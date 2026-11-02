// A0.1 (plan SCUMM): recorrido automático y pruebas de atajos con la API de QA del juego (?qa=1).
// Ejecuta rutas declarativas de qa/*.json (newGame, act, use, combine, talk, walk, goto, dismissAll, wait, resize y,
// desde A2.4, key, click, rightclick y doubleclick; desde A2.10, runScript; desde A2.9, journal y callAnon)
// con comprobaciones de escena, inventario y flags. Cada ruta va en un navegador limpio (sin partidas
// guardadas). Deja una captura por paso y un informe en walkthrough-shots/ (report.json + resumen de CI).
//
// Tipos de ruta:
//  - walkthrough: todos los pasos y comprobaciones deben pasar (y el objetivo, si lo hay).
//  - sequence-break: intenta llegar antes de tiempo a `goal`. Si lo consigue es un atajo abierto → FALLO,
//    salvo que la ruta lleve `knownBreak` (checkpoint que lo cerrará) → XFAIL documentado. Si lleva
//    `knownBreak` y ya no se llega → XPASS, que también falla para que se quite la marca.
//    La ruta solo se da por cerrada si la para el paso del intento (`attempt: true`, o el último) o un paso
//    con `gate: true`; un tropiezo en cualquier otro paso es ERROR. Los pasos anteriores al intento
//    necesitan `expect`, para no dar por cerrada una ruta que nunca llegó al punto del atajo.
//
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/walkthrough.mjs [qa/walkthrough.json qa/sequence-breaks.json]
//      WALKTHROUGH_ONLY=<id de ruta> para lanzar una sola.
//      --selftest [qa/selftest.json] (A0.5): autotest del runner. Cada ruta lleva `expectStatus` (y opcionalmente
//      `expectDetail`, regex del detalle); falla si alguna clasificación no es la esperada. Solo aquí vale "allowGoto".
//
// La lógica pura (definición de rutas, comprobaciones y clasificación) está en scripts/lib/walkthrough-core.mjs.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import {
  attemptIndex, check, checkAttemptRan, checkRejects, classify, describe, fmtPoint, inBounds, kindOf, routeDefects,
  selftestDefects, selftestMismatch, notePixel,
} from './lib/walkthrough-core.mjs';

const ARGS = process.argv.slice(2);
const SELFTEST = ARGS.includes('--selftest');
const FILE_ARGS = ARGS.filter((a) => a !== '--selftest');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const OUT = process.env.WALKTHROUGH_OUT || (SELFTEST ? 'walkthrough-selftest-shots' : 'walkthrough-shots');
const ONLY = process.env.WALKTHROUGH_ONLY || '';
const FILES = FILE_ARGS.length ? FILE_ARGS : SELFTEST ? ['qa/selftest.json'] : ['qa/walkthrough.json', 'qa/sequence-breaks.json'];
// Ruido conocido que no rompe el juego (igual que el smoke) y recursos que faltan (se listan aparte)
const IGNORE = [/AudioContext/i, /autoplay/i, /WalletConnect/i, /ethereum/i, /favicon/i, /Failed to load resource/i];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const callQa = (page, step) => page.evaluate(async (s) => {
  const q = window.__qa;
  switch (s.do) {
    case 'newGame': return q.newGame();
    case 'act': return q.act(s.verb, s.target, s.choices ?? [], s.holdTextMs ?? 0);
    case 'use': return q.use(s.item, s.target, s.choices ?? []);
    case 'combine': return q.combine(s.items[0], s.items[1]);
    case 'talk': return q.talk(s.npc, s.choices ?? []);
    case 'walk': return q.walk(s.x, s.y);
    case 'goto': return q.goto(s.scene, s.spawn);
    case 'dismissAll': return q.dismissAll();
    case 'state': return q.state();
    // A2.4: teclado y ratón de escritorio
    case 'key': return q.press(s.key, s.phase ?? 'press');
    case 'click': return q.click(s.target, s.choices ?? []);
    case 'rightclick': return q.rightClick(s.target, s.choices ?? []);
    case 'doubleclick': return q.doubleClick(s.target);
    // A2.10: script de QA por el ScriptEngine principal (cinemáticas); Esc a los `skipAfterMs` para saltarla
    case 'runScript': return q.runScript(s.ops, s.skipAfterMs !== undefined ? { skipAfterMs: s.skipAfterMs } : {});
    // A2.9: diario (móvil de Dex): abrir/cerrar con su botón y llamar a Anon
    case 'journal': return s.action === 'close' ? q.closeJournal() : q.openJournal(s.tab ?? 'goals');
    case 'callAnon': return q.callAnon();
    default: throw new Error(`[qa:error] paso desconocido «${s.do}»`);
  }
}, step);

async function runStep(page, step) {
  if (step.do === 'wait') {
    await sleep(step.ms ?? 1000);
    return page.evaluate(() => window.__qa.state());
  }
  // A1.10: redimensiona el viewport (dispara el resize del ScaleManager, de window y de visualViewport) y espera a que
  // pasen los rebuild con debounce de la interfaz (300 ms) y los reintentos de GameScene.scheduleResize (400 ms).
  // Un console.error o pageerror de un listener que quedó de una escena anterior hace fallar la ruta como siempre.
  if (step.do === 'resize') {
    await page.setViewport({ width: step.width, height: step.height });
    await sleep(step.settleMs ?? 1200);
    return page.evaluate(() => window.__qa.state());
  }
  // walk con untilScene: volver a pulsar el mismo punto si un trigger intermedio paró al personaje. Si no
  // llega, es un error de la prueba; solo cuenta como «el juego no deja» si lleva `trigger` y el personaje
  // llegó a pisar ese trigger (o se disparó) sin pasar de escena. Así un cambio de coordenadas o de
  // pathfinding nunca se confunde con un gate cerrado.
  if (step.do === 'walk' && step.untilScene) {
    const before = await page.evaluate(() => window.__qa.state());
    let trigger = null;
    if (step.trigger) {
      trigger = before.triggers.find((t) => t.id === step.trigger);
      if (!trigger) throw new Error(`[qa:error] no existe el trigger «${step.trigger}» en ${before.scene}`);
      if (!inBounds({ x: step.x, y: step.y }, trigger.bounds)) {
        throw new Error(`[qa:error] ruta mal definida: ${step.x},${step.y} no cae dentro de ${step.trigger} ${JSON.stringify(trigger.bounds)}`);
      }
    }
    const tries = step.tries ?? 3;
    let st;
    for (let i = 0; i < tries; i++) {
      st = await callQa(page, step);
      if (st.scene === step.untilScene) return st;
    }
    const where = `escena «${st.scene}», personaje en ${fmtPoint(st.player)}`;
    if (trigger && st.scene === before.scene) {
      const fired = !before.firedTriggers.includes(trigger.id) && st.firedTriggers.includes(trigger.id);
      if (fired || inBounds(st.player, trigger.bounds)) {
        throw new Error(`[qa:blocked] llegó a ${trigger.id} y no pasó a «${step.untilScene}» (${where})`);
      }
    }
    throw new Error(`[qa:error] WALK ${step.x},${step.y} no llegó a «${step.untilScene}» tras ${tries} intentos (${where}${trigger ? `, fuera de ${trigger.id}` : ''})`);
  }
  return callQa(page, step);
}

async function runRoute(file, route) {
  const result = {
    file, id: route.id, title: route.title ?? '', kind: route.kind ?? 'walkthrough', knownBreak: route.knownBreak ?? null,
    status: 'pass', detail: '', secs: 0, steps: [], farthest: null, lastState: null, problems: [], missing: [],
  };
  // Una ruta mal escrita no llega a abrir el navegador
  const defects = routeDefects(route, { allowGoto: SELFTEST && route.allowGoto === true });
  if (defects.length) return { ...result, status: 'error', detail: `ruta mal definida: ${defects.join('; ')}` };

  const dir = `${OUT}/${slug(route.id)}`;
  mkdirSync(dir, { recursive: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const problems = result.problems;
  const missing = new Set();
  page.on('pageerror', (err) => problems.push(`error de página: ${err.message.split('\n')[0]}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !IGNORE.some((re) => re.test(text))) problems.push(`console.error: ${text.slice(0, 200)}`);
    // El watchdog de ScriptEngine solo salta con un script colgado sin nada en pantalla (A1.1): aquí es un fallo, no ruido
    if (msg.type() === 'warn' && /forceReset/.test(text)) problems.push(`watchdog: ${text.slice(0, 200)}`);
  });
  page.on('response', (res) => {
    if (res.url().startsWith(BASE) && res.status() >= 400) missing.add(`${res.status()} ${res.url().replace(BASE, '').split('?')[0]}`);
  });

  const t0 = Date.now();
  const seqBreak = result.kind === 'sequence-break';
  const attempt = attemptIndex(route);
  let state = null;
  let stopped = null;
  let goalReached = false;
  // A1.10: listeners de resize tras el primer paso, para `expect.noListenerGrowth`
  let listenersBaseline;
  // A2.4: lo mismo con los listeners de teclado y del lienzo
  let inputListenersBaseline;
  // A2.8: alto del jugador por escena (para `expect.pixel.sameHeightAs`)
  const pixelRefs = {};

  try {
    await page.goto(`${BASE}/?qa=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => !!window.__qa, { timeout: 90_000, polling: 250 });
  } catch (err) {
    stopped = { kind: 'error', index: 0, message: `la página no expuso window.__qa: ${err.message.split('\n')[0]}` };
  }

  for (let i = 0; !stopped && i < route.steps.length; i++) {
    const step = route.steps[i];
    const label = step.label || describe(step);
    const ts = Date.now();
    const before = await page.evaluate(() => window.__qa.state()).catch(() => state);
    let error = null;
    let fails = [];
    try {
      state = await runStep(page, step);
      if (listenersBaseline === undefined && typeof state?.resizeListeners === 'number') listenersBaseline = state.resizeListeners;
      if (inputListenersBaseline === undefined && typeof state?.inputListeners === 'number') inputListenersBaseline = state.inputListeners;
      // Un atajo abierto manda aunque fallen las comprobaciones del paso
      if (route.goal && check(route.goal, state).length === 0) goalReached = true;
      fails = [...check(step.expect, state, { listenersBaseline, inputListenersBaseline, pixelRefs }), ...checkRejects(step, before, state)];
      notePixel(pixelRefs, state);
      if (seqBreak && i === attempt && !goalReached) fails.push(...checkAttemptRan(step, before, state));
    } catch (err) {
      error = err.message.split('\n')[0];
      state = await page.evaluate(() => window.__qa?.state()).catch(() => state);
    }
    await page.screenshot({ path: `${dir}/${String(i + 1).padStart(2, '0')}-${slug(label)}.jpg`, type: 'jpeg', quality: 60 }).catch(() => {});
    const secs = Number(((Date.now() - ts) / 1000).toFixed(1));
    result.steps.push({ index: i + 1, label, secs, scene: state?.scene ?? null, resizeListeners: state?.resizeListeners ?? null, error, fails, note: step.note ?? null });
    if (seqBreak && goalReached) {
      console.log(`    ⚑ ${i + 1}. ${label} (${secs} s) · ${state.scene}: objetivo alcanzado`);
      result.farthest = { index: i + 1, label, scene: state.scene };
      break;
    }
    if (error || fails.length) {
      console.log(`    ✖ ${i + 1}. ${label} (${secs} s) — ${error ?? fails.join('; ')}`);
      stopped = { kind: error ? kindOf(error) : 'assert', index: i + 1, message: error ?? fails.join('; ') };
      break;
    }
    result.farthest = { index: i + 1, label, scene: state.scene };
    const listeners = step.expect?.noListenerGrowth
      ? ` · listeners de resize ${state.resizeListeners} (tras el primer paso ${listenersBaseline}) · de teclado/lienzo ${state.inputListeners ?? '?'} (${inputListenersBaseline ?? '?'})`
      : '';
    console.log(`    ✓ ${i + 1}. ${label} (${secs} s) · ${state.scene}${listeners}`);
  }

  result.secs = Number(((Date.now() - t0) / 1000).toFixed(1));
  result.lastState = state;
  result.missing = [...missing];
  await context.close();

  const { status, detail } = classify(route, {
    stopped,
    goalReached,
    goalFails: route.goal ? check(route.goal, state) : [],
    problems,
    stepLabel: (index) => result.steps[index - 1]?.label,
  });
  return { ...result, status, detail };
}

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

console.log(`${SELFTEST ? 'Selftest del runner de walkthrough' : 'Walkthrough de AdrianAdventure'} contra ${BASE}`);
const results = [];
for (const file of FILES) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n${spec.title ?? file}`);
  for (const route of spec.routes) {
    if (ONLY && route.id !== ONLY) continue;
    console.log(`  ▸ ${route.id}${route.title ? ` — ${route.title}` : ''}`);
    const stDefects = SELFTEST ? selftestDefects(route) : [];
    const r = stDefects.length
      ? { file, id: route.id, kind: route.kind ?? 'walkthrough', status: 'error', detail: '', secs: 0, steps: [], farthest: null, problems: [], missing: [] }
      : await runRoute(file, route);
    console.log(`  → ${r.status.toUpperCase()} en ${r.secs} s${r.detail ? `: ${r.detail}` : ''}`);
    if (SELFTEST) {
      r.expectStatus = route.expectStatus ?? null;
      r.mismatch = selftestMismatch(route, r);
      console.log(r.mismatch ? `  ✖ SELFTEST: ${r.mismatch}` : `  ✓ selftest: ${r.status.toUpperCase()} como se esperaba`);
    }
    if ((SELFTEST && r.mismatch) || (!SELFTEST && ['fail', 'error', 'xpass'].includes(r.status))) {
      for (const p of r.problems.slice(0, 5)) console.log(`      · ${p}`);
      for (const line of (r.lastState?.log ?? []).slice(-10)) console.log(`      | ${line}`);
      if (r.lastState) console.log(`      estado: escena ${r.lastState.scene}, ocupado [${r.lastState.busy}], inventario [${r.lastState.inventory}]`);
    }
    results.push(r);
  }
}
await browser.close();

const missing = [...new Set(results.flatMap((r) => r.missing))];
writeFileSync(`${OUT}/report.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), selftest: SELFTEST, results, missing }, null, 2));

const LABEL = { pass: 'OK', xfail: 'XFAIL (conocido)', xpass: 'XPASS (quitar knownBreak)', fail: 'FALLO', error: 'ERROR' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const farthest = (r) => (r.farthest ? cell(`${r.farthest.index}/${r.steps.length > r.farthest.index ? r.steps.length : r.farthest.index}. ${r.farthest.label} (${r.farthest.scene})`) : '—');
const md = SELFTEST
  ? [
    '### Selftest del runner de walkthrough (A0.5)',
    '',
    `Contra \`${BASE}\` · capturas en el artefacto \`walkthrough-selftest-shots\``,
    '',
    '| Ruta | Tipo | Esperado | Resultado | Selftest | Detalle |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${cell(r.id)} | ${r.kind} | ${cell(r.expectStatus)} | ${LABEL[r.status]} | ${r.mismatch ? `✖ ${cell(r.mismatch)}` : '✓'} | ${cell(r.detail)} |`),
  ]
  : [
    '### Walkthrough y atajos (A0.1)',
    '',
    `Contra \`${BASE}\` · capturas en el artefacto \`walkthrough-shots\``,
    '',
    '| Ruta | Tipo | Resultado | Punto más lejano | Detalle |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${cell(r.id)} | ${r.kind} | ${LABEL[r.status]} | ${farthest(r)} | ${cell(r.detail)} |`),
  ];
if (missing.length) md.push('', `<details><summary>Recursos con error HTTP (${missing.length})</summary>`, '', ...missing.slice(0, 50).map((m) => `- ${cell(m)}`), '', '</details>');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);

if (missing.length) console.log(`\nRecursos con error HTTP (${missing.length}): ${missing.slice(0, 10).join(', ')}`);
if (!results.length) {
  console.log('\nNinguna ruta ejecutada.');
  process.exit(1);
}
if (SELFTEST) {
  const wrong = results.filter((r) => r.mismatch);
  if (wrong.length) {
    console.log(`\nSelftest: ${wrong.length} clasificación(es) inesperada(s): ${wrong.map((r) => `${r.id} (${r.mismatch})`).join('; ')}`);
    process.exit(1);
  }
  console.log(`\nSelftest OK (${results.length} rutas, cada una con la clasificación esperada)`);
  process.exit(0);
}
const bad = results.filter((r) => ['fail', 'error', 'xpass'].includes(r.status));
if (bad.length) {
  console.log(`\n${bad.length} ruta(s) con fallo: ${bad.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
console.log(`\nWalkthrough OK (${results.length} rutas; ${results.filter((r) => r.status === 'xfail').length} atajo(s) conocidos)`);

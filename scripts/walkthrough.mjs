// A0.1 (plan SCUMM): recorrido automático y pruebas de atajos con la API de QA del juego (?qa=1).
// Ejecuta rutas declarativas de qa/*.json (newGame, act, use, combine, talk, walk, goto, dismissAll, wait)
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
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const OUT = process.env.WALKTHROUGH_OUT || 'walkthrough-shots';
const ONLY = process.env.WALKTHROUGH_ONLY || '';
const FILES = process.argv.length > 2 ? process.argv.slice(2) : ['qa/walkthrough.json', 'qa/sequence-breaks.json'];
// Ruido conocido que no rompe el juego (igual que el smoke) y recursos que faltan (se listan aparte)
const IGNORE = [/AudioContext/i, /autoplay/i, /WalletConnect/i, /ethereum/i, /favicon/i, /Failed to load resource/i];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describe(s) {
  switch (s.do) {
    case 'act': return `${s.verb} ${s.target}${s.holdTextMs ? ` (texto ${s.holdTextMs / 1000} s)` : ''}`;
    case 'use': return `USE ${s.item} → ${s.target}`;
    case 'combine': return `USE ${s.items.join(' + ')}`;
    case 'talk': return `TALK ${s.npc}${s.choices?.length ? ` [${s.choices.join(' / ')}]` : ''}`;
    case 'walk': return `WALK ${s.x},${s.y}${s.trigger ? ` (${s.trigger})` : ''}${s.untilScene ? ` → ${s.untilScene}` : ''}`;
    case 'goto': return `GOTO ${s.scene}`;
    case 'wait': return `WAIT ${s.ms} ms`;
    default: return s.do;
  }
}

/** Comprobaciones de estado: scene, has, lacks, flags, visited, achievements. Devuelve los fallos. */
function check(expect, st) {
  if (!expect) return [];
  if (!st) return ['sin estado del juego'];
  const f = [];
  if (expect.scene && st.scene !== expect.scene) f.push(`escena «${st.scene}», se esperaba «${expect.scene}»`);
  for (const id of expect.has ?? []) if (!st.inventory.includes(id)) f.push(`falta «${id}» en el inventario`);
  for (const id of expect.lacks ?? []) if (st.inventory.includes(id)) f.push(`«${id}» no debería estar en el inventario`);
  for (const [flag, want] of Object.entries(expect.flags ?? {})) {
    if (Boolean(st.flags[flag]) !== want) f.push(`flag ${flag} = ${Boolean(st.flags[flag])}, se esperaba ${want}`);
  }
  for (const id of expect.visited ?? []) if (!st.visited.includes(id)) f.push(`no se visitó «${id}»`);
  for (const id of expect.achievements ?? []) if (!st.achievements.includes(id)) f.push(`falta el logro «${id}»`);
  return f;
}

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
    default: throw new Error(`[qa:error] paso desconocido «${s.do}»`);
  }
}, step);

const inBounds = (p, b) => !!p && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const fmtPoint = (p) => (p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : '?');

async function runStep(page, step) {
  if (step.do === 'wait') {
    await sleep(step.ms ?? 1000);
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

const kindOf = (message) => (/\[qa:blocked\]/.test(message) ? 'blocked' : 'error');

/** Paso que intenta el atajo en una ruta sequence-break: el marcado con `attempt`, o el último. */
const attemptIndex = (route) => {
  const i = route.steps.findIndex((s) => s.attempt);
  return i >= 0 ? i : route.steps.length - 1;
};

/** Defectos de definición: una ruta de atajo mal escrita no puede darse por cerrada. */
function routeDefects(route) {
  if ((route.kind ?? 'walkthrough') !== 'sequence-break') return [];
  const out = [];
  if (!route.goal) out.push('falta "goal"');
  if (!route.steps?.length) out.push('no tiene pasos');
  if (route.steps.filter((s) => s.attempt).length > 1) out.push('más de un paso con "attempt"');
  route.steps.slice(0, attemptIndex(route)).forEach((s, i) => {
    if (!s.expect) out.push(`paso ${i + 1} (${describe(s)}): los pasos anteriores al intento necesitan "expect"`);
  });
  return out;
}

async function runRoute(file, route) {
  const dir = `${OUT}/${slug(route.id)}`;
  mkdirSync(dir, { recursive: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const problems = [];
  const missing = new Set();
  page.on('pageerror', (err) => problems.push(`error de página: ${err.message.split('\n')[0]}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !IGNORE.some((re) => re.test(text))) problems.push(`console.error: ${text.slice(0, 200)}`);
    // El watchdog de 30 s de GameScene descarta scripts en cola (A1.1): aquí es un fallo, no ruido
    if (msg.type() === 'warn' && /forceReset/.test(text)) problems.push(`watchdog: ${text.slice(0, 200)}`);
  });
  page.on('response', (res) => {
    if (res.url().startsWith(BASE) && res.status() >= 400) missing.add(`${res.status()} ${res.url().replace(BASE, '').split('?')[0]}`);
  });

  const result = {
    file, id: route.id, title: route.title ?? '', kind: route.kind ?? 'walkthrough', knownBreak: route.knownBreak ?? null,
    status: 'pass', detail: '', secs: 0, steps: [], farthest: null, lastState: null, problems, missing: [],
  };
  const t0 = Date.now();
  let state = null;
  let stopped = null;
  let goalReached = false;

  const defects = routeDefects(route);
  if (defects.length) {
    await context.close();
    return { ...result, status: 'error', detail: `ruta mal definida: ${defects.join('; ')}` };
  }

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
    let error = null;
    let fails = [];
    try {
      state = await runStep(page, step);
      fails = check(step.expect, state);
    } catch (err) {
      error = err.message.split('\n')[0];
      state = await page.evaluate(() => window.__qa?.state()).catch(() => state);
    }
    await page.screenshot({ path: `${dir}/${String(i + 1).padStart(2, '0')}-${slug(label)}.jpg`, type: 'jpeg', quality: 60 }).catch(() => {});
    const secs = Number(((Date.now() - ts) / 1000).toFixed(1));
    result.steps.push({ index: i + 1, label, secs, scene: state?.scene ?? null, error, fails, note: step.note ?? null });
    if (error || fails.length) {
      console.log(`    ✖ ${i + 1}. ${label} (${secs} s) — ${error ?? fails.join('; ')}`);
      stopped = { kind: error ? kindOf(error) : 'assert', index: i + 1, message: error ?? fails.join('; ') };
      break;
    }
    result.farthest = { index: i + 1, label, scene: state.scene };
    console.log(`    ✓ ${i + 1}. ${label} (${secs} s) · ${state.scene}`);
    if (route.goal && check(route.goal, state).length === 0) {
      goalReached = true;
      if (result.kind === 'sequence-break') break;
    }
  }

  result.secs = Number(((Date.now() - t0) / 1000).toFixed(1));
  result.lastState = state;
  result.missing = [...missing];
  await context.close();

  if (result.kind === 'sequence-break') {
    const attempt = attemptIndex(route);
    // Solo cierra la ruta el paso del intento o uno marcado como gate; cualquier otro tropiezo es un error de
    // la prueba (no se llegó a probar el atajo), igual que un [qa:error] en cualquier paso.
    const closingStep = stopped && stopped.index > 0 && stopped.kind !== 'error'
      && (stopped.index - 1 === attempt || route.steps[stopped.index - 1]?.gate === true);
    if (stopped?.kind === 'error') {
      result.status = 'error';
      result.detail = `paso ${stopped.index}: ${stopped.message}`;
    } else if (goalReached) {
      result.status = result.knownBreak ? 'xfail' : 'fail';
      result.detail = result.knownBreak
        ? `atajo abierto, conocido: lo cierra ${result.knownBreak}`
        : 'atajo abierto: se llega antes de tiempo';
    } else if (stopped && !closingStep) {
      result.status = 'error';
      result.detail = `paso de preparación ${stopped.index} (${result.steps[stopped.index - 1]?.label ?? '?'}) no salió como se esperaba, así que el atajo no se llegó a intentar: ${stopped.message}`;
    } else {
      const why = stopped
        ? `paso ${stopped.index}${stopped.index - 1 === attempt ? ' (intento)' : ' (gate)'}: ${stopped.message}`
        : `el intento (paso ${attempt + 1}) terminó sin cumplir ${JSON.stringify(route.goal)}`;
      result.status = result.knownBreak ? 'xpass' : 'pass';
      result.detail = result.knownBreak ? `el atajo ya está cerrado (${why}): quita "knownBreak" de la ruta` : `cerrado (${why})`;
    }
  } else if (stopped) {
    result.status = 'fail';
    result.detail = `paso ${stopped.index}: ${stopped.message}`;
  } else if (route.goal && !goalReached) {
    result.status = 'fail';
    result.detail = `sin objetivo: ${check(route.goal, state).join('; ')}`;
  }
  if (problems.length && !['fail', 'error'].includes(result.status)) {
    result.status = 'fail';
    result.detail = `${result.detail ? `${result.detail} · ` : ''}${problems.length} error(es) del juego: ${problems[0]}`;
  }
  return result;
}

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

console.log(`Walkthrough de AdrianAdventure contra ${BASE}`);
const results = [];
for (const file of FILES) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n${spec.title ?? file}`);
  for (const route of spec.routes) {
    if (ONLY && route.id !== ONLY) continue;
    console.log(`  ▸ ${route.id}${route.title ? ` — ${route.title}` : ''}`);
    const r = await runRoute(file, route);
    console.log(`  → ${r.status.toUpperCase()} en ${r.secs} s${r.detail ? `: ${r.detail}` : ''}`);
    if (['fail', 'error', 'xpass'].includes(r.status)) {
      for (const p of r.problems.slice(0, 5)) console.log(`      · ${p}`);
      for (const line of (r.lastState?.log ?? []).slice(-10)) console.log(`      | ${line}`);
      if (r.lastState) console.log(`      estado: escena ${r.lastState.scene}, ocupado [${r.lastState.busy}], inventario [${r.lastState.inventory}]`);
    }
    results.push(r);
  }
}
await browser.close();

const missing = [...new Set(results.flatMap((r) => r.missing))];
writeFileSync(`${OUT}/report.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), results, missing }, null, 2));

const LABEL = { pass: 'OK', xfail: 'XFAIL (conocido)', xpass: 'XPASS (quitar knownBreak)', fail: 'FALLO', error: 'ERROR' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = [
  '### Walkthrough y atajos (A0.1)',
  '',
  `Contra \`${BASE}\` · capturas en el artefacto \`walkthrough-shots\``,
  '',
  '| Ruta | Tipo | Resultado | Punto más lejano | Detalle |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${cell(r.id)} | ${r.kind} | ${LABEL[r.status]} | ${r.farthest ? cell(`${r.farthest.index}/${r.steps.length > r.farthest.index ? r.steps.length : r.farthest.index}. ${r.farthest.label} (${r.farthest.scene})`) : '—'} | ${cell(r.detail)} |`),
];
if (missing.length) md.push('', `<details><summary>Recursos con error HTTP (${missing.length})</summary>`, '', ...missing.slice(0, 50).map((m) => `- ${cell(m)}`), '', '</details>');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);

if (missing.length) console.log(`\nRecursos con error HTTP (${missing.length}): ${missing.slice(0, 10).join(', ')}`);
const bad = results.filter((r) => ['fail', 'error', 'xpass'].includes(r.status));
if (!results.length) {
  console.log('\nNinguna ruta ejecutada.');
  process.exit(1);
}
if (bad.length) {
  console.log(`\n${bad.length} ruta(s) con fallo: ${bad.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
console.log(`\nWalkthrough OK (${results.length} rutas; ${results.filter((r) => r.status === 'xfail').length} atajo(s) conocidos)`);

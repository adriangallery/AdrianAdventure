// F3.2b (plan FUNTICO_ADVENTURE): la aventura (Campaign) en el build funtico se juega en vertical y en horizontal, con
// giro en caliente y sin perder estado. Contra `campaign.html?qa=1` (banco de F3.1, que activa el LayoutProfile
// `STACKED_PORTRAIT_LAYOUT`), renderer CANVAS (Chrome sin WebGL, como triage-e2e):
//   1. Juega el capítulo 1 (ruta crítica de qa/walkthrough.json cortada en chapter:1) en 390x844 con tres giros
//      (vertical→horizontal en mitad de la ruta; horizontal→vertical→horizontal→vertical con un texto abierto) y
//      comprueba tras cada giro: escena, flags, inventario, posición de Dex, texto abierto y reloj que sigue. Antes de la
//      ruta, toques REALES (touchscreen) en vertical: verbo del panel y hotspots que empiezan fuera de cuadro (Dex anda
//      hacia el borde tocando la escena y la cámara le sigue). Otra pasada entera en 844x390.
//   2. Capturas en 390x844, 844x390, 1280x720 y 1920x1080 (escena, diálogo, inventario, móvil/diario, opciones).
//   3. Bounds: todo interactivo de la interfaz (lienzo y HTML) dentro del viewport; en vertical, el panel (verbos,
//      inventario, flechas) con zonas ≥ 44 px y letra ≥ 14 px, y diálogos/opciones con letra ≥ 14 px; la escena ≥ 38 % del
//      alto y Dex dentro del cuadro con Dex quieto. Lo demás que no llega a 44/14 px se lista como aviso.
//   4. fps: mediana por rAF con CPU x4 en 390x844 ≥ 50 (canvas); fotograma más largo durante un giro ≤ 250 ms (CPU x1).
//   5. Sin errores de consola ni de página.
// Uso (por turno-pesado):
//   FUNTICO_CAMPAIGN_HARNESS=1 npx vite build --mode funtico && cp -r assets dist-funtico/
//   npx vite preview --mode funtico --outDir dist-funtico --host 127.0.0.1 --port 4175 --strictPort &
//   BASE_URL=http://127.0.0.1:4175 node scripts/funtico/campaign-layout-e2e.mjs
// Variables: OUT (por defecto campaign-layout-e2e/), ONLY=portrait,landscape,desktop (fases a correr).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../lib/browser.mjs';
import { check, cutRoute, parseUntil } from '../lib/walkthrough-core.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const OUT = process.env.OUT || 'campaign-layout-e2e';
const ONLY = new Set((process.env.ONLY || 'portrait,landscape,desktop').split(',').map((s) => s.trim()));
const IGNORE = [/AudioContext/i, /autoplay/i, /WalletConnect/i, /ethereum/i, /favicon/i, /Failed to load resource/i];
const MIN_TOUCH = 44;
const MIN_FONT = 14;
mkdirSync(OUT, { recursive: true });

const file = JSON.parse(readFileSync('qa/walkthrough.json', 'utf-8'));
const route = cutRoute((file.routes ?? file).find((r) => r.id === 'ruta-critica'), parseUntil('chapter:1'));
if (!route?.steps?.length) { console.error('no hay ruta-critica en qa/walkthrough.json'); process.exit(2); }

const problems = [];
const warnings = [];
const report = { base: BASE, renderer: 'canvas', passes: {}, rotations: [], realTaps: [], audits: [], fps: null, shots: [], problems, warnings, ok: false };
const fail = (m) => { problems.push(m); console.log(`  FALLO ${m}`); };
const pass = (m) => console.log(`  ok ${m}`);
const want = (cond, m) => (cond ? pass(m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parse = (s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; };
const MOBILE = new Set(['390x844', '844x390']);
const vp = (s) => ({ ...parse(s), deviceScaleFactor: MOBILE.has(s) ? 2 : 1, isMobile: MOBILE.has(s), hasTouch: MOBILE.has(s) });

const callQa = (page, s) => page.evaluate(async (s) => {
  const q = window.__qa;
  switch (s.do) {
    case 'newGame': return q.newGame();
    case 'act': return q.act(s.verb, s.target, s.choices ?? [], s.holdTextMs ?? 0);
    case 'use': return q.use(s.item, s.target, s.choices ?? []);
    case 'give': return q.give(s.item, s.target, s.choices ?? []);
    case 'pick': return q.pick(s.verb, s.item);
    case 'combine': return q.combine(s.items[0], s.items[1]);
    case 'talk': return q.talk(s.npc, s.choices ?? []);
    case 'walk': return q.walk(s.x, s.y);
    case 'dismissAll': return q.dismissAll();
    case 'state': return q.state();
    case 'key': return q.press(s.key, s.phase ?? 'press');
    case 'click': return q.click(s.target, s.choices ?? []);
    case 'rightclick': return q.rightClick(s.target, s.choices ?? []);
    case 'doubleclick': return q.doubleClick(s.target);
    case 'runScript': return q.runScript(s.ops, s.skipAfterMs !== undefined ? { skipAfterMs: s.skipAfterMs } : {});
    case 'journal': return s.action === 'close' ? q.closeJournal() : q.openJournal(s.tab ?? 'goals');
    case 'callAnon': return q.callAnon();
    case 'mockWeb3': return q.mockWeb3(s.web3 === undefined ? null : s.web3);
    default: throw new Error(`[qa:error] paso desconocido «${s.do}»`);
  }
}, s);

/** Estado que no debe cambiar con un giro (y el reloj, que debe seguir). */
const snap = (page) => page.evaluate(() => {
  const q = window.__qa.state();
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const sp = q.speech;
  return {
    scene: q.scene,
    flags: JSON.stringify(Object.keys(q.flags).sort().map((k) => [k, q.flags[k]])),
    inventory: q.inventory.join(','),
    player: q.player,
    speech: sp ? `${sp.speaker}|${sp.text}`.slice(0, 300) : null,
    speechBox: sp ? { x: sp.x, y: sp.y, w: sp.w, h: sp.h, mode: sp.mode } : null,
    choices: q.choices ? q.choices.length : null,
    playTimeMs: q.playTimeMs ?? 0,
    w: g.scale.width,
    h: g.scale.height,
    cam: gs?.cameras?.main ? Math.round(gs.cameras.main.scrollX) : null,
  };
});

/**
 * Auditoría de la interfaz: interactivos y textos de UIScene (lienzo) y elementos pulsables del HTML, en px CSS
 * (Scale.RESIZE: px del juego = px CSS). `panel` marca lo que cuelga del panel SCUMM; `speech`, diálogos y opciones.
 */
const audit = (page) => page.evaluate(() => {
  const g = window.__game;
  const ui = g.scene.getScene('UIScene');
  const gs = g.scene.getScene('GameScene');
  const W = g.scale.width;
  const H = g.scale.height;
  const panelC = ui?.scummUI?.container ?? null;
  const choiceC = ui?.choicePanel?.container ?? null;
  const out = { W, H, interactive: [], texts: [], html: [], sceneRatio: null, dex: null, panelH: g.registry.get('scummPanelHeight') ?? null };
  const rectOf = (o, r) => {
    const m = o.getWorldTransformMatrix();
    const ox = o.displayOriginX ?? 0;
    const oy = o.displayOriginY ?? 0;
    const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]
      .map(([x, y]) => m.transformPoint(x - ox, y - oy));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const label = (o) => (o.type === 'Text' ? o.text : (o.name || o.type)).slice(0, 30);
  const walk = (list, inPanel, inSpeech) => {
    for (const o of list) {
      if (!o.visible || o.alpha === 0) continue;
      const p = inPanel || o === panelC;
      const s = inSpeech || o === choiceC;
      if (o.list) { walk(o.list, p, s); continue; }
      if (o.input?.enabled) {
        const ha = o.input.hitArea;
        const r = ha && typeof ha.width === 'number' ? rectOf(o, ha) : rectOf(o, { x: 0, y: 0, width: o.width, height: o.height });
        out.interactive.push({ what: label(o), panel: p, speech: s, ...r });
      }
      if (o.type === 'Text' && /[A-Za-z]/.test(o.text)) {
        const m = o.getWorldTransformMatrix();
        const px = parseFloat(String(o.style.fontSize)) * Math.hypot(m.a, m.b);
        const r = rectOf(o, { x: 0, y: 0, width: o.width, height: o.height });
        const speech = s || o.depth >= 900 || /DialogueBox/.test(o.name ?? '');
        out.texts.push({ what: o.text.slice(0, 30), px: Math.round(px * 10) / 10, panel: p, speech, onScreen: r.x < W && r.y < H && r.x + r.w > 0 && r.y + r.h > 0 });
      }
    }
  };
  if (ui?.children) walk(ui.children.list, false, false);
  // Diálogo y subtítulos (DialogueBox): los textos que da getSpeech()
  const spTexts = ui?.dialogueBox ? Object.values(ui.dialogueBox).filter((v) => v && v.type === 'Text' && v.visible && v.text) : [];
  for (const t of spTexts) {
    const m = t.getWorldTransformMatrix();
    out.texts.push({ what: t.text.slice(0, 30), px: Math.round(parseFloat(String(t.style.fontSize)) * Math.hypot(m.a, m.b) * 10) / 10, panel: false, speech: true, onScreen: true });
  }
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    out.html.push({ what: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height, font: parseFloat(cs.fontSize) });
  }
  const panelH = out.panelH ?? 0;
  out.sceneRatio = Math.round(((H - panelH) / H) * 1000) / 1000;
  if (gs?.player && gs.cameras?.main) {
    const cam = gs.cameras.main;
    const sx = (gs.player.x - cam.scrollX) * cam.zoom;
    const sy = (gs.player.y - cam.scrollY) * cam.zoom;
    out.dex = { sx: Math.round(sx), sy: Math.round(sy), inView: sx >= 0 && sx <= W && sy >= 0 && sy <= H - panelH + 1, // «quieto» = Player.isMoving() (la `path` de QA es la última ruta y se queda puesta al parar: con ella nunca filtraba)
    moving: !!gs.player.isMoving?.() };
  }
  return out;
});

function judge(size, where, a, { strictPortrait }) {
  // Tolerancia de 3 px: la zona táctil de 44×44 de los botones de arriba (A5.2, touchTarget) sobresale 2 px del borde
  // superior sin que se vea nada fuera (es la caja de toque, no el dibujo)
  const inVp = (r) => r.x >= -3 && r.y >= -3 && r.x + r.w <= a.W + 3 && r.y + r.h <= a.H + 3;
  const outs = a.interactive.filter((r) => !inVp(r)).map((r) => `${r.what} (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)})`);
  const htmlOuts = a.html.filter((r) => !inVp(r)).map((r) => r.what);
  want(outs.length === 0 && htmlOuts.length === 0, `[${size}] ${where}: interactivos dentro del viewport${outs.length + htmlOuts.length ? `: fuera ${[...outs, ...htmlOuts].join('; ')}` : ''}`);
  const smallTouch = a.interactive.filter((r) => Math.min(r.w, r.h) < MIN_TOUCH - 0.5);
  const smallFont = a.texts.filter((t) => t.onScreen && t.px < MIN_FONT - 0.05);
  const mobile = MOBILE.has(size);
  if (mobile && strictPortrait) {
    const pT = smallTouch.filter((r) => r.panel).map((r) => `${r.what} ${Math.round(r.w)}x${Math.round(r.h)}`);
    const pF = smallFont.filter((t) => t.panel || t.speech).map((t) => `${t.what} ${t.px}px`);
    want(pT.length === 0, `[${size}] ${where}: panel con zonas táctiles ≥ ${MIN_TOUCH} px${pT.length ? `: ${pT.join('; ')}` : ''}`);
    want(pF.length === 0, `[${size}] ${where}: panel, diálogos y opciones con letra ≥ ${MIN_FONT} px${pF.length ? `: ${pF.join('; ')}` : ''}`);
    want(a.sceneRatio >= 0.38, `[${size}] ${where}: escena ${Math.round(a.sceneRatio * 100)} % del alto (≥ 38 %)`);
  }
  if (mobile) {
    const restT = smallTouch.filter((r) => !(strictPortrait && r.panel)).map((r) => `${r.what} ${Math.round(r.w)}x${Math.round(r.h)}`);
    const restF = smallFont.filter((t) => !(strictPortrait && (t.panel || t.speech))).map((t) => `${t.what} ${t.px}px`);
    const htmlT = a.html.filter((r) => Math.min(r.w, r.h) < MIN_TOUCH - 0.5).map((r) => `${r.what} ${Math.round(r.w)}x${Math.round(r.h)}`);
    if (restT.length || htmlT.length) warnings.push(`[${size}] ${where}: zonas < ${MIN_TOUCH} px: ${[...new Set([...restT, ...htmlT])].join('; ')}`);
    if (restF.length) warnings.push(`[${size}] ${where}: letra < ${MIN_FONT} px: ${[...new Set(restF)].join('; ')}`);
  }
  report.audits.push({ size, where, W: a.W, H: a.H, sceneRatio: a.sceneRatio, panelH: a.panelH, dex: a.dex, minTouch: Math.min(...a.interactive.map((r) => Math.min(r.w, r.h)), 999), minFont: Math.min(...a.texts.filter((t) => t.onScreen).map((t) => t.px), 999) });
}

async function waitIdle(page, ms = 8000) {
  await page.waitForFunction(() => { const s = window.__qa.state(); return !s.path && !s.walkTarget; }, { timeout: ms, polling: 100 }).catch(() => {});
}

async function newPage(browser, size) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (err) => fail(`[${size}] error de página: ${err.message.split('\n')[0]}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !IGNORE.some((re) => re.test(text))) fail(`[${size}] console.error: ${text.slice(0, 200)}`);
  });
  page.on('request', (req) => { if (/funtico\.(com|io|gg)/i.test(req.url())) fail(`petición a Funtico: ${req.url()}`); });
  await page.setViewport(vp(size));
  await page.goto(`${BASE}/campaign.html?qa=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__qa && !!window.__funtico?.metrics, { timeout: 120_000, polling: 250 });
  const r = await page.evaluate(() => (window.__game.renderer.type === 2 ? 'WEBGL' : 'CANVAS'));
  want(r === 'CANVAS', `[${size}] renderer ${r}`);
  return { page, ctx };
}

async function shot(page, size, name) {
  const f = path.join(OUT, `${size}-${name}.png`);
  await page.screenshot({ path: f });
  report.shots.push(f);
}

/** Gira (cambia el viewport) y comprueba que no se pierde nada. Mide el fotograma más largo durante el giro. */
async function rotate(page, to, why) {
  const a = await snap(page);
  await page.evaluate(() => {
    window.__rot = { max: 0, last: performance.now(), on: true };
    const f = (t) => { const r = window.__rot; if (!r.on) return; r.max = Math.max(r.max, t - r.last); r.last = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const t0 = Date.now();
  await page.setViewport(vp(to));
  await sleep(1200);
  const maxFrame = await page.evaluate(() => { window.__rot.on = false; return Math.round(window.__rot.max); });
  const b = await snap(page);
  const wall = Date.now() - t0;
  const dPlayer = a.player && b.player ? Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y) : 0;
  const rec = { why, to, maxFrame, scene: [a.scene, b.scene], dPlayer: Math.round(dPlayer * 10) / 10, clock: [a.playTimeMs, b.playTimeMs], speechKept: a.speech === b.speech, size: [b.w, b.h] };
  report.rotations.push(rec);
  want(b.w === parse(to).width && b.h === parse(to).height, `giro a ${to} (${why}): juego a ${b.w}x${b.h}`);
  want(a.scene === b.scene && a.flags === b.flags && a.inventory === b.inventory, `giro a ${to} (${why}): misma escena, flags e inventario`);
  want(dPlayer <= 2, `giro a ${to} (${why}): Dex en su sitio (se movió ${rec.dPlayer} %)`);
  want(a.speech === b.speech && a.choices === b.choices, `giro a ${to} (${why}): texto/opciones abiertos se mantienen (${a.speech ? 'había texto' : 'sin texto'})`);
  if (b.speechBox) {
    const sb = b.speechBox;
    const left = sb.x - sb.w / 2;
    want(left >= -2 && left + sb.w <= b.w + 2 && sb.y >= -2 && sb.y + sb.h <= b.h + 2, `giro a ${to} (${why}): el texto abierto se recoloca dentro de la pantalla (${Math.round(left)},${Math.round(sb.y)} ${Math.round(sb.w)}x${Math.round(sb.h)})`);
  }
  want(b.playTimeMs >= a.playTimeMs && b.playTimeMs - a.playTimeMs <= wall + 500, `giro a ${to} (${why}): el reloj sigue (+${b.playTimeMs - a.playTimeMs} ms en ${wall} ms)`);
  want(maxFrame <= 250, `giro a ${to} (${why}): fotograma más largo ${maxFrame} ms (≤ 250)`);
  return b;
}

/** Toque real (touchscreen) en coordenadas de pantalla. */
const tapAt = async (page, x, y) => { await page.touchscreen.tap(Math.round(x), Math.round(y)); };

/** Centro en pantalla de un hotspot (bounds en % → mundo con CoordSystem → pantalla con el scroll de la cámara). */
const hotspotScreen = (page, id) => page.evaluate((id) => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const cs = g.registry.get('coordSystem');
  const h = g.registry.get('sceneData').regions.hotspots.find((x) => x.id === id);
  const p = cs.pctToScreen(h.bounds.x + h.bounds.w / 2, h.bounds.y + h.bounds.h / 2);
  const cam = gs.cameras.main;
  return { x: (p.x - cam.scrollX) * cam.zoom, y: (p.y - cam.scrollY) * cam.zoom, W: g.scale.width, viewH: g.scale.height - (g.registry.get('scummPanelHeight') ?? 0) };
}, id);

/** Centro en pantalla de un verbo del panel (para tocarlo de verdad). */
const verbScreen = (page, verb) => page.evaluate((verb) => {
  const ui = window.__game.scene.getScene('UIScene');
  const t = ui.scummUI.verbTexts.get(verb);
  const b = t.getBounds();
  return { x: b.centerX, y: b.centerY };
}, verb);

async function realTaps(page, size) {
  // hs_fence no: su borde está pegado a tr_mountain (x 0-3 %), que cambia de escena
  const targets = ['hs_mailbox', 'hs_trees', 'hs_bushes'];
  for (const id of targets) {
    let s = await hotspotScreen(page, id);
    const startedOff = s.x < 0 || s.x > s.W;
    // Si está fuera de cuadro, Dex anda hacia ese borde (toque real en la acera del borde) y la cámara le sigue
    for (let i = 0; i < 16 && (s.x < 30 || s.x > s.W - 30); i++) {
      const g0 = await page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); const c = gs.cameras.main; return { y: (gs.player.y - c.scrollY) * c.zoom, scrollX: c.scrollX }; });
      // A la izquierda, sin acercarse a tr_mountain (x 0-3 % del fondo) cuando la cámara ya está en el borde
      await tapAt(page, s.x < 0 ? (g0.scrollX > 80 ? 24 : 70) : s.W - 24, Math.min(s.viewH - 6, g0.y - 4));
      await sleep(400);
      await waitIdle(page, 10_000);
      await sleep(900); // la cámara llega con lerp
      s = await hotspotScreen(page, id);
    }
    const inView = s.x >= 0 && s.x <= s.W && s.y >= 0 && s.y <= s.viewH;
    want(inView, `[${size}] toque real: «${id}» ${startedOff ? 'empezaba fuera de cuadro y ' : ''}queda a la vista (x ${Math.round(s.x)})`);
    if (!inView) continue;
    const before = (await page.evaluate(() => window.__qa.state())).actions;
    const v = await verbScreen(page, 'LOOK');
    await tapAt(page, v.x, v.y);
    await sleep(150);
    const verb = await page.evaluate(() => window.__qa.state().verb);
    want(verb === 'LOOK', `[${size}] toque real en el verbo Look at (${Math.round(v.x)},${Math.round(v.y)}): verbo ${verb}`);
    await tapAt(page, s.x, s.y);
    await page.waitForFunction((b) => window.__qa.state().actions > b, { timeout: 15_000, polling: 100 }, before).catch(() => {});
    const after = (await page.evaluate(() => window.__qa.state())).actions;
    report.realTaps.push({ size, id, startedOff, at: { x: Math.round(s.x), y: Math.round(s.y) }, actions: [before, after] });
    want(after > before, `[${size}] toque real LOOK sobre «${id}» en (${Math.round(s.x)},${Math.round(s.y)}): la acción se ejecuta`);
    await page.evaluate(() => window.__qa.dismissAll());
  }
}

/** fps medianos por rAF durante `ms`. */
const rafMedian = (page, ms) => page.evaluate((dur) => new Promise((res) => {
  const t = [];
  let last = performance.now();
  const end = last + dur;
  const f = (now) => {
    t.push(now - last);
    last = now;
    if (now < end) requestAnimationFrame(f);
    else { t.sort((a, b) => a - b); res({ median: Math.round(10000 / t[Math.floor(t.length / 2)]) / 10, frames: t.length, max: Math.round(t[t.length - 1]) }); }
  };
  requestAnimationFrame(f);
}), ms);

async function playChapter(page, size, { rotations }) {
  const steps = [];
  let cur = size;
  const other = (s) => (s === '390x844' ? '844x390' : '390x844');
  for (const [i, step] of route.steps.entries()) {
    const label = `${i + 1}/${route.steps.length} ${step.do} ${step.verb ?? ''} ${step.target ?? step.item ?? step.npc ?? ''}`.trim();
    let st;
    try {
      if (rotations && step.holdTextMs) {
        // Giro con un texto abierto: el paso corre en la página mientras se gira dos veces
        await page.evaluate((s) => { window.__step = window.__qa.act(s.verb, s.target, s.choices ?? [], s.holdTextMs ?? 0); window.__step.catch(() => {}); }, step);
        await page.waitForFunction(() => !!window.__qa.state().speech, { timeout: 30_000, polling: 100 }).catch(() => {});
        await sleep(800);
        await shot(page, cur, 'dialogo');
        judge(cur, 'texto abierto', await audit(page), { strictPortrait: cur === '390x844' });
        cur = other(cur); await rotate(page, cur, 'con texto abierto');
        await shot(page, cur, 'dialogo');
        judge(cur, 'texto abierto (girado)', await audit(page), { strictPortrait: cur === '390x844' });
        cur = other(cur); await rotate(page, cur, 'con texto abierto, vuelta');
        st = await page.evaluate(() => window.__step);
      } else {
        st = await callQa(page, step);
      }
    } catch (err) {
      fail(`[${size}] paso ${label}: ${String(err.message ?? err).split('\n')[0]}`);
      break;
    }
    const e = step.expect ?? null;
    if (e) {
      const hard = check({ scene: e.scene, has: e.has, lacks: e.lacks, flags: e.flags, unsetFlags: e.unsetFlags }, st);
      for (const x of hard) fail(`[${size}] paso ${label}: ${x}`);
    }
    steps.push({ step: label, scene: st?.scene });
    // Capturas y auditoría en momentos fijos
    if (step.do === 'journal' && step.action === 'open' && !steps.journalShot) {
      steps.journalShot = true;
      await sleep(500);
      await shot(page, cur, 'movil');
      judge(cur, 'móvil abierto', await audit(page), { strictPortrait: false });
    }
    if (i === 3) {
      await waitIdle(page);
      await shot(page, cur, 'escena');
      const a = await audit(page);
      judge(cur, 'escena', a, { strictPortrait: cur === '390x844' });
      if (a.dex && !a.dex.moving) want(a.dex.inView, `[${cur}] Dex quieto dentro del cuadro (${a.dex.sx},${a.dex.sy})`);
    }
    if (step.do === 'combine') {
      await shot(page, cur, 'inventario');
      judge(cur, 'inventario', await audit(page), { strictPortrait: cur === '390x844' });
    }
    if (rotations && i === 9) { cur = other(cur); await rotate(page, cur, `paso ${i + 1}`); }
    if (rotations && i === 15) { cur = other(cur); await rotate(page, cur, `paso ${i + 1}`); }
    if (!(i % 6)) {
      await waitIdle(page, 4000);
      const a = await audit(page);
      if (a.dex && !a.dex.moving && !(await page.evaluate(() => window.__qa.state().cinematic?.active))) {
        want(a.dex.inView, `[${cur}] paso ${i + 1}: Dex quieto dentro del cuadro (${a.dex.sx},${a.dex.sy})`);
      }
    }
    if (problems.length > 25) break;
  }
  const fin = await page.evaluate(() => window.__qa.state());
  want(!!fin.flags.chapter_1_complete, `[${size}] capítulo 1 completo (chapter_1_complete) con ${route.steps.length} pasos`);
  return steps;
}

const browser = await launchBrowser({
  engine: 'chromium',
  puppeteerOpts: {
    headless: true,
    protocolTimeout: 900_000,
    args: ['--no-sandbox', '--disable-3d-apis', '--disable-webgl', '--autoplay-policy=no-user-gesture-required'],
  },
});
let exitCode = 1;
try {
  if (ONLY.has('portrait')) {
    console.log('— Vertical 390x844 con giros —');
    const { page, ctx } = await newPage(browser, '390x844');
    await callQa(page, route.steps[0]); // newGame
    await waitIdle(page);
    // fps con CPU x4 (canvas)
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(500);
    const raf = await rafMedian(page, 4500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    report.fps = { renderer: 'canvas', size: '390x844', cpuThrottle: 4, ...raf, gate: 50 };
    want(raf.median >= 50, `fps medianos con CPU x4 en 390x844 (canvas): ${raf.median} (${raf.frames} fotogramas en 4,5 s, máx ${raf.max} ms)`);
    await realTaps(page, '390x844');
    // Móvil/diario también en vertical (en la ruta el paso del diario cae en horizontal tras el giro)
    try {
      await page.evaluate(() => window.__qa.openJournal('goals'));
      await sleep(500);
      await shot(page, '390x844', 'movil');
      judge('390x844', 'móvil abierto', await audit(page), { strictPortrait: false });
      await page.evaluate(() => window.__qa.closeJournal());
    } catch (err) {
      warnings.push(`[390x844] no se pudo abrir el móvil para la captura: ${String(err.message ?? err).split('\n')[0]}`);
    }
    // Partida nueva desde una página recién cargada (como la pasada en horizontal)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => !!window.__qa && !!window.__funtico?.metrics, { timeout: 120_000, polling: 250 });
    // La ruta entera (su newGame empieza partida nueva tras los toques reales)
    report.passes.portrait = await playChapter(page, '390x844', { rotations: true });
    await ctx.close();
  }
  if (ONLY.has('landscape')) {
    console.log('— Horizontal 844x390 —');
    const { page, ctx } = await newPage(browser, '844x390');
    report.passes.landscape = await playChapter(page, '844x390', { rotations: false });
    await ctx.close();
  }
  if (ONLY.has('desktop')) {
    for (const size of ['1280x720', '1920x1080']) {
      console.log(`— Escritorio ${size} (capturas) —`);
      const { page, ctx } = await newPage(browser, size);
      for (const step of route.steps.slice(0, 16)) {
        try { await callQa(page, step); } catch (err) { fail(`[${size}] ${step.do}: ${String(err.message ?? err).split('\n')[0]}`); break; }
        if (step.do === 'journal' && step.action === 'open') { await sleep(400); await shot(page, size, 'movil'); }
      }
      await page.evaluate(() => window.__qa.closeJournal());
      await shot(page, size, 'inventario');
      judge(size, 'escena', await audit(page), { strictPortrait: false });
      await page.evaluate(() => { window.__step = window.__qa.act('LOOK', 'hs_porch_light', [], 4000); window.__step.catch(() => {}); });
      await page.waitForFunction(() => !!window.__qa.state().speech, { timeout: 20_000, polling: 100 }).catch(() => {});
      await sleep(600);
      await shot(page, size, 'dialogo');
      await page.evaluate(() => window.__step);
      await ctx.close();
    }
  }
  report.ok = problems.length === 0;
  exitCode = report.ok ? 0 : 1;
} catch (err) {
  fail(`fallo del runner: ${err.message ?? err}`);
} finally {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
for (const w of [...new Set(warnings)]) console.log(`aviso: ${w}`);
console.log(`Capturas en ${OUT}/ (${report.shots.length}); informe en ${OUT}/report.json`);
console.log(exitCode === 0 ? 'OK' : `FALLO (${problems.length})`);
process.exit(exitCode);

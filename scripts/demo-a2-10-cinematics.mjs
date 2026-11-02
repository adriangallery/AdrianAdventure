// Demo de A2.10 (regla visual del plan SCUMM): sistema de cinemáticas.
// En el lobby (?qa=1, 844x390 táctil) lanza por `__qa.runScript` una cinemática de ejemplo:
//   franjas (letterbox) y la interfaz fuera → pan a la recepcionista → zoom ×2 → subtítulo del narrador en la franja
//   inferior → la cámara vuelve al jugador y lo sigue → el jugador anda (pathfinding A2.1) → se gira a la izquierda →
//   dice una frase (texto sobre su cabeza, con el zoom) → sacudida → iris que se cierra sobre él → fin.
// Comprueba por `state().cinematic` que durante la cinemática hay franjas, interfaz oculta y cámara movida (zoom y
// scroll), que el narrador habla en la franja (`speech.mode = band`) y el jugador sobre su cabeza, que se ve la iris,
// y que al terminar todo vuelve (sin franjas, interfaz visible, zoom 1, cámara de siempre, sin transición).
// Después repite la MISMA cinemática saltándola con Esc (`skipAfterMs`) desde otra posición y exige el mismo estado
// final (flag, posición y orientación del jugador) con `skipped: true` y nada a medias.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-10-cinematics
import { startDemo } from './lib/demo.mjs';

const SCENE = 'lobby';
const OPS = [
  { op: 'cinematicStart' },
  { op: 'cameraPan', actor: 'npc_receptionist', ms: 900 },
  { op: 'cameraZoom', zoom: 2, ms: 700 },
  { op: 'say', speaker: 'Narrator', text: 'Only the receptionist remains at her post.' },
  { op: 'cameraFollow', ms: 600 },
  { op: 'actorMove', actor: 'player', x: 52, y: 92 },
  { op: 'actorFace', actor: 'player', dir: 'left' },
  { op: 'say', text: 'A tall plant in a ceramic pot. It looks thirsty. Really thirsty.' },
  { op: 'setFlag', flag: 'qa_cinematic_done', value: true },
  { op: 'cameraShake', intensity: 0.01, ms: 350 },
  { op: 'iris', mode: 'out', actor: 'player', ms: 700 },
  { op: 'cinematicEnd' },
];
const RESET = [
  { op: 'actorTeleport', actor: 'player', x: 80, y: 95 },
  { op: 'actorFace', actor: 'player', dir: 'right' },
  { op: 'setFlag', flag: 'qa_cinematic_done', value: false },
];

const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const fmt = (p) => (p ? `${p.x.toFixed(2)},${p.y.toFixed(2)}` : '?');

await demo.openScene(SCENE);
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle())) await demo.fail('La escena no quedó libre');
for (let i = 0; i < 4; i++) await demo.shot();

/**
 * Lanza runScript sin esperarlo y graba mientras dura, apuntando lo que se vio. Devuelve lo visto y el estado final
 * (o el error de la API).
 */
async function filmScript(ops, opts, label) {
  await page.evaluate((o, op) => {
    window.__demoRun = window.__qa.runScript(o, op).then(() => null, (e) => String(e?.message || e));
  }, ops, opts);
  const seen = { letterbox: false, chromeHidden: false, zoomMax: 1, scrollMoved: false, band: false, head: false, iris: false, ducked: false, frames: 0 };
  const t0 = Date.now();
  let start = null;
  let stillDone = false;
  while (Date.now() - t0 < 90000) {
    const r = await page.evaluate(async () => {
      const st = window.__qa.state();
      const settled = await Promise.race([window.__demoRun, new Promise((res) => setTimeout(() => res('pending'), 0))]);
      return { st, settled };
    });
    await demo.shot();
    seen.frames++;
    const c = r.st.cinematic;
    if (c) {
      if (!start) start = c.camera;
      if (c.active && c.letterbox) seen.letterbox = true;
      if (c.active && c.chromeHidden) seen.chromeHidden = true;
      if (c.active && c.ducked) seen.ducked = true;
      seen.zoomMax = Math.max(seen.zoomMax, c.camera.zoom);
      if (c.active && (Math.abs(c.camera.x - start.x) > 5 || Math.abs(c.camera.y - start.y) > 5)) seen.scrollMoved = true;
      if (c.transition === 'iris') seen.iris = true;
    }
    const sp = r.st.speech;
    if (sp?.mode === 'band') {
      seen.band = true;
      if (!stillDone && label === 'entera' && c?.camera.zoom > 1.5) { await demo.still('band'); stillDone = true; }
    }
    if (sp?.mode === 'head' && c?.active) seen.head = true;
    if (r.settled !== 'pending') {
      const st = await page.evaluate(() => window.__qa.state());
      return { seen, error: r.settled, st };
    }
  }
  return { seen, error: 'tiempo agotado (90 s)', st: await page.evaluate(() => window.__qa.state()) };
}

function checkRestored(st, label) {
  const c = st.cinematic;
  if (!c) { problems.push(`${label}: sin state().cinematic`); return; }
  if (c.active) problems.push(`${label}: la cinemática sigue activa al terminar`);
  if (c.letterbox) problems.push(`${label}: quedan las franjas`);
  if (c.chromeHidden) problems.push(`${label}: la interfaz sigue oculta`);
  if (Math.abs(c.camera.zoom - 1) > 0.01) problems.push(`${label}: zoom ${c.camera.zoom} al terminar (se esperaba 1)`);
  if (!c.camera.following) problems.push(`${label}: la cámara no volvió a la de siempre`);
  if (c.transition !== 'none') problems.push(`${label}: queda una transición en pantalla (${c.transition})`);
  if (c.ducked) problems.push(`${label}: la música sigue bajada`);
}

// 1) Entera
const full = await filmScript(OPS, {}, 'entera');
console.log(`entera: ${JSON.stringify(full.seen)} · final ${JSON.stringify(full.st.cinematic)} · jugador ${fmt(full.st.player)} mira ${full.st.facing}`);
if (full.error) problems.push(`entera: runScript falló: ${full.error}`);
if (!full.seen.letterbox) problems.push('entera: no se vieron las franjas con la cinemática activa');
if (!full.seen.chromeHidden) problems.push('entera: la interfaz no se ocultó');
if (full.seen.zoomMax < 1.9) problems.push(`entera: el zoom no llegó a 2 (máximo ${full.seen.zoomMax})`);
if (!full.seen.scrollMoved) problems.push('entera: la cámara no se movió (scroll igual que al empezar)');
if (!full.seen.band) problems.push('entera: el narrador no habló en la franja inferior (speech.mode band)');
if (!full.seen.head) problems.push('entera: el jugador no habló sobre su cabeza durante la cinemática');
if (!full.seen.iris) problems.push('entera: no se vio la iris');
if (!full.seen.ducked) problems.push('entera: la música no se bajó durante la cinemática');
checkRestored(full.st, 'entera');
if (full.st.cinematic?.skipped) problems.push('entera: sale como saltada');
if (!full.st.flags.qa_cinematic_done) problems.push('entera: no se aplicó el setFlag de la cinemática');
if (full.st.facing !== 'left') problems.push(`entera: el jugador mira «${full.st.facing}», se esperaba «left»`);
for (let i = 0; i < 6; i++) await demo.shot();
await demo.still('full');

// 2) Vuelta atrás (fuera de cinemática: actorTeleport/actorFace también valen en scripts normales)
const reset = await page.evaluate(async (o) => window.__qa.runScript(o).then((st) => ({ st }), (e) => ({ error: String(e?.message || e) })), RESET);
if (reset.error) problems.push(`reset: ${reset.error}`);
else if (reset.st.flags.qa_cinematic_done !== false || reset.st.facing !== 'right' || Math.hypot(reset.st.player.x - 80, reset.st.player.y - 95) > 1) {
  problems.push(`reset: no quedó como se pidió (jugador ${fmt(reset.st.player)} mira ${reset.st.facing}, flag ${reset.st.flags.qa_cinematic_done})`);
}
for (let i = 0; i < 4; i++) await demo.shot();

// 3) La misma, saltada con Esc a mitad del zoom
const skip = await filmScript(OPS, { skipAfterMs: 1500 }, 'saltada');
console.log(`saltada: ${JSON.stringify(skip.seen)} · final ${JSON.stringify(skip.st.cinematic)} · jugador ${fmt(skip.st.player)} mira ${skip.st.facing}`);
if (skip.error) problems.push(`saltada: runScript falló: ${skip.error}`);
if (!skip.seen.letterbox) problems.push('saltada: no llegó a verse la cinemática antes del salto');
checkRestored(skip.st, 'saltada');
if (!skip.st.cinematic?.skipped) problems.push('saltada: state().cinematic.skipped no es true');
if (skip.seen.frames > 60) problems.push(`saltada: tardó demasiado (${skip.seen.frames} fotogramas): el salto no fue de golpe`);
// Mismo estado final que la entera
if (skip.st.flags.qa_cinematic_done !== full.st.flags.qa_cinematic_done) problems.push('saltada: la flag de la cinemática no quedó igual que en la entera');
if (skip.st.facing !== full.st.facing) problems.push(`saltada: mira «${skip.st.facing}», en la entera «${full.st.facing}»`);
if (!skip.st.player || !full.st.player || Math.hypot(skip.st.player.x - full.st.player.x, skip.st.player.y - full.st.player.y) > 1) {
  problems.push(`saltada: el jugador acabó en ${fmt(skip.st.player)}, en la entera en ${fmt(full.st.player)}`);
}
for (let i = 0; i < 6; i++) await demo.shot();
await demo.still('skipped');
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

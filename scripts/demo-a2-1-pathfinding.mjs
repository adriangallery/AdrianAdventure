// Demo de A2.1 (regla visual del plan SCUMM): pathfinding A* con obstáculos declarativos.
// En el lobby, el pie de la escalera (poste y primer peldaño) es ahora un `blockedAreas` de scene.json. El personaje
// se pone a su izquierda, se hace clic a su derecha a la misma altura y tiene que rodearlo por delante en vez de ir en
// línea recta (antes lo atravesaba). El GIF pinta el obstáculo (rojo), el rastro real del personaje frame a frame
// (verde) y la ruta calculada (amarillo, con los puntos de paso).
// Comprueba por la API de QA (`state().path`, `isWalkable`) que:
//   - la línea recta del origen al destino sí cruza el obstáculo (si no, la demo no probaría nada);
//   - la ruta tiene al menos un punto de paso intermedio y ningún tramo pisa zona no caminable;
//   - ningún frame deja al personaje dentro del obstáculo o fuera de la zona caminable;
//   - llega al destino pedido.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-1-pathfinding
import { startDemo } from './lib/demo.mjs';

const SCENE = 'lobby';
const FROM = { x: 52, y: 84.5 };
const TO = { x: 70, y: 84.5 };

const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
const pageErrors = [];
// Solo excepciones sin capturar: los console.error de red (web3, Alchemy sin clave) no son de esta demo
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));

await demo.openScene(SCENE);
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle())) await demo.fail('La escena no quedó libre');

const blocked = await page.evaluate(() => window.__game.registry.get('sceneData').blockedAreas ?? []);
if (!blocked.length) await demo.fail('El lobby no tiene blockedAreas');

// 1) Al lado izquierdo del obstáculo, andando como el jugador (clic con WALK)
const walk1 = await page.evaluate(async (p) => {
  try { await window.__qa.walk(p.x, p.y); return null; } catch (e) { return String(e?.message || e); }
}, FROM);
if (walk1) await demo.fail(`No pudo ir al origen: ${walk1}`);

// Capa de dibujo encima del fondo y del primer plano + grabación del rastro frame a frame
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const g = gs.add.graphics().setDepth(60);
  window.__demoGfx = g;
  window.__trail = [];
  const rec = () => window.__trail.push({ x: gs.player.pctX, y: gs.player.pctY });
  gs.events.on('postupdate', rec);
  window.__demoStop = () => gs.events.off('postupdate', rec);
  window.__demoDraw = (path) => {
    const cs = gs.coordSystem;
    const P = (p) => cs.pctToScreen(p.x, p.y);
    g.clear();
    for (const b of gs.registry.get('sceneData').blockedAreas ?? []) {
      const tl = P({ x: b.x, y: b.y });
      const br = P({ x: b.x + b.w, y: b.y + b.h });
      g.fillStyle(0xff3030, 0.35).fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      g.lineStyle(2, 0xff3030, 0.9).strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }
    const trail = window.__trail;
    if (trail.length > 1) {
      g.lineStyle(3, 0x30ff60, 0.9).beginPath();
      trail.forEach((p, i) => { const s = P(p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      g.strokePath();
    }
    if (path && path.length > 1) {
      g.lineStyle(2, 0xffe040, 0.9).beginPath();
      path.forEach((p, i) => { const s = P(p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      g.strokePath();
      g.fillStyle(0xffe040, 1);
      for (const p of path) { const s = P(p); g.fillCircle(s.x, s.y, 4); }
    }
  };
  window.__demoDraw(null);
});
for (let i = 0; i < 6; i++) await demo.shot();

// 2) Clic al otro lado del obstáculo (sin esperar: se graba mientras anda)
await page.evaluate((p) => {
  window.__demoWalk = window.__qa.walk(p.x, p.y).then(() => null, (e) => String(e?.message || e));
}, TO);
const t0 = Date.now();
let walkErr = null;
let done = false;
while (!done && Date.now() - t0 < 20000) {
  await page.evaluate(() => window.__demoDraw(window.__qa.state().path));
  await demo.shot();
  const st = await page.evaluate(async () => {
    const s = window.__qa.state();
    const settled = await Promise.race([window.__demoWalk, new Promise((r) => setTimeout(() => r('pending'), 0))]);
    return { walking: s.busy.includes('walking'), settled };
  });
  if (st.settled !== 'pending') { done = true; walkErr = st.settled; }
}
await page.evaluate(() => { window.__demoStop(); window.__demoDraw(window.__qa.state().path); });
for (let i = 0; i < 12; i++) await demo.shot();
await demo.still('full');

// 3) Comprobaciones
const res = await page.evaluate((blockedRects) => {
  const qa = window.__qa;
  const st = qa.state();
  const path = st.path ?? [];
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const sample = (a, b, step = 0.05) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  };
  const badPath = [];
  for (let i = 1; i < path.length; i++) {
    for (const p of sample(path[i - 1], path[i])) if (!qa.isWalkable(p.x, p.y)) { badPath.push(p); break; }
  }
  const straight = path.length ? sample(path[0], path[path.length - 1]) : [];
  const trail = window.__trail;
  const badTrail = trail.filter((p) => !qa.isWalkable(p.x, p.y) || blockedRects.some((b) => inside(p, b)));
  return {
    path,
    player: st.player,
    straightCrosses: straight.some((p) => blockedRects.some((b) => inside(p, b))),
    badPath,
    trailFrames: trail.length,
    badTrail: badTrail.slice(0, 5),
    maxY: Math.max(...trail.map((p) => p.y)),
  };
}, blocked);
await demo.end();

console.log(`obstáculo ${JSON.stringify(blocked)}`);
console.log(`ruta ${JSON.stringify(res.path.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) })))}`);
console.log(`rastro ${res.trailFrames} frames · y máxima ${res.maxY.toFixed(2)} · final ${JSON.stringify(res.player)} · ${demo.frames} fotogramas`);

const problems = [];
if (walkErr) problems.push(`el walk falló: ${walkErr}`);
if (!done) problems.push('no terminó de andar en 20 s');
if (res.path.length < 3) problems.push(`la ruta no tiene puntos de paso intermedios: ${JSON.stringify(res.path)}`);
if (!res.straightCrosses) problems.push('la línea recta del origen al destino no cruza el obstáculo: la demo no prueba el rodeo');
if (res.badPath.length) problems.push(`la ruta pisa zona no caminable en ${JSON.stringify(res.badPath)}`);
if (res.trailFrames < 5) problems.push(`rastro demasiado corto (${res.trailFrames} frames)`);
if (res.badTrail.length) problems.push(`el personaje pisó zona no caminable u obstáculo: ${JSON.stringify(res.badTrail)}`);
if (!res.player || Math.hypot(res.player.x - TO.x, res.player.y - TO.y) > 0.5) problems.push(`no llegó al destino ${JSON.stringify(TO)}: ${JSON.stringify(res.player)}`);
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

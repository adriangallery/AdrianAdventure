// Demo de A2.12 (plan SCUMM): «walk limpio» en las 13 escenas.
// En 844x390 (móvil apaisado), con ?qa=1, para cada escena: deja la escena libre, apaga los triggers (para que un
// borde no saque a Dex de la escena; onStep = null) y le hace andar por una ruta que recorre las esquinas de cada
// walkableArea (metidas 0,6 %) y va al punto de llegada de los hotspots principales y de cada NPC (el mismo que usa
// el juego: Facing.approachHotspot/approachTalk vía GameScene.planHotspot/approachTalk con la Reach del jugador).
// Graba cada frame (postupdate): posición, si anda, textura, profundidad de Dex y de cada NPC, factor de profundidad.
// Comprueba (falla con exit 1):
//   - Dex nunca fuera de lo andable ni dentro de un obstáculo (isWalkablePct, que incluye blockedAreas y la huella
//     de las NPC) en ningún frame;
//   - llega a cada destino antes de TIMEOUT_MS (no se atasca);
//   - no patina: avance medio en píxeles de arte por segundo de cada tramo dentro de ±25 % de lo que pide WalkMotion
//     (74 × speed/140), sin frames desplazándose sin animación de andar ni andando parado (> 250 ms sin avanzar);
//   - orden de profundidad con las NPC según la y de los pies (pies más abajo = delante) en todos los frames.
// Capturas: `<escena>-ruta.png` (zona andable en verde, obstáculos en rojo, rastro en amarillo) y `<escena>-<n>.png` al
// llegar a cada objeto/NPC. Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-12-walk
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const VP = { width: 844, height: 390, isMobile: true, hasTouch: true };
const WALK_ART_PX_PER_S = 74; // = src/systems/WalkMotion.ts (lo comprueba tests/walk-clean.test.mjs)
const TIMEOUT_MS = 20000;
const INSET = 0.6;
const MAX_HOTSPOTS = 4;

const ROOT = new URL('../assets/scenes/', import.meta.url);
const SCENES = readdirSync(ROOT).filter((d) => {
  try { readFileSync(new URL(`${d}/scene.json`, ROOT)); return true; } catch { return false; }
});

const demo = await startDemo(import.meta.url, { fps: 3, width: 640, viewport: VP });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

const speedMul = (s) => Math.min(1.6, Math.max(0.5, (typeof s === 'number' && s > 0 ? s : 140) / 140));

/** Ruta de la escena: esquinas de cada walkableArea y destinos de hotspots (los más grandes cerca del suelo) y NPC */
function route(d) {
  const pts = [];
  for (const a of d.walkableAreas ?? []) {
    const x0 = a.x + Math.min(INSET, a.w / 2);
    const x1 = a.x + a.w - Math.min(INSET, a.w / 2);
    const y0 = a.y + Math.min(INSET, a.h / 2);
    const y1 = a.y + a.h - Math.min(INSET, a.h / 2);
    pts.push({ kind: 'edge', x: x0, y: y1 }, { kind: 'edge', x: x0, y: y0 }, { kind: 'edge', x: x1, y: y0 }, { kind: 'edge', x: x1, y: y1 });
  }
  const hs = (d.regions?.hotspots ?? []).filter((h) => h.bounds).sort((a, b) => (b.bounds.y + b.bounds.h) - (a.bounds.y + a.bounds.h));
  for (const h of hs.slice(0, MAX_HOTSPOTS)) pts.push({ kind: 'hotspot', id: h.id });
  for (const n of d.npcs ?? []) pts.push({ kind: 'npc', id: n.id });
  return pts;
}

async function installRecorder() {
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    // Sin triggers (ni tras cada tramo ni en update): la demo solo anda y no debe salir de la escena
    gs.player.onStep = null;
    gs.checkWalkTriggers = () => false;
    window.__samples = [];
    window.__trail = [];
    // Tiempo de juego (el `delta` con el que anda el jugador), no el reloj de pared: el runner de CI va a saltos
    let clock = 0;
    const rec = (_time, delta) => {
      clock += delta;
      const p = gs.player;
      const st = p.getAnimState();
      window.__samples.push({
        t: clock, x: p.pctX, y: p.pctY, moving: p.isMoving(), tex: st.texture, depth: p.depth,
        scale: p.getScaleInfo().depth, ps: p.getPixelScale(), ok: p.isWalkablePct(p.pctX, p.pctY),
        npcs: gs.npcs.filter((n) => n.visible && n.pctPosition).map((n) => ({ id: n.npcId, y: n.pctPosition.y, depth: n.depth })),
      });
      window.__trail.push({ x: p.pctX, y: p.pctY });
    };
    gs.events.on('postupdate', rec);
    const g = gs.add.graphics().setDepth(60);
    window.__draw = () => {
      const cs = gs.coordSystem;
      const P = (q) => cs.pctToScreen(q.x, q.y);
      const d = gs.registry.get('sceneData');
      g.clear();
      for (const a of d.walkableAreas ?? []) {
        const tl = P(a); const br = P({ x: a.x + a.w, y: a.y + a.h });
        g.lineStyle(2, 0x30ff60, 0.9).strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      }
      for (const b of d.blockedAreas ?? []) {
        const tl = P(b); const br = P({ x: b.x + b.w, y: b.y + b.h });
        g.fillStyle(0xff3030, 0.35).fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      }
      const tr = window.__trail;
      if (tr.length > 1) {
        g.lineStyle(2, 0xffe040, 0.9).beginPath();
        tr.forEach((q, i) => { const s = P(q); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
        g.strokePath();
      }
    };
    window.__clear = () => g.clear();
  });
}

/** Destino del juego para un punto de la ruta (punto de llegada de Facing con la Reach del jugador) */
const targetOf = (pt, d) => page.evaluate((pt, h) => {
  const gs = window.__game.scene.getScene('GameScene');
  if (pt.kind === 'edge') return { x: pt.x, y: pt.y };
  if (pt.kind === 'hotspot') {
    if (!h) return null;
    const plan = gs.planHotspot(h, 'USE');
    // null = ya está allí: se queda donde está
    return plan.walkTo ?? { x: gs.player.pctX, y: gs.player.pctY };
  }
  const npc = gs.npcs.find((n) => n.npcId === pt.id);
  if (!npc || !npc.visible) return null;
  return gs.qaPlanTalk(pt.id) ?? { x: gs.player.pctX, y: gs.player.pctY };
}, pt, pt.kind === 'hotspot' ? (d.regions?.hotspots ?? []).find((q) => q.id === pt.id) ?? null : null);

/** Anda a `to` y espera a que llegue (o TIMEOUT_MS). Devuelve ms tardados o null si se atascó. */
async function walk(to) {
  await page.evaluate((to) => { window.__game.scene.getScene('GameScene').player.walkToPct(to.x, to.y); }, to);
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT_MS) {
    await demo.sleep(150);
    if (!(await page.evaluate(() => window.__game.scene.getScene('GameScene').player.isMoving()))) return Date.now() - t0;
    if ((Date.now() - t0) % 900 < 160) { await page.evaluate(() => window.__draw()); await demo.shot(); }
  }
  return null;
}

/** Revisa los frames grabados desde `from` (índice): zona, patinaje y orden con NPC */
function analyse(scene, samples, mul, label) {
  const errs = [];
  let movT = 0;
  let movArt = 0;
  let still = 0;
  let slides = 0;
  let run = 0;
  let maxRun = 0;
  const odd = [];
  let depthBad = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!b.ok) errs.push(`${label}: Dex fuera de lo andable o en un obstáculo en (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
    const dt = b.t - a.t;
    const dPx = Math.hypot(((b.x - a.x) / 100) * scene._w, ((b.y - a.y) / 100) * scene._h);
    const art = dPx / (b.ps * Math.max(0.2, b.scale));
    // Desplazarse sin animación de andar: parado y moviéndose, o andando con una textura que no es de andar.
    // Un frame suelto (16 ms, el de arrancar o el de llegar) no se ve; dos seguidos sí
    let slid = false;
    if (dPx > 0.5 && !a.moving && !b.moving) slid = true;
    if (b.moving && a.moving && dPx > 0.5 && !/walk|back|front/i.test(b.tex)) slid = true;
    if (slid) {
      slides++;
      run++;
      maxRun = Math.max(maxRun, run);
      if (odd.length < 3) odd.push(`${b.tex}${b.moving ? '' : ' (parado)'} ${dPx.toFixed(1)} px`);
    } else run = 0;
    if (b.moving && a.moving) {
      movT += dt;
      movArt += art;
      if (dPx < 1e-6) still += dt; else still = 0;
      if (still > 250) errs.push(`${label}: anda parado ${Math.round(still)} ms en (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
    }
    for (const n of b.npcs) {
      const front = b.y >= n.y;
      if (front !== b.depth > n.depth) depthBad++;
    }
  }
  const want = WALK_ART_PX_PER_S * mul;
  const got = movT > 400 ? (movArt / movT) * 1000 : null;
  if (got !== null && (got < want * 0.75 || got > want * 1.25)) errs.push(`${label}: avanza ${got.toFixed(1)} px de arte/s (esperado ${want.toFixed(1)} ±25 %)`);
  if (maxRun >= 2) errs.push(`${label}: ${maxRun} frames seguidos desplazándose sin animación de andar (${odd.join('; ')})`);
  else if (slides) console.log(`  aviso ${label}: ${slides} frame suelto sin animación de andar (${odd.join('; ')})`);
  if (depthBad) errs.push(`${label}: ${depthBad} frames con el orden de profundidad con una NPC al revés`);
  return { errs: [...new Set(errs)].slice(0, 6), artPxPerS: got, want, slides, maxRun };
}

for (const id of SCENES) {
  const d = JSON.parse(readFileSync(new URL(`${id}/scene.json`, ROOT), 'utf8'));
  d._w = d.render.world.width;
  d._h = d.render.world.height;
  if (d.player.hidePlayer) {
    console.log(`${id}: Dex oculto en esta escena (primer plano): sin recorrido`);
    report.push({ scene: id, skipped: 'hidePlayer' });
    continue;
  }
  try {
    await demo.openScene(id);
    await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  } catch (e) {
    problems.push(`${id}: no abre: ${e?.message || e}`);
    continue;
  }
  if (!(await demo.settle({ tap: [Math.round(VP.width / 2), 40] }))) problems.push(`${id}: la escena no quedó libre`);
  // Tamaño real del fondo (render.world puede no coincidir)
  const img = await page.evaluate(() => { const cs = window.__game.scene.getScene('GameScene').coordSystem; return { w: cs.imgW, h: cs.imgH }; });
  d._w = img.w;
  d._h = img.h;
  await installRecorder();
  const mul = speedMul(d.player.speed);
  const row = { scene: id, legs: [] };
  let k = 0;
  for (const pt of route(d)) {
    const to = await targetOf(pt, d);
    if (!to) { row.legs.push({ pt, skipped: 'sin destino' }); continue; }
    const from = await page.evaluate(() => window.__samples.length);
    const ms = await walk(to);
    const label = `${id} → ${pt.kind}${pt.id ? ` ${pt.id}` : ''} (${to.x.toFixed(1)}, ${to.y.toFixed(1)})`;
    if (ms === null) problems.push(`${label}: no llega en ${TIMEOUT_MS} ms (atascado)`);
    const now = await page.evaluate(() => window.__game.registry.get('currentSceneId'));
    if (now !== id) { problems.push(`${label}: la escena cambió a ${now} (un trigger saltó)`); break; }
    const samples = await page.evaluate((f) => window.__samples.slice(Math.max(0, f - 1)), from);
    const res = analyse(d, samples, mul, label);
    problems.push(...res.errs);
    row.legs.push({ pt, to, ms, artPxPerS: res.artPxPerS && Math.round(res.artPxPerS * 10) / 10, want: res.want, errs: res.errs.length });
    if (pt.kind !== 'edge') {
      await page.evaluate(() => window.__clear());
      await demo.sleep(300);
      await demo.still(`${id}-${++k}`);
    }
  }
  await page.evaluate(() => window.__draw());
  await demo.sleep(200);
  await demo.still(`${id}-ruta`);
  for (let i = 0; i < 3; i++) await demo.shot();
  report.push(row);
  const speeds = row.legs.map((l) => l.artPxPerS).filter((v) => v);
  console.log(`${id}: ${row.legs.length} tramos, px de arte/s ${speeds.length ? `${Math.min(...speeds)}–${Math.max(...speeds)}` : '-'} (pide ${(WALK_ART_PX_PER_S * mul).toFixed(1)})`);
}

await demo.end();
writeFileSync(join(demo.dir, 'walk.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join('\n') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

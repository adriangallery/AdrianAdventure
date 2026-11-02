// Demo de A2.8 (regla visual del plan SCUMM): densidad de píxel unificada.
// En 844x390 (móvil apaisado) y 1280x720 (escritorio), con ?qa=1:
//   1) lobby: el jugador anda hasta el mostrador, junto a la recepcionista (misma unidad de píxel los dos);
//   2) clinic_interior: el jugador junto al Dr. Satoshi;
//   3) outside: paseo de la acera al porche y vuelta: con depthScale encoge al alejarse y crece al acercarse.
// Comprueba por la API de QA (`state().pixel`, src/systems/PixelScale.ts) que:
//   - jugador y NPC usan la misma unidad: escala de la NPC = base del jugador (× artScale, 1 en las dos);
//   - donde la escala base se redondea (siempre desde ×2: 1280x720 → ×3) es un entero y la de las NPC también; en
//     844x390 la base exacta es 1,38 y la regla la deja sin redondear (un entero la cambiaría un 28-45 %, ver la
//     cabecera de PixelScale.ts): se comprueba que la regla se cumple, no que sea entera;
//   - el alto del jugador (en % del fondo) coincide (±1 %) en lobby, clinic_interior y la acera de outside;
//   - en outside, en el porche el factor de profundidad es < 0,7 y al volver a la acera vuelve a 1 (y a la escala entera).
// Capturas fijas a zoom 1 (sin reescalar): `<viewport>-<escena>-pies.png` (los pies y las zapatillas del jugador, para
// ver el píxel limpio), `<viewport>-<escena>.png` y, en outside, `<viewport>-filtro-lineal.png` /
// `<viewport>-filtro-nearest.png` (el fondo con el filtro de A2.8 y con el de antes, para comparar los cables).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-8-pixel-density
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true },
  { label: '1280x720', width: 1280, height: 720, isMobile: false, hasTouch: true },
];
const STAGE = { width: 1320, height: 800 };
const SNAP_TOLERANCE = 0.2; // el de src/systems/PixelScale.ts

const demo = await startDemo(import.meta.url, { fps: 4, width: 660 });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

// Lienzo fijo para los fotogramas del GIF (los dos viewports en el mismo tamaño)
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption) {
  const png = await page.screenshot();
  const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;font:16px monospace;color:#c8c0e8">
    <div style="margin-bottom:10px">${caption}</div>
    <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878;image-rendering:pixelated"></body></html>`);
  await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
  await page.bringToFront();
}

const pixel = () => page.evaluate(() => window.__qa.state().pixel);
/** Pies del jugador en pantalla (zoom 1) */
const feet = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  const p = gs.player;
  return { x: p.x - cam.scrollX, y: p.y - cam.scrollY, w: p.displayWidth, h: p.displayHeight, vw: cam.width, vh: cam.height };
});

/** Captura a zoom 1 de la zona de los pies (y otra del cuerpo entero), recortada a la pantalla. */
async function feetStill(tag) {
  const f = await feet();
  const clip = (x, y, w, h) => {
    const cx = Math.max(0, Math.min(f.vw - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(f.vh - 1, Math.round(y)));
    return { x: cx, y: cy, width: Math.max(1, Math.min(Math.round(w), f.vw - cx)), height: Math.max(1, Math.min(Math.round(h), f.vh - cy)) };
  };
  await demo.still(`${tag}-pies`, { clip: clip(f.x - 70, f.y - Math.min(90, f.h * 0.35), 140, Math.min(90, f.h * 0.35) + 8) });
  await demo.still(`${tag}-cuerpo`, { clip: clip(f.x - f.w, f.y - f.h - 10, f.w * 2, f.h + 20) });
}

/** Anda a (x, y) grabando hasta que llega; devuelve el error de la API, si lo hubo. */
async function walkFilming(x, y, caption, { sample } = {}) {
  await page.evaluate((x, y) => { window.__demoWalk = window.__qa.walk(x, y).then(() => null, (e) => String(e?.message || e)); window.__demoWalkDone = false; window.__demoWalk.then(() => { window.__demoWalkDone = true; }); }, x, y);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (sample) sample(await pixel());
    await stageFrame(caption);
    if (await page.evaluate(() => window.__demoWalkDone)) break;
  }
  return page.evaluate(() => window.__demoWalk);
}

/** La regla de redondeo (PixelScale.snapScreenScale) aplicada aparte */
function expectedSnap(exact) {
  const n = Math.round(exact);
  return n >= 1 && Math.abs(n - exact) / exact <= SNAP_TOLERANCE + 1e-9;
}

/** Comprobaciones comunes de una escena con el jugador en la franja sin profundidad. */
function checkScene(tag, p, { npc } = {}) {
  const bad = (m) => problems.push(`${tag}: ${m}`);
  if (!p) return bad('sin state().pixel');
  report.push({ tag, ...p });
  console.log(`${tag}: ${JSON.stringify(p)}`);
  const exact = p.pixelScale * p.coordScale;
  const want = expectedSnap(exact);
  if (p.snapped !== want) bad(`base ${exact.toFixed(3)}: redondeada = ${p.snapped}, la regla dice ${want}`);
  if (Math.abs(p.depth - 1) > 1e-6) bad(`el jugador no está en la franja sin profundidad (factor ${p.depth})`);
  if (want) {
    if (!p.integer) bad(`la escala del jugador ${p.playerScale} no es un múltiplo entero del píxel de arte`);
    for (const n of p.npcs) if (!n.integer) bad(`la escala de ${n.id} ${n.scale} no es un múltiplo entero del píxel de arte`);
  }
  if (npc) {
    const n = p.npcs.find((x) => x.id === npc);
    if (!n) bad(`no está ${npc}`);
    else if (Math.abs(n.scale - p.playerBase) > 1e-6) bad(`${npc} a escala ${n.scale} y el jugador a ${p.playerBase}: mezcla de resoluciones`);
  }
}

async function open(scene, vp) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 40] }))) await demo.fail(`${vp.label} ${scene}: la escena no quedó libre`);
}

for (const vp of VIEWPORTS) {
  const { label, ...viewport } = vp;
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  const heights = {};

  // 1) lobby, junto a la recepcionista
  await open('lobby', vp);
  for (let i = 0; i < 2; i++) await stageFrame(`${label} · lobby`);
  const lobbyErr = await walkFilming(42, 90, `${label} · lobby: anda hasta la recepcionista`);
  if (lobbyErr) problems.push(`${label} lobby: walk falló: ${lobbyErr}`);
  await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  const lobby = await pixel();
  checkScene(`${label} lobby`, lobby, { npc: 'npc_receptionist' });
  heights.lobby = lobby?.playerHeightPct;
  await demo.still(`${label}-lobby`);
  await feetStill(`${label}-lobby`);
  for (let i = 0; i < 4; i++) await stageFrame(`${label} · lobby: jugador ×${lobby?.playerScale?.toFixed?.(2)} y recepcionista ×${lobby?.npcs?.[0]?.scale?.toFixed?.(2)} (misma unidad)`);

  // 2) clinic_interior, junto al Dr. Satoshi (el spawn ya está junto al mostrador)
  await open('clinic_interior', vp);
  // La zona caminable de la derecha es la franja y 96-100 %, que en 844x390 queda bajo el panel de verbos (el clic
  // de `walk` no llega): el spawn (89, 98) ya está junto al Dr. Satoshi, así que no hace falta andar.
  await demo.film(400);
  await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  const clinic = await pixel();
  checkScene(`${label} clinic_interior`, clinic, { npc: 'npc_dr_satoshi' });
  heights.clinic_interior = clinic?.playerHeightPct;
  await demo.still(`${label}-clinic_interior`);
  await feetStill(`${label}-clinic_interior`);
  for (let i = 0; i < 4; i++) await stageFrame(`${label} · clinic_interior: jugador ×${clinic?.playerScale?.toFixed?.(2)} y Dr. Satoshi ×${clinic?.npcs?.[0]?.scale?.toFixed?.(2)}`);

  // 3) outside: acera → porche → acera (depthScale)
  await open('outside', vp);
  const front = await pixel();
  checkScene(`${label} outside (acera)`, front);
  heights.outside = front?.playerHeightPct;
  await feetStill(`${label}-outside`);
  let minDepth = 1;
  const sample = (p) => { if (p) minDepth = Math.min(minDepth, p.depth); };
  const inErr = await walkFilming(39, 83.5, `${label} · outside: hacia el porche (se aleja: encoge)`, { sample });
  if (inErr) problems.push(`${label} outside: walk al porche falló: ${inErr}`);
  await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  const porch = await pixel();
  console.log(`${label} outside (porche): ${JSON.stringify(porch)}`);
  report.push({ tag: `${label} outside (porche)`, ...porch });
  if (!(minDepth < 0.7)) problems.push(`${label} outside: en el porche el factor de profundidad es ${minDepth} (se esperaba < 0,7)`);
  await demo.still(`${label}-outside-porche`);
  // Filtro del fondo: el de A2.8 (lineal) y el de antes (nearest), mismo encuadre
  await demo.still(`${label}-filtro-lineal`);
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    gs.textures.get("bg_outside").setFilter(1); // Phaser.Textures.FilterMode.NEAREST
  });
  await demo.sleep(300);
  await demo.still(`${label}-filtro-nearest`);
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    gs.textures.get('bg_outside').setFilter(0); // Phaser.Textures.FilterMode.LINEAR
  });
  const outErr = await walkFilming(55, 97, `${label} · outside: vuelve a la acera (se acerca: crece)`);
  if (outErr) problems.push(`${label} outside: walk a la acera falló: ${outErr}`);
  await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  const back = await pixel();
  checkScene(`${label} outside (vuelta)`, back);
  for (let i = 0; i < 3; i++) await stageFrame(`${label} · outside: de vuelta en la acera, ×${back?.playerScale?.toFixed?.(2)}`);

  // Mismo alto en las tres escenas (±1 %: con el mismo viewport y la misma unidad tiene que ser idéntico)
  const ref = heights.lobby;
  for (const [scene, h] of Object.entries(heights)) {
    if (!(typeof h === 'number' && typeof ref === 'number' && Math.abs(h - ref) / ref <= 0.01)) {
      problems.push(`${label}: el jugador mide el ${h} % en ${scene} y el ${ref} % en lobby`);
    }
  }
  console.log(`${label}: alto del jugador por escena ${JSON.stringify(heights)}`);
}

await stage.close().catch(() => {});
await demo.end();
writeFileSync(join(demo.dir, 'pixel.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`${frame} fotogramas · problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

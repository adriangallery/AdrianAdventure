// Demo de A2.13 (plan SCUMM): escala fija de Dex en outside y cambio de tamaño ≤ 25 % en el resto.
// Adrián (11-nov): en `outside` Dex no debe cambiar de tamaño en ningún momento, con el tamaño que tiene en la acera
// junto al buzón; en las demás escenas, escala fija si el fondo apenas tiene profundidad y, donde se aleja de verdad
// (camino del monte), un cambio suave de como mucho un 25 % entre el punto más cercano y el más lejano.
// Con ?qa=1:
//   1) outside, en 844x390 (móvil apaisado) y 1280x720 (escritorio): Dex en la acera junto al buzón (55, 93), anda
//      hasta la puerta (34,5, 83,5) midiendo su alto en pantalla en cada fotograma, y vuelve. Falla si el alto en la
//      puerta (o en cualquier punto del paseo) se aparta más de 1 px del de la acera, o si el factor de profundidad no
//      es 1. Capturas `outside-<vp>-acera.png`, `outside-<vp>-puerta.png` y las dos juntas en
//      `outside-<vp>-acera-y-puerta.png`.
//   2) el resto de escenas (844x390): Dex en el punto andable más cercano (abajo) y en el más lejano (arriba) de
//      `walkableAreas`; falla si lejos/cerca < 0,75, o si una escena de escala fija (qa/proportion-refs.json, scale)
//      cambia más de 1 px. Capturas `<escena>-cerca.png` y `<escena>-lejos.png`. treatment_room no enseña a Dex.
// Tabla en fixed-scale.md/.json. Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-13-fixed-scale
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';
import { loadRefs, loadScene, MAX_DEPTH_CHANGE } from './lib/proportion.mjs';

const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true },
  { label: '1280x720', width: 1280, height: 720, isMobile: false, hasTouch: true },
];
const SIDEWALK = { x: 55, y: 93 }; // acera, junto al buzón (hs_mailbox walkTo 57, 92)
const DOOR = { x: 34.5, y: 83.5 }; // porche, delante de la puerta (hs_front_door x 31,6-36,6)
const STAGE = { width: 1320, height: 800 };
const TOL_PX = 1;
const INSET = 0.6;

const demo = await startDemo(import.meta.url, { fps: 4, width: 660 });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = { outside: [], scenes: [] };
const refs = loadRefs();

const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
const imgTag = (png) => `<img src="data:image/png;base64,${Buffer.from(png).toString('base64')}" style="max-width:${STAGE.width - 20}px;max-height:${(STAGE.height - 60) / 2}px;outline:1px solid #504878;image-rendering:pixelated">`;
async function stageShot(caption, pngs, path) {
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:16px monospace;color:#c8c0e8">
    <div>${caption}</div>${pngs.map(imgTag).join('')}</body></html>`);
  await stage.screenshot({ path });
  await page.bringToFront();
}
const stageFrame = async (caption) => stageShot(caption, [await page.screenshot()], join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`));

/** Alto de Dex en pantalla (px de lienzo, zoom de cámara incluido), factor de profundidad y posición de los pies. */
const measure = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const p = gs.player;
  const px = window.__qa.state().pixel;
  return { h: Math.round(p.displayHeight * gs.cameras.main.zoom * 100) / 100, depth: px.depth, worldHeightPct: px.worldHeightPct, pixelScale: px.pixelScale, x: Math.round(p.pctX * 10) / 10, y: Math.round(p.pctY * 10) / 10 };
});

async function open(scene, vp) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 40] }))) problems.push(`${vp.label} ${scene}: la escena no quedó libre`);
}

async function place(x, y) {
  await page.evaluate((x, y) => {
    const gs = window.__game.scene.getScene('GameScene');
    gs.player.teleportPct(x, y);
    gs.player.setVisible(true);
  }, x, y);
  await demo.sleep(900);
  return measure();
}

/** Anda a (x, y) grabando y midiendo en cada fotograma; devuelve { err, samples }. */
async function walkMeasuring(x, y, caption) {
  await page.evaluate((x, y) => { window.__demoWalk = window.__qa.walk(x, y).then(() => null, (e) => String(e?.message || e)); window.__demoWalkDone = false; window.__demoWalk.then(() => { window.__demoWalkDone = true; }); }, x, y);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const m = await measure();
    samples.push(m);
    await stageFrame(`${caption} · Dex ${m.h} px (factor ${m.depth})`);
    if (await page.evaluate(() => window.__demoWalkDone)) break;
  }
  return { err: await page.evaluate(() => window.__demoWalk), samples };
}

// 1) outside: acera → puerta → acera, mismo alto
for (const vp of VIEWPORTS) {
  const { label, ...viewport } = vp;
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  await open('outside', vp);
  const acera = await place(SIDEWALK.x, SIDEWALK.y);
  const aceraPng = await page.screenshot({ path: join(demo.dir, `outside-${label}-acera.png`) });
  for (let i = 0; i < 3; i++) await stageFrame(`${label} · outside: Dex en la acera, junto al buzón · ${acera.h} px`);
  const ida = await walkMeasuring(DOOR.x, DOOR.y, `${label} · outside: hacia la puerta (A2.13: no encoge)`);
  if (ida.err) problems.push(`${label} outside: walk a la puerta falló: ${ida.err}`);
  await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  // Por si el walk se quedó corto (punto de llegada ajustado), la medida de la puerta es con los pies en DOOR
  const puerta = await place(DOOR.x, DOOR.y);
  const puertaPng = await page.screenshot({ path: join(demo.dir, `outside-${label}-puerta.png`) });
  for (let i = 0; i < 3; i++) await stageFrame(`${label} · outside: Dex en la puerta · ${puerta.h} px (en la acera ${acera.h} px)`);
  await stageShot(`${label} · outside: acera (${acera.h} px) y puerta (${puerta.h} px)`, [aceraPng, puertaPng], join(demo.dir, `outside-${label}-acera-y-puerta.png`));
  const vuelta = await walkMeasuring(SIDEWALK.x, SIDEWALK.y, `${label} · outside: vuelta a la acera`);
  if (vuelta.err) problems.push(`${label} outside: walk a la acera falló: ${vuelta.err}`);
  const all = [acera, puerta, ...ida.samples, ...vuelta.samples];
  const hs = all.map((m) => m.h);
  const min = Math.min(...hs), max = Math.max(...hs);
  const row = { viewport: label, acera: acera.h, puerta: puerta.h, min, max, samples: all.length, depth: [...new Set(all.map((m) => m.depth))] };
  report.outside.push(row);
  console.log(`${label} outside: ${JSON.stringify(row)}`);
  if (Math.abs(puerta.h - acera.h) > TOL_PX) problems.push(`${label} outside: Dex mide ${acera.h} px en la acera y ${puerta.h} px en la puerta (±${TOL_PX} px)`);
  if (max - min > TOL_PX) problems.push(`${label} outside: al andar su alto va de ${min} a ${max} px (escala fija: ±${TOL_PX} px)`);
  if (all.some((m) => Math.abs(m.depth - 1) > 1e-6)) problems.push(`${label} outside: factor de profundidad ≠ 1 (${row.depth.join(', ')})`);
  if (Math.abs(acera.worldHeightPct - 40.23) > 0.05) problems.push(`${label} outside: en la acera mide el ${acera.worldHeightPct} % del fondo (el tamaño de A2.11 era 40,23 %)`);
}

// 2) resto de escenas: punto más cercano y más lejano de la zona andable
const VP = VIEWPORTS[0];
await page.setViewport({ deviceScaleFactor: 1, ...(({ label, ...v }) => v)(VP) });
for (const ref of refs.scenes) {
  if (ref.scene === 'outside' || ref.skipDemo) continue;
  const scene = loadScene(ref.scene);
  const areas = (scene.walkableAreas || []).filter((a) => a.w > 0 && a.h > 0);
  if (!areas.length) { problems.push(`${ref.scene}: sin walkableAreas`); continue; }
  const top = areas.reduce((a, b) => (b.y < a.y ? b : a));
  const bottom = areas.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
  const lejosP = { x: top.x + top.w / 2, y: top.y + INSET };
  const cercaP = { x: bottom.x + bottom.w / 2, y: bottom.y + bottom.h - INSET };
  try { await open(ref.scene, VP); } catch (e) { problems.push(`${ref.scene}: no abre: ${e?.message || e}`); continue; }
  const cerca = await place(cercaP.x, cercaP.y);
  await demo.still(`${ref.scene}-cerca`);
  await stageFrame(`${ref.scene} (${ref.scale}): cerca · ${cerca.h} px`);
  const lejos = await place(lejosP.x, lejosP.y);
  await demo.still(`${ref.scene}-lejos`);
  await stageFrame(`${ref.scene} (${ref.scale}): lejos · ${lejos.h} px`);
  const ratio = Math.round((lejos.h / cerca.h) * 1000) / 1000;
  const row = { scene: ref.scene, scale: ref.scale, cerca: { ...cercaP, h: cerca.h, depth: cerca.depth }, lejos: { ...lejosP, h: lejos.h, depth: lejos.depth }, ratio };
  report.scenes.push(row);
  console.log(`${ref.scene}: ${JSON.stringify(row)}`);
  if (ratio < 1 - MAX_DEPTH_CHANGE - 1e-3) problems.push(`${ref.scene}: lejos/cerca = ${ratio} (< ${1 - MAX_DEPTH_CHANGE}): cambia de tamaño más de un ${MAX_DEPTH_CHANGE * 100} %`);
  if (ref.scale === 'fixed' && Math.abs(lejos.h - cerca.h) > TOL_PX) problems.push(`${ref.scene}: escala fija y Dex mide ${cerca.h} px cerca y ${lejos.h} px lejos`);
}

await demo.end();
const md = [
  '| outside | acera (px) | puerta (px) | mín–máx al andar (px) | factor |',
  '|---|---|---|---|---|',
  ...report.outside.map((r) => `| ${r.viewport} | ${r.acera} | ${r.puerta} | ${r.min}–${r.max} (${r.samples} medidas) | ${r.depth.join(', ')} |`),
  '',
  '| escena | modo | cerca (px) | lejos (px) | lejos/cerca |',
  '|---|---|---|---|---|',
  ...report.scenes.map((r) => `| ${r.scene} | ${r.scale} | ${r.cerca.h} | ${r.lejos.h} | ${r.ratio} |`),
].join('\n');
writeFileSync(join(demo.dir, 'fixed-scale.md'), `${md}\n`);
writeFileSync(join(demo.dir, 'fixed-scale.json'), JSON.stringify(report, null, 2));
console.log(md);
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

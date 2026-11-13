// Demo de A3.3f («lo que hace falta para un puzle tiene que VERSE»), en móvil apaisado 844×390 y vertical 390×844:
//  1) en outside, Dex va a la valla: el tablón suelto (overlay plank_loose) está a la vista y el hueco (fence_gap) no;
//  2) va bajo la chimenea: el nido de urracas (overlay nest) está a la vista;
//  3) PULL valla: el tablón desaparece y queda el hueco;
//  4) tablón + chimenea: el nido cae y desaparece.
// Falla si algún overlay falta, no está visible cuando toca o no cae dentro de la cámara.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-3f-nido
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  { tag: 'port', viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0].viewport });
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

/** Estado de un overlay condicional: existe, visible, y qué parte de su caja cae dentro de la cámara (0–1). */
const overlay = (id) => page.evaluate((oid) => {
  const gs = window.__game.scene.getScene('GameScene');
  const co = (gs.conditionalOverlays ?? []).find((o) => o.id === oid);
  if (!co) return { exists: false };
  const b = co.sprite.getBounds();
  const v = gs.cameras.main.worldView;
  const ix = Math.max(0, Math.min(b.right, v.right) - Math.max(b.left, v.left));
  const iy = Math.max(0, Math.min(b.bottom, v.bottom) - Math.max(b.top, v.top));
  const cam = gs.cameras.main;
  return {
    exists: true,
    visible: co.sprite.visible && co.sprite.alpha > 0.5,
    inView: b.width * b.height > 0 ? (ix * iy) / (b.width * b.height) : 0,
    // Tamaño en pantalla (px CSS): que se distinga a tamaño móvil
    screenW: Math.round(b.width * cam.zoom),
    screenH: Math.round(b.height * cam.zoom),
  };
}, id);

/** Primer punto andable de la lista (x, y en %) */
const walkable = (pts) => page.evaluate((list) => list.find(([x, y]) => window.__qa.isWalkable(x, y)) ?? null, pts);

async function expectShown(id, tag, minPx) {
  const o = await overlay(id);
  check(o.exists, `${tag}: el overlay ${id} está cargado`);
  check(o.visible, `${tag}: ${id} visible`);
  check(o.inView > 0.9, `${tag}: ${id} dentro de la cámara (${Math.round((o.inView ?? 0) * 100)} %)`);
  check(Math.min(o.screenW ?? 0, o.screenH ?? 0) >= minPx, `${tag}: ${id} mide ${o.screenW}×${o.screenH} px en pantalla (≥ ${minPx})`);
}
async function expectHidden(id, tag) {
  const o = await overlay(id);
  check(o.exists && !o.visible, `${tag}: ${id} oculto`);
}

for (const [i, { tag, viewport }] of VIEWPORTS.entries()) {
  if (i > 0) {
    // Partida nueva: sin el tablón ni el nido caído de la ronda anterior
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.setViewport(viewport);
  }
  await demo.openScene('outside');
  await demo.settle({ tap: [Math.round(viewport.width / 2), 40] });
  await demo.film(800);

  // 1) La valla
  const fenceSpot = await walkable([[6, 94], [5.5, 94], [7, 93], [8, 95], [10, 94]]);
  check(!!fenceSpot, `${tag}: punto andable junto a la valla ${JSON.stringify(fenceSpot)}`);
  await page.evaluate(([x, y]) => window.__qa.walk(x, y), fenceSpot ?? [6, 94]);
  await demo.film(1500);
  await demo.still(`${tag}-1-valla-antes`);
  await expectShown('plank_loose', tag, 12);
  await expectHidden('fence_gap', tag);

  // 2) La chimenea
  const nestSpot = await walkable([[46, 93], [45, 94], [47, 92], [44, 95], [48, 94], [50, 93]]);
  check(!!nestSpot, `${tag}: punto andable bajo la chimenea ${JSON.stringify(nestSpot)}`);
  await page.evaluate(([x, y]) => window.__qa.walk(x, y), nestSpot ?? [46, 93]);
  await demo.film(1500);
  await demo.still(`${tag}-2-nido-antes`);
  await expectShown('nest', tag, 20);

  // 3) Coger el tablón
  await page.evaluate(() => window.__qa.act('PULL', 'hs_fence'));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(1500);
  await demo.still(`${tag}-3-valla-despues`);
  const flags1 = await page.evaluate(() => window.__qa.state().flags);
  check(flags1.has_plank === true, `${tag}: PULL valla da el tablón (has_plank)`);
  await expectHidden('plank_loose', tag);
  await expectShown('fence_gap', tag, 4);

  // 4) Tirar el nido
  await page.evaluate(() => window.__qa.use('fence_plank', 'hs_chimney'));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(1500);
  await demo.still(`${tag}-4-nido-despues`);
  const flags2 = await page.evaluate(() => window.__qa.state().flags);
  check(flags2.nest_down === true, `${tag}: tablón + chimenea tira el nido (nest_down)`);
  await expectHidden('nest', tag);
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

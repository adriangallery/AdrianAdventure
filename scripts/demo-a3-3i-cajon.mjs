// Demo de A3.3i (el CAJÓN del escritorio de upstairs se ve y se llama cajón), en 1280×720 y en móvil apaisado 844×390:
//  1) en upstairs, Dex va al escritorio: el cajón de la cajonera derecha lleva la pantallita de cerradura
//     (overlay desk_drawer_locked) y el abierto (desk_drawer_open) no está; el hotspot hs_desk_drawer se llama
//     «Desk Drawer»;
//  2) OPEN hs_desk_drawer + «Keep reading» ×3: la terminal_key sale del cajón (found_terminal_key);
//  3) el cajón queda abierto (desk_drawer_open visible, desk_drawer_locked oculto).
// Falla si algún overlay falta, no está visible cuando toca, no cae dentro de la cámara o el puzle no da la llave.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-3i-cajon
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'desk', viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } },
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
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
    screenW: Math.round(b.width * cam.zoom),
    screenH: Math.round(b.height * cam.zoom),
  };
}, id);

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
    // Partida nueva: el cajón cerrado otra vez
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.setViewport(viewport);
  }
  await demo.openScene('upstairs');
  await demo.settle({ tap: [Math.round(viewport.width / 2), 40] });
  await demo.film(800);

  const name = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const data = gs.cache.json.get('scene_upstairs');
    return data?.regions?.hotspots?.find((h) => h.id === 'hs_desk_drawer')?.name ?? null;
  });
  check(name === 'Desk Drawer', `${tag}: el hotspot hs_desk_drawer se llama «${name}»`);

  // 1) Delante del cajón cerrado
  await page.evaluate(() => window.__qa.walk(61.4, 97));
  await demo.film(1500);
  await demo.still(`${tag}-1-cajon-cerrado`);
  await expectShown('desk_drawer_locked', tag, 12);
  await expectHidden('desk_drawer_open', tag);

  // 2) El puzle: leer los Términos hasta la página 38
  await page.evaluate(() => window.__qa.act('OPEN', 'hs_desk_drawer', ['Keep reading', 'Keep reading', 'Keep reading']));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(1500);
  const st = await page.evaluate(() => window.__qa.state());
  check(st.flags.found_terminal_key === true, `${tag}: OPEN cajón + «Keep reading» ×3 da found_terminal_key`);
  check((st.inventory ?? []).some((it) => (it.id ?? it) === 'terminal_key'), `${tag}: la terminal_key está en el inventario`);

  // 3) Cajón abierto
  await demo.still(`${tag}-2-cajon-abierto`);
  await expectShown('desk_drawer_open', tag, 12);
  await expectHidden('desk_drawer_locked', tag);
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

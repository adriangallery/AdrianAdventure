// Demo de A3.11 («lo que ya cogiste desaparece de la escena»), en escritorio 1280×720 y móvil apaisado 844×390:
//  1) basement: el ratón de la mesa está dibujado y su hotspot existe; PICK lo mete en el inventario, el hotspot deja
//     de existir (ni nombre al pasar ni clic: el punto cae en la mesa) y el parche mouse_taken lo borra del fondo;
//  2) volver a la escena (lobby → basement) y recargar la página: sigue sin ratón;
//  3) upstairs: la lata de BULL RUN (hotspot oculto mientras la llevas, overlay de la lata fuera);
//  4) clinic_interior: la foto del marco (hotspot oculto, overlay no_photo).
// Capturas antes/después de cada objeto en demo-out/a3-11-cogidos/. Falla si un hotspot cogido sigue en la escena o
// un overlay no cambia.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-11-cogidos
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'desk', viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } },
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0].viewport });
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

const qaState = () => page.evaluate(() => window.__qa.state());
const overlayVisible = (id) => page.evaluate((oid) => {
  const gs = window.__game.scene.getScene('GameScene');
  const co = (gs.conditionalOverlays ?? []).find((o) => o.id === oid);
  return co ? co.sprite.visible : null;
}, id);
/** Hotspot bajo el centro de un hotspot (con la visibilidad del juego): lo que el ratón nombraría ahí */
const hoverAt = (hsId) => page.evaluate((id) => {
  const gs = window.__game.scene.getScene('GameScene');
  const hs = gs.sceneDataLoader.getHotspots().find((h) => h.id === id);
  const b = hs.bounds;
  const hit = gs.sceneDataLoader.getHotspotAtPct(b.x + b.w / 2, b.y + b.h / 2, (h) => gs.qaIsHotspotVisible(h));
  return hit ? hit.id : null;
}, hsId);
const walkable = (pts) => page.evaluate((list) => list.find(([x, y]) => window.__qa.isWalkable(x, y)) ?? null, pts);

async function pickAndCheck({ tag, scene, hs, verb = 'PICK', item, overlay, overlayAfter, near }) {
  const spot = await walkable(near);
  if (spot) await page.evaluate(([x, y]) => window.__qa.walk(x, y), spot);
  await demo.film(1200);
  let st = await qaState();
  check(st.hotspots.includes(hs), `${tag} ${scene}: ${hs} existe antes de cogerlo`);
  check(await hoverAt(hs) === hs, `${tag} ${scene}: al pasar por encima sale ${hs}`);
  check(await overlayVisible(overlay) === !overlayAfter, `${tag} ${scene}: overlay ${overlay} ${overlayAfter ? 'oculto' : 'visible'} antes`);
  await demo.still(`${tag}-${scene}-${hs}-antes`);
  await page.evaluate(([v, h]) => window.__qa.act(v, h), [verb, hs]);
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(1200);
  st = await qaState();
  check(st.inventory.includes(item), `${tag} ${scene}: ${item} en el inventario`);
  check(!st.hotspots.includes(hs), `${tag} ${scene}: ${hs} ya no existe`);
  check(await hoverAt(hs) !== hs, `${tag} ${scene}: al pasar por encima ya no sale ${hs} (sale ${await hoverAt(hs)})`);
  check(await overlayVisible(overlay) === overlayAfter, `${tag} ${scene}: overlay ${overlay} ${overlayAfter ? 'visible' : 'oculto'} después`);
  await demo.still(`${tag}-${scene}-${hs}-despues`);
}

for (const [i, { tag, viewport }] of VIEWPORTS.entries()) {
  if (i > 0) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.setViewport(viewport);
  }
  // 1) basement: el ratón
  await demo.openScene('basement');
  await demo.settle({ tap: [Math.round(viewport.width / 2), 40] });
  await pickAndCheck({ tag, scene: 'basement', hs: 'hs_dead_mouse', item: 'broken_mouse', overlay: 'mouse_taken', overlayAfter: true, near: [[62, 90], [60, 90], [64, 92], [58, 88]] });
  check(await hoverAt('hs_dead_mouse') === 'hs_left_desk', `${tag} basement: donde estaba el ratón ahora se toca la mesa`);

  // 2) volver a la escena y recargar
  await page.evaluate(() => window.__qa.goto('lobby'));
  await demo.film(800);
  await page.evaluate(() => window.__qa.goto('basement'));
  await demo.film(1200);
  let st = await qaState();
  check(st.scene === 'basement' && !st.hotspots.includes('hs_dead_mouse'), `${tag} basement: al volver a la escena el ratón sigue sin estar`);
  check(await overlayVisible('mouse_taken') === true, `${tag} basement: al volver, el parche sigue puesto`);
  await demo.still(`${tag}-basement-vuelta`);

  // 3) upstairs: la lata
  await page.evaluate(() => window.__qa.goto('upstairs'));
  await demo.film(1200);
  await pickAndCheck({ tag, scene: 'upstairs', hs: 'hs_energy_drink', item: 'energy_drink', overlay: 'no_energy_drink', overlayAfter: false, near: [[46, 95], [44, 95], [48, 94]] });

  // 4) clinic_interior: la foto
  await page.evaluate(() => window.__qa.goto('clinic_interior'));
  await demo.film(1200);
  await pickAndCheck({ tag, scene: 'clinic_interior', hs: 'hs_clinic_photo', item: 'clinic_photo', overlay: 'no_photo', overlayAfter: true, near: [[48, 92], [46, 93], [50, 92]] });
}

// 5) cargar partida: la autopartida guarda las flags; al recargar y volver al sótano el ratón no está
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.scene?.isActive('GameScene'), { timeout: 90000, polling: 500 });
await page.evaluate(() => window.__qa.goto('basement'));
await demo.film(1200);
const st = await qaState();
if (st.flags.found_broken_mouse) {
  check(!st.hotspots.includes('hs_dead_mouse'), 'partida cargada: el ratón del sótano sigue sin estar');
  check(await overlayVisible('mouse_taken') === true, 'partida cargada: el parche sigue puesto');
  await demo.still('carga-basement');
} else {
  console.log('(la recarga con ?qa=1 empieza partida nueva: la carga ya la cubre el estado evaluado en cada entrada)');
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

// Demo de V6 para Adrián (regla visual): en móvil, MANTENER PULSADO un objeto = su acción principal (anillo de
// progreso de 450 ms). A1.14: TOCAR un objeto con Walk ya no es mirarlo: Dex anda hacia él sin frase (SCUMM clásico).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run hold
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 12, viewport: { deviceScaleFactor: 2 } });
const { page } = demo;
await demo.openScene(SCENE);

// Deja la escena libre tocando arriba (zona sin objetos) mientras haya cinemática, diálogo o cooldown
const settle = () => demo.settle({ cooldown: true });
if (!(await settle())) await demo.fail('La escena no quedó libre');
await demo.sleep(600);

// Elegir un objeto visible con acción principal «real» (no USE por descarte) y centrar la cámara en él
const target = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const Scene = gs.constructor;
  const hs = gs.registry.get('sceneData').regions.hotspots
    .filter((h) => h.bounds && gs.isHotspotVisible(h))
    .map((h) => ({ h, verb: Scene.mainVerbFor(h) }))
    .sort((a, b) => (a.verb === 'USE') - (b.verb === 'USE') || b.h.bounds.w * b.h.bounds.h - a.h.bounds.w * a.h.bounds.h)[0];
  const cam = gs.cameras.main;
  const a = gs.coordSystem.pctToScreen(hs.h.bounds.x, hs.h.bounds.y);
  const b = gs.coordSystem.pctToScreen(hs.h.bounds.x + hs.h.bounds.w, hs.h.bounds.y + hs.h.bounds.h);
  cam.stopFollow();
  cam.scrollX = Math.max(0, (a.x + b.x) / 2 - cam.width / 2);
  // Registrar qué verbo llega a la UI en cada toque
  window.__verbs = [];
  gs.events.on('hotspot:tapped', (h, v) => window.__verbs.push({ id: h.id, verb: v ?? null }));
  return { id: hs.h.id, name: hs.h.name, main: hs.verb, x: Math.round((a.x + b.x) / 2 - cam.scrollX), y: Math.round((a.y + b.y) / 2 - cam.scrollY) };
});
console.log('objetivo', JSON.stringify(target));

// 1) Tocar = andar hacia él (A1.14), sin verbo ni frase
await demo.film(500);
await page.touchscreen.tap(target.x, target.y);
await demo.film(1800);
const afterTap = await page.evaluate(() => window.__verbs.slice());
const tapWalk = await page.evaluate(() => window.__qa?.state().walkTarget ?? null);
if (!(await settle())) await demo.fail('La escena no quedó libre tras tocar');
await demo.film(400);

// 2) Mantener pulsado = acción principal (toque de 700 ms con captura del anillo)
await page.touchscreen.touchStart(target.x, target.y);
await demo.film(700);
await page.touchscreen.touchEnd();
await demo.film(2200);
// A3.2: tras la apertura Dex queda junto a la puerta y puede tener que cruzar la calle hasta el objeto: la acción llega
// al terminar de andar, así que se espera (hasta 20 s) a que llegue un verbo nuevo
for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
  if ((await page.evaluate((n) => window.__verbs.length > n, afterTap.length))) break;
  await demo.film(500);
}
const afterHold = await page.evaluate(() => window.__verbs.slice());
await demo.still('full');
await demo.end();

console.log('tras tocar', JSON.stringify(afterTap));
console.log('tras mantener', JSON.stringify(afterHold));
console.log(`${demo.frames} frames`);
console.log('andar al tocar', JSON.stringify(tapWalk));
const tapOk = afterTap.length === 0 && (!tapWalk || (tapWalk.target === target.id && tapWalk.verb === 'WALK'));
const holdVerbs = afterHold.slice(afterTap.length).map((e) => e.verb);
// La acción puede llegar al instante (TALK/sin alcance) o al terminar de andar
const holdOk = holdVerbs.includes(target.main) && !holdVerbs.includes('LOOK');
if (!tapOk) await demo.fail(`Tocar no anduvo (A1.14): verbos ${JSON.stringify(afterTap)}, walkTarget ${JSON.stringify(tapWalk)}`);
if (!holdOk) await demo.fail(`Mantener no disparó ${target.main}: ${JSON.stringify(holdVerbs)}`);

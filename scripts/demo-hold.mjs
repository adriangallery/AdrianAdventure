// Demo de V6 para Adrián (regla visual): en móvil, TOCAR un objeto = mirarlo y MANTENER PULSADO = su
// acción principal (anillo de progreso de 450 ms).
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

// 1) Tocar = mirar
await demo.film(500);
await page.touchscreen.tap(target.x, target.y);
await demo.film(1800);
const afterTap = await page.evaluate(() => window.__verbs.slice());
if (!(await settle())) await demo.fail('El diálogo de «mirar» no se cerró');
await demo.film(400);

// 2) Mantener pulsado = acción principal (toque de 700 ms con captura del anillo)
await page.touchscreen.touchStart(target.x, target.y);
await demo.film(700);
await page.touchscreen.touchEnd();
await demo.film(2200);
const afterHold = await page.evaluate(() => window.__verbs.slice());
await demo.still('full');
await demo.end();

console.log('tras tocar', JSON.stringify(afterTap));
console.log('tras mantener', JSON.stringify(afterHold));
console.log(`${demo.frames} frames`);
const tapOk = afterTap.length === 1 && afterTap[0].verb === 'LOOK';
const holdVerbs = afterHold.slice(afterTap.length).map((e) => e.verb);
// La acción puede llegar al instante (TALK/sin alcance) o al terminar de andar
const holdOk = holdVerbs.includes(target.main) && !holdVerbs.includes('LOOK');
if (!tapOk) await demo.fail('Tocar no disparó LOOK');
if (!holdOk) await demo.fail(`Mantener no disparó ${target.main}: ${JSON.stringify(holdVerbs)}`);

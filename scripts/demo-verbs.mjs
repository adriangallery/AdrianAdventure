// Demo de V6 para Adrián (regla visual): al tocar un objeto, el panel resalta los verbos que hacen algo con él
// y atenúa los que no tienen respuesta; y el panel plegado en móvil se recuerda al recargar.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run verbs
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 6 });
const { page } = demo;
const load = async () => {
  await demo.openScene(SCENE);
  return demo.settle();
};
if (!(await load())) await demo.fail('La escena no quedó libre');

// 1) Tocar un objeto con acción real → contexto de verbos
const target = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const Scene = gs.constructor;
  const hs = gs.registry.get('sceneData').regions.hotspots
    .filter((h) => h.bounds && gs.isHotspotVisible(h) && Scene.mainVerbFor(h) !== 'USE')[0];
  const cam = gs.cameras.main;
  const a = gs.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
  const b = gs.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
  cam.stopFollow();
  cam.scrollX = Math.max(0, (a.x + b.x) / 2 - cam.width / 2);
  return { id: hs.id, main: Scene.mainVerbFor(hs), x: Math.round((a.x + b.x) / 2 - cam.scrollX), y: Math.round((a.y + b.y) / 2 - cam.scrollY) };
});
for (let i = 0; i < 3; i++) await demo.shot();
await page.touchscreen.tap(target.x, target.y);
await demo.sleep(400);
for (let i = 0; i < 6; i++) await demo.shot();
const ctx = await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.getContextState());

// 2) Plegar el panel (asa superior) y recargar: debe seguir plegado
await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.collapse());
await demo.sleep(500);
for (let i = 0; i < 3; i++) await demo.shot();
const okReload = await load();
const collapsedAfterReload = await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.collapsed === true);
for (let i = 0; i < 4; i++) await demo.shot();
await demo.still('full');
await demo.end();

console.log(`objetivo ${JSON.stringify(target)} · contexto ${JSON.stringify(ctx)} · plegado tras recargar: ${collapsedAfterReload} (escena libre: ${okReload}) · ${demo.frames} frames`);
if (ctx.id !== target.id) await demo.fail('El panel no tomó el objeto tocado como contexto');
if (!ctx.highlighted.includes(target.main)) await demo.fail(`El verbo principal ${target.main} no quedó resaltado`);
if (!collapsedAfterReload) await demo.fail('El panel plegado no se recordó al recargar');

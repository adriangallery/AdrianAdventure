// Demo de V6 para Adrián (regla visual): al tocar un objeto, el panel resalta los verbos que hacen algo con él
// y atenúa los que no tienen respuesta; y el panel plegado en móvil se recuerda al recargar.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-verbs.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-verbs-frames';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png` });
const load = async () => {
  await page.goto(`${BASE}/?scene=${SCENE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
    { timeout: 90000, polling: 500 }, SCENE,
  );
  let calm = 0;
  for (let i = 0; i < 90 && calm < 4; i++) {
    const busy = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      return !!gs.scriptEngine?.isRunning?.() || !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive');
    });
    if (busy) { calm = 0; await page.touchscreen.tap(422, 40); } else calm++;
    await new Promise((r) => setTimeout(r, 700));
  }
  return calm >= 4;
};
if (!(await load())) { console.error('La escena no quedó libre'); process.exit(1); }

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
for (let i = 0; i < 3; i++) await shot();
await page.touchscreen.tap(target.x, target.y);
await new Promise((r) => setTimeout(r, 400));
for (let i = 0; i < 6; i++) await shot();
const ctx = await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.getContextState());

// 2) Plegar el panel (asa superior) y recargar: debe seguir plegado
await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.collapse());
await new Promise((r) => setTimeout(r, 500));
for (let i = 0; i < 3; i++) await shot();
const okReload = await load();
const collapsedAfterReload = await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.collapsed === true);
for (let i = 0; i < 4; i++) await shot();
await page.screenshot({ path: 'demo-verbs-full.png' });
await browser.close();

console.log(`objetivo ${JSON.stringify(target)} · contexto ${JSON.stringify(ctx)} · plegado tras recargar: ${collapsedAfterReload} (escena libre: ${okReload}) · ${n} frames`);
if (ctx.id !== target.id) { console.error('El panel no tomó el objeto tocado como contexto'); process.exit(1); }
if (!ctx.highlighted.includes(target.main)) { console.error(`El verbo principal ${target.main} no quedó resaltado`); process.exit(1); }
if (!collapsedAfterReload) { console.error('El panel plegado no se recordó al recargar'); process.exit(1); }

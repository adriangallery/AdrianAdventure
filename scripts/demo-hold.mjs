// Demo de V6 para Adrián (regla visual): en móvil, TOCAR un objeto = mirarlo y MANTENER PULSADO = su
// acción principal (anillo de progreso de 450 ms). Graba frames PNG que el job de CI convierte en GIF.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-hold.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-hold-frames';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${BASE}/?scene=${SCENE}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  (id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
  { timeout: 90000, polling: 500 }, SCENE,
);

const busy = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return !!gs.scriptEngine?.isRunning?.() || !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive') || (gs.inputCooldownFrames ?? 0) > 0;
});
// Deja la escena libre tocando arriba (zona sin objetos) mientras haya cinemática o diálogo
const settle = async () => {
  for (let i = 0; i < 60 && (await busy()); i++) {
    await page.touchscreen.tap(422, 40);
    await new Promise((r) => setTimeout(r, 700));
  }
  return !(await busy());
};
if (!(await settle())) { console.error('La escena no quedó libre'); process.exit(1); }
await new Promise((r) => setTimeout(r, 600));

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

let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png` });
const film = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await shot(); };

// 1) Tocar = mirar
await film(500);
await page.touchscreen.tap(target.x, target.y);
await film(1800);
const afterTap = await page.evaluate(() => window.__verbs.slice());
if (!(await settle())) { console.error('El diálogo de «mirar» no se cerró'); process.exit(1); }
await film(400);

// 2) Mantener pulsado = acción principal (toque de 700 ms con captura del anillo)
await page.touchscreen.touchStart(target.x, target.y);
await film(700);
await page.touchscreen.touchEnd();
await film(2200);
const afterHold = await page.evaluate(() => window.__verbs.slice());
await page.screenshot({ path: 'demo-hold-full.png' });
await browser.close();

console.log('tras tocar', JSON.stringify(afterTap));
console.log('tras mantener', JSON.stringify(afterHold));
console.log(`${n} frames`);
const tapOk = afterTap.length === 1 && afterTap[0].verb === 'LOOK';
const holdVerbs = afterHold.slice(afterTap.length).map((e) => e.verb);
// La acción puede llegar al instante (TALK/sin alcance) o al terminar de andar
const holdOk = holdVerbs.includes(target.main) && !holdVerbs.includes('LOOK');
if (!tapOk) { console.error('Tocar no disparó LOOK'); process.exit(1); }
if (!holdOk) { console.error(`Mantener no disparó ${target.main}: ${JSON.stringify(holdVerbs)}`); process.exit(1); }

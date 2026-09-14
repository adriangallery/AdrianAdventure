// Demo de V6 para Adrián (regla visual): tras un rato sin avanzar aparece una pista breve y se resalta un
// objeto que aún no se ha tocado. En CI se acorta la espera con ?hintAfter=6 (6 s en vez de 3 min).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-hints.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-hints-frames';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(`${BASE}/?scene=${SCENE}&hintAfter=6`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  (id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
  { timeout: 90000, polling: 500 }, SCENE,
);
const busy = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return !!gs.scriptEngine?.isRunning?.() || !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive');
});
// Pasar la cinemática de entrada (4 comprobaciones libres seguidas)
let calm = 0;
for (let i = 0; i < 90 && calm < 4; i++) {
  if (await busy()) { calm = 0; await page.touchscreen.tap(422, 40); } else calm++;
  await new Promise((r) => setTimeout(r, 700));
}
if (calm < 4) { console.error('La escena no quedó libre'); process.exit(1); }

let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png` });
let hint = null;
const end = Date.now() + 40000;
while (Date.now() < end) {
  await shot();
  hint = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const h = window.__game.registry.get('lastHint');
    return h ? { ...h, blocking: !!gs.registry.get('dialogueShowing'), label: gs.children.list.some((c) => c.name === 'hint-label') } : null;
  });
  if (hint) break;
  await new Promise((r) => setTimeout(r, 400));
}
for (let i = 0; i < 12; i++) { await shot(); await new Promise((r) => setTimeout(r, 250)); }
await page.screenshot({ path: 'demo-hints-full.png' });
await browser.close();
console.log(`pista: ${JSON.stringify(hint)} · ${n} frames`);
if (!hint || !String(hint.text).startsWith('Hint:')) { console.error('No apareció ninguna pista tras la espera'); process.exit(1); }
if (!hint.label) { console.error('La pista no tiene etiqueta en pantalla'); process.exit(1); }
if (hint.blocking) { console.error('La pista bloquea los toques (dialogueShowing)'); process.exit(1); }

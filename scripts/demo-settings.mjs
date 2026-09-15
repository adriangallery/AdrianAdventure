// Demo de V6 para Adrián (regla visual): ajustes en el menú de guardado — velocidad del texto (Slow/Normal/
// Fast/Instant), música on/off y volumen. Verifica que «Instant» enseña el texto completo al momento.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-settings.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-settings-frames';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
if (calm < 4) { console.error('La escena no quedó libre'); process.exit(1); }

let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png` });
for (let i = 0; i < 3; i++) await shot();
// Abrir el menú de guardado (icono del disquete, arriba a la izquierda)
await page.touchscreen.tap(22, 22);
await page.waitForSelector('#save-load-overlay button[data-setting="text-speed"]', { timeout: 15000 });
await shot();
const clickSetting = async (name) => {
  await page.click(`#save-load-overlay button[data-setting="${name}"]`);
  await new Promise((r) => setTimeout(r, 300));
  await shot();
  return page.$eval(`#save-load-overlay button[data-setting="${name}"]`, (b) => b.textContent);
};
const speeds = [];
for (let i = 0; i < 6; i++) {
  speeds.push(await clickSetting('text-speed'));
  if ((await page.evaluate(() => localStorage.getItem('adrian_adventure_text_speed'))) === 'instant') break;
}
const hasVolume = !!(await page.$('#save-load-overlay button[data-setting="volume"]'));
const volume = hasVolume ? await clickSetting('volume') : null;
const stored = await page.evaluate(() => ({ speed: localStorage.getItem('adrian_adventure_text_speed'), volume: localStorage.getItem('adrian_adventure_music_volume') }));
await page.evaluate(() => document.getElementById('save-load-overlay')?.remove());

// Con «Instant», un texto largo debe verse completo a los 120 ms
const MSG = 'Settings check: with instant text speed this whole sentence must appear at once.';
await page.evaluate((m) => window.__game.scene.getScene('UIScene').events.emit('say', m, undefined, () => {}), MSG);
await new Promise((r) => setTimeout(r, 120));
const shown = await page.evaluate((m) => window.__game.scene.getScene('UIScene').children.list.some((c) => c.type === 'Text' && c.text === m), MSG);
for (let i = 0; i < 6; i++) await shot();
await page.screenshot({ path: 'demo-settings-full.png' });
await browser.close();

console.log(`velocidades: ${JSON.stringify(speeds)} · volumen: ${volume} · guardado: ${JSON.stringify(stored)} · texto completo al instante: ${shown} · ${n} frames`);
if (stored.speed !== 'instant') { console.error('La velocidad del texto no se guardó'); process.exit(1); }
if (hasVolume && !stored.volume) { console.error('El volumen no se guardó'); process.exit(1); }
if (!shown) { console.error('Con Instant el texto no apareció completo'); process.exit(1); }

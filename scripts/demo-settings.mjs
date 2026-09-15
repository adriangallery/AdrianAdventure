// Demo de V6 para Adrián (regla visual): ajustes en el menú de guardado — velocidad del texto (Slow/Normal/
// Fast/Instant), música on/off y volumen. Verifica que «Instant» enseña el texto completo al momento.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run settings
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 4 });
const { page } = demo;
await demo.openScene(SCENE);
if (!(await demo.settle())) await demo.fail('La escena no quedó libre');

for (let i = 0; i < 3; i++) await demo.shot();
// Abrir el menú de guardado (icono del disquete, arriba a la izquierda)
await page.touchscreen.tap(22, 22);
await page.waitForSelector('#save-load-overlay button[data-setting="text-speed"]', { timeout: 15000 });
await demo.shot();
const clickSetting = async (name) => {
  await page.click(`#save-load-overlay button[data-setting="${name}"]`);
  await demo.sleep(300);
  await demo.shot();
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
await demo.sleep(120);
const shown = await page.evaluate((m) => window.__game.scene.getScene('UIScene').children.list.some((c) => c.type === 'Text' && c.text === m), MSG);
for (let i = 0; i < 6; i++) await demo.shot();
await demo.still('full');
await demo.end();

console.log(`velocidades: ${JSON.stringify(speeds)} · volumen: ${volume} · guardado: ${JSON.stringify(stored)} · texto completo al instante: ${shown} · ${demo.frames} frames`);
if (stored.speed !== 'instant') await demo.fail('La velocidad del texto no se guardó');
if (hasVolume && !stored.volume) await demo.fail('El volumen no se guardó');
if (!shown) await demo.fail('Con Instant el texto no apareció completo');

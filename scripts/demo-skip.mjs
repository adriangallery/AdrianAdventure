// Demo de V6 para Adrián (regla visual): MANTENER PULSADO durante una cinemática la pasa en avance rápido
// (etiqueta «>> FAST»). Escena `outside` con la premisa de entrada. Graba frames PNG para el GIF de CI.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-skip.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-skip-frames';
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
const state = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return {
    script: !!gs.scriptEngine?.isRunning?.(),
    dialogue: !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive'),
    fast: !!gs.fastForward?.ticker,
  };
});
// Esperar a que arranque la cinemática de entrada
let st;
for (let i = 0; i < 40; i++) { st = await state(); if (st.script) break; await new Promise((r) => setTimeout(r, 250)); }
if (!st.script) { console.error('La escena no empezó con cinemática (¿premisa ya vista?)'); process.exit(1); }

let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png` });
const film = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await shot(); };

await film(1200);
const t0 = Date.now();
await page.touchscreen.touchStart(422, 120);
let sawFast = false;
let done = false;
const end = Date.now() + 25000;
while (Date.now() < end) {
  await shot();
  st = await state();
  sawFast ||= st.fast;
  if (!st.script && !st.dialogue) { done = true; break; }
}
await page.touchscreen.touchEnd();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
await film(1200);
await page.screenshot({ path: 'demo-skip-full.png' });
await browser.close();
console.log(`avance rápido visto: ${sawFast} · cinemática terminada: ${done} en ${secs} s · ${n} frames`);
if (!sawFast) { console.error('No se activó el avance rápido al mantener pulsado'); process.exit(1); }
if (!done) { console.error('La cinemática no terminó manteniendo pulsado 25 s'); process.exit(1); }

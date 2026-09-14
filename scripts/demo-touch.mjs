// Demo de V6 para Adrián (regla visual): toque con el dedo JUSTO FUERA del teclado de la escena
// `outside` (hotspot de 1,9 % de ancho) y resaltado amarillo al pulsar. Genera frames PNG que el job
// de CI convierte en GIF. Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-touch.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = 'demo-frames';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
// Móvil en horizontal con pantalla táctil
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${BASE}/?scene=outside`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'outside',
  { timeout: 90000, polling: 500 },
);
await new Promise((r) => setTimeout(r, 1500));

// Centrar la cámara en el teclado y calcular dónde queda en pantalla
const target = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const hs = gs.registry.get('sceneData').regions.hotspots.find((h) => h.id === 'hs_keypad');
  const cam = gs.cameras.main;
  const a = gs.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
  const b = gs.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
  cam.stopFollow();
  cam.scrollX = Math.max(0, (a.x + b.x) / 2 - cam.width / 2);
  return { left: a.x - cam.scrollX, right: b.x - cam.scrollX, top: a.y - cam.scrollY, bottom: b.y - cam.scrollY, w: cam.width, h: cam.height };
});
console.log('teclado en pantalla', target);
await new Promise((r) => setTimeout(r, 400));

const clip = {
  x: Math.max(0, Math.round(target.left - 120)),
  y: Math.max(0, Math.round(target.top - 60)),
  width: 260,
  height: Math.round(target.bottom - target.top + 120),
};
let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png`, clip });
const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await shot(); };

await hold(600);
// Toque 12 px a la derecha del borde del teclado: fuera del rectángulo, dentro del margen de 22 px
const tapX = Math.round(target.right + 12);
const tapY = Math.round((target.top + target.bottom) / 2);
await page.touchscreen.tap(tapX, tapY);
const flashed = await page.evaluate(() =>
  window.__game.scene.getScene('GameScene').children.list.some((c) => c.type === 'Graphics' && c.depth === 50),
);
await hold(900);
console.log(`toque en (${tapX}, ${tapY}) · resaltado visible: ${flashed} · ${n} frames`);
await page.screenshot({ path: 'demo-full.png' });
await browser.close();
if (!flashed) { console.error('El toque junto al teclado no resaltó el hotspot'); process.exit(1); }

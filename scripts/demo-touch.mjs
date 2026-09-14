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
// Esperar a que la escena esté libre: sin script de entrada, sin diálogo y sin cooldown de input.
// Si hay un diálogo abierto se toca el centro para avanzarlo (como haría el jugador).
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return {
      script: !!gs.scriptEngine?.isRunning?.(),
      dialogue: !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive'),
      cooldown: gs.inputCooldownFrames ?? 0,
    };
  });
  if (!st.script && !st.dialogue && st.cooldown <= 0) break;
  // Cinemática de entrada («click to continue») o diálogo: tocar para avanzar, como el jugador
  if (st.script || st.dialogue) await page.touchscreen.tap(422, 120);
  await new Promise((r) => setTimeout(r, 700));
}
const idle = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return !gs.scriptEngine?.isRunning?.() && !gs.registry.get('dialogueShowing') && !gs.registry.get('dialogueActive');
});
if (!idle) { console.error('La escena no quedó libre tras pasar la cinemática'); process.exit(1); }
await new Promise((r) => setTimeout(r, 800));

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
console.log('teclado en pantalla', JSON.stringify(target));
await new Promise((r) => setTimeout(r, 400));

const clip = {
  x: Math.max(0, Math.round(target.left - 120)),
  y: Math.max(0, Math.round(target.top - 60)),
  width: 260,
  height: Math.round(target.bottom - target.top + 120),
};
// Registrar lo que Phaser recibe del toque, para diagnosticar si falla
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  gs.input.on('pointerdown', (p) => { window.__lastTap = { wasTouch: p.wasTouch, x: Math.round(p.x), y: Math.round(p.y) }; });
});
let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/${String(n++).padStart(3, '0')}.png`, clip });
const hold = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await shot(); };

await hold(600);
// Toque 12 px a la derecha del borde del teclado: fuera del rectángulo, dentro del margen de 22 px
const tapX = Math.round(target.right + 12);
const tapY = Math.round((target.top + target.bottom) / 2);
await page.touchscreen.tap(tapX, tapY);
const diag = await page.evaluate(([tx, ty]) => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  const pct = gs.coordSystem.screenToPct(tx + cam.scrollX, ty + cam.scrollY);
  const o = gs.coordSystem.pctToScreen(0, 0);
  const f = gs.coordSystem.pctToScreen(100, 100);
  const pad = { x: (22 / (f.x - o.x)) * 100, y: (22 / (f.y - o.y)) * 100 };
  const near = gs.sceneDataLoader.getHotspotNearPct?.(pct.x, pct.y, pad.x, pad.y)?.id ?? null;
  return {
    flashed: gs.children.list.some((c) => c.type === 'Graphics' && c.depth === 50),
    lastTap: window.__lastTap ?? null,
    panelTop: gs.scale.height - (gs.getEffectivePanelHeight?.() ?? 0),
    pct: { x: +pct.x.toFixed(2), y: +pct.y.toFixed(2) },
    pad: { x: +pad.x.toFixed(2), y: +pad.y.toFixed(2) },
    near,
    script: !!gs.scriptEngine?.isRunning?.(),
    dialogue: !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive'),
  };
}, [tapX, tapY]);
console.log('diagnóstico', JSON.stringify(diag));
const flashed = diag.flashed;
await hold(900);
console.log(`toque en (${tapX}, ${tapY}) · resaltado visible: ${flashed} · ${n} frames`);
await page.screenshot({ path: 'demo-full.png' });
await browser.close();
if (!flashed) { console.error('El toque junto al teclado no resaltó el hotspot'); process.exit(1); }

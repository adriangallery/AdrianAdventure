// Demo de V6 para Adrián (regla visual): al entrar en una escena aparece «AUTOSAVED» y, al volver a la
// portada, «Continue» enseña la escena y cuándo se guardó. Graba frames PNG que el CI convierte en GIF.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/demo-autosave.mjs
import { mkdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SCENE = process.env.DEMO_SCENE || 'outside';
const OUT = 'demo-autosave-frames';
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

// 1) Escena: pasar la cinemática de entrada y ver el aviso
await page.goto(`${BASE}/?scene=${SCENE}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  (id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
  { timeout: 90000, polling: 500 }, SCENE,
);
let seen = false;
const end = Date.now() + 40000;
while (Date.now() < end && !seen) {
  const st = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const label = gs.children.list.find((c) => c.name === 'autosave-indicator');
    return {
      busy: !!gs.scriptEngine?.isRunning?.() || !!gs.registry.get('dialogueShowing'),
      label: !!label && label.alpha > 0.5,
    };
  });
  await shot();
  if (st.label) seen = true;
  else if (st.busy) await page.touchscreen.tap(422, 40);
  await new Promise((r) => setTimeout(r, 300));
}
for (let i = 0; i < 6; i++) await shot();
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('adrian_adventure_save') || '{}')[0] ?? null);

// 2) Portada: «Continue» con la escena y la hora
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), { timeout: 90000, polling: 500 });
await new Promise((r) => setTimeout(r, 1500));
const menu = await page.evaluate(() => {
  const ms = window.__game.scene.getScene('MenuScene');
  const texts = ms.children.list.filter((c) => c.type === 'Text').map((c) => c.text);
  return { hasContinue: texts.some((t) => t.includes('Continue')), detail: ms.children.list.find((c) => c.name === 'continue-detail')?.text ?? null };
});
for (let i = 0; i < 10; i++) await shot();
await page.screenshot({ path: 'demo-autosave-menu.png' });
await browser.close();

console.log(`aviso visto: ${seen} · autoguardado: ${saved ? saved.sceneName : 'no'} · portada: ${JSON.stringify(menu)} · ${n} frames`);
if (!seen) { console.error('No apareció AUTOSAVED'); process.exit(1); }
if (!saved) { console.error('No hay autoguardado en localStorage'); process.exit(1); }
if (!menu.hasContinue || !menu.detail || !menu.detail.includes(saved.sceneName)) { console.error('La portada no enseña Continue con la escena guardada'); process.exit(1); }

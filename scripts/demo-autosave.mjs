// Demo de V6 para Adrián (regla visual): al entrar en una escena aparece «AUTOSAVED» y, al volver a la
// portada, «Continue» enseña la escena y cuándo se guardó.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run autosave
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;

// 1) Escena: pasar la cinemática de entrada y ver el aviso
await demo.openScene(SCENE);
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
  await demo.shot();
  if (st.label) seen = true;
  else if (st.busy) await page.touchscreen.tap(422, 40);
  await demo.sleep(300);
}
for (let i = 0; i < 6; i++) await demo.shot();
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('adrian_adventure_save') || '{}')[0] ?? null);

// 2) Portada: «Continue» con la escena y la hora
await page.goto(`${demo.base}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), { timeout: 90000, polling: 500 });
await demo.sleep(1500);
const menu = await page.evaluate(() => {
  const ms = window.__game.scene.getScene('MenuScene');
  const texts = ms.children.list.filter((c) => c.type === 'Text').map((c) => c.text);
  return { hasContinue: texts.some((t) => t.includes('Continue')), detail: ms.children.list.find((c) => c.name === 'continue-detail')?.text ?? null };
});
for (let i = 0; i < 10; i++) await demo.shot();
await demo.still('menu');
await demo.end();

console.log(`aviso visto: ${seen} · autoguardado: ${saved ? saved.sceneName : 'no'} · portada: ${JSON.stringify(menu)} · ${demo.frames} frames`);
if (!seen) await demo.fail('No apareció AUTOSAVED');
if (!saved) await demo.fail('No hay autoguardado en localStorage');
if (!menu.hasContinue || !menu.detail || !menu.detail.includes(saved.sceneName)) await demo.fail('La portada no enseña Continue con la escena guardada');

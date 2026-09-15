// Demo de V6 para Adrián (regla visual): MANTENER PULSADO durante una cinemática la pasa en avance rápido
// (etiqueta «>> FAST»). Escena `outside` con la premisa de entrada.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run skip
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 12 });
const { page } = demo;
await demo.openScene(SCENE);
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
for (let i = 0; i < 40; i++) { st = await state(); if (st.script) break; await demo.sleep(250); }
if (!st.script) await demo.fail('La escena no empezó con cinemática (¿premisa ya vista?)');

await demo.film(1200);
const t0 = Date.now();
await page.touchscreen.touchStart(422, 120);
let sawFast = false;
let done = false;
const end = Date.now() + 25000;
while (Date.now() < end) {
  await demo.shot();
  st = await state();
  sawFast ||= st.fast;
  if (!st.script && !st.dialogue) { done = true; break; }
}
await page.touchscreen.touchEnd();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
await demo.film(1200);
await demo.still('full');
await demo.end();
console.log(`avance rápido visto: ${sawFast} · cinemática terminada: ${done} en ${secs} s · ${demo.frames} frames`);
if (!sawFast) await demo.fail('No se activó el avance rápido al mantener pulsado');
if (!done) await demo.fail('La cinemática no terminó manteniendo pulsado 25 s');

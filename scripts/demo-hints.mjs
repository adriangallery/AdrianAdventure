// Demo de V6 para Adrián (regla visual): tras un rato sin avanzar aparece una pista breve y se resalta un
// objeto que aún no se ha tocado. En CI se acorta la espera con ?hintAfter=6 (6 s en vez de 3 min).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run hints
import { startDemo } from './lib/demo.mjs';

const SCENE = process.env.DEMO_SCENE || 'outside';
const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
await demo.openScene(SCENE, '&hintAfter=6');
// Pasar la cinemática de entrada (4 comprobaciones libres seguidas)
if (!(await demo.settle())) await demo.fail('La escena no quedó libre');

let hint = null;
const end = Date.now() + 40000;
while (Date.now() < end) {
  await demo.shot();
  hint = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const h = window.__game.registry.get('lastHint');
    return h ? { ...h, blocking: !!gs.registry.get('dialogueShowing'), label: gs.children.list.some((c) => c.name === 'hint-label') } : null;
  });
  if (hint) break;
  await demo.sleep(400);
}
for (let i = 0; i < 12; i++) { await demo.shot(); await demo.sleep(250); }
await demo.still('full');
await demo.end();
console.log(`pista: ${JSON.stringify(hint)} · ${demo.frames} frames`);
if (!hint || !String(hint.text).startsWith('Hint:')) await demo.fail('No apareció ninguna pista tras la espera');
if (!hint.label) await demo.fail('La pista no tiene etiqueta en pantalla');
if (hint.blocking) await demo.fail('La pista bloquea los toques (dialogueShowing)');

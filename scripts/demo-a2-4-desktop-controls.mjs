// Demo de A2.4 (plan SCUMM): controles de escritorio en el lobby (?qa=1), con viewport de escritorio (1280x720, ratón,
// sin pantalla táctil) y teclado y ratón reales de Chrome:
//   1) Esc salta la narrativa y el título del capítulo 2 de la entrada;
//   2) mantener Tab resalta los hotspots y la recepcionista (contorno y nombre) y al soltar se quita;
//   3) clic derecho en la recepcionista: anda hasta ella y empieza a hablar (verbo por defecto de una NPC: TALK).
// Comprueba por la API de QA que Tab resaltó la puerta y la recepcionista, que al soltar no queda nada y que el
// clic derecho fue TALK sobre npc_receptionist; en el panel se ven las letras de los atajos junto a cada verbo.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-4-desktop-controls
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 8, width: 800, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: false } });
const { page, sleep } = demo;
const problems = [];

const busy = () => page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  return !!gs.scriptEngine?.isRunning?.() || !!g.registry.get('dialogueShowing') || g.registry.get('cinematicActive') > 0;
});

await demo.openScene('lobby');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
await page.waitForFunction(() => window.__game.registry.get('cinematicActive') > 0, { timeout: 20000, polling: 100 }).catch(() => {});
await demo.film(1200);
// 1) Esc: salta la entrada (y cualquier texto que quede) sin tocar la pantalla
for (let i = 0; i < 20 && (await busy()); i++) {
  await page.keyboard.press('Escape');
  for (let k = 0; k < 6; k++) await demo.shot();
}
if (await busy()) problems.push('Esc no dejó el lobby libre');
await sleep(400);
await demo.film(600);

// 2) Tab mantenido
await page.keyboard.down('Tab');
await sleep(150);
const lit = await page.evaluate(() => window.__qa.state().highlightedHotspots);
await demo.film(1800);
await demo.still('tab');
await page.keyboard.up('Tab');
const unlit = await page.evaluate(() => window.__qa.state().highlightedHotspots);
if (!lit.includes('hs_frontdoor') || !lit.includes('npc_receptionist')) problems.push(`Tab no resaltó la puerta y la recepcionista: ${lit.join(', ')}`);
if (unlit.length) problems.push(`al soltar Tab siguen resaltados: ${unlit.join(', ')}`);
const hints = await page.evaluate(() => window.__qa.state().verbKeyHints);
console.log(`Tab: ${lit.length} resaltados · letras de atajos en el panel: ${hints.length ? hints.join(', ') : 'ninguna (sin puntero fino)'}`);
await demo.film(500);

// 3) Clic derecho en la recepcionista (centro de su sprite en píxeles de página)
const npc = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const n = gs.npcs.find((x) => x.npcId === 'npc_receptionist');
  const m = n.getWorldTransformMatrix();
  const r = g.canvas.getBoundingClientRect();
  const cam = gs.cameras.main;
  return { x: r.left + m.tx - cam.scrollX, y: r.top + m.ty - (n.height * n.scale) / 2 - cam.scrollY };
});
await page.mouse.click(npc.x, npc.y, { button: 'right' });
const t0 = Date.now();
while (Date.now() - t0 < 8000) {
  await demo.shot();
  if (await page.evaluate(() => !!window.__game.registry.get('dialogueActive'))) break;
}
await demo.film(1500);
const wt = await page.evaluate(() => window.__qa.state().walkTarget);
if (wt?.target !== 'npc_receptionist' || wt?.verb !== 'TALK') problems.push(`clic derecho en la recepcionista: ${JSON.stringify(wt)}, se esperaba TALK`);
if (!(await page.evaluate(() => !!window.__game.registry.get('dialogueActive')))) problems.push('el clic derecho no abrió el diálogo de la recepcionista');
await demo.still('full');
await demo.end();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('OK: Esc salta la entrada, Tab resalta y se quita al soltar, clic derecho en la NPC = hablar');

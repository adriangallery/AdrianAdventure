// Demo de A2.17 fase 3 (plan SCUMM): trozos del primer plano con máscara y walk-behind, en 844x390 (móvil apaisado).
//   1. outside: Dex anda por DETRÁS del arbusto grande (pies en y 91,5 < base 93: le tapa las piernas), sale por
//      delante (y 96) y pasa por detrás del arbusto pequeño del porche (pies en y 93 < base 97,3).
//   2. mountain: Dex delante de las rocas pero DETRÁS de la maleza (pies en y 93: base de las rocas 89,5, de la maleza
//      97), delante de todo (y 98) y detrás de las rocas (x 81, y 88).
// En cada parada comprueba, con la profundidad real de los objetos de Phaser, que Dex queda por encima o por debajo de
// cada trozo según la y de sus pies, y que los trozos con máscara existen (textura `fglayer_*`). Capturas fijas de cada
// parada; el GIF es el paseo. «problemas: ninguno» si todo sale.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-17-fase3
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const LANDSCAPE = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: LANDSCAPE });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

/** Trozos del primer plano de la escena (id, profundidad, si es de máscara) y profundidad y pies de Dex */
const layersState = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const sd = window.__game.registry.get('sceneData');
  const defs = sd?.foregroundLayers ?? [];
  const layers = (gs.fgLayers || []).map((l, i) => ({ id: defs[i]?.id, depth: l.img.depth, masked: !!l.bounds, texture: l.img.texture.key }));
  return { layers, dex: { depth: gs.player.depth, x: Math.round(gs.player.pctX * 10) / 10, y: Math.round(gs.player.pctY * 10) / 10 } };
});

async function open(scene) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(LANDSCAPE.width / 2), 40] }))) problems.push(`${scene}: la escena no quedó libre`);
}

/** Anda a (x, y) grabando fotogramas mientras dura el paseo */
async function walk(x, y) {
  await page.evaluate((x, y) => { window.__demoWalkDone = false; window.__qa.walk(x, y).finally(() => { window.__demoWalkDone = true; }); }, x, y);
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await demo.shot();
    if (await page.evaluate(() => window.__demoWalkDone)) break;
    await demo.sleep(150);
  }
}

/** Comprueba que Dex queda detrás (`behind`) o delante (`front`) de cada trozo */
async function expectAt(scene, label, expect) {
  await demo.sleep(500);
  const st = await layersState();
  await demo.still(`${scene}-${label}`);
  for (let i = 0; i < 4; i++) await demo.shot();
  for (const [id, want] of Object.entries(expect)) {
    const l = st.layers.find((x) => x.id === id);
    if (!l) { problems.push(`${scene} ${label}: no está el trozo ${id}`); continue; }
    const got = st.dex.depth < l.depth ? 'behind' : 'front';
    if (got !== want) problems.push(`${scene} ${label}: Dex (pies ${st.dex.x}, ${st.dex.y}) queda ${got} de ${id} y debía quedar ${want}`);
  }
  report.push({ scene, label, dex: st.dex, layers: st.layers });
  console.log(`${scene} ${label}: Dex ${JSON.stringify(st.dex)} · ${st.layers.map((l) => `${l.id}@${l.depth.toFixed(3)}${l.masked ? ' (máscara)' : ''}`).join(', ')}`);
}

// 1) outside: por detrás del arbusto grande, por delante, y por detrás del pequeño
await open('outside');
{
  const st = await layersState();
  for (const id of ['bush_left', 'bush_right']) {
    const l = st.layers.find((x) => x.id === id);
    if (!l?.masked || !String(l.texture).startsWith('fglayer_')) problems.push(`outside: el trozo ${id} no tiene su textura con máscara (${JSON.stringify(l)})`);
  }
}
await walk(30, 97);
await walk(16, 91.5);
await expectAt('outside', 'detras-arbusto', { bush_left: 'behind', bush_right: 'behind' });
await walk(13, 96.5);
await expectAt('outside', 'delante-arbusto', { bush_left: 'front' });
await walk(22, 93);
await expectAt('outside', 'detras-arbusto-porche', { bush_left: 'front', bush_right: 'behind' });
await walk(24, 99);
await expectAt('outside', 'delante-de-todo', { bush_left: 'front', bush_right: 'front' });

// 2) mountain: entre las rocas y la maleza, delante de todo y detrás de las rocas
await open('mountain');
{
  const l = (await layersState()).layers.find((x) => x.id === 'maleza');
  if (!l?.masked) problems.push(`mountain: la maleza no tiene su textura con máscara (${JSON.stringify(l)})`);
}
await walk(91, 93);
await expectAt('mountain', 'entre-rocas-y-maleza', { rocks_right: 'front', maleza: 'behind' });
await walk(91, 98);
await expectAt('mountain', 'delante-de-todo', { rocks_right: 'front', maleza: 'front' });
await walk(81, 88);
await expectAt('mountain', 'detras-de-las-rocas', { rocks_right: 'behind', maleza: 'behind' });

await demo.end();
writeFileSync(join(demo.dir, 'fase3.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

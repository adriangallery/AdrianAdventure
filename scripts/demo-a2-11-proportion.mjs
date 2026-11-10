// Demo de A2.11 (plan SCUMM): proporción de Dex al estilo SCUMM en todas las escenas.
// En 844x390 (móvil apaisado, el juego es mobile-first), con ?qa=1, para cada escena de qa/proportion-refs.json:
//   - pone a Dex (teleportPct) en el fondo, en medio y delante de la zona andable, en un segundo punto a la misma y
//     (sameDepth) y junto a la puerta o el mueble de referencia, y saca una captura en cada sitio;
//   - lee `state().pixel` (alto del mundo y en pantalla, escala base, factor de profundidad, escala de cada NPC);
//   - mide (scripts/lib/proportion.mjs): alto de Dex en % del fondo, alto de la referencia, cociente Dex/referencia
//     (puerta: 0,80-1,05), alto relativo a la zona jugable, NPC a la misma profundidad (±10 %), dos sitios a la
//     misma profundidad (≤ 20 %) y grupos de escenas contiguas (plano delantero ≤ 20 %);
//   - comprueba que la medida del juego coincide con la analítica (±2 %): la tabla de docs/progreso/A2.11.md sale de
//     `node scripts/lib/proportion.mjs table`.
// Falla (exit 1) si alguna escena queda fuera, salvo las excepciones razonadas del JSON.
// Capturas: `<escena>-<sitio>.png` (Dex junto a la referencia: `<escena>-ref.png`) y la tabla en proportion.md/.json.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-11-proportion
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';
import { loadRefs, loadScene, loadGlobal, evaluateScene, groupProblems, depthFactor, markdownTable, evaluateAll } from './lib/proportion.mjs';

const VP = { width: 844, height: 390, isMobile: true, hasTouch: true };
const demo = await startDemo(import.meta.url, { fps: 2, width: 640, viewport: VP });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const refs = loadRefs();
const global = loadGlobal();
const rows = [];
const raw = [];

const pixel = () => page.evaluate(() => window.__qa.state().pixel);

async function open(scene) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(VP.width / 2), 40] }))) problems.push(`${scene}: la escena no quedó libre`);
}

/** Pone a Dex con los pies en (x, y) %, espera a la cámara y lee la escala. */
async function place(x, y) {
  await page.evaluate((x, y) => {
    const gs = window.__game.scene.getScene('GameScene');
    gs.player.teleportPct(x, y);
    gs.player.setVisible(true);
  }, x, y);
  await demo.sleep(900);
  return pixel();
}

for (const ref of refs.scenes) {
  if (ref.skipDemo) {
    console.log(`${ref.scene}: no se mide en la demo (${ref.exception})`);
    continue;
  }
  const scene = loadScene(ref.scene);
  try {
    await open(ref.scene);
  } catch (e) {
    problems.push(`${ref.scene}: no abre: ${e?.message || e}`);
    continue;
  }
  const measured = {};
  let npcMeasures = null;
  for (const [k, p] of Object.entries(ref.positions || {})) {
    const px = await place(p.x, p.y);
    if (!px) { problems.push(`${ref.scene} ${k}: sin state().pixel`); continue; }
    measured[k] = px.worldHeightPct;
    raw.push({ scene: ref.scene, at: k, x: p.x, y: p.y, ...px });
    await demo.still(`${ref.scene}-${k}`);
    await demo.shot();
    // NPC: escala real frente a la base del jugador × el factor de profundidad en la y de cada NPC (misma unidad)
    if (!npcMeasures && px.npcs?.length) {
      npcMeasures = {};
      for (const n of scene.npcs || []) {
        const q = px.npcs.find((m) => m.id === n.id);
        if (!q) { problems.push(`${ref.scene}: no está ${n.id}`); continue; }
        const want = px.playerBase * depthFactor(scene.depthScale, n.position?.y ?? 100) * (n.artScale ?? 1);
        // evaluateScene compara got / (pixelScale × factor × artScale): se pasa en la misma unidad
        npcMeasures[n.id] = (q.scale / want) * px.pixelScale * depthFactor(scene.depthScale, n.position?.y ?? 100) * (n.artScale ?? 1);
      }
    }
  }
  // Lo medido en el juego tiene que coincidir con lo analítico (si no, la tabla del doc no vale)
  const ana = evaluateScene(ref, scene, global);
  for (const [k, h] of Object.entries(measured)) {
    const a = ana.row.dex[k];
    if (typeof h !== 'number' || Math.abs(h - a) / a > 0.02) problems.push(`${ref.scene} ${k}: el juego mide ${h} % y el cálculo ${a} %`);
  }
  const { row, problems: p } = evaluateScene(ref, scene, global, (y, x, k) => measured[k] ?? NaN, npcMeasures);
  row.refLabel = ref.reference?.label;
  row.screen = Object.fromEntries(raw.filter((r) => r.scene === ref.scene).map((r) => [r.at, r.playerHeightPct]));
  rows.push(row);
  problems.push(...p);
  console.log(`${ref.scene}: Dex ${JSON.stringify(row.dex)} (pantalla ${JSON.stringify(row.screen)}) · ref ${row.refHeight} % · Dex/ref ${row.ratio}${row.exception ? ' (excepción)' : ''}${row.npcs.length ? ` · NPC ${JSON.stringify(row.npcs)}` : ''}`);
}
problems.push(...groupProblems(refs.groups, rows));

await demo.end();
let before = null;
try { before = evaluateAll(refs, { rev: 'origin/main' }).rows; } catch { /* sin historia de git en el runner: solo «después» */ }
const md = markdownTable(before || [], rows);
writeFileSync(join(demo.dir, 'proportion.md'), `${md}\n`);
writeFileSync(join(demo.dir, 'proportion.json'), JSON.stringify({ rows, raw }, null, 2));
console.log(md);
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

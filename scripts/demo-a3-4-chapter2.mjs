// Demo de A3.4d/A3.4e (regla visual del plan SCUMM): el final del capítulo 2 y la cadena opcional de Fernando, en un
// solo viewport (844x390, móvil apaisado) y CORTA (objetivo ≤ 90 s y GIF ≤ 15 MB: 4 fps, 560 px, frases a ritmo rápido y andar a ×3).
// Empieza en `upstairs` (?qa=1) con lo de antes ya hecho por __qa.runScript (keycard ya pasada por el lector,
// terminal_key, veleta girada y la lata de BULL RUN), y a ritmo de jugador (un toque por frase):
//   1) bebida energética en el mining rig: «Its liquid cooling gurgles...» → empty_can (has_empty_can);
//   2) USE escotilla del techo → azotea; LOOK parabólica («...The best-funded birdbath in the city.»);
//   3) lata vacía en la parabólica → rainwater_can (has_rainwater);
//   4) terminal_key en la escotilla (último cierre): «Three locks. Adrian trusts nobody...» y Dex baja (chapter_2_complete);
//   5) del sótano al lobby; lluvia en Fernando: Penny «He's tipping you...» → golden_token (plant_watered);
//   6) al piso de arriba; token en el mining rig → Founder Mode (founder_mode).
// Comprueba por `state()` flags, inventario y escena, y que se vieron las frases clave. Capturas: `gurgle.png`,
// `birdbath.png`, `bajada.png`, `fernando.png`, `founder.png`, `final.png`. Duración total en `chapter2.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-4-chapter2
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 4, width: 560 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const bad = (m) => problems.push(m);
const report = { views: [] };

const qaState = () => page.evaluate(() => window.__qa.state());
const KEY = /^(has_empty_can|has_rainwater|plant_watered|plant_revived|founder_mode|hatch_|basement_unlocked|chapter_2_complete)/;
const flagsOf = (st) => Object.fromEntries(Object.entries(st.flags).filter(([k]) => KEY.test(k)));

/** Lo que hay en pantalla: texto (y quién), elección pendiente y si el juego está ocupado. */
const probe = () => page.evaluate(() => {
  const st = window.__qa.state();
  return { text: st.speech?.text ?? null, speaker: st.speech?.speaker ?? null, choices: st.choices ? st.choices.map((c) => c.text) : null, busy: (st.busy ?? []).length > 0, scene: st.scene };
});

/** Empieza una acción como un clic real (verbo, objeto del inventario y toque en el hotspot), sin cerrar textos. */
function start(verb, target, item = null) {
  return page.evaluate((verb, target, item) => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const panel = g.scene.getScene('UIScene').getScummUI();
    panel.clearSelectedItem();
    if (panel.getSelectedVerb() !== verb) panel.selectVerb(verb);
    if (item && (!panel.clickInventoryItem(item) || panel.getSelectedItem()?.id !== item)) return `no se pudo elegir ${item}`;
    const hs = g.registry.get('sceneData').regions.hotspots.find((h) => h.id === target);
    if (!hs) return `no hay ${target}`;
    return gs.qaTapHotspot(hs) ?? null;
  }, verb, target, item);
}

/** Elige en el panel de opciones la primera que contenga `want` (sin mayúsculas). */
const choose = (want) => page.evaluate((want) => {
  const cp = window.__game.scene.getScene('UIScene').getChoicePanel();
  const idx = cp.getOptions().findIndex((o) => o.text.toLowerCase().includes(want.toLowerCase()));
  return idx >= 0 && cp.choose(idx) ? null : `no se pudo elegir «${want}»`;
}, want);

/** Sigue las frases y las opciones hasta que el juego queda libre: un fotograma por frase, un toque para pasar. */
async function follow(view, stills, choices = []) {
  const queue = [...choices];
  const seen = [];
  let lastText = null;
  let calm = 0;
  let busyTick = 0;
  let lastTapAt = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && calm < 6) {
    const r = await probe();
    if (r.choices) {
      calm = 0;
      await demo.film(600);
      const want = queue.shift();
      if (want === undefined) { bad(`${view}: opciones sin respuesta prevista (${r.choices.join(' | ')})`); break; }
      const err = await choose(want);
      if (err) { bad(`${view}: ${err} entre ${r.choices.join(' | ')}`); break; }
      seen.push({ speaker: '>', text: want });
      lastText = null;
      await demo.sleep(300);
      continue;
    }
    if (r.text && r.text !== lastText) {
      calm = 0;
      lastText = r.text;
      seen.push({ speaker: r.speaker, text: r.text });
      for (const [re, label] of stills) if (re.test(r.text)) await demo.still(`${view}-${label}`);
      await demo.film(Math.min(2000, Math.max(900, r.text.length * 25)));
      await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
      lastTapAt = Date.now();
      await demo.sleep(250);
      continue;
    }
    // Andar y transiciones a ×3 (un fotograma de cada tres): la demo tiene que quedarse en ≤ 90 s
    // Si el toque cayó con la frase aún escribiéndose (la completa en vez de pasarla), otro toque
    if (r.text && Date.now() - lastTapAt > 1500) { await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap()); lastTapAt = Date.now(); }
    if (r.text || r.busy) { calm = 0; if (busyTick++ % 3 === 0) await demo.shot(); await demo.sleep(150); continue; }
    lastText = null;
    calm++;
    await demo.sleep(200);
  }
  return seen;
}

const has = (s, ...ids) => ids.every((i) => s.inventory.includes(i));
const T0 = Date.now();
const view = { id: '844x390', tap: [422, 40] };
await demo.openScene('upstairs');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: view.tap }))) await demo.fail('upstairs no quedó libre al entrar');
await page.evaluate(() => window.__qa.runScript([
  { op: 'setFlag', flag: 'chapter_1_complete', value: true },
  { op: 'setFlag', flag: 'found_keycard', value: true },
  { op: 'setFlag', flag: 'has_keycard', value: true },
  { op: 'addItem', id: 'keycard', name: 'Keycard' },
  { op: 'setFlag', flag: 'found_terminal_key', value: true },
  { op: 'addItem', id: 'terminal_key', name: 'Trading Terminal Key' },
  { op: 'setFlag', flag: 'vane_greased', value: true },
  { op: 'setFlag', flag: 'vane_turned', value: true },
  { op: 'setFlag', flag: 'hatch_reader_ok', value: true },
  { op: 'setFlag', flag: 'has_energy_drink', value: true },
  { op: 'addItem', id: 'energy_drink', name: 'Energy Drink' },
]));
const v = { view: view.id, steps: [] };
report.views.push(v);

// [etiqueta, qué, acción, capturas, comprobación del estado, frase obligatoria]
const steps = [
  ['rig', 'bebida energética en el mining rig', () => start('USE', 'hs_computer', 'energy_drink'),
    [[/gurgles/, 'gurgle']], (s) => has(s, 'empty_can') && !has(s, 'energy_drink') && s.flags.has_empty_can, /been waiting for this/],
  ['azotea', 'USE escotilla del techo → azotea', () => start('USE', 'hs_roof_hatch'), [], (s) => s.scene === 'rooftop', null],
  ['parabolica', 'LOOK parabólica', () => start('LOOK', 'hs_satellite_dish'),
    [[/birdbath/, 'birdbath']], (s) => s.scene === 'rooftop', /best-funded birdbath/],
  ['lluvia', 'lata vacía en la parabólica', () => start('USE', 'hs_satellite_dish', 'empty_can'),
    [], (s) => has(s, 'rainwater_can') && !has(s, 'empty_can') && s.flags.has_rainwater, /Artisanal/],
  ['bajada', 'terminal_key en la escotilla: abre y baja (fin del capítulo 2)', () => start('USE', 'hs_roof_access_panel', 'terminal_key'),
    [[/Including, apparently, Adrian/, 'bajada']],
    (s) => s.scene === 'basement' && s.flags.basement_unlocked && s.flags.chapter_2_complete, /Including, apparently, Adrian/],
  ['lobby', 'escaleras del sótano → lobby', () => start('USE', 'hs_stairs'), [], (s) => s.scene === 'lobby', null],
  ['fernando', 'lluvia en Fernando', () => start('USE', 'hs_plant', 'rainwater_can'),
    [[/tips people he likes/, 'fernando']], (s) => has(s, 'golden_token') && s.flags.plant_watered && s.flags.plant_revived, /only tips people he likes/],
  ['arriba', 'escaleras → piso de arriba', () => start('USE', 'hs_stairs_up'), [], (s) => s.scene === 'upstairs', null],
  ['founder', 'Golden Token en el mining rig', () => start('USE', 'hs_computer', 'golden_token'),
    [[/FOUNDER MODE/, 'founder']], (s) => s.flags.founder_mode && !has(s, 'golden_token'), /FOUNDER MODE/],
];
for (const [tag, what, act, stills, ok, line] of steps) {
  await demo.film(150);
  const err = await act();
  if (err) { bad(`${what}: ${err}`); break; }
  const seen = await follow(view.id, stills.map(([re, label]) => [re, label]), []);
  // Al bajar, la apertura del capítulo 3 se pasa con toques antes de seguir
  if (tag === 'bajada') await demo.settle({ tap: view.tap });
  const st = await qaState();
  v.steps.push({ tag, what, seen, scene: st.scene, flags: flagsOf(st), inventory: st.inventory });
  console.log(`${what}: ${seen.map((x) => `${x.speaker ?? 'Dex'}: «${x.text}»`).join(' / ')} · ${st.scene} ${JSON.stringify(flagsOf(st))}`);
  if (line && !seen.some((x) => line.test(x.text))) bad(`${what}: no se vio la frase ${line}`);
  if (!ok(st)) bad(`${what}: estado inesperado (${st.scene}, ${JSON.stringify(flagsOf(st))}, inventario ${st.inventory.join(', ')})`);
}
await demo.settle({ tap: view.tap });
await demo.still('final');
report.seconds = Math.round((Date.now() - T0) / 1000);
console.log(`Duración de la grabación: ${report.seconds} s`);

await demo.end();
writeFileSync(join(demo.dir, 'chapter2.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Final del capítulo 2 (escotilla) y cadena de Fernando hasta Founder Mode, en 844x390');

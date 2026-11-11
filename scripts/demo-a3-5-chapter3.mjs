// Demo de A3.5d (regla visual del plan SCUMM): el capítulo 3 «Below the Surface» entero, en un solo viewport
// (844x390, móvil apaisado) y CORTA (objetivo < 120 s: 4 fps, 560 px, frases a ritmo rápido y andar a ×3).
// Empieza en `basement` (?qa=1) con lo de los capítulos 1 y 2 puesto por __qa.runScript (knows_gerald, Ledger,
// boli de Mt. Gox y antena) y juega a ritmo de jugador (un toque por frase):
//   1) mesa: disquete + papel en blanco; 2) rack → server_room; suelo técnico: alargador y gafas 3D;
//   3) TALK terminal: PZ-BOT pide alfa; papel + boli = fake_alpha; alfa al terminal: «GERALD. GERALD. ALL IN.» → log;
//   4) antena en el cristal; interruptor: «RUNNING ON BATTERY. 4 %. STILL BULLISH.» (coords_known);
//   5) a pie al sótano; alargador en el CRT («It smells like 1997.»); Ledger: «7314» y el cumpleaños de Gerald;
//   6) disquete → printout («Very useless.»); printout + boli → marked_map y chapter_3_complete.
// Comprueba por `state()` flags, inventario y escena, y que se vieron las frases clave. Capturas: `suelo.png`,
// `pzbot.png`, `crash.png`, `bateria.png`, `pin.png`, `mapa.png`, `final.png`. Duración en `chapter3.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-5-chapter3
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
const KEY = /^(crt_powered|computer_unlocked|has_printout|has_extension_cord|met_pzbot|pzbot_crashed|switch_unlocked|emergency_|coords_known|has_marked_map|chapter_3_complete)/;
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
      await demo.film(Math.min(1300, Math.max(600, r.text.length * 16)));
      await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
      lastTapAt = Date.now();
      await demo.sleep(250);
      continue;
    }
    // Andar y transiciones a ×3 (un fotograma de cada tres): la demo tiene que quedarse en < 120 s
    // Si el toque cayó con la frase aún escribiéndose (la completa en vez de pasarla), otro toque
    if (r.text && Date.now() - lastTapAt > 1500) { await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap()); lastTapAt = Date.now(); }
    if (r.text || r.busy) { calm = 0; if (busyTick++ % 3 === 0) await demo.shot(); await demo.sleep(150); continue; }
    lastText = null;
    calm++;
    await demo.sleep(200);
  }
  return seen;
}

/** Juntar dos objetos como el jugador: verbo USE y los dos objetos del inventario, uno detrás de otro. */
function combine(a, b) {
  return page.evaluate((a, b) => {
    const panel = window.__game.scene.getScene('UIScene').getScummUI();
    panel.clearSelectedItem();
    if (panel.getSelectedVerb() !== 'USE') panel.selectVerb('USE');
    return panel.clickInventoryItem(a) && panel.clickInventoryItem(b) ? null : `no se pudieron juntar ${a} y ${b}`;
  }, a, b);
}

/** Andar a un punto (en % del fondo) con el verbo Walk, como un toque en el suelo. */
function walkTo(x, y) {
  return page.evaluate((x, y) => {
    const g = window.__game;
    const panel = g.scene.getScene('UIScene').getScummUI();
    panel.clearSelectedItem();
    if (panel.getSelectedVerb() !== 'WALK') panel.selectVerb('WALK');
    return g.scene.getScene('GameScene').qaWalk(x, y) ?? null;
  }, x, y);
}

const has = (s, ...ids) => ids.every((i) => s.inventory.includes(i));
const T0 = Date.now();
const view = { id: '844x390', tap: [422, 40] };
await demo.openScene('basement');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: view.tap }))) await demo.fail('basement no quedó libre al entrar');
// Lo de los capítulos 1 y 2 ya hecho: Gerald conocido, Ledger, boli de Mt. Gox y antena
await page.evaluate(() => window.__qa.runScript([
  { op: 'setFlag', flag: 'chapter_1_complete', value: true },
  { op: 'setFlag', flag: 'chapter_2_complete', value: true },
  { op: 'setFlag', flag: 'basement_unlocked', value: true },
  { op: 'setFlag', flag: 'chapter_3_intro_shown', value: true },
  { op: 'setFlag', flag: 'knows_gerald', value: true },
  { op: 'setFlag', flag: 'found_ledger', value: true },
  { op: 'addItem', id: 'ledger', name: 'Ledger' },
  { op: 'setFlag', flag: 'found_keycard', value: true },
  { op: 'addItem', id: 'leaky_pen', name: 'Leaky Pen' },
  { op: 'setFlag', flag: 'found_antenna', value: true },
  { op: 'addItem', id: 'antenna', name: 'Antenna' },
]));
const v = { view: view.id, steps: [] };
report.views.push(v);

// [etiqueta, qué, acción, capturas, comprobación del estado, frase obligatoria, elecciones]
const steps = [
  ['mesa', 'PICK mesa: disquete y papel en blanco', () => start('PICK', 'hs_left_desk'),
    [], (s) => has(s, 'floppy_disk', 'scrap_paper'), /In this economy/],
  ['rack', 'PUSH rack → server_room', () => start('PUSH', 'hs_equipment'), [], (s) => s.scene === 'server_room', null],
  ['suelo', 'PICK suelo técnico: alargador y gafas 3D', () => start('PICK', 'hs_raised_floor'),
    [[/Red on the right/, 'suelo']], (s) => has(s, 'extension_cord', 'glasses_3d'), /Red on the right/],
  ['pzbot', 'TALK terminal: PZ-BOT', () => start('TALK', 'hs_terminal'),
    [[/DO YOU HAVE ALPHA/, 'pzbot']], (s) => s.flags.met_pzbot && !s.flags.switch_unlocked, /DO YOU HAVE ALPHA/],
  ['alfa', 'papel + boli = alfa falsa', () => combine('scrap_paper', 'leaky_pen'),
    [], (s) => has(s, 'fake_alpha', 'leaky_pen') && !has(s, 'scrap_paper'), null],
  ['crash', 'alfa falsa en el terminal: PZ-BOT se cuelga', () => start('USE', 'hs_terminal', 'fake_alpha'),
    [[/ALL IN/, 'crash']], (s) => s.flags.pzbot_crashed && s.flags.switch_unlocked && has(s, 'server_log'), /GERALD\. ALL IN/],
  ['cristal', 'antena en el cristal', () => start('USE', 'hs_emergency_switch', 'antenna'),
    [], (s) => s.flags.emergency_glass_broken, /CRACK/],
  ['interruptor', 'USE interruptor: coordenadas', () => start('USE', 'hs_emergency_switch'),
    [[/STILL BULLISH/, 'bateria']], (s) => s.flags.emergency_switch_flipped && s.flags.coords_known && !s.flags.chapter_3_complete, /STILL BULLISH/],
  ['vuelta', 'a pie al sótano', () => walkTo(8, 95), [], (s) => s.scene === 'basement', null],
  ['corriente', 'alargador en el CRT', () => start('USE', 'hs_main_computer', 'extension_cord'),
    [], (s) => s.flags.crt_powered, /smells like 1997/],
  ['pin', 'Ledger en el CRT: PIN', () => start('USE', 'hs_main_computer', 'ledger'),
    [[/genesis block/, 'pin']], (s) => s.flags.computer_unlocked, /genesis block/, ['7314', "Gerald's birthday"]],
  ['disquete', 'disquete en el CRT: listado y mapa sin X', () => start('USE', 'hs_main_computer', 'floppy_disk'),
    [], (s) => has(s, 'printout', 'floppy_disk'), /Very useless/],
  ['mapa', 'printout + boli = mapa marcado', () => combine('printout', 'leaky_pen'),
    [[/X marks the spot/, 'mapa']], (s) => has(s, 'marked_map') && s.flags.chapter_3_complete, null],
];
for (const [tag, what, act, stills, ok, line, choices = []] of steps) {
  await demo.film(150);
  const err = await act();
  if (err) { bad(`${what}: ${err}`); break; }
  const seen = await follow(view.id, stills.map(([re, label]) => [re, label]), choices);
  if (tag === 'rack' || tag === 'vuelta') await demo.settle({ tap: view.tap });
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
writeFileSync(join(demo.dir, 'chapter3.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Capítulo 3 (CRT, PZ-BOT, interruptor y mapa marcado), en 844x390');

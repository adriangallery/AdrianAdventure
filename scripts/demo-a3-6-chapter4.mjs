// Demo de A3.6f (regla visual del plan SCUMM): el capítulo 4 «The Mountain Path», en un solo viewport (844x390, móvil
// apaisado) y CORTA (objetivo ≤ 120 s: 4 fps, 560 px, frases a ritmo rápido y andar a ×3).
// Empieza en `clinic_exterior` (?qa=1) con lo de los capítulos 1-3 puesto por __qa.runScript (lata BULL RUN, gafas 3D)
// y, para que quepa, las réplicas de los monos (fud_r1…fud_r4: en la demo se ve la fuente de la barra). Juega:
//   1) papelera: clinic_note; nota y lata al buzón (intake_evidence); 2) negación con Gwei → admitted, dentro;
//   3) Satoshi: condición de Chad; archivador → piscina; 4) pato con Gerald (pool_accepted); B.O.T.: R5 y R6;
//   5) MemeLAB: gafas (visión clara) y Pepe; 6) duelo con Chad → sobriety_chip; 7) Satoshi: autorización
//   (treatment_room_unlocked, chapter_4_complete).
// Comprueba por `state()` flags, inventario y escena, y que se vieron las frases clave. Capturas: `gwei.png`,
// `chad.png`, `pepe.png`, `duelo.png`, `final.png`. Duración en `chapter4.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-6-chapter4
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
const KEY = /^(intake_|admitted|clinic_unlocked|satoshi_|pool_accepted|fud_r|memelab_clear_vision|found_pepememe|beat_chad|chad_losses|has_sobriety_chip|treatment_room_unlocked|chapter_4_complete)/;
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
    if (target.startsWith('npc_')) return gs.qaTapNpc(target) ?? null;
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
      await demo.film(Math.min(1100, Math.max(500, r.text.length * 13)));
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
await demo.openScene('clinic_exterior');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: view.tap }))) await demo.fail('clinic_exterior no quedó libre al entrar');
// Capítulos 1-3 hechos (lata y gafas 3D) y, para que la demo quepa en 120 s, las réplicas de los monos
await page.evaluate(() => window.__qa.runScript([
  { op: 'setFlag', flag: 'chapter_1_complete', value: true },
  { op: 'setFlag', flag: 'chapter_2_complete', value: true },
  { op: 'setFlag', flag: 'chapter_3_complete', value: true },
  { op: 'setFlag', flag: 'chapter_4_intro_shown', value: true },
  { op: 'addItem', id: 'energy_drink', name: 'Energy Drink' },
  { op: 'setFlag', flag: 'found_glasses_3d', value: true },
  { op: 'addItem', id: 'glasses_3d', name: '3D Glasses' },
  { op: 'setFlag', flag: 'fud_r1', value: true },
  { op: 'setFlag', flag: 'fud_r2', value: true },
  { op: 'setFlag', flag: 'fud_r3', value: true },
  { op: 'setFlag', flag: 'fud_r4', value: true },
]));
const v = { view: view.id, steps: [] };
report.views.push(v);

// [etiqueta, qué, acción, capturas, comprobación del estado, frase obligatoria, elecciones]
const steps = [
  ['papelera', 'PICK papelera: clinic_note', () => start('PICK', 'hs_trash_can'),
    [], (s) => has(s, 'clinic_note', 'energy_drink'), /Day 47/],
  ['perdida', 'nota al buzón: pérdida', () => start('USE', 'hs_visitor_box', 'clinic_note'),
    [], (s) => s.flags.intake_loss && has(s, 'clinic_note'), /Proof of loss/],
  ['insomnio', 'lata al buzón: insomnio', () => start('USE', 'hs_visitor_box', 'energy_drink'),
    [], (s) => s.flags.intake_evidence, /Proof of insomnia/],
  ['gwei', 'USE puerta: cuestionario de negación', () => start('USE', 'hs_main_entrance'),
    [[/Welcome home/, 'gwei']], (s) => s.scene === 'clinic_interior' && s.flags.admitted && has(s, 'patient_wristband'), /Textbook/, ['stop whenever']],
  ['satoshi', 'TALK Satoshi: graduarse con Chad', () => start('TALK', 'npc_dr_satoshi'),
    [], (s) => s.flags.satoshi_needs_chad && s.flags.satoshi_pool_hint, /Chad runs it/, ['Can I see the treatment room', 'Goodbye, doctor']],
  ['archivador', 'PUSH archivador → piscina', () => start('PUSH', 'hs_filing_cabinet'), [], (s) => s.scene === 'recovery_pool', null],
  ['pato', 'PICK basura: pato', () => start('PICK', 'hs_trash_pile'), [], (s) => has(s, 'rubber_duck'), null],
  ['gerald', 'USE Gerald con el pato: aceptado', () => start('USE', 'hs_rubber_duck'),
    [], (s) => s.flags.pool_accepted, /Two ducks/],
  ['bot', 'B.O.T.: The Liquidation y réplicas 5 y 6', () => start('TALK', 'hs_robot_bartender'),
    [], (s) => s.flags.fud_r5 && s.flags.fud_r6, /never made anything/, ['have a drink', 'Thanks, B.O.T.']],
  ['memelab', 'puerta DEEP LIQUIDITY → MemeLAB', () => start('USE', 'hs_dark_door'), [], (s) => s.scene === 'memelab', null],
  ['gafas', 'gafas 3D sobre las de Dex', () => start('USE', 'hs_meme_tube', 'glasses_3d'),
    [], (s) => s.flags.memelab_clear_vision, /Two wrong glasses/],
  ['pepe', 'PICK Pepe: by P.Z.', () => start('PICK', 'hs_pepememe'),
    [[/by P\.Z\./, 'pepe']], (s) => has(s, 'pepememe'), /by P\.Z\./],
  ['salida', 'vuelta a la piscina', () => start('USE', 'hs_exit_door'), [], (s) => s.scene === 'recovery_pool', null],
  ['chad', 'duelo de FUD con Chad', () => start('TALK', 'hs_chad'),
    [[/Name ONE thing/, 'duelo'], [/Specimen #001/, 'chad']], (s) => s.flags.beat_chad && has(s, 'sobriety_chip', 'pepememe'), /Specimen #001/,
    ["Let's duel", 'loyalty card', 'kiddie pool', 'exit plan', 'Show the Rare Pepe']],
  ['subir', 'escaleras → recepción', () => start('USE', 'hs_stairs_up'), [], (s) => s.scene === 'clinic_interior', null],
  ['autorizacion', 'TALK Satoshi: la ficha', () => start('TALK', 'npc_dr_satoshi'),
    [], (s) => s.flags.treatment_room_unlocked && s.flags.chapter_4_complete && !has(s, 'sobriety_chip'), /Chad doesn't even beat Chad/, ['I beat Chad', 'Goodbye, doctor']],
];
const SETTLE = new Set(['gwei', 'archivador', 'memelab', 'salida', 'subir']);
for (const [tag, what, act, stills, ok, line, choices = []] of steps) {
  await demo.film(150);
  const err = await act();
  if (err) { bad(`${what}: ${err}`); break; }
  const seen = await follow(view.id, stills.map(([re, label]) => [re, label]), choices);
  if (SETTLE.has(tag)) await demo.settle({ tap: view.tap });
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
if (report.seconds > 120) console.warn(`AVISO: la demo dura ${report.seconds} s (objetivo ≤ 120 s)`);

await demo.end();
writeFileSync(join(demo.dir, 'chapter4.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Capítulo 4 (admisión, Satoshi, piscina, MemeLAB, duelo de FUD y autorización), en 844x390');

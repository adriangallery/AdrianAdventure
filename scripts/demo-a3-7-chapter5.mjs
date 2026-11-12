// Demo de A3.7e (regla visual del plan SCUMM): el capítulo 5 «Patient Zero» y el epílogo, en un solo viewport (844x390,
// móvil apaisado) y CORTA (objetivo ≤ 120 s: 4 fps, 560 px, frases a ritmo rápido).
// Empieza en `treatment_room` (?qa=1) con lo de los capítulos 1-4 puesto por __qa.runScript (disquete, boli de Mt. Gox,
// réplicas fud_r1…fud_r6, Pepe) y juega: 1) LOOK monitor (INSERT BACKUP); 2) disquete al monitor (backup_loaded);
// 3) sillón → revelación «VOICE MATCH: 100 %» y duelo final con PZ-BOT (I2, I4, I6, «I'm not you anymore») → pzbot_off;
// 4) Adrian tras el cristal (met_adrian, silueta); 5) la nota («Gerald says hi»); 6) salida → epílogo (cinemática:
// amanecer, Penny es RRHH, DOORIS dice «Dex»); 7) firma del NOW HIRING con el boli (game_complete).
// Comprueba por `state()` flags, inventario y escena, y que se vieron las frases clave. Capturas: `monitor.png`,
// `duelo.png`, `adrian.png`, `penny.png`, `firma.png`, `final.png`. Duración en `chapter5.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-7-chapter5
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
const view = { id: '844x390', tap: [422, 40] };

const qaState = () => page.evaluate(() => window.__qa.state());
const KEY = /^(backup_loaded|patient_seated|monitor_revealed|patient_zero_revealed|pzbot_|met_adrian|found_adrian_note|chapter_5_complete|epilogue_intro_shown|signed_up|game_complete)/;
const flagsOf = (st) => Object.fromEntries(Object.entries(st.flags).filter(([k]) => KEY.test(k)));

/** Lo que hay en pantalla: texto (y quién), elección pendiente y si el juego está ocupado. */
const probe = () => page.evaluate(() => {
  const st = window.__qa.state();
  return { text: st.speech?.text ?? null, speaker: st.speech?.speaker ?? null, choices: st.choices ? st.choices.map((c) => c.text) : null, busy: (st.busy ?? []).length > 0, scene: st.scene };
});

/** Empieza una acción como un clic real (verbo, objeto del inventario y toque en el hotspot), sin cerrar textos. */
async function start(verb, target, item = null) {
  // Como __qa.act: el toque solo cuenta cuando la escena acepta entrada (enfriamiento tras cerrar un texto o un diálogo)
  await page.waitForFunction(() => !window.__game.scene.getScene('GameScene').qaIsInputBlocked(), { timeout: 5000, polling: 50 }).catch(() => {});
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
async function follow(viewId, stills, choices = []) {
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
      if (want === undefined) { bad(`${viewId}: opciones sin respuesta prevista (${r.choices.join(' | ')})`); break; }
      const err = await choose(want);
      if (err) { bad(`${viewId}: ${err} entre ${r.choices.join(' | ')}`); break; }
      seen.push({ speaker: '>', text: want });
      lastText = null;
      await demo.sleep(300);
      continue;
    }
    if (r.text && r.text !== lastText) {
      calm = 0;
      lastText = r.text;
      seen.push({ speaker: r.speaker, text: r.text });
      await demo.film(Math.min(1100, Math.max(500, r.text.length * 13)));
      for (const [re, label] of stills) if (re.test(r.text)) await demo.still(`${viewId}-${label}`);
      await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
      lastTapAt = Date.now();
      await demo.sleep(250);
      continue;
    }
    // Andar y transiciones a ×3 (un fotograma de cada tres): la demo tiene que quedarse en < 120 s
    // Si el toque cayó con la frase aún escribiéndose (la completa en vez de pasarla), otro toque
    if (r.text && Date.now() - lastTapAt > 1500) { await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap()); lastTapAt = Date.now(); }
    // El monitor (monitorReveal) y la tarjeta del capítulo esperan un toque de verdad: sin texto y ocupado > 2,5 s, un clic
    if (!r.text && r.busy && Date.now() - lastTapAt > 2500) { await page.mouse.click(...view.tap); lastTapAt = Date.now(); }
    if (r.text || r.busy) { calm = 0; if (busyTick++ % 3 === 0) await demo.shot(); await demo.sleep(150); continue; }
    lastText = null;
    calm++;
    await demo.sleep(200);
  }
  return seen;
}

const has = (s, ...ids) => ids.every((i) => s.inventory.includes(i));
const T0 = Date.now();
await demo.openScene('treatment_room');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: view.tap }))) await demo.fail('treatment_room no quedó libre al entrar');
// Capítulos 1-4 hechos: disquete del sótano, boli de Mt. Gox, réplicas de la piscina y el Pepe del MemeLAB
await page.evaluate(() => window.__qa.runScript([
  ...['chapter_1_complete', 'chapter_2_complete', 'chapter_3_complete', 'chapter_4_complete', 'treatment_room_unlocked',
    'chapter_5_intro_shown', 'found_floppy', 'found_pepememe', 'fud_r1', 'fud_r2', 'fud_r3', 'fud_r4', 'fud_r5', 'fud_r6']
    .map((flag) => ({ op: 'setFlag', flag, value: true })),
  { op: 'addItem', id: 'floppy_disk', name: 'Floppy Disk' },
  { op: 'addItem', id: 'leaky_pen', name: 'Leaky Pen' },
]));
const v = { view: view.id, steps: [] };
report.views.push(v);

// [etiqueta, qué, acción, capturas, comprobación del estado, frase obligatoria, elecciones]
const steps = [
  ['mirar', 'LOOK monitor: INSERT BACKUP', () => start('LOOK', 'hs_monitor'), [], (s) => !s.flags.backup_loaded, /INSERT BACKUP/],
  ['disco', 'disquete al monitor', () => start('USE', 'hs_monitor', 'floppy_disk'),
    [], (s) => s.flags.backup_loaded && has(s, 'floppy_disk'), /DO NOT LOSE/],
  ['sillon', 'sillón → revelación y duelo final con PZ-BOT', () => start('USE', 'hs_chair'),
    [[/VOICE MATCH: 100/, 'monitor'], [/USED TO BE FUN/, 'duelo']], (s) => s.flags.patient_zero_revealed && s.flags.pzbot_off, /DON'T SOUND LIKE ME/,
    ['settle this', 'streak of zero', 'hear you lose', 'receipts floating', 'not you anymore']],
  ['adrian', 'TALK cristal: Adrian', () => start('TALK', 'hs_observation_window'),
    [[/You took your time/, 'adrian']], (s) => s.flags.met_adrian, /You took your time/],
  ['nota', 'PICK nota de Adrian', () => start('PICK', 'hs_adrian_note'), [], (s) => has(s, 'adrian_note'), /Gerald says hi/],
  ['salida', 'puerta → epílogo (cinemática)', () => start('USE', 'hs_exit_door'),
    [[/I am HR/, 'penny']], (s) => s.scene === 'epilogue_outside' && s.flags.chapter_5_complete && s.flags.epilogue_intro_shown, /I am HR/],
  ['firma', 'boli de Mt. Gox con el NOW HIRING', () => start('USE', 'hs_now_hiring_sign', 'leaky_pen'),
    [[/Still leaking/, 'firma']], (s) => s.flags.signed_up && s.flags.game_complete, /Still leaking/],
];
const SETTLE = new Set(['salida']);
for (const [tag, what, act, stills, ok, line, choices = []] of steps) {
  await demo.film(150);
  const err = await act();
  if (err) { bad(`${what}: ${err}`); break; }
  const seen = await follow(view.id, stills.map(([re, label]) => [re, label]), choices);
  if (SETTLE.has(tag)) await demo.settle({ tap: view.tap });
  const st = await qaState();
  if (!seen.length) console.log(`  [diag] ${tag}: sin frases · busy ${JSON.stringify(st.busy)} · jugador ${JSON.stringify(st.player)} · walkTarget ${JSON.stringify(st.walkTarget)} · path ${JSON.stringify(st.path)} · verbo ${st.verb}`);
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
writeFileSync(join(demo.dir, 'chapter5.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Capítulo 5 (monitor, duelo final con PZ-BOT, Adrian, nota) y epílogo (Penny, firma), en 844x390');

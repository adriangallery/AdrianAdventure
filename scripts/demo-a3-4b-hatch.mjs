// Demo de A3.4b/A3.4c (regla visual del plan SCUMM): cajón de Terms & Conditions, veleta oxidada y escotilla de tres
// cierres; el capítulo 2 acaba AL BAJAR. En `upstairs` (?qa=1), en 844x390 (móvil apaisado) y en 390x844 (vertical), a
// ritmo de jugador (un toque por frase, las opciones del árbol se eligen en pantalla):
//   1) USE escritorio → árbol tos_drawer: «Accept» («...your left kidney.») y «Never mind»: el cajón no abre;
//   2) OPEN escritorio: «Keep reading» ×3 → página 38 («...first person ever to read this. Drawer unlocked.»):
//      terminal_key y la nota de PZ;
//   3) PICK caja de pizza: pizza_slice; USE escotilla del techo → azotea;
//   4) USE veleta sin grasa («Rusted solid»); pizza en la veleta (vane_greased, «Adrian's diet...»); USE veleta
//      (vane_turned);
//   5) LOOK escotilla (tres cierres, «Still shut: the card reader and the keyhole.»); keycard (hatch_reader_ok);
//      terminal_key (hatch_lock_ok): «Three locks. Adrian trusts nobody. Including, apparently, Adrian.» y Dex baja al
//      sótano (basement_unlocked, chapter_2_complete).
// La keycard del abrigo (A3.4a) se mete con __qa.runScript. Comprueba por `state()` flags, inventario y escena, y que
// se vieron las frases clave. Capturas: `<vista>-kidney.png`, `-pagina38.png`, `-oxidada.png`, `-grasa.png`,
// `-cierres.png`, `-bajada.png`, `-final.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-4b-hatch
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 5, width: 640 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const bad = (m) => problems.push(m);
const report = { views: [] };

const qaState = () => page.evaluate(() => window.__qa.state());
const KEY = /^(tos_read_|found_terminal_key|found_pz_note|has_pizza_slice|vane_|hatch_|basement_unlocked|chapter_2_complete)/;
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
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && calm < 6) {
    const r = await probe();
    if (r.choices) {
      calm = 0;
      await demo.film(900);
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
      await demo.film(Math.min(3500, Math.max(1200, r.text.length * 40)));
      await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
      await demo.sleep(250);
      continue;
    }
    if (r.text || r.busy) { calm = 0; await demo.shot(); await demo.sleep(200); continue; }
    lastText = null;
    calm++;
    await demo.sleep(200);
  }
  return seen;
}

const has = (s, ...ids) => ids.every((i) => s.inventory.includes(i));

for (const view of [{ id: '844x390', width: 844, height: 390, tap: [422, 40] }, { id: '390x844', width: 390, height: 844, tap: [195, 60] }]) {
  await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await demo.openScene('upstairs');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: view.tap }))) await demo.fail(`${view.id}: upstairs no quedó libre al entrar`);
  await page.evaluate(() => window.__qa.runScript([
    { op: 'setFlag', flag: 'chapter_1_complete', value: true },
    { op: 'setFlag', flag: 'found_keycard', value: true },
    { op: 'setFlag', flag: 'has_keycard', value: true },
    { op: 'addItem', id: 'keycard', name: 'Keycard' },
  ]));
  const v = { view: view.id, steps: [] };
  report.views.push(v);

  // [etiqueta, qué, acción, opciones, capturas, comprobación del estado, frase obligatoria]
  const steps = [
    ['kidney', 'USE escritorio: «Accept» sin leer', () => start('USE', 'hs_desk'), ['Accept', 'Never mind'],
      [[/left kidney/, 'kidney']], (s) => !s.flags.found_terminal_key && !has(s, 'terminal_key'), /left kidney/],
    ['leer', 'OPEN escritorio: «Keep reading» ×3', () => start('OPEN', 'hs_desk'), ['Keep reading', 'Keep reading', 'Keep reading'],
      [[/first person ever to read this/, 'pagina38']], (s) => s.flags.tos_read_3 && s.flags.found_pz_note && has(s, 'terminal_key'), /first person ever to read this/],
    ['pizza', 'PICK caja de pizza', () => start('PICK', 'hs_pizza_box'), [],
      [], (s) => has(s, 'pizza_slice') && s.flags.has_pizza_slice, /velcro/],
    ['azotea', 'USE escotilla del techo → azotea', () => start('USE', 'hs_roof_hatch'), [],
      [], (s) => s.scene === 'rooftop', null],
    ['oxidada', 'USE veleta sin grasa', () => start('USE', 'hs_weather_vane'), [],
      [[/Rusted solid/, 'oxidada']], (s) => !s.flags.vane_turned, /Rusted solid/],
    ['grasa', 'pizza en la veleta', () => start('USE', 'hs_weather_vane', 'pizza_slice'), [],
      [[/infrastructure/, 'grasa']], (s) => s.flags.vane_greased && !has(s, 'pizza_slice'), /contributes to the infrastructure/],
    ['giro', 'USE veleta engrasada', () => start('USE', 'hs_weather_vane'), [],
      [], (s) => s.flags.vane_turned, /latch/],
    ['cierres', 'LOOK escotilla: tres cierres y lo que falta', () => start('LOOK', 'hs_roof_access_panel'), [],
      [[/Still shut/, 'cierres']], (s) => !s.flags.basement_unlocked, /Still shut: the card reader and the keyhole/],
    ['lector', 'keycard en la escotilla', () => start('USE', 'hs_roof_access_panel', 'keycard'), [],
      [], (s) => s.flags.hatch_reader_ok && !s.flags.basement_unlocked, /thinks I'm Adrian/],
    ['bajada', 'terminal_key en la escotilla: abre y baja', () => start('USE', 'hs_roof_access_panel', 'terminal_key'), [],
      [[/Including, apparently, Adrian/, 'bajada']],
      (s) => s.scene === 'basement' && s.flags.hatch_lock_ok && s.flags.basement_unlocked && s.flags.chapter_2_complete && has(s, 'keycard', 'terminal_key'),
      /Including, apparently, Adrian/],
  ];
  for (const [tag, what, act, choices, stills, ok, line] of steps) {
    await demo.film(500);
    const err = await act();
    if (err) { bad(`${view.id} ${what}: ${err}`); break; }
    const seen = await follow(view.id, stills, choices);
    const st = await qaState();
    v.steps.push({ tag, what, seen, scene: st.scene, flags: flagsOf(st), inventory: st.inventory });
    console.log(`${view.id} · ${what}: ${seen.map((x) => `${x.speaker ?? 'Dex'}: «${x.text}»`).join(' / ')} · ${st.scene} ${JSON.stringify(flagsOf(st))}`);
    if (line && !seen.some((x) => line.test(x.text))) bad(`${view.id} ${what}: no se vio la frase ${line}`);
    if (!ok(st)) bad(`${view.id} ${what}: estado inesperado (${st.scene}, ${JSON.stringify(flagsOf(st))}, inventario ${st.inventory.join(', ')})`);
  }
  // La apertura del capítulo 3 en el sótano se pasa con toques
  await demo.settle({ tap: view.tap });
  await demo.still(`${view.id}-final`);
}

await demo.end();
writeFileSync(join(demo.dir, 'hatch.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Cajón de Terms & Conditions, veleta engrasada y escotilla de tres cierres hasta el sótano, en 844x390 y 390x844');

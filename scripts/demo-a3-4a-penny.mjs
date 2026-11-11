// Demo de A3.4a (regla visual del plan SCUMM): «Penny y el abrigo», el primer puzle del capítulo 2.
// En `lobby` (?qa=1), en 844x390 (móvil apaisado) y en 390x844 (vertical), a ritmo de jugador (un toque por frase):
//   1) PICK abrigo con Penny mirando: «Touch that coat and I call HR. I AM HR. ...Unless something CONFIDENTIAL lands
//      on my desk.» (no hay keycard);
//   2) USE sobre CONFIDENTIAL → escritorio de Penny: «Is that... CONFIDENTIAL?» y «Oh. Oh no. Oh, he did NOT.»
//      (penny_reading; el sobre se queda en su mesa);
//   3) TALK a Penny mientras lee: «Shh. Page two.»;
//   4) PICK abrigo: keycard y boli de Mt. Gox («Still leaking after all these years.») y Penny devuelve el sobre.
// El sobre se mete con __qa.runScript (la escena se abre directamente). Antes de cada paso Dex se acerca con
// __qa.walk para que Penny y el abrigo salgan en pantalla (la cámara sigue a Dex). Comprueba por `state()` las flags
// (penny_coat_warned, penny_reading, found_keycard, has_leaky_pen, penny_envelope_back) y el inventario, y que se
// vieron las frases clave. Capturas: `<vista>-rechazo.png`, `-sobre.png`, `-leyendo.png`, `-abrigo.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-4a-penny
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
const KEY = /^(penny_|found_keycard|has_keycard|has_leaky_pen)/;
const flagsOf = (st) => Object.fromEntries(Object.entries(st.flags).filter(([k]) => KEY.test(k)));

/** Lo que hay en pantalla: texto (y quién), elección pendiente y si el juego está ocupado. */
const probe = () => page.evaluate(() => {
  const st = window.__qa.state();
  return { text: st.speech?.text ?? null, speaker: st.speech?.speaker ?? null, choice: !!st.choices, busy: (st.busy ?? []).length > 0 };
});

/** Empieza una acción como un clic real (verbo, objeto del inventario y toque en el hotspot o la NPC), sin cerrar textos. */
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

/** Sigue las frases hasta que el juego queda libre: un fotograma por frase, un toque para pasar. */
async function follow(view, stills) {
  const seen = [];
  let lastText = null;
  let calm = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && calm < 6) {
    const r = await probe();
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
    if (r.text || r.busy || r.choice) { calm = 0; await demo.shot(); await demo.sleep(200); continue; }
    lastText = null;
    calm++;
    await demo.sleep(200);
  }
  return seen;
}

for (const view of [{ id: '844x390', width: 844, height: 390, tap: [422, 40] }, { id: '390x844', width: 390, height: 844, tap: [195, 60] }]) {
  await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await demo.openScene('lobby');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  // La apertura del capítulo 2 (cinemática con Penny) se pasa con toques, como un jugador con prisa
  if (!(await demo.settle({ tap: view.tap }))) await demo.fail(`${view.id}: el lobby no quedó libre tras la apertura`);
  await page.evaluate(() => window.__qa.runScript([{ op: 'addItem', id: 'mystery_envelope', name: 'Mystery Envelope' }]));
  const v = { view: view.id, steps: [] };
  report.views.push(v);

  const steps = [
    ['rechazo', 'PICK abrigo con Penny mirando', [55, 90], () => start('PICK', 'hs_coat'),
      [[/I AM HR/, 'rechazo']], (s) => s.flags.penny_coat_warned && !s.inventory.includes('keycard'), /I AM HR/],
    ['sobre', 'sobre CONFIDENTIAL al escritorio de Penny', [44, 92], () => start('USE', 'hs_monitor_desk', 'mystery_envelope'),
      [[/CONFIDENTIAL\?/, 'sobre'], [/he did NOT/, 'leyendo']], (s) => s.flags.penny_reading && !s.inventory.includes('mystery_envelope'), /he did NOT/],
    ['charla', 'TALK a Penny mientras lee', [44, 92], () => start('TALK', 'npc_receptionist'),
      [], (s) => s.flags.penny_reading && !s.inventory.includes('keycard'), /Page two/],
    ['abrigo', 'PICK abrigo: keycard, boli y el sobre de vuelta', [55, 90], () => start('PICK', 'hs_coat'),
      [[/Still leaking/, 'abrigo']],
      (s) => ['keycard', 'leaky_pen', 'mystery_envelope'].every((i) => s.inventory.includes(i)) && s.flags.found_keycard && s.flags.has_leaky_pen && s.flags.penny_envelope_back,
      /Still leaking after all these years/],
  ];
  for (const [tag, what, near, act, stills, ok, line] of steps) {
    // Acercarse primero (Penny y el abrigo en pantalla; en vertical la cámara sigue a Dex)
    const werr = await page.evaluate((x, y) => window.__qa.walk(x, y).then(() => null, (e) => String(e?.message || e)), near[0], near[1]);
    if (werr) bad(`${view.id} ${what}: no pudo acercarse (${werr})`);
    await demo.film(600);
    const err = await act();
    if (err) { bad(`${view.id} ${what}: ${err}`); break; }
    const seen = await follow(view.id, stills);
    const st = await qaState();
    v.steps.push({ tag, what, seen, flags: flagsOf(st), inventory: st.inventory });
    console.log(`${view.id} · ${what}: ${seen.map((x) => `${x.speaker ?? 'Dex'}: «${x.text}»`).join(' / ')} · ${JSON.stringify(flagsOf(st))}`);
    if (!seen.some((x) => line.test(x.text))) bad(`${view.id} ${what}: no se vio la frase ${line}`);
    if (!ok(st)) bad(`${view.id} ${what}: estado inesperado (${JSON.stringify(flagsOf(st))}, inventario ${st.inventory.join(', ')})`);
  }
  await demo.still(`${view.id}-final`);
}

await demo.end();
writeFileSync(join(demo.dir, 'penny.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEMA: ${p}`);
  await demo.fail(`${problems.length} problema(s)`);
}
console.log('Penny y el abrigo: rechazo, sobre, lectura, keycard y boli, en 844x390 y 390x844');

// Demo de A3.3 (regla visual del plan SCUMM): el final del capítulo 1, «Breaking & Entering», con DOORIS.
// En `outside` (?qa=1) en 844x390 (móvil apaisado, táctil):
//   1) la cadena del capítulo por la API de QA, un fotograma con rótulo por paso: lámpara (mitad A), tablón, nido
//      (mitad B), nota entera, felpudo con el tablón (Ledger), buzón (sobre + factura de Gerald), y el primer contacto
//      con DOORIS (nota al teclado: presentación, llamada de Anon, pregunta de seguridad respondida con la factura);
//   2) el tercer factor filmado a ritmo de jugador: USE Ledger → teclado con toques reales para cada frase («Ledger
//      detected…», «Three-factor authentication complete. One factor was a duck.», la de Dex) hasta el fundido al lobby
//      y la apertura del capítulo 2 (Penny) ya en marcha.
// Comprueba por `state()` las flags de los tres factores (dooris_pin_ok, dooris_question_ok, dooris_key_ok), que la
// respuesta buena solo aparece con la factura (lastChoices), que door_unlocked y chapter_1_complete acaban puestas y
// que la escena final es el lobby. Capturas: `dooris-hello.png`, `dooris-question.png`, `dooris-open.png`, `lobby.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-3-chapter1
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const STAGE = { width: 900, height: 560 };
const demo = await startDemo(import.meta.url, { fps: 5, width: 640 });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const bad = (m) => problems.push(m);
const report = { steps: [], finale: [] };

// Lienzo fijo con rótulo
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption, n = 1) {
  for (let i = 0; i < n; i++) {
    const png = await page.screenshot();
    const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;font:15px monospace;color:#c8c0e8">
      <div style="margin-bottom:10px">${caption}</div>
      <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878"></body></html>`);
    await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
    await page.bringToFront();
  }
}
const qaState = () => page.evaluate(() => window.__qa.state());
const flagsOf = (st) => Object.fromEntries(Object.entries(st.flags).filter(([k]) => /^(dooris_|door_unlocked|chapter_1_complete|anon_call_1|knows_gerald|found_ledger)/.test(k)));

await demo.openScene('outside');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
await page.evaluate(() => document.fonts?.ready);
// La apertura (A3.2) es una cinemática: se salta con toques, como un jugador con prisa
if (!(await demo.settle({ tap: [422, 40] }))) await demo.fail('outside no quedó libre tras la apertura');
await stageFrame('Capítulo 1 · outside', 2);

// ── 1) La cadena del capítulo por la API de QA ──────────────────────────────────────────────────────────────
const chain = [
  ['USE lámpara: apagarla (las polillas se van)', (q) => q.act('USE', 'hs_porch_light'), (s) => s.flags.porch_light_off],
  ['PICK lámpara: mitad A del PIN («73..»)', (q) => q.act('PICK', 'hs_porch_light'), (s) => s.inventory.includes('note_half_a')],
  ['PULL valla: el tablón', (q) => q.act('PULL', 'hs_fence'), (s) => s.inventory.includes('fence_plank')],
  ['tablón + chimenea: cae el nido, mitad B («..14»)', (q) => q.use('fence_plank', 'hs_chimney'), (s) => s.inventory.includes('note_half_b')],
  ['mitad + mitad: 7314', (q) => q.combine('note_half_a', 'note_half_b'), (s) => s.inventory.includes('code_note')],
  ['tablón + felpudo HODL (pegado): el Ledger', (q) => q.use('fence_plank', 'hs_doormat'), (s) => s.inventory.includes('ledger')],
  ['OPEN buzón: sobre CONFIDENTIAL y la factura del veterinario de Gerald', (q) => q.act('OPEN', 'hs_mailbox'), (s) => s.inventory.includes('vet_bill') && s.flags.knows_gerald],
  ['nota → teclado: DOORIS se presenta, llama Anon, pregunta de seguridad: «[The name on the vet bill]»', (q) => q.use('code_note', 'hs_keypad', ['vet bill']), (s) => s.flags.dooris_pin_ok && s.flags.dooris_question_ok && !s.flags.door_unlocked],
];
for (const [what, fn, ok] of chain) {
  const err = await page.evaluate((src) => (0, eval)(src)(window.__qa).then(() => null, (e) => String(e?.message || e)), fn.toString());
  const st = await qaState();
  report.steps.push({ what, err, flags: flagsOf(st), inventory: st.inventory });
  if (err) { bad(`${what}: ${err}`); break; }
  if (!ok(st)) bad(`${what}: el estado no es el esperado (${JSON.stringify(flagsOf(st))}, inventario ${st.inventory.join(', ')})`);
  await stageFrame(what, 2);
}
{
  const st = await qaState();
  const lc = st.lastChoices ?? [];
  if (!lc.some((c) => /vet bill/i.test(c.text))) bad(`con la factura, la respuesta buena tendría que estar en las opciones: ${JSON.stringify(lc)}`);
  if (!st.flags.dooris_met || !st.flags.anon_call_1) bad('el primer contacto no dejó dooris_met y anon_call_1');
}

// ── 2) El tercer factor, a ritmo de jugador ─────────────────────────────────────────────────────────────────
// Como `__qa.use`, pero sin cerrar los textos solos: verbo USE, el Ledger en el inventario y un clic en el teclado.
const started = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const ui = g.scene.getScene('UIScene');
  const panel = ui.getScummUI();
  panel.clearSelectedItem();
  if (panel.getSelectedVerb() !== 'USE') panel.selectVerb('USE');
  if (!panel.clickInventoryItem('ledger') || panel.getSelectedItem()?.id !== 'ledger') return 'no se pudo elegir el Ledger';
  const hs = g.registry.get('sceneData').regions.hotspots.find((h) => h.id === 'hs_keypad');
  return gs.qaTapHotspot(hs) ?? null;
});
if (started) bad(`USE Ledger → teclado: ${started}`);

/** Lo que hay en pantalla: texto (y quién), elección pendiente, escena y si el juego está ocupado. */
const probe = () => page.evaluate(() => {
  const st = window.__qa.state();
  return { scene: st.scene, text: st.speech?.text ?? null, speaker: st.speech?.speaker ?? null, choice: !!st.choices, busy: st.busy ?? [], cinematic: !!st.cinematic?.active };
});
const seen = [];
let lastText = null;
const t0 = Date.now();
let stills = { hello: false, question: false, open: false };
while (Date.now() - t0 < 90000) {
  const r = await probe();
  if (r.scene === 'lobby') break;
  if (r.text && r.text !== lastText) {
    lastText = r.text;
    seen.push({ speaker: r.speaker, text: r.text });
    report.finale.push({ speaker: r.speaker, text: r.text, at: Date.now() - t0 });
    const label = `${r.speaker ?? 'Dex'}: «${r.text.length > 70 ? `${r.text.slice(0, 67)}…` : r.text}»`;
    if (!stills.hello && /Ledger detected/i.test(r.text)) { stills.hello = true; await demo.still('dooris-hello'); }
    if (!stills.open && /One factor was a duck/i.test(r.text)) { stills.open = true; await demo.still('dooris-open'); }
    // Lo que tarda en leerse (sin voz en la demo): ~45 ms por carácter, 1,2-4 s
    await stageFrame(label, 2);
    await demo.sleep(Math.min(4000, Math.max(1200, r.text.length * 45)));
    await stageFrame(label);
    await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
    await demo.sleep(250);
    continue;
  }
  if (r.choice) {
    // No debería haber elección: la pregunta ya está respondida (gate → entering). Si la hay, salir del árbol.
    if (!stills.question) { stills.question = true; await demo.still('dooris-question'); }
    const opts = await page.evaluate(() => window.__qa.state().choices);
    bad(`DOORIS volvió a pedir una elección con los tres factores: ${JSON.stringify(opts)}`);
    await page.evaluate(() => {
      const cp = window.__game.scene.getScene('UIScene').getChoicePanel();
      const o = cp.getOptions();
      cp.choose(Math.max(0, o.findIndex((x) => /come back/i.test(x.text))));
    });
    await demo.sleep(300);
    continue;
  }
  await stageFrame(r.cinematic ? 'fundido al lobby…' : 'DOORIS…');
  await demo.sleep(200);
}
if (!stills.question) {
  // La captura de la pregunta se hace en otra partida más abajo (aquí no debe aparecer); se deja constancia
  stills.question = 'n/a';
}

// Llegada al lobby: la apertura del capítulo 2 (A3.2) corre sola; se filma un par de segundos y se deja libre
await page.waitForFunction(() => window.__game.registry.get('currentSceneId') === 'lobby', { timeout: 30000, polling: 200 }).catch(() => bad('no se llegó al lobby en 30 s'));
await stageFrame('lobby: capítulo 2 (Penny mira desde el mostrador)', 3);
await demo.sleep(1500);
await stageFrame('lobby · apertura del capítulo 2', 3);
await demo.still('lobby');
if (!(await demo.settle({ tap: [422, 40] }))) bad('el lobby no quedó libre');
const end = await qaState();
report.end = { scene: end.scene, flags: flagsOf(end) };
if (end.scene !== 'lobby') bad(`escena final ${end.scene}, se esperaba lobby`);
for (const f of ['dooris_pin_ok', 'dooris_question_ok', 'dooris_key_ok', 'door_unlocked', 'chapter_1_complete']) {
  if (!end.flags[f]) bad(`falta la flag ${f} al acabar el capítulo`);
}
if (!seen.some((l) => /Ledger detected/i.test(l.text))) bad('no se vio «Ledger detected…»');
if (!seen.some((l) => /One factor was a duck/i.test(l.text))) bad('no se vio «One factor was a duck»');
if (!seen.some((l) => /dooris/i.test(l.speaker ?? ''))) bad('ninguna frase salió con el speaker DOORIS');
await stageFrame('Capítulo 1 completo', 3);

// ── 3) La pregunta de seguridad, para la captura: partida nueva, sin factura la opción buena no está ──────
await demo.openScene('outside');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: [422, 40] }))) bad('outside (segunda partida) no quedó libre');
const askedWithout = await page.evaluate(() => window.__qa.act('TALK', 'hs_keypad', ['come back']).then((s) => ({ ok: true, choices: s.lastChoices }), (e) => ({ ok: false, err: String(e?.message || e) })));
if (!askedWithout.ok) bad(`TALK teclado sin factura: ${askedWithout.err}`);
else if ((askedWithout.choices ?? []).some((c) => /vet bill/i.test(c.text))) bad(`sin la factura la respuesta buena no debería estar: ${JSON.stringify(askedWithout.choices)}`);
report.withoutBill = askedWithout;
// Con la factura: la pregunta en pantalla (sin responder) para la captura
await page.evaluate(() => window.__qa.act('OPEN', 'hs_mailbox'));
const asked = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const ui = g.scene.getScene('UIScene');
  ui.getScummUI().clearSelectedItem();
  ui.getScummUI().selectVerb('TALK');
  const hs = g.registry.get('sceneData').regions.hotspots.find((h) => h.id === 'hs_keypad');
  return gs.qaTapHotspot(hs) ?? null;
});
if (asked) bad(`TALK teclado con factura: ${asked}`);
const t1 = Date.now();
let gotChoice = false;
while (Date.now() - t1 < 40000) {
  const r = await probe();
  if (r.choice) { gotChoice = true; break; }
  if (r.text) {
    await stageFrame(`${r.speaker ?? 'Dex'}: «${r.text.length > 70 ? `${r.text.slice(0, 67)}…` : r.text}»`);
    await demo.sleep(900);
    await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
  }
  await demo.sleep(200);
}
if (!gotChoice) bad('la pregunta de seguridad no llegó a enseñar sus opciones');
else {
  const opts = await page.evaluate(() => window.__qa.state().choices);
  report.withBill = opts;
  if (!opts.some((c) => /vet bill/i.test(c.text))) bad(`con la factura falta la respuesta buena: ${JSON.stringify(opts)}`);
  if (!opts.some((c) => /password123/.test(c.text))) bad('falta la opción falsa password123');
  await demo.still('dooris-question');
  await stageFrame('pregunta de seguridad: la respuesta buena solo con la factura', 3);
  await page.evaluate(() => {
    const cp = window.__game.scene.getScene('UIScene').getChoicePanel();
    cp.choose(cp.getOptions().findIndex((x) => /come back/i.test(x.text)));
  });
}
await page.evaluate(() => window.__qa.dismissAll()).catch(() => {});

await demo.end();
if (pageErrors.length) bad(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
report.problems = problems;
writeFileSync(join(demo.dir, 'chapter1.json'), JSON.stringify(report, null, 2));
console.log(`final del capítulo 1: ${seen.length} frases filmadas · flags ${JSON.stringify(report.end?.flags ?? {})}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

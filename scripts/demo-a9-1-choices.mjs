// Demo de A9.1 + A9.3 (plan SCUMM): elecciones de diálogo completas en móvil y franja de logro que no pisa nada.
// En 844x390 (apaisado) y 390x844 (vertical), con ?qa=1:
//   1) abre los diálogos de Chad (recovery_pool, duelo de FUD con todas las réplicas aprendidas: hub y primer asalto),
//      PZ-BOT (treatment_room), DOORIS (outside), Penny (lobby) y Dr. Satoshi (clinic_interior) y, en cada elección,
//      mide con ChoicePanel.getOptionBoxes(): FALLA si alguna opción queda fuera de pantalla o del panel, mide menos de
//      40 px de alto, la letra baja de 11 px, el número de cajas no es el de opciones o aparece «More...»;
//   2) un panel sintético de 7 réplicas largas (el peor caso) con las mismas comprobaciones;
//   3) A9.3: lanza un logro cuando la frase de Dex YA está en pantalla: FALLA si la franja aparece con una frase en
//      pantalla (lo mira un vigía cada 50 ms desde el instante en que se lanza), si su caja pisa la de una frase que
//      coincida después, la franja de botones de arriba (32 px) o el panel de verbos; y si el título de escena se sale.
// Capturas: `<vista>-<diálogo>.png`, `<vista>-sintetico.png`, `<vista>-logro.png`. Informe en `choices.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-1-choices
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 4, width: 640 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const bad = (m) => { problems.push(m); console.error(`PROBLEMA: ${m}`); };
const report = { views: [] };

const DIALOGUES = [
  { tag: 'chad', scene: 'recovery_pool', npcId: 'chad_fud', treeId: 'chad_fud', depth: 2,
    flags: ['fud_r1', 'fud_r2', 'fud_r3', 'fud_r4', 'fud_r5', 'fud_r6'] },
  { tag: 'pzbot', scene: 'treatment_room', npcId: 'pzbot_final', treeId: 'pzbot_final', depth: 1, flags: [] },
  { tag: 'dooris', scene: 'outside', npcId: 'dooris', treeId: 'dooris_auth', depth: 1, flags: [] },
  { tag: 'penny', scene: 'lobby', npcId: 'npc_receptionist', treeId: 'receptionist_intro', depth: 1, flags: [] },
  { tag: 'satoshi', scene: 'clinic_interior', npcId: 'npc_dr_satoshi', treeId: 'dr_satoshi_intro', depth: 1, flags: [] },
];

/** Mide el panel de elecciones en pantalla. */
const measure = () => page.evaluate(() => {
  const ui = window.__game.scene.getScene('UIScene');
  const cp = ui.getChoicePanel();
  const st = window.__qa.state();
  const texts = [];
  const walk = (c) => { for (const o of c.list ?? []) { if (o.type === 'Text') texts.push(o.text); if (o.list) walk(o); } };
  walk(cp.getRoot());
  const L = cp.getLayout();
  return {
    vw: window.__game.scale.width, vh: window.__game.scale.height,
    options: st.choices?.map((o) => o.text) ?? null,
    boxes: cp.getOptionBoxes(), fontSize: L?.fontSize ?? null, columns: L?.columns ?? null,
    top: L?.top ?? null, height: L?.height ?? null, scroll: L?.scroll ?? null, texts,
  };
});

function checkChoices(view, what, m) {
  const where = `${view} ${what}`;
  if (!m.options) { bad(`${where}: no hay elección en pantalla`); return; }
  if (m.boxes.length !== m.options.length) bad(`${where}: ${m.boxes.length} cajas para ${m.options.length} opciones`);
  if (m.texts.some((t) => /More\.\.\.|More…/.test(t))) bad(`${where}: aparece «More...»`);
  if ((m.fontSize ?? 0) < 11) bad(`${where}: letra de ${m.fontSize} px`);
  for (const b of m.boxes) {
    if (!b.visible) bad(`${where}: la opción ${b.index} no se ve entera dentro del panel`);
    if (b.h < 40) bad(`${where}: la opción ${b.index} mide ${b.h} px de alto`);
    if (b.x < 0 || b.y < 0 || b.x + b.w > m.vw + 0.5 || b.y + b.h > m.vh + 0.5) bad(`${where}: la opción ${b.index} se sale de la pantalla`);
  }
}

/** Pasa frases con toques hasta que sale una elección (o se acaba el tiempo). */
async function untilChoice(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await page.evaluate(() => { const s = window.__qa.state(); return { choice: !!s.choices, text: s.speech?.text ?? null }; });
    if (r.choice) { await demo.sleep(400); return true; }
    if (r.text) await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
    await demo.shot();
    await demo.sleep(350);
  }
  return false;
}

for (const view of [{ id: '844x390', width: 844, height: 390, tap: [422, 40] }, { id: '390x844', width: 390, height: 844, tap: [195, 60] }]) {
  await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const v = { view: view.id, dialogues: [] };
  report.views.push(v);

  for (const d of DIALOGUES) {
    await demo.openScene(d.scene);
    await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
    if (!(await demo.settle({ tap: view.tap }))) { bad(`${view.id} ${d.tag}: ${d.scene} no quedó libre`); continue; }
    await page.evaluate((flags) => window.__qa.runScript(flags.map((f) => ({ op: 'setFlag', flag: f, value: true }))), d.flags);
    // Sin await: el script no acaba hasta que se elige
    await page.evaluate((npcId, treeId) => { window.__qa.runScript([{ op: 'dialogue', npcId, treeId }]).catch(() => {}); }, d.npcId, d.treeId);
    for (let level = 1; level <= d.depth; level++) {
      if (!(await untilChoice())) { bad(`${view.id} ${d.tag}: no salió la elección ${level}`); break; }
      const m = await measure();
      checkChoices(view.id, `${d.tag}#${level}`, m);
      v.dialogues.push({ tag: d.tag, level, columns: m.columns, fontSize: m.fontSize, top: m.top, height: m.height, scroll: m.scroll, options: m.options, boxes: m.boxes });
      console.log(`${view.id} · ${d.tag}#${level}: ${m.options?.length} opciones, ${m.columns} col., letra ${m.fontSize}, panel ${m.height} px${m.scroll ? ' (scroll)' : ''}`);
      await demo.film(800);
      await demo.still(`${view.id}-${d.tag}${level > 1 ? `-${level}` : ''}`);
      // Primera opción (en Chad, «Let's duel.» lleva al primer asalto)
      await page.evaluate(() => window.__game.scene.getScene('UIScene').getChoicePanel().choose(0));
      await demo.sleep(300);
    }
  }

  // Peor caso: 7 réplicas largas a la vez
  await page.evaluate(() => {
    const cp = window.__game.scene.getScene('UIScene').getChoicePanel();
    const long = ['A broken clock is right twice a day. You\'re on a streak of zero.', 'Still more detail than your exit plan.',
      'At least mine float. Yours sank in a kiddie pool.', 'Then today they\'ll hear you lose.',
      'And you sold the bottom so often, they gave you a loyalty card.', 'I can tell. They left the receipts floating in the pool.',
      'Uh... no they\'re not?'];
    cp.show(long.map((text, i) => ({ text, enabled: i !== 6, used: i === 1 })));
  });
  await demo.sleep(400);
  const syn = await measure();
  // El sintético no pasa por el DialogueSystem: las opciones salen de getOptions()
  syn.options = await page.evaluate(() => window.__game.scene.getScene('UIScene').getChoicePanel().getOptions().map((o) => o.text));
  checkChoices(view.id, 'sintético', syn);
  v.dialogues.push({ tag: 'sintetico', columns: syn.columns, fontSize: syn.fontSize, height: syn.height, scroll: syn.scroll, boxes: syn.boxes });
  console.log(`${view.id} · sintético: 7 opciones, ${syn.columns} col., panel ${syn.height} px${syn.scroll ? ' (scroll)' : ''}`);
  await demo.still(`${view.id}-sintetico`);
  await page.evaluate(() => window.__game.scene.getScene('UIScene').getChoicePanel().choose(0));
  await demo.sleep(400);

  // A9.3: logro durante una frase
  await demo.openScene('rooftop');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: view.tap }))) bad(`${view.id}: rooftop no quedó libre`);
  const title = await page.evaluate(() => {
    const t = window.__game.scene.getScene('GameScene').sceneTitleText;
    if (!t || !t.active) return null;
    const b = t.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height, vw: window.__game.scale.width };
  });
  if (title && (title.x < 0 || title.x + title.w > title.vw || title.y < 32)) bad(`${view.id}: el título de escena se sale (${JSON.stringify(title)})`);
  await page.evaluate(() => {
    window.__qa.runScript([{ op: 'say', text: 'This line is long enough to still be on screen when the achievement arrives. Patience, Gerald.' }]).catch(() => {});
  });
  // runScript espera a que el juego quede libre (≥ 600 ms) antes de lanzar la frase: el logro se lanza cuando la frase
  // YA está en pantalla (antes se lanzaba a los 500 ms, salía con la pantalla libre y la frase llegaba después)
  let spoke = false;
  for (let i = 0; i < 50 && !spoke; i++) {
    spoke = await page.evaluate(() => !!window.__qa.state().speech);
    if (!spoke) await demo.sleep(100);
  }
  if (!spoke) bad(`${view.id}: la frase de Dex no salió`);
  // Vigía en la página (cada 50 ms): instante en que aparece la franja, si en ESE instante había frase, y si alguna vez
  // la caja de la franja pisa la de una frase (una frase posterior puede coincidir, pero en otra zona)
  await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UIScene');
    const w = { emittedAt: performance.now(), appearedAt: null, speechAtAppear: null, overlaps: [] };
    window.__achWatch = w;
    let prev = null;
    w.timer = setInterval(() => {
      const rect = ui.getAchievementStatus().rect;
      const sp = window.__qa.state().speech;
      if (rect && !prev && w.appearedAt === null) { w.appearedAt = performance.now() - w.emittedAt; w.speechAtAppear = sp?.text ?? null; }
      if (rect && sp) {
        const box = { x: sp.x - sp.w / 2, y: sp.y, w: sp.w, h: sp.h };
        if (box.x < rect.x + rect.w && rect.x < box.x + box.w && box.y < rect.y + rect.h && rect.y < box.y + box.h) {
          if (w.overlaps.length < 3) w.overlaps.push({ rect, speech: box, text: sp.text });
        }
      }
      prev = rect;
    }, 50);
    ui.events.emit('showAchievement', 'Demo achievement');
  });
  await demo.sleep(600);
  const during = await page.evaluate(() => ({ speech: window.__qa.state().speech?.text ?? null, ...window.__game.scene.getScene('UIScene').getAchievementStatus() }));
  if (during.speech && during.rect) bad(`${view.id}: el logro salió con una frase en pantalla`);
  await demo.film(800);
  for (let i = 0; i < 10; i++) {
    const s = await page.evaluate(() => window.__qa.state().speech?.text ?? null);
    if (!s) break;
    await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
    await demo.sleep(400);
  }
  let ach = null;
  for (let i = 0; i < 20 && !ach; i++) {
    await demo.sleep(150);
    ach = await page.evaluate(() => {
      const st = window.__game.scene.getScene('UIScene').getAchievementStatus();
      return st.rect ? { ...st.rect, panelH: window.__game.registry.get('scummPanelHeight'), vh: window.__game.scale.height, speech: window.__qa.state().speech?.text ?? null } : null;
    });
  }
  if (!ach) bad(`${view.id}: el logro no salió al acabar la frase`);
  else {
    if (ach.y < 32) bad(`${view.id}: el logro pisa los botones de arriba (y=${ach.y})`);
    if (ach.y + ach.h > ach.vh - ach.panelH) bad(`${view.id}: el logro pisa el panel de verbos`);
    await demo.sleep(300);
    await demo.still(`${view.id}-logro`);
  }
  const watch = await page.evaluate(() => {
    const w = window.__achWatch;
    clearInterval(w.timer);
    return { appearedAt: w.appearedAt, speechAtAppear: w.speechAtAppear, overlaps: w.overlaps };
  });
  // Lo que importa: la franja no APARECE con una frase en pantalla, y si después coincide con una, no la pisa
  if (watch.speechAtAppear) bad(`${view.id}: el logro apareció con una frase en pantalla («${watch.speechAtAppear}»)`);
  if (watch.overlaps.length) bad(`${view.id}: la franja de logro pisa una frase (${JSON.stringify(watch.overlaps[0])})`);
  v.achievement = { during, shown: ach, title, watch };
  console.log(`${view.id} · logro: en cola durante la frase (${during.queued}), luego en ${JSON.stringify(ach)}; título ${JSON.stringify(title)}`);
  await demo.film(1500);
}

await demo.end();
writeFileSync(join(demo.dir, 'choices.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) await demo.fail(`${problems.length} problema(s)`);
console.log('A9.1/A9.3: todas las opciones a la vez en 844x390 y 390x844; el logro espera y no pisa nada');

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
//   4) A9.15: abre el duelo de Chad en 844x390 y GIRA el móvil con la elección abierta (390x844 y vuelta): tras cada
//      giro, las mismas comprobaciones que en 1) con el tamaño nuevo (antes el panel se quedaba con la colocación vieja);
//   5) A9.15: el logro de cada final de capítulo (cap. 1–4 y el GAME COMPLETE del 5), con su texto real y en la escena
//      donde se gana (outside, rooftop, basement, clinic_interior, epilogue_outside), en 844x390 y 1280x720: el mismo
//      vigía de 3) y, además, FALLA si el texto de la franja se sale de la franja o de la pantalla.
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

/**
 * A9.3 + A9.15: en `sceneId`, lanza el logro `achText` cuando una frase de Dex YA está en pantalla y comprueba que la
 * franja espera, no pisa frases, ni los botones de arriba, ni el panel de verbos, y que su texto cabe dentro de ella.
 */
async function checkAchievement(viewId, sceneId, achText, tap, shotLabel) {
  const where = `${viewId} ${sceneId}`;
  await demo.openScene(sceneId);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap }))) bad(`${where}: la escena no quedó libre`);
  const title = await page.evaluate(() => {
    const t = window.__game.scene.getScene('GameScene').sceneTitleText;
    if (!t || !t.active) return null;
    const b = t.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height, vw: window.__game.scale.width };
  });
  if (title && (title.x < 0 || title.x + title.w > title.vw || title.y < 32)) bad(`${where}: el título de escena se sale (${JSON.stringify(title)})`);
  await page.evaluate(() => {
    window.__qa.runScript([{ op: 'say', text: 'This line is long enough to still be on screen when the achievement arrives. Patience, Gerald.' }]).catch(() => {});
  });
  // runScript espera a que el juego quede libre (≥ 600 ms) antes de lanzar la frase: el logro se lanza cuando la frase
  // YA está en pantalla
  let spoke = false;
  for (let i = 0; i < 50 && !spoke; i++) {
    spoke = await page.evaluate(() => !!window.__qa.state().speech);
    if (!spoke) await demo.sleep(100);
  }
  if (!spoke) bad(`${where}: la frase de Dex no salió`);
  // Vigía en la página (cada 50 ms): instante en que aparece la franja, si en ESE instante había frase, y si alguna vez
  // la caja de la franja pisa la de una frase (una frase posterior puede coincidir, pero en otra zona)
  await page.evaluate((text) => {
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
    ui.events.emit('showAchievement', text);
  }, achText);
  await demo.sleep(600);
  const during = await page.evaluate(() => ({ speech: window.__qa.state().speech?.text ?? null, ...window.__game.scene.getScene('UIScene').getAchievementStatus() }));
  if (during.speech && during.rect) bad(`${where}: el logro salió con una frase en pantalla`);
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
      return st.rect ? { ...st.rect, textRects: st.textRects, panelH: window.__game.registry.get('scummPanelHeight'), vw: window.__game.scale.width, vh: window.__game.scale.height, speech: window.__qa.state().speech?.text ?? null } : null;
    });
  }
  if (!ach) bad(`${where}: el logro no salió al acabar la frase`);
  else {
    if (ach.y < 32) bad(`${where}: el logro pisa los botones de arriba (y=${ach.y})`);
    if (ach.y + ach.h > ach.vh - ach.panelH) bad(`${where}: el logro pisa el panel de verbos`);
    // A9.15: el texto («ACHIEVEMENT UNLOCKED» y el nombre) dentro de la franja y de la pantalla
    if (!ach.textRects?.length) bad(`${where}: la franja no informa de sus textos`);
    for (const r of ach.textRects ?? []) {
      if (r.x < -0.5 || r.x + r.w > ach.vw + 0.5) bad(`${where}: el texto del logro se sale de la pantalla a lo ancho (${JSON.stringify(r)})`);
      if (r.y < ach.y - 0.5 || r.y + r.h > ach.y + ach.h + 0.5) bad(`${where}: el texto del logro se sale de la franja (${JSON.stringify(r)} en ${JSON.stringify({ y: ach.y, h: ach.h })})`);
    }
    await demo.sleep(300);
    await demo.still(shotLabel);
  }
  const watch = await page.evaluate(() => {
    const w = window.__achWatch;
    clearInterval(w.timer);
    return { appearedAt: w.appearedAt, speechAtAppear: w.speechAtAppear, overlaps: w.overlaps };
  });
  // Lo que importa: la franja no APARECE con una frase en pantalla, y si después coincide con una, no la pisa
  if (watch.speechAtAppear) bad(`${where}: el logro apareció con una frase en pantalla («${watch.speechAtAppear}»)`);
  if (watch.overlaps.length) bad(`${where}: la franja de logro pisa una frase (${JSON.stringify(watch.overlaps[0])})`);
  console.log(`${where} · logro «${achText}»: en cola durante la frase (${during.queued}), luego en ${JSON.stringify(ach && { x: ach.x, y: ach.y, w: ach.w, h: ach.h })}`);
  return { scene: sceneId, text: achText, during: { speech: during.speech, queued: during.queued }, shown: ach, title, watch };
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
  v.achievement = await checkAchievement(view.id, 'rooftop', 'Demo achievement', view.tap, `${view.id}-logro`);
  await demo.film(1500);
}

// A9.15 (resto de A9.1): girar el móvil con una elección abierta
{
  const touch = { deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  await page.setViewport({ width: 844, height: 390, ...touch });
  const rot = { start: null, turns: [] };
  report.rotation = rot;
  await demo.openScene('recovery_pool');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [422, 40] }))) bad('giro: recovery_pool no quedó libre');
  await page.evaluate(() => window.__qa.runScript(['fud_r1', 'fud_r2', 'fud_r3', 'fud_r4', 'fud_r5', 'fud_r6'].map((f) => ({ op: 'setFlag', flag: f, value: true }))));
  await page.evaluate(() => { window.__qa.runScript([{ op: 'dialogue', npcId: 'chad_fud', treeId: 'chad_fud' }]).catch(() => {}); });
  if (!(await untilChoice())) bad('giro: no salió la elección de Chad');
  else {
    // Primer asalto (5 réplicas): el caso que más ocupa
    await page.evaluate(() => window.__game.scene.getScene('UIScene').getChoicePanel().choose(0));
    await demo.sleep(300);
    if (!(await untilChoice())) bad('giro: no salió el primer asalto');
    const m0 = await measure();
    checkChoices('844x390', 'giro (antes)', m0);
    rot.start = { columns: m0.columns, top: m0.top, height: m0.height, options: m0.options?.length };
    for (const [w, h] of [[390, 844], [844, 390]]) {
      await page.setViewport({ width: w, height: h, ...touch });
      await demo.sleep(900);
      const m = await measure();
      const view = `${w}x${h}`;
      if (m.vw !== w || m.vh !== h) bad(`giro a ${view}: el juego mide ${m.vw}x${m.vh}`);
      if (!m.options) bad(`giro a ${view}: la elección se cerró al girar`);
      checkChoices(view, 'giro (con la elección abierta)', m);
      rot.turns.push({ view, columns: m.columns, top: m.top, height: m.height, scroll: m.scroll, boxes: m.boxes });
      console.log(`giro a ${view} con la elección abierta: ${m.options?.length} opciones, ${m.columns} col., panel ${m.top}+${m.height} px`);
      await demo.film(600);
      await demo.still(`giro-${view}`);
    }
    // Sigue funcionando: se elige y la conversación sigue
    const chose = await page.evaluate(() => window.__game.scene.getScene('UIScene').getChoicePanel().choose(0));
    if (!chose) bad('giro: tras girar, la elección no se puede elegir');
    await demo.sleep(400);
  }
}

// A9.15 (resto de A9.3): el logro de los cinco finales de capítulo, en su escena y con su texto
const FINALS = [
  { cap: 1, scene: 'outside', text: 'CHAPTER 1 COMPLETE \u2014 Breaking & Entering' },
  { cap: 2, scene: 'rooftop', text: 'Chapter 2 Complete: The Receptionist' },
  { cap: 3, scene: 'basement', text: 'Chapter 3 Complete: Below the Surface' },
  { cap: 4, scene: 'clinic_interior', text: 'Chapter 4 Complete: The Mountain Path' },
  { cap: 5, scene: 'epilogue_outside', text: 'GAME COMPLETE: ZEROadventure II' },
];
report.finals = [];
for (const view of [
  { id: '844x390', width: 844, height: 390, tap: [422, 40], isMobile: true },
  { id: '1280x720', width: 1280, height: 720, tap: [640, 60], isMobile: false },
]) {
  // hasTouch también en escritorio: settle() pasa las frases tocando la pantalla
  await page.setViewport({ width: view.width, height: view.height, deviceScaleFactor: 1, isMobile: view.isMobile, hasTouch: true });
  for (const f of FINALS) {
    const r = await checkAchievement(view.id, f.scene, f.text, view.tap, `${view.id}-final-cap${f.cap}`);
    report.finals.push({ view: view.id, cap: f.cap, ...r });
  }
}

await demo.end();
writeFileSync(join(demo.dir, 'choices.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) bad(`errores de página: ${pageErrors.slice(0, 3).join(' | ')}`);
if (problems.length) await demo.fail(`${problems.length} problema(s)`);
console.log('A9.1/A9.3/A9.15: todas las opciones a la vez en 844x390 y 390x844, también al girar con la elección abierta; el logro espera y no pisa nada en rooftop y en los cinco finales');

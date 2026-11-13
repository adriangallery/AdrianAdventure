// Demo de A2.18 (plan SCUMM): «Give X to …» y «Use X with …» de dos pasos, con toques REALES (touchscreen de Chrome) en
// 844x390 (móvil apaisado, GIF) y 390x844 (vertical, capturas fijas), en el lobby:
//   1. toca GIVE y la factura del veterinario → la línea de acción queda «Give Vet Bill to...» (visible, dentro de la
//      pantalla) y NO contesta nada;
//   2. toca a Penny → Dex se acerca y contesta Penny (su pareja giveResponses.vet_bill);
//   3. toca USE y el tablón → «Use Fence Plank with...» → toca el póster (sin script) → respuesta de mal uso del tablón.
// «problemas: ninguno» si todo sale. Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-18-give-use
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const LANDSCAPE = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const PORTRAIT = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const TIMEOUT_MS = 20000;

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: LANDSCAPE });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

const st = () => page.evaluate(() => {
  const s = window.__qa.state();
  return { sentence: s.sentence, speech: s.speech?.text ?? null, verb: s.verb, fail: s.lastFailResponse, walkTarget: s.walkTarget, player: s.player };
});

/** Punto de pantalla (CSS) de un objeto del panel SCUMM: un verbo o la casilla de un objeto del inventario. */
const panelPoint = (what) => page.evaluate((what) => {
  const ui = window.__game.scene.getScene('UIScene').scummUI;
  let obj = null;
  if (what.verb) obj = ui.verbTexts.get(what.verb);
  else {
    const items = ui.inventory.getItems();
    const i = items.findIndex((it) => it.id === what.item);
    const slots = ui.invContainer.list.filter((o) => o.type === 'Rectangle');
    obj = i >= 0 ? slots[i] ?? null : null;
  }
  if (!obj) return null;
  const b = obj.getBounds();
  const r = window.__game.canvas.getBoundingClientRect();
  const k = r.width / window.__game.scale.width;
  return { x: r.left + b.centerX * k, y: r.top + b.centerY * k };
}, what);

/** Caja (CSS) de la línea de acción, para comprobar que se ve entera en la pantalla. */
const actionLineBox = () => page.evaluate(() => {
  const ui = window.__game.scene.getScene('UIScene').scummUI;
  const b = ui.actionLine.getBounds();
  const r = window.__game.canvas.getBoundingClientRect();
  const k = r.width / window.__game.scale.width;
  return { left: r.left + b.left * k, right: r.left + b.right * k, top: r.top + b.top * k, bottom: r.top + b.bottom * k, vw: innerWidth, vh: innerHeight, text: ui.actionLine.text };
});

/** Punto de pantalla (CSS) de un punto del fondo en % y si cae dentro de la escena visible (no en el panel). */
const screenOf = (pt) => page.evaluate((pt) => {
  const gs = window.__game.scene.getScene('GameScene');
  const s = gs.coordSystem.pctToScreen(pt.x, pt.y);
  const cam = gs.cameras.main;
  const r = window.__game.canvas.getBoundingClientRect();
  const k = r.width / gs.scale.width;
  const panel = window.__game.registry.get('scummPanelHeight') ?? 0;
  const x = r.left + (s.x - cam.scrollX) * k;
  const y = r.top + (s.y - cam.scrollY) * k;
  return { x, y, inside: x >= 12 && x <= innerWidth - 12 && y >= 40 && y <= r.top + (gs.scale.height - panel) * k - 8 };
}, pt);

async function touch(p) {
  await page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
  await demo.sleep(120);
}

async function waitStill(film) {
  const t0 = Date.now();
  await demo.sleep(250);
  while (Date.now() - t0 < TIMEOUT_MS) {
    if (film) await demo.shot(); else await demo.sleep(200);
    const moving = await page.evaluate(() => window.__game.scene.getScene('GameScene').player.isMoving());
    if (!moving) return Date.now() - t0;
  }
  return null;
}

/** Espera a que salga una frase que case con `re`; devuelve el estado (o null). */
async function waitSpeech(re, film) {
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT_MS) {
    if (film) await demo.shot(); else await demo.sleep(250);
    const s = await st();
    if (s.speech && re.test(s.speech)) return s;
  }
  return null;
}

/** Toca un objetivo de la escena; si no entra en pantalla (vertical), antes anda hacia él con la API. */
async function tapScene(pt, film) {
  let s = await screenOf(pt);
  if (!s.inside) {
    await page.evaluate((pt) => {
      // andar SIN tocar el panel (la frase pendiente no se puede perder): directo al personaje
      window.__game.scene.getScene('GameScene').player.walkToPct(pt.x, 92);
    }, pt);
    await waitStill(film);
    s = await screenOf(pt);
  }
  if (!s.inside) return false;
  await touch(s);
  return true;
}

async function sentenceStep(tag, film, verb, item, re) {
  const label = `${tag} ${verb} + ${item}`;
  const v = await panelPoint({ verb });
  const it = await panelPoint({ item });
  if (!v || !it) { problems.push(`${label}: no se encuentra el verbo o la casilla en el panel`); return false; }
  await touch(v);
  if (film) await demo.shot();
  await touch(it);
  for (let i = 0; i < (film ? 6 : 1); i++) { if (film) await demo.shot(); else await demo.sleep(300); }
  const s = await st();
  const box = await actionLineBox();
  report.push({ vp: tag, step: `${verb} ${item}`, sentence: s.sentence, actionLine: box, speech: s.speech });
  console.log(`${label}: «${s.sentence?.text}» pending=${s.sentence?.pending} (línea ${Math.round(box.left)}..${Math.round(box.right)} de ${box.vw}, y ${Math.round(box.top)})`);
  if (!s.sentence?.pending || !re.test(s.sentence.text)) problems.push(`${label}: la frase no queda a medias: ${JSON.stringify(s.sentence)}`);
  if (s.speech) problems.push(`${label}: contestó al pulsar el objeto: «${s.speech}»`);
  if (box.left < 0 || box.right > box.vw || box.top < 0 || box.bottom > box.vh) problems.push(`${label}: la línea de acción se sale de la pantalla: ${JSON.stringify(box)}`);
  await demo.still(`${tag}-${verb.toLowerCase()}-${item}-pendiente`);
  return true;
}

for (const [tag, vp] of [['844x390', LANDSCAPE], ['390x844', PORTRAIT]]) {
  const film = vp === LANDSCAPE;
  await page.setViewport(vp);
  await demo.openScene('lobby');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  await page.evaluate(() => window.__qa.dismissAll());
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 60] }))) problems.push(`${tag}: la escena no quedó libre`);
  await page.evaluate(() => window.__qa.runScript([
    { op: 'addItem', id: 'vet_bill', name: 'Vet Bill' },
    { op: 'addItem', id: 'fence_plank', name: 'Fence Plank' },
    { op: 'addItem', id: 'ledger', name: 'Ledger' },
  ]));
  // el panel desplegado (en móvil se recuerda plegado entre partidas)
  await page.evaluate(() => { const ui = window.__game.scene.getScene('UIScene').scummUI; if (!ui.isExpanded()) ui.expand(); });
  await demo.sleep(600);
  await page.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.resetSelection());

  // 1-2. Give Vet Bill to Penny
  if (await sentenceStep(tag, film, 'GIVE', 'vet_bill', /^Give .+ to\.\.\.$/)) {
    const p = await page.evaluate(() => {
      const n = window.__game.scene.getScene('GameScene').npcs.find((x) => x.npcId === 'npc_receptionist');
      return n ? { x: n.pctPosition.x, y: n.pctPosition.y - 8 } : null;
    });
    if (!p || !(await tapScene(p, film))) problems.push(`${tag}: Penny no se puede tocar`);
    else {
      const s = await waitSpeech(/Named Gerald/i, film);
      if (film) for (let i = 0; i < 6; i++) await demo.shot();
      report.push({ vp: tag, step: 'GIVE vet_bill → Penny', fail: s?.fail ?? null, speech: s?.speech ?? null });
      console.log(`${tag} Give Vet Bill to Penny: ${s ? `«${s.speech}» (${s.fail?.bag})` : 'SIN RESPUESTA'}`);
      if (!s) problems.push(`${tag}: Penny no contestó a la factura`);
      else if (s.fail?.kind !== 'item-npc' || s.fail?.verb !== 'GIVE' || s.sentence?.pending) problems.push(`${tag}: respuesta inesperada ${JSON.stringify(s)}`);
      await demo.still(`${tag}-give-penny`);
    }
    await page.evaluate(() => window.__qa.dismissAll());
  }

  // 3. Use Fence Plank with Wall Poster (sin script)
  await demo.settle({ tap: [Math.round(vp.width / 2), 60] });
  if (await sentenceStep(tag, film, 'USE', 'fence_plank', /^Use .+ with\.\.\.$/)) {
    if (!(await tapScene({ x: 48.8, y: 37 }, film))) problems.push(`${tag}: el póster no se puede tocar`);
    else {
      const s = await waitSpeech(/plank/i, film);
      if (film) for (let i = 0; i < 6; i++) await demo.shot();
      report.push({ vp: tag, step: 'USE fence_plank → hs_poster', fail: s?.fail ?? null, speech: s?.speech ?? null });
      console.log(`${tag} Use Fence Plank with Poster: ${s ? `«${s.speech}» (${s.fail?.bag})` : 'SIN RESPUESTA'}`);
      if (!s) problems.push(`${tag}: el póster no contestó al tablón`);
      else if (s.fail?.kind !== 'item-hotspot' || s.fail?.target !== 'hs_poster') problems.push(`${tag}: respuesta inesperada ${JSON.stringify(s.fail)}`);
      await demo.still(`${tag}-use-poster`);
    }
    await page.evaluate(() => window.__qa.dismissAll());
  }
}

await demo.end();
writeFileSync(join(demo.dir, 'give-use.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join('\n') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

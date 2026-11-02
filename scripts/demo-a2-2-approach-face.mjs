// Demo de A2.2 (regla visual del plan SCUMM): acercarse al objetivo y girarse hacia él.
// En el lobby (?qa=1):
//   1) TALK a la recepcionista: el personaje anda hasta la distancia de conversación (lo más cerca del mostrador que
//      deja la zona caminable), se gira hacia ella (izquierda) y empieza el diálogo.
//   2) LOOK a la puerta principal (lejos, a la derecha): NO anda; solo se gira (derecha) y mira.
//   3) PICK del abrigo: anda hasta debajo, se gira de espaldas (está colgado en la pared, por encima) y lo registra.
// El GIF pinta el punto de llegada (amarillo) y el rastro del personaje (verde).
// Comprueba por la API de QA (`state().facing`, `state().walkTarget`, `state().player`) que:
//   - TALK anduvo hasta `walkTarget.walkTo` (cerca del mostrador) y mira «left» al empezar a hablar;
//   - LOOK no movió al personaje (ni una centésima) y lo dejó mirando «right»;
//   - PICK anduvo hasta su `walkTo` y mira «back» al ejecutar.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-2-approach-face
import { startDemo } from './lib/demo.mjs';

const SCENE = 'lobby';
const NPC = 'npc_receptionist';
const FAR = 'hs_frontdoor';
const PICK = 'hs_coat';

const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
const pageErrors = [];
// Solo excepciones sin capturar: los console.error de red (web3, Alchemy sin clave) no son de esta demo
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const fmt = (p) => (p ? `${p.x.toFixed(2)},${p.y.toFixed(2)}` : '?');

async function open() {
  await demo.openScene(SCENE);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle())) await demo.fail('La escena no quedó libre');
  // Capa de dibujo: punto de llegada y rastro del personaje
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const g = gs.add.graphics().setDepth(60);
    window.__trail = [];
    const rec = () => window.__trail.push({ x: gs.player.pctX, y: gs.player.pctY });
    gs.events.on('postupdate', rec);
    window.__demoDraw = () => {
      const cs = gs.coordSystem;
      const P = (p) => cs.pctToScreen(p.x, p.y);
      g.clear();
      const trail = window.__trail.slice(-400);
      if (trail.length > 1) {
        g.lineStyle(3, 0x30ff60, 0.9).beginPath();
        trail.forEach((p, i) => { const s = P(p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
        g.strokePath();
      }
      const wt = window.__qa.state().walkTarget;
      if (wt?.walkTo) {
        const s = P(wt.walkTo);
        g.lineStyle(3, 0xffe040, 1).strokeCircle(s.x, s.y, 8);
      }
    };
  });
}

/** Lanza una acción de la API de QA sin esperarla; graba hasta que `until(state)` o hasta que la promesa termine. */
async function filmAction(start, until, maxMs = 20000) {
  await page.evaluate(start);
  const t0 = Date.now();
  let hit = null;
  while (Date.now() - t0 < maxMs) {
    const r = await page.evaluate(async () => {
      window.__demoDraw();
      const st = window.__qa.state();
      const settled = await Promise.race([window.__demoAct, new Promise((res) => setTimeout(() => res('pending'), 0))]);
      return { st, settled };
    });
    await demo.shot();
    if (until(r.st)) { hit = r.st; break; }
    if (r.settled !== 'pending') return { st: r.st, settled: r.settled, hit: null };
  }
  return { st: hit, settled: 'pending', hit };
}

/** Cierra el diálogo en curso: textos con el toque sintético y elecciones con una salida (o la primera opción). */
async function closeDialogue() {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const game = window.__game;
    const gs = game.scene.getScene('GameScene');
    const ui = game.scene.getScene('UIScene');
    const exit = /bye|leave|later|nothing|never ?mind|that'?s all|thanks|go now|see you/i;
    for (let i = 0; i < 300; i++) {
      const busy = game.registry.get('dialogueActive') || game.registry.get('dialogueShowing');
      const panel = ui.getChoicePanel();
      if (!busy && !panel.isAwaitingChoice()) return true;
      if (panel.isAwaitingChoice()) {
        const opts = panel.getOptions();
        let idx = opts.findIndex((o) => o.enabled && exit.test(o.text));
        if (idx < 0) idx = opts.findIndex((o) => o.enabled);
        if (idx < 0) return false;
        panel.choose(idx);
        await sleep(300);
        continue;
      }
      gs.qaSyntheticTap();
      await sleep(250);
    }
    return false;
  });
}

await open();
for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__demoDraw()); await demo.shot(); }
const st0 = await page.evaluate(() => window.__qa.state());
console.log(`inicio: jugador ${fmt(st0.player)} · mira ${st0.facing}`);

// 1) TALK a la recepcionista: graba hasta que empieza el diálogo (el texto o las opciones)
const talking = (st) => st.busy.some((b) => b === 'dialogue' || b === 'text' || b === 'choice');
const t = await filmAction(
  () => { window.__demoAct = window.__qa.talk('npc_receptionist').then(() => null, (e) => String(e?.message || e)); },
  talking,
);
if (!t.hit) {
  problems.push(`TALK: no empezó el diálogo (${t.settled ?? 'tiempo agotado'})`);
} else {
  const wt = t.hit.walkTarget;
  console.log(`TALK: walkTarget ${JSON.stringify(wt)} · jugador ${fmt(t.hit.player)} · mira ${t.hit.facing}`);
  if (!wt || wt.target !== NPC || wt.verb !== 'TALK') problems.push(`TALK: walkTarget inesperado ${JSON.stringify(wt)}`);
  else if (!wt.walkTo) problems.push('TALK: no anduvo (walkTo null)');
  else if (Math.hypot(t.hit.player.x - wt.walkTo.x, t.hit.player.y - wt.walkTo.y) > 0.6) problems.push(`TALK: no llegó a ${fmt(wt.walkTo)} (está en ${fmt(t.hit.player)})`);
  if (Math.hypot(t.hit.player.x - st0.player.x, t.hit.player.y - st0.player.y) < 5) problems.push('TALK: apenas se movió');
  if (t.hit.facing !== 'left') problems.push(`TALK: mira «${t.hit.facing}», se esperaba «left» (la recepcionista está a la izquierda)`);
}
for (let i = 0; i < 10; i++) await demo.shot();
await demo.still('talk');
const closed = await closeDialogue();
await page.evaluate(() => window.__demoAct);
if (!closed) {
  console.log('TALK: el diálogo no se pudo cerrar solo; se recarga la escena para seguir');
  await open();
}
if (!(await demo.settle({ cooldown: true }))) await demo.fail('La escena no quedó libre tras el diálogo');

// 2) LOOK a la puerta: no anda, solo se gira. Primero se le deja mirando a la izquierda (como tras hablar)
const before = await page.evaluate(() => window.__qa.state());
console.log(`antes de LOOK: jugador ${fmt(before.player)} · mira ${before.facing}`);
const l = await filmAction(
  () => { window.__demoAct = window.__qa.act('LOOK', 'hs_frontdoor').then(() => null, (e) => String(e?.message || e)); },
  () => false,
  20000,
);
if (l.settled) problems.push(`LOOK falló: ${l.settled}`);
const afterLook = await page.evaluate(() => window.__qa.state());
console.log(`LOOK: walkTarget ${JSON.stringify(afterLook.walkTarget)} · jugador ${fmt(afterLook.player)} · mira ${afterLook.facing}`);
if (!before.player || !afterLook.player || Math.hypot(afterLook.player.x - before.player.x, afterLook.player.y - before.player.y) > 0.01) {
  problems.push(`LOOK movió al jugador: ${fmt(before.player)} → ${fmt(afterLook.player)}`);
}
if (afterLook.walkTarget?.target !== FAR || afterLook.walkTarget?.walkTo !== null) problems.push(`LOOK: walkTarget inesperado ${JSON.stringify(afterLook.walkTarget)}`);
if (afterLook.facing !== 'right') problems.push(`LOOK: mira «${afterLook.facing}», se esperaba «right» (la puerta está a la derecha)`);
if (before.facing === afterLook.facing) problems.push(`LOOK: no se giró (ya miraba «${before.facing}»), la demo no prueba el giro`);
for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__demoDraw()); await demo.shot(); }
await demo.still('look');

// 3) PICK del abrigo: anda, se gira de espaldas y lo registra
const p = await filmAction(
  () => { window.__demoAct = window.__qa.act('PICK', 'hs_coat').then(() => null, (e) => String(e?.message || e)); },
  (st) => st.busy.includes('text') || st.busy.includes('script'),
);
const atPick = p.hit ?? (await page.evaluate(() => window.__qa.state()));
console.log(`PICK: walkTarget ${JSON.stringify(atPick.walkTarget)} · jugador ${fmt(atPick.player)} · mira ${atPick.facing}`);
const pw = atPick.walkTarget;
if (!pw || pw.target !== PICK || pw.verb !== 'PICK' || !pw.walkTo) problems.push(`PICK: walkTarget inesperado ${JSON.stringify(pw)}`);
else if (Math.hypot(atPick.player.x - pw.walkTo.x, atPick.player.y - pw.walkTo.y) > 0.6) problems.push(`PICK: no llegó a ${fmt(pw.walkTo)} (está en ${fmt(atPick.player)})`);
if (atPick.facing !== 'back') problems.push(`PICK: mira «${atPick.facing}», se esperaba «back» (el abrigo cuelga en la pared)`);
for (let i = 0; i < 8; i++) await demo.shot();
await demo.still('pick');
const pickErr = await page.evaluate(() => window.__demoAct);
if (pickErr) problems.push(`PICK falló: ${pickErr}`);
const final = await page.evaluate(() => window.__qa.state());
console.log(`final: inventario ${JSON.stringify(final.inventory)} · mira ${final.facing}`);
for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__demoDraw()); await demo.shot(); }
await demo.still('full');
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

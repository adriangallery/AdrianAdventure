// Demo de A7.2 (lote P2 del buzón del jugador) en móvil apaisado 844×390:
//  1) J-5 + J-6: TALK con Penny en el lobby: Dex se acerca al extremo del mostrador (no a la mesita de la planta) y
//     ningún texto queda bajo los botones de arriba ni encima de la cabeza de quien habla;
//  2) J-4: en outside, con las dos mitades, USE teclado da la pista de juntarlas; juntas, USE teclado teclea el PIN;
//  3) J-7: guardar en el slot 1, andar, cargar el slot 1: Dex vuelve a donde se guardó y el panel de verbos sigue abierto.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a7-2-buzon-p2
import { startDemo } from './lib/demo.mjs';
import * as SP from './lib/save-panel.mjs';

const demo = await startDemo(import.meta.url, {
  fps: 4, width: 640, viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
});
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };
const TOP_STRIP = 32 + 8; // TOP_UI_INSET + SPEECH_MARGIN (src/ui/speechLayout.ts)

/** Lanza una acción de QA (expresión que devuelve una promesa) sin esperarla y filma hasta que termina (o `max` ms). */
async function filmWhile(label, expr, max = 60000) {
  await page.evaluate(`(() => {
    window.__demoDone = false; window.__demoErr = null;
    Promise.resolve(${expr}).catch((e) => { window.__demoErr = String(e && e.message || e); })
      .finally(() => { window.__demoDone = true; });
  })()`);
  const end = Date.now() + max;
  while (Date.now() < end && !(await page.evaluate(() => window.__demoDone))) await demo.shot();
  const err = await page.evaluate(() => window.__demoErr);
  check(!err, `${label}${err ? `: ${err}` : ''}`);
}

/** Muestrea el texto hablado en la página (cada 100 ms) mientras dure la acción. */
const startSampler = () => page.evaluate(() => {
  window.__speech = [];
  window.__sampler = setInterval(() => {
    const s = window.__qa.state().speech;
    if (s) window.__speech.push({ text: s.text, speaker: s.speaker, x: s.x, y: s.y, w: s.w, h: s.h, mode: s.mode, head: s.head });
  }, 100);
});
const stopSampler = () => page.evaluate(() => { clearInterval(window.__sampler); return window.__speech; });

// ─── 1) Lobby: Penny ───────────────────────────────────────────────────────────────────────────────────────────────
await demo.openScene('lobby');
await demo.settle();
await demo.film(1500);
await startSampler();
await filmWhile('TALK Penny (come back later)', `window.__qa.talk('npc_receptionist', ['come back later'])`);
const samples = await stopSampler();
const pos = await page.evaluate(() => { const p = window.__game.scene.getScene('GameScene').player; return { x: p.pctX, y: p.pctY }; });
await demo.still('01-penny');
check(Math.abs(pos.x - 39.4) < 1.5 && Math.abs(pos.y - 94) < 1.5, `J-6: Dex habla con Penny junto al mostrador (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
const penny = samples.filter((s) => /penny/i.test(s.speaker ?? ''));
check(penny.length > 0, `J-5: se muestrearon ${penny.length} posiciones de texto de Penny`);
const under = samples.filter((s) => s.y + 1 < TOP_STRIP && !(s.mode === 'top'));
check(!under.length, `J-5: ningún texto sobre la cabeza empieza bajo los botones (${under.length} malos)`);
const tops = samples.filter((s) => s.mode === 'top' && s.y < TOP_STRIP);
check(!tops.length, `J-5: ningún texto arriba-centro pisa la franja de botones (${tops.length} malos)`);
const onHead = samples.filter((s) => s.head && s.y + s.h > s.head.headY + 2 && Math.abs(s.x - s.head.x) < s.w / 2 + 10);
check(!onHead.length, `J-5: ningún texto tapa la cabeza de quien habla (${onHead.length} malos${onHead[0] ? `: ${JSON.stringify(onHead[0])}` : ''})`);

// ─── 2) Outside: el PIN ────────────────────────────────────────────────────────────────────────────────────────────
await demo.openScene('outside');
await demo.settle();
for (const [verb, id] of [['USE', 'hs_porch_light'], ['PICK', 'hs_porch_light'], ['PULL', 'hs_fence']]) {
  await page.evaluate((v, t) => window.__qa.act(v, t), verb, id);
}
await page.evaluate(() => window.__qa.use('fence_plank', 'hs_chimney'));
await page.evaluate(() => window.__qa.dismissAll());
await startSampler();
await filmWhile('USE teclado con las dos mitades', `window.__qa.act('USE', 'hs_keypad', ['come back'])`);
const halves = await stopSampler();
check(halves.some((s) => /put the note back together/i.test(s.text)), 'J-4: con las mitades, Dex dice que hay que juntarlas');
await page.evaluate(() => window.__qa.combine('note_half_a', 'note_half_b'));
await page.evaluate(() => window.__qa.dismissAll());
await startSampler();
await filmWhile('USE teclado con la nota entera', `window.__qa.act('USE', 'hs_keypad', ['come back'])`);
const typed = await stopSampler();
await demo.still('02-pin');
const flags = await page.evaluate(() => window.__qa.state().flags);
check(flags.dooris_pin_ok === true && !flags.door_unlocked, 'J-4: USE teclado con code_note teclea el PIN (dooris_pin_ok)');
check(typed.some((s) => /7\.\.\. 3\.\.\. 1\.\.\. 4/.test(s.text)), 'J-4: se ve «7... 3... 1... 4.»');

// ─── 3) Guardar, andar, cargar ─────────────────────────────────────────────────────────────────────────────────────
const where = () => page.evaluate(() => {
  const p = window.__game.scene.getScene('GameScene').player;
  return { x: p.pctX, y: p.pctY, expanded: window.__game.scene.getScene('UIScene').getScummUI().isExpanded() };
});
const saved = await where();
await SP.openPanel(page);
await SP.tapSlot(page, 1);
check((await SP.waitStatus(page)).kind === 'ok', 'J-7: guardado en el slot 1');
await demo.film(1200);
await SP.closePanel(page);
const target = await page.evaluate((sx) => {
  for (const x of [72, 70, 75, 65, 25, 20]) for (const y of [92, 90, 94]) if (Math.abs(x - sx) > 20 && window.__qa.isWalkable(x, y)) return { x, y };
  return null;
}, saved.x);
check(!!target, `J-7: punto andable lejos del guardado: ${JSON.stringify(target)}`);
await filmWhile('andar lejos', `window.__qa.walk(${target?.x ?? 70}, ${target?.y ?? 92})`);
const moved = await where();
await SP.openPanel(page);
await SP.tab(page, 'load');
await SP.tapSlot(page, 1);
await demo.film(1200);
await SP.confirm(page, true);
await page.waitForFunction(() => !document.getElementById('save-load-overlay'), { timeout: 20000, polling: 200 });
await demo.sleep(1500);
await SP.waitInGame(page, 'outside');
await demo.film(2500);
const loaded = await where();
await demo.still('03-loaded');
console.log(`guardado ${JSON.stringify(saved)} · andó a ${JSON.stringify(moved)} · cargado ${JSON.stringify(loaded)}`);
check(Math.abs(moved.x - saved.x) > 10, 'J-7: Dex se alejó antes de cargar');
check(Math.abs(loaded.x - saved.x) < 2 && Math.abs(loaded.y - saved.y) < 2, 'J-7: tras cargar, Dex está donde se guardó');
check(loaded.expanded, 'J-7: tras cargar, el panel de verbos está desplegado');
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

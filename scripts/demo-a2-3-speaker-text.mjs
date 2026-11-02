// Demo de A2.3 (regla visual del plan SCUMM): el texto se pinta sobre la cabeza de quien habla, en su color.
// En el lobby (?qa=1), en 844x390 (móvil horizontal) y 390x844 (móvil vertical):
//   1) LOOK a la planta: el jugador habla; el texto va sobre SU cabeza, en el color del jugador (SPEECH_COLORS._player).
//   2) TALK a la recepcionista: anda hasta ella y su saludo va sobre la cabeza de ELLA, en su color (rosa).
//   3) Una línea del narrador (speaker «Narrator», solo en la demo): arriba-centro, como antes de A2.3.
// Comprueba por la API de QA (`state().speech`) que:
//   - el modo es `head` si quien habla se ve en pantalla (posición calculada aparte, desde el sprite y la cámara) y
//     `top` si no; el narrador siempre `top`, centrado en x y a la altura de siempre;
//   - sobre la cabeza: la cabeza queda bajo el bloque (|x − cabeza.x| ≤ ancho/2) y el bloque acaba por encima de
//     ella (salvo si está pegado al margen superior);
//   - el bloque cabe entero en la pantalla y el color es el del personaje.
// El GIF compone los dos viewports sobre un lienzo fijo (ffmpeg no admite fotogramas de distinto tamaño). Capturas
// fijas: `<viewport>-look.png`, `<viewport>-talk.png`, `<viewport>-narrator.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-3-speaker-text
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const SCENE = 'lobby';
const LOOK = 'hs_plant';
const NPC = 'npc_receptionist';
const COLORS = { player: '#ffffff', receptionist: '#ff9ad2', narrator: '#f0e8d8' };
const NARRATOR_LINE = 'Meanwhile, somewhere in the lobby, a narrator clears his throat.';
const VIEWPORTS = [
  { label: 'landscape-844x390', width: 844, height: 390, isMobile: true, hasTouch: true },
  { label: 'portrait-390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
];
const STAGE = { width: 900, height: 900 };

const demo = await startDemo(import.meta.url, { fps: 4, width: 600 });
const { page, browser } = demo;
const pageErrors = [];
// Solo excepciones sin capturar: los console.error de red (web3, Alchemy sin clave) no son de esta demo
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];

// Lienzo fijo para los fotogramas del GIF
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption) {
  const png = await page.screenshot();
  const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;font:15px monospace;color:#c8c0e8">
    <div style="margin-bottom:10px">${caption}</div>
    <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878"></body></html>`);
  await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
  // Una pestaña en segundo plano frena requestAnimationFrame y el bucle de Phaser: el juego vuelve al frente
  await page.bringToFront();
}

/** Texto en pantalla (state().speech) y, calculada aparte desde el sprite y la cámara, la cabeza de quien habla. */
const probe = (who) => page.evaluate((who) => {
  const game = window.__game;
  const gs = game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  const vp = { width: game.scale.width, height: game.scale.height };
  const speech = window.__qa.state().speech;
  let head = null;
  if (who === 'player') {
    const p = gs.player;
    if (p?.visible) head = { x: p.x - cam.scrollX, headY: p.y - p.displayHeight - cam.scrollY, footY: p.y - cam.scrollY };
  } else if (who) {
    const n = gs.npcs.find((x) => x.npcId === who);
    if (n?.visible) head = { x: n.x - cam.scrollX, headY: n.y - n.height * n.scaleY - cam.scrollY, footY: n.y - cam.scrollY };
  }
  const onScreen = !!head && head.x >= 0 && head.x <= vp.width && head.footY > 0 && head.headY < vp.height;
  return { speech, head, onScreen, vp };
}, who);

function checkSpeech(tag, r, { who, color, speaker }) {
  const bad = (m) => problems.push(`${tag}: ${m}`);
  const s = r.speech;
  if (!s) return bad('no hay texto en pantalla (state().speech null)');
  console.log(`${tag}: ${JSON.stringify({ ...s, text: s.text.slice(0, 40) })} · cabeza calculada ${JSON.stringify(r.head)} · se ve ${r.onScreen}`);
  if (speaker !== undefined && s.speaker !== speaker) bad(`speaker «${s.speaker}», se esperaba «${speaker}»`);
  if (s.color.toLowerCase() !== color) bad(`color ${s.color}, se esperaba ${color}`);
  const { width: W, height: H } = r.vp;
  if (s.x - s.w / 2 < -1 || s.x + s.w / 2 > W + 1) bad(`el texto se sale por los lados (x=${s.x}, w=${s.w}, pantalla ${W})`);
  if (s.y < -1 || s.y + s.h > H + 1) bad(`el texto se sale por arriba o por abajo (y=${s.y}, h=${s.h}, pantalla ${H})`);
  if (!who) {
    if (s.mode !== 'top') bad(`modo ${s.mode}, el narrador va arriba (top)`);
    if (Math.abs(s.x - W / 2) > 1) bad(`el narrador no está centrado (x=${s.x}, centro ${W / 2})`);
    if (s.y > Math.max(20, H * 0.06) + 4) bad(`el narrador no está arriba (y=${s.y})`);
    return;
  }
  if (!r.onScreen) {
    if (s.mode !== 'top') bad(`quien habla no se ve y el modo es ${s.mode} (se esperaba top)`);
    return;
  }
  if (s.mode !== 'head') return bad(`quien habla se ve y el modo es ${s.mode} (se esperaba head)`);
  if (!s.head || Math.abs(s.head.x - r.head.x) > 3 || Math.abs(s.head.headY - r.head.headY) > 3) {
    bad(`la cabeza del juego ${JSON.stringify(s.head)} no coincide con la calculada ${JSON.stringify(r.head)}`);
  }
  if (Math.abs(s.x - r.head.x) > s.w / 2 + 1) bad(`el texto no está sobre la cabeza (x=${s.x}, w=${s.w}, cabeza x=${r.head.x})`);
  const pinnedTop = s.y <= 8.5;
  if (!pinnedTop && s.y + s.h > r.head.headY + 1) bad(`el texto no acaba por encima de la cabeza (fondo ${s.y + s.h}, cabeza ${r.head.headY})`);
}

/**
 * Espera (grabando) a que el texto en pantalla cumpla `cond`; devuelve el último sondeo. Con `advance`, los textos
 * que no son el esperado (p. ej. el trigger de primera visita que pisa al andar) se pasan con el toque sintético.
 */
async function waitSpeech(who, cond, caption, { maxMs = 25000, advance = false } = {}) {
  const t0 = Date.now();
  let r = null;
  while (Date.now() - t0 < maxMs) {
    r = await probe(who);
    if (r.speech && cond(r.speech)) return r;
    await stageFrame(caption);
    if (advance && r.speech) await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
  }
  return r;
}

/** Cierra textos y diálogo como en la demo de A2.2: toque sintético y salida (o la primera opción). */
const closeDialogue = () => page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const game = window.__game;
  const gs = game.scene.getScene('GameScene');
  const ui = game.scene.getScene('UIScene');
  const exit = /bye|leave|later|nothing|never ?mind|that'?s all|thanks|go now|see you/i;
  for (let i = 0; i < 300; i++) {
    const busy = game.registry.get('dialogueActive') || game.registry.get('dialogueShowing');
    const panel = ui.getChoicePanel();
    if (!busy && !panel.isAwaitingChoice() && !gs.qaBusy().script) return true;
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

for (const vp of VIEWPORTS) {
  const { label, ...viewport } = vp;
  const cap = (what) => `${label} · ${what}`;
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  await demo.openScene(SCENE);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  await page.evaluate(() => document.fonts?.ready);
  if (!(await demo.settle({ tap: [Math.round(viewport.width / 2), 40] }))) await demo.fail(`${label}: la escena no quedó libre`);
  for (let i = 0; i < 2; i++) await stageFrame(cap('lobby'));

  // 1) LOOK: habla el jugador (texto 6 s en pantalla sin cerrarlo)
  await page.evaluate((id) => { window.__demoAct = window.__qa.act('LOOK', id, [], 6000).then(() => null, (e) => String(e?.message || e)); }, LOOK);
  const look = await waitSpeech('player', (s) => s.kind === 'player', cap('LOOK planta: habla el jugador'));
  await demo.sleep(400);
  const lookR = await probe('player');
  checkSpeech(`${label} LOOK`, lookR.speech ? lookR : look ?? lookR, { who: 'player', color: COLORS.player, speaker: null });
  await demo.still(`${label}-look`);
  for (let i = 0; i < 5; i++) await stageFrame(cap('LOOK planta: texto sobre el jugador, en su color'));
  const lookErr = await page.evaluate(() => window.__demoAct);
  if (lookErr) problems.push(`${label} LOOK falló: ${lookErr}`);
  if (!(await demo.settle({ tap: [Math.round(viewport.width / 2), 40], cooldown: true }))) await demo.fail(`${label}: la escena no quedó libre tras LOOK`);

  // 2) TALK a la recepcionista, como un clic (sin el avance rápido de la API, para que su saludo se quede en pantalla)
  await page.evaluate((id) => {
    const ui = window.__game.scene.getScene('UIScene');
    const gs = window.__game.scene.getScene('GameScene');
    ui.getScummUI().clearSelectedItem();
    ui.getScummUI().selectVerb('TALK');
    window.__demoTalk = gs.qaTapNpc(id);
  }, NPC);
  const talkWhy = await page.evaluate(() => window.__demoTalk);
  if (talkWhy) problems.push(`${label} TALK: el clic no llegó a la recepcionista: ${talkWhy}`);
  const talk = await waitSpeech(NPC, (s) => s.speaker === 'Receptionist', cap('TALK recepcionista'), { advance: true });
  await demo.sleep(500);
  const talkR = await probe(NPC);
  checkSpeech(`${label} TALK`, talkR.speech ? talkR : talk ?? talkR, { who: NPC, color: COLORS.receptionist, speaker: 'Receptionist' });
  await demo.still(`${label}-talk`);
  for (let i = 0; i < 6; i++) await stageFrame(cap('TALK: texto sobre la recepcionista, en su color'));
  if (!(await closeDialogue())) problems.push(`${label} TALK: el diálogo no se pudo cerrar`);
  if (!(await demo.settle({ tap: [Math.round(viewport.width / 2), 40], cooldown: true }))) await demo.fail(`${label}: la escena no quedó libre tras TALK`);

  // 3) Narrador: arriba-centro, como siempre
  await page.evaluate((line) => {
    window.__game.scene.getScene('UIScene').events.emit('say', line, 'Narrator', () => {});
  }, NARRATOR_LINE);
  await waitSpeech(null, (s) => s.speaker === 'Narrator', cap('narrador'), { maxMs: 5000 });
  await demo.sleep(500);
  checkSpeech(`${label} NARRADOR`, await probe(null), { who: null, color: COLORS.narrator, speaker: 'Narrator' });
  await demo.still(`${label}-narrator`);
  for (let i = 0; i < 5; i++) await stageFrame(cap('narrador: arriba-centro, como antes'));
  if (!(await closeDialogue())) problems.push(`${label} NARRADOR: el texto no se pudo cerrar`);
}

await stage.close().catch(() => {});
await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`${frame} fotogramas · problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

// Demo de A4.1 (regla visual del plan SCUMM): animación del protagonista. A2.15: Dex usa el rig 2D pre-renderizado
// (dex2d_*): andar arriba/abajo y hablar van en los fotogramas, sin balanceo por giro; el mono sigue como en A4.1.
// En el lobby (?qa=1), 1280x720 (el GIF: un recorte de 800x540 de la escena centrado en el jugador, con una línea de
// estado arriba) y luego 390x844 (capturas fijas):
//   1) anda de perfil hasta debajo del abrigo; sube hacia el fondo (Back-Left/Right alternando + balanceo) y baja hacia
//      la cámara (Front-Left/Right + balanceo);
//   2) habla: LOOK a la planta (texto del jugador 2,5 s en pantalla): cabeceo de perfil; y en una cinemática (A2.10) un
//      actorMove hacia el fondo y la misma frase de frente: cabeceo con las manos (Idle-1 / Front-*);
//   3) coge: PICK del abrigo (de espaldas): gesto de puntillas a la vez que el script;
//   4) reposo: espera dos tics (semilla fija con ?qa=1);
//   5) disfraz de mono con __qa.previewCostume('ape') (solo los sprites; ni inventario ni flags): baja y sube con los
//      fotogramas de perfil y el balanceo, y habla; vuelta al de la partida;
//   6) 390x844: sube y baja otra vez.
// Comprueba por la API de QA (`state().anim`, `state().facing`, `state().pixel`) que:
//   - en los tramos verticales `anim.dir` es «up»/«down» con texturas Back-*/Front-* (el mono, las de perfil) y se ve
//     el balanceo (giro ≠ 0); al llegar mira «back»/«front», sin giro, sin elevación y con la escala base (entera en
//     1280x720: `pixel.integer`);
//   - `anim.talking` es true con el texto del jugador abierto y false al cerrarlo, y entonces vuelve al reposo;
//   - el gesto del PICK se ve (`gesture`, elevación > 0) y acaba en reposo mirando «back»;
//   - salen dos tics de reposo sin cambiar `facing` ni la escala;
//   - previewCostume no da objetos ni pone `ape_costume_worn`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-1-player-anim
import { startDemo, sleep } from './lib/demo.mjs';

const SCENE = 'lobby';
const X = 55.5; // bajo el abrigo: tramo vertical libre (ni triggers ni blockedAreas)
const Y_FRONT = 98;
const Y_BACK = 85;
const PLANT_LINE = 'A tall plant in a ceramic pot. It looks thirsty. Really thirsty.'; // texto que ya existe (hs_plant LOOK)
const CLIP = { width: 800, height: 540 };

const demo = await startDemo(import.meta.url, { fps: 6, width: 640, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const fmtA = (a) => (a ? `dir ${a.dir} · ${a.texture} · giro ${a.angle}° · elevación ${a.liftPx}px · ×${a.scale} (base ×${a.baseScale})` : '?');
let filming = true;

async function open(width) {
  await demo.openScene(SCENE);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(width / 2), 40] }))) await demo.fail('La escena no quedó libre');
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
  });
}

/** Estado + línea de estado (DOM sobre el lienzo) + recorte centrado en el jugador; un fotograma si se graba. */
async function capture(label, { shot = filming } = {}) {
  const r = await page.evaluate((label, cw, ch) => {
    const st = window.__qa.state();
    const gs = window.__game.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const px = (gs.player.x - cam.scrollX) * cam.zoom;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(cw, vw);
    const h = Math.min(ch, vh);
    const x = Math.max(0, Math.min(vw - w, Math.round(px - w / 2)));
    let cap = document.getElementById('demo-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'demo-cap';
      cap.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:15px monospace;color:#fff;background:rgba(10,10,20,.72);padding:4px 8px;white-space:pre';
      document.body.appendChild(cap);
    }
    const a = st.anim;
    cap.style.left = `${x + 6}px`;
    cap.style.top = '6px';
    cap.textContent = `${label}\n${a ? `dir ${a.dir} · ${a.texture} · ${a.angle.toFixed(1)}° · lift ${a.liftPx}px · ×${a.scale}${a.talking ? ' · TALK' : ''}${a.gesture ? ' · GESTO' : ''}${a.idleTick ? ` · TIC ${a.idleTick}` : ''}` : ''}`;
    return { st, clip: { x, y: 0, width: w, height: h } };
  }, label, CLIP.width, CLIP.height);
  if (shot) await demo.shot({ clip: r.clip });
  return r;
}

/** Lanza una acción de __qa (sin esperarla) y graba/muestrea hasta que termine. `onState(st, clip)` en cada muestra. */
async function during(label, start, args = [], { maxMs = 45000, every = 0, onState } = {}) {
  await page.evaluate(start, ...args);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { st, clip } = await capture(label);
    if (onState) await onState(st, clip);
    if (await page.evaluate(() => window.__demoDone)) break;
    if (every) await sleep(every);
  }
  if (!(await page.evaluate(() => window.__demoDone))) return `no terminó en ${maxMs} ms`;
  return page.evaluate(() => window.__demoErr);
}

/** Unos fotogramas quietos */
async function hold(label, n = 4) {
  for (let i = 0; i < n; i++) await capture(label);
}

/** Tramo andado: muestrea dirección, texturas y giro mientras anda; comprueba la llegada. */
async function walkLeg(tag, label, x, y, want) {
  const seen = { dirs: new Set(), textures: new Set(), maxAngle: 0, still: false };
  // Muestreo dentro de la página, en cada fotograma: desde A2.11/A2.12 (pixelScale 7 en el lobby, 74 px de arte/s) el
  // tramo vertical dura ~1 s y las capturas (una cada ~300 ms) podían caer todas cerca del paso por cero del giro.
  await page.evaluate(() => {
    const s = (window.__demoSway = { dirs: [], textures: [], maxAngle: 0, on: true });
    const tick = () => {
      if (!s.on) return;
      const a = window.__qa.state().anim;
      if (a?.moving) {
        if (!s.dirs.includes(a.dir)) s.dirs.push(a.dir);
        if (!s.textures.includes(a.texture)) s.textures.push(a.texture);
        s.maxAngle = Math.max(s.maxAngle, Math.abs(a.angle));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const err = await during(label, (x, y) => window.__demoRun(window.__qa.walk(x, y)), [x, y], {
    onState: async (st, clip) => {
      const a = st.anim;
      if (!a?.moving) return;
      seen.dirs.add(a.dir);
      seen.textures.add(a.texture);
      seen.maxAngle = Math.max(seen.maxAngle, Math.abs(a.angle));
      if (!seen.still && a.dir === want.dir && want.texture.test(a.texture) && (!want.sway || Math.abs(a.angle) > 0.5)) {
        seen.still = true;
        await demo.still(tag, { clip });
      }
    },
  });
  if (err) problems.push(`${tag}: walk falló: ${err}`);
  const inPage = await page.evaluate(() => { const s = window.__demoSway; s.on = false; return s; });
  for (const d of inPage.dirs) seen.dirs.add(d);
  for (const t of inPage.textures) seen.textures.add(t);
  seen.maxAngle = Math.max(seen.maxAngle, inPage.maxAngle);
  await sleep(300);
  const { st } = await capture(`${label}: llega`);
  const a = st.anim;
  console.log(`${tag}: visto ${[...seen.dirs].join('/')} · ${[...seen.textures].join(', ')} · giro máx ${seen.maxAngle.toFixed(2)}° → ${fmtA(a)} · mira ${st.facing}`);
  if (!seen.dirs.has(want.dir)) problems.push(`${tag}: andando, anim.dir nunca fue «${want.dir}» (${[...seen.dirs].join('/') || 'nada'})`);
  if (![...seen.textures].some((t) => want.texture.test(t))) problems.push(`${tag}: ninguna textura ${want.texture} al andar (${[...seen.textures].join(', ')})`);
  if (want.sway && seen.maxAngle < 0.5) problems.push(`${tag}: sin balanceo (giro máx ${seen.maxAngle.toFixed(2)}°)`);
  if (a?.dir !== want.dir) problems.push(`${tag}: al llegar anim.dir «${a?.dir}», se esperaba «${want.dir}»`);
  if (want.facing && st.facing !== want.facing) problems.push(`${tag}: al llegar mira «${st.facing}», se esperaba «${want.facing}»`);
  checkRest(tag, st, want.integer);
  return st;
}

/** Reposo: sin giro ni elevación, escala = base (y entera si toca) */
function checkRest(tag, st, integer = true) {
  const a = st.anim;
  if (!a) { problems.push(`${tag}: sin state().anim`); return; }
  if (!a.rest || a.angle !== 0 || a.liftPx !== 0 || a.scale !== a.baseScale) problems.push(`${tag}: no vuelve al reposo (${fmtA(a)})`);
  if (integer && st.pixel && !st.pixel.integer) problems.push(`${tag}: escala ${st.pixel.playerScale} no entera tras parar`);
}

/** Texto del jugador en pantalla `ms`: muestrea `talking`; al cerrarse, comprueba que para. */
async function talkLeg(tag, label, start, args, want) {
  const seen = { talking: false, textures: new Set(), maxAngle: 0, still: false, open: false };
  const err = await during(label, start, args, {
    onState: async (st, clip) => {
      const a = st.anim;
      const playerText = st.speech?.kind === 'player';
      if (playerText) seen.open = true;
      if (playerText && a?.talking) {
        seen.talking = true;
        seen.textures.add(a.texture);
        seen.maxAngle = Math.max(seen.maxAngle, Math.abs(a.angle));
        if (!seen.still && seen.textures.size >= (want.frames ?? 1) && (Math.abs(a.angle) > 0.3 || seen.textures.size >= 2)) {
          seen.still = true;
          await demo.still(tag, { clip });
        }
      }
    },
  });
  if (err) problems.push(`${tag}: falló: ${err}`);
  if (!(await demo.settle({ tap: [640, 40], calm: 2, every: 300 }))) problems.push(`${tag}: la escena no quedó libre`);
  await sleep(200);
  const { st } = await capture(`${label}: texto cerrado`);
  console.log(`${tag}: texto ${seen.open ? 'visto' : 'NO visto'} · talking ${seen.talking} · texturas ${[...seen.textures].join(', ')} · cabeceo máx ${seen.maxAngle.toFixed(2)}° → tras cerrar: talking ${st.anim?.talking} · ${fmtA(st.anim)}`);
  if (!seen.open) problems.push(`${tag}: no salió el texto del jugador`);
  if (!seen.talking) problems.push(`${tag}: anim.talking nunca fue true con el texto abierto`);
  // A2.15: con el rig 2D el cabeceo y las manos van en los fotogramas (sin giro): vale giro o ≥ 2 texturas
  if (seen.maxAngle < 0.3 && seen.textures.size < 2) problems.push(`${tag}: sin cabeceo ni gesto (giro máx ${seen.maxAngle.toFixed(2)}°, ${seen.textures.size} textura(s))`);
  if (want.frames && seen.textures.size < want.frames) problems.push(`${tag}: hablando solo ${seen.textures.size} textura(s), se esperaban ${want.frames}`);
  if (want.texture && ![...seen.textures].some((t) => want.texture.test(t))) problems.push(`${tag}: hablando sin textura ${want.texture}`);
  if (st.anim?.talking) problems.push(`${tag}: anim.talking sigue true con el texto cerrado`);
  if (st.speech) problems.push(`${tag}: el texto no se cerró`);
  checkRest(tag, st, want.integer ?? true);
  return st;
}

// ── 1280x720 ─────────────────────────────────────────────────────────────────────────────────────────────────────
await open(1280);
const st0 = (await capture('lobby 1280x720')).st;
await hold('lobby 1280x720', 3);
console.log(`inicio: jugador ${st0.player.x.toFixed(1)},${st0.player.y.toFixed(1)} · ${fmtA(st0.anim)} · pixel ×${st0.pixel?.playerScale} entera ${st0.pixel?.integer}`);
if (!st0.anim) await demo.fail('state().anim no existe (API de QA anterior a A4.1)');

// 1) de perfil hasta debajo del abrigo; arriba y abajo
await walkLeg('perfil', '1) de perfil', X, Y_FRONT, { dir: 'left', texture: /^(player_walk_(left|right)|dex2d_walk_[lr])_\d$/, sway: false });
await walkLeg('arriba', '1) hacia el fondo: rig de espaldas', X, Y_BACK, { dir: 'up', texture: /^dex2d_walk_up_\d$/, sway: false, facing: 'back' });
await hold('1) llega de espaldas', 3);
await walkLeg('abajo', '1) hacia la cámara: rig de frente', X, Y_FRONT, { dir: 'down', texture: /^dex2d_walk_down_\d$/, sway: false, facing: 'front' });
await hold('1) llega de frente', 3);

// 2) hablar: de perfil (LOOK planta, texto 2,5 s) y de frente en una cinemática con actorMove vertical
await talkLeg('habla-perfil', '2) LOOK planta: cabeceo de perfil',
  () => window.__demoRun(window.__qa.act('LOOK', 'hs_plant', [], 2500)), [], {});
const cineSeen = { up: false };
await talkLeg('habla-frente', '2) cinemática: actorMove al fondo y habla de frente',
  (line, x) => window.__demoRun(window.__qa.runScript([
    { op: 'cinematicStart' },
    { op: 'actorMove', actor: 'player', x, y: 90 },
    { op: 'actorFace', actor: 'player', dir: 'front' },
    { op: 'say', text: line },
    { op: 'cinematicEnd' },
  ])), [PLANT_LINE, X], { frames: 3, texture: /^dex2d_talk_front_/ });
// (la subida de la cinemática se comprueba aparte: anim.dir queda en «up» tras el actorMove)
{
  const { st } = await capture('2) tras la cinemática');
  cineSeen.up = st.anim?.dir === 'up';
  if (!cineSeen.up) problems.push(`cinemática: tras el actorMove hacia el fondo anim.dir es «${st.anim?.dir}», se esperaba «up»`);
  if (st.facing !== 'front') problems.push(`cinemática: mira «${st.facing}», se esperaba «front» (actorFace)`);
}
await hold('2) fin de la cinemática', 3);

// 3) coger: PICK del abrigo (sube, se gira de espaldas y gesto de puntillas a la vez que el script)
{
  // A3.4a: con Penny mirando el abrigo no se coge; aquí se da por distraída (el puzle lo graba demo-a3-4a-penny)
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'penny_reading', value: true }]));
  const seen = { gesture: false, maxLift: 0, still: false };
  const err = await during('3) PICK abrigo: gesto de puntillas', () => window.__demoRun(window.__qa.act('PICK', 'hs_coat')), [], {
    onState: async (st, clip) => {
      const a = st.anim;
      if (a?.gesture) {
        seen.gesture = true;
        seen.maxLift = Math.max(seen.maxLift, a.liftPx);
        if (!seen.still && a.liftPx > 0) { seen.still = true; await demo.still('gesto', { clip }); }
      }
    },
  });
  if (err) problems.push(`PICK hs_coat falló: ${err}`);
  await sleep(300);
  const { st } = await capture('3) PICK abrigo: hecho');
  console.log(`gesto: visto ${seen.gesture} · elevación máx ${seen.maxLift}px → ${fmtA(st.anim)} · mira ${st.facing} · inventario ${JSON.stringify(st.inventory)}`);
  if (!seen.gesture) problems.push('PICK: no se vio el gesto (anim.gesture)');
  if (seen.maxLift <= 0) problems.push('PICK: de espaldas el gesto no se puso de puntillas (liftPx 0)');
  if (st.facing !== 'back') problems.push(`PICK: mira «${st.facing}», se esperaba «back»`);
  if (!st.inventory.includes('keycard')) problems.push('PICK: no cogió la keycard');
  checkRest('PICK', st);
}

// 4) reposo: dos tics (se graba un fotograma cada ~300 ms)
{
  const before = (await capture('4) reposo: esperando tics')).st;
  const kinds = [];
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const { st, clip } = await capture('4) reposo: tics');
    const tic = st.anim?.idleTick ?? null;
    if (tic && tic !== last) {
      kinds.push(tic);
      await demo.still(`tic-${kinds.length}`, { clip });
      if (st.facing !== before.facing) problems.push(`tic ${tic}: cambió facing a «${st.facing}»`);
      if (st.anim.scale !== st.anim.baseScale) problems.push(`tic ${tic}: escala ${st.anim.scale} ≠ base ${st.anim.baseScale}`);
    }
    last = tic;
    if ((st.anim?.idleTicks ?? 0) - (before.anim?.idleTicks ?? 0) >= 2 && !tic) break;
    await sleep(150);
  }
  await sleep(200);
  const { st } = await capture('4) reposo');
  const n = (st.anim?.idleTicks ?? 0) - (before.anim?.idleTicks ?? 0);
  console.log(`tics: ${n} (${kinds.join(', ')}) · mira ${st.facing} → ${fmtA(st.anim)}`);
  if (n < 2) problems.push(`reposo: solo ${n} tic(s) en 30 s`);
  if (st.facing !== before.facing) problems.push(`reposo: facing pasó de «${before.facing}» a «${st.facing}»`);
  checkRest('reposo', st);
}

// 5) disfraz de mono (solo sprites)
{
  const before = (await capture('5) disfraz de mono')).st;
  await page.evaluate(() => window.__qa.previewCostume('ape'));
  await hold('5) previewCostume(ape)', 3);
  await walkLeg('mono-abajo', '5) mono hacia la cámara: perfil + balanceo', X, Y_FRONT, { dir: 'down', texture: /^ape_walk_(left|right)_\d$/, sway: true, facing: 'front' });
  await walkLeg('mono-arriba', '5) mono hacia el fondo: perfil + balanceo', X, 87, { dir: 'up', texture: /^ape_walk_(left|right)_\d$/, sway: true, facing: 'back' });
  await talkLeg('mono-habla', '5) mono habla (LOOK planta)', () => window.__demoRun(window.__qa.act('LOOK', 'hs_plant', [], 2000)), [], { texture: /^ape_/ });
  const { st } = await capture('5) mono');
  if (st.anim?.costume !== 'ape') problems.push(`mono: anim.costume «${st.anim?.costume}»`);
  await page.evaluate(() => window.__qa.previewCostume(null));
  await sleep(300);
  const after = (await capture('5) vuelta al de la partida')).st;
  await hold('5) vuelta al de la partida', 3);
  console.log(`mono: costume ${st.anim?.costume} → ${after.anim?.costume} · ape_costume_worn ${!!after.flags.ape_costume_worn} · inventario ${JSON.stringify(after.inventory)}`);
  if (after.anim?.costume !== 'player' || after.anim?.preview !== null) problems.push(`mono: previewCostume(null) no volvió al de la partida (${after.anim?.costume}, preview ${after.anim?.preview})`);
  if (after.flags.ape_costume_worn) problems.push('mono: previewCostume puso la flag ape_costume_worn');
  if (JSON.stringify(after.inventory) !== JSON.stringify(before.inventory)) problems.push(`mono: previewCostume cambió el inventario (${JSON.stringify(before.inventory)} → ${JSON.stringify(after.inventory)})`);
}
{
  const { clip } = await capture('lobby 1280x720', { shot: false });
  await demo.still('full', { clip });
}

// ── 390x844 (capturas fijas) ─────────────────────────────────────────────────────────────────────────────────────
filming = false;
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open(390);
{
  const st = (await capture('390x844')).st;
  console.log(`390x844: ${fmtA(st.anim)} · pixel ×${st.pixel?.playerScale} entera ${st.pixel?.integer}`);
  await walkLeg('390-perfil', '390x844 de perfil', X, Y_FRONT, { dir: 'left', texture: /^(player|dex2d)_walk_/, sway: false, integer: false });
  await walkLeg('390-arriba', '390x844 hacia el fondo', X, Y_BACK, { dir: 'up', texture: /^dex2d_walk_up_/, sway: false, facing: 'back', integer: false });
  await walkLeg('390-abajo', '390x844 hacia la cámara', X, Y_FRONT, { dir: 'down', texture: /^dex2d_walk_down_/, sway: false, facing: 'front', integer: false });
  await demo.still('390x844');
}
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

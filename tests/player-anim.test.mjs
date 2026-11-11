// A4.1 (plan SCUMM): animación del protagonista (src/systems/PlayerAnim.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/player-anim.test.mjs (va en `npm run test:engine`)
// PLAYER_ANIM_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

const A = await import(process.env.PLAYER_ANIM_PATH ?? '../src/systems/PlayerAnim.ts');
const {
  VERTICAL_ENTER, VERTICAL_EXIT, STEP_MS, WALK_FRAME_MS, SWAY_DEG, TALK_HZ, TALK_NOD_DEG, GESTURE_MS, GESTURE_LIFT_ART,
  IDLE_TIC_AFTER_MS, IDLE_TIC_GAP_MIN_MS, IDLE_TIC_GAP_MAX_MS, QA_IDLE_SEED,
  moveDir, isVertical, facingForDir, mirrored, facingTexture, walkPose, talkPose, wantsGesture, gesturePose,
  mulberry32, idleTicKinds, pickIdleTic, idleTicPose, IdleTicker, restPose,
} = A;

// Claves que carga PreloadScene a partir de los PNG de assets/sprites/player (el mono no tiene perfil, Front ni Back)
const PNG = readdirSync(new URL('../assets/sprites/player/', import.meta.url)).filter((f) => f.endsWith('.png'));
const KEYS = new Set([
  ...[1, 2, 3, 4].map((i) => `player_idle${i}`), ...[1, 2, 3, 4].map((i) => `ape_idle${i}`),
  ...[0, 1, 2].flatMap((i) => [`player_walk_left_${i}`, `player_walk_right_${i}`, `ape_walk_left_${i}`, `ape_walk_right_${i}`]),
  'player_left', 'player_right', 'player_front_left', 'player_front_right', 'player_back_left', 'player_back_right',
]);
const has = (k) => KEYS.has(k);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('los sprites que usa A4.1 existen (sin arte nuevo) y el mono no tiene Front/Back', () => {
  for (const f of ['Front-Left.png', 'Front-Right.png', 'Back-Left.png', 'Back-Right.png', 'Idle-2.png', 'Idle-3.png', 'Walk-Left-1.png', 'Walk-Right-1.png', 'Ape-Idle-3.png']) {
    assert.ok(PNG.includes(f), `falta ${f}`);
  }
  assert.ok(!PNG.some((f) => /^Ape-(Front|Back)/.test(f)), 'si aparece arte Ape-Front/Back, quitarlo de «Arte pendiente» y cargarlo');
});

test('moveDir: perfil o vertical por el tramo en píxeles de mundo, con histéresis', () => {
  assert.equal(moveDir(100, 0, null), 'right');
  assert.equal(moveDir(-100, 10, null), 'left');
  assert.equal(moveDir(0, 50, null), 'down');
  assert.equal(moveDir(0, -50, null), 'up');
  // Diagonal: entra en vertical solo por encima de VERTICAL_ENTER
  assert.equal(moveDir(10, 10 * VERTICAL_ENTER, null), 'right', 'en el umbral sigue de perfil');
  assert.equal(moveDir(10, 10 * VERTICAL_ENTER + 0.01, null), 'down');
  // Histéresis: ya en vertical, sigue mientras |dy| ≥ VERTICAL_EXIT·|dx|; de perfil, no entra hasta VERTICAL_ENTER
  assert.equal(moveDir(10, 12, 'down'), 'down', 'entre los dos umbrales no cambia (vertical)');
  assert.equal(moveDir(10, 12, 'right'), 'right', 'entre los dos umbrales no cambia (perfil)');
  assert.equal(moveDir(10, 10 * VERTICAL_EXIT - 0.01, 'down'), 'right');
  assert.equal(moveDir(-10, -12, 'up'), 'up');
  assert.equal(moveDir(10, -12, 'down'), 'up', 'vertical al revés: cambia de sentido, no de eje');
  // Sin movimiento, la anterior
  assert.equal(moveDir(0, 0, 'up'), 'up');
  assert.equal(moveDir(0, 0, null), 'right');
  assert.ok(VERTICAL_EXIT < VERTICAL_ENTER);
});

test('moveDir: una diagonal que oscila alrededor del umbral no parpadea', () => {
  let d = null;
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const ratio = 1.45 + 0.1 * Math.sin(i); // 1,35-1,55: cruza VERTICAL_ENTER
    d = moveDir(10, 10 * ratio, d);
    seen.push(d);
  }
  const flips = seen.slice(1).filter((x, i) => x !== seen[i]).length;
  assert.ok(flips <= 1, `cambió ${flips} veces: ${seen.join(',')}`);
});

test('facingForDir, isVertical y mirrored', () => {
  assert.equal(facingForDir('up'), 'back');
  assert.equal(facingForDir('down'), 'front');
  assert.equal(facingForDir('left'), 'left');
  assert.equal(facingForDir('right'), 'right');
  assert.ok(isVertical('up') && isVertical('down') && !isVertical('left') && !isVertical(null));
  assert.equal(mirrored('right'), 'left');
  assert.equal(mirrored('left'), 'right');
});

test('facingTexture: la de A2.2 (perfil espejado, espaldas por el último lado, de frente idle animado)', () => {
  assert.equal(facingTexture('player', 'right', 'right', has), 'player_left');
  assert.equal(facingTexture('player', 'left', 'left', has), 'player_right');
  assert.equal(facingTexture('player', 'back', 'right', has), 'player_back_left');
  assert.equal(facingTexture('player', 'back', 'left', has), 'player_back_right');
  assert.equal(facingTexture('player', 'front', 'right', has), null);
  // Mono: perfil = primer fotograma de andar; de espaldas no hay → idle animado
  assert.equal(facingTexture('ape', 'right', 'right', has), 'ape_walk_left_0');
  assert.equal(facingTexture('ape', 'back', 'right', has), null);
});

test('walkPose de perfil: los 3 fotogramas de siempre, sin giro', () => {
  const at = (t, dir = 'right') => walkPose({ prefix: 'player', dir, side: 'right', tMs: t, has });
  assert.deepEqual(at(0), { texture: 'player_walk_left_0', angle: 0, lift: 0 });
  assert.equal(at(WALK_FRAME_MS).texture, 'player_walk_left_1');
  assert.equal(at(WALK_FRAME_MS * 2).texture, 'player_walk_left_2');
  assert.equal(at(WALK_FRAME_MS * 3).texture, 'player_walk_left_0');
  assert.equal(at(0, 'left').texture, 'player_walk_right_0');
});

test('walkPose en vertical: Front-* bajando y Back-* subiendo, alternando como paso, con balanceo ±SWAY_DEG', () => {
  const down = (t) => walkPose({ prefix: 'player', dir: 'down', side: 'right', tMs: t, has });
  const up = (t) => walkPose({ prefix: 'player', dir: 'up', side: 'left', tMs: t, has });
  assert.equal(down(0).texture, 'player_front_left');
  assert.equal(down(STEP_MS).texture, 'player_front_right');
  assert.equal(down(STEP_MS * 2).texture, 'player_front_left');
  assert.equal(up(0).texture, 'player_back_left');
  assert.equal(up(STEP_MS + 1).texture, 'player_back_right');
  assert.equal(down(0).angle, 0, 'el balanceo empieza en 0 (sin salto al arrancar)');
  assert.ok(near(down(STEP_MS / 2).angle, SWAY_DEG, 1e-9));
  assert.ok(near(down(STEP_MS * 1.5).angle, -SWAY_DEG, 1e-9));
  let max = 0;
  for (let t = 0; t < 3000; t += 7) max = Math.max(max, Math.abs(down(t).angle));
  assert.ok(max <= SWAY_DEG + 1e-9 && SWAY_DEG >= 2 && SWAY_DEG <= 3, `balanceo ${max}`);
  assert.equal(down(123).lift, 0, 'andar no eleva ni escala');
});

test('walkPose del mono en vertical: fotogramas de perfil del último lado con el balanceo', () => {
  const p = walkPose({ prefix: 'ape', dir: 'down', side: 'left', tMs: WALK_FRAME_MS, has });
  assert.equal(p.texture, 'ape_walk_right_1');
  assert.ok(near(walkPose({ prefix: 'ape', dir: 'up', side: 'right', tMs: STEP_MS / 2, has }).angle, SWAY_DEG));
  // Sin ninguna textura de Front (tráiler), igual
  assert.equal(walkPose({ prefix: 'player', dir: 'down', side: 'right', tMs: 0, has: (k) => !k.includes('front') && !k.startsWith('dex2d_') }).texture, 'player_walk_left_0');
});

test('talkPose: cabeceo a TALK_HZ, de frente alterna manos; con pose fija solo cabecea', () => {
  const period = 1000 / TALK_HZ;
  assert.ok(TALK_HZ >= 6 && TALK_HZ <= 8);
  const side = (t) => talkPose({ prefix: 'player', facing: 'right', tMs: t, has });
  assert.equal(side(0).angle, 0);
  assert.ok(near(side(period / 2).angle, TALK_NOD_DEG, 1e-9), 'de perfil se inclina hacia donde mira');
  assert.ok(near(side(period).angle, 0, 1e-9), 'y vuelve: un cabeceo por periodo');
  assert.ok(talkPose({ prefix: 'player', facing: 'left', tMs: period / 2, has }).angle < 0);
  assert.equal(side(period / 2).texture, null, 'de perfil no cambia de textura');
  // Cuenta de cabeceos en 1 s: TALK_HZ
  let nods = 0;
  let prev = 0;
  for (let t = 1; t <= 1000; t++) {
    const a = side(t).angle;
    if (prev > 0.5 * TALK_NOD_DEG && a <= 0.5 * TALK_NOD_DEG && a < prev) nods++;
    prev = a;
  }
  assert.ok(Math.abs(nods - TALK_HZ) <= 1, `${nods} cabeceos en 1 s`);
  const front = (t) => talkPose({ prefix: 'player', facing: 'front', tMs: t, has });
  const seq = [0, 2, 4, 6].map((b) => front(b * period + 1).texture);
  assert.deepEqual(seq, ['player_idle1', 'player_front_left', 'player_idle1', 'player_front_right']);
  assert.deepEqual([0, 2].map((b) => talkPose({ prefix: 'ape', facing: 'front', tMs: b * period + 1, has }).texture), ['ape_idle1', 'ape_idle3']);
  assert.equal(talkPose({ prefix: 'player', facing: 'front', tMs: 2 * period + 1, has, posed: true }).texture, null);
  assert.equal(talkPose({ prefix: 'player', facing: 'back', tMs: 10, has }).texture, null);
  for (let t = 0; t < 2000; t += 13) assert.equal(front(t).lift, 0);
});

test('gesto: solo verbos de acción, ≤ 400 ms, sale de 0 y vuelve a 0', () => {
  for (const v of ['PICK', 'USE', 'OPEN', 'PUSH', 'PULL', 'GIVE', 'CLOSE']) assert.ok(wantsGesture(v), v);
  for (const v of ['LOOK', 'TALK', 'WALK']) assert.ok(!wantsGesture(v), v);
  assert.ok(GESTURE_MS >= 250 && GESTURE_MS <= 400);
  const g = (facing, t, aim = null) => gesturePose({ prefix: 'player', facing, side: 'right', aim, tMs: t, has });
  assert.equal(g('right', GESTURE_MS), null, 'terminado');
  assert.equal(g('right', -1), null);
  assert.ok(near(g('right', 0).angle, 0) && g('right', 0).lift === 0);
  // De perfil: brazo adelantado (walk_*_1) e inclinado hacia donde mira
  assert.equal(g('right', 100).texture, 'player_walk_left_1');
  assert.ok(g('right', GESTURE_MS / 2).angle > 5);
  assert.ok(g('left', GESTURE_MS / 2).angle < -5);
  // De espaldas: su Back-* (textura de la orientación) de puntillas
  const back = g('back', GESTURE_MS / 2);
  assert.equal(back.texture, null);
  assert.ok(near(back.lift, GESTURE_LIFT_ART));
  assert.ok(g('back', GESTURE_MS - 1).lift < 0.1, 'acaba casi en el suelo');
  // De frente: Front-* hacia el lado del objetivo
  assert.equal(g('front', 100, 'left').texture, 'player_front_right');
  assert.ok(g('front', 100, 'left').angle < 0);
  // Mono: de perfil también tiene walk_*_1; de espaldas no hay textura, solo de puntillas
  assert.equal(gesturePose({ prefix: 'ape', facing: 'left', side: 'left', aim: null, tMs: 50, has }).texture, 'ape_walk_right_1');
});

test('mulberry32 es determinista y en [0, 1)', () => {
  const a = mulberry32(QA_IDLE_SEED);
  const b = mulberry32(QA_IDLE_SEED);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, mulberry32(7)));
});

test('tics de reposo: tipos por orientación y poses que solo cambian la textura', () => {
  assert.deepEqual(idleTicKinds('front'), ['lookSide', 'tapFoot']);
  assert.deepEqual(idleTicKinds('back'), ['lookCamera', 'lookSide']);
  assert.equal(pickIdleTic(() => 0.99, 'right', 'right').kind, 'lookSide');
  assert.equal(pickIdleTic(() => 0.99, 'right', 'right').side, 'left', 'de perfil mira al otro lado');
  assert.deepEqual(idleTicPose({ kind: 'lookSide', ms: 1000, side: 'left' }, 10, { prefix: 'player', has }), { texture: 'player_right', angle: 0, lift: 0 });
  assert.equal(idleTicPose({ kind: 'lookSide', ms: 1000, side: 'right' }, 10, { prefix: 'ape', has }).texture, 'ape_walk_left_0');
  assert.equal(idleTicPose({ kind: 'lookCamera', ms: 1000, side: 'right' }, 10, { prefix: 'player', has }).texture, 'player_idle1');
  const tap = [0, 150, 300].map((t) => idleTicPose({ kind: 'tapFoot', ms: 900, side: 'right' }, t, { prefix: 'player', has }).texture);
  assert.deepEqual(tap, ['player_idle1', 'player_idle2', 'player_idle1']);
  assert.deepEqual(restPose(), { texture: null, angle: 0, lift: 0 });
});

test('IdleTicker: primer tic tras IDLE_TIC_AFTER_MS quieto, luego cada 3-6 s; cualquier cosa lo reinicia', () => {
  const run = (seed, ms, free = () => true) => {
    const tk = new IdleTicker(seed);
    const log = [];
    let prev = null;
    for (let t = 0; t <= ms; t += 16) {
      const r = tk.update(16, free(t), 'front', 'right');
      if (r && r.tic !== prev) log.push({ at: t, kind: r.tic.kind, side: r.tic.side });
      prev = r ? r.tic : null;
    }
    return { log, count: tk.count };
  };
  const a = run(QA_IDLE_SEED, 30000);
  assert.ok(a.log.length >= 4, `${a.log.length} tics en 30 s`);
  assert.ok(a.log[0].at >= IDLE_TIC_AFTER_MS - 16 && a.log[0].at <= IDLE_TIC_AFTER_MS + 32, `primer tic a los ${a.log[0].at} ms`);
  for (let i = 1; i < a.log.length; i++) {
    const gap = a.log[i].at - a.log[i - 1].at;
    assert.ok(gap >= IDLE_TIC_GAP_MIN_MS && gap <= IDLE_TIC_GAP_MAX_MS + 1300, `hueco ${gap}`);
  }
  assert.equal(a.count, a.log.length);
  // Determinista con la misma semilla
  assert.deepEqual(run(QA_IDLE_SEED, 30000).log, a.log);
  // Sin reposo (andar, hablar, script) no hay tics, y al volver tarda otra vez IDLE_TIC_AFTER_MS
  const b = run(QA_IDLE_SEED, 20000, (t) => t > 10000);
  assert.ok(b.log[0].at >= 10000 + IDLE_TIC_AFTER_MS - 32, `primer tic a los ${b.log[0].at} ms`);
  const tk = new IdleTicker(1);
  for (let t = 0; t < IDLE_TIC_AFTER_MS + 100; t += 50) tk.update(50, true, 'front', 'right');
  assert.ok(tk.current(), 'tic en curso');
  assert.equal(tk.update(16, false, 'front', 'right'), null);
  assert.equal(tk.current(), null, 'cortado');
});

// ── A2.15: rig 2D pre-renderizado (art/dex2d/build.py) ───────────────────────────────────────────────────────────
const F = await import('../src/data/dex2dFrames.ts');
const RIG_PNG = readdirSync(new URL('../assets/sprites/player/dex2d/', import.meta.url)).filter((f) => f.endsWith('.png'));
const RIG_KEYS = new Set([...KEYS, ...Object.entries(F.DEX2D_ANIMS).flatMap(([a, m]) => Array.from({ length: m.frames }, (_, i) => `dex2d_${a}_${i}`))]);
const hasR = (k) => RIG_KEYS.has(k);

test('A2.15: los fotogramas del rig existen y cuadran con las constantes de PlayerAnim', () => {
  for (const [a, m] of Object.entries(F.DEX2D_ANIMS)) {
    for (let i = 0; i < m.frames; i++) assert.ok(RIG_PNG.includes(`${a}_${i}.png`), `falta dex2d/${a}_${i}.png`);
    assert.equal(m.h, 103, `${a}: alto 103 (A2.11: mismo alto y pies abajo)`);
  }
  assert.equal(F.DEX2D_ANIMS.walk_r.frames, A.RIG_WALK_FRAMES);
  assert.equal(F.DEX2D_ANIMS.walk_r.ms, A.RIG_WALK_FRAME_MS);
  assert.equal(F.DEX2D_ANIMS.walk_down.frames, A.RIG_VWALK_FRAMES);
  assert.equal(F.DEX2D_ANIMS.walk_up.ms, A.RIG_VWALK_FRAME_MS);
  assert.equal(F.DEX2D_ANIMS.idle.frames, A.RIG_IDLE_FRAMES);
  assert.equal(F.DEX2D_ANIMS.talk_r.ms, A.RIG_TALK_FRAME_MS);
  assert.equal(F.DEX2D_ANIMS.shrug.frames, A.RIG_SHRUG_FRAMES);
  for (const [k, v] of Object.entries(A.RIG_TICS)) {
    assert.equal(F.DEX2D_ANIMS[`tic_${k}`].frames, v.frames, k);
    assert.equal(F.DEX2D_ANIMS[`tic_${k}`].ms, v.ms, k);
  }
  assert.equal(F.DEX2D_WALK_STEP_ART_PX, A.RIG_STEP_ART_PX);
});

test('A2.15: sin patinar — 2 pasos por ciclo de andar = lo que avanza a 74 px de arte/s', async () => {
  const W = await import('../src/systems/WalkMotion.ts');
  const cycle = A.RIG_WALK_FRAMES * A.RIG_WALK_FRAME_MS;
  assert.ok(near(W.artPxPerCycle(cycle), 2 * A.RIG_STEP_ART_PX, 1e-6), `${W.artPxPerCycle(cycle)} px por ciclo`);
  assert.ok(Math.abs(A.RIG_VWALK_FRAMES * A.RIG_VWALK_FRAME_MS - cycle) <= 2, 'arriba/abajo con la misma cadencia');
});

test('A2.15: walk/talk/gesto/shrug usan el rig con Dex y no con el mono', () => {
  assert.equal(A.hasRig('player', hasR), true);
  assert.equal(A.hasRig('ape', hasR), false);
  assert.equal(A.hasRig('player', has), false, 'sin los fotogramas (tráiler) sigue lo de A4.1');
  assert.equal(walkPose({ prefix: 'player', dir: 'right', side: 'right', tMs: 0, has: hasR }).texture, 'dex2d_walk_r_0');
  assert.equal(walkPose({ prefix: 'player', dir: 'left', side: 'left', tMs: 350, has: hasR }).texture, 'dex2d_walk_l_3');
  assert.equal(walkPose({ prefix: 'player', dir: 'right', side: 'right', tMs: 800, has: hasR }).texture, 'dex2d_walk_r_0');
  assert.equal(walkPose({ prefix: 'player', dir: 'down', side: 'right', tMs: 140, has: hasR }).texture, 'dex2d_walk_down_1');
  assert.equal(walkPose({ prefix: 'player', dir: 'up', side: 'right', tMs: 0, has: hasR }).angle, 0, 'el rig no se balancea con tween');
  assert.equal(walkPose({ prefix: 'ape', dir: 'right', side: 'right', tMs: 0, has: hasR }).texture, 'ape_walk_left_0');
  assert.equal(talkPose({ prefix: 'player', facing: 'front', tMs: 150, has: hasR }).texture, 'dex2d_talk_front_1');
  assert.equal(talkPose({ prefix: 'player', facing: 'right', tMs: 0, has: hasR }).texture, 'dex2d_talk_r_0');
  assert.equal(talkPose({ prefix: 'player', facing: 'front', tMs: 150, has: hasR, posed: true }).texture, null);
  const g = (t, level) => gesturePose({ prefix: 'player', facing: 'right', side: 'right', aim: 'right', tMs: t, has: hasR, level });
  assert.equal(g(0).texture, 'dex2d_pick_r_mid_0');
  assert.equal(g(GESTURE_MS - 1, 'high').texture, 'dex2d_pick_r_high_3');
  assert.equal(g(GESTURE_MS), null);
  assert.equal(A.pickLevel(0.1), 'low');
  assert.equal(A.pickLevel(0.5), 'mid');
  assert.equal(A.pickLevel(1.0), 'high');
  assert.equal(A.pickLevel(null), 'mid');
  assert.equal(A.shrugPose({ prefix: 'player', tMs: 0, has: hasR }).texture, 'dex2d_shrug_0');
  assert.equal(A.shrugPose({ prefix: 'player', tMs: A.SHRUG_MS, has: hasR }), null);
  assert.equal(A.shrugPose({ prefix: 'ape', tMs: 0, has: hasR }), null);
});

test('A2.15: manías de reposo del rig, deterministas con la semilla de QA', () => {
  assert.deepEqual(idleTicKinds('front', true), ['scratch', 'glasses', 'sway', 'yawn', 'lookSide']);
  assert.deepEqual(idleTicKinds('front'), ['lookSide', 'tapFoot'], 'sin rig, lo de A4.1');
  const seq = (seed) => {
    const r = mulberry32(seed);
    return Array.from({ length: 12 }, () => pickIdleTic(r, 'front', 'right', true).kind);
  };
  assert.deepEqual(seq(QA_IDLE_SEED), seq(QA_IDLE_SEED));
  assert.ok(new Set(seq(QA_IDLE_SEED)).size >= 3, 'al menos 3 manías distintas en 12 tics');
  const tic = { kind: 'scratch', ms: 8 * 140, side: 'right' };
  assert.equal(idleTicPose(tic, 0, { prefix: 'player', has: hasR }).texture, 'dex2d_tic_scratch_0');
  assert.equal(idleTicPose(tic, 8 * 140 - 1, { prefix: 'player', has: hasR }).texture, 'dex2d_tic_scratch_7');
});

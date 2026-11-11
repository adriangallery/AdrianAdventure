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
  assert.equal(walkPose({ prefix: 'player', dir: 'down', side: 'right', tMs: 0, has: (k) => !k.includes('front') && !k.startsWith('player3d_') }).texture, 'player_walk_left_0');
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

// ── A2.14: Dex en 3D (assets/sprites/player3d, generado por art/dex3d) ──────────────────────────────────────────────
test('A2.14: fotogramas 3D en disco, manifiesto y tamaño (alto de Dex 103, pies en la fila 103)', async () => {
  const { DEX3D, DEX_ART_HEIGHT, WALK3D_FRAMES, TALK3D_FRAMES, GESTURE3D_FRAMES, GESTURES3D } = A;
  assert.equal(DEX3D, 'player3d');
  assert.equal(DEX_ART_HEIGHT, 103);
  const dir = new URL('../assets/sprites/player3d/', import.meta.url);
  const files = new Set(readdirSync(dir));
  const { readFileSync } = await import('node:fs');
  const man = JSON.parse(readFileSync(new URL('dex3d.json', dir), 'utf8'));
  assert.equal(man.artHeight, DEX_ART_HEIGHT);
  assert.ok(Math.abs(man.origin[1] - DEX_ART_HEIGHT / man.frameHeight) < 1e-9);
  const need = [];
  for (const d of ['down', 'up', 'left', 'right']) {
    for (let i = 0; i < WALK3D_FRAMES; i++) need.push(`walk_${d}_${i}.png`);
    if (d !== 'up') for (let i = 0; i < TALK3D_FRAMES; i++) need.push(`talk_${d}_${i}.png`);
    for (const g of GESTURES3D) for (let i = 0; i < GESTURE3D_FRAMES; i++) need.push(`${g}_${d}_${i}.png`);
  }
  for (let i = 0; i < 4; i++) need.push(`idle_down_${i}.png`);
  need.push('idle_right_0.png', 'idle_left_0.png', 'idle_up_right_0.png', 'idle_up_left_0.png');
  for (const f of need) assert.ok(files.has(f), `falta ${f}`);
  assert.equal(man.anims.walk.frames, WALK3D_FRAMES);
});

test('A2.14: andar 3D = 8 fotogramas en 540 ms = 2 zancadas de 20 px a 74 px/s (sin patinar), sin balanceo', () => {
  const { WALK3D_FRAMES, WALK3D_FRAME_MS } = A;
  // 540 ms frente a 540,5: el pie apoyado se desliza < 0,1 % (0,04 px de arte por ciclo)
  assert.ok(near(WALK3D_FRAMES * WALK3D_FRAME_MS, (2 * 20 * 1000) / 74, 1));
  const has3 = (k) => k.startsWith('player3d_') || has(k);
  for (const dir of ['down', 'up', 'left', 'right']) {
    const seen = new Set();
    for (let t = 0; t < WALK3D_FRAMES * WALK3D_FRAME_MS; t += WALK3D_FRAME_MS) {
      const p = walkPose({ prefix: 'player', dir, side: 'right', tMs: t + 1, has: has3 });
      assert.equal(p.angle, 0);
      seen.add(p.texture);
    }
    assert.equal(seen.size, WALK3D_FRAMES, dir);
    assert.ok([...seen].every((k) => k.startsWith(`player3d_walk_${dir}_`)));
  }
  // el mono sigue con lo suyo
  assert.ok(walkPose({ prefix: 'ape', dir: 'left', side: 'left', tMs: 0, has: has3 }).texture.startsWith('ape_walk_'));
});

test('A2.14: hablar y gestos 3D; el gesto según verbo y altura', () => {
  const { gestureAnimFor, GESTURE3D_FRAMES } = A;
  const has3 = (k) => k.startsWith('player3d_') || has(k);
  assert.match(talkPose({ prefix: 'player', facing: 'front', tMs: 250, has: has3 }).texture, /^player3d_talk_down_2$/);
  assert.match(talkPose({ prefix: 'player', facing: 'right', tMs: 0, has: has3 }).texture, /^player3d_talk_right_0$/);
  // con pose fija de cinemática no cambia de textura
  assert.equal(talkPose({ prefix: 'player', facing: 'front', tMs: 250, has: has3, posed: true }).texture, null);
  const frames = new Set();
  for (let t = 0; t < GESTURE_MS; t += 10) frames.add(gesturePose({ prefix: 'player', facing: 'left', side: 'left', aim: 'left', tMs: t, has: has3, anim: 'pick_low' }).texture);
  assert.equal(frames.size, GESTURE3D_FRAMES);
  assert.equal(gesturePose({ prefix: 'player', facing: 'left', side: 'left', aim: null, tMs: GESTURE_MS, has: has3 }), null);
  assert.equal(gestureAnimFor('PICK', 0.1), 'pick_low');
  assert.equal(gestureAnimFor('PICK', 0.5), 'pick_mid');
  assert.equal(gestureAnimFor('PICK', 0.95), 'pick_high');
  assert.equal(gestureAnimFor('PICK', null), 'pick_mid');
  assert.equal(gestureAnimFor('PUSH', 0.5), 'push');
  assert.equal(gestureAnimFor('OPEN', 0.5), 'use');
});

// ── A2.14 «con gracia»: manías de reposo y encogerse de hombros ───────────────────────────────────────────────────────
test('A2.14 gracia: manías de reposo de frente (se disparan, alternan sin repetir, deterministas, se cortan)', () => {
  const { MANIAS3D, MANIA_LIST, maniaMs } = A;
  assert.ok(MANIA_LIST.length >= 4);
  for (const m of MANIA_LIST) {
    const { frames, fps } = MANIAS3D[m];
    assert.ok(frames >= 8 && frames <= 12, `${m}: ${frames} fotogramas`);
    assert.ok(fps >= 8 && fps <= 10, `${m}: ${fps} fps`);
    assert.equal(maniaMs(m), Math.round((frames * 1000) / fps));
  }
  assert.deepEqual(idleTicKinds('front', true), ['mania', 'lookSide']);
  assert.deepEqual(idleTicKinds('right', true), ['lookCamera', 'lookSide'], 'de perfil, sin manías');
  const run = (seed, ms, free = () => true, facing = 'front') => {
    const tk = new IdleTicker(seed);
    const log = [];
    let prev = null;
    for (let t = 0; t <= ms; t += 16) {
      const r = tk.update(16, free(t), facing, 'right', true);
      if (r && r.tic !== prev) log.push({ at: t, kind: r.tic.kind, mania: r.tic.mania ?? null });
      prev = r ? r.tic : null;
    }
    return log;
  };
  const a = run(QA_IDLE_SEED, 60000);
  const manias = a.filter((x) => x.kind === 'mania').map((x) => x.mania);
  assert.ok(a[0].at >= IDLE_TIC_AFTER_MS - 16 && a[0].at <= IDLE_TIC_AFTER_MS + 32, `primer tic a los ${a[0].at} ms`);
  assert.ok(manias.length >= 5, `${manias.length} manías en 60 s`);
  assert.ok(new Set(manias).size >= 3, `variedad: ${manias.join(', ')}`);
  for (let i = 1; i < manias.length; i++) assert.notEqual(manias[i], manias[i - 1], 'no repite la anterior');
  assert.deepEqual(run(QA_IDLE_SEED, 60000), a, 'misma semilla, mismas manías');
  // de perfil no hay manías
  assert.ok(run(QA_IDLE_SEED, 30000, () => true, 'left').every((x) => x.kind !== 'mania'));
  // fotogramas: player3d_<manía>_down_<i>, del 0 al último y ahí se queda
  const has3 = (k) => k.startsWith('player3d_') || has(k);
  const m = MANIA_LIST[0];
  const tic = { kind: 'mania', ms: maniaMs(m), side: 'right', mania: m };
  const seen = new Set();
  for (let t = 0; t < tic.ms; t += 20) seen.add(idleTicPose(tic, t, { prefix: 'player', has: has3 }).texture);
  assert.equal(seen.size, MANIAS3D[m].frames);
  assert.equal(idleTicPose(tic, 0, { prefix: 'player', has: has3 }).texture, `player3d_${m}_down_0`);
  assert.equal(idleTicPose(tic, 99999, { prefix: 'player', has: has3 }).texture, `player3d_${m}_down_${MANIAS3D[m].frames - 1}`);
  assert.equal(idleTicPose(tic, 0, { prefix: 'player', has }).texture, 'player_idle1', 'sin fotogramas 3D, el idle');
  // se corta en cuanto deja de estar en reposo (andar, hablar, gesto)
  const tk = new IdleTicker(QA_IDLE_SEED);
  let cur = null;
  for (let t = 0; t < 20000 && !(cur && cur.tic.kind === 'mania'); t += 16) cur = tk.update(16, true, 'front', 'right', true);
  assert.equal(cur?.tic.kind, 'mania');
  assert.equal(tk.update(16, false, 'front', 'right', true), null);
  assert.equal(tk.current(), null, 'cortada al instante');
});

test('A2.14 gracia: encogerse de hombros (shrug) de frente y de perfil, 7 fotogramas en SHRUG_MS', () => {
  const { shrugPose, SHRUG_MS, SHRUG3D_FRAMES, SHRUG3D_FRAME_MS } = A;
  assert.equal(SHRUG_MS, SHRUG3D_FRAMES * SHRUG3D_FRAME_MS);
  assert.ok(SHRUG3D_FRAMES >= 6 && SHRUG3D_FRAMES <= 8);
  const has3 = (k) => k.startsWith('player3d_') || has(k);
  for (const [facing, dir] of [['front', 'down'], ['left', 'left'], ['right', 'right']]) {
    const seen = new Set();
    for (let t = 0; t < SHRUG_MS; t += 10) {
      const p = shrugPose({ prefix: 'player', facing, tMs: t, has: has3 });
      assert.equal(p.angle, 0);
      assert.equal(p.lift, 0);
      seen.add(p.texture);
    }
    assert.equal(seen.size, SHRUG3D_FRAMES, facing);
    assert.ok([...seen].every((k) => k.startsWith(`player3d_shrug_${dir}_`)));
    assert.equal(shrugPose({ prefix: 'player', facing, tMs: SHRUG_MS, has: has3 }), null, 'termina');
  }
  // de espaldas no hay fotogramas (las claves up no existen) y el mono no tiene
  const noUp = (k) => has3(k) && !k.includes('_shrug_up_');
  assert.equal(shrugPose({ prefix: 'player', facing: 'back', tMs: 0, has: noUp }), null);
  assert.equal(shrugPose({ prefix: 'ape', facing: 'front', tMs: 0, has: has3 }), null);
});

test('A2.14 gracia: PNG de las manías y del shrug en disco y en el manifiesto', async () => {
  const { MANIAS3D, MANIA_LIST, SHRUG3D_FRAMES } = A;
  const dir = new URL('../assets/sprites/player3d/', import.meta.url);
  const files = new Set(readdirSync(dir));
  const { readFileSync } = await import('node:fs');
  const man = JSON.parse(readFileSync(new URL('dex3d.json', dir), 'utf8'));
  for (const m of MANIA_LIST) {
    for (let i = 0; i < MANIAS3D[m].frames; i++) assert.ok(files.has(`${m}_down_${i}.png`), `falta ${m}_down_${i}.png`);
    assert.equal(man.anims[m]?.frames, MANIAS3D[m].frames, `manifiesto ${m}`);
  }
  for (const d of ['down', 'left', 'right']) for (let i = 0; i < SHRUG3D_FRAMES; i++) assert.ok(files.has(`shrug_${d}_${i}.png`), `falta shrug_${d}_${i}.png`);
  assert.equal(man.anims.shrug?.frames, SHRUG3D_FRAMES);
});

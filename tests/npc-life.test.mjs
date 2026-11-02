// A4.2 (plan SCUMM): vida en las NPC (src/systems/NpcLife.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/npc-life.test.mjs (va en `npm run test:engine`)
// NPC_LIFE_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const L = await import(process.env.NPC_LIFE_PATH ?? '../src/systems/NpcLife.ts');
const {
  BREATH_MS, BREATH_UP, BLINK_MS, BLINK_GAP_MIN_MS, BLINK_GAP_MAX_MS, BLINK_FIRST_MAX_MS, VOICE_SEG_MIN_MS, VOICE_SEG_MAX_MS,
  VOICE_PAUSE_MAX_MS, TEXT_SEG_MIN_MS, TEXT_SEG_MAX_MS, LOADING_GRACE_MS, RELEASE_MS, LEVEL_DEAD_MS,
  hashId, lifeSeed, breathPhase, breathPx, blinkSquash, defaultFacing, sideOf, textBudgetMs, BlinkClock, Mouth, NpcLife,
} = L;

const FRAME = 16;
/** Corre `ms` a 60 fps llamando a `fn(t)`; devuelve los valores */
function run(ms, fn) {
  const out = [];
  for (let t = 0; t < ms; t += FRAME) out.push(fn(t));
  return out;
}
/** Tramos seguidos iguales: [[valor, duración ms], …] */
function segments(values) {
  const segs = [];
  for (const v of values) {
    const last = segs[segs.length - 1];
    if (last && last[0] === v) last[1] += FRAME;
    else segs.push([v, FRAME]);
  }
  return segs;
}
const talk = (line, voice, level = null) => ({ talking: true, line, voice, level });
const idle = { talking: false, line: '', voice: 'none', level: null };
const life = (o = {}) => ({ playerX: 900, npcX: 500, talking: false, line: '', voice: 'none', level: null, busy: false, faceLocked: false, ...o });

test('los sprites de las NPC están mirando a la derecha y tienen su _talk (y PreloadScene los carga)', () => {
  const png = readdirSync(new URL('../assets/sprites/npcs/', import.meta.url));
  for (const n of ['receptionist', 'dr_satoshi']) {
    assert.ok(png.includes(`${n}.png`), `falta ${n}.png`);
    assert.ok(png.includes(`${n}_talk.png`), `falta ${n}_talk.png`);
  }
  const preload = readFileSync(new URL('../src/scenes/PreloadScene.ts', import.meta.url), 'utf8');
  const ids = preload.match(/const npcIds = \[([^\]]*)\]/)?.[1] ?? '';
  for (const n of ['receptionist', 'receptionist_talk', 'dr_satoshi', 'dr_satoshi_talk']) assert.ok(ids.includes(`'${n}'`), `PreloadScene no carga ${n}`);
});

test('respiración: 1 píxel de arte, a saltos enteros, ciclo lento y desfasada por NPC', () => {
  const v = run(BREATH_MS * 2, (t) => breathPx(t, 0));
  assert.ok(v.every((x) => x === 0 || x === 1), 'solo 0 o 1');
  assert.ok(BREATH_MS >= 3000 && BREATH_MS <= 4000, 'ciclo de 3-4 s');
  const segs = segments(v);
  // Dos cambios por ciclo: nada de parpadeo de un frame
  assert.ok(segs.length <= 5, `cambios: ${segs.length}`);
  const up = v.filter((x) => x === 1).length / v.length;
  assert.ok(Math.abs(up - BREATH_UP) < 0.02, `arriba ${up}`);
  assert.equal(breathPx(-100, 0), breathPx(BREATH_MS - 100, 0), 'tiempo negativo no rompe');
  // Penny y el Dr. Satoshi no respiran a la vez
  const a = breathPhase('npc_receptionist');
  const b = breathPhase('npc_dr_satoshi');
  assert.ok(a >= 0 && a < BREATH_MS && b >= 0 && b < BREATH_MS);
  assert.ok(Math.abs(a - b) > 300, `desfases ${a} y ${b}`);
});

test('semillas: fijas con ?qa=1 y distintas por NPC', () => {
  assert.equal(lifeSeed('npc_receptionist', true), lifeSeed('npc_receptionist', true, 0.7));
  assert.notEqual(lifeSeed('npc_receptionist', true), lifeSeed('npc_dr_satoshi', true));
  assert.notEqual(lifeSeed('npc_receptionist', false, 0.1), lifeSeed('npc_receptionist', false, 0.2));
  assert.equal(hashId('abc'), hashId('abc'));
  assert.notEqual(hashId('abc'), hashId('abd'));
});

test('parpadeo: el primero pronto, luego cada 3-7 s, BLINK_MS de duración y determinista con la semilla', () => {
  const c = new BlinkClock(1234);
  const v = run(40000, () => c.update(FRAME));
  const segs = segments(v);
  const blinks = segs.filter(([b]) => b);
  const gaps = segs.filter(([b]) => !b);
  assert.equal(blinks.length, c.count);
  assert.ok(c.count >= 40000 / BLINK_GAP_MAX_MS - 1 && c.count <= 40000 / BLINK_GAP_MIN_MS + 1, `parpadeos ${c.count}`);
  for (const [, ms] of blinks) assert.ok(ms >= BLINK_MS && ms <= BLINK_MS + FRAME * 2, `parpadeo de ${ms} ms`);
  assert.ok(gaps[0][1] <= BLINK_FIRST_MAX_MS + FRAME, `primer parpadeo a los ${gaps[0][1]} ms`);
  for (const [, ms] of gaps.slice(1, -1)) assert.ok(ms >= BLINK_GAP_MIN_MS - FRAME && ms <= BLINK_GAP_MAX_MS + FRAME, `hueco de ${ms} ms`);
  const d = new BlinkClock(1234);
  assert.deepEqual(run(40000, () => d.update(FRAME)), v, 'misma semilla, mismos parpadeos');
});

test('parpadeo sin textura: aplasta exactamente 1 píxel de arte (alto entero en pantalla con la escala de A2.8)', () => {
  assert.equal(blinkSquash(37) * 37, 36);
  for (const scale of [2, 3, 4]) assert.equal(Math.round(37 * blinkSquash(37) * scale * 1e6) / 1e6, 36 * scale);
  assert.equal(blinkSquash(1), 1);
});

test('orientación por defecto y lado del jugador (con zona muerta)', () => {
  assert.equal(defaultFacing(undefined), 'right');
  assert.equal(defaultFacing('left'), 'left');
  assert.equal(defaultFacing('front'), 'right');
  assert.equal(sideOf(100, 500, 'right'), 'left');
  assert.equal(sideOf(900, 500, 'left'), 'right');
  assert.equal(sideOf(502, 500, 'left'), 'left', 'casi encima: el de antes');
});

test('boca con voz sonando: sílabas irregulares de 80-220 ms con pausas, y empieza abriendo', () => {
  const m = new Mouth(42);
  const v = run(6000, () => m.update(FRAME, talk('Hello there.', 'playing')));
  assert.equal(v[0], true, 'el primer frame ya abre');
  const segs = segments(v).slice(0, -1);
  const opens = segs.filter(([o]) => o).map(([, ms]) => ms);
  const closes = segs.filter(([o]) => !o).map(([, ms]) => ms);
  for (const ms of opens) assert.ok(ms >= VOICE_SEG_MIN_MS - FRAME && ms <= VOICE_SEG_MAX_MS + FRAME, `abierta ${ms} ms`);
  for (const ms of closes) assert.ok(ms >= VOICE_SEG_MIN_MS - FRAME && ms <= VOICE_PAUSE_MAX_MS + FRAME, `cerrada ${ms} ms`);
  assert.ok(new Set(opens).size >= 4, 'cadencia irregular');
  assert.ok(closes.some((ms) => ms > VOICE_SEG_MAX_MS + FRAME), 'alguna pausa más larga');
  assert.equal(m.moves, opens.length + (v[v.length - 1] && segments(v).at(-1)[0] ? 1 : 0));
  assert.equal(m.lastMode, 'clip');
});

test('boca: clip descargándose = cerrada (hasta LOADING_GRACE_MS), clip terminado = cerrada, sin hablar = cerrada', () => {
  const m = new Mouth(1);
  const loading = run(LOADING_GRACE_MS - 50, () => m.update(FRAME, talk('a line', 'loading')));
  assert.ok(loading.every((o) => !o));
  const late = run(400, () => m.update(FRAME, talk('a line', 'loading')));
  assert.ok(late.some((o) => o), 'tras la gracia se mueve como sin voz');
  const done = run(500, () => m.update(FRAME, talk('a line', 'done')));
  assert.ok(done.every((o) => !o));
  assert.equal(m.update(FRAME, idle), false);
});

test('boca sin voz: alterna 120-200 ms lo que se tardaría en decirlo y luego se cierra', () => {
  const line = 'We are closed. Do not touch anything.';
  const m = new Mouth(7);
  const budget = textBudgetMs(line.length);
  const v = run(budget + 1500, () => m.update(FRAME, talk(line, 'none')));
  const during = v.slice(0, Math.floor(budget / FRAME));
  const after = v.slice(Math.ceil(budget / FRAME) + 1);
  assert.ok(after.every((o) => !o), 'cerrada al acabar');
  const segs = segments(during).slice(1, -1);
  for (const [, ms] of segs) assert.ok(ms >= TEXT_SEG_MIN_MS - FRAME && ms <= TEXT_SEG_MAX_MS + FRAME, `${ms} ms`);
  assert.ok(segs.length >= 4);
  assert.equal(m.lastMode, 'text');
  assert.equal(textBudgetMs(1), 900);
  assert.equal(textBudgetMs(10000), 6000);
});

test('boca con analizador: solo abre con señal; un analizador sordo se ignora', () => {
  // Señal a ráfagas: 300 ms de voz, 300 ms de silencio
  const m = new Mouth(3);
  const level = (t) => (Math.floor(t / 300) % 2 === 0 ? 0.2 : 0);
  const v = run(3000, (t) => m.update(FRAME, talk('x', 'playing', level(t))));
  v.forEach((o, k) => { if (o) assert.ok(level(k * FRAME) > 0, `abierta en silencio a los ${k * FRAME} ms`); });
  assert.ok(v.some((o) => o));
  assert.equal(m.lastLevel, true);
  // Sordo (siempre 0): a partir de LEVEL_DEAD_MS sigue el patrón
  const d = new Mouth(3);
  const w = run(2000, () => d.update(FRAME, talk('y', 'playing', 0)));
  assert.ok(w.some((o) => o));
  assert.equal(d.levelDead(), true);
  assert.ok(LEVEL_DEAD_MS < 1000);
});

test('boca: línea nueva reinicia el patrón (empieza abriendo otra vez)', () => {
  const m = new Mouth(5);
  run(1000, () => m.update(FRAME, talk('one', 'done')));
  assert.equal(m.update(FRAME, talk('two', 'playing')), true);
});

test('NpcLife: se gira hacia el jugador al engancharla y vuelve a su orientación al soltarla', () => {
  const n = new NpcLife('npc_receptionist', 1, 'right');
  assert.equal(n.update(FRAME, life({ playerX: 100 })).facing, 'right', 'libre: la de por defecto');
  n.engage();
  assert.equal(n.update(FRAME, life({ playerX: 100, busy: true })).facing, 'left', 'jugador a la izquierda');
  assert.equal(n.turns, 1);
  assert.equal(n.update(FRAME, life({ playerX: 900, busy: true })).facing, 'right', 'cambia de lado: se gira');
  // Libre: aguanta RELEASE_MS y vuelve
  const v = run(RELEASE_MS + 200, () => n.update(FRAME, life({ playerX: 100 })).facing);
  assert.equal(v[0], 'left');
  assert.equal(v[v.length - 1], 'right');
  assert.equal(n.isEngaged(), false);
  assert.equal(n.atRest(), true);
  // Por defecto mirando a la izquierda (npcs[].facing)
  const l = new NpcLife('x', 1, 'left');
  assert.equal(l.update(FRAME, life({ playerX: 900 })).facing, 'left');
});

test('NpcLife: al hablar se engancha sola y apunta la conversación (líneas, boca, hacia dónde miraba)', () => {
  const n = new NpcLife('npc_receptionist', 9, 'right');
  run(800, () => n.update(FRAME, life({ playerX: 100, talking: true, line: 'one', voice: 'playing' })));
  run(800, () => n.update(FRAME, life({ playerX: 100, talking: true, line: 'two', voice: 'none' })));
  const lt = n.lastTalk;
  assert.equal(lt.lines, 2);
  assert.equal(lt.faced, 'left');
  assert.equal(lt.facedPlayer, true);
  assert.ok(lt.mouthMoves >= 4, `aperturas ${lt.mouthMoves}`);
  assert.equal(lt.voice, 'clip');
  assert.ok(lt.ms >= 1500);
  // Una conversación nueva (engage tras soltarse) la reinicia
  run(RELEASE_MS + 100, () => n.update(FRAME, life({ playerX: 100 })));
  n.engage();
  assert.equal(n.lastTalk, null);
});

test('NpcLife: una cinemática que le fijó la cara manda (facing null = no tocar)', () => {
  const n = new NpcLife('npc_receptionist', 1, 'right');
  n.noteFacing('left');
  const p = n.update(FRAME, life({ playerX: 900, talking: true, line: 'x', faceLocked: true }));
  assert.equal(p.facing, null);
  assert.equal(n.currentFacing(), 'left');
  assert.equal(n.lastTalk.facedPlayer, false, 'miraba a otro lado: lo dice');
  // Al acabar la cinemática vuelve a girarse hacia el jugador
  assert.equal(n.update(FRAME, life({ playerX: 900, talking: true, line: 'x' })).facing, 'right');
});

test('NpcLife: respira y parpadea sola, y en reposo con la boca cerrada', () => {
  const n = new NpcLife('npc_dr_satoshi', lifeSeed('npc_dr_satoshi', true), 'right');
  const poses = run(12000, () => n.update(FRAME, life()));
  assert.ok(poses.some((p) => p.breathPx === 1) && poses.some((p) => p.breathPx === 0));
  assert.ok(n.blinkCount() >= 2, `parpadeos ${n.blinkCount()}`);
  assert.ok(poses.every((p) => !p.mouthOpen));
  assert.equal(n.atRest(), true);
});

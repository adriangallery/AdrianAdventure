// A2.16 (plan SCUMM): prueba de estilo «Dex de papel» (`?dex=papel&papel=suave|media|tope`), src/systems/PaperDex.ts
// y los datos generados por art/dex2d/papel.py (src/data/dexPapelFrames.ts).
// CI (Node 22): node --experimental-strip-types --test tests/paper-dex.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parsePaperMode, PAPER_SPECS, PAPER_INTENSITIES, jawDropForLevel, JawDriver, ArmPoser, stanceSlip, PAPER_STEP_ART_PX,
  DEXPAPEL_WALK_POSES, DEXPAPEL_WALK_POSE_MS, paperWalkKey, paperFiles, paperJawAnchor, paperTalkAnim, paperPickIndex,
  paperVWalkIndex, JAW_STEP_MS, JAW_LEVEL_FULL,
} from '../src/systems/PaperDex.ts';
import * as D from '../src/data/dexPapelFrames.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parámetro de URL: sin ?dex=papel no hay modo papel (el Dex de A2.15)', () => {
  assert.equal(parsePaperMode(''), null);
  assert.equal(parsePaperMode('?qa=1'), null);
  assert.equal(parsePaperMode('?dex=rig'), null);
  assert.equal(parsePaperMode('?papel=tope'), null);
});

test('parámetro de URL: ?dex=papel → media por defecto; papel=suave|media|tope; valores raros → media', () => {
  assert.deepEqual(parsePaperMode('?dex=papel'), { intensity: 'media' });
  assert.deepEqual(parsePaperMode('?dex=PAPEL&papel=Tope'), { intensity: 'tope' });
  assert.deepEqual(parsePaperMode('?qa=1&dex=papel&papel=suave'), { intensity: 'suave' });
  assert.deepEqual(parsePaperMode('?dex=papel&papel=loco'), { intensity: 'media' });
});

test('intensidades: de suave a tope crece todo (mandíbula, desajuste, poses) y los brazos van más rápido', () => {
  const [s, m, t] = PAPER_INTENSITIES.map((k) => PAPER_SPECS[k]);
  assert.ok(s.jawMax < m.jawMax && m.jawMax < t.jawMax);
  assert.ok(s.jawSide <= m.jawSide && m.jawSide <= t.jawSide);
  assert.ok(s.armPoses.length < m.armPoses.length && m.armPoses.length < t.armPoses.length);
  assert.ok(s.armMinMs > t.armMinMs);
  for (const k of PAPER_INTENSITIES) {
    const p = PAPER_SPECS[k];
    // números del encargo: cambio de pose de brazos entre 400 y 900 ms
    assert.ok(p.armMinMs >= 400 && p.armMaxMs <= 900 && p.armMinMs < p.armMaxMs, k);
    assert.ok(p.jawMax <= 4, 'la mandíbula nunca baja más de 4 px (legible a escala de juego)');
  }
});

test('mandíbula en función del nivel: 0 en silencio, escalones enteros, tope en el nivel lleno', () => {
  for (const k of PAPER_INTENSITIES) {
    const max = PAPER_SPECS[k].jawMax;
    assert.equal(jawDropForLevel(0, max), 0);
    assert.equal(jawDropForLevel(0.005, max), 0);
    assert.equal(jawDropForLevel(NaN, max), 0);
    assert.equal(jawDropForLevel(0.021, max), 1);
    assert.equal(jawDropForLevel(JAW_LEVEL_FULL, max), max);
    assert.equal(jawDropForLevel(0.9, max), max);
    let prev = 0;
    for (let l = 0; l <= 0.3; l += 0.005) {
      const d = jawDropForLevel(l, max);
      assert.ok(Number.isInteger(d) && d >= prev, 'monótona y entera');
      prev = d;
    }
  }
});

test('JawDriver: cambia a saltos (como mucho cada JAW_STEP_MS), cerrada sin desajuste, abierta ≤ jawMax+1', () => {
  for (const k of PAPER_INTENSITIES) {
    const spec = PAPER_SPECS[k];
    const j = new JawDriver(spec, 7);
    let changes = 0;
    let last = JSON.stringify(j.state);
    let sides = 0;
    for (let t = 0; t < 6000; t += 16) {
      const lvl = Math.abs(Math.sin(t / 90)) * 0.2;
      const s = j.update(16, lvl);
      if (s.dy === 0) assert.equal(s.dx, 0, 'cerrada vuelve a su sitio');
      assert.ok(s.dy <= spec.jawMax + 1 && Math.abs(s.dx) <= 1);
      if (s.dx) sides++;
      if (JSON.stringify(s) !== last) { changes++; last = JSON.stringify(s); }
    }
    assert.ok(changes <= 6000 / JAW_STEP_MS + 1, `${k}: ${changes} cambios`);
    if (k === 'suave') assert.equal(sides, 0, 'suave no se descoloca de lado');
    if (k === 'tope') assert.ok(sides > 0, 'tope sí se descoloca a veces');
  }
});

test('JawDriver: con la voz en silencio se cierra; sin señal (null) abre y cierra a cadencia irregular', () => {
  const j = new JawDriver(PAPER_SPECS.media, 3);
  for (let t = 0; t < 500; t += 16) j.update(16, 0);
  assert.deepEqual(j.state, { dx: 0, dy: 0 });
  const free = new JawDriver(PAPER_SPECS.media, 3);
  const runs = [];
  let cur = null;
  let len = 0;
  for (let t = 0; t < 8000; t += 10) {
    const open = free.update(10, null).dy > 0;
    if (open === cur) len += 10;
    else { if (cur !== null) runs.push(len); cur = open; len = 10; }
  }
  assert.ok(runs.length > 20, 'abre y cierra');
  assert.ok(new Set(runs.map((r) => Math.round(r / 10))).size >= 2, "tramos de duración variable");
});

test('ArmPoser: no repite pose, cambia cada armMin..armMax ms y empieza gesticulando', () => {
  for (const k of PAPER_INTENSITIES) {
    const spec = PAPER_SPECS[k];
    const a = new ArmPoser(spec, 11);
    let pose = a.update(0, 5);
    assert.notEqual(pose, 0, 'arranca con un gesto');
    let since = 0;
    for (let t = 0; t < 20000; t += 10) {
      since += 10;
      const p = a.update(10, 5);
      if (p !== pose) {
        assert.ok(since >= spec.armMinMs - 10 && since <= spec.armMaxMs + 10, `${k}: ${since} ms`);
        assert.ok(spec.armPoses.includes(p));
        since = 0;
        pose = p;
      }
    }
    // de perfil hay 4 poses
    const b = new ArmPoser(spec, 5);
    for (let t = 0; t < 5000; t += 10) assert.ok(b.update(10, 4) < 4);
  }
});

test('andar sin patinar: el pie de apoyo retrocede respecto a la cadera lo mismo que avanza Dex (74 px/s)', () => {
  assert.equal(D.DEXPAPEL_WALK_POSES, DEXPAPEL_WALK_POSES);
  assert.equal(D.DEXPAPEL_WALK_POSE_MS, DEXPAPEL_WALK_POSE_MS);
  assert.ok(Math.abs(D.DEXPAPEL_STEP_ART_PX - PAPER_STEP_ART_PX) < 0.06);
  assert.ok(DEXPAPEL_WALK_POSE_MS >= 130 && DEXPAPEL_WALK_POSE_MS <= 150, 'ritmo del encargo: 130-150 ms por pose');
  for (const s of stanceSlip(D.DEXPAPEL_STANCE_X)) assert.ok(Math.abs(s) <= 0.5, `deriva ${s}`);
  // y a otra velocidad patinaría (la prueba no es trivial)
  assert.ok(stanceSlip(D.DEXPAPEL_STANCE_X, 100).some((s) => Math.abs(s) > 1));
});

test('fotogramas: andar 4 poses a saltos por intensidad, mismo alto (103) y PNG en disco', () => {
  for (const k of PAPER_INTENSITIES) {
    for (const d of ['r', 'l']) {
      const m = D.DEXPAPEL_ANIMS[`walk_${d}_${k}`];
      assert.ok(m, `walk_${d}_${k}`);
      assert.equal(m.frames, 4);
      assert.equal(m.h, 103);
    }
  }
  assert.equal(paperWalkKey('right', 'tope', 0), 'dexpapel_walk_r_tope_0');
  assert.equal(paperWalkKey('left', 'suave', 149), 'dexpapel_walk_l_suave_0');
  assert.equal(paperWalkKey('left', 'suave', 150), 'dexpapel_walk_l_suave_1');
  assert.equal(paperWalkKey('right', 'media', 600), 'dexpapel_walk_r_media_0');
  for (const f of paperFiles(D.DEXPAPEL_ANIMS)) assert.ok(existsSync(path.join(ROOT, f.url)), f.url);
});

test('hablar: cada fotograma tiene su mandíbula, el perfil izquierdo es el espejo del derecho', () => {
  for (const anim of ['talk_front', 'talk_r', 'talk_l']) {
    const m = D.DEXPAPEL_ANIMS[anim];
    assert.equal(m.jaw.length, m.frames);
    for (let i = 0; i < m.frames; i++) {
      const [x, y] = paperJawAnchor(D.DEXPAPEL_ANIMS, anim, i);
      assert.ok(x >= 0 && x < m.w && y > 10 && y < 30, `${anim} ${i}`);
    }
  }
  const r = D.DEXPAPEL_ANIMS.talk_r;
  const l = D.DEXPAPEL_ANIMS.talk_l;
  const jw = D.DEXPAPEL_JAW_SIZE.r[0];
  r.jaw.forEach(([x, y], i) => assert.deepEqual(l.jaw[i], [r.w - (x + jw), y]));
  assert.deepEqual(paperTalkAnim('front'), { anim: 'talk_front', jaw: 'front' });
  assert.deepEqual(paperTalkAnim('left'), { anim: 'talk_l', jaw: 'l' });
  assert.equal(paperTalkAnim('back'), null);
});

test('coger a saltos (3 poses) y andar en vertical con poses sostenidas (ciclo de 800 ms)', () => {
  assert.deepEqual([0, 110, 220, 319].map((t) => paperPickIndex(t, 320)), [0, 2, 3, 3]);
  assert.equal(paperPickIndex(-5, 320), 0);
  const seq = [];
  for (let t = 0; t < 1600; t += 200) seq.push(paperVWalkIndex(t));
  assert.deepEqual(seq, [0, 1, 3, 4, 0, 1, 3, 4]);
});

// F1.2 (plan FUNTICO_ADVENTURE): modelo de carrera de TriageScene (src/funtico/triage/TriageModel.ts), con reloj falso.
// Lo que registra tiene que pasar validateTaps y su puntuación ser la de scoreRun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateRun, scoreRun, validateTaps } from '../src/funtico/triage/triage.js';
import { TriageModel } from '../src/funtico/triage/TriageModel.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/funtico/triage/catalog.json', import.meta.url), 'utf-8'));
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

function fake(seed) {
  let now = 1000;
  const run = generateRun(seed, catalog);
  const m = new TriageModel(run, () => now);
  return { m, run, adv: (ms) => { now += ms; } };
}

test('carrera perfecta: registro válido y puntuación = scoreRun', () => {
  const { m, run, adv } = fake('model-perfect');
  for (const st of run.stations) {
    adv(900);
    const out = st.kind === 'relapse' ? m.pickOption(st.correct) : m.tapWorld(...center(st.bounds));
    assert.equal(out.kind, 'hit');
  }
  assert.ok(m.finished);
  assert.deepEqual(validateTaps(run, m.taps), { ok: true, reason: null });
  assert.equal(m.result().score, scoreRun(run, m.taps).score);
  assert.equal(m.result().hits, 9);
  assert.equal(m.bestStreak, 9);
  assert.ok(m.result().leftoverBonus > 0);
});

test('toques demasiado rápidos se ignoran (no se registran)', () => {
  const { m, adv } = fake('model-fast');
  adv(100);
  assert.equal(m.tapWorld(1, 1).kind, 'ignored');
  adv(300);
  assert.equal(m.tapWorld(0.1, 0.1).kind, 'miss');
  adv(50);
  assert.equal(m.tapWorld(0.1, 0.1).kind, 'ignored');
  assert.equal(m.taps.length, 1);
});

test('3 fallos cierran la estación; el tiempo acaba la carrera', () => {
  const { m, run, adv } = fake('model-miss');
  const st0 = run.stations[0];
  const far = st0.bounds.x > 50 ? 1 : 99;
  for (let k = 0; k < 3; k++) { adv(400); const o = m.tapWorld(far, 1); assert.equal(o.kind, 'miss'); assert.equal(o.closed, k === 2); }
  assert.equal(m.current, 1);
  assert.equal(m.score.raw, -750);
  adv(200000);
  assert.ok(m.tick());
  assert.ok(m.finished);
  assert.deepEqual(validateTaps(run, m.taps), { ok: true, reason: null });
});

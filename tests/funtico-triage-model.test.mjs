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

// ── F2.2/F2.4: formato de gameEvents (contrato del servidor) y de los eventos del Verifier ──
const V = await import('../src/funtico/triage/verifierEvents.ts');
const { catalogId } = await import('../src/funtico/triage/triage.js');

test('gameEvents: cabecera {triage, catalog} y toques con solo t, est, obj, x, y', () => {
  const { m, run, adv } = fake('model-events');
  for (const st of run.stations.slice(0, 3)) {
    adv(900);
    if (st.kind === 'relapse') m.pickOption(st.correct); else m.tapWorld(...center(st.bounds));
  }
  const ev = V.gameEventsFor(catalogId(catalog), m.taps);
  assert.deepEqual(JSON.parse(ev[0]), { triage: 1, catalog: catalogId(catalog) });
  assert.deepEqual(Object.keys(JSON.parse(ev[0])), ['triage', 'catalog']);
  assert.equal(ev.length, m.taps.length + 1);
  ev.slice(1).forEach((s, i) => {
    const o = JSON.parse(s);
    assert.deepEqual(Object.keys(o), ['t', 'est', 'obj', 'x', 'y']);
    assert.deepEqual(o, { ...m.taps[i] });
  });
});

test('eventos del Verifier: start / toque {t,est,obj,x,y,ok} / end, y la cola no entrega en el toque', () => {
  const got = [];
  const later = [];
  const q = new V.EventQueue((l) => got.push(l), (fn) => later.push(fn));
  q.push(V.startEvent({ runId: 'r'.repeat(32), catalog: '1:abc', stations: 9, durationMs: 180000 }));
  q.push(V.tapEvent({ t: 900, est: 0, obj: 'pill', x: 12.5, y: 40 }, true));
  q.push(V.tapEvent({ t: 1300, est: 1, obj: 'fud_2', x: 3, y: 0 }, false));
  assert.equal(got.length, 0, 'push no entrega en el acto');
  assert.equal(later.length, 1, 'una sola entrega programada');
  later[0]();
  assert.equal(got.length, 3);
  assert.deepEqual(JSON.parse(got[0]), { ev: 'start', v: 1, run: 'r'.repeat(32), cat: '1:abc', n: 9, dur: 180000 });
  assert.deepEqual(JSON.parse(got[1]), { t: 900, est: 0, obj: 'pill', x: 12.5, y: 40, ok: 1 });
  assert.deepEqual(Object.keys(JSON.parse(got[2])), ['t', 'est', 'obj', 'x', 'y', 'ok']);
  q.push(V.endEvent({ t: 1300, score: 10, hits: 1, misses: 1, completed: false }));
  q.flush();
  assert.deepEqual(JSON.parse(got[3]), { ev: 'end', t: 1300, score: 10, hits: 1, misses: 1, done: 0 });
  const bad = new V.EventQueue(() => { throw new Error('sdk'); }, (fn) => fn());
  assert.doesNotThrow(() => bad.push('x'));
});

test('nombre en el Hall of Fame: cabe entero o se corta limpio con «..»', async () => {
  const { fitName } = await import('../src/funtico/fitName.ts');
  assert.equal(fitName('Test Pilot #9950', 16), 'Test Pilot #9950');
  assert.equal(fitName('Test Pilot #9950', 15), 'Test Pilot..');
  assert.equal(fitName('Test Pilot #9950', 10), 'Test Pil..');
  assert.equal(fitName('dr_zero', 6), 'dr_z..');
  for (let n = 4; n < 16; n++) assert.ok(fitName('Test Pilot #9950', n).length <= n);
});

// A9.14: duración por capítulo (telemetría anónima). CI (Node 22):
// node --experimental-strip-types --test tests/chapter-timing.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../src/systems/ChapterTiming.ts');
const M = await import('../src/systems/SaveMigration.ts');

const MIN = 60_000;

test('partida nueva: cada capítulo se manda una vez con su duración', () => {
  const st = { flags: {}, playTimeMs: 0 };
  assert.deepEqual(T.noteChapterMarks(st), []);
  st.playTimeMs = 25 * MIN; st.flags.chapter_1_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), [{ chapter: 1, seconds: 1500 }]);
  assert.deepEqual(T.noteChapterMarks(st), [], 'no se repite');
  st.playTimeMs = 60 * MIN; st.flags.chapter_2_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), [{ chapter: 2, seconds: 2100 }]);
  assert.deepEqual(Object.keys(st.chapterTimes.marks), ['1', '2']);
});

test('partida vieja con capítulos cerrados: lo cerrado y el siguiente no se mandan', () => {
  const st = { flags: { chapter_1_complete: true }, playTimeMs: 40 * MIN };
  assert.deepEqual(T.noteChapterMarks(st), []);
  assert.equal(st.chapterTimes.marks[1], -1);
  st.playTimeMs = 70 * MIN; st.flags.chapter_2_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), [], 'cap. 2 empezó antes de medir');
  st.playTimeMs = 95 * MIN; st.flags.chapter_3_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), [{ chapter: 3, seconds: 1500 }]);
});

test('capítulo 1 solo si se empezó a medir con el tiempo casi a 0', () => {
  const st = { flags: {}, playTimeMs: 3 * MIN };
  T.noteChapterMarks(st);
  st.playTimeMs = 20 * MIN; st.flags.chapter_1_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), []);
  const ok = { flags: {}, playTimeMs: 4000 };
  T.noteChapterMarks(ok);
  ok.playTimeMs = 20 * MIN; ok.flags.chapter_1_complete = true;
  assert.deepEqual(T.noteChapterMarks(ok), [{ chapter: 1, seconds: 1200 }]);
});

test('duraciones absurdas no se mandan; estado roto no rompe', () => {
  const st = { flags: {}, playTimeMs: 0 };
  T.noteChapterMarks(st);
  st.playTimeMs = 3000; st.flags.chapter_1_complete = true;
  assert.deepEqual(T.noteChapterMarks(st), [], '< 10 s (atajo de depuración)');
  assert.deepEqual(T.noteChapterMarks(null), []);
  assert.deepEqual(T.noteChapterMarks({}), []);
});

test('telemetryAllowed: nada desde QA, CI, dev, local ni tráiler', () => {
  const base = { search: '', hostname: 'adventure.zerothetoken.com', isDev: false, webdriver: false };
  assert.equal(T.telemetryAllowed(base), true);
  assert.equal(T.telemetryAllowed({ ...base, search: '?qa=1' }), false);
  assert.equal(T.telemetryAllowed({ ...base, search: '?trailer' }), false);
  assert.equal(T.telemetryAllowed({ ...base, webdriver: true }), false);
  assert.equal(T.telemetryAllowed({ ...base, isDev: true }), false);
  assert.equal(T.telemetryAllowed({ ...base, hostname: 'localhost' }), false);
});

test('SaveMigration: chapterTimes válido se queda, corrupto se descarta', () => {
  const good = { flags: {}, chapterTimes: { start: 0, marks: { 1: 1500000, 2: -1, 9: 5, x: 3, 3: 'a' } } };
  M.migrateGameState(good);
  assert.deepEqual(good.chapterTimes, { start: 0, marks: { 1: 1500000, 2: -1 } });
  for (const bad of [null, 5, [], { start: -1, marks: {} }, { start: 0 }, { start: 0, marks: [] }]) {
    const st = { flags: {}, chapterTimes: bad };
    M.migrateGameState(st);
    assert.equal('chapterTimes' in st, false, JSON.stringify(bad));
  }
});

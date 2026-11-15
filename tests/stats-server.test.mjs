// A9.17: agregador de estadísticas anónimas. Node puro: node --test tests/stats-server.test.mjs (en `npm run test:server`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEvent, aggregateDay, quantile, summarizeDays, createStatsStore, hashSid, addDays } from '../save-server/stats.js';

const SID = 'abcdefgh12345678';
const base = { m: false, br: 'chrome', w: false };

test('parseEvent: solo campos conocidos; la dirección o la IP que lleguen se descartan', () => {
  const ev = parseEvent({ t: 'session_start', sid: SID, m: true, br: 'safari', w: true, address: '0x' + '1'.repeat(40), ip: '1.2.3.4' });
  assert.deepEqual(ev, { t: 'session_start', sid: SID, m: true, br: 'safari', w: true });
  assert.deepEqual(parseEvent({ t: 'chapter_complete', sid: SID, ch: 2, s: 1500 }), { t: 'chapter_complete', sid: SID, m: false, br: 'other', w: false, ch: 2, s: 1500 });
  assert.equal(parseEvent({ t: 'chapter_complete', sid: SID, ch: 2, s: 'x' }).s, undefined);
  assert.equal(parseEvent({ t: 'quit_scene', sid: SID, scene: 'lobby' }).scene, 'lobby');
  for (const bad of [null, [], {}, { t: 'nope', sid: SID }, { t: 'new_game', sid: 'short' }, { t: 'new_game', sid: 'a b c d e f g h' },
    { t: 'chapter_start', sid: SID }, { t: 'chapter_start', sid: SID, ch: 6 }, { t: 'quit_scene', sid: SID, scene: '../etc' }]) {
    assert.equal(parseEvent(bad), null, JSON.stringify(bad));
  }
});

test('quantile: interpolación lineal (percentiles p25/mediana/p75)', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10], 0.25), 10);
  assert.equal(quantile([100, 200, 300, 400], 0.5), 250);
  assert.equal(quantile([100, 200, 300, 400], 0.25), 175);
  assert.equal(quantile([100, 200, 300, 400], 0.75), 325);
});

test('aggregateDay: cuenta por partida, plataforma del primer evento, último abandono', () => {
  const ev = (h, t, extra = {}) => ({ ...base, h, t, ...extra });
  const agg = aggregateDay('2026-11-14', [
    ev('a', 'session_start', { m: true, br: 'safari', w: true }), ev('a', 'new_game'), ev('a', 'new_game'),
    ev('a', 'chapter_start', { ch: 1 }), ev('a', 'chapter_complete', { ch: 1, s: 1200 }), ev('a', 'chapter_start', { ch: 2 }),
    ev('a', 'quit_scene', { scene: 'lobby' }), ev('a', 'quit_scene', { scene: 'upstairs' }),
    ev('b', 'session_start'), ev('b', 'continue'), ev('b', 'chapter_complete', { ch: 1 }), ev('b', 'game_complete'),
    ev('b', 'quit_scene', { scene: 'upstairs' }),
  ]);
  assert.equal(agg.uniques, 2);
  assert.equal(agg.newGames, 1);
  assert.equal(agg.continues, 1);
  assert.equal(agg.chapterStart[1], 1); assert.equal(agg.chapterStart[2], 1);
  assert.equal(agg.chapterComplete[1], 2);
  assert.deepEqual(agg.chapterSeconds[1], [1200]);
  assert.equal(agg.gameComplete, 1);
  assert.deepEqual(agg.platform, { mobile: 1, desktop: 1 });
  assert.deepEqual(agg.wallet, { with: 1, without: 1 });
  assert.equal(agg.browser.safari, 1); assert.equal(agg.browser.chrome, 1);
  assert.deepEqual(agg.quitScenes, { upstairs: 2 });
});

test('summarizeDays: embudo, tiempos y % que llega al final', () => {
  const d1 = aggregateDay('2026-11-13', [1, 2, 3, 4].map((i) => ({ ...base, h: `h${i}`, t: 'chapter_start', ch: 1 })));
  const d2 = aggregateDay('2026-11-14', [
    ...[600, 900, 1200, 1800].map((s, i) => ({ ...base, h: `h${i}`, t: 'chapter_complete', ch: 1, s })),
    { ...base, h: 'h0', t: 'game_complete' },
  ]);
  const r = summarizeDays([d2, d1], { today: '2026-11-14', uniqueToday: 4, uniqueWeek: 4 });
  assert.deepEqual(r.funnel[0], { chapter: 1, start: 4, complete: 4 });
  assert.deepEqual(r.chapterTime[0], { chapter: 1, n: 4, p25: 825, median: 1050, p75: 1350 });
  assert.equal(r.chapterTime[1].median, null);
  assert.deepEqual(r.finish, { started: 4, completed: 1, rate: 25 });
  assert.deepEqual(r.uniques.daily.map((d) => d.day), ['2026-11-13', '2026-11-14']);
  assert.equal(r.uniques.week, 4);
});

test('almacén: únicos día/semana por hash, sin el id del navegador en disco, y purga a los 30 días', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stats-'));
  try {
    let t = Date.UTC(2026, 9, 1, 12);
    const store = createStatsStore({ dir, now: () => t });
    const put = (sid, ev) => store.record(parseEvent({ sid, ...ev }));
    put('sessionAAAAAAAA', { t: 'session_start' });
    put('sessionAAAAAAAA', { t: 'new_game' });
    const day1 = '2026-10-01';
    const raw = readFileSync(store.rawFile(day1), 'utf-8');
    assert.ok(!raw.includes('sessionAAAAAAAA'), 'el id del navegador no se guarda');
    assert.ok(raw.includes(hashSid('sessionAAAAAAAA', store.salt)));

    // Seis días después: A vuelve, B nueva → hoy 2, semana 2
    t += 6 * 86400000;
    put('sessionAAAAAAAA', { t: 'continue' });
    put('sessionBBBBBBBB', { t: 'session_start', m: true });
    let s = store.summary();
    assert.equal(s.uniques.today, 2);
    assert.equal(s.uniques.week, 2);
    assert.equal(s.games.new, 1);
    assert.equal(s.games.continue, 1);
    assert.ok(existsSync(store.dailyFile(day1)), 'el día cerrado tiene su agregado');

    // Un día más: el día 1 ya cae fuera de la semana (A cuenta por el día 7; B y C)
    t += 86400000;
    put('sessionCCCCCCCC', { t: 'session_start' });
    s = store.summary();
    assert.equal(s.uniques.today, 1);
    assert.equal(s.uniques.week, 3);

    // 31 días después del primero: el crudo del día 1 se borra, su agregado diario se queda
    t = Date.UTC(2026, 9, 31, 12);
    const purged = store.maintain();
    assert.deepEqual(purged, [day1]);
    assert.ok(!existsSync(store.rawFile(day1)));
    assert.ok(existsSync(store.dailyFile(day1)));
    assert.ok(existsSync(store.rawFile(addDays(day1, 6))), 'el día 7 (hace 24 días) sigue');
    // El agregado viejo no lleva ids
    assert.ok(!readFileSync(store.dailyFile(day1), 'utf-8').includes(hashSid('sessionAAAAAAAA', store.salt)));
    // Línea rota en un crudo: se ignora
    writeFileSync(store.rawFile('2026-10-31'), 'roto\n');
    assert.equal(store.summary().uniques.today, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A9.14: telemetría anónima del save-server. Node puro: node --test tests/telemetry-server.test.mjs (en `npm run test:server`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSample, sampleLine, createRateLimiter, summarize } from '../save-server/telemetry.js';

test('parseSample: solo capítulo 1-5 y segundos enteros 10..21600; lo demás se ignora', () => {
  assert.deepEqual(parseSample({ chapter: 2, seconds: 1500, address: '0xabc', runId: 'x' }), { chapter: 2, seconds: 1500 });
  for (const bad of [null, [], {}, { chapter: 0, seconds: 100 }, { chapter: 6, seconds: 100 }, { chapter: '1', seconds: 100 },
    { chapter: 1, seconds: 9 }, { chapter: 1, seconds: 21601 }, { chapter: 1, seconds: 100.5 }]) {
    assert.equal(parseSample(bad), null, JSON.stringify(bad));
  }
});

test('sampleLine: capítulo, segundos y día, nada más', () => {
  const line = sampleLine({ chapter: 3, seconds: 1800 }, Date.UTC(2026, 10, 14, 16, 45));
  assert.deepEqual(JSON.parse(line), { c: 3, s: 1800, d: '2026-11-14' });
  assert.ok(line.endsWith('\n'));
});

test('límite por IP en memoria', () => {
  let t = 0;
  const lim = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.equal(lim('a'), true); assert.equal(lim('a'), true); assert.equal(lim('a'), false);
  assert.equal(lim('b'), true);
  t = 1001; assert.equal(lim('a'), true);
});

test('summarize: mediana y cuartiles por capítulo, líneas rotas fuera', () => {
  const text = [1200, 1500, 1800, 2400].map((s) => JSON.stringify({ c: 1, s, d: '2026-11-14' })).join('\n') + '\nroto\n{"c":9,"s":100}\n';
  const r = summarize(text);
  const c1 = r.chapters[0];
  assert.equal(c1.n, 4); assert.equal(c1.median, 1650); assert.equal(c1.min, 1200); assert.equal(c1.max, 2400);
  assert.equal(r.chapters[1].n, 0); assert.equal(r.chapters[1].median, null);
  assert.equal(summarize('').chapters.length, 5);
});

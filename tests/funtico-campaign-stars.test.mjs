// F3.2a (plan FUNTICO_ADVENTURE): estrellas simuladas de Campaign (src/funtico/campaign/stars.ts).
// node --experimental-strip-types --test tests/funtico-campaign-stars.test.mjs (en `npm run test:funtico`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../src/funtico/campaign/stars.ts');
const m = (o = {}) => ({ completed: 1, time_s: 100, hints: 0, hint_max_level: 0, optional: 0, ...o });

test('par provisional: cap. 1 = 600 s, cap. 2 = 1200 s', () => {
  assert.equal(S.parFor(1), 600);
  assert.equal(S.parFor(2), 1200);
  assert.equal(S.parFor(3), null);
});

test('sin terminar: 0 estrellas', () => {
  assert.equal(S.computeStars(1, m({ completed: 0 })), 0);
});

test('★ terminar; ★★ con hint_max_level ≤ 1; ★★★ sin pistas y bajo el par', () => {
  assert.equal(S.computeStars(1, m({ hints: 3, hint_max_level: 2 })), 1);
  assert.equal(S.computeStars(1, m({ hints: 2, hint_max_level: 3 })), 1);
  assert.equal(S.computeStars(1, m({ hints: 2, hint_max_level: 1 })), 2);
  assert.equal(S.computeStars(1, m({ hints: 1, hint_max_level: 1, time_s: 10 })), 2, 'con una pista no hay tercera');
  assert.equal(S.computeStars(1, m({ time_s: 600 })), 3, 'en el par justo vale');
  assert.equal(S.computeStars(1, m({ time_s: 601 })), 2);
});

test('★★★ por opcionales solo si el capítulo tiene alguno', () => {
  // cap. 1 no tiene opcionales: pasado el par, sin pistas, se queda en 2
  assert.equal(S.computeStars(1, m({ time_s: 5000, optional: 0 })), 2);
  assert.equal(S.computeStars(1, m({ time_s: 5000, optional: 3 })), 2);
  // cap. 2: pasado el par pero con todos los opcionales
  assert.equal(S.computeStars(2, m({ time_s: 5000, optional: S.OPTIONAL_TOTAL[2] })), 3);
  assert.equal(S.computeStars(2, m({ time_s: 5000, optional: 0 })), 2);
  assert.equal(S.computeStars(2, m({ time_s: 5000, optional: S.OPTIONAL_TOTAL[2], hints: 1, hint_max_level: 1 })), 2);
});

test('las reglas se pintan en texto (inglés, con el par)', () => {
  const l1 = S.starRuleLines(1);
  assert.equal(l1.length, 3);
  assert.match(l1[2], /10:00/);
  assert.doesNotMatch(l1[2], /EXTRAS/);
  assert.match(S.starRuleLines(2)[2], /20:00 OR ALL 1 EXTRAS/);
});

test('formatTime y starString', () => {
  assert.equal(S.formatTime(0), '00:00');
  assert.equal(S.formatTime(754.9), '12:34');
  assert.equal(S.formatTime(null), '--:--');
  assert.equal(S.starString(2), '**-');
  assert.equal(S.starString(9), '***');
});

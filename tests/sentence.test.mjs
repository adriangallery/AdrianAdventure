// A2.18 (plan SCUMM): frase de dos pasos «Give X to …» / «Use X with …» (src/systems/Sentence.ts). Lógica pura, sin Phaser.
// CI (Node 22): node --experimental-strip-types --test tests/sentence.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../src/systems/Sentence.ts');

test('GIVE + objeto: queda «Give X to ...» esperando destino (ya no responde al momento)', () => {
  const { next, action } = S.tapItem(S.idle('GIVE'), 'ledger');
  assert.deepEqual(action, { kind: 'pending', verb: 'GIVE', item: 'ledger' });
  assert.deepEqual(next, { verb: 'GIVE', item: 'ledger' });
  assert.equal(S.isPending(next), true);
  assert.equal(S.sentenceText(next, 'Give', 'Hardware Wallet', null), 'Give Hardware Wallet to...');
  assert.equal(S.sentenceText(next, 'Give', 'Hardware Wallet', 'Penny'), 'Give Hardware Wallet to Penny');
  // el propio objeto bajo el ratón no es un destino
  assert.equal(S.sentenceText(next, 'Give', 'Hardware Wallet', 'Hardware Wallet'), 'Give Hardware Wallet to...');
});

test('USE (y WALK) + objeto: «Use X with ...»; WALK pasa a USE', () => {
  for (const verb of ['USE', 'WALK']) {
    const { next, action } = S.tapItem(S.idle(verb), 'fence_plank');
    assert.deepEqual(action, { kind: 'pending', verb: 'USE', item: 'fence_plank' });
    assert.equal(S.sentenceText(next, 'Use', 'Fence Plank', null), 'Use Fence Plank with...');
    assert.equal(S.sentenceText(next, 'Use', 'Fence Plank', 'Poster'), 'Use Fence Plank with Poster');
  }
});

test('USE de un objeto que se usa solo (disfraz): al momento, sin frase pendiente', () => {
  const { next, action } = S.tapItem(S.idle('USE'), 'ape_costume', { immediateUse: (id) => id === 'ape_costume' });
  assert.deepEqual(action, { kind: 'immediate', verb: 'USE', item: 'ape_costume' });
  assert.equal(S.isPending(next), false);
  // con GIVE el disfraz sí espera destino
  assert.equal(S.tapItem(S.idle('GIVE'), 'ape_costume', { immediateUse: () => true }).action.kind, 'pending');
});

test('verbos de un objeto sobre el inventario: al momento y sin frase pendiente', () => {
  for (const verb of ['LOOK', 'OPEN', 'CLOSE', 'PUSH', 'PULL', 'PICK', 'TALK']) {
    const { next, action } = S.tapItem(S.idle(verb), 'mystery_envelope');
    assert.deepEqual(action, { kind: 'immediate', verb, item: 'mystery_envelope' }, verb);
    assert.deepEqual(next, { verb, item: null }, verb);
  }
});

test('frase pendiente + otro objeto: se resuelve «V X con Y» y vuelve a WALK; el mismo objeto la suelta', () => {
  const give = { verb: 'GIVE', item: 'ledger' };
  let r = S.tapItem(give, 'rubber_duck');
  assert.deepEqual(r.action, { kind: 'resolve', verb: 'GIVE', item: 'ledger', target: 'rubber_duck' });
  assert.deepEqual(r.next, { verb: 'WALK', item: null });
  r = S.tapItem({ verb: 'USE', item: 'note_half_a' }, 'note_half_b');
  assert.deepEqual(r.action, { kind: 'resolve', verb: 'USE', item: 'note_half_a', target: 'note_half_b' });
  r = S.tapItem(give, 'ledger');
  assert.deepEqual(r.action, { kind: 'drop' });
  assert.deepEqual(r.next, { verb: 'GIVE', item: null });
});

test('cancelar: otro verbo, el mismo verbo, clic derecho/Esc; el suelo vacío la mantiene', () => {
  const give = { verb: 'GIVE', item: 'ledger' };
  assert.deepEqual(S.selectVerb(give, 'USE'), { verb: 'USE', item: null });
  assert.deepEqual(S.selectVerb(give, 'LOOK'), { verb: 'LOOK', item: null });
  assert.deepEqual(S.selectVerb(give, 'GIVE'), { verb: 'WALK', item: null });
  assert.deepEqual(S.selectVerb({ verb: 'USE', item: 'x' }, 'USE'), { verb: 'WALK', item: null });
  assert.deepEqual(S.cancel(give), { next: { verb: 'WALK', item: null }, had: true });
  assert.deepEqual(S.cancel(S.idle('WALK')), { next: { verb: 'WALK', item: null }, had: false });
  assert.deepEqual(S.tapFloor(give), give);
  assert.deepEqual(S.resolved(), { verb: 'WALK', item: null });
});

test('línea de acción sin objeto: WALK vacía o «Walk to X»; otro verbo, su etiqueta', () => {
  assert.equal(S.sentenceText(S.idle('WALK'), 'Walk to', null, null), '');
  assert.equal(S.sentenceText(S.idle('WALK'), 'Walk to', null, 'Plant'), 'Walk to Plant');
  assert.equal(S.sentenceText(S.idle('GIVE'), 'Give', null, null), 'Give');
  assert.equal(S.sentenceText(S.idle('LOOK'), 'Look at', null, 'Plant'), 'Look at Plant');
  assert.equal(S.isPending({ verb: 'LOOK', item: 'x' }), false);
});

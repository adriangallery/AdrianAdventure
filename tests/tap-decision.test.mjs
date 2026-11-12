// A1.14 (plan SCUMM): decisión de un toque (src/systems/TapDecision.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/tap-decision.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../src/systems/TapDecision.ts');

test('WALK + suelo sin hotspot = andar', () => {
  assert.equal(T.decideTap({ verb: 'WALK', target: 'floor', hasItem: false, touch: true }), 'walk');
  assert.equal(T.decideTap({ verb: 'LOOK', target: 'floor', hasItem: false, touch: false }), 'walk');
});

test('WALK + hotspot con el dedo = andar (o mantener para la acción principal), nunca LOOK', () => {
  assert.equal(T.decideTap({ verb: 'WALK', target: 'hotspot', hasItem: false, touch: true }), 'hold-or-walk');
  assert.equal(T.decideTap({ verb: 'WALK', target: 'hotspot', hasItem: false, touch: false }), 'walk-hotspot');
});

test('WALK + hotspot de suelo (punto tocado andable) = andar al punto tocado', () => {
  // outside: toque en hs_path / hs_carport sobre el suelo
  assert.deepEqual(T.walkPointFor({ x: 75, y: 95 }, true, { x: 57, y: 92 }), { x: 75, y: 95 });
});

test('WALK + hotspot objeto (punto no andable) = andar a su punto de llegada, sin frase', () => {
  // outside: buzón (walkTo 57,92) tocado en su caja
  assert.deepEqual(T.walkPointFor({ x: 60, y: 72 }, false, { x: 57, y: 92 }), { x: 57, y: 92 });
  // sin punto de llegada: al tocado (la ruta lleva al alcanzable más cercano); nunca se queda sin destino
  assert.deepEqual(T.walkPointFor({ x: 77, y: 70 }, false, null), { x: 77, y: 70 });
});

test('verbo elegido + hotspot = ejecutar el verbo; objeto elegido = combo; NPC = npc', () => {
  assert.equal(T.decideTap({ verb: 'LOOK', target: 'hotspot', hasItem: false, touch: true }), 'verb');
  assert.equal(T.decideTap({ verb: 'OPEN', target: 'hotspot', hasItem: false, touch: false }), 'verb');
  assert.equal(T.decideTap({ verb: 'USE', target: 'hotspot', hasItem: true, touch: true }), 'combo');
  assert.equal(T.decideTap({ verb: 'WALK', target: 'npc', hasItem: false, touch: true }), 'npc');
});

const free = { textShowing: false, justDismissed: false, cinematic: false, dialogueActive: false, awaitingChoice: false, scriptRunning: false };

test('toque sin texto ni bloqueo = se ejecuta ya', () => {
  assert.equal(T.textTapPolicy(free), 'execute');
});

test('toque durante una frase suelta = la salta y se ejecuta (también si la frase la cerró este mismo toque)', () => {
  assert.equal(T.textTapPolicy({ ...free, textShowing: true }), 'skip-and-execute');
  assert.equal(T.textTapPolicy({ ...free, textShowing: true, scriptRunning: true }), 'skip-and-execute');
  assert.equal(T.textTapPolicy({ ...free, justDismissed: true, scriptRunning: true }), 'skip-and-execute');
});

test('cinemática, diálogo con opciones o script sin texto = solo avanzar', () => {
  assert.equal(T.textTapPolicy({ ...free, textShowing: true, cinematic: true }), 'skip-only');
  assert.equal(T.textTapPolicy({ ...free, textShowing: true, dialogueActive: true }), 'skip-only');
  assert.equal(T.textTapPolicy({ ...free, awaitingChoice: true }), 'skip-only');
  assert.equal(T.textTapPolicy({ ...free, scriptRunning: true }), 'skip-only');
});

test('toque diferido: se ejecuta al quedar libre, espera al script y se descarta si sale otra frase', () => {
  const s = { textShowing: false, scriptRunning: false, dialogueActive: false, cinematic: false, sceneChanging: false };
  assert.equal(T.deferredTapVerdict(s, 16), 'run');
  assert.equal(T.deferredTapVerdict({ ...s, scriptRunning: true }, 16), 'wait');
  assert.equal(T.deferredTapVerdict({ ...s, scriptRunning: true }, T.DEFERRED_TAP_MAX_MS + 1), 'drop');
  assert.equal(T.deferredTapVerdict({ ...s, textShowing: true }, 16), 'drop', 'la frase siguiente del script: el toque era «siguiente»');
  assert.equal(T.deferredTapVerdict({ ...s, dialogueActive: true }, 16), 'drop');
  assert.equal(T.deferredTapVerdict({ ...s, cinematic: true }, 16), 'drop');
  assert.equal(T.deferredTapVerdict({ ...s, sceneChanging: true }, 16), 'drop');
});

test('tras una acción con verbo, el verbo vuelve a WALK', () => {
  for (const v of ['LOOK', 'OPEN', 'USE', 'PICK', 'TALK', 'GIVE', 'WALK']) assert.equal(T.verbAfterAction(v), 'WALK');
});

// A1.13 (plan SCUMM): «Continue» carga la partida más reciente CON PROGRESO y el autoguardado no pisa partidas.
// CI (Node 22): node --experimental-strip-types --test tests/save-progress.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../src/systems/SaveProgress.ts');
const S = await import('../src/systems/SaveSlots.ts');

/** localStorage de mentira con key()/length, como el del navegador. */
const memStore = (init = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  };
};
const game = (scene, flags = [], inv = [], extra = {}) => ({
  saveVersion: 2, currentScene: scene, flags: Object.fromEntries(flags.map((f) => [f, true])),
  inventory: inv.map((id) => ({ id, name: id, icon: null, fromNFT: false })), visited: [scene],
  firedTriggers: [], dialogueProgress: {}, achievements: [], ...extra,
});
const at = (hms) => Date.parse(`2026-11-11T${hms}+01:00`);

// Las partidas de Adrián (11-nov): slot 2 a las 19:01:42 (2 flags, 0 objetos), slot 1 a las 19:02:04 (5 flags,
// 2 objetos: su grabación manual), slot 0 = autoguardado VACÍO a las 19:02:45. Todo en `outside` (capítulo 1).
const INTRO = ['premise_shown', 'chapter_1_intro_shown'];
const SLOT1_FLAGS = [...INTRO, 'porch_light_off', 'found_note_half_a', 'has_plank'];
const adrianSlots = () => ({
  0: { id: 0, state: game('outside', [], [], { savedAt: at('19:02:45') }), timestamp: at('19:02:45'), sceneName: 'Outside' },
  1: { id: 1, state: game('outside', SLOT1_FLAGS, ['note_half_a', 'fence_plank'], { savedAt: at('19:02:04') }), timestamp: at('19:02:04'), sceneName: 'Outside' },
  2: { id: 2, state: game('outside', INTRO, [], { savedAt: at('19:01:42') }), timestamp: at('19:01:42'), sceneName: 'Outside' },
});

test('saveProgress: New Game = 0; flags, objetos, escenas y notas suman', () => {
  assert.equal(P.saveProgress(game('outside')), 0);
  assert.equal(P.hasProgress(null), false);
  assert.equal(P.saveProgress(game('outside', ['a'], ['x'])), 2);
  assert.equal(P.saveProgress({ ...game('outside'), flags: { a: false } }), 0);
  assert.equal(P.saveProgress({ ...game('lobby'), visited: ['outside', 'lobby'] }), 1);
  assert.equal(P.saveProgress({ ...game('outside'), journal: { notes: ['n1'], seen: [], hints: {}, calls: 0 } }), 1);
  // objetos que vienen de un NFT no son progreso
  assert.equal(P.saveProgress({ ...game('outside'), inventory: [{ id: 'nft', name: 'n', icon: null, fromNFT: true }] }), 0);
});

test('caso de Adrián: Continue elige el slot 1 (5 flags, 2 objetos), no el autoguardado vacío más nuevo', () => {
  const st = memStore({ [P.SAVE_KEY]: JSON.stringify(adrianSlots()) });
  const best = P.pickContinue(P.collectLocalCandidates(st));
  assert.equal(best.source, 'slot');
  assert.equal(best.slotId, 1);
  assert.equal(best.timestamp, at('19:02:04'));
  assert.deepEqual(best.state.inventory.map((i) => i.id), ['note_half_a', 'fence_plank']);
  assert.equal(Object.values(best.state.flags).filter(Boolean).length, 5);
});

test('caso de Adrián con su partida de cartera más vieja: sigue ganando el slot 1', () => {
  const st = memStore({
    [P.SAVE_KEY]: JSON.stringify(adrianSlots()),
    'adrian_adventure_wallet_0x4943aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': JSON.stringify({
      state: game('outside', ['found_envelope'], ['floppy_box']), address: '0x4943', timestamp: at('18:30:00'), signature: null, sceneName: 'Outside',
    }),
  });
  assert.equal(P.pickContinue(P.collectLocalCandidates(st)).slotId, 1);
});

test('solo partida de cartera → Continue la carga', () => {
  const st = memStore({
    'adrian_adventure_wallet_0xabc': JSON.stringify({ state: game('lobby', ['door_unlocked'], ['keycard']), timestamp: 50, sceneName: 'Lobby' }),
    unrelated: 'x',
  });
  const best = P.pickContinue(P.collectLocalCandidates(st));
  assert.equal(best.source, 'wallet');
  assert.equal(best.key, 'adrian_adventure_wallet_0xabc');
  assert.equal(best.sceneName, 'Lobby');
});

test('cartera más nueva que los slots → gana la cartera; «Before load» y «Previous autosave» también cuentan', () => {
  const slots = adrianSlots();
  const st = memStore({
    [P.SAVE_KEY]: JSON.stringify(slots),
    'adrian_adventure_wallet_0xabc': JSON.stringify({ state: game('lobby', ['door_unlocked']), timestamp: at('19:05:00'), sceneName: 'Lobby' }),
  });
  assert.equal(P.pickContinue(P.collectLocalCandidates(st)).source, 'wallet');
  const st2 = memStore({ [P.SAVE_KEY]: JSON.stringify({ ...slots, 3: { id: 3, state: game('upstairs', ['x']), timestamp: at('19:10:00'), sceneName: 'Upstairs' } }) });
  assert.equal(P.pickContinue(P.collectLocalCandidates(st2)).slotId, 3);
  const st3 = memStore({ [P.SAVE_KEY]: JSON.stringify({ 0: slots[0], 4: { id: 4, state: game('lobby', ['y']), timestamp: 1, sceneName: 'Lobby' } }) });
  assert.equal(P.pickContinue(P.collectLocalCandidates(st3)).slotId, 4);
});

test('todo vacío (o corrupto) → sin Continue', () => {
  assert.equal(P.pickContinue(P.collectLocalCandidates(memStore())), null);
  assert.equal(P.pickContinue(P.collectLocalCandidates(memStore({ [P.SAVE_KEY]: JSON.stringify({ 0: adrianSlots()[0] }) }))), null);
  assert.equal(P.pickContinue(P.collectLocalCandidates(memStore({ [P.SAVE_KEY]: '{roto', 'adrian_adventure_wallet_x': 'nope' }))), null);
});

test('a igual fecha gana la de más progreso; la nube solo sustituye si es más nueva Y con más progreso', () => {
  const a = { source: 'slot', slotId: 1, state: game('outside', ['a']), sceneName: 'O', timestamp: 10 };
  const b = { source: 'slot', slotId: 2, state: game('outside', ['a', 'b']), sceneName: 'O', timestamp: 10 };
  assert.equal(P.pickContinue([a, b]).slotId, 2);
  const newerPoorer = { source: 'cloud', state: game('outside', ['z']), sceneName: 'O', timestamp: 20 };
  const newerRicher = { source: 'cloud', state: game('lobby', ['a', 'b', 'c']), sceneName: 'L', timestamp: 20 };
  const olderRicher = { ...newerRicher, timestamp: 5 };
  assert.equal(P.cloudBeatsLocal(b, newerPoorer), false);
  assert.equal(P.cloudBeatsLocal(b, olderRicher), false);
  assert.equal(P.cloudBeatsLocal(b, newerRicher), true);
  assert.equal(P.cloudBeatsLocal(null, newerPoorer), true);
  assert.equal(P.cloudBeatsLocal(b, { ...newerRicher, state: game('outside') }), false);
});

/** El autoguardado de SaveLoadSystem.autoSave, con el almacenamiento inyectado (misma secuencia que el código). */
const autoSave = (st, state, sceneName, now) => {
  const existing = S.readSlot(st, 0);
  const plan = P.autosavePlan(existing?.state, state);
  if (!plan.write) return false;
  if (plan.backupExisting && existing) {
    if (!S.writeSlotVerified(st, P.PREVIOUS_AUTOSAVE_SLOT, existing.state, existing.sceneName, existing.timestamp).ok) return false;
  }
  return S.writeSlotVerified(st, 0, state, sceneName, now).ok;
};

test('un autoguardado vacío no pisa el slot 0 con progreso (ni de otra partida ni de la misma)', () => {
  const st = memStore();
  const run = game('lobby', ['door_unlocked'], ['keycard'], { runId: 'rA' });
  assert.equal(autoSave(st, run, 'Lobby', 100), true);
  assert.equal(autoSave(st, game('outside', [], [], { runId: 'rB' }), 'Outside', 200), false);
  assert.equal(autoSave(st, game('outside', [], [], { runId: 'rA' }), 'Outside', 300), false);
  assert.equal(autoSave(st, game('outside'), 'Outside', 400), false);
  const s0 = S.readSlot(st, 0);
  assert.equal(s0.timestamp, 100);
  assert.deepEqual(s0.state.inventory.map((i) => i.id), ['keycard']);
  assert.equal(S.readSlot(st, P.PREVIOUS_AUTOSAVE_SLOT), null);
});

test('misma partida: el autoguardado avanza aunque gaste objetos (sin copia)', () => {
  const st = memStore();
  autoSave(st, game('outside', ['a'], ['x', 'y'], { runId: 'rA' }), 'Outside', 100);
  assert.equal(autoSave(st, game('outside', ['a', 'b'], [], { runId: 'rA' }), 'Outside', 200), true);
  assert.equal(S.readSlot(st, 0).timestamp, 200);
  assert.equal(S.readSlot(st, P.PREVIOUS_AUTOSAVE_SLOT), null);
});

test('New Game a propósito: la partida anterior se conserva en «Previous autosave» y Continue la sigue viendo', () => {
  const st = memStore();
  const old = game('upstairs', ['door_unlocked', 'found_keycard'], ['keycard', 'terminal_key'], { runId: 'rOld' });
  autoSave(st, old, 'Upstairs', 100);
  // New Game: el estado inicial no se autoguarda
  assert.equal(autoSave(st, game('outside', [], [], { runId: 'rNew' }), 'Outside', 200), false);
  assert.equal(S.readSlot(st, 0).state.runId, 'rOld');
  // primer progreso de la partida nueva: se escribe y la vieja pasa a la copia
  assert.equal(autoSave(st, game('outside', ['premise_shown'], [], { runId: 'rNew' }), 'Outside', 300), true);
  assert.equal(S.readSlot(st, 0).state.runId, 'rNew');
  const prev = S.readSlot(st, P.PREVIOUS_AUTOSAVE_SLOT);
  assert.equal(prev.state.runId, 'rOld');
  assert.equal(prev.timestamp, 100);
  assert.deepEqual(prev.state.inventory.map((i) => i.id), ['keycard', 'terminal_key']);
  assert.equal(S.slotLabel(P.PREVIOUS_AUTOSAVE_SLOT), 'Previous autosave');
  // la partida vieja sigue disponible para cargar
  const ids = P.collectLocalCandidates(st).map((c) => c.slotId);
  assert.ok(ids.includes(P.PREVIOUS_AUTOSAVE_SLOT));
  // partidas viejas sin runId cuentan como otra partida: también se copian antes de pisarlas
  const st2 = memStore({ [P.SAVE_KEY]: JSON.stringify({ 0: { id: 0, state: game('lobby', ['x']), timestamp: 5, sceneName: 'Lobby' } }) });
  assert.equal(autoSave(st2, game('outside', ['y'], [], { runId: 'rN' }), 'Outside', 6), true);
  assert.equal(S.readSlot(st2, P.PREVIOUS_AUTOSAVE_SLOT).state.currentScene, 'lobby');
});

test('caso de Adrián tras Continue: el autoguardado de la escena escribe el slot 1 en el 0 y no toca 1 ni 2', () => {
  const st = memStore({ [P.SAVE_KEY]: JSON.stringify(adrianSlots()) });
  const best = P.pickContinue(P.collectLocalCandidates(st));
  const loaded = { ...structuredClone(best.state), runId: 'rLoaded' };
  assert.equal(autoSave(st, loaded, 'Outside', at('19:10:00')), true);
  const after = adrianSlots();
  assert.deepEqual(S.readSlot(st, 1), after[1]);
  assert.deepEqual(S.readSlot(st, 2), after[2]);
  assert.equal(Object.values(S.readSlot(st, 0).state.flags).filter(Boolean).length, 5);
  // el 0 que había estaba vacío: no hace falta copia
  assert.equal(S.readSlot(st, P.PREVIOUS_AUTOSAVE_SLOT), null);
});

test('runId: generado válido; inválidos rechazados', () => {
  const id = P.newRunId(1_700_000_000_000, 0.5);
  assert.ok(P.isValidRunId(id));
  assert.equal(P.isValidRunId(''), false);
  assert.equal(P.isValidRunId('<script>'), false);
  assert.equal(P.isValidRunId(42), false);
});

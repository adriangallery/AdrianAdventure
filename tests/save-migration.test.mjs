// A1.4 (plan SCUMM): migración de partidas guardadas (flags renombradas). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/save-migration.test.mjs (va en `npm run test:engine`)
// SAVE_MIGRATION_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { migrateGameState, migrateSave, SAVE_VERSION, RENAMED_FLAGS } = await import(
  process.env.SAVE_MIGRATION_PATH ?? '../src/systems/SaveMigration.ts'
);

/** Partida v1 (antes de A1.4) tal como la dejaba el juego en localStorage o en la nube. */
const oldState = (flags) => ({
  currentScene: 'upstairs',
  flags,
  inventory: [{ id: 'terminal_key', name: 'Trading Terminal Key', icon: null, fromNFT: false }],
  visited: ['outside', 'lobby', 'upstairs'],
  firedTriggers: [],
  dialogueProgress: {},
  achievements: [],
});

test('found_hw_wallet pasa a found_terminal_key y desaparece', () => {
  const s = oldState({ found_hw_wallet: true, found_pz_note: true, found_code_note: true });
  const out = migrateGameState(s);
  assert.equal(out, s, 'migra en su sitio');
  assert.deepEqual(s.flags, { found_terminal_key: true, found_pz_note: true, found_code_note: true });
  assert.equal(s.saveVersion, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 2);
});

test('el cajón sin abrir sigue sin abrir', () => {
  const s = migrateGameState(oldState({ found_code_note: true }));
  assert.equal('found_terminal_key' in s.flags, false);
  assert.equal('found_hw_wallet' in s.flags, false);
});

test('un false viejo explícito se conserva como false; un true en cualquiera de los dos gana', () => {
  assert.deepEqual(migrateGameState(oldState({ found_hw_wallet: false })).flags, { found_terminal_key: false });
  assert.deepEqual(migrateGameState(oldState({ found_hw_wallet: true, found_terminal_key: false })).flags, { found_terminal_key: true });
  assert.deepEqual(migrateGameState(oldState({ found_hw_wallet: false, found_terminal_key: true })).flags, { found_terminal_key: true });
});

test('idempotente, y se aplica aunque la partida ya sea v2 (un cliente viejo puede reescribir el nombre viejo)', () => {
  const s = migrateGameState(oldState({ found_hw_wallet: true }));
  assert.deepEqual(migrateGameState(structuredClone(s)), s);
  const rewritten = { ...s, flags: { ...s.flags, found_hw_wallet: true } };
  assert.deepEqual(migrateGameState(rewritten).flags, { found_terminal_key: true });
  assert.equal(migrateGameState({ ...s, saveVersion: 99 }).saveVersion, 99, 'no baja la versión de una partida más nueva');
});

test('envoltorios de partida (slot local, wallet, nube) y estados incompletos', () => {
  const slot = { id: 1, timestamp: 1, sceneName: 'Upstairs', state: oldState({ found_hw_wallet: true }) };
  assert.equal(migrateSave(slot), slot);
  assert.deepEqual(slot.state.flags, { found_terminal_key: true });
  const cloud = { address: '0xabc', timestamp: 2, signature: null, sceneName: 'x', state: oldState({ found_hw_wallet: true }) };
  migrateSave(cloud);
  assert.deepEqual(cloud.state.flags, { found_terminal_key: true });
  // nada de esto lanza
  assert.equal(migrateSave(null), null);
  assert.equal(migrateSave(undefined), undefined);
  assert.deepEqual(migrateSave({ sceneName: 'sin estado' }), { sceneName: 'sin estado' });
  assert.equal(migrateGameState(null), null);
  assert.deepEqual(migrateGameState({ currentScene: 'outside' }), { currentScene: 'outside', saveVersion: SAVE_VERSION });
});

test('ningún nombre nuevo es a su vez un nombre viejo (no hay cadenas ni ciclos)', () => {
  for (const newName of Object.values(RENAMED_FLAGS)) assert.equal(newName in RENAMED_FLAGS, false, newName);
});

test('A2.6: una partida sin dialogueUsed carga igual (sin opciones usadas) y no se le inventa el campo', () => {
  const s = migrateGameState(oldState({}));
  assert.equal('dialogueUsed' in s, false);
});

test('A2.6: dialogueUsed válido se conserva; lo corrupto se limpia', () => {
  const ok = migrateGameState({ ...oldState({}), dialogueUsed: { lobby_tree: ['hub:Hi'] } });
  assert.deepEqual(ok.dialogueUsed, { lobby_tree: ['hub:Hi'] });
  const mixed = migrateGameState({ ...oldState({}), dialogueUsed: { a: ['x', 3, null], b: 'nope' } });
  assert.deepEqual(mixed.dialogueUsed, { a: ['x'] });
  for (const bad of [null, 'x', 7, ['a']]) {
    const s = migrateGameState({ ...oldState({}), dialogueUsed: bad });
    assert.equal('dialogueUsed' in s, false, `descarta ${JSON.stringify(bad)}`);
  }
});

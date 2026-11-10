// A1.12 (plan SCUMM): guardado fiable. Lógica pura con almacenamiento y fetch inyectados.
// CI (Node 22): node --experimental-strip-types --test tests/save-slots.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import(process.env.SAVE_SLOTS_PATH ?? '../src/systems/SaveSlots.ts');

const memStore = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const game = (scene, flags = {}, inv = [], savedAt = 1) => ({
  currentScene: scene, flags, inventory: inv.map((id) => ({ id, name: id })), visited: [scene],
  firedTriggers: [], dialogueProgress: {}, achievements: [], savedAt,
});

test('writeSlotVerified: escribe ese slot, lo relee y no toca los demás', () => {
  const st = memStore();
  assert.equal(S.writeSlotVerified(st, 1, game('lobby', { a: true }), 'Lobby', 100).ok, true);
  assert.equal(S.writeSlotVerified(st, 2, game('outside'), 'Outside', 200).ok, true);
  // sobrescribir el 1 (caso de Adrián): el 1 cambia de verdad, el 2 sigue igual
  const r = S.writeSlotVerified(st, 1, game('upstairs', { a: true, b: true }, ['key'], 300), 'Upstairs', 300);
  assert.equal(r.ok, true);
  // «recargar la página» = leer de cero el mismo almacenamiento
  const again = S.readSlot(memStore(st.data), 1);
  assert.equal(again.sceneName, 'Upstairs');
  assert.equal(again.state.currentScene, 'upstairs');
  assert.deepEqual(again.state.flags, { a: true, b: true });
  assert.equal(again.state.inventory[0].id, 'key');
  assert.equal(S.readSlot(st, 2).sceneName, 'Outside');
});

test('writeSlotVerified: almacenamiento lleno o que no guarda → error, nunca ok', () => {
  const full = { getItem: () => null, setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } };
  assert.deepEqual(S.writeSlotVerified(full, 1, game('lobby'), 'Lobby', 1), { ok: false, error: 'storage-full' });
  const blackHole = { getItem: () => null, setItem: () => {} };
  assert.deepEqual(S.writeSlotVerified(blackHole, 1, game('lobby'), 'Lobby', 1), { ok: false, error: 'verify-failed' });
  // guarda otra cosa (p. ej. otra pestaña escribe a la vez): la relectura no coincide
  let stored = null;
  const liar = { getItem: () => stored, setItem: () => { stored = JSON.stringify({ 1: { id: 1, state: game('other'), timestamp: 1, sceneName: 'Lobby' } }); } };
  assert.equal(S.writeSlotVerified(liar, 1, game('lobby'), 'Lobby', 1).ok, false);
  assert.deepEqual(S.writeSlotVerified(memStore(), 1, null, 'x', 1), { ok: false, error: 'no-game' });
});

test('writeSlotVerified no muta la partida en memoria', () => {
  const g = game('lobby', { a: true });
  const copy = JSON.stringify(g);
  S.writeSlotVerified(memStore(), 1, g, 'Lobby', 5);
  assert.equal(JSON.stringify(g), copy);
});

test('pickSlotView: gana el más reciente (una copia vieja de la nube no tapa el guardado local)', () => {
  const local = { id: 1, state: game('upstairs'), timestamp: 500, sceneName: 'Upstairs' };
  const remote = { state: game('lobby'), sceneName: 'Lobby', timestamp: 100 };
  assert.equal(S.pickSlotView(1, local, remote).sceneName, 'Upstairs');
  assert.equal(S.pickSlotView(1, local, { ...remote, timestamp: 900 }).source, 'cloud');
  assert.equal(S.pickSlotView(1, null, { state: game('x'), savedAt: 7 }).timestamp, 7);
  assert.equal(S.pickSlotView(1, null, null), null);
});

test('slotTapAction: nunca carga en un clic; sobrescribir pide confirmación', () => {
  const v = { slotId: 1, state: game('a'), sceneName: 'A', timestamp: 1, source: 'local' };
  assert.equal(S.slotTapAction('load', 1, v, true), 'confirm-load');
  assert.equal(S.slotTapAction('load', 2, null, true), 'none');
  assert.equal(S.slotTapAction('save', 1, v, true), 'confirm-overwrite');
  assert.equal(S.slotTapAction('save', 2, null, true), 'save-now');
  assert.equal(S.slotTapAction('save', 2, null, false), 'none');
  // el autoguardado y la copia de seguridad no se escriben a mano
  assert.equal(S.slotTapAction('save', S.AUTOSAVE_SLOT, null, true), 'none');
  assert.equal(S.slotTapAction('save', S.BACKUP_SLOT, null, true), 'none');
});

test('backupBeforeLoad: guarda la partida actual en «Before load» sin tocar los manuales', () => {
  const st = memStore();
  S.writeSlotVerified(st, 1, game('lobby'), 'Lobby', 1);
  assert.equal(S.backupBeforeLoad(st, game('upstairs', { x: true }), 'Upstairs', 2).ok, true);
  assert.equal(S.readSlot(st, S.BACKUP_SLOT).sceneName, 'Upstairs');
  assert.equal(S.readSlot(st, 1).sceneName, 'Lobby');
  assert.equal(S.slotLabel(S.BACKUP_SLOT), 'Before load');
});

// ─── Nube: servidor en memoria ───
const ADDR = '0x' + 'ab'.repeat(20);
function fakeServer({ failPost = 0, dropWrite = false } = {}) {
  const db = {};
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const m = url.match(/\/save\/(0x[0-9a-f]{40})\/(\d)$/);
    if ((init.method ?? 'GET') === 'POST') {
      if (failPost) return { ok: false, status: failPost, json: async () => ({ error: 'x' }) };
      const b = JSON.parse(init.body);
      if (!b.authSignature) return { ok: false, status: 401, json: async () => ({}) };
      if (!dropWrite) db[`${b.address}:${b.slot}`] = { ...b, savedAt: Date.now() };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const hit = m && db[`${m[1]}:${m[2]}`];
    return hit ? { ok: true, status: 200, json: async () => hit } : { ok: false, status: 404, json: async () => ({}) };
  };
  return { db, calls, fetch };
}
const auth = (now) => ({ signature: '0xsig', timestamp: now - 1000 });

test('cloudSaveVerified: 2xx + relectura del mismo slot = ok', async () => {
  const srv = fakeServer();
  const now = Date.now();
  const r = await S.cloudSaveVerified({ fetch: srv.fetch, base: 'https://s', address: ADDR.toUpperCase().replace('0X', '0x'), auth: auth(now), state: game('lobby', {}, [], now), sceneName: 'Lobby', slot: 2, now });
  assert.deepEqual(r, { ok: true });
  assert.ok(srv.db[`${ADDR}:2`]);
  assert.deepEqual(srv.calls.map((c) => c.method), ['POST', 'GET']);
  assert.match(srv.calls[1].url, /\/save\/0x[0-9a-f]{40}\/2$/);
});

test('cloudSaveVerified: 500, sin sesión, sesión caducada, escritura perdida → error (nunca «guardado»)', async () => {
  const now = Date.now();
  const base = { base: 'https://s', address: ADDR, state: game('lobby'), sceneName: 'Lobby', slot: 1, now };
  assert.deepEqual(await S.cloudSaveVerified({ ...base, fetch: fakeServer({ failPost: 500 }).fetch, auth: auth(now) }), { ok: false, error: 'http', status: 500 });
  const noSess = fakeServer();
  assert.deepEqual(await S.cloudSaveVerified({ ...base, fetch: noSess.fetch, auth: null }), { ok: false, error: 'no-session' });
  assert.equal(noSess.calls.length, 0);
  assert.equal((await S.cloudSaveVerified({ ...base, fetch: fakeServer().fetch, auth: { signature: '0x', timestamp: now - S.SESSION_MAX_AGE_MS } })).error, 'session-expired');
  assert.equal((await S.cloudSaveVerified({ ...base, fetch: fakeServer({ failPost: 401 }).fetch, auth: auth(now) })).error, 'session-expired');
  assert.equal((await S.cloudSaveVerified({ ...base, fetch: fakeServer({ dropWrite: true }).fetch, auth: auth(now) })).error, 'verify-failed');
  assert.equal((await S.cloudSaveVerified({ ...base, fetch: async () => { throw new Error('offline'); }, auth: auth(now) })).error, 'network');
  assert.equal((await S.cloudSaveVerified({ ...base, slot: S.BACKUP_SLOT, fetch: fakeServer().fetch, auth: auth(now) })).error, 'invalid-slot');
});

test('saveFingerprint: distingue escena, flags, inventario y fecha', () => {
  const a = S.saveFingerprint(game('lobby', { a: true }, ['k'], 1), 'L');
  assert.equal(a, S.saveFingerprint(game('lobby', { a: true, z: false }, ['k'], 1), 'L'));
  assert.notEqual(a, S.saveFingerprint(game('outside', { a: true }, ['k'], 1), 'L'));
  assert.notEqual(a, S.saveFingerprint(game('lobby', { b: true }, ['k'], 1), 'L'));
  assert.notEqual(a, S.saveFingerprint(game('lobby', { a: true }, [], 1), 'L'));
  assert.notEqual(a, S.saveFingerprint(game('lobby', { a: true }, ['k'], 2), 'L'));
  assert.ok(S.saveErrorMessage('http', 500).includes('500'));
});

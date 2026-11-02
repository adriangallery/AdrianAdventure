// A1.6: /leaderboard no publica direcciones completas. Node puro: `node --test tests/leaderboard-privacy.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateAddress, publicPlayer, createEnsCache } from '../save-server/privacy.js';

const FULL = '0x13FCBBBD00000000000000000000000000007F23';
const FULL_LC = FULL.toLowerCase();

test('truncateAddress: 6 + … + 4, en minúsculas', () => {
  const t = truncateAddress(FULL);
  assert.equal(t, '0x13fc…7f23');
  assert.equal(t.length, 11);
  assert.equal(truncateAddress(FULL_LC), t);
});

test('truncateAddress: casos raros', () => {
  assert.equal(truncateAddress(''), '');
  assert.equal(truncateAddress(undefined), '');
  assert.equal(truncateAddress(null), '');
  assert.equal(truncateAddress(42), '');
  assert.equal(truncateAddress('0x' + 'z'.repeat(40)), '', 'no hex');
  assert.equal(truncateAddress('hola'), '');
  assert.equal(truncateAddress(FULL_LC + '00'), '', 'longitud incorrecta');
  assert.equal(truncateAddress('0x13fc…7f23'), '0x13fc…7f23', 'ya truncada → tal cual');
});

const internal = {
  address: FULL_LC, sceneName: 'The Lobby', score: 420, chapters: 1, scenesVisited: 3, items: 2, puzzles: 1,
  gameComplete: false, patientZero: false, holderBadges: ['ARCHIVIST'], holderPts: 100, hiddenPts: 0,
  achievements: ['first_steps'], lastSaved: 1700000000000, secretoInterno: 'no debe salir',
};

test('publicPlayer: sin la dirección completa en ningún campo', () => {
  const row = publicPlayer(internal);
  assert.equal(row.address, '0x13fc…7f23');
  assert.equal(row.ens, null);
  assert.equal(row.score, 420);
  assert.deepEqual(row.holderBadges, ['ARCHIVIST']);
  assert.equal('secretoInterno' in row, false, 'lista blanca de campos');
  const json = JSON.stringify(row).toLowerCase();
  assert.equal(json.includes(FULL_LC), false);
  assert.equal(json.includes(FULL_LC.slice(2, 12)), false);
});

test('publicPlayer: ENS desde la caché y filas inválidas', () => {
  assert.equal(publicPlayer(internal, (a) => (a === FULL_LC ? 'adrian.eth' : null)).ens, 'adrian.eth');
  assert.equal(publicPlayer(internal, () => undefined).ens, null);
  assert.equal(publicPlayer(internal, () => '').ens, null);
  assert.equal(publicPlayer({ ...internal, address: 'basura' }), null);
  assert.equal(publicPlayer(null), null);
});

test('createEnsCache: no bloquea, cachea nombres y null, TTL', async () => {
  let t = 0;
  const calls = [];
  const cache = createEnsCache({
    resolve: async (a) => { calls.push(a); return a === FULL_LC ? 'adrian.eth' : null; },
    now: () => t, ttlMs: 1000, log: () => {},
  });
  const other = '0x' + '1'.repeat(40);
  assert.equal(cache.get(FULL_LC), undefined);
  const p = cache.prefetch([FULL, other, FULL_LC]);
  assert.equal(cache.get(FULL_LC), undefined, 'aún no resuelto: el leaderboard no espera');
  await p;
  assert.equal(cache.get(FULL_LC), 'adrian.eth');
  assert.equal(cache.get(other), null, 'el null también se cachea');
  assert.equal(calls.length, 2, 'sin duplicados');
  await cache.prefetch([FULL_LC, other]);
  assert.equal(calls.length, 2, 'en caché: no se vuelve a pedir');
  t = 2000;
  assert.equal(cache.get(FULL_LC), undefined, 'caducado');
  await cache.prefetch([FULL_LC, 'no-es-direccion']);
  assert.equal(calls.length, 3);
});

test('createEnsCache: errores y timeout no rompen y se cachean como null', async () => {
  const logs = [];
  const a = '0x' + 'a'.repeat(40);
  const b = '0x' + 'b'.repeat(40);
  const cache = createEnsCache({
    resolve: (x) => (x === a ? Promise.reject(new Error('rpc caído\nstack secreto')) : new Promise(() => {})),
    timeoutMs: 30, log: (m) => logs.push(m),
  });
  await cache.prefetch([a, b]);
  assert.equal(cache.get(a), null);
  assert.equal(cache.get(b), null);
  assert.equal(logs.length, 2);
  assert.ok(logs.every((m) => !m.includes('stack') && !m.includes('aaaaaaaaaa')), 'log breve, sin dirección completa');
});

test('createEnsCache: concurrencia acotada', async () => {
  let active = 0;
  let max = 0;
  const cache = createEnsCache({
    resolve: async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; return null; },
    concurrency: 3, log: () => {},
  });
  const addrs = Array.from({ length: 10 }, (_, i) => '0x' + i.toString(16).repeat(40));
  await cache.prefetch(addrs);
  assert.equal(max, 3);
  assert.equal(cache.size(), 10);
});

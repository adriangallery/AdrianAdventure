// A9.17: acceso a /stats por firma de wallet (tipo SIWE). Wallets de prueba generadas aquí; STATS_ADMINS real NO va en
// el repo. Node: node --test tests/stats-auth.test.mjs (en `npm run test:server`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createStatsAuth, parseAdmins, loadSessionSecret, NONCE_TTL_MS, SESSION_TTL_MS } from '../save-server/stats-auth.js';
import { createStatsRoutes } from '../save-server/stats-routes.js';
import { createStatsStore } from '../save-server/stats.js';

const admin = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'stats-auth-'));
  const clock = { t: Date.UTC(2026, 10, 14, 20) };
  const auth = createStatsAuth({
    admins: parseAdmins(`  ${admin.address.toUpperCase().replace('0X', '0x')} , not-an-address`),
    secret: loadSessionSecret(undefined, join(dir, 'secret')),
    verify: verifyMessage,
    now: () => clock.t,
  });
  const store = createStatsStore({ dir, now: () => clock.t });
  const routes = createStatsRoutes({ store, auth });
  const call = (method, path, { body, token } = {}) => routes({
    method, path, bodyText: body ? JSON.stringify(body) : '', headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '127.0.0.1',
  });
  return { dir, clock, call, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function signIn(call, account) {
  const n = await call('GET', '/stats/nonce');
  assert.equal(n.status, 200);
  assert.match(n.body.message, /Nonce: [0-9a-f]{32}/);
  assert.match(n.body.message, /NOT a transaction/);
  assert.match(n.body.message, /Issued At: 2026-/);
  const signature = await account.signMessage({ message: n.body.message });
  return { nonce: n.body.nonce, signature, message: n.body.message };
}

test('parseAdmins: minúsculas y solo direcciones válidas', () => {
  assert.deepEqual(parseAdmins(`${admin.address}, basura,`), [admin.address.toLowerCase()]);
  assert.deepEqual(parseAdmins(undefined), []);
});

test('firma válida de una wallet de la lista → 200 y el token abre /stats/summary', async () => {
  const s = setup();
  try {
    const { nonce, signature } = await signIn(s.call, admin);
    const r = await s.call('POST', '/stats/login', { body: { address: admin.address, signature, nonce } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.address, admin.address.toLowerCase());
    assert.equal(r.body.expiresAt, s.clock.t + SESSION_TTL_MS);
    const sum = await s.call('GET', '/stats/summary', { token: r.body.token });
    assert.equal(sum.status, 200);
    assert.equal(sum.body.funnel.length, 5);
    // Token caducado (12 h) → 401
    s.clock.t += SESSION_TTL_MS + 1;
    assert.equal((await s.call('GET', '/stats/summary', { token: r.body.token })).status, 401);
  } finally { s.done(); }
});

test('firma válida de otra wallet (no está en la lista) → 401', async () => {
  const s = setup();
  try {
    const { nonce, signature } = await signIn(s.call, stranger);
    const r = await s.call('POST', '/stats/login', { body: { address: stranger.address, signature, nonce } });
    assert.equal(r.status, 401);
  } finally { s.done(); }
});

test('firma de otra wallet haciéndose pasar por la admin → 401', async () => {
  const s = setup();
  try {
    const { nonce, signature } = await signIn(s.call, stranger);
    const r = await s.call('POST', '/stats/login', { body: { address: admin.address, signature, nonce } });
    assert.equal(r.status, 401);
  } finally { s.done(); }
});

test('nonce reutilizado → 401', async () => {
  const s = setup();
  try {
    const { nonce, signature } = await signIn(s.call, admin);
    assert.equal((await s.call('POST', '/stats/login', { body: { address: admin.address, signature, nonce } })).status, 200);
    assert.equal((await s.call('POST', '/stats/login', { body: { address: admin.address, signature, nonce } })).status, 401);
  } finally { s.done(); }
});

test('nonce caducado (> 5 min) → 401', async () => {
  const s = setup();
  try {
    const { nonce, signature } = await signIn(s.call, admin);
    s.clock.t += NONCE_TTL_MS + 1;
    assert.equal((await s.call('POST', '/stats/login', { body: { address: admin.address, signature, nonce } })).status, 401);
  } finally { s.done(); }
});

test('sin token, token basura o token firmado con otro secreto → 401', async () => {
  const s = setup();
  try {
    assert.equal((await s.call('GET', '/stats/summary')).status, 401);
    assert.equal((await s.call('GET', '/stats/summary', { token: 'abc.def' })).status, 401);
    const other = createStatsAuth({ admins: [admin.address], secret: 'x'.repeat(40), verify: verifyMessage });
    const n = other.issueNonce();
    const signature = await admin.signMessage({ message: n.message });
    const r = await other.login({ address: admin.address, signature, nonce: n.nonce });
    assert.equal(r.ok, true);
    assert.equal((await s.call('GET', '/stats/summary', { token: r.token })).status, 401);
  } finally { s.done(); }
});

test('ingestión: evento válido 200, basura 400, demasiado grande 413', async () => {
  const s = setup();
  try {
    assert.equal((await s.call('POST', '/stats/event', { body: { t: 'session_start', sid: 'abcdefgh12345678', m: true } })).status, 200);
    assert.equal((await s.call('POST', '/stats/event', { body: { t: 'hack', sid: 'abcdefgh12345678' } })).status, 400);
    assert.equal((await s.call('POST', '/stats/event', { body: { t: 'new_game', sid: 'abcdefgh12345678', pad: 'x'.repeat(600) } })).status, 413);
  } finally { s.done(); }
});

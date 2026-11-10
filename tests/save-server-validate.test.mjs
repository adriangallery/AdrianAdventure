// A1.12: validación del save-server (dirección, slot, firma de sesión). Node puro:
// node --test tests/save-server-validate.test.mjs (va en `npm run test:server`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAddress, parseSlot, checkSessionAuth, validateSaveBody, sessionMessage, SESSION_MAX_AGE_MS,
} from '../save-server/validate.js';

const ADDR = '0x' + 'ab'.repeat(20);

test('normalizeAddress: solo 0x + 40 hex', () => {
  assert.equal(normalizeAddress(ADDR.toUpperCase().replace('0X', '0x')), ADDR);
  for (const bad of ['', '0x123', ADDR + '0', '../../etc/passwd', `${ADDR}/../x`, null, 42, ADDR.replace('ab', 'zz')]) {
    assert.equal(normalizeAddress(bad), null, String(bad));
  }
});

test('parseSlot: lista blanca 0-2', () => {
  assert.equal(parseSlot(0), 0);
  assert.equal(parseSlot('2'), 2);
  for (const bad of [3, -1, '3', '1.0', '01', '1abc', '../1', 1.5, null, undefined, 'x']) assert.equal(parseSlot(bad), null, String(bad));
});

test('checkSessionAuth: exige firma, no caducada, válida para ESA dirección', async () => {
  const now = 1_800_000_000_000;
  const seen = [];
  const verify = async ({ address, message, signature }) => { seen.push(message); return signature === '0xgood'.replace('good', 'aa') && address === ADDR; };
  assert.equal((await checkSessionAuth({ address: ADDR, now, verify })).status, 401);
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: '0xaa', now, verify })).status, 401);
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: 'nothex', authTimestamp: now, now, verify })).ok, false);
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: '0xaa', authTimestamp: now - SESSION_MAX_AGE_MS - 1, now, verify })).ok, false);
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: '0xaa', authTimestamp: now + 60 * 60 * 1000, now, verify })).ok, false);
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: '0xbb', authTimestamp: now, now, verify })).ok, false);
  assert.deepEqual(await checkSessionAuth({ address: ADDR, authSignature: '0xaa', authTimestamp: String(now - 1000), now, verify }), { ok: true });
  assert.equal(seen.at(-1), sessionMessage(ADDR, now - 1000));
  const throws = async () => { throw new Error('rpc down'); };
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: '0xaa', authTimestamp: now, now, verify: throws })).ok, false);
});

test('checkSessionAuth con una firma real (viem), si está instalado', async (t) => {
  let viem, accounts;
  try { viem = await import('viem'); accounts = await import('viem/accounts'); } catch { t.skip('viem no instalado'); return; }
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const addr = account.address.toLowerCase();
  const ts = Date.now();
  const signature = await account.signMessage({ message: sessionMessage(addr, ts) });
  const verify = (args) => viem.verifyMessage(args);
  assert.deepEqual(await checkSessionAuth({ address: addr, authSignature: signature, authTimestamp: ts, verify }), { ok: true });
  // la firma de otra wallet no vale para esta dirección
  assert.equal((await checkSessionAuth({ address: ADDR, authSignature: signature, authTimestamp: ts, verify })).ok, false);
});

test('validateSaveBody: campos, dirección y slot', () => {
  const ok = validateSaveBody({ state: { currentScene: 'lobby' }, address: ADDR, slot: 2, sceneName: 'Lobby', timestamp: 5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.slot, 2);
  assert.equal(validateSaveBody({ state: {}, address: ADDR }).slot, 1);
  assert.equal(validateSaveBody(null).status, 400);
  assert.equal(validateSaveBody({ address: ADDR }).status, 400);
  assert.equal(validateSaveBody({ state: [], address: ADDR }).status, 400);
  assert.equal(validateSaveBody({ state: {}, address: '0x1' }).status, 400);
  assert.equal(validateSaveBody({ state: {}, address: ADDR, slot: 3 }).status, 400);
  assert.equal(validateSaveBody({ state: {}, address: ADDR, slot: '1' }).ok, true);
  assert.equal(validateSaveBody({ state: {}, address: ADDR, sceneName: 'x'.repeat(201) }).status, 400);
  assert.equal(validateSaveBody({ state: {}, address: ADDR, timestamp: 'now' }).status, 400);
});

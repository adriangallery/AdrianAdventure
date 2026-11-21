// F2.1: save-server/funtico-crypto.js frente al CryptoHelper del SDK vendorizado.
//   npm run test:funtico-server   (node --experimental-transform-types --test …)
// Dos fuentes de verdad: vectores fijos versionados (tests/fixtures/funtico-crypto-vectors.json, regenerables con
// scripts/funtico-crypto-vectors.mjs) y el propio SDK cargado en vivo (tests/funtico-sdk-loader.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFunticoSdk } from './funtico-sdk-loader.mjs';
import { encrypt, decrypt, hmacSha256, verifyHmac, formatKey, practiceKey, attemptKey, sessionKey, signKey } from '../save-server/funtico-crypto.js';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/funtico-crypto-vectors.json', import.meta.url), 'utf8'));
const { CryptoHelper } = await loadFunticoSdk();

// Claves de PRUEBA, obviamente falsas, construidas por código.
const padKey = 'p'.repeat(32);
const realKey = 'k'.repeat(16) + 'z'.repeat(16);

test('vectores fijos del SDK: cifrar da lo mismo y descifrar devuelve el texto', () => {
  assert.ok(vectors.encrypt.length >= 20);
  for (const v of vectors.encrypt) {
    assert.equal(encrypt(v.plain, v.key), v.cipher, `cifrar ${JSON.stringify(v.plain)} con clave de ${v.key.length}`);
    assert.equal(decrypt(v.cipher, v.key), v.plain);
  }
  for (const v of vectors.hmac) {
    assert.equal(hmacSha256(v.message, v.key), v.hex);
    assert.ok(verifyHmac(v.message, v.key, v.hex));
  }
});

test('los vectores versionados siguen cuadrando con el SDK vendorizado actual', async () => {
  for (const v of vectors.encrypt) assert.equal(await CryptoHelper.encrypt(v.plain, v.key), v.cipher);
  for (const v of vectors.hmac) assert.equal(await CryptoHelper.hmacSha256(v.message, v.key), v.hex);
});

test('en vivo contra el SDK: lo que cifra uno lo descifra el otro, en los dos sentidos', async () => {
  const plain = JSON.stringify({ Score: 987654, RunId: 'r-42', Collected: { chest_1: 2 }, GameEvents: ['{"t":1}', 'ñ'] });
  for (const key of [practiceKey(1234, padKey), attemptKey('att-0001-xyz', realKey), sessionKey(0xa1b2, realKey), 'x']) {
    const fromSdk = await CryptoHelper.encrypt(plain, key);
    assert.equal(decrypt(fromSdk, key), plain);
    assert.equal(fromSdk, encrypt(plain, key));
    assert.equal(await CryptoHelper.decrypt(encrypt(plain, key), key), plain);
  }
  assert.equal(hmacSha256('abc', signKey(realKey)), await CryptoHelper.hmacSha256('abc', signKey(realKey)));
});

test('derivación de claves = la del SDK en cada método', () => {
  assert.equal(practiceKey(42, padKey), '00000042' + 'p'.repeat(8));
  assert.equal(practiceKey(123456789012, realKey), '12345678' + 'k'.repeat(8));
  assert.equal(attemptKey('abcdefghijkl', realKey), 'abcdefgh' + 'k'.repeat(8));
  assert.equal(sessionKey(255, realKey), '000000ff' + 'z'.repeat(8));
  assert.equal(signKey(realKey), 'k'.repeat(8) + 'z'.repeat(16));
  assert.equal(formatKey('ab'), 'ab' + 'a'.repeat(14));
  assert.equal(formatKey(''), '0'.repeat(16));
});

test('ida y vuelta del relay: relleno (cliente) → servidor → real → el SDK con la real lo descifra y la firma verifica', async () => {
  const userId = 777;
  const plain = JSON.stringify({ Score: 31337, RunId: 'run-abc' });
  // «Cliente»: el SDK con la clave de relleno, como en CompletePractice
  const clientData = await CryptoHelper.encrypt(plain, practiceKey(userId, padKey));
  const clientHash = await CryptoHelper.hmacSha256(clientData, signKey(padKey));
  // Servidor: comprueba y deshace el relleno, rehace con la real
  assert.ok(verifyHmac(clientData, signKey(padKey), clientHash));
  const opened = decrypt(clientData, practiceKey(userId, padKey));
  assert.equal(opened, plain);
  const realData = encrypt(opened, practiceKey(userId, realKey));
  const realHash = hmacSha256(realData, signKey(realKey));
  // «Funtico»: el SDK con la real
  assert.equal(await CryptoHelper.decrypt(realData, practiceKey(userId, realKey)), plain);
  assert.equal(await CryptoHelper.hmacSha256(realData, signKey(realKey)), realHash);
  assert.notEqual(realData, clientData);
  assert.equal(verifyHmac(realData, signKey(padKey), realHash), false);
});

test('descifrar rechaza base64 roto, bloque incompleto y clave equivocada; verifyHmac rechaza formas raras', () => {
  const c = encrypt('{"a":1}', 'abcdefgh12345678');
  assert.throws(() => decrypt('no es base64!', 'abcdefgh12345678'));
  assert.throws(() => decrypt('AAAA', 'abcdefgh12345678'));
  assert.throws(() => decrypt('', 'abcdefgh12345678'));
  let wrong;
  try { wrong = decrypt(c, 'zzzzzzzz12345678'); } catch { wrong = null; }
  assert.notEqual(wrong, '{"a":1}');
  assert.equal(verifyHmac('m', 'k', 'XYZ'), false);
  assert.equal(verifyHmac('m', 'k', undefined), false);
  assert.equal(verifyHmac('m', 'k', hmacSha256('m', 'k').toUpperCase()), false);
});

// F2.1: regenera tests/fixtures/funtico-crypto-vectors.json con el CryptoHelper del SDK vendorizado.
//   node --experimental-transform-types --no-warnings scripts/funtico-crypto-vectors.mjs
// Claves de PRUEBA construidas por código (no hay ninguna clave real). Salida determinista (IV fijo del SDK).
import { writeFileSync } from 'node:fs';
import { loadFunticoSdk } from '../tests/funtico-sdk-loader.mjs';

const { CryptoHelper } = await loadFunticoSdk();

const keys = [
  'abcdefgh' + '12345678',          // exactamente 16
  'q'.repeat(8) + 'w'.repeat(24),   // más de 16: se corta
  'short',                          // menos de 16: se rellena con su primer carácter
  '',                               // vacía: se rellena con '0'
  '0000a1b2' + 'p'.repeat(8),       // forma de clave de sesión (UserId hex + 8 de la privada)
];
const texts = [
  '',
  'hola',
  '0123456789abcdef',
  JSON.stringify({ Score: 1234, RunId: 'run-1', GameEvents: ['a', 'b'] }),
  'ñandú · 漢字 · 🎮',
];
const encrypt = [];
for (const key of keys) for (const plain of texts) encrypt.push({ key, plain, cipher: await CryptoHelper.encrypt(plain, key) });
const hmac = [];
for (const key of ['k'.repeat(24), 'session-event-1', 'x']) {
  for (const message of ['', 'hola', encrypt[3].cipher]) hmac.push({ key, message, hex: await CryptoHelper.hmacSha256(message, key) });
}
const out = new URL('../tests/fixtures/funtico-crypto-vectors.json', import.meta.url);
writeFileSync(out, JSON.stringify({ source: 'src/funtico/sdk/FunticoPhaserSDK.ts CryptoHelper', encrypt, hmac }, null, 2) + '\n');
console.log(`ok: ${encrypt.length} cifrados, ${hmac.length} firmas → ${out.pathname}`);

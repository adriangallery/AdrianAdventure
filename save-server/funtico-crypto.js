// F2.1 (plan FUNTICO_ADVENTURE): reimplementación en Node del `CryptoHelper` del SDK de Funtico
// (src/funtico/sdk/FunticoPhaserSDK.ts). Funciones puras, sin estado ni singleton: el servidor atiende a muchos
// jugadores a la vez y no puede usar `FunticoSDK.Instance`.
//
// Mismo esquema que el SDK (público en su repo): AES-128-CBC con PKCS7 e IV fijo, clave de texto ajustada a 16
// caracteres (`formatKey`) y codificada en UTF-8, salida en base64; firma HMAC-SHA256 en hex. Lo que cifra el cliente
// con una clave lo descifra esto con esa clave y al revés (vectores en tests/funtico-crypto.test.mjs).
//
// Nunca registra ni incluye en errores las claves ni los textos.
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

const IV = Buffer.from('1234567890123456', 'utf8');
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/** Igual que `CryptoHelper.formatKey`: corta a 16 o rellena hasta 16 con su primer carácter (o '0'). */
export function formatKey(key) {
  const k = String(key);
  if (k.length > 16) return k.substring(0, 16);
  if (k.length < 16) return k.padEnd(16, k[0] || '0');
  return k;
}

function keyBytes(keyStr) {
  const bytes = Buffer.from(formatKey(keyStr), 'utf8');
  // WebCrypto rechaza una clave AES que no sea de 16 bytes (p. ej. con caracteres no ASCII); aquí igual.
  if (bytes.length !== 16) throw new Error('funtico-crypto: la clave no da 16 bytes');
  return bytes;
}

/** `CryptoHelper.encrypt`: texto → base64. */
export function encrypt(plainText, keyStr) {
  const cipher = createCipheriv('aes-128-cbc', keyBytes(keyStr), IV);
  return Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]).toString('base64');
}

/** `CryptoHelper.decrypt`: base64 → texto. Lanza si el base64, el relleno o el UTF-8 no son válidos. */
export function decrypt(encryptedBase64, keyStr) {
  if (typeof encryptedBase64 !== 'string' || !encryptedBase64 || !BASE64_RE.test(encryptedBase64)) {
    throw new Error('funtico-crypto: base64 no válido');
  }
  const bytes = Buffer.from(encryptedBase64, 'base64');
  if (bytes.length === 0 || bytes.length % 16 !== 0) throw new Error('funtico-crypto: longitud de bloque no válida');
  const decipher = createDecipheriv('aes-128-cbc', keyBytes(keyStr), IV);
  const out = Buffer.concat([decipher.update(bytes), decipher.final()]);
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}

/** `CryptoHelper.hmacSha256`: HMAC-SHA256(mensaje, clave) en hex minúsculas. */
export function hmacSha256(message, keyStr) {
  return createHmac('sha256', Buffer.from(String(keyStr), 'utf8')).update(String(message), 'utf8').digest('hex');
}

/** Compara una firma recibida con la esperada en tiempo constante. */
export function verifyHmac(message, keyStr, hash) {
  if (typeof hash !== 'string' || !HEX64_RE.test(hash)) return false;
  const expected = Buffer.from(hmacSha256(message, keyStr), 'hex');
  return timingSafeEqual(expected, Buffer.from(hash, 'hex'));
}

// ─── Derivación de claves por ruta (la misma que hace el SDK en cada método) ───

/** `CompletePractice`: UserId decimal rellenado a 8 con ceros (8 primeros) + 8 primeros de la privada. */
export function practiceKey(userId, privateKey) {
  return String(userId).padStart(8, '0').substring(0, 8) + privateKey.substring(0, 8);
}

/** `CompleteCampaignLevel` (y `EndRoomSP`): 8 primeros del id del intento + 8 primeros de la privada. */
export function attemptKey(attemptId, privateKey) {
  return String(attemptId).substring(0, 8) + privateKey.substring(0, 8);
}

/** Sesiones (`CreateSession_Client`, `UpdateSession_Client`, `Reconnect…`): UserId en hex (≥ 8) + 8 últimos de la privada. */
export function sessionKey(userId, privateKey) {
  return Number(userId).toString(16).padStart(8, '0') + privateKey.substring(privateKey.length - 8);
}

/** Clave de la firma de los envíos de puntuación (`CompletePractice`, `CompleteCampaignLevel`). */
export function signKey(privateKey) {
  return privateKey.substring(8);
}

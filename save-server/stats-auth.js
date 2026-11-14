// A9.17: acceso a /stats/summary tipo Sign-In with Ethereum (solo FIRMA de un mensaje legible, nunca una transacción).
// Sin dependencias de red: la verificación de la firma se inyecta (`verify`, en index.js la de viem con respaldo
// ERC-1271 en Base; en los tests, verifyMessage de viem). Se prueba con `node --test` (tests/stats-auth.test.mjs).
//
// Flujo: GET /stats/nonce → { nonce, message } (un solo uso, caduca a los 5 min) · el navegador firma `message` ·
// POST /stats/login { address, signature, nonce } → si la firma es de `address` y `address` está en STATS_ADMINS,
// { token, expiresAt } (12 h, HMAC-SHA256 con el secreto de sesión) · GET /stats/summary con `Authorization: Bearer`.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_DOMAIN = 'adventure.zerothetoken.com';
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SIG_RE = /^0x[0-9a-fA-F]{130,}$/;

/** `STATS_ADMINS` ("0xabc…,0xdef…") → lista en minúsculas, solo direcciones válidas. */
export function parseAdmins(env) {
  return String(env || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => ADDR_RE.test(s));
}

/** Secreto de sesión: el del entorno o uno generado la primera vez y guardado en `file` (modo 600). */
export function loadSessionSecret(envValue, file) {
  if (envValue && envValue.length >= 16) return envValue;
  if (file && existsSync(file)) {
    const s = readFileSync(file, 'utf-8').trim();
    if (s.length >= 32) return s;
  }
  const s = randomBytes(32).toString('hex');
  if (file) writeFileSync(file, s, { mode: 0o600 });
  return s;
}

/** Mensaje legible que se firma: dominio, que es solo una firma, nonce y fecha. */
export function loginMessage({ domain, nonce, issuedAt }) {
  return [
    `${domain} wants you to sign in to ZEROadventure play stats.`,
    '',
    'This is only a signature: it is NOT a transaction and costs no gas.',
    '',
    'URI: https://save.zerothetoken.com/stats',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function createStatsAuth({ admins = [], secret, verify, now = () => Date.now(), maxNonces = 1000 } = {}) {
  if (!secret) throw new Error('stats-auth: falta el secreto');
  if (typeof verify !== 'function') throw new Error('stats-auth: falta verify');
  const adminSet = new Set(admins.map((a) => a.toLowerCase()));
  const nonces = new Map();

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function issueNonce(domain = DEFAULT_DOMAIN) {
    const t = now();
    for (const [k, v] of nonces) if (v.exp <= t) nonces.delete(k);
    while (nonces.size >= maxNonces) nonces.delete(nonces.keys().next().value);
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date(t).toISOString();
    const message = loginMessage({ domain, nonce, issuedAt });
    nonces.set(nonce, { exp: t + NONCE_TTL_MS, message });
    return { nonce, message, expiresAt: t + NONCE_TTL_MS };
  }

  /** → { ok: true, token, expiresAt, address } o { ok: false, status, error }. El nonce se gasta SIEMPRE (un intento). */
  async function login(body) {
    const fail = (error, status = 401) => ({ ok: false, status, error });
    if (!body || typeof body !== 'object') return fail('Invalid body', 400);
    const { address, signature, nonce } = body;
    if (typeof address !== 'string' || !ADDR_RE.test(address) || typeof signature !== 'string' || !SIG_RE.test(signature)
      || typeof nonce !== 'string') return fail('Invalid body', 400);
    const entry = nonces.get(nonce);
    nonces.delete(nonce);
    if (!entry) return fail('Unknown or used nonce');
    if (entry.exp <= now()) return fail('Nonce expired');
    let valid = false;
    try { valid = await verify({ address, message: entry.message, signature }); } catch { valid = false; }
    if (!valid) return fail('Bad signature');
    const addr = address.toLowerCase();
    if (!adminSet.has(addr)) return fail('Not allowed');
    const expiresAt = now() + SESSION_TTL_MS;
    const payload = b64url(JSON.stringify({ a: addr, exp: expiresAt }));
    return { ok: true, token: `${payload}.${sign(payload)}`, expiresAt, address: addr };
  }

  /** Cabecera Authorization → dirección si el token es válido, no caducado y la dirección sigue en la lista; si no, null. */
  function checkToken(authHeader) {
    const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(authHeader || ''));
    if (!m) return null;
    const expected = Buffer.from(sign(m[1]));
    const got = Buffer.from(m[2]);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    let p;
    try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf-8')); } catch { return null; }
    if (!p || typeof p.a !== 'string' || typeof p.exp !== 'number' || p.exp <= now()) return null;
    return adminSet.has(p.a) ? p.a : null;
  }

  return { issueNonce, login, checkToken };
}

/** Dominio que se pone en el mensaje según el Origin de la petición (solo los del juego; si no, el de por defecto). */
export function domainFromOrigin(origin) {
  try {
    const h = new URL(String(origin)).host;
    if (['adventure.zerothetoken.com', 'adventure.adrianzero.com'].includes(h) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return h;
  } catch { /* sin Origin */ }
  return DEFAULT_DOMAIN;
}

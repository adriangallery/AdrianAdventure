// A9.17: rutas de /stats sin framework (las monta index.js en Hono y la demo en node:http). Petición →
// { status, body }. Rutas:
//   POST /stats/event    evento anónimo (texto JSON, ≤ 512 B; text/plain para que sendBeacon no pida preflight CORS)
//   GET  /stats/nonce    nonce de un solo uso (5 min) y mensaje a firmar
//   POST /stats/login    { address, signature, nonce } → { token, expiresAt } (Bearer de 12 h)
//   GET  /stats/summary  agregados (Authorization: Bearer …; sin sesión válida, 401)
import { createHash } from 'node:crypto';
import { parseEvent, MAX_BODY_BYTES } from './stats.js';
import { domainFromOrigin } from './stats-auth.js';

/** Límite en memoria por clave (hash de la IP): `max` por ventana. No persiste ni registra nada. */
export function createLimiter({ max = 120, windowMs = 60 * 60 * 1000, now = () => Date.now(), maxKeys = 10000 } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const k = String(key || '?');
    const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { hits.set(k, arr); return false; }
    arr.push(t);
    hits.delete(k);
    hits.set(k, arr);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  };
}

/** La IP solo existe aquí, hasheada y en memoria, para el límite de ritmo. */
const ipKey = (ip) => createHash('sha256').update(String(ip || '?')).digest('hex').slice(0, 16);

export function createStatsRoutes({ store, auth, eventLimit = createLimiter(), loginLimit = createLimiter({ max: 30 }) }) {
  return async function handle({ method, path, headers = {}, bodyText = '', ip = '?' }) {
    const h = (name) => headers[name] ?? headers[name.toLowerCase()];
    if (method === 'POST' && path === '/stats/event') {
      if (Buffer.byteLength(bodyText || '') > MAX_BODY_BYTES) return { status: 413, body: { error: 'Too large' } };
      let body;
      try { body = JSON.parse(bodyText); } catch { return { status: 400, body: { error: 'Invalid JSON' } }; }
      const ev = parseEvent(body);
      if (!ev) return { status: 400, body: { error: 'Invalid event' } };
      if (!eventLimit(ipKey(ip))) return { status: 429, body: { error: 'Too many' } };
      try { store.record(ev); } catch (err) {
        console.error('Stats event error:', err?.message);
        return { status: 500, body: { error: 'Internal server error' } };
      }
      return { status: 200, body: { ok: true } };
    }
    if (method === 'GET' && path === '/stats/nonce') {
      if (!loginLimit(ipKey(ip))) return { status: 429, body: { error: 'Too many' } };
      const { nonce, message, expiresAt } = auth.issueNonce(domainFromOrigin(h('origin')));
      return { status: 200, body: { nonce, message, expiresAt } };
    }
    if (method === 'POST' && path === '/stats/login') {
      if (Buffer.byteLength(bodyText || '') > 2048) return { status: 413, body: { error: 'Too large' } };
      let body;
      try { body = JSON.parse(bodyText); } catch { return { status: 400, body: { error: 'Invalid JSON' } }; }
      const r = await auth.login(body);
      if (!r.ok) return { status: r.status, body: { error: r.error } };
      return { status: 200, body: { token: r.token, expiresAt: r.expiresAt, address: r.address } };
    }
    if (method === 'GET' && path === '/stats/summary') {
      if (!auth.checkToken(h('authorization'))) return { status: 401, body: { error: 'Unauthorized' } };
      try { return { status: 200, body: store.summary() }; } catch (err) {
        console.error('Stats summary error:', err?.message);
        return { status: 500, body: { error: 'Internal server error' } };
      }
    }
    return null;
  };
}

// F2.1 (plan FUNTICO_ADVENTURE): relay del build Funtico hacia la API de juegos de Funtico. Lo monta index.js en
// /funtico (desde fuera: https://funtico.adventure.adrianzero.com/save-api/funtico/... vía nginx, mismo origen que el
// juego, sin CORS nuevo). Sin framework, como stats-routes.js: petición → { status, body, contentType }.
//
// - Interruptor FUNTICO_ENABLED (apagado por defecto): apagado, TODO /funtico/* es 404 y no se lee nada más.
// - Encendido: FUNTICO_ENV (staging|production), FUNTICO_PUBLIC_KEY, FUNTICO_PRIVATE_KEY (la real, solo en la config de
//   Dokku) y FUNTICO_CLIENT_PAD_KEY (relleno PÚBLICO del cliente; por defecto el de src/funtico/FunticoBridge.ts).
//   Claves ausentes o inválidas → 503 en todas las rutas y un único aviso en el log, sin el valor.
// - Lista blanca método+ruta (ROUTES): lo demás es 404 sin salir a la red. Lecturas: se reenvían con el
//   `Authorization` del jugador y la X-User-Key pública de la config. Envíos firmados: se comprueba la firma y se
//   descifra con el relleno, se valida la forma (y el validador enganchado, F2.2) y se re-cifra/firma con la real.
// - Nunca calcula ni devuelve X-Server-Key, nunca copia cabeceras de Funtico al cliente, el host no lo elige el
//   cliente, y ni las claves ni los cuerpos descifrados van a los logs. Timeout o red caída → 502 genérico.
// Ver docs/progreso/F2.1.md.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encrypt, decrypt, hmacSha256, verifyHmac, practiceKey, attemptKey, sessionKey, signKey } from './funtico-crypto.js';

/**
 * Relleno público que el cliente pasa al SDK como `privateGameKey` (`FUNTICO_PLACEHOLDER` del puente). NO es secreto:
 * va en el bundle. Solo sirve para que el SDK arranque y cifre algo que este relay sabe deshacer.
 */
export const DEFAULT_CLIENT_PAD_KEY = 'public-placeholder-not-a-secret-zeroadventure';

/** URL base de la API de juegos por entorno (la misma que pone el SDK cuando no hay `apiBaseUrl`). */
export const FUNTICO_API_BASE = Object.freeze({
  staging: 'https://funtico-sdk-staging.azurewebsites.net',
  production: 'https://funtico-sdk.azurewebsites.net',
});

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 512 * 1024;
const MAX_EVENTS = 2000;
const MAX_EVENT_CHARS = 2048;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const BEARER_RE = /^Bearer [A-Za-z0-9._~+/=-]{1,8192}$/;

const NOT_FOUND = Object.freeze({ status: 404, body: '404 Not Found', contentType: 'text/plain; charset=UTF-8' });
const json = (status, body) => ({ status, body: JSON.stringify(body), contentType: 'application/json' });

export function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Las reglas de `FunticoSDK.validateConfig` (sin formato fijo: el SDK avisa de que hay claves de más de un formato).
 * Devuelve null si vale o el motivo SIN los valores.
 */
export function keyProblem(publicKey, privateKey, label = 'FUNTICO_PRIVATE_KEY') {
  if (typeof publicKey !== 'string' || publicKey.length === 0) return 'FUNTICO_PUBLIC_KEY falta o está vacía';
  if (typeof privateKey !== 'string' || privateKey.length === 0) return `${label} falta o está vacía`;
  if (publicKey !== publicKey.trim()) return 'FUNTICO_PUBLIC_KEY tiene espacios o saltos de línea alrededor';
  if (privateKey !== privateKey.trim()) return `${label} tiene espacios o saltos de línea alrededor`;
  // ≥ 8 lo exige el SDK; aquí además hace falta algo después del carácter 8 para la clave de firma.
  if (privateKey.length < 9) return `${label} es demasiado corta (${privateKey.length} caracteres)`;
  if (privateKey === publicKey) return `${label} es igual que FUNTICO_PUBLIC_KEY`;
  if (privateKey.includes(publicKey) || publicKey.includes(privateKey)) return `${label} y FUNTICO_PUBLIC_KEY se solapan`;
  if (Buffer.byteLength(privateKey.substring(0, 8)) !== 8 || Buffer.byteLength(privateKey.slice(-8)) !== 8) {
    return `${label} tiene caracteres no ASCII en los extremos`;
  }
  return null;
}

/** Lee la config SOLO si el interruptor está encendido. → { enabled:false } | { enabled, ok, config? , reason? } */
export function loadFunticoConfig(env = process.env) {
  if (!isEnabled(env.FUNTICO_ENABLED)) return { enabled: false };
  const envName = String(env.FUNTICO_ENV ?? 'staging').trim().toLowerCase();
  const apiBase = FUNTICO_API_BASE[envName === 'prod' ? 'production' : envName];
  if (!apiBase) return { enabled: true, ok: false, reason: 'FUNTICO_ENV no es staging ni production' };
  const publicKey = env.FUNTICO_PUBLIC_KEY;
  const privateKey = env.FUNTICO_PRIVATE_KEY;
  const padKey = env.FUNTICO_CLIENT_PAD_KEY || DEFAULT_CLIENT_PAD_KEY;
  const bad = keyProblem(publicKey, privateKey) || keyProblem(publicKey, padKey, 'FUNTICO_CLIENT_PAD_KEY');
  if (bad) return { enabled: true, ok: false, reason: bad };
  if (padKey === privateKey) return { enabled: true, ok: false, reason: 'FUNTICO_CLIENT_PAD_KEY es igual que FUNTICO_PRIVATE_KEY' };
  return { enabled: true, ok: true, config: { env: envName === 'prod' ? 'production' : envName, apiBase, publicKey, privateKey, padKey } };
}

// ─── Lista blanca (derivada de los métodos del SDK que usa src/funtico/FunticoBridge.ts) ───
// kind: read = reenvío tal cual · sessions = reenvío y re-cifrado de las sesiones guardadas de la respuesta ·
// signed = descifrar con relleno, validar, re-cifrar/firmar con la real.
export const ROUTES = Object.freeze({
  'POST /Auth/funtico-auth': { kind: 'read', body: 'auth', auth: false },           // Initialize / Authentication
  'GET /User/get-full-data': { kind: 'read' },                                         // GetUserData
  'GET /User/get-balance': { kind: 'read' },                                           // GetBalance
  'GET /User/vouchers': { kind: 'read' },                                              // GetVouchers
  'GET /HallOfFame/global': { kind: 'read', query: ['page', 'limit', 'gameMode'] },     // GetHallOfFame(Global)
  'GET /HallOfFame/monthly': { kind: 'read', query: ['page', 'limit', 'gameMode'] },    // GetHallOfFame(Monthly)
  'GET /Campaign/availability': { kind: 'read', auth: false },                         // GetCampaignAvailability
  'GET /Campaign/levels': { kind: 'read' },                                            // GetCampaignLevels
  'POST /Campaign/start-level': { kind: 'read', query: ['levelId'] },                  // StartCampaignLevel
  'GET /Session/any-unfinished-sessions': { kind: 'sessions' },                        // UserHasUnfinishedSession_Client
  'GET /Session/reconnect-to-session': { kind: 'sessions', query: ['id'] },            // ReconnectToUnfinishedSession_Client
  'POST /User/complete-practice': { kind: 'signed' },                                  // CompletePractice
  'POST /Campaign/complete-level': { kind: 'signed' },                                 // CompleteCampaignLevel
  'POST /Session/create-session': { kind: 'signed' },                                  // CreateSession_Client
  'POST /Session/update-session': { kind: 'signed' },                                  // UpdateSession_Client
});

class Reject extends Error {
  constructor(status, error) { super(error); this.status = status; this.error = error; }
}
const bad = (error = 'Invalid body') => new Reject(400, error);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const int32 = (n) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

function checkEvents(ev) {
  if (ev === undefined) return;
  if (!Array.isArray(ev) || ev.length > MAX_EVENTS || !ev.every((e) => typeof e === 'string' && e.length <= MAX_EVENT_CHARS)) {
    throw bad('Invalid GameEvents');
  }
}

/** Forma del texto que cifra `CompletePractice`. */
function checkPracticePayload(p) {
  if (!isObj(p) || !onlyKeys(p, ['Score', 'RunId', 'Collected', 'GameEvents'])) throw bad('Invalid payload');
  if (!int32(p.Score)) throw bad('Invalid Score');
  if (typeof p.RunId !== 'string' || !ID_RE.test(p.RunId)) throw bad('Invalid RunId');
  if (p.Collected !== undefined) {
    if (!isObj(p.Collected) || Object.keys(p.Collected).length > 64) throw bad('Invalid Collected');
    for (const [k, v] of Object.entries(p.Collected)) if (!ID_RE.test(k) || !Number.isInteger(v) || v <= 0 || v > 1e6) throw bad('Invalid Collected');
  }
  checkEvents(p.GameEvents);
}

/** Forma del texto que cifra `CompleteCampaignLevel` (mismas reglas de métricas que el SDK). */
function checkCampaignPayload(p, attemptId) {
  if (!isObj(p) || !onlyKeys(p, ['AttemptId', 'LevelId', 'Metrics', 'GameEvents'])) throw bad('Invalid payload');
  if (p.AttemptId !== attemptId) throw bad('AttemptId mismatch');
  if (typeof p.LevelId !== 'string' || !ID_RE.test(p.LevelId)) throw bad('Invalid LevelId');
  if (!isObj(p.Metrics)) throw bad('Invalid Metrics');
  const m = Object.entries(p.Metrics);
  if (m.length < 1 || m.length > 32) throw bad('Invalid Metrics');
  for (const [k, v] of m) if (k.length < 1 || k.length > 64 || typeof v !== 'number' || !Number.isFinite(v)) throw bad('Invalid Metrics');
  checkEvents(p.GameEvents);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw bad('Invalid JSON'); }
}

function decryptOr400(data, key) {
  try { return decrypt(data, key); } catch { throw bad('Invalid payload'); }
}

const tokenHash = (auth) => createHash('sha256').update(auth).digest('hex');

/**
 * @param {object} o
 * @param {Record<string,string|undefined>} [o.env]       process.env (o uno de prueba)
 * @param {typeof fetch} [o.fetch]                       inyectable para tests
 * @param {string} [o.dataDir]                           directorio de datos del save-server; se usa <dataDir>/funtico
 * @param {Record<string,Function>} [o.validators]       'POST /User/complete-practice' → (payload, ctx) (F2.2)
 * @param {{warn:Function,error:Function}} [o.log]
 * @param {number} [o.timeoutMs]
 * @returns {(req:{method:string,path:string,search?:string,headers?:Record<string,string|undefined>,bodyText?:string}) => Promise<{status:number,body:string,contentType:string}>}
 */
export function createFunticoRelay({ env = process.env, fetch: fetchImpl = globalThis.fetch, dataDir, validators = {}, log = console, timeoutMs = 10000, now = () => Date.now() } = {}) {
  const loaded = loadFunticoConfig(env);
  if (!loaded.enabled) {
    const off = async () => NOT_FOUND;
    off.enabled = false;
    return off;
  }
  let funticoDir = null;
  if (dataDir) {
    funticoDir = join(dataDir, 'funtico');
    try { mkdirSync(funticoDir, { recursive: true }); } catch { log.error('[funtico] no se pudo crear el directorio de datos'); funticoDir = null; }
  }
  if (!loaded.ok) {
    log.warn(`[funtico] FUNTICO_ENABLED está encendido pero la configuración no vale: ${loaded.reason}. Todas las rutas /funtico responden 503.`);
    const unavailable = async () => json(503, { error: 'Funtico relay not configured' });
    unavailable.enabled = true;
    return unavailable;
  }
  const cfg = loaded.config;
  const userCache = new Map(); // sha256(Authorization) → { userId, exp }
  const sessions = new Map();  // Id de la sesión guardada → { sessionId, userId }

  const remember = (map, k, v, max = 10000) => { map.delete(k); map.set(k, v); if (map.size > max) map.delete(map.keys().next().value); };

  function record(route, status) {
    if (!funticoDir) return;
    try { appendFileSync(join(funticoDir, 'signed.jsonl'), JSON.stringify({ t: new Date(now()).toISOString(), route, status }) + '\n'); }
    catch { log.error('[funtico] no se pudo escribir el registro de envíos'); }
  }

  /** Única salida a la red: host fijo de la config, cabeceras construidas aquí (nunca X-Server-Key). */
  async function upstream(method, path, search, auth, bodyText) {
    const headers = { 'X-User-Key': cfg.publicKey };
    if (auth) headers.Authorization = auth;
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${cfg.apiBase}${path}${search}`, { method, headers, body: bodyText, signal: ctrl.signal, redirect: 'error' });
      const text = await res.text();
      if (text.length > MAX_UPSTREAM_BYTES) throw new Error('upstream too large');
      return { status: res.status, text, contentType: /json/i.test(res.headers?.get?.('content-type') || '') ? 'application/json' : 'text/plain; charset=UTF-8' };
    } catch (err) {
      log.error(`[funtico] fallo hacia Funtico en ${method} ${path}: ${err?.name === 'AbortError' ? 'timeout' : 'red'}`);
      throw new Reject(502, 'Upstream unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** UserId del dueño del token, preguntado a Funtico con ese mismo token (no se fía de lo que diga el cliente). */
  async function userIdFor(auth) {
    if (!auth) throw new Reject(401, 'Unauthorized');
    const k = tokenHash(auth);
    const hit = userCache.get(k);
    if (hit && hit.exp > now()) return hit.userId;
    const r = await upstream('GET', '/User/get-full-data', '', auth);
    if (r.status === 401 || r.status === 403) throw new Reject(r.status, 'Unauthorized');
    if (r.status < 200 || r.status >= 300) throw new Reject(502, 'Upstream unavailable');
    let userId;
    try { userId = JSON.parse(r.text)?.UserId; } catch { /* abajo */ }
    if (!Number.isSafeInteger(userId) || userId < 0) throw new Reject(502, 'Upstream unavailable');
    remember(userCache, k, { userId, exp: now() + 5 * 60 * 1000 });
    return userId;
  }

  /** Sesión guardada de Funtico (cifrada con la real) → la misma cifrada con el relleno, para el SDK del cliente. */
  function toClientSession(s, userId) {
    if (!isObj(s) || typeof s.Data !== 'string' || typeof s.SessionId !== 'string') return s;
    if (typeof s.Id === 'string') remember(sessions, s.Id, { sessionId: s.SessionId, userId });
    let plain;
    try { plain = decrypt(s.Data, sessionKey(userId, cfg.privateKey)); } catch { return { ...s, Data: '', Hash: '' }; }
    const Data = encrypt(plain, sessionKey(userId, cfg.padKey));
    return { ...s, Data, Hash: hmacSha256(Data, s.SessionId) };
  }

  async function runValidator(routeKey, payload, ctx) {
    const v = validators[routeKey];
    if (typeof v !== 'function') return payload;
    let r;
    try { r = await v(payload, ctx); } catch { log.error(`[funtico] el validador de ${routeKey} lanzó`); throw new Reject(500, 'Validation failed'); }
    if (r === undefined || r === true) return payload;
    if (r === false) throw bad('Rejected');
    if (isObj(r) && r.ok === false) throw new Reject(Number.isInteger(r.status) && r.status >= 400 && r.status < 500 ? r.status : 400, typeof r.error === 'string' ? r.error : 'Rejected');
    if (isObj(r) && r.ok === true) return r.payload === undefined ? payload : r.payload;
    throw new Reject(500, 'Validation failed');
  }

  /** Envíos firmados: devuelve el cuerpo a mandar a Funtico, ya con la clave real. */
  const signed = {
    async 'POST /User/complete-practice'(body, auth, routeKey) {
      if (!isObj(body) || !onlyKeys(body, ['Data', 'Hash']) || typeof body.Data !== 'string') throw bad();
      if (!verifyHmac(body.Data, signKey(cfg.padKey), body.Hash)) throw bad('Bad signature');
      const userId = await userIdFor(auth);
      const payload = parseJson(decryptOr400(body.Data, practiceKey(userId, cfg.padKey)));
      checkPracticePayload(payload);
      const out = await runValidator(routeKey, payload, { route: routeKey, userId, now: now() });
      checkPracticePayload(out);
      const Data = encrypt(JSON.stringify(out), practiceKey(userId, cfg.privateKey));
      return { Data, Hash: hmacSha256(Data, signKey(cfg.privateKey)) };
    },
    async 'POST /Campaign/complete-level'(body, auth, routeKey) {
      if (!isObj(body) || !onlyKeys(body, ['AttemptId', 'EncryptedData', 'Hash']) || typeof body.EncryptedData !== 'string') throw bad();
      if (typeof body.AttemptId !== 'string' || !ID_RE.test(body.AttemptId)) throw bad('Invalid AttemptId');
      if (!verifyHmac(body.EncryptedData, signKey(cfg.padKey), body.Hash)) throw bad('Bad signature');
      const userId = await userIdFor(auth);
      const payload = parseJson(decryptOr400(body.EncryptedData, attemptKey(body.AttemptId, cfg.padKey)));
      checkCampaignPayload(payload, body.AttemptId);
      const out = await runValidator(routeKey, payload, { route: routeKey, userId, now: now() });
      checkCampaignPayload(out, body.AttemptId);
      const EncryptedData = encrypt(JSON.stringify(out), attemptKey(body.AttemptId, cfg.privateKey));
      return { AttemptId: body.AttemptId, EncryptedData, Hash: hmacSha256(EncryptedData, signKey(cfg.privateKey)) };
    },
    async 'POST /Session/create-session'(body, auth, routeKey) {
      if (!isObj(body) || !onlyKeys(body, ['SessionId', 'SaveSessionId', 'GameType', 'Data', 'Hash']) || typeof body.Data !== 'string') throw bad();
      if (typeof body.SessionId !== 'string' || !ID_RE.test(body.SessionId)) throw bad('Invalid SessionId');
      if (typeof body.SaveSessionId !== 'string' || !ID_RE.test(body.SaveSessionId)) throw bad('Invalid SaveSessionId');
      if (!Number.isInteger(body.GameType) || body.GameType < 0 || body.GameType > 16) throw bad('Invalid GameType');
      if (!verifyHmac(body.Data, body.SessionId, body.Hash)) throw bad('Bad signature');
      const userId = await userIdFor(auth);
      const state = decryptOr400(body.Data, sessionKey(userId, cfg.padKey));
      parseJson(state);
      const out = await runValidator(routeKey, state, { route: routeKey, userId, sessionId: body.SessionId, now: now() });
      if (typeof out !== 'string') throw new Reject(500, 'Validation failed');
      const Data = encrypt(out, sessionKey(userId, cfg.privateKey));
      return { SessionId: body.SessionId, SaveSessionId: body.SaveSessionId, GameType: body.GameType, Data, Hash: hmacSha256(Data, body.SessionId) };
    },
    async 'POST /Session/update-session'(body, auth, routeKey) {
      if (!isObj(body) || !onlyKeys(body, ['Id', 'Data', 'Hash']) || typeof body.Data !== 'string') throw bad();
      if (typeof body.Id !== 'string' || !ID_RE.test(body.Id)) throw bad('Invalid Id');
      const userId = await userIdFor(auth);
      // La firma de update va con el SessionId (id del evento), que el cuerpo no lleva: lo aprendimos al crear o
      // reconectar la sesión a través de este relay.
      const known = sessions.get(body.Id);
      if (!known || known.userId !== userId) throw new Reject(409, 'Unknown session: reconnect first');
      if (!verifyHmac(body.Data, known.sessionId, body.Hash)) throw bad('Bad signature');
      const state = decryptOr400(body.Data, sessionKey(userId, cfg.padKey));
      parseJson(state);
      const out = await runValidator(routeKey, state, { route: routeKey, userId, sessionId: known.sessionId, now: now() });
      if (typeof out !== 'string') throw new Reject(500, 'Validation failed');
      const Data = encrypt(out, sessionKey(userId, cfg.privateKey));
      return { Id: body.Id, Data, Hash: hmacSha256(Data, known.sessionId) };
    },
  };

  function buildSearch(search, allowed = []) {
    const params = new URLSearchParams(search || '');
    const out = [];
    for (const [k, v] of params) {
      if (!allowed.includes(k) || !ID_RE.test(v) || out.some(([kk]) => kk === k)) throw bad('Invalid query');
      out.push([k, v]);
    }
    return out.length ? '?' + out.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
  }

  const handle = async function handle({ method, path, search = '', headers = {}, bodyText = '' }) {
    const routeKey = `${String(method).toUpperCase()} ${path}`;
    const route = Object.hasOwn(ROUTES, routeKey) ? ROUTES[routeKey] : null;
    if (!route) return NOT_FOUND;
    try {
      if (Buffer.byteLength(bodyText || '') > MAX_BODY_BYTES) return json(413, { error: 'Too large' });
      const rawAuth = headers.authorization ?? headers.Authorization;
      const auth = typeof rawAuth === 'string' && BEARER_RE.test(rawAuth) ? rawAuth : null;
      if (rawAuth && !auth) throw new Reject(401, 'Unauthorized');
      if (route.auth !== false && !auth) throw new Reject(401, 'Unauthorized');
      const qs = buildSearch(search, route.query);

      if (route.kind === 'signed') {
        const body = await signed[routeKey](parseJson(bodyText), auth, routeKey);
        const r = await upstream('POST', path, qs, auth, JSON.stringify(body));
        record(routeKey, r.status);
        let text = r.text;
        if (routeKey === 'POST /Session/create-session' && r.status >= 200 && r.status < 300) {
          try { text = JSON.stringify(toClientSession(JSON.parse(r.text), await userIdFor(auth))); } catch { /* tal cual */ }
        }
        return { status: r.status, body: text, contentType: r.contentType };
      }

      let outBody;
      if (route.body === 'auth') {
        const b = parseJson(bodyText);
        if (!isObj(b) || !onlyKeys(b, ['Token']) || typeof b.Token !== 'string' || !b.Token || b.Token.length > 8192) throw bad();
        outBody = JSON.stringify({ Token: b.Token });
      } else if (bodyText) {
        throw bad('Unexpected body');
      }
      const r = await upstream(String(method).toUpperCase(), path, qs, auth, outBody);
      if (route.kind === 'sessions' && r.status >= 200 && r.status < 300) {
        const userId = await userIdFor(auth);
        let data;
        try { data = JSON.parse(r.text); } catch { return json(502, { error: 'Upstream unavailable' }); }
        if (routeKey === 'GET /Session/reconnect-to-session') data = toClientSession(data, userId);
        else if (isObj(data) && Array.isArray(data.SavedSessions)) data = { ...data, SavedSessions: data.SavedSessions.map((s) => toClientSession(s, userId)) };
        return { status: r.status, body: JSON.stringify(data), contentType: 'application/json' };
      }
      return { status: r.status, body: r.text, contentType: r.contentType };
    } catch (err) {
      if (err instanceof Reject) return json(err.status, { error: err.error });
      log.error(`[funtico] error interno en ${routeKey}`);
      return json(500, { error: 'Internal error' });
    }
  };
  handle.enabled = true;
  return handle;
}

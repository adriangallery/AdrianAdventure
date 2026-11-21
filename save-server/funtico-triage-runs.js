// F2.2 (plan FUNTICO_ADVENTURE): Triage en servidor. Dos piezas que index.js engancha en el relay (funtico.js):
//   - `local['POST /run/start']`: abre una carrera para el jugador del token. Id aleatorio (crypto) y semilla =
//     HMAC-SHA256(FUNTICO_SEED_SALT, runId): sin la sal no se puede precalcular ni elegir la semilla.
//   - `validators['POST /User/complete-practice']`: antes de re-firmar con la clave real, comprueba la carrera (existe,
//     es de ese jugador, no se envió ya, no caducó), el registro de toques (validateTaps + hora del servidor) y
//     RECALCULA la puntuación con scoreRun. La que firma el relay es la del servidor; la del cliente se ignora.
//
// Estado en el volumen (<dataDir>/funtico/triage/): `open/<runId>.json` = carrera abierta (sobrevive a un reinicio);
// `runs/<runId>.jsonl` = registro por carrera (inicio, toques, veredicto). Enviar = borrar `open/<runId>.json`
// (unlink es atómico: de dos envíos simultáneos, o de dos contenedores sobre el mismo volumen, solo gana uno).
// Nunca registra la sal, las claves ni el token. Contrato para el cliente y límites: docs/progreso/F2.2.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { generateRun, scoreRun, validateTaps, catalogId, RUN_VERSION, RULES } from './funtico-triage/triage.js';
import { isEnabled } from './funtico.js';

export const START_ROUTE = 'POST /run/start';
export const PRACTICE_ROUTE = 'POST /User/complete-practice';

export const LIMITS = Object.freeze({
  /** Desde run/start hasta que el envío deja de aceptarse: carrera (180 s) + carga/transiciones + red. */
  expiryMarginMs: 3 * 60 * 1000,
  /** Lo que el último toque puede pasarse de la hora del servidor transcurrida (relojes/latencias). */
  clockToleranceMs: 1000,
  maxOpenPerUser: 3,
  maxStartsPerHour: 30,
  maxOpenTotal: 5000,
  /** Mínimo de la sal (caracteres): menos es «sin sal». */
  minSaltChars: 32,
});

const RUN_ID_RE = /^[0-9a-f]{32}$/;
const TAP_KEYS = ['t', 'est', 'obj', 'x', 'y'];
const HERE = dirname(fileURLToPath(import.meta.url));

/** Catálogo que trae el save-server (copia byte a byte de src/funtico/triage/catalog.json). */
export function loadServerCatalog() {
  return JSON.parse(readFileSync(join(HERE, 'funtico-triage', 'catalog.json'), 'utf8'));
}

/** Semilla de una carrera: HMAC-SHA256(sal, runId) en hex. Determinista, no se guarda. */
export function seedFor(salt, runId) {
  return createHmac('sha256', Buffer.from(salt, 'utf8')).update(runId, 'utf8').digest('hex');
}

const reject = (status, error) => ({ ok: false, status, error });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * GameEvents de CompletePractice → { header, taps } o null si la forma no vale.
 * GameEvents[0] = '{"triage":1,"catalog":"<catalogId>"}'; GameEvents[1..] = un toque por cadena, '{"t","est","obj","x","y"}'.
 */
export function parseGameEvents(events, maxTaps) {
  if (!Array.isArray(events) || events.length < 1 || events.length > maxTaps + 1) return null;
  let header;
  try { header = JSON.parse(events[0]); } catch { return null; }
  if (!isObj(header) || Object.keys(header).length !== 2 || !Number.isInteger(header.triage) || typeof header.catalog !== 'string') return null;
  const taps = [];
  for (const s of events.slice(1)) {
    let e;
    try { e = JSON.parse(s); } catch { return null; }
    if (!isObj(e) || Object.keys(e).length !== TAP_KEYS.length || !TAP_KEYS.every((k) => Object.hasOwn(e, k))) return null;
    if (!Number.isInteger(e.t) || !Number.isInteger(e.est) || typeof e.obj !== 'string' || e.obj.length > 128
      || typeof e.x !== 'number' || !Number.isFinite(e.x) || typeof e.y !== 'number' || !Number.isFinite(e.y)) return null;
    taps.push({ t: e.t, est: e.est, obj: e.obj, x: e.x, y: e.y });
  }
  return { header, taps };
}

/** Señales de bot que NO rechazan (quedan en el registro para revisar premios). */
function botFlags(score) {
  const hitTimes = score.stations.filter((s) => s.hit && s.kind !== 'relapse').map((s) => s.elapsedMs);
  const flags = [];
  if (hitTimes.length >= 4) {
    const mean = hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length;
    const sd = Math.sqrt(hitTimes.reduce((a, b) => a + (b - mean) ** 2, 0) / hitTimes.length);
    if (sd < 80) flags.push('uniform_reaction');
    if (mean < 700) flags.push('fast_mean_reaction');
  }
  if (score.misses === 0 && score.hits === score.stations.length) flags.push('perfect_run');
  return flags;
}

/**
 * @param {object} o
 * @param {Record<string,string|undefined>} [o.env]
 * @param {string} [o.dataDir]     directorio de datos del save-server; se usa <dataDir>/funtico/triage
 * @param {() => number} [o.now]
 * @param {{warn:Function,error:Function}} [o.log]
 * @param {object} [o.catalog]     por defecto el de save-server/funtico-triage/
 * @param {Partial<typeof LIMITS>} [o.limits]
 * @returns {{ enabled: boolean, configured: boolean, local: Record<string,Function>, validators: Record<string,Function> }}
 */
export function createTriageRuns({ env = process.env, dataDir, now = () => Date.now(), log = console, catalog, limits = {} } = {}) {
  // Interruptor apagado: no se lee ninguna otra variable ni se toca el volumen (como el relay).
  if (!isEnabled(env.FUNTICO_ENABLED)) return { enabled: false, configured: false, local: {}, validators: {} };
  const L = { ...LIMITS, ...limits };
  const salt = typeof env.FUNTICO_SEED_SALT === 'string' ? env.FUNTICO_SEED_SALT : '';
  const unconfigured = salt.length < L.minSaltChars || salt !== salt.trim();
  let baseDir = null;
  if (!unconfigured && dataDir) {
    baseDir = join(dataDir, 'funtico', 'triage');
    try {
      mkdirSync(join(baseDir, 'open'), { recursive: true });
      mkdirSync(join(baseDir, 'runs'), { recursive: true });
    } catch { log.error('[funtico-triage] no se pudo crear el directorio de datos'); baseDir = null; }
  }
  if (unconfigured || !baseDir) {
    log.warn(unconfigured
      ? `[funtico-triage] FUNTICO_SEED_SALT falta o es corta (mínimo ${L.minSaltChars} caracteres): run/start y CompletePractice responden 503.`
      : '[funtico-triage] sin directorio de datos: run/start y CompletePractice responden 503.');
    const off = async () => reject(503, 'triage_unconfigured');
    return {
      enabled: true,
      configured: false,
      local: { [START_ROUTE]: async () => ({ status: 503, body: { error: 'triage_unconfigured' } }) },
      validators: { [PRACTICE_ROUTE]: off },
    };
  }

  const cat = catalog ?? loadServerCatalog();
  const catId = catalogId(cat);
  const durationMs = RULES.durationMs;
  const openDir = join(baseDir, 'open');
  const runsDir = join(baseDir, 'runs');
  /** runId → { runId, userId, startedAt, expiresAt, catalog, v } */
  const open = new Map();
  /** userId → [hora de cada run/start de la última hora] (memoria: se pierde al reiniciar) */
  const starts = new Map();

  const openFile = (id) => join(openDir, `${id}.json`);
  const logFile = (id) => join(runsDir, `${id}.jsonl`);
  function logRun(id, entry) {
    try { appendFileSync(logFile(id), JSON.stringify({ at: new Date(now()).toISOString(), ...entry }) + '\n'); }
    catch { log.error('[funtico-triage] no se pudo escribir el registro de una carrera'); }
  }
  function readOpen(id) {
    try {
      const s = JSON.parse(readFileSync(openFile(id), 'utf8'));
      return isObj(s) && s.runId === id && Number.isSafeInteger(s.userId) ? s : null;
    } catch { return null; }
  }
  /** Cierra una carrera abierta. true solo para quien de verdad la borra (atómico entre peticiones y procesos). */
  function claim(id) {
    open.delete(id);
    try { unlinkSync(openFile(id)); return true; } catch { return false; }
  }
  function pruneExpired() {
    const t = now();
    for (const [id, s] of open) {
      if (s.expiresAt < t && claim(id)) logRun(id, { ev: 'expired', runId: id, userId: s.userId });
    }
  }

  // Al arrancar: recarga las carreras abiertas del volumen (sobreviven a un reinicio).
  for (const f of readdirSync(openDir)) {
    const id = f.endsWith('.json') ? f.slice(0, -5) : '';
    if (!RUN_ID_RE.test(id)) continue;
    const s = readOpen(id);
    if (s) open.set(id, s);
  }
  pruneExpired();

  async function start({ userId, bodyText = '' }) {
    if (bodyText && bodyText.trim() !== '' && bodyText.trim() !== '{}') return { status: 400, body: { error: 'unexpected_body' } };
    pruneExpired();
    const t = now();
    const recent = (starts.get(userId) ?? []).filter((x) => x > t - 3600 * 1000);
    if (recent.length >= L.maxStartsPerHour) return { status: 429, body: { error: 'rate_limited' } };
    let mine = 0;
    for (const s of open.values()) if (s.userId === userId) mine++;
    if (mine >= L.maxOpenPerUser) return { status: 429, body: { error: 'too_many_open_runs' } };
    if (open.size >= L.maxOpenTotal) return { status: 503, body: { error: 'busy' } };

    const runId = randomBytes(16).toString('hex');
    const seed = seedFor(salt, runId);
    const state = { runId, userId, startedAt: t, expiresAt: t + durationMs + L.expiryMarginMs, catalog: catId, v: RUN_VERSION };
    try {
      // tmp + rename: un fichero abierto a medias no se ve nunca
      const tmp = join(openDir, `.${runId}.tmp`);
      writeFileSync(tmp, JSON.stringify(state), { flag: 'wx' });
      renameSync(tmp, openFile(runId));
    } catch {
      log.error('[funtico-triage] no se pudo guardar una carrera nueva');
      return { status: 503, body: { error: 'storage_unavailable' } };
    }
    open.set(runId, state);
    recent.push(t);
    starts.set(userId, recent);
    if (starts.size > 50000) starts.delete(starts.keys().next().value);
    logRun(runId, { ev: 'start', runId, userId, seed, startedAt: new Date(t).toISOString(), expiresAt: new Date(state.expiresAt).toISOString(), catalog: catId, v: RUN_VERSION, durationMs });
    return {
      status: 200,
      body: { runId, seed, serverTime: t, v: RUN_VERSION, catalog: catId, catalogHash: cat.hash, durationS: durationMs / 1000, expiresAt: state.expiresAt },
    };
  }

  /** Validador de CompletePractice (payload ya descifrado y con forma comprobada por el relay). */
  async function validatePractice(payload, ctx) {
    const id = payload.RunId;
    const userId = ctx.userId;
    const t = Number.isFinite(ctx.now) ? ctx.now : now();
    if (!RUN_ID_RE.test(id)) return reject(404, 'run_unknown');
    const s = open.get(id) ?? readOpen(id);
    if (!s) return reject(existsSync(logFile(id)) ? 409 : 404, existsSync(logFile(id)) ? 'run_closed' : 'run_unknown');
    if (s.userId !== userId) {
      // no la quema: el dueño la puede seguir enviando
      logRun(id, { ev: 'foreign_submit', runId: id, userId });
      return reject(403, 'run_not_owner');
    }
    if (!claim(id)) return reject(409, 'run_closed');

    const verdict = (ok, extra) => logRun(id, { ev: 'verdict', runId: id, userId, ok, ...extra });
    const elapsed = t - s.startedAt;
    if (t > s.expiresAt) { verdict(false, { reason: 'run_expired', elapsedMs: elapsed }); return reject(410, 'run_expired'); }

    const parsed = parseGameEvents(payload.GameEvents, 64);
    logRun(id, {
      ev: 'submit', runId: id, userId, elapsedMs: elapsed, clientScore: payload.Score,
      header: parsed?.header ?? null, taps: parsed?.taps ?? null, events: parsed ? undefined : (Array.isArray(payload.GameEvents) ? payload.GameEvents.length : null),
    });
    if (!parsed) { verdict(false, { reason: 'bad_events' }); return reject(400, 'bad_events'); }
    const { header, taps } = parsed;
    if (header.triage !== RUN_VERSION || header.catalog !== s.catalog || s.catalog !== catId || s.v !== RUN_VERSION) {
      verdict(false, { reason: 'catalog_mismatch', clientCatalog: header.catalog, serverCatalog: catId });
      return reject(409, 'catalog_mismatch');
    }

    const run = generateRun(seedFor(salt, id), cat);
    const v = validateTaps(run, taps);
    if (!v.ok) {
      // El cliente avanzó de estación tras un toque que, con los bounds de ESTA semilla, no acierta.
      const reason = v.reason === 'wrong_station' && v.at > 0 && taps[v.at].est === taps[v.at - 1].est + 1
        ? 'hit_out_of_bounds' : `taps_${v.reason}`;
      verdict(false, { reason, at: v.at });
      return reject(422, reason);
    }
    const lastT = taps.length ? taps[taps.length - 1].t : 0;
    if (lastT > elapsed + L.clockToleranceMs) {
      verdict(false, { reason: 'time_ahead_of_server', lastTapMs: lastT, elapsedMs: elapsed });
      return reject(422, 'time_ahead_of_server');
    }

    const score = scoreRun(run, taps);
    const flags = botFlags(score);
    verdict(true, {
      score: score.score, raw: score.raw, hits: score.hits, misses: score.misses, completed: score.completed,
      endMs: score.endMs, leftoverBonus: score.leftoverBonus, clientScore: payload.Score,
      scoreMismatch: payload.Score !== score.score, flags,
    });
    // Lo que se firma y va a Funtico: la puntuación del servidor. `Collected` del cliente no pasa (no lo controla el
    // servidor); GameEvents va tal cual (cabecera + toques ya validados) como rastro en Funtico.
    return { ok: true, payload: { Score: score.score, RunId: id, GameEvents: payload.GameEvents } };
  }

  return { enabled: true, configured: true, local: { [START_ROUTE]: start }, validators: { [PRACTICE_ROUTE]: validatePractice }, catalogId: catId };
}

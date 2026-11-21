// F2.2: Triage en servidor (save-server/funtico-triage-runs.js enganchado al relay de funtico.js). Sin red: Funtico es
// un fetch simulado (UserId por token; CompletePractice se descifra con la clave REAL y se apunta lo recibido).
//   npm run test:funtico-server
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHmac } from 'node:crypto';
import { createFunticoRelay, DEFAULT_CLIENT_PAD_KEY } from '../save-server/funtico.js';
import { createTriageRuns, loadServerCatalog, LIMITS } from '../save-server/funtico-triage-runs.js';
import { encrypt, decrypt, hmacSha256, practiceKey, signKey } from '../save-server/funtico-crypto.js';
import { generateRun, scoreRun, catalogId } from '../save-server/funtico-triage/triage.js';
import { compareCopies, FILES } from '../scripts/funtico/sync-triage-server.mjs';

// Claves y sal de PRUEBA construidas por código en cada ejecución (nunca una real ni una constante).
const realKey = ['Real', 'Test', 'Key-'].join('') + 'xyz-' + randomBytes(8).toString('hex');
const publicKey = ['pub', 'lic'].join('') + '-test-' + 'g'.repeat(10);
const padKey = DEFAULT_CLIENT_PAD_KEY;
const testSalt = () => randomBytes(32).toString('hex');
const USERS = { 'Bearer tok-ana': 101, 'Bearer tok-bob': 202 };
const ANA = 'Bearer tok-ana';
const BOB = 'Bearer tok-bob';
const catalog = loadServerCatalog();

function fakeFuntico() {
  const practice = [];
  const calls = [];
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    calls.push(key);
    const userId = USERS[init.headers?.Authorization];
    if (key === 'GET /User/get-full-data') return userId ? res(200, { UserId: userId }) : res(401, {});
    if (key === 'POST /User/complete-practice') {
      const body = JSON.parse(init.body);
      if (hmacSha256(body.Data, signKey(realKey)) !== body.Hash) return res(400, 'bad hash');
      practice.push({ userId, payload: JSON.parse(decrypt(body.Data, practiceKey(userId, realKey))) });
      return res(200, true);
    }
    return res(404, 'nope');
  };
  return { fetch, practice, calls };
}

/** Un save-server «arrancado» sobre `dir`: triage + relay, con reloj controlable. */
function boot(dir, { salt, clock, enabled = '1', limits } = {}) {
  const logs = [];
  const log = { warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const env = { FUNTICO_ENABLED: enabled, FUNTICO_ENV: 'staging', FUNTICO_PUBLIC_KEY: publicKey, FUNTICO_PRIVATE_KEY: realKey };
  if (salt !== undefined) env.FUNTICO_SEED_SALT = salt;
  const now = () => clock.t;
  const fx = fakeFuntico();
  const triage = createTriageRuns({ env, dataDir: dir, now, log, limits });
  const relay = createFunticoRelay({ env, dataDir: dir, fetch: fx.fetch, now, log, validators: triage.validators, local: triage.local });
  return { relay, triage, logs, ...fx };
}

const startRun = async (relay, auth = ANA) => {
  const r = await relay({ method: 'POST', path: '/run/start', headers: { authorization: auth }, bodyText: '' });
  return { status: r.status, body: JSON.parse(r.body) };
};

/** Cuerpo de CompletePractice tal como lo monta el SDK del cliente (clave de relleno). */
function practiceBody(userId, payload) {
  const Data = encrypt(JSON.stringify(payload), practiceKey(userId, padKey));
  return JSON.stringify({ Data, Hash: hmacSha256(Data, signKey(padKey)) });
}
const submit = async (relay, auth, payload) => {
  const r = await relay({ method: 'POST', path: '/User/complete-practice', headers: { authorization: auth }, bodyText: practiceBody(USERS[auth], payload) });
  return { status: r.status, body: JSON.parse(r.body) };
};
const events = (taps, cat = catalogId(catalog)) => [JSON.stringify({ triage: 1, catalog: cat }), ...taps.map((e) => JSON.stringify(e))];

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
/** Carrera honrada: acierta cada estación `gap` ms después de abrirse. */
function honestTaps(run, gap = 2300) {
  return run.stations.map((st, i) => {
    const p = st.kind === 'relapse' ? { x: st.correct, y: 0 } : center(st.bounds);
    return { t: (i + 1) * gap + (i % 3) * 170, est: i, obj: st.obj, x: p.x, y: p.y };
  });
}
/** Un punto de la escena fuera de los bounds. */
function outside(b) {
  if (b.x + b.w + 3 <= 100) return { x: b.x + b.w + 2, y: b.y + b.h / 2 };
  if (b.x - 3 >= 0) return { x: b.x - 2, y: b.y + b.h / 2 };
  return { x: b.x + b.w / 2, y: b.y + b.h + 2 <= 100 ? b.y + b.h + 2 : b.y - 2 };
}

function withDir(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'funtico-triage-'));
    try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}
const T0 = 1_800_000_000_000;

function readAll(dir) {
  const base = join(dir, 'funtico', 'triage');
  let s = '';
  for (const sub of ['open', 'runs']) for (const f of readdirSync(join(base, sub))) s += readFileSync(join(base, sub, f), 'utf8');
  return s;
}
const runLog = (dir, id) => readFileSync(join(dir, 'funtico', 'triage', 'runs', `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ─── Copia byte a byte ───

test('la copia del save-server (save-server/funtico-triage/) es idéntica byte a byte a src/funtico/triage/', () => {
  const r = compareCopies();
  assert.equal(r.length, FILES.length);
  for (const x of r) assert.ok(x.ok, `${x.file}: ${x.reason} — corre node scripts/funtico/sync-triage-server.mjs`);
});

// ─── run/start ───

test('run/start: id aleatorio, semilla = HMAC(sal, runId), hora del servidor, catálogo y duración; estado en el volumen', withDir(async (dir) => {
  const salt = testSalt();
  const clock = { t: T0 };
  const { relay } = boot(dir, { salt, clock });
  const a = await startRun(relay);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.runId, /^[0-9a-f]{32}$/);
  assert.equal(a.body.seed, createHmac('sha256', salt).update(a.body.runId).digest('hex'));
  assert.equal(a.body.serverTime, T0);
  assert.equal(a.body.catalog, catalogId(catalog));
  assert.equal(a.body.catalogHash, catalog.hash);
  assert.equal(a.body.durationS, 180);
  assert.equal(a.body.v, 1);
  const b = await startRun(relay);
  assert.notEqual(a.body.runId, b.body.runId);
  assert.notEqual(a.body.seed, b.body.seed);
  assert.ok(existsSync(join(dir, 'funtico', 'triage', 'open', `${a.body.runId}.json`)));
  const disk = readAll(dir);
  assert.ok(!disk.includes(salt) && !disk.includes('tok-ana') && !disk.includes(realKey), 'ni sal, ni token, ni claves en el volumen');
  // sin token → 401; con cuerpo raro → 400
  assert.equal((await relay({ method: 'POST', path: '/run/start', headers: {}, bodyText: '' })).status, 401);
  assert.equal((await relay({ method: 'POST', path: '/run/start', headers: { authorization: ANA }, bodyText: '{"seed":"x"}' })).status, 400);
}));

test('run/start: límite de carreras abiertas por jugador y de arranques por hora', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay } = boot(dir, { salt: testSalt(), clock });
  for (let i = 0; i < LIMITS.maxOpenPerUser; i++) assert.equal((await startRun(relay)).status, 200);
  const over = await startRun(relay);
  assert.deepEqual(over, { status: 429, body: { error: 'too_many_open_runs' } });
  assert.equal((await startRun(relay, BOB)).status, 200, 'el límite es por jugador');
  // cuando caducan, se liberan
  clock.t += 180_000 + LIMITS.expiryMarginMs + 1;
  assert.equal((await startRun(relay)).status, 200);

  const dir2 = mkdtempSync(join(tmpdir(), 'funtico-triage-'));
  try {
    const c2 = { t: T0 };
    const s2 = boot(dir2, { salt: testSalt(), clock: c2, limits: { maxStartsPerHour: 2, maxOpenPerUser: 99 } });
    assert.equal((await startRun(s2.relay)).status, 200);
    assert.equal((await startRun(s2.relay)).status, 200);
    assert.deepEqual(await startRun(s2.relay), { status: 429, body: { error: 'rate_limited' } });
    c2.t += 3600_001;
    assert.equal((await startRun(s2.relay)).status, 200);
  } finally { rmSync(dir2, { recursive: true, force: true }); }
}));

test('sin FUNTICO_SEED_SALT (o corta): run/start y CompletePractice → 503 triage_unconfigured, sin sal por defecto', withDir(async (dir) => {
  for (const salt of [undefined, '', 'corta', ' ' + testSalt()]) {
    const clock = { t: T0 };
    const { relay, logs, practice } = boot(dir, { salt, clock });
    assert.deepEqual(await startRun(relay), { status: 503, body: { error: 'triage_unconfigured' } });
    const r = await submit(relay, ANA, { Score: 5, RunId: 'a'.repeat(32), GameEvents: events([]) });
    assert.deepEqual(r, { status: 503, body: { error: 'triage_unconfigured' } });
    assert.equal(practice.length, 0);
    assert.equal(logs.length, 1);
    if (salt && salt.length > 16) assert.ok(!logs[0].includes(salt.trim()), 'el aviso no lleva la sal');
  }
  assert.ok(!existsSync(join(dir, 'funtico', 'triage')), 'sin sal no crea el estado de carreras');
}));

test('apagado (FUNTICO_ENABLED fuera): ni lee la sal ni crea nada; /run/start es 404', withDir(async (dir) => {
  const env = { FUNTICO_SEED_SALT: testSalt() };
  const read = [];
  const spy = new Proxy(env, { get: (o, k) => { read.push(k); return o[k]; } });
  const t = createTriageRuns({ env: spy, dataDir: dir });
  assert.equal(t.enabled, false);
  assert.deepEqual(read, ['FUNTICO_ENABLED']);
  assert.deepEqual(readdirSync(dir), []);
  const relay = createFunticoRelay({ env: {}, dataDir: dir, validators: t.validators, local: t.local });
  const r = await relay({ method: 'POST', path: '/run/start', headers: { authorization: ANA }, bodyText: '' });
  assert.equal(r.status, 404);
}));

// ─── CompletePractice ───

test('carrera válida: aceptada y a Funtico va la puntuación RECALCULADA (la del cliente se ignora); registro JSONL', withDir(async (dir) => {
  const salt = testSalt();
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt, clock });
  const { body: s } = await startRun(relay);
  const run = generateRun(s.seed, catalog);
  const taps = honestTaps(run);
  const expected = scoreRun(run, taps);
  assert.ok(expected.score > 0 && expected.hits === run.stations.length);
  clock.t += taps.at(-1).t + 800;
  const r = await submit(relay, ANA, { Score: 999999, RunId: s.runId, Collected: { gems: 500 }, GameEvents: events(taps) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(practice.length, 1);
  assert.equal(practice[0].userId, 101);
  assert.deepEqual(practice[0].payload, { Score: expected.score, RunId: s.runId, GameEvents: events(taps) });

  const lines = runLog(dir, s.runId);
  assert.deepEqual(lines.map((l) => l.ev), ['start', 'submit', 'verdict']);
  assert.equal(lines[0].userId, 101);
  assert.deepEqual(lines[1].taps, taps);
  assert.equal(lines[1].clientScore, 999999);
  assert.equal(lines[2].ok, true);
  assert.equal(lines[2].score, expected.score);
  assert.equal(lines[2].scoreMismatch, true);
  assert.ok(Array.isArray(lines[2].flags));
  const disk = readAll(dir);
  assert.ok(!disk.includes(salt) && !disk.includes('tok-ana') && !disk.includes(realKey));
  assert.ok(!existsSync(join(dir, 'funtico', 'triage', 'open', `${s.runId}.json`)), 'la carrera queda cerrada');
}));

test('reenvío de la misma carrera → 409 run_closed (y Funtico solo recibe una); envíos simultáneos: solo uno pasa', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const { body: s } = await startRun(relay);
  const taps = honestTaps(generateRun(s.seed, catalog));
  clock.t += 60_000;
  const payload = { Score: 1, RunId: s.runId, GameEvents: events(taps) };
  assert.equal((await submit(relay, ANA, payload)).status, 200);
  assert.deepEqual(await submit(relay, ANA, payload), { status: 409, body: { error: 'run_closed' } });
  assert.equal(practice.length, 1);

  const { body: s2 } = await startRun(relay);
  const taps2 = honestTaps(generateRun(s2.seed, catalog));
  clock.t += 60_000;
  const p2 = { Score: 1, RunId: s2.runId, GameEvents: events(taps2) };
  const all = await Promise.all([submit(relay, ANA, p2), submit(relay, ANA, p2), submit(relay, ANA, p2)]);
  assert.deepEqual(all.map((x) => x.status).sort(), [200, 409, 409]);
  assert.equal(practice.length, 2);
  // id inventado
  assert.deepEqual(await submit(relay, ANA, { ...payload, RunId: 'f'.repeat(32) }), { status: 404, body: { error: 'run_unknown' } });
  assert.deepEqual(await submit(relay, ANA, { ...payload, RunId: 'run-0001' }), { status: 404, body: { error: 'run_unknown' } });
}));

test('carrera de otro jugador → 403 run_not_owner sin quemarla; su dueño la puede enviar', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const { body: s } = await startRun(relay, ANA);
  const taps = honestTaps(generateRun(s.seed, catalog));
  clock.t += 60_000;
  const payload = { Score: 1, RunId: s.runId, GameEvents: events(taps) };
  assert.deepEqual(await submit(relay, BOB, payload), { status: 403, body: { error: 'run_not_owner' } });
  assert.equal(practice.length, 0);
  assert.equal((await submit(relay, ANA, payload)).status, 200);
}));

test('carrera caducada → 410 run_expired', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const { body: s } = await startRun(relay);
  const taps = honestTaps(generateRun(s.seed, catalog));
  clock.t = s.expiresAt + 1;
  assert.deepEqual(await submit(relay, ANA, { Score: 1, RunId: s.runId, GameEvents: events(taps) }), { status: 410, body: { error: 'run_expired' } });
  assert.equal(practice.length, 0);
  assert.equal(runLog(dir, s.runId).at(-1).reason, 'run_expired');
}));

test('tiempos imposibles → 422: toques demasiado juntos, no crecientes, reacción inhumana, envío antes de lo posible', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const cases = [
    ['taps_too_fast', (taps) => taps.map((e, i) => ({ ...e, t: 400 + i * 100 }))],
    ['taps_time_not_increasing', (taps) => taps.map((e, i) => (i === 2 ? { ...e, t: taps[1].t } : e))],
    ['taps_reaction_too_fast', (taps) => [{ ...taps[0], t: 120 }, ...taps.slice(1)]],
    ['taps_time_out_of_range', (taps) => [...taps.slice(0, -1), { ...taps.at(-1), t: 181_000 }]],
  ];
  for (const [code, mutate] of cases) {
    const { body: s } = await startRun(relay);
    clock.t += 200_000; // margen de sobra para que la hora del servidor no sea el motivo
    const r = await submit(relay, ANA, { Score: 1, RunId: s.runId, GameEvents: events(mutate(honestTaps(generateRun(s.seed, catalog)))) });
    assert.deepEqual(r, { status: 422, body: { error: code } }, code);
  }
  // registro de 9 toques en 21 s, pero enviado 5 s después de run/start: el reloj del servidor dice que es imposible
  const { body: s } = await startRun(relay);
  clock.t += 5_000;
  const r = await submit(relay, ANA, { Score: 1, RunId: s.runId, GameEvents: events(honestTaps(generateRun(s.seed, catalog))) });
  assert.deepEqual(r, { status: 422, body: { error: 'time_ahead_of_server' } });
  assert.equal(practice.length, 0);
}));

test('acierto fuera de los bounds del objetivo de ESA semilla → 422 hit_out_of_bounds; semilla ajena tampoco cuela', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const { body: s } = await startRun(relay);
  const run = generateRun(s.seed, catalog);
  const taps = honestTaps(run);
  const spot = run.stations.findIndex((st) => st.kind !== 'relapse');
  taps[spot] = { ...taps[spot], ...outside(run.stations[spot].bounds) };
  clock.t += 60_000;
  assert.deepEqual(await submit(relay, ANA, { Score: 1, RunId: s.runId, GameEvents: events(taps) }), { status: 422, body: { error: 'hit_out_of_bounds' } });

  // toques de una carrera con OTRA semilla (p. ej. una elegida por el atacante) contra este runId
  const { body: s2 } = await startRun(relay);
  const forged = honestTaps(generateRun('semilla-elegida-por-el-atacante', catalog));
  clock.t += 60_000;
  const r = await submit(relay, ANA, { Score: 1, RunId: s2.runId, GameEvents: events(forged) });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /^(taps_wrong_objective|hit_out_of_bounds)$/);
  assert.equal(practice.length, 0);
}));

test('cabecera de GameEvents: catálogo distinto → 409 catalog_mismatch; forma mala → 400 bad_events', withDir(async (dir) => {
  const clock = { t: T0 };
  const { relay, practice } = boot(dir, { salt: testSalt(), clock });
  const { body: s } = await startRun(relay);
  const taps = honestTaps(generateRun(s.seed, catalog));
  clock.t += 60_000;
  assert.deepEqual(await submit(relay, ANA, { Score: 1, RunId: s.runId, GameEvents: events(taps, '1:000000000000') }), { status: 409, body: { error: 'catalog_mismatch' } });
  for (const GameEvents of [undefined, [], ['{}'], [events([])[0], '{"t":1,"est":0,"obj":"x","x":1,"y":1,"ok":1}'], [events([])[0], 'nope']]) {
    const { body: sx } = await startRun(relay);
    clock.t += 60_000;
    const payload = { Score: 1, RunId: sx.runId };
    if (GameEvents) payload.GameEvents = GameEvents;
    assert.deepEqual(await submit(relay, ANA, payload), { status: 400, body: { error: 'bad_events' } }, JSON.stringify(GameEvents));
  }
  assert.equal(practice.length, 0);
}));

test('persistencia: una carrera abierta sobrevive a un reinicio (nueva instancia, mismo directorio); el reenvío sigue cerrado', withDir(async (dir) => {
  const salt = testSalt();
  const clock = { t: T0 };
  const first = boot(dir, { salt, clock });
  const { body: s } = await startRun(first.relay);
  const { body: done } = await startRun(first.relay);
  const tapsDone = honestTaps(generateRun(done.seed, catalog));
  clock.t += 60_000;
  assert.equal((await submit(first.relay, ANA, { Score: 1, RunId: done.runId, GameEvents: events(tapsDone) })).status, 200);

  // «reinicio»: nueva instancia sobre el mismo volumen
  const second = boot(dir, { salt, clock });
  const taps = honestTaps(generateRun(s.seed, catalog));
  const r = await submit(second.relay, ANA, { Score: 7, RunId: s.runId, GameEvents: events(taps) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(second.practice[0].payload.Score, scoreRun(generateRun(s.seed, catalog), taps).score);
  assert.deepEqual(await submit(second.relay, ANA, { Score: 1, RunId: done.runId, GameEvents: events(tapsDone) }), { status: 409, body: { error: 'run_closed' } });
  // el límite de abiertas también se reconstruye al arrancar
  const third = boot(dir, { salt, clock, limits: { maxOpenPerUser: 1 } });
  assert.equal((await startRun(third.relay)).status, 200);
  const fourth = boot(dir, { salt, clock, limits: { maxOpenPerUser: 1 } });
  assert.deepEqual(await startRun(fourth.relay), { status: 429, body: { error: 'too_many_open_runs' } });
}));

// F2.1: relay /funtico del save-server (save-server/funtico.js). Sin red: Funtico es un fetch simulado que descifra y
// comprueba con el CryptoHelper del SDK vendorizado, y el «cliente» es el propio SDK (FunticoSDK) apuntando al relay.
//   npm run test:funtico-server
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFunticoSdk } from './funtico-sdk-loader.mjs';
import { createFunticoRelay, loadFunticoConfig, ROUTES, DEFAULT_CLIENT_PAD_KEY, FUNTICO_API_BASE } from '../save-server/funtico.js';
import { practiceKey, attemptKey, sessionKey, signKey, hmacSha256 } from '../save-server/funtico-crypto.js';

const SDK = await loadFunticoSdk();
const { CryptoHelper } = SDK;

// Claves de PRUEBA, obviamente falsas, construidas por código (nunca una real).
const realKey = ['Real', 'Test', 'Key-'].join('') + 'xyz-' + '0123456789abcdef';
const publicKey = ['pub', 'lic'].join('') + '-test-' + 'g'.repeat(10);
const padKey = DEFAULT_CLIENT_PAD_KEY;
const serverKeyOfReal = hmacSha256(realKey, publicKey); // lo que sería la X-Server-Key: jamás debe salir
const USER_ID = 4242;
const TOKEN = 'Bearer jwt-of-test-player';

const baseEnv = () => ({ FUNTICO_ENABLED: '1', FUNTICO_ENV: 'staging', FUNTICO_PUBLIC_KEY: publicKey, FUNTICO_PRIVATE_KEY: realKey });

// ─── Captura de console.* (ninguna línea puede llevar la clave real) ───
let logs = [];
const orig = {};
beforeEach(() => {
  logs = [];
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) {
    orig[k] = console[k];
    console[k] = (...a) => logs.push(a.map(String).join(' '));
  }
});
afterEach(() => {
  for (const k of Object.keys(orig)) console[k] = orig[k];
  for (const line of logs) assertNoSecret(line, 'log');
});

function assertNoSecret(text, where) {
  for (const s of [realKey, signKey(realKey), realKey.substring(0, 8) + realKey.slice(-8), serverKeyOfReal]) {
    assert.ok(!String(text).includes(s), `${where} contiene material de la clave real`);
  }
}

// ─── Funtico simulado (usa el CryptoHelper del SDK con la clave REAL) ───
function fakeFuntico({ fail } = {}) {
  const calls = [];
  const state = { practice: [], levels: [], sessions: new Map() };
  const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-server-key': 'nunca-al-cliente' } });
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: { ...init.headers }, body: init.body });
    if (fail === 'network') throw new TypeError('fetch failed');
    if (fail === 'timeout') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    switch (key) {
      case 'POST /Auth/funtico-auth': return res(200, { Token: 'jwt-of-test-player' });
      case 'GET /User/get-full-data': return res(200, { UserId: USER_ID, PlatformId: 9, Name: 'Tester' });
      case 'GET /User/get-balance': return res(200, { Tico: 0 });
      case 'GET /User/vouchers': return res(200, { Data: [] });
      case 'GET /HallOfFame/global': return res(200, { Entries: [], Page: Number(u.searchParams.get('page')) });
      case 'POST /User/complete-practice': {
        if (await CryptoHelper.hmacSha256(body.Data, signKey(realKey)) !== body.Hash) return res(400, 'bad hash');
        state.practice.push(JSON.parse(await CryptoHelper.decrypt(body.Data, practiceKey(USER_ID, realKey))));
        return res(200, 'true');
      }
      case 'POST /Campaign/complete-level': {
        if (await CryptoHelper.hmacSha256(body.EncryptedData, signKey(realKey)) !== body.Hash) return res(400, 'bad hash');
        state.levels.push(JSON.parse(await CryptoHelper.decrypt(body.EncryptedData, attemptKey(body.AttemptId, realKey))));
        return res(200, { IsWin: true, Stars: 3, BestStars: 3, IsNewBest: true, LevelCompletedFirstTime: true, UnlockedLevelId: null, Rewards: [], RewardsGranted: false, TotalLevels: 5, CompletedLevels: 1, TotalStarsEarned: 3, MaxStars: 15 });
      }
      case 'POST /Session/create-session': {
        if (await CryptoHelper.hmacSha256(body.Data, body.SessionId) !== body.Hash) return res(400, 'bad hash');
        const saved = { Id: 'db-1', SessionId: body.SessionId, SaveSessionId: body.SaveSessionId, GameType: body.GameType, ReconnectTime: 900, Data: body.Data, Hash: body.Hash };
        state.sessions.set('db-1', saved);
        return res(200, saved);
      }
      case 'POST /Session/update-session': {
        const s = state.sessions.get(body.Id);
        if (!s || await CryptoHelper.hmacSha256(body.Data, s.SessionId) !== body.Hash) return res(400, 'bad hash');
        await CryptoHelper.decrypt(body.Data, sessionKey(USER_ID, realKey));
        s.Data = body.Data; s.Hash = body.Hash;
        return res(200, 'true');
      }
      case 'GET /Session/reconnect-to-session': return res(200, state.sessions.get(u.searchParams.get('id')));
      case 'GET /Session/any-unfinished-sessions': return res(200, { SavedSessions: [...state.sessions.values()] });
      default: return res(404, 'nope');
    }
  };
  return { fetch, calls, state };
}

const mk = (opts = {}) => {
  const fx = fakeFuntico(opts);
  const relay = createFunticoRelay({ env: baseEnv(), fetch: fx.fetch, timeoutMs: 200, ...opts.relay });
  return { relay, ...fx };
};

/** Cuerpo de CompletePractice tal como lo monta el SDK con la clave de relleno. */
async function clientPractice(payload, key = padKey) {
  const Data = await CryptoHelper.encrypt(JSON.stringify(payload), practiceKey(USER_ID, key));
  return { Data, Hash: await CryptoHelper.hmacSha256(Data, signKey(key)) };
}
const post = (relay, path, body, headers = { authorization: TOKEN }) => relay({ method: 'POST', path, headers, bodyText: JSON.stringify(body) });

// ─── Interruptor y config ───

test('apagado (por defecto): 404 en todo /funtico/*, sin fetch, sin leer otra variable, sin crear el directorio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funtico-off-'));
  try {
    for (const enabled of [undefined, '', '0', 'false', 'no']) {
      const read = new Set();
      const env = new Proxy({ FUNTICO_ENABLED: enabled, FUNTICO_PRIVATE_KEY: realKey }, { get: (t, k) => { read.add(k); return t[k]; } });
      let fetched = 0;
      const relay = createFunticoRelay({ env, fetch: async () => { fetched++; }, dataDir: dir });
      for (const [method, path] of [['GET', '/User/get-full-data'], ['POST', '/User/complete-practice'], ['GET', '/x'], ['GET', '']]) {
        const r = await relay({ method, path, headers: { authorization: TOKEN }, bodyText: '{}' });
        assert.equal(r.status, 404);
        assertNoSecret(r.body, 'respuesta');
      }
      assert.equal(fetched, 0);
      assert.deepEqual([...read], ['FUNTICO_ENABLED']);
      assert.equal(relay.enabled, false);
    }
    assert.equal(existsSync(join(dir, 'funtico')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('encendido sin claves o con claves inválidas: 503 en todas las rutas y UN aviso sin el valor', async () => {
  const cases = [
    {},
    { FUNTICO_PRIVATE_KEY: undefined },
    { FUNTICO_PUBLIC_KEY: '' },
    { FUNTICO_PRIVATE_KEY: realKey + '\n' },
    { FUNTICO_PRIVATE_KEY: 'short' },
    { FUNTICO_PRIVATE_KEY: publicKey },
    { FUNTICO_PRIVATE_KEY: publicKey + realKey },
    { FUNTICO_ENV: 'dev' },
    { FUNTICO_CLIENT_PAD_KEY: realKey },
  ];
  for (const over of cases) {
    logs = [];
    const env = Object.keys(over).length ? { ...baseEnv(), ...over } : { FUNTICO_ENABLED: '1' };
    let fetched = 0;
    const relay = createFunticoRelay({ env, fetch: async () => { fetched++; } });
    for (const path of ['/User/get-full-data', '/no-existe']) {
      const r = await relay({ method: 'GET', path, headers: { authorization: TOKEN } });
      assert.equal(r.status, 503, JSON.stringify(Object.keys(over)));
      assertNoSecret(r.body, 'respuesta');
    }
    assert.equal(fetched, 0);
    assert.equal(logs.length, 1, 'un único aviso');
    assertNoSecret(logs[0], 'log');
    assert.ok(!logs[0].includes(publicKey));
  }
});

test('config: URL base por entorno sacada del SDK; relleno por defecto = FUNTICO_PLACEHOLDER del puente', () => {
  assert.equal(loadFunticoConfig(baseEnv()).config.apiBase, 'https://funtico-sdk-staging.azurewebsites.net');
  assert.equal(loadFunticoConfig({ ...baseEnv(), FUNTICO_ENV: 'production' }).config.apiBase, 'https://funtico-sdk.azurewebsites.net');
  const sdkSrc = readFileSync(new URL('../src/funtico/sdk/FunticoPhaserSDK.ts', import.meta.url), 'utf8');
  for (const url of Object.values(FUNTICO_API_BASE)) assert.ok(sdkSrc.includes(`"${url}"`), url);
  const bridge = readFileSync(new URL('../src/funtico/FunticoBridge.ts', import.meta.url), 'utf8');
  assert.match(bridge, new RegExp(`FUNTICO_PLACEHOLDER = '${DEFAULT_CLIENT_PAD_KEY}'`));
});

test('lista blanca: cada ruta existe en el SDK; fuera de ella → 404 sin fetch; el cliente no elige host', async () => {
  const sdkSrc = readFileSync(new URL('../src/funtico/sdk/FunticoPhaserSDK.ts', import.meta.url), 'utf8');
  for (const k of Object.keys(ROUTES)) {
    const p = k.split(' ')[1];
    if (p.startsWith('/HallOfFame/')) { // el SDK la compone: `${this.apiUri}/HallOfFame/${path}` con path = "global" | "monthly"
      assert.ok(sdkSrc.includes('${this.apiUri}/HallOfFame/${path}') && sdkSrc.includes(`path = "${p.split('/')[2]}"`), k);
    } else {
      assert.ok(sdkSrc.includes('${this.apiUri}' + p), k);
    }
  }
  const { relay, calls } = mk();
  for (const [method, path] of [
    ['GET', '/Rooms/get-rooms'], ['POST', '/SpecialTournaments/result-tournament'], ['GET', '/User/complete-practice'],
    ['POST', '/User/get-full-data'], ['GET', '//evil.example/User/get-full-data'], ['GET', '/User/get-full-data/../vouchers'],
    ['GET', '/user/get-full-data'], ['GET', 'https://evil.example/x'], ['DELETE', '/User/get-full-data'], ['GET', '/__proto__'],
  ]) {
    const r = await relay({ method, path, headers: { authorization: TOKEN } });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
  const r = await relay({ method: 'GET', path: '/HallOfFame/global', search: '?page=1&url=https://evil.example', headers: { authorization: TOKEN } });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('lectura: se reenvía a la URL del entorno con el token del jugador y la X-User-Key de la config; nada de X-Server-Key', async () => {
  const { relay, calls } = mk();
  const r = await relay({ method: 'GET', path: '/HallOfFame/global', search: '?page=2&limit=10&gameMode=3', headers: { authorization: TOKEN } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { Entries: [], Page: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://funtico-sdk-staging.azurewebsites.net/HallOfFame/global?page=2&limit=10&gameMode=3');
  assert.deepEqual(calls[0].headers, { 'X-User-Key': publicKey, Authorization: TOKEN });
  assert.equal(r.headers, undefined, 'no se copian cabeceras de Funtico al cliente');

  const fx = fakeFuntico();
  const prodRelay = createFunticoRelay({ env: { ...baseEnv(), FUNTICO_ENV: 'production' }, fetch: fx.fetch });
  await prodRelay({ method: 'GET', path: '/User/get-balance', headers: { authorization: TOKEN } });
  assert.equal(fx.calls[0].url, 'https://funtico-sdk.azurewebsites.net/User/get-balance');

  const noAuth = await relay({ method: 'GET', path: '/User/get-full-data' });
  assert.equal(noAuth.status, 401);
  const badAuth = await relay({ method: 'GET', path: '/User/get-full-data', headers: { authorization: 'Bearer a\r\nX-Server-Key: x' } });
  assert.equal(badAuth.status, 401);
  assert.equal(calls.length, 1);
});

test('envío firmado: lo que sale va con la clave real (Funtico lo descifra con el SDK) y no contiene el relleno', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funtico-on-'));
  try {
    const { relay, calls, state } = mk({ relay: { dataDir: dir } });
    const payload = { Score: 15320, RunId: 'run-0001', GameEvents: ['{"t":120,"ok":1}'] };
    const r = await post(relay, '/User/complete-practice', await clientPractice(payload));
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(state.practice, [payload]);
    const out = calls.find((c) => c.url.endsWith('/User/complete-practice'));
    const sent = JSON.parse(out.body);
    assert.deepEqual(Object.keys(sent), ['Data', 'Hash']);
    assert.equal(sent.Hash, await CryptoHelper.hmacSha256(sent.Data, signKey(realKey)));
    const clientBody = await clientPractice(payload);
    assert.notEqual(sent.Data, clientBody.Data);
    for (const c of calls) {
      assert.ok(!JSON.stringify(c).includes(padKey), 'el relleno no viaja a Funtico');
      assert.ok(!Object.keys(c.headers).some((h) => /server-key/i.test(h)), 'nunca X-Server-Key');
      assert.ok(c.url.startsWith('https://funtico-sdk-staging.azurewebsites.net/'));
      assertNoSecret(c.body ?? '', 'cuerpo saliente (texto en claro)');
    }
    // Registro mínimo en <datos>/funtico/: hora, ruta y estado; sin token ni cuerpo
    const lines = readFileSync(join(dir, 'funtico', 'signed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual(Object.keys(lines[0]), ['t', 'route', 'status']);
    assert.equal(lines[0].route, 'POST /User/complete-practice');
    assert.equal(lines[0].status, 200);
    const raw = readFileSync(join(dir, 'funtico', 'signed.jsonl'), 'utf8');
    assert.ok(!raw.includes('jwt') && !raw.includes('15320'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cuerpo manipulado, firma mala o forma inválida → 400 sin fetch', async () => {
  const good = await clientPractice({ Score: 10, RunId: 'r1' });
  const tampered = { ...good, Data: good.Data.slice(0, -4) + 'AAA=' };
  const flipped = { ...good, Hash: good.Hash.replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a')) };
  const realSigned = await clientPractice({ Score: 10, RunId: 'r1' }, realKey); // firmado con otra clave
  for (const [path, body] of [
    ['/User/complete-practice', tampered], ['/User/complete-practice', flipped], ['/User/complete-practice', realSigned],
    ['/User/complete-practice', { ...good, Extra: 1 }], ['/User/complete-practice', { Data: good.Data }], ['/User/complete-practice', 'x'],
    ['/Campaign/complete-level', { AttemptId: 'att-1', EncryptedData: good.Data, Hash: 'f'.repeat(64) }],
  ]) {
    const { relay, calls } = mk();
    const r = await post(relay, path, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(calls.length, 0);
  }
  const { relay, calls } = mk();
  const notJson = await relay({ method: 'POST', path: '/User/complete-practice', headers: { authorization: TOKEN }, bodyText: '{nope' });
  assert.equal(notJson.status, 400);
  const big = await relay({ method: 'POST', path: '/User/complete-practice', headers: { authorization: TOKEN }, bodyText: 'x'.repeat(70 * 1024) });
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test('payload descifrado con forma mala → 400 y no se firma nada', async () => {
  const { relay, calls } = mk();
  for (const payload of [{ Score: 1.5, RunId: 'r' }, { Score: 1, RunId: '' }, { Score: 1, RunId: 'r', Hack: true }, { Score: 2 ** 40, RunId: 'r' }]) {
    const r = await post(relay, '/User/complete-practice', await clientPractice(payload));
    assert.equal(r.status, 400);
  }
  assert.ok(calls.every((c) => !c.url.endsWith('/complete-practice')));
});

test('validador enganchado (F2.2): puede rechazar (400) o reescribir el payload antes de firmar', async () => {
  const seen = [];
  const reject = mk({ relay: { validators: { 'POST /User/complete-practice': (p, ctx) => { seen.push({ p, ctx }); return { ok: false, error: 'Score mismatch' }; } } } });
  const r1 = await post(reject.relay, '/User/complete-practice', await clientPractice({ Score: 999999, RunId: 'r9' }));
  assert.equal(r1.status, 400);
  assert.deepEqual(JSON.parse(r1.body), { error: 'Score mismatch' });
  assert.equal(seen[0].ctx.userId, USER_ID);
  assert.deepEqual(seen[0].p, { Score: 999999, RunId: 'r9' });
  assert.ok(reject.calls.every((c) => !c.url.endsWith('/complete-practice')));

  const rewrite = mk({ relay: { validators: { 'POST /User/complete-practice': async (p) => ({ ok: true, payload: { ...p, Score: 1200 } }) } } });
  const r2 = await post(rewrite.relay, '/User/complete-practice', await clientPractice({ Score: 999999, RunId: 'r9' }));
  assert.equal(r2.status, 200);
  assert.deepEqual(rewrite.state.practice, [{ Score: 1200, RunId: 'r9' }]);

  const broken = mk({ relay: { validators: { 'POST /User/complete-practice': () => { throw new Error('payload ' + realKey); } } } });
  const r3 = await post(broken.relay, '/User/complete-practice', await clientPractice({ Score: 1, RunId: 'r9' }));
  assert.equal(r3.status, 500);
});

test('timeout y red caída → 502 genérico', async () => {
  for (const fail of ['network', 'timeout']) {
    const { relay } = mk({ fail });
    const r = await relay({ method: 'GET', path: '/User/get-balance', headers: { authorization: TOKEN } });
    assert.equal(r.status, 502);
    assert.deepEqual(JSON.parse(r.body), { error: 'Upstream unavailable' });
  }
});

test('de extremo a extremo con el SDK real: SDK (relleno) → relay → Funtico (real)', async () => {
  const fx = fakeFuntico();
  const relay = createFunticoRelay({ env: baseEnv(), fetch: fx.fetch });
  const relayBase = 'https://funtico.test/save-api/funtico';
  const responses = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    assert.ok(String(url).startsWith(relayBase), 'el SDK solo habla con el relay');
    const r = await relay({ method: init.method || 'GET', path: u.pathname.slice('/save-api/funtico'.length), search: u.search, headers: { authorization: init.headers?.Authorization }, bodyText: init.body ?? '' });
    responses.push(r);
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.contentType } });
  };
  try {
    const sdk = SDK.FunticoSDK.Instance;
    await sdk.Initialize({ publicGameKey: 'zeroadventure-public-id-pending', privateGameKey: padKey, env: SDK.FunticoEnvironment.STAGING, apiBaseUrl: relayBase, userToken: 'platform-token' });
    assert.equal(sdk.getUserToken(), 'jwt-of-test-player');
    assert.equal(await sdk.CompletePractice(4321.9, { gameEvents: ['e1'] }), true);
    assert.equal(fx.state.practice.at(-1).Score, 4321);
    assert.deepEqual(fx.state.practice.at(-1).GameEvents, ['e1']);

    const attempt = { AttemptId: 'att-12345678', LevelId: 'lvl-1', ConfigVersion: 1, StartedAt: '2026-11-21T00:00:00Z' };
    const done = await sdk.CompleteCampaignLevel({ time_s: 812.5, solved: true }, attempt);
    assert.equal(done.Stars, 3);
    assert.deepEqual(fx.state.levels.at(-1).Metrics, { time_s: 812.5, solved: 1 });

    const saved = await sdk.CreateSession_Client('{"scene":"lobby"}', SDK.GameTypeEnum.Practice, 'event-1', 'save-1');
    assert.equal(saved.Id, 'db-1');
    assert.equal(await sdk.UpdateSession_Client('{"scene":"upstairs"}'), true);
    assert.equal(await sdk.ReconnectToUnfinishedSession_Client('db-1'), '{"scene":"upstairs"}');
    const stored = fx.state.sessions.get('db-1').Data;
    assert.equal(await CryptoHelper.decrypt(stored, sessionKey(USER_ID, realKey)), '{"scene":"upstairs"}');
    const unfinished = await sdk.UserHasUnfinishedSession_Client();
    assert.equal(await CryptoHelper.decrypt(unfinished.SavedSessions[0].Data, sessionKey(USER_ID, padKey)), '{"scene":"upstairs"}');

    for (const c of fx.calls) {
      assert.ok(!JSON.stringify(c).includes(padKey));
      assert.ok(!Object.keys(c.headers).some((h) => /server-key/i.test(h)));
      assert.equal(c.headers['X-User-Key'], publicKey, 'la pública de la config, no la del cliente');
    }
    for (const r of responses) assertNoSecret(r.body, 'respuesta');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('update-session de una sesión que el relay no conoce → 409 sin firmar', async () => {
  const { relay, calls } = mk();
  const Data = await CryptoHelper.encrypt('{}', sessionKey(USER_ID, padKey));
  const r = await post(relay, '/Session/update-session', { Id: 'db-9', Data, Hash: await CryptoHelper.hmacSha256(Data, 'event-9') });
  assert.equal(r.status, 409);
  assert.ok(calls.every((c) => !c.url.endsWith('/update-session')));
});

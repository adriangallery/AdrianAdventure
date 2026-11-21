// F0.2 (plan FUNTICO_ADVENTURE): puente con Funtico (src/funtico/FunticoBridge.ts). Modo simulado sin red ni SDK,
// Hall of Fame con empates «gana quien llegó antes», prefijo de claves, storage roto, y live con un SDK falso.
// CI (Node 22): node --experimental-strip-types --test tests/funtico-bridge.test.mjs (es `npm run test:funtico`)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const B = await import(process.env.FUNTICO_BRIDGE_PATH ?? '../src/funtico/FunticoBridge.ts');

const PREFIX = 'adrian_adventure_funtico_';
const MONTH = Date.UTC(2026, 10, 1); // 1-nov-2026 00:00 UTC
const H = 3600_000;

/** localStorage de mentira que apunta cada clave que se lee o se escribe. */
const memStore = (init = {}) => {
  const data = { ...init };
  const reads = [];
  const writes = [];
  return {
    data, reads, writes,
    getItem: (k) => { reads.push(k); return k in data ? data[k] : null; },
    setItem: (k, v) => { writes.push(k); data[k] = String(v); },
    removeItem: (k) => { writes.push(k); delete data[k]; },
  };
};
const brokenStore = () => ({
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
});
const clock = (t) => { const c = () => c.t; c.t = t; return c; };

async function mockBridge({ storage = memStore(), now = clock(MONTH + 10 * H), random = () => 0.5, search = '' } = {}) {
  const bridge = B.createBridge({
    search, storage, now, random,
    sdkLoader: () => { throw new Error('el simulado no debe cargar el SDK'); },
  });
  assert.equal(bridge.mode, 'mock');
  const r = await bridge.init();
  assert.deepEqual(r, { ok: true, value: 'mock' });
  return bridge;
}
const val = (r) => { assert.equal(r.ok, true, r.ok ? '' : `${r.error.code}: ${r.error.message}`); return r.value; };

// En modo simulado no puede salir ni una petición: cualquier fetch hace fallar la prueba.
let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch llamado en una prueba del puente'); };
});
afterEach(() => { globalThis.fetch = realFetch; });

// ── resolveMode ──

test('resolveMode: tabla de casos', () => {
  const cases = [
    ['', 'mock'],
    ['?', 'mock'],
    ['?token=', 'mock'],
    ['?token=%20%20', 'mock'],
    ['?foo=1', 'mock'],
    ['?token=abc', 'live'],
    ['token=abc', 'live'],
    ['?token=abc&mock=1', 'mock'],
    ['?mock=1&token=abc', 'mock'],
    ['?mock=true&token=abc', 'mock'],
    ['?mock&token=abc', 'mock'],
    ['?mock=0&token=abc', 'live'],
    ['?mock=false&token=abc', 'live'],
    ['?mock=1', 'mock'],
    ['?lang=es&token=eyJhbGciOi.x.y', 'live'],
  ];
  for (const [search, want] of cases) assert.equal(B.resolveMode(search), want, `resolveMode(${JSON.stringify(search)})`);
});

// ── Simulado ──

test('mock: usuario de prueba estable entre instancias con el mismo storage', async () => {
  const storage = memStore();
  const a = val(await (await mockBridge({ storage, random: () => 0.1234 })).getUser());
  assert.match(a.Name, /^Test Pilot #\d{4}$/);
  assert.equal(a.Name, `Test Pilot #${a.UserId}`);
  assert.equal(a.AvatarUrl, null);
  const b = val(await (await mockBridge({ storage, random: () => 0.9 })).getUser());
  assert.deepEqual(b, a, 'otra instancia con el mismo storage = mismo usuario');
  const c = val(await (await mockBridge({ storage: memStore(), random: () => 0.9 })).getUser());
  assert.notEqual(c.UserId, a.UserId);
});

test('mock: sin init() el puente responde not_initialized (no lanza)', async () => {
  const bridge = B.createBridge({ search: '', storage: memStore() });
  const r = await bridge.getUser();
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not_initialized');
  assert.deepEqual(bridge.getRecordedEvents(), []);
  bridge.recordEvent('x'); // no lanza
});

test('mock: completar práctica la coloca en su sitio del Hall of Fame', async () => {
  const bridge = await mockBridge();
  const before = val(await bridge.getHallOfFame());
  assert.equal(before.leaderboard.length, B.MOCK_RIVALS.length);
  assert.equal(before.currentPlayer, null);
  const scores = before.leaderboard.map((e) => e.totalPoints);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x), 'orden por puntos desc');

  assert.equal(val(await bridge.completePractice(10000, { sessionId: 'run-1' })), true);
  const hof = val(await bridge.getHallOfFame({ period: 'monthly', gameMode: 'practice' }));
  const me = val(await bridge.getUser());
  assert.equal(hof.totalPlayers, B.MOCK_RIVALS.length + 1);
  assert.equal(hof.currentPlayer.userId, me.UserId);
  assert.equal(hof.currentPlayer.rank, 4, '14250, 12800, 11000 y luego 10000');
  assert.equal(hof.leaderboard[3].displayName, me.Name);
  assert.deepEqual(hof.leaderboard.map((e) => e.rank), hof.leaderboard.map((_, i) => i + 1));

  // Cuenta la MEJOR marca, no la suma; gamesPlayed cuenta todas
  val(await bridge.completePractice(2000));
  val(await bridge.completePractice(13000.9)); // se trunca como en el SDK
  const hof2 = val(await bridge.getHallOfFame());
  assert.equal(hof2.currentPlayer.totalPoints, 13000);
  assert.equal(hof2.currentPlayer.gamesPlayed, 3);
  assert.equal(hof2.currentPlayer.rank, 2);

  // Paginación
  const p2 = val(await bridge.getHallOfFame({ page: 2, limit: 4 }));
  assert.equal(p2.leaderboard.length, 4);
  assert.equal(p2.leaderboard[0].rank, 5);
  assert.equal(p2.page, 2);
  assert.equal(p2.limit, 4);
  // Salas y torneos: el simulado no tiene
  assert.equal(val(await bridge.getHallOfFame({ gameMode: 'rooms' })).totalPlayers, 0);
});

test('mock: en empate gana quien llegó antes', async () => {
  // Ape Pilot (11000) jugó a MONTH + 3 h. Si el jugador empata DESPUÉS, va detrás…
  const late = await mockBridge({ now: clock(MONTH + 10 * H) });
  val(await late.completePractice(11000));
  const hl = val(await late.getHallOfFame());
  assert.equal(hl.currentPlayer.rank, 4);
  assert.equal(hl.leaderboard[2].displayName, 'Ape Pilot');
  // …y si empata ANTES, va delante.
  const early = await mockBridge({ now: clock(MONTH + 30 * 60_000) });
  val(await early.completePractice(11000));
  const he = val(await early.getHallOfFame());
  assert.equal(he.currentPlayer.rank, 3);
  assert.equal(he.leaderboard[3].displayName, 'Ape Pilot');

  // Entre sus propias marcas iguales cuenta la primera (playedAt de la primera)
  const now = clock(MONTH + 10 * H);
  const own = await mockBridge({ now });
  val(await own.completePractice(500));
  now.t += H;
  val(await own.completePractice(500));
  assert.equal(val(await own.getHallOfFame()).currentPlayer.playedAt, new Date(MONTH + 10 * H).toISOString());

  // El comparador exportado: mismo criterio
  const a = { userId: 1, totalPoints: 5, playedAt: '2026-11-02T00:00:00.000Z' };
  const b = { userId: 2, totalPoints: 5, playedAt: '2026-11-01T00:00:00.000Z' };
  assert.deepEqual([a, b].sort(B.compareHallOfFame).map((e) => e.userId), [2, 1]);
});

test('mock: el mensual solo cuenta este mes; el global, todo', async () => {
  const now = clock(MONTH - 5 * 24 * H); // octubre
  const bridge = await mockBridge({ now });
  val(await bridge.completePractice(20000));
  now.t = MONTH + 10 * H; // noviembre
  val(await bridge.completePractice(100));
  assert.equal(val(await bridge.getHallOfFame({ period: 'monthly' })).currentPlayer.totalPoints, 100);
  const g = val(await bridge.getHallOfFame({ period: 'global' }));
  assert.equal(g.currentPlayer.totalPoints, 20000);
  assert.equal(g.currentPlayer.rank, 1);
});

test('mock: puntuación inválida → { ok: false, invalid }, sin guardar nada', async () => {
  const bridge = await mockBridge();
  for (const bad of [NaN, Infinity, 2 ** 31, '100']) {
    const r = await bridge.completePractice(bad);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'invalid');
  }
  assert.equal(val(await bridge.getHallOfFame()).currentPlayer, null);
});

test('mock: sesiones para reanudar (crear, actualizar, reconectar, ventana de 15 min, cerrar)', async () => {
  const storage = memStore();
  const now = clock(MONTH + 10 * H);
  const bridge = await mockBridge({ storage, now });
  assert.equal(val(await bridge.getSession()), null);
  assert.equal((await bridge.updateSession('{}')).ok, false, 'sin sesión activa no se actualiza');

  const s = val(await bridge.createSession('{"step":0}', 'Practice', 'triage', 'run-1'));
  assert.equal(s.SessionId, 'triage');
  assert.equal(s.SaveSessionId, 'run-1');
  assert.equal(s.GameType, 5);
  assert.equal(val(await bridge.updateSession('{"step":3}')), true);
  bridge.recordEvent('e1');
  assert.deepEqual(bridge.getRecordedEvents(), ['e1']);

  // «Recarga»: otra instancia con el mismo storage encuentra la sesión
  now.t += 5 * 60_000;
  const again = await mockBridge({ storage, now });
  const resumed = val(await again.getSession());
  assert.equal(resumed.session.Id, s.Id);
  assert.equal(resumed.json, '{"step":3}');
  assert.equal(resumed.session.ReconnectTime, 10 * 60);
  assert.deepEqual(again.getRecordedEvents(), [], 'reconectar limpia el registro, como el SDK');

  // Pasados 15 min desde que se creó ya no se puede reanudar
  now.t += 10 * 60_000;
  assert.equal(val(await (await mockBridge({ storage, now })).getSession()), null);

  // Cerrar la sesión activa la quita
  const b2 = await mockBridge({ storage, now });
  val(await b2.createSession('{}', 'Practice', 'triage', 'run-2'));
  b2.closeSession();
  assert.equal(val(await b2.getUnfinishedSessions()).SavedSessions.length, 0);
});

test('mock: campaña coherente (bloqueos, estrellas, desbloqueo del siguiente)', async () => {
  const storage = memStore();
  const bridge = await mockBridge({ storage });
  const av = val(await bridge.getCampaignAvailability());
  assert.deepEqual(av, { IsAvailable: true, LevelCount: 5, MaxStars: 15 });
  let levels = val(await bridge.getCampaignLevels());
  assert.deepEqual(levels.Levels.map((l) => l.Status), [1, 0, 0, 0, 0]);
  assert.equal(levels.Levels[1].StarRules, null, 'bloqueado: sin reglas ni config');

  const locked = await bridge.startCampaignLevel('chapter_2');
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, 'campaign');
  assert.equal(locked.error.campaignCode, 'LevelLocked');
  const noAttempt = await bridge.completeCampaignLevel({ completed: 1 });
  assert.equal(noAttempt.error.campaignCode, 'NoActiveAttempt');

  const attempt = val(await bridge.startCampaignLevel('chapter_1'));
  assert.deepEqual(bridge.getActiveCampaignAttempt(), attempt);
  const bad = await bridge.completeCampaignLevel({});
  assert.equal(bad.error.campaignCode, 'InvalidMetrics');

  // Perder es un resultado normal
  const lost = val(await bridge.completeCampaignLevel({ completed: false, time_s: 100 }, attempt));
  assert.equal(lost.IsWin, false);
  assert.equal(lost.Stars, 0);
  assert.equal(bridge.getActiveCampaignAttempt(), null, 'como en el SDK, el intento resuelto se consume');
  assert.deepEqual(val(await bridge.getCampaignLevels()).Levels.map((l) => l.Status), [1, 0, 0, 0, 0]);

  val(await bridge.startCampaignLevel('chapter_1'));
  const won = val(await bridge.completeCampaignLevel({ completed: true, hints: 0, hint_max_level: 0, time_s: 600 }));
  assert.equal(won.IsWin, true);
  assert.equal(won.Stars, 3);
  assert.equal(won.LevelCompletedFirstTime, true);
  assert.equal(won.UnlockedLevelId, 'chapter_2');
  assert.equal(won.TotalStarsEarned, 3);
  assert.equal(bridge.getActiveCampaignAttempt(), null, 'el intento se consume');

  // Persistido: otra instancia ve el progreso
  levels = val(await (await mockBridge({ storage })).getCampaignLevels());
  assert.deepEqual(levels.Levels.map((l) => l.Status), [2, 1, 0, 0, 0]);
  assert.equal(levels.Levels[0].BestStars, 3);
  assert.equal(levels.CompletedLevels, 1);

  const a2 = val(await bridge.startCampaignLevel('chapter_2'));
  const two = val(await bridge.completeCampaignLevel({ completed: 1, hints: 4, hint_max_level: 3, time_s: 99999 }, a2));
  assert.equal(two.Stars, 1);
});

test('mock: TODAS las claves que lee o escribe llevan el prefijo adrian_adventure_funtico_', async () => {
  const storage = memStore({ unrelated_key: 'x' });
  const bridge = await mockBridge({ storage });
  val(await bridge.getUser());
  val(await bridge.completePractice(1234, { sessionId: 's1' }));
  val(await bridge.getHallOfFame());
  val(await bridge.createSession('{}', 'Practice', 'triage', 'r1'));
  val(await bridge.updateSession('{"a":1}'));
  val(await bridge.getSession());
  bridge.closeSession();
  const at = val(await bridge.startCampaignLevel('chapter_1'));
  val(await bridge.completeCampaignLevel({ completed: 1 }, at));
  val(await bridge.getCampaignLevels());

  assert.ok(storage.writes.length >= 5, `escribió ${storage.writes.length} veces`);
  const keys = [...storage.reads, ...storage.writes, ...Object.keys(storage.data)].filter((k) => k !== 'unrelated_key');
  const off = keys.filter((k) => !k.startsWith(PREFIX));
  assert.deepEqual(off, [], `claves sin prefijo: ${off.join(', ')}`);
  assert.equal(storage.data.unrelated_key, 'x', 'no toca lo que no es suyo');
});

test('mock: storage que lanza (lleno o sin permiso) → sigue funcionando en memoria', async () => {
  const bridge = await mockBridge({ storage: brokenStore() });
  const u1 = val(await bridge.getUser());
  assert.deepEqual(val(await bridge.getUser()), u1, 'mismo usuario durante la partida');
  val(await bridge.completePractice(9999));
  assert.equal(val(await bridge.getHallOfFame()).currentPlayer.totalPoints, 9999);
  val(await bridge.createSession('{"x":1}', 'Practice', 'triage', 'r'));
  assert.equal(val(await bridge.getSession()).json, '{"x":1}');
  const at = val(await bridge.startCampaignLevel('chapter_1'));
  assert.equal(val(await bridge.completeCampaignLevel({ completed: 1 }, at)).IsWin, true);

  // storage null (sin localStorage) también vale
  const b2 = await mockBridge({ storage: null });
  assert.match(val(await b2.getUser()).Name, /^Test Pilot #/);
});

test('mock: no llama al sdkLoader ni a fetch en todo el recorrido', async () => {
  let loads = 0;
  let fetches = 0;
  globalThis.fetch = () => { fetches++; throw new Error('fetch en modo simulado'); };
  for (const search of ['', '?mock=1&token=secreto', '?token=']) {
    const bridge = B.createBridge({ search, storage: memStore(), sdkLoader: async () => { loads++; return {}; } });
    assert.equal(bridge.mode, 'mock');
    val(await bridge.init());
    val(await bridge.getUser());
    val(await bridge.completePractice(1));
    val(await bridge.getHallOfFame({ period: 'global', gameMode: 'all' }));
    val(await bridge.createSession('{}', 'Practice', 'e', 's'));
    val(await bridge.getSession());
    val(await bridge.getCampaignLevels());
  }
  assert.equal(loads, 0, 'sdkLoader no se llama en simulado');
  assert.equal(fetches, 0, 'fetch no se llama en simulado');
});

// ── Live con SDK falso ──

class FakeCampaignError extends Error {
  constructor(code, message) { super(message); this.name = 'CampaignError'; this.Code = code; }
}

function fakeSdk() {
  const calls = [];
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return typeof ret === 'function' ? ret(...args) : ret; };
  const instance = {
    Initialize: rec('Initialize', async () => {}),
    GetUserData: rec('GetUserData', async () => ({ UserId: 77, PlatformId: 1058, Name: 'player_49', Level: 1 })),
    CompletePractice: rec('CompletePractice', async () => true),
    GetHallOfFame: rec('GetHallOfFame', async () => ({ leaderboard: [], currentPlayer: null, totalPlayers: 0, page: 1, limit: 10 })),
    CreateSession_Client: rec('CreateSession_Client', async (json, gt, ev, ss) => ({ Id: 'db1', SessionId: ev, SaveSessionId: ss, GameType: gt, ReconnectTime: 900, Data: 'enc', Hash: 'h' })),
    UpdateSession_Client: rec('UpdateSession_Client', async () => true),
    UserHasUnfinishedSession_Client: rec('UserHasUnfinishedSession_Client', async () => ({ SavedSessions: [{ Id: 'db1' }] })),
    ReconnectToUnfinishedSession_Client: rec('ReconnectToUnfinishedSession_Client', async () => '{"step":2}'),
    CloseCurrentSession_Client: rec('CloseCurrentSession_Client'),
    RecordEvent_Client: rec('RecordEvent_Client'),
    GetCurrentSessionEvents_Client: rec('GetCurrentSessionEvents_Client', ['a']),
    GetCampaignAvailability: rec('GetCampaignAvailability', async () => ({ IsAvailable: true, LevelCount: 5, MaxStars: 15 })),
    GetCampaignLevels: rec('GetCampaignLevels', async () => ({ IsAvailable: true, Levels: [] })),
    StartCampaignLevel: rec('StartCampaignLevel', async (id) => ({ AttemptId: 'att1', LevelId: id, ConfigVersion: 1, StartedAt: 'x' })),
    GetActiveCampaignAttempt: rec('GetActiveCampaignAttempt', null),
    CompleteCampaignLevel: rec('CompleteCampaignLevel', async () => ({ IsWin: true, Stars: 2 })),
  };
  const mod = {
    FunticoSDK: { Instance: instance },
    FunticoEnvironment: { STAGING: 'staging', PROD: 'prod' },
    HallOfFamePeriodMode: { Global: 0, Monthly: 1 },
    HallOfFameGameModeFilter: { All: 0, SpecialTournament: 1, Rooms: 2, Practice: 3 },
    GameTypeEnum: { Indirect_PVP: 0, Direct_PVP: 1, Tournament: 3, Rooms: 4, Practice: 5, MultiplayerPvp: 6 },
  };
  let loads = 0;
  const loader = async () => { loads++; return mod; };
  return { instance, calls, loader, loads: () => loads };
}

const TOKEN = 'tok-SECRETO-123';

test('live: carga perezosa del SDK y configuración (relay, relleno, token, entorno)', async () => {
  const fake = fakeSdk();
  const storage = memStore();
  const bridge = B.createBridge({ search: `?token=${TOKEN}`, origin: 'https://funtico.example', storage, sdkLoader: fake.loader });
  assert.equal(bridge.mode, 'live');
  assert.equal(fake.loads(), 0, 'crear el puente no carga el SDK');
  const r1 = await bridge.getUser();
  assert.equal(r1.error.code, 'not_initialized');

  assert.deepEqual(await bridge.init(), { ok: true, value: 'live' });
  await bridge.init(); // idempotente
  assert.equal(fake.loads(), 1);
  const [name, config] = fake.calls[0];
  assert.equal(name, 'Initialize');
  assert.deepEqual(config, {
    env: 'staging',
    publicGameKey: B.FUNTICO_PUBLIC_PLACEHOLDER,
    privateGameKey: B.FUNTICO_PLACEHOLDER,
    userToken: TOKEN,
    apiBaseUrl: 'https://funtico.example/save-api/funtico',
  });
  assert.match(B.FUNTICO_PLACEHOLDER, /^public-placeholder-/);
  assert.ok(B.FUNTICO_PLACEHOLDER.length >= 17);
  assert.equal(storage.writes.length + storage.reads.length, 0, 'live no toca el storage (ni guarda el token)');

  const prod = fakeSdk();
  const b2 = B.createBridge({ search: `?token=${TOKEN}`, env: 'prod', apiBaseUrl: 'https://relay/x', storage: memStore(), sdkLoader: prod.loader });
  val(await b2.init());
  assert.equal(prod.calls[0][1].env, 'prod');
  assert.equal(prod.calls[0][1].apiBaseUrl, 'https://relay/x');
});

test('live: cada método del puente llama a su método del SDK', async () => {
  const fake = fakeSdk();
  const bridge = B.createBridge({ search: `?token=${TOKEN}`, origin: '', storage: memStore(), sdkLoader: fake.loader });
  val(await bridge.init());
  fake.calls.length = 0;

  assert.deepEqual(val(await bridge.getUser()), { UserId: 77, PlatformId: 1058, Name: 'player_49', AvatarUrl: null });
  assert.equal(val(await bridge.completePractice(4321.7, { sessionId: 'mine', gameEvents: ['e'] })), true);
  val(await bridge.getHallOfFame());
  val(await bridge.getHallOfFame({ period: 'global', page: 2, limit: 20, gameMode: 'all' }));
  val(await bridge.createSession('{"s":1}', 'Practice', 'triage', 'run-9'));
  val(await bridge.updateSession('{"s":2}'));
  assert.deepEqual(val(await bridge.getSession()), { session: { Id: 'db1' }, json: '{"step":2}' });
  bridge.recordEvent('{"t":1}');
  assert.deepEqual(bridge.getRecordedEvents(), ['a']);
  bridge.closeSession();
  val(await bridge.getCampaignAvailability());
  val(await bridge.getCampaignLevels(false));
  const at = val(await bridge.startCampaignLevel('lvl-1'));
  assert.equal(bridge.getActiveCampaignAttempt(), null);
  val(await bridge.completeCampaignLevel({ completed: true }, at));

  assert.deepEqual(fake.calls, [
    ['GetUserData', true],
    ['CompletePractice', 4321.7, { gameEvents: ['e'] }], // sessionId no existe en el SDK: no se pasa
    ['GetHallOfFame', 1, 1, 10, 3], // Monthly, Practice
    ['GetHallOfFame', 0, 2, 20, 0], // Global, All
    ['CreateSession_Client', '{"s":1}', 5, 'triage', 'run-9'],
    ['UpdateSession_Client', '{"s":2}'],
    ['UserHasUnfinishedSession_Client'],
    ['ReconnectToUnfinishedSession_Client', 'db1'],
    ['RecordEvent_Client', '{"t":1}'],
    ['GetCurrentSessionEvents_Client'],
    ['CloseCurrentSession_Client'],
    ['GetCampaignAvailability', true],
    ['GetCampaignLevels', false],
    ['StartCampaignLevel', 'lvl-1'],
    ['GetActiveCampaignAttempt'],
    ['CompleteCampaignLevel', { completed: true }, { AttemptId: 'att1', LevelId: 'lvl-1', ConfigVersion: 1, StartedAt: 'x' }],
  ]);
});

test('live: los fallos vuelven como { ok: false, error } tipado y sin el token', async () => {
  const fake = fakeSdk();
  const bridge = B.createBridge({ search: `?token=${TOKEN}`, storage: memStore(), sdkLoader: fake.loader });
  val(await bridge.init());

  fake.instance.CompletePractice = async () => { throw new Error(`Failed to complete practice: bad token ${TOKEN}`); };
  const rej = await bridge.completePractice(10);
  assert.equal(rej.ok, false);
  assert.equal(rej.error.code, 'rejected');
  assert.ok(!rej.error.message.includes(TOKEN), 'el token no sale en el mensaje');
  assert.match(rej.error.message, /\[token\]/);

  fake.instance.GetHallOfFame = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal((await bridge.getHallOfFame()).error.code, 'network');

  fake.instance.CompleteCampaignLevel = async () => { throw new FakeCampaignError('CompletionTooFast', 'too fast'); };
  const camp = await bridge.completeCampaignLevel({ completed: 1 });
  assert.deepEqual(camp.error, { code: 'campaign', message: 'too fast', campaignCode: 'CompletionTooFast' });

  fake.instance.RecordEvent_Client = () => { throw new Error('boom'); };
  bridge.recordEvent('x'); // no lanza hacia la escena

  // SDK que no carga (chunk perdido) e Initialize que falla
  const noLoad = B.createBridge({ search: `?token=${TOKEN}`, storage: memStore(), sdkLoader: async () => { throw new Error('chunk 404'); } });
  const r = await noLoad.init();
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'sdk_load');
  const authFail = fakeSdk();
  authFail.instance.Initialize = async () => { throw new Error(`Funtico Authentication failed: ${TOKEN} expired`); };
  const af = B.createBridge({ search: `?token=${TOKEN}`, storage: memStore(), sdkLoader: authFail.loader });
  const ar = await af.init();
  assert.equal(ar.error.code, 'rejected');
  assert.ok(!ar.error.message.includes(TOKEN));
  assert.equal((await af.getUser()).error.code, 'not_initialized');
});

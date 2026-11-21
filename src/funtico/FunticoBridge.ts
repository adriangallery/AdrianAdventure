/**
 * F0.2 (plan FUNTICO_ADVENTURE): ÚNICA puerta del juego hacia Funtico.
 *
 * - `resolveMode(search)`: sin `?token=` o con `?mock=1` → 'mock'; con token y sin mock → 'live'.
 * - `createBridge({ search, storage, now, sdkLoader, … })`: elige la plataforma y devuelve un `FunticoBridge`
 *   que NUNCA lanza hacia la escena: cada llamada asíncrona resuelve a `{ ok: true, value }` o
 *   `{ ok: false, error }` (error tipado).
 * - `MockPlatform`: simulada, sin red y sin ejecutar una línea del SDK. Usuario de prueba estable, Practice,
 *   Hall of Fame, sesiones y campaña en memoria + `storage` (todas las claves con el prefijo
 *   `adrian_adventure_funtico_`). Si el `storage` lanza (lleno, iframe sin permiso), sigue en memoria.
 * - `LivePlatform`: adaptador fino sobre `FunticoSDK` (src/funtico/sdk/FunticoPhaserSDK.ts), cargado SOLO en
 *   modo live con `import()` dinámico. `apiBaseUrl` = `<origin>/save-api/funtico` (relay del save-server, F2.1).
 *   El cliente lleva una clave privada DE RELLENO (pública, no es un secreto); la real solo existe en el
 *   servidor. El token de `?token=` no se guarda ni se escribe en logs (se tacha de los mensajes de error).
 *
 * Los métodos calcan los del SDK en camelCase y los datos usan los MISMOS tipos y nombres de campo del SDK
 * (`import type`: se borra al compilar). Este archivo no puede usar `enum`, `namespace` ni parameter
 * properties: lo importan los tests de Node con `--experimental-strip-types`.
 */
import type {
  CampaignAttemptData,
  CampaignAvailabilityViewModel,
  CampaignCompletionResult,
  CampaignLevelStatus,
  CampaignLevelViewModel,
  CampaignLevelsViewModel,
  CampaignMetrics,
  CampaignStarRules,
  CompletePracticeOptions,
  HallOfFamePlayerEntry,
  HallOfFameResponse,
  SavedSessionResponse,
  UnfinishedSessionsResponse,
  UserData,
} from './sdk/FunticoPhaserSDK';

// ───────────────────────────── Tipos públicos ─────────────────────────────

export type FunticoMode = 'mock' | 'live';
export type FunticoEnv = 'staging' | 'prod';

/** Lo mínimo de `localStorage` que usa el puente. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type FunticoErrorCode =
  | 'network' // fetch falló (sin red, CORS, relay caído)
  | 'rejected' // el servidor (o el SDK) rechazó la llamada
  | 'campaign' // CampaignError del SDK; el código del SDK va en `campaignCode`
  | 'invalid' // argumentos que el SDK rechazaría sin llegar a enviar
  | 'not_initialized' // falta `init()` o falló
  | 'sdk_load'; // no se pudo cargar el SDK (chunk perdido)

export interface FunticoError {
  code: FunticoErrorCode;
  message: string;
  /** `CampaignError.Code` del SDK (p. ej. 'LevelLocked', 'CompletionTooFast'). */
  campaignCode?: string;
}

export type FunticoResult<T> = { ok: true; value: T } | { ok: false; error: FunticoError };

/** Usuario de Funtico. Campos de `UserData` del SDK + avatar. */
export interface FunticoUser {
  UserId: UserData['UserId'];
  PlatformId: UserData['PlatformId'];
  Name: UserData['Name'];
  /** El SDK no expone el avatar del propio jugador (`getUsersInfo` es privado): en live va a null. */
  AvatarUrl: string | null;
}

/**
 * `CompletePracticeOptions` del SDK + `sessionId`. `sessionId` NO existe en el SDK (el SDK crea su propio
 * `RunId` por carrera y lo reutiliza en los reintentos): en live se ignora; en simulado se guarda con la marca.
 */
export interface PracticeOptions extends CompletePracticeOptions {
  sessionId?: string;
}

/** Parámetros de `GetHallOfFame(mode, page, limit, gameMode)` como literales (el puente no carga los enums). */
export interface HallOfFameQuery {
  /** HallOfFamePeriodMode. Por defecto 'monthly' (los premios de Funtico son mensuales). */
  period?: 'global' | 'monthly';
  page?: number;
  limit?: number;
  /** HallOfFameGameModeFilter. Por defecto 'practice' (Triage). */
  gameMode?: 'all' | 'practice' | 'rooms' | 'special';
}

/** Nombres de `GameTypeEnum` que usa el juego en `CreateSession_Client`. */
export type FunticoGameType = 'Practice' | 'Rooms' | 'Tournament';

/** Sesión que se puede reanudar + su estado ya descifrado. */
export interface ResumableSession {
  session: SavedSessionResponse;
  json: string;
}

/**
 * Contrato común de Mock y Live. Las implementaciones PUEDEN lanzar; el puente (`createBridge`) lo captura.
 * Cada método indica el del SDK al que corresponde.
 */
export interface FunticoPlatform {
  readonly mode: FunticoMode;
  /** `Initialize(config)` (que ya hace `Authentication(token)` y `GetUserData`). */
  init(): Promise<void>;
  /** `GetUserData(useCache)`. */
  getUser(useCache?: boolean): Promise<FunticoUser>;
  /** `CompletePractice(score, options)`. */
  completePractice(score: number, options?: PracticeOptions): Promise<boolean>;
  /** `GetHallOfFame(mode, page, limit, gameMode)`. */
  getHallOfFame(query?: HallOfFameQuery): Promise<HallOfFameResponse>;
  /** `CreateSession_Client(json, gameType, eventId, saveSessionId)`. */
  createSession(json: string, gameType: FunticoGameType, eventId: string, saveSessionId: string): Promise<SavedSessionResponse>;
  /** `UpdateSession_Client(json)`. */
  updateSession(json: string): Promise<boolean>;
  /** `UserHasUnfinishedSession_Client()`. */
  getUnfinishedSessions(): Promise<UnfinishedSessionsResponse>;
  /** `ReconnectToUnfinishedSession_Client(id)` → estado descifrado. */
  reconnectSession(id: string): Promise<string>;
  /** `CloseCurrentSession_Client()`. */
  closeSession(): void;
  /** `RecordEvent_Client(eventInfo)`. */
  recordEvent(eventInfo: string): void;
  /** `GetCurrentSessionEvents_Client()`. */
  getRecordedEvents(): string[];
  /** `GetCampaignAvailability(useCache)`. */
  getCampaignAvailability(useCache?: boolean): Promise<CampaignAvailabilityViewModel>;
  /** `GetCampaignLevels(useCache)`. */
  getCampaignLevels(useCache?: boolean): Promise<CampaignLevelsViewModel>;
  /** `StartCampaignLevel(levelId)`. */
  startCampaignLevel(levelId: string): Promise<CampaignAttemptData>;
  /** `GetActiveCampaignAttempt()`. */
  getActiveCampaignAttempt(): CampaignAttemptData | null;
  /** `CompleteCampaignLevel(metrics, attempt)`. */
  completeCampaignLevel(metrics: CampaignMetrics, attempt?: CampaignAttemptData): Promise<CampaignCompletionResult>;
}

/** Lo que ve el juego: lo mismo que la plataforma, pero sin lanzar nunca. */
export interface FunticoBridge {
  readonly mode: FunticoMode;
  init(): Promise<FunticoResult<FunticoMode>>;
  getUser(useCache?: boolean): Promise<FunticoResult<FunticoUser>>;
  completePractice(score: number, options?: PracticeOptions): Promise<FunticoResult<boolean>>;
  getHallOfFame(query?: HallOfFameQuery): Promise<FunticoResult<HallOfFameResponse>>;
  createSession(json: string, gameType: FunticoGameType, eventId: string, saveSessionId: string): Promise<FunticoResult<SavedSessionResponse>>;
  updateSession(json: string): Promise<FunticoResult<boolean>>;
  getUnfinishedSessions(): Promise<FunticoResult<UnfinishedSessionsResponse>>;
  reconnectSession(id: string): Promise<FunticoResult<string>>;
  /** Atajo (no existe en el SDK): primera sesión sin terminar + `reconnectSession`; null si no hay ninguna. */
  getSession(): Promise<FunticoResult<ResumableSession | null>>;
  closeSession(): void;
  recordEvent(eventInfo: string): void;
  getRecordedEvents(): string[];
  getCampaignAvailability(useCache?: boolean): Promise<FunticoResult<CampaignAvailabilityViewModel>>;
  getCampaignLevels(useCache?: boolean): Promise<FunticoResult<CampaignLevelsViewModel>>;
  startCampaignLevel(levelId: string): Promise<FunticoResult<CampaignAttemptData>>;
  getActiveCampaignAttempt(): CampaignAttemptData | null;
  completeCampaignLevel(metrics: CampaignMetrics, attempt?: CampaignAttemptData): Promise<FunticoResult<CampaignCompletionResult>>;
}

/** Lo que el adaptador live usa del módulo del SDK (el `sdkLoader` de los tests lo falsea). */
export type FunticoSdkModule = Pick<
  typeof import('./sdk/FunticoPhaserSDK'),
  'FunticoSDK' | 'FunticoEnvironment' | 'HallOfFamePeriodMode' | 'HallOfFameGameModeFilter' | 'GameTypeEnum'
>;
export type SdkLoader = () => Promise<FunticoSdkModule>;

export interface CreateBridgeOptions {
  /** `location.search` (por defecto, el de la página). */
  search?: string;
  /** Por defecto `localStorage` (si el navegador deja tocarlo). */
  storage?: StorageLike | null;
  /** Reloj en ms (por defecto `Date.now`). */
  now?: () => number;
  /** Carga del SDK real, solo en live. Por defecto `import('./sdk/FunticoPhaserSDK')`. */
  sdkLoader?: SdkLoader;
  /** Azar para el id del usuario de prueba (por defecto `Math.random`). */
  random?: () => number;
  /** Entorno de Funtico en live. Por defecto 'staging'. */
  env?: FunticoEnv;
  /** Origen para el `apiBaseUrl` por defecto (por defecto `location.origin`). */
  origin?: string;
  /** Por defecto `<origin>/save-api/funtico` (relay del save-server). */
  apiBaseUrl?: string;
  /** Clave pública del juego (X-User-Key). No es secreta; hasta tener la de staging, un relleno. */
  publicGameKey?: string;
}

// ───────────────────────────── Constantes ─────────────────────────────

export const STORAGE_PREFIX = 'adrian_adventure_funtico_';

/**
 * Relleno PÚBLICO que el cliente pasa como `privateGameKey` (el SDK exige una para arrancar y cifra con ella).
 * NO es un secreto ni la clave real: el relay del save-server (F2.1) descifra con este relleno y vuelve a
 * cifrar y firmar con la clave real, que solo vive en la config de Dokku. ≥ 17 caracteres y sin solaparse con
 * la pública (lo comprueba `validateConfig` del SDK).
 */
export const FUNTICO_PLACEHOLDER = 'public-placeholder-not-a-secret-zeroadventure';

/** Relleno de la clave pública del juego hasta que Funtico dé las de staging (F2.3). Tampoco es secreto. */
export const FUNTICO_PUBLIC_PLACEHOLDER = 'zeroadventure-public-id-pending';

/** Ventana de reconexión de Funtico: 15 min desde que se crea la sesión (USAGE del SDK). */
export const SESSION_WINDOW_MS = 15 * 60 * 1000;

/** Valores de `GameTypeEnum` del SDK, para el simulado (que no carga el SDK). */
const GAME_TYPE_VALUE: Record<FunticoGameType, number> = { Tournament: 3, Rooms: 4, Practice: 5 };

// ───────────────────────────── Modo ─────────────────────────────

/** Sin `?token=` (o vacío) o con `?mock=1` → 'mock'; con token y sin mock → 'live'. Pura. */
export function resolveMode(search: string): FunticoMode {
  const params = new URLSearchParams(search ?? '');
  const mock = params.get('mock');
  if (mock !== null && mock !== '0' && mock.toLowerCase() !== 'false') return 'mock';
  const token = (params.get('token') ?? '').trim();
  return token ? 'live' : 'mock';
}

// ───────────────────────────── Almacenamiento seguro ─────────────────────────────

/** Memoria primero y `storage` de respaldo; si el `storage` lanza, se sigue solo en memoria. */
class SafeStore {
  private readonly mem = new Map<string, string>();
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
  }

  get(name: string): string | null {
    const key = STORAGE_PREFIX + name;
    const cached = this.mem.get(key);
    if (cached !== undefined) return cached;
    try {
      const value = this.storage?.getItem(key) ?? null;
      if (value !== null) this.mem.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  set(name: string, value: string): void {
    const key = STORAGE_PREFIX + name;
    this.mem.set(key, value);
    try {
      this.storage?.setItem(key, value);
    } catch {
      /* lleno o sin permiso: queda en memoria */
    }
  }

  getJSON<T>(name: string, fallback: T): T {
    const raw = this.get(name);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJSON(name: string, value: unknown): void {
    this.set(name, JSON.stringify(value));
  }
}

// ───────────────────────────── Simulado ─────────────────────────────

interface MockRun {
  score: number;
  at: number;
  sessionId?: string;
  events: number;
}

interface MockSession extends SavedSessionResponse {
  createdAt: number;
  closed: boolean;
}

interface MockLevelProgress {
  BestStars: number;
  BestMetrics: Record<string, number> | null;
  CompletedAt: string | null;
}

/** Rivales ficticios deterministas del Hall of Fame simulado (nombre, mejor marca). */
export const MOCK_RIVALS: ReadonlyArray<readonly [string, number]> = [
  ['Nurse Byte', 14250],
  ['Dr. Pixel', 12800],
  ['Ape Pilot', 11000],
  ['FUD Hunter', 9600],
  ['Sample Sam', 8200],
  ['Night Shift', 6900],
  ['Intern #42', 5400],
  ['Lost Patient', 3100],
];
const MOCK_RIVAL_ID_BASE = 900001;

/** Capítulos de la campaña simulada (F3 los sustituye por los niveles que configure Funtico). */
const MOCK_LEVELS: ReadonlyArray<{ Name: string; parSeconds: number }> = [
  { Name: 'Breaking & Entering', parSeconds: 900 },
  { Name: 'The Receptionist', parSeconds: 1500 },
  { Name: 'Below the Surface', parSeconds: 1500 },
  { Name: 'The Mountain Path', parSeconds: 1800 },
  { Name: 'Patient Zero', parSeconds: 2400 },
];
const MAX_STARS_PER_LEVEL = 3;
const MAX_RUNS = 1000;

/** Error con la misma forma que `CampaignError` del SDK (`name` + `Code`). */
class MockCampaignError extends Error {
  readonly Code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CampaignError';
    this.Code = code;
  }
}

function monthStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function compareHallOfFame(a: HallOfFamePlayerEntry, b: HallOfFamePlayerEntry): number {
  // Funtico: más puntos primero; en empate gana quien llegó antes.
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  const ta = a.playedAt ? Date.parse(a.playedAt) : Number.POSITIVE_INFINITY;
  const tb = b.playedAt ? Date.parse(b.playedAt) : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.userId - b.userId;
}

export interface MockPlatformOptions {
  storage?: StorageLike | null;
  now?: () => number;
  random?: () => number;
}

export class MockPlatform implements FunticoPlatform {
  readonly mode = 'mock' as const;
  private readonly store: SafeStore;
  private readonly now: () => number;
  private readonly random: () => number;
  private user: FunticoUser | null = null;
  private events: string[] = [];
  private activeSessionId: string | null = null;
  private sessionCounter = 0;

  constructor(options: MockPlatformOptions = {}) {
    this.store = new SafeStore(options.storage ?? null);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async init(): Promise<void> {
    this.user = this.loadOrCreateUser();
  }

  private loadOrCreateUser(): FunticoUser {
    const saved = this.store.getJSON<{ UserId?: unknown; Name?: unknown } | null>('user', null);
    if (saved && typeof saved.UserId === 'number' && typeof saved.Name === 'string') {
      return { UserId: saved.UserId, PlatformId: saved.UserId, Name: saved.Name, AvatarUrl: null };
    }
    const n = 1000 + Math.floor(this.random() * 9000);
    const user: FunticoUser = { UserId: n, PlatformId: n, Name: `Test Pilot #${n}`, AvatarUrl: null };
    this.store.setJSON('user', { UserId: user.UserId, Name: user.Name });
    return user;
  }

  private requireUser(): FunticoUser {
    if (!this.user) this.user = this.loadOrCreateUser();
    return this.user;
  }

  async getUser(): Promise<FunticoUser> {
    return { ...this.requireUser() };
  }

  // ── Practice + Hall of Fame ──

  private runs(): MockRun[] {
    const runs = this.store.getJSON<MockRun[]>('practice_runs', []);
    return Array.isArray(runs) ? runs : [];
  }

  async completePractice(score: number, options: PracticeOptions = {}): Promise<boolean> {
    const runs = this.runs();
    const events = options.gameEvents ?? this.events;
    const run: MockRun = { score: Math.trunc(score), at: this.now(), events: events.length };
    if (options.sessionId) run.sessionId = options.sessionId;
    runs.push(run);
    this.store.setJSON('practice_runs', runs.slice(-MAX_RUNS));
    this.events = []; // como el SDK: un resultado entregado limpia el registro
    return true;
  }

  async getHallOfFame(query: HallOfFameQuery = {}): Promise<HallOfFameResponse> {
    const period = query.period ?? 'monthly';
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.max(1, Math.trunc(query.limit ?? 10));
    const gameMode = query.gameMode ?? 'practice';
    const now = this.now();
    const monthStart = monthStartUtc(now);

    const entries: HallOfFamePlayerEntry[] = [];
    // El simulado solo tiene Practice: salas y torneos salen vacíos.
    if (gameMode === 'practice' || gameMode === 'all') {
      MOCK_RIVALS.forEach(([name, points], i) => {
        entries.push({
          userId: MOCK_RIVAL_ID_BASE + i,
          funticoId: MOCK_RIVAL_ID_BASE + i,
          displayName: name,
          avatarUrl: null,
          country: null,
          rank: 0,
          totalPoints: points,
          gamesPlayed: 3 + i,
          playedAt: new Date(monthStart + (i + 1) * 3600_000).toISOString(),
        });
      });
      const user = this.requireUser();
      const mine = this.runs().filter((r) => period === 'global' || r.at >= monthStart);
      if (mine.length > 0) {
        // Mejor marca individual (no suma); entre marcas iguales, la primera.
        let best = mine[0];
        for (const r of mine) if (r.score > best.score || (r.score === best.score && r.at < best.at)) best = r;
        entries.push({
          userId: user.UserId,
          funticoId: user.PlatformId,
          displayName: user.Name,
          avatarUrl: null,
          country: null,
          rank: 0,
          totalPoints: best.score,
          gamesPlayed: mine.length,
          playedAt: new Date(best.at).toISOString(),
        });
      }
    }
    entries.sort(compareHallOfFame);
    entries.forEach((e, i) => { e.rank = i + 1; });
    const me = entries.find((e) => e.userId === this.requireUser().UserId) ?? null;
    return {
      leaderboard: entries.slice((page - 1) * limit, page * limit),
      currentPlayer: me,
      totalPlayers: entries.length,
      page,
      limit,
    };
  }

  // ── Sesiones (reanudar) ──

  private sessions(): MockSession[] {
    const list = this.store.getJSON<MockSession[]>('sessions', []);
    return Array.isArray(list) ? list : [];
  }

  private saveSessions(list: MockSession[]): void {
    const now = this.now();
    // Las caducadas y cerradas ya no sirven: no se acumulan.
    this.store.setJSON('sessions', list.filter((s) => !s.closed && now - s.createdAt < SESSION_WINDOW_MS));
  }

  async createSession(json: string, gameType: FunticoGameType, eventId: string, saveSessionId: string): Promise<SavedSessionResponse> {
    const now = this.now();
    this.sessionCounter++;
    const session: MockSession = {
      Id: `mock-session-${now}-${this.sessionCounter}`,
      SessionId: eventId,
      SaveSessionId: saveSessionId,
      GameType: GAME_TYPE_VALUE[gameType],
      ReconnectTime: SESSION_WINDOW_MS / 1000,
      Data: json, // el SDK lo cifra; el simulado lo guarda en claro
      Hash: '',
      createdAt: now,
      closed: false,
    };
    const list = this.sessions();
    list.push(session);
    this.saveSessions(list);
    this.activeSessionId = session.Id;
    this.events = [];
    return this.publicSession(session, now);
  }

  async updateSession(json: string): Promise<boolean> {
    const list = this.sessions();
    const s = list.find((x) => x.Id === this.activeSessionId);
    if (!s) throw new Error('No active client session found to update. Create or Reconnect first.');
    s.Data = json;
    this.saveSessions(list);
    return true;
  }

  async getUnfinishedSessions(): Promise<UnfinishedSessionsResponse> {
    const now = this.now();
    const live = this.sessions().filter((s) => !s.closed && now - s.createdAt < SESSION_WINDOW_MS);
    return { SavedSessions: live.map((s) => this.publicSession(s, now)) };
  }

  async reconnectSession(id: string): Promise<string> {
    const now = this.now();
    const s = this.sessions().find((x) => x.Id === id && !x.closed && now - x.createdAt < SESSION_WINDOW_MS);
    if (!s) throw new Error('Failed to reconnect to session');
    this.activeSessionId = s.Id;
    this.events = [];
    return s.Data;
  }

  closeSession(): void {
    const id = this.activeSessionId;
    this.activeSessionId = null;
    this.events = [];
    if (!id) return;
    const list = this.sessions();
    const s = list.find((x) => x.Id === id);
    if (s) s.closed = true;
    this.saveSessions(list);
  }

  private publicSession(s: MockSession, now: number): SavedSessionResponse {
    return {
      Id: s.Id,
      SessionId: s.SessionId,
      SaveSessionId: s.SaveSessionId,
      GameType: s.GameType,
      ReconnectTime: Math.max(0, Math.floor((s.createdAt + SESSION_WINDOW_MS - now) / 1000)),
      Data: s.Data,
      Hash: s.Hash,
    };
  }

  recordEvent(eventInfo: string): void {
    this.events.push(eventInfo);
  }

  getRecordedEvents(): string[] {
    return [...this.events];
  }

  // ── Campaña ──

  private progress(): Record<string, MockLevelProgress> {
    const p = this.store.getJSON<Record<string, MockLevelProgress>>('campaign', {});
    return p && typeof p === 'object' ? p : {};
  }

  private levelId(index: number): string {
    return `chapter_${index + 1}`;
  }

  private starRules(index: number): CampaignStarRules {
    const par = MOCK_LEVELS[index].parSeconds;
    return {
      Win: [{ Metric: 'completed', Op: '>=', Value: 1 }],
      Stars: [
        { Star: 1, Conditions: [{ Metric: 'completed', Op: '>=', Value: 1 }] },
        { Star: 2, Conditions: [{ Metric: 'hint_max_level', Op: '<=', Value: 1 }] },
        { Star: 3, Conditions: [{ Metric: 'hints', Op: '==', Value: 0 }, { Metric: 'time_s', Op: '<=', Value: par }] },
      ],
    };
  }

  async getCampaignAvailability(): Promise<CampaignAvailabilityViewModel> {
    return { IsAvailable: true, LevelCount: MOCK_LEVELS.length, MaxStars: MOCK_LEVELS.length * MAX_STARS_PER_LEVEL };
  }

  async getCampaignLevels(): Promise<CampaignLevelsViewModel> {
    const progress = this.progress();
    const levels: CampaignLevelViewModel[] = MOCK_LEVELS.map((lvl, i) => {
      const id = this.levelId(i);
      const done = progress[id];
      const unlocked = i === 0 || Boolean(progress[this.levelId(i - 1)]?.CompletedAt);
      const status = (done?.CompletedAt ? 2 : unlocked ? 1 : 0) as CampaignLevelStatus; // Completed/Unlocked/Locked
      return {
        Id: id,
        Order: i + 1,
        Name: lvl.Name,
        Description: null,
        Status: status,
        BestStars: done?.BestStars ?? 0,
        BestMetrics: done?.BestMetrics ?? null,
        LevelConfigJson: unlocked ? JSON.stringify({ chapter: i + 1 }) : null,
        StarRules: unlocked ? this.starRules(i) : null,
        MinDurationSeconds: 0, // el simulado no frena: los tests de Playwright juegan rápido
        ConfigVersion: 1,
        Rewards: [],
        CompletedAt: done?.CompletedAt ?? null,
      };
    });
    return { IsAvailable: true, Levels: levels, ...this.summary(progress) };
  }

  private summary(progress: Record<string, MockLevelProgress>) {
    const values = Object.values(progress);
    return {
      TotalLevels: MOCK_LEVELS.length,
      CompletedLevels: values.filter((p) => p.CompletedAt).length,
      TotalStarsEarned: values.reduce((n, p) => n + (p.BestStars || 0), 0),
      MaxStars: MOCK_LEVELS.length * MAX_STARS_PER_LEVEL,
    };
  }

  async startCampaignLevel(levelId: string): Promise<CampaignAttemptData> {
    const levels = await this.getCampaignLevels();
    const level = levels.Levels.find((l) => l.Id === levelId);
    if (!level) throw new MockCampaignError('LevelNotFound', `Campaign level ${levelId} not found`);
    if (level.Status === (0 as CampaignLevelStatus)) throw new MockCampaignError('LevelLocked', `Campaign level ${levelId} is locked`);
    this.sessionCounter++;
    const attempt: CampaignAttemptData = {
      AttemptId: `mock-attempt-${this.now()}-${this.sessionCounter}`,
      LevelId: levelId,
      ConfigVersion: level.ConfigVersion,
      StartedAt: new Date(this.now()).toISOString(),
    };
    this.store.setJSON('campaign_attempt', attempt);
    return attempt;
  }

  getActiveCampaignAttempt(): CampaignAttemptData | null {
    return this.store.getJSON<CampaignAttemptData | null>('campaign_attempt', null);
  }

  async completeCampaignLevel(metrics: CampaignMetrics, attempt?: CampaignAttemptData): Promise<CampaignCompletionResult> {
    const tracked = this.getActiveCampaignAttempt();
    const active = attempt ?? tracked;
    if (!active) throw new MockCampaignError('NoActiveAttempt', 'No active campaign attempt to complete.');
    const entries = Object.entries(metrics ?? {});
    if (entries.length < 1 || entries.length > 32) {
      throw new MockCampaignError('InvalidMetrics', `Campaign metrics must carry 1-32 entries; got ${entries.length}`);
    }
    const m: Record<string, number> = {};
    for (const [name, value] of entries) {
      if (name.length < 1 || name.length > 64) throw new MockCampaignError('InvalidMetrics', `Campaign metric name "${name}" must be 1-64 characters`);
      if (typeof value === 'boolean') m[name] = value ? 1 : 0;
      else if (typeof value === 'number' && Number.isFinite(value)) m[name] = value;
      else throw new MockCampaignError('InvalidMetrics', `Campaign metric "${name}" must be a finite number or a boolean`);
    }
    const index = MOCK_LEVELS.findIndex((_, i) => this.levelId(i) === active.LevelId);
    if (index < 0) throw new MockCampaignError('AttemptNotFound', 'Campaign attempt not found');

    // Estrellas como las reglas pintadas en `starRules` (en live las calcula el servidor de Funtico).
    const isWin = (m.completed ?? 0) >= 1;
    let stars = 0;
    if (isWin) {
      stars = 1;
      if ((m.hint_max_level ?? 0) <= 1) stars = 2;
      if (stars === 2 && (m.hints ?? 0) === 0 && (m.time_s ?? Infinity) <= MOCK_LEVELS[index].parSeconds) stars = 3;
    }

    const progress = this.progress();
    const prev = progress[active.LevelId];
    const firstTime = isWin && !prev?.CompletedAt;
    const isNewBest = isWin && stars > (prev?.BestStars ?? 0);
    if (isWin) {
      progress[active.LevelId] = {
        BestStars: Math.max(stars, prev?.BestStars ?? 0),
        BestMetrics: isNewBest || !prev ? m : prev.BestMetrics,
        CompletedAt: prev?.CompletedAt ?? new Date(this.now()).toISOString(),
      };
      this.store.setJSON('campaign', progress);
    }
    if (tracked?.AttemptId === active.AttemptId) this.store.setJSON('campaign_attempt', null);
    this.events = [];
    const next = index + 1 < MOCK_LEVELS.length ? this.levelId(index + 1) : null;
    return {
      IsWin: isWin,
      Stars: stars,
      BestStars: progress[active.LevelId]?.BestStars ?? 0,
      IsNewBest: isNewBest,
      LevelCompletedFirstTime: firstTime,
      UnlockedLevelId: firstTime ? next : null,
      Rewards: [],
      RewardsGranted: false,
      ...this.summary(progress),
    };
  }
}

// ───────────────────────────── Live ─────────────────────────────

export interface LivePlatformOptions {
  sdkLoader: SdkLoader;
  token: string;
  env: FunticoEnv;
  apiBaseUrl: string;
  publicGameKey: string;
}

type SdkInstance = FunticoSdkModule['FunticoSDK']['Instance'];

/** Adaptador fino sobre `FunticoSDK.Instance`: casi un pase directo. */
export class LivePlatform implements FunticoPlatform {
  readonly mode = 'live' as const;
  private readonly options: LivePlatformOptions;
  private mod: FunticoSdkModule | null = null;
  private sdk: SdkInstance | null = null;

  constructor(options: LivePlatformOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    let mod: FunticoSdkModule;
    try {
      mod = await this.options.sdkLoader();
    } catch (e) {
      throw new BridgeFailure('sdk_load', `Funtico SDK could not be loaded: ${messageOf(e)}`);
    }
    const sdk = mod.FunticoSDK.Instance;
    await sdk.Initialize({
      env: this.options.env === 'prod' ? mod.FunticoEnvironment.PROD : mod.FunticoEnvironment.STAGING,
      publicGameKey: this.options.publicGameKey,
      privateGameKey: FUNTICO_PLACEHOLDER,
      userToken: this.options.token,
      apiBaseUrl: this.options.apiBaseUrl,
    });
    this.mod = mod;
    this.sdk = sdk;
  }

  private s(): SdkInstance {
    if (!this.sdk) throw new BridgeFailure('not_initialized', 'Funtico bridge is not initialized. Call init() first.');
    return this.sdk;
  }

  private m(): FunticoSdkModule {
    if (!this.mod) throw new BridgeFailure('not_initialized', 'Funtico bridge is not initialized. Call init() first.');
    return this.mod;
  }

  async getUser(useCache = true): Promise<FunticoUser> {
    const u = await this.s().GetUserData(useCache);
    return { UserId: u.UserId, PlatformId: u.PlatformId, Name: u.Name, AvatarUrl: null };
  }

  async completePractice(score: number, options: PracticeOptions = {}): Promise<boolean> {
    const sdkOptions: CompletePracticeOptions = {};
    if (options.collected) sdkOptions.collected = options.collected;
    if (options.gameEvents) sdkOptions.gameEvents = options.gameEvents;
    return this.s().CompletePractice(score, sdkOptions);
  }

  async getHallOfFame(query: HallOfFameQuery = {}): Promise<HallOfFameResponse> {
    const mod = this.m();
    const period = query.period === 'global' ? mod.HallOfFamePeriodMode.Global : mod.HallOfFamePeriodMode.Monthly;
    const F = mod.HallOfFameGameModeFilter;
    const gm = query.gameMode ?? 'practice';
    const filter = gm === 'all' ? F.All : gm === 'rooms' ? F.Rooms : gm === 'special' ? F.SpecialTournament : F.Practice;
    return this.s().GetHallOfFame(period, query.page ?? 1, query.limit ?? 10, filter);
  }

  async createSession(json: string, gameType: FunticoGameType, eventId: string, saveSessionId: string): Promise<SavedSessionResponse> {
    return this.s().CreateSession_Client(json, this.m().GameTypeEnum[gameType], eventId, saveSessionId);
  }

  async updateSession(json: string): Promise<boolean> {
    return this.s().UpdateSession_Client(json);
  }

  async getUnfinishedSessions(): Promise<UnfinishedSessionsResponse> {
    return this.s().UserHasUnfinishedSession_Client();
  }

  async reconnectSession(id: string): Promise<string> {
    return this.s().ReconnectToUnfinishedSession_Client(id);
  }

  closeSession(): void {
    this.s().CloseCurrentSession_Client();
  }

  recordEvent(eventInfo: string): void {
    this.s().RecordEvent_Client(eventInfo);
  }

  getRecordedEvents(): string[] {
    return this.s().GetCurrentSessionEvents_Client();
  }

  async getCampaignAvailability(useCache = true): Promise<CampaignAvailabilityViewModel> {
    return this.s().GetCampaignAvailability(useCache);
  }

  async getCampaignLevels(useCache = true): Promise<CampaignLevelsViewModel> {
    return this.s().GetCampaignLevels(useCache);
  }

  async startCampaignLevel(levelId: string): Promise<CampaignAttemptData> {
    return this.s().StartCampaignLevel(levelId);
  }

  getActiveCampaignAttempt(): CampaignAttemptData | null {
    return this.s().GetActiveCampaignAttempt();
  }

  async completeCampaignLevel(metrics: CampaignMetrics, attempt?: CampaignAttemptData): Promise<CampaignCompletionResult> {
    return this.s().CompleteCampaignLevel(metrics, attempt);
  }
}

// ───────────────────────────── Puente ─────────────────────────────

/** Error con código ya decidido (lo lanzan las plataformas; el puente lo traduce tal cual). */
class BridgeFailure extends Error {
  readonly code: FunticoErrorCode;
  constructor(code: FunticoErrorCode, message: string) {
    super(message);
    this.name = 'BridgeFailure';
    this.code = code;
  }
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'unknown error';
}

function toError(e: unknown, token: string): FunticoError {
  let message = messageOf(e);
  if (token) message = message.split(token).join('[token]'); // el token nunca sale en un mensaje
  if (e instanceof BridgeFailure) return { code: e.code, message };
  const err = e as { name?: unknown; Code?: unknown } | null;
  if (err && err.name === 'CampaignError') {
    return { code: 'campaign', message, campaignCode: typeof err.Code === 'string' ? err.Code : 'Unknown' };
  }
  if (e instanceof TypeError) return { code: 'network', message }; // fetch: «Failed to fetch» y similares
  return { code: 'rejected', message };
}

function validScore(score: number): boolean {
  return typeof score === 'number' && Number.isFinite(score) &&
    Math.trunc(score) >= -2147483648 && Math.trunc(score) <= 2147483647;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // iframe sin permiso: tocar localStorage lanza
  }
}

function defaultSearch(): string {
  try {
    return typeof location !== 'undefined' ? location.search : '';
  } catch {
    return '';
  }
}

function defaultOrigin(): string {
  try {
    return typeof location !== 'undefined' ? location.origin : '';
  } catch {
    return '';
  }
}

/** Envuelve una plataforma: nada lanza hacia la escena. */
export function wrapPlatform(platform: FunticoPlatform, token = ''): FunticoBridge {
  let initPromise: Promise<FunticoResult<FunticoMode>> | null = null;
  let ready = false;

  const notReady = (): FunticoResult<never> => ({
    ok: false,
    error: { code: 'not_initialized', message: 'Funtico bridge is not initialized. Call init() first.' },
  });

  async function call<T>(fn: () => Promise<T>): Promise<FunticoResult<T>> {
    if (!ready) return notReady();
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      return { ok: false, error: toError(e, token) };
    }
  }

  function quiet<T>(fn: () => T, fallback: T): T {
    if (!ready) return fallback;
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  return {
    mode: platform.mode,
    init() {
      if (!initPromise) {
        initPromise = platform.init().then(
          (): FunticoResult<FunticoMode> => { ready = true; return { ok: true, value: platform.mode }; },
          (e): FunticoResult<FunticoMode> => { initPromise = null; return { ok: false, error: toError(e, token) }; },
        );
      }
      return initPromise;
    },
    getUser: (useCache) => call(() => platform.getUser(useCache)),
    completePractice: (score, options) => {
      if (!validScore(score)) {
        const invalid: FunticoResult<boolean> = {
          ok: false,
          error: { code: 'invalid', message: `score must be a finite number that fits a 32-bit integer, got ${score}` },
        };
        return Promise.resolve(invalid);
      }
      return call(() => platform.completePractice(score, options));
    },
    getHallOfFame: (query) => call(() => platform.getHallOfFame(query)),
    createSession: (json, gameType, eventId, saveSessionId) => call(() => platform.createSession(json, gameType, eventId, saveSessionId)),
    updateSession: (json) => call(() => platform.updateSession(json)),
    getUnfinishedSessions: () => call(() => platform.getUnfinishedSessions()),
    reconnectSession: (id) => call(() => platform.reconnectSession(id)),
    getSession: () => call(async () => {
      const { SavedSessions } = await platform.getUnfinishedSessions();
      const session = SavedSessions?.[0];
      if (!session) return null;
      return { session, json: await platform.reconnectSession(session.Id) };
    }),
    closeSession: () => quiet(() => platform.closeSession(), undefined),
    recordEvent: (eventInfo) => quiet(() => platform.recordEvent(eventInfo), undefined),
    getRecordedEvents: () => quiet(() => platform.getRecordedEvents(), []),
    getCampaignAvailability: (useCache) => call(() => platform.getCampaignAvailability(useCache)),
    getCampaignLevels: (useCache) => call(() => platform.getCampaignLevels(useCache)),
    startCampaignLevel: (levelId) => call(() => platform.startCampaignLevel(levelId)),
    getActiveCampaignAttempt: () => quiet(() => platform.getActiveCampaignAttempt(), null),
    completeCampaignLevel: (metrics, attempt) => call(() => platform.completeCampaignLevel(metrics, attempt)),
  };
}

/** Elige el modo por la URL y monta el puente. Síncrono; la carga del SDK (solo live) ocurre en `init()`. */
export function createBridge(options: CreateBridgeOptions = {}): FunticoBridge {
  const search = options.search ?? defaultSearch();
  const mode = resolveMode(search);
  if (mode === 'mock') {
    const storage = options.storage === undefined ? defaultStorage() : options.storage;
    return wrapPlatform(new MockPlatform({ storage, now: options.now, random: options.random }));
  }
  const token = (new URLSearchParams(search).get('token') ?? '').trim();
  const origin = options.origin ?? defaultOrigin();
  const live = new LivePlatform({
    sdkLoader: options.sdkLoader ?? (() => import('./sdk/FunticoPhaserSDK')),
    token,
    env: options.env ?? 'staging',
    apiBaseUrl: options.apiBaseUrl ?? `${origin}/save-api/funtico`,
    publicGameKey: options.publicGameKey ?? FUNTICO_PUBLIC_PLACEHOLDER,
  });
  return wrapPlatform(live, token);
}

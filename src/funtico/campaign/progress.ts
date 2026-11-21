/**
 * F3.2a (plan FUNTICO_ADVENTURE): progreso de Campaign y guardado aparte por usuario Funtico. Lógica pura (sin imports
 * de valores; el almacenamiento se inyecta), probada en Node (tests/funtico-campaign-progress.test.mjs).
 *
 * Claves (todas con `adrian_adventure_funtico_campaign_<userId>_`; nunca `adrian_adventure_save` ni las del juego):
 *   …_progress          progreso: estrellas y mejor tiempo por expediente, cosméticos activos (JSON, `v: 1`)
 *   …_ch<N>_save        la partida en curso del capítulo N (las claves de SaveLoadSystem, redirigidas por
 *                       `chapterSaveStore`: `adrian_adventure_save` → `…_ch<N>_save`)
 *   …_ch<N>_metrics     `JSON.stringify(window.__funtico.metrics)` del intento en curso (para F3.3)
 */

export const CAMPAIGN_PREFIX = 'adrian_adventure_funtico_campaign_';
export const CASE_COUNT = 5;
/** Expedientes jugables en este MVP (el resto, «COMING SOON»). */
export const PLAYABLE_CASES: readonly number[] = [1, 2];

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CaseRecord {
  /** Mejores estrellas (0–3). */
  stars: number;
  /** Mejor tiempo (s) de un intento terminado; null si nunca se terminó. */
  bestTimeS: number | null;
  /** Veces terminado. */
  completions: number;
}

export type CosmeticId = 'ape_costume' | 'phone_theme';

export interface CampaignProgress {
  v: 1;
  cases: Record<string, CaseRecord>;
  /** Cosméticos ACTIVADOS por el jugador (solo cuentan si están desbloqueados). */
  active: Partial<Record<CosmeticId, boolean>>;
}

export interface UnlockDef { id: CosmeticId; stars: number; label: string }

/** Desbloqueos internos por estrellas totales (nada de Funtico: cosméticos del propio juego). */
export const UNLOCKS: readonly UnlockDef[] = [
  { id: 'ape_costume', stars: 3, label: 'APE COSTUME' },
  { id: 'phone_theme', stars: 5, label: 'DEX PHONE THEME' },
];

/** Id de usuario apto para una clave (solo [A-Za-z0-9-]; lo demás, `_`). */
export function safeUserId(userId: string | number | null | undefined): string {
  const s = String(userId ?? 'anon').replace(/[^A-Za-z0-9-]/g, '_');
  return s || 'anon';
}

export function campaignKey(userId: string | number | null | undefined, name: string): string {
  return `${CAMPAIGN_PREFIX}${safeUserId(userId)}_${name}`;
}

export function emptyProgress(): CampaignProgress {
  return { v: 1, cases: {}, active: {} };
}

const int = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.floor(v)));
};

/** Lee el progreso (corrupto o ilegible = vacío; nunca lanza). */
export function loadProgress(store: KV, userId: string | number | null | undefined): CampaignProgress {
  let raw: string | null = null;
  try { raw = store.getItem(campaignKey(userId, 'progress')); } catch { return emptyProgress(); }
  if (!raw) return emptyProgress();
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return emptyProgress(); }
  const out = emptyProgress();
  if (!data || typeof data !== 'object') return out;
  const d = data as { cases?: unknown; active?: unknown };
  if (d.cases && typeof d.cases === 'object') {
    for (const [k, v] of Object.entries(d.cases as Record<string, unknown>)) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 1 || n > CASE_COUNT || !v || typeof v !== 'object') continue;
      const r = v as Record<string, unknown>;
      out.cases[String(n)] = {
        stars: int(r.stars, 0, 3) ?? 0,
        bestTimeS: int(r.bestTimeS, 0, 1e9),
        completions: int(r.completions, 0, 1e9) ?? 0,
      };
    }
  }
  if (d.active && typeof d.active === 'object') {
    for (const u of UNLOCKS) if ((d.active as Record<string, unknown>)[u.id] === true) out.active[u.id] = true;
  }
  return out;
}

/** Guarda el progreso; false si el almacenamiento falla. */
export function saveProgressTo(store: KV, userId: string | number | null | undefined, p: CampaignProgress): boolean {
  try {
    store.setItem(campaignKey(userId, 'progress'), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function caseRecord(p: CampaignProgress, chapter: number): CaseRecord {
  return p.cases[String(chapter)] ?? { stars: 0, bestTimeS: null, completions: 0 };
}

export function totalStars(p: CampaignProgress): number {
  return Object.values(p.cases).reduce((n, c) => n + (c.stars || 0), 0);
}

export type CaseState = 'open' | 'locked' | 'soon';

/** 1 siempre abierto; N abierto si N-1 tiene ≥ 1 estrella; fuera de PLAYABLE_CASES, «soon». */
export function caseState(p: CampaignProgress, chapter: number): CaseState {
  if (!PLAYABLE_CASES.includes(chapter)) return 'soon';
  if (chapter === 1) return 'open';
  return caseRecord(p, chapter - 1).stars >= 1 ? 'open' : 'locked';
}

export interface RecordOutcome {
  progress: CampaignProgress;
  newBestStars: boolean;
  newBestTime: boolean;
  /** Expediente que se abre por primera vez con este resultado (o null). */
  unlockedCase: number | null;
  /** Cosméticos que se desbloquean por primera vez con este resultado. */
  newUnlocks: CosmeticId[];
}

/** Apunta un intento (no muta `p`). Sin terminar (`stars` 0) no cambia nada. */
export function recordResult(p: CampaignProgress, chapter: number, stars: number, timeS: number): RecordOutcome {
  const next: CampaignProgress = { v: 1, cases: { ...p.cases }, active: { ...p.active } };
  const prev = caseRecord(p, chapter);
  const s = int(stars, 0, 3) ?? 0;
  const t = int(timeS, 0, 1e9);
  if (s < 1) return { progress: next, newBestStars: false, newBestTime: false, unlockedCase: null, newUnlocks: [] };
  const newBestStars = s > prev.stars;
  const newBestTime = t !== null && (prev.bestTimeS === null || t < prev.bestTimeS);
  next.cases[String(chapter)] = {
    stars: Math.max(prev.stars, s),
    bestTimeS: newBestTime ? t : prev.bestTimeS,
    completions: prev.completions + 1,
  };
  const nextCase = chapter + 1;
  const unlockedCase = caseState(p, nextCase) === 'locked' && caseState(next, nextCase) === 'open' ? nextCase : null;
  const before = new Set(unlockedCosmetics(p));
  const newUnlocks = unlockedCosmetics(next).filter((id) => !before.has(id));
  return { progress: next, newBestStars, newBestTime, unlockedCase, newUnlocks };
}

export function unlockedCosmetics(p: CampaignProgress): CosmeticId[] {
  const total = totalStars(p);
  return UNLOCKS.filter((u) => total >= u.stars).map((u) => u.id);
}

export function isUnlocked(p: CampaignProgress, id: CosmeticId): boolean {
  return unlockedCosmetics(p).includes(id);
}

/** Activo = desbloqueado y encendido por el jugador. */
export function isActive(p: CampaignProgress, id: CosmeticId): boolean {
  return isUnlocked(p, id) && p.active[id] === true;
}

/** Enciende o apaga un cosmético (no muta `p`; si está bloqueado no cambia nada). */
export function toggleCosmetic(p: CampaignProgress, id: CosmeticId): CampaignProgress {
  if (!isUnlocked(p, id)) return p;
  const active = { ...p.active };
  if (active[id]) delete active[id];
  else active[id] = true;
  return { ...p, active };
}

const GAME_PREFIX = 'adrian_adventure_';

/**
 * Almacén de partidas del capítulo N: redirige cada clave del juego (`adrian_adventure_<x>`) a
 * `adrian_adventure_funtico_campaign_<userId>_ch<N>_<x>`. Lo que no empieza por `adrian_adventure_` también va con
 * prefijo. Se instala con `setSaveStorage` (src/platform/SaveStorage.ts) antes de arrancar el juego.
 */
export function chapterSaveStore(store: KV, userId: string | number | null | undefined, chapter: number): KV {
  const map = (k: string) => campaignKey(userId, `ch${chapter}_${k.startsWith(GAME_PREFIX) ? k.slice(GAME_PREFIX.length) : k}`);
  return {
    getItem: (k) => store.getItem(map(k)),
    setItem: (k, v) => store.setItem(map(k), v),
    removeItem: (k) => store.removeItem(map(k)),
  };
}

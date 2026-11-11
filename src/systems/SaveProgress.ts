import type { GameState } from '@/types/game.types';

/**
 * A1.13 (plan SCUMM): «Continue» y autoguardado que no pierden partidas. Lógica PURA (sin Phaser ni DOM, sin imports
 * de valores; el almacenamiento se inyecta) para probarla con `node --experimental-strip-types`
 * (tests/save-progress.test.mjs).
 *
 *   - `saveProgress`: cuánto progreso tiene una partida (flags activas, objetos, escenas visitadas además de la
 *     inicial, notas del diario, estar en una escena distinta de la inicial). 0 = partida vacía (la de «New Game»).
 *   - `pickContinue`: de todas las partidas guardadas (slots 0-2, «Before load», «Previous autosave», partidas de
 *     cartera), la MÁS RECIENTE ENTRE LAS QUE TIENEN PROGRESO. Una vacía nunca gana a una con progreso por ser más nueva.
 *   - `autosavePlan`: qué hace un autoguardado: un estado vacío no se escribe nunca; si lo que hay en el slot es de
 *     OTRA partida (otro `runId`) y tiene progreso, antes de pisarlo se copia a «Previous autosave» (nunca se pierde).
 */

export const INITIAL_SCENE = 'outside';
export const SAVE_KEY = 'adrian_adventure_save';
export const WALLET_SAVE_PREFIX = 'adrian_adventure_wallet_';
/** Slot local con la copia del autoguardado de otra partida que se iba a pisar (solo en este dispositivo). */
export const PREVIOUS_AUTOSAVE_SLOT = 4;
/** Slots locales que pueden continuarse: 0 autoguardado, 1-2 manuales, 3 «Before load», 4 «Previous autosave». */
export const CONTINUE_SLOTS = [0, 1, 2, 3, 4] as const;

export interface KVList {
  getItem(key: string): string | null;
  readonly length: number;
  key(index: number): string | null;
}

export interface ContinueCandidate {
  /** 'slot' = adrian_adventure_save[slotId]; 'wallet' = adrian_adventure_wallet_<addr>; 'cloud' = nube de la wallet. */
  source: 'slot' | 'wallet' | 'cloud';
  slotId?: number;
  key?: string;
  state: GameState;
  sceneName: string;
  timestamp: number;
}

type PartialState = Partial<GameState> | null | undefined;

/** Puntos de progreso de una partida (0 = vacía). */
export function saveProgress(state: PartialState): number {
  if (!state || typeof state !== 'object') return 0;
  const flags = state.flags && typeof state.flags === 'object'
    ? Object.values(state.flags).filter((v) => v === true).length : 0;
  const inv = Array.isArray(state.inventory) ? state.inventory.filter((i) => i && !(i as { fromNFT?: boolean }).fromNFT).length : 0;
  const visited = Array.isArray(state.visited) ? new Set(state.visited.filter((v) => v !== INITIAL_SCENE)).size : 0;
  const scene = typeof state.currentScene === 'string' && state.currentScene !== INITIAL_SCENE && visited === 0 ? 1 : 0;
  const notes = state.journal && Array.isArray(state.journal.notes) ? state.journal.notes.length : 0;
  return flags + inv + visited + scene + notes;
}

export function hasProgress(state: PartialState): boolean {
  return saveProgress(state) > 0;
}

/**
 * La partida que carga «Continue»: la más reciente entre las que tienen progreso (a igual fecha, la de más progreso;
 * luego la de slot sobre la de cartera, por orden estable). null si ninguna tiene progreso → no hay «Continue».
 */
export function pickContinue(candidates: readonly (ContinueCandidate | null | undefined)[]): ContinueCandidate | null {
  let best: ContinueCandidate | null = null;
  for (const c of candidates) {
    if (!c || !c.state || !hasProgress(c.state)) continue;
    if (!best) { best = c; continue; }
    const t = c.timestamp ?? 0;
    const bt = best.timestamp ?? 0;
    if (t > bt || (t === bt && saveProgress(c.state) > saveProgress(best.state))) best = c;
  }
  return best;
}

/**
 * Cuándo la nube sustituye a la elección local ya enseñada en el menú: solo si es MÁS NUEVA y con MÁS progreso
 * (la nube llega tarde y no debe cambiar la partida por otra parecida o peor).
 */
export function cloudBeatsLocal(local: ContinueCandidate | null, cloud: ContinueCandidate | null): boolean {
  if (!cloud || !hasProgress(cloud.state)) return false;
  if (!local) return true;
  return (cloud.timestamp ?? 0) > (local.timestamp ?? 0) && saveProgress(cloud.state) > saveProgress(local.state);
}

/** Todas las partidas locales que «Continue» puede cargar (slots y partidas de cartera). Lo ilegible se ignora. */
export function collectLocalCandidates(store: KVList): ContinueCandidate[] {
  const out: ContinueCandidate[] = [];
  try {
    const raw = store.getItem(SAVE_KEY);
    const slots = raw ? JSON.parse(raw) as Record<string, { state?: GameState; sceneName?: string; timestamp?: number } | null> : null;
    if (slots && typeof slots === 'object') {
      for (const id of CONTINUE_SLOTS) {
        const s = slots[id];
        if (s && s.state && typeof s.state === 'object') {
          out.push({ source: 'slot', slotId: id, state: s.state, sceneName: s.sceneName ?? 'Unknown', timestamp: Number(s.timestamp) || 0 });
        }
      }
    }
  } catch { /* slots corruptos: como vacíos */ }
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(WALLET_SAVE_PREFIX)) keys.push(k);
  }
  for (const key of keys.sort()) {
    try {
      const w = JSON.parse(store.getItem(key) ?? 'null') as { state?: GameState; sceneName?: string; timestamp?: number } | null;
      if (w && w.state && typeof w.state === 'object') {
        out.push({ source: 'wallet', key, state: w.state, sceneName: w.sceneName ?? 'Unknown', timestamp: Number(w.timestamp) || 0 });
      }
    } catch { /* partida de cartera corrupta: se ignora */ }
  }
  return out;
}

export type AutosavePlan =
  | { write: false; reason: 'empty' }
  | { write: true; backupExisting: boolean };

/**
 * Qué hace un autoguardado de `next` sobre lo que ya hay (`existing`):
 *   - `next` sin progreso → no se escribe (tras «New Game» el primer autoguardado llega con el primer progreso; un
 *     estado vacío jamás pisa nada).
 *   - lo que hay tiene progreso y es de OTRA partida (otro `runId`; las partidas viejas no tienen y cuentan como otra)
 *     → se escribe, pero antes se copia lo que había (`backupExisting`).
 *   - misma partida → se escribe sin más (aunque tenga menos puntos: gastar un objeto es avanzar, no perder).
 */
export function autosavePlan(existing: PartialState, next: PartialState): AutosavePlan {
  if (!hasProgress(next)) return { write: false, reason: 'empty' };
  const backupExisting = hasProgress(existing) && (existing?.runId ?? null) !== (next?.runId ?? null);
  return { write: true, backupExisting };
}

/** Id de partida nuevo (lo lleva cada «New Game»; a una partida vieja sin id se le pone uno al cargarla). */
export function newRunId(now: number, rand: number): string {
  return `r${now.toString(36)}${Math.floor(rand * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** `runId` válido: texto corto de [A-Za-z0-9_-]. */
export function isValidRunId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
}

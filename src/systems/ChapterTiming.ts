/**
 * A9.14 (plan SCUMM): cuánto dura cada capítulo para un jugador real (la biblia pide 20–40 min). Decisión de Adrián
 * (14-nov): telemetría ANÓNIMA: el juego manda al save-server solo `{ chapter, seconds }` (ni cartera, ni id de
 * partida, ni nada personal). Lógica pura y sin imports de valores (se prueba con `node --experimental-strip-types`,
 * ver tests/chapter-timing.test.mjs).
 *
 * Cómo se mide: con `playTimeMs` (A9.4: suma de fotogramas de GameScene con tope por fotograma, así que la pestaña
 * oculta no suma). Cuando se ve por primera vez la flag `chapter_N_complete`, se apunta en `chapterTimes.marks[N]` el
 * `playTimeMs` de ese momento; la duración del capítulo N es esa marca menos la del N-1 (o menos 0 en el 1).
 *
 * Solo se manda lo que se ha medido entero: si la partida ya traía capítulos cerrados de antes de A9.14, su marca
 * queda en -1 (desconocida) y el capítulo siguiente tampoco se manda. El capítulo 1 solo se manda si la partida
 * empezó a medirse con el tiempo jugado prácticamente a 0 (`start` ≤ START_TOLERANCE_MS).
 */

export const CHAPTER_COUNT = 5;
/** Una partida que empieza a medirse con más tiempo jugado que esto no cuenta para el capítulo 1. */
export const START_TOLERANCE_MS = 5000;
/** Duraciones fuera de esto no se mandan (el servidor aplica los mismos límites). */
export const MIN_CHAPTER_SECONDS = 10;
export const MAX_CHAPTER_SECONDS = 6 * 60 * 60;

/** Lo que se guarda en la partida (`GameState.chapterTimes`). Marca -1 = capítulo cerrado sin medir. */
export interface ChapterTimes {
  start: number;
  marks: Record<string, number>;
}

export interface ChapterSample {
  chapter: number;
  seconds: number;
}

interface TimedState {
  flags?: Record<string, boolean> | null;
  playTimeMs?: number;
  chapterTimes?: ChapterTimes;
}

const finiteMs = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * Mira las flags `chapter_N_complete`, apunta las marcas nuevas EN `state` y devuelve las muestras que hay que mandar
 * (normalmente ninguna; una al cerrar un capítulo). Idempotente: una marca apuntada no se vuelve a mandar.
 */
export function noteChapterMarks(state: TimedState | null | undefined): ChapterSample[] {
  if (!state || typeof state !== 'object') return [];
  const flags = state.flags && typeof state.flags === 'object' ? state.flags : {};
  const now = finiteMs(state.playTimeMs);
  if (!state.chapterTimes) {
    // Primera vez que se mide esta partida: lo ya cerrado queda como desconocido
    const marks: Record<string, number> = {};
    for (let n = 1; n <= CHAPTER_COUNT; n++) if (flags[`chapter_${n}_complete`]) marks[n] = -1;
    state.chapterTimes = { start: now, marks };
    return [];
  }
  const ct = state.chapterTimes;
  const out: ChapterSample[] = [];
  for (let n = 1; n <= CHAPTER_COUNT; n++) {
    if (!flags[`chapter_${n}_complete`] || ct.marks[n] !== undefined) continue;
    ct.marks[n] = now;
    const prev = n === 1 ? (ct.start <= START_TOLERANCE_MS ? 0 : -1) : (ct.marks[n - 1] ?? -1);
    if (prev < 0) continue;
    const seconds = Math.round((now - prev) / 1000);
    if (seconds >= MIN_CHAPTER_SECONDS && seconds <= MAX_CHAPTER_SECONDS) out.push({ chapter: n, seconds });
  }
  return out;
}

/**
 * ¿Se manda telemetría desde esta página? No desde QA/CI (`?qa=1`, navegador automatizado), desarrollo, local ni
 * el modo tráiler: solo partidas de verdad.
 */
export function telemetryAllowed(opts: { search: string; hostname: string; isDev: boolean; webdriver: boolean }): boolean {
  if (opts.isDev || opts.webdriver) return false;
  const p = new URLSearchParams(opts.search);
  if (p.get('qa') === '1' || p.has('trailer') || p.has('record')) return false;
  const h = opts.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return false;
  return true;
}

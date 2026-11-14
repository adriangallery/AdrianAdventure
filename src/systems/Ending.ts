// A9.4 (plan SCUMM): el final que cierra. Créditos que no se saltan con un toque, «THE END», resumen de la partida
// (tiempo jugado, llamadas a Anon, logros con su nombre) y vuelta a la portada con la partida marcada como terminada.
// Lógica pura, sin imports de valores (se prueba con `node --experimental-strip-types`, tests/ending.test.mjs).

/** Los primeros 3 s de créditos no se saltan con nada (el toque que cerró la última frase no los quita). */
export const CREDITS_LOCK_MS = 3000;
/** Pasados esos 3 s, mantener pulsado este tiempo (o Esc) los salta. Un toque no los salta nunca. */
export const CREDITS_HOLD_MS = 600;
/** «THE END» y el resumen no se cierran con un toque antes de esto (que dé tiempo a leerlo). */
export const ENDING_TAP_GUARD_MS = 2000;
/** Tope de lo que suma un fotograma al tiempo jugado (pestaña oculta, pausas del navegador). */
export const PLAYTIME_MAX_STEP_MS = 250;

export type CreditsInput = 'tap' | 'hold' | 'esc';

/** ¿Salta los créditos esta entrada a los `elapsedMs` de empezar? Un toque, nunca; mantener o Esc, tras 3 s. */
export function creditsSkipAllowed(input: CreditsInput, elapsedMs: number): boolean {
  if (input === 'tap') return false;
  return Number.isFinite(elapsedMs) && elapsedMs >= CREDITS_LOCK_MS;
}

/** ¿Cierra el resumen un toque a los `elapsedMs` de enseñarlo? */
export function endingTapAllowed(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= ENDING_TAP_GUARD_MS;
}

/** Suma un fotograma al tiempo jugado (con tope por fotograma; valores raros no suman). */
export function addPlayTime(prevMs: number | undefined, deltaMs: number): number {
  const prev = typeof prevMs === 'number' && Number.isFinite(prevMs) && prevMs > 0 ? prevMs : 0;
  const d = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, PLAYTIME_MAX_STEP_MS) : 0;
  return prev + d;
}

/** Tiempo jugado legible: «45s», «12m 05s», «1h 07m». Sin dato o 0 → «0m 00s». */
export function formatPlayTime(ms: number | undefined): string {
  const total = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return total > 0 ? `${s}s` : '0m 00s';
}

/** Llamadas a Anon (las pistas pedidas por el móvil de Dex), de `journal.calls`; sin diario = 0. */
export function anonCalls(journal: { calls?: unknown } | undefined | null): number {
  const c = journal?.calls;
  return typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
}

/** «Called Anon: never» / «1 time» / «N times». */
export function anonCallsText(n: number): string {
  if (n <= 0) return 'never';
  return n === 1 ? '1 time' : `${n} times`;
}

/** Nombre legible de un logro: el de su definición; si no hay, el id con mayúsculas («alpha_leak» → «Alpha Leak»). */
export function achievementName(id: string, defs: ReadonlyArray<{ id: string; name: string }>): string {
  const def = defs.find((d) => d.id === id);
  if (def) return def.name;
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Nombres de los logros conseguidos, sin repetir y en el orden del juego (el de `defs`; los desconocidos al final). */
export function achievementNames(ids: ReadonlyArray<string>, defs: ReadonlyArray<{ id: string; name: string }>): string[] {
  const uniq = [...new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))];
  const order = (id: string) => {
    const i = defs.findIndex((d) => d.id === id);
    return i < 0 ? defs.length : i;
  };
  return uniq.sort((a, b) => order(a) - order(b)).map((id) => achievementName(id, defs));
}

export interface EndingSummary {
  playTime: string;
  anonCalls: number;
  achievements: string[];
  /** Líneas de texto tal cual salen en pantalla, debajo de «THE END» */
  lines: string[];
}

/** El resumen del final a partir de la partida. */
export function endingSummary(
  state: { playTimeMs?: number; journal?: { calls?: unknown } | null; achievements?: ReadonlyArray<string> },
  defs: ReadonlyArray<{ id: string; name: string }>,
  totalAchievements: number = defs.length,
): EndingSummary {
  const playTime = formatPlayTime(state.playTimeMs);
  const calls = anonCalls(state.journal);
  const achievements = achievementNames(state.achievements ?? [], defs);
  const lines = [
    `Time played: ${playTime}`,
    `Called Anon: ${anonCallsText(calls)}`,
    `Achievements: ${achievements.length} of ${totalAchievements}`,
    ...achievements.map((n) => `★ ${n}`),
  ];
  return { playTime, anonCalls: calls, achievements, lines };
}

/** ¿Está terminada la partida? (A9.4: lleva `completedAt`, que se pone al acabar los créditos; las partidas de antes no lo traen) */
export function isFinishedRun(state: { completedAt?: unknown } | null | undefined): boolean {
  const c = state?.completedAt;
  return typeof c === 'number' && Number.isFinite(c) && c > 0;
}

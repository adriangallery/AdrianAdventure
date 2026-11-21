/**
 * F3.2a (plan FUNTICO_ADVENTURE): estrellas SIMULADAS de Campaign con reglas locales. Lógica pura (sin imports), probada
 * en Node (tests/funtico-campaign-stars.test.mjs). F3.4 sustituirá el par y las reglas por las `StarRules` del servidor.
 *
 *   ★     terminar el capítulo
 *   ★★    terminar con `hint_max_level` ≤ 1 (como mucho la pista de «dirección» de Anon)
 *   ★★★   lo anterior + `hints` == 0 y (`time_s` ≤ par o todos los opcionales del capítulo)
 *
 * «Todos los opcionales» solo cuenta en un capítulo que tiene alguno (`OPTIONAL_TOTAL` > 0): el capítulo 1 no tiene,
 * y si contara como cumplido el par no serviría de nada.
 */

export interface StarMetrics {
  completed: number;
  time_s: number;
  hints: number;
  hint_max_level: number;
  optional: number;
}

/** Par provisional en segundos de tiempo de juego, por capítulo. */
export const PAR_SECONDS: Readonly<Record<number, number>> = { 1: 600, 2: 1200 };

/**
 * Logros opcionales (categorías `explorer`/`secret`, ver F3.1) por capítulo. Provisional: el capítulo 2 tiene el reloj
 * (`diamond_hands`, 2.8). Fernando y el Golden Token (2.7) no dan logro y no cuentan todavía.
 */
export const OPTIONAL_TOTAL: Readonly<Record<number, number>> = { 1: 0, 2: 1 };

export const MAX_STARS = 3;

export function parFor(chapter: number): number | null {
  return PAR_SECONDS[chapter] ?? null;
}

export function formatTime(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return '--:--';
  const t = Math.floor(s);
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Qué reglas se cumplen (para pintarlas con su marca). */
export function starChecks(chapter: number, m: StarMetrics): { finish: boolean; lowHints: boolean; noHints: boolean; underPar: boolean; allOptional: boolean } {
  const par = parFor(chapter);
  const total = OPTIONAL_TOTAL[chapter] ?? 0;
  return {
    finish: (m.completed ?? 0) >= 1,
    lowHints: (m.hint_max_level ?? 0) <= 1,
    noHints: (m.hints ?? 0) === 0,
    underPar: par !== null && Number.isFinite(m.time_s) && m.time_s <= par,
    allOptional: total > 0 && (m.optional ?? 0) >= total,
  };
}

/** Estrellas (0–3). Sin terminar, 0. */
export function computeStars(chapter: number, m: StarMetrics): number {
  const c = starChecks(chapter, m);
  if (!c.finish) return 0;
  if (!c.lowHints) return 1;
  if (c.noHints && (c.underPar || c.allOptional)) return 3;
  return 2;
}

/** Las reglas en texto (inglés) para pintarlas en el resultado y en el mapa. */
export function starRuleLines(chapter: number): string[] {
  const par = parFor(chapter);
  const total = OPTIONAL_TOTAL[chapter] ?? 0;
  const third = total > 0
    ? `NO HINTS AND UNDER ${formatTime(par)} OR ALL ${total} EXTRAS`
    : `NO HINTS AND UNDER ${formatTime(par)}`;
  return ['FINISH THE CASE', 'HINTS: DIRECTION ONLY', third];
}

/** «★★☆» con caracteres de la fuente del juego (Press Start 2P no tiene ★): `*` llena y `-` vacía. */
export function starString(n: number): string {
  const k = Math.max(0, Math.min(MAX_STARS, Math.floor(n) || 0));
  return '*'.repeat(k) + '-'.repeat(MAX_STARS - k);
}

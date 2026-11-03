/**
 * A4.5 (plan SCUMM): stingers musicales. Lógica pura, sin Phaser ni imports (tests/stingers.test.mjs).
 *
 * Los clips (`stinger_*` de assets/audio/sfx, sintetizados en Do por scripts/audio/stinger-recipes.mjs) se transportan con
 * `detune` a la tónica de la pista que suena (src/config/music.config.ts, estimada por scripts/audio/analyze-music.mjs) y
 * siguen su modo (mayor/menor) cuando tienen tercera. Suenan al encontrar un objeto (`addItem`), al resolver un puzle (un
 * objetivo del diario se cumple), al cerrar un capítulo y, a demanda, con el op `{ "op": "stinger", "kind": "fail" }`.
 * Mientras suena uno la música baja (fuente de ducking `stinger`).
 */

export type StingerKind = 'item' | 'puzzle' | 'chapter' | 'fail';
export const STINGER_KINDS: readonly StingerKind[] = ['item', 'puzzle', 'chapter', 'fail'];

export interface MusicKeyLike {
  /** 0 = Do … 11 = Si */
  tonic: number;
  mode: 'major' | 'minor';
}

/** Volumen de los stingers (los efectos van por el nodo maestro de Phaser, aparte de la música) */
export const STINGER_VOLUME = 0.55;
/** Duración (ms) de cada clip tal y como lo escribe el generador, para soltar el ducking al acabar */
export const STINGER_MS: Record<string, number> = {
  stinger_item: 750,
  stinger_puzzle_major: 1300,
  stinger_puzzle_minor: 1300,
  stinger_chapter_major: 2300,
  stinger_chapter_minor: 2300,
  stinger_fail: 1100,
};
export const STINGER_SFX_KEYS = Object.keys(STINGER_MS);

export function isStingerKind(v: unknown): v is StingerKind {
  return typeof v === 'string' && (STINGER_KINDS as readonly string[]).includes(v);
}

/** Semitonos de Do a la tónica, por el camino más corto (una cuarta arriba como mucho; si no, hacia abajo) */
export function transposeSemitones(tonic: number): number {
  const t = ((Math.round(tonic) % 12) + 12) % 12;
  return t <= 5 ? t : t - 12;
}

/** Clip y desafino (cents) de un stinger sobre la tonalidad que suena (null = sin música: en Do, mayor) */
export function stingerFor(kind: StingerKind, musicKey: MusicKeyLike | null | undefined): { key: string; detune: number; ms: number } {
  const mode = musicKey?.mode === 'minor' ? 'minor' : 'major';
  const key = kind === 'item' || kind === 'fail' ? `stinger_${kind}` : `stinger_${kind}_${mode}`;
  const semis = musicKey ? transposeSemitones(musicKey.tonic) : 0;
  const detune = semis * 100;
  // El desafino cambia la velocidad de reproducción (rate = 2^(cents/1200)): el clip dura menos o más
  const ms = Math.round(STINGER_MS[key] / Math.pow(2, detune / 1200));
  return { key, detune, ms };
}

export interface GoalSnapshot {
  chapter: number;
  /** Objetivos cumplidos del capítulo actual */
  done: number;
}

/**
 * Qué stingers tocan entre dos instantáneas del diario: `chapter` si el capítulo avanzó (el objetivo que lo cerró no suena
 * aparte), `puzzle` por cada objetivo cumplido nuevo dentro del mismo capítulo. Sin instantánea anterior (primera vez en la
 * página) no suena nada: es el punto de partida.
 */
export function goalStingers(prev: GoalSnapshot | null | undefined, now: GoalSnapshot): StingerKind[] {
  if (!prev) return [];
  if (now.chapter > prev.chapter) return ['chapter'];
  if (now.chapter < prev.chapter) return [];
  const out: StingerKind[] = [];
  for (let i = prev.done; i < now.done; i++) out.push('puzzle');
  return out;
}

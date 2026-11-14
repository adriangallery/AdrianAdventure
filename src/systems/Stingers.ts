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

/**
 * A8.3b: stingers de EVENTO grabados (ElevenLabs, art/music/stingers/plan.json, cortados y normalizados a −15,5 LUFS,
 * 192 kbps). Los sintetizados siguen siendo los puentes entre temas (MusicPlanner) y la reserva. `tonic`/`mode` son los
 * MEDIDOS (analyze-music.mjs), no los pedidos; `mode: null` = sin tercera (vale para mayor y menor). No se integraron
 * item (medido Si menor, ambiguo), puzzle_minor ni chapter_minor (salieron en Do mayor, no en La menor).
 */
export interface GenStinger {
  ms: number;
  tonic: number;
  mode: 'major' | 'minor' | null;
}
export const STINGER_GEN: Record<string, GenStinger> = {
  stinger_gen_puzzle_major: { ms: 4180, tonic: 7, mode: 'major' },
  stinger_gen_chapter_major: { ms: 7262, tonic: 0, mode: 'major' },
  stinger_gen_fail: { ms: 2873, tonic: 0, mode: null },
};
export const STINGER_GEN_KEYS = Object.keys(STINGER_GEN);
/** Transposición máxima (semitonos) de un clip grabado: más allá cambia demasiado de velocidad y timbre (±12 %) */
export const STINGER_GEN_MAX_SHIFT = 2;

/**
 * Clip de un EVENTO (objeto, puzle, capítulo, fallo): el grabado si lo hay y encaja con la tonalidad que suena (mismo modo
 * y a ≤ STINGER_GEN_MAX_SHIFT semitonos) y no hay una voz hablando (duraría encima de la frase); si no, el sintetizado.
 */
export function eventStingerFor(
  kind: StingerKind,
  musicKey: MusicKeyLike | null | undefined,
  opts: { voice?: boolean } = {},
): { key: string; detune: number; ms: number } {
  const synth = stingerFor(kind, musicKey);
  if (opts.voice) return synth;
  const genKey = synth.key.replace(/^stinger_/, 'stinger_gen_');
  const gen = STINGER_GEN[genKey];
  if (!gen) return synth;
  if (musicKey && gen.mode && musicKey.mode !== gen.mode) return synth;
  const semis = musicKey ? transposeSemitones(musicKey.tonic - gen.tonic) : 0;
  if (Math.abs(semis) > STINGER_GEN_MAX_SHIFT) return synth;
  const detune = semis * 100;
  return { key: genKey, detune, ms: Math.round(gen.ms / Math.pow(2, detune / 1200)) };
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

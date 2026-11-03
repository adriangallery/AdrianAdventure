// Generado por scripts/audio/analyze-music.mjs (A4.5). No editar a mano.
// Tonalidad estimada de cada pista de assets/audio/music (cromagrama + perfiles de Krumhansl): los stingers, sintetizados
// en Do, se transportan a la tónica de la pista que suena (src/systems/Stingers.ts).
export interface MusicKey {
  /** Clase de altura de la tónica (0 = Do … 11 = Si) */
  tonic: number;
  mode: 'major' | 'minor';
}

export const MUSIC_KEYS: Record<string, MusicKey> = {
  'clinical': { tonic: 4, mode: 'minor' }, // E minor
  'epilogue': { tonic: 0, mode: 'major' }, // C major
  'retro-adventure': { tonic: 2, mode: 'major' }, // D major
  'retroadrian': { tonic: 9, mode: 'minor' }, // A minor
  'tension': { tonic: 4, mode: 'minor' }, // E minor
  'vista': { tonic: 7, mode: 'minor' }, // G minor
};

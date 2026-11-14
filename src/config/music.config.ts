// Generado por scripts/audio/analyze-music.mjs (A4.5). No editar a mano.
// Tonalidad estimada de cada pista de assets/audio/music (cromagrama + perfiles de Krumhansl): los stingers, sintetizados
// en Do, se transportan a la tónica de la pista que suena (src/systems/Stingers.ts).
export interface MusicKey {
  /** Clase de altura de la tónica (0 = Do … 11 = Si) */
  tonic: number;
  mode: 'major' | 'minor';
}

export const MUSIC_KEYS: Record<string, MusicKey> = {
  'adrianlab-n0': { tonic: 7, mode: 'major' }, // G major
  'adrianlab-n1': { tonic: 7, mode: 'major' }, // G major
  'adrianlab-n2': { tonic: 7, mode: 'major' }, // G major
  'adrianlab-n3': { tonic: 7, mode: 'major' }, // G major
  'aventura-n0': { tonic: 2, mode: 'major' }, // D major
  'aventura-n1': { tonic: 2, mode: 'major' }, // D major
  'aventura-n2': { tonic: 2, mode: 'major' }, // D major
  'aventura-n3': { tonic: 2, mode: 'major' }, // D major
  'clinica-n0': { tonic: 4, mode: 'major' }, // E major
  'clinica-n1': { tonic: 4, mode: 'major' }, // E major
  'clinica-n2': { tonic: 4, mode: 'major' }, // E major
  'clinica-n3': { tonic: 4, mode: 'major' }, // E major
  'clinical': { tonic: 4, mode: 'minor' }, // E minor
  'dex-n0': { tonic: 2, mode: 'major' }, // D major
  'dex-n1': { tonic: 2, mode: 'major' }, // D major
  'dex-n2': { tonic: 2, mode: 'major' }, // D major
  'dex-n3': { tonic: 2, mode: 'major' }, // D major
  'epilogue': { tonic: 0, mode: 'major' }, // C major
  'final-n0': { tonic: 7, mode: 'major' }, // G major
  'final-n1': { tonic: 7, mode: 'major' }, // G major
  'final-n2': { tonic: 7, mode: 'major' }, // G major
  'final-n3': { tonic: 7, mode: 'major' }, // G major
  'retro-adventure': { tonic: 2, mode: 'major' }, // D major
  'retroadrian': { tonic: 9, mode: 'minor' }, // A minor
  'sotano-n0': { tonic: 4, mode: 'minor' }, // E minor
  'sotano-n1': { tonic: 4, mode: 'minor' }, // E minor
  'sotano-n2': { tonic: 4, mode: 'minor' }, // E minor
  'sotano-n3': { tonic: 4, mode: 'minor' }, // E minor
  'tension': { tonic: 4, mode: 'minor' }, // E minor
  'vista': { tonic: 7, mode: 'minor' }, // G minor
};

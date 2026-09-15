/**
 * V6 (plan AdrianZERO): ajustes del jugador guardados en localStorage — velocidad del texto y volumen de la
 * música. El silencio de la música ya lo gestiona MusicManager (adrian_adventure_muted).
 */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export type MusicLevel = 'low' | 'medium' | 'high';

const STORE_TEXT_SPEED = 'adrian_adventure_text_speed';
const STORE_MUSIC_LEVEL = 'adrian_adventure_music_volume';

export const TEXT_SPEEDS: TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
export const MUSIC_LEVELS: MusicLevel[] = ['low', 'medium', 'high'];

const CHAR_DELAY: Record<TextSpeed, number> = { slow: 45, normal: 25, fast: 10, instant: 0 };
const LEVEL_VOLUME: Record<MusicLevel, number> = { low: 0.25, medium: 0.55, high: 0.9 };

function read(name: string): string | null {
  try { return localStorage.getItem(name); } catch { return null; }
}
function write(name: string, value: string): void {
  try { localStorage.setItem(name, value); } catch { /* sin almacenamiento: el ajuste dura la sesión */ }
}

export function getTextSpeed(): TextSpeed {
  const v = read(STORE_TEXT_SPEED) as TextSpeed | null;
  return v && TEXT_SPEEDS.includes(v) ? v : 'normal';
}
export function setTextSpeed(v: TextSpeed): void { write(STORE_TEXT_SPEED, v); }
/** Milisegundos por carácter del efecto máquina de escribir (0 = texto completo al instante). */
export function charDelayMs(): number { return CHAR_DELAY[getTextSpeed()]; }

/** Nivel guardado, o null si el jugador nunca lo cambió (se usa el volumen por defecto del juego). */
export function getMusicLevel(): MusicLevel | null {
  const v = read(STORE_MUSIC_LEVEL) as MusicLevel | null;
  return v && MUSIC_LEVELS.includes(v) ? v : null;
}
export function setMusicLevel(v: MusicLevel): void { write(STORE_MUSIC_LEVEL, v); }
export function musicVolumeFor(level: MusicLevel | null, fallback: number): number {
  return level ? LEVEL_VOLUME[level] : fallback;
}

export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' };
export const MUSIC_LEVEL_LABEL: Record<MusicLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/**
 * V6 (plan AdrianZERO): ajustes del jugador guardados en localStorage — velocidad del texto y volumen de la
 * música. El silencio de la música ya lo gestiona MusicManager (adrian_adventure_muted).
 *
 * A4.8 (plan SCUMM): volumen por defecto ALTO (antes, sin nada guardado, la música iba a 0,25 = «Low») y ajuste aparte
 * de las voces (`Voices`, por defecto High = ganancia 1,0, independiente del de la música). Migración de una sola vez
 * (`migrateMusicLevel`, marca `adrian_adventure_music_volume_v2`): a quien tenga guardado el valor por defecto antiguo
 * («low» o nada) se le pone High; lo que se cambie a mano después de esta versión se respeta. Sin imports: se prueba en
 * Node (tests/audio-mix.test.mjs). No toca las partidas guardadas.
 */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export type MusicLevel = 'low' | 'medium' | 'high';
export type VoiceLevel = MusicLevel;

const STORE_TEXT_SPEED = 'adrian_adventure_text_speed';
export const STORE_MUSIC_LEVEL = 'adrian_adventure_music_volume';
/** A4.8: marca de la migración del volumen (presente = ya migrado; el valor es la versión) */
export const STORE_MUSIC_MIGRATED = 'adrian_adventure_music_volume_v2';
export const STORE_VOICE_LEVEL = 'adrian_adventure_voice_volume';

export const TEXT_SPEEDS: TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
export const MUSIC_LEVELS: MusicLevel[] = ['low', 'medium', 'high'];
export const VOICE_LEVELS: VoiceLevel[] = MUSIC_LEVELS;
/** A4.8: nivel por defecto de música y voces (antes la música, sin nada guardado, sonaba a 0,25 = Low) */
export const DEFAULT_MUSIC_LEVEL: MusicLevel = 'high';
export const DEFAULT_VOICE_LEVEL: VoiceLevel = 'high';

const CHAR_DELAY: Record<TextSpeed, number> = { slow: 45, normal: 25, fast: 10, instant: 0 };
export const LEVEL_VOLUME: Record<MusicLevel, number> = { low: 0.25, medium: 0.55, high: 0.9 };
/** A4.8: ganancia de las voces por nivel (High = 1,0: la voz nunca baja con el ajuste de la música) */
export const VOICE_LEVEL_GAIN: Record<VoiceLevel, number> = { low: 0.35, medium: 0.6, high: 1 };

function read(name: string): string | null {
  try { return localStorage.getItem(name); } catch { return null; }
}
function write(name: string, value: string): void {
  try { localStorage.setItem(name, value); } catch { /* sin almacenamiento: el ajuste dura la sesión */ }
}
const isLevel = (v: string | null): v is MusicLevel => v !== null && (MUSIC_LEVELS as string[]).includes(v);

export function getTextSpeed(): TextSpeed {
  const v = read(STORE_TEXT_SPEED) as TextSpeed | null;
  return v && TEXT_SPEEDS.includes(v) ? v : 'normal';
}
export function setTextSpeed(v: TextSpeed): void { write(STORE_TEXT_SPEED, v); }
/** Milisegundos por carácter del efecto máquina de escribir (0 = texto completo al instante). */
export function charDelayMs(): number { return CHAR_DELAY[getTextSpeed()]; }

/**
 * A4.8: migración pura del volumen de la música. `stored` = lo guardado en STORE_MUSIC_LEVEL, `marker` = lo guardado en
 * STORE_MUSIC_MIGRATED. Devuelve el nivel que vale ahora y si hay que escribirlo (y la marca).
 * - Ya migrado (hay marca): se respeta lo guardado; sin nada (o basura) → High.
 * - Sin marca: nada guardado o «low» (el valor por defecto antiguo: 0,25, que el menú enseñaba como «Low») → High;
 *   «medium»/«high» los eligió el jugador → se quedan.
 */
export function migrateMusicLevel(stored: string | null, marker: string | null): { level: MusicLevel; write: boolean } {
  if (marker !== null) return { level: isLevel(stored) ? stored : DEFAULT_MUSIC_LEVEL, write: false };
  if (stored === 'medium' || stored === 'high') return { level: stored, write: true };
  return { level: DEFAULT_MUSIC_LEVEL, write: true };
}

/** Nivel de la música (A4.8: migra una vez y, sin nada guardado, High). */
export function getMusicLevel(): MusicLevel {
  const m = migrateMusicLevel(read(STORE_MUSIC_LEVEL), read(STORE_MUSIC_MIGRATED));
  if (m.write) {
    write(STORE_MUSIC_LEVEL, m.level);
    write(STORE_MUSIC_MIGRATED, '1');
  }
  return m.level;
}
export function setMusicLevel(v: MusicLevel): void {
  write(STORE_MUSIC_LEVEL, v);
  write(STORE_MUSIC_MIGRATED, '1');
}
/** Volumen (ganancia) de la música para un nivel; `fallback` solo si no hay nivel (compatibilidad) */
export function musicVolumeFor(level: MusicLevel | null, fallback = LEVEL_VOLUME[DEFAULT_MUSIC_LEVEL]): number {
  return level ? LEVEL_VOLUME[level] : fallback;
}

/** A4.8: nivel de las voces (por defecto High) */
export function getVoiceLevel(): VoiceLevel {
  const v = read(STORE_VOICE_LEVEL);
  return isLevel(v) ? v : DEFAULT_VOICE_LEVEL;
}
export function setVoiceLevel(v: VoiceLevel): void { write(STORE_VOICE_LEVEL, v); }
export function voiceGainFor(level: VoiceLevel | null): number {
  return VOICE_LEVEL_GAIN[level ?? DEFAULT_VOICE_LEVEL];
}

/** Siguiente nivel al pulsar el botón (Low → Medium → High → Low) */
export function nextLevel(cur: MusicLevel): MusicLevel {
  return MUSIC_LEVELS[(MUSIC_LEVELS.indexOf(cur) + 1) % MUSIC_LEVELS.length];
}

export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' };
export const MUSIC_LEVEL_LABEL: Record<MusicLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

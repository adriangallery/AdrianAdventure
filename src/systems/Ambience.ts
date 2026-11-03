/**
 * A4.4 (plan SCUMM): bucles de ambiente por escena (`audio.ambience` de scene.json: grillos, viento, servidores,
 * ventilación…). Lógica pura, sin Phaser (tests/audio-ambience.test.mjs); quien suena es MusicManager, con un
 * AudioBufferSourceNode en bucle por debajo de la música.
 *
 * Los ficheros los genera `scripts/audio/make-ambience.mjs`: cada uno es el bucle (loopSec) más AMBIENCE_PAD_SEC del
 * principio repetido al final, así cualquier ventana de loopSec segundos que empiece antes del relleno es un bucle
 * perfecto, tenga o no el descodificador de MP3 su retardo (~25 ms) al principio. Los puntos de bucle se centran en
 * el relleno: loopStart = pad/2, loopEnd = pad/2 + loopSec.
 */
// Sin imports (se prueba en Node): MusicManager pasa AMBIENCE_LOOPS y AMBIENCE_PAD_SEC de src/config/ambience.config.ts.
export interface AmbienceLoopInfo {
  loopSec: number;
  gain: number;
}

/** Fundido entre el ambiente de una escena y el de la siguiente (más corto que el de la música: no es melódico) */
export const AMBIENCE_CROSSFADE_MS = 1500;
/** Volumen base del ambiente respecto a la música (ambos pasan por el volumen de ajustes y el ducking) */
export const AMBIENCE_BASE_GAIN = 0.9;

export const ambienceUrl = (key: string, v: string): string => `assets/audio/ambience/${key}.mp3${v}`;
/** Clave en la caché de audio de Phaser (no choca con un efecto que se llame igual) */
export const ambienceCacheKey = (key: string): string => `amb_${key}`;

export interface AmbienceRequest {
  key: string;
  /** Ganancia final (gain del bucle × ambienceVolume de la escena × AMBIENCE_BASE_GAIN) */
  gain: number;
  loopSec: number;
}

/** Lo justo de `SceneData.audio` que mira el ambiente */
export interface AmbienceAudioConfig {
  ambience?: string | null;
  /** Multiplicador por escena (0-2; por defecto 1): la misma ventilación suena menos en el treatment room */
  ambienceVolume?: number;
}

/**
 * Qué ambiente pide la escena, o null si no tiene (o pide uno que no existe: se avisa por consola y se calla, el
 * linter lo marca como error (f)).
 */
export function resolveAmbience(
  audio: AmbienceAudioConfig | null | undefined,
  loops: Readonly<Record<string, AmbienceLoopInfo>>,
  warn: (msg: string) => void = (m) => console.warn(m),
): AmbienceRequest | null {
  const key = audio?.ambience;
  if (!key) return null;
  const info = loops[key];
  if (!info) {
    warn(`[Ambience] «${key}» no está en ambience.config.ts (node scripts/audio/make-ambience.mjs)`);
    return null;
  }
  const vol = typeof audio?.ambienceVolume === 'number' && Number.isFinite(audio.ambienceVolume) ? Math.min(2, Math.max(0, audio.ambienceVolume)) : 1;
  return { key, gain: Math.max(0.001, info.gain * vol * AMBIENCE_BASE_GAIN), loopSec: info.loopSec };
}

/**
 * Puntos de bucle (segundos) para un buffer descodificado: centrados en el relleno. Si el buffer resulta más corto de
 * lo esperado (fichero viejo o recortado), se usa lo que hay desde el principio.
 */
export function ambienceLoopPoints(loopSec: number, bufferSec: number, padSec: number): { start: number; end: number } {
  const start = padSec / 2;
  const end = start + loopSec;
  if (bufferSec >= end) return { start, end };
  const safeEnd = Math.max(0.1, bufferSec);
  return { start: Math.max(0, Math.min(start, safeEnd - loopSec)), end: safeEnd };
}

/**
 * Qué hacer al cambiar de escena con el ambiente que suena (`current`) y el que pide la nueva (`next`): seguir igual
 * (misma clave: solo se ajusta el volumen), fundir a otro o apagar.
 */
export function ambienceTransition(current: string | null, next: AmbienceRequest | null): 'keep' | 'crossfade' | 'silence' | 'none' {
  if (!next) return current ? 'silence' : 'none';
  return current === next.key ? 'keep' : 'crossfade';
}

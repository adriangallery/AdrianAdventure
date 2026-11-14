/**
 * A4.8 (plan SCUMM): mezcla por categorías. Los ficheros NO se renormalizan (2.575 mp3 de voz con hash en el lock): se
 * compensa con ganancia en el motor. Medidas (ffmpeg loudnorm/ebur128) y cuentas en docs/progreso/A4.8.md.
 *
 *   voz      ≈ −25,6 LUFS (mediana de 30 clips, pico real −4,8 dBTP como mucho) → VOICE_BOOST (+11 dB) → ≈ −15/−16 LUFS
 *   música   ≈ −14,5 LUFS (pistas A4.5/A8.1) × High 0,9 (−0,9 dB) → ≈ −15,4; bajo la voz × DUCK_LEVEL 0,35 (−9,1 dB) → ≈ −24,5
 *   efectos  ≈ −12/−15 LUFS momentáneo × 0,7 (por defecto de SfxPlayer) × SFX_GAIN (+6 dB) → al nivel de la voz
 *            (los pasos siguen a la mitad que eligió Adrián: SFX_GAIN es el volumen maestro de Phaser y sube a todos igual)
 *
 * Contra el clipping, todo (Phaser: voces, efectos, stingers; MusicManager: música y ambiente) sale por un limitador
 * maestro (DynamicsCompressor rápido con umbral MASTER_LIMIT_DB) antes del altavoz.
 * Sin imports: lo puro se prueba en Node (tests/audio-mix.test.mjs).
 */

/** Ganancia extra de las voces (+11 dB): de ≈ −25,6 LUFS a ≈ −15/−16 LUFS tras el limitador */
export const VOICE_BOOST = 3.55;
/** Volumen maestro de Phaser (efectos, stingers, interfaz y voces): +6 dB */
export const SFX_GAIN = 2;
/** Limitador maestro: umbral (dBFS), ratio, ataque y relajación (s) */
export const MASTER_LIMIT_DB = -3;
export const MASTER_LIMIT = { threshold: MASTER_LIMIT_DB, knee: 0, ratio: 20, attack: 0.002, release: 0.15 } as const;

export const toDb = (g: number): number => 20 * Math.log10(g);
export const fromDb = (db: number): number => 10 ** (db / 20);

/**
 * Volumen del clip de voz en Phaser (`sound.add(key, { volume })`): pasa por el maestro de Phaser (SFX_GAIN), así que se
 * divide para que la ganancia efectiva sea VOICE_BOOST × nivel de voces (1,0 en High), sin depender de la música.
 */
export function voiceClipVolume(levelGain: number): number {
  const g = Number.isFinite(levelGain) ? Math.max(0, levelGain) : 1;
  return Math.round((VOICE_BOOST * g / SFX_GAIN) * 1000) / 1000;
}

/** Ganancia efectiva de la voz a la salida (antes del limitador) */
export function voiceEffectiveGain(levelGain: number): number {
  return voiceClipVolume(levelGain) * SFX_GAIN;
}

/**
 * Sonoridad estimada (LUFS) de una categoría a la salida, sin limitador: fichero + ganancias en dB. Para la tabla del
 * doc y para comprobar en los tests que la música bajo la voz queda 8–10 dB por debajo.
 */
export function outputLufs(fileLufs: number, ...gains: number[]): number {
  return Math.round((fileLufs + gains.reduce((s, g) => s + toDb(g), 0)) * 10) / 10;
}

/**
 * Engancha el limitador maestro: el maestro de Phaser (masterVolumeNode → destino) pasa a ir por él, y devuelve el nodo
 * para que MusicManager conecte su salida. Si Phaser no expone sus nodos (audio HTML5), devuelve null y todo sigue como
 * estaba. Se crea una vez por contexto.
 */
const limiters = new WeakMap<BaseAudioContext, DynamicsCompressorNode>();
export function masterLimiter(ctx: BaseAudioContext, phaserMaster?: AudioNode | null): DynamicsCompressorNode | null {
  try {
    let lim = limiters.get(ctx);
    if (!lim) {
      lim = ctx.createDynamicsCompressor();
      lim.threshold.value = MASTER_LIMIT.threshold;
      lim.knee.value = MASTER_LIMIT.knee;
      lim.ratio.value = MASTER_LIMIT.ratio;
      lim.attack.value = MASTER_LIMIT.attack;
      lim.release.value = MASTER_LIMIT.release;
      lim.connect(ctx.destination);
      limiters.set(ctx, lim);
      if (phaserMaster) {
        phaserMaster.disconnect();
        phaserMaster.connect(lim);
      }
    }
    return lim;
  } catch {
    return null;
  }
}

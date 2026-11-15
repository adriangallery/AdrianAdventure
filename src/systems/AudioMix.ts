/**
 * A4.8 (plan SCUMM): mezcla por categorías. Los ficheros NO se renormalizan (2.575 mp3 de voz con hash en el lock): se
 * compensa con ganancia en el motor. Medidas (ffmpeg loudnorm/ebur128) y cuentas en docs/progreso/A4.8.md.
 *
 *   voz      ≈ −25,6 LUFS (mediana de 30 clips, pico real −4,8 dBTP como mucho) → VOICE_BOOST (+11 dB) → ≈ −15/−16 LUFS
 *   música   ≈ −14,5 LUFS (pistas A4.5/A8.1) × High 0,9 (−0,9 dB) → ≈ −15,4; bajo la voz × DUCK_LEVEL 0,35 (−9,1 dB) → ≈ −24,5
 *   efectos  ≈ −12/−15 LUFS momentáneo × 0,7 (por defecto de SfxPlayer) × SFX_GAIN (+6 dB) → al nivel de la voz
 *            (los pasos siguen a la mitad que eligió Adrián: SFX_GAIN es el volumen maestro de Phaser y sube a todos igual)
 *
 * Contra el clipping, todo (Phaser: voces, efectos, stingers; MusicManager: música y ambiente) sale por la cadena maestra
 * antes del altavoz (A4.8b, porque el compresor solo dejaba pasar picos de +0,1 dBFS: no es un limitador de pared y
 * Chrome le suma ganancia de compensación automática):
 *   DynamicsCompressor (umbral MASTER_LIMIT_DB, ratio 20, ataque 1 ms) → recorte de salida MASTER_TRIM_DB →
 *   WaveShaper de recorte suave (lineal hasta SOFT_CLIP.knee, nunca pasa de SOFT_CLIP.ceiling) → destino.
 * Sin imports: lo puro se prueba en Node (tests/audio-mix.test.mjs).
 */

/** Ganancia extra de las voces (+11 dB): de ≈ −25,6 LUFS a ≈ −15/−16 LUFS tras el limitador */
export const VOICE_BOOST = 3.55;
/** Volumen maestro de Phaser (efectos, stingers, interfaz y voces): +6 dB */
export const SFX_GAIN = 2;
/** Compresor maestro: umbral (dBFS), ratio, ataque y relajación (s). A4.8b: −3 → −6 dB y ataque 2 → 1 ms */
export const MASTER_LIMIT_DB = -6;
export const MASTER_LIMIT = { threshold: MASTER_LIMIT_DB, knee: 0, ratio: 20, attack: 0.001, release: 0.1 } as const;
/** A4.8b: ganancia detrás del compresor (dB), que se come la compensación automática de Chrome (≈ +3,4 dB con −6/20) */
export const MASTER_TRIM_DB = -1.5;
/**
 * A4.8b: red de seguridad (amplitud lineal): por debajo de `knee` la señal pasa intacta; por encima se curva (tanh) hacia
 * `ceiling` sin llegar nunca. ceiling −2 dBFS deja margen al pico real entre muestras y al códec de la grabación.
 */
export const SOFT_CLIP = { knee: 0.5, ceiling: 0.794, points: 4097 } as const;

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
 * Curva del WaveShaper (entrada −1…1 → salida): identidad hasta `knee` y después `knee + (ceiling−knee)·tanh(...)`,
 * simétrica, continua y con pendiente 1 en el codo. Fuera de −1…1 el WaveShaper usa el extremo: nunca pasa de `ceiling`.
 */
export function softClipCurve(points: number = SOFT_CLIP.points, knee: number = SOFT_CLIP.knee, ceiling: number = SOFT_CLIP.ceiling) {
  const n = Math.max(3, Math.floor(points));
  const curve = new Float32Array(n);
  const room = Math.max(1e-6, ceiling - knee);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(x) * Math.min(y, ceiling);
  }
  return curve;
}

/** Cadena maestra: `input` es donde se conecta todo el audio del juego; `output`, el último nodo antes del altavoz */
export interface MasterChain { input: AudioNode; output: AudioNode }

/**
 * Engancha la cadena maestra (compresor → recorte → recorte suave → destino): el maestro de Phaser (masterVolumeNode →
 * destino) pasa a ir por ella, y devuelve sus extremos para que MusicManager conecte su salida y las demos graben del
 * final. Si Phaser no expone sus nodos (audio HTML5), devuelve null y todo sigue como estaba. Una vez por contexto (A4.9:
 * mismo AudioContext, no se crea otro).
 */
const chains = new WeakMap<BaseAudioContext, MasterChain>();
export function masterLimiter(ctx: BaseAudioContext, phaserMaster?: AudioNode | null): MasterChain | null {
  try {
    let chain = chains.get(ctx);
    if (!chain) {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = MASTER_LIMIT.threshold;
      lim.knee.value = MASTER_LIMIT.knee;
      lim.ratio.value = MASTER_LIMIT.ratio;
      lim.attack.value = MASTER_LIMIT.attack;
      lim.release.value = MASTER_LIMIT.release;
      const trim = ctx.createGain();
      trim.gain.value = fromDb(MASTER_TRIM_DB);
      lim.connect(trim);
      let out: AudioNode = trim;
      try {
        const clip = ctx.createWaveShaper();
        clip.curve = softClipCurve();
        clip.oversample = 'none';
        trim.connect(clip);
        out = clip;
      } catch { /* sin WaveShaper: compresor + recorte */ }
      out.connect(ctx.destination);
      chain = { input: lim, output: out };
      chains.set(ctx, chain);
      if (phaserMaster) {
        phaserMaster.disconnect();
        phaserMaster.connect(lim);
      }
    }
    return chain;
  } catch {
    return null;
  }
}

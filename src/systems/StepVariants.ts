/**
 * A4.7 (plan SCUMM): tres propuestas de pasos para que Adrián elija, con `?steps=a|b|c` (también en producción).
 * Sin parámetro suenan los de A4.4 (Footsteps.ts, a mitad de volumen). Lógica pura, sin Phaser
 * (tests/step-variants.test.mjs); la usan GameScene y scripts/audio/demo-steps.mjs (los clips de muestra), así que
 * lo que se oye en el clip es exactamente lo que elige el juego.
 *
 *   a «clásica»   golpe sordo y corto, casi sin agudos (aventura clásica)
 *   b «cartoon»   pat-pat gomoso y blandito; de vez en cuando un chirrido de zapatilla o un «boing»
 *   c «discreta»  toques muy bajos y cortos, solo en madera, metal, grava y baldosa (muda en moqueta, césped, cemento)
 *
 * Ficheros: assets/audio/steps/<variante>/<superficie>_<n>.mp3 (scripts/audio/make-steps.mjs), clave de Phaser
 * `step<variante>_<superficie>_<n>`. Solo se descargan si se pide la variante y el sonido está activado (A1.5).
 *
 * Cada pisada: muestra al azar sin repetir la última de esa superficie, velocidad (tono) ±rateJitter, volumen
 * ±volJitter y un retraso de 0..delayJitterMs para que no suene a metrónomo (muy por debajo de los 100 ms de un
 * fotograma del andar: no se desincroniza del pie). Con `?qa=1` la semilla es fija (QA_STEP_SEED).
 */

export type StepVariant = 'a' | 'b' | 'c';
export const STEP_VARIANTS: readonly StepVariant[] = ['a', 'b', 'c'];

export interface StepVariantSpec {
  /** Nombre para la nota y la pregunta a Adrián */
  label: string;
  /** Volumen base (antes de profundidad y variación) */
  volume: number;
  /** Superficies con muestras; en las demás la variante no suena */
  surfaces: readonly string[];
  /** Muestras normales por superficie (1..samples) */
  samples: number;
  /** Muestra rara (n = samples + 1) que sale con probabilidad p, nunca dos veces seguidas */
  rare: { p: number } | null;
  /** Velocidad de reproducción 1 ± rateJitter (cambia tono y duración a la vez) */
  rateJitter: number;
  /** Volumen × (1 ± volJitter) */
  volJitter: number;
  /** Retraso al azar 0..delayJitterMs */
  delayJitterMs: number;
}

const ALL_SURFACES = ['wood', 'gravel', 'concrete', 'tile', 'metal', 'carpet', 'grass'] as const;

export const STEP_VARIANT_SPECS: Record<StepVariant, StepVariantSpec> = {
  a: { label: 'clásica', volume: 0.24, surfaces: ALL_SURFACES, samples: 4, rare: null, rateJitter: 0.06, volJitter: 0.15, delayJitterMs: 18 },
  b: { label: 'cartoon', volume: 0.22, surfaces: ALL_SURFACES, samples: 4, rare: { p: 0.08 }, rateJitter: 0.08, volJitter: 0.15, delayJitterMs: 22 },
  c: { label: 'discreta', volume: 0.11, surfaces: ['wood', 'metal', 'gravel', 'tile'], samples: 4, rare: null, rateJitter: 0.06, volJitter: 0.15, delayJitterMs: 15 },
};

/** Semilla fija con ?qa=1 (tests, demos y walkthrough repetibles) */
export const QA_STEP_SEED = 0x57ff;

/** `?steps=a|b|c` (mayúsculas o minúsculas); cualquier otra cosa = los pasos de siempre (null) */
export function parseStepVariant(search: string): StepVariant | null {
  const v = new URLSearchParams(search).get('steps')?.trim().toLowerCase();
  return v && (STEP_VARIANTS as readonly string[]).includes(v) ? (v as StepVariant) : null;
}

export const variantKey = (v: StepVariant, surface: string, n: number): string => `step${v}_${surface}_${n}`;
export const variantUrl = (v: StepVariant, surface: string, n: number): string => `assets/audio/steps/${v}/${surface}_${n}.mp3`;

/** Número de ficheros por superficie (normales + la rara) */
export const variantSampleCount = (v: StepVariant): number => STEP_VARIANT_SPECS[v].samples + (STEP_VARIANT_SPECS[v].rare ? 1 : 0);

/** Ficheros de la variante para esas superficies (las que la variante no tiene se saltan) */
export function variantFiles(v: StepVariant, surfaces: Iterable<string>): Array<{ key: string; url: string }> {
  const spec = STEP_VARIANT_SPECS[v];
  const out: Array<{ key: string; url: string }> = [];
  const seen = new Set<string>();
  for (const s of surfaces) {
    if (seen.has(s) || !spec.surfaces.includes(s)) continue;
    seen.add(s);
    for (let n = 1; n <= variantSampleCount(v); n++) out.push({ key: variantKey(v, s, n), url: variantUrl(v, s, n) });
  }
  return out;
}

/** PRNG determinista (mulberry32, el mismo que PlayerAnim y NpcLife) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla del elector: fija con ?qa=1; si no, `random` (0-1) */
export function stepSeed(qa: boolean, random = 0): number {
  return qa ? QA_STEP_SEED : Math.floor(random * 0x7fffffff) >>> 0;
}

export interface VariantStep {
  key: string;
  /** Índice de la muestra (1..samples, o samples + 1 la rara) */
  n: number;
  rate: number;
  volume: number;
  delayMs: number;
}

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/** Elige cada pisada de una variante: muestra sin repetir la última (por superficie), tono, volumen y retraso */
export class StepPicker {
  readonly variant: StepVariant;
  private rng: () => number;
  private last = new Map<string, number>();

  constructor(variant: StepVariant, seed: number) {
    this.variant = variant;
    this.rng = mulberry32(seed);
  }

  /** La pisada que toca en `surface` (null = esta variante no suena ahí). `depth` como en Footsteps.stepSound */
  next(surface: string, depth = 1): VariantStep | null {
    const spec = STEP_VARIANT_SPECS[this.variant];
    if (!spec.surfaces.includes(surface)) return null;
    const last = this.last.get(surface) ?? 0;
    const rareN = spec.samples + 1;
    let n: number;
    if (spec.rare && last !== rareN && this.rng() < spec.rare.p) {
      n = rareN;
    } else {
      // 1..samples sin la última: se elige entre samples-1 huecos y se salta la última
      const pool = last >= 1 && last <= spec.samples ? spec.samples - 1 : spec.samples;
      n = 1 + Math.floor(this.rng() * pool);
      if (last >= 1 && last <= spec.samples && n >= last) n++;
    }
    this.last.set(surface, n);
    const rate = round(1 + (this.rng() * 2 - 1) * spec.rateJitter, 3);
    const far = 0.6 + 0.4 * Math.min(1, Math.max(0.2, depth));
    const volume = round(spec.volume * far * (1 + (this.rng() * 2 - 1) * spec.volJitter), 3);
    const delayMs = Math.round(this.rng() * spec.delayJitterMs);
    return { key: variantKey(this.variant, surface, n), n, rate, volume, delayMs };
  }
}

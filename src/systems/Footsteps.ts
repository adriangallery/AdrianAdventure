/**
 * A4.4 (plan SCUMM): pasos según la superficie. Lógica pura, sin Phaser (tests/footsteps.test.mjs). `Player` lleva
 * la cuenta de la distancia andada en píxeles de arte y avisa de cada paso; GameScene mira sobre qué superficie
 * están los pies (`audio.footstep` de la escena o un rectángulo de `audio.surfaces`) y toca `step_<superficie>_1/2`
 * alternando el pie, con un desafino al azar para que dos pasos no suenen iguales.
 *
 * scene.json:
 *   "audio": { "footstep": "gravel", "surfaces": [{ "x": 30.9, "y": 82.5, "w": 16.3, "h": 14.1, "footstep": "wood" }] }
 * Sin `footstep` (ni rectángulo que cubra los pies) no suena nada: una escena sin superficie declarada sigue muda.
 */

/**
 * Píxeles de arte entre dos pasos. A2.15: ≈ el paso del rig 2D (PlayerAnim.RIG_STEP_ART_PX = 29,6: 8 fotogramas × 100 ms = 2
 * pasos a 74 px/s), así cada pisada suena cuando el pie toca el suelo en la animación (2,5 pasos/s).
 */
export const STRIDE_ART_PX = 30;
/** Un salto mayor que esto (teletransporte, cambio de escena) no cuenta como andar */
export const MAX_STEP_JUMP_ART_PX = STRIDE_ART_PX * 3;
/** Desafino al azar (cents) y volumen de cada paso. A4.7: a la mitad (0,42 → 0,21) mientras Adrián elige otros pasos */
export const STEP_DETUNE_CENTS = 120;
export const STEP_VOLUME_A44 = 0.42;
export const STEP_VOLUME = STEP_VOLUME_A44 / 2;
/** Superficies con efectos generados (scripts/audio/sfx-recipes.mjs) */
export const SURFACES = ['wood', 'gravel', 'concrete', 'tile', 'metal', 'carpet', 'grass'] as const;

export interface SurfaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
  footstep: string;
}

export interface FootstepAudioConfig {
  footstep?: string | null;
  surfaces?: SurfaceRect[];
}

/** Superficie bajo los pies (en %): el primer rectángulo de `surfaces` que los contiene, si no `footstep`; null = muda */
export function surfaceAt(audio: FootstepAudioConfig | null | undefined, x: number, y: number): string | null {
  if (!audio) return null;
  for (const r of audio.surfaces ?? []) {
    if (typeof r?.footstep !== 'string') continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.footstep;
  }
  return typeof audio.footstep === 'string' && audio.footstep ? audio.footstep : null;
}

/**
 * A8.4: variantes por superficie (`step_<superficie>_1..STEP_VARIANTS`, ElevenLabs: art/sfx/sfx.json). Pie izquierdo =
 * impares, derecho = pares; `pick` elige la pareja (0 = _1/_2, 1 = _3/_4…). Con 2 variantes, como en A4.4.
 */
export const STEP_VARIANTS = 2;
export const stepKey = (surface: string, foot: 0 | 1, pick = 0): string => `step_${surface}_${foot + 1 + 2 * pick}`;

/**
 * Cuenta la distancia andada y dice cuándo toca un paso. El primer paso suena al echar a andar (tras media
 * zancada, para que un toque corto no dispare dos) y luego cada STRIDE_ART_PX; alterna el pie.
 */
export class FootstepTracker {
  private acc = STRIDE_ART_PX / 2;
  private foot: 0 | 1 = 0;
  private steps = 0;

  /** Avanza `distArtPx` píxeles de arte; devuelve el pie del paso que toca (0 | 1) o null. */
  advance(distArtPx: number): 0 | 1 | null {
    if (!(distArtPx > 0)) return null;
    if (distArtPx > MAX_STEP_JUMP_ART_PX) { this.reset(); return null; }
    this.acc += distArtPx;
    if (this.acc < STRIDE_ART_PX) return null;
    this.acc -= STRIDE_ART_PX;
    const foot = this.foot;
    this.foot = foot === 0 ? 1 : 0;
    this.steps++;
    return foot;
  }

  /** Al pararse: el siguiente arranque vuelve a sonar tras media zancada */
  reset(): void {
    this.acc = STRIDE_ART_PX / 2;
  }

  count(): number {
    return this.steps;
  }
}

/** Parámetros del efecto de un paso: clave, desafino (cents) y volumen; `random` y `randomPick` en [0, 1) */
export function stepSound(surface: string, foot: 0 | 1, random: number, depth = 1, randomPick = 0): { key: string; detune: number; volume: number } {
  const pairs = Math.max(1, Math.floor(STEP_VARIANTS / 2));
  const pick = Math.min(pairs - 1, Math.max(0, Math.floor(randomPick * pairs)));
  const detune = Math.round((random * 2 - 1) * STEP_DETUNE_CENTS);
  // Más lejos (escala por profundidad < 1) suena un poco más bajo
  const volume = Math.round(STEP_VOLUME * (0.6 + 0.4 * Math.min(1, Math.max(0.2, depth))) * 100) / 100;
  return { key: stepKey(surface, foot, pick), detune, volume };
}

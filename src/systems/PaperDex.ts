/**
 * A2.16 (plan SCUMM): PRUEBA de estilo «Dex de papel», detrás de `?dex=papel` (y `&papel=suave|media|tope`, por
 * defecto media). Funciona también en producción, como `?steps=` (A4.7). Sin el parámetro el juego es el de A2.15.
 *
 * Lógica pura, sin Phaser (tests/paper-dex.test.mjs, en `npm run test:engine`); Player solo aplica lo que dice.
 *  - Mismo sprite y piezas del rig (art/dex2d/papel.py → assets/sprites/player/dexpapel, claves `dexpapel_*`).
 *  - Poses a saltos: andar de 4 poses × 150 ms con el pie de apoyo quieto (paso de 22,2 px a 74 px/s), gestos de
 *    3 poses, brazos al hablar que cambian de pose cada 400-900 ms (según intensidad) a destiempo de la mandíbula.
 *  - Mandíbula (habla «de recortable»): pieza aparte que baja con el volumen de la voz (VoiceSystem.level) en
 *    escalones de JAW_STEP_MS, a veces descolocada 1 px de lado o de más; sin señal, cadencia irregular.
 */
// Sin imports (se prueba en Node con strip-types): los datos generados (src/data/dexPapelFrames.ts) entran por
// parámetro y los tests comprueban que las constantes de aquí cuadran con ellos.
/** Lo que interesa de cada animación de src/data/dexPapelFrames.ts */
export interface PaperAnimData { frames: number; jaw?: ReadonlyArray<readonly [number, number]> }
export type PaperAnims = Record<string, PaperAnimData>;
/** Andar de perfil: 4 poses × 150 ms = 2 pasos (art/dex2d/papel.py WALK_POSES / WALK_POSE_MS) */
export const DEXPAPEL_WALK_POSES = 4;
export const DEXPAPEL_WALK_POSE_MS = 150;
/** Velocidad de WalkMotion (A2.12) en px de arte/s */
export const PAPER_WALK_ART_PX_PER_S = 74;
/** Paso (medio ciclo) en px de arte: 74 × 0,6 / 2 = 22,2 */
export const PAPER_STEP_ART_PX = (PAPER_WALK_ART_PX_PER_S * DEXPAPEL_WALK_POSES * DEXPAPEL_WALK_POSE_MS) / 1000 / 2;

export type PaperIntensity = 'suave' | 'media' | 'tope';
export const PAPER_INTENSITIES: readonly PaperIntensity[] = ['suave', 'media', 'tope'];
export const PAPER_PREFIX = 'dexpapel';

export interface PaperSpec {
  /** Bajada máxima de la mandíbula (px de arte) con la voz a tope */
  jawMax: number;
  /** Probabilidad, en cada escalón con la boca abierta, de que la mandíbula se descoloque 1 px de lado */
  jawSide: number;
  /** Probabilidad de 1 px de más hacia abajo (desajuste vertical cómico) */
  jawExtra: number;
  /** Cambio de pose de brazos al hablar: cada armMin..armMax ms */
  armMinMs: number;
  armMaxMs: number;
  /** Poses de brazos que usa (índices de talk_front; de perfil se recortan a las que hay) */
  armPoses: readonly number[];
}

export const PAPER_SPECS: Record<PaperIntensity, PaperSpec> = {
  suave: { jawMax: 2, jawSide: 0, jawExtra: 0, armMinMs: 700, armMaxMs: 900, armPoses: [0, 1] },
  media: { jawMax: 3, jawSide: 0.15, jawExtra: 0.1, armMinMs: 550, armMaxMs: 850, armPoses: [0, 1, 2, 3] },
  tope: { jawMax: 4, jawSide: 0.35, jawExtra: 0.25, armMinMs: 400, armMaxMs: 650, armPoses: [0, 1, 2, 3, 4] },
};

/** La mandíbula cambia a saltos: como mucho cada JAW_STEP_MS (papel: nada de interpolar) */
export const JAW_STEP_MS = 70;
/** Nivel RMS que abre (histéresis con el de cerrar, como NpcLife) y el que la baja del todo */
export const JAW_LEVEL_OPEN = 0.02;
export const JAW_LEVEL_CLOSE = 0.01;
export const JAW_LEVEL_FULL = 0.15;
/** Sin señal: abierta/cerrada en tramos de JAW_FREE_MIN..MAX ms al azar */
export const JAW_FREE_MIN_MS = 70;
export const JAW_FREE_MAX_MS = 210;
/** Gesto de coger con papel: 3 poses del pick del rig (anticipación, estirón, vuelta), sin la intermedia */
export const PAPER_PICK_FRAMES: readonly number[] = [0, 2, 3];
/** Andar arriba/abajo: 4 de los 6 fotogramas del rig, 200 ms cada uno (mismo ciclo de 800 ms = 2 pasos) */
export const PAPER_VWALK_FRAMES: readonly number[] = [0, 1, 3, 4];
export const PAPER_VWALK_POSE_MS = 200;

export interface PaperMode {
  intensity: PaperIntensity;
}

/** `?dex=papel` (+ `&papel=suave|media|tope`, por defecto media). Cualquier otra cosa: null (el Dex de siempre) */
export function parsePaperMode(search: string): PaperMode | null {
  const q = new URLSearchParams(search);
  if (q.get('dex')?.trim().toLowerCase() !== 'papel') return null;
  const v = q.get('papel')?.trim().toLowerCase();
  const intensity = v && (PAPER_INTENSITIES as readonly string[]).includes(v) ? (v as PaperIntensity) : 'media';
  return { intensity };
}

export const paperKey = (anim: string, i: number): string => `${PAPER_PREFIX}_${anim}_${i}`;
export const paperJawKey = (view: 'front' | 'r' | 'l'): string => `${PAPER_PREFIX}_jaw_${view}`;

/** Ficheros a cargar (solo si se pide el modo papel) */
export function paperFiles(anims: PaperAnims): Array<{ key: string; url: string }> {
  const out: Array<{ key: string; url: string }> = [];
  for (const [anim, m] of Object.entries(anims)) {
    for (let i = 0; i < m.frames; i++) out.push({ key: paperKey(anim, i), url: `assets/sprites/player/dexpapel/${anim}_${i}.png` });
  }
  for (const v of ['front', 'r', 'l'] as const) out.push({ key: paperJawKey(v), url: `assets/sprites/player/dexpapel/jaw_${v}.png` });
  return out;
}

/** Pose de andar de perfil (a saltos, 150 ms) */
export function paperWalkKey(dir: 'left' | 'right', intensity: PaperIntensity, tMs: number): string {
  const i = Math.floor(Math.max(0, tMs) / DEXPAPEL_WALK_POSE_MS) % DEXPAPEL_WALK_POSES;
  return paperKey(`walk_${dir === 'right' ? 'r' : 'l'}_${intensity}`, i);
}

/** Andar arriba/abajo con papel: fotograma del rig de A2.15 (`dex2d_walk_up|down_<n>`) sostenido 200 ms */
export function paperVWalkIndex(tMs: number): number {
  return PAPER_VWALK_FRAMES[Math.floor(Math.max(0, tMs) / PAPER_VWALK_POSE_MS) % PAPER_VWALK_FRAMES.length];
}

/** Fotograma del pick del rig para el gesto (3 poses iguales en `durMs`) */
export function paperPickIndex(tMs: number, durMs: number): number {
  const n = PAPER_PICK_FRAMES.length;
  return PAPER_PICK_FRAMES[Math.min(n - 1, Math.max(0, Math.floor((tMs / durMs) * n)))];
}

/**
 * Deriva del pie de apoyo respecto al suelo en cada medio paso (px de arte; 0 = no patina): entre dos poses del
 * mismo apoyo la cadera avanza velocidad × ms y el pie, relativo a la cadera, tiene que retroceder lo mismo.
 */
export function stanceSlip(stanceX: readonly number[], speedArtPxPerS = PAPER_WALK_ART_PX_PER_S): number[] {
  const adv = (speedArtPxPerS * DEXPAPEL_WALK_POSE_MS) / 1000;
  const out: number[] = [];
  for (let i = 0; i + 1 < stanceX.length; i += 2) out.push(stanceX[i + 1] - stanceX[i] + adv);
  return out;
}

/** Bajada de la mandíbula (px enteros 0..jawMax) para un nivel RMS: escalones, nunca intermedios */
export function jawDropForLevel(level: number, jawMax: number): number {
  if (!Number.isFinite(level) || level < JAW_LEVEL_OPEN) return 0;
  const k = Math.min(1, (level - JAW_LEVEL_OPEN) / (JAW_LEVEL_FULL - JAW_LEVEL_OPEN));
  return Math.max(1, Math.min(jawMax, Math.ceil(k * jawMax)));
}

/** PRNG determinista (mulberry32, el de PlayerAnim) */
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
export const QA_PAPER_SEED = 0x9a9e;

export interface JawState { dx: number; dy: number }

/**
 * Mandíbula: cada JAW_STEP_MS mira el nivel. Con señal, la bajada sale del volumen (con histéresis abre/cierra);
 * sin señal (null: HTML5, contexto suspendido, sin clip), abre y cierra en tramos irregulares. Al abrir se puede
 * descolocar 1 px de lado (jawSide) o 1 px de más (jawExtra); cerrada siempre vuelve a su sitio.
 */
export class JawDriver {
  private rng: () => number;
  private spec: PaperSpec;
  private t = 0;
  private nextAt = 0;
  private open = false;
  private freeUntil = 0;
  private freeOpen = false;
  state: JawState = { dx: 0, dy: 0 };

  constructor(spec: PaperSpec, seed: number) {
    this.spec = spec;
    this.rng = mulberry32(seed);
  }

  reset(): void {
    this.t = 0;
    this.nextAt = 0;
    this.open = false;
    this.freeUntil = 0;
    this.freeOpen = false;
    this.state = { dx: 0, dy: 0 };
  }

  update(dtMs: number, level: number | null): JawState {
    this.t += dtMs;
    if (this.t < this.nextAt) return this.state;
    this.nextAt = this.t + JAW_STEP_MS;
    let dy = 0;
    if (level !== null) {
      if (level >= JAW_LEVEL_OPEN) this.open = true;
      else if (level < JAW_LEVEL_CLOSE) this.open = false;
      dy = this.open ? jawDropForLevel(Math.max(level, JAW_LEVEL_OPEN), this.spec.jawMax) : 0;
    } else {
      if (this.t >= this.freeUntil) {
        this.freeOpen = !this.freeOpen;
        this.freeUntil = this.t + JAW_FREE_MIN_MS + this.rng() * (JAW_FREE_MAX_MS - JAW_FREE_MIN_MS);
      }
      dy = this.freeOpen ? 1 + Math.floor(this.rng() * this.spec.jawMax) : 0;
    }
    let dx = 0;
    if (dy > 0) {
      if (this.rng() < this.spec.jawSide) dx = this.rng() < 0.5 ? -1 : 1;
      if (dy < this.spec.jawMax + 1 && this.rng() < this.spec.jawExtra) dy += 1;
    }
    this.state = { dx, dy };
    return this.state;
  }
}

/** Brazos al hablar: pose nueva (distinta de la anterior) cada armMin..armMax ms, con su propio reloj */
export class ArmPoser {
  private rng: () => number;
  private spec: PaperSpec;
  private t = 0;
  private nextAt = 0;
  pose = 0;

  constructor(spec: PaperSpec, seed: number) {
    this.spec = spec;
    this.rng = mulberry32(seed);
  }

  reset(): void {
    this.t = 0;
    this.nextAt = 0;
    this.pose = 0;
  }

  /** `count` = poses que tiene la vista (5 de frente, 4 de perfil) */
  update(dtMs: number, count: number): number {
    this.t += dtMs;
    if (this.t < this.nextAt) return this.pose;
    const pool = this.spec.armPoses.filter((p) => p < count);
    const choices = pool.length > 1 ? pool.filter((p) => p !== this.pose) : pool;
    // la primera pose al empezar a hablar ya gesticula (no la de reposo)
    const first = this.nextAt === 0 && choices.length > 1 ? choices.filter((p) => p !== 0) : choices;
    this.pose = first[Math.min(first.length - 1, Math.floor(this.rng() * first.length))] ?? 0;
    this.nextAt = this.t + this.spec.armMinMs + this.rng() * (this.spec.armMaxMs - this.spec.armMinMs);
    return this.pose;
  }
}

/** Animación de hablar y su fotograma de mandíbula: vista según hacia dónde mira (de espaldas no hay) */
export function paperTalkAnim(facing: string): { anim: string; jaw: 'front' | 'r' | 'l' } | null {
  if (facing === 'front') return { anim: 'talk_front', jaw: 'front' };
  if (facing === 'right') return { anim: 'talk_r', jaw: 'r' };
  if (facing === 'left') return { anim: 'talk_l', jaw: 'l' };
  return null;
}

/** Dónde va la mandíbula (px de arte, esquina superior izquierda en el lienzo del fotograma) */
export function paperJawAnchor(anims: PaperAnims, anim: string, i: number): readonly [number, number] | null {
  return anims[anim]?.jaw?.[i] ?? null;
}

export function paperTalkFrames(anims: PaperAnims, anim: string): number {
  return anims[anim]?.frames ?? 0;
}

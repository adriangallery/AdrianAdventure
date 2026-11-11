// A4.1 (plan SCUMM): animación del protagonista (andar arriba y abajo, hablar, coger, tics de reposo, disfraz de mono).
// Lógica pura, sin Phaser ni imports (se prueba en Node: tests/player-anim.test.mjs, en `npm run test:engine`).
//
// Player.ts solo aplica lo que dice este módulo: una textura (o null = la de su orientación), un ángulo en grados
// (giro sobre los pies: el origen del sprite está en ellos) y una elevación en píxeles de arte (de puntillas). Nada de
// aquí toca la escala: A2.8 la deja entera (×3 en 1280x720) y un squash la haría fraccionaria; el balanceo, el cabeceo
// y el gesto son giros y elevaciones, y al parar Player vuelve a ángulo 0, elevación 0 y su escala base.
//
// Sin arte nuevo (D2): se usan los sprites que ya hay en assets/sprites/player. Claves de Phaser (PreloadScene):
//   <p>_idle1..4 · <p>_walk_left_0..2 / <p>_walk_right_0..2 (espejadas: walk_left = va hacia la DERECHA de la pantalla)
//   <p>_left / <p>_right (perfil, espejadas como las de andar) · player_front_left / player_front_right (de frente)
//   player_back_left (Back-Left.png: de espaldas girado a la derecha) / player_back_right
// <p> = 'player' o 'ape' (disfraz de mono: solo idle y andar de perfil; sin Front ni Back).

export type AnimFacing = 'left' | 'right' | 'front' | 'back';
/** Dirección del movimiento: left/right en horizontal, up (se aleja: de espaldas) y down (se acerca: de frente) */
export type AnimDir = 'left' | 'right' | 'up' | 'down';
export type Side = 'left' | 'right';
export type HasTexture = (key: string) => boolean;

/** Qué pinta Player en este frame. `texture` null = la de su orientación (quieta o el idle animado). */
export interface AnimPose {
  texture: string | null;
  /** Grados, positivo = horario (la cabeza va a la derecha) */
  angle: number;
  /** Píxeles de arte hacia arriba (se multiplican por la escala y se redondean a píxeles de pantalla) */
  lift: number;
}

// ── Andar ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Pasa a vertical cuando |dy| > 1,5·|dx| (en píxeles de mundo)… */
export const VERTICAL_ENTER = 1.5;
/** …y vuelve a horizontal solo cuando |dy| < 1·|dx|: entre las dos no cambia (histéresis, sin parpadeo en diagonal) */
export const VERTICAL_EXIT = 1;
/** Fotograma de andar de perfil (3 fotogramas) */
export const WALK_FRAME_MS = 180;
/** Paso de frente o de espaldas (alterna Left/Right) */
export const STEP_MS = 220;
/** Balanceo al andar en vertical: ±2,5° sobre los pies, un vaivén cada dos pasos */
export const SWAY_DEG = 2.5;

// ── Hablar ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Cabeceo mientras el jugador tiene texto en pantalla: 7 por segundo */
export const TALK_HZ = 7;
export const TALK_NOD_DEG = 1.5;
/** De frente alterna manos (Idle-1 / Front-*) cada 2 cabeceos (3,5 Hz) */
export const TALK_FRAME_BEATS = 2;

// ── Coger / usar ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Gesto al actuar sobre un hotspot: no retrasa el script (va a la vez que el primer op) y dura menos de 400 ms */
export const GESTURE_MS = 320;
export const GESTURE_LEAN_DEG = 6;
/** De espaldas (alcanzar algo colgado): de puntillas 2 píxeles de arte */
export const GESTURE_LIFT_ART = 2;
export const GESTURE_VERBS: readonly string[] = ['PICK', 'USE', 'OPEN', 'CLOSE', 'PUSH', 'PULL', 'GIVE'];

// ── Reposo ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Primer tic tras 6 s quieto con la escena libre; luego cada 3-6 s */
export const IDLE_TIC_AFTER_MS = 6000;
export const IDLE_TIC_GAP_MIN_MS = 3000;
export const IDLE_TIC_GAP_MAX_MS = 6000;
export const IDLE_TIC_LOOK_MS = 1200;
export const IDLE_TIC_TAP_MS = 900;
export const IDLE_TIC_TAP_FRAME_MS = 150;
/** Semilla fija con ?qa=1: los tics salen siempre en el mismo orden (demos y walkthrough repetibles) */
export const QA_IDLE_SEED = 0x41a1;

export type IdleTicKind = 'lookSide' | 'lookCamera' | 'tapFoot' | 'mania';
export interface IdleTic {
  kind: IdleTicKind;
  ms: number;
  /** lookSide: hacia qué lado de la pantalla mira */
  side: Side;
  /** kind 'mania' (A2.14, Dex 3D de frente): cuál suena */
  mania?: Mania3d;
}

// ── A2.14: Dex en 3D (sprites pre-renderizados con Blender, art/dex3d) ─────────────────────────────────────────────
// Claves (PreloadScene, assets/sprites/player3d): player3d_<anim>_<dir>_<i>, dir = down | up | left | right (hacia
// dónde mira en la PANTALLA, sin espejar). Si existen, mandan sobre los fotogramas de siempre; el mono no tiene.
export const DEX3D = 'player3d';
/** Alto de Dex en reposo en píxeles de arte (el de siempre, A2.11): en los fotogramas 3D, la fila de los pies */
export const DEX_ART_HEIGHT = 103;
/** Ciclo de andar: 8 fotogramas × 67,5 ms = 540 ms = 2 zancadas de 20 px de arte a 74 px/s (WalkMotion, Footsteps) */
export const WALK3D_FRAMES = 8;
export const WALK3D_FRAME_MS = 67.5;
/** Hablar: 8 fotogramas a 10 fps (boca y cabeza) */
export const TALK3D_FRAMES = 8;
export const TALK3D_FRAME_MS = 100;
/** Gestos: 5 fotogramas repartidos en GESTURE_MS (sale de reposo, llega y vuelve) */
export const GESTURE3D_FRAMES = 5;
export type Gesture3d = 'pick_low' | 'pick_mid' | 'pick_high' | 'use' | 'push' | 'pull' | 'give';
export const GESTURES3D: readonly Gesture3d[] = ['pick_low', 'pick_mid', 'pick_high', 'use', 'push', 'pull', 'give'];
export type Dir3d = 'down' | 'up' | 'left' | 'right';

/**
 * A2.14 «con gracia»: manías de reposo de Dex 3D (solo de frente, `player3d_<manía>_down_<i>`). Las elige IdleTicker
 * cuando mira de frente y existen sus fotogramas; alternan sin repetir la anterior y se cortan al andar, hablar o hacer
 * un gesto (lo mismo que los tics de A4.1).
 */
export type Mania3d = 'idle_scratch' | 'idle_glasses' | 'idle_yawn' | 'idle_tap' | 'idle_rock';
export const MANIAS3D: Readonly<Record<Mania3d, { frames: number; fps: number }>> = {
  idle_scratch: { frames: 10, fps: 9 }, // rascarse la cabeza
  idle_glasses: { frames: 10, fps: 9 }, // subirse las gafas con un dedo
  idle_yawn: { frames: 12, fps: 9 }, // bostezar estirándose
  idle_tap: { frames: 12, fps: 9 }, // brazos cruzados y golpecitos con el pie
  idle_rock: { frames: 10, fps: 9 }, // manos a la espalda, balancearse sobre puntas y talones
};
export const MANIA_LIST = Object.keys(MANIAS3D) as Mania3d[];
/** De frente con manías: probabilidad de manía frente a mirar a un lado */
export const MANIA_CHANCE = 0.75;

export function maniaMs(m: Mania3d): number {
  return Math.round((MANIAS3D[m].frames * 1000) / MANIAS3D[m].fps);
}

/** «No puedo» (respuesta de fallo): encogimiento de hombros, de frente y de perfil */
export const SHRUG3D_FRAMES = 7;
export const SHRUG3D_FRAME_MS = 100;
export const SHRUG_MS = SHRUG3D_FRAMES * SHRUG3D_FRAME_MS;

export function facingDir3d(f: AnimFacing): Dir3d {
  return f === 'front' ? 'down' : f === 'back' ? 'up' : f;
}

/**
 * Qué gesto 3D toca para un verbo. `rel` = altura del objetivo sobre los pies en fracciones del alto de Dex (0 = suelo,
 * 1 = cabeza; null = no se sabe): coger bajo (< 0,3), a media altura o alto (> 0,8).
 */
export function gestureAnimFor(verb: string, rel: number | null): Gesture3d {
  if (verb === 'PICK') {
    if (rel !== null && rel < 0.3) return 'pick_low';
    if (rel !== null && rel > 0.8) return 'pick_high';
    return 'pick_mid';
  }
  if (verb === 'PUSH') return 'push';
  if (verb === 'PULL') return 'pull';
  if (verb === 'GIVE') return 'give';
  return 'use';
}

const REST: AnimPose = { texture: null, angle: 0, lift: 0 };
/** Pose de reposo: la textura de la orientación, ángulo 0 y sin elevación */
export function restPose(): AnimPose {
  return { ...REST };
}

export function isVertical(d: AnimDir | null): boolean {
  return d === 'up' || d === 'down';
}

/**
 * Dirección de un tramo (dx, dy en píxeles de mundo: % × ancho o alto del fondo, para que 1 % en x pese lo que mide).
 * Vertical si |dy| domina (umbral VERTICAL_ENTER) y, si ya lo era, mientras no baje de VERTICAL_EXIT. Sin movimiento,
 * la anterior.
 */
export function moveDir(dx: number, dy: number, prev: AnimDir | null): AnimDir {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-9 && ay < 1e-9) return prev ?? 'right';
  const vertical = isVertical(prev) ? ay >= VERTICAL_EXIT * ax : ay > VERTICAL_ENTER * ax;
  if (vertical) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}

/** Hacia dónde mira mientras anda (y al llegar): de espaldas al subir, de frente al bajar */
export function facingForDir(d: AnimDir): AnimFacing {
  if (d === 'up') return 'back';
  if (d === 'down') return 'front';
  return d;
}

/** Las claves de perfil y de andar están espejadas: mirar a la derecha = `_left` */
export function mirrored(side: Side): Side {
  return side === 'right' ? 'left' : 'right';
}

/** Textura quieta de una orientación (null = idle animado, de frente). La de A2.2, movida aquí. */
export function facingTexture(prefix: string, facing: AnimFacing, side: Side, has: HasTexture): string | null {
  let cands: string[] = [];
  if (facing === 'back') cands = [`${prefix}_back_${mirrored(side)}`];
  else if (facing === 'left' || facing === 'right') cands = [`${prefix}_${mirrored(facing)}`, `${prefix}_walk_${mirrored(facing)}_0`];
  return cands.find((k) => has(k)) ?? null;
}

/**
 * Andar: de perfil, los 3 fotogramas de siempre; en vertical, Front-* (baja) o Back-* (sube) alternando Left/Right
 * como paso, con balanceo SWAY_DEG·sin(π·t/STEP_MS) (un vaivén completo cada dos pasos, empieza en 0). Sin Front/Back
 * (disfraz de mono), en vertical los fotogramas de perfil del último lado, con el mismo balanceo.
 */
export function walkPose(o: { prefix: string; dir: AnimDir; side: Side; tMs: number; has: HasTexture }): AnimPose & { texture: string } {
  const t = Math.max(0, o.tMs);
  if (o.prefix === 'player' && o.has(`${DEX3D}_walk_${o.dir}_0`)) {
    return { texture: `${DEX3D}_walk_${o.dir}_${Math.floor(t / WALK3D_FRAME_MS) % WALK3D_FRAMES}`, angle: 0, lift: 0 };
  }
  const sideFrames = (side: Side) => `${o.prefix}_walk_${mirrored(side)}_${Math.floor(t / WALK_FRAME_MS) % 3}`;
  if (!isVertical(o.dir)) return { texture: sideFrames(o.dir as Side), angle: 0, lift: 0 };
  const angle = SWAY_DEG * Math.sin((Math.PI * t) / STEP_MS);
  const pair = o.dir === 'down' ? [`${o.prefix}_front_left`, `${o.prefix}_front_right`] : [`${o.prefix}_back_left`, `${o.prefix}_back_right`];
  if (pair.every((k) => o.has(k))) return { texture: pair[Math.floor(t / STEP_MS) % 2], angle, lift: 0 };
  return { texture: sideFrames(o.side), angle, lift: 0 };
}

/**
 * Hablar (texto del jugador en pantalla): cabeceo a TALK_HZ. De perfil se inclina hacia donde mira y vuelve
 * (|sin|); de frente o de espaldas, ± a los lados. De frente además alterna Idle-1 / Front-Left / Idle-1 / Front-Right
 * (manos) cada TALK_FRAME_BEATS cabeceos; el mono, Ape-Idle-1 / Ape-Idle-3 (cabeza). Con una pose fija de cinemática
 * (`posed`) solo cabecea.
 */
export function talkPose(o: { prefix: string; facing: AnimFacing; tMs: number; has: HasTexture; posed?: boolean }): AnimPose {
  const k3 = `${DEX3D}_talk_${facingDir3d(o.facing)}_`;
  if (o.prefix === 'player' && !o.posed && o.has(`${k3}0`)) {
    return { texture: `${k3}${Math.floor(Math.max(0, o.tMs) / TALK3D_FRAME_MS) % TALK3D_FRAMES}`, angle: 0, lift: 0 };
  }
  const beats = (Math.max(0, o.tMs) / 1000) * TALK_HZ;
  const wave = Math.sin(Math.PI * beats);
  const angle = o.facing === 'left' || o.facing === 'right'
    ? (o.facing === 'right' ? 1 : -1) * TALK_NOD_DEG * Math.abs(wave)
    : TALK_NOD_DEG * wave;
  let texture: string | null = null;
  if (!o.posed && o.facing === 'front') {
    const p = o.prefix;
    const hands = [`${p}_idle1`, `${p}_front_left`, `${p}_idle1`, `${p}_front_right`];
    const head = [`${p}_idle1`, `${p}_idle3`];
    const frames = hands.every((k) => o.has(k)) ? hands : head.every((k) => o.has(k)) ? head : [];
    if (frames.length) texture = frames[Math.floor(beats / TALK_FRAME_BEATS) % frames.length];
  }
  return { texture, angle, lift: 0 };
}

export function wantsGesture(verb: string): boolean {
  return GESTURE_VERBS.includes(verb);
}

/**
 * Gesto de alcanzar o coger (GESTURE_MS, envolvente sin(π·t/GESTURE_MS): sale de 0 y vuelve a 0). De perfil, el
 * fotograma de andar con el brazo adelantado (walk_*_1) y se inclina hacia el objetivo; de espaldas, su Back-* de
 * puntillas (estirón hacia algo colgado); de frente, Front-* hacia el lado del objetivo, inclinado y de puntillas.
 * null cuando ha terminado.
 */
export function gesturePose(o: { prefix: string; facing: AnimFacing; side: Side; aim: Side | null; tMs: number; has: HasTexture; anim?: Gesture3d }): AnimPose | null {
  if (o.tMs >= GESTURE_MS || o.tMs < 0) return null;
  const k3 = `${DEX3D}_${o.anim ?? 'pick_mid'}_${facingDir3d(o.facing)}_`;
  if (o.prefix === 'player' && o.has(`${k3}0`)) {
    const i = Math.min(GESTURE3D_FRAMES - 1, Math.floor((o.tMs / GESTURE_MS) * GESTURE3D_FRAMES));
    return { texture: `${k3}${i}`, angle: 0, lift: 0 };
  }
  const e = Math.sin((Math.PI * o.tMs) / GESTURE_MS);
  const sign = (s: Side) => (s === 'right' ? 1 : -1);
  if (o.facing === 'left' || o.facing === 'right') {
    const reach = `${o.prefix}_walk_${mirrored(o.facing)}_1`;
    return { texture: o.has(reach) ? reach : null, angle: sign(o.facing) * GESTURE_LEAN_DEG * e, lift: 0 };
  }
  if (o.facing === 'back') {
    return { texture: null, angle: o.aim ? sign(o.aim) * 2 * e : 0, lift: GESTURE_LIFT_ART * e };
  }
  const toward = o.aim ?? o.side;
  const key = `${o.prefix}_front_${mirrored(toward)}`;
  return { texture: o.has(key) ? key : null, angle: sign(toward) * (GESTURE_LEAN_DEG / 2) * e, lift: (GESTURE_LIFT_ART / 2) * e };
}

/**
 * A2.14: encogerse de hombros («no puedo») durante SHRUG_MS con los fotogramas 3D de su orientación (de frente o de
 * perfil). null si ha terminado o no hay fotogramas (de espaldas, el mono, el tráiler): entonces no hace nada.
 */
export function shrugPose(o: { prefix: string; facing: AnimFacing; tMs: number; has: HasTexture }): AnimPose | null {
  if (o.tMs >= SHRUG_MS || o.tMs < 0) return null;
  const k = `${DEX3D}_shrug_${facingDir3d(o.facing)}_`;
  if (o.prefix !== 'player' || !o.has(`${k}0`)) return null;
  return { texture: `${k}${Math.min(SHRUG3D_FRAMES - 1, Math.floor(o.tMs / SHRUG3D_FRAME_MS))}`, angle: 0, lift: 0 };
}

/** PRNG pequeño y determinista (mulberry32): con la misma semilla, la misma secuencia */
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

/** Tics posibles según hacia dónde mira: de frente mira a un lado o mueve el pie; de perfil o de espaldas, a cámara o al otro lado */
export function idleTicKinds(facing: AnimFacing, manias = false): IdleTicKind[] {
  if (facing === 'front' && manias) return ['mania', 'lookSide'];
  return facing === 'front' ? ['lookSide', 'tapFoot'] : ['lookCamera', 'lookSide'];
}

/**
 * A2.14: con `manias` (Dex 3D de frente) casi siempre una manía (MANIA_CHANCE), distinta de la anterior (`prev`);
 * si no, mirar a un lado. Sin manías, como en A4.1.
 */
export function pickIdleTic(rng: () => number, facing: AnimFacing, side: Side, manias = false, prev: Mania3d | null = null): IdleTic {
  if (facing === 'front' && manias) {
    if (rng() < MANIA_CHANCE) {
      const pool = MANIA_LIST.filter((m) => m !== prev);
      const mania = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      return { kind: 'mania', ms: maniaMs(mania), side, mania };
    }
    return { kind: 'lookSide', ms: IDLE_TIC_LOOK_MS, side: rng() < 0.5 ? 'left' : 'right' };
  }
  const kinds = idleTicKinds(facing);
  const kind = kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))];
  const coin: Side = rng() < 0.5 ? 'left' : 'right';
  // De perfil mira al otro lado (por encima del hombro); de frente o de espaldas, a un lado al azar
  const lookTo: Side = facing === 'left' || facing === 'right' ? mirrored(facing) : coin;
  return { kind, ms: kind === 'tapFoot' ? IDLE_TIC_TAP_MS : IDLE_TIC_LOOK_MS, side: kind === 'lookSide' ? lookTo : side };
}

/**
 * Pose de un tic: `lookSide` = perfil hacia `side` (mirar al lado), `lookCamera` = Idle-1 (de frente, a cámara),
 * `tapFoot` = Idle-1 / Idle-2 (piernas) cada 150 ms con un vaivén de 1°. Solo cambia la textura (y ese grado): la
 * orientación (`facing`) no se toca, así `expect.facing` no lo ve.
 */
export function idleTicPose(tic: IdleTic, tMs: number, o: { prefix: string; has: HasTexture }): AnimPose {
  const p = o.prefix;
  const first = (keys: string[]) => keys.find((k) => o.has(k)) ?? null;
  if (tic.kind === 'mania' && tic.mania) {
    const { frames, fps } = MANIAS3D[tic.mania];
    const i = Math.min(frames - 1, Math.floor((Math.max(0, tMs) * fps) / 1000));
    return { texture: first([`${DEX3D}_${tic.mania}_down_${i}`, `${p}_idle1`]), angle: 0, lift: 0 };
  }
  if (tic.kind === 'lookSide') return { texture: first([`${p}_${mirrored(tic.side)}`, `${p}_walk_${mirrored(tic.side)}_0`]), angle: 0, lift: 0 };
  if (tic.kind === 'lookCamera') return { texture: first([`${p}_idle1`]), angle: 0, lift: 0 };
  const step = Math.floor(Math.max(0, tMs) / IDLE_TIC_TAP_FRAME_MS) % 2;
  return { texture: first([step ? `${p}_idle2` : `${p}_idle1`, `${p}_idle1`]), angle: step ? 1 : -1, lift: 0 };
}

/**
 * Calendario de tics de reposo. `update` cada frame con `free` = quieto, sin hablar, sin gesto y con la escena libre
 * (sin script, texto, diálogo ni cinemática). Cualquier cosa que no sea reposo lo reinicia: el primer tic llega
 * IDLE_TIC_AFTER_MS después. Devuelve el tic en curso y su tiempo, o null.
 */
export class IdleTicker {
  private rng: () => number;
  private still = 0;
  private nextAt = IDLE_TIC_AFTER_MS;
  private tic: IdleTic | null = null;
  private ticT = 0;
  private lastMania: Mania3d | null = null;
  /** Tics empezados desde que se creó (QA) */
  count = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /** `manias`: Dex 3D con los fotogramas de las manías (solo cuenta de frente) */
  update(dtMs: number, free: boolean, facing: AnimFacing, side: Side, manias = false): { tic: IdleTic; t: number } | null {
    if (!free) {
      this.reset();
      return null;
    }
    if (this.tic) {
      this.ticT += dtMs;
      if (this.ticT < this.tic.ms) return { tic: this.tic, t: this.ticT };
      this.tic = null;
      this.still = 0;
      this.nextAt = IDLE_TIC_GAP_MIN_MS + this.rng() * (IDLE_TIC_GAP_MAX_MS - IDLE_TIC_GAP_MIN_MS);
      return null;
    }
    this.still += dtMs;
    if (this.still < this.nextAt) return null;
    this.tic = pickIdleTic(this.rng, facing, side, manias, this.lastMania);
    if (this.tic.mania) this.lastMania = this.tic.mania;
    this.ticT = 0;
    this.count++;
    return { tic: this.tic, t: 0 };
  }

  /** Deja de estar en reposo: corta el tic en curso y el siguiente vuelve a tardar IDLE_TIC_AFTER_MS */
  reset(): void {
    this.tic = null;
    this.ticT = 0;
    this.still = 0;
    this.nextAt = IDLE_TIC_AFTER_MS;
  }

  current(): IdleTic | null {
    return this.tic;
  }
}

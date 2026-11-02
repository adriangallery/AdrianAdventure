// A2.2 (plan SCUMM): a dónde se acerca el personaje para usar un hotspot o hablar con un NPC, y hacia dónde se gira.
// Lógica pura, sin Phaser ni imports (se prueba en Node: tests/facing.test.mjs).
//
// Coordenadas en % del fondo, como Pathfinding. Para comparar distancias horizontales con verticales se pasa
// `aspect` (ancho / alto del fondo: 3712 / 1152 ≈ 3,2 en casi todas las escenas), así 1 % en x pesa lo que mide en
// pantalla. `playerHeight` es la altura del personaje en % del alto del fondo (≈ 49 con la unidad de píxel por defecto, A2.8).
//
// Campos opcionales en scene.json (HotspotData y NPCData):
//   "walkTo": { "x": 34, "y": 84 }   punto (en %) al que va el personaje antes de actuar
//   "face": "back"                    orientación al llegar: left | right | front | back
// Sin ellos:
//   - hotspot: el centro-abajo de `bounds` (lo de siempre), llevado al punto alcanzable más cercano;
//     TALK a un hotspot: como a un NPC plantado en ese centro-abajo.
//   - NPC: a distancia de conversación (TALK_DISTANCE % en x) del lado en el que está el jugador, a la altura de la
//     NPC; si ese lado no se pisa, el otro; y siempre llevado al punto alcanzable más cercano.
//   - face: hacia el objetivo desde el punto de llegada (`faceToward`).
// Si el objetivo queda en otra isla de la zona caminable, `reach` devuelve null: no se anda, solo se gira.

export type Facing = 'left' | 'right' | 'front' | 'back';
export const FACINGS: readonly Facing[] = ['left', 'right', 'front', 'back'];

export interface FacingPoint {
  x: number;
  y: number;
}

export interface FacingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lo que mira Facing de un hotspot o NPC de scene.json */
export interface ApproachTarget {
  bounds?: FacingRect;
  position?: FacingPoint;
  walkTo?: FacingPoint;
  face?: string;
}

export interface FacingOptions {
  /** Ancho / alto del fondo (1 si no se sabe) */
  aspect?: number;
  /** Altura del personaje en % del alto del fondo */
  playerHeight?: number;
}

/**
 * Punto alcanzable más cercano a `p` desde donde está el jugador (lo da Player/NavGrid), o null si `p` está en otra
 * isla de la zona caminable: entonces no se anda.
 */
export type Reach = (p: FacingPoint) => FacingPoint | null;

export interface Approach {
  /** Punto al que andar; null = no se anda (ya está allí, no hay bounds o no se puede llegar) */
  walkTo: FacingPoint | null;
  /** Orientación al llegar (o al momento si no se anda); null = no se gira (objetivo sin posición) */
  face: Facing | null;
  /** Punto al que se mira (centro del hotspot, posición de la NPC) */
  aim: FacingPoint | null;
}

/** Distancia de conversación con una NPC, en % del ancho del fondo */
export const TALK_DISTANCE = 7;
/** Si el jugador ya está a esta distancia horizontal de la NPC (y a su altura), no anda para hablar */
export const TALK_NEAR_MIN = 3;
export const TALK_NEAR_MAX = 10;
/** Tolerancia vertical (en %) para dar por hecho que el jugador ya está a la altura de la NPC */
const TALK_NEAR_DY = 3;
/** Más cerca que esto (en %) del punto de llegada = ya está allí */
const ARRIVED_EPS = 0.5;
const DEFAULT_PLAYER_HEIGHT = 20;

export function isFacing(v: unknown): v is Facing {
  return typeof v === 'string' && (FACINGS as readonly string[]).includes(v);
}

/** Centro de un rectángulo */
export function rectCenter(b: FacingRect): FacingPoint {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** El punto de siempre para usar un hotspot: centro-abajo de sus bounds (sin pasar del borde del fondo) */
export function standPoint(b: FacingRect): FacingPoint {
  return { x: b.x + b.w / 2, y: Math.min(b.y + b.h, 100) };
}

/**
 * Orientación para mirar `aim` desde `from` (los pies del personaje).
 *  - claramente por encima de la cabeza y más arriba que a un lado (objeto alto en la pared, puerta al fondo) → back;
 *  - a los pies (el centro del objetivo por debajo de las rodillas) y cerca en horizontal → front;
 *  - casi en la vertical del personaje: back si está por encima de las rodillas, front si no;
 *  - si no, perfil: right si está a la derecha, left si a la izquierda.
 */
export function faceToward(from: FacingPoint, aim: FacingPoint, opts: FacingOptions = {}): Facing {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1;
  const h = opts.playerHeight && opts.playerHeight > 0 ? opts.playerHeight : DEFAULT_PLAYER_HEIGHT;
  const dx = aim.x - from.x;
  const dxN = Math.abs(dx) * aspect; // en las mismas unidades que la altura
  const rise = from.y - aim.y; // > 0: el objetivo está por encima de los pies
  if (rise > h * 0.8 && dxN < rise * 0.75) return 'back';
  if (rise < h * 0.2 && dxN < h * 0.5) return 'front';
  if (dxN < h * 0.15) return rise >= h * 0.2 ? 'back' : 'front';
  return dx > 0 ? 'right' : 'left';
}

/**
 * Orientación hacia una persona (NPC): de perfil hacia su lado; de frente solo si está justo en la vertical. Las NPC
 * se miran a la cara, no a los pies, así que la altura no cuenta (la recepcionista está detrás del mostrador, más al
 * fondo que el jugador, y aun así se le habla de perfil).
 */
export function faceSide(from: FacingPoint, aimX: number): Facing {
  const dx = aimX - from.x;
  if (Math.abs(dx) < ARRIVED_EPS) return 'front';
  return dx > 0 ? 'right' : 'left';
}

/** Hacia dónde mirar desde `from`: perfil hacia una NPC; hacia un hotspot, según `faceToward` */
function faceFor(t: ApproachTarget, from: FacingPoint, aim: FacingPoint, opts: FacingOptions): Facing {
  return t.position ? faceSide(from, aim.x) : faceToward(from, aim, opts);
}

const dist = (a: FacingPoint, b: FacingPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** `face` explícito del scene.json si es válido; si no, null */
function explicitFace(t: ApproachTarget): Facing | null {
  return isFacing(t.face) ? t.face : null;
}

/** Punto al que se mira: centro de los bounds, la posición de la NPC o, en último caso, el walkTo explícito */
export function aimOf(t: ApproachTarget): FacingPoint | null {
  if (t.bounds) return rectCenter(t.bounds);
  if (t.position) return { ...t.position };
  return t.walkTo ? { ...t.walkTo } : null;
}

/**
 * USE/PICK/OPEN/CLOSE/PUSH/PULL/GIVE sobre un hotspot: a `walkTo` (o el centro-abajo de los bounds), llevado al punto
 * alcanzable más cercano, y girado hacia el hotspot (o al `face` explícito).
 */
export function approachHotspot(t: ApproachTarget, player: FacingPoint, reach: Reach, opts: FacingOptions = {}): Approach {
  const aim = aimOf(t);
  const want = t.walkTo ?? (t.bounds ? standPoint(t.bounds) : null);
  const walkTo = want ? reach(want) : null;
  const from = walkTo ?? player;
  const face = explicitFace(t) ?? (aim ? faceToward(from, aim, opts) : null);
  return { walkTo: walkTo && dist(walkTo, player) > ARRIVED_EPS ? walkTo : null, face, aim };
}

/**
 * TALK: a distancia de conversación del lado del jugador (o a `walkTo` si lo hay), mirando a la NPC. `position` es la
 * NPC; para un hotspot se toma su centro-abajo. Si el jugador ya está a esa distancia y a su altura, no anda.
 */
export function approachTalk(t: ApproachTarget, player: FacingPoint, reach: Reach, opts: FacingOptions = {}): Approach {
  const at = t.position ?? (t.bounds ? standPoint(t.bounds) : null);
  const aim = t.position ? { ...t.position } : aimOf(t);
  if (!at) return { walkTo: null, face: explicitFace(t), aim };

  let walkTo: FacingPoint | null;
  if (t.walkTo) {
    walkTo = reach(t.walkTo);
  } else {
    const ddx = Math.abs(player.x - at.x);
    const near = ddx >= TALK_NEAR_MIN && ddx <= TALK_NEAR_MAX && Math.abs(player.y - at.y) <= TALK_NEAR_DY;
    if (near) {
      walkTo = null;
    } else {
      const side = player.x >= at.x ? 1 : -1;
      walkTo = null;
      let bestErr = Infinity;
      for (const s of [side, -side]) {
        const want = { x: at.x + s * TALK_DISTANCE, y: at.y };
        const got = reach(want);
        if (!got) continue;
        // Error = cuánto se aleja del punto ideal; el lado del jugador gana los empates (y casi-empates)
        const err = dist(got, want) + (s === side ? 0 : 1);
        if (err < bestErr) {
          bestErr = err;
          walkTo = got;
        }
      }
    }
  }
  const from = walkTo ?? player;
  const face = explicitFace(t) ?? (aim ? faceFor(t, from, aim, opts) : null);
  return { walkTo: walkTo && dist(walkTo, player) > ARRIVED_EPS ? walkTo : null, face, aim };
}

/** LOOK: no anda; se gira hacia el objetivo desde donde está (el `face` explícito es para el punto de llegada). */
export function lookFacing(t: ApproachTarget, player: FacingPoint, opts: FacingOptions = {}): Facing | null {
  const aim = t.position ? { ...t.position } : aimOf(t);
  return aim ? faceFor(t, player, aim, opts) : null;
}

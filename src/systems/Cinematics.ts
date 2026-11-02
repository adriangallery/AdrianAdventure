/**
 * A2.10 (plan SCUMM): lógica pura del sistema de cinemáticas, sin Phaser, para probarla con
 * `node --experimental-strip-types --test tests/cinematics.test.mjs` (va en `npm run test:engine`).
 *
 * - Planificador del salto: qué hace cada op cuando el jugador salta la cinemática (`skipActionFor`, `planSkip`).
 * - Geometría: franjas del letterbox, iris (círculo que se cierra o abre) y cortinilla.
 * - Cámara: scroll para centrar un punto con zoom dentro de los límites del fondo, y de mundo a pantalla.
 * - Subtítulos: cuánto se queda un texto en pantalla en cinemática (voz o cálculo por caracteres).
 * - Ducking de la música (nivel y fundido).
 *
 * La parte con Phaser está en `src/systems/CinematicDirector.ts`; los opcodes, en `ScriptEngine.ts` y en
 * `qa/README.md` § Cinemáticas.
 */

/** Op de script mínimo (el mismo forma que `ScriptOp` de scene.types, sin importar tipos de la app). */
export interface CineOp {
  op: string;
  [key: string]: unknown;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  width: number;
  height: number;
}

// ─── Opcodes ──────────────────────────────────────────────────────────────────────────────────────────────

/** Ops de cámara, transiciones y actores: los ejecuta el director de cinemáticas (`CinemaHooks.run`). */
export const CINEMATIC_OPS: readonly string[] = [
  'cameraPan', 'cameraZoom', 'cameraShake', 'cameraFollow',
  'iris', 'wipe',
  'actorMove', 'actorFace', 'actorAnim', 'actorShow', 'actorHide', 'actorTeleport',
];

/** Ops que abren o cierran el modo cinemática (los lleva el propio ScriptEngine: sabe quién la abrió). */
export const CINEMATIC_MODE_OPS: readonly string[] = ['cinematic', 'cinematicStart', 'cinematicEnd'];

/** `cinematic {on:true}`/`cinematicStart` → 'start'; `cinematic {on:false}`/`cinematicEnd` → 'end'; si no, null. */
export function cinematicModeOf(op: CineOp): 'start' | 'end' | null {
  if (op.op === 'cinematicStart') return 'start';
  if (op.op === 'cinematicEnd') return 'end';
  if (op.op === 'cinematic') return op.on === false ? 'end' : 'start';
  return null;
}

/**
 * Qué hace un op cuando el jugador salta la cinemática:
 * - `state`: se aplica (setFlag, addItem, removeItem, cambio de escena, logro, disfraz): la partida queda igual que
 *   si la hubiera visto entera.
 * - `branch`: condicional síncrono: se evalúa y su rama sigue en modo salto.
 * - `instant`: cámara, actores y transiciones: se aplica su estado final sin animar (el personaje acaba donde
 *   iba, la cámara donde apuntaba).
 * - `run`: se ejecuta normal porque espera algo que el salto no puede decidir (un diálogo con elecciones, web3) o
 *   no bloquea (`mintAchievement`).
 * - `end`: fin de la cinemática: se deja de saltar y lo que venga después se ejecuta normal.
 * - `stop`: corta el script, como siempre.
 * - `skip`: presentación pura (textos, esperas, sonidos, sacudidas, tarjetas, monitor): se omite.
 */
export type SkipAction = 'state' | 'branch' | 'instant' | 'run' | 'end' | 'stop' | 'skip';

const STATE_OPS = new Set(['setFlag', 'addItem', 'removeItem', 'gotoScene', 'fadeToScene', 'achievement', 'setCostume']);
const BRANCH_OPS = new Set(['ifFlag', 'ifHasItem', 'ifVisited', 'ifWalletConnected']);
const RUN_OPS = new Set(['mintAchievement', 'dialogue', 'web3Require', 'mintNFT']);
/** Presentación con estado final que importa (dónde acaba la cámara o un actor, una iris cerrada) */
const INSTANT_OPS = new Set(CINEMATIC_OPS.filter((o) => o !== 'cameraShake'));

export function skipActionFor(op: CineOp): SkipAction {
  const mode = cinematicModeOf(op);
  if (mode === 'end') return 'end';
  if (mode === 'start') return 'instant';
  if (op.op === 'stop') return 'stop';
  if (STATE_OPS.has(op.op)) return 'state';
  if (BRANCH_OPS.has(op.op)) return 'branch';
  if (RUN_OPS.has(op.op)) return 'run';
  if (INSTANT_OPS.has(op.op)) return 'instant';
  return 'skip';
}

/**
 * Plan del salto desde `ops[from]` (el op en curso ya no se repite: se pasa el siguiente): los ops que se aplican
 * (estado, instantáneos y los que se ejecutan normal), con las ramas resueltas por `branchOf` (la que tocaría con
 * el estado actual; undefined = ninguna), hasta el fin de la cinemática o un `stop`. Es lo mismo que hace
 * ScriptEngine op a op; aquí entero, para las pruebas y la documentación.
 */
export function planSkip(
  ops: readonly CineOp[],
  branchOf: (op: CineOp) => readonly CineOp[] | undefined = () => undefined,
  from = 0,
): { applied: Array<{ op: CineOp; action: SkipAction }>; ended: boolean; stopped: boolean } {
  const applied: Array<{ op: CineOp; action: SkipAction }> = [];
  const walk = (list: readonly CineOp[], start: number): 'end' | 'stop' | null => {
    for (let i = start; i < list.length; i++) {
      const op = list[i];
      const action = skipActionFor(op);
      if (action === 'end') { applied.push({ op, action }); return 'end'; }
      if (action === 'stop') return 'stop';
      if (action === 'branch') {
        const b = branchOf(op);
        const r = b ? walk(b, 0) : null;
        if (r) return r;
        continue;
      }
      if (action !== 'skip') applied.push({ op, action });
    }
    return null;
  };
  const r = walk(ops, from);
  return { applied, ended: r === 'end', stopped: r === 'stop' };
}

// ─── Letterbox ────────────────────────────────────────────────────────────────────────────────────────────

/** Franja superior: 10 % del alto, entre 24 y 64 px */
export const LETTERBOX_RATIO = 0.1;
export const LETTERBOX_MIN = 24;
export const LETTERBOX_MAX = 64;
/** Entrada y salida de las franjas */
export const LETTERBOX_MS = 350;

/**
 * Alto de las franjas negras en pantalla. La de abajo tapa además el panel SCUMM (`panelH`, oculto durante la
 * cinemática) y es la banda de los subtítulos de quien no está en pantalla.
 */
export function letterboxBars(vp: Viewport, panelH = 0): { top: number; bottom: number } {
  const bar = Math.round(Math.min(LETTERBOX_MAX, Math.max(LETTERBOX_MIN, vp.height * LETTERBOX_RATIO)));
  const top = Math.min(bar, Math.floor(vp.height / 4));
  const bottom = Math.min(Math.max(bar, Math.round(panelH)), Math.floor(vp.height / 2));
  return { top, bottom };
}

/** Franjas a mitad de animación (`p` de 0 a 1). */
export function letterboxAt(bars: { top: number; bottom: number }, p: number): { top: number; bottom: number } {
  const t = clamp01(p);
  return { top: bars.top * t, bottom: bars.bottom * t };
}

// ─── Iris y cortinilla ────────────────────────────────────────────────────────────────────────────────────

/** `out` = se cierra (acaba en negro), `in` = se abre (acaba viendo la escena). */
export type TransitionMode = 'in' | 'out';
export type WipeDir = 'left' | 'right' | 'up' | 'down';

export const IRIS_MS = 700;
export const WIPE_MS = 500;
/** Lados del polígono del círculo de la iris */
export const IRIS_SEGMENTS = 48;

/** Radio que deja ver toda la pantalla desde `c` (distancia a la esquina más lejana). */
export function irisMaxRadius(c: Point, vp: Viewport): number {
  const dx = Math.max(c.x, vp.width - c.x);
  const dy = Math.max(c.y, vp.height - c.y);
  return Math.hypot(dx, dy);
}

/** Radio del agujero de la iris en el instante `p` (0 → 1). `out` va de abierto a cerrado; `in`, al revés. */
export function irisRadiusAt(mode: TransitionMode, p: number, maxR: number): number {
  const t = clamp01(p);
  return Math.max(0, mode === 'out' ? maxR * (1 - t) : maxR * t);
}

/**
 * Lo negro de la iris como cuadriláteros convexos sin huecos entre sí (sin máscaras: vale en Canvas y WebGL): cada
 * uno va de un lado del polígono del agujero (radio `r`) al mismo lado de un polígono exterior que cubre la
 * pantalla (radio `farR` corregido para que el polígono, no solo el círculo, la cubra).
 */
export function irisQuads(c: Point, r: number, farR: number, segments = IRIS_SEGMENTS): Point[][] {
  const n = Math.max(3, Math.floor(segments));
  const outer = farR / Math.cos(Math.PI / n) + 2;
  const inner = Math.max(0, r);
  const quads: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    quads.push([
      { x: c.x + Math.cos(a0) * inner, y: c.y + Math.sin(a0) * inner },
      { x: c.x + Math.cos(a0) * outer, y: c.y + Math.sin(a0) * outer },
      { x: c.x + Math.cos(a1) * outer, y: c.y + Math.sin(a1) * outer },
      { x: c.x + Math.cos(a1) * inner, y: c.y + Math.sin(a1) * inner },
    ]);
  }
  return quads;
}

/**
 * Rectángulo negro de la cortinilla en el instante `p`. `dir` es hacia dónde avanza el borde: `left` entra por la
 * derecha y barre hacia la izquierda. `out` cubre la pantalla poco a poco; `in` la destapa en la misma dirección.
 */
export function wipeRect(mode: TransitionMode, dir: WipeDir, p: number, vp: Viewport): Rect {
  const t = clamp01(p);
  const { width: W, height: H } = vp;
  const horizontal = dir === 'left' || dir === 'right';
  const size = horizontal ? W : H;
  // Parte cubierta: en `out` crece desde el borde de entrada; en `in` es lo que queda por destapar
  const covered = mode === 'out' ? size * t : size * (1 - t);
  if (horizontal) {
    // left: entra por la derecha. En `out` cubre [W-covered, W]; en `in` el borde sigue hacia la izquierda: [0, covered]
    const fromRight = (dir === 'left') === (mode === 'out');
    return { x: fromRight ? W - covered : 0, y: 0, w: covered, h: H };
  }
  // up: entra por abajo
  const fromBottom = (dir === 'up') === (mode === 'out');
  return { x: 0, y: fromBottom ? H - covered : 0, w: W, h: covered };
}

/** Transición de `fadeToScene`/`gotoScene` (`transition`) o de los ops `iris`/`wipe`. */
export interface TransitionSpec {
  type: 'fade' | 'iris' | 'wipe';
  /** iris: centro en % del fondo o un actor ('player' o id de NPC); por defecto, el jugador */
  at?: Point | string;
  dir?: WipeDir;
  ms?: number;
}

/**
 * `transition` de un op: `"iris"`, `"wipe"`, `"fade"` o `{ type, at, dir, ms }`. null si no trae (o no se entiende:
 * entonces se usa el fundido de siempre).
 */
export function parseTransition(raw: unknown): TransitionSpec | null {
  if (typeof raw === 'string') return ['fade', 'iris', 'wipe'].includes(raw) ? { type: raw as TransitionSpec['type'] } : null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!['fade', 'iris', 'wipe'].includes(o.type as string)) return null;
  const spec: TransitionSpec = { type: o.type as TransitionSpec['type'] };
  if (isPoint(o.at) || typeof o.at === 'string') spec.at = o.at as Point | string;
  if (['left', 'right', 'up', 'down'].includes(o.dir as string)) spec.dir = o.dir as WipeDir;
  if (typeof o.ms === 'number' && Number.isFinite(o.ms) && o.ms >= 0) spec.ms = o.ms;
  return spec;
}

// ─── Cámara ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CameraView {
  /** Tamaño de la cámara (el lienzo entero; el zoom de Phaser es alrededor de su centro) */
  width: number;
  height: number;
  /** Zona de pantalla donde se ve la escena (entre las franjas): de `top` a `height - bottom` */
  top?: number;
  bottom?: number;
}

export const CAMERA_MS = 1000;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

export function clampZoom(z: unknown, fallback = 1): number {
  const n = typeof z === 'number' && Number.isFinite(z) ? z : fallback;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

/**
 * Scroll de un eje para que el punto de mundo `f` quede en el centro de la zona visible [lo, hi] de pantalla con
 * zoom `z` (Phaser: pantalla = (mundo − scroll − size/2)·z + size/2). Con límites [bLo, bHi]: si lo visible cabe
 * dentro, no se sale de ellos; si es más grande, se centran.
 */
export function axisScroll(f: number, lo: number, hi: number, size: number, z: number, bLo?: number, bHi?: number): number {
  const half = size / 2;
  const centerOn = (p: number) => p - half - ((lo + hi) / 2 - half) / z;
  let scroll = centerOn(f);
  if (bLo === undefined || bHi === undefined || !(bHi > bLo)) return scroll;
  const span = (hi - lo) / z;
  if (span >= bHi - bLo) return centerOn((bLo + bHi) / 2);
  const worldLo = scroll + half + (lo - half) / z;
  const worldHi = worldLo + span;
  if (worldLo < bLo) scroll += bLo - worldLo;
  else if (worldHi > bHi) scroll -= worldHi - bHi;
  return scroll;
}

/** Scroll de la cámara para centrar `focus` (mundo) con zoom `zoom` en la zona visible, dentro de `bounds`. */
export function cameraScrollFor(focus: Point, zoom: number, view: CameraView, bounds?: Rect | null): { scrollX: number; scrollY: number } {
  const z = clampZoom(zoom);
  const top = view.top ?? 0;
  const bottom = view.bottom ?? 0;
  return {
    scrollX: axisScroll(focus.x, 0, view.width, view.width, z, bounds?.x, bounds ? bounds.x + bounds.w : undefined),
    scrollY: axisScroll(focus.y, top, view.height - bottom, view.height, z, bounds?.y, bounds ? bounds.y + bounds.h : undefined),
  };
}

/** Punto de mundo que la cámara tiene ahora en el centro de la zona visible (lo inverso de `cameraScrollFor`). */
export function cameraFocusOf(scroll: { scrollX: number; scrollY: number }, zoom: number, view: CameraView): Point {
  const z = clampZoom(zoom);
  const top = view.top ?? 0;
  const bottom = view.bottom ?? 0;
  const cy = (top + view.height - bottom) / 2;
  return {
    x: scroll.scrollX + view.width / 2,
    y: scroll.scrollY + view.height / 2 + (cy - view.height / 2) / z,
  };
}

/** De mundo a pantalla con la cámara (scroll y zoom alrededor de su centro), para el texto sobre la cabeza. */
export function worldToScreen(p: Point, cam: { scrollX: number; scrollY: number; zoom: number; width: number; height: number }): Point {
  const z = cam.zoom || 1;
  return {
    x: (p.x - cam.scrollX - cam.width / 2) * z + cam.width / 2,
    y: (p.y - cam.scrollY - cam.height / 2) * z + cam.height / 2,
  };
}

/** Interpolación lineal entre dos puntos. */
export function lerpPoint(a: Point, b: Point, t: number): Point {
  const k = clamp01(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Easing de los ops (`ease`): nombres cortos o de Phaser. Por defecto, Sine.easeInOut. */
export function easeName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Sine.easeInOut';
  const s = raw.trim();
  const short: Record<string, string> = {
    linear: 'Linear', sine: 'Sine.easeInOut', quad: 'Quad.easeInOut', cubic: 'Cubic.easeInOut', expo: 'Expo.easeInOut',
    back: 'Back.easeOut', bounce: 'Bounce.easeOut', in: 'Sine.easeIn', out: 'Sine.easeOut', inout: 'Sine.easeInOut',
  };
  return short[s.toLowerCase()] ?? s;
}

/** Duración de un op (`ms`) ya validada: número finito ≥ 0 o la de por defecto. */
export function durationOf(op: CineOp, fallback: number): number {
  const ms = op.ms;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : fallback;
}

/** Duración de un deslizamiento a velocidad andante (`pctPerSec`, en % del alto del fondo por segundo). */
export function slideDurationMs(from: Point, to: Point, pctPerSec: number, aspect = 1): number {
  // Las coordenadas x van en % del ancho: se pasan a % del alto con el aspecto del fondo
  const dx = (to.x - from.x) * aspect;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (!(pctPerSec > 0)) return 0;
  return Math.round((dist / pctPerSec) * 1000);
}

// ─── Subtítulos y música ──────────────────────────────────────────────────────────────────────────────────

/** Margen tras el final de la voz antes de pasar al siguiente texto */
export const VOICE_TAIL_MS = 300;
export const SUBTITLE_MIN_MS = 1500;
/** Lectura: ms por carácter una vez escrito el texto */
export const READ_MS_PER_CHAR = 45;

/**
 * Cuánto se queda un texto en pantalla en cinemática (avanza solo; un toque lo adelanta como siempre): lo que dura
 * su clip de voz más un margen, o, sin voz, lo que tarda en escribirse más tiempo de lectura.
 */
export function subtitleHoldMs(textLength: number, charDelayMs: number, voiceMs?: number | null): number {
  if (typeof voiceMs === 'number' && Number.isFinite(voiceMs) && voiceMs > 0) return Math.round(voiceMs + VOICE_TAIL_MS);
  const len = Math.max(0, textLength);
  return Math.max(SUBTITLE_MIN_MS, Math.round(len * Math.max(0, charDelayMs) + len * READ_MS_PER_CHAR + 600));
}

/** Música bajo la voz y en cinemática: ~35 % del volumen, con un fundido de 200 ms (bajar y volver) */
export const DUCK_LEVEL = 0.35;
export const DUCK_FADE_MS = 200;

/** Ganancia del ducking según quién lo pide (voz, cinemática): con alguno, DUCK_LEVEL; sin ninguno, 1. */
export function duckGainFor(sources: { size: number }): number {
  return sources.size > 0 ? DUCK_LEVEL : 1;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────────────────────────────────

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function isPoint(v: unknown): v is Point {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export const FACINGS = ['left', 'right', 'front', 'back'] as const;
export type ActorFacing = typeof FACINGS[number];

export function isActorFacing(v: unknown): v is ActorFacing {
  return typeof v === 'string' && (FACINGS as readonly string[]).includes(v);
}

/**
 * A2.3 (plan SCUMM): colocación del texto hablado sobre la cabeza de quien habla. Lógica pura (sin Phaser) para
 * poder probarla con `node --experimental-strip-types --test tests/speech-layout.test.mjs`.
 *
 * Coordenadas en píxeles de pantalla (las del juego con Scale.RESIZE). El texto se coloca con origen (0.5, 0):
 * `x` es el centro horizontal y `y` el borde superior del bloque de texto.
 *
 * - `head`: el bloque queda centrado sobre la cabeza, con su borde inferior `gap` px por encima; si no cabe, se
 *   pega al margen izquierdo, derecho o superior (y nunca baja del panel inferior).
 * - `top`: el modo de siempre, arriba en el centro. Es el del narrador/sistema y el de reserva cuando quien habla
 *   no está en la escena, no se ve (hidePlayer, closeups, tráiler) o se ha salido de la pantalla.
 */

export type SpeechMode = 'head' | 'top';

/** Quién habla, resuelto a partir del `speaker` del texto. */
export type SpeakerKind = 'player' | 'npc' | 'narrator';

export interface Viewport {
  width: number;
  height: number;
}

/** Cabeza (punto más alto del sprite) y pies de quien habla, en pantalla. */
export interface HeadAnchor {
  x: number;
  headY: number;
  footY: number;
}

export interface SpeechPlacement {
  mode: SpeechMode;
  /** Centro horizontal del bloque */
  x: number;
  /** Borde superior del bloque */
  y: number;
  /** Se ha pegado a algún borde (solo en modo head) */
  clamped: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/** Margen mínimo entre el texto y el borde de la pantalla */
export const SPEECH_MARGIN = 8;
/** Separación entre el borde inferior del texto y la cabeza */
export const SPEECH_GAP = 10;
/** Ancho de línea sobre la cabeza: fracción del ancho de pantalla (horizontal / escritorio) */
export const HEAD_WRAP_RATIO = 0.4;
/** En vertical (móvil) el 40 % no da ni para tres palabras: se usa este */
export const HEAD_WRAP_RATIO_PORTRAIT = 0.82;
/** Ancho mínimo de línea sobre la cabeza (si la pantalla lo permite) */
export const HEAD_WRAP_MIN = 240;
/** Ancho máximo de línea sobre la cabeza */
export const HEAD_WRAP_MAX = 560;
/** Ancho de línea del modo arriba-centro (el de antes de A2.3) */
export const TOP_WRAP_MAX = 600;
const TOP_WRAP_PAD = 64;

/** Nombres de `speaker` que son el narrador o el sistema (texto arriba-centro). Sin mayúsculas. */
export const NARRATOR_SPEAKERS: readonly string[] = ['narrator', 'narrador', 'system', 'sistema'];
/** Nombres de `speaker` que son el jugador (además de no poner speaker). Sin mayúsculas. */
export const PLAYER_SPEAKERS: readonly string[] = ['player', 'jugador', 'adrian'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tamaño de la letra del texto hablado (misma escala con el viewport que antes de A2.3). */
export function speechFontSize(vp: Viewport): { body: number; speaker: number } {
  const refDim = vp.height > vp.width ? Math.max(vp.width, vp.height * 0.5) : vp.width;
  return {
    speaker: Math.max(13, Math.min(20, Math.floor(refDim * 0.018))),
    body: Math.max(12, Math.min(18, Math.floor(refDim * 0.016))),
  };
}

/** Grosor del contorno oscuro según el tamaño de letra (legible sobre fondos cargados). */
export function speechStroke(fontSize: number): number {
  return Math.max(4, Math.round(fontSize / 3));
}

/**
 * Ancho de wrap del texto. Sobre la cabeza ≈ 40 % del ancho (con mínimo y máximo); en vertical, más ancho para
 * que quepa. Nunca más que la pantalla menos los márgenes. Arriba-centro, como antes (≤ 600 px).
 */
export function speechWrapWidth(vp: Viewport, mode: SpeechMode = 'head'): number {
  const avail = Math.max(1, vp.width - SPEECH_MARGIN * 2);
  if (mode === 'top') return Math.max(1, Math.min(vp.width - TOP_WRAP_PAD, TOP_WRAP_MAX));
  const ratio = vp.height > vp.width ? HEAD_WRAP_RATIO_PORTRAIT : HEAD_WRAP_RATIO;
  const want = clamp(vp.width * ratio, HEAD_WRAP_MIN, HEAD_WRAP_MAX);
  return Math.floor(Math.min(avail, want));
}

/** Y del modo arriba-centro (6 % del alto, mínimo 20 px), como antes de A2.3. */
export function topY(vp: Viewport): number {
  return Math.max(20, vp.height * 0.06);
}

/** ¿Se ve quien habla? Su x dentro de la pantalla y algo de su cuerpo dentro en vertical. */
export function isAnchorOnScreen(head: HeadAnchor | null | undefined, vp: Viewport): head is HeadAnchor {
  if (!head) return false;
  if (![head.x, head.headY, head.footY].every(Number.isFinite)) return false;
  if (head.x < 0 || head.x > vp.width) return false;
  return head.footY > 0 && head.headY < vp.height;
}

export interface PlaceOptions {
  head: HeadAnchor | null | undefined;
  vp: Viewport;
  /** Tamaño del bloque de texto ya envuelto (el mensaje completo, no lo que lleva escrito el typewriter) */
  textW: number;
  textH: number;
  /** Alto del panel inferior (SCUMM) que el texto no debe pisar */
  bottomInset?: number;
  margin?: number;
  gap?: number;
}

/** Coloca el bloque de texto: sobre la cabeza y dentro de pantalla, o arriba-centro si no hay cabeza visible. */
export function placeSpeech(o: PlaceOptions): SpeechPlacement {
  const { vp } = o;
  const margin = o.margin ?? SPEECH_MARGIN;
  const gap = o.gap ?? SPEECH_GAP;
  const none = { left: false, right: false, top: false, bottom: false };
  if (!isAnchorOnScreen(o.head, vp)) return { mode: 'top', x: vp.width / 2, y: topY(vp), clamped: none };

  const head = o.head;
  const halfW = o.textW / 2;
  const clamped = { ...none };
  let x = head.x;
  if (o.textW + margin * 2 >= vp.width) {
    // Más ancho que la pantalla: centrado
    x = vp.width / 2;
    clamped.left = clamped.right = true;
  } else if (x - halfW < margin) {
    x = margin + halfW;
    clamped.left = true;
  } else if (x + halfW > vp.width - margin) {
    x = vp.width - margin - halfW;
    clamped.right = true;
  }

  let y = head.headY - gap - o.textH;
  const maxY = vp.height - (o.bottomInset ?? 0) - margin - o.textH;
  if (y > maxY) {
    y = maxY;
    clamped.bottom = true;
  }
  if (y < margin) {
    y = margin;
    clamped.top = true;
  }
  return { mode: 'head', x, y, clamped };
}

/**
 * Quién habla según el `speaker` del texto: sin speaker (o «player») = el jugador; «Narrator»/«System» = el
 * narrador; cualquier otro nombre = una NPC (si no está en la escena, el texto cae arriba-centro igual).
 */
export function speakerKind(speaker: string | null | undefined): SpeakerKind {
  const s = (speaker ?? '').trim().toLowerCase();
  if (!s || PLAYER_SPEAKERS.includes(s)) return 'player';
  if (NARRATOR_SPEAKERS.includes(s)) return 'narrator';
  return 'npc';
}

/** '#ff6600', 'ff6600', '0xff6600' o '#f60' → '#ff6600'; null si no es un color. */
export function normalizeColor(c: string | null | undefined): string | null {
  if (!c) return null;
  let s = c.trim().toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  else if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export interface ColorOptions {
  kind: SpeakerKind;
  /** Claves con las que buscar en el mapa: id y nombre de la NPC, speaker tal cual… (sin mayúsculas) */
  keys: Array<string | null | undefined>;
  /** Mapa de colores por personaje; `_player`, `_npc` y `_narrator` son los de reserva por tipo */
  colors: Readonly<Record<string, string>>;
  /** `color` de la NPC en el scene.json (NPCData.color), si lo tiene */
  npcColor?: string | null;
  /** Último recurso */
  fallback?: string;
}

/** Color del texto: el del mapa por personaje, el `color` de la NPC en la escena o el de reserva por tipo. */
export function speechColor(o: ColorOptions): string {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(o.colors)) map.set(k.toLowerCase(), v);
  if (o.kind === 'player') {
    const own = map.get('_player') ?? map.get('player');
    if (own) return own;
  }
  for (const k of o.keys) {
    const hit = k ? map.get(k.trim().toLowerCase()) : undefined;
    if (hit) return hit;
  }
  if (o.kind === 'npc') {
    const own = normalizeColor(o.npcColor);
    if (own) return own;
  }
  return map.get(`_${o.kind}`) ?? o.fallback ?? '#f0e8d8';
}

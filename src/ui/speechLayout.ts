/**
 * A2.3 (plan SCUMM): colocación del texto hablado sobre la cabeza de quien habla. Lógica pura (sin Phaser) para
 * poder probarla con `node --experimental-strip-types --test tests/speech-layout.test.mjs`.
 *
 * Coordenadas en píxeles de pantalla (las del juego con Scale.RESIZE). El texto se coloca con origen (0.5, 0):
 * `x` es el centro horizontal y `y` el borde superior del bloque de texto.
 *
 * - `head`: el bloque queda centrado sobre la cabeza, con su borde inferior `gap` px por encima; si no cabe, se
 *   pega al margen izquierdo, derecho o superior (y nunca baja del panel inferior).
 *   A7.2 (J-5): si por arriba no cabe sin tapar la cabeza (cabeza muy alta, texto largo), el bloque se pone a un lado
 *   de quien habla (`side`), a la altura de la cabeza; si tampoco cabe a lo ancho, pide un wrap más estrecho
 *   (`wantWrap`) para que quien llama lo vuelva a medir y a colocar.
 * - A7.2 (J-5): `topInset` reserva la franja de los botones de arriba (guardar, ayuda, móvil, wallet): ni el modo
 *   `head` ni el `top` (con el nombre de quien habla encima) se meten en ella.
 * - `top`: el modo de siempre, arriba en el centro. Es el del narrador/sistema y el de reserva cuando quien habla
 *   no está en la escena, no se ve (hidePlayer, closeups, tráiler) o se ha salido de la pantalla.
 */

/** A2.10: `band` = subtítulo en la franja inferior del letterbox (cinemática y quien habla no se ve). */
/** A2.19b: 'caption' = subtítulo discreto de una línea que ya se lee en la pantalla de la máquina */
export type SpeechMode = 'head' | 'top' | 'band' | 'caption';

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
  /** A7.2: en modo head, el bloque va a ese lado de quien habla porque por encima le taparía la cabeza */
  side?: 'left' | 'right';
  /** A7.2: el bloque no cabe a ningún lado con su ancho: volver a medirlo con este wrap y colocarlo otra vez */
  wantWrap?: number;
}

/**
 * A7.2 (J-5): alto de la franja de los botones de arriba (SaveButton, ayuda, móvil y WalletButton: y = 8, alto 24).
 * DialogueBox la pasa como `topInset` fuera de las cinemáticas (en ellas los botones se esconden).
 */
export const TOP_UI_INSET = 32;
/** A7.2: ancho mínimo de un bloque puesto a un lado de quien habla (menos que esto no se lee) */
export const SIDE_WRAP_MIN = 140;

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
  if (mode === 'top' || mode === 'band') return Math.max(1, Math.min(vp.width - TOP_WRAP_PAD, TOP_WRAP_MAX));
  const ratio = vp.height > vp.width ? HEAD_WRAP_RATIO_PORTRAIT : HEAD_WRAP_RATIO;
  const want = clamp(vp.width * ratio, HEAD_WRAP_MIN, HEAD_WRAP_MAX);
  return Math.floor(Math.min(avail, want));
}

/**
 * Y del modo arriba-centro (6 % del alto, mínimo 20 px), como antes de A2.3. A7.2: con `topInset` (franja de los
 * botones de arriba) baja lo justo para que el nombre de quien habla (`nameH`, va encima del texto) no la pise.
 */
export function topY(vp: Viewport, topInset = 0, nameH = 0): number {
  const base = Math.max(20, vp.height * 0.06);
  return topInset > 0 ? Math.max(base, topInset + SPEECH_MARGIN + nameH) : base;
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
  /**
   * A2.10: franjas del letterbox en pantalla (cinemática). Sin cabeza visible el texto va centrado en la de abajo
   * (modo `band`); sobre la cabeza no pisa ninguna de las dos.
   */
  band?: { top: number; bottom: number } | null;
  /** A7.2: franja de arriba reservada a los botones (px desde el borde superior); 0 o sin pasar = nada */
  topInset?: number;
  /** A7.2: alto del nombre de quien habla en el modo arriba-centro (va encima del texto) */
  nameH?: number;
}

/** A2.10: Y del subtítulo en la franja inferior: centrado en ella, sin salirse por abajo. */
export function bandY(vp: Viewport, bandBottom: number, textH: number, margin = SPEECH_MARGIN): number {
  const top = vp.height - bandBottom;
  const centered = top + (bandBottom - textH) / 2;
  return Math.max(top + 2, Math.min(centered, vp.height - margin - textH));
}

/** Coloca el bloque de texto: sobre la cabeza y dentro de pantalla, o arriba-centro si no hay cabeza visible. */
export function placeSpeech(o: PlaceOptions): SpeechPlacement {
  const { vp } = o;
  const margin = o.margin ?? SPEECH_MARGIN;
  const gap = o.gap ?? SPEECH_GAP;
  const none = { left: false, right: false, top: false, bottom: false };
  const band = o.band && o.band.bottom > 0 ? o.band : null;
  if (!isAnchorOnScreen(o.head, vp)) {
    if (band) return { mode: 'band', x: vp.width / 2, y: bandY(vp, band.bottom, o.textH, margin), clamped: none };
    return { mode: 'top', x: vp.width / 2, y: topY(vp, o.topInset ?? 0, o.nameH ?? 0), clamped: none };
  }

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
  const maxY = vp.height - Math.max(o.bottomInset ?? 0, band?.bottom ?? 0) - margin - o.textH;
  const minY = Math.max(band?.top ?? 0, o.topInset ?? 0) + margin;
  if (y > maxY) {
    y = maxY;
    clamped.bottom = true;
  }
  if (y < minY) {
    y = minY;
    clamped.top = true;
  }
  // A7.2 (J-5): pegado arriba, el bloque bajaría sobre la cabeza de quien habla: mejor a un lado
  if (clamped.top && y + o.textH > head.headY - gap) {
    const side = placeBeside(o, head, minY, maxY, margin, gap);
    if (side) return side;
  }
  return { mode: 'head', x, y, clamped };
}

/**
 * A7.2 (J-5): el bloque a un lado de quien habla, a la altura de la cabeza, en el lado con más sitio. Deja libre el
 * cuerpo (media anchura estimada por su alto). Si no cabe con su ancho, pide `wantWrap` (el sitio que hay); con
 * menos de SIDE_WRAP_MIN px a los dos lados devuelve null (se queda arriba, como antes).
 */
function placeBeside(o: PlaceOptions, head: HeadAnchor, minY: number, maxY: number, margin: number, gap: number): SpeechPlacement | null {
  const { vp } = o;
  const bodyHalf = clamp((head.footY - head.headY) * 0.2, 12, 60);
  const rightSpace = vp.width - margin - (head.x + bodyHalf + gap);
  const leftSpace = head.x - bodyHalf - gap - margin;
  const right = rightSpace >= leftSpace;
  const space = Math.floor(right ? rightSpace : leftSpace);
  if (space < SIDE_WRAP_MIN) return null;
  const w = Math.min(o.textW, space);
  const x = right ? head.x + bodyHalf + gap + w / 2 : head.x - bodyHalf - gap - w / 2;
  const top = Math.max(minY, Math.min(head.headY - o.textH / 3, maxY));
  const clamped = { left: !right && w === space, right: right && w === space, top: top === minY, bottom: top === maxY && top !== minY };
  const placed: SpeechPlacement = { mode: 'head', x, y: top, clamped, side: right ? 'right' : 'left' };
  if (o.textW > space) placed.wantWrap = space;
  return placed;
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

/** A2.19b: rectángulo en px del viewport (pantalla de la máquina, cuerpo de Dex) */
export interface CaptionRect { x: number; y: number; w: number; h: number }

const overlapArea = (a: CaptionRect, b: CaptionRect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * A2.19b: subtítulo discreto (la línea ya se teclea dentro de la pantalla de la máquina): abajo, justo encima del panel,
 * centrado; si ahí pisa la pantalla o a Dex (`avoid`), arriba (bajo los botones); si pisa en los dos sitios, donde pise
 * menos. Devuelve el borde superior del bloque y su centro horizontal.
 */
export function placeCaption(o: {
  vp: Viewport;
  textW: number;
  textH: number;
  bottomInset?: number;
  topInset?: number;
  avoid?: CaptionRect[];
  margin?: number;
}): SpeechPlacement {
  const margin = o.margin ?? SPEECH_MARGIN;
  const none = { left: false, right: false, top: false, bottom: false };
  const x = o.vp.width / 2;
  const bottomY = o.vp.height - (o.bottomInset ?? 0) - margin - o.textH;
  const topYv = (o.topInset ?? 0) + margin;
  const cost = (y: number) => {
    const block = { x: x - o.textW / 2, y, w: o.textW, h: o.textH };
    return (o.avoid ?? []).reduce((n, r) => n + overlapArea(block, r), 0);
  };
  const cb = cost(bottomY);
  if (cb === 0) return { mode: 'caption', x, y: bottomY, clamped: none };
  const ct = cost(topYv);
  return { mode: 'caption', x, y: ct < cb ? topYv : bottomY, clamped: none };
}

// A2.8 (plan SCUMM): densidad de píxel unificada. Lógica pura, sin Phaser ni imports (se prueba en Node:
// tests/pixel-scale.test.mjs, en `npm run test:engine`).
//
// Unidades:
//   - píxel de arte: un píxel de la hoja del sprite (el jugador mide 103, la recepcionista 37: misma densidad);
//   - píxel de fondo: un píxel de background.png (3712×1152 casi siempre);
//   - píxel de pantalla: un píxel del lienzo (CSS px; el navegador lo amplía por el DPR con `image-rendering: pixelated`).
//
// `pixelScale` (scene.json, opcional) = cuántos píxeles de fondo mide un píxel de arte de personaje en esa escena: la
// unidad de píxel del mundo. Por defecto DEFAULT_PIXEL_SCALE (5,5, la media de los playerScale que se habían ajustado
// a mano en los interiores; el jugador mide 103 × 5,5 = 567 px de fondo, el 49 % del alto). Jugador, disfraz de mono y
// NPC usan la misma unidad; una hoja dibujada a otra densidad lleva `artScale` en su entrada de `npcs[]`.
//
// En pantalla: base = pixelScale × artScale × coordSystem.scale (píxeles de pantalla por píxel de arte), redondeada al
// entero más cercano si eso no cambia el tamaño más de SNAP_TOLERANCE (20 %): desde base ≥ 2 siempre (escritorio:
// 1280×720 → 3, 1920×1080 → 4) y nunca por debajo de 1. Entre 1,25 y 1,67 (móvil apaisado, 844×390 → 1,38) un entero
// sería un 28-45 % más pequeño o más grande y se deja exacta: ahí el lienzo va a DPR ≥ 2 y la diferencia de un píxel
// de lienzo es de décimas de milímetro. Por debajo de 1 (planos generales como epilogue_outside) no hay entero posible.
//
// `depthScale` (scene.json, opcional) = escala por profundidad lineal en y, como en Monkey Island: entre `yTop` y
// `yBottom` (en % del alto del fondo) el factor va de `scaleTop` a `scaleBottom` y fuera se queda en el del extremo.
// Multiplica la base ya redondeada, así que donde el factor es 1 la escala sigue siendo entera y al andar no hay saltos.
// Solo donde la perspectiva lo pide (caminos que se alejan: outside, mountain, clinic_exterior).
//
// La altura que usa Facing (A2.2) es la «del mundo» (artHeightPct: sin redondeo de pantalla), para que girarse hacia
// un objeto no dependa del tamaño de la ventana.

export interface DepthScale {
  /** y (en % del fondo) donde el factor es `scaleTop` (lo más lejano) */
  yTop: number;
  /** y (en % del fondo) donde el factor es `scaleBottom` (lo más cercano) */
  yBottom: number;
  scaleTop: number;
  scaleBottom: number;
}

/** Lo que mira PixelScale de scene.json */
export interface PixelSceneConfig {
  pixelScale?: number;
  depthScale?: DepthScale;
  /** Antiguo (antes de A2.8): escala del jugador por escena; se lee como pixelScale si no hay pixelScale */
  player?: { playerScale?: number };
}

/** Lo que mira PixelScale de assets/config/global.json */
export interface PixelGlobalConfig {
  pixelScale?: number;
  /** Antiguo (antes de A2.8) */
  playerScale?: number;
}

export const DEFAULT_PIXEL_SCALE = 5.5;
/** Rangos válidos (los repite scripts/lint-scenes.mjs: el linter corre en Node sin type stripping) */
export const PIXEL_SCALE_MIN = 1;
export const PIXEL_SCALE_MAX = 12;
export const DEPTH_FACTOR_MIN = 0.2;
export const DEPTH_FACTOR_MAX = 2;
export const ART_SCALE_MIN = 0.25;
export const ART_SCALE_MAX = 4;
/** Error relativo máximo que se acepta al redondear la escala de pantalla a un entero */
export const SNAP_TOLERANCE = 0.2;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isValidPixelScale(v: unknown): v is number {
  return isNum(v) && v >= PIXEL_SCALE_MIN && v <= PIXEL_SCALE_MAX;
}

export function isValidArtScale(v: unknown): v is number {
  return isNum(v) && v >= ART_SCALE_MIN && v <= ART_SCALE_MAX;
}

/** Defectos de un depthScale (vacío = válido) */
export function depthScaleDefects(d: unknown): string[] {
  if (!d || typeof d !== 'object') return ['depthScale tiene que ser un objeto {yTop, yBottom, scaleTop, scaleBottom}'];
  const o = d as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ['yTop', 'yBottom', 'scaleTop', 'scaleBottom']) if (!isNum(o[k])) out.push(`depthScale.${k} no es un número`);
  if (out.length) return out;
  const { yTop, yBottom, scaleTop, scaleBottom } = o as unknown as DepthScale;
  if (yTop < 0 || yBottom > 100) out.push('depthScale.yTop/yBottom fuera de 0-100');
  if (!(yTop < yBottom)) out.push('depthScale.yTop tiene que ser menor que yBottom');
  for (const [k, v] of [['scaleTop', scaleTop], ['scaleBottom', scaleBottom]] as const) {
    if (v < DEPTH_FACTOR_MIN || v > DEPTH_FACTOR_MAX) out.push(`depthScale.${k} = ${v} fuera de ${DEPTH_FACTOR_MIN}-${DEPTH_FACTOR_MAX}`);
  }
  return out;
}

/** Unidad de píxel de la escena: pixelScale, o el playerScale antiguo, o el global, o DEFAULT_PIXEL_SCALE. */
export function resolvePixelScale(scene: PixelSceneConfig | null | undefined, global?: PixelGlobalConfig | null): number {
  const cands = [scene?.pixelScale, scene?.player?.playerScale, global?.pixelScale, global?.playerScale];
  return cands.find(isValidPixelScale) ?? DEFAULT_PIXEL_SCALE;
}

/** Factor de profundidad en `yPct` (1 sin depthScale o si no es válido). */
export function depthFactor(depth: DepthScale | null | undefined, yPct: number): number {
  if (!depth || depthScaleDefects(depth).length) return 1;
  const t = Math.min(1, Math.max(0, (yPct - depth.yTop) / (depth.yBottom - depth.yTop)));
  return depth.scaleTop + (depth.scaleBottom - depth.scaleTop) * t;
}

export interface SnappedScale {
  /** Píxeles de pantalla por píxel de arte */
  value: number;
  /** true = entero (cada píxel de arte mide lo mismo en pantalla) */
  snapped: boolean;
}

/** Redondea la escala de pantalla a un entero si eso no la cambia más de `tol` (ver cabecera). */
export function snapScreenScale(exact: number, tol = SNAP_TOLERANCE): SnappedScale {
  if (!isNum(exact) || exact <= 0) return { value: exact, snapped: false };
  const n = Math.round(exact);
  if (n >= 1 && Math.abs(n - exact) / exact <= tol + 1e-9) return { value: n, snapped: true };
  return { value: exact, snapped: false };
}

export interface SpriteScaleInput {
  pixelScale: number;
  /** Densidad de la hoja respecto a la del jugador (1 = la misma) */
  artScale?: number;
  /** coordSystem.scale: píxeles de pantalla por píxel de fondo */
  coordScale: number;
  depth?: DepthScale | null;
  /** y de los pies (en %) */
  yPct?: number;
}

export interface SpriteScale {
  /** Escala que se le pone al sprite (píxeles de pantalla por píxel de arte) */
  scale: number;
  /** Base sin profundidad, ya redondeada */
  base: number;
  /** La base es entera */
  snapped: boolean;
  /** Factor de profundidad aplicado */
  depth: number;
}

export function spriteScale(i: SpriteScaleInput): SpriteScale {
  const art = isValidArtScale(i.artScale) ? i.artScale : 1;
  const b = snapScreenScale(i.pixelScale * art * i.coordScale);
  const d = depthFactor(i.depth, i.yPct ?? 100);
  return { scale: b.value * d, base: b.value, snapped: b.snapped, depth: d };
}

/** Altura «del mundo» (sin redondeo de pantalla) en % del alto del fondo de un sprite de `artH` píxeles de arte. */
export function artHeightPct(artH: number, pixelScale: number, imgH: number, depth = 1, artScale = 1): number {
  return imgH > 0 ? (artH * pixelScale * artScale * depth / imgH) * 100 : 0;
}

/** ¿La escala es un múltiplo entero del píxel de arte? (con margen de coma flotante) */
export function isIntegerScale(scale: number, eps = 1e-6): boolean {
  return isNum(scale) && scale >= 1 - eps && Math.abs(scale - Math.round(scale)) <= eps;
}

/**
 * Inversa para el hit-test: punto del mundo → píxel de arte de un sprite con los pies (origen 0,5 / 1) en `foot`, de
 * `w`×`h` píxeles de arte a escala `scale`. `inside` = cae dentro de la hoja; `slackBelow` (en píxeles de arte) deja
 * pulsar un poco por debajo de los pies, como el hitbox de las NPC.
 */
export function worldToArt(
  p: { x: number; y: number }, foot: { x: number; y: number }, scale: number, w: number, h: number, slackBelow = 0,
): { x: number; y: number; inside: boolean } {
  const s = scale > 0 ? scale : 1;
  const x = (p.x - foot.x) / s + w / 2;
  const y = (p.y - foot.y) / s + h;
  return { x, y, inside: x > 0 && x < w && y > 0 && y < h + slackBelow };
}

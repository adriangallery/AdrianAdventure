// A5.1 (plan SCUMM): memoria de GPU y peso de las escenas. Lógica pura, sin Phaser ni imports (se prueba en Node:
// tests/scene-textures.test.mjs, en `npm run test:engine`).
//
// Un fondo decodificado ocupa en la GPU ancho × alto × 4 bytes (RGBA de 8 bits; Phaser no genera mipmaps para estas
// texturas: `pixelArt` y el filtro lineal de GameScene.applySceneArtFilter van sin ellos). Un fondo de 3712×1152 son
// 16,3 MiB; con su primer plano, 32,6 MiB por escena (aquí «MB» = MiB, como en el smoke). `textureReport` suma lo que hay
// en el TextureManager y lo clasifica (arte de la escena actual, arte de otras escenas que sigue cargado, personajes,
// iconos, insignias, lienzos de texto), para `__qa.state().textures`, el smoke y la demo.
//
// Tres decisiones de A5.1:
//   1. Tamaño lógico ≠ tamaño de textura. Las coordenadas en % (hotspots, walkableAreas, bounds de overlays), la unidad de
//      píxel (A2.8: píxeles de fondo por píxel de arte) y la velocidad del jugador (px de fondo/s) siguen referidas al
//      fondo original (`render.world` del scene.json, 3712×1152 casi siempre: `worldSize`). La textura que se sube a la
//      GPU puede ser más pequeña: GameScene la estira con `fitScale` (mundo / textura) y todo cae donde caía.
//   2. Variantes del arte a tamaño de fondo (fondo, primer plano y overlays sin `bounds`): `<nombre>@2048.webp` y
//      `<nombre>@1280.webp` (BG_VARIANT_WIDTHS; scripts/make-bg-variants.mjs las genera con sharp a partir del PNG
//      maestro, que no se carga nunca). `pickBgVariant` elige UNA para toda la sesión al arrancar: la más pequeña que
//      cubre el fondo tal y como se pinta (alto del área de juego × DPR, cover en vertical/panorámico, contain si no),
//      y si ninguna llega, la mayor. Así escritorio y móviles con DPR ≥ 2 van a 2048 y un móvil a DPR 1 (o con poca
//      memoria, `deviceMemory` ≤ 2 GB, o ahorro de datos) a 1280. `?bg=1280|2048` la fuerza (solo en dev o con ?qa=1).
//   3. Liberar el arte de escenas que ya no se ven. Al entrar en una escena, `texturesToEvict` dice qué claves de arte de
//      escena (bg_, fg_, overlay_, sprites web3) quitar del TextureManager: todas menos las de la escena que entra y la
//      anterior (volver atrás sigue siendo instantáneo y sin red: A2.7 deja los ficheros en la caché HTTP, se vuelven a
//      decodificar). Antes se acumulaban: 6 escenas visitadas eran 170 MB de texturas.

/** Anchos de las variantes del arte a tamaño de fondo, de menor a mayor */
export const BG_VARIANT_WIDTHS: readonly number[] = [1280, 2048];
/** Variante por defecto si no se puede medir nada (p. ej. sin `window`) */
export const DEFAULT_BG_VARIANT = 2048;

export interface BgVariant {
  width: number;
  /** Por qué: `fit` (la más pequeña que cubre lo que se pinta), `max` (ninguna llega: la mayor), `lowMemory`, `saveData`, `override` */
  reason: string;
}

export interface PickBgVariantInput {
  /** Área de juego en px CSS (viewport menos el panel SCUMM) */
  vpW: number;
  vpH: number;
  /** window.devicePixelRatio */
  dpr: number;
  /** Tamaño lógico del fondo (render.world) */
  world: { w: number; h: number };
  /** navigator.deviceMemory (GB, solo Chromium) */
  deviceMemory?: number | null;
  /** navigator.connection.saveData */
  saveData?: boolean | null;
  /** ?bg=<ancho> (solo si es una variante que existe) */
  override?: number | string | null;
  widths?: readonly number[];
}

/** Ancho en px de dispositivo con el que se pinta el fondo (la misma cuenta que CoordSystem.recalculate) */
export function renderedBgWidth(vpW: number, vpH: number, dpr: number, world: { w: number; h: number }): number {
  if (!(vpW > 0) || !(vpH > 0) || !(world.w > 0) || !(world.h > 0)) return 0;
  const portrait = vpH > vpW;
  const panoramic = world.w / world.h > (vpW / vpH) * 1.2;
  const scale = portrait || panoramic ? vpH / world.h : Math.min(vpW / world.w, vpH / world.h);
  return world.w * scale * Math.max(1, dpr || 1);
}

/** Variante de fondo para la sesión (ver cabecera, decisión 2). */
export function pickBgVariant(input: PickBgVariantInput): BgVariant {
  const widths = [...(input.widths ?? BG_VARIANT_WIDTHS)].sort((a, b) => a - b);
  const smallest = widths[0] ?? DEFAULT_BG_VARIANT;
  const largest = widths[widths.length - 1] ?? DEFAULT_BG_VARIANT;
  const override = Number(input.override);
  if (input.override != null && input.override !== '' && widths.includes(override)) return { width: override, reason: 'override' };
  if (input.saveData) return { width: smallest, reason: 'saveData' };
  if (typeof input.deviceMemory === 'number' && input.deviceMemory > 0 && input.deviceMemory <= 2) return { width: smallest, reason: 'lowMemory' };
  const needed = renderedBgWidth(input.vpW, input.vpH, input.dpr, input.world);
  if (!(needed > 0)) return { width: largest, reason: 'max' };
  const fit = widths.find((w) => w >= needed);
  return fit !== undefined ? { width: fit, reason: 'fit' } : { width: largest, reason: 'max' };
}

/** `background` → `background@2048.webp` (sin `?v=`) */
export const variantFile = (name: string, width: number): string => `${name}@${width}.webp`;

/** Alto de una variante: el ancho pedido con la proporción del fondo, redondeado como hace sharp */
export const variantHeight = (width: number, world: { w: number; h: number }): number => Math.max(1, Math.round((width * world.h) / world.w));

/**
 * Tamaño lógico de la escena: `render.world` del scene.json si es válido; si no, el de la textura del fondo (como antes
 * de A5.1: solo vale si la textura es el fondo entero).
 */
export function worldSize(scene: { render?: { world?: { width?: unknown; height?: unknown } } } | null | undefined, tex: { w: number; h: number }): { w: number; h: number } {
  const w = scene?.render?.world?.width;
  const h = scene?.render?.world?.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { w, h };
  return { w: tex.w, h: tex.h };
}

/** Escala extra que lleva una imagen a tamaño de fondo para medir lo que el mundo (1 si la textura ya mide eso) */
export function fitScale(world: { w: number; h: number }, tex: { w: number; h: number }): { x: number; y: number } {
  return { x: tex.w > 0 ? world.w / tex.w : 1, y: tex.h > 0 ? world.h / tex.h : 1 };
}

/**
 * Claves de arte de escena que sobran al entrar en `entering`: las de cualquier escena de `sceneArt` que no sea la que
 * entra ni ninguna de `keep` (la anterior). Solo las que existen (`exists`), en el orden del mapa.
 */
export function texturesToEvict(
  sceneArt: Readonly<Record<string, readonly string[]>>,
  entering: string,
  keep: readonly (string | null | undefined)[],
  exists: (key: string) => boolean,
): string[] {
  const stay = new Set<string>([entering, ...keep.filter((k): k is string => typeof k === 'string')]);
  const out: string[] = [];
  for (const [scene, keys] of Object.entries(sceneArt)) {
    if (stay.has(scene)) continue;
    for (const k of keys) if (exists(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Lo que mira el informe de cada fuente de textura de Phaser (TextureSource) */
export interface TextureEntry {
  key: string;
  width: number;
  height: number;
  /** Textura dibujada en un canvas (los Text de Phaser): se cuenta aparte */
  canvas?: boolean;
}

export type TextureKind = 'scene' | 'otherScenes' | 'characters' | 'items' | 'badges' | 'canvas' | 'other';

export interface TextureKindTotal {
  count: number;
  bytes: number;
}

export interface TextureReport {
  count: number;
  bytes: number;
  byKind: Record<TextureKind, TextureKindTotal>;
  /** Escenas cuyo arte (fondo, primer plano, overlays, sprites web3) sigue en Phaser, la actual incluida */
  scenesLoaded: string[];
  /** Texturas de BIG_TEXTURE_BYTES o más, de mayor a menor */
  big: Array<{ key: string; w: number; h: number; bytes: number }>;
}

/** Bytes de una textura RGBA de 8 bits sin mipmaps */
export const textureBytes = (w: number, h: number): number => Math.max(0, w) * Math.max(0, h) * 4;

/** A partir de aquí una textura sale en la lista `big` del informe (1 MB) */
export const BIG_TEXTURE_BYTES = 1024 * 1024;

const KINDS: TextureKind[] = ['scene', 'otherScenes', 'characters', 'items', 'badges', 'canvas', 'other'];

/**
 * Informe de memoria de texturas. `sceneArt` dice qué claves son arte de cada escena (las de sceneImageAssets de
 * src/systems/ScenePrefetch.ts); una clave `bg_*`/`fg_*`/`overlay_*` de una escena que no está en el mapa cuenta como
 * arte de otra escena. Las claves internas de Phaser (`__DEFAULT`, `__MISSING`, `__WHITE`, `__NORMAL`) no cuentan.
 */
export function textureReport(
  entries: readonly TextureEntry[],
  opts: { currentScene: string | null; sceneArt: Readonly<Record<string, readonly string[]>> },
): TextureReport {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { count: 0, bytes: 0 }])) as Record<TextureKind, TextureKindTotal>;
  const keyScene = new Map<string, string>();
  for (const [scene, keys] of Object.entries(opts.sceneArt)) for (const k of keys) keyScene.set(k, scene);
  const scenesLoaded = new Set<string>();
  const big: TextureReport['big'] = [];
  let count = 0;
  let bytes = 0;
  for (const e of entries) {
    if (e.key.startsWith('__')) continue;
    const b = textureBytes(e.width, e.height);
    count++;
    bytes += b;
    let kind: TextureKind;
    const scene = keyScene.get(e.key);
    if (scene !== undefined) {
      scenesLoaded.add(scene);
      kind = scene === opts.currentScene ? 'scene' : 'otherScenes';
    } else if (e.canvas) kind = 'canvas';
    else if (/^(bg_|fg_|overlay_)/.test(e.key)) kind = 'otherScenes';
    else if (/^(player_|ape_|npc_)/.test(e.key)) kind = 'characters';
    else if (e.key.startsWith('item_')) kind = 'items';
    else if (e.key.startsWith('badge_')) kind = 'badges';
    else kind = 'other';
    byKind[kind].count++;
    byKind[kind].bytes += b;
    if (b >= BIG_TEXTURE_BYTES) big.push({ key: e.key, w: e.width, h: e.height, bytes: b });
  }
  big.sort((a, c) => c.bytes - a.bytes || a.key.localeCompare(c.key));
  return { count, bytes, byKind, scenesLoaded: [...scenesLoaded].sort(), big };
}

/** MiB con un decimal, para logs e informes (el smoke y el resto del repo llaman «MB» a 1048576 bytes) */
export const toMb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10;

// A2.7 (plan SCUMM): qué escenas son vecinas, qué ficheros necesita cada una y en qué orden se precargan.
// Lógica pura, sin Phaser ni imports (se prueba en Node: tests/scene-prefetch.test.mjs). El que descarga es
// src/systems/ScenePrefetcher.ts; PreloadScene usa `sceneImageAssets` para encolar exactamente lo mismo.
//
// Vecinas = escenas a las que se puede salir desde esta: `gotoScene`/`fadeToScene` en cualquier script de su
// scene.json (hotspots, gateFallback, triggers, onEnter, objetos, combos y nodos de diálogo, ramas incluidas;
// el mismo recorrido que scripts/lint-scenes.mjs) y `transitions.goto[].targetScene`.

// A5.1: iguales que en src/systems/SceneTextures.ts (sin import: este módulo se prueba en Node con type stripping, que
// no resuelve imports sin extensión; tests/scene-textures.test.mjs comprueba que coinciden)
export const DEFAULT_BG_VARIANT = 2048;
export const variantFile = (name: string, width: number): string => `${name}@${width}.webp`;

/**
 * A5.1: ¿overlay a tamaño de fondo? Sin `bounds`, o con unos `bounds` que cubren el fondo entero (0,0,100,100: así
 * dejó A2.7 `server_room.lights_out`). Esos van en variantes como el fondo; overlayTransform los coloca igual con o sin
 * bounds porque escala por mundo/textura. scripts/make-bg-variants.mjs usa la misma regla.
 */
export function isFullFrame(bounds: unknown): boolean {
  if (!bounds || typeof bounds !== 'object') return true;
  const b = bounds as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  return Number(b.x) <= 0 && Number(b.y) <= 0 && Number(b.w) >= 100 && Number(b.h) >= 100;
}

/** Lo justo de un scene.json para el grafo y los ficheros (SceneData lo cumple). */
export interface PrefetchScene {
  assets?: { foreground?: string | null };
  onEnter?: unknown[];
  regions?: {
    hotspots?: Array<{ scripts?: Record<string, unknown[]>; gateFallback?: unknown[] }>;
    triggers?: Array<{ onEnter?: unknown[] }>;
  };
  items?: { sceneItems?: Array<{ pickupScript?: unknown[] }> };
  combos?: Array<{ script?: unknown[] }>;
  dialogues?: Record<string, { nodes?: Record<string, { onEnter?: unknown[] }> }>;
  transitions?: { goto?: Array<{ targetScene?: string }> };
  conditionalOverlays?: Array<{ id: string; sprite: string; format?: 'png' | 'webp'; bounds?: unknown }>;
  web3Visuals?: Array<{ defaultSprite: string; variants?: Array<{ sprite: string }> }>;
  audio?: { music?: string | null; ambience?: string | null };
}

export interface SceneAsset {
  /** Clave de textura de Phaser (la de PreloadScene/GameScene) */
  key: string;
  /** Ruta relativa con `?v=` */
  url: string;
}

const EXIT_OPS = new Set(['gotoScene', 'fadeToScene']);
const NESTED_KEYS = ['then', 'else', 'onSuccess', 'onFail'];

function collectExits(ops: unknown, out: string[]): void {
  if (!Array.isArray(ops)) return;
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const o = op as Record<string, unknown>;
    if (typeof o.op === 'string' && EXIT_OPS.has(o.op) && typeof o.sceneId === 'string') out.push(o.sceneId);
    for (const k of NESTED_KEYS) collectExits(o[k], out);
  }
}

/** Escenas vecinas en orden de aparición, sin repetir y sin la propia escena. */
export function sceneExits(scene: PrefetchScene | null | undefined, selfId?: string): string[] {
  if (!scene) return [];
  const found: string[] = [];
  collectExits(scene.onEnter, found);
  for (const hs of scene.regions?.hotspots ?? []) {
    for (const ops of Object.values(hs.scripts ?? {})) collectExits(ops, found);
    collectExits(hs.gateFallback, found);
  }
  for (const tr of scene.regions?.triggers ?? []) collectExits(tr.onEnter, found);
  for (const it of scene.items?.sceneItems ?? []) collectExits(it.pickupScript, found);
  for (const c of scene.combos ?? []) collectExits(c.script, found);
  for (const tree of Object.values(scene.dialogues ?? {})) {
    for (const node of Object.values(tree?.nodes ?? {})) collectExits(node?.onEnter, found);
  }
  for (const g of scene.transitions?.goto ?? []) if (typeof g.targetScene === 'string') found.push(g.targetScene);
  return [...new Set(found)].filter((id) => id !== selfId);
}

export const sceneJsonUrl = (sceneId: string, v: string): string => `assets/scenes/${sceneId}/scene.json${v}`;
export const musicUrl = (track: string, v: string): string => `assets/audio/music/${track}.mp3${v}`;
/** A4.4: bucles de ambiente (clave de caché `amb_<clave>`, como en MusicManager) */
export const ambienceUrl = (key: string, v: string): string => `assets/audio/ambience/${key}.mp3${v}`;
export const ambienceCacheKey = (key: string): string => `amb_${key}`;

/**
 * Imágenes de una escena con la clave de textura que les da PreloadScene: fondo, primer plano (si
 * `assets.foreground`), overlays condicionales (`overlay_<escena>_<id>`, png o webp según `format`) y sprites de
 * web3Visuals (por defecto y variantes; la clave es el nombre del sprite).
 *
 * A5.1: el arte a tamaño de fondo (fondo, primer plano y overlays sin `bounds`) se sirve en variantes
 * `<nombre>@<ancho>.webp` (src/systems/SceneTextures.ts); `variant` es el ancho elegido para la sesión (DEFAULT_BG_VARIANT
 * si no se pasa). Los overlays recortados (con `bounds`) y los sprites web3 van a su tamaño, como siempre.
 */
export function sceneImageAssets(sceneId: string, scene: PrefetchScene | null | undefined, v: string, variant: number = DEFAULT_BG_VARIANT): SceneAsset[] {
  const base = `assets/scenes/${sceneId}`;
  const full = (name: string) => `${base}/${variantFile(name, variant)}${v}`;
  const out: SceneAsset[] = [{ key: `bg_${sceneId}`, url: full('background') }];
  if (!scene) return out;
  if (scene.assets?.foreground) out.push({ key: `fg_${sceneId}`, url: full('foreground') });
  for (const co of scene.conditionalOverlays ?? []) {
    const ext = co.format === 'webp' ? 'webp' : 'png';
    out.push({ key: `overlay_${sceneId}_${co.id}`, url: isFullFrame(co.bounds) ? full(co.sprite) : `${base}/${co.sprite}.${ext}${v}` });
  }
  for (const w of scene.web3Visuals ?? []) {
    out.push({ key: w.defaultSprite, url: `${base}/${w.defaultSprite}.png${v}` });
    for (const vr of w.variants ?? []) out.push({ key: vr.sprite, url: `${base}/${vr.sprite}.png${v}` });
  }
  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.key)) return false;
    seen.add(a.key);
    return true;
  });
}

/** `navigator.connection` (Network Information API, solo en Chromium) */
export interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Vecinas que se precargan como mucho con buena conexión (los fondos pesan ~4 MB cada uno) */
export const MAX_PREFETCH_SCENES = 4;

/**
 * Cuántas vecinas se precargan según la conexión: ninguna con «ahorro de datos» o en 2G, solo la primera salida
 * en 3G y todas (hasta MAX_PREFETCH_SCENES) si no. Sin Network Information API (Safari, Firefox) cuenta como buena.
 */
export function prefetchBudget(conn: ConnectionLike | null | undefined): { maxScenes: number; reason: string | null } {
  if (conn?.saveData) return { maxScenes: 0, reason: 'saveData' };
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return { maxScenes: 0, reason: conn.effectiveType };
  if (conn?.effectiveType === '3g') return { maxScenes: 1, reason: '3g' };
  return { maxScenes: MAX_PREFETCH_SCENES, reason: null };
}

export interface PrefetchTask {
  scene: string;
  kind: 'json' | 'image' | 'music' | 'ambience';
  url: string;
  /** Clave de textura o de audio en Phaser (para no pedir lo que ya está decodificado) */
  key?: string;
}

export interface PlanInput {
  /** Escena en la que está el jugador */
  current: string;
  /** Vecinas de `current`, en orden (sceneExits) */
  neighbors: readonly string[];
  /** scene.json ya conocidos (los que faltan se piden primero) */
  scenes: Readonly<Record<string, PrefetchScene | undefined>>;
  v: string;
  /** A5.1: ancho de la variante de fondo de la sesión */
  variant?: number;
  /** URLs ya descargadas a la caché HTTP (o en curso) */
  done: ReadonlySet<string>;
  /** Textura (o audio) ya en Phaser */
  isLoaded: (key: string) => boolean;
  /** Con el sonido apagado no se precarga música (A1.5) */
  muted: boolean;
  /** Tope de vecinas (las primeras salidas) */
  maxScenes?: number;
}

/**
 * Cola de precarga para la escena actual, de una en una y en este orden: primero los scene.json de las vecinas que
 * faltan (sin ellos no se sabe qué imágenes tienen), luego las imágenes de cada vecina en orden de salida (fondo,
 * primer plano, overlays, web3) y al final su música y su ambiente (A4.4) si hay sonido. Nunca lo ya descargado ni lo ya decodificado
 * en Phaser. El planificador se vuelve a llamar cuando llega un scene.json (así entran sus imágenes).
 */
export function planPrefetch(input: PlanInput): PrefetchTask[] {
  const { current, scenes, v, done, isLoaded, muted } = input;
  const neighbors = input.neighbors.filter((id) => id !== current).slice(0, input.maxScenes ?? MAX_PREFETCH_SCENES);
  const tasks: PrefetchTask[] = [];
  const add = (t: PrefetchTask) => {
    if (done.has(t.url)) return;
    if (t.key && isLoaded(t.key)) return;
    if (tasks.some((x) => x.url === t.url)) return;
    tasks.push(t);
  };
  for (const id of neighbors) if (!scenes[id]) add({ scene: id, kind: 'json', url: sceneJsonUrl(id, v) });
  for (const id of neighbors) {
    const s = scenes[id];
    if (!s) continue;
    for (const a of sceneImageAssets(id, s, v, input.variant)) add({ scene: id, kind: 'image', url: a.url, key: a.key });
  }
  if (!muted) {
    for (const id of neighbors) {
      const track = scenes[id]?.audio?.music;
      if (track) add({ scene: id, kind: 'music', url: musicUrl(track, v), key: track });
    }
    // A4.4: y su ambiente (ligero: ~130 KB por bucle), detrás de la música
    for (const id of neighbors) {
      const amb = scenes[id]?.audio?.ambience;
      if (amb) add({ scene: id, kind: 'ambience', url: ambienceUrl(amb, v), key: ambienceCacheKey(amb) });
    }
  }
  return tasks;
}

export type TransitionMode = 'instant' | 'indicator' | 'full';

/**
 * Cómo se enseña la carga al entrar en una escena: `full` (barra, porcentaje y frases) solo la primera vez que
 * arranca el juego; después, `instant` (fundido corto sin nada encima) si todo lo que hace falta está ya en Phaser
 * o en la caché HTTP, o `indicator` (una barrita discreta) si hay que bajar algo.
 */
export function transitionMode(opts: { firstLoad: boolean; missing: number }): TransitionMode {
  if (opts.firstLoad) return 'full';
  return opts.missing === 0 ? 'instant' : 'indicator';
}

/** Duración de los fundidos: corto entre escenas, el de siempre (400 ms) al arrancar. */
export const FADE_SHORT_MS = 250;
export const FADE_FIRST_MS = 400;

/** Ruta sin `?v=` para informes (QA) */
export const shortUrl = (url: string): string => url.split('?')[0];

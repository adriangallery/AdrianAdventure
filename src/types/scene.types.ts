import type { ScreenDef } from '@/systems/ScreenText';
import type { ResponseMap } from '@/systems/FailResponses';

export interface SceneData {
  version: number;
  id: string;
  title: string;
  assets: {
    background: string;
    walkmask: string;
    atlas: string | null;
    /** Optional foreground layer (transparent PNG, same dimensions as background) — renders above player for depth */
    foreground?: string;
  };
  render: {
    world: { width: number; height: number };
    camera: {
      start: { x: number; y: number };
      followPlayer: boolean;
      lerp: number;
      clampToWorld: boolean;
    };
  };
  player: {
    spawn: { x: number; y: number };
    speed: number;
    /** Antiguo (antes de A2.8): se lee como `pixelScale` de la escena si no lo hay. Usa `pixelScale`. */
    playerScale?: number;
    /** Hide player sprite (for closeup/cinematic scenes) */
    hidePlayer?: boolean;
    /**
     * P1 (arte pendiente): Dex sentado en una escena con `hidePlayer`. Con la flag a true se ve `dex2d_sit_0` (y
     * `dex2d_sit_talk_0` alternando mientras habla Dex) con la base del lienzo (48×103, pies abajo en el centro) en
     * (x, y) %, a la escala del jugador. Solo con el traje normal (no con el disfraz de mono).
     */
    seated?: { flag: string; x: number; y: number; depth?: number };
    /** Per-scene player depth override (default 10, foreground is 15) */
    playerDepth?: number;
    sprite: { sheet: string | null; idle: string | null; walk: string | null };
  };
  ui: {
    verbs: string[];
    mobileDrawerDefault: 'collapsed' | 'expanded';
  };
  maskMapping: MaskMapping;
  regions: {
    hotspots: HotspotData[];
    triggers: TriggerData[];
  };
  items: {
    sceneItems: SceneItemData[];
  };
  combos: ComboData[];
  audio: {
    music: string | null;
    variation?: MusicVariation;
    crossfadeDuration?: number;
    /** A4.4: bucle de assets/audio/ambience/<clave>.mp3 (claves en src/config/ambience.config.ts); null = sin ambiente */
    ambience: string | null;
    /** A4.4: multiplicador del volumen del ambiente en esta escena (0-2, por defecto 1) */
    ambienceVolume?: number;
    /** A4.4: superficie de los pasos (wood | gravel | concrete | tile | metal | carpet | grass); sin ella no suenan */
    footstep?: string | null;
    /** A4.4: zonas (en %) con otra superficie, p. ej. el porche de madera dentro del camino de grava */
    surfaces?: Array<{ x: number; y: number; w: number; h: number; footstep: string }>;
    sfx: Record<string, string>;
  };
  transitions: {
    goto: GotoData[];
  };
  /** Rectangular areas where the player can walk (percentage 0-100) */
  walkableAreas?: Array<{ x: number; y: number; w: number; h: number }>;
  /**
   * A2.1: obstáculos dentro de las zonas caminables (rectángulos en %, se restan de walkableAreas; su borde tampoco
   * se pisa). El personaje los rodea con el pathfinding (src/systems/Pathfinding.ts). Sin walkableAreas no hacen nada.
   */
  blockedAreas?: Array<{ x: number; y: number; w: number; h: number }>;
  /**
   * A2.17 fase 2: walk-behind por objeto. Trozos de foreground.png (caja en %, como bounds) que no van siempre por
   * encima de Dex: se dibujan a la profundidad de su línea base (`baseY`, % del alto), ordenados con Dex y las NPC por
   * la y de los pies (actorDepth). Pies por debajo de la base (y mayor) = Dex delante; por encima = el trozo le tapa.
   * El resto del primer plano sigue a depth 15 (siempre delante).
   */
  foregroundLayers?: Array<{
    id: string;
    bounds: { x: number; y: number; w: number; h: number };
    baseY: number;
    /**
     * A2.17 fase 3: máscara (fichero de la escena, WebP sin pérdida del tamaño de `bounds` en el maestro; la genera
     * scripts/make-fg-layers.py): el trozo son solo los píxeles del primer plano donde es opaca, no el rectángulo entero
     * (p. ej. la maleza delante de las rocas, o un arbusto junto a un seto que debe seguir delante).
     */
    mask?: string;
    /**
     * A2.17 fase 4: tapado relativo a los pies (maleza alta por la que se anda). El trozo se parte en franjas
     * horizontales de `bandStep` % de alto; la franja k (que empieza en bounds.y + k·bandStep) se dibuja a la base
     * baseY + k·bandStep. Así la base baja con la franja y el trozo tapa a Dex siempre lo mismo: desde
     * (baseY − bounds.y) por encima de sus pies hacia abajo, esté donde esté. Sin bandStep, una sola base para todo.
     */
    bandStep?: number;
  }>;
  npcs?: NPCData[];
  dialogues?: Record<string, DialogueTreeData>;
  /** Scripts that run automatically when the scene loads */
  onEnter?: ScriptOp[];
  /** Conditional visual overlays based on wallet/NFT state */
  web3Visuals?: Web3Visual[];
  /** Sprites shown/hidden based on game flags */
  conditionalOverlays?: ConditionalOverlayData[];
  /** Camera post-processing effect (e.g., anaglyph for MemeLAB) */
  cameraEffect?: { type: string; disableFlag?: string };
  /**
   * A2.8: unidad de píxel del mundo: píxeles de fondo por píxel de arte de personaje (jugador, mono y NPC). Por defecto
   * DEFAULT_PIXEL_SCALE (src/systems/PixelScale.ts). Rango 1-12.
   */
  pixelScale?: number;
  /** A2.8: escala por profundidad lineal en y (factor de `scaleTop` en `yTop` a `scaleBottom` en `yBottom`, en %) */
  depthScale?: { yTop: number; yBottom: number; scaleTop: number; scaleBottom: number };
  /**
   * A4.3: animación ambiental por código (src/systems/Ambient.ts): polillas, polvo, LEDs, niebla, nubes, luces que titilan o
   * respiran, barrido de CRT, burbujas, goteras, pájaros y vaivén del primer plano. Cada elemento se enciende o apaga con
   * `when` (gramática de A2.6a) y se dibuja sin assets. Un elemento mal definido se salta (aviso en consola y en el linter).
   */
  ambient?: AmbientElementData[];
  /**
   * A2.19: pantallas de la escena (CRT, monitores, teclados, carteles luminosos) donde un `say` con `screen: "<id>"` pinta su
   * texto (src/systems/ScreenText.ts). `bounds` en % del mundo, medidos sobre el cristal del fondo.
   */
  screens?: Record<string, ScreenDef>;
}

/** A4.3: un elemento de `ambient[]` tal como va en el JSON (campos según `kind`; ver la cabecera de src/systems/Ambient.ts) */
export interface AmbientElementData {
  id: string;
  kind: 'moths' | 'dust' | 'leds' | 'fog' | 'clouds' | 'flicker' | 'glow' | 'scan' | 'rise' | 'drip' | 'birds' | 'sway';
  /** Condición para verse (`flag`, `!flag`, `item:id`, `!item:id`; lista = todas). Sin ella, siempre */
  when?: string | string[];
  /** Por defecto 12 (encima del jugador, debajo del primer plano); 5 = detrás del jugador; 16 = encima del primer plano */
  depth?: number;
  /** Alfa máxima (0-1) y mínima (glow, flicker; por defecto el 30 % de alpha) */
  alpha?: number;
  alphaMin?: number;
  /** `#rrggbb` */
  color?: string;
  /** leds: paleta de las celdas */
  colors?: string[];
  count?: number;
  /** Tamaño en píxeles del fondo (punto, grosor, alto de un banco de niebla, envergadura) */
  size?: number;
  /** Multiplicador de velocidad (1); 0 en dust = quietas, solo centellean */
  speed?: number;
  /** ms: ciclo (glow, scan, sway), tic (flicker), intervalo (leds, drip) */
  period?: number;
  /** Rectángulo en % del fondo (dust, fog, clouds, flicker, glow, scan, rise, birds; leds con cols/rows) */
  area?: { x: number; y: number; w: number; h: number };
  /** Punto en % del fondo (moths, drip) */
  at?: { x: number; y: number };
  /** moths: radio de la órbita en % del alto del fondo */
  radius?: number;
  /** fog, clouds: 1 = se mueve con el fondo; < 1 = más lejos */
  parallax?: number;
  blend?: 'normal' | 'add' | 'screen' | 'multiply';
  shape?: 'rect' | 'ellipse';
  /** drip: y (%) donde salpica la gota */
  floorY?: number;
  /** dust, rise: partículas extra que lanza el op `ambient` con action burst */
  burst?: number;
  /** rise: manchas suaves (vapor) en vez de puntos (burbujas) */
  soft?: boolean;
  /** leds: celdas explícitas (si no, `area` con `cols` × `rows`) */
  cells?: Array<{ x: number; y: number }>;
  cols?: number;
  rows?: number;
  /** sway: px del fondo de vaivén del primer plano */
  amplitude?: number;
}

export interface ConditionalOverlayData {
  id: string;
  /** Sprite file name (without extension) inside the scene folder */
  sprite: string;
  format?: 'png' | 'webp';
  /**
   * A2.7: caja de la imagen dentro del fondo, en % del fondo (como hotspots). Sin ella la imagen mide lo que el
   * fondo y va encima entera. La escribe scripts/crop-overlays.mjs al recortar (ver src/systems/OverlayPlacement.ts).
   */
  bounds?: { x: number; y: number; w: number; h: number };
  flag: string;
  invert?: boolean;
  depth?: number;
}

// ─── Web3 Visual Elements ───────────────────────────────────

export interface Web3Visual {
  id: string;
  /** Position in percentage coordinates (0-100) */
  position: { x: number; y: number };
  /** Size in percentage (optional — if omitted, uses natural sprite size) */
  size?: { w: number; h: number };
  /** Default sprite key shown to all players */
  defaultSprite: string;
  /** Variant sprites shown when gating rules pass */
  variants: Web3VisualVariant[];
  /** Depth layer (default: 5, between bg at 0 and player at 10) */
  depth?: number;
}

export interface Web3VisualVariant {
  /** Gating rule that must pass for this variant */
  gate: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
  /** Sprite key to show when gate passes */
  sprite: string;
  /** Optional visual effect */
  effect?: 'glow' | 'shimmer' | 'none';
}

export interface NPCData {
  id: string;
  name: string;
  position: { x: number; y: number };
  color?: string;
  dialogueTreeId?: string;
  /**
   * Antiguo (antes de A2.8): escala a mano. Se ignora: las NPC usan la unidad de píxel de la escena (`pixelScale`).
   * El linter avisa si aparece.
   */
  scale?: number;
  /** A2.8: densidad de la hoja respecto a la del jugador (1 = la misma, por defecto). Rango 0,25-4. */
  artScale?: number;
  /**
   * Respuesta cuando el jugador da (GIVE) o usa (USE) un objeto con la NPC: clave = id del objeto o `_default`. A2.5: cada
   * valor es una frase o una lista (bolsa: no repite la última; ronda fija con ?qa=1). Sin marcadores (`{item}`): todo
   * literal, para que tenga voz. Prioridad y bolsas de reserva: src/systems/FailResponses.ts.
   */
  giveResponses?: ResponseMap;
  useResponses?: ResponseMap;
  /**
   * A2.6: GIVE/USE de ese objeto con la NPC lanza un árbol (`tree`, de la misma escena; por defecto el de la NPC)
   * desde su `start` o desde `node`, en vez del texto de giveResponses/useResponses. `setFlag` se pone antes.
   */
  itemDialogues?: Record<string, NPCItemDialogue>;
  /** A2.2: punto (en %) desde el que se le habla; por defecto, a distancia de conversación del lado del jugador */
  walkTo?: { x: number; y: number };
  /** A2.2: orientación del jugador al llegar; por defecto, de perfil hacia la NPC */
  face?: 'left' | 'right' | 'front' | 'back';
  /**
   * A4.2: orientación por defecto de la NPC (`left` = sprite espejado). Por defecto `right`, como están dibujados. Se
   * gira hacia el jugador al hablar y vuelve a esta al acabar.
   */
  facing?: 'left' | 'right';
}

export interface NPCItemDialogue {
  tree?: string;
  node?: string;
  setFlag?: string;
}

export interface DialogueTreeData {
  id: string;
  start: string;
  nodes: Record<string, DialogueNodeData>;
}

export interface DialogueNodeData {
  speaker?: string;
  /** A2.6: un nodo sin texto (el hub) solo enseña sus opciones */
  text?: string;
  choices?: DialogueChoiceData[];
  next?: string;
  onEnter?: ScriptOp[];
  end?: boolean;
  /** A2.6a: condiciones (`flag`, `!flag`, `item:id`, `!item:id`); si falla alguna, el nodo se salta */
  when?: string | string[];
}

/** A2.6: ver src/systems/DialogueSystem.ts (DialogueChoice) para la semántica de cada campo */
export interface DialogueChoiceData {
  id?: string;
  text: string;
  /** Obligatorio salvo en las salidas (`exit: true`) */
  next?: string;
  gate?: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
  /** Sin cumplir: opción visible y bloqueada (con `hideIfLocked`, oculta) */
  flag?: string;
  setFlag?: string;
  /** A2.6a: sin cumplir, la opción se OCULTA */
  when?: string | string[];
  hideIfLocked?: boolean;
  once?: boolean;
  exit?: boolean;
}

export interface MaskMapping {
  walkableColor: string;
  hotspotColor: string;
  triggerColor: string;
  regionIdStrategy: 'manual' | 'auto';
}

export interface HotspotData {
  id: string;
  maskRegionId?: string;
  name: string;
  cursor?: string;
  /** Bounds in PERCENTAGE coordinates (0-100) relative to background */
  bounds?: { x: number; y: number; w: number; h: number };
  scripts: Record<string, ScriptOp[]>;
  /** If set, hotspot is only interactive when gate passes */
  gate?: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
  /** Script to run when gate fails (default: generic locked message) */
  gateFallback?: ScriptOp[];
  /** Hotspot hidden while this flag is set */
  hideWhenFlag?: string;
  /** Hotspot only visible while this flag is set */
  showWhenFlag?: string;
  /** A2.2: punto (en %) al que anda el jugador antes de actuar; por defecto, el centro-abajo de `bounds` */
  walkTo?: { x: number; y: number };
  /** A2.2: orientación del jugador al llegar; por defecto, hacia el hotspot (ver src/systems/Facing.ts) */
  face?: 'left' | 'right' | 'front' | 'back';
  /**
   * A2.5: respuestas de fallo al usar un objeto aquí sin combo: `<itemId>` = pareja específica (el intento tentador que
   * no es la solución), `_default` = cualquier otro objeto. Cada valor, una frase o una lista (bolsa). Prioridad:
   * pareja > `_default` > bolsa del objeto (assets/config/fail-responses.json `items`) > bolsa genérica. Sin marcadores.
   */
  useResponses?: ResponseMap;
}

export interface TriggerData {
  id: string;
  maskRegionId?: string;
  once: boolean;
  /** Bounds in PERCENTAGE coordinates (0-100) relative to background */
  bounds?: { x: number; y: number; w: number; h: number };
  onEnter: ScriptOp[];
  /** If set, trigger only fires when gate passes */
  gate?: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
}

export interface SceneItemData {
  id: string;
  name: string;
  position: { x: number; y: number };
  sprite: string | null;
  pickupScript: ScriptOp[];
  /** If set, item only visible/pickable when gate passes */
  gate?: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
  /** Visual indicator for gated items: 'hidden' = invisible, 'lock' = lock overlay, 'glow' = glow for holders */
  gateIndicator?: 'lock' | 'glow' | 'hidden';
}

export interface ComboData {
  items: [string, string];
  result: string;
  script: ScriptOp[];
}

export interface GotoData {
  id: string;
  targetScene: string;
  spawn: { x: number; y: number };
}

export interface MusicVariation {
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  filterQ?: number;
  volume?: number;
}

export interface ScriptOp {
  op: string;
  [key: string]: unknown;
}

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
    ambience: string | null;
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
  /** Fun responses when the player GIVEs/USEs an item on the NPC (key = item id or _default) */
  giveResponses?: Record<string, string>;
  useResponses?: Record<string, string>;
  /**
   * A2.6: GIVE/USE de ese objeto con la NPC lanza un árbol (`tree`, de la misma escena; por defecto el de la NPC)
   * desde su `start` o desde `node`, en vez del texto de giveResponses/useResponses. `setFlag` se pone antes.
   */
  itemDialogues?: Record<string, NPCItemDialogue>;
  /** A2.2: punto (en %) desde el que se le habla; por defecto, a distancia de conversación del lado del jugador */
  walkTo?: { x: number; y: number };
  /** A2.2: orientación del jugador al llegar; por defecto, de perfil hacia la NPC */
  face?: 'left' | 'right' | 'front' | 'back';
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

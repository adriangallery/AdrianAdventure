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
    /** Per-scene player scale override. Takes precedence over global playerScale. */
    playerScale?: number;
    /** Hide player sprite (for closeup/cinematic scenes) */
    hidePlayer?: boolean;
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
  npcs?: NPCData[];
  dialogues?: Record<string, DialogueTreeData>;
  /** Scripts that run automatically when the scene loads */
  onEnter?: ScriptOp[];
  /** Conditional visual overlays based on wallet/NFT state */
  web3Visuals?: Web3Visual[];
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
  /** Custom scale multiplier for this NPC (default: 1.0) */
  scale?: number;
}

export interface DialogueTreeData {
  id: string;
  start: string;
  nodes: Record<string, DialogueNodeData>;
}

export interface DialogueNodeData {
  speaker?: string;
  text: string;
  choices?: DialogueChoiceData[];
  next?: string;
  onEnter?: ScriptOp[];
  end?: boolean;
}

export interface DialogueChoiceData {
  text: string;
  next: string;
  gate?: { type: string; contract?: string; tokenId?: number; minBalance?: number | string };
  flag?: string;
  setFlag?: string;
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

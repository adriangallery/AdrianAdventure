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
}

export interface NPCData {
  id: string;
  name: string;
  position: { x: number; y: number };
  color?: string;
  dialogueTreeId?: string;
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
}

export interface TriggerData {
  id: string;
  maskRegionId?: string;
  once: boolean;
  /** Bounds in PERCENTAGE coordinates (0-100) relative to background */
  bounds?: { x: number; y: number; w: number; h: number };
  onEnter: ScriptOp[];
}

export interface SceneItemData {
  id: string;
  name: string;
  position: { x: number; y: number };
  sprite: string | null;
  pickupScript: ScriptOp[];
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

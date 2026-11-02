import { SAVE_VERSION } from '@/systems/SaveMigration';
import type { JournalProgress } from '@/systems/Journal';

export enum Verb {
  WALK = 'WALK',
  // Panel verbs — 3x3 grid (Thimbleweed Park order)
  OPEN = 'OPEN',
  PICK = 'PICK',
  PUSH = 'PUSH',
  CLOSE = 'CLOSE',
  LOOK = 'LOOK',
  PULL = 'PULL',
  GIVE = 'GIVE',
  TALK = 'TALK',
  USE = 'USE',
}

/** All verbs including WALK (used by systems). */
export const ALL_VERBS = Object.values(Verb);

/** The 9 verbs displayed in the SCUMM panel (excludes WALK). */
export const PANEL_VERBS: Verb[] = [
  Verb.OPEN,  Verb.PICK,  Verb.PUSH,
  Verb.CLOSE, Verb.LOOK,  Verb.PULL,
  Verb.GIVE,  Verb.TALK,  Verb.USE,
];

export const VERB_ICONS: Record<Verb, string> = {
  [Verb.WALK]: '\u{1F6B6}',   // walking person
  [Verb.OPEN]: '\u{1F513}',   // unlocked
  [Verb.PICK]: '\u{2B07}',    // down arrow
  [Verb.PUSH]: '\u{1F449}',   // pointing right
  [Verb.CLOSE]: '\u{1F512}',  // locked
  [Verb.LOOK]: '\u{1F441}',   // eye
  [Verb.PULL]: '\u{1F448}',   // pointing left
  [Verb.GIVE]: '\u{1F381}',   // gift
  [Verb.TALK]: '\u{1F4AC}',   // speech bubble
  [Verb.USE]: '\u{270B}',     // hand
};

export const VERB_LABELS: Record<Verb, string> = {
  [Verb.WALK]: 'Walk to',
  [Verb.OPEN]: 'Open',
  [Verb.PICK]: 'Pick up',
  [Verb.PUSH]: 'Push',
  [Verb.CLOSE]: 'Close',
  [Verb.LOOK]: 'Look at',
  [Verb.PULL]: 'Pull',
  [Verb.GIVE]: 'Give',
  [Verb.TALK]: 'Talk to',
  [Verb.USE]: 'Use',
};

export interface GameState {
  currentScene: string;
  flags: Record<string, boolean>;
  inventory: InventoryItem[];
  visited: string[];
  /** Player position within current scene (percentage coords) */
  playerPosition?: { pctX: number; pctY: number };
  /** IDs of "once" triggers that have already fired (persisted across sessions) */
  firedTriggers: string[];
  /** Dialogue trees completed per NPC: npcId → completedTreeIds */
  dialogueProgress: Record<string, string[]>;
  /**
   * A2.6: opciones de diálogo ya elegidas, por árbol: treeId → claves (`DialogueSystem.choiceKey`). Se pintan en gris.
   * Opcional: las partidas anteriores a A2.6 no lo traen y cargan igual (sin opciones usadas).
   */
  dialogueUsed?: Record<string, string[]>;
  /**
   * A2.9: diario (móvil de Dex): notas apuntadas, lo ya visto, nivel de pista de Anon por puzle y llamadas. Opcional y
   * aditivo como `dialogueUsed`: las partidas anteriores no lo traen (diario vacío) y SaveMigration lo sanea.
   */
  journal?: JournalProgress;
  /** Achievement IDs that have been earned */
  achievements: string[];
  /** Timestamp of last save */
  savedAt?: number;
  /** A1.4: versión del formato de la partida (ver SaveMigration.ts); sin ella es una partida v1 */
  saveVersion?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  icon: string | null;
  fromNFT: boolean;
}

export function createInitialState(sceneId: string): GameState {
  return {
    saveVersion: SAVE_VERSION,
    currentScene: sceneId,
    flags: {},
    inventory: [],
    visited: [sceneId],
    firedTriggers: [],
    dialogueProgress: {},
    achievements: [],
  };
}

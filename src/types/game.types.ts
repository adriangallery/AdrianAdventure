import { SAVE_VERSION } from '@/systems/SaveMigration';
import type { JournalProgress } from '@/systems/Journal';
import { newRunId } from '@/systems/SaveProgress';

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
  /**
   * A1.13: id de la partida (nuevo en cada «New Game»; a las viejas se les pone uno al cargarlas). El autoguardado
   * no pisa sin copia el autoguardado de OTRA partida con progreso (SaveProgress.autosavePlan).
   */
  runId?: string;
  /**
   * A9.4: tiempo jugado en ms (suma los fotogramas de GameScene, con tope por fotograma). Opcional y aditivo: las
   * partidas de antes no lo traen y empiezan a contar desde 0 al cargarlas.
   */
  playTimeMs?: number;
  /**
   * A9.4: cuándo terminó la partida (al acabar los créditos y el resumen). Opcional: sin él la partida no está terminada.
   * «Continue» sobre una partida terminada vuelve al epílogo (el camino de bajada repite el final) y la portada lo dice.
   */
  completedAt?: number;
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
    runId: newRunId(Date.now(), Math.random()),
    currentScene: sceneId,
    flags: {},
    inventory: [],
    visited: [sceneId],
    firedTriggers: [],
    dialogueProgress: {},
    achievements: [],
  };
}

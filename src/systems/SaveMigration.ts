import type { GameState } from '@/types/game.types';

/**
 * A1.4 (plan SCUMM): versión de las partidas guardadas y migraciones al cargarlas. Lógica pura y sin imports de
 * valores (se prueba con `node --experimental-strip-types`, ver tests/save-migration.test.mjs).
 *
 * Versiones:
 *   1  (implícita: partidas sin `saveVersion`) todo lo anterior a A1.4.
 *   2  A1.4: flags renombradas a nombres veraces (RENAMED_FLAGS).
 *      A2.6: campo aditivo `dialogueUsed` (opcional; sin subir versión): si llega corrupto se descarta.
 *
 * Toda partida que entra en el juego pasa por aquí: los slots locales (`SaveLoadSystem.getAllSlots`), la
 * partida de la wallet en localStorage y la de la nube (`wallet-save`: `loadLocal`, `loadRemoteSlots`,
 * `importWalletSave`) y, de red de seguridad, el estado que `GameScene.create` saca del registry. El servidor de
 * guardado (save-server) no se toca: guarda lo que le manda el cliente, y lo viejo que devuelva se migra aquí.
 */
export const SAVE_VERSION = 2;

/**
 * Flags renombradas: nombre viejo → nombre nuevo. Se aplican SIEMPRE, sea cual sea la versión (es idempotente):
 * un cliente viejo (app de Android o Steam sin actualizar) puede volver a escribir el nombre viejo en una
 * partida que ya era v2.
 */
export const RENAMED_FLAGS: Readonly<Record<string, string>> = {
  // upstairs.hs_desk.OPEN: el cajón da la Trading Terminal Key, no un hardware wallet
  found_hw_wallet: 'found_terminal_key',
};

/**
 * Migra `state` EN SU SITIO (los llamadores ya guardan la referencia) y lo devuelve. La flag nueva queda a true
 * si lo estaba la vieja o la nueva; la vieja desaparece. Tolera estados incompletos o corruptos (sin `flags`).
 */
export function migrateGameState<T extends Partial<GameState> | null | undefined>(state: T): T {
  if (!state || typeof state !== 'object') return state;
  const flags = state.flags;
  if (flags && typeof flags === 'object') {
    for (const [oldName, newName] of Object.entries(RENAMED_FLAGS)) {
      if (!Object.prototype.hasOwnProperty.call(flags, oldName)) continue;
      const merged = Boolean(flags[oldName]) || Boolean(flags[newName]);
      delete flags[oldName];
      flags[newName] = merged;
    }
  }
  // A2.6: opciones de diálogo usadas. Solo se conserva lo que tenga forma de treeId → string[]
  if (state.dialogueUsed !== undefined) {
    const used = state.dialogueUsed as unknown;
    if (!used || typeof used !== 'object' || Array.isArray(used)) {
      delete state.dialogueUsed;
    } else {
      const clean: Record<string, string[]> = {};
      for (const [treeId, keys] of Object.entries(used as Record<string, unknown>)) {
        if (Array.isArray(keys)) clean[treeId] = keys.filter((k): k is string => typeof k === 'string');
      }
      state.dialogueUsed = clean;
    }
  }
  if (typeof state.saveVersion !== 'number' || state.saveVersion < SAVE_VERSION) state.saveVersion = SAVE_VERSION;
  return state;
}

/** Migra el `state` de cualquier envoltorio de partida (`SaveSlot`, `WalletSave`) y devuelve el envoltorio. */
export function migrateSave<S extends { state?: Partial<GameState> | null } | null | undefined>(save: S): S {
  if (save && typeof save === 'object') migrateGameState(save.state);
  return save;
}

import type { GameState } from '@/types/game.types';

/**
 * A1.4 (plan SCUMM): versión de las partidas guardadas y migraciones al cargarlas. Lógica pura y sin imports de
 * valores (se prueba con `node --experimental-strip-types`, ver tests/save-migration.test.mjs).
 *
 * Versiones:
 *   1  (implícita: partidas sin `saveVersion`) todo lo anterior a A1.4.
 *   2  A1.4: flags renombradas a nombres veraces (RENAMED_FLAGS).
 *      A2.6: campo aditivo `dialogueUsed` (opcional; sin subir versión): si llega corrupto se descarta.
 *      A2.9: campo aditivo `journal` (diario: notas, vistos, nivel de pista por puzle, llamadas; opcional, sin subir
 *      versión): si no es un objeto se descarta; si lo es, se queda solo lo que tenga la forma esperada (la misma regla
 *      que `progressFrom` de Journal.ts).
 *      A1.13: campo aditivo `runId` (id de partida, opcional, sin subir versión): si no es un id válido se descarta.
 *      A7.2: `playerPosition` (ya existía, opcional) se sanea: si no son dos números finitos en 0..100 se descarta y
 *      la partida carga en el spawn por defecto de la escena (ver `savedSpawn`).
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
  // A2.9: diario. notes/seen = listas de ids (sin repetir), hints = puzzleId → nivel 1..3, calls = entero ≥ 0
  if (state.journal !== undefined) {
    const raw = state.journal as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      delete state.journal;
    } else {
      const r = raw as Record<string, unknown>;
      const ids = (v: unknown) => [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])];
      const hints: Record<string, number> = {};
      if (r.hints && typeof r.hints === 'object' && !Array.isArray(r.hints)) {
        for (const [k, v] of Object.entries(r.hints as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 1) hints[k] = Math.min(3, Math.floor(v));
        }
      }
      const calls = typeof r.calls === 'number' && Number.isFinite(r.calls) && r.calls >= 0 ? Math.floor(r.calls) : 0;
      state.journal = { notes: ids(r.notes), seen: ids(r.seen), hints, calls };
    }
  }
  // A1.13: id de partida opcional; si no es un id válido se descarta (la partida se trata como vieja)
  if (state.runId !== undefined && !(typeof state.runId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(state.runId))) {
    delete state.runId;
  }
  // A7.2: posición del jugador en la escena guardada (en %); corrupta = se descarta (spawn por defecto)
  if (state.playerPosition !== undefined) {
    const pos = cleanPosition(state.playerPosition);
    if (pos) state.playerPosition = pos; else delete state.playerPosition;
  }
  if (typeof state.saveVersion !== 'number' || state.saveVersion < SAVE_VERSION) state.saveVersion = SAVE_VERSION;
  return state;
}

function cleanPosition(raw: unknown): { pctX: number; pctY: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { pctX, pctY } = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  return ok(pctX) && ok(pctY) ? { pctX, pctY } : null;
}

/**
 * A7.2: punto donde aparece el jugador al cargar `state`: su `playerPosition` si es válida, o `null` (= el spawn por
 * defecto de la escena; partidas viejas o posición corrupta). `{ x, y }` en %, el formato de `spawnOverride`.
 */
export function savedSpawn(state: Partial<GameState> | null | undefined): { x: number; y: number } | null {
  const p = state && typeof state === 'object' ? cleanPosition(state.playerPosition) : null;
  return p ? { x: p.pctX, y: p.pctY } : null;
}

/** Migra el `state` de cualquier envoltorio de partida (`SaveSlot`, `WalletSave`) y devuelve el envoltorio. */
export function migrateSave<S extends { state?: Partial<GameState> | null } | null | undefined>(save: S): S {
  if (save && typeof save === 'object') migrateGameState(save.state);
  return save;
}

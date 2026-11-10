import type { GameState } from '@/types/game.types';

/**
 * A1.12 (plan SCUMM): guardado de partida fiable. Lógica PURA (sin Phaser ni DOM, sin imports de valores): el
 * almacenamiento local y el `fetch` de la nube se inyectan, así que se prueba con `node --experimental-strip-types`
 * (tests/save-slots.test.mjs).
 *
 * Reglas:
 *   - «Guardado» solo tras confirmar la escritura: en local se relee el slot y se compara la huella (escena, flags,
 *     inventario, fecha); en la nube, respuesta 2xx + relectura del MISMO slot con la misma huella.
 *   - Slots: 0 = autoguardado (lo escribe solo el autoguardado), 1-2 = manuales (solo con acción del jugador),
 *     3 = «Before load» (copia de seguridad que se hace antes de cargar otra partida; solo en este dispositivo).
 *   - Al listar un slot que existe en local y en la nube gana el MÁS RECIENTE (antes ganaba siempre la nube, y un
 *     guardado local bueno quedaba tapado por una copia vieja de la nube).
 *   - Tocar un slot nunca carga en un clic: `slotTapAction` decide guardar / confirmar sobrescritura / confirmar carga.
 */

export const SAVE_KEY = 'adrian_adventure_save';
export const AUTOSAVE_SLOT = 0;
export const MANUAL_SLOTS = [1, 2] as const;
export const BACKUP_SLOT = 3;
/** Slots que acepta el save-server (lista blanca; el de seguridad es solo local). */
export const CLOUD_SLOTS = [0, 1, 2] as const;
/** La sesión firmada caduca a las 24 h en el servidor; el cliente la da por caducada un poco antes. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SESSION_MARGIN_MS = 10 * 60 * 1000;

export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SlotRecord {
  id: number;
  state: GameState;
  timestamp: number;
  sceneName: string;
}

export interface SlotView {
  slotId: number;
  state: GameState;
  sceneName: string;
  timestamp: number;
  source: 'local' | 'cloud';
}

export type SaveError = 'no-game' | 'storage-full' | 'storage-error' | 'verify-failed';
export type SaveResult = { ok: true; record: SlotRecord } | { ok: false; error: SaveError };

type Migrate = (slot: SlotRecord) => unknown;

export function slotLabel(slotId: number): string {
  if (slotId === AUTOSAVE_SLOT) return 'Autosave';
  if (slotId === BACKUP_SLOT) return 'Before load';
  return `Slot ${slotId}`;
}

/** Huella de lo que importa de una partida: escena, flags activas, inventario y fecha de guardado. */
export function saveFingerprint(state: GameState | null | undefined, sceneName?: string): string {
  if (!state) return '';
  const flags = Object.keys(state.flags ?? {}).filter((k) => state.flags[k]).sort();
  const inv = (state.inventory ?? []).map((i) => (typeof i === 'string' ? i : i?.id)).sort();
  return JSON.stringify({
    scene: state.currentScene ?? null,
    sceneName: sceneName ?? null,
    flags,
    inv,
    savedAt: state.savedAt ?? null,
  });
}

/** Todos los slots locales (corruptos o ilegibles = vacío; `migrate` adapta partidas de versiones anteriores). */
export function readSlots(store: KVStore, migrate?: Migrate): Record<number, SlotRecord> {
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return {};
    const slots = JSON.parse(raw) as Record<number, SlotRecord> | null;
    if (!slots || typeof slots !== 'object') return {};
    if (migrate) for (const slot of Object.values(slots)) if (slot) migrate(slot);
    return slots;
  } catch {
    return {};
  }
}

export function readSlot(store: KVStore, slotId: number, migrate?: Migrate): SlotRecord | null {
  return readSlots(store, migrate)[slotId] ?? null;
}

/**
 * Escribe la partida en `slotId` y la RELEE: solo devuelve ok si lo leído tiene la misma huella. Los demás slots no
 * se tocan. Si la escritura falla (p. ej. almacenamiento lleno) lo dice; la partida en memoria no se modifica.
 */
export function writeSlotVerified(
  store: KVStore, slotId: number, state: GameState | null | undefined, sceneName: string, now: number,
): SaveResult {
  if (!state) return { ok: false, error: 'no-game' };
  const record: SlotRecord = { id: slotId, state: JSON.parse(JSON.stringify(state)) as GameState, timestamp: now, sceneName };
  try {
    const slots = readSlots(store);
    slots[slotId] = record;
    store.setItem(SAVE_KEY, JSON.stringify(slots));
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    return { ok: false, error: /quota/i.test(name) || /quota/i.test(String(err)) ? 'storage-full' : 'storage-error' };
  }
  const back = readSlot(store, slotId);
  if (!back || back.timestamp !== now || back.sceneName !== sceneName
    || saveFingerprint(back.state, sceneName) !== saveFingerprint(state, sceneName)) {
    return { ok: false, error: 'verify-failed' };
  }
  return { ok: true, record: back };
}

export function deleteSlotLocal(store: KVStore, slotId: number): void {
  const slots = readSlots(store);
  delete slots[slotId];
  store.setItem(SAVE_KEY, JSON.stringify(slots));
}

/** Copia de seguridad «Before load» de la partida actual, antes de cargar otra. */
export function backupBeforeLoad(store: KVStore, state: GameState | null | undefined, sceneName: string, now: number): SaveResult {
  return writeSlotVerified(store, BACKUP_SLOT, state, sceneName, now);
}

interface RemoteSave {
  state?: GameState;
  sceneName?: string;
  timestamp?: number;
  savedAt?: number;
}

/** Lo que enseña el panel para un slot: el guardado más reciente entre el local y el de la nube. */
export function pickSlotView(slotId: number, local: SlotRecord | null | undefined, remote: RemoteSave | null | undefined): SlotView | null {
  const l: SlotView | null = local?.state
    ? { slotId, state: local.state, sceneName: local.sceneName, timestamp: local.timestamp ?? 0, source: 'local' }
    : null;
  const r: SlotView | null = remote?.state
    ? { slotId, state: remote.state, sceneName: remote.sceneName ?? 'Unknown', timestamp: remote.timestamp ?? remote.savedAt ?? 0, source: 'cloud' }
    : null;
  if (l && r) return r.timestamp > l.timestamp ? r : l;
  return l ?? r;
}

export type PanelMode = 'save' | 'load';
export type TapAction = 'save-now' | 'confirm-overwrite' | 'confirm-load' | 'none';

/** Qué hace tocar un slot. Nunca carga directamente: en modo cargar siempre pide confirmación. */
export function slotTapAction(mode: PanelMode, slotId: number, view: SlotView | null, hasGame: boolean): TapAction {
  if (mode === 'save') {
    if (!hasGame || !(MANUAL_SLOTS as readonly number[]).includes(slotId)) return 'none';
    return view ? 'confirm-overwrite' : 'save-now';
  }
  return view ? 'confirm-load' : 'none';
}

// ─── Nube ────────────────────────────────────────────────────

export interface SessionAuth { signature: string; timestamp: number }

export type CloudError = 'no-session' | 'session-expired' | 'invalid-slot' | 'http' | 'network' | 'verify-failed';
export type CloudResult = { ok: true } | { ok: false; error: CloudError; status?: number };

export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean; status: number; json(): Promise<unknown>;
  }>;
}

export function sessionUsable(auth: SessionAuth | null | undefined, now: number): boolean {
  return !!auth && !!auth.signature && now - auth.timestamp < SESSION_MAX_AGE_MS - SESSION_MARGIN_MS && auth.timestamp <= now + 5 * 60 * 1000;
}

/**
 * Sube la partida al slot `slot` de la nube y lo RELEE: ok solo con 2xx y la misma huella (escena, flags,
 * inventario, fecha) y el mismo `timestamp`. Sin sesión firmada no se intenta (el servidor la exige).
 */
export async function cloudSaveVerified(opts: {
  fetch: FetchLike; base: string; address: string; auth: SessionAuth | null | undefined;
  state: GameState; sceneName: string; slot: number; now: number;
}): Promise<CloudResult> {
  const { base, slot, state, sceneName, now } = opts;
  const addr = opts.address.toLowerCase();
  if (!(CLOUD_SLOTS as readonly number[]).includes(slot)) return { ok: false, error: 'invalid-slot' };
  if (!opts.auth) return { ok: false, error: 'no-session' };
  if (!sessionUsable(opts.auth, now)) return { ok: false, error: 'session-expired' };
  const body = {
    state, address: addr, timestamp: now, sceneName, slot,
    authSignature: opts.auth.signature, authTimestamp: opts.auth.timestamp,
  };
  try {
    const resp = await opts.fetch(`${base}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, error: resp.status === 401 ? 'session-expired' : 'http', status: resp.status };
    const check = await opts.fetch(`${base}/save/${addr}/${slot}`);
    if (!check.ok) return { ok: false, error: 'verify-failed', status: check.status };
    const back = (await check.json()) as RemoteSave | null;
    if (!back || back.timestamp !== now || saveFingerprint(back.state, back.sceneName) !== saveFingerprint(state, sceneName)) {
      return { ok: false, error: 'verify-failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Texto (inglés, como el juego) para un error de guardado. */
export function saveErrorMessage(err: SaveError | CloudError, status?: number): string {
  switch (err) {
    case 'no-game': return 'Nothing to save yet.';
    case 'storage-full': return 'Device storage is full. Not saved.';
    case 'storage-error': return 'Could not write to this device. Not saved.';
    case 'verify-failed': return 'Save could not be verified. Try again.';
    case 'no-session': return 'Cloud save needs a wallet signature.';
    case 'session-expired': return 'Wallet signature expired. Sign again to save to the cloud.';
    case 'invalid-slot': return 'This slot cannot be saved to the cloud.';
    case 'http': return `Cloud server error${status ? ` (${status})` : ''}. Not saved to the cloud.`;
    case 'network': return 'Cloud unreachable. Not saved to the cloud.';
  }
}

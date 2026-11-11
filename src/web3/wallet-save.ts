import type { GameState } from '@/types/game.types';
import { getWalletState, getSessionAuth } from './wallet';
import { migrateSave } from '@/systems/SaveMigration';
import { cloudSaveVerified, sessionUsable, type CloudResult } from '@/systems/SaveSlots';
import { autosavePlan, hasProgress } from '@/systems/SaveProgress';


const WALLET_SAVE_PREFIX = 'adrian_adventure_wallet_';
const SAVE_SERVER = 'https://save.zerothetoken.com';

export interface WalletSave {
  state: GameState;
  address: string;
  timestamp: number;
  signature: string | null;
  sceneName: string;
}

// ─── Local storage (fast, always available) ──────────────────

/** Save game state locally keyed by wallet address */
function saveLocal(address: string, state: GameState, sceneName: string): void {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  const save: WalletSave = {
    state: structuredClone(state),
    address: address.toLowerCase(),
    timestamp: Date.now(),
    signature: null,
    sceneName,
  };
  localStorage.setItem(key, JSON.stringify(save));
}

/** Load from local storage */
function loadLocal(address: string): WalletSave | null {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    // A1.4: partidas de versiones anteriores (flags renombradas)
    return migrateSave(JSON.parse(raw) as WalletSave);
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Save game state for a wallet (local only — fast, no signature popup).
 * Use saveForWalletRemote() for cross-device sync (requires wallet signature).
 */
export function saveForWallet(address: string, state: GameState, sceneName: string): void {
  // A1.13: el autoguardado de cartera sigue la regla del slot 0: un estado vacío no pisa nada, y la partida de cartera
  // con progreso de OTRA partida se conserva en `<clave>_prev` (también la ve «Continue») antes de pisarla.
  const existing = loadLocal(address);
  const plan = autosavePlan(existing?.state, state);
  if (!plan.write) return;
  if (plan.backupExisting && existing) {
    try {
      localStorage.setItem(`${WALLET_SAVE_PREFIX}${address.toLowerCase()}_prev`, JSON.stringify(existing));
    } catch { return; }
  }
  saveLocal(address, state, sceneName);
}

/**
 * A1.12: sube la partida al slot `slot` de la nube y lo RELEE (ver SaveSlots.cloudSaveVerified). Antes devolvía false
 * en silencio y el panel decía «saved» igual; ahora el que llama recibe el motivo del fallo y lo enseña.
 * El servidor exige la firma de sesión de la wallet (`authorizeSession`); sin ella devuelve `no-session` sin llamar.
 */
export async function saveForWalletRemote(address: string, state: GameState, sceneName: string, slot = 1): Promise<CloudResult> {
  saveLocal(address, state, sceneName);
  const res = await cloudSaveVerified({
    fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }), base: SAVE_SERVER, address, auth: getSessionAuth(),
    state, sceneName, slot, now: Date.now(),
  });
  if (!res.ok) console.warn(`Remote save slot ${slot} failed: ${res.error}${res.status ? ` (${res.status})` : ''}`);
  return res;
}

/**
 * Load all remote slots for a wallet. Returns { 1: WalletSave, 2: WalletSave } or null.
 */
export async function loadRemoteSlots(address: string): Promise<Record<number, WalletSave> | null> {
  try {
    const resp = await fetch(`${SAVE_SERVER}/save/${address.toLowerCase()}`, { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json() as { slots: Record<number, WalletSave> };
      // A1.4: lo que devuelve la nube puede ser de antes del renombrado de flags
      for (const save of Object.values(data.slots ?? {})) migrateSave(save);
      return data.slots ?? null;
    }
  } catch {
    console.warn('Remote slots unavailable');
  }
  return null;
}

/**
 * Load best save for a wallet (highest progress from any slot). Tries remote first.
 */
export async function loadForWallet(address: string): Promise<WalletSave | null> {
  const local = loadLocal(address);
  const remote = await loadRemoteSlots(address);
  const remoteBest = remote
    ? Object.values(remote).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0] ?? null
    : null;
  // V7: gana la partida más reciente. Antes la nube pisaba siempre la local, y un progreso local más nuevo
  // (jugado sin conexión o antes del último sync) se perdía al conectar la wallet.
  if (remoteBest && (!local || (remoteBest.timestamp ?? 0) > (local.timestamp ?? 0))) {
    saveLocal(address, remoteBest.state, remoteBest.sceneName);
    return remoteBest;
  }
  return local;
}

/** Slot remoto del autoguardado en la nube (el servidor acepta 0 = autosave, 1-2 = manuales). */
export const CLOUD_AUTOSAVE_SLOT = 0;
const CLOUD_AUTOSAVE_MIN_MS = 60 * 1000;
let lastCloudAutosaveAt = 0;

/**
 * V7: sube el autoguardado a la nube como mucho una vez por minuto. Nunca bloquea ni lanza: si falla,
 * el guardado local ya está hecho y el siguiente cambio de escena lo reintenta.
 */
export function cloudAutosave(address: string, state: GameState, sceneName: string): void {
  const now = Date.now();
  if (now - lastCloudAutosaveAt < CLOUD_AUTOSAVE_MIN_MS) return;
  // A1.13: un estado sin progreso nunca sube a la nube (pisaría el autoguardado de la nube con una partida vacía)
  if (!hasProgress(state)) return;
  // A1.12: sin firma de sesión el servidor rechaza; no se intenta (el panel ofrece firmar). Solo escribe el slot 0.
  if (!sessionUsable(getSessionAuth(), now)) return;
  lastCloudAutosaveAt = now;
  void saveForWalletRemote(address, state, sceneName, CLOUD_AUTOSAVE_SLOT);
}

/** Quick check (local only, sync) */
export function hasWalletSave(address: string): boolean {
  return loadLocal(address) !== null;
}

/** Delete local save */
export function deleteWalletSave(address: string): void {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  localStorage.removeItem(key);
}

/** Sign and export save as downloadable JSON */
export async function exportSignedWalletSave(state: GameState, sceneName: string): Promise<string | null> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) return null;

  const timestamp = Date.now();
  const message = JSON.stringify({ state, address, timestamp });

  try {
    const signature = await walletClient.signMessage({ account: address, message });
    const save: WalletSave = { state, address, timestamp, signature, sceneName };
    return JSON.stringify(save, null, 2);
  } catch (err) {
    console.error('Failed to sign save:', err);
    return null;
  }
}

/** Import save from JSON string */
export function importWalletSave(json: string): WalletSave | null {
  try {
    const save = JSON.parse(json) as WalletSave;
    if (!save.state || !save.address) return null;
    return migrateSave(save);
  } catch {
    return null;
  }
}

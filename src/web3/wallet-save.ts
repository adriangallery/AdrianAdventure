import type { GameState } from '@/types/game.types';
import { getWalletState } from './wallet';

const WALLET_SAVE_PREFIX = 'adrian_adventure_wallet_';
const SAVE_SERVER = 'https://enchanting-reflection-production-a838.up.railway.app';

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
    return JSON.parse(raw) as WalletSave;
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
  saveLocal(address, state, sceneName);
}

/**
 * Save to remote Railway server for a specific slot (requires wallet signature).
 * Returns true on success.
 */
export async function saveForWalletRemote(address: string, state: GameState, sceneName: string, slot = 1): Promise<boolean> {
  saveLocal(address, state, sceneName);

  const { walletClient } = getWalletState();
  if (!walletClient) return false;

  try {
    const addr = address.toLowerCase();
    const timestamp = Date.now();
    const message = JSON.stringify({ state, address: addr, timestamp });
    const signature = await walletClient.signMessage({ account: addr as `0x${string}`, message });

    const resp = await fetch(`${SAVE_SERVER}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, address: addr, timestamp, signature, sceneName, slot }),
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    console.log(`Remote save synced: slot ${slot} for ${addr}`);
    return true;
  } catch (err) {
    console.warn('Remote save failed:', err);
    return false;
  }
}

/**
 * Load all remote slots for a wallet. Returns { 1: WalletSave, 2: WalletSave } or null.
 */
export async function loadRemoteSlots(address: string): Promise<Record<number, WalletSave> | null> {
  try {
    const resp = await fetch(`${SAVE_SERVER}/save/${address.toLowerCase()}`);
    if (resp.ok) {
      const data = await resp.json() as { slots: Record<number, WalletSave> };
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
  const remote = await loadRemoteSlots(address);
  if (remote) {
    // Return the most recent slot
    const slots = Object.values(remote);
    if (slots.length > 0) {
      const best = slots.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
      saveLocal(address, best.state, best.sceneName);
      return best;
    }
  }

  return loadLocal(address);
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
    return save;
  } catch {
    return null;
  }
}

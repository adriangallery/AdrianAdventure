import type { GameState } from '@/types/game.types';
import { getWalletState } from './wallet';

const WALLET_SAVE_PREFIX = 'adrian_adventure_wallet_';

export interface WalletSave {
  state: GameState;
  address: string;
  timestamp: number;
  signature: string | null;
  sceneName: string;
}

/** Save game state for a specific wallet address */
export function saveForWallet(address: string, state: GameState, sceneName: string): void {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  const save: WalletSave = {
    state: structuredClone(state),
    address: address.toLowerCase(),
    timestamp: Date.now(),
    signature: null, // Signed on export, not on every save
    sceneName,
  };
  localStorage.setItem(key, JSON.stringify(save));
}

/** Load game state for a specific wallet address */
export function loadForWallet(address: string): WalletSave | null {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as WalletSave;
  } catch {
    return null;
  }
}

/** Check if a wallet has a saved game */
export function hasWalletSave(address: string): boolean {
  return loadForWallet(address) !== null;
}

/** Delete a wallet save */
export function deleteWalletSave(address: string): void {
  const key = WALLET_SAVE_PREFIX + address.toLowerCase();
  localStorage.removeItem(key);
}

/**
 * Sign and export a wallet save as a JSON string.
 * The signature proves the save belongs to this wallet.
 */
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

/** Import a wallet save from JSON string */
export function importWalletSave(json: string): WalletSave | null {
  try {
    const save = JSON.parse(json) as WalletSave;
    if (!save.state || !save.address) return null;
    return save;
  } catch {
    return null;
  }
}

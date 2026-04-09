import { getWalletState } from './wallet';
import type { GameState } from '@/types/game.types';

/**
 * On-chain save state via signed messages.
 *
 * The save data lives in localStorage. The wallet signature proves ownership.
 * No gas cost. Can be verified by anyone.
 *
 * TODO: For fully on-chain save, store a hash on the Diamond.
 */

export interface SignedSave {
  state: GameState;
  address: string;
  timestamp: number;
  signature: string;
}

/**
 * Sign the current game state with the connected wallet.
 */
export async function signSaveState(state: GameState): Promise<SignedSave | null> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) {
    throw new Error('Wallet not connected');
  }

  const timestamp = Date.now();
  const message = JSON.stringify({ state, address, timestamp });

  try {
    const signature = await walletClient.signMessage({ account: address, message });
    return { state, address, timestamp, signature };
  } catch (err) {
    console.error('Failed to sign save state:', err);
    return null;
  }
}

/**
 * Export signed save as downloadable JSON string.
 */
export function exportSignedSave(save: SignedSave): string {
  return JSON.stringify(save, null, 2);
}

/**
 * Import and verify a signed save structure.
 */
export function importSignedSave(json: string): SignedSave | null {
  try {
    const save = JSON.parse(json) as SignedSave;
    if (!save.state || !save.address || !save.signature) return null;
    return save;
  } catch {
    return null;
  }
}

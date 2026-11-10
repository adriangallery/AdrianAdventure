import type { GameState } from '@/types/game.types';
import { migrateSave } from '@/systems/SaveMigration';
import { saveForWallet, loadForWallet, hasWalletSave, cloudAutosave, type WalletSave } from '@/web3/wallet-save';
import { SAVE_KEY, writeSlotVerified, readSlots, backupBeforeLoad, deleteSlotLocal, type SaveResult } from '@/systems/SaveSlots';

/** Slots que cuentan como «hay partida» (0 = autoguardado, 1-2 = manuales; el 3 «Before load» no cuenta). */
const MAX_SLOTS = 3;

export interface SaveSlot {
  id: number;
  state: GameState;
  timestamp: number;
  sceneName: string;
}

/**
 * Save/Load system using localStorage.
 * Auto-save on scene transitions (slot 0 = autosave).
 * Manual save/load to slots 1-2.
 * Wallet-linked saves separate per address.
 */
export class SaveLoadSystem {
  private walletAddress: string | null = null;

  /** Set the active wallet address for wallet-linked saves */
  setWalletAddress(address: string | null): void {
    this.walletAddress = address;
  }

  /**
   * Auto-save the current state (slot 0 + wallet save if connected).
   */
  autoSave(state: GameState, sceneName: string): boolean {
    // Solo el slot 0 (A1.12: el autoguardado nunca toca los manuales 1-2 ni «Before load»)
    const ok = this.saveToSlot(0, state, sceneName).ok;
    // Also save to wallet-linked storage if connected
    if (this.walletAddress) {
      saveForWallet(this.walletAddress, state, sceneName);
      // V7: copia en la nube (slot 0) para continuar desde otro dispositivo; limitada a 1/min
      cloudAutosave(this.walletAddress, state, sceneName);
    }
    return ok;
  }

  /**
   * Save to a specific slot (0 = autosave, 1-2 = manual). A1.12: relee lo escrito y devuelve si de verdad quedó
   * guardado (antes no devolvía nada y el panel decía «saved» pasara lo que pasara).
   */
  saveToSlot(slotId: number, state: GameState, sceneName: string): SaveResult {
    const res = writeSlotVerified(localStorage, slotId, state, sceneName, Date.now());
    if (!res.ok) console.warn(`Save slot ${slotId} failed: ${res.error}`);
    return res;
  }

  /** A1.12: copia de seguridad «Before load» de la partida actual antes de cargar otra. */
  backupBeforeLoad(state: GameState, sceneName: string): SaveResult {
    return backupBeforeLoad(localStorage, state, sceneName, Date.now());
  }

  /**
   * Load from a specific slot. Returns null if empty.
   */
  loadFromSlot(slotId: number): SaveSlot | null {
    const slots = this.getAllSlots();
    return slots[slotId] ?? null;
  }

  /**
   * Load the autosave (slot 0).
   */
  loadAutoSave(): SaveSlot | null {
    return this.loadFromSlot(0);
  }

  /**
   * Get all save slots.
   */
  getAllSlots(): Record<number, SaveSlot> {
    // A1.4: partidas de versiones anteriores (flags renombradas)
    return readSlots(localStorage, (slot) => migrateSave(slot));
  }

  /**
   * Get list of available (non-empty) slots for display.
   */
  getAvailableSlots(): SaveSlot[] {
    const slots = this.getAllSlots();
    const result: SaveSlot[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (slots[i]) result.push(slots[i]);
    }
    return result;
  }

  /**
   * Delete a save slot.
   */
  deleteSlot(slotId: number): void {
    deleteSlotLocal(localStorage, slotId);
  }

  /**
   * Check if any save exists.
   */
  hasSave(): boolean {
    return this.getAvailableSlots().length > 0;
  }

  /**
   * Clear all saves.
   */
  clearAll(): void {
    localStorage.removeItem(SAVE_KEY);
  }

  // ─── Wallet-linked saves ──────────────────────────────────

  /** Check if the connected wallet has a save */
  hasWalletSave(address: string): boolean {
    return hasWalletSave(address);
  }

  /** Load the wallet-linked save (async — tries remote first) */
  async loadWalletSave(address: string): Promise<WalletSave | null> {
    return loadForWallet(address);
  }
}

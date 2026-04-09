import type { GameState } from '@/types/game.types';

const SAVE_KEY = 'adrian_adventure_save';
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
 */
export class SaveLoadSystem {
  /**
   * Auto-save the current state (slot 0).
   */
  autoSave(state: GameState, sceneName: string): void {
    this.saveToSlot(0, state, sceneName);
  }

  /**
   * Save to a specific slot (0 = autosave, 1-2 = manual).
   */
  saveToSlot(slotId: number, state: GameState, sceneName: string): void {
    const slots = this.getAllSlots();
    slots[slotId] = {
      id: slotId,
      state: structuredClone(state),
      timestamp: Date.now(),
      sceneName,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
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
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<number, SaveSlot>;
    } catch {
      return {};
    }
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
    const slots = this.getAllSlots();
    delete slots[slotId];
    localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
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
}

import type { GameState, InventoryItem } from '@/types/game.types';

/**
 * Manages game items and (future) NFT items in a unified inventory.
 * Emits events via a callback when the inventory changes.
 */
export class InventorySystem {
  private onChange: (() => void) | null = null;
  private getState: () => GameState;
  private setState: (updater: (s: GameState) => GameState) => void;

  constructor(
    getState: () => GameState,
    setState: (updater: (s: GameState) => GameState) => void,
  ) {
    this.getState = getState;
    this.setState = setState;
  }

  onChanged(cb: () => void): void {
    this.onChange = cb;
  }

  getItems(): InventoryItem[] {
    return this.getState().inventory;
  }

  getGameItems(): InventoryItem[] {
    return this.getState().inventory.filter((i) => !i.fromNFT);
  }

  getNFTItems(): InventoryItem[] {
    return this.getState().inventory.filter((i) => i.fromNFT);
  }

  hasItem(id: string): boolean {
    return this.getState().inventory.some((i) => i.id === id);
  }

  addItem(id: string, name: string, icon?: string): void {
    if (this.hasItem(id)) return;
    this.setState((s) => ({
      ...s,
      inventory: [...s.inventory, { id, name, icon: icon ?? null, fromNFT: false }],
    }));
    this.onChange?.();
  }

  removeItem(id: string): void {
    this.setState((s) => ({
      ...s,
      inventory: s.inventory.filter((i) => i.id !== id),
    }));
    this.onChange?.();
  }

  addNFTItem(id: string, name: string, icon: string | null): void {
    if (this.hasItem(id)) return;
    this.setState((s) => ({
      ...s,
      inventory: [...s.inventory, { id, name, icon, fromNFT: true }],
    }));
    this.onChange?.();
  }

  count(): number {
    return this.getState().inventory.length;
  }
}

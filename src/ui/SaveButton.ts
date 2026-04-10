import Phaser from 'phaser';
import type { GameState } from '@/types/game.types';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { getWalletState } from '@/web3/wallet';
import { exportSignedWalletSave, importWalletSave, saveForWalletRemote, loadForWallet } from '@/web3/wallet-save';
import type { GameScene } from '@/scenes/GameScene';
import { TWP, FONT } from '@/config/theme';

/**
 * Floppy disk save button — top-left corner.
 * Unified save system: wallet connected = wallet-keyed saves, otherwise anonymous.
 */
export class SaveButton {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.container = scene.add.container(8, 8).setDepth(600);

    const bg = scene.add.rectangle(0, 0, 30, 24, TWP.WALLET_BG, 0.85)
      .setStrokeStyle(1, TWP.WALLET_BORDER, 0.6)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    const label = scene.add.text(15, 12, '\u{1F4BE}', {
      fontSize: '14px',
    }).setOrigin(0.5, 0.5);

    this.container.add([bg, label]);
    bg.on('pointerdown', () => this.showMenu());
  }

  private showMenu(): void {
    const overlay = document.createElement('div');
    overlay.id = 'save-load-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(6,6,12,0.9);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1a1a2e; border: 2px solid #5b3a8c;
      border-radius: 8px; padding: 24px; text-align: center;
      max-width: 360px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const { address } = getWalletState();
    const isWallet = !!address;

    const title = document.createElement('div');
    title.textContent = isWallet
      ? `\u{1F4BE} Save Game (${address!.slice(0, 6)}...${address!.slice(-4)})`
      : '\u{1F4BE} Save Game';
    title.style.cssText = 'color: #f8e848; font-size: 11px; margin-bottom: 16px; line-height: 1.5;';
    modal.appendChild(title);

    if (isWallet) {
      const hint = document.createElement('div');
      hint.textContent = '\u{1F517} Saves linked to your wallet';
      hint.style.cssText = 'color: #3396ff; font-size: 7px; margin-bottom: 14px;';
      modal.appendChild(hint);
    }

    const cleanup = () => overlay.remove();

    const saveSystem = new SaveLoadSystem();
    if (isWallet) saveSystem.setWalletAddress(address!);
    // Sync player position before showing menu
    const gs = this.scene.scene.get('GameScene') as GameScene | undefined;
    gs?.syncPlayerPosition?.();
    const gameState = this.scene.registry.get('gameState') as GameState | undefined;
    const sceneData = this.scene.registry.get('sceneData') as { title?: string } | undefined;
    const sceneName = sceneData?.title ?? 'Unknown';

    const makeBtn = (text: string, enabled: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.disabled = !enabled;
      btn.style.cssText = `
        display: block; width: 100%; padding: 10px 16px; margin-bottom: 8px;
        background: ${enabled ? '#2a2a4e' : '#1a1a2e'}; border: 1px solid ${enabled ? '#5b3a8c' : '#333'};
        border-radius: 6px; color: ${enabled ? '#e8d5f5' : '#555'};
        font-family: 'Press Start 2P', monospace; font-size: 9px;
        cursor: ${enabled ? 'pointer' : 'not-allowed'}; text-align: left;
      `;
      if (enabled) {
        btn.onmouseenter = () => { btn.style.background = '#3a3a6e'; };
        btn.onmouseleave = () => { btn.style.background = '#2a2a4e'; };
        btn.onclick = onClick;
      }
      return btn;
    };

    // Save slots 1 & 2
    for (const slotId of [1, 2]) {
      const slot = saveSystem.loadFromSlot(slotId);
      const slotLabel = slot
        ? `${slot.sceneName} — ${new Date(slot.timestamp).toLocaleDateString()}`
        : 'Empty';
      modal.appendChild(makeBtn(`\u{1F4BE} Save Slot ${slotId}: ${slotLabel}`, !!gameState, async () => {
        if (gameState) {
          gameState.savedAt = Date.now();
          saveSystem.saveToSlot(slotId, gameState, sceneName);
          // Also sync to Railway if wallet connected
          if (isWallet) {
            saveForWalletRemote(address!, gameState, sceneName).catch(() => {});
          }
          cleanup();
        }
      }));
    }

    // Separator
    const sep = document.createElement('hr');
    sep.style.cssText = 'border: none; border-top: 1px solid #333; margin: 12px 0;';
    modal.appendChild(sep);

    // Load slots 1 & 2
    for (const slotId of [1, 2]) {
      const slot = saveSystem.loadFromSlot(slotId);
      const slotLabel = slot
        ? `${slot.sceneName} — ${new Date(slot.timestamp).toLocaleDateString()}`
        : 'Empty';
      modal.appendChild(makeBtn(`\u{1F4C2} Load Slot ${slotId}: ${slotLabel}`, !!slot, () => {
        if (slot) {
          if (!slot.state.firedTriggers) slot.state.firedTriggers = [];
          if (!slot.state.dialogueProgress) slot.state.dialogueProgress = {};
          this.scene.registry.set('gameState', slot.state);
          this.scene.registry.set('currentSceneId', slot.state.currentScene);
          cleanup();
          this.scene.scene.stop('UIScene');
          this.scene.scene.stop('GameScene');
          this.scene.scene.start('PreloadScene');
        }
      }));
    }

    // Wallet-only features
    if (isWallet) {
      const sep2 = document.createElement('hr');
      sep2.style.cssText = 'border: none; border-top: 1px solid #3396ff44; margin: 12px 0;';
      modal.appendChild(sep2);

      // Export signed save (downloads JSON with wallet signature)
      modal.appendChild(makeBtn('\u{1F4E4} Export Signed Save', !!gameState, async () => {
        if (gameState) {
          const json = await exportSignedWalletSave(gameState, sceneName);
          if (json) {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zeroadventure_${address!.slice(0, 8)}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }
          cleanup();
        }
      }));

      // Import signed save
      modal.appendChild(makeBtn('\u{1F4E5} Import Signed Save', true, () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const save = importWalletSave(reader.result as string);
            if (save && save.address.toLowerCase() === address!.toLowerCase()) {
              if (!save.state.firedTriggers) save.state.firedTriggers = [];
              if (!save.state.dialogueProgress) save.state.dialogueProgress = {};
              this.scene.registry.set('gameState', save.state);
              this.scene.registry.set('currentSceneId', save.state.currentScene);
              cleanup();
              this.scene.scene.stop('UIScene');
              this.scene.scene.stop('GameScene');
              this.scene.scene.start('PreloadScene');
            } else {
              alert('Save file does not match connected wallet.');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      }));
    }

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      display: block; width: 100%; padding: 8px 16px; margin-top: 12px;
      background: transparent; border: 1px solid #444; border-radius: 6px;
      color: #888; font-family: 'Press Start 2P', monospace; font-size: 8px;
      cursor: pointer;
    `;
    closeBtn.onclick = cleanup;
    modal.appendChild(closeBtn);

    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  destroy(): void {
    this.container.destroy();
    document.getElementById('save-load-overlay')?.remove();
  }
}

import Phaser from 'phaser';
import type { GameState } from '@/types/game.types';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { getWalletState } from '@/web3/wallet';
import { hasWalletSave, loadForWallet, exportSignedWalletSave } from '@/web3/cloud-save';
import { TWP, FONT } from '@/config/theme';

/**
 * Floppy disk save button — top-right, next to wallet button.
 */
export class SaveButton {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const { width } = scene.scale;
    const fontSize = Math.max(10, Math.min(14, Math.floor(width * 0.012)));

    // Position to the left of wallet button
    this.container = scene.add.container(width - 140, 8).setDepth(600);

    const bg = scene.add.rectangle(0, 0, 28, 24, TWP.WALLET_BG, 0.85)
      .setStrokeStyle(1, TWP.WALLET_BORDER, 0.6)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });

    const label = scene.add.text(-6, 4, '\u{1F4BE}', {
      fontFamily: FONT.FAMILY,
      fontSize: `${fontSize}px`,
    }).setOrigin(1, 0);

    this.container.add([bg, label]);
    bg.on('pointerdown', () => this.showMenu());

    scene.scale.on('resize', (gs: Phaser.Structs.Size) => {
      this.container.setPosition(gs.width - 140, 8);
    });
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
      max-width: 360px; width: 90%;
    `;

    const title = document.createElement('div');
    title.textContent = '\u{1F4BE} Game Menu';
    title.style.cssText = 'color: #f8e848; font-size: 12px; margin-bottom: 20px;';
    modal.appendChild(title);

    const cleanup = () => overlay.remove();

    const saveSystem = new SaveLoadSystem();
    const gameState = this.scene.registry.get('gameState') as GameState | undefined;
    const sceneData = this.scene.registry.get('sceneData') as { title?: string } | undefined;
    const sceneName = sceneData?.title ?? 'Unknown';

    const makeBtn = (text: string, enabled: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.disabled = !enabled;
      btn.style.cssText = `
        display: block; width: 100%; padding: 10px 16px; margin-bottom: 10px;
        background: ${enabled ? '#2a2a4e' : '#1a1a2e'}; border: 1px solid ${enabled ? '#5b3a8c' : '#333'};
        border-radius: 6px; color: ${enabled ? '#e8d5f5' : '#555'};
        font-family: 'Press Start 2P', monospace; font-size: 9px;
        cursor: ${enabled ? 'pointer' : 'not-allowed'};
      `;
      if (enabled) {
        btn.onmouseenter = () => { btn.style.background = '#3a3a6e'; };
        btn.onmouseleave = () => { btn.style.background = '#2a2a4e'; };
        btn.onclick = onClick;
      }
      return btn;
    };

    // Save Slot 1
    const slot1 = saveSystem.loadFromSlot(1);
    const s1Label = slot1 ? `Slot 1 (${slot1.sceneName})` : 'Slot 1 (Empty)';
    modal.appendChild(makeBtn(`\u{1F4BE} Save ${s1Label}`, !!gameState, () => {
      if (gameState) {
        saveSystem.autoSave(gameState, sceneName);
        saveSystem.saveToSlot(1, gameState, sceneName);
        cleanup();
      }
    }));

    // Save Slot 2
    const slot2 = saveSystem.loadFromSlot(2);
    const s2Label = slot2 ? `Slot 2 (${slot2.sceneName})` : 'Slot 2 (Empty)';
    modal.appendChild(makeBtn(`\u{1F4BE} Save ${s2Label}`, !!gameState, () => {
      if (gameState) {
        saveSystem.autoSave(gameState, sceneName);
        saveSystem.saveToSlot(2, gameState, sceneName);
        cleanup();
      }
    }));

    const sep = document.createElement('hr');
    sep.style.cssText = 'border: none; border-top: 1px solid #333; margin: 14px 0;';
    modal.appendChild(sep);

    // Load Slot 1
    modal.appendChild(makeBtn(`\u{1F4C2} Load ${s1Label}`, !!slot1, () => {
      if (slot1) {
        if (!slot1.state.firedTriggers) slot1.state.firedTriggers = [];
        if (!slot1.state.dialogueProgress) slot1.state.dialogueProgress = {};
        this.scene.registry.set('gameState', slot1.state);
        this.scene.registry.set('currentSceneId', slot1.state.currentScene);
        cleanup();
        this.scene.scene.stop('UIScene');
        this.scene.scene.stop('GameScene');
        this.scene.scene.start('PreloadScene');
      }
    }));

    // Load Slot 2
    modal.appendChild(makeBtn(`\u{1F4C2} Load ${s2Label}`, !!slot2, () => {
      if (slot2) {
        if (!slot2.state.firedTriggers) slot2.state.firedTriggers = [];
        if (!slot2.state.dialogueProgress) slot2.state.dialogueProgress = {};
        this.scene.registry.set('gameState', slot2.state);
        this.scene.registry.set('currentSceneId', slot2.state.currentScene);
        cleanup();
        this.scene.scene.stop('UIScene');
        this.scene.scene.stop('GameScene');
        this.scene.scene.start('PreloadScene');
      }
    }));

    // Wallet save section
    const { address } = getWalletState();
    if (address) {
      const wsep = document.createElement('hr');
      wsep.style.cssText = 'border: none; border-top: 1px solid #3396ff44; margin: 14px 0;';
      modal.appendChild(wsep);

      const wLabel = document.createElement('div');
      wLabel.textContent = '\u{1F517} Wallet Save';
      wLabel.style.cssText = 'color: #3396ff; font-size: 8px; margin-bottom: 10px;';
      modal.appendChild(wLabel);

      const hasWS = hasWalletSave(address);
      const walletSave = hasWS ? loadForWallet(address) : null;

      modal.appendChild(makeBtn('\u{1F4BE} Save to Wallet', !!gameState, () => {
        if (gameState) {
          saveSystem.setWalletAddress(address);
          saveSystem.autoSave(gameState, sceneName);
          cleanup();
        }
      }));

      modal.appendChild(makeBtn(
        walletSave ? `\u{1F4C2} Load Wallet (${walletSave.sceneName})` : '\u{1F4C2} No Wallet Save',
        !!walletSave,
        () => {
          if (walletSave) {
            if (!walletSave.state.firedTriggers) walletSave.state.firedTriggers = [];
            if (!walletSave.state.dialogueProgress) walletSave.state.dialogueProgress = {};
            this.scene.registry.set('gameState', walletSave.state);
            this.scene.registry.set('currentSceneId', walletSave.state.currentScene);
            cleanup();
            this.scene.scene.stop('UIScene');
            this.scene.scene.stop('GameScene');
            this.scene.scene.start('PreloadScene');
          }
        }
      ));

      // Export signed save
      modal.appendChild(makeBtn('\u{1F4E4} Export Signed Save', !!gameState, async () => {
        if (gameState) {
          const json = await exportSignedWalletSave(gameState, sceneName);
          if (json) {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zeroadventure_save_${address.slice(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }
          cleanup();
        }
      }));
    }

    // Close
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Close';
    cancelBtn.style.cssText = `
      display: block; width: 100%; padding: 8px 16px; margin-top: 14px;
      background: transparent; border: 1px solid #444; border-radius: 6px;
      color: #888; font-family: 'Press Start 2P', monospace; font-size: 8px;
      cursor: pointer;
    `;
    cancelBtn.onclick = cleanup;
    modal.appendChild(cancelBtn);

    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  destroy(): void {
    this.container.destroy();
    document.getElementById('save-load-overlay')?.remove();
  }
}

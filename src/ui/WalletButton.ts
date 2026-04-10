import Phaser from 'phaser';
import { connectWallet, disconnectWallet, getWalletState, onWalletChange, truncateAddress, hasInjectedWallet, hasWalletConnectConfig, type WalletProviderType } from '@/web3/wallet';
import { getZeroBalance, hasFloppyBoxTokens } from '@/web3/contracts';
import { loadNFTs, type GameNFT } from '@/web3/nft-loader';
import { hasWalletSave, loadForWallet } from '@/web3/wallet-save';
import type { InventorySystem } from '@/systems/InventorySystem';
import { TWP, FONT } from '@/config/theme';

/**
 * Minimal wallet button — top-right, Thimbleweed Park style.
 * Shows a DOM overlay picker for choosing injected vs WalletConnect.
 */
export class WalletButton {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private inventory: InventorySystem | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const { width } = scene.scale;
    const fontSize = Math.max(9, Math.min(12, Math.floor(width * 0.01)));

    this.container = scene.add.container(width - 8, 8).setDepth(600);

    this.bg = scene.add.rectangle(0, 0, 120, 24, TWP.WALLET_BG, 0.85)
      .setStrokeStyle(1, TWP.WALLET_BORDER, 0.6)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });

    this.label = scene.add.text(-6, 5, 'Connect', {
      fontFamily: FONT.FAMILY,
      fontSize: `${fontSize}px`,
      color: TWP.WALLET_TEXT,
    }).setOrigin(1, 0);

    this.container.add([this.bg, this.label]);
    this.bg.on('pointerdown', () => this.handleClick());

    this.unsubscribe = onWalletChange((state) => this.updateDisplay(state.connected, state.address));
    const current = getWalletState();
    if (current.connected) this.updateDisplay(true, current.address);

    scene.scale.on('resize', (gs: Phaser.Structs.Size) => this.container.setPosition(gs.width - 8, 8));
  }

  setInventory(inv: InventorySystem): void { this.inventory = inv; }

  /** Callback for external systems to run after wallet connects (e.g., cloud save check) */
  onConnectedCallback: ((address: string) => void) | null = null;

  private async handleClick(): Promise<void> {
    const state = getWalletState();
    if (state.connected) {
      disconnectWallet();
    } else {
      const choice = await this.showWalletPicker();
      if (!choice) return;
      try {
        this.label.setText('...');
        const ns = await connectWallet(choice);
        await this.onConnected(ns.address!);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed';
        this.label.setText(msg.slice(0, 16));
        this.scene.time.delayedCall(3000, () => this.updateDisplay(false, null));
      }
    }
  }

  private async onConnected(address: string): Promise<void> {
    const balance = await getZeroBalance(address as `0x${string}`);
    if (!this.label?.active) return; // Scene may have changed during async
    this.label.setText(`${truncateAddress(address)} | ${balance} $ZERO`);
    this.resizeBg();

    if (this.inventory) {
      try {
        const nfts: GameNFT[] = await loadNFTs(address);
        for (const nft of nfts) {
          this.inventory.addNFTItem(`nft_${nft.contract}_${nft.tokenId}`, `${nft.filter}: ${nft.name}`, nft.image);
        }
      } catch (err) { console.error('NFT load failed:', err); }

      // Check for AdrianLAB Floppy Box tokens (10000-10010)
      try {
        console.log('Checking floppy box tokens for', address);
        const hasFloppy = await hasFloppyBoxTokens(address as `0x${string}`);
        console.log('Floppy box result:', hasFloppy);
        if (hasFloppy && this.inventory && !this.inventory.hasItem('floppy_box')) {
          this.inventory.addItem('floppy_box', 'Floppy Disc Box');
          console.log('Floppy Disc Box added to inventory');
        }
      } catch (err) { console.error('Floppy box check failed:', err); }
    }

    // Check for existing wallet save and offer to load
    if (hasWalletSave(address)) {
      const walletSave = loadForWallet(address);
      if (walletSave) {
        const shouldLoad = await this.showLoadSavePrompt(walletSave.sceneName, walletSave.timestamp);
        if (shouldLoad) {
          // Restore saved game state
          const registry = this.scene.registry;
          // Ensure backward compat for old saves missing new fields
          if (!walletSave.state.firedTriggers) walletSave.state.firedTriggers = [];
          if (!walletSave.state.dialogueProgress) walletSave.state.dialogueProgress = {};
          registry.set('gameState', walletSave.state);
          registry.set('currentSceneId', walletSave.state.currentScene);
          if (walletSave.state.playerPosition) {
            registry.set('spawnOverride', { x: walletSave.state.playerPosition.pctX, y: walletSave.state.playerPosition.pctY });
          }
          // Restart from PreloadScene to load the saved scene
          this.scene.scene.stop('UIScene');
          this.scene.scene.stop('GameScene');
          this.scene.scene.start('PreloadScene');
          return;
        }
      }
    }

    // Notify external systems
    this.onConnectedCallback?.(address);
  }

  /** Show DOM prompt asking if user wants to load their wallet save */
  private showLoadSavePrompt(sceneName: string, timestamp: number): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'wallet-save-prompt';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(6,6,12,0.85);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Press Start 2P', monospace;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: #1a1a2e; border: 2px solid #5b3a8c;
        border-radius: 8px; padding: 24px; text-align: center;
        max-width: 340px; width: 90%;
      `;

      const title = document.createElement('div');
      title.textContent = 'Welcome back!';
      title.style.cssText = 'color: #f8e848; font-size: 11px; margin-bottom: 16px;';
      modal.appendChild(title);

      const info = document.createElement('div');
      const date = new Date(timestamp).toLocaleDateString();
      info.textContent = `Save found: ${sceneName} (${date})`;
      info.style.cssText = 'color: #aaa; font-size: 8px; margin-bottom: 20px; line-height: 1.6;';
      modal.appendChild(info);

      const cleanup = () => overlay.remove();

      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Load Save';
      loadBtn.style.cssText = `
        display: block; width: 100%; padding: 12px 16px; margin-bottom: 10px;
        background: #2a2a4e; border: 1px solid #5b3a8c; border-radius: 6px;
        color: #e8d5f5; font-family: 'Press Start 2P', monospace; font-size: 10px;
        cursor: pointer;
      `;
      loadBtn.onclick = () => { cleanup(); resolve(true); };
      modal.appendChild(loadBtn);

      const skipBtn = document.createElement('button');
      skipBtn.textContent = 'Continue Playing';
      skipBtn.style.cssText = `
        display: block; width: 100%; padding: 8px 16px;
        background: transparent; border: 1px solid #444; border-radius: 6px;
        color: #888; font-family: 'Press Start 2P', monospace; font-size: 8px;
        cursor: pointer;
      `;
      skipBtn.onclick = () => { cleanup(); resolve(false); };
      modal.appendChild(skipBtn);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  private updateDisplay(connected: boolean, address: string | null): void {
    // Guard: skip if Phaser objects have been destroyed
    if (!this.label?.active || !this.bg?.active) return;
    try {
      if (connected && address) {
        this.label.setText(truncateAddress(address));
        this.bg.setStrokeStyle(1, TWP.WALLET_BORDER_ON, 0.8);
      } else {
        this.label.setText('Connect');
        this.bg.setStrokeStyle(1, TWP.WALLET_BORDER, 0.6);
      }
      this.resizeBg();
    } catch { /* Phaser text canvas destroyed — safe to ignore */ }
  }

  private resizeBg(): void {
    if (!this.bg?.active || !this.label?.active) return;
    this.bg.setSize(Math.max(80, this.label.width + 16), 24);
  }

  /** Show DOM overlay wallet picker — returns provider type or null if cancelled */
  private showWalletPicker(): Promise<WalletProviderType | null> {
    const hasInjected = hasInjectedWallet();
    const hasWC = hasWalletConnectConfig();

    // If only one option available, skip the picker
    if (hasInjected && !hasWC) return Promise.resolve('injected');
    if (!hasInjected && hasWC) return Promise.resolve('walletconnect');
    if (!hasInjected && !hasWC) {
      return Promise.reject(new Error('No wallet options available'));
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'wallet-picker-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(6,6,12,0.85);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Press Start 2P', monospace;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: #1a1a2e; border: 2px solid #5b3a8c;
        border-radius: 8px; padding: 24px; text-align: center;
        max-width: 320px; width: 90%;
      `;

      const title = document.createElement('div');
      title.textContent = 'Connect Wallet';
      title.style.cssText = `
        color: #f8e848; font-size: 12px; margin-bottom: 20px;
      `;
      modal.appendChild(title);

      const cleanup = () => {
        overlay.remove();
      };

      // Browser Wallet button
      const injBtn = document.createElement('button');
      injBtn.textContent = 'Browser Wallet';
      injBtn.disabled = !hasInjected;
      injBtn.style.cssText = `
        display: block; width: 100%; padding: 12px 16px; margin-bottom: 12px;
        background: ${hasInjected ? '#2a2a4e' : '#1a1a2e'}; border: 1px solid ${hasInjected ? '#5b3a8c' : '#333'};
        border-radius: 6px; color: ${hasInjected ? '#e8d5f5' : '#555'};
        font-family: 'Press Start 2P', monospace; font-size: 10px;
        cursor: ${hasInjected ? 'pointer' : 'not-allowed'};
        transition: background 0.2s;
      `;
      if (hasInjected) {
        injBtn.onmouseenter = () => { injBtn.style.background = '#3a3a6e'; };
        injBtn.onmouseleave = () => { injBtn.style.background = '#2a2a4e'; };
        injBtn.onclick = () => { cleanup(); resolve('injected'); };
      }
      modal.appendChild(injBtn);

      if (!hasInjected) {
        const hint = document.createElement('div');
        hint.textContent = 'No browser wallet detected';
        hint.style.cssText = 'color: #555; font-size: 7px; margin-bottom: 12px;';
        modal.appendChild(hint);
      }

      // WalletConnect button
      if (hasWC) {
        const wcBtn = document.createElement('button');
        wcBtn.textContent = 'WalletConnect';
        wcBtn.style.cssText = `
          display: block; width: 100%; padding: 12px 16px; margin-bottom: 12px;
          background: #2a2a4e; border: 1px solid #3396ff;
          border-radius: 6px; color: #e8d5f5;
          font-family: 'Press Start 2P', monospace; font-size: 10px;
          cursor: pointer; transition: background 0.2s;
        `;
        wcBtn.onmouseenter = () => { wcBtn.style.background = '#2a3a5e'; };
        wcBtn.onmouseleave = () => { wcBtn.style.background = '#2a2a4e'; };
        wcBtn.onclick = () => { cleanup(); resolve('walletconnect'); };
        modal.appendChild(wcBtn);
      }

      // Cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        display: block; width: 100%; padding: 8px 16px;
        background: transparent; border: 1px solid #444;
        border-radius: 6px; color: #888;
        font-family: 'Press Start 2P', monospace; font-size: 8px;
        cursor: pointer;
      `;
      cancelBtn.onclick = () => { cleanup(); resolve(null); };
      modal.appendChild(cancelBtn);

      // Close on backdrop click
      overlay.onclick = (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      };

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.container.destroy();
    // Clean up any lingering picker overlay
    document.getElementById('wallet-picker-overlay')?.remove();
  }
}

import Phaser from 'phaser';
import { connectWallet, disconnectWallet, getWalletState, onWalletChange, truncateAddress } from '@/web3/wallet';
import { getZeroBalance } from '@/web3/contracts';
import { loadNFTs, type GameNFT } from '@/web3/nft-loader';
import type { InventorySystem } from '@/systems/InventorySystem';
import { TWP, FONT } from '@/config/theme';

/**
 * Minimal wallet button — top-right, Thimbleweed Park style.
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

  private async handleClick(): Promise<void> {
    const state = getWalletState();
    if (state.connected) {
      disconnectWallet();
    } else {
      try {
        this.label.setText('...');
        const ns = await connectWallet();
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
    this.label.setText(`${truncateAddress(address)} | ${balance} $ZERO`);
    this.resizeBg();

    if (this.inventory) {
      try {
        const nfts: GameNFT[] = await loadNFTs(address);
        for (const nft of nfts) {
          this.inventory.addNFTItem(`nft_${nft.contract}_${nft.tokenId}`, `${nft.filter}: ${nft.name}`, nft.image);
        }
      } catch (err) { console.error('NFT load failed:', err); }
    }
  }

  private updateDisplay(connected: boolean, address: string | null): void {
    if (connected && address) {
      this.label.setText(truncateAddress(address));
      this.bg.setStrokeStyle(1, TWP.WALLET_BORDER_ON, 0.8);
    } else {
      this.label.setText('Connect');
      this.bg.setStrokeStyle(1, TWP.WALLET_BORDER, 0.6);
    }
    this.resizeBg();
  }

  private resizeBg(): void {
    this.bg.setSize(Math.max(80, this.label.width + 16), 24);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.container.destroy();
  }
}

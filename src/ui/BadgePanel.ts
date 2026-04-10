import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';
import { ACHIEVEMENTS, type AchievementDef } from '@/config/achievements.config';
import type { GameState } from '@/types/game.types';
import { getWalletState } from '@/web3/wallet';
import { mintAchievement, hasLabToken, type MintResult } from '@/web3/contracts';
import { CONTRACTS } from '@/config/blockchain.config';
import type { Address } from 'viem';

const BADGE_SIZE = 64;
const GAP = 12;
const COLS = 4;
const PAD = 24;

/**
 * Full-screen badge panel showing all achievements.
 * Earned = colored, unearned = dark silhouette.
 * Earned badges have a "Mint" button for on-chain ERC1155 minting via AdrianLAB.
 */
export class BadgePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private trophyBtn: Phaser.GameObjects.Container;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(900).setVisible(false).setScrollFactor(0);
    this.trophyBtn = this.buildTrophyButton();
  }

  private buildTrophyButton(): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(0, 0).setDepth(800).setScrollFactor(0);
    const { width } = this.scene.scale;

    // Position: top-left, next to save icon
    const x = 48;
    const y = 20;

    const bg = this.scene.add.rectangle(x, y, 30, 24, 0x1a1a2e, 0.85)
      .setStrokeStyle(1, 0x504878, 0.6)
      .setInteractive({ useHandCursor: true });
    const icon = this.scene.add.text(x, y, '\u{1F3C6}', {
      fontSize: '14px',
    }).setOrigin(0.5);

    bg.on('pointerover', () => bg.setStrokeStyle(1, 0xf8e848, 0.9));
    bg.on('pointerout', () => bg.setStrokeStyle(1, 0x504878, 0.6));
    bg.on('pointerdown', () => this.toggle());

    btn.add([bg, icon]);
    return btn;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;
    this.container.removeAll(true);

    const { width, height } = this.scene.scale;
    const state = this.scene.registry.get('gameState') as GameState;
    const earned = state?.achievements ?? [];

    // Full-screen dark overlay
    const overlay = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x06060c, 0.92)
      .setInteractive();
    overlay.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Close if clicking outside the panel area
      if (p.y < 60 || p.y > height - 60) this.hide();
    });
    this.container.add(overlay);

    // Title
    const titleSize = Math.max(12, Math.min(18, Math.floor(width * 0.016)));
    const title = this.scene.add.text(width / 2, 40, 'ACHIEVEMENT BADGES', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#f8e848',
    }).setOrigin(0.5);
    this.container.add(title);

    // Subtitle with count
    const sub = this.scene.add.text(width / 2, 40 + titleSize + 8,
      `${earned.length} / ${ACHIEVEMENTS.length} earned`, {
      fontFamily: FONT.FAMILY, fontSize: `${Math.floor(titleSize * 0.6)}px`, color: '#8878a8',
    }).setOrigin(0.5);
    this.container.add(sub);

    // Close button
    const closeBtn = this.scene.add.text(width - PAD, 30, 'X', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#8878a8',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#f8e848'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#8878a8'));
    closeBtn.on('pointerdown', () => this.hide());
    this.container.add(closeBtn);

    // Badge grid
    const startY = 90;
    const gridW = COLS * (BADGE_SIZE + GAP) - GAP;
    const startX = (width - gridW) / 2;
    const fontSize = Math.max(7, Math.min(10, Math.floor(width * 0.008)));
    const descSize = Math.max(6, Math.min(8, Math.floor(width * 0.006)));

    // Group by category
    const categories: Array<{ label: string; key: string }> = [
      { label: 'STORY', key: 'chapter' },
      { label: 'HOLDER EXCLUSIVE', key: 'holder' },
      { label: 'EXPLORER', key: 'explorer' },
    ];

    let curY = startY;

    for (const cat of categories) {
      const badges = ACHIEVEMENTS.filter(a => a.category === cat.key);
      if (badges.length === 0) continue;

      // Category header
      const catLabel = this.scene.add.text(startX, curY, cat.label, {
        fontFamily: FONT.FAMILY, fontSize: `${descSize}px`, color: '#504878',
      });
      this.container.add(catLabel);
      curY += descSize + 10;

      badges.forEach((badge, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = startX + col * (BADGE_SIZE + GAP) + BADGE_SIZE / 2;
        const y = curY + row * (BADGE_SIZE + GAP + 20) + BADGE_SIZE / 2;

        const isEarned = earned.includes(badge.id);

        // Badge background
        const bg = this.scene.add.rectangle(x, y, BADGE_SIZE, BADGE_SIZE,
          isEarned ? 0x1a2a38 : 0x0a0a12, isEarned ? 0.9 : 0.5)
          .setStrokeStyle(2, isEarned ? 0xf8e848 : 0x222233, isEarned ? 0.8 : 0.3);
        this.container.add(bg);

        // Badge icon (first letter or lock)
        const iconText = isEarned ? badge.name.charAt(0) : '\u{1F512}';
        const iconColor = isEarned ? '#f8e848' : '#333344';
        const badgeIcon = this.scene.add.text(x, y - 6, iconText, {
          fontFamily: FONT.FAMILY, fontSize: `${Math.floor(BADGE_SIZE * 0.35)}px`, color: iconColor,
        }).setOrigin(0.5);
        this.container.add(badgeIcon);

        // Badge name below icon
        const nameColor = isEarned ? '#e8d5f5' : '#333344';
        const nameText = this.scene.add.text(x, y + BADGE_SIZE / 2 + 4, badge.name, {
          fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`, color: nameColor,
          wordWrap: { width: BADGE_SIZE + GAP },
          align: 'center',
        }).setOrigin(0.5, 0);
        this.container.add(nameText);

        // Mint button for earned badges
        if (isEarned) {
          const mintY = y + BADGE_SIZE / 2 + 4 + fontSize + 8 + (nameText.height > fontSize + 4 ? 8 : 0);
          const mintBtn = this.scene.add.text(x, y + 16, 'MINT', {
            fontFamily: FONT.FAMILY, fontSize: `${descSize}px`, color: '#48d8e8',
            backgroundColor: '#0a1a20', padding: { x: 4, y: 2 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });

          mintBtn.on('pointerover', () => mintBtn.setColor('#80f0ff'));
          mintBtn.on('pointerout', () => mintBtn.setColor('#48d8e8'));
          mintBtn.on('pointerdown', () => this.mintBadge(badge, mintBtn));

          this.container.add(mintBtn);
        }
      });

      const rowCount = Math.ceil(badges.length / COLS);
      curY += rowCount * (BADGE_SIZE + GAP + 20) + 10;
    }

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 200 });
  }

  hide(): void {
    this.visible = false;
    this.scene.tweens.add({
      targets: this.container, alpha: 0, duration: 150,
      onComplete: () => {
        this.container.setVisible(false);
        this.container.removeAll(true);
      },
    });
  }

  isVisible(): boolean { return this.visible; }

  private async mintBadge(badge: AchievementDef, btn: Phaser.GameObjects.Text): Promise<void> {
    const { address, connected } = getWalletState();
    if (!connected || !address) {
      btn.setText('CONNECT WALLET');
      this.scene.time.delayedCall(2000, () => btn.setText('MINT'));
      return;
    }

    // Check if already minted on-chain
    try {
      const already = await hasLabToken(address as Address, badge.tokenId);
      if (already) {
        btn.setText('OWNED \u2713').setColor('#48d848');
        return;
      }
    } catch { /* continue to mint */ }

    btn.setText('MINTING...').setColor('#f8e848');
    const result: MintResult = await mintAchievement(badge.tokenId);

    if (result.status === 'success') {
      btn.setText('MINTED \u2713').setColor('#48d848');
    } else if (result.status === 'not-configured') {
      btn.setText('SOON').setColor('#8878a8');
      this.scene.time.delayedCall(2000, () => btn.setText('MINT').setColor('#48d8e8'));
    } else {
      btn.setText('FAILED').setColor('#e84848');
      this.scene.time.delayedCall(2000, () => btn.setText('MINT').setColor('#48d8e8'));
    }
  }

  destroy(): void {
    this.container.destroy();
    this.trophyBtn.destroy();
  }
}

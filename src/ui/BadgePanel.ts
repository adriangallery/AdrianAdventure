import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';
import { ACHIEVEMENTS, type AchievementDef } from '@/config/achievements.config';
import type { GameState } from '@/types/game.types';
import { getWalletState } from '@/web3/wallet';
import { mintAchievement, hasLabToken, type MintResult } from '@/web3/contracts';
import { CONTRACTS } from '@/config/blockchain.config';
import type { Address } from 'viem';

const OPENSEA_BASE = 'https://opensea.io/assets/base/0x90546848474fb3c9fda3fdad887969bb244e7e58';

/**
 * Full-screen badge panel — brighter design, badge images, OpenSea links.
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
    const x = 48;
    const y = 20;
    const bg = this.scene.add.rectangle(x, y, 30, 24, 0x1a1a2e, 0.85)
      .setStrokeStyle(1, 0x504878, 0.6)
      .setInteractive({ useHandCursor: true });
    const icon = this.scene.add.text(x, y, '\u{1F3C6}', { fontSize: '14px' }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setStrokeStyle(1, 0xf8e848, 0.9));
    bg.on('pointerout', () => bg.setStrokeStyle(1, 0x504878, 0.6));
    bg.on('pointerdown', () => this.toggle());
    btn.add([bg, icon]);
    return btn;
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  show(): void {
    this.visible = true;
    this.container.removeAll(true);

    const { width, height } = this.scene.scale;
    const state = this.scene.registry.get('gameState') as GameState;
    const earned = state?.achievements ?? [];

    // Overlay
    const overlay = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x0a0a14, 0.96)
      .setInteractive();
    overlay.on('pointerdown', () => this.hide());
    this.container.add(overlay);

    // Sizing
    const isSmall = width < 800;
    const badgeSize = isSmall ? 60 : 84;
    const gap = isSmall ? 14 : 20;
    const cols = isSmall ? 3 : 5;
    const titleSize = isSmall ? 14 : 20;
    const nameSize = isSmall ? 7 : 9;
    const catSize = isSmall ? 9 : 13;
    const pad = isSmall ? 16 : 40;

    // Title
    this.container.add(this.scene.add.text(width / 2, 28, 'ACHIEVEMENT BADGES', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#f8e848',
    }).setOrigin(0.5));

    // Subtitle
    this.container.add(this.scene.add.text(width / 2, 28 + titleSize + 6,
      `${earned.length} / ${ACHIEVEMENTS.length} earned`, {
      fontFamily: FONT.FAMILY, fontSize: `${Math.floor(titleSize * 0.55)}px`, color: '#b0a0c8',
    }).setOrigin(0.5));

    // Close
    const closeBtn = this.scene.add.text(width - pad, 22, 'X', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#b0a0c8',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#f8e848'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#b0a0c8'));
    closeBtn.on('pointerdown', () => this.hide());
    this.container.add(closeBtn);

    const categories: Array<{ label: string; key: string }> = [
      { label: '\u{2694}\u{FE0F}  STORY', key: 'chapter' },
      { label: '\u{1F451}  HOLDER EXCLUSIVE', key: 'holder' },
      { label: '\u{1F9ED}  EXPLORER', key: 'explorer' },
    ];

    const cellH = badgeSize + 28 + nameSize;
    let curY = 28 + titleSize + 6 + titleSize * 0.55 + 24;

    for (const cat of categories) {
      const badges = ACHIEVEMENTS.filter(a => a.category === cat.key);
      if (badges.length === 0) continue;

      // Category header — bright, with separator line
      const catLabel = this.scene.add.text(pad, curY, cat.label, {
        fontFamily: FONT.FAMILY, fontSize: `${catSize}px`, color: '#c8b8e0',
      });
      this.container.add(catLabel);

      const lineX = pad + catLabel.width + 12;
      if (lineX < width - pad) {
        this.container.add(this.scene.add.rectangle(
          (lineX + width - pad) / 2, curY + catSize / 2,
          width - pad - lineX, 1, 0x504878, 0.6
        ));
      }
      curY += catSize + 14;

      const gridW = cols * (badgeSize + gap) - gap;
      const startX = (width - gridW) / 2;

      badges.forEach((badge, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (badgeSize + gap) + badgeSize / 2;
        const y = curY + row * cellH + badgeSize / 2;
        const isEarned = earned.includes(badge.id);

        // Background
        const bgColor = isEarned ? 0x1e2e40 : 0x181820;
        const borderColor = isEarned ? 0xf8e848 : 0x484860;

        const bg = this.scene.add.rectangle(x, y, badgeSize, badgeSize, bgColor, 1)
          .setStrokeStyle(2, borderColor, isEarned ? 1 : 0.7);
        this.container.add(bg);

        // Badge image for earned (load from sprite if available, otherwise letter)
        const spriteKey = `badge_${badge.id}`;
        if (isEarned && this.scene.textures.exists(spriteKey)) {
          const img = this.scene.add.image(x, y, spriteKey).setOrigin(0.5);
          const maxDim = badgeSize - 6;
          img.setScale(Math.min(maxDim / img.width, maxDim / img.height));
          this.container.add(img);
        } else {
          const iconText = isEarned ? badge.name.charAt(0) : '?';
          const iconColor = isEarned ? '#f8e848' : '#666678';
          this.container.add(this.scene.add.text(x, y - 2, iconText, {
            fontFamily: FONT.FAMILY, fontSize: `${Math.floor(badgeSize * 0.38)}px`, color: iconColor,
          }).setOrigin(0.5));
        }

        // Name
        const nameColor = isEarned ? '#e8ddf0' : '#666678';
        this.container.add(this.scene.add.text(x, y + badgeSize / 2 + 5, badge.name, {
          fontFamily: FONT.FAMILY, fontSize: `${nameSize}px`, color: nameColor,
          wordWrap: { width: badgeSize + gap }, align: 'center',
        }).setOrigin(0.5, 0));

        // Click → OpenSea (earned) or do nothing (locked)
        bg.setInteractive({ useHandCursor: isEarned });
        bg.on('pointerover', () => {
          bg.setStrokeStyle(isEarned ? 3 : 2, isEarned ? 0xf8e848 : 0x6868780, 1);
        });
        bg.on('pointerout', () => {
          bg.setStrokeStyle(2, borderColor, isEarned ? 1 : 0.7);
        });
        bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
          p.event.stopPropagation();
          if (isEarned) {
            window.open(`${OPENSEA_BASE}/${badge.tokenId}`, '_blank');
          }
        });

        // Mint button for earned
        if (isEarned) {
          const mintBtn = this.scene.add.text(x, y + 16, 'MINT', {
            fontFamily: FONT.FAMILY, fontSize: `${Math.max(7, nameSize - 1)}px`, color: '#48d8e8',
            backgroundColor: '#0c1820', padding: { x: 6, y: 2 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          mintBtn.on('pointerover', () => mintBtn.setColor('#80f0ff'));
          mintBtn.on('pointerout', () => mintBtn.setColor('#48d8e8'));
          mintBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
            p.event.stopPropagation();
            this.mintBadge(badge, mintBtn);
          });
          this.container.add(mintBtn);
        }
      });

      const rowCount = Math.ceil(badges.length / cols);
      curY += rowCount * cellH + 6;
    }

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 200 });
  }

  hide(): void {
    this.visible = false;
    this.scene.tweens.add({
      targets: this.container, alpha: 0, duration: 150,
      onComplete: () => { this.container.setVisible(false); this.container.removeAll(true); },
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
    try {
      const already = await hasLabToken(address as Address, badge.tokenId);
      if (already) { btn.setText('OWNED \u2713').setColor('#48d848'); return; }
    } catch { /* continue */ }

    btn.setText('MINTING...').setColor('#f8e848');
    const result: MintResult = await mintAchievement(badge.tokenId);
    if (result.status === 'success') {
      btn.setText('MINTED \u2713').setColor('#48d848');
    } else if (result.status === 'not-configured') {
      btn.setText('SOON').setColor('#b0a0c8');
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

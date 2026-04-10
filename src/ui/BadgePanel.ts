import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';
import { ACHIEVEMENTS, type AchievementDef } from '@/config/achievements.config';
import type { GameState } from '@/types/game.types';
import { getWalletState } from '@/web3/wallet';
import { mintAchievement, hasLabToken, type MintResult } from '@/web3/contracts';
import { CONTRACTS } from '@/config/blockchain.config';
import type { Address } from 'viem';

/**
 * Full-screen badge panel showing all achievements.
 * Spacious layout with large badges, bright locked icons, and clear categories.
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
    const overlay = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x06060c, 0.95)
      .setInteractive();
    overlay.on('pointerdown', () => this.hide());
    this.container.add(overlay);

    // Responsive sizing
    const isSmall = width < 800;
    const badgeSize = isSmall ? 56 : 80;
    const gap = isSmall ? 16 : 24;
    const cols = isSmall ? 3 : 5;
    const titleSize = isSmall ? 14 : 20;
    const nameSize = isSmall ? 7 : 10;
    const catSize = isSmall ? 8 : 11;
    const pad = isSmall ? 16 : 40;

    // Title
    const title = this.scene.add.text(width / 2, 30, 'ACHIEVEMENT BADGES', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#f8e848',
    }).setOrigin(0.5);
    this.container.add(title);

    // Subtitle
    const sub = this.scene.add.text(width / 2, 30 + titleSize + 6,
      `${earned.length} / ${ACHIEVEMENTS.length} earned`, {
      fontFamily: FONT.FAMILY, fontSize: `${Math.floor(titleSize * 0.55)}px`, color: '#8878a8',
    }).setOrigin(0.5);
    this.container.add(sub);

    // Close button
    const closeBtn = this.scene.add.text(width - pad, 24, 'X', {
      fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`, color: '#8878a8',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#f8e848'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#8878a8'));
    closeBtn.on('pointerdown', () => this.hide());
    this.container.add(closeBtn);

    // Categories
    const categories: Array<{ label: string; key: string }> = [
      { label: 'STORY', key: 'chapter' },
      { label: 'HOLDER EXCLUSIVE', key: 'holder' },
      { label: 'EXPLORER', key: 'explorer' },
    ];

    // Cell height = badge + name + optional mint button
    const cellH = badgeSize + gap + 16;
    let curY = 30 + titleSize + 6 + titleSize * 0.55 + 20;

    for (const cat of categories) {
      const badges = ACHIEVEMENTS.filter(a => a.category === cat.key);
      if (badges.length === 0) continue;

      // Category header with line
      const catLabel = this.scene.add.text(pad, curY, cat.label, {
        fontFamily: FONT.FAMILY, fontSize: `${catSize}px`, color: '#504878',
      });
      this.container.add(catLabel);

      const lineY = curY + catSize / 2;
      const lineX = pad + catLabel.width + 10;
      if (lineX < width - pad) {
        const line = this.scene.add.rectangle(
          (lineX + width - pad) / 2, lineY,
          width - pad - lineX, 1, 0x302848, 0.5
        );
        this.container.add(line);
      }

      curY += catSize + 12;

      const gridW = cols * (badgeSize + gap) - gap;
      const startX = (width - gridW) / 2;

      badges.forEach((badge, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (badgeSize + gap) + badgeSize / 2;
        const y = curY + row * cellH + badgeSize / 2;

        const isEarned = earned.includes(badge.id);

        // Badge background — brighter for locked, golden for earned
        const bgColor = isEarned ? 0x1a2a38 : 0x14141e;
        const bgAlpha = isEarned ? 1 : 0.8;
        const borderColor = isEarned ? 0xf8e848 : 0x3a3a50;
        const borderAlpha = isEarned ? 0.9 : 0.6;

        const bg = this.scene.add.rectangle(x, y, badgeSize, badgeSize, bgColor, bgAlpha)
          .setStrokeStyle(2, borderColor, borderAlpha);
        this.container.add(bg);

        // Badge icon
        const iconText = isEarned ? badge.name.charAt(0) : '?';
        const iconColor = isEarned ? '#f8e848' : '#555566';
        const iconSize = Math.floor(badgeSize * 0.4);
        const badgeIcon = this.scene.add.text(x, y - 4, iconText, {
          fontFamily: FONT.FAMILY, fontSize: `${iconSize}px`, color: iconColor,
        }).setOrigin(0.5);
        this.container.add(badgeIcon);

        // Badge name below
        const nameColor = isEarned ? '#e8d5f5' : '#555566';
        const nameText = this.scene.add.text(x, y + badgeSize / 2 + 4, badge.name, {
          fontFamily: FONT.FAMILY, fontSize: `${nameSize}px`, color: nameColor,
          wordWrap: { width: badgeSize + gap },
          align: 'center',
        }).setOrigin(0.5, 0);
        this.container.add(nameText);

        // Mint button for earned badges
        if (isEarned) {
          const mintBtn = this.scene.add.text(x, y + 14, 'MINT', {
            fontFamily: FONT.FAMILY, fontSize: `${Math.max(7, nameSize - 1)}px`, color: '#48d8e8',
            backgroundColor: '#0a1a20', padding: { x: 6, y: 2 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });

          mintBtn.on('pointerover', () => mintBtn.setColor('#80f0ff'));
          mintBtn.on('pointerout', () => mintBtn.setColor('#48d8e8'));
          mintBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
            p.event.stopPropagation();
            this.mintBadge(badge, mintBtn);
          });
          this.container.add(mintBtn);
        }

        // Hover tooltip for description
        bg.setInteractive({ useHandCursor: isEarned });
        bg.on('pointerover', () => {
          if (isEarned) bg.setStrokeStyle(3, 0xf8e848, 1);
          else bg.setStrokeStyle(2, 0x5a5a70, 0.8);
        });
        bg.on('pointerout', () => {
          bg.setStrokeStyle(2, borderColor, borderAlpha);
        });
      });

      const rowCount = Math.ceil(badges.length / cols);
      curY += rowCount * cellH + 8;
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

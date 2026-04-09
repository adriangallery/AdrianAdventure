import Phaser from 'phaser';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { TWP, FONT } from '@/config/theme';

/**
 * Title/Menu screen — Thimbleweed Park noir atmosphere.
 */
export class MenuScene extends Phaser.Scene {
  private resizeHandler: (() => void) | null = null;

  constructor() {
    super({ key: 'MenuScene' });
  }

  preload(): void {
    if (!this.textures.exists('intro')) {
      this.load.image('intro', 'assets/ui/intro.png');
    }
  }

  create(): void {
    this.buildMenu();
    this.resizeHandler = () => {
      if (!this.scene.isActive('MenuScene')) return;
      if (!this.cameras?.main) return;
      this.children.removeAll(true);
      this.tweens.killAll();
      this.buildMenu();
    };
    this.scale.on('resize', this.resizeHandler);
  }

  shutdown(): void {
    if (this.resizeHandler) {
      this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  private buildMenu(): void {
    if (!this.cameras?.main) return;
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const refSize = isPortrait ? Math.max(width, height * 0.45) : width;

    this.cameras.main.setBackgroundColor(TWP.MENU_BG);

    // Intro image
    if (this.textures.exists('intro')) {
      const imgY = isPortrait ? height * 0.28 : height * 0.35;
      const img = this.add.image(width / 2, imgY, 'intro');
      const maxW = width * (isPortrait ? 0.85 : 0.55);
      const maxH = height * (isPortrait ? 0.3 : 0.45);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      img.setScale(scale).setAlpha(0.85);
    }

    // Title — yellow TWP style
    const titleSize = Math.max(18, Math.min(36, Math.floor(refSize * 0.04)));
    const titleY = isPortrait ? height * 0.50 : height * 0.68;
    const title = this.add.text(width / 2, titleY, 'ZEROadventure II', {
      fontFamily: FONT.FAMILY,
      fontSize: `${titleSize}px`,
      color: TWP.MENU_TITLE,
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: title,
      alpha: { from: 1, to: 0.6 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
    });

    // Subtitle
    const subSize = Math.max(10, Math.min(16, Math.floor(refSize * 0.016)));
    this.add.text(width / 2, title.y + titleSize + 12, 'A Point & Click Web3 Adventure on Base', {
      fontFamily: FONT.FAMILY,
      fontSize: `${subSize}px`,
      color: TWP.MENU_SUBTITLE,
      wordWrap: { width: width * 0.85 },
      align: 'center',
    }).setOrigin(0.5);

    // Buttons
    const saveSystem = new SaveLoadSystem();
    const hasSave = saveSystem.hasSave();
    const btnSize = Math.max(14, Math.min(22, Math.floor(refSize * 0.024)));
    const btnSpacing = Math.max(btnSize * 3, 50);
    const btnY = isPortrait ? height * 0.72 : height * 0.86;

    this.createButton(width / 2, btnY, 'New Game', btnSize, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.registry.remove('gameState');
        this.scene.start('PreloadScene');
      });
    });

    if (hasSave) {
      this.createButton(width / 2, btnY + btnSpacing, 'Continue', btnSize, () => {
        const slot = saveSystem.loadAutoSave();
        if (slot) {
          this.registry.set('gameState', slot.state);
          this.registry.set('currentSceneId', slot.state.currentScene);
          this.cameras.main.fadeOut(400, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('PreloadScene');
          });
        }
      });
    }

    // Rotate hint in portrait
    if (isPortrait) {
      const hintSize = Math.max(9, Math.min(12, Math.floor(refSize * 0.012)));
      this.add.text(width / 2, height - 30, '\u{1F504} Rotate for best experience', {
        fontFamily: FONT.FAMILY,
        fontSize: `${hintSize}px`,
        color: TWP.MENU_SUBTITLE,
      }).setOrigin(0.5);
    }
  }

  private createButton(x: number, y: number, label: string, size: number, onClick: () => void): void {
    const text = this.add.text(x, y, `[ ${label} ]`, {
      fontFamily: FONT.FAMILY,
      fontSize: `${size}px`,
      color: TWP.MENU_BTN,
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setPadding(16, 12);

    text.on('pointerover', () => text.setColor(TWP.MENU_BTN_HOVER));
    text.on('pointerout', () => text.setColor(TWP.MENU_BTN));
    text.on('pointerdown', onClick);
  }
}

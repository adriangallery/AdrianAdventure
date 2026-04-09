import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

const PADDING = 16;
const CHOICE_HEIGHT = 44;

/**
 * Shows branching dialogue choices at the bottom of the screen.
 * Thimbleweed Park style: cyan/teal bullet-pointed options on dark panel.
 * Returns a Promise that resolves with the selected index.
 */
export class ChoicePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private resolveChoice: ((index: number) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(450).setVisible(false);
  }

  show(choices: { text: string; enabled: boolean }[]): Promise<number> {
    return new Promise<number>((resolve) => {
      this.resolveChoice = resolve;
      this.container.removeAll(true);

      const { width, height } = this.scene.scale;
      const panelH = PADDING * 2 + choices.length * CHOICE_HEIGHT;
      const panelY = height - panelH;

      this.container.setPosition(0, panelY);

      // Dark background — same as SCUMM panel
      const bg = this.scene.add.rectangle(width / 2, panelH / 2, width, panelH, TWP.CHOICE_BG, 0.92);
      const border = this.scene.add.rectangle(width / 2, 0, width, 1, TWP.CHOICE_BORDER, 0.6);
      this.container.add([bg, border]);

      choices.forEach((choice, i) => {
        const y = PADDING + i * CHOICE_HEIGHT + CHOICE_HEIGHT / 2;
        const color = choice.enabled ? TWP.CHOICE_ENABLED : TWP.CHOICE_DISABLED;
        // TWP style: bullet point for enabled, lock for gated
        const prefix = choice.enabled ? '\u2022 ' : '\u{1F512} ';

        const choiceFontSize = Math.max(10, Math.min(14, Math.floor(width * 0.013)));
        const text = this.scene.add
          .text(PADDING + 8, y, `${prefix}${choice.text}`, {
            fontFamily: FONT.FAMILY,
            fontSize: `${choiceFontSize}px`,
            color,
            wordWrap: { width: width - PADDING * 2 - 16 },
            lineSpacing: 4,
          })
          .setOrigin(0, 0.5);

        if (choice.enabled) {
          const hitArea = this.scene.add
            .rectangle(width / 2, y, width - PADDING * 2, CHOICE_HEIGHT - 4, 0x000000, 0)
            .setInteractive({ useHandCursor: true });

          hitArea.on('pointerover', () => {
            hitArea.setFillStyle(0x102030, 0.4);
            text.setColor(TWP.CHOICE_HOVER);
          });
          hitArea.on('pointerout', () => {
            hitArea.setFillStyle(0x000000, 0);
            text.setColor(TWP.CHOICE_ENABLED);
          });
          hitArea.on('pointerdown', () => this.selectChoice(i));

          this.container.add(hitArea);
        }

        this.container.add(text);
      });

      this.container.setVisible(true);
      this.container.setAlpha(0);
      this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 150 });
    });
  }

  private selectChoice(index: number): void {
    const cb = this.resolveChoice;
    this.resolveChoice = null;

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      onComplete: () => {
        this.container.setVisible(false);
        this.container.removeAll(true);
        cb?.(index);
      },
    });
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  destroy(): void {
    this.container.destroy();
  }
}

import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

/**
 * Dialogue choices rendered INSIDE the SCUMM panel, replacing verbs+inventory.
 * Classic Monkey Island / Thimbleweed Park style: colored choice lines on the
 * same dark panel background. Choices take over the full panel width.
 */
export class ChoicePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private resolveChoice: ((index: number) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Depth 510 = above the ScummUI panel (500) so choices overlay verbs/inventory
    this.container = scene.add.container(0, 0).setDepth(510).setVisible(false).setScrollFactor(0);
  }

  show(choices: { text: string; enabled: boolean }[]): Promise<number> {
    return new Promise<number>((resolve) => {
      this.resolveChoice = resolve;
      this.container.removeAll(true);

      const { width, height } = this.scene.scale;

      // Get the SCUMM panel height and position so we render inside it
      const panelH = (this.scene.registry.get('scummPanelHeight') as number) ?? Math.floor(height * 0.25);
      const panelY = height - panelH;

      this.container.setPosition(0, panelY);

      // Full panel background — covers verbs + inventory completely
      const bg = this.scene.add.rectangle(width / 2, panelH / 2, width, panelH, TWP.CHOICE_BG, 1);
      this.container.add(bg);

      // Layout: choices as lines, vertically centered in the panel
      const padX = Math.max(12, width * 0.03);
      const padTop = Math.max(8, panelH * 0.08);
      const lineH = Math.max(28, Math.min(44, Math.floor(panelH / (choices.length + 1))));
      const fontSize = Math.max(10, Math.min(16, Math.floor(width * 0.014)));

      choices.forEach((choice, i) => {
        const y = padTop + i * lineH + lineH / 2;
        const color = choice.enabled ? TWP.CHOICE_ENABLED : TWP.CHOICE_DISABLED;
        const prefix = choice.enabled ? '\u2022 ' : '\u{1F512} ';

        const text = this.scene.add
          .text(padX, y, `${prefix}${choice.text}`, {
            fontFamily: FONT.FAMILY,
            fontSize: `${fontSize}px`,
            color,
            wordWrap: { width: width - padX * 2 },
            lineSpacing: 4,
          })
          .setOrigin(0, 0.5);

        if (choice.enabled) {
          // Hit area spans full width for easy clicking
          const hitArea = this.scene.add
            .rectangle(width / 2, y, width, lineH, 0x000000, 0)
            .setInteractive({ useHandCursor: true });

          hitArea.on('pointerover', () => {
            text.setColor(TWP.CHOICE_HOVER);
          });
          hitArea.on('pointerout', () => {
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

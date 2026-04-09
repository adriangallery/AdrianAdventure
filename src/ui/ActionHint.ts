import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

/**
 * Floating label that shows the hotspot name near the pointer when hovering/tapping.
 * Thimbleweed Park style: soft lavender text on dark translucent background.
 * Auto-hides after a short delay.
 */
export class ActionHint {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private hideTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const hintSize = Math.max(10, Math.min(14, Math.floor(scene.scale.width * 0.012)));
    this.text = scene.add.text(0, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${hintSize}px`,
      color: TWP.HINT_TEXT,
      backgroundColor: TWP.HINT_BG,
      padding: { x: 8, y: 4 },
      stroke: TWP.HINT_STROKE,
      strokeThickness: 1,
    })
      .setOrigin(0.5, 1)
      .setDepth(300)
      .setVisible(false)
      .setScrollFactor(0);
  }

  show(screenX: number, screenY: number, name: string): void {
    this.hideTimer?.remove();

    const { width } = this.scene.scale;
    const clampedX = Phaser.Math.Clamp(screenX, 60, width - 60);

    this.text.setText(name);
    this.text.setPosition(clampedX, screenY - 10);
    this.text.setVisible(true);
    this.text.setAlpha(1);

    this.hideTimer = this.scene.time.delayedCall(2000, () => this.hide());
  }

  hide(): void {
    this.hideTimer?.remove();
    this.hideTimer = null;

    this.scene.tweens.add({
      targets: this.text,
      alpha: 0,
      duration: 200,
      onComplete: () => this.text.setVisible(false),
    });
  }

  destroy(): void {
    this.hideTimer?.remove();
    this.text.destroy();
  }
}

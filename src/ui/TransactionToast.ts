import Phaser from 'phaser';
import { FONT } from '@/config/theme';

export type ToastStatus = 'pending' | 'success' | 'failed';

const COLORS: Record<ToastStatus, { bg: number; text: string }> = {
  pending: { bg: 0xcc8800, text: '#fff8e0' },
  success: { bg: 0x228833, text: '#e0ffe0' },
  failed:  { bg: 0x993333, text: '#ffe0e0' },
};

/**
 * Non-blocking toast notification for transaction status.
 * Slides down from top, auto-dismisses.
 */
export class TransactionToast {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(status: ToastStatus, message: string, autoDismissMs?: number): void {
    this.dismiss();

    const { width } = this.scene.scale;
    const fontSize = Math.max(8, Math.min(11, Math.floor(width * 0.012)));
    const config = COLORS[status];
    const padX = 16;
    const padY = 8;

    const text = this.scene.add.text(0, 0, message, {
      fontFamily: FONT.FAMILY,
      fontSize: `${fontSize}px`,
      color: config.text,
      wordWrap: { width: width * 0.7 },
    }).setOrigin(0.5, 0.5);

    const barW = Math.min(width * 0.8, text.width + padX * 2);
    const barH = text.height + padY * 2;

    const bg = this.scene.add.rectangle(0, 0, barW, barH, config.bg, 0.92)
      .setStrokeStyle(1, 0xffffff, 0.3)
      .setOrigin(0.5, 0.5);

    this.container = this.scene.add.container(width / 2, -barH)
      .setDepth(900)
      .setScrollFactor(0)
      .add([bg, text]);

    // Slide in
    this.scene.tweens.add({
      targets: this.container,
      y: barH / 2 + 8,
      duration: 300,
      ease: 'Back.easeOut',
    });

    // Auto-dismiss
    const dismissDelay = autoDismissMs ?? (status === 'pending' ? 0 : status === 'success' ? 3000 : 4000);
    if (dismissDelay > 0) {
      this.scene.time.delayedCall(dismissDelay, () => this.dismiss());
    }
  }

  dismiss(): void {
    if (!this.container) return;
    const c = this.container;
    this.container = null;
    this.scene.tweens.add({
      targets: c,
      y: -50,
      alpha: 0,
      duration: 250,
      onComplete: () => c.destroy(),
    });
  }

  destroy(): void {
    this.container?.destroy();
    this.container = null;
  }
}

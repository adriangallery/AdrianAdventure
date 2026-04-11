import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

const PADDING = 16;
const TYPEWRITER_SPEED = 25; // ms per character

/**
 * Dialogue text displayed directly in the game viewport, floating above the character.
 * Classic LucasArts / Thimbleweed Park style: colored text on screen, no box background.
 * Tap/click to skip or dismiss.
 */
export class DialogueBox {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private speakerText: Phaser.GameObjects.Text;

  private fullMessage = '';
  private displayedChars = 0;
  private typewriterTimer: Phaser.Time.TimerEvent | null = null;
  private resolvePromise: (() => void) | null = null;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const { width } = scene.scale;

    // Responsive font sizes — use larger ref on portrait for readability
    const { height } = scene.scale;
    const refDim = height > width ? Math.max(width, height * 0.5) : width;
    const speakerSize = Math.max(13, Math.min(20, Math.floor(refDim * 0.018)));
    const bodySize = Math.max(12, Math.min(18, Math.floor(refDim * 0.016)));

    // Speaker name — yellow (TWP character name style)
    this.speakerText = scene.add.text(width / 2, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${speakerSize}px`,
      color: TWP.DIALOGUE_SPEAKER,
      stroke: TWP.DIALOGUE_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(600).setVisible(false).setScrollFactor(0);

    // Body text — warm white with black outline
    this.text = scene.add.text(width / 2, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${bodySize}px`,
      color: TWP.DIALOGUE_TEXT,
      stroke: TWP.DIALOGUE_STROKE,
      strokeThickness: 4,
      align: 'center',
      wordWrap: { width: Math.min(width - PADDING * 4, 700), useAdvancedWrap: true },
      lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(600).setVisible(false).setScrollFactor(0);

    scene.scale.on('resize', this.handleResize, this);
  }

  say(text: string, speaker?: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.visible) this.dismiss();

      this.resolvePromise = resolve;
      this.fullMessage = text;
      this.displayedChars = 0;
      this.visible = true;

      // Always use viewport center — text has scrollFactor(0) so it's screen-fixed
      const vpW = this.scene.scale.width;
      const centerX = vpW / 2;
      const textY = Math.max(20, this.scene.scale.height * 0.06);

      // Word wrap to viewport width, not bg width
      this.text.setWordWrapWidth(Math.min(vpW - PADDING * 4, 700));

      if (speaker) {
        this.speakerText.setText(speaker);
        this.speakerText.setPosition(centerX, textY - 4);
        this.speakerText.setVisible(true);
        this.text.setPosition(centerX, textY + 2);
      } else {
        this.speakerText.setVisible(false);
        this.text.setPosition(centerX, textY);
      }

      this.text.setText('');
      this.text.setVisible(true);
      this.text.setWordWrapWidth(Math.min(this.scene.scale.width - PADDING * 4, 600));

      // Typewriter effect
      this.typewriterTimer = this.scene.time.addEvent({
        delay: TYPEWRITER_SPEED,
        repeat: this.fullMessage.length - 1,
        callback: () => {
          this.displayedChars++;
          this.text.setText(this.fullMessage.substring(0, this.displayedChars));
        },
      });

      // Click to skip typewriter, then click again to dismiss
      // Min display time prevents rapid-fire taps from skipping messages on mobile
      let canDismiss = false;
      const minReadTime = Math.min(1200, 300 + this.fullMessage.length * 15);

      const handler = () => {
        if (this.displayedChars < this.fullMessage.length) {
          // Skip typewriter — show full text
          this.typewriterTimer?.remove();
          this.typewriterTimer = null;
          this.displayedChars = this.fullMessage.length;
          this.text.setText(this.fullMessage);
        } else if (canDismiss) {
          // Full text shown and min read time passed — dismiss
          this.scene.input.off('pointerdown', handler);
          this.dismiss();
        }
      };

      this.scene.time.delayedCall(150, () => {
        this.scene.input.on('pointerdown', handler);
      });
      this.scene.time.delayedCall(minReadTime, () => {
        canDismiss = true;
      });
    });
  }

  private dismiss(): void {
    this.typewriterTimer?.remove();
    this.typewriterTimer = null;
    this.visible = false;
    this.text.setVisible(false);
    this.speakerText.setVisible(false);
    // Signal that a dialogue was just dismissed — GameScene should ignore this click
    this.scene.registry.set('dialogueDismissedAt', this.scene.time.now);
    const cb = this.resolvePromise;
    this.resolvePromise = null;
    cb?.();
  }

  /** Show text briefly (auto-dismiss after delay), then resolve. No click needed. */
  sayBrief(text: string, durationMs = 1500, speaker?: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.visible) this.dismiss();

      this.resolvePromise = resolve;
      this.fullMessage = text;
      this.displayedChars = text.length;
      this.visible = true;

      const vpW = this.scene.scale.width;
      const centerX = vpW / 2;
      const textY = Math.max(20, this.scene.scale.height * 0.06);
      this.text.setWordWrapWidth(Math.min(vpW - PADDING * 4, 700));

      if (speaker) {
        this.speakerText.setText(speaker);
        this.speakerText.setPosition(centerX, textY - 4);
        this.speakerText.setVisible(true);
        this.text.setPosition(centerX, textY + 2);
      } else {
        this.speakerText.setVisible(false);
        this.text.setPosition(centerX, textY);
      }

      this.text.setText(text);
      this.text.setVisible(true);

      // Auto-dismiss after duration
      this.scene.time.delayedCall(durationMs, () => this.dismiss());
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const { width } = gameSize;
    this.text.setPosition(width / 2, this.text.y);
    this.text.setWordWrapWidth(Math.min(width - PADDING * 4, 600));
    this.speakerText.setPosition(width / 2, this.speakerText.y);
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this);
    this.typewriterTimer?.remove();
    this.text.destroy();
    this.speakerText.destroy();
  }
}

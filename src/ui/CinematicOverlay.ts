import Phaser from 'phaser';
import { FONT } from '@/config/theme';

const DEPTH = 1000;
const BG_COLOR = 0x06060c;
const TITLE_COLOR = '#f8e848';
const BODY_COLOR = '#f0e8d8';
const SUBTLE_COLOR = '#504878';
const CONTINUE_COLOR = '#504878';
const ACHIEVEMENT_BG = 0xc8a820;
const ACHIEVEMENT_TEXT_COLOR = '#08080f';

/**
 * Full-screen cinematic overlay for story moments:
 * - titleCard: chapter intros with typewriter effect (click to continue)
 * - narrative: lines appearing one by one (click to continue)
 * - achievement: non-blocking popup that auto-dismisses
 */
export class CinematicOverlay {
  private scene: Phaser.Scene;
  /** Persistent black cover shown immediately to prevent scene flash */
  private blackCover: Phaser.GameObjects.Rectangle | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Show an instant black cover to prevent scene flash while cinematic loads.
   * Call this immediately on scene create, before any delay.
   */
  showBlackCover(): void {
    if (this.blackCover) return;
    const { width, height } = this.scene.scale;
    this.blackCover = this.scene.add.rectangle(width / 2, height / 2, width * 2, height * 2, BG_COLOR, 1)
      .setOrigin(0.5)
      .setDepth(DEPTH - 1)
      .setScrollFactor(0);
  }

  /** Remove the black cover with a fade */
  hideBlackCover(): void {
    if (!this.blackCover) return;
    const cover = this.blackCover;
    this.blackCover = null;
    this.scene.tweens.add({
      targets: cover,
      alpha: 0,
      duration: 600,
      onComplete: () => cover.destroy(),
    });
  }

  /**
   * Show a title card with chapter number and title.
   * Click to dismiss after text finishes typing.
   */
  showTitleCard(chapter: string, title: string, subtitle?: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width, height } = this.scene.scale;

      const chapterSize = Math.max(10, Math.min(16, Math.floor(width * 0.014)));
      const titleSize = Math.max(14, Math.min(24, Math.floor(width * 0.022)));
      const subtitleSize = Math.max(8, Math.min(12, Math.floor(width * 0.01)));
      const continueSize = Math.max(7, Math.min(10, Math.floor(width * 0.008)));

      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setAlpha(1).setScrollFactor(0);

      // Black background — instant, no fade
      const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, BG_COLOR, 1)
        .setOrigin(0.5).setScrollFactor(0);
      container.add(bg);

      const chapterText = this.scene.add.text(width / 2, height * 0.38, '', {
        fontFamily: FONT.FAMILY, fontSize: `${chapterSize}px`,
        color: SUBTLE_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0);
      container.add(chapterText);

      const titleText = this.scene.add.text(width / 2, height * 0.48, '', {
        fontFamily: FONT.FAMILY, fontSize: `${titleSize}px`,
        color: TITLE_COLOR, align: 'center',
        wordWrap: { width: width * 0.8, useAdvancedWrap: true }, lineSpacing: 10,
      }).setOrigin(0.5).setScrollFactor(0);
      container.add(titleText);

      const subtitleText = this.scene.add.text(width / 2, height * 0.58, '', {
        fontFamily: FONT.FAMILY, fontSize: `${subtitleSize}px`,
        color: BODY_COLOR, align: 'center',
        wordWrap: { width: width * 0.75, useAdvancedWrap: true }, lineSpacing: 6,
      }).setOrigin(0.5).setScrollFactor(0);
      container.add(subtitleText);

      // "Click to continue" hint — hidden until typing finishes
      const continueHint = this.scene.add.text(width / 2, height * 0.85, '[ click to continue ]', {
        fontFamily: FONT.FAMILY, fontSize: `${continueSize}px`,
        color: CONTINUE_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0);
      container.add(continueHint);

      let typingDone = false;

      // Start typewriter sequence
      this.typewrite(chapterText, chapter, 40, () => {
        this.scene.time.delayedCall(300, () => {
          this.typewrite(titleText, title, 35, () => {
            if (subtitle) {
              this.scene.time.delayedCall(200, () => {
                this.typewrite(subtitleText, subtitle, 30, () => {
                  typingDone = true;
                  this.pulseAlpha(continueHint);
                });
              });
            } else {
              typingDone = true;
              this.pulseAlpha(continueHint);
            }
          });
        });
      });

      // Wait for click to dismiss
      const clickHandler = () => {
        if (!typingDone) return;
        this.scene.input.off('pointerdown', clickHandler);
        this.fadeOutAndDestroy(container, resolve);
      };
      this.scene.input.on('pointerdown', clickHandler);
    });
  }

  /**
   * Show narrative text lines one by one on a black background.
   * Click to advance to next line. Click after last line to dismiss.
   */
  showNarrative(lines: string[]): Promise<void> {
    return new Promise<void>((resolve) => {
      if (lines.length === 0) { resolve(); return; }

      const { width, height } = this.scene.scale;
      const fontSize = Math.max(9, Math.min(14, Math.floor(width * 0.012)));
      const lineHeight = fontSize * 2.5;
      const continueSize = Math.max(7, Math.min(10, Math.floor(width * 0.008)));

      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setAlpha(1).setScrollFactor(0);

      // Black background — instant
      const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, BG_COLOR, 1)
        .setOrigin(0.5).setScrollFactor(0);
      container.add(bg);

      // Calculate starting Y to center the block
      const totalHeight = lines.length * lineHeight;
      const startY = (height - totalHeight) / 2;

      // Create text objects, initially invisible
      const textObjects: Phaser.GameObjects.Text[] = [];
      for (let i = 0; i < lines.length; i++) {
        const txt = this.scene.add.text(width / 2, startY + i * lineHeight, lines[i], {
          fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`,
          color: BODY_COLOR, align: 'center',
          wordWrap: { width: width * 0.85, useAdvancedWrap: true }, lineSpacing: 6,
        }).setOrigin(0.5, 0).setAlpha(0).setScrollFactor(0);
        container.add(txt);
        textObjects.push(txt);
      }

      // "Click to continue" hint
      const continueHint = this.scene.add.text(width / 2, height * 0.92, '[ click to continue ]', {
        fontFamily: FONT.FAMILY, fontSize: `${continueSize}px`,
        color: CONTINUE_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0);
      container.add(continueHint);

      let allRevealed = false;

      // Stagger-reveal all lines automatically
      const staggerDelay = 150; // ms between each line
      const lineTweens: Phaser.Tweens.Tween[] = [];
      textObjects.forEach((txt, i) => {
        const tw = this.scene.tweens.add({
          targets: txt,
          alpha: { from: 0, to: 1 },
          duration: 400,
          delay: i * staggerDelay,
          onComplete: () => {
            if (i === textObjects.length - 1) {
              allRevealed = true;
              this.pulseAlpha(continueHint);
            }
          },
        });
        lineTweens.push(tw);
      });

      // Click handler — skip to all revealed, or dismiss
      const clickHandler = () => {
        if (!allRevealed) {
          // Skip animation — show all lines instantly
          lineTweens.forEach((tw) => tw.stop());
          textObjects.forEach((txt) => txt.setAlpha(1));
          allRevealed = true;
          this.pulseAlpha(continueHint);
          return;
        }
        // All lines shown — dismiss
        this.scene.input.off('pointerdown', clickHandler);
        this.fadeOutAndDestroy(container, resolve);
      };
      this.scene.input.on('pointerdown', clickHandler);
    });
  }

  /**
   * Show a brief achievement popup at top of screen.
   * Non-blocking — slides down, holds 3s, slides up, auto-destroys.
   */
  showAchievement(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width } = this.scene.scale;
      const fontSize = Math.max(8, Math.min(12, Math.floor(width * 0.01)));
      const labelSize = Math.max(6, Math.min(9, Math.floor(width * 0.007)));
      const stripHeight = Math.max(50, Math.floor(fontSize * 5));

      const container = this.scene.add.container(0, -stripHeight).setDepth(DEPTH + 1).setScrollFactor(0);

      const bg = this.scene.add.rectangle(width / 2, stripHeight / 2, width, stripHeight, ACHIEVEMENT_BG, 0.95)
        .setOrigin(0.5).setScrollFactor(0);
      container.add(bg);

      const label = this.scene.add.text(width / 2, stripHeight * 0.3, 'ACHIEVEMENT UNLOCKED', {
        fontFamily: FONT.FAMILY, fontSize: `${labelSize}px`,
        color: ACHIEVEMENT_TEXT_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0);
      container.add(label);

      const achText = this.scene.add.text(width / 2, stripHeight * 0.65, text, {
        fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`,
        color: ACHIEVEMENT_TEXT_COLOR, align: 'center',
        wordWrap: { width: width * 0.85, useAdvancedWrap: true },
      }).setOrigin(0.5).setScrollFactor(0);
      container.add(achText);

      this.scene.tweens.add({
        targets: container,
        y: 0,
        duration: 400,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.time.delayedCall(3000, () => {
            this.scene.tweens.add({
              targets: container,
              y: -stripHeight,
              duration: 400,
              ease: 'Power2',
              onComplete: () => {
                container.destroy(true);
                resolve();
              },
            });
          });
        },
      });
    });
  }

  // ─── Private helpers ───────────────────────

  private typewrite(
    textObj: Phaser.GameObjects.Text, fullText: string,
    charDelayMs: number, onComplete: () => void,
  ): void {
    let charIndex = 0;
    const timer = this.scene.time.addEvent({
      delay: charDelayMs,
      repeat: fullText.length - 1,
      callback: () => {
        charIndex++;
        textObj.setText(fullText.substring(0, charIndex));
        if (charIndex >= fullText.length) {
          timer.remove();
          onComplete();
        }
      },
    });
  }

  /** Pulse a "click to continue" hint with gentle breathing */
  private pulseAlpha(text: Phaser.GameObjects.Text): void {
    this.scene.tweens.add({
      targets: text,
      alpha: { from: 0, to: 0.7 },
      duration: 800,
      yoyo: true,
      repeat: -1,
    });
  }

  private fadeOutAndDestroy(container: Phaser.GameObjects.Container, onDone: () => void): void {
    this.scene.tweens.add({
      targets: container,
      alpha: 0,
      duration: 500,
      onComplete: () => {
        container.destroy(true);
        onDone();
      },
    });
  }

  destroy(): void {
    if (this.blackCover) {
      this.blackCover.destroy();
      this.blackCover = null;
    }
  }
}

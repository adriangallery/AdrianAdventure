import Phaser from 'phaser';
import { FONT } from '@/config/theme';

const DEPTH = 1000;
const BG_COLOR = 0x06060c;
const TITLE_COLOR = '#f8e848';
const BODY_COLOR = '#f0e8d8';
const SUBTLE_COLOR = '#504878';
const CONTINUE_COLOR = '#a090c0';
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

      const refDim = Math.max(width, height * 0.6); // Use larger ref for portrait phones
      const chapterSize = Math.max(12, Math.min(18, Math.floor(refDim * 0.016)));
      const titleSize = Math.max(16, Math.min(28, Math.floor(refDim * 0.026)));
      const subtitleSize = Math.max(10, Math.min(14, Math.floor(refDim * 0.012)));
      const continueSize = Math.max(10, Math.min(14, Math.floor(refDim * 0.012)));

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
      const isLandscape = width > height;
      const refDim = isLandscape ? Math.max(width, height * 1.5) : Math.max(width, height * 0.6);
      const fontSize = Math.max(11, Math.min(16, Math.floor(refDim * 0.012)));
      const lineHeight = fontSize * (isLandscape ? 2.2 : 2.8);
      const continueSize = Math.max(10, Math.min(14, Math.floor(refDim * 0.012)));

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

  /**
   * Rolling credits — classic vertical scroll (Star Wars / Monkey Island style).
   * Shows roles, fun lines, and earned achievements. Click to skip.
   */
  showCredits(earnedAchievements: string[] = []): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width, height } = this.scene.scale;
      const refDim = Math.max(width, height * 0.6);

      const titleSize = Math.max(18, Math.min(28, Math.floor(refDim * 0.024)));
      const headingSize = Math.max(12, Math.min(18, Math.floor(refDim * 0.016)));
      const bodySize = Math.max(10, Math.min(14, Math.floor(refDim * 0.012)));
      const smallSize = Math.max(8, Math.min(11, Math.floor(refDim * 0.009)));

      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setAlpha(1).setScrollFactor(0);

      // Black background
      const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, BG_COLOR, 1)
        .setOrigin(0.5).setScrollFactor(0);
      container.add(bg);

      // Build credits content as a vertical stack
      // Each entry: { text, color, size, gap (extra spacing after) }
      const lines: Array<{ text: string; color: string; size: number; gap?: number }> = [
        { text: 'Z E R O a d v e n t u r e   I I', color: TITLE_COLOR, size: titleSize, gap: 20 },
        { text: 'A Point & Click Web3 Adventure on Base', color: SUBTLE_COLOR, size: smallSize, gap: 50 },

        // ── Story ──
        { text: 'You found Patient Zero.', color: BODY_COLOR, size: bodySize },
        { text: 'You found yourself.', color: BODY_COLOR, size: bodySize, gap: 50 },

        // ── Roles ──
        { text: '— CREATED BY —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Adrian', color: TITLE_COLOR, size: headingSize },
        { text: 'Code, Design, Blockchain, Sleepless Nights,', color: BODY_COLOR, size: smallSize },
        { text: 'Questionable Variable Names, and Pixel Misalignment', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— ART & PIXEL WIZARDRY —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Tiger', color: TITLE_COLOR, size: headingSize },
        { text: '@HalfxTiger', color: SUBTLE_COLOR, size: smallSize },
        { text: 'Scenes, Characters, Items, UI,', color: BODY_COLOR, size: smallSize },
        { text: 'and making pixels look better than most AAA studios', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— AI ASSISTANCE —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Claude', color: '#48d8e8', size: headingSize },
        { text: 'Anthropic', color: SUBTLE_COLOR, size: smallSize },
        { text: 'Voice Generation, Code Architecture,', color: BODY_COLOR, size: smallSize },
        { text: 'Writing 5000 lines at 3 AM without complaining,', color: BODY_COLOR, size: smallSize },
        { text: 'and pretending to understand the blockchain', color: BODY_COLOR, size: smallSize, gap: 40 },

        // ── Tech ──
        { text: '— BUILT WITH —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Phaser 3  \u00B7  TypeScript  \u00B7  Viem', color: BODY_COLOR, size: bodySize },
        { text: 'Base Chain  \u00B7  EIP-2535 Diamond  \u00B7  Kokoro TTS', color: BODY_COLOR, size: bodySize, gap: 40 },

        // ── Fun section ──
        { text: '— SPECIAL THANKS —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'The $ZERO Community', color: TITLE_COLOR, size: bodySize },
        { text: 'The FloorEngine (for sweeping while we sleep)', color: BODY_COLOR, size: smallSize },
        { text: 'The Rubber Duck (for listening)', color: BODY_COLOR, size: smallSize },
        { text: 'Coffee (the real proof-of-work)', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— BUGS REPORTED BY —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Nobody. There are no bugs.', color: BODY_COLOR, size: smallSize },
        { text: 'Everything is a feature.', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— NO ANIMALS WERE HARMED —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Except the three-headed monkey.', color: BODY_COLOR, size: smallSize },
        { text: 'He knows what he did.', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— TIGER FUN FACT —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Tiger drew every pixel in this game', color: BODY_COLOR, size: smallSize },
        { text: 'while Adrian kept changing the color palette.', color: BODY_COLOR, size: smallSize },
        { text: 'Tiger is still drawing. Please send help.', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— ADRIAN FUN FACT —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Adrian deployed 38 smart contracts', color: BODY_COLOR, size: smallSize },
        { text: 'and forgot what half of them do.', color: BODY_COLOR, size: smallSize },
        { text: 'The other half forgot what Adrian does.', color: BODY_COLOR, size: smallSize, gap: 40 },

        { text: '— AI FUN FACT —', color: SUBTLE_COLOR, size: smallSize, gap: 10 },
        { text: 'Claude wrote 1,600+ voice line configs', color: BODY_COLOR, size: smallSize },
        { text: 'and still can\'t tell you what $ZERO is worth.', color: BODY_COLOR, size: smallSize },
        { text: '"I\'m not a financial advisor." \u2014 Claude, 2026', color: SUBTLE_COLOR, size: smallSize, gap: 50 },
      ];

      // ── Achievement summary ──
      if (earnedAchievements.length > 0) {
        lines.push({ text: '— YOUR ACHIEVEMENTS —', color: SUBTLE_COLOR, size: smallSize, gap: 10 });
        for (const id of earnedAchievements) {
          // Use achievement badge emoji based on category
          const name = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          lines.push({ text: `\u2B50 ${name}`, color: TITLE_COLOR, size: smallSize });
        }
        lines.push({ text: '', color: BODY_COLOR, size: smallSize, gap: 30 });
      }

      // ── Final ──
      lines.push(
        { text: 'The ecosystem continues.', color: BODY_COLOR, size: bodySize },
        { text: 'The FloorEngine sweeps.', color: BODY_COLOR, size: bodySize },
        { text: 'The community builds.', color: BODY_COLOR, size: bodySize, gap: 40 },
        { text: 'Thank you for playing.', color: TITLE_COLOR, size: headingSize, gap: 50 },
        { text: 'BE REAL | BE $ZERO', color: TITLE_COLOR, size: titleSize, gap: 30 },
        { text: 'zeroadventures.com', color: SUBTLE_COLOR, size: smallSize, gap: 80 },
      );

      // Create text objects stacked vertically, starting BELOW the screen
      const lineGap = 8; // base gap between lines
      let curY = 0;
      const textObjects: Phaser.GameObjects.Text[] = [];

      for (const line of lines) {
        const txt = this.scene.add.text(width / 2, curY, line.text, {
          fontFamily: FONT.FAMILY,
          fontSize: `${line.size}px`,
          color: line.color,
          align: 'center',
          wordWrap: { width: width * 0.85, useAdvancedWrap: true },
          lineSpacing: 4,
        }).setOrigin(0.5, 0).setScrollFactor(0);
        container.add(txt);
        textObjects.push(txt);
        curY += line.size + lineGap + (line.gap ?? 0);
      }

      // Total content height
      const contentH = curY;
      // Duration: scroll the entire content + screen height
      const totalScroll = contentH + height;
      const scrollDuration = totalScroll * 28; // ~28ms per pixel = slow, cinematic

      // Position all text below the screen
      const scrollContainer = this.scene.add.container(0, height).setScrollFactor(0);
      for (const txt of textObjects) {
        container.remove(txt);
        scrollContainer.add(txt);
      }
      container.add(scrollContainer);

      // Scroll upward
      this.scene.tweens.add({
        targets: scrollContainer,
        y: -contentH,
        duration: scrollDuration,
        ease: 'Linear',
        onComplete: () => {
          this.fadeOutAndDestroy(container, resolve);
        },
      });

      // "Click to skip" hint at bottom
      const skipHint = this.scene.add.text(width / 2, height - 20, '[ click to skip ]', {
        fontFamily: FONT.FAMILY, fontSize: `${smallSize}px`,
        color: CONTINUE_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0);
      container.add(skipHint);

      // Show skip hint after 3 seconds
      this.scene.time.delayedCall(3000, () => {
        this.pulseAlpha(skipHint);
      });

      // Click to skip
      const clickHandler = () => {
        this.scene.input.off('pointerdown', clickHandler);
        this.scene.tweens.killTweensOf(scrollContainer);
        this.fadeOutAndDestroy(container, resolve);
      };
      this.scene.input.on('pointerdown', clickHandler);
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
      alpha: { from: 0.3, to: 1 },
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

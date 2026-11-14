import Phaser from 'phaser';
import { achievementRect, achievementStripHeight, type Rect } from './achievementLayout';
import { FONT } from '@/config/theme';
import { BRANDING } from '@/config/branding';
import { CREDITS_HOLD_MS, CREDITS_LOCK_MS, ENDING_TAP_GUARD_MS, creditsSkipAllowed, endingTapAllowed, type CreditsInput } from '@/systems/Ending';

/** A9.4: lo que la API de QA y las demos ven de los créditos */
export interface CreditsQaInfo {
  startedAt: number;
  durationMs: number;
  /** Toques que no saltaron los créditos */
  tapsIgnored: number;
  /** Esc pulsados en los primeros 3 s (no saltan) */
  escIgnored: number;
  skipped: boolean;
  skipInput: CreditsInput | null;
  skippedAtMs: number | null;
  done: boolean;
  smallestFontPx: number;
}

/** A9.4: lo que la API de QA y las demos ven de «THE END» y el resumen */
export interface EndingQaInfo {
  theEnd: boolean;
  stats: string[];
  achievements: string[];
  /** Cuántos logros caben en pantalla (el resto sale como «+N more») */
  achievementsShown: number;
  tapsIgnored: number;
  done: boolean;
}

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
   * A3.2: con `autoMs` (dentro de una cinemática del motor) se cierra sola `autoMs` después de escribirse, sin
   * «click to continue»; un toque la cierra antes, como siempre.
   */
  showTitleCard(chapter: string, title: string, subtitle?: string, autoMs?: number): Promise<void> {
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
      let dismissed = false;
      this.skipTyping = false;
      const autoDelay = typeof autoMs === 'number' && Number.isFinite(autoMs) && autoMs >= 0 ? autoMs : null;

      const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        this.skipTyping = false;
        this.scene.input.off('pointerdown', clickHandler);
        this.fadeOutAndDestroy(container, resolve);
      };
      const onTyped = () => {
        typingDone = true;
        if (autoDelay !== null) this.scene.time.delayedCall(autoDelay, dismiss);
        else this.pulseAlpha(continueHint);
      };

      // Start typewriter sequence
      this.typewrite(chapterText, chapter, 40, () => {
        this.scene.time.delayedCall(300, () => {
          this.typewrite(titleText, title, 35, () => {
            if (subtitle) {
              this.scene.time.delayedCall(200, () => {
                this.typewrite(subtitleText, subtitle, 30, onTyped);
              });
            } else {
              onTyped();
            }
          });
        });
      });

      // Wait for click to dismiss
      const clickHandler = () => {
        if (!typingDone) { this.skipTyping = true; return; }
        dismiss();
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
   * Show a brief achievement popup. Non-blocking — holds 3s and auto-destroys.
   * A9.3: sale abajo de la escena, apoyada sobre el panel de verbos (`panelH`), no arriba sobre los botones;
   * UIScene la encola hasta que no hay frase ni diálogo en pantalla (src/ui/achievementLayout.ts).
   */
  showAchievement(text: string, panelH = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width, height } = this.scene.scale;
      // A5.2: mínimo 11 px en móvil (antes 8 y 6)
      const fontSize = Math.max(11, Math.min(12, Math.floor(width * 0.01)));
      const labelSize = 11;
      const stripHeight = achievementStripHeight(fontSize);
      const rect = achievementRect(width, height, panelH, stripHeight);
      this.lastAchievementRect = rect;

      const container = this.scene.add.container(0, rect.y + 12).setDepth(DEPTH + 1).setScrollFactor(0).setAlpha(0);

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
        y: rect.y,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.time.delayedCall(3000, () => {
            this.scene.tweens.add({
              targets: container,
              alpha: 0,
              duration: 400,
              ease: 'Power2',
              onComplete: () => {
                container.destroy(true);
                this.lastAchievementRect = null;
                resolve();
              },
            });
          });
        },
      });
    });
  }

  /** A9.3: caja de la franja de logro en pantalla (null si no hay); la demo comprueba que no pisa nada. */
  lastAchievementRect: Rect | null = null;

  /**
   * Rolling credits — classic vertical scroll (Star Wars / Monkey Island style).
   * A9.4: un toque NO los salta (el toque que cerró la última frase los quitaba al momento); en los primeros
   * CREDITS_LOCK_MS no los salta nada y después, mantener pulsado CREDITS_HOLD_MS o Esc. Nombre y web de
   * src/config/branding.ts; los logros llegan ya con su nombre legible. Resuelve `true` si se saltaron.
   */
  showCredits(achievementNames: string[] = [], qa?: (info: CreditsQaInfo) => void): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const { width, height } = this.scene.scale;
      const refDim = Math.max(width, height * 0.6);

      const titleSize = Math.max(18, Math.min(28, Math.floor(refDim * 0.024)));
      const headingSize = Math.max(13, Math.min(18, Math.floor(refDim * 0.016)));
      // A9.4: mínimo 11 px (A5.2) también en los créditos
      const bodySize = Math.max(12, Math.min(14, Math.floor(refDim * 0.012)));
      const smallSize = Math.max(11, Math.min(12, Math.floor(refDim * 0.009)));

      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setAlpha(1).setScrollFactor(0);

      // Black background
      const bg = this.scene.add.rectangle(width / 2, height / 2, width, height, BG_COLOR, 1)
        .setOrigin(0.5).setScrollFactor(0);
      container.add(bg);

      // Build credits content as a vertical stack
      // Each entry: { text, color, size, gap (extra spacing after) }
      const lines: Array<{ text: string; color: string; size: number; gap?: number }> = [
        { text: BRANDING.name, color: TITLE_COLOR, size: titleSize, gap: 20 },
        { text: BRANDING.tagline, color: SUBTLE_COLOR, size: smallSize, gap: 50 },

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
      if (achievementNames.length > 0) {
        lines.push({ text: '— YOUR ACHIEVEMENTS —', color: SUBTLE_COLOR, size: smallSize, gap: 10 });
        // A7.3: ★ (U+2605, está en Press Start 2P) en vez de ⭐. A9.4: el nombre legible del logro, no su id
        for (const name of achievementNames) lines.push({ text: `\u2605 ${name}`, color: TITLE_COLOR, size: smallSize });
        lines.push({ text: '', color: BODY_COLOR, size: smallSize, gap: 30 });
      }

      // ── Final ──
      lines.push(
        { text: 'The ecosystem continues.', color: BODY_COLOR, size: bodySize },
        { text: 'The FloorEngine sweeps.', color: BODY_COLOR, size: bodySize },
        { text: 'The community builds.', color: BODY_COLOR, size: bodySize, gap: 40 },
        { text: 'Thank you for playing.', color: TITLE_COLOR, size: headingSize, gap: 50 },
        { text: 'BE REAL | BE $ZERO', color: TITLE_COLOR, size: titleSize, gap: 30 },
        { text: BRANDING.web, color: SUBTLE_COLOR, size: smallSize, gap: 80 },
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
        // A9.4: con letra de 11 px una línea larga puede partirse en vertical: se cuenta su alto real
        curY += Math.max(line.size, txt.height) + lineGap + (line.gap ?? 0);
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

      const info: CreditsQaInfo = {
        startedAt: this.scene.time.now, durationMs: scrollDuration, tapsIgnored: 0, escIgnored: 0,
        skipped: false, skipInput: null, skippedAtMs: null, done: false, smallestFontPx: Math.min(...lines.map((l) => l.size)),
      };
      const report = () => qa?.({ ...info });
      report();

      let finished = false;
      const finish = (skipInput: CreditsInput | null) => {
        if (finished) return;
        finished = true;
        this.scene.input.off('pointerdown', onDown);
        this.scene.input.off('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        holdCheck.remove();
        this.scene.tweens.killTweensOf(scrollContainer);
        if (skipInput) {
          info.skipped = true;
          info.skipInput = skipInput;
          info.skippedAtMs = Math.round(this.scene.time.now - info.startedAt);
        }
        this.fadeOutAndDestroy(container, () => {
          info.done = true;
          report();
          resolve(info.skipped);
        });
        report();
      };

      // Scroll upward
      this.scene.tweens.add({
        targets: scrollContainer,
        y: -contentH,
        duration: scrollDuration,
        ease: 'Linear',
        onComplete: () => finish(null),
      });

      // A9.4: aviso de cómo saltarlos, solo cuando ya se puede (pasados CREDITS_LOCK_MS)
      const touch = this.scene.sys.game.device.input.touch;
      const skipHint = this.scene.add.text(width / 2, height - 20, touch ? '[ hold to skip ]' : '[ hold or Esc to skip ]', {
        fontFamily: FONT.FAMILY, fontSize: `${smallSize}px`,
        color: CONTINUE_COLOR, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setAlpha(0).setName('credits-skip-hint');
      container.add(skipHint);
      this.scene.time.delayedCall(CREDITS_LOCK_MS, () => {
        if (!finished) this.pulseAlpha(skipHint);
      });

      const elapsed = () => this.scene.time.now - info.startedAt;
      // Mantener pulsado: se mide desde que baja el dedo (los toques sintéticos del avance rápido de GameScene, con el
      // dedo aún abajo, no reinician la cuenta); un toque suelto no hace nada.
      let holdFrom: number | null = null;
      let holdPointer: Phaser.Input.Pointer | null = null;
      const onDown = (pointer: Phaser.Input.Pointer) => {
        if (finished) return;
        if (pointer?.isDown && holdFrom === null) {
          holdFrom = this.scene.time.now;
          holdPointer = pointer;
        }
        info.tapsIgnored++;
        report();
      };
      const onUp = () => { holdFrom = null; holdPointer = null; };
      const holdCheck = this.scene.time.addEvent({
        delay: 100, loop: true,
        callback: () => {
          if (finished || holdFrom === null) return;
          if (!holdPointer?.isDown) { holdFrom = null; holdPointer = null; return; }
          if (this.scene.time.now - holdFrom >= CREDITS_HOLD_MS && creditsSkipAllowed('hold', elapsed())) {
            info.tapsIgnored = Math.max(0, info.tapsIgnored - 1); // el toque que empezó a mantener no era un toque
            finish('hold');
          }
        },
      });
      const onKey = (e: KeyboardEvent) => {
        if (finished || (e.key !== 'Escape' && e.key !== 'Esc')) return;
        if (creditsSkipAllowed('esc', elapsed())) finish('esc');
        else { info.escIgnored++; report(); }
      };
      this.scene.input.on('pointerdown', onDown);
      this.scene.input.on('pointerup', onUp);
      window.addEventListener('keydown', onKey);
    });
  }

  /**
   * A9.4: «THE END» y el resumen de la partida (tiempo jugado, llamadas a Anon, logros), sobre negro. Se cierra con un
   * toque, Esc, Intro o espacio pasados ENDING_TAP_GUARD_MS (antes no, para que dé tiempo a leerlo). La letra no baja de
   * 11 px; si la lista de logros no cabe, se acorta con «+N more». Deja en `lastEndingLayout` las cajas de cada texto.
   */
  showEnding(summary: { stats: string[]; achievements: string[] }, qa?: (info: EndingQaInfo) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width, height } = this.scene.scale;
      const isLandscape = width > height;
      const refDim = isLandscape ? Math.max(width, height * 1.5) : Math.max(width, height * 0.6);
      const theEndSize = Math.max(22, Math.min(40, Math.floor(refDim * 0.034)));
      let bodySize = Math.max(11, Math.min(14, Math.floor(refDim * 0.012)));
      const hintSize = Math.max(11, Math.min(13, Math.floor(refDim * 0.011)));
      const margin = Math.max(12, Math.round(height * 0.05));
      const wrapW = Math.min(width * 0.88, 720);

      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setAlpha(0).setScrollFactor(0);
      container.add(this.scene.add.rectangle(width / 2, height / 2, width, height, BG_COLOR, 1).setOrigin(0.5).setScrollFactor(0));

      const theEnd = this.scene.add.text(width / 2, 0, 'THE END', {
        fontFamily: FONT.FAMILY, fontSize: `${theEndSize}px`, color: TITLE_COLOR, align: 'center',
      }).setOrigin(0.5, 0).setScrollFactor(0).setName('ending-the-end');
      const name = this.scene.add.text(width / 2, 0, BRANDING.name, {
        fontFamily: FONT.FAMILY, fontSize: `${hintSize}px`, color: SUBTLE_COLOR, align: 'center',
        wordWrap: { width: wrapW, useAdvancedWrap: true },
      }).setOrigin(0.5, 0).setScrollFactor(0).setName('ending-name');
      const stats = this.scene.add.text(width / 2, 0, summary.stats.join('\n'), {
        fontFamily: FONT.FAMILY, fontSize: `${bodySize}px`, color: BODY_COLOR, align: 'center',
        wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: Math.round(bodySize * 0.6),
      }).setOrigin(0.5, 0).setScrollFactor(0).setName('ending-stats');
      const ach = this.scene.add.text(width / 2, 0, '', {
        fontFamily: FONT.FAMILY, fontSize: `${bodySize}px`, color: TITLE_COLOR, align: 'center',
        wordWrap: { width: wrapW, useAdvancedWrap: true }, lineSpacing: Math.round(bodySize * 0.5),
      }).setOrigin(0.5, 0).setScrollFactor(0).setName('ending-achievements');
      const hint = this.scene.add.text(width / 2, height - margin, '[ tap to return to the title ]', {
        fontFamily: FONT.FAMILY, fontSize: `${hintSize}px`, color: CONTINUE_COLOR, align: 'center',
      }).setOrigin(0.5, 1).setScrollFactor(0).setAlpha(0).setName('ending-hint');
      container.add([theEnd, name, stats, ach, hint]);

      // Coloca todo de arriba abajo; si no cabe, primero baja la letra (hasta 11 px) y luego acorta la lista de logros
      const gap = () => Math.max(6, Math.round(bodySize * 0.9));
      const layout = (shown: number): number => {
        const list = summary.achievements.slice(0, shown).map((n) => `\u2605 ${n}`);
        const more = summary.achievements.length - shown;
        if (more > 0) list.push(`+${more} more`);
        ach.setFontSize(bodySize).setLineSpacing(Math.round(bodySize * 0.5)).setText(list.join('   '));
        stats.setFontSize(bodySize).setLineSpacing(Math.round(bodySize * 0.6));
        let y = margin;
        theEnd.setY(y); y += theEnd.height + Math.round(gap() * 0.5);
        name.setY(y); y += name.height + gap() * 1.5;
        stats.setY(y); y += stats.height + gap();
        ach.setY(y); y += ach.height;
        return y;
      };
      const limit = height - margin - hint.height - gap();
      let shown = summary.achievements.length;
      let bottom = layout(shown);
      while (bottom > limit && bodySize > 11) { bodySize--; bottom = layout(shown); }
      while (bottom > limit && shown > 0) { shown--; bottom = layout(shown); }

      const rect = (t: Phaser.GameObjects.Text) => ({
        name: t.name, x: Math.round(t.x - t.width / 2), y: Math.round(t.y - (t.originY === 1 ? t.height : 0)),
        w: Math.round(t.width), h: Math.round(t.height), fontPx: parseInt(String(t.style.fontSize), 10),
      });
      this.lastEndingLayout = { width, height, texts: [theEnd, name, stats, ach, hint].filter((t) => t.text).map(rect) };

      const shownAt = this.scene.time.now;
      const info: EndingQaInfo = {
        theEnd: true, stats: [...summary.stats], achievements: [...summary.achievements], achievementsShown: shown,
        tapsIgnored: 0, done: false,
      };
      qa?.({ ...info });
      this.scene.tweens.add({ targets: container, alpha: 1, duration: 600 });
      this.scene.time.delayedCall(ENDING_TAP_GUARD_MS, () => { if (!closed) this.pulseAlpha(hint); });

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        this.scene.input.off('pointerdown', onDown);
        window.removeEventListener('keydown', onKey);
        this.fadeOutAndDestroy(container, () => {
          this.lastEndingLayout = null;
          info.done = true;
          qa?.({ ...info });
          resolve();
        });
      };
      const onDown = () => {
        if (endingTapAllowed(this.scene.time.now - shownAt)) close();
        else { info.tapsIgnored++; qa?.({ ...info }); }
      };
      const onKey = (e: KeyboardEvent) => {
        if (!['Escape', 'Esc', 'Enter', ' '].includes(e.key)) return;
        if (endingTapAllowed(this.scene.time.now - shownAt)) close();
      };
      this.scene.input.on('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
    });
  }

  /** A9.4: cajas (px de pantalla) y tamaño de letra de cada texto del resumen en pantalla; null si no está. */
  lastEndingLayout: { width: number; height: number; texts: Array<{ name: string; x: number; y: number; w: number; h: number; fontPx: number }> } | null = null;

  // ─── Private helpers ───────────────────────

  /** V6: un toque durante la escritura del título la completa de golpe */
  private skipTyping = false;

  private typewrite(
    textObj: Phaser.GameObjects.Text, fullText: string,
    charDelayMs: number, onComplete: () => void,
  ): void {
    let charIndex = 0;
    const timer = this.scene.time.addEvent({
      delay: charDelayMs,
      repeat: fullText.length - 1,
      callback: () => {
        if (this.skipTyping) charIndex = fullText.length - 1;
        charIndex++;
        textObj.setText(fullText.substring(0, charIndex));
        if (charIndex >= fullText.length) {
          timer.remove();
          onComplete();
        }
      },
    });
  }

  /**
   * V6b — monitor del treatment_room: lluvia verde a pantalla completa y, encima, el expediente del
   * jugador tecleado como en un terminal. `linesPromise` resuelve cuando termina la consulta on-chain;
   * mientras tanto parpadea «ACCESSING PATIENT RECORDS». Clic: completa el texto; otro clic: cierra.
   */
  showMonitorReveal(linesPromise: Promise<string[]>): Promise<void> {
    return new Promise<void>((resolve) => {
      const { width, height } = this.scene.scale;
      const container = this.scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);
      container.add(this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 1)
        .setOrigin(0.5).setScrollFactor(0));

      // Lluvia en un canvas propio: cada paso oscurece un poco y dibuja un carácter por columna
      const texKey = `monitor_rain_${Date.now()}`;
      const canvasTex = this.scene.textures.createCanvas(texKey, width, height);
      if (canvasTex) container.add(this.scene.add.image(0, 0, texKey).setOrigin(0, 0).setScrollFactor(0));
      const glyph = Math.max(10, Math.floor(Math.min(width, height) / 40));
      const cols = Math.ceil(width / glyph);
      const drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -40));
      const chars = '0123456789abcdefx';
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const rainTimer = this.scene.time.addEvent({
        delay: 60, loop: true, paused: reducedMotion || !canvasTex,
        callback: () => {
          if (!canvasTex) return;
          const ctx = canvasTex.context;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
          ctx.fillRect(0, 0, width, height);
          ctx.font = `${glyph}px monospace`;
          for (let i = 0; i < cols; i++) {
            const y = drops[i] * glyph;
            if (y >= 0) {
              ctx.fillStyle = Math.random() < 0.1 ? '#c8ffc8' : '#1f9f44';
              ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * glyph, y);
            }
            drops[i] = y > height && Math.random() > 0.975 ? 0 : drops[i] + 1;
          }
          canvasTex.refresh();
        },
      });

      // Panel de terminal
      const panelW = Math.min(width * 0.9, 760);
      const panelH = Math.min(height * 0.72, 520);
      const pad = Math.max(12, Math.floor(panelW * 0.04));
      const fontSize = Math.max(8, Math.min(14, Math.floor((panelW - pad * 2) / 30)));
      const panel = this.scene.add.rectangle(width / 2, height / 2, panelW, panelH, 0x000000, 0.82)
        .setOrigin(0.5).setStrokeStyle(2, 0x2bd35a, 0.9).setScrollFactor(0);
      container.add(panel);
      const text = this.scene.add.text(width / 2 - panelW / 2 + pad, height / 2 - panelH / 2 + pad, '', {
        fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`, color: '#5dff8a',
        lineSpacing: Math.floor(fontSize * 0.9),
        wordWrap: { width: panelW - pad * 2, useAdvancedWrap: true },
      }).setOrigin(0, 0).setScrollFactor(0);
      container.add(text);
      const continueHint = this.scene.add.text(width / 2, height / 2 + panelH / 2 - pad, '[ click to continue ]', {
        fontFamily: FONT.FAMILY, fontSize: `${Math.max(8, fontSize - 2)}px`, color: '#2bd35a', align: 'center',
      }).setOrigin(0.5, 1).setScrollFactor(0).setAlpha(0);
      container.add(continueHint);

      let phase: 'loading' | 'typing' | 'done' = 'loading';
      let full = '';
      let typed = 0;
      let cursorOn = true;
      const loadingText = '> ACCESSING PATIENT RECORDS';
      const cursorTimer = this.scene.time.addEvent({
        delay: 400, loop: true,
        callback: () => {
          cursorOn = !cursorOn;
          if (phase === 'loading') text.setText(`${loadingText}${cursorOn ? '...' : ''}_`);
        },
      });
      text.setText(`${loadingText}..._`);

      let typeTimer: Phaser.Time.TimerEvent | null = null;
      const finishTyping = () => {
        typeTimer?.remove();
        typeTimer = null;
        text.setText(full);
        phase = 'done';
        this.pulseAlpha(continueHint);
      };

      const minLoadingMs = 1400;
      const startedAt = Date.now();
      linesPromise
        .catch(() => ['> RECORDS UNREADABLE. THE NODE IS SILENT.', '> DIAGNOSIS: PATIENT ZERO'])
        .then((lines) => {
          const delay = Math.max(0, minLoadingMs - (Date.now() - startedAt));
          this.scene.time.delayedCall(delay, () => {
            if (!container.active) return;
            full = lines.join('\n');
            phase = 'typing';
            typeTimer = this.scene.time.addEvent({
              delay: 24, loop: true,
              callback: () => {
                typed = Math.min(full.length, typed + 2);
                text.setText(full.slice(0, typed) + (typed < full.length ? '_' : ''));
                if (typed >= full.length) finishTyping();
              },
            });
          });
        });

      const clickHandler = () => {
        if (phase === 'loading') return;
        if (phase === 'typing') { finishTyping(); return; }
        this.scene.input.off('pointerdown', clickHandler);
        rainTimer.remove();
        cursorTimer.remove();
        this.fadeOutAndDestroy(container, () => {
          if (this.scene.textures.exists(texKey)) this.scene.textures.remove(texKey);
          resolve();
        });
      };
      this.scene.input.on('pointerdown', clickHandler);
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

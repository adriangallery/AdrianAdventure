import Phaser from 'phaser';
import { charDelayMs } from '@/systems/Settings';
import { TWP, FONT, SPEECH_COLORS } from '@/config/theme';
import type { SceneData } from '@/types/scene.types';
import {
  isAnchorOnScreen, placeSpeech, speakerKind, speechColor, speechFontSize, speechStroke, speechWrapWidth, topY,
  type HeadAnchor, type SpeakerKind, type SpeechMode,
} from './speechLayout';

// Velocidad del texto: ver src/systems/Settings.ts (antes fija a 25 ms por carácter)

/** A2.3: cabeza en pantalla de quien habla ('player' o nombre/id de la NPC); null si no está o no se ve. */
export type SpeakerHeadProvider = (who: string) => (HeadAnchor & { id: string }) | null;

/** A2.3 (QA): texto en pantalla, dónde está y en qué modo. */
export interface SpeechState {
  text: string;
  speaker: string | null;
  /** Centro horizontal y borde superior del bloque de texto (pantalla) */
  x: number;
  y: number;
  /** Tamaño del bloque (mensaje completo) */
  w: number;
  h: number;
  color: string;
  mode: SpeechMode;
  kind: SpeakerKind;
  /** Cabeza de quien habla en pantalla (null en modo top o si no se encontró) */
  head: HeadAnchor | null;
}

interface Current {
  speaker: string | null;
  kind: SpeakerKind;
  /** A quién se le pregunta la cabeza ('player' o el speaker de la NPC); null = narrador */
  who: string | null;
  color: string;
  mode: SpeechMode | null;
  head: HeadAnchor | null;
  wrap: number;
  w: number;
  h: number;
}

/**
 * Dialogue text displayed directly in the game viewport, LucasArts / Thimbleweed Park style: colored text on
 * screen, no box background. Tap/click to skip or dismiss.
 *
 * A2.3: el texto del jugador y de las NPC se pinta sobre la cabeza de quien habla (sigue a la cámara y al
 * personaje cada frame), en el color de cada personaje (`SPEECH_COLORS`); el narrador/sistema y los textos de
 * quien no se ve (hidePlayer, closeups, tráiler, fuera de pantalla) van arriba-centro como antes, con el nombre.
 * La colocación está en `speechLayout.ts` (lógica pura, con tests).
 */
export class DialogueBox {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private speakerText: Phaser.GameObjects.Text;
  private headOf: SpeakerHeadProvider | null;

  private fullMessage = '';
  private displayedChars = 0;
  private typewriterTimer: Phaser.Time.TimerEvent | null = null;
  private resolvePromise: (() => void) | null = null;
  private visible = false;
  private activeHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pendingHandlerCall: Phaser.Time.TimerEvent | null = null;
  private pendingDismissCall: Phaser.Time.TimerEvent | null = null;
  private current: Current | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, headOf?: SpeakerHeadProvider) {
    this.scene = scene;
    this.headOf = headOf ?? null;
    const { width, height } = scene.scale;
    const size = speechFontSize({ width, height });

    // Speaker name — yellow (TWP character name style); solo en modo arriba-centro
    this.speakerText = scene.add.text(width / 2, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${size.speaker}px`,
      color: TWP.DIALOGUE_SPEAKER,
      stroke: TWP.DIALOGUE_STROKE,
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(600).setVisible(false).setScrollFactor(0);

    // Body text — color por personaje con contorno oscuro y sombra (legible sobre fondos cargados)
    this.text = scene.add.text(width / 2, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${size.body}px`,
      color: TWP.DIALOGUE_TEXT,
      stroke: TWP.DIALOGUE_STROKE,
      strokeThickness: speechStroke(size.body),
      align: 'center',
      wordWrap: { width: speechWrapWidth({ width, height }, 'top'), useAdvancedWrap: true },
      lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(600).setVisible(false).setScrollFactor(0);
    this.text.setShadow(2, 2, '#000000', 0, true, true);

    scene.scale.on('resize', this.handleResize, this);
    // A2.3: el texto sobre la cabeza sigue a la cámara y al personaje (se quita en destroy)
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.layout, this);
  }

  say(text: string, speaker?: string): Promise<void> {
    return new Promise<void>((resolve) => {
      // Clean up any previous dialogue immediately
      this.cleanup();

      this.resolvePromise = resolve;
      this.fullMessage = text;
      this.displayedChars = 0;
      this.visible = true;
      this.scene.registry.set('dialogueShowing', true);

      this.begin(speaker);
      this.text.setText('');
      this.text.setVisible(true);

      // Typewriter effect — V6: velocidad según los ajustes del jugador (instant = texto completo)
      const charDelay = charDelayMs();
      if (charDelay === 0) {
        this.displayedChars = this.fullMessage.length;
        this.text.setText(this.fullMessage);
      } else {
        this.typewriterTimer = this.scene.time.addEvent({
          delay: charDelay,
          repeat: this.fullMessage.length - 1,
          callback: () => {
            this.displayedChars++;
            this.text.setText(this.fullMessage.substring(0, this.displayedChars));
          },
        });
      }

      // Click to skip typewriter, then click again to dismiss
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
          this.dismiss();
        }
      };
      this.activeHandler = handler;

      this.pendingHandlerCall = this.scene.time.delayedCall(150, () => {
        this.pendingHandlerCall = null;
        this.scene.input.on('pointerdown', handler);
      });
      this.scene.time.delayedCall(minReadTime, () => {
        canDismiss = true;
      });
    });
  }

  /**
   * A2.3: quién habla, su color y el tamaño del bloque con el mensaje completo; coloca el texto por primera vez.
   * El tamaño se mide con el mensaje entero para que el typewriter no haga saltar el bloque.
   */
  private begin(speaker?: string): void {
    const kind = speakerKind(speaker);
    const who = kind === 'player' ? 'player' : kind === 'npc' ? (speaker ?? '').trim() : null;
    const head = who ? this.headOf?.(who) ?? null : null;
    const npcData = kind === 'npc'
      ? (this.scene.registry.get('sceneData') as SceneData | undefined)?.npcs?.find((n) =>
        n.id === head?.id || n.name.toLowerCase() === (speaker ?? '').trim().toLowerCase())
      : undefined;
    const color = speechColor({
      kind,
      keys: [head?.id, npcData?.id, npcData?.name, speaker],
      colors: SPEECH_COLORS,
      npcColor: npcData?.color,
      fallback: TWP.DIALOGUE_TEXT,
    });

    const size = speechFontSize(this.scene.scale);
    this.text.setFontSize(`${size.body}px`).setStroke(TWP.DIALOGUE_STROKE, speechStroke(size.body)).setColor(color);
    this.speakerText.setFontSize(`${size.speaker}px`).setText(kind !== 'player' ? speaker ?? '' : '');
    this.current = { speaker: speaker ?? null, kind, who, color, mode: null, head: null, wrap: 0, w: 0, h: 0 };
    this.layout();
  }

  /** Mide el bloque con el mensaje completo a ese ancho de wrap (y deja escrito lo que llevaba el typewriter). */
  private measure(wrap: number): void {
    const cur = this.current;
    if (!cur) return;
    this.text.setWordWrapWidth(wrap);
    const shown = this.text.text;
    this.text.setText(this.fullMessage);
    cur.w = this.text.width;
    cur.h = this.text.height;
    cur.wrap = wrap;
    if (shown !== this.fullMessage) this.text.setText(shown);
  }

  /** A2.3: coloca el texto (cada frame mientras se ve, en POST_UPDATE): sobre la cabeza o arriba-centro. */
  private layout(): void {
    const cur = this.current;
    if (!this.visible || !cur || this.destroyed || !this.text.active) return;
    const vp = { width: this.scene.scale.width, height: this.scene.scale.height };
    const head = cur.who ? this.headOf?.(cur.who) ?? null : null;

    // Fuera de pantalla o sin cabeza: arriba-centro (con su ancho de wrap); se vuelve a medir solo si cambia
    const anchor = isAnchorOnScreen(head, vp) ? head : null;
    const wrap = speechWrapWidth(vp, anchor ? 'head' : 'top');
    if (cur.wrap !== wrap) this.measure(wrap);
    // A2.10: en cinemática el panel está oculto bajo la franja inferior, que es la banda de subtítulos
    const band = (this.scene.registry.get('cinematicBand') as { top: number; bottom: number } | null | undefined) ?? null;
    const panelH = band ? 0 : ((this.scene.registry.get('scummPanelHeight') as number | undefined) ?? 0);
    const p = placeSpeech({ head: anchor, vp, textW: cur.w, textH: cur.h, bottomInset: panelH, band });

    cur.mode = p.mode;
    cur.head = p.mode === 'head' && anchor ? { x: anchor.x, headY: anchor.headY, footY: anchor.footY } : null;
    if (p.mode === 'head') {
      this.speakerText.setVisible(false);
      this.text.setPosition(Math.round(p.x), Math.round(p.y));
      return;
    }
    // Arriba-centro, como antes de A2.3 (o A2.10: en la franja inferior): con el nombre de quien habla encima
    const y = p.mode === 'band' ? p.y : topY(vp);
    if (this.speakerText.text) {
      this.speakerText.setPosition(p.x, y - 4).setVisible(true);
      this.text.setPosition(p.x, y + 2);
    } else {
      this.speakerText.setVisible(false);
      this.text.setPosition(p.x, y);
    }
  }

  /** A2.3 (QA): texto en pantalla y su colocación; null si no hay ninguno. */
  getSpeech(): SpeechState | null {
    const cur = this.current;
    if (!this.visible || !cur || !cur.mode) return null;
    return {
      text: this.fullMessage,
      speaker: cur.speaker,
      x: this.text.x,
      y: this.text.y,
      w: cur.w,
      h: cur.h,
      color: cur.color,
      mode: cur.mode,
      kind: cur.kind,
      head: cur.head ? { ...cur.head } : null,
    };
  }

  /**
   * Clean up current dialogue and resolve its pending promise.
   * Resolving prevents script-engine awaits from hanging when a say is
   * interrupted by another say (which would otherwise leave running=true
   * and freeze all input permanently).
   */
  private cleanup(): void {
    if (this.activeHandler) {
      this.scene.input.off('pointerdown', this.activeHandler);
      this.activeHandler = null;
    }
    // Cancel pending delayed calls to prevent handler leaks
    this.pendingHandlerCall?.remove();
    this.pendingHandlerCall = null;
    this.pendingDismissCall?.remove();
    this.pendingDismissCall = null;
    this.typewriterTimer?.remove();
    this.typewriterTimer = null;
    this.visible = false;
    this.current = null;
    this.scene.registry.set('dialogueShowing', false);
    this.text.setVisible(false);
    this.speakerText.setVisible(false);
    // Capture and clear before invoking, so re-entrant calls don't double-resolve
    const prev = this.resolvePromise;
    this.resolvePromise = null;
    prev?.();
  }

  private dismiss(): void {
    // Guard: don't dismiss if nothing is showing — prevents leaked handlers
    // from setting dialogueDismissedAt on every click (which would freeze input)
    if (!this.visible) return;
    if (this.activeHandler) {
      this.scene.input.off('pointerdown', this.activeHandler);
      this.activeHandler = null;
    }
    this.pendingHandlerCall?.remove();
    this.pendingHandlerCall = null;
    this.pendingDismissCall?.remove();
    this.pendingDismissCall = null;
    this.typewriterTimer?.remove();
    this.typewriterTimer = null;
    this.visible = false;
    this.current = null;
    this.scene.registry.set('dialogueShowing', false);
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
      this.cleanup();

      this.resolvePromise = resolve;
      this.fullMessage = text;
      this.displayedChars = text.length;
      this.visible = true;
      this.scene.registry.set('dialogueShowing', true);

      this.text.setText(text);
      this.begin(speaker);
      this.text.setVisible(true);

      // Auto-dismiss after duration
      this.pendingDismissCall = this.scene.time.delayedCall(durationMs, () => {
        this.pendingDismissCall = null;
        this.dismiss();
      });
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * A2.10: subtítulo de cinemática que avanza solo: si `text` sigue en pantalla, lo completa y lo cierra como un
   * toque. Devuelve false si ya no está (lo cerró un toque o lo sustituyó otro texto).
   */
  advanceIfShowing(text: string): boolean {
    if (!this.visible || this.fullMessage !== text) return false;
    this.dismiss();
    return true;
  }

  /** A2.10: salto de cinemática: cierra el texto en pantalla al momento (resuelve el `say` que lo esperaba). */
  skip(): void {
    if (this.visible) this.dismiss();
  }

  /** A2.10: objetos del texto (UIScene no los oculta con el resto de la interfaz en cinemática). */
  getObjects(): Phaser.GameObjects.GameObject[] {
    return [this.text, this.speakerText];
  }

  private handleResize(): void {
    if (!this.text?.active || !this.speakerText?.active) return;
    const cur = this.current;
    if (!cur) return;
    // Letra y ancho de wrap nuevos: se vuelve a medir y colocar
    const size = speechFontSize(this.scene.scale);
    this.text.setFontSize(`${size.body}px`).setStroke(TWP.DIALOGUE_STROKE, speechStroke(size.body));
    this.speakerText.setFontSize(`${size.speaker}px`);
    cur.wrap = 0;
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    this.scene.scale.off('resize', this.handleResize, this);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.layout, this);
    if (this.activeHandler) {
      this.scene.input.off('pointerdown', this.activeHandler);
    }
    this.pendingHandlerCall?.remove();
    this.pendingDismissCall?.remove();
    this.typewriterTimer?.remove();
    this.current = null;
    this.text.destroy();
    this.speakerText.destroy();
  }
}

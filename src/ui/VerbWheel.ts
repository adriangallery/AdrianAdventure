import Phaser from 'phaser';
import { Verb, PANEL_VERBS, VERB_LABELS } from '@/types/game.types';
import { TWP, FONT } from '@/config/theme';

const WHEEL_RADIUS = 80;
const BUTTON_RADIUS = 28;
const BG_ALPHA = 0.80;
const ANIM_DURATION = 150;

interface WheelSlot {
  verb: Verb;
  bg: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  angle: number;
}

/**
 * Radial verb wheel — appears on hotspot tap, user drags/taps a verb.
 * Mobile-first: thumb-friendly, semi-transparent, doesn't block scene.
 * Thimbleweed Park palette: dark backdrop, lavender buttons, yellow active.
 */
export class VerbWheel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private backdrop: Phaser.GameObjects.Arc;
  private slots: WheelSlot[] = [];
  private visible = false;
  private onSelect: ((verb: Verb) => void) | null = null;
  private hotspotLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(500).setAlpha(0).setVisible(false);

    // Center backdrop circle
    this.backdrop = scene.add.circle(0, 0, WHEEL_RADIUS + BUTTON_RADIUS + 10, TWP.WHEEL_BACKDROP, 0.6);
    this.container.add(this.backdrop);

    // Hotspot name in center
    this.hotspotLabel = scene.add.text(0, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: '10px',
      color: TWP.WHEEL_HOTSPOT,
      align: 'center',
    }).setOrigin(0.5).setWordWrapWidth(WHEEL_RADIUS * 1.2);
    this.container.add(this.hotspotLabel);

    // Create verb buttons arranged in a circle (9 panel verbs)
    const verbs = PANEL_VERBS;
    const angleStep = (Math.PI * 2) / verbs.length;
    const startAngle = -Math.PI / 2; // Start from top

    for (let i = 0; i < verbs.length; i++) {
      const verb = verbs[i];
      const angle = startAngle + angleStep * i;
      const bx = Math.cos(angle) * WHEEL_RADIUS;
      const by = Math.sin(angle) * WHEEL_RADIUS;

      // Button background — dark with subtle lavender border
      const bg = scene.add.circle(bx, by, BUTTON_RADIUS, TWP.WHEEL_BTN_BG, BG_ALPHA)
        .setStrokeStyle(2, TWP.WHEEL_BTN_BORDER, 0.7)
        .setInteractive({ useHandCursor: true });

      // Text-only label (TWP style — no emoji icons)
      const label = scene.add.text(bx, by, VERB_LABELS[verb], {
        fontFamily: FONT.FAMILY,
        fontSize: '8px',
        color: TWP.WHEEL_LABEL,
        align: 'center',
      }).setOrigin(0.5).setWordWrapWidth(BUTTON_RADIUS * 1.6);

      // Pointer events — TWP hover: yellow highlight
      bg.on('pointerover', () => {
        bg.setFillStyle(TWP.WHEEL_BTN_HOVER, 0.9);
        bg.setStrokeStyle(2, TWP.WHEEL_BTN_HOVER_BORDER, 1);
        label.setColor(TWP.WHEEL_LABEL_HOVER);
        scene.tweens.add({ targets: [bg, label], scale: 1.15, duration: 80 });
      });

      bg.on('pointerout', () => {
        bg.setFillStyle(TWP.WHEEL_BTN_BG, BG_ALPHA);
        bg.setStrokeStyle(2, TWP.WHEEL_BTN_BORDER, 0.7);
        label.setColor(TWP.WHEEL_LABEL);
        scene.tweens.add({ targets: [bg, label], scale: 1, duration: 80 });
      });

      bg.on('pointerdown', () => {
        this.selectVerb(verb);
      });

      this.container.add([bg, label]);
      this.slots.push({ verb, bg, label, angle });
    }
  }

  show(screenX: number, screenY: number, hotspotName: string, callback: (verb: Verb) => void): void {
    if (this.visible) this.hide();

    this.onSelect = callback;
    this.hotspotLabel.setText(hotspotName);

    const pad = WHEEL_RADIUS + BUTTON_RADIUS + 20;
    const { width, height } = this.scene.scale;
    const cx = Phaser.Math.Clamp(screenX, pad, width - pad);
    const cy = Phaser.Math.Clamp(screenY, pad, height - pad);

    this.container.setPosition(cx, cy);
    this.container.setVisible(true);
    this.container.setScale(0);
    this.container.setAlpha(0);
    this.visible = true;

    this.scene.tweens.add({
      targets: this.container,
      scale: 1,
      alpha: 1,
      duration: ANIM_DURATION,
      ease: 'Back.easeOut',
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;

    this.scene.tweens.add({
      targets: this.container,
      scale: 0,
      alpha: 0,
      duration: ANIM_DURATION / 2,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.container.setVisible(false);
        this.onSelect = null;
      },
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  private selectVerb(verb: Verb): void {
    const cb = this.onSelect;
    this.hide();
    if (cb) {
      this.scene.time.delayedCall(50, () => cb(verb));
    }
  }

  destroy(): void {
    this.container.destroy();
  }
}

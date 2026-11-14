import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

/** A2.6: opción tal como llega de DialogueSystem (`used` = ya elegida: gris, pero se puede volver a elegir) */
export interface ChoiceOption { text: string; enabled: boolean; used?: boolean }

import { layoutChoices, clampScroll, scrollToShow, CHOICE_LINE_SPACING, PREFIX_ENABLED, PREFIX_LOCKED, type ChoiceLayout } from './choiceLayout';

/** Recorrido del dedo (px) a partir del cual un toque pasa a ser arrastre del scroll y ya no elige. */
const DRAG_SLOP = 8;

/**
 * Dialogue choices rendered INSIDE the SCUMM panel, replacing verbs+inventory.
 * Classic Monkey Island / Thimbleweed Park style: colored choice lines on the
 * same dark panel background. Choices take over the full panel width.
 * A9.1: todas las opciones a la vez (sin «More...»): una o dos columnas y, si hace falta, el panel crece hacia arriba
 * o se desplaza con el dedo. Colocación en src/ui/choiceLayout.ts.
 */
export class ChoicePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private resolveChoice: ((index: number) => void) | null = null;
  /** Opciones en pantalla (A0.1: la API de QA las lee y elige por aquí) */
  private options: { text: string; enabled: boolean; used: boolean }[] = [];
  /** A9.1: colocación actual y scroll */
  private layout: ChoiceLayout | null = null;
  private maskShape: Phaser.GameObjects.Graphics | null = null;
  private scrollY = 0;
  private drag: { startY: number; startScroll: number; moved: boolean } | null = null;
  private pressed = -1;
  private inputBound = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Depth 510 = above the ScummUI panel (500) so choices overlay verbs/inventory
    this.container = scene.add.container(0, 0).setDepth(510).setVisible(false).setScrollFactor(0);
  }

  show(choices: ChoiceOption[]): Promise<number> {
    return new Promise<number>((resolve) => {
      this.resolveChoice = resolve;
      this.options = choices.map((c) => ({ text: c.text, enabled: c.enabled, used: c.used === true }));
      this.scrollY = 0;
      this.render();
      this.bindInput();
      this.container.setVisible(true);
      this.container.setAlpha(0);
      this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 150 });
    });
  }

  /** A9.1: colocación actual (la demo y la QA miden con ella). */
  getLayout(): ChoiceLayout | null {
    return this.layout;
  }

  /** A9.1: cajas de cada opción en px de pantalla, ya con el scroll; `visible` = entera dentro del panel. */
  getOptionBoxes(): { index: number; x: number; y: number; w: number; h: number; visible: boolean }[] {
    const L = this.layout;
    if (!L) return [];
    return L.rows.map((r) => {
      const y = L.top + r.y - this.scrollY;
      return { index: r.index, x: r.x, y, w: r.w, h: r.h, visible: y >= L.top - 0.5 && y + r.h <= L.top + L.height + 0.5 };
    });
  }

  /** Pinta todas las opciones (A9.1: sin páginas). */
  private render(): void {
    this.container.removeAll(true);
    this.maskShape?.destroy();
    this.maskShape = null;

    const { width, height } = this.scene.scale;
    const panelH = (this.scene.registry.get('scummPanelHeight') as number) ?? Math.floor(height * 0.25);
    const texts = this.options.map((o) => `${o.enabled ? PREFIX_ENABLED : PREFIX_LOCKED}${o.text}`);

    // Medidor real: un texto de prueba con la misma letra y envoltura
    const probe = this.scene.add.text(0, 0, '', { fontFamily: FONT.FAMILY, lineSpacing: CHOICE_LINE_SPACING }).setVisible(false);
    const measure = (t: string, wrapW: number, fontSize: number): number => {
      probe.setFontSize(fontSize);
      probe.setWordWrapWidth(wrapW);
      probe.setText(t);
      return probe.height;
    };
    const L = layoutChoices({ width, height, panelH, texts, measure });
    probe.destroy();
    this.layout = L;
    this.scrollY = clampScroll(this.scrollY, L);

    this.container.setPosition(0, L.top);

    // Fondo de todo el panel (tapa verbos e inventario; si crece, también un trozo del suelo)
    const bg = this.scene.add.rectangle(width / 2, L.height / 2, width, L.height, TWP.CHOICE_BG, 1);
    this.container.add(bg);

    const list = this.scene.add.container(0, -this.scrollY);
    this.container.add(list);

    L.rows.forEach((row) => {
      const choice = this.options[row.index];
      const index = row.index;
      const color = !choice.enabled ? TWP.CHOICE_DISABLED : choice.used ? TWP.CHOICE_USED : TWP.CHOICE_ENABLED;
      const cy = row.y + row.h / 2;
      const text = this.scene.add
        .text(row.x, cy, texts[index], {
          fontFamily: FONT.FAMILY,
          fontSize: `${L.fontSize}px`,
          color,
          wordWrap: { width: row.wrapW },
          lineSpacing: CHOICE_LINE_SPACING,
        })
        .setOrigin(0, 0.5);

      if (choice.enabled) {
        // Zona táctil: la celda entera (todo el ancho de su columna, alto ≥ 44 px)
        const hitArea = this.scene.add
          .rectangle(row.x + row.w / 2, cy, row.w + (L.columns === 1 ? L.padX * 2 : 0), row.h, 0x000000, 0)
          .setInteractive({ useHandCursor: true });
        hitArea.on('pointerover', () => text.setColor(TWP.CHOICE_HOVER));
        hitArea.on('pointerout', () => text.setColor(color));
        if (L.scroll) {
          // Con scroll se elige al soltar, si el dedo no ha arrastrado y la opción está dentro del panel
          hitArea.on('pointerdown', () => { this.pressed = index; });
          hitArea.on('pointerup', (p: Phaser.Input.Pointer) => {
            const ok = this.pressed === index && !this.drag?.moved && p.y >= L.top && p.y <= L.top + L.height;
            this.pressed = -1;
            if (ok) this.selectChoice(index);
          });
        } else {
          hitArea.on('pointerdown', () => this.selectChoice(index));
        }
        list.add(hitArea);
      }
      list.add(text);
    });

    if (L.scroll) {
      // Máscara: lo que se sale del panel no se ve
      const g = this.scene.make.graphics({}, false);
      g.fillStyle(0xffffff);
      g.fillRect(0, L.top, width, L.height);
      this.maskShape = g;
      list.setMask(g.createGeometryMask());
      // Pista de que hay más: una barrita a la derecha
      const trackH = L.height - 8;
      const thumbH = Math.max(16, Math.round(trackH * (L.height / L.contentH)));
      const thumbY = 4 + Math.round((trackH - thumbH) * (this.scrollY / Math.max(1, L.maxScroll)));
      this.container.add(this.scene.add.rectangle(width - 4, thumbY + thumbH / 2, 3, thumbH, 0xffffff, 0.35));
    }
  }

  private applyScroll(offset: number): void {
    if (!this.layout) return;
    const next = clampScroll(offset, this.layout);
    if (next === this.scrollY) return;
    this.scrollY = next;
    this.render();
  }

  /** A9.1: lleva la opción `index` a la vista (si hay scroll). */
  revealOption(index: number): void {
    if (this.layout) this.applyScroll(scrollToShow(index, this.scrollY, this.layout));
  }

  private onDown = (p: Phaser.Input.Pointer): void => {
    const L = this.layout;
    if (!this.container.visible || !L?.scroll || p.y < L.top) { this.drag = null; return; }
    this.drag = { startY: p.y, startScroll: this.scrollY, moved: false };
  };

  private onMove = (p: Phaser.Input.Pointer): void => {
    if (!this.drag || !p.isDown) return;
    const dy = p.y - this.drag.startY;
    if (!this.drag.moved && Math.abs(dy) < DRAG_SLOP) return;
    this.drag.moved = true;
    this.applyScroll(this.drag.startScroll - dy);
  };

  private onUp = (): void => {
    // El pointerup de la opción va antes que el de la escena: se limpia en el siguiente tic
    const d = this.drag;
    this.scene.time.delayedCall(0, () => { if (this.drag === d) this.drag = null; });
  };

  private onWheel = (_p: unknown, _o: unknown, _dx: number, dy: number): void => {
    if (this.container.visible && this.layout?.scroll) this.applyScroll(this.scrollY + dy * 0.5);
  };

  private bindInput(): void {
    if (this.inputBound) return;
    this.inputBound = true;
    this.scene.input.on('pointerdown', this.onDown);
    this.scene.input.on('pointermove', this.onMove);
    this.scene.input.on('pointerup', this.onUp);
    this.scene.input.on('wheel', this.onWheel);
  }

  private unbindInput(): void {
    if (!this.inputBound) return;
    this.inputBound = false;
    this.scene.input.off('pointerdown', this.onDown);
    this.scene.input.off('pointermove', this.onMove);
    this.scene.input.off('pointerup', this.onUp);
    this.scene.input.off('wheel', this.onWheel);
    this.drag = null;
  }

  private selectChoice(index: number): void {
    const cb = this.resolveChoice;
    if (!cb) return;
    this.unbindInput();
    this.resolveChoice = null;

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      onComplete: () => {
        this.container.setVisible(false);
        this.container.removeAll(true);
        this.maskShape?.destroy();
        this.maskShape = null;
        this.layout = null;
        cb?.(index);
      },
    });
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  /** A0.1: true mientras el diálogo espera que el jugador elija. */
  /** A2.10: contenedor del panel (UIScene no lo oculta con el resto de la interfaz en cinemática). */
  getRoot(): Phaser.GameObjects.Container {
    return this.container;
  }

  isAwaitingChoice(): boolean {
    return this.resolveChoice !== null;
  }

  /**
   * A0.1: opciones en pantalla, en orden (las bloqueadas no se pueden pulsar). A2.6: `used` = ya elegida antes; las
   * ocultas (`when`, `once`, `hideIfLocked`) no llegan aquí. A9.1: ya no hay páginas; todas están en pantalla.
   */
  getOptions(): { text: string; enabled: boolean; used: boolean }[] {
    return this.options.map((o) => ({ ...o }));
  }

  /** A0.1: elegir la opción `index` igual que al pulsar su línea. false si no hay elección o está bloqueada. */
  choose(index: number): boolean {
    if (!this.resolveChoice || !this.options[index]?.enabled) return false;
    this.selectChoice(index);
    return true;
  }

  destroy(): void {
    this.unbindInput();
    this.maskShape?.destroy();
    this.container.destroy();
  }
}

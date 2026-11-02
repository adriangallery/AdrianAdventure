import Phaser from 'phaser';
import { TWP, FONT } from '@/config/theme';

/** A2.6: opción tal como llega de DialogueSystem (`used` = ya elegida: gris, pero se puede volver a elegir) */
export interface ChoiceOption { text: string; enabled: boolean; used?: boolean }

/** Alto mínimo de una línea de opción (dedo en móvil) */
const MIN_LINE_H = 28;

/**
 * Dialogue choices rendered INSIDE the SCUMM panel, replacing verbs+inventory.
 * Classic Monkey Island / Thimbleweed Park style: colored choice lines on the
 * same dark panel background. Choices take over the full panel width.
 */
export class ChoicePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private resolveChoice: ((index: number) => void) | null = null;
  /** Opciones en pantalla (A0.1: la API de QA las lee y elige por aquí) */
  private options: { text: string; enabled: boolean; used: boolean }[] = [];
  /** A2.6: página visible cuando hay más opciones de las que caben en el panel */
  private page = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Depth 510 = above the ScummUI panel (500) so choices overlay verbs/inventory
    this.container = scene.add.container(0, 0).setDepth(510).setVisible(false).setScrollFactor(0);
  }

  show(choices: ChoiceOption[]): Promise<number> {
    return new Promise<number>((resolve) => {
      this.resolveChoice = resolve;
      this.options = choices.map((c) => ({ text: c.text, enabled: c.enabled, used: c.used === true }));
      this.page = 0;
      this.render();
      this.container.setVisible(true);
      this.container.setAlpha(0);
      this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 150 });
    });
  }

  /**
   * Pinta la página actual. A2.6 (móvil primero): el panel no crece; si no caben todas las opciones, se enseñan
   * por páginas con una última línea «More...» que pasa a la siguiente (y vuelve a la primera).
   */
  private render(): void {
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
    const fit = Math.max(2, Math.floor((panelH - padTop) / MIN_LINE_H));
    const total = this.options.length;
    const paged = total > fit;
    const perPage = paged ? fit - 1 : Math.max(1, total);
    const pages = Math.max(1, Math.ceil(total / perPage));
    if (this.page >= pages) this.page = 0;
    const first = this.page * perPage;
    const visible = this.options.slice(first, first + perPage);
    const rows = visible.length + (paged ? 1 : 0);
    const lineH = Math.max(MIN_LINE_H, Math.min(44, Math.floor(panelH / (rows + 1))));
    const fontSize = Math.max(10, Math.min(16, Math.floor(width * 0.014)));

    const addLine = (row: number, label: string, color: string, onTap: (() => void) | null) => {
      const y = padTop + row * lineH + lineH / 2;
      const text = this.scene.add
        .text(padX, y, label, {
          fontFamily: FONT.FAMILY,
          fontSize: `${fontSize}px`,
          color,
          wordWrap: { width: width - padX * 2 },
          lineSpacing: 4,
        })
        .setOrigin(0, 0.5);

      if (onTap) {
        // Hit area spans full width for easy clicking
        const hitArea = this.scene.add
          .rectangle(width / 2, y, width, lineH, 0x000000, 0)
          .setInteractive({ useHandCursor: true });
        hitArea.on('pointerover', () => text.setColor(TWP.CHOICE_HOVER));
        hitArea.on('pointerout', () => text.setColor(color));
        hitArea.on('pointerdown', onTap);
        this.container.add(hitArea);
      }

      this.container.add(text);
    };

    visible.forEach((choice, i) => {
      const index = first + i;
      const color = !choice.enabled ? TWP.CHOICE_DISABLED : choice.used ? TWP.CHOICE_USED : TWP.CHOICE_ENABLED;
      const prefix = choice.enabled ? '• ' : '\u{1F512} ';
      addLine(i, `${prefix}${choice.text}`, color, choice.enabled ? () => this.selectChoice(index) : null);
    });

    if (paged) {
      addLine(visible.length, `> More... (${this.page + 1}/${pages})`, TWP.CHOICE_ENABLED, () => {
        if (!this.resolveChoice) return;
        this.page = (this.page + 1) % pages;
        this.render();
      });
    }
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
   * ocultas (`when`, `once`, `hideIfLocked`) no llegan aquí. Incluye las de todas las páginas.
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
    this.container.destroy();
  }
}

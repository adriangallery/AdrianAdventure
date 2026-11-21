/**
 * F1.2 (plan FUNTICO_ADVENTURE): piezas de UI del build Funtico (paleta de la UI SCUMM, botones, safe-areas y el
 * registro de rectángulos que lee el gancho de pruebas `uiBounds()`). El juego usa px de juego = px CSS
 * (Scale.RESIZE sin resolución extra), así que los tamaños de aquí ya son px CSS.
 */
import Phaser from 'phaser';

export const FONT = '"Press Start 2P", monospace';
export const C = {
  bg: '#06060c',
  bgN: 0x06060c,
  panelN: 0x12111f,
  panel2N: 0x1c1a30,
  borderN: 0x4a4280,
  yellow: '#f8e848',
  yellowN: 0xf8e848,
  lilac: '#b8a8f0',
  lilacDim: '#8078b0',
  white: '#e8e4f8',
  green: '#58e078',
  greenN: 0x58e078,
  red: '#ff5a5a',
  redN: 0xff5a5a,
  grey: '#5c587a',
};

/** Tamaño mínimo de texto y de objetivo táctil en móvil (px CSS). */
export const MIN_TEXT = 14;
export const MIN_TOUCH = 44;

export interface Insets { top: number; right: number; bottom: number; left: number }

let probe: HTMLDivElement | null = null;
/** Safe-areas del navegador (env(safe-area-inset-*)) en px CSS. */
export function safeInsets(): Insets {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string) => Math.round(parseFloat(v) || 0);
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Un elemento de UI para `uiBounds()`: texto (con tamaño de fuente) o interactivo. */
export interface UiBound extends Rect { id: string; kind: 'text' | 'button' | 'area'; fontPx?: number; text?: string }

/** Texto con la fuente del juego. */
export function txt(scene: Phaser.Scene, s: string, px: number, color: string = C.white, align: 'left' | 'center' | 'right' = 'left'): Phaser.GameObjects.Text {
  return scene.add.text(0, 0, s, { fontFamily: FONT, fontSize: `${px}px`, color, align, lineSpacing: Math.round(px * 0.45) });
}

/** Botón: rectángulo con borde y texto centrado (ajusta línea al ancho). */
export class Button {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  enabled = true;
  private onTap: () => void;
  private fill: number;

  constructor(scene: Phaser.Scene, readonly id: string, text: string, onTap: () => void, opts: { fill?: number; color?: string } = {}) {
    this.fill = opts.fill ?? C.panel2N;
    this.bg = scene.add.rectangle(0, 0, 10, 10, this.fill).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.label = txt(scene, text, MIN_TEXT, opts.color ?? C.yellow, 'center').setOrigin(0.5, 0.5);
    this.onTap = onTap;
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerdown', () => { if (this.enabled) this.bg.setFillStyle(C.borderN); });
    this.bg.on('pointerout', () => this.bg.setFillStyle(this.fill));
    this.bg.on('pointerup', () => {
      this.bg.setFillStyle(this.fill);
      if (this.enabled) this.onTap();
    });
  }

  /** Coloca el botón; el alto crece si el texto (ajustado al ancho) lo necesita, nunca baja de 44 px. */
  place(x: number, y: number, w: number, h: number, fontPx = MIN_TEXT): number {
    this.label.setFontSize(fontPx).setLineSpacing(Math.round(fontPx * 0.45)).setWordWrapWidth(Math.max(20, w - 20), true);
    const hh = Math.max(MIN_TOUCH, h, Math.ceil(this.label.height + 16));
    this.bg.setPosition(Math.round(x), Math.round(y)).setSize(Math.round(w), hh);
    this.bg.input?.hitArea.setTo(0, 0, Math.round(w), hh);
    this.label.setPosition(Math.round(x + w / 2), Math.round(y + hh / 2));
    return hh;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.label.setAlpha(on ? 1 : 0.55);
    return this;
  }

  setVisible(v: boolean): this {
    this.bg.setVisible(v);
    this.label.setVisible(v);
    if (this.bg.input) this.bg.input.enabled = v;
    return this;
  }

  setText(s: string): this {
    this.label.setText(s);
    return this;
  }

  bound(): UiBound {
    return { id: this.id, kind: 'button', x: this.bg.x, y: this.bg.y, w: this.bg.width, h: this.bg.height, fontPx: fontPx(this.label), text: this.label.text };
  }
}

export function fontPx(t: Phaser.GameObjects.Text): number {
  return parseFloat(String(t.style.fontSize)) || 0;
}

/** Rectángulo de un texto visible para `uiBounds()`. */
export function textBound(id: string, t: Phaser.GameObjects.Text): UiBound {
  const b = t.getBounds();
  return { id, kind: 'text', x: b.x, y: b.y, w: b.width, h: b.height, fontPx: fontPx(t), text: t.text };
}

/** Ajusta el tamaño de fuente (entero, entre min y max) para que `s` quepa en `w` px en una línea. */
export function fitFont(chars: number, w: number, min = MIN_TEXT, max = 32): number {
  return Math.max(min, Math.min(max, Math.floor(w / Math.max(1, chars))));
}

/** Escena «Funtico»: datos compartidos (puente, usuario) en el registry del juego. */
export const REG = { bridge: 'funtico.bridge', userName: 'funtico.userName', seedParam: 'funtico.seed' } as const;

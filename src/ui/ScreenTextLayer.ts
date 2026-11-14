import Phaser from 'phaser';
import { FONT } from '@/config/theme';
import {
  LINE_HEIGHT, MAX_SCREEN_PX, MIN_READABLE_PX, SCREEN_PALETTES, layoutScreen, screenCharDelay, typedLength, visibleRows,
  type ScreenColor, type ScreenLayout,
} from '@/systems/ScreenText';

/**
 * A2.19 (plan SCUMM): texto DENTRO de la pantalla de una máquina de la escena (CRT, monitor, teclado). Vive en el mundo
 * (se mueve y escala con la cámara), por debajo de los personajes y por encima del fondo: fondo de fósforo que tapa el
 * dibujo fijo, letra pixel, scanlines, parpadeo leve, tecleo con cursor y scroll de terminal si no cabe.
 *
 * Las líneas seguidas en la misma pantalla se acumulan como en una terminal (la nueva debajo, la vieja sube). Se apaga
 * sola a los LINGER_MS de la última línea, al escribir en otra pantalla o en el SHUTDOWN de GameScene (`destroy`).
 */

/** Profundidad: encima del fondo (-1), debajo de los actores (ACTOR_DEPTH_MIN = 9) y de los overlays (12) */
export const SCREEN_DEPTH = 8.5;
/** Cuánto sigue encendida la pantalla tras su última línea */
export const LINGER_MS = 9000;

export interface ScreenLayerQa {
  id: string;
  text: string;
  shown: string;
  typing: boolean;
  fontPx: number;
  rows: number;
  overflow: boolean;
}

export class ScreenTextLayer {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private textObj: Phaser.GameObjects.Text | null = null;
  private typeTimer: Phaser.Time.TimerEvent | null = null;
  private lingerTimer: Phaser.Time.TimerEvent | null = null;
  private blinkTween: Phaser.Tweens.Tween | null = null;
  private flickerTween: Phaser.Tweens.Tween | null = null;
  private id: string | null = null;
  private full = '';
  private layout: ScreenLayout | null = null;
  private typed = 0;
  private cursorOn = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Teclea `text` en la pantalla `id` (caja del mundo `rect` en px). `zoom` = zoom de la cámara (la letra mínima se mide
   * en px del viewport). `instant` = sin tecleo (salto de cinemática, texto instantáneo en ajustes). Devuelve una promesa
   * que se resuelve al acabar de teclear.
   */
  write(id: string, text: string, rect: { x: number; y: number; w: number; h: number }, opts: { color?: ScreenColor; zoom: number; instant: boolean; opaque?: boolean }): Promise<void> {
    const append = this.id === id && this.container && this.full;
    const from = append ? typedLength(this.layout?.lines ?? []) + 1 : 0;
    if (!append) {
      this.clear();
      this.build(rect, opts.color ?? 'green', opts.opaque !== false);
      this.full = text;
    } else {
      this.full = `${this.full}\n${text}`;
    }
    this.id = id;
    this.lingerTimer?.remove();
    this.lingerTimer = null;
    const zoom = opts.zoom > 0 ? opts.zoom : 1;
    // Letra en px del mundo: legible en el viewport (MIN_READABLE_PX) y sin pasarse de MAX_SCREEN_PX vista
    this.layout = layoutScreen(this.full, { w: rect.w, h: rect.h }, { minPx: MIN_READABLE_PX / zoom, maxPx: MAX_SCREEN_PX / zoom });
    const fontPx = this.layout.fontPx;
    this.textObj?.setFontSize(`${Math.max(1, fontPx)}px`).setLineSpacing(Math.max(0, fontPx * (LINE_HEIGHT - 1)))
      .setPosition(this.layout.pad, this.layout.pad);
    const total = typedLength(this.layout.lines);
    this.typeTimer?.remove();
    this.typeTimer = null;
    if (opts.instant) {
      this.typed = total;
      this.render();
      return Promise.resolve();
    }
    this.typed = Math.min(from, total);
    this.render();
    const delay = screenCharDelay(total - this.typed);
    return new Promise<void>((resolve) => {
      if (this.typed >= total || delay <= 0) { this.typed = total; this.render(); resolve(); return; }
      this.typeTimer = this.scene.time.addEvent({
        delay,
        loop: true,
        callback: () => {
          this.typed += 1;
          this.render();
          if (this.typed >= total) {
            this.typeTimer?.remove();
            this.typeTimer = null;
            resolve();
          }
        },
      });
    });
  }

  /** Termina el tecleo al momento (toque que adelanta el subtítulo, salto) */
  finishTyping(): void {
    if (!this.layout) return;
    this.typeTimer?.remove();
    this.typeTimer = null;
    this.typed = typedLength(this.layout.lines);
    this.render();
  }

  /** La línea ya se dijo: la pantalla se queda encendida un rato y se apaga sola */
  linger(ms = LINGER_MS): void {
    this.lingerTimer?.remove();
    this.lingerTimer = this.scene.time.delayedCall(ms, () => this.clear());
  }

  qaState(): ScreenLayerQa | null {
    if (!this.id || !this.layout) return null;
    const v = visibleRows(this.layout.lines, this.layout.rows, this.typed);
    return {
      id: this.id,
      text: this.full,
      shown: v.rows.join('\n'),
      typing: !v.done,
      fontPx: Math.round(this.layout.fontPx * 100) / 100,
      rows: this.layout.rows,
      overflow: this.layout.overflow,
    };
  }

  clear(): void {
    this.typeTimer?.remove();
    this.typeTimer = null;
    this.lingerTimer?.remove();
    this.lingerTimer = null;
    this.blinkTween?.remove();
    this.blinkTween = null;
    this.flickerTween?.remove();
    this.flickerTween = null;
    this.container?.destroy(true);
    this.container = null;
    this.textObj = null;
    this.id = null;
    this.full = '';
    this.layout = null;
    this.typed = 0;
  }

  destroy(): void {
    this.clear();
  }

  private build(rect: { x: number; y: number; w: number; h: number }, color: ScreenColor, opaque: boolean): void {
    const pal = SCREEN_PALETTES[color] ?? SCREEN_PALETTES.green;
    const c = this.scene.add.container(rect.x, rect.y).setDepth(SCREEN_DEPTH);
    const g = this.scene.add.graphics();
    const bg = Phaser.Display.Color.HexStringToColor(pal.bg).color;
    const fg = Phaser.Display.Color.HexStringToColor(pal.fg).color;
    g.fillStyle(bg, opaque ? 0.94 : 0.55).fillRect(0, 0, rect.w, rect.h);
    // Brillo de fósforo hacia el centro
    g.fillStyle(fg, 0.06).fillRect(rect.w * 0.08, rect.h * 0.08, rect.w * 0.84, rect.h * 0.84);
    const text = this.scene.add.text(0, 0, '', {
      fontFamily: FONT.FAMILY,
      fontSize: '8px',
      color: pal.fg,
    });
    text.setShadow(0, 0, pal.glow, 4, false, true);
    // Scanlines: una línea oscura cada 3 px del mundo
    const sl = this.scene.add.graphics();
    sl.fillStyle(0x000000, 0.22);
    for (let y = 1; y < rect.h; y += 3) sl.fillRect(0, y, rect.w, 1);
    c.add([g, text, sl]);
    // Recorte a la caja (lo que no cabe ya lo quita visibleRows; esto es por si la letra redondea)
    const maskShape = this.scene.make.graphics({}, false);
    maskShape.fillStyle(0xffffff).fillRect(rect.x, rect.y, rect.w, rect.h);
    c.setMask(maskShape.createGeometryMask());
    c.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
    this.container = c;
    this.textObj = text;
    // Parpadeo leve del fósforo y cursor
    this.flickerTween = this.scene.tweens.add({ targets: c, alpha: { from: 1, to: 0.9 }, duration: 90, yoyo: true, repeat: -1, repeatDelay: 1700, ease: 'Stepped' });
    this.blinkTween = this.scene.tweens.addCounter({
      from: 0, to: 1, duration: 530, repeat: -1,
      onRepeat: () => { this.cursorOn = !this.cursorOn; this.render(); },
    });
  }

  private render(): void {
    if (!this.textObj || !this.layout) return;
    const v = visibleRows(this.layout.lines, this.layout.rows, this.typed);
    const rows = v.rows.slice();
    const cursor = this.cursorOn || !v.done ? '_' : ' ';
    if (rows.length) rows[rows.length - 1] += cursor;
    else rows.push(cursor);
    this.textObj.setText(rows.join('\n'));
  }
}

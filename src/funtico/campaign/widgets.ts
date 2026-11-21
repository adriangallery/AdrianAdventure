/** F3.2a: piezas de UI de Campaign (fila de estrellas dibujadas: la fuente del juego no tiene ★). */
import Phaser from 'phaser';
import { C } from '../ui';

export class StarRow {
  readonly stars: Phaser.GameObjects.Star[];

  constructor(scene: Phaser.Scene, count = 3) {
    this.stars = Array.from({ length: count }, () => scene.add.star(0, 0, 5, 4, 9, C.yellowN).setStrokeStyle(2, C.yellowN));
  }

  /** Coloca las estrellas a partir de (x, y) = esquina superior izquierda; devuelve el ancho ocupado. */
  place(x: number, y: number, size: number, filled: number): number {
    const r = size / 2;
    const gap = Math.round(size * 0.25);
    this.stars.forEach((s, i) => {
      s.setPosition(Math.round(x + r + i * (size + gap)), Math.round(y + r));
      s.setInnerRadius(r * 0.45).setOuterRadius(r);
      s.setFillStyle(C.yellowN, i < filled ? 1 : 0);
      s.setStrokeStyle(2, i < filled ? C.yellowN : 0x5c587a);
    });
    return this.stars.length * size + (this.stars.length - 1) * gap;
  }

  setVisible(v: boolean): this {
    for (const s of this.stars) s.setVisible(v);
    return this;
  }
}

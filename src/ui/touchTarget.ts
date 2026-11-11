// A5.2 (plan SCUMM): zonas táctiles mínimas en la interfaz. Un botón puede verse pequeño (30×24 en la barra de arriba)
// pero el dedo necesita ~44×44 px (guía de Apple; el CI exige 40, ver scripts/lib/mobile-audit.mjs). Estas funciones
// amplían solo la zona de impacto, centrada sobre lo que se ve, sin cambiar el dibujo.
import Phaser from 'phaser';

/** Lado mínimo de una zona táctil en px CSS (el lienzo va a 1 px de juego = 1 px CSS, Scale.RESIZE). */
export const MIN_TOUCH_PX = 44;

/** Rectángulo de impacto en coordenadas locales (desde la esquina del objeto) de al menos `min`×`min`, centrado en `w`×`h`. */
export function touchHitRect(w: number, h: number, min = MIN_TOUCH_PX): Phaser.Geom.Rectangle {
  const W = Math.max(w, min);
  const H = Math.max(h, min);
  return new Phaser.Geom.Rectangle((w - W) / 2, (h - H) / 2, W, H);
}

/** `setInteractive` con la zona táctil ampliada (cursor de mano en escritorio, como antes). */
export function setTouchInteractive<T extends Phaser.GameObjects.GameObject>(obj: T, w: number, h: number, min = MIN_TOUCH_PX): T {
  obj.setInteractive({ hitArea: touchHitRect(w, h, min), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
  return obj;
}

/** Si el punto de pantalla cae en la zona táctil (ampliada) de un objeto de escala 1; el hit-test de la API de QA lo usa. */
export function touchContains(obj: Phaser.GameObjects.Rectangle, x: number, y: number): boolean {
  const b = obj.getBounds();
  const ha = obj.input?.hitArea as Phaser.Geom.Rectangle | undefined;
  if (!ha || typeof ha.contains !== 'function') return b.contains(x, y);
  return ha.contains(x - b.x, y - b.y);
}

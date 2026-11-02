// A2.7 (plan SCUMM): dónde se dibuja un overlay recortado. Lógica pura, sin Phaser ni imports (tests/overlay-placement.test.mjs).
//
// Un `conditionalOverlays[]` sin `bounds` es una imagen del tamaño del fondo: va en el mismo sitio y con la misma
// escala que el fondo. Con `bounds` (en % del fondo, lo escribe scripts/crop-overlays.mjs) es solo su caja: se
// pasa a píxeles enteros del fondo con la misma cuenta que scripts/lib/overlay-crop.mjs (pctToBox) y se coloca
// ahí, así cada píxel cae exactamente donde caía en la imagen completa.

export interface PctRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BgTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Posición (esquina superior izquierda, origen 0,0) y escala de un overlay. `bg` = transformación del fondo
 * (CoordSystem.getBgTransform), `img` = tamaño del fondo en px, `tex` = tamaño de la textura del overlay.
 */
export function overlayTransform(
  bg: BgTransform,
  img: { w: number; h: number },
  tex: { w: number; h: number },
  bounds?: PctRect | null,
): BgTransform {
  if (!bounds) return { x: bg.x, y: bg.y, scaleX: bg.scaleX, scaleY: bg.scaleY };
  const left = Math.round((bounds.x * img.w) / 100);
  const top = Math.round((bounds.y * img.h) / 100);
  const width = Math.round((bounds.w * img.w) / 100);
  const height = Math.round((bounds.h * img.h) / 100);
  return {
    x: bg.x + left * bg.scaleX,
    y: bg.y + top * bg.scaleY,
    // Si la textura mide lo que dice bounds (lo normal) es la escala del fondo tal cual
    scaleX: bg.scaleX * (tex.w > 0 ? width / tex.w : 1),
    scaleY: bg.scaleY * (tex.h > 0 ? height / tex.h : 1),
  };
}

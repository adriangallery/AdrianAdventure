// A9.1 (plan SCUMM): colocación de las opciones de diálogo. Lógica pura (sin Phaser), la usa src/ui/ChoicePanel.ts y la
// prueba tests/choice-layout.test.mjs.
//
// Antes (A2.6) el panel de elecciones no crecía y paginaba con «More...»: en 844×390 el duelo con Chad salía de 2 en 2
// y no se podían comparar las réplicas. Ahora TODAS las opciones salen a la vez:
//   1) si caben en el panel SCUMM tal cual, en una columna (lo de siempre);
//   2) si no, en dos columnas cuando la pantalla es ancha (apaisado, escritorio) y así caben;
//   3) si aún no, el panel crece hacia arriba sobre el suelo (lo justo, hasta `maxChoiceHeight`), con la opción más
//      baja de las dos (una o dos columnas);
//   4) solo si ni así cabe, el panel se queda en `maxChoiceHeight` y las opciones se desplazan con el dedo (scroll).
// Cada opción tiene una zona táctil de al menos CHOICE_MIN_ROW px de alto (px CSS: el lienzo va a 1:1) y letra de al
// menos CHOICE_MIN_FONT px.

/** Alto mínimo de la zona táctil de una opción (objetivo de Apple 44; la auditoría de A5.2 exige 40). */
export const CHOICE_MIN_ROW = 44;
/** Letra mínima y máxima de las opciones (px CSS). */
export const CHOICE_MIN_FONT = 11;
export const CHOICE_MAX_FONT = 16;
/** Ancho mínimo de pantalla para usar dos columnas. */
export const TWO_COLUMN_MIN_WIDTH = 600;
/** Separación entre columnas. */
export const COLUMN_GAP = 16;
/** Relleno vertical dentro de cada opción (arriba y abajo del texto). */
export const ROW_PAD_Y = 6;
/** Interlineado de las opciones que ocupan varias líneas (Phaser `lineSpacing`). */
export const CHOICE_LINE_SPACING = 4;
/** Prefijo de cada opción: «• » se puede elegir, «× » bloqueada. */
export const PREFIX_ENABLED = '• ';
export const PREFIX_LOCKED = '× ';

/** Mide el alto en px de `text` envuelto a `wrapW` con letra `fontSize`. */
export type MeasureFn = (text: string, wrapW: number, fontSize: number) => number;

export interface ChoiceLayoutInput {
  /** Tamaño de la pantalla (px CSS). */
  width: number;
  height: number;
  /** Alto del panel SCUMM (verbos + inventario) que las opciones tapan. */
  panelH: number;
  /** Texto de cada opción, ya con su prefijo, en su orden. */
  texts: string[];
  /** Medidor de texto; por defecto, estimación para Press Start 2P (cada carácter mide 1 em). */
  measure?: MeasureFn;
}

export interface ChoiceRow {
  /** Índice de la opción (el mismo orden que `texts`). */
  index: number;
  /** Caja de la zona táctil, relativa a la esquina superior del panel y SIN el desplazamiento del scroll. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ancho al que se envuelve el texto. */
  wrapW: number;
}

export interface ChoiceLayout {
  fontSize: number;
  columns: 1 | 2;
  padX: number;
  padY: number;
  /** Y de la pantalla donde empieza el panel de opciones. */
  top: number;
  /** Alto visible del panel de opciones (≥ panelH). */
  height: number;
  /** Alto de todo el contenido; si es mayor que `height`, hay scroll. */
  contentH: number;
  scroll: boolean;
  /** Desplazamiento máximo del scroll (0 si no hay). */
  maxScroll: number;
  rows: ChoiceRow[];
}

/** Letra de las opciones según el ancho de pantalla: 11 px en un iPhone, 16 px en escritorio. */
export function choiceFontSize(width: number): number {
  return Math.max(CHOICE_MIN_FONT, Math.min(CHOICE_MAX_FONT, Math.floor(width * 0.014)));
}

/**
 * Alto máximo al que puede crecer el panel de opciones: deja arriba la parte de la escena donde suele estar quien
 * habla. 62 % en pantallas bajas (apaisado, ≤ 500 px), 50 % en el resto; nunca menos que el panel SCUMM.
 */
export function maxChoiceHeight(width: number, height: number, panelH: number): number {
  const ratio = height <= 500 ? 0.62 : 0.5;
  return Math.max(panelH, Math.floor(height * ratio));
}

/** Estimación de alto para Press Start 2P (monoespaciada, 1 carácter = 1 em), con envoltura por palabras. */
export function estimateTextHeight(text: string, wrapW: number, fontSize: number): number {
  const perLine = Math.max(1, Math.floor(wrapW / fontSize));
  let lines = 1;
  let col = 0;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (col === 0) col = len;
    else if (col + 1 + len <= perLine) col += 1 + len;
    else { lines++; col = len; }
    while (col > perLine) { lines++; col -= perLine; }
  }
  return lines * fontSize + (lines - 1) * CHOICE_LINE_SPACING;
}

interface Arrangement { columns: 1 | 2; contentH: number; rows: ChoiceRow[] }

function arrange(input: ChoiceLayoutInput, columns: 1 | 2, fontSize: number, padX: number, padY: number): Arrangement {
  const { width, texts } = input;
  const measure = input.measure ?? estimateTextHeight;
  const colW = (width - padX * 2 - COLUMN_GAP * (columns - 1)) / columns;
  const wrapW = Math.max(fontSize * 4, Math.floor(colW - 4));
  const perCol = Math.ceil(texts.length / columns);
  const rows: ChoiceRow[] = [];
  let tallest = 0;
  for (let c = 0; c < columns; c++) {
    let y = padY;
    // Por columnas (primero baja la izquierda): el orden se lee igual que en una sola columna.
    for (let i = c * perCol; i < Math.min(texts.length, (c + 1) * perCol); i++) {
      const h = Math.max(CHOICE_MIN_ROW, Math.ceil(measure(texts[i], wrapW, fontSize) + ROW_PAD_Y * 2));
      rows.push({ index: i, x: padX + c * (colW + COLUMN_GAP), y, w: colW, h, wrapW });
      y += h;
    }
    tallest = Math.max(tallest, y - padY);
  }
  return { columns, contentH: Math.ceil(tallest + padY * 2), rows };
}

/** Coloca todas las opciones a la vez (sin páginas). Ver la cabecera del archivo. */
export function layoutChoices(input: ChoiceLayoutInput): ChoiceLayout {
  const { width, height, panelH } = input;
  const fontSize = choiceFontSize(width);
  const padX = Math.max(12, Math.round(width * 0.03));
  const padY = Math.max(4, Math.min(10, Math.round(panelH * 0.05)));
  const maxH = Math.min(height, maxChoiceHeight(width, height, panelH));

  const one = arrange(input, 1, fontSize, padX, padY);
  const candidates: Arrangement[] = [one];
  if (width >= TWO_COLUMN_MIN_WIDTH && input.texts.length >= 2) candidates.push(arrange(input, 2, fontSize, padX, padY));

  let pick = candidates.find((a) => a.contentH <= panelH);
  if (!pick) pick = candidates.reduce((best, a) => (a.contentH < best.contentH ? a : best));

  const visibleH = Math.max(panelH, Math.min(pick.contentH, maxH));
  const scroll = pick.contentH > visibleH;
  return {
    fontSize,
    columns: pick.columns,
    padX,
    padY,
    top: height - visibleH,
    height: visibleH,
    contentH: pick.contentH,
    scroll,
    maxScroll: scroll ? pick.contentH - visibleH : 0,
    rows: pick.rows,
  };
}

/** Desplazamiento del scroll acotado a [0, maxScroll]. */
export function clampScroll(offset: number, layout: Pick<ChoiceLayout, 'maxScroll'>): number {
  return Math.max(0, Math.min(layout.maxScroll, offset));
}

/** Desplazamiento mínimo que deja la opción `index` entera a la vista (para el teclado o la QA). */
export function scrollToShow(index: number, offset: number, layout: ChoiceLayout): number {
  const row = layout.rows.find((r) => r.index === index);
  if (!row || !layout.scroll) return clampScroll(offset, layout);
  let o = offset;
  if (row.y - o < 0) o = row.y - layout.padY;
  if (row.y + row.h - o > layout.height) o = row.y + row.h + layout.padY - layout.height;
  return clampScroll(o, layout);
}

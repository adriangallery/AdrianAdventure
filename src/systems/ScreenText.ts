/**
 * A2.19 (plan SCUMM): «lo que sale en una pantalla, que salga en la pantalla». Lógica pura (sin Phaser ni DOM) del texto
 * que una máquina de la escena enseña DENTRO de su pantalla: qué parte de la línea es de la pantalla, cómo se maqueta en la
 * caja medida sobre el fondo (`scene.json` → `screens`), qué se ve mientras se teclea (scroll) y cuándo hace falta el
 * PRIMER PLANO a pantalla completa (texto largo o pantalla demasiado pequeña para leerse en el viewport).
 *
 * En los scripts va como campo `screen` del op `say`/`sayBrief` (no como op nuevo): la línea sigue siendo la misma línea
 * hablada, con su clip de voz, su subtítulo (más discreto), su salto de cinemática y su avance por toque; solo se le añade
 * dónde se pinta. `display` (opcional) es el texto que se ve en la pantalla si no coincide con lo citado entre comillas;
 * no se habla ni tiene clip de voz.
 *
 *   { "op": "say", "text": "The CRT prints: 'HELLO.'", "screen": "crt" }
 *   { "op": "say", "text": "Thirty-eight pages of Terms...", "screen": "drawer_terms", "display": "TERMS OF SERVICE ...", "closeup": true }
 */

export type ScreenColor = 'green' | 'amber' | 'red' | 'white' | 'gold';

/** Pantalla de una escena (`scene.json` → `screens.<id>`). `bounds` en % del mundo, como los hotspots. */
export interface ScreenDef {
  bounds: { x: number; y: number; w: number; h: number };
  color?: ScreenColor;
  /** Nombre en la cabecera del primer plano (si no, el id en mayúsculas) */
  label?: string;
  /** El texto se escribe sobre un fondo opaco (tapa el dibujo fijo del fondo). Por defecto true. */
  opaque?: boolean;
  /** Pantalla de un objeto en la mano / del inventario: no se pinta en la escena, siempre primer plano */
  closeupOnly?: boolean;
}

export interface ScreenPalette { fg: string; dim: string; bg: string; glow: string }

export const SCREEN_PALETTES: Record<ScreenColor, ScreenPalette> = {
  green: { fg: '#8dff7a', dim: '#3f9a45', bg: '#031207', glow: 'rgba(110,255,120,.35)' },
  amber: { fg: '#ffc357', dim: '#a8701e', bg: '#140a01', glow: 'rgba(255,180,60,.35)' },
  red: { fg: '#ff6b5a', dim: '#a33a2e', bg: '#160403', glow: 'rgba(255,90,70,.35)' },
  white: { fg: '#e8f4ff', dim: '#7b8ea3', bg: '#05080d', glow: 'rgba(200,230,255,.3)' },
  gold: { fg: '#ffd84a', dim: '#a88a20', bg: '#0f0b02', glow: 'rgba(255,215,70,.35)' },
};

export const SCREEN_COLORS = new Set<string>(Object.keys(SCREEN_PALETTES));

/** Ancho de un carácter de «Press Start 2P» respecto a su tamaño (monoespaciada cuadrada) */
export const CHAR_ASPECT = 1;
/** Interlineado (alto de fila / tamaño de letra) */
export const LINE_HEIGHT = 1.35;
/** Margen interior de la pantalla, en fracción del lado menor */
export const SCREEN_PAD = 0.08;
/**
 * Letra mínima que se lee en el VIEWPORT (px CSS) en la pantalla de la escena; por debajo, primer plano.
 * A2.19b: 11 px efectivos (antes 7: en 390×844 el CRT del basement se tecleaba a 8 px y solo se leía por el subtítulo).
 * Es la misma letra mínima del primer plano.
 */
export const MIN_READABLE_PX = 11;
/** Letra máxima dentro de la pantalla (px de pantalla): un texto corto no se pinta gigante */
export const MAX_SCREEN_PX = 14;
/** Columnas mínimas para que el texto se lea en la caja (menos = una palabra por fila) */
export const MIN_COLS = 10;
/** Texto que se considera largo siempre (Términos, logs): primer plano */
export const LONG_TEXT_CHARS = 220;

/**
 * Lo que sale en la pantalla de una línea hablada: `display` si lo hay; si no, lo citado entre comillas simples
 * («The CRT prints: 'HELLO.'» → «HELLO.»), varios trozos citados en filas; si no hay nada citado, la línea entera.
 * Las comillas de los apóstrofos («you're») no cuentan: una cita empieza tras inicio, espacio, «:», «(» o «—» y acaba
 * antes de fin, espacio o puntuación.
 */
export function screenDisplayText(text: string, display?: unknown): string {
  if (typeof display === 'string' && display.trim()) return display.trim();
  const quoted: string[] = [];
  const re = /(?:^|[\s:(—-])'(.+?)'(?=$|[\s.,!?;:)—-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) quoted.push(m[1].trim());
  return quoted.length ? quoted.join('\n') : text.trim();
}

/**
 * Parte el texto en filas de `cols` caracteres como una terminal: respeta los saltos de línea, corta por palabras y
 * parte las palabras más largas que una fila.
 */
export function wrapText(text: string, cols: number): string[] {
  const c = Math.max(1, Math.floor(cols));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (let w of words) {
      while (w.length > c) {
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, c));
        w = w.slice(c);
      }
      if (!w) continue;
      if (!line) line = w;
      else if (line.length + 1 + w.length <= c) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

export interface ScreenLayout {
  /** Tamaño de letra en px de la caja dada */
  fontPx: number;
  cols: number;
  rows: number;
  lines: string[];
  /** Hay más filas que las que caben: se ve el final (scroll de terminal) */
  overflow: boolean;
  pad: number;
}

/**
 * Maqueta `text` en una caja de `w`×`h` px: la letra más grande (hasta `maxPx`) con la que cabe entero; si no cabe ni a
 * `minPx`, se queda a `minPx` y desborda (scroll). Los px son de la misma caja (del mundo o del primer plano).
 */
export function layoutScreen(text: string, box: { w: number; h: number }, opts: { minPx: number; maxPx: number }): ScreenLayout {
  const pad = Math.max(1, Math.round(Math.min(box.w, box.h) * SCREEN_PAD));
  const iw = Math.max(1, box.w - pad * 2);
  const ih = Math.max(1, box.h - pad * 2);
  const minPx = Math.max(1, opts.minPx);
  const maxPx = Math.max(minPx, opts.maxPx);
  const fit = (px: number) => {
    const cols = Math.max(1, Math.floor(iw / (px * CHAR_ASPECT)));
    const rows = Math.max(1, Math.floor(ih / (px * LINE_HEIGHT)));
    // +1 columna para el cursor del final
    const lines = wrapText(text, Math.max(1, cols - 1));
    return { fontPx: px, cols, rows, lines, overflow: lines.length > rows, pad };
  };
  for (let px = Math.floor(maxPx); px >= Math.ceil(minPx); px--) {
    const l = fit(px);
    if (!l.overflow) return l;
  }
  return fit(minPx);
}

/**
 * Lo que se ve mientras se teclea: las filas con los `typed` primeros caracteres (cada salto de fila cuenta como uno) y,
 * si pasan de `rows`, solo las últimas (scroll hacia arriba como una terminal). `scroll` = filas que han subido.
 */
export function visibleRows(lines: string[], rows: number, typed: number): { rows: string[]; scroll: number; done: boolean } {
  const shown: string[] = [];
  let left = Math.max(0, Math.floor(typed));
  for (const line of lines) {
    if (left <= 0 && shown.length) break;
    const take = Math.min(line.length, left);
    shown.push(line.slice(0, take));
    left -= take + 1;
    if (take < line.length) break;
  }
  const total = lines.reduce((n, l) => n + l.length, 0) + Math.max(0, lines.length - 1);
  const r = Math.max(1, rows);
  const scroll = Math.max(0, shown.length - r);
  return { rows: shown.slice(scroll), scroll, done: typed >= total };
}

/** Caracteres que hay que teclear para ver todo (`visibleRows(...).done`) */
export function typedLength(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length, 0) + Math.max(0, lines.length - 1);
}

export type CloseupReason = 'forced' | 'long' | 'small' | 'closeupOnly' | 'cropped';

export interface ViewRect { x: number; y: number; w: number; h: number }

/**
 * A2.19b: ¿la caja de la pantalla (px del viewport) cabe ENTERA en lo que enseña la cámara (px del viewport)? `tol` px de
 * margen por redondeo. Si no cabe, el texto tecleado dentro queda cortado: primer plano (`cropped`).
 */
export function screenFitsView(screen: ViewRect, view: ViewRect, tol = 1): boolean {
  return screen.x >= view.x - tol && screen.y >= view.y - tol
    && screen.x + screen.w <= view.x + view.w + tol && screen.y + screen.h <= view.y + view.h + tol;
}

/**
 * ¿Primer plano? `screenPx` = tamaño de la caja de la pantalla tal como se ve en el viewport (px CSS: caja del mundo ×
 * zoom de la cámara). Devuelve el motivo o null (se lee en la pantalla de la escena).
 * - forced: el script lo pide (`closeup: true`); closeupOnly: la pantalla no está en la escena (un móvil en la mano).
 * - long: más de LONG_TEXT_CHARS, o más filas de las que caben en la caja a la letra mínima legible.
 * - small: a la letra mínima legible no cabe ni la palabra más larga (o MIN_COLS columnas) en una fila (390×844 con la
 *   pantalla del fondo diminuta).
 * - cropped (A2.19b): la cámara corta la pantalla (no cabe entera en el viewport): el texto de dentro no se leería.
 * A2.19b: con la letra mínima a 11 px, si el texto no cabe entero a 11 px (o más filas de las que caben) = `long`: así
 * lo que se teclea en la escena nunca baja de 11 px efectivos (ScreenTextLayer usa la misma mínima).
 */
export function closeupReason(input: {
  text: string;
  screenPx: { w: number; h: number };
  forced?: boolean;
  closeupOnly?: boolean;
  minReadablePx?: number;
  /** A2.19b: la caja de la pantalla y lo que enseña la cámara, en px del viewport; si no cabe entera: `cropped` */
  screenRect?: ViewRect;
  view?: ViewRect;
}): CloseupReason | null {
  if (input.forced) return 'forced';
  if (input.closeupOnly) return 'closeupOnly';
  if (input.screenRect && input.view && !screenFitsView(input.screenRect, input.view)) return 'cropped';
  if (input.text.length > LONG_TEXT_CHARS) return 'long';
  const min = input.minReadablePx ?? MIN_READABLE_PX;
  const l = layoutScreen(input.text, input.screenPx, { minPx: min, maxPx: min });
  // A2.19b: un texto corto («ALL IN.», «WRONG PIN.») se lee en una pantalla estrecha si sus palabras caben enteras a la
  // letra mínima; basta con MIN_COLS columnas o con la palabra más larga (+ cursor), lo que sea menos
  const longest = Math.max(1, ...input.text.split(/\s+/).map((w) => w.length));
  if (l.cols - 1 < Math.min(MIN_COLS, longest)) return 'small';
  if (l.overflow) return 'long';
  return null;
}

/** Ms por carácter del tecleo en la pantalla: más rápido que el subtítulo, con un tope para textos largos (≤ 2,5 s) */
export function screenCharDelay(len: number, base = 28): number {
  if (len <= 0) return 0;
  return Math.max(6, Math.min(base, Math.floor(2500 / len)));
}

/**
 * Valida `screens` de una escena; devuelve los errores (para el linter y el aviso de consola). Una pantalla necesita
 * `bounds` numéricos dentro de 0-100 con ancho y alto positivos y, si lleva `color`, uno de SCREEN_COLORS.
 */
export function screenDefErrors(id: string, def: unknown): string[] {
  const errs: string[] = [];
  if (!def || typeof def !== 'object') return [`screens.${id}: no es un objeto`];
  const d = def as Record<string, unknown>;
  const b = d.bounds as Record<string, unknown> | undefined;
  if (!b || !['x', 'y', 'w', 'h'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number))) {
    errs.push(`screens.${id}: bounds {x,y,w,h} numéricos`);
  } else {
    const { x, y, w, h } = b as { x: number; y: number; w: number; h: number };
    if (w <= 0 || h <= 0) errs.push(`screens.${id}: bounds con ancho y alto > 0`);
    if (x < 0 || y < 0 || x + w > 100.01 || y + h > 100.01) errs.push(`screens.${id}: bounds fuera de 0-100 %`);
  }
  if (d.color !== undefined && !SCREEN_COLORS.has(String(d.color))) errs.push(`screens.${id}: color «${String(d.color)}» (${[...SCREEN_COLORS].join('|')})`);
  return errs;
}

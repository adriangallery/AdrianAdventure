/**
 * A7.3: iconos de la interfaz DIBUJADOS en pixel art (sin depender de la fuente de emoji del sistema).
 *
 * En un Chrome de Linux sin fuente de emoji, o en un Android viejo, '💾', '🏆', '🔊'… salen como cuadraditos vacíos.
 * Cada icono es una rejilla de caracteres (un carácter = un píxel, '.' = transparente) con una paleta común, y se
 * pinta igual en los dos mundos:
 *  - HTML (paneles): `iconSvg(nombre, px)` → `<svg>` en línea con un `<rect>` por tramo, `shape-rendering: crispEdges`.
 *  - Phaser (canvas): `iconTexture(scene, nombre, escala)` → clave de una textura generada una vez por juego.
 *
 * Un icono nuevo = una rejilla más aquí. `tests/no-emoji-ui.test.mjs` impide volver a meter emojis en la interfaz.
 */
import type Phaser from 'phaser';

/** Paleta común (colores de TWP: amarillo #f8e848, morado #5b3a8c, lila claro #e8d5f5…) */
const PALETTE: Record<string, string> = {
  K: '#08080f', // contorno / casi negro
  Y: '#f8e848', // amarillo TWP
  O: '#c08830', // oro oscuro
  W: '#e8d5f5', // lila claro (texto)
  G: '#a8a0c0', // gris lila
  D: '#5b3a8c', // morado TWP
  B: '#5a84e0', // azul
  b: '#2a4a98', // azul oscuro
  S: '#d0d0dc', // plata
  s: '#8a8aa0', // plata oscura
  R: '#e84848', // rojo
  N: '#48d848', // verde
  C: '#48d8e8', // cian
  Z: '#d08850', // bronce
  z: '#8a5428', // bronce oscuro
};

const GRIDS = {
  floppy: [
    'bBBBBBBBB.',
    'BBSSSSbSBB',
    'BBSSSSbSBB',
    'BBSSSSSSBB',
    'BBBBBBBBBB',
    'BWWWWWWWWB',
    'BWKKKKKKWB',
    'BWWWWWWWWB',
    'BWKKKKKWWB',
    'BBBBBBBBBB',
  ],
  trophy: [
    'YYYYYYYYYY',
    'Y.YYWYYY.Y',
    'Y.YWYYYY.Y',
    '.YYYYYYYY.',
    '..YYYYYY..',
    '...YYYY...',
    '....YY....',
    '....YY....',
    '..OOOOOO..',
    '..OOOOOO..',
  ],
  folder: [
    '..........',
    'OOOO......',
    'OYYYO.....',
    'OYYYYOOOOO',
    'OOOOOOOOOO',
    'OYYYYYYYYO',
    'OYYYYYYYYO',
    'OYYYYYYYYO',
    'OYYYYYYYYO',
    'OOOOOOOOOO',
  ],
  speaker: [
    '....W.....',
    '...WW...W.',
    '..WWW.W..W',
    'WWWWW..W.W',
    'WWWWW..W.W',
    'WWWWW..W.W',
    'WWWWW..W.W',
    '..WWW.W..W',
    '...WW...W.',
    '....W.....',
  ],
  mute: [
    '....G.....',
    '...GG.....',
    '..GGG.....',
    'GGGGG.R..R',
    'GGGGG..RR.',
    'GGGGG..RR.',
    'GGGGG.R..R',
    '..GGG.....',
    '...GG.....',
    '....G.....',
  ],
  note: [
    '...YYYYYYY',
    '...YYYYYYY',
    '...Y.....Y',
    '...Y.....Y',
    '...Y.....Y',
    '...Y.....Y',
    '.YYY...YYY',
    'YYYY..YYYY',
    'YYYY..YYYY',
    '.YY....YY.',
  ],
  gear: [
    '....GG....',
    '.GG.GG.GG.',
    '.GGGGGGGG.',
    '..GG..GG..',
    'GGG....GGG',
    'GGG....GGG',
    '..GG..GG..',
    '.GGGGGGGG.',
    '.GG.GG.GG.',
    '....GG....',
  ],
  check: [
    '..........',
    '.........N',
    '........NN',
    '.......NN.',
    'N.....NN..',
    'NN...NN...',
    '.NN.NN....',
    '..NNN.....',
    '...N......',
    '..........',
  ],
  close: [
    'WW......WW',
    'WWW....WWW',
    '.WWW..WWW.',
    '..WWWWWW..',
    '...WWWW...',
    '...WWWW...',
    '..WWWWWW..',
    '.WWW..WWW.',
    'WWW....WWW',
    'WW......WW',
  ],
  cloud: [
    '..........',
    '..........',
    '....WWW...',
    '...WWWWW..',
    '.WWWWWWWW.',
    'WWWWWWWWWW',
    'WWWWWWWWWW',
    '.WWWWWWWW.',
    '..........',
    '..........',
  ],
  pen: [
    '........OO',
    '.......OYO',
    '......OYO.',
    '.....OYO..',
    '....OYO...',
    '...OYO....',
    '..OYO.....',
    '..WO......',
    '.W........',
    'W.WW.WW...',
  ],
  retry: [
    '...CCCC...',
    '..C....C.C',
    '.C......CC',
    'C......CCC',
    'C.........',
    'C.........',
    'C........C',
    '.C......C.',
    '..C....C..',
    '...CCCC...',
  ],
  export: [
    '....CC....',
    '...CCCC...',
    '..CCCCCC..',
    '....CC....',
    '....CC....',
    '....CC....',
    'W...CC...W',
    'W........W',
    'W........W',
    'WWWWWWWWWW',
  ],
  import: [
    '....CC....',
    '....CC....',
    '....CC....',
    '..CCCCCC..',
    '...CCCC...',
    '....CC....',
    'W........W',
    'W........W',
    'W........W',
    'WWWWWWWWWW',
  ],
  lock: [
    '...GGGG...',
    '..G....G..',
    '..G....G..',
    '..G....G..',
    '.YYYYYYYY.',
    '.YYYYYYYY.',
    '.YYYKKYYY.',
    '.YYYKKYYY.',
    '.YYYYYYYY.',
    '.YYYYYYYY.',
  ],
  backpack: [
    '...OOOO...',
    '..O....O..',
    '.OOOOOOOO.',
    'OZZZZZZZZO',
    'OZZZZZZZZO',
    'OZOOOOOOZO',
    'OZOYYYYOZO',
    'OZOOOOOOZO',
    'OZZZZZZZZO',
    '.OOOOOOOO.',
  ],
  clapper: [
    'WKWKWKWKW.',
    'KWKWKWKWKW',
    '..........',
    'GGGGGGGGGG',
    'GKKKKKKKKG',
    'GKKKKKKKKG',
    'GKKKKKKKKG',
    'GKKKKKKKKG',
    'GKKKKKKKKG',
    'GGGGGGGGGG',
  ],
  star: [
    '....YY....',
    '....YY....',
    '...YYYY...',
    'YYYYYYYYYY',
    '.YYYYYYYY.',
    '..YYYYYY..',
    '..YYYYYY..',
    '.YYY..YYY.',
    '.YY....YY.',
    'Y........Y',
  ],
  medal_gold: [
    '.RR....BB.',
    '..RR..BB..',
    '...RRBB...',
    '...YYYY...',
    '..YYYYYY..',
    '.YYYOOYYY.',
    '.YYOYYYYY.',
    '.YYYYYYYY.',
    '..YYYYYY..',
    '...YYYY...',
  ],
  medal_silver: [
    '.RR....BB.',
    '..RR..BB..',
    '...RRBB...',
    '...SSSS...',
    '..SSSSSS..',
    '.SSSssSSS.',
    '.SSsSSSSS.',
    '.SSSSSSSS.',
    '..SSSSSS..',
    '...SSSS...',
  ],
  medal_bronze: [
    '.RR....BB.',
    '..RR..BB..',
    '...RRBB...',
    '...ZZZZ...',
    '..ZZZZZZ..',
    '.ZZZzzZZZ.',
    '.ZZzZZZZZ.',
    '.ZZZZZZZZ.',
    '..ZZZZZZ..',
    '...ZZZZ...',
  ],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof GRIDS;
export const ICON_NAMES = Object.keys(GRIDS) as IconName[];

/** Tramos horizontales del mismo color: [x, y, ancho, color] (menos `<rect>` que un píxel por rect). */
function runs(name: IconName, tint?: string): Array<[number, number, number, string]> {
  const out: Array<[number, number, number, string]> = [];
  GRIDS[name].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== '.' && PALETTE[ch]) out.push([x, y, w, tint ?? PALETTE[ch]]);
      x += w;
    }
  });
  return out;
}

export function iconSize(name: IconName): { w: number; h: number } {
  const g = GRIDS[name];
  return { w: g[0].length, h: g.length };
}

/** `<svg>` en línea (decorativo: aria-hidden; el botón que lo lleva pone su aria-label/title). `px` = alto en CSS px. */
/** `tint`: un solo color para todo el icono (p. ej. la marca del diario sobre fondo verde). */
export function iconSvg(name: IconName, px = 20, style = 'vertical-align: middle;', tint?: string): string {
  const { w, h } = iconSize(name);
  const rects = runs(name, tint).map(([x, y, rw, c]) => `<rect x="${x}" y="${y}" width="${rw}" height="1" fill="${c}"/>`).join('');
  const pw = Math.round((px * w) / h);
  return `<svg class="px-icon" data-icon="${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${pw}" height="${px}" shape-rendering="crispEdges" aria-hidden="true" focusable="false" style="${style}">${rects}</svg>`;
}

/** Elemento HTML con el icono (para appendChild). */
export function iconEl(name: IconName, px = 20, style?: string, tint?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.cssText = 'display: inline-block; line-height: 0; vertical-align: middle;';
  span.innerHTML = iconSvg(name, px, style, tint);
  return span;
}

/** Rellena un elemento con «icono + texto» (el texto como nodo de texto: nada de innerHTML con datos). */
export function setIconLabel(el: HTMLElement, name: IconName, text: string, px = 12): void {
  el.textContent = '';
  el.appendChild(iconEl(name, px, 'vertical-align: middle; margin-right: 6px;'));
  el.appendChild(document.createTextNode(text));
}

/** Textura de Phaser con el icono a `scale` píxeles de pantalla por píxel de arte (entero: se ve nítido). */
export function iconTexture(scene: Phaser.Scene, name: IconName, scale = 2): string {
  const key = `ui-icon-${name}@${scale}`;
  if (scene.textures.exists(key)) return key;
  const { w, h } = iconSize(name);
  const tex = scene.textures.createCanvas(key, w * scale, h * scale);
  if (!tex) return key;
  const ctx = tex.getContext();
  for (const [x, y, rw, c] of runs(name)) {
    ctx.fillStyle = c;
    ctx.fillRect(x * scale, y * scale, rw * scale, scale);
  }
  tex.refresh();
  return key;
}

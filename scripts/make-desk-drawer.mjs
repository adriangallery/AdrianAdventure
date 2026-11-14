// A3.3i (plan SCUMM): el CAJÓN del escritorio de `upstairs` tiene que verse (arte por código, 0 $, sin IA).
//
// La `terminal_key` sale del cajón con cerradura de Términos y Condiciones del escritorio de trading, pero el fondo
// solo pintaba dos cajones de madera iguales y nada decía «aquí hay una cerradura». Este script repinta el cajón de
// ARRIBA de la cajonera derecha, píxel a píxel y de forma determinista:
//   - overlay_drawer_locked.webp  el tirador se corre a la izquierda y en su sitio va una pantallita de cerradura
//                                 (marco oscuro, candado rojo cerrado, líneas de «texto legal» y la barra de ACCEPT).
//                                 Visible mientras NO está `found_terminal_key`.
//   - overlay_drawer_open.webp    el mismo frente, sacado un palmo (se baja 18 px y deja ver el hueco oscuro con el
//                                 canto de los 38 folios de los Términos); la pantalla, en verde con el candado abierto.
//                                 Visible con `found_terminal_key`.
// Cómo: se copia el trozo del fondo, se pinta encima y el overlay es SOLO lo que cambia (Δ > 12 en algún canal; el
// resto, transparente: así no hay manchas casi iguales al fondo ni halo, alfa binario). Cada color pintado se
// cuantiza al color más cercano de la paleta del propio fondo (escritorio y monitores: madera, contorno casi negro,
// rojo y verde de las velas de los gráficos). Escribe los WebP sin pérdida ya recortados a su caja y actualiza
// `conditionalOverlays` del scene.json sin reformatear el resto. Después: `node scripts/crop-overlays.mjs --check`
// y, tras mirar la composición, `--update-lock`.
//
// Uso:  node scripts/make-desk-drawer.mjs                  genera y actualiza
//       node scripts/make-desk-drawer.mjs --preview <dir>  además deja composiciones sobre el fondo para mirarlas
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contentBox, boxToPct, replaceTopLevelKey } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'scenes', 'upstairs');
const previewIdx = process.argv.indexOf('--preview');
const PREVIEW = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

const { data: BG, info } = await sharp(join(DIR, 'background.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const idx = (x, y) => (y * W + x) * 4;
const getBg = (x, y) => [BG[idx(x, y)], BG[idx(x, y) + 1], BG[idx(x, y) + 2]];

// ── Paleta del fondo: todos los colores del escritorio y los monitores (el fondo no es de paleta cerrada) ──
const counts = new Map();
for (let y = 450; y < 1000; y++) {
  for (let x = 1500; x < 2420; x++) {
    const i = idx(x, y);
    const k = (BG[i] << 16) | (BG[i + 1] << 8) | BG[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
}
const PALETTE = [...counts].map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
const qCache = new Map();
const quant = (c) => {
  const key = (c[0] << 16) | (c[1] << 8) | c[2];
  if (qCache.has(key)) return qCache.get(key);
  let best = PALETTE[0];
  let bd = Infinity;
  for (const p of PALETTE) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  qCache.set(key, best);
  return best;
};

// ── Geometría del cajón de arriba de la cajonera derecha (px del fondo 3712×1152) ──
const FRONT = { x0: 2188, x1: 2371, y0: 789, y1: 866 }; // frente con su contorno
const BODY = [72, 36, 23]; // madera del frente
const HANDLE = { x0: 2240, x1: 2326, y0: 812, y1: 854 }; // tirador original y su sombra
const HANDLE_DX = -42; // el tirador se corre a la izquierda
const SCREEN = { x0: 2282, x1: 2357, y0: 802, y1: 853 }; // pantallita de cerradura
const SPX = 4; // un píxel de arte de la pantalla = 4 px de fondo

const C = {
  K: [9, 5, 5], // contorno (el del cajón)
  F: [62, 58, 60], // marco de la pantalla (gris oscuro de los monitores)
  f: [104, 98, 96], // luz del marco, arriba
  S: [6, 10, 9], // cristal apagado
  R: [222, 58, 52], // rojo de las velas
  r: [120, 24, 24], // rojo oscuro (ojo de la cerradura)
  G: [80, 214, 96], // verde de las velas
  g: [26, 92, 40], // verde oscuro
  L: [128, 136, 130], // «texto legal» gris
  I: [20, 8, 10], // interior del cajón
  P: [226, 214, 186], // canto de los folios
  p: [120, 104, 88], // sombra del canto
};

const LOCKED = [
  '...............',
  '.RRR...........',
  'R...R.LLLLLLLL.',
  'R...R..........',
  'RRRRR.LLLLLL...',
  'RRrRR..........',
  'RRrRR.LLLLLLLL.',
  'RRRRR..........',
  '......RRRRRRR..',
];
const OPEN = [
  '...GGG.........',
  '...G..G........',
  '......G.LLLLLL.',
  'GGGGG..........',
  'GGgGG..LLLLL...',
  'GGgGG..........',
  'GGGGG..LLLLLL..',
  '...............',
  '......GGGGGGG..',
];

function paintFront(img, lockGrid) {
  const set = (x, y, c) => { const i = idx(x, y); img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
  // 1. tirador: se copia corrido a la izquierda (solo lo que no es madera) y se borra el original
  const handlePx = [];
  for (let y = HANDLE.y0; y < HANDLE.y1; y++) {
    for (let x = HANDLE.x0; x < HANDLE.x1; x++) {
      const c = getBg(x, y);
      if (Math.max(Math.abs(c[0] - BODY[0]), Math.abs(c[1] - BODY[1]), Math.abs(c[2] - BODY[2])) > 22) handlePx.push([x, y, c]);
    }
  }
  for (let y = HANDLE.y0; y < HANDLE.y1; y++) for (let x = HANDLE.x0; x < HANDLE.x1; x++) set(x, y, BODY);
  for (const [x, y, c] of handlePx) set(x + HANDLE_DX, y, c);
  // 2. pantallita: contorno, marco con luz arriba, cristal y la rejilla de arte
  for (let y = SCREEN.y0; y < SCREEN.y1; y++) {
    for (let x = SCREEN.x0; x < SCREEN.x1; x++) {
      const e = Math.min(x - SCREEN.x0, SCREEN.x1 - 1 - x, y - SCREEN.y0, SCREEN.y1 - 1 - y);
      if (e < 3) set(x, y, C.K);
      else if (e < 6) set(x, y, y - SCREEN.y0 < 6 ? C.f : C.F);
      else set(x, y, C.S);
    }
  }
  const gx = SCREEN.x0 + 7;
  const gy = SCREEN.y0 + 7;
  lockGrid.forEach((row, ry) => [...row].forEach((ch, rx) => {
    if (ch === '.') return;
    for (let dy = 0; dy < SPX; dy++) for (let dx = 0; dx < SPX; dx++) {
      const x = gx + rx * SPX + dx;
      const y = gy + ry * SPX + dy;
      if (x < SCREEN.x1 - 6 && y < SCREEN.y1 - 6) set(x, y, C[ch]);
    }
  }));
  // sombra de contacto de la pantalla sobre la madera (abajo y a la derecha, 2 px)
  for (let x = SCREEN.x0 + 3; x < SCREEN.x1 + 2; x++) for (let y = SCREEN.y1; y < SCREEN.y1 + 2; y++) set(x, y, [44, 20, 18]);
  for (let y = SCREEN.y0 + 3; y < SCREEN.y1; y++) for (let x = SCREEN.x1; x < SCREEN.x1 + 2; x++) set(x, y, [44, 20, 18]);
}

function render(open) {
  const img = Buffer.from(BG);
  paintFront(img, open ? OPEN : LOCKED);
  if (open) {
    // el frente se saca: se baja DROP px y deja ver el hueco con el canto de los folios
    const DROP = 18;
    const front = [];
    for (let y = FRONT.y0; y < FRONT.y1; y++) for (let x = FRONT.x0; x < FRONT.x1; x++) {
      const i = idx(x, y);
      front.push([x, y, [img[i], img[i + 1], img[i + 2]]]);
    }
    const set = (x, y, c) => { const i = idx(x, y); img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
    for (let y = FRONT.y0; y < FRONT.y0 + DROP + 6; y++) {
      for (let x = FRONT.x0; x < FRONT.x1; x++) {
        const edge = x < FRONT.x0 + 5 || x >= FRONT.x1 - 5 || y < FRONT.y0 + 3;
        set(x, y, edge ? C.K : C.I);
      }
    }
    // folios: tres cantos claros escalonados con su sombra
    for (const [y, x0, x1] of [[FRONT.y0 + 5, 2206, 2296], [FRONT.y0 + 10, 2200, 2318], [FRONT.y0 + 15, 2212, 2340]]) {
      for (let x = x0; x < x1; x++) { set(x, y, C.P); set(x, y + 1, C.P); set(x, y + 2, C.P); set(x, y + 3, C.p); }
    }
    for (const [x, y, c] of front) set(x, y + DROP, c);
    // sombra del frente sacado sobre el cajón de abajo
    for (let x = FRONT.x0 + 2; x < FRONT.x1; x++) for (let y = FRONT.y1 + DROP; y < FRONT.y1 + DROP + 3; y++) set(x, y, C.K);
  }
  // overlay = solo lo que cambia; cuantizado a la paleta del fondo; alfa binario
  const out = Buffer.alloc(W * H * 4);
  for (let y = FRONT.y0 - 4; y < FRONT.y1 + 24; y++) {
    for (let x = FRONT.x0 - 4; x < FRONT.x1 + 6; x++) {
      const i = idx(x, y);
      const c = [img[i], img[i + 1], img[i + 2]];
      const b = getBg(x, y);
      if (Math.max(Math.abs(c[0] - b[0]), Math.abs(c[1] - b[1]), Math.abs(c[2] - b[2])) <= 12) continue;
      const q = quant(c);
      if (Math.max(Math.abs(q[0] - b[0]), Math.abs(q[1] - b[1]), Math.abs(q[2] - b[2])) <= 12) continue;
      out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2]; out[i + 3] = 255;
    }
  }
  return out;
}

const OVERLAYS = [
  { id: 'desk_drawer_locked', sprite: 'overlay_drawer_locked', flag: 'found_terminal_key', invert: true, open: false },
  { id: 'desk_drawer_open', sprite: 'overlay_drawer_open', flag: 'found_terminal_key', open: true },
];

const sceneFile = join(DIR, 'scene.json');
const text = readFileSync(sceneFile, 'utf8');
const scene = JSON.parse(text);
const list = (scene.conditionalOverlays ?? []).filter((co) => !OVERLAYS.some((o) => o.id === co.id));
const made = [];
for (const o of OVERLAYS) {
  const buf = render(o.open);
  const box = contentBox(buf, W, H, 4);
  const out = join(DIR, `${o.sprite}.webp`);
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).extract(box).webp({ lossless: true, effort: 6 }).toFile(out);
  const bounds = boxToPct(box, W, H);
  list.push({ id: o.id, sprite: o.sprite, format: 'webp', bounds, flag: o.flag, ...(o.invert ? { invert: true } : {}), depth: 5 });
  made.push({ ...o, box, buf });
  console.log(`  ${o.sprite}.webp  ${box.width}x${box.height} en (${box.left}, ${box.top})  bounds ${JSON.stringify(bounds)}`);
}
writeFileSync(sceneFile, replaceTopLevelKey(text, 'conditionalOverlays', list));

if (PREVIEW) {
  mkdirSync(PREVIEW, { recursive: true });
  const bgFile = join(DIR, 'background.png');
  for (const o of made) {
    const ov = await sharp(o.buf, { raw: { width: W, height: H, channels: 4 } }).extract(o.box).png().toBuffer();
    const comp = await sharp(bgFile).composite([{ input: ov, left: o.box.left, top: o.box.top }]).png().toBuffer();
    // recorte ampliado ×3 del escritorio y vista «móvil» 844×390 (fondo a 390 de alto, centrado en el cajón)
    await sharp(comp).extract({ left: 2060, top: 700, width: 420, height: 330 }).resize(1260, 990, { kernel: 'nearest' }).toFile(join(PREVIEW, `${o.sprite}-x3.png`));
    const sc = 390 / H;
    const mw = Math.round(W * sc);
    const cx = Math.round(2280 * sc);
    const left = Math.max(0, Math.min(mw - 844, cx - 422));
    await sharp(await sharp(comp).resize(mw, 390, { kernel: 'nearest' }).toBuffer()).extract({ left, top: 0, width: 844, height: 390 }).toFile(join(PREVIEW, `${o.sprite}-movil.png`));
  }
  await sharp(bgFile).extract({ left: 2060, top: 700, width: 420, height: 330 }).resize(1260, 990, { kernel: 'nearest' }).toFile(join(PREVIEW, 'antes-x3.png'));
  console.log(`  composiciones en ${PREVIEW}`);
}

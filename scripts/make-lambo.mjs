// A3.12 (plan SCUMM): arte por código del «lambo» de `outside` (0 $, sin IA; vía B, como make-outside-props.mjs).
//
// Superdeportivo de cuña GENÉRICO de los 90 (sin logotipo, escudo ni nombre), amarillo/naranja, en vista lateral con
// el morro hacia la casa, aparcado bajo el carport. Se pinta en una rejilla de arte de forma determinista (perfil por
// polígonos, pasos de arco de rueda, llantas doradas, tomas de aire, cristal con el atardecer reflejado, tramado en
// damero entre tonos como el del fondo), se le pone un contorno oscuro de 1 px de arte y sombra de contacto, y se
// escala ×PX con vecino más cercano. Todos los colores son de la paleta del fondo de outside (median cut de 48
// colores de background.png). El poste delantero derecho del carport queda DELANTE del coche: el overlay deja
// transparente su columna (así el poste del fondo tapa el coche sin capa extra de walk-behind).
//
// Escala: Dex ≈ 103 px de arte × 4,5 = ~463 px de fondo para 1,75 m. Coche 224 × 60 px de arte → 1008 × 270 px
// (≈ 2,2 × y 0,58 × el alto de Dex: el largo real de una cuña de 4 m es ≈ 2,3 × Dex; algo más corto para caber
// entre los postes del carport).
//
// Uso:  node scripts/make-lambo.mjs                  escribe assets/scenes/outside/overlay_lambo.webp e imprime bounds
//       node scripts/make-lambo.mjs --preview <dir>  además deja composiciones sobre el fondo para mirarlas
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contentBox, boxToPct } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'scenes', 'outside');
const BG_W = 3712;
const BG_H = 1152;
const PX = 4.5;
const previewIdx = process.argv.indexOf('--preview');
const PREVIEW = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

// Colocación en el fondo (px de fondo): esquina izquierda del arte y línea del suelo (bajo las ruedas)
const ORIGIN_X = 2440;
const GROUND_Y = 1062;
// Columna del poste delantero derecho del carport (delante del coche): se deja transparente
const POST = { x0: 3150, x1: 3206 };

// Paleta (toda del fondo de outside)
const C = {
  K: [17, 6, 3], // contorno
  k: [9, 2, 1], // negro (neumático, tomas)
  t: [32, 20, 14], // flanco del neumático
  g: [24, 13, 10], // cristal oscuro
  r: [64, 32, 30], // cristal medio
  s: [208, 97, 73], // reflejo del atardecer en el cristal
  p: [254, 179, 103], // brillo del reflejo
  Y: [247, 186, 90], // carrocería con luz (techo, capó, pliegue del hombro)
  y: [216, 162, 91], // carrocería (a la sombra del techo del carport)
  o: [223, 127, 72], // carrocería en media sombra (bajo la línea de hombro)
  O: [145, 66, 52], // carrocería en sombra (faldón)
  d: [91, 39, 31], // sombra profunda (pasos de rueda, juntas)
  b: [144, 96, 68], // llanta dorada con luz
  B: [106, 79, 37], // llanta en sombra
  h: [76, 55, 42], // buje
  T: [215, 54, 93], // piloto trasero
  a: [250, 118, 70], // intermitente lateral
};

const W = 224;
const H = 62; // con la sombra de contacto
const GROUND = 58; // fila de arte donde apoyan los neumáticos
const grid = Array.from({ length: H }, () => Array(W).fill(null));
const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = c; };
const get = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? grid[y][x] : null);

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Línea de un polígono abierto: y en la x dada (interpolación lineal)
function lineY(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return null;
}
const dither = (x, y) => (x + y) % 2 === 0;

// ── Perfil ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Cuña: morro bajo a la izquierda, parabrisas muy tumbado, techo corto, tapa del motor que cae hacia atrás.
const TOP = [[1, 36], [10, 31], [28, 27], [58, 26], [82, 23], [112, 9], [150, 9], [190, 17], [214, 21], [222, 24]];
const BODY = [...TOP, [223, 46], [218, 50], [6, 50], [0, 44], [0, 39]];
const GLASS = [[86, 24], [113, 11], [146, 11], [156, 24]];
const WHEELS = [{ cx: 42, cy: 44, r: 14 }, { cx: 182, cy: 44, r: 14 }];
const SHOULDER = [[2, 41], [222, 33]]; // línea de hombro: arriba con luz, abajo en sombra

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!inPoly(x + 0.5, y + 0.5, BODY)) continue;
    const top = lineY(TOP, x) ?? 0;
    const sh = lineY(SHOULDER, x);
    let c;
    if (y < top + 2) c = 'Y'; // canto superior iluminado
    else if (y < sh - 2) c = dither(x, y) && y > sh - 4 ? 'o' : 'y';
    else if (y < sh) c = 'Y'; // brillo del pliegue del hombro (pega la luz del atardecer)
    else if (y < 44) c = dither(x, y) && y > 41 ? 'O' : 'o';
    else c = 'O';
    set(x, y, c);
  }
}
// Cristal lateral con el cielo del atardecer reflejado en diagonal
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inPoly(x + 0.5, y + 0.5, GLASS)) continue;
  const diag = x + y * 1.4;
  let c = y > 20 ? 'g' : 'r';
  if (diag > 120 && diag < 130) c = 's';
  if (diag >= 124 && diag < 127) c = 'p';
  if (diag > 136 && diag < 139) c = 's';
  set(x, y, c);
}
// Marco del cristal y pilar central
for (let x = 86; x <= 156; x++) { const yb = 24; if (get(x, yb)) set(x, yb, 'd'); }
for (let y = 11; y <= 24; y++) set(128 + Math.round((24 - y) * 0.25), y, 'd');
// Juntas de puerta y del capó
for (let y = 25; y <= 47; y++) { set(86 - Math.round((y - 25) * 0.15), y, 'd'); set(158, y, 'd'); }
for (let x = 22; x <= 70; x++) { const y = Math.round(lineY(TOP, x) + 3); if (x % 1 === 0 && get(x, y) === 'y') set(x, y, 'o'); }
// Toma de aire lateral (cinco lamas) detrás de la puerta
for (let i = 0; i < 5; i++) {
  const x0 = 162 + i * 5;
  for (let y = 27; y <= 37; y++) for (let x = x0; x <= x0 + 2; x++) {
    const slant = Math.round((y - 27) * 0.3);
    set(x - slant, y, y === 27 ? 'd' : 'k');
  }
}
// Rejilla de la tapa del motor (lamas sobre la cubierta)
for (let x = 160; x <= 206; x += 4) { const y = Math.round(lineY(TOP, x)); set(x, y + 1, 'd'); set(x + 1, y + 1, 'd'); }
// Faldón inferior oscuro y entrada de aire delantera
for (let x = 4; x <= 220; x++) { set(x, 49, 'd'); set(x, 48, get(x, 48) ? 'O' : null); }
for (let x = 3; x <= 18; x++) set(x, 45, 'k');
// Pilotos: intermitente ámbar en el morro, piloto trasero en la cola
for (let y = 39; y <= 41; y++) for (let x = 2; x <= 6; x++) set(x, y, 'a');
for (let y = 26; y <= 32; y++) for (let x = 219; x <= 222; x++) set(x, y, 'T');
// Alerón trasero: pala plana sobre dos patas (el gesto más «wen lambo» de la silueta)
for (let x = 194; x <= 223; x++) { set(x, 11, 'Y'); set(x, 12, 'y'); set(x, 13, 'o'); }
for (const x of [200, 214]) for (let y = 14; y <= Math.round(lineY(TOP, x)); y++) { set(x, y, 'O'); set(x + 1, y, 'd'); }
// Retrovisor
for (let x = 88; x <= 94; x++) for (let y = 20; y <= 23; y++) set(x, y, y === 20 ? 'Y' : 'y');

// Pasos de rueda (huecos oscuros) y ruedas
for (const { cx, cy, r } of WHEELS) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d <= r + 3 && y <= cy && get(x, y)) set(x, y, d > r + 1.5 ? 'd' : 'k'); // arco
    if (d <= r && y + 0.5 <= GROUND && y > (lineY(TOP, x) ?? 0) + 2) {
      let c = 'k';
      if (d > r - 2.5) c = 't';
      if (d > r - 1) c = 'k';
      if (d <= r - 4) c = dx + dy < 0 ? 'b' : 'B'; // llanta: luz arriba a la izquierda (cielo), sombra abajo
      if (d <= r - 4 && d > r - 5.2) c = 'B';
      if (d <= 2) c = 'h';
      // Radios: cinco, de la llanta «teléfono» de los 90 (agujeros oscuros entre radios)
      const ang = Math.atan2(dy, dx);
      if (d > 3 && d < r - 5 && Math.cos(ang * 5) > 0.55) c = 'h';
      set(x, y, c);
    }
  }
}

// Contorno de 1 px de arte (4 vecinos) alrededor de la silueta
{
  const add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!grid[y][x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!get(x + dx, y + dy) && y + dy >= 0 && y + dy < H) add.push([x + dx, y + dy]);
  }
  for (const [x, y] of add) if (x >= 0 && x < W && y <= GROUND) set(x, y, 'K');
}

// ── Raster a tamaño de fondo ─────────────────────────────────────────────────────────────────────────────────────
const SW = Math.round(W * PX), SH = Math.round(H * PX);
const buf = Buffer.alloc(BG_W * BG_H * 4);
const oy = GROUND_Y - Math.round((GROUND + 1) * PX); // la fila GROUND acaba en GROUND_Y
// Sombra de contacto: elipse ancha bajo el coche, negro con alfa, a escala de arte (bordes en escalón, sin degradado)
for (let ay = GROUND - 4; ay < H; ay++) for (let ax = -6; ax < W + 6; ax++) {
  const ex = (ax + 0.5 - W / 2) / (W / 2 + 4), ey = (ay + 0.5 - (GROUND + 0.5)) / 3.2;
  const e = ex * ex + ey * ey;
  if (e > 1) continue;
  const alpha = e < 0.55 ? 150 : 95;
  for (let py = Math.round(ay * PX); py < Math.round((ay + 1) * PX); py++) for (let px = Math.round(ax * PX); px < Math.round((ax + 1) * PX); px++) {
    const X = ORIGIN_X + px, Y = oy + py;
    if (X < 0 || X >= BG_W || Y < 0 || Y >= BG_H) continue;
    const i = (Y * BG_W + X) * 4;
    buf[i] = C.k[0]; buf[i + 1] = C.k[1]; buf[i + 2] = C.k[2]; buf[i + 3] = alpha;
  }
}
for (let py = 0; py < SH; py++) for (let px = 0; px < SW; px++) {
  const c = grid[Math.min(H - 1, Math.floor(py / PX))][Math.min(W - 1, Math.floor(px / PX))];
  if (!c) continue;
  const X = ORIGIN_X + px, Y = oy + py;
  if (X < 0 || X >= BG_W || Y < 0 || Y >= BG_H) continue;
  const i = (Y * BG_W + X) * 4;
  const [r, g, b] = C[c];
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
}
// El poste delantero derecho del carport tapa el coche
for (let Y = 0; Y < BG_H; Y++) for (let X = POST.x0; X < POST.x1; X++) buf[(Y * BG_W + X) * 4 + 3] = 0;

const box = contentBox(buf, BG_W, BG_H, 4);
const out = join(DIR, 'overlay_lambo.webp');
await sharp(buf, { raw: { width: BG_W, height: BG_H, channels: 4 } }).extract(box).webp({ lossless: true, effort: 6 }).toFile(out);
console.log(`overlay_lambo.webp ${box.width}x${box.height} en (${box.left}, ${box.top})  bounds ${JSON.stringify(boxToPct(box, BG_W, BG_H))}`);

if (PREVIEW) {
  mkdirSync(PREVIEW, { recursive: true });
  const bg = join(DIR, 'background.png');
  const ov = await sharp(buf, { raw: { width: BG_W, height: BG_H, channels: 4 } }).png().toBuffer();
  const after = await sharp(bg).composite([{ input: ov }]).png().toBuffer();
  const l = 2200, t = 560, w = 1512, h = 592;
  await sharp(after).extract({ left: l, top: t, width: w, height: h }).png().toFile(join(PREVIEW, 'lambo-zoom.png'));
  await sharp(after).resize(844).png().toFile(join(PREVIEW, 'scene844.png'));
  await sharp(after).resize({ height: 390 }).extract({ left: 1257 - 844, top: 0, width: 844, height: 390 }).png().toFile(join(PREVIEW, 'landscape-right-844x390.png'));
}

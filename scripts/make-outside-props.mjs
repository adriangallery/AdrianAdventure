// A3.3f (plan SCUMM): arte por código de los props de puzle de `outside` que el fondo no dibuja (0 $, sin IA).
//
// «Lo que hace falta para un puzle tiene que VERSE»: el nido de urracas de `hs_chimney` y el tablón suelto de
// `hs_fence` no se distinguían en el fondo. Este script pinta, píxel a píxel y de forma determinista:
//   - overlay_nest.webp         nido de ramitas encima de la corona de la chimenea, con dos urracas (blanco y negro,
//                               cola azulada) y un brillo de papel de aluminio. Visible mientras NO está `nest_down`.
//   - overlay_plank_loose.webp  hueco en la valla + tablón claro torcido colgando de un clavo. Visible sin `has_plank`.
//   - overlay_fence_gap.webp    solo el hueco (tras coger el tablón, `has_plank`).
// Cada píxel de arte mide PX = 4,5 px de fondo (el `pixelScale` de outside) y se escala con vecino más cercano. Los
// colores salen del propio fondo (contorno casi negro, ladrillo, madera de la valla). Escribe los WebP sin pérdida ya
// recortados a su caja (misma cuenta que scripts/lib/overlay-crop.mjs) y actualiza `conditionalOverlays` del
// scene.json (sin reformatear el resto). `node scripts/crop-overlays.mjs --check` (lint) los da por buenos.
//
// Uso:  node scripts/make-outside-props.mjs                  genera y actualiza
//       node scripts/make-outside-props.mjs --preview <dir>  además deja composiciones sobre el fondo para mirarlas
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contentBox, boxToPct, replaceTopLevelKey } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'scenes', 'outside');
const BG_W = 3712;
const BG_H = 1152;
const PX = 4.5;
const previewIdx = process.argv.indexOf('--preview');
const PREVIEW = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

// Paleta (muestreada del fondo de outside)
const C = {
  K: [18, 2, 2], // contorno (el del ladrillo y la valla)
  D: [59, 26, 33], // ramita oscura (sombra del ladrillo)
  M: [110, 60, 45], // ramita media
  L: [176, 120, 72], // paja clara (luz del atardecer)
  H: [222, 170, 96], // brillo cálido de las ramitas de arriba
  B: [16, 12, 22], // urraca negra
  U: [44, 70, 138], // reflejo azul de la cola y el ala
  W: [244, 238, 232], // urraca blanca
  E: [255, 255, 255], // ojo / destello
  F: [196, 204, 216], // papel de aluminio
  G: [120, 128, 144], // aluminio en sombra
  P: [186, 128, 86], // tablón suelto (más claro que los vecinos, 78,41,35)
  Q: [226, 176, 120], // canto iluminado del tablón
  R: [112, 64, 50], // veta / sombra del tablón
  N: [214, 214, 200], // cabeza del clavo
  V: [8, 3, 4], // hueco de la valla
  O: [52, 44, 26], // matorral que asoma por el hueco
};

// Rejilla de arte: Map "x,y" → letra de la paleta (coordenadas de arte, pueden ser negativas)
class Grid {
  constructor() {
    this.px = new Map();
  }
  set(x, y, c) {
    this.px.set(`${x},${y}`, c);
  }
  get(x, y) {
    return this.px.get(`${x},${y}`);
  }
  /** Dibuja filas de texto ('.' = vacío) con la esquina en (ox, oy); `mirror` las da la vuelta en horizontal */
  sprite(rows, ox, oy, mirror = false) {
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        const xx = mirror ? row.length - 1 - x : x;
        this.set(ox + xx, oy + y, ch);
      });
    });
  }
  /** Línea de Bresenham */
  line(x0, y0, x1, y1, c) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** Contorno de 1 px de arte alrededor de todo lo pintado (salvo `skip`), en los huecos de 4 vecinos */
  outline(c = 'K', skip = '') {
    const add = [];
    for (const [k, v] of this.px) {
      if (skip.includes(v)) continue;
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.px.has(`${x + dx},${y + dy}`)) add.push([x + dx, y + dy]);
    }
    for (const [x, y] of add) this.set(x, y, c);
  }
}

// PRNG determinista (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Nido ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const MAGPIE = [
  '..BBB.......',
  '.BEBBB......',
  'BBBBBB......',
  '..BBBBW.....',
  '..BWWWWB....',
  '..WWWWBUB...',
  '...WWWBUUBB.',
  '....BBBB.UUU',
  '....B..B...U',
];
const MAGPIE_PECK = [
  '............',
  '......WBBUUU',
  '...BBWWBUBU.',
  '..BBWWWWB...',
  '.BEBBWWB....',
  'BBBB.B.B....',
];

function nestGrid() {
  const g = new Grid();
  const r = rng(0xa33f);
  const W = 28, cx = 13.5, top = 4, depth = 7;
  // Cuenco: media elipse con borde de paja alto e irregular
  for (let x = 0; x < W; x++) {
    const u = (x - cx) / (W / 2);
    const bottom = top + Math.round(depth * Math.sqrt(Math.max(0, 1 - u * u)));
    const rim = top - (r() < 0.35 ? 1 : 0);
    for (let y = rim; y <= bottom; y++) {
      const v = r();
      g.set(x, y, y <= top ? (v < 0.5 ? 'H' : 'L') : v < 0.4 ? 'M' : v < 0.75 ? 'D' : 'L');
    }
  }
  // Ramitas que cruzan el cuenco y sobresalen (diagonales en claro y oscuro)
  const twigs = [
    [-3, 2, 9, 7, 'L'], [18, 7, 31, 1, 'L'], [2, 8, 14, 3, 'H'], [12, 9, 26, 4, 'M'], [-2, 6, 6, 9, 'D'],
    [22, 2, 30, 6, 'D'], [6, 3, 11, 0, 'L'], [15, 3, 19, 0, 'M'], [24, 8, 29, 10, 'M'], [-1, 4, 4, 6, 'H'],
  ];
  for (const [x0, y0, x1, y1, c] of twigs) g.line(x0, y0, x1, y1, c);
  // Ramitas que cuelgan por delante de la corona
  g.line(5, 10, 3, 14, 'M');
  g.line(20, 10, 22, 13, 'D');
  // Papel de aluminio arrugado en el borde (lo que brilla)
  g.sprite(['.FE', 'FGF', 'GF.'], 9, 2);
  g.outline('K');
  // Urraca que vigila (izquierda, mirando a la izquierda) y urraca que picotea (derecha)
  const m = new Grid();
  m.sprite(MAGPIE, 1, -8);
  m.sprite(MAGPIE_PECK, 18, -4, true);
  m.outline('K', 'B');
  for (const [k, v] of m.px) if (!g.px.has(k) || v !== 'K') g.px.set(k, v);
  return g;
}

// ── Tablón ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Tablón de 6 × 26 px de arte que cuelga de un clavo en su esquina de arriba y gira ANG grados (la punta de abajo
// se va a la izquierda, por encima del tablón vecino).
const PLANK_W = 6, PLANK_H = 26, ANG = 24;
function plankGrid() {
  const g = new Grid();
  const a = (ANG * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  // Muestreo inverso: para cada píxel de destino, ¿cae dentro del tablón sin girar? (pivote en el clavo, (1, 1))
  for (let y = -2; y < PLANK_H + 4; y++) {
    for (let x = -16; x < PLANK_W + 4; x++) {
      const dx = x + 0.5 - 1.5, dy = y + 0.5 - 1.5;
      const u = dx * ca + dy * sa + 1.5, v = -dx * sa + dy * ca + 1.5;
      if (u < 0 || u >= PLANK_W || v < 0 || v >= PLANK_H) continue;
      const ui = Math.floor(u), vi = Math.floor(v);
      let c = 'P';
      if (ui === 0) c = 'Q'; // canto con luz
      else if (ui === PLANK_W - 1) c = 'R';
      else if ((ui === 2 && vi % 7 > 1 && vi % 7 < 6) || (ui === 3 && vi % 9 === 4)) c = 'R'; // vetas
      if (vi >= PLANK_H - 2 && (ui + vi) % 2 === 0) c = 'R'; // punta astillada
      g.set(x, y, c);
    }
  }
  // Punta rota: dos dientes
  g.outline('K');
  g.sprite(['KNK', 'NEN', 'KNK'], 0, 0); // clavo
  return g;
}
function gapGrid() {
  const g = new Grid();
  // Hueco del tablón (6 px de arte de ancho) con matorral oscuro asomando
  for (let y = 0; y < PLANK_H; y++) for (let x = 0; x < PLANK_W; x++) g.set(x, y, (x * 3 + y * 5) % 11 === 0 || (y > 17 && (x + y) % 3 === 0) ? 'O' : 'V');
  return g;
}

// ── Rasterizado a píxeles de fondo ───────────────────────────────────────────────────────────────────────────────
/** Pinta las rejillas en una capa RGBA del tamaño del fondo; (ox, oy) = px de fondo del píxel de arte (0, 0) */
function rasterize(layers) {
  const buf = Buffer.alloc(BG_W * BG_H * 4);
  for (const { grid, ox, oy } of layers) {
    for (const [k, c] of grid.px) {
      const [ax, ay] = k.split(',').map(Number);
      const x0 = Math.round(ox + ax * PX), x1 = Math.round(ox + (ax + 1) * PX);
      const y0 = Math.round(oy + ay * PX), y1 = Math.round(oy + (ay + 1) * PX);
      const rgb = C[c];
      if (!rgb) throw new Error(`color desconocido ${c}`);
      for (let y = Math.max(0, y0); y < Math.min(BG_H, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(BG_W, x1); x++) {
          const i = (y * BG_W + x) * 4;
          buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
        }
      }
    }
  }
  return buf;
}

// Dónde va cada cosa (px del fondo 3712×1152)
const NEST_AT = { ox: 1560, oy: 46 }; // corona izquierda de la chimenea (1580–1757, y≈45–80), con el cielo detrás: en vertical la derecha la tapa el botón Connect
const SLOT_X = 72; // tercer tablón de la valla (72–100 px), cuyo canto de arriba está en y≈700
const SLOT_Y = 698;

const OVERLAYS = [
  { id: 'nest', sprite: 'overlay_nest', flag: 'nest_down', invert: true, layers: [{ grid: nestGrid(), ...NEST_AT }] },
  {
    id: 'plank_loose',
    sprite: 'overlay_plank_loose',
    flag: 'has_plank',
    invert: true,
    layers: [{ grid: gapGrid(), ox: SLOT_X, oy: SLOT_Y }, { grid: plankGrid(), ox: SLOT_X, oy: SLOT_Y - 4 }],
  },
  { id: 'fence_gap', sprite: 'overlay_fence_gap', flag: 'has_plank', layers: [{ grid: gapGrid(), ox: SLOT_X, oy: SLOT_Y }] },
];

const sceneFile = join(DIR, 'scene.json');
const text = readFileSync(sceneFile, 'utf8');
const scene = JSON.parse(text);
const list = (scene.conditionalOverlays ?? []).filter((co) => !OVERLAYS.some((o) => o.id === co.id));
const made = [];
for (const o of OVERLAYS) {
  const buf = rasterize(o.layers);
  const box = contentBox(buf, BG_W, BG_H, 4);
  const out = join(DIR, `${o.sprite}.webp`);
  await sharp(buf, { raw: { width: BG_W, height: BG_H, channels: 4 } }).extract(box).webp({ lossless: true, effort: 6 }).toFile(out);
  const bounds = boxToPct(box, BG_W, BG_H);
  const entry = { id: o.id, sprite: o.sprite, format: 'webp', bounds, flag: o.flag, ...(o.invert ? { invert: true } : {}), depth: 5 };
  list.push(entry);
  made.push({ ...o, box, buf });
  console.log(`  ${o.sprite}.webp  ${box.width}x${box.height} en (${box.left}, ${box.top})  bounds ${JSON.stringify(bounds)}`);
}
writeFileSync(sceneFile, replaceTopLevelKey(text, 'conditionalOverlays', list));

if (PREVIEW) {
  mkdirSync(PREVIEW, { recursive: true });
  const bg = join(DIR, 'background.png');
  const ov = (ids) => made.filter((m) => ids.includes(m.id)).map((m) => ({ input: m.buf, raw: { width: BG_W, height: BG_H, channels: 4 } }));
  const before = await sharp(bg).composite(ov(['nest', 'plank_loose'])).png().toBuffer();
  const after = await sharp(bg).composite(ov(['fence_gap'])).png().toBuffer();
  const zoom = (img, l, t, w, h, k, name) =>
    sharp(img).extract({ left: l, top: t, width: w, height: h }).resize(w * k, h * k, { kernel: 'nearest' }).png().toFile(join(PREVIEW, name));
  await zoom(before, 1440, 0, 400, 200, 2, 'nest-zoom.png');
  await zoom(before, 0, 560, 260, 320, 2, 'plank-zoom.png');
  await zoom(after, 0, 560, 260, 320, 2, 'gap-zoom.png');
  await sharp(before).resize(844).png().toFile(join(PREVIEW, 'scene844-before.png'));
  await sharp(after).resize(844).png().toFile(join(PREVIEW, 'scene844-after.png'));
  // Móvil apaisado (844×390): el fondo se ve a 390 px de alto; recorte de la mitad izquierda
  await sharp(before).resize({ height: 390 }).extract({ left: 0, top: 0, width: 844, height: 390 }).png().toFile(join(PREVIEW, 'landscape-left-before.png'));
  console.log(`  vistas previas en ${PREVIEW}`);
}

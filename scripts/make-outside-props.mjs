// A3.3f (plan SCUMM): arte por código de los props de puzle de `outside` que el fondo no dibuja (0 $, sin IA).
//
// «Lo que hace falta para un puzle tiene que VERSE»: el nido de urracas de `hs_chimney` y el tablón suelto de
// `hs_fence` no se distinguían en el fondo. Este script pinta, píxel a píxel y de forma determinista:
//   - overlay_nest.webp         nido de ramitas encima de la corona de la chimenea, con dos urracas y un brillo de papel
//                               de aluminio. Visible mientras NO está `nest_down`. A3.3h: más pequeño, solo colores del
//                               fondo, luz del atardecer, sombra de contacto, orla del fondo (sin halo) y depth 0, por
//                               debajo de las nubes del cielo (`sky_clouds`, depth 1).
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
// A3.3h: el nido de A3.3f parecía pegado (amarillo plano, contorno por todas partes, urracas blanco puro y azul que el
// fondo no tiene). Ahora: ~75 % del tamaño, SOLO colores del fondo (k-means de 20 colores del recorte de la chimenea,
// 1540–1800 × 0–300, y los dos blancos crema del fondo entero para las urracas y el aluminio), luz del atardecer desde la derecha (el lado del sol, como la cara iluminada de la
// chimenea) y sombra hacia la casa (izquierda), tramado en damero como el del cielo y el ladrillo, sombra de contacto
// sobre la corona y una orla de píxeles del propio fondo para que el filtro lineal no deje halo en el borde.
const NP = {
  a: [18, 7, 7], // contorno (el de la chimenea)
  b: [41, 15, 16], // negro de urraca / hueco del nido
  c: [71, 19, 14], // ramita en sombra
  d: [65, 30, 31], // reflejo ciruela de la cola (el «azul» de la urraca, con la paleta del fondo)
  e: [90, 34, 37], // ramita oscura
  f: [122, 52, 38], // ramita media en sombra
  g: [139, 62, 44], // ramita media
  h: [172, 88, 58], // ramita media con luz
  i: [203, 109, 69], // paja con luz
  j: [230, 153, 96], // paja muy iluminada
  k: [252, 196, 110], // brillo del sol / ojo
  v: [232, 197, 157], // blanco de urraca en sombra (el crema de las nubes del fondo)
  w: [252, 246, 212], // blanco de urraca con luz (el color más claro del fondo)
  x: [252, 246, 212], // papel de aluminio con luz
  z: [205, 174, 127], // aluminio en media luz
};
Object.assign(C, NP);
const RAMP = ['c', 'e', 'f', 'g', 'h', 'i', 'j']; // de la sombra (casa, izquierda) a la luz (sol, derecha)

// Urraca que vigila (mira a la izquierda) y urraca que picotea dentro del nido (mira a la derecha). 'W' = blanco: se
// resuelve en 'w' (con luz) o 'v' (en sombra) según el lado de la urraca que da al sol.
const MAGPIE = [
  '.aaa.....',
  'aakaa....',
  '..aab....',
  '..aWWb...',
  '..WWWWb..',
  '...WWbbb.',
  '....a.bdb',
  '.......ab',
];
const MAGPIE_PECK = [
  'bd.......',
  '.bbbWW...',
  '...bWWWa.',
  '....bWaaa',
  '......aka',
];

function putBird(g, rows, ox, oy) {
  const w = rows[0].length;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.set(ox + x, oy + y, ch === 'W' ? (x >= w / 2 - 0.5 ? 'w' : 'v') : ch);
  }));
}

/** Celdas de la sombra de contacto (debajo del cuenco), con su fuerza 0-1 */
const NEST_SHADOW = [];

function nestGrid() {
  const g = new Grid();
  const r = rng(0xa33f);
  const W = 21, cx = 10, top = 3, depth = 5;
  NEST_SHADOW.length = 0;
  for (let x = 0; x < W; x++) {
    const u = (x - cx) / (W / 2);
    const bottom = top + Math.round(depth * Math.sqrt(Math.max(0, 1 - u * u)));
    const rim = top - (x > 2 && x < W - 3 && r() < 0.3 ? 1 : 0);
    const t = x / (W - 1);
    for (let y = rim; y <= bottom; y++) {
      // Tono: luz de la derecha, el borde de arriba más claro y la panza más oscura, con ruido de ramitas y tramado
      const f = 2.2 + t * 3 + (y <= top + 1 ? 1.6 : 0) - ((y - top) / depth) * 2.4 + (r() - 0.5) * 1.4;
      let idx = Math.floor(f);
      if (f - idx > 0.5 && (x + y) % 2 === 0) idx++;
      g.set(x, y, RAMP[Math.max(0, Math.min(RAMP.length - 1, idx))]);
    }
    if (x > 0 && x < W - 1) NEST_SHADOW.push([x, bottom + 2, 1], [x, bottom + 3, 0.5]);
  }
  // Hueco del cuenco (donde se mete la urraca que picotea)
  for (let x = 5; x <= 15; x++) g.set(x, top, x < 7 || x > 13 ? 'c' : 'b');
  // Ramitas que cruzan el cuenco (vetas en diagonal, más claras del lado del sol)
  const twigs = [[1, 6, 6, 5, 'e'], [8, 7, 13, 5, 'h'], [14, 6, 19, 5, 'i'], [3, 5, 8, 7, 'c'], [12, 5, 17, 7, 'g']];
  for (const [x0, y0, x1, y1, c] of twigs) g.line(x0, y0, x1, y1, c);
  // Papel de aluminio arrugado en el borde, del lado del sol (lo que brilla; discreto)
  g.sprite(['xz', 'z.'], 11, 3); // bg ≈ (1624–1633, 40–49): el ambient `nest_foil_glint` titila ahí
  g.outline('a');
  // Ramitas sueltas que salen del borde (sin contorno: de 1 px, como las líneas finas del fondo)
  g.line(-1, 3, -3, 3, 'a');
  g.line(-1, 5, -2, 6, 'a');
  g.line(W, 3, W + 2, 2, 'a');
  g.line(4, 10, 4, 11, 'a');
  // Urracas encima del contorno del nido
  const m = new Grid();
  putBird(m, MAGPIE, 1, -4);
  putBird(m, MAGPIE_PECK, 9, -1);
  const body = new Set(m.px.keys());
  m.outline('a', 'abd');
  for (const [k, v] of m.px) if (body.has(k) || !g.px.has(k)) g.px.set(k, v);
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
const NEST_AT = { ox: 1574, oy: 26 }; // corona izquierda de la chimenea (1580–1757, y≈45–100), delante de la olla izquierda y con el cielo detrás: en vertical la derecha la tapa el botón Connect

// ── Fundido con el fondo (A3.3h) ─────────────────────────────────────────────────────────────────────────────────
const BG_RAW = await sharp(join(DIR, 'background.png')).removeAlpha().raw().toBuffer();
const PALETTE = Object.values(NP);
const nearest = (r, g, b) => {
  let best = PALETTE[0], bd = Infinity;
  for (const p of PALETTE) {
    const d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
};
const isSky = (i) => BG_RAW[i] > 180 && BG_RAW[i + 1] < 90 && BG_RAW[i + 2] > 70; // rosa del cielo: ahí no hay sombra
/**
 * Sombra de contacto: oscurece el ladrillo bajo el cuenco (el fondo × fuerza, cuantizado a la paleta, en damero la
 * fila floja) y orla de 3 px con el fondo tal cual alrededor de todo, para que el filtro lineal del juego mezcle el
 * borde con el mismo color que hay detrás (sin halo ni filo).
 */
function blendIntoBackground(buf, { ox, oy }) {
  for (const [ax, ay, k] of NEST_SHADOW) {
    const x0 = Math.round(ox + ax * PX), x1 = Math.round(ox + (ax + 1) * PX);
    const y0 = Math.round(oy + ay * PX), y1 = Math.round(oy + (ay + 1) * PX);
    if (k < 1 && (ax + ay) % 2 === 1) continue;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * BG_W + x) * 4, j = (y * BG_W + x) * 3;
      if (buf[i + 3] || isSky(j)) continue;
      const m = k < 1 ? 0.72 : 0.55;
      const c = nearest(BG_RAW[j] * m, BG_RAW[j + 1] * m, BG_RAW[j + 2] * m);
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }
  const R = 3, add = [];
  for (let y = 0; y < BG_H; y++) for (let x = 0; x < BG_W; x++) {
    if (buf[(y * BG_W + x) * 4 + 3]) continue;
    let near = false;
    for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < BG_W && yy < BG_H && buf[(yy * BG_W + xx) * 4 + 3] === 255) { near = true; break; }
    }
    if (near) add.push(y * BG_W + x);
  }
  for (const p of add) {
    buf[p * 4] = BG_RAW[p * 3]; buf[p * 4 + 1] = BG_RAW[p * 3 + 1]; buf[p * 4 + 2] = BG_RAW[p * 3 + 2]; buf[p * 4 + 3] = 255;
  }
}
const SLOT_X = 72; // tercer tablón de la valla (72–100 px), cuyo canto de arriba está en y≈700
const SLOT_Y = 698;

const OVERLAYS = [
  // depth 0: entre el fondo (-1) y las nubes del cielo (`sky_clouds`, depth 1), que pasan POR DELANTE del nido
  { id: 'nest', sprite: 'overlay_nest', flag: 'nest_down', invert: true, depth: 0, post: (buf) => blendIntoBackground(buf, NEST_AT), layers: [{ grid: nestGrid(), ...NEST_AT }] },
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
  o.post?.(buf);
  const box = contentBox(buf, BG_W, BG_H, 4);
  const out = join(DIR, `${o.sprite}.webp`);
  await sharp(buf, { raw: { width: BG_W, height: BG_H, channels: 4 } }).extract(box).webp({ lossless: true, effort: 6 }).toFile(out);
  const bounds = boxToPct(box, BG_W, BG_H);
  const entry = { id: o.id, sprite: o.sprite, format: 'webp', bounds, flag: o.flag, ...(o.invert ? { invert: true } : {}), depth: o.depth ?? 5 };
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

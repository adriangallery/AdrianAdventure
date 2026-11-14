// A3.11 (plan SCUMM): LO QUE YA COGISTE DESAPARECE DE LA ESCENA. Parches «sin objeto» pintados A PARTIR DEL FONDO.
//
// Para cada objeto que se coge y está dibujado en el fondo, este script genera `overlay_<id>.webp`: un parche que
// tapa SOLO la zona del objeto (máscara de formas en píxeles del fondo) reconstruyendo lo de detrás con los colores
// vecinos del propio `background.webp` de la escena (0 $, sin IA, determinista):
//   1. relleno «piel de cebolla»: cada píxel de la máscara toma la media de sus vecinos ya conocidos, del borde hacia
//      dentro; luego unas pasadas de suavizado (Jacobi) con el borde fijo;
//   2. cuantización a la paleta del anillo de alrededor (los píxeles del fondo a ≤ RING px de la máscara): el parche
//      solo usa colores que ya están al lado, así no queda mancha de otro tono;
//   3. alfa 255 dentro de la máscara y 0 fuera (sin halo ni borde suave), y fuera también los píxeles que quedan casi
//      iguales al fondo (Δ ≤ 12: no hacen falta y crop-overlays --check los cuenta como mancha);
//   4. recorte a su caja (scripts/lib/overlay-crop.mjs), WebP sin pérdida, y la entrada de `conditionalOverlays` del
//      scene.json (visible con la MISMA flag que oculta el hotspot) sin reformatear el resto del fichero.
// Si cambia un fondo (regla de los fondos rehechos, 14-nov), se vuelve a ejecutar y se revisa la hoja de --preview;
// después `node scripts/crop-overlays.mjs --update-lock`.
//
// Uso:  node scripts/make-picked-overlays.mjs                  genera y actualiza los scene.json
//       node scripts/make-picked-overlays.mjs --preview <dir>  además deja antes/después ampliados (para mirarlos)
//       node scripts/make-picked-overlays.mjs --only <id>      solo ese parche
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contentBox, boxToPct, replaceTopLevelKey } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PREVIEW = arg('--preview');
const ONLY = arg('--only');
const RING = 5;
const NEAR = 12;

/**
 * Parches. `shapes` en píxeles del fondo (3712×1152): { rect: [x, y, w, h] }, { ellipse: [cx, cy, rx, ry] } o
 * { key: [x, y, w, h], minLuma, grow }: dentro del rect, los píxeles claros (luma ≥ minLuma: un papel) y `grow` px
 * alrededor (su contorno). `fill` (opcional): reglas para un objeto delante de superficies conocidas, cada una
 * { x: [x0, x1], y: [y0, y1], from: 'row' | 'col', src }: 'row' copia el píxel de la fila `src` en la misma columna
 * (lo vertical sigue hacia abajo: un marco, una pared), 'col' el de la columna `src` en la misma fila (lo horizontal
 * sigue: una repisa). Lo que no cubre ninguna regla se rellena del borde hacia dentro.
 * `flag` = la flag «ya cogido» (la misma de `hideWhenFlag` del hotspot); `insertBefore` = clave de primer nivel delante
 * de la que va `conditionalOverlays` si la escena aún no tiene (cambio acotado: no se reordena nada).
 */
export const PATCHES = [
  {
    scene: 'basement',
    id: 'mouse_taken',
    hotspot: 'hs_dead_mouse',
    flag: 'found_broken_mouse',
    depth: 5,
    insertBefore: 'onEnter',
    // el ratón de la mesa, al lado del teclado (el cable se queda: el LOOK de después habla del cable colgando)
    // con su contorno negro y su sombra marrón; el contorno y el cable oscuros no siembran el relleno (ignoreDark)
    shapes: [{ ellipse: [2328, 686, 36, 26] }, { ellipse: [2347, 700, 19, 15] }, { ellipse: [2338, 707, 20, 8] }],
    ignoreDark: 100,
  },
  {
    scene: 'memelab',
    id: 'pepe_taken',
    hotspot: 'hs_pepememe',
    flag: 'found_pepememe',
    depth: 5,
    // la hoja impresa (el Rare Pepe) que asoma por encima de la impresora; el trozo que entra en la ranura se queda
    shapes: [{ key: [2925, 598, 145, 58], minLuma: 150, grow: 7 }, { rect: [2958, 600, 95, 9] }],
    ignoreDark: 60,
    // detrás: el encerado y su marco siguen hacia abajo hasta la repisa, la repisa sigue hacia la derecha hasta el
    // marco, y la pared lisa sigue hacia abajo desde encima de la hoja
    fill: [
      { x: [2900, 2931], y: [598, 640], from: 'col', src: 2918 },
      { x: [2932, 2976], y: [598, 640], from: 'row', src: 594 },
      { x: [2900, 2976], y: [641, 660], from: 'col', src: 2912 },
      { x: [2977, 3075], y: [598, 660], from: 'row', src: 594 },
    ],
  },
];

async function loadBg(scene) {
  const { data, info } = await sharp(join(ROOT, 'assets', 'scenes', scene, 'background.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function buildMask(shapes, w, h, bg) {
  const m = new Uint8Array(w * h);
  const luma = (i) => 0.299 * bg[i * 4] + 0.587 * bg[i * 4 + 1] + 0.114 * bg[i * 4 + 2];
  for (const s of shapes) {
    if (s.key) {
      const [x0, y0, rw, rh] = s.key;
      const g = s.grow ?? 0;
      const inRect = (x, y) => x >= x0 && y >= y0 && x < x0 + rw && y < y0 + rh;
      for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) {
        if (luma(y * w + x) < s.minLuma) continue;
        for (let dy = -g; dy <= g; dy++) for (let dx = -g; dx <= g; dx++) if (inRect(x + dx, y + dy)) m[(y + dy) * w + x + dx] = 1;
      }
    } else if (s.rect) {
      const [x0, y0, rw, rh] = s.rect;
      for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1;
    } else if (s.ellipse) {
      const [cx, cy, rx, ry] = s.ellipse;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) m[y * w + x] = 1;
        }
      }
    }
  }
  return m;
}

/** Rellena la máscara desde el borde con los colores del fondo; devuelve RGBA del tamaño del fondo (alfa solo en la máscara) */
export function inpaint(bg, w, h, mask, { ignoreDark = 0, fill = null } = {}) {
  const luma = (i) => 0.299 * bg[i * 4] + 0.587 * bg[i * 4 + 1] + 0.114 * bg[i * 4 + 2];
  const col = new Float32Array(w * h * 3);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) { known[i] = 1; col[i * 3] = bg[i * 4]; col[i * 3 + 1] = bg[i * 4 + 1]; col[i * 3 + 2] = bg[i * 4 + 2]; }
  }
  // caja de la máscara (para no recorrer el fondo entero)
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const N = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  // 0. reglas de `fill` (copias de filas/columnas del fondo); esos píxeles no se suavizan después
  for (const r of fill ?? []) {
    for (let y = Math.max(y0, r.y[0]); y <= Math.min(y1, r.y[1]); y++) for (let x = Math.max(x0, r.x[0]); x <= Math.min(x1, r.x[1]); x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const j = r.from === 'row' ? r.src * w + x : y * w + r.src;
      col[i * 3] = bg[j * 4]; col[i * 3 + 1] = bg[j * 4 + 1]; col[i * 3 + 2] = bg[j * 4 + 2];
      known[i] = 2;
    }
  }
  // 1. piel de cebolla
  for (;;) {
    const layer = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!mask[i] || known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of N) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (known[j] && (mask[j] || luma(j) >= ignoreDark)) { r += col[j * 3]; g += col[j * 3 + 1]; b += col[j * 3 + 2]; n++; }
      }
      if (n) layer.push([i, r / n, g / n, b / n]);
    }
    if (!layer.length) break;
    for (const [i, r, g, b] of layer) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; known[i] = 1; }
  }
  // 2. suavizado con el borde fijo
  for (let it = 0; it < 40; it++) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!mask[i] || known[i] === 2) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of N.slice(0, 4)) {
        const j = (y + dy) * w + (x + dx);
        if (!mask[j] && luma(j) < ignoreDark) continue;
        r += col[j * 3]; g += col[j * 3 + 1]; b += col[j * 3 + 2]; n++;
      }
      if (n) { col[i * 3] = r / n; col[i * 3 + 1] = g / n; col[i * 3 + 2] = b / n; }
    }
  }
  // 3. paleta del anillo
  const pal = new Map();
  for (let y = Math.max(0, y0 - RING); y <= Math.min(h - 1, y1 + RING); y++) {
    for (let x = Math.max(0, x0 - RING); x <= Math.min(w - 1, x1 + RING); x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      let near = false;
      for (let dy = -RING; dy <= RING && !near; dy++) for (let dx = -RING; dx <= RING; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) { near = true; break; }
      }
      if (near && luma(i) >= ignoreDark) pal.set((bg[i * 4] << 16) | (bg[i * 4 + 1] << 8) | bg[i * 4 + 2], [bg[i * 4], bg[i * 4 + 1], bg[i * 4 + 2]]);
    }
  }
  const palette = [...pal.values()];
  const out = Buffer.alloc(w * h * 4);
  let opaque = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    const r = col[i * 3], g = col[i * 3 + 1], b = col[i * 3 + 2];
    let best = palette[0], bd = Infinity;
    if (known[i] === 2) best = [r, g, b]; // copia de una regla: ya es un color del fondo
    else for (const p of palette) { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; best = p; } }
    const delta = Math.max(Math.abs(best[0] - bg[i * 4]), Math.abs(best[1] - bg[i * 4 + 1]), Math.abs(best[2] - bg[i * 4 + 2]));
    if (delta <= NEAR) continue; // casi igual al fondo: no hace falta (y contaría como mancha)
    out[i * 4] = best[0]; out[i * 4 + 1] = best[1]; out[i * 4 + 2] = best[2]; out[i * 4 + 3] = 255;
    opaque++;
  }
  return { rgba: out, opaque, palette: palette.length };
}

/** Inserta o sustituye la entrada `id` de `conditionalOverlays` sin tocar el resto del scene.json */
function upsertOverlay(text, entry, insertBefore) {
  const scene = JSON.parse(text);
  if (scene.conditionalOverlays) {
    const list = scene.conditionalOverlays.filter((co) => co.id !== entry.id).concat([entry]);
    return replaceTopLevelKey(text, 'conditionalOverlays', list);
  }
  const re = new RegExp(`\\n([ \\t]*)"${insertBefore}"\\s*:`, 'g');
  let m;
  while ((m = re.exec(text)) && depthAt(text, m.index) !== 1);
  if (!m) throw new Error(`no encuentro «${insertBefore}» para insertar conditionalOverlays`);
  const indent = m[1];
  const json = JSON.stringify([entry], null, 2).replace(/\n/g, `\n${indent}`);
  return `${text.slice(0, m.index)}\n${indent}"conditionalOverlays": ${json},${text.slice(m.index)}`;
}

/** Profundidad de llaves/corchetes en `pos` (fuera de strings): 1 = clave de primer nivel */
function depthAt(text, pos) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < pos; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth;
}

async function main() {
  if (PREVIEW) mkdirSync(PREVIEW, { recursive: true });
  const bgs = new Map();
  for (const p of PATCHES) {
    if (ONLY && p.id !== ONLY) continue;
    if (!bgs.has(p.scene)) bgs.set(p.scene, await loadBg(p.scene));
    const { data: bg, w, h } = bgs.get(p.scene);
    const mask = buildMask(p.shapes, w, h, bg);
    const { rgba, opaque, palette } = inpaint(bg, w, h, mask, { ignoreDark: p.ignoreDark ?? 0, fill: p.fill });
    const box = contentBox(rgba, w, h, 4);
    if (!box) throw new Error(`${p.scene}/${p.id}: el parche ha quedado vacío`);
    const dir = join(ROOT, 'assets', 'scenes', p.scene);
    const file = join(dir, `overlay_${p.id}.webp`);
    await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract(box).webp({ lossless: true }).toFile(file);
    const sceneFile = join(dir, 'scene.json');
    const entry = { id: p.id, sprite: `overlay_${p.id}`, format: 'webp', bounds: boxToPct(box, w, h), flag: p.flag, depth: p.depth ?? 5 };
    writeFileSync(sceneFile, upsertOverlay(readFileSync(sceneFile, 'utf8'), entry, p.insertBefore ?? 'ambient'));
    console.log(`${p.scene}/${p.id}: ${opaque} px opacos, paleta de ${palette} colores, caja ${box.width}×${box.height} en ${box.left},${box.top}`);
    if (PREVIEW) {
      const pad = 40;
      const L = Math.max(0, box.left - pad), T = Math.max(0, box.top - pad);
      const W = Math.min(w - L, box.width + 2 * pad), H = Math.min(h - T, box.height + 2 * pad);
      const scale = Math.max(1, Math.floor(600 / W));
      const before = await sharp(bg, { raw: { width: w, height: h, channels: 4 } }).extract({ left: L, top: T, width: W, height: H }).png().toBuffer();
      const patch = await sharp(file).png().toBuffer();
      const after = await sharp(before).composite([{ input: patch, left: box.left - L, top: box.top - T }]).png().toBuffer();
      for (const [name, buf] of [['antes', before], ['despues', after]]) {
        await sharp(buf).resize({ width: W * scale, kernel: 'nearest' }).toFile(join(PREVIEW, `${p.scene}-${p.id}-${name}.png`));
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

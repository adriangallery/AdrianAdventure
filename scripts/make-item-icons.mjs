#!/usr/bin/env node
// A3.3c (plan SCUMM): iconos de inventario del PIN partido, reproducibles y sin dependencias (Node puro: zlib).
//
//   node scripts/make-item-icons.mjs [--root <dir>]
//
// Escribe en assets/sprites/items/ (128×128 RGBA, como los otros 28 iconos; el arte se dibuja en una rejilla de
// 64×64 y se escala ×2 con vecino más próximo donde es dibujo propio):
//   note_half_a.png  mitad izquierda de code_note.png («73»), con el borde derecho rasgado
//   note_half_b.png  mitad derecha («14»), con el borde izquierdo rasgado y envuelta en papel de aluminio
//   fence_plank.png  un tablón de valla en diagonal: vetas, un clavo torcido y el extremo partido
// Sin arte de pago: las mitades salen de code_note.png y el tablón se dibuja aquí. Determinista (sin azar).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argRoot = process.argv.indexOf('--root');
const root = argRoot > 0 ? path.resolve(process.argv[argRoot + 1]) : path.resolve(here, '..');
const ITEMS = path.join(root, 'assets', 'sprites', 'items');
const SIZE = 128;

// ── PNG mínimo (8 bits, RGBA, sin entrelazar) ──
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es un PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || colorType !== 6 || interlace !== 0) throw new Error(`PNG no soportado (depth ${depth}, color ${colorType}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

export function encodePng({ width, height, data }) {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Lienzo ──
const blank = (w = SIZE, h = SIZE) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4) });
const get = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
const set = (img, x, y, [r, g, b, a = 255]) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
};
/** Pinta `src` sobre `dst` desplazado (dx, dy), con alfa «over». */
function over(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const [r, g, b, a] = get(src, x, y);
    if (a === 0) continue;
    if (a === 255) { set(dst, x + dx, y + dy, [r, g, b, 255]); continue; }
    const [R, G, B, A] = get(dst, x + dx, y + dy);
    const oa = a + (A * (255 - a)) / 255;
    const mix = (s, d) => Math.round((s * a + (d * A * (255 - a)) / 255) / (oa || 1));
    set(dst, x + dx, y + dy, [mix(r, R), mix(g, G), mix(b, B), Math.round(oa)]);
  }
}
/** Escala ×2 con vecino más próximo (rejilla de 64 → icono de 128). */
function up2(img) {
  const out = blank(img.width * 2, img.height * 2);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) set(out, x, y, get(img, x >> 1, y >> 1));
  return out;
}

const OUTLINE = [4, 4, 2, 255];
// Rasgado: desplazamiento del borde por tramos de 4 px (determinista)
const TEAR = [0, 1, -1, 1, -2, 0, 1, -1, 0, -2, 1, 0, -1, 1, -2, 0];
const SPLIT = 69; // (con el rasgado, 67-70) entre «73» (x 24-66) y «14» (x 72-104) de code_note.png

/** Mitad de la nota: `side` 'a' = izquierda (se queda con x < corte), 'b' = derecha. Borde rasgado con contorno. */
function noteHalf(note, side) {
  const out = blank(note.width, note.height);
  const cut = (y) => SPLIT + TEAR[(y >> 2) % TEAR.length];
  for (let y = 0; y < note.height; y++) for (let x = 0; x < note.width; x++) {
    const keep = side === 'a' ? x < cut(y) : x >= cut(y);
    if (keep) set(out, x, y, get(note, x, y));
  }
  // Contorno del rasgado: el píxel del borde que queda dentro del papel, y el de al lado en el escalón
  for (let y = 0; y < note.height; y++) {
    const c = cut(y);
    const edge = side === 'a' ? c - 1 : c;
    if (get(out, edge, y)[3] > 0) set(out, edge, y, OUTLINE);
    const prev = y > 0 ? cut(y - 1) : c;
    if (prev !== c) {
      const lo = Math.min(prev, c), hi = Math.max(prev, c);
      for (let x = lo; x < hi; x++) {
        const xx = side === 'a' ? x - 1 : x;
        if (get(out, xx, y)[3] > 0) set(out, xx, y, OUTLINE);
      }
    }
  }
  return out;
}

/** Recorta al rectángulo con alfa y centra en un lienzo de SIZE. */
function centered(img, offX = 0, offY = 0) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (get(img, x, y)[3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const out = blank();
  const dx = Math.round((SIZE - (x1 - x0 + 1)) / 2) - x0 + offX;
  const dy = Math.round((SIZE - (y1 - y0 + 1)) / 2) - y0 + offY;
  over(out, img, dx, dy);
  return { img: out, box: { x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy } };
}

/** Papel de aluminio arrugado (rejilla de 64) detrás y en dos esquinas de la mitad B. */
function foil(box) {
  const g = blank(64, 64);
  const shades = [[222, 226, 232], [196, 201, 210], [168, 174, 185], [238, 241, 245], [150, 156, 168]];
  const OUT = [70, 74, 84];
  const inBack = (x, y) => {
    // Rombo achatado más grande que la nota, con bordes irregulares
    const cx = (box.x0 + box.x1) / 4, cy = (box.y0 + box.y1) / 4;
    const w = (box.x1 - box.x0) / 4 + 5 + ((y * 7) % 3), h = (box.y1 - box.y0) / 4 + 4 + ((x * 5) % 3);
    return Math.abs(x - cx) / w + Math.abs(y - cy) / h <= 1.18 && Math.abs(x - cx) <= w && Math.abs(y - cy) <= h;
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inBack(x, y)) continue;
    const s = shades[((x >> 1) * 3 + (y >> 1) * 2 + (((x >> 2) ^ (y >> 2)) & 1)) % shades.length];
    set(g, x, y, s);
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inBack(x, y)) continue;
    if (!inBack(x - 1, y) || !inBack(x + 1, y) || !inBack(x, y - 1) || !inBack(x, y + 1)) set(g, x, y, OUT);
  }
  // Pliegues que tapan dos esquinas de la nota (arriba a la izquierda y abajo a la derecha)
  const front = blank(64, 64);
  const corner = (cx, cy, dirX, dirY) => {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9 - i; j++) {
      const x = cx + dirX * i, y = cy + dirY * j;
      const edge = j === 8 - i || i === 0 || j === 0;
      set(front, x, y, edge ? OUT : shades[(i * 2 + j) % 4]);
    }
  };
  corner(Math.floor(box.x0 / 2) - 1, Math.floor(box.y0 / 2) - 1, 1, 1);
  corner(Math.ceil(box.x1 / 2) + 1, Math.ceil(box.y1 / 2) + 1, -1, -1);
  return { back: up2(g), front: up2(front) };
}

/** Tablón en diagonal en una rejilla de 64, escalado ×2. */
function plank() {
  const g = blank(64, 64);
  const cx = 32, cy = 33, ang = -Math.PI / 4;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const L = 30, W = 8.5;
  const WOOD = [[176, 116, 64], [158, 102, 54], [192, 132, 78], [140, 88, 46]];
  const OUT = [52, 30, 16];
  const broken = (v) => [0, 2, 1, 3, 1, 0, 2, 3, 1, 2, 0, 1, 2, 3][Math.round(v + 9) % 14];
  const inside = (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    if (Math.abs(v) > W) return null;
    if (u < -L) return null;
    if (u > L - broken(v)) return null; // extremo partido (arriba a la derecha)
    return { u, v };
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const p = inside(x, y);
    if (!p) continue;
    // Vetas: bandas a lo largo del tablón, con nudo
    const band = Math.floor((p.v + 9) / 1.5);
    let c = WOOD[(band + (Math.floor((p.u + 30) / 9) % 2)) % 3];
    if (band % 3 === 0) c = WOOD[3];
    const kx = p.u + 9, ky = p.v - 1.5;
    if (kx * kx / 6 + ky * ky / 2 < 1.2) c = [110, 66, 32];
    set(g, x, y, c);
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) set(g, x, y, OUT);
  }
  // Clavo torcido en el extremo de abajo a la izquierda
  const nu = -L + 5, nx = Math.round(cx + nu * cos), ny = Math.round(cy + nu * sin);
  for (const [x, y, col] of [
    [nx, ny, [60, 62, 70]], [nx + 1, ny, [120, 124, 134]], [nx, ny + 1, [120, 124, 134]], [nx + 1, ny + 1, [190, 194, 204]],
    [nx - 1, ny - 1, [90, 94, 104]], [nx - 2, ny - 2, [90, 94, 104]], [nx - 2, ny - 3, [150, 154, 164]],
  ]) set(g, x, y, col);
  return up2(g);
}

function main() {
  const note = decodePng(fs.readFileSync(path.join(ITEMS, 'code_note.png')));
  if (note.width !== SIZE || note.height !== SIZE) throw new Error(`code_note.png mide ${note.width}x${note.height}, se esperaba ${SIZE}`);

  const a = centered(noteHalf(note, 'a'));
  const bHalf = centered(noteHalf(note, 'b'));
  const f = foil(bHalf.box);
  const b = blank();
  over(b, f.back, 0, 0);
  over(b, bHalf.img, 0, 0);
  over(b, f.front, 0, 0);

  const outs = { note_half_a: a.img, note_half_b: b, fence_plank: plank() };
  for (const [id, img] of Object.entries(outs)) {
    const file = path.join(ITEMS, `${id}.png`);
    fs.writeFileSync(file, encodePng(img));
    console.log(`${path.relative(root, file)} ${img.width}x${img.height}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

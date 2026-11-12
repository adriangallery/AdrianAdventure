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
//   vet_bill.png     (A3.3d) la factura del veterinario de Gerald: receipt.png teñido de verde menta con un sello de huella
//   leaky_pen.png    (A3.4a) el boli de Mt. Gox del abrigo de Adrian: en diagonal, con la punta goteando tinta azul
//   pizza_slice.png  (A3.4b) una porción de la pizza fosilizada de upstairs: pepperoni, brillos de grasa y una gota
//   empty_can.png    (A3.4d) energy_drink.png (69×128, centrado en 128×128) desaturado y abollado: la lata que se bebió el mining rig
//   rainwater_can.png (A3.4d) energy_drink.png teñido de azul con gotas: la lata llena de lluvia de la parabólica
//   extension_cord.png (A3.5a) el alargador naranja del suelo técnico de server_room: un rollo de cable y el enchufe
//   scrap_paper.png  (A3.5a) el papel en blanco de la mesa del sótano: arrugado, con el borde de arriba rasgado
//   fake_alpha.png   (A3.5b) scrap_paper.png con garabatos de tinta azul («BUY $GERALD. TRUST ME.») y una mancha del boli
//   marked_map.png   (A3.5c) printout.png con una X de tinta azul encima: el mapa marcado
//   patient_wristband.png (A3.6a) pulsera de paciente de la clínica: banda blanca en anillo, etiqueta lila y cierre
//   sobriety_chip.png (A3.6e) la ficha de sobriedad de Chad: moneda de bronce con un «0» grabado
// Sin arte de pago: las mitades salen de code_note.png, la factura de receipt.png y el tablón se dibuja aquí.
// Determinista (sin azar).
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

/**
 * A3.3d: la factura del veterinario de Gerald = receipt.png teñido de papel clínico (verde menta) con un sello rojo
 * de huella (cuatro dedos y almohadilla) abajo a la derecha. El contorno oscuro del recibo se respeta.
 */
function vetBill(receipt) {
  const out = blank(receipt.width, receipt.height);
  for (let y = 0; y < receipt.height; y++) for (let x = 0; x < receipt.width; x++) {
    const [r, g, b, a] = get(receipt, x, y);
    if (a === 0) continue;
    const lum = (r + g + b) / 3;
    if (lum < 70) { set(out, x, y, [r, g, b, a]); continue; } // contorno y tinta
    // Papel: hacia verde menta, conservando el sombreado del recibo
    const k = lum / 255;
    set(out, x, y, [Math.round(150 + 95 * k), Math.round(205 + 50 * k), Math.round(170 + 70 * k), a]);
  }
  const RED = [196, 40, 48, 255], DARK = [120, 18, 24, 255];
  const stamp = (cx, cy, rx, ry) => {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1 && get(out, x, y)[3] > 0) set(out, x, y, d > 0.62 ? DARK : RED);
    }
  };
  // Huella: almohadilla y cuatro dedos (rejilla de 128, abajo a la derecha, sobre la zona del precio)
  stamp(92, 104, 9, 7);
  stamp(79, 92, 4, 5); stamp(88, 87, 4, 5); stamp(97, 87, 4, 5); stamp(106, 92, 4, 5);
  return out;
}

/**
 * A3.4a: el boli de Mt. Gox (rejilla de 64, ×2). Cuerpo en diagonal (punta abajo a la izquierda), anilla dorada,
 * banda roja con tres rayas blancas (el logo del exchange, sin letras), clip, y tres gotas de tinta bajo la punta.
 */
function leakyPen() {
  const g = blank(64, 64);
  const cx = 33, cy = 30, ang = -Math.PI / 4;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const L = 25, W = 3.6;
  const OUT = [20, 22, 40];
  const at = (u, v) => [Math.round(cx + u * cos - v * sin), Math.round(cy + u * sin + v * cos)];
  const inside = (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    if (u < -L || u > L) return null;
    // la punta se estrecha en los últimos 7 px
    const w = u < -L + 7 ? W * (u + L) / 7 : W;
    if (Math.abs(v) > Math.max(w, 0.6)) return null;
    return { u, v };
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const p = inside(x, y);
    if (!p) continue;
    let c;
    if (p.u < -L + 7) c = p.u < -L + 3 ? [40, 60, 150] : [196, 198, 206]; // punta manchada de tinta y cono metálico
    else if (p.u < -L + 9) c = [212, 170, 60]; // anilla dorada
    else if (p.u > 4 && p.u < 14) c = Math.abs(Math.round(p.u) % 3) === 0 ? [240, 240, 236] : [200, 36, 44]; // banda
    else c = p.v < -1.2 ? [70, 96, 196] : p.v > 1.6 ? [28, 44, 120] : [46, 68, 160]; // cuerpo azul con brillo
    set(g, x, y, c);
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) set(g, x, y, OUT);
  }
  // Clip plateado a lo largo del capuchón
  for (let u = L - 12; u <= L - 2; u++) { const [x, y] = at(u, -W - 1); set(g, x, y, [170, 174, 186]); set(g, x + 1, y + 1, OUT); }
  // Gotas de tinta bajo la punta (cada vez más abajo)
  const [tx, ty] = at(-L, 0);
  const INK = [36, 54, 150], HI = [120, 150, 240];
  const drop = (x, y, r) => {
    for (let yy = -r - 1; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const yy2 = yy < 0 ? yy * r / (r + 1) : yy; // forma de lágrima: más estrecha arriba
      if (xx * xx + yy2 * yy2 <= r * r + 0.5) set(g, x + xx, y + yy, OUT);
    }
    for (let yy = -r; yy < r; yy++) for (let xx = -r + 1; xx < r; xx++) {
      if (xx * xx + yy * yy <= (r - 1) * (r - 1) + 0.5) set(g, x + xx, y + yy, INK);
    }
    set(g, x - 1, y - 1, HI);
  };
  drop(tx, ty + 6, 2);
  drop(tx + 1, ty + 13, 3);
  // charco
  for (let x = tx - 6; x <= tx + 8; x++) for (let y = ty + 19; y <= ty + 21; y++) {
    const d = Math.abs(x - tx - 1) / 7 + Math.abs(y - ty - 20) / 1.6;
    if (d <= 1) set(g, x, y, d > 0.75 ? OUT : INK);
  }
  return up2(g);
}

/**
 * A3.4b: una porción de la pizza fosilizada de upstairs (rejilla de 64, ×2). Triángulo con la punta abajo, borde de
 * corteza arriba, queso con tres rodajas de pepperoni y brillos de grasa (la que engrasa la veleta), y una gota.
 */
function pizzaSlice() {
  const g = blank(64, 64);
  const OUT = [30, 18, 8];
  const top = 12, tip = 54, half = 22, cx = 32;
  const inside = (x, y) => {
    const fy = y + 0.5;
    if (fy < top || fy > tip) return false;
    const w = half * (tip - fy) / (tip - top);
    return Math.abs(x + 0.5 - cx) <= w;
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inside(x, y)) continue;
    let c;
    if (y < top + 5) c = y < top + 2 ? [214, 150, 70] : [176, 108, 44]; // corteza
    else c = (x * 7 + y * 3) % 11 === 0 ? [236, 196, 70] : [246, 214, 96]; // queso con grumos
    set(g, x, y, c);
  }
  const PEP = [178, 40, 34], PEPD = [130, 24, 22];
  for (const [px, py, r] of [[26, 22, 4], [38, 25, 4], [31, 36, 3]]) {
    for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d <= r * r && inside(x, y)) set(g, x, y, d >= (r - 1) * (r - 1) ? PEPD : PEP);
    }
  }
  // brillos de grasa (blanco amarillento, en diagonal)
  for (const [x, y] of [[22, 19], [23, 20], [35, 31], [36, 32], [28, 43], [44, 19], [45, 20]]) if (inside(x, y)) set(g, x, y, [255, 250, 210]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) set(g, x, y, OUT);
  }
  // una gota de grasa bajo la punta
  for (const [x, y, c] of [[32, 56, OUT], [31, 57, OUT], [32, 57, [250, 222, 120]], [33, 57, OUT], [31, 58, OUT], [32, 58, [250, 222, 120]], [33, 58, OUT], [32, 59, OUT]]) set(g, x, y, c);
  return up2(g);
}

/**
 * A3.4d: la lata de BULL RUN después del mining rig (gris, sin brillo: vacía) y llena de lluvia de la parabólica
 * (teñida de azul, con tres gotas cayendo). Las dos salen de energy_drink.png (más estrecho: se centra en el lienzo de 128).
 */
function canVariant(can, kind) {
  const out = blank(SIZE, SIZE);
  const ox = Math.floor((SIZE - can.width) / 2), oy = Math.floor((SIZE - can.height) / 2);
  for (let y = 0; y < can.height; y++) for (let x = 0; x < can.width; x++) {
    const [r, g, b, a] = get(can, x, y);
    if (a === 0) continue;
    const lum = (r + g + b) / 3;
    if (lum < 50) { set(out, x + ox, y + oy, [r, g, b, a]); continue; } // contorno
    const k = lum / 255;
    if (kind === 'empty') {
      const v = Math.round(70 + 120 * k);
      set(out, x + ox, y + oy, [v, v, Math.min(255, v + 6), a]);
    } else {
      set(out, x + ox, y + oy, [Math.round(40 + 70 * k), Math.round(110 + 90 * k), Math.round(170 + 85 * k), a]);
    }
  }
  if (kind === 'rain') {
    const DROP = [120, 200, 255, 255], EDGE = [20, 60, 110, 255];
    for (const [cx, cy] of [[24, 18], [104, 30], [100, 70]]) {
      for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const dy = (y - cy) / 4, dx = (x - cx) / (3 * Math.max(0.2, (dy + 1) / 2));
        const d = dx * dx + dy * dy;
        if (d <= 1) set(out, x, y, d > 0.55 ? EDGE : DROP);
      }
    }
  }
  return out;
}

// A3.5: iconos del capítulo 3 (se insertan en make-item-icons.mjs antes de main)
function scrapPaper() {
  const g = blank(64, 64);
  const OUT = [40, 38, 30];
  // papel algo torcido con borde rasgado arriba
  const inside = (x, y) => {
    const top = 14 + ((x * 7) % 5 === 0 ? 2 : (x % 3)), bot = 50 - Math.floor(x / 16);
    return x >= 12 && x <= 51 && y >= top && y <= bot;
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const crease = Math.abs(x - y) < 1 || Math.abs(x + y - 70) < 1;
    set(g, x, y, edge ? OUT : crease ? [214, 208, 186] : [242, 238, 222]);
  }
  return up2(g);
}
function extensionCord() {
  const g = blank(64, 64);
  const OUT = [40, 20, 6], OR = [240, 120, 30], HI = [255, 176, 90];
  // rollo de cable: tres anillos
  for (const [cx, cy, r] of [[28, 34, 15], [28, 34, 11], [28, 34, 7]]) {
    for (let a = 0; a < 720; a++) {
      const t = (a / 720) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(t)), y = Math.round(cy + r * 0.8 * Math.sin(t));
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) if (get(g, x + dx, y + dy)[3] === 0) set(g, x + dx, y + dy, OUT);
    }
  }
  for (const [cx, cy, r] of [[28, 34, 15], [28, 34, 11], [28, 34, 7]]) {
    for (let a = 0; a < 720; a++) {
      const t = (a / 720) * Math.PI * 2;
      set(g, Math.round(cx + r * Math.cos(t)), Math.round(cy + r * 0.8 * Math.sin(t)), Math.sin(t) < -0.5 ? HI : OR);
    }
  }
  // cola de cable hasta el enchufe
  for (let x = 43; x <= 50; x++) { set(g, x, 33, OUT); set(g, x, 34, OR); set(g, x, 35, OUT); }
  // enchufe blanco con dos patas
  for (let y = 28; y <= 40; y++) for (let x = 50; x <= 57; x++) {
    const e = y === 28 || y === 40 || x === 50 || x === 57;
    set(g, x, y, e ? OUT : [232, 230, 222]);
  }
  for (const py of [31, 37]) for (let x = 58; x <= 61; x++) { set(g, x, py, [180, 170, 120]); set(g, x, py + 1, OUT); }
  return up2(g);
}
function inkOn(base, rows, color = [40, 60, 170]) {
  const out = blank(base.width, base.height);
  over(out, base, 0, 0);
  // garabatos de tinta en filas (solo sobre el papel)
  for (const [y0, x0, x1] of rows) {
    for (let x = x0; x <= x1; x++) {
      const y = y0 + Math.round(2 * Math.sin(x / 2.3));
      for (const dy of [0, 1]) if (get(out, x, y + dy)[3] > 0) set(out, x, y + dy, color);
    }
  }
  return out;
}
function fakeAlpha(paper) {
  // el papel en blanco con «BUY $GERALD. TRUST ME.» garabateado y una mancha del boli
  const out = inkOn(paper, [[40, 34, 92], [56, 30, 98], [72, 38, 86]]);
  for (let y = 84; y <= 96; y++) for (let x = 70; x <= 84; x++) {
    const d = ((x - 77) / 7) ** 2 + ((y - 90) / 6) ** 2;
    if (d <= 1 && get(out, x, y)[3] > 0) set(out, x, y, d > 0.6 ? [20, 30, 100] : [46, 68, 160]);
  }
  return out;
}
function markedMap(printout) {
  const out = blank(printout.width, printout.height);
  over(out, printout, 0, 0);
  // una X gruesa de tinta azul en el centro del mapa (con contorno oscuro)
  const cx = 64, cy = 66, R = 16;
  for (const pass of [0, 1]) for (let t = -R; t <= R; t++) for (const s of [1, -1]) {
    const x = cx + t, y = cy + s * t;
    const w = pass === 0 ? 4 : 2;
    for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > w) continue;
      set(out, x + dx, y + dy, pass === 0 ? [18, 26, 90] : [60, 92, 214]);
    }
  }
  return out;
}

// A3.6a: pulsera de paciente (banda blanca en anillo visto en perspectiva, etiqueta lila de la clínica y cierre)
function patientWristband() {
  const g = blank(64, 64);
  const OUT = [30, 26, 46], W = [236, 236, 244], SH = [184, 184, 200], LAB = [200, 180, 255], INK = [70, 50, 120];
  const cx = 32, cy = 34, rx = 22, ry = 12, th = 5;
  const inBand = (x, y) => {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    const dxi = (x + 0.5 - cx) / (rx - th), dyi = (y + 0.5 - cy) / (ry - th * 0.55);
    return d <= 1 && Math.sqrt(dxi * dxi + dyi * dyi) >= 1;
  };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (inBand(x, y)) set(g, x, y, y < cy ? SH : W);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!inBand(x, y)) continue;
    if (!inBand(x - 1, y) || !inBand(x + 1, y) || !inBand(x, y - 1) || !inBand(x, y + 1)) set(g, x, y, OUT);
  }
  // etiqueta delante (abajo) con dos renglones de «tinta»
  for (let y = 40; y < 50; y++) for (let x = 24; x < 41; x++) set(g, x, y, x === 24 || x === 40 || y === 40 || y === 49 ? OUT : LAB);
  for (const [y, x0, x1] of [[43, 27, 38], [46, 27, 34]]) for (let x = x0; x <= x1; x++) set(g, x, y, INK);
  // cierre a la izquierda
  for (let y = 30; y < 38; y++) for (let x = 9; x < 14; x++) set(g, x, y, x === 9 || x === 13 || y === 30 || y === 37 ? OUT : [150, 150, 170]);
  return up2(g);
}

// A3.6e: ficha de sobriedad (moneda de bronce con canto, un «0» grabado y un brillo)
function sobrietyChip() {
  const g = blank(64, 64);
  const OUT = [50, 30, 10], BR = [184, 120, 56], DK = [130, 80, 34], HI = [236, 190, 120];
  const cx = 32, cy = 32, r = 22;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > r) continue;
    let c = d > r - 1.2 ? OUT : d > r - 4 ? DK : BR;
    if (d <= r - 4 && x + y < 46) c = HI.map((v, i) => Math.round((v + BR[i]) / 2));
    set(g, x, y, c);
  }
  // «0» grabado
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = (x + 0.5 - cx) / 7, dy = (y + 0.5 - cy) / 11;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 1 && d >= 0.62) set(g, x, y, OUT);
  }
  for (let i = 0; i < 4; i++) set(g, 20 + i, 18 - i, [255, 240, 200]);
  return up2(g);
}

function main() {
  const note = decodePng(fs.readFileSync(path.join(ITEMS, 'code_note.png')));
  const receipt = decodePng(fs.readFileSync(path.join(ITEMS, 'receipt.png')));
  if (receipt.width !== SIZE || receipt.height !== SIZE) throw new Error(`receipt.png mide ${receipt.width}x${receipt.height}, se esperaba ${SIZE}`);
  if (note.width !== SIZE || note.height !== SIZE) throw new Error(`code_note.png mide ${note.width}x${note.height}, se esperaba ${SIZE}`);

  const a = centered(noteHalf(note, 'a'));
  const bHalf = centered(noteHalf(note, 'b'));
  const f = foil(bHalf.box);
  const b = blank();
  over(b, f.back, 0, 0);
  over(b, bHalf.img, 0, 0);
  over(b, f.front, 0, 0);

  const can = decodePng(fs.readFileSync(path.join(ITEMS, 'energy_drink.png')));
  if (can.width > SIZE || can.height > SIZE) throw new Error(`energy_drink.png mide ${can.width}x${can.height}, más de ${SIZE}`);
  const printout = decodePng(fs.readFileSync(path.join(ITEMS, 'printout.png')));
  const scrap = scrapPaper();
  const outs = { note_half_a: a.img, note_half_b: b, fence_plank: plank(), vet_bill: vetBill(receipt), leaky_pen: leakyPen(), pizza_slice: pizzaSlice(), empty_can: canVariant(can, 'empty'), rainwater_can: canVariant(can, 'rain'),
    extension_cord: extensionCord(), scrap_paper: scrap, fake_alpha: fakeAlpha(scrap), marked_map: markedMap(printout),
    patient_wristband: patientWristband(), sobriety_chip: sobrietyChip() };
  for (const [id, img] of Object.entries(outs)) {
    const file = path.join(ITEMS, `${id}.png`);
    fs.writeFileSync(file, encodePng(img));
    console.log(`${path.relative(root, file)} ${img.width}x${img.height}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

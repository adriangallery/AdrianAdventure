// A9.16 (plan SCUMM): la veleta volteada de rooftop. Compone background.webp + vane_flipped.webp (con sharp) y
// comprueba que el overlay solo cambia la veleta: fuera de su silueta (lo que no es cielo en el fondo o en el estado
// volteado, engordado 6 px) la diferencia con el fondo es 0, no hay píxeles opacos que no cambien nada, el alfa es 0 o
// 255, el WebP es sin pérdida y no llega a la rosa de los vientos. node --test tests/vane-overlay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pctToBox } from '../scripts/lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'scenes', 'rooftop');
const sharp = (await import('sharp').catch(() => null))?.default ?? null;
const ROSE_TOP_PCT = (155 / 490) * 100; // make-rooftop-bg.py ROSE[1] en la franja de 490 px
const DILATE = 6; // px del maestro: el anillo de halo del JPEG que se borra (2 px de la franja × 2,7)

// mismo criterio que is_sky() de scripts/make-rooftop-bg.py
const isSky = (r, g, b) => b - r >= 50 && r + g + b >= 250 && r + g + b <= 480;

test('vane_flipped.webp es WebP sin pérdida (VP8L)', () => {
  const buf = readFileSync(join(DIR, 'vane_flipped.webp'));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.ok(buf.includes(Buffer.from('VP8L')), 'lleva un trozo VP8L');
  assert.ok(!buf.includes(Buffer.from('VP8 ')), 'no lleva un trozo VP8 con pérdida');
});

test('fondo + vane_flipped solo cambia la silueta de la veleta, sin píxeles inútiles', { skip: !sharp && 'sin sharp (npm ci)' }, async () => {
  const scene = JSON.parse(readFileSync(join(DIR, 'scene.json'), 'utf8'));
  const co = scene.conditionalOverlays.find((o) => o.id === 'vane_flipped');
  const bg = await sharp(join(DIR, 'background.webp')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ov = await sharp(join(DIR, 'vane_flipped.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = bg.info.width, H = bg.info.height, ow = ov.info.width, oh = ov.info.height;
  const box = pctToBox(co.bounds, W, H);
  assert.equal(box.width, ow);
  assert.equal(box.height, oh);
  assert.ok(co.bounds.y + co.bounds.h <= ROSE_TOP_PCT + 0.01, `acaba en ${co.bounds.y + co.bounds.h} %, encima de la rosa (${ROSE_TOP_PCT.toFixed(2)} %)`);

  // marco de trabajo: la caja del overlay más un borde
  const M = 8, fx0 = box.left - M, fy0 = box.top - M, fw = ow + 2 * M, fh = oh + 2 * M;
  const sil = new Uint8Array(fw * fh);
  let changed = 0, useless = 0, semi = 0, outside = 0;
  const comp = (x, y) => { // píxel compuesto en coordenadas del fondo
    const b = (y * W + x) * 3;
    const ox = x - box.left, oy = y - box.top;
    if (ox >= 0 && oy >= 0 && ox < ow && oy < oh) {
      const o = (oy * ow + ox) * 4;
      if (ov.data[o + 3] === 255) return [ov.data[o], ov.data[o + 1], ov.data[o + 2]];
    }
    return [bg.data[b], bg.data[b + 1], bg.data[b + 2]];
  };
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const gx = fx0 + x, gy = fy0 + y, b = (gy * W + gx) * 3;
      const c = comp(gx, gy);
      if (!isSky(bg.data[b], bg.data[b + 1], bg.data[b + 2]) || !isSky(c[0], c[1], c[2])) {
        for (let dy = -DILATE; dy <= DILATE; dy++) {
          for (let dx = -DILATE; dx <= DILATE; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < fw && yy < fh) sil[yy * fw + xx] = 1;
          }
        }
      }
    }
  }
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const o = (oy * ow + ox) * 4, a = ov.data[o + 3];
      if (a === 0) continue;
      if (a !== 255) { semi++; continue; }
      const gx = box.left + ox, gy = box.top + oy, b = (gy * W + gx) * 3;
      const same = ov.data[o] === bg.data[b] && ov.data[o + 1] === bg.data[b + 1] && ov.data[o + 2] === bg.data[b + 2];
      if (same) { useless++; continue; }
      changed++;
      if (!sil[(gy - fy0) * fw + (gx - fx0)]) outside++;
    }
  }
  assert.equal(semi, 0, 'alfa 0 o 255, sin semitransparentes');
  assert.equal(useless, 0, 'ningún píxel opaco igual al fondo');
  assert.ok(changed > 5000, `cambia la B y la flecha (${changed} px)`);
  assert.equal(outside, 0, `fuera de la silueta de la veleta (engordada ${DILATE} px) no cambia nada (${outside} px)`);
});

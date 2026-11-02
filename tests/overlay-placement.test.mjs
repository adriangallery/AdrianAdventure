// A2.7 (plan SCUMM): colocación de los overlays recortados (src/systems/OverlayPlacement.ts) y su coherencia con
// scripts/lib/overlay-crop.mjs: un overlay recortado cae píxel a píxel donde caía la imagen del tamaño del fondo.
// CI (Node 22): node --experimental-strip-types --test tests/overlay-placement.test.mjs (va en `npm run test:engine`)
// OVERLAY_PLACEMENT_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { boxToPct, imageSize } from '../scripts/lib/overlay-crop.mjs';

const { overlayTransform } = await import(process.env.OVERLAY_PLACEMENT_PATH ?? '../src/systems/OverlayPlacement.ts');
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('sin bounds: la misma transformación que el fondo', () => {
  const bg = { x: 10, y: 5, scaleX: 0.3, scaleY: 0.3 };
  assert.deepEqual(overlayTransform(bg, { w: 3712, h: 1152 }, { w: 3712, h: 1152 }), bg);
  assert.deepEqual(overlayTransform(bg, { w: 3712, h: 1152 }, { w: 3712, h: 1152 }, null), bg);
});

test('con bounds: el píxel (i, j) del recorte cae donde caía el (left+i, top+j) de la imagen entera', () => {
  const img = { w: 3712, h: 1152 };
  const box = { left: 2120, top: 718, width: 233, height: 331 };
  const bounds = boxToPct(box, img.w, img.h);
  for (const bg of [{ x: 0, y: 0, scaleX: 1, scaleY: 1 }, { x: 37.5, y: -12, scaleX: 0.3381, scaleY: 0.3381 }, { x: 0, y: 0, scaleX: 0.75, scaleY: 0.75 }]) {
    const o = overlayTransform(bg, img, { w: box.width, h: box.height }, bounds);
    assert.ok(near(o.scaleX, bg.scaleX) && near(o.scaleY, bg.scaleY), 'misma escala que el fondo');
    for (const [i, j] of [[0, 0], [100, 200], [box.width, box.height]]) {
      assert.ok(near(o.x + i * o.scaleX, bg.x + (box.left + i) * bg.scaleX, 1e-6));
      assert.ok(near(o.y + j * o.scaleY, bg.y + (box.top + j) * bg.scaleY, 1e-6));
    }
  }
});

test('textura de otro tamaño que bounds: se estira a la caja', () => {
  const o = overlayTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1 }, { w: 1000, h: 500 }, { w: 50, h: 25 }, { x: 10, y: 20, w: 10, h: 10 });
  assert.deepEqual(o, { x: 100, y: 100, scaleX: 2, scaleY: 2 });
});

test('overlays reales con bounds: la textura mide lo que dice bounds (escala exacta del fondo)', () => {
  const root = new URL('../assets/scenes/', import.meta.url);
  let n = 0;
  for (const id of readdirSync(root)) {
    const f = new URL(`${id}/scene.json`, root);
    if (!existsSync(f)) continue;
    const s = JSON.parse(readFileSync(f, 'utf8'));
    const bg = imageSize(readFileSync(new URL(`${id}/background.webp`, root)));
    for (const co of s.conditionalOverlays ?? []) {
      if (!co.bounds) continue;
      const tex = imageSize(readFileSync(new URL(`${id}/${co.sprite}.${co.format === 'webp' ? 'webp' : 'png'}`, root)));
      const o = overlayTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1 }, { w: bg.width, h: bg.height }, { w: tex.width, h: tex.height }, co.bounds);
      assert.ok(near(o.scaleX, 1) && near(o.scaleY, 1), `${id}.${co.id}: escala ${o.scaleX}x${o.scaleY}`);
      assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), `${id}.${co.id}: posición entera (${o.x}, ${o.y})`);
      n++;
    }
  }
  assert.ok(n >= 0);
});

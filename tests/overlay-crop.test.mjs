// A2.7 (plan SCUMM): caja con contenido, % ↔ píxeles, cabeceras PNG/WebP y edición de scene.json sin reformatear
// (scripts/lib/overlay-crop.mjs, que usa scripts/crop-overlays.mjs). Node puro: node --test tests/overlay-crop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { contentBox, boxToPct, pctToBox, isFullBox, imageSize, replaceTopLevelKey, ALPHA_THRESHOLD, MARGIN_PX } from '../scripts/lib/overlay-crop.mjs';

/** RGBA de w×h con alfa `a` en los píxeles de `pts` */
function rgba(w, h, pts, a = 255) {
  const buf = new Uint8Array(w * h * 4);
  for (const [x, y, al = a] of pts) buf[(y * w + x) * 4 + 3] = al;
  return buf;
}

test('contentBox: caja de los píxeles con alfa > umbral más el margen, dentro de la imagen', () => {
  assert.deepEqual(contentBox(rgba(20, 10, [[5, 4], [8, 6]]), 20, 10), { left: 3, top: 2, width: 8, height: 7 });
  assert.deepEqual(contentBox(rgba(20, 10, [[0, 0], [19, 9]]), 20, 10), { left: 0, top: 0, width: 20, height: 10 }, 'el margen no sale de la imagen');
  assert.deepEqual(contentBox(rgba(20, 10, [[5, 5]]), 20, 10, 4, { margin: 0 }), { left: 5, top: 5, width: 1, height: 1 });
  assert.equal(contentBox(rgba(20, 10, []), 20, 10), null);
});

test('contentBox ignora el ruido de alfa ≤ 4 (las líneas blancas casi invisibles de los PNG generados)', () => {
  const pts = [[0, 0, 3], [19, 9, ALPHA_THRESHOLD], [10, 5, 200]];
  assert.deepEqual(contentBox(rgba(20, 10, pts), 20, 10), { left: 10 - MARGIN_PX, top: 5 - MARGIN_PX, width: 1 + 2 * MARGIN_PX, height: 1 + 2 * MARGIN_PX });
  assert.deepEqual(contentBox(rgba(20, 10, [[0, 0, 5]]), 20, 10, 4, { margin: 0 }), { left: 0, top: 0, width: 1, height: 1 }, 'alfa 5 sí cuenta');
});

test('contentBox con 2 canales (gris + alfa)', () => {
  const buf = new Uint8Array(6 * 4 * 2);
  buf[(2 * 6 + 3) * 2 + 1] = 255;
  assert.deepEqual(contentBox(buf, 6, 4, 2, { margin: 0 }), { left: 3, top: 2, width: 1, height: 1 });
});

test('boxToPct/pctToBox: ida y vuelta exacta en píxeles para todo el fondo de 3712x1152 y 2816x1536', () => {
  for (const [W, H] of [[3712, 1152], [2816, 1536]]) {
    for (let left = 0; left < W; left += 7) {
      const box = { left, top: left % H, width: Math.max(1, (W - left) % 977), height: Math.max(1, (H - (left % H)) % 433) };
      assert.deepEqual(pctToBox(boxToPct(box, W, H), W, H), box);
    }
  }
  assert.deepEqual(boxToPct({ left: 0, top: 0, width: 3712, height: 1152 }, 3712, 1152), { x: 0, y: 0, w: 100, h: 100 });
  assert.ok(isFullBox({ left: 0, top: 0, width: 4, height: 3 }, 4, 3));
  assert.ok(!isFullBox({ left: 1, top: 0, width: 3, height: 3 }, 4, 3));
});

test('imageSize lee PNG y WebP (VP8, VP8L y VP8X) de los assets del repo', () => {
  const root = new URL('../assets/scenes/', import.meta.url);
  const bg = imageSize(readFileSync(new URL('outside/background.webp', root)));
  assert.deepEqual(bg, { format: 'webp', width: 3712, height: 1152 });
  assert.deepEqual(imageSize(readFileSync(new URL('epilogue_outside/background.webp', root))), { format: 'webp', width: 2816, height: 1536 });
  assert.deepEqual(imageSize(readFileSync(new URL('lobby/poster_generic.png', root))), { format: 'png', width: 30, height: 45 });
  // VP8L y VP8X sintéticos
  const vp8l = Buffer.alloc(32);
  vp8l.write('RIFF', 0); vp8l.write('WEBP', 8); vp8l.write('VP8L', 12); vp8l[20] = 0x2f;
  vp8l.writeUInt32LE((233 - 1) | ((331 - 1) << 14), 21);
  assert.deepEqual(imageSize(vp8l), { format: 'webp', width: 233, height: 331 });
  const vp8x = Buffer.alloc(32);
  vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12);
  vp8x.writeUIntLE(3712 - 1, 24, 3); vp8x.writeUIntLE(1152 - 1, 27, 3);
  assert.deepEqual(imageSize(vp8x), { format: 'webp', width: 3712, height: 1152 });
  assert.equal(imageSize(Buffer.from('no es una imagen, ni PNG ni WebP')), null);
});

test('replaceTopLevelKey cambia solo esa clave de primer nivel y deja el resto del fichero igual', () => {
  const text = '{\n  "id": "x",\n  "regions": { "conditionalOverlays": [1] },\n  "conditionalOverlays": [\n    { "id": "a", "sprite": "b" }\n  ],\n  "list": [1, 2, 3]\n}\n';
  const out = replaceTopLevelKey(text, 'conditionalOverlays', [{ id: 'a', sprite: 'b', format: 'webp' }]);
  assert.equal(out, '{\n  "id": "x",\n  "regions": { "conditionalOverlays": [1] },\n  "conditionalOverlays": [\n    {\n      "id": "a",\n      "sprite": "b",\n      "format": "webp"\n    }\n  ],\n  "list": [1, 2, 3]\n}\n');
  assert.deepEqual(JSON.parse(out).regions, { conditionalOverlays: [1] });
  assert.throws(() => replaceTopLevelKey(text, 'nope', 1), /no encuentro/);
  // strings con corchetes y comillas escapadas no despistan
  const tricky = '{\n  "a": "]\\"[",\n  "b": [ "x]" ]\n}';
  assert.equal(JSON.parse(replaceTopLevelKey(tricky, 'b', ['y'])).b[0], 'y');
});

test('los scene.json del repo siguen siendo JSON y los overlays con bounds cuadran con su imagen', () => {
  const root = new URL('../assets/scenes/', import.meta.url);
  for (const id of readdirSync(root)) {
    const f = new URL(`${id}/scene.json`, root);
    if (!existsSync(f)) continue;
    const s = JSON.parse(readFileSync(f, 'utf8'));
    const bg = imageSize(readFileSync(new URL(`${id}/background.webp`, root)));
    for (const co of s.conditionalOverlays ?? []) {
      if (!co.bounds) continue;
      const img = imageSize(readFileSync(new URL(`${id}/${co.sprite}.${co.format === 'webp' ? 'webp' : 'png'}`, root)));
      const box = pctToBox(co.bounds, bg.width, bg.height);
      assert.deepEqual([box.width, box.height], [img.width, img.height], `${id}.${co.id}`);
      assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= bg.width && box.top + box.height <= bg.height, `${id}.${co.id} fuera del fondo`);
    }
  }
});

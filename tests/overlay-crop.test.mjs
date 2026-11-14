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

// --- A9.16: píxeles del overlay contra el fondo y manifiesto de hashes (scripts/lib/overlay-pixels.mjs) ---
import { overlayVsBackground, isNearPatchDefect, lockProblems, NEAR_MAX_PX, NEAR_DELTA } from '../scripts/lib/overlay-pixels.mjs';

test('overlayVsBackground cuenta iguales, casi iguales y distintos (solo opacos) en su sitio del fondo', () => {
  const bw = 4, bh = 2, bg = new Uint8Array(bw * bh * 3).fill(100);
  // overlay 2x2 en (1, 0): igual, casi (Δ 5), distinto (Δ 60), semitransparente
  const ov = new Uint8Array([100, 100, 100, 255, 105, 100, 100, 255, 160, 100, 100, 255, 0, 0, 0, 128]);
  assert.deepEqual(overlayVsBackground(ov, 2, 2, bg, bw, 3, 1, 0), { opaque: 3, equal: 1, near: 1, far: 1, semi: 1 });
  const edge = new Uint8Array([100 + NEAR_DELTA, 100, 100, 255]);
  assert.equal(overlayVsBackground(edge, 1, 1, bg, bw, 3, 0, 0).near, 1, `Δ ${NEAR_DELTA} aún es «casi»`);
});

test('isNearPatchDefect: falla con muchos casi iguales y en proporción alta (la veleta de A9.12), no con pocos', () => {
  assert.equal(isNearPatchDefect({ opaque: 50230, near: 6556 }), true, 'veleta vieja: 6556 px, 13,1 %');
  assert.equal(isNearPatchDefect({ opaque: 65316, near: 7828 }), false, 'puerta de recovery_pool: 12,0 %');
  assert.equal(isNearPatchDefect({ opaque: 3000, near: NEAR_MAX_PX }), false, 'por debajo del tope de px');
});

test('lockProblems: fondo cambiado, overlay cambiado, que falta y que sobra', () => {
  const lock = { overlays: { 'a/x': { background: 'b1', overlay: 'o1' }, 'a/gone': { background: 'b1', overlay: 'o9' } } };
  assert.deepEqual(lockProblems(lock, { 'a/x': { background: 'b1', overlay: 'o1' }, 'a/gone': { background: 'b1', overlay: 'o9' } }), []);
  const p = lockProblems(lock, { 'a/x': { background: 'b2', overlay: 'o2' }, 'a/new': { background: 'b1', overlay: 'o3' } });
  assert.equal(p.length, 4);
  assert.match(p.join('\n'), /a\/x: el fondo de la escena cambió/);
  assert.match(p.join('\n'), /a\/x: el overlay cambió/);
  assert.match(p.join('\n'), /a\/new: no está/);
  assert.match(p.join('\n'), /a\/gone: está en overlays.lock.json y ya no existe/);
});

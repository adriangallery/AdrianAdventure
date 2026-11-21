// F3.2b: con el perfil apilado, el texto largo abierto (buzón, ≈201×384 px a 14 px) cabe entero en la zona visible de
// la escena tras girar (844x390 ↔ 390x844): se ensancha el wrap y se mete dentro por los cuatro bordes.
// node --experimental-strip-types --test tests/speech-fit.test.mjs (va en `npm run test:funtico`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const L = await import(process.env.SPEECH_LAYOUT_PATH ?? '../src/ui/speechLayout.ts');

// Bloque del e2e: 201 px de ancho y 384 de alto con letra 14 y lineSpacing 8 (22 px por línea)
const LINE = 22;
const INK = 201 * (384 / LINE); // «largo» del texto en px si fuera una sola línea
const measure = (wrap) => {
  const lines = Math.ceil(INK / (wrap * 0.92)); // las palabras no llenan la línea entera
  return { w: Math.min(wrap, INK), h: lines * LINE };
};

/** Lo que hace DialogueBox.layout() con el perfil apilado: colocar, y si no cabe, ensanchar el wrap y volver a colocar. */
function layout(vp, head, panelH, narrow) {
  const topInset = L.TOP_UI_INSET;
  let wrap = narrow ?? L.speechWrapWidth(vp, 'head');
  let m = measure(wrap);
  const place = () => L.placeSpeech({ head, vp, textW: m.w, textH: m.h, bottomInset: panelH, topInset });
  let p = place();
  if (p.wantWrap && p.wantWrap < wrap) { wrap = p.wantWrap; m = measure(wrap); p = place(); }
  const area = L.speechArea(vp, { bottomInset: panelH, topInset });
  let fit = L.fitSpeechBlock({ x: p.x, y: p.y, textW: m.w, textH: m.h, area });
  const full = L.fullSpeechWrap(vp);
  if (!fit.fits && wrap < full) {
    wrap = full; m = measure(wrap); p = place();
    fit = L.fitSpeechBlock({ x: p.x, y: p.y, textW: m.w, textH: m.h, area });
  }
  return { left: fit.x - m.w / 2, top: fit.y, w: m.w, h: m.h, area, fits: fit.fits };
}

const inside = (b) => b.left >= b.area.left - 0.5 && b.left + b.w <= b.area.right + 0.5 && b.top >= b.area.top - 0.5 && b.top + b.h <= b.area.bottom + 0.5;

test('844x390 (horizontal) con el wrap estrecho que venía de vertical: cabe entero en la escena', () => {
  const vp = { width: 844, height: 390 };
  const b = layout(vp, { x: 300, headY: 150, footY: 260 }, 110, 201);
  assert.ok(b.fits, JSON.stringify(b));
  assert.ok(inside(b), JSON.stringify(b));
  assert.ok(b.top + b.h <= vp.height, 'no se sale por abajo');
});

test('390x844 (vertical, escena arriba) con Dex a la izquierda: no empieza fuera por la izquierda', () => {
  const vp = { width: 390, height: 844 };
  for (const panelH of [422, 371]) {
    for (const x of [30, 120, 200, 360]) {
      const b = layout(vp, { x, headY: 140, footY: 300 }, panelH);
      assert.ok(b.fits, JSON.stringify({ x, panelH, b }));
      assert.ok(inside(b), JSON.stringify({ x, panelH, b }));
      assert.ok(b.left >= 0, 'dentro por la izquierda');
    }
  }
});

test('fitSpeechBlock: pega a los cuatro bordes y dice si cabe', () => {
  const area = { left: 8, top: 40, right: 382, bottom: 414 };
  assert.deepEqual(L.fitSpeechBlock({ x: 0, y: 500, textW: 100, textH: 50, area }), { x: 58, y: 364, fits: true });
  assert.deepEqual(L.fitSpeechBlock({ x: 400, y: 0, textW: 100, textH: 50, area }), { x: 332, y: 40, fits: true });
  const big = L.fitSpeechBlock({ x: 10, y: 10, textW: 500, textH: 500, area });
  assert.equal(big.fits, false);
  assert.equal(big.x, 195);
  assert.equal(big.y, 40);
});

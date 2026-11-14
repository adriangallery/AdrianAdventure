// A9.1 (plan SCUMM): opciones de diálogo todas a la vez, sin «More...» (src/ui/choiceLayout.ts). Lógica pura.
// CI (Node 22): node --experimental-strip-types --test tests/choice-layout.test.mjs (va en `npm run test:engine`)
// CHOICE_LAYOUT_PATH permite apuntar a una copia ya transpilada a JS.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const L = await import(process.env.CHOICE_LAYOUT_PATH ?? '../src/ui/choiceLayout.ts');
const { layoutChoices, choiceFontSize, maxChoiceHeight, estimateTextHeight, clampScroll, scrollToShow, CHOICE_MIN_ROW, CHOICE_MIN_FONT, PREFIX_ENABLED } = L;

const LAND = { width: 844, height: 390, panelH: 120 };
const PORT = { width: 390, height: 844, panelH: 152 };
const DESK = { width: 1280, height: 720, panelH: 180 };
const LAND_COLLAPSED = { width: 844, height: 390, panelH: 40 };

const p = (t) => `${PREFIX_ENABLED}${t}`;
// Duelo con Chad (recovery_pool, chad_fud/i1 con todas las réplicas aprendidas): las frases reales más largas
const CHAD = [
  'A broken clock is right twice a day. You\'re on a streak of zero.',
  'Still more detail than your exit plan.',
  'At least mine float. Yours sank in a kiddie pool.',
  'Then today they\'ll hear you lose.',
  'And you sold the bottom so often, they gave you a loyalty card.',
  'I can tell. They left the receipts floating in the pool.',
  'Uh... no they\'re not?',
].map(p);
const HUB = ['Who are you?', 'What is this place?', 'Can I see the doctor?', 'Tell me something else', 'Goodbye'].map(p);

/** Comprobaciones comunes: todas, en pantalla (o alcanzables con scroll), sin solaparse, ≥ 44 px, letra ≥ 11. */
function check(vp, texts) {
  const lay = layoutChoices({ ...vp, texts });
  assert.equal(lay.rows.length, texts.length, 'todas las opciones a la vez');
  assert.deepEqual(lay.rows.map((r) => r.index).sort((a, b) => a - b), texts.map((_, i) => i));
  assert.ok(lay.fontSize >= CHOICE_MIN_FONT, `letra ${lay.fontSize}`);
  assert.ok(lay.height >= vp.panelH, 'nunca más bajo que el panel SCUMM');
  assert.ok(lay.top >= 0 && lay.top + lay.height === vp.height, 'pegado abajo y dentro de la pantalla');
  assert.ok(lay.height <= Math.max(vp.panelH, maxChoiceHeight(vp.width, vp.height, vp.panelH)), 'no crece más del máximo');
  for (const r of lay.rows) {
    assert.ok(r.h >= CHOICE_MIN_ROW, `opción ${r.index}: ${r.h} px de alto`);
    assert.ok(r.x >= 0 && r.x + r.w <= vp.width, `opción ${r.index} dentro de la pantalla en horizontal`);
    assert.ok(r.y >= 0 && r.y + r.h <= lay.contentH, `opción ${r.index} dentro del contenido`);
    assert.ok(estimateTextHeight(texts[r.index], r.wrapW, lay.fontSize) <= r.h, 'el texto cabe en su celda');
  }
  for (const a of lay.rows) for (const b of lay.rows) {
    if (a === b) continue;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, `opciones ${a.index} y ${b.index} se pisan`);
  }
  return lay;
}

test('letra: 11 px en un iPhone (vertical y apaisado), 16 en escritorio', () => {
  assert.equal(choiceFontSize(390), 11);
  assert.equal(choiceFontSize(844), 11);
  assert.equal(choiceFontSize(1280), 16);
  assert.equal(choiceFontSize(4000), 16);
});

test('pocas opciones cortas: una columna dentro del panel, sin crecer', () => {
  const lay = check(DESK, [p('Yes.'), p('No.'), p('Goodbye')]);
  assert.equal(lay.columns, 1);
  assert.equal(lay.height, DESK.panelH);
  assert.equal(lay.scroll, false);
});

test('duelo con Chad en 844×390: dos columnas, todas a la vez, sin scroll y sin pasar del 62 % del alto', () => {
  const lay = check(LAND, CHAD);
  assert.equal(lay.columns, 2);
  assert.equal(lay.scroll, false);
  assert.ok(lay.height <= Math.floor(390 * 0.62), `alto ${lay.height}`);
  // Orden por columnas: la izquierda empieza por la primera opción y la derecha sigue
  const left = lay.rows.filter((r) => r.x < 844 / 2).map((r) => r.index);
  assert.deepEqual(left, [0, 1, 2, 3]);
});

test('duelo con Chad en 390×844: una columna, todas a la vez y la mitad de arriba libre', () => {
  const lay = check(PORT, CHAD);
  assert.equal(lay.columns, 1);
  assert.equal(lay.scroll, false);
  assert.ok(lay.top >= 844 / 2, `empieza en y=${lay.top}`);
});

test('hubs de Penny y Satoshi: caben en los tres tamaños', () => {
  for (const vp of [LAND, PORT, DESK]) {
    const lay = check(vp, HUB);
    assert.equal(lay.scroll, false, `${vp.width}x${vp.height}`);
  }
});

test('panel plegado (40 px): las opciones crecen igual hasta caber', () => {
  const lay = check(LAND_COLLAPSED, CHAD);
  assert.equal(lay.scroll, false);
  assert.ok(lay.height > 40);
});

test('escritorio 1280×720: el duelo cabe sin scroll y tapa como mucho la mitad', () => {
  const lay = check(DESK, CHAD);
  assert.equal(lay.scroll, false);
  assert.ok(lay.height <= 360);
});

test('si de verdad no cabe, scroll: alto máximo y desplazamiento acotado', () => {
  const many = Array.from({ length: 20 }, (_, i) => p(`Option number ${i + 1} with a reasonably long line of text to wrap.`));
  const lay = check(LAND, many);
  assert.equal(lay.scroll, true);
  assert.equal(lay.height, maxChoiceHeight(844, 390, 120));
  assert.equal(lay.maxScroll, lay.contentH - lay.height);
  assert.equal(clampScroll(-50, lay), 0);
  assert.equal(clampScroll(1e6, lay), lay.maxScroll);
  // Llevar la última opción a la vista la deja entera dentro del panel
  const last = lay.rows.find((r) => r.index === 19);
  const o = scrollToShow(19, 0, lay);
  assert.ok(last.y - o >= 0 && last.y + last.h - o <= lay.height);
  assert.equal(scrollToShow(0, o, lay), 0);
});

test('estimación de texto: envuelve por palabras y parte las palabras larguísimas', () => {
  assert.equal(estimateTextHeight('abc', 100, 10), 10);
  assert.equal(estimateTextHeight('aaaa bbbb', 50, 10), 24); // 5 caracteres por línea: dos líneas
  assert.equal(estimateTextHeight('x'.repeat(25), 100, 10), 38); // 10 por línea: tres líneas
});

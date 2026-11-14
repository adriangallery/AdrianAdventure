// A2.19 (plan SCUMM): texto dentro de las pantallas de la escena (src/systems/ScreenText.ts). Lógica pura, sin Phaser:
// qué se ve en la pantalla, maquetación, recorte, scroll de terminal y decisión de primer plano.
// CI (Node 22): node --experimental-strip-types --test tests/screen-text.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import(process.env.SCREEN_TEXT_PATH ?? '../src/systems/ScreenText.ts');
const E = await import(process.env.SCRIPT_ENGINE_PATH ?? '../src/systems/ScriptEngine.ts');
const {
  screenDisplayText, wrapText, layoutScreen, visibleRows, typedLength, closeupReason, screenCharDelay, screenDefErrors,
  MIN_READABLE_PX, LONG_TEXT_CHARS,
} = S;

test('screenDisplayText: lo citado entre comillas, sin apóstrofos, o display', () => {
  assert.equal(
    screenDisplayText("'ADRIANLAB FLOPPY COLLECTION DETECTED — HOLDER OVERRIDE ACTIVE. Decrypting Sector Zero...'"),
    'ADRIANLAB FLOPPY COLLECTION DETECTED — HOLDER OVERRIDE ACTIVE. Decrypting Sector Zero...',
  );
  assert.equal(
    screenDisplayText("The CRT prints a final line: 'COMPRESSION RATIO: infinity. When you believe in the art, size doesn't matter.'"),
    "COMPRESSION RATIO: infinity. When you believe in the art, size doesn't matter.",
  );
  assert.equal(
    screenDisplayText("'To whoever holds these discs: you're not just a collector. — A.'"),
    "To whoever holds these discs: you're not just a collector. — A.",
  );
  assert.equal(screenDisplayText("I press a key. The screen flickers: 'DO NOT MASH KEYS.' I wasn't mashing."), 'DO NOT MASH KEYS.');
  assert.equal(screenDisplayText("One: 'A.' Two: 'B!'"), 'A.\nB!');
  assert.equal(screenDisplayText("Dex can't see it's broken"), "Dex can't see it's broken", 'sin cita: la línea entera');
  assert.equal(screenDisplayText("x 'Y'", '  OVERRIDE  '), 'OVERRIDE');
});

test('wrapText: por palabras, saltos de línea y palabras más largas que la fila', () => {
  assert.deepEqual(wrapText('HELLO WORLD FOO', 11), ['HELLO WORLD', 'FOO']);
  assert.deepEqual(wrapText('A\nB C', 10), ['A', 'B C']);
  assert.deepEqual(wrapText('ABCDEFGHIJ KL', 4), ['ABCD', 'EFGH', 'IJ', 'KL']);
  for (const l of wrapText('PROPAGATION: EXPONENTIAL. TARGET: ALL TIMELINES.', 9)) assert.ok(l.length <= 9, l);
});

test('layoutScreen: la letra más grande que cabe, y a la mínima desborda (scroll)', () => {
  const short = layoutScreen('HELLO', { w: 300, h: 200 }, { minPx: 6, maxPx: 14 });
  assert.equal(short.fontPx, 14);
  assert.equal(short.overflow, false);
  const long = layoutScreen('WORD '.repeat(200), { w: 120, h: 60 }, { minPx: 6, maxPx: 14 });
  assert.equal(long.fontPx, 6);
  assert.equal(long.overflow, true);
  assert.ok(long.lines.length > long.rows);
  // Todas las filas caben en el ancho (con la columna del cursor)
  for (const l of long.lines) assert.ok(l.length <= long.cols - 1);
  // Cabe a una letra intermedia
  const mid = layoutScreen('ADRIANLAB FLOPPY COLLECTION DETECTED', { w: 200, h: 120 }, { minPx: 4, maxPx: 30 });
  assert.equal(mid.overflow, false);
  assert.ok(mid.fontPx < 30 && mid.fontPx > 4);
});

test('visibleRows: tecleo, recorte y scroll de terminal', () => {
  const lines = ['AAAA', 'BBBB', 'CCCC'];
  assert.equal(typedLength(lines), 14);
  assert.deepEqual(visibleRows(lines, 2, 0).rows, ['']);
  assert.deepEqual(visibleRows(lines, 2, 2).rows, ['AA']);
  assert.deepEqual(visibleRows(lines, 2, 6).rows, ['AAAA', 'B']);
  const end = visibleRows(lines, 2, 14);
  assert.deepEqual(end.rows, ['BBBB', 'CCCC'], 'solo las dos últimas: la primera subió');
  assert.equal(end.scroll, 1);
  assert.equal(end.done, true);
  assert.equal(visibleRows(lines, 5, 13).done, false);
});

test('closeupReason: se lee en la pantalla del fondo en escritorio; primer plano si es pequeña, larga o se pide', () => {
  const crtDesk = { w: 324 * 0.625, h: 225 * 0.625 }; // CRT del basement a 1280×720 (fondo de 1152 px de alto)
  const crtPortrait = { w: 324 * 0.24, h: 225 * 0.24 }; // en 390×844 con la barra de verbos
  const text = 'ADRIANLAB FLOPPY COLLECTION DETECTED — HOLDER OVERRIDE ACTIVE. Decrypting Sector Zero...';
  assert.equal(closeupReason({ text, screenPx: crtDesk }), null);
  assert.equal(closeupReason({ text, screenPx: crtPortrait }), 'small');
  assert.equal(closeupReason({ text: 'X'.repeat(LONG_TEXT_CHARS + 1), screenPx: { w: 2000, h: 2000 } }), 'long');
  assert.equal(closeupReason({ text: 'HI', screenPx: crtDesk, forced: true }), 'forced');
  assert.equal(closeupReason({ text: 'HI', screenPx: crtDesk, closeupOnly: true }), 'closeupOnly');
  // Muchas filas a la letra mínima en una pantalla mediana = larga
  assert.equal(closeupReason({ text: 'WORD '.repeat(40), screenPx: { w: 120, h: 60 } }), 'long');
  // Justo en el borde: MIN_COLS columnas a la letra mínima
  const minW = 10 * MIN_READABLE_PX / (1 - 2 * 0.08) + 1;
  assert.equal(closeupReason({ text: 'OK', screenPx: { w: minW, h: minW } }), null);
});

test('screenCharDelay: rápido, con tope de tiempo total', () => {
  assert.equal(screenCharDelay(0), 0);
  assert.equal(screenCharDelay(10), 28);
  assert.ok(screenCharDelay(1000) * 1000 <= 6000);
  assert.ok(screenCharDelay(1000) >= 6);
});

test('screenDefErrors: bounds y color', () => {
  assert.deepEqual(screenDefErrors('crt', { bounds: { x: 52, y: 30, w: 8, h: 19 }, color: 'green' }), []);
  assert.equal(screenDefErrors('crt', { bounds: { x: 52, y: 30, w: 0, h: 19 } }).length, 1);
  assert.equal(screenDefErrors('crt', { bounds: { x: 95, y: 30, w: 8, h: 19 } }).length, 1);
  assert.equal(screenDefErrors('crt', { bounds: { x: 1, y: 1, w: 1, h: 1 }, color: 'pink' }).length, 1);
  assert.equal(screenDefErrors('crt', {}).length, 1);
});

test('screenRequestOf: el campo screen del op say (texto hablado intacto)', () => {
  assert.equal(E.screenRequestOf({ op: 'say', text: 'hi' }), null);
  const r = E.screenRequestOf({ op: 'say', text: "'HELLO'", screen: 'crt', closeup: true, display: 'HELLO' });
  assert.deepEqual(r, { screen: 'crt', text: "'HELLO'", speaker: undefined, display: 'HELLO', closeup: true, briefMs: undefined });
  assert.equal(E.screenRequestOf({ op: 'sayBrief', text: 'x', screen: 'crt' }, 1500).briefMs, 1500);
});

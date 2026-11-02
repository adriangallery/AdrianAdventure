// A2.3 (plan SCUMM): colocación del texto sobre la cabeza de quien habla (src/ui/speechLayout.ts) y color por
// personaje (SPEECH_COLORS de src/config/theme.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/speech-layout.test.mjs (va en `npm run test:engine`)
// SPEECH_LAYOUT_PATH / THEME_PATH permiten apuntar a copias ya transpiladas a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const L = await import(process.env.SPEECH_LAYOUT_PATH ?? '../src/ui/speechLayout.ts');
const { SPEECH_COLORS, TWP } = await import(process.env.THEME_PATH ?? '../src/config/theme.ts');
const {
  placeSpeech, speechWrapWidth, speechFontSize, speechStroke, isAnchorOnScreen, speakerKind, speechColor, normalizeColor,
  topY, SPEECH_MARGIN, SPEECH_GAP, HEAD_WRAP_MIN,
} = L;

const LAND = { width: 844, height: 390 };
const PORT = { width: 390, height: 844 };
const DESK = { width: 1280, height: 720 };
const head = (x, headY, footY = headY + 150) => ({ x, headY, footY });

test('centrado sobre la cabeza, con el borde inferior por encima de ella', () => {
  const p = placeSpeech({ head: head(400, 200), vp: LAND, textW: 200, textH: 40 });
  assert.equal(p.mode, 'head');
  assert.equal(p.x, 400);
  assert.equal(p.y, 200 - SPEECH_GAP - 40);
  assert.ok(p.y + 40 < 200, 'el texto acaba por encima de la cabeza');
  assert.deepEqual(p.clamped, { left: false, right: false, top: false, bottom: false });
});

test('pegado al borde izquierdo y al derecho', () => {
  const l = placeSpeech({ head: head(30, 200), vp: LAND, textW: 300, textH: 40 });
  assert.equal(l.mode, 'head');
  assert.equal(l.x - 150, SPEECH_MARGIN);
  assert.ok(l.clamped.left && !l.clamped.right);
  const r = placeSpeech({ head: head(830, 200), vp: LAND, textW: 300, textH: 40 });
  assert.equal(r.x + 150, LAND.width - SPEECH_MARGIN);
  assert.ok(r.clamped.right && !r.clamped.left);
});

test('pegado al borde superior si la cabeza queda muy arriba (o por encima de la pantalla)', () => {
  const p = placeSpeech({ head: head(400, 30), vp: LAND, textW: 200, textH: 60 });
  assert.equal(p.mode, 'head');
  assert.equal(p.y, SPEECH_MARGIN);
  assert.ok(p.clamped.top);
  // Cabeza fuera por arriba pero los pies dentro: sigue sobre el personaje, pegado arriba
  const q = placeSpeech({ head: head(400, -80, 200), vp: LAND, textW: 200, textH: 60 });
  assert.equal(q.mode, 'head');
  assert.equal(q.y, SPEECH_MARGIN);
});

test('nunca pisa el panel inferior', () => {
  const p = placeSpeech({ head: head(400, 380, 389), vp: LAND, textW: 200, textH: 40, bottomInset: 90 });
  assert.equal(p.mode, 'head');
  assert.ok(p.y + 40 <= LAND.height - 90 - SPEECH_MARGIN + 1e-9);
  assert.ok(p.clamped.bottom);
});

test('más ancho que la pantalla: centrado', () => {
  const p = placeSpeech({ head: head(50, 300), vp: PORT, textW: 400, textH: 80 });
  assert.equal(p.x, PORT.width / 2);
});

test('fuera de pantalla o sin cabeza → arriba-centro (modo de antes)', () => {
  for (const h of [null, undefined, head(-20, 200), head(900, 200), head(400, -300, -10), head(400, 500, 700), head(NaN, 1, 2)]) {
    const p = placeSpeech({ head: h, vp: LAND, textW: 200, textH: 40 });
    assert.equal(p.mode, 'top', JSON.stringify(h));
    assert.equal(p.x, LAND.width / 2);
    assert.equal(p.y, topY(LAND));
  }
  assert.equal(topY(LAND), Math.max(20, 390 * 0.06));
  assert.equal(isAnchorOnScreen(head(0, 10), LAND), true, 'en el borde cuenta como dentro');
});

test('ancho de wrap: ≈ 40 % en horizontal, más en vertical, mínimo y dentro de la pantalla', () => {
  assert.equal(speechWrapWidth(DESK), Math.floor(1280 * 0.4));
  assert.equal(speechWrapWidth(LAND), Math.floor(844 * 0.4));
  const port = speechWrapWidth(PORT);
  assert.ok(port >= HEAD_WRAP_MIN && port > PORT.width * 0.4, `vertical: ${port}`);
  assert.ok(port <= PORT.width - SPEECH_MARGIN * 2);
  // Pantalla diminuta: cabe igual
  assert.ok(speechWrapWidth({ width: 200, height: 300 }) <= 200 - SPEECH_MARGIN * 2);
  // Modo arriba-centro: el de antes (≤ 600, ancho − 64)
  assert.equal(speechWrapWidth(DESK, 'top'), 600);
  assert.equal(speechWrapWidth(PORT, 'top'), 390 - 64);
});

test('letra y contorno escalan con el viewport como antes', () => {
  assert.deepEqual(speechFontSize(LAND), { speaker: 15, body: 13 });
  assert.deepEqual(speechFontSize(PORT), { speaker: 13, body: 12 });
  assert.deepEqual(speechFontSize({ width: 2560, height: 1440 }), { speaker: 20, body: 18 });
  assert.equal(speechStroke(12), 4);
  assert.equal(speechStroke(18), 6);
});

test('quién habla: sin speaker = jugador, Narrator/System = narrador, el resto = NPC', () => {
  assert.equal(speakerKind(undefined), 'player');
  assert.equal(speakerKind(''), 'player');
  assert.equal(speakerKind('player'), 'player');
  assert.equal(speakerKind('Narrator'), 'narrator');
  assert.equal(speakerKind(' system '), 'narrator');
  assert.equal(speakerKind('Receptionist'), 'npc');
  assert.equal(speakerKind('B.O.T.'), 'npc');
});

test('color por personaje con reserva', () => {
  const colors = { _player: '#ffffff', _npc: '#f8e848', _narrator: '#f0e8d8', receptionist: '#ff9ad2' };
  assert.equal(speechColor({ kind: 'player', keys: [], colors }), '#ffffff');
  assert.equal(speechColor({ kind: 'npc', keys: ['npc_receptionist', 'Receptionist'], colors }), '#ff9ad2', 'por nombre, sin mayúsculas');
  assert.equal(speechColor({ kind: 'npc', keys: ['npc_x', 'Stranger'], colors, npcColor: 'ff6600' }), '#ff6600', 'color de la NPC en la escena');
  assert.equal(speechColor({ kind: 'npc', keys: ['Receptionist'], colors, npcColor: '00ff00' }), '#ff9ad2', 'el mapa manda sobre el de la escena');
  assert.equal(speechColor({ kind: 'npc', keys: ['Stranger'], colors }), '#f8e848', 'reserva de NPC');
  assert.equal(speechColor({ kind: 'npc', keys: ['Stranger'], colors, npcColor: 'nope' }), '#f8e848', 'color inválido → reserva');
  assert.equal(speechColor({ kind: 'narrator', keys: ['Narrator'], colors }), '#f0e8d8');
  assert.equal(speechColor({ kind: 'npc', keys: [null, undefined], colors: {}, fallback: '#123456' }), '#123456');
  assert.equal(normalizeColor('0xFF6600'), '#ff6600');
  assert.equal(normalizeColor('#f60'), '#ff6600');
  assert.equal(normalizeColor('red'), null);
});

test('SPEECH_COLORS: jugador, narrador, reserva de NPC y las NPC del juego con color propio', () => {
  for (const k of ['_player', '_narrator', '_npc', 'receptionist', 'dr. satoshi', 'b.o.t.', 'npc_receptionist', 'npc_dr_satoshi']) {
    assert.match(SPEECH_COLORS[k] ?? '', /^#[0-9a-f]{6}$/i, k);
  }
  assert.equal(SPEECH_COLORS._narrator, TWP.DIALOGUE_TEXT, 'el narrador sigue con el color de siempre');
  const npcs = ['Receptionist', 'Dr. Satoshi', 'B.O.T.'].map((n) => speechColor({ kind: 'npc', keys: [n], colors: SPEECH_COLORS }));
  const player = speechColor({ kind: 'player', keys: [], colors: SPEECH_COLORS });
  assert.equal(new Set([...npcs, player]).size, 4, 'cada personaje en un color distinto');
});

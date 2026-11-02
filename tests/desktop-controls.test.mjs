// A2.4 (plan SCUMM): controles de escritorio (src/systems/DesktopControls.ts): tabla de teclas, verbo por defecto del
// clic derecho, salidas para el doble clic y foco del teclado. Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/desktop-controls.test.mjs (va en `npm run test:engine`)
// DESKTOP_CONTROLS_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const D = await import(process.env.DESKTOP_CONTROLS_PATH ?? '../src/systems/DesktopControls.ts');
const { VERB_KEYS, keyAction, focusOf, defaultVerbFor, exitVerbFor, primaryVerb, isDoubleClick, DOUBLE_CLICK_MS } = D;

const scene = (id) => JSON.parse(readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
const hotspot = (sceneId, id) => scene(sceneId).regions.hotspots.find((h) => h.id === id);
const PANEL = ['OPEN', 'PICK', 'PUSH', 'CLOSE', 'LOOK', 'PULL', 'GIVE', 'TALK', 'USE'];

test('cada verbo del panel tiene una tecla propia, de una letra y que no es la del inventario', () => {
  assert.deepEqual(Object.keys(VERB_KEYS).sort(), [...PANEL].sort());
  const keys = Object.values(VERB_KEYS);
  assert.equal(new Set(keys).size, keys.length, 'sin teclas repetidas');
  for (const k of keys) assert.match(k, /^[a-z]$/);
  assert.ok(!keys.includes('i'), 'I es el inventario');
});

test('keyAction: verbos, Tab, Esc e I; nada con Ctrl/Cmd/Alt ni escribiendo', () => {
  assert.deepEqual(keyAction({ key: 'l' }, 'game'), { kind: 'verb', verb: 'LOOK' });
  assert.deepEqual(keyAction({ key: 'L' }, 'game'), { kind: 'verb', verb: 'LOOK' }, 'con mayúsculas también');
  assert.deepEqual(keyAction({ key: 'y' }, 'game'), { kind: 'verb', verb: 'PULL' });
  assert.deepEqual(keyAction({ key: 's' }, 'game'), { kind: 'verb', verb: 'PUSH' });
  assert.deepEqual(keyAction({ key: 'Tab' }, 'game'), { kind: 'highlight' });
  assert.deepEqual(keyAction({ key: 'Escape' }, 'game'), { kind: 'skip' });
  assert.deepEqual(keyAction({ key: 'i' }, 'game'), { kind: 'inventory' });
  assert.equal(keyAction({ key: 'x' }, 'game'), null);
  assert.equal(keyAction({ key: 'ArrowLeft' }, 'game'), null);
  assert.equal(keyAction({ key: 'c', ctrlKey: true }, 'game'), null, 'Ctrl+C es del navegador');
  assert.equal(keyAction({ key: 'l', metaKey: true }, 'game'), null, 'Cmd+L es del navegador');
  assert.equal(keyAction({ key: 'Tab', altKey: true }, 'game'), null);
  for (const key of ['l', 'Tab', 'Escape', 'i']) assert.equal(keyAction({ key }, 'typing'), null, `escribiendo: ${key}`);
  assert.equal(keyAction({ key: 'Tab' }, 'elsewhere'), null, 'Tab sigue moviendo el foco en un diálogo HTML');
  assert.deepEqual(keyAction({ key: 'l' }, 'elsewhere'), { kind: 'verb', verb: 'LOOK' });
});

test('focusOf: campos de texto, controles de la página y el propio juego', () => {
  assert.equal(focusOf(null, false), 'game');
  assert.equal(focusOf({ tagName: 'BODY' }, false), 'game');
  assert.equal(focusOf({ tagName: 'CANVAS' }, true), 'game');
  assert.equal(focusOf({ tagName: 'INPUT' }, false), 'typing');
  assert.equal(focusOf({ tagName: 'textarea' }, false), 'typing');
  assert.equal(focusOf({ tagName: 'DIV', isContentEditable: true }, false), 'typing');
  assert.equal(focusOf({ tagName: 'BUTTON' }, false), 'elsewhere');
});

test('verbo por defecto: salidas OPEN/USE, objetos que se cogen PICK, solo texto LOOK', () => {
  assert.equal(defaultVerbFor(hotspot('lobby', 'hs_frontdoor')), 'OPEN');
  assert.equal(defaultVerbFor(hotspot('lobby', 'hs_stairs_up')), 'USE');
  assert.equal(defaultVerbFor(hotspot('lobby', 'hs_coat')), 'PICK');
  assert.equal(defaultVerbFor(hotspot('lobby', 'hs_plant')), 'LOOK');
  assert.equal(defaultVerbFor(hotspot('lobby', 'hs_floor_tiles')), 'LOOK');
  assert.equal(primaryVerb(hotspot('lobby', 'hs_plant')), null, 'en táctil (mainVerbFor) cae en USE');
  assert.equal(defaultVerbFor({ scripts: {} }), 'LOOK');
  assert.equal(defaultVerbFor({}), 'LOOK');
});

test('en todas las escenas, lo que se coge da PICK y lo que solo habla da LOOK', () => {
  for (const id of readdirSync(new URL('../assets/scenes/', import.meta.url))) {
    let data;
    try { data = scene(id); } catch { continue; }
    for (const h of data.regions?.hotspots ?? []) {
      const v = defaultVerbFor(h);
      assert.ok([...PANEL].includes(v), `${id}/${h.id}: ${v}`);
      const picks = JSON.stringify(h.scripts?.PICK ?? []).includes('"addItem"');
      if (picks) assert.equal(v, 'PICK', `${id}/${h.id} se coge`);
    }
  }
});

test('salidas: el doble clic cruza las puertas y escaleras, no los objetos', () => {
  assert.equal(exitVerbFor(hotspot('lobby', 'hs_stairs_up')), 'USE');
  assert.equal(exitVerbFor(hotspot('lobby', 'hs_frontdoor')), 'OPEN');
  assert.equal(exitVerbFor(hotspot('upstairs', 'hs_roof_hatch')), 'OPEN');
  assert.equal(exitVerbFor(hotspot('lobby', 'hs_coat')), null);
  assert.equal(exitVerbFor(hotspot('lobby', 'hs_plant')), null);
  // una salida dentro de un ifFlag (puerta con condición) también cuenta: su script decide al ejecutarse
  assert.equal(exitVerbFor({ scripts: { OPEN: [{ op: 'ifFlag', flag: 'x', then: [{ op: 'fadeToScene', sceneId: 'a' }], else: [{ op: 'say', text: 'no' }] }] } }), 'OPEN');
});

test('isDoubleClick: mismo objetivo y dentro del margen', () => {
  const prev = { id: 'hs_a', at: 1000 };
  assert.ok(isDoubleClick(prev, 'hs_a', 1000 + DOUBLE_CLICK_MS));
  assert.ok(!isDoubleClick(prev, 'hs_a', 1001 + DOUBLE_CLICK_MS), 'demasiado lento');
  assert.ok(!isDoubleClick(prev, 'hs_b', 1100), 'otro hotspot');
  assert.ok(!isDoubleClick(prev, null, 1100), 'en el fondo no');
  assert.ok(!isDoubleClick(null, 'hs_a', 1100), 'primer clic');
});

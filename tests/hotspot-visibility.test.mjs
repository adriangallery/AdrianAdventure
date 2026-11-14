// A3.11 (plan SCUMM): visibilidad de hotspots por estado (src/systems/HotspotVisibility.ts) y que el hotspot oculto no
// tape al de debajo (src/systems/SceneDataLoader.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/hotspot-visibility.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { hotspotVisible, conditionHolds } = await import('../src/systems/HotspotVisibility.ts');
const { SceneDataLoader } = await import('../src/systems/SceneDataLoader.ts');

const state = (flags = {}, items = []) => [(f) => Boolean(flags[f]), (i) => items.includes(i)];

test('hideWhenFlag: oculto con la flag «ya cogido», también si el objeto ya salió del inventario', () => {
  const hs = { hideWhenFlag: 'found_broken_mouse' };
  assert.equal(hotspotVisible(hs, ...state()), true);
  assert.equal(hotspotVisible(hs, ...state({ found_broken_mouse: true }, ['broken_mouse'])), false);
  assert.equal(hotspotVisible(hs, ...state({ found_broken_mouse: true }, [])), false, 'gastado: sigue oculto');
});

test('hideWhen: todas las condiciones (la lata de upstairs vuelve si la gastas)', () => {
  const hs = { hideWhen: ['has_energy_drink', 'item:energy_drink'] };
  assert.equal(hotspotVisible(hs, ...state()), true);
  assert.equal(hotspotVisible(hs, ...state({ has_energy_drink: true }, ['energy_drink'])), false);
  assert.equal(hotspotVisible(hs, ...state({ has_energy_drink: true }, [])), true);
  assert.equal(conditionHolds('!item:x', ...state()), true);
  assert.equal(conditionHolds('mal escrita', ...state()), null);
  assert.equal(hotspotVisible({ hideWhen: 'mal escrita' }, ...state()), true, 'una condición mal escrita no oculta (el linter la marca)');
});

test('showWhenFlag sigue igual', () => {
  assert.equal(hotspotVisible({ showWhenFlag: 'x' }, ...state()), false);
  assert.equal(hotspotVisible({ showWhenFlag: 'x' }, ...state({ x: true })), true);
});

test('un hotspot oculto no tapa al de debajo y priority gana al orden', () => {
  const desk = { id: 'desk', name: 'Desk', bounds: { x: 0, y: 0, w: 50, h: 50 }, scripts: {} };
  const mouse = { id: 'mouse', name: 'Mouse', bounds: { x: 10, y: 10, w: 5, h: 5 }, scripts: {}, priority: 1, hideWhenFlag: 'found' };
  const loader = new SceneDataLoader({ regions: { hotspots: [desk, mouse], triggers: [] } });
  assert.equal(loader.getHotspotAtPct(12, 12)?.id, 'mouse', 'priority 1 gana aunque vaya después');
  const vis = (flags) => (hs) => hotspotVisible(hs, (f) => Boolean(flags[f]), () => false);
  assert.equal(loader.getHotspotAtPct(12, 12, vis({}))?.id, 'mouse');
  assert.equal(loader.getHotspotAtPct(12, 12, vis({ found: true }))?.id, 'desk', 'cogido: el clic va a la mesa');
  assert.equal(loader.getHotspotAtPct(40, 40, vis({}))?.id, 'desk');
});

test('basement: el ratón se oculta con found_broken_mouse y está encima del ratón dibujado (dentro de la mesa)', () => {
  const s = JSON.parse(readFileSync(new URL('../assets/scenes/basement/scene.json', import.meta.url), 'utf8'));
  const loader = new SceneDataLoader(s);
  const mouse = s.regions.hotspots.find((h) => h.id === 'hs_dead_mouse');
  const cx = mouse.bounds.x + mouse.bounds.w / 2, cy = mouse.bounds.y + mouse.bounds.h / 2;
  const vis = (flags) => (hs) => hotspotVisible(hs, (f) => Boolean(flags[f]), () => false);
  assert.equal(loader.getHotspotAtPct(cx, cy, vis({}))?.id, 'hs_dead_mouse');
  assert.equal(loader.getHotspotAtPct(cx, cy, vis({ found_broken_mouse: true }))?.id, 'hs_left_desk');
  const ov = s.conditionalOverlays.find((co) => co.id === 'mouse_taken');
  assert.equal(ov.flag, 'found_broken_mouse');
});

// A3.12 (plan SCUMM): blockedAreas condicionales (`when`), la huella del lambo de outside. Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/blocked-when.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { activeBlockedAreas, blockedAreasKey, sceneObstacles } = await import('../src/systems/WalkMotion.ts');
const { conditionHolds } = await import('../src/systems/HotspotVisibility.ts');
const { NavGrid } = await import('../src/systems/Pathfinding.ts');

const holdsWith = (flags = {}, items = []) => (c) => conditionHolds(c, (f) => Boolean(flags[f]), (i) => items.includes(i)) === true;

test('sin `when` bloquea siempre; con `when` solo si se cumplen todas', () => {
  const areas = [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 10, y: 10, w: 5, h: 5, when: 'pzbot_crashed' },
    { x: 20, y: 20, w: 5, h: 5, when: ['pzbot_crashed', '!item:key'] },
  ];
  assert.equal(activeBlockedAreas(areas, holdsWith()).length, 1);
  assert.equal(activeBlockedAreas(areas, holdsWith({ pzbot_crashed: true })).length, 3);
  assert.equal(activeBlockedAreas(areas, holdsWith({ pzbot_crashed: true }, ['key'])).length, 2);
  assert.deepEqual(activeBlockedAreas(areas, holdsWith())[0], { x: 0, y: 0, w: 1, h: 1 }, 'sin la propiedad when en la salida');
  assert.equal(activeBlockedAreas(undefined, holdsWith()).length, 0);
  assert.equal(blockedAreasKey(areas, holdsWith()), '100');
  assert.equal(blockedAreasKey(areas, holdsWith({ pzbot_crashed: true })), '111');
});

test('outside: con pzbot_crashed Dex no pisa la huella del lambo y sigue pudiendo cruzar por delante', () => {
  const sd = JSON.parse(readFileSync(new URL('../assets/scenes/outside/scene.json', import.meta.url), 'utf8'));
  const lambo = sd.blockedAreas.find((b) => b.when === 'pzbot_crashed');
  assert.ok(lambo, 'outside tiene un blockedArea con when: pzbot_crashed');
  const mid = { x: lambo.x + lambo.w / 2, y: lambo.y + lambo.h / 2 };
  // el centro de la huella cae en suelo andable (si no, el obstáculo no serviría de nada)
  const grid = (flags) => new NavGrid(sd.walkableAreas, sceneObstacles(sd.walkableAreas, activeBlockedAreas(sd.blockedAreas, holdsWith(flags)), sd.npcs));
  assert.equal(grid({}).isWalkable(mid.x, mid.y), true, 'sin coche se pisa');
  const g = grid({ pzbot_crashed: true });
  assert.equal(g.isWalkable(mid.x, mid.y), false, 'con coche no');
  // de un lado al otro del coche por delante (pies más abajo que la huella)
  assert.equal(g.canReach({ x: 60, y: 97 }, { x: 97, y: 97 }), true);
  // el punto de llegada del hotspot es andable y está delante del coche
  const hs = sd.regions.hotspots.find((h) => h.id === 'hs_lambo');
  assert.ok(hs?.walkTo, 'hs_lambo con walkTo');
  assert.equal(g.isWalkable(hs.walkTo.x, hs.walkTo.y), true);
  assert.ok(hs.walkTo.y > lambo.y + lambo.h, 'walkTo delante del coche');
});

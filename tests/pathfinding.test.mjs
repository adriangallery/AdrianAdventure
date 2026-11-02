// A2.1 (plan SCUMM): pathfinding A* por las zonas caminables (src/systems/Pathfinding.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/pathfinding.test.mjs (va en `npm run test:engine`)
// PATHFINDING_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const { NavGrid, isWalkableIn } = await import(process.env.PATHFINDING_PATH ?? '../src/systems/Pathfinding.ts');

/** Recorre la ruta (origen + puntos) con paso fino y comprueba que todo se pisa. */
function assertWalkablePath(nav, start, points, step = 0.05) {
  let a = start;
  for (const b of points) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const y = a.y + ((b.y - a.y) * i) / n;
      assert.ok(nav.isWalkable(x, y), `la ruta pisa (${x.toFixed(2)}, ${y.toFixed(2)}), que no es caminable`);
    }
    a = b;
  }
}

const near = (p, q, tol = 1e-6) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;
const last = (r) => r.points[r.points.length - 1];

test('rectángulo único: línea recta, un solo punto de paso y sin A*', () => {
  const nav = new NavGrid([{ x: 0, y: 80, w: 100, h: 20 }]);
  const r = nav.findPath({ x: 10, y: 90 }, { x: 90, y: 85 });
  assert.equal(r.points.length, 1);
  assert.ok(r.exact);
  assert.ok(near(r.points[0], { x: 90, y: 85 }));
  assert.equal(r.expanded, 0);
});

test('forma de L: rodea la esquina sin salirse y el suavizado deja pocos puntos', () => {
  // Suelo horizontal abajo y pasillo vertical a la izquierda (como mountain o clinic_exterior)
  const nav = new NavGrid([{ x: 10, y: 90, w: 80, h: 10 }, { x: 10, y: 50, w: 10, h: 45 }]);
  const start = { x: 85, y: 95 };
  const r = nav.findPath(start, { x: 15, y: 55 });
  assert.ok(r.exact);
  assert.ok(near(last(r), { x: 15, y: 55 }));
  assert.ok(r.points.length >= 2, 'tiene que haber al menos un punto de paso en la esquina');
  assert.ok(r.points.length <= 4, `demasiados puntos de paso tras suavizar: ${r.points.length}`);
  assertWalkablePath(nav, start, r.points);
});

test('obstáculo en medio: lo rodea por el lado libre', () => {
  const nav = new NavGrid([{ x: 0, y: 80, w: 100, h: 20 }], [{ x: 45, y: 80, w: 10, h: 12 }]);
  const start = { x: 30, y: 84 };
  const r = nav.findPath(start, { x: 70, y: 84 });
  assert.ok(r.exact);
  assert.ok(r.points.length >= 2);
  assertWalkablePath(nav, start, r.points);
  // Pasa por debajo del obstáculo
  assert.ok(r.points.some((p) => p.y > 92), JSON.stringify(r.points));
});

test('destino no caminable: el punto alcanzable más cercano (no atraviesa el bloqueo)', () => {
  const nav = new NavGrid([{ x: 0, y: 80, w: 100, h: 20 }], [{ x: 45, y: 80, w: 10, h: 12 }]);
  // Encima del suelo: se proyecta al borde superior
  const up = nav.findPath({ x: 20, y: 90 }, { x: 20, y: 40 });
  assert.ok(!up.exact);
  assert.ok(near(up.goal, { x: 20, y: 80 }, 1e-6), JSON.stringify(up.goal));
  // Dentro del obstáculo: el borde más cercano, fuera de él
  const inside = nav.findPath({ x: 20, y: 90 }, { x: 50, y: 90 });
  assert.ok(!inside.exact);
  assert.ok(nav.isWalkable(inside.goal.x, inside.goal.y));
  assert.ok(Math.abs(inside.goal.y - 92) < 0.2, JSON.stringify(inside.goal));
  assertWalkablePath(nav, { x: 20, y: 90 }, inside.points);
});

test('isla inalcanzable: va al punto más cercano de SU componente, no a la isla', () => {
  const nav = new NavGrid([{ x: 0, y: 90, w: 40, h: 10 }, { x: 60, y: 90, w: 40, h: 10 }]);
  assert.equal(nav.componentCount, 2);
  const start = { x: 10, y: 95 };
  const r = nav.findPath(start, { x: 80, y: 95 });
  assert.ok(!r.exact);
  assert.ok(r.goal.x <= 40 + 1e-6, `el destino cae en la isla: ${JSON.stringify(r.goal)}`);
  assert.ok(Math.abs(r.goal.x - 40) < 0.5);
  assert.equal(nav.canReach(start, { x: 80, y: 95 }), false);
  assert.equal(nav.canReach(start, { x: 30, y: 92 }), true);
  assertWalkablePath(nav, start, r.points);
});

test('origen fuera de zona: se recupera entrando por el punto más cercano', () => {
  const nav = new NavGrid([{ x: 0, y: 80, w: 100, h: 20 }]);
  const start = { x: 50, y: 60 };
  const r = nav.findPath(start, { x: 70, y: 90 });
  assert.ok(r.exact);
  assert.ok(r.points.length >= 2);
  assert.ok(nav.isWalkable(r.points[0].x, r.points[0].y));
  assert.ok(r.points[0].y >= 80 && r.points[0].y <= 81.5, JSON.stringify(r.points[0]));
  assertWalkablePath(nav, r.points[0], r.points.slice(1));
  assert.equal(nav.canReach(start, { x: 70, y: 90 }), true);
});

test('el suavizado no atraviesa paredes (U con un muro fino)', () => {
  // Dos pasillos verticales unidos abajo; el muro entre ellos es estrecho
  const nav = new NavGrid(
    [{ x: 10, y: 50, w: 10, h: 50 }, { x: 22, y: 50, w: 10, h: 50 }, { x: 10, y: 92, w: 22, h: 8 }],
  );
  const start = { x: 15, y: 55 };
  const r = nav.findPath(start, { x: 27, y: 55 });
  assert.ok(r.exact);
  assertWalkablePath(nav, start, r.points, 0.02);
  assert.ok(r.points.some((p) => p.y > 90), 'tiene que bajar hasta el pasillo de abajo');
});

test('bordes: caminable incluye los bordes de walkableAreas y excluye los de blockedAreas', () => {
  const W = [{ x: 0, y: 80, w: 100, h: 20 }];
  const B = [{ x: 40, y: 80, w: 10, h: 5 }];
  assert.equal(isWalkableIn(W, B, 0, 80), true);
  assert.equal(isWalkableIn(W, B, 100, 100), true);
  assert.equal(isWalkableIn(W, B, 40, 82), false);
  assert.equal(isWalkableIn(W, B, 45, 85), false);
  assert.equal(isWalkableIn([], [], -5, 300), true, 'sin áreas se anda por todas partes');
  const free = new NavGrid([]);
  assert.ok(free.unrestricted);
  assert.ok(near(free.findPath({ x: 1, y: 1 }, { x: 99, y: 2 }).goal, { x: 99, y: 2 }));
});

test('coste acotado: rejilla 200×100 con obstáculo, ruta larga en pocos ms', () => {
  // Toda la imagen caminable con un muro casi completo en medio: obliga a A* a recorrer media rejilla
  const nav = new NavGrid([{ x: 0, y: 0, w: 100, h: 100 }], [{ x: 49, y: 0, w: 2, h: 95 }]);
  assert.ok(nav.cellCount <= 200 * 100, `celdas: ${nav.cellCount}`);
  const start = { x: 5, y: 5 };
  const target = { x: 95, y: 5 };
  nav.findPath(start, target); // calentamiento del JIT
  const runs = 20;
  const t0 = performance.now();
  let r;
  for (let i = 0; i < runs; i++) r = nav.findPath(start, target);
  const ms = (performance.now() - t0) / runs;
  console.log(`# coste: ${nav.cols}×${nav.rows} celdas, ${r.expanded} nodos expandidos, ${r.points.length} puntos, ${ms.toFixed(2)} ms por búsqueda`);
  assert.ok(r.exact);
  assertWalkablePath(nav, start, r.points);
  assert.ok(r.points.some((p) => p.y > 95));
  // Margen amplio para CI; en el portátil/escritorio sale por debajo de 5 ms
  assert.ok(ms < 50, `búsqueda demasiado lenta: ${ms.toFixed(2)} ms`);
});

test('escenas reales: una sola componente, spawns y destinos de hotspots alcanzables', () => {
  const dir = new URL('../assets/scenes/', import.meta.url);
  for (const id of readdirSync(dir)) {
    const file = new URL(`${id}/scene.json`, dir);
    if (!existsSync(file)) continue;
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (!s.walkableAreas?.length) continue;
    const nav = new NavGrid(s.walkableAreas, s.blockedAreas ?? []);
    assert.equal(nav.componentCount, 1, `${id}: la zona caminable está partida en ${nav.componentCount} trozos`);
    const spawn = s.player.spawn;
    assert.ok(nav.isWalkable(spawn.x, spawn.y), `${id}: spawn fuera de zona`);
    for (const h of s.regions.hotspots) {
      if (!h.bounds) continue;
      const t = { x: h.bounds.x + h.bounds.w / 2, y: Math.min(h.bounds.y + h.bounds.h, 100) };
      // Si el destino del hotspot es caminable, tiene que poder alcanzarse desde el spawn y por una ruta limpia
      if (!nav.isWalkable(t.x, t.y)) continue;
      assert.ok(nav.canReach(spawn, t), `${id}/${h.id}: destino caminable pero inalcanzable`);
      const r = nav.findPath(spawn, t);
      assertWalkablePath(nav, spawn, r.points);
    }
    for (const b of s.blockedAreas ?? []) {
      // Un bloqueado tiene que caer sobre la zona caminable (si no, no sirve de nada)
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      assert.ok(s.walkableAreas.some((a) => c.x >= a.x && c.x <= a.x + a.w && c.y >= a.y && c.y <= a.y + a.h), `${id}: blockedArea fuera de la zona caminable`);
    }
  }
});

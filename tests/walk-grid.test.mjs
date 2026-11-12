// A1.14 (plan SCUMM): «se queda enganchado y cuesta que camine». Rejilla de origen × destino en CADA escena con la
// MISMA lógica que el juego (NavGrid de src/systems/Pathfinding.ts con los obstáculos de WalkMotion.sceneObstacles,
// como Player). Falla si un toque no mueve a Dex, si el punto final no es el destino (o el alcanzable más cercano),
// si la ruta pisa zona no andable o si mide más del doble del camino geodésico mínimo (Dijkstra propio, en la
// rejilla fina del test). También los puntos de llegada de hotspots (walkTo) y NPC (approachTalk) y el caso de la
// captura del 12-nov (Dex junto al pilar del porche de outside → toque en el carport).
// CI (Node 22): node --experimental-strip-types --test tests/walk-grid.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { NavGrid } = await import('../src/systems/Pathfinding.ts');
const { approachTalk } = await import('../src/systems/Facing.ts');
const W = await import('../src/systems/WalkMotion.ts');
const { walkPointFor } = await import('../src/systems/TapDecision.ts');

const ROOT = new URL('../assets/scenes/', import.meta.url);
const IDS = readdirSync(ROOT).filter((d) => {
  try {
    readFileSync(new URL(`${d}/scene.json`, ROOT));
    return true;
  } catch {
    return false;
  }
});
const SCENES = Object.fromEntries(IDS.map((id) => [id, JSON.parse(readFileSync(new URL(`${id}/scene.json`, ROOT), 'utf8'))]));
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function navOf(d) {
  return new NavGrid(d.walkableAreas, W.sceneObstacles(d.walkableAreas, d.blockedAreas, d.npcs));
}

/** Rejilla fina (0,5 × 0,5 %) de puntos andables y Dijkstra 8-vecinos: distancia geodésica de referencia. */
function geodesic(nav) {
  const S = 0.5;
  const cols = Math.ceil(100 / S);
  const rows = Math.ceil(100 / S);
  const open = new Uint8Array(cols * rows);
  const ctr = (i) => ({ x: ((i % cols) + 0.5) * S, y: (Math.floor(i / cols) + 0.5) * S });
  for (let i = 0; i < open.length; i++) {
    const c = ctr(i);
    open[i] = nav.isWalkable(c.x, c.y) ? 1 : 0;
  }
  const cellOf = (p) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(p.x / S)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(p.y / S)));
    let best = -1;
    let bd = Infinity;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const i = rr * cols + cc;
        if (!open[i]) continue;
        const dd = dist(ctr(i), p);
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    return best;
  };
  /** Distancias desde p a todas las celdas */
  const from = (p) => {
    const D = new Float64Array(open.length).fill(Infinity);
    const s = cellOf(p);
    if (s < 0) return { D, s };
    D[s] = dist(p, ctr(s));
    // Montículo simple
    const hk = [D[s]];
    const hn = [s];
    const push = (k, n) => {
      let i = hn.length;
      hk.push(k); hn.push(n);
      while (i > 0) {
        const q = (i - 1) >> 1;
        if (hk[q] <= k) break;
        hk[i] = hk[q]; hn[i] = hn[q]; i = q;
      }
      hk[i] = k; hn[i] = n;
    };
    const pop = () => {
      const top = hn[0];
      const topK = hk[0];
      const lk = hk.pop(); const ln = hn.pop();
      if (hn.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= hn.length) break;
          const r = l + 1;
          const c = r < hn.length && hk[r] < hk[l] ? r : l;
          if (hk[c] >= lk) break;
          hk[i] = hk[c]; hn[i] = hn[c]; i = c;
        }
        hk[i] = lk; hn[i] = ln;
      }
      return [topK, top];
    };
    const diag = Math.SQRT2 * S;
    while (hn.length) {
      const [k, i] = pop();
      if (k > D[i]) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (!open[j]) continue;
          if (dr && dc && (!open[r * cols + cc] || !open[rr * cols + c])) continue;
          const nk = k + (dr && dc ? diag : S);
          if (nk < D[j]) { D[j] = nk; push(nk, j); }
        }
      }
    }
    return { D, s };
  };
  return { from, cellOf, ctr };
}

function pathLength(start, points) {
  let len = 0;
  let a = start;
  for (const b of points) { len += dist(a, b); a = b; }
  return len;
}

/** Recorre la ruta con paso fino: todo tiene que pisarse (el primer tramo puede salir de un origen no andable). */
function offWalk(nav, start, points, step = 0.1) {
  let a = start;
  let first = !nav.isWalkable(start.x, start.y);
  for (const b of points) {
    if (!first) {
      const n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let i = 0; i <= n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        if (!nav.isWalkable(p.x, p.y)) return p;
      }
    }
    first = false;
    a = b;
  }
  return null;
}

/** Puntos andables repartidos por la zona andable (rejilla sobre el envolvente, hasta ~`max`) */
function walkableGrid(nav, d, max = 24) {
  const areas = d.walkableAreas ?? [];
  const minX = Math.min(...areas.map((a) => a.x));
  const minY = Math.min(...areas.map((a) => a.y));
  const maxX = Math.max(...areas.map((a) => a.x + a.w));
  const maxY = Math.max(...areas.map((a) => a.y + a.h));
  const pts = [];
  for (const nx of [6, 9, 12, 16]) {
    pts.length = 0;
    const ny = Math.max(2, Math.round(nx / 3));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const p = { x: minX + ((i + 0.5) * (maxX - minX)) / nx, y: minY + ((j + 0.5) * (maxY - minY)) / ny };
        if (nav.isWalkable(p.x, p.y)) pts.push(p);
      }
    }
    if (pts.length >= max / 2) break;
  }
  return pts.slice(0, max);
}

/** Destinos: rejilla de toda la escena (andables y no andables) + centro de cada hotspot + walkTo + NPC */
function targets(d) {
  const list = [];
  for (let x = 5; x < 100; x += 10) for (let y = 5; y < 100; y += 10) list.push({ via: 'rejilla', x, y });
  for (let x = 2.5; x < 100; x += 5) list.push({ via: 'suelo', x, y: 95 });
  for (const h of d.regions?.hotspots ?? []) {
    if (h.bounds) list.push({ via: `${h.id} (centro)`, x: h.bounds.x + h.bounds.w / 2, y: h.bounds.y + h.bounds.h / 2 });
    if (h.walkTo) list.push({ via: `${h.id}.walkTo`, ...h.walkTo });
  }
  for (const n of d.npcs ?? []) if (n.position) list.push({ via: `${n.id}`, ...n.position });
  return list;
}

for (const id of IDS) {
  const d = SCENES[id];
  test(`${id}: desde cada origen andable, cada toque mueve a Dex al destino o al alcanzable más cercano, por ruta corta`, () => {
    const nav = navOf(d);
    if (nav.unrestricted) return;
    const geo = geodesic(nav);
    const starts = walkableGrid(nav, d);
    assert.ok(starts.length > 0, `${id}: sin puntos andables`);
    const tgs = targets(d);
    const fails = [];
    /** Puntos andables de la rejilla fina con su zona conexa (para «el alcanzable más cercano») */
    const fine = [];
    for (let x = 0.25; x < 100; x += 0.5) {
      for (let y = 0.25; y < 100; y += 0.5) if (nav.isWalkable(x, y)) fine.push({ x, y, comp: nav.componentAt({ x, y }) });
    }
    const nearestCache = new Map();
    for (const s of starts) {
      const { D } = geo.from(s);
      const comp = nav.componentAt(s);
      for (const t of tgs) {
        const r = nav.findPath(s, t);
        const end = r.points.length ? r.points[r.points.length - 1] : s;
        const tag = `${fmt(s)} → ${t.via} ${fmt(t)}`;
        if (dist(end, r.goal) > 1e-6) { fails.push(`${tag}: acaba en ${fmt(end)} y no en su goal ${fmt(r.goal)}`); continue; }
        if (nav.canReach(s, t)) {
          if (dist(r.goal, t) > 0.01) fails.push(`${tag}: alcanzable pero acaba en ${fmt(r.goal)}`);
        } else {
          // El alcanzable más cercano: ningún punto andable de su zona (rejilla fina) está claramente más cerca
          if (!nav.isWalkable(r.goal.x, r.goal.y) || nav.componentAt(r.goal) !== comp) {
            fails.push(`${tag}: el goal ${fmt(r.goal)} no se pisa o es de otra zona`);
            continue;
          }
          const dGoal = dist(r.goal, t);
          const key = `${comp}:${t.x}:${t.y}`;
          let best = nearestCache.get(key);
          if (best === undefined) {
            best = Infinity;
            for (const q of fine) if (q.comp === comp) best = Math.min(best, Math.hypot(q.x - t.x, q.y - t.y));
            nearestCache.set(key, best);
          }
          if (dGoal > best + 1.2) fails.push(`${tag}: acaba en ${fmt(r.goal)} a ${dGoal.toFixed(2)} y hay andable a ${best.toFixed(2)}`);
        }
        if (dist(s, r.goal) > 0.3 && r.points.length === 0) fails.push(`${tag}: no se mueve (ruta vacía)`);
        const off = offWalk(nav, s, r.points);
        if (off) fails.push(`${tag}: la ruta pisa ${fmt(off)}, no andable`);
        const gc = geo.cellOf(r.goal);
        const g = gc >= 0 ? D[gc] + dist(r.goal, geo.ctr(gc)) : Infinity;
        const len = pathLength(s, r.points);
        if (Number.isFinite(g) && len > 2 * g + 1.5) fails.push(`${tag}: ruta de ${len.toFixed(1)} % y la geodésica es ${g.toFixed(1)} %`);
      }
    }
    assert.deepEqual(fails.slice(0, 15), [], `${fails.length} fallos en ${id}`);
  });

  test(`${id}: hablar con cada NPC desde cualquier origen lleva a un punto andable de su zona`, () => {
    const nav = navOf(d);
    if (nav.unrestricted || !(d.npcs ?? []).length) return;
    const fails = [];
    for (const s of walkableGrid(nav, d, 12)) {
      const reach = (p) => nav.approach(s, p);
      for (const n of d.npcs ?? []) {
        if (!n.position) continue;
        const plan = approachTalk({ position: n.position, walkTo: n.walkTo, face: n.face }, s, reach, { aspect: d.render.world.width / d.render.world.height, playerHeight: 40 });
        if (!plan.walkTo) continue; // otra isla: habla sin andar (A2.2)
        const r = nav.findPath(s, plan.walkTo);
        if (dist(r.goal, plan.walkTo) > 1.5) fails.push(`${fmt(s)} → ${n.id}: llega a ${fmt(r.goal)} y no a ${fmt(plan.walkTo)}`);
      }
    }
    assert.deepEqual(fails, []);
  });
}

test('outside (captura 12-nov): de junto al pilar del porche al carport, a la acera, al buzón y a los arbustos: llega', () => {
  const d = SCENES.outside;
  const nav = navOf(d);
  const hs = Object.fromEntries(d.regions.hotspots.map((h) => [h.id, h]));
  // Pilar del porche: el borde derecho del porche, en el suelo y algo por encima (pies que el rig o la escala dejan fuera)
  const starts = [{ x: 46.5, y: 90 }, { x: 47, y: 85 }, { x: 44, y: 83 }, { x: 49.7, y: 84 }, { x: 49.7, y: 81.7 }];
  const taps = [
    { id: 'hs_carport', tap: { x: 77, y: 72 } },
    { id: 'hs_carport', tap: { x: 80, y: 86 } },
    { id: 'hs_path', tap: { x: 48, y: 92 } },
    { id: 'hs_mailbox', tap: { x: 60.5, y: 72 } },
    { id: 'hs_bushes', tap: { x: 18, y: 93 } },
    { id: 'hs_front_door', tap: { x: 34, y: 70 } },
  ];
  for (const s of starts) {
    for (const { id, tap } of taps) {
      const h = hs[id];
      const to = walkPointFor(tap, nav.canReach(s, tap), h.walkTo ?? null);
      const r = nav.findPath(s, to);
      assert.ok(r.points.length > 0, `${fmt(s)} → ${id}: no se mueve`);
      const end = r.points[r.points.length - 1];
      assert.ok(nav.isWalkable(end.x, end.y), `${fmt(s)} → ${id}: acaba en ${fmt(end)}, no andable`);
      // Llega a la vertical del destino (la x del carport o del buzón), no se queda en el porche
      assert.ok(Math.abs(end.x - to.x) < 2, `${fmt(s)} → ${id}: acaba en ${fmt(end)} lejos de ${fmt(to)}`);
    }
  }
});

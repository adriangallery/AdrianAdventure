// A2.12 (plan SCUMM): «walk limpio». Recorre las 13 escenas con la MISMA lógica que el juego (NavGrid de
// src/systems/Pathfinding.ts con los obstáculos de WalkMotion.sceneObstacles, approachHotspot/approachTalk de
// src/systems/Facing.ts con la Reach de Player.approachPct = NavGrid.approach) y falla si:
//  - un spawn (el de la escena o el de una transición que entra en ella) cae fuera de la zona andable, dentro de un
//    blockedArea o en la huella de una NPC;
//  - el punto de llegada de un hotspot, NPC o transición (walkTo explícito o el de Facing por defecto) cae fuera de lo
//    andable, en un obstáculo o en la huella de una NPC, o encima del propio objeto (dentro de sus bounds);
//  - un walkTo explícito no se pisa; un trigger no toca la zona andable (no se podría disparar).
// Y prueba la lógica pura de WalkMotion (velocidad sin patinar, orden por la y de los pies, huellas).
// CI (Node 22): node --experimental-strip-types --test tests/walk-clean.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { NavGrid } = await import('../src/systems/Pathfinding.ts');
const { approachHotspot, approachTalk, standPoint } = await import('../src/systems/Facing.ts');
const W = await import('../src/systems/WalkMotion.ts');
const { STRIDE_ART_PX } = await import('../src/systems/Footsteps.ts');
const { WALK_FRAME_MS, STEP_MS } = await import('../src/systems/PlayerAnim.ts');

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
const inRect = (p, r, eps = 1e-6) => p.x >= r.x - eps && p.x <= r.x + r.w + eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps;
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

/** Spawns que entran en cada escena: transiciones (goto) y ops de script con sceneId + spawn (gotoScene, fadeToScene…) */
const SPAWNS_IN = {};
for (const [from, d] of Object.entries(SCENES)) {
  for (const g of d.transitions?.goto ?? []) (SPAWNS_IN[g.targetScene] ??= []).push({ via: `${from}:${g.id}`, ...g.spawn });
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (typeof o.op === 'string' && typeof o.sceneId === 'string' && o.spawn && Number.isFinite(o.spawn.x)) {
      (SPAWNS_IN[o.sceneId] ??= []).push({ via: `${from}:${o.op}${path}`, x: o.spawn.x, y: o.spawn.y });
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk({ regions: d.regions, npcs: d.npcs, dialogues: d.dialogues, onEnter: d.onEnter, combos: d.combos, items: d.items }, '');
}

/**
 * Triggers que hoy no se pisan (ninguna parte cae en la zona andable) y se dejan así a sabiendas: ver
 * docs/progreso/A2.12.md. Si alguno empieza a pisarse, el test lo dice para quitarlo de aquí.
 */
const DEAD_TRIGGERS = new Set(['basement:tr_chapter3_intro', 'lobby:tr_to_frontdoor']);

function world(d) {
  const nav = new NavGrid(d.walkableAreas, W.sceneObstacles(d.walkableAreas, d.blockedAreas, d.npcs));
  const feet = (d.npcs ?? []).map((n) => ({ id: n.id, r: W.npcFootprint(n.position) }));
  /** Motivo por el que no vale como sitio donde estar el jugador, o null */
  const bad = (p) => {
    if (!nav.isWalkable(p.x, p.y)) {
      const b = (d.blockedAreas ?? []).find((r) => inRect(p, r));
      if (b) return `dentro de blockedArea ${JSON.stringify(b)}`;
      const f = feet.find((n) => inRect(p, n.r));
      return f ? `en la huella de ${f.id}` : 'fuera de la zona andable';
    }
    const f = feet.find((n) => inRect(p, n.r));
    return f ? `en la huella de ${f.id}` : null;
  };
  const opts = { aspect: d.render.world.width / d.render.world.height, playerHeight: 40 };
  return { nav, bad, opts };
}

/** Puntos desde los que puede llegar el jugador a la escena: su spawn y los de las transiciones que entran */
function origins(d) {
  const list = [{ via: 'player.spawn', ...d.player.spawn }, ...(SPAWNS_IN[d.id] ?? [])];
  return list.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

test('hay 13 escenas con zona andable', () => {
  assert.equal(IDS.length, 13, IDS.join(','));
  for (const id of IDS) assert.ok((SCENES[id].walkableAreas ?? []).length > 0, `${id} sin walkableAreas`);
});

for (const id of IDS) {
  const d = SCENES[id];
  const { nav, bad, opts } = world(d);

  test(`${id}: spawns dentro de lo andable y fuera de obstáculos`, () => {
    const errs = [];
    if (!d.player.hidePlayer) {
      const why = bad(d.player.spawn);
      if (why) errs.push(`player.spawn ${fmt(d.player.spawn)} ${why}`);
    }
    for (const s of SPAWNS_IN[id] ?? []) {
      const why = bad(s);
      if (why) errs.push(`spawn de ${s.via} ${fmt(s)} ${why}`);
    }
    assert.deepEqual(errs, []);
  });

  test(`${id}: puntos de llegada de hotspots y NPC (se para delante, no encima)`, () => {
    const errs = [];
    for (const o of origins(d)) {
      if (bad(o)) continue; // ya lo cuenta el test de spawns
      const reach = (p) => nav.approach(o, p);
      for (const h of d.regions?.hotspots ?? []) {
        if (h.walkTo && bad(h.walkTo)) errs.push(`${h.id}: walkTo explícito ${fmt(h.walkTo)} ${bad(h.walkTo)}`);
        const plan = approachHotspot(h, o, reach, opts);
        const at = plan.walkTo ?? o;
        const why = bad(at);
        if (why) errs.push(`${h.id} desde ${o.via}: llegada ${fmt(at)} ${why}`);
        // Encima del objeto: dentro de sus bounds y por encima de su borde de abajo (salvo walkTo puesto a mano)
        if (plan.walkTo && !h.walkTo && h.bounds && inRect(at, h.bounds, -0.01) && at.y < standPoint(h.bounds).y - 0.5) {
          errs.push(`${h.id} desde ${o.via}: llegada ${fmt(at)} encima del objeto ${JSON.stringify(h.bounds)}`);
        }
        if (h.verbs?.TALK || h.verbs?.talk) {
          const t = approachTalk(h, o, reach, opts);
          const tw = t.walkTo ?? o;
          if (bad(tw)) errs.push(`${h.id} (hablar) desde ${o.via}: llegada ${fmt(tw)} ${bad(tw)}`);
        }
      }
      for (const n of d.npcs ?? []) {
        if (n.walkTo && bad(n.walkTo)) errs.push(`${n.id}: walkTo explícito ${fmt(n.walkTo)} ${bad(n.walkTo)}`);
        // Desde el origen y desde los dos lados de la NPC (approachTalk elige el lado del jugador)
        const froms = [o, { x: n.position.x - 20, y: o.y }, { x: n.position.x + 20, y: o.y }].map((p) => nav.findPath(o, p).goal);
        for (const from of froms) {
          const t = approachTalk(n, from, (p) => nav.approach(from, p), opts);
          const at = t.walkTo ?? from;
          const why = bad(at);
          if (why) errs.push(`${n.id} desde ${fmt(from)}: llegada ${fmt(at)} ${why}`);
        }
      }
    }
    assert.deepEqual(errs, []);
  });

  test(`${id}: los triggers tocan la zona andable`, () => {
    const errs = [];
    for (const t of d.regions?.triggers ?? []) {
      const b = t.bounds;
      if (!b) continue;
      let hit = false;
      for (let x = b.x; x <= b.x + b.w + 1e-9 && !hit; x += Math.max(0.1, b.w / 20)) {
        for (let y = b.y; y <= b.y + b.h + 1e-9 && !hit; y += Math.max(0.1, b.h / 20)) hit = nav.isWalkable(x, y);
      }
      const known = DEAD_TRIGGERS.has(`${id}:${t.id}`);
      if (!hit && !known) errs.push(`${t.id} ${JSON.stringify(b)} no se pisa`);
      if (hit && known) errs.push(`${t.id} ya se pisa: quítalo de DEAD_TRIGGERS`);
    }
    assert.deepEqual(errs, []);
  });
}

// ── Lógica pura de WalkMotion ──────────────────────────────

test('velocidad: igual en píxeles en cualquier dirección (antes 3,2× más rápido en horizontal)', () => {
  const imgW = 3712;
  const imgH = 1152;
  const budget = 100;
  const h = W.stepToward(10, 0, budget, imgW, imgH);
  const v = W.stepToward(0, 10, budget, imgW, imgH);
  assert.ok(Math.abs(W.pctToWorldPx(h.movePct, 0, imgW, imgH) - budget) < 1e-9);
  assert.ok(Math.abs(W.pctToWorldPx(0, v.movePct, imgW, imgH) - budget) < 1e-9);
  // Sin pasarse del objetivo ni del tramo máximo
  assert.ok(Math.abs(W.stepToward(0.1, 0, 1e6, imgW, imgH).movePct - 0.1) < 1e-12);
  assert.ok(Math.abs(W.stepToward(10, 0, 1e6, imgW, imgH, 0.5).movePct - 0.5) < 1e-12);
  assert.deepEqual(W.stepToward(0, 0, 10, imgW, imgH), { movePct: 0, usedPx: 0 });
});

test('velocidad: escala con el tamaño de Dex (unidad de píxel × profundidad) y no patina en ninguna escena', () => {
  assert.ok(Math.abs(W.walkSpeedWorldPx(7, 1) / W.walkSpeedWorldPx(3.5, 1) - 2) < 1e-9);
  assert.ok(Math.abs(W.walkSpeedWorldPx(4, 0.5) / W.walkSpeedWorldPx(4, 1) - 0.5) < 1e-9);
  // Avance por zancada de sonido (Footsteps) y por ciclo de andar: dentro de un rango natural en cualquier escena,
  // porque la velocidad en píxeles de arte no depende de la escena (el reloj de la animación va × speedMultiplier)
  const stepMs = (STRIDE_ART_PX / W.WALK_ART_PX_PER_S) * 1000;
  assert.ok(stepMs >= STEP_MS * 0.9 && stepMs <= WALK_FRAME_MS * 2, `zancada cada ${stepMs.toFixed(0)} ms`);
  const cycle = W.artPxPerCycle(WALK_FRAME_MS * 3);
  assert.ok(cycle >= STRIDE_ART_PX * 1.5 && cycle <= STRIDE_ART_PX * 2.5, `ciclo ${cycle} px de arte`);
  for (const id of IDS) {
    const d = SCENES[id];
    const mul = W.speedMultiplier(d.player.speed);
    assert.ok(mul >= 0.5 && mul <= 1.6, `${id} speed ${d.player.speed}`);
  }
  assert.equal(W.speedMultiplier(undefined), 1);
  assert.equal(W.speedMultiplier(10_000), 1.6);
});

test('orden por la y de los pies: más abajo = delante, sin salir de [9, 10) ni tapar overlays/primer plano/UI', () => {
  assert.ok(W.actorDepth(90, true) > W.actorDepth(80));
  assert.ok(W.actorDepth(70, true) < W.actorDepth(80));
  assert.ok(W.actorDepth(80, true) > W.actorDepth(80), 'empate: el jugador delante');
  for (const y of [-10, 0, 50, 99.9, 100, 120, NaN]) {
    for (const p of [true, false]) {
      const dep = W.actorDepth(y, p);
      assert.ok(dep >= W.ACTOR_DEPTH_MIN && dep < W.ACTOR_DEPTH_MAX, `${y} ${p} → ${dep}`);
      assert.ok(dep < 12 && dep < 15, 'por debajo de overlays (12) y primer plano (15)');
    }
  }
});

test('huella de NPC: solo cuenta la de las NPC que están sobre el suelo', () => {
  const walk = [{ x: 0, y: 80, w: 100, h: 20 }];
  const obs = W.sceneObstacles(walk, [{ x: 1, y: 81, w: 1, h: 1 }], [{ position: { x: 50, y: 90 } }, { position: { x: 20, y: 60 } }]);
  assert.equal(obs.length, 2);
  assert.deepEqual(obs[1], W.npcFootprint({ x: 50, y: 90 }));
  const nav = new NavGrid(walk, obs);
  assert.ok(!nav.isWalkable(50, 90));
  // Ruta de un lado al otro de la NPC: la rodea
  const r = nav.findPath({ x: 40, y: 90 }, { x: 60, y: 90 });
  const pts = [{ x: 40, y: 90 }, ...r.points];
  for (let k = 1; k < pts.length; k++) assert.ok(nav.segmentClear(pts[k - 1], pts[k]));
});

// A2.2 (plan SCUMM): punto de llegada y orientación por hotspot/NPC (src/systems/Facing.ts) y NavGrid.approach
// (src/systems/Pathfinding.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/facing.test.mjs (va en `npm run test:engine`)
// FACING_PATH / PATHFINDING_PATH permiten apuntar a copias ya transpiladas a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const F = await import(process.env.FACING_PATH ?? '../src/systems/Facing.ts');
const { NavGrid } = await import(process.env.PATHFINDING_PATH ?? '../src/systems/Pathfinding.ts');
const { faceToward, faceSide, approachHotspot, approachTalk, lookFacing, standPoint, isFacing, TALK_DISTANCE } = F;

const scene = (id) => JSON.parse(readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
/** Reach de prueba: todo se alcanza tal cual */
const anywhere = (p) => ({ ...p });
/** Reach de prueba: suelo en la franja y ∈ [80, 100] y x ∈ [0, 100] (proyección) */
const floor = (p) => ({ x: Math.min(100, Math.max(0, p.x)), y: Math.min(100, Math.max(80, p.y)) });
/** Escena típica: fondo 3712×1152 y personaje de ≈ 50 % de alto (playerScale 6) */
const OPTS = { aspect: 3712 / 1152, playerHeight: 50 };
const near = (p, q, tol = 1e-6) => !!p && !!q && Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;

test('isFacing y standPoint', () => {
  for (const f of ['left', 'right', 'front', 'back']) assert.ok(isFacing(f));
  assert.ok(!isFacing('up'));
  assert.ok(!isFacing(undefined));
  assert.deepEqual(standPoint({ x: 10, y: 20, w: 10, h: 30 }), { x: 15, y: 50 });
  assert.deepEqual(standPoint({ x: 10, y: 90, w: 10, h: 30 }), { x: 15, y: 100 });
});

test('faceToward: perfil según el lado', () => {
  assert.equal(faceToward({ x: 50, y: 90 }, { x: 70, y: 70 }, OPTS), 'right');
  assert.equal(faceToward({ x: 50, y: 90 }, { x: 30, y: 70 }, OPTS), 'left');
});

test('faceToward: objeto alto en la pared o al fondo → back', () => {
  // Póster muy por encima de la cabeza, casi en la vertical
  assert.equal(faceToward({ x: 48, y: 83 }, { x: 49, y: 30 }, OPTS), 'back');
  // Puerta al fondo justo delante (centro a media altura, en la vertical)
  assert.equal(faceToward({ x: 34, y: 84 }, { x: 34, y: 67 }, OPTS), 'back');
  // Muy alto pero muy a un lado: de perfil
  assert.equal(faceToward({ x: 20, y: 90 }, { x: 60, y: 20 }, OPTS), 'right');
});

test('faceToward: a los pies → front', () => {
  assert.equal(faceToward({ x: 45.8, y: 95.4 }, { x: 45.8, y: 89.8 }, OPTS), 'front');
  assert.equal(faceToward({ x: 45, y: 90 }, { x: 46, y: 93 }, OPTS), 'front');
  // Sin opciones (aspecto 1, altura 20) sigue funcionando
  assert.equal(faceToward({ x: 50, y: 90 }, { x: 50, y: 89 }), 'front');
  assert.equal(faceToward({ x: 50, y: 90 }, { x: 50, y: 40 }), 'back');
});

test('approachHotspot: por defecto el centro-abajo, llevado a lo alcanzable, y girado hacia el hotspot', () => {
  const hs = { bounds: { x: 46.7, y: 27, w: 4.3, h: 20.5 } }; // póster del lobby
  const a = approachHotspot(hs, { x: 80, y: 95 }, floor, OPTS);
  assert.ok(near(a.walkTo, { x: 48.85, y: 80 }), JSON.stringify(a.walkTo));
  assert.equal(a.face, 'back');
  // Sin recorte: el punto de siempre, tal cual
  const b = approachHotspot({ bounds: { x: 40, y: 85, w: 10, h: 5 } }, { x: 10, y: 95 }, anywhere, OPTS);
  assert.ok(near(b.walkTo, { x: 45, y: 90 }));
  assert.equal(b.face, 'front'); // objeto en el suelo, a los pies
});

test('approachHotspot: si el suelo no llega bajo el objeto, se queda al lado y mira de perfil', () => {
  const onlyRight = (p) => ({ x: Math.max(60, p.x), y: Math.max(85, p.y) });
  const a = approachHotspot({ bounds: { x: 30, y: 60, w: 10, h: 20 } }, { x: 90, y: 90 }, onlyRight, OPTS);
  assert.ok(near(a.walkTo, { x: 60, y: 85 }));
  assert.equal(a.face, 'left');
});

test('approachHotspot: sin llegar (otra isla) no anda, pero se gira; sin bounds ni walkTo, nada', () => {
  const a = approachHotspot({ bounds: { x: 10, y: 60, w: 4, h: 10 } }, { x: 60, y: 90 }, () => null, OPTS);
  assert.equal(a.walkTo, null);
  assert.equal(a.face, 'left');
  const b = approachHotspot({}, { x: 60, y: 90 }, anywhere, OPTS);
  assert.deepEqual(b, { walkTo: null, face: null, aim: null });
});

test('approachHotspot: ya está en el punto → no anda', () => {
  const a = approachHotspot({ bounds: { x: 40, y: 85, w: 10, h: 5 } }, { x: 45, y: 90 }, anywhere, OPTS);
  assert.equal(a.walkTo, null);
  assert.equal(a.face, 'front');
});

test('approachHotspot: walkTo y face explícitos mandan', () => {
  const hs = { bounds: { x: 31.6, y: 54.1, w: 5, h: 26.2 }, walkTo: { x: 40, y: 92 }, face: 'left' };
  const a = approachHotspot(hs, { x: 70, y: 95 }, anywhere, OPTS);
  assert.ok(near(a.walkTo, { x: 40, y: 92 }));
  assert.equal(a.face, 'left');
  // walkTo explícito fuera de la zona: también se lleva a lo alcanzable
  const b = approachHotspot({ ...hs, walkTo: { x: 40, y: 70 } }, { x: 70, y: 95 }, floor, OPTS);
  assert.ok(near(b.walkTo, { x: 40, y: 80 }));
  // face inválido se ignora (se calcula)
  const c = approachHotspot({ ...hs, face: 'up' }, { x: 70, y: 95 }, anywhere, OPTS);
  assert.equal(c.face, 'left'); // la puerta queda a la izquierda de (40, 92)
});

test('approachTalk: NPC a distancia de conversación del lado del jugador, a su altura, mirándola', () => {
  const npc = { position: { x: 50, y: 90 } };
  const r = approachTalk(npc, { x: 85, y: 95 }, anywhere, OPTS);
  assert.ok(near(r.walkTo, { x: 50 + TALK_DISTANCE, y: 90 }));
  assert.equal(r.face, 'left');
  const l = approachTalk(npc, { x: 10, y: 95 }, anywhere, OPTS);
  assert.ok(near(l.walkTo, { x: 50 - TALK_DISTANCE, y: 90 }));
  assert.equal(l.face, 'right');
  assert.ok(TALK_DISTANCE >= 6 && TALK_DISTANCE <= 8);
});

test('approachTalk: si el lado del jugador no se pisa, va al otro', () => {
  const npc = { position: { x: 20, y: 90 } };
  // Solo se pisa x ≤ 25: el lado derecho (27) queda lejos de lo ideal; el izquierdo (13) se alcanza tal cual
  const leftOnly = (p) => ({ x: Math.min(25, p.x), y: p.y });
  const r = approachTalk(npc, { x: 24, y: 80 }, leftOnly, OPTS);
  assert.ok(near(r.walkTo, { x: 20 - TALK_DISTANCE, y: 90 }), JSON.stringify(r.walkTo));
  assert.equal(r.face, 'right');
});

test('approachTalk: ya a distancia de conversación → no anda, solo se gira', () => {
  const r = approachTalk({ position: { x: 50, y: 90 } }, { x: 44, y: 91 }, anywhere, OPTS);
  assert.equal(r.walkTo, null);
  assert.equal(r.face, 'right');
});

test('approachTalk: NPC en otra isla → no anda; walkTo y face explícitos mandan', () => {
  const r = approachTalk({ position: { x: 50, y: 60 } }, { x: 80, y: 95 }, () => null, OPTS);
  assert.equal(r.walkTo, null);
  assert.equal(r.face, 'left');
  const e = approachTalk({ position: { x: 50, y: 90 }, walkTo: { x: 30, y: 92 }, face: 'back' }, { x: 80, y: 95 }, anywhere, OPTS);
  assert.ok(near(e.walkTo, { x: 30, y: 92 }));
  assert.equal(e.face, 'back');
});

test('approachTalk sobre un hotspot: como una NPC plantada en su centro-abajo', () => {
  const r = approachTalk({ bounds: { x: 40, y: 70, w: 10, h: 20 } }, { x: 90, y: 90 }, anywhere, OPTS);
  assert.ok(near(r.walkTo, { x: 45 + TALK_DISTANCE, y: 90 }));
  assert.equal(r.face, 'left');
});

test('lookFacing: se gira desde donde está, sin usar el face del punto de llegada', () => {
  assert.equal(lookFacing({ bounds: { x: 10, y: 50, w: 5, h: 10 } }, { x: 60, y: 95 }, OPTS), 'left');
  assert.equal(lookFacing({ bounds: { x: 80, y: 50, w: 5, h: 10 }, face: 'back' }, { x: 20, y: 95 }, OPTS), 'right');
  assert.equal(lookFacing({ position: { x: 30, y: 90 } }, { x: 60, y: 95 }, OPTS), 'left');
  assert.equal(lookFacing({}, { x: 60, y: 95 }, OPTS), null);
  assert.equal(faceSide({ x: 30, y: 90 }, 30.1), 'front');
});

test('NavGrid.approach: el punto alcanzable más cercano en la isla del jugador, o null si es de otra isla', () => {
  const nav = new NavGrid([{ x: 0, y: 90, w: 40, h: 10 }, { x: 60, y: 90, w: 40, h: 10 }]);
  // Objeto en la pared encima de la isla izquierda: se va debajo
  assert.ok(near(nav.approach({ x: 10, y: 95 }, { x: 20, y: 50 }), { x: 20, y: 90 }));
  // Objeto encima de la otra isla: no se alcanza
  assert.equal(nav.approach({ x: 10, y: 95 }, { x: 80, y: 50 }), null);
  // En el hueco entre islas, más cerca de la propia: al borde de la propia
  assert.ok(near(nav.approach({ x: 10, y: 95 }, { x: 45, y: 95 }), { x: 40, y: 95 }));
  // Sin zonas caminables: el propio punto
  assert.deepEqual(new NavGrid([]).approach({ x: 1, y: 1 }, { x: 50, y: 50 }), { x: 50, y: 50 });
});

test('lobby real: TALK a la recepcionista anda hasta el mostrador y mira a la izquierda; el póster, de espaldas', () => {
  const s = scene('lobby');
  const nav = new NavGrid(s.walkableAreas, s.blockedAreas);
  const player = { ...s.player.spawn };
  const reach = (p) => nav.approach(player, p);
  const npc = s.npcs.find((n) => n.id === 'npc_receptionist');
  const t = approachTalk(npc, player, reach, OPTS);
  assert.ok(t.walkTo, 'tiene que andar hacia ella');
  assert.ok(nav.isWalkable(t.walkTo.x, t.walkTo.y));
  assert.ok(t.walkTo.x < player.x - 20, `se acerca: ${JSON.stringify(t.walkTo)}`);
  assert.equal(t.face, 'left');
  const poster = s.regions.hotspots.find((h) => h.id === 'hs_poster');
  const p = approachHotspot(poster, player, reach, OPTS);
  assert.ok(p.walkTo && nav.isWalkable(p.walkTo.x, p.walkTo.y));
  assert.equal(p.face, 'back');
});

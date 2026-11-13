// A2.17: lógica pura del revisor de proporción (scripts/lib/proportion-sweep.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isWalkableRects, gridPoints, nearestWalkable, sweepPoints, expectedDexPct, nearestRef, overlap,
  evaluatePosition, newFailures, failureKey, summarize, loadScaleRefs, loadSceneJson,
} from '../scripts/lib/proportion-sweep.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scene = {
  walkableAreas: [{ x: 0, y: 90, w: 100, h: 10 }],
  blockedAreas: [{ x: 40, y: 90, w: 10, h: 10 }],
  regions: { hotspots: [{ id: 'hs_door', bounds: { x: 10, y: 50, w: 6, h: 40 } }, { id: 'hs_box', bounds: { x: 70, y: 60, w: 5, h: 10 }, walkTo: { x: 72, y: 95 } }] },
  npcs: [{ id: 'npc_a', position: { x: 60, y: 92 } }],
};
const door = { id: 'hs_door', label: 'puerta', realHeightM: 2, box: { x: 10, y: 50, w: 6, h: 40 }, baseY: 90, foreground: false };
const bush = { id: 'hs_bush', label: 'arbusto', realHeightM: 1, box: { x: 80, y: 80, w: 10, h: 18 }, baseY: 98, foreground: true };
const doc = { scalePolicy: 'measure', refs: [door, bush] };

test('zona andable: rectángulos menos bloqueos', () => {
  assert.equal(isWalkableRects(scene, 5, 95), true);
  assert.equal(isWalkableRects(scene, 45, 95), false);
  assert.equal(isWalkableRects(scene, 5, 80), false);
});

test('rejilla: solo puntos andables y sin repetir', () => {
  const g = gridPoints(scene, 10, 5);
  assert.ok(g.length > 10);
  assert.ok(g.every((p) => isWalkableRects(scene, p.x, p.y)));
  assert.equal(new Set(g.map((p) => p.id)).size, g.length);
});

test('andable más cercano y puntos de llegada', () => {
  assert.deepEqual(nearestWalkable(scene, 13, 70), { x: 13, y: 90.5 });
  const pts = sweepPoints(scene, doc, { step: 20, stepY: 5 });
  assert.ok(pts.some((p) => p.kind === 'arrival' && p.id === 'hs_box' && p.x === 72 && p.y === 95), 'walkTo del hotspot');
  assert.ok(pts.some((p) => p.kind === 'arrival' && p.id === 'npc_a'));
  assert.ok(pts.some((p) => p.kind === 'ref' && p.id === 'hs_door:der'));
});

test('alto esperado: puerta de 2 m y 40 % → Dex 35 %', () => {
  assert.equal(expectedDexPct(door), 35);
  assert.equal(nearestRef([door, bush], 91).ref.id, 'hs_door');
  assert.equal(nearestRef([door], 70), null, 'base demasiado lejos');
  assert.equal(overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
});

const at = (o) => ({ x: 20, y: 91, feetX: 20, feetY: 91, box: { x: 18, y: 56, w: 4, h: 35 }, heightPct: 35, walkable: true, maskOk: null, cover: {}, ...o });

test('escala: dentro de ±15 % no falla; fuera sí; con scalePolicy fixed es informativa', () => {
  assert.equal(evaluatePosition(at(), doc).failures.length, 0);
  const big = evaluatePosition(at({ heightPct: 45 }), doc);
  assert.equal(big.failures[0].type, 'scale');
  assert.ok(big.failures[0].dev > 0.15);
  const fixed = evaluatePosition(at({ heightPct: 45 }), { ...doc, scalePolicy: 'fixed' });
  assert.equal(fixed.failures.length, 0);
  assert.equal(fixed.info[0].type, 'scale');
});

test('pies: fuera de la zona andable = fallo; fuera de la walkmask = info (el juego no la usa)', () => {
  assert.equal(evaluatePosition(at({ walkable: false }), doc).failures[0].type, 'feet');
  const wm = evaluatePosition(at({ maskOk: false }), doc);
  assert.equal(wm.failures.length, 0);
  assert.equal(wm.info.find((i) => i.type === 'walkmask')?.type, 'walkmask');
});

test('profundidad: primer plano que no tapa, y primer plano que tapa estando delante', () => {
  const behind = at({ x: 85, feetX: 85, y: 92, feetY: 92, box: { x: 83, y: 57, w: 4, h: 35 } });
  const occ = evaluatePosition(behind, doc);
  assert.equal(occ.failures.find((f) => f.type === 'occlusion')?.ref, 'hs_bush');
  assert.equal(evaluatePosition({ ...behind, cover: { hs_bush: 0.9 } }, doc).failures.filter((f) => f.type === 'occlusion').length, 0);
  const front = at({ x: 85, feetX: 85, y: 99, feetY: 99, box: { x: 83, y: 64, w: 4, h: 35 }, cover: { hs_bush: 0.8 } });
  assert.equal(evaluatePosition(front, doc).failures.find((f) => f.type === 'overdraw')?.ref, 'hs_bush');
});

test('base de fallos conocidos: solo cuentan los nuevos', () => {
  const pos = { kind: 'grid', id: 'g1', failures: [{ type: 'feet' }, { type: 'scale', ref: 'hs_door' }] };
  const results = [{ scene: 's', positions: [pos] }];
  assert.equal(newFailures(results, { known: [] }).length, 2);
  assert.deepEqual(newFailures(results, { known: [failureKey('s', pos, pos.failures[0])] }), ['s|scale|hs_door|grid:g1']);
  const sum = summarize('s', [{ ...pos, score: 2, x: 1, y: 2 }, { kind: 'grid', id: 'g2', failures: [], score: 0 }]);
  assert.deepEqual(sum.byType, { feet: 1, scale: 1 });
  assert.equal(sum.failing, 1);
});

test('todas las escenas tienen scale-refs.json válido y outside es de escala fija', () => {
  const scenes = readdirSync(join(ROOT, 'assets/scenes')).filter((s) => existsSync(join(ROOT, 'assets/scenes', s, 'scene.json')));
  for (const s of scenes) {
    const r = loadScaleRefs(ROOT, s);
    assert.ok(r, `${s}: falta scale-refs.json`);
    assert.equal(r.scene, s);
    assert.ok(['measure', 'fixed'].includes(r.scalePolicy), s);
    assert.ok(r.refs.length >= 1, s);
    for (const ref of r.refs) {
      assert.ok(ref.realHeightM > 0 && typeof ref.baseY === 'number' && typeof ref.foreground === 'boolean', `${s} ${ref.id}`);
      if (!ref.npc) assert.ok(ref.box && ref.box.h > 0, `${s} ${ref.id}: caja`);
    }
    assert.ok(sweepPoints(loadSceneJson(ROOT, s), r).length > 5, `${s}: pocos puntos`);
  }
  assert.equal(loadScaleRefs(ROOT, 'outside').scalePolicy, 'fixed');
});

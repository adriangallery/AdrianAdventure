// A2.11: proporción de Dex (scripts/lib/proportion.mjs). Puro: node --experimental-strip-types --test tests/proportion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolvePixelScale, depthFactor, heightPct, evaluateScene, groupProblems, pngHeight, loadRefs, loadScene, loadGlobal,
  evaluateAll, markdownTable, DOOR_RANGE, NPC_TOL, SAME_DEPTH_TOL, MAX_DEPTH_CHANGE, depthChange, scaleModeProblems,
} from '../scripts/lib/proportion.mjs';
import * as PS from '../src/systems/PixelScale.ts';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('las fórmulas repetidas coinciden con src/systems/PixelScale.ts', () => {
  const d = { yTop: 80, yBottom: 90, scaleTop: 0.5, scaleBottom: 1 };
  for (let y = 60; y <= 100; y += 0.5) assert.ok(near(depthFactor(d, y), PS.depthFactor(d, y)), `y ${y}`);
  for (const sc of [{ pixelScale: 4 }, { player: { playerScale: 3.9 } }, {}, null, { pixelScale: 0.1 }]) {
    assert.equal(resolvePixelScale(sc, { pixelScale: 6 }), PS.resolvePixelScale(sc, { pixelScale: 6 }));
  }
  assert.ok(near(heightPct({ pixelScale: 5.5, _imgH: 1152 }, null, 100), PS.artHeightPct(103, 5.5, 1152)));
  assert.ok(near(heightPct({ depthScale: d, _imgH: 1152 }, null, 85), PS.artHeightPct(103, 5.5, 1152, 0.75)));
});

test('heightPct usa el alto real del fondo antes que render.world', () => {
  assert.ok(near(heightPct({ render: { world: { height: 1024 } }, _imgH: 1152 }, null, 100), PS.artHeightPct(103, 5.5, 1152)));
  assert.ok(near(heightPct({ render: { world: { height: 1024 } } }, null, 100), PS.artHeightPct(103, 5.5, 1024)));
});

test('pngHeight lee la cabecera IHDR', () => {
  const buf = readFileSync(new URL('../assets/scenes/lobby/background.png', import.meta.url)).subarray(0, 32);
  assert.equal(pngHeight(buf), 1152);
  assert.equal(pngHeight(Buffer.from('no es un png, no es un png, no')), null);
});

const door = (top, bottom) => ({ scene: 'x', reference: { label: 'puerta', kind: 'door', top, bottom }, positions: { front: { x: 50, y: 98 }, frontL: { x: 10, y: 98 }, ref: { x: 50, y: 95 } }, sameDepth: [['front', 'frontL']] });

test('evaluateScene: puerta dentro y fuera de 0,80-1,05', () => {
  assert.deepEqual(DOOR_RANGE, [0.8, 1.05]);
  const sc = { _imgH: 1152 }; // Dex 49,18 %
  assert.deepEqual(evaluateScene(door(36, 87), sc, null).problems, []); // 0,96
  assert.match(evaluateScene(door(19, 96), sc, null).problems[0], /0.64 fuera de 0.8-1.05/);
  assert.match(evaluateScene(door(52, 75), sc, null).problems[0], /2.14 fuera/);
  // Excepción razonada: se mide pero no falla
  const ex = { ...door(52, 75), exception: 'plano general' };
  const r = evaluateScene(ex, sc, null);
  assert.deepEqual(r.problems, []);
  assert.equal(r.row.exception, 'plano general');
  assert.equal(r.row.ratio, 2.14);
});

test('evaluateScene: mueble con su rango declarado', () => {
  const ref = { scene: 'x', reference: { label: 'mesa', kind: 'furniture', top: 61, bottom: 88, expected: [2, 2.7] }, positions: { front: { x: 1, y: 99 } } };
  assert.match(evaluateScene(ref, { _imgH: 1152 }, null).problems[0], /1.82 fuera de 2-2.7/);
  assert.deepEqual(evaluateScene(ref, { pixelScale: 7, _imgH: 1152 }, null).problems, []);
});

test('evaluateScene: misma profundidad (≤ 20 %) y NPC (±10 %) con medidas del juego', () => {
  assert.equal(SAME_DEPTH_TOL, 0.2);
  assert.equal(NPC_TOL, 0.1);
  const meas = { front: 50, frontL: 38, ref: 45 };
  const r = evaluateScene(door(36, 87), { _imgH: 1152 }, null, (y, x, k) => meas[k]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /misma profundidad/);
  const sc = { _imgH: 1152, depthScale: { yTop: 80, yBottom: 90, scaleTop: 0.5, scaleBottom: 1 }, npcs: [{ id: 'npc_a', position: { y: 85 } }] };
  // Analítico: la NPC sigue a Dex (factor 0,75 en y 85)
  assert.deepEqual(evaluateScene({ scene: 'x', positions: {} }, sc, null).problems, []);
  // Medida: la NPC a escala 5,5 × 1 (sin profundidad) cuando Dex a su y va a 5,5 × 0,75 → +33 %
  const bad = evaluateScene({ scene: 'x', positions: {} }, sc, null, undefined, { npc_a: 5.5 });
  assert.match(bad.problems[0], /npc_a a 1.33×/);
  assert.deepEqual(evaluateScene({ scene: 'x', positions: {} }, sc, null, undefined, { npc_a: 5.5 * 0.75 * 1.05 }).problems, []);
});

test('groupProblems: plano delantero de escenas contiguas ≤ 20 %', () => {
  const rows = [{ scene: 'a', dex: { front: 62.6 } }, { scene: 'b', dex: { front: 49.2 } }, { scene: 'c', dex: { front: 58.1 } }];
  assert.match(groupProblems([{ name: 'casa', scenes: ['a', 'b'] }], rows)[0], /grupo casa/);
  assert.deepEqual(groupProblems([{ name: 'casa', scenes: ['a', 'c'] }], rows), []);
});

test('qa/proportion-refs.json: las 13 escenas, referencias medibles y posiciones andables', () => {
  const refs = loadRefs();
  const ids = refs.scenes.map((r) => r.scene).sort();
  assert.deepEqual(ids, ['basement', 'clinic_exterior', 'clinic_interior', 'epilogue_outside', 'lobby', 'memelab', 'mountain', 'outside', 'recovery_pool', 'rooftop', 'server_room', 'treatment_room', 'upstairs']);
  for (const r of refs.scenes) {
    const sc = loadScene(r.scene);
    assert.ok(sc, r.scene);
    assert.ok(r.reference && r.reference.top < r.reference.bottom, `${r.scene}: referencia`);
    if (r.reference.kind !== 'door') assert.ok(Array.isArray(r.reference.expected) && r.reference.why, `${r.scene}: mueble sin rango razonado`);
    if (r.exception && !r.positions?.ref) continue; // A2.13: outside es excepción del cociente pero se mide entera
    for (const k of ['front', 'ref']) assert.ok(r.positions[k], `${r.scene}: falta la posición ${k}`);
    // Todas las posiciones caen dentro de un rectángulo andable
    for (const [k, p] of Object.entries(r.positions)) {
      const inside = (sc.walkableAreas || []).some((a) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h);
      assert.ok(inside, `${r.scene}.${k} (${p.x}, ${p.y}) fuera de walkableAreas`);
    }
  }
});

test('las escenas del repo cumplen las referencias (lo que exige la demo, en analítico)', () => {
  const { rows, problems } = evaluateAll(loadRefs());
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 13);
  assert.match(markdownTable([], rows), /\| lobby \|/);
  assert.equal(loadGlobal().pixelScale, 5.5);
});

// ── A2.13: escala fija en outside y cambio de tamaño ≤ 25 % en el resto ──

test('A2.13: depthChange y scaleModeProblems', () => {
  assert.equal(MAX_DEPTH_CHANGE, 0.25);
  assert.equal(depthChange(null), 0);
  assert.ok(near(depthChange({ yTop: 59, yBottom: 86.5, scaleTop: 0.35, scaleBottom: 1 }), 0.65));
  assert.ok(near(depthChange({ yTop: 59, yBottom: 86.5, scaleTop: 0.75, scaleBottom: 1 }), 0.25));
  assert.ok(near(depthChange({ yTop: 59, yBottom: 86.5, scaleTop: 1, scaleBottom: 0.8 }), 0.2));
  const ds = (top) => ({ depthScale: { yTop: 80, yBottom: 95, scaleTop: top, scaleBottom: 1 } });
  assert.deepEqual(scaleModeProblems({ scene: 'x', scale: 'fixed' }, {}), []);
  assert.deepEqual(scaleModeProblems({ scene: 'x', scale: 'fixed' }, ds(1)), [], 'scaleTop = scaleBottom es fija');
  assert.match(scaleModeProblems({ scene: 'x', scale: 'fixed' }, ds(0.9))[0], /escala fija/);
  assert.deepEqual(scaleModeProblems({ scene: 'x', scale: 'variable' }, ds(0.75)), []);
  assert.match(scaleModeProblems({ scene: 'x', scale: 'variable' }, ds(0.5))[0], /50 %/);
  assert.match(scaleModeProblems({ scene: 'x', scale: 'variable' }, {})[0], /fixed/);
  assert.match(scaleModeProblems({ scene: 'x' }, {})[0], /falta scale/);
});

test('A2.13: evaluateScene en una escena fija exige el mismo alto en todas las posiciones', () => {
  const ref = { scene: 'x', scale: 'fixed', positions: { a: { x: 50, y: 99 }, b: { x: 40, y: 83 } } };
  assert.deepEqual(evaluateScene(ref, { pixelScale: 4.5, _imgH: 1152 }, null).problems, []);
  const bad = evaluateScene(ref, { pixelScale: 4.5, _imgH: 1152 }, null, (y) => (y < 90 ? 30 : 40)).problems;
  assert.ok(bad.some((p) => /escala fija y Dex mide de 30 % a 40 %/.test(p)));
});

test('A2.13: cada escena declara su modo; outside fija a 4,5 (el tamaño de la acera) y ningún cambio > 25 %', () => {
  const refs = loadRefs();
  for (const r of refs.scenes) {
    assert.ok(['fixed', 'variable'].includes(r.scale) && r.scaleWhy, `${r.scene}: scale/scaleWhy`);
    const sc = loadScene(r.scene);
    assert.deepEqual(scaleModeProblems(r, sc), [], r.scene);
    assert.ok(depthChange(sc.depthScale) <= MAX_DEPTH_CHANGE + 1e-9, r.scene);
  }
  const out = refs.scenes.find((r) => r.scene === 'outside');
  assert.equal(out.scale, 'fixed');
  assert.match(out.exception, /A2\.13/);
  const sc = loadScene('outside');
  assert.equal(sc.depthScale, undefined);
  assert.equal(resolvePixelScale(sc, loadGlobal()), 4.5);
  // Acera junto al buzón y puerta: el mismo alto (el de la acera de A2.11: 40,23 % del fondo)
  const acera = heightPct(sc, loadGlobal(), 93), puerta = heightPct(sc, loadGlobal(), 83);
  assert.ok(near(acera, puerta) && Math.abs(acera - 40.23) < 0.01, `${acera} / ${puerta}`);
  assert.equal(refs.scenes.find((r) => r.scene === 'epilogue_outside').scale, 'fixed', 'coherente con outside');
});

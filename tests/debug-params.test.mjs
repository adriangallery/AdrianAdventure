// A1.8 (plan SCUMM): los parámetros de depuración de la URL (?scene, ?skip, ?dev, ?hintAfter) no valen en el build de
// producción sin ?qa=1. Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/debug-params.test.mjs (va en `npm run test:engine`)
// DEBUG_PARAMS_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { debugParamsAllowed, gameUrlParams, DEBUG_PARAMS } = await import(
  process.env.DEBUG_PARAMS_PATH ?? '../src/config/debugParams.ts'
);

test('producción sin ?qa=1: ?scene, ?skip, ?dev y ?hintAfter se ignoran', () => {
  const p = gameUrlParams('?scene=treatment_room&skip&dev&hintAfter=1', false);
  assert.equal(debugParamsAllowed('?scene=treatment_room', false), false);
  for (const k of ['scene', 'skip', 'dev', 'hintAfter']) assert.equal(p.has(k), false, k);
});

test('producción con ?qa=1: valen (smoke, demos y walkthrough del CI)', () => {
  const p = gameUrlParams('?qa=1&scene=lobby&hintAfter=6', false);
  assert.equal(p.get('scene'), 'lobby');
  assert.equal(p.get('hintAfter'), '6');
  assert.equal(gameUrlParams('?qa=0&scene=lobby', false).has('scene'), false);
});

test('en dev valen siempre', () => {
  assert.equal(gameUrlParams('?scene=lobby&dev', true).get('scene'), 'lobby');
  assert.equal(gameUrlParams('?scene=lobby&dev', true).has('dev'), true);
});

test('los parámetros que no son de depuración pasan siempre (?trailer, ?record, ?qa)', () => {
  const p = gameUrlParams('?trailer&record', false);
  assert.equal(p.has('trailer'), true);
  assert.equal(p.has('record'), true);
  assert.deepEqual([...DEBUG_PARAMS].sort(), ['dev', 'hintAfter', 'scene', 'skip']);
});

test('main.ts, BootScene y GameScene leen la URL por gameUrlParams (nadie lee ?scene/?skip/?dev/?hintAfter a pelo)', () => {
  const files = ['src/main.ts', 'src/scenes/BootScene.ts', 'src/scenes/GameScene.ts'];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(src, /gameUrlParams\(window\.location\.search, import\.meta\.env\.DEV\)/, f);
    for (const m of src.matchAll(/new URLSearchParams\(window\.location\.search\)\.(?:get|has)\('([^']+)'\)/g)) {
      assert.ok(!DEBUG_PARAMS.includes(m[1]), `${f} lee ?${m[1]} sin gameUrlParams`);
    }
  }
});

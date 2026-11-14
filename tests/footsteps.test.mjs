// A4.4 (plan SCUMM): pasos por superficie, lógica pura (src/systems/Footsteps.ts), sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/footsteps.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  FootstepTracker, surfaceAt, stepSound, stepKey, STRIDE_ART_PX, MAX_STEP_JUMP_ART_PX, STEP_DETUNE_CENTS, STEP_VOLUME, STEP_VOLUME_A44, SURFACES, STEP_VARIANTS,
} = await import(process.env.FOOTSTEPS_PATH ?? '../src/systems/Footsteps.ts');

test('surfaceAt: el rectángulo de surfaces manda sobre footstep; sin nada, muda', () => {
  const audio = { footstep: 'gravel', surfaces: [{ x: 30, y: 80, w: 20, h: 10, footstep: 'wood' }] };
  assert.equal(surfaceAt(audio, 40, 85), 'wood');
  assert.equal(surfaceAt(audio, 10, 95), 'gravel');
  assert.equal(surfaceAt(audio, 30, 80), 'wood', 'el borde cuenta dentro');
  assert.equal(surfaceAt({ surfaces: [{ x: 0, y: 0, w: 10, h: 10, footstep: 'tile' }] }, 50, 50), null);
  assert.equal(surfaceAt({ footstep: null }, 1, 1), null);
  assert.equal(surfaceAt(null, 1, 1), null);
  assert.equal(surfaceAt({ footstep: 'tile', surfaces: [{ x: 0, y: 0, w: 10, h: 10 }] }, 5, 5), 'tile', 'un rectángulo sin footstep no cuenta');
});

test('el tracker da el primer paso tras media zancada y luego uno por zancada, alternando el pie', () => {
  const t = new FootstepTracker();
  const feet = [];
  for (let i = 0; i < 200; i++) {
    const f = t.advance(1);
    if (f !== null) feet.push({ at: i + 1, foot: f });
  }
  assert.equal(feet[0].at, STRIDE_ART_PX / 2);
  assert.equal(feet[1].at - feet[0].at, STRIDE_ART_PX);
  assert.deepEqual(feet.slice(0, 4).map((f) => f.foot), [0, 1, 0, 1]);
  assert.equal(t.count(), feet.length);
});

test('parar y volver a andar: el siguiente paso suena otra vez tras media zancada; un salto grande no cuenta', () => {
  const t = new FootstepTracker();
  assert.equal(t.advance(STRIDE_ART_PX / 2), 0);
  t.advance(STRIDE_ART_PX * 0.9);
  t.reset();
  assert.equal(t.advance(STRIDE_ART_PX / 2 - 0.01), null);
  assert.equal(t.advance(0.02), 1, 'sigue alternando el pie');
  assert.equal(t.advance(MAX_STEP_JUMP_ART_PX + 1), null, 'teletransporte');
  assert.equal(t.advance(STRIDE_ART_PX / 2 - 0.01), null, 'y tras el salto se vuelve a empezar desde media zancada');
  assert.equal(t.advance(0), null);
  assert.equal(t.advance(-5), null);
});

test('stepSound: clave por superficie y pie, desafino dentro del margen y volumen según la profundidad', () => {
  assert.equal(stepKey('wood', 0), 'step_wood_1');
  assert.equal(stepKey('wood', 1), 'step_wood_2');
  const a = stepSound('gravel', 1, 0, 1);
  const b = stepSound('gravel', 1, 0.999, 1);
  assert.equal(a.key, 'step_gravel_2');
  assert.equal(a.detune, -STEP_DETUNE_CENTS);
  assert.equal(b.detune, STEP_DETUNE_CENTS);
  assert.equal(a.volume, STEP_VOLUME);
  assert.equal(STEP_VOLUME, 0.21, 'A4.7: los pasos de siempre suenan a la mitad (0,42 → 0,21)');
  assert.equal(STEP_VOLUME, STEP_VOLUME_A44 / 2);
  assert.ok(stepSound('gravel', 0, 0.5, 0.5).volume < STEP_VOLUME, 'más lejos, más bajo');
  assert.ok(stepSound('gravel', 0, 0.5, 0).volume > 0);
});

test('todas las superficies tienen sus dos efectos en assets/audio/sfx', async () => {
  const { existsSync } = await import('node:fs');
  for (const s of SURFACES) {
    for (let n = 1; n <= STEP_VARIANTS; n++) assert.ok(existsSync(new URL(`../assets/audio/sfx/step_${s}_${n}.mp3`, import.meta.url)), `falta step_${s}_${n}.mp3`);
  }
});

test('A8.4: variantes de paso: el pie manda en la paridad y randomPick elige la pareja dentro de STEP_VARIANTS', () => {
  assert.equal(stepKey('wood', 0, 1), 'step_wood_3');
  assert.equal(stepKey('wood', 1, 1), 'step_wood_4');
  assert.equal(STEP_VARIANTS % 2, 0, 'variantes por parejas (izquierdo/derecho)');
  for (const r of [0, 0.3, 0.6, 0.999]) {
    const n = Number(stepSound('tile', 0, 0.5, 1, r).key.split('_').pop());
    assert.ok(n % 2 === 1 && n <= STEP_VARIANTS, `pie izquierdo → impar ≤ ${STEP_VARIANTS} (${n})`);
  }
  assert.equal(stepSound('tile', 1, 0.5).key, 'step_tile_2', 'sin randomPick, la primera pareja (A4.4)');
});

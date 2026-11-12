// A4.7 (plan SCUMM): propuestas de pasos `?steps=a|b|c` (src/systems/StepVariants.ts), sus recetas y los clips de
// muestra (scripts/audio/demo-steps.mjs, solo la parte pura: sin ffmpeg).
// CI (Node 22): node --experimental-strip-types --test tests/step-variants.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const {
  STEP_VARIANTS, STEP_VARIANT_SPECS, QA_STEP_SEED, parseStepVariant, variantKey, variantUrl, variantFiles, variantSampleCount,
  StepPicker, stepSeed,
} = await import('../src/systems/StepVariants.ts');
const { SURFACES, STRIDE_ART_PX } = await import('../src/systems/Footsteps.ts');
const { VARIANT_RECIPES } = await import('../scripts/audio/step-variant-recipes.mjs');
const { renderStep, splitKey } = await import('../scripts/audio/make-steps.mjs');
const { highpass, rmsOf, peakOf, secs, SAMPLE_RATE } = await import('../scripts/audio/synth.mjs');
const { demoSteps, WALK_ART_PX_PER_S, LEGS } = await import('../scripts/audio/demo-steps.mjs');

test('parseStepVariant: a, b, c (sin distinguir mayúsculas); lo demás = los de siempre', () => {
  assert.equal(parseStepVariant('?steps=a'), 'a');
  assert.equal(parseStepVariant('?qa=1&steps=B'), 'b');
  assert.equal(parseStepVariant('?steps=c&scene=lobby'), 'c');
  assert.equal(parseStepVariant(''), null);
  assert.equal(parseStepVariant('?steps='), null);
  assert.equal(parseStepVariant('?steps=d'), null);
  assert.equal(parseStepVariant('?steps=ab'), null);
});

test('variantFiles: solo las superficies que tiene la variante, sin repetir, con todas sus muestras', () => {
  assert.equal(variantKey('a', 'wood', 3), 'stepa_wood_3');
  assert.equal(variantUrl('b', 'tile', 5), 'assets/audio/steps/b/tile_5.mp3');
  assert.equal(variantFiles('a', ['gravel', 'wood', 'gravel']).length, 8);
  assert.equal(variantFiles('b', ['tile']).length, 5, 'b lleva la muestra rara');
  assert.deepEqual(variantFiles('c', ['carpet', 'grass', 'concrete']), [], 'c es muda en moqueta, césped y cemento');
  assert.equal(variantFiles('c', ['metal', 'carpet']).length, 4);
});

test('cada variante tiene ≥ 4 muestras por superficie, su receta y su mp3', () => {
  for (const v of STEP_VARIANTS) {
    const spec = STEP_VARIANT_SPECS[v];
    assert.ok(spec.samples >= 4, `${v}: ${spec.samples} muestras`);
    for (const s of spec.surfaces) {
      assert.ok(SURFACES.includes(s), `${v}: superficie desconocida ${s}`);
      for (let n = 1; n <= variantSampleCount(v); n++) {
        assert.ok(VARIANT_RECIPES[v][variantKey(v, s, n)], `falta la receta ${variantKey(v, s, n)}`);
        assert.ok(existsSync(new URL(`../${variantUrl(v, s, n)}`, import.meta.url)), `falta ${variantUrl(v, s, n)}`);
      }
    }
    assert.equal(Object.keys(VARIANT_RECIPES[v]).length, spec.surfaces.length * variantSampleCount(v), `${v}: recetas de más`);
  }
  assert.deepEqual([...STEP_VARIANT_SPECS.a.surfaces].sort(), [...SURFACES].sort(), 'a cubre todas las superficies');
  assert.deepEqual([...STEP_VARIANT_SPECS.b.surfaces].sort(), [...SURFACES].sort(), 'b cubre todas las superficies');
});

test('StepPicker: nunca repite la última muestra de la superficie, la rara nunca dos seguidas, todas salen', () => {
  for (const v of STEP_VARIANTS) {
    const spec = STEP_VARIANT_SPECS[v];
    const p = new StepPicker(v, 1234);
    for (const s of spec.surfaces) {
      let last = 0;
      const seen = new Set();
      for (let i = 0; i < 400; i++) {
        const st = p.next(s);
        assert.notEqual(st.n, last, `${v}/${s}: repite ${st.n}`);
        assert.equal(st.key, variantKey(v, s, st.n));
        seen.add(st.n);
        last = st.n;
      }
      assert.equal(seen.size, variantSampleCount(v), `${v}/${s}: salen ${[...seen]}`);
    }
  }
});

test('StepPicker: tono, volumen y retraso dentro de su margen; más lejos, más bajo; c muda donde toca', () => {
  for (const v of STEP_VARIANTS) {
    const spec = STEP_VARIANT_SPECS[v];
    const p = new StepPicker(v, 99);
    const rates = new Set();
    for (let i = 0; i < 300; i++) {
      const st = p.next(spec.surfaces[0]);
      assert.ok(Math.abs(st.rate - 1) <= spec.rateJitter + 1e-9, `${v}: rate ${st.rate}`);
      assert.ok(st.volume >= spec.volume * (1 - spec.volJitter) - 1e-3 && st.volume <= spec.volume * (1 + spec.volJitter) + 1e-3, `${v}: volumen ${st.volume}`);
      assert.ok(st.delayMs >= 0 && st.delayMs <= spec.delayJitterMs, `${v}: retraso ${st.delayMs}`);
      assert.ok(st.delayMs < 50, 'el retraso no desincroniza del fotograma del andar (100 ms)');
      rates.add(st.rate);
    }
    assert.ok(rates.size > 20, `${v}: el tono varía`);
    const far = new StepPicker(v, 5).next(spec.surfaces[0], 0.3);
    assert.ok(far.volume < spec.volume * (1 - spec.volJitter) + 1e-3);
  }
  const c = new StepPicker('c', 1);
  for (const s of ['carpet', 'grass', 'concrete']) assert.equal(c.next(s), null);
  assert.ok(STEP_VARIANT_SPECS.c.volume < STEP_VARIANT_SPECS.a.volume, 'c es la más baja');
});

test('StepPicker: misma semilla, misma secuencia (?qa=1 usa QA_STEP_SEED)', () => {
  assert.equal(stepSeed(true, 0.7), QA_STEP_SEED);
  assert.notEqual(stepSeed(false, 0.7), QA_STEP_SEED);
  const run = (seed) => { const p = new StepPicker('b', seed); return Array.from({ length: 50 }, (_, i) => p.next(i % 2 ? 'tile' : 'gravel')); };
  assert.deepEqual(run(QA_STEP_SEED), run(QA_STEP_SEED));
  assert.notDeepEqual(run(QA_STEP_SEED), run(QA_STEP_SEED + 1));
});

test('recetas: deterministas, cortas, sin pasar de ±1; a casi sin agudos, c más corta que a', () => {
  const hf = (b) => rmsOf(highpass(highpass(b, 2500), 2500)) / rmsOf(b);
  for (const v of STEP_VARIANTS) {
    for (const key of Object.keys(VARIANT_RECIPES[v])) {
      assert.equal(splitKey(key).variant, v);
      const a = renderStep(key);
      assert.deepEqual(a, renderStep(key), `${key} no es determinista`);
      assert.ok(a.length >= secs(0.05) && a.length <= secs(0.5), `${key}: ${a.length / SAMPLE_RATE} s`);
      assert.ok(peakOf(a) <= 1 && peakOf(a) > 0.2, `${key}: pico ${peakOf(a)}`);
      if (v === 'a') assert.ok(hf(a) < 0.05, `${key}: demasiados agudos (${hf(a).toFixed(3)})`);
    }
  }
  assert.ok(renderStep('stepc_wood_1').length < renderStep('stepa_wood_1').length);
});

test('clip de muestra: mismo ritmo que el juego (una pisada por zancada), grava y luego baldosa, determinista', () => {
  for (const v of ['actual', 'a', 'b', 'c']) {
    const steps = demoSteps(v);
    assert.deepEqual(steps, demoSteps(v));
    const period = STRIDE_ART_PX / WALK_ART_PX_PER_S;
    assert.ok(steps.length >= 22 && steps.length <= 26, `${v}: ${steps.length} pisadas`);
    const firstLeg = steps.filter((s) => s.at < LEGS[0].secs);
    for (let i = 1; i < firstLeg.length; i++) {
      const gap = firstLeg[i].at - firstLeg[i - 1].at;
      assert.ok(Math.abs(gap - period) < 0.05, `${v}: hueco ${gap.toFixed(3)} s (zancada ${period.toFixed(3)} s)`);
    }
    assert.ok(firstLeg.every((s) => s.key.includes('gravel')));
    assert.ok(steps.filter((s) => s.at >= LEGS[0].secs).every((s) => s.key.includes('tile')));
    for (const s of steps) assert.ok(existsSync(new URL(`../${s.url}`, import.meta.url)), `falta ${s.url}`);
  }
  assert.ok(demoSteps('actual').every((s) => s.volume === 0.21), 'el actual, a mitad de volumen');
  assert.ok(demoSteps('b').some((s) => s.key.endsWith('_5')), 'el clip de b enseña la muestra rara');
});

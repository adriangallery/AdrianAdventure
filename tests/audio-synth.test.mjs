// A4.4 (plan SCUMM): el sintetizador y las recetas (scripts/audio/*), sin ffmpeg: solo el audio en memoria.
// CI (Node 22): node --test tests/audio-synth.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const synth = await import('../scripts/audio/synth.mjs');
const { RECIPES: SFX, SFX_KEYS, SURFACES } = await import('../scripts/audio/sfx-recipes.mjs');
const { renderSfx, seedOf } = await import('../scripts/audio/make-sfx.mjs');
const { RECIPES: AMB, LOOP_SEC, PAD_SEC, SEAM_SEC } = await import('../scripts/audio/ambience-recipes.mjs');
const { renderAmbience, configSource } = await import('../scripts/audio/make-ambience.mjs');

const { rng, osc, secs, seamless, padLoop, peakOf, rmsOf, wavBytes, SAMPLE_RATE } = synth;

test('rng con semilla: determinista y en [0, 1)', () => {
  const a = rng(42);
  const b = rng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(seedOf('step_wood_1'), seedOf('step_wood_2'));
});

test('osc: un seno de 441 Hz cruza por cero 882 veces por segundo (±2)', () => {
  const buf = osc('sine', 441, SAMPLE_RATE);
  let crossings = 0;
  for (let i = 1; i < buf.length; i++) if ((buf[i - 1] < 0) !== (buf[i] < 0)) crossings++;
  assert.ok(Math.abs(crossings - 882) <= 2, `cruces ${crossings}`);
});

test('seamless + padLoop: el bucle empalma sin salto y el relleno repite el principio', () => {
  const r = rng(7);
  const raw = new Float32Array(secs(2.5));
  for (let i = 0; i < raw.length; i++) raw[i] = r() * 2 - 1;
  const loop = seamless(raw, 0.5);
  assert.equal(loop.length, secs(2));
  const file = padLoop(loop, 0.25);
  assert.equal(file.length, secs(2.25));
  for (let i = 0; i < secs(0.25); i++) assert.equal(file[loop.length + i], loop[i]);
  // La costura: el final del bucle se fundió sobre el principio (potencia constante): sin discontinuidad de nivel
  const rmsHead = rmsOf(loop.subarray(0, secs(0.1)));
  const rmsTail = rmsOf(loop.subarray(loop.length - secs(0.1)));
  assert.ok(Math.abs(rmsHead - rmsTail) < 0.15, `rms cabeza ${rmsHead} cola ${rmsTail}`);
});

test('wavBytes: cabecera RIFF mono 16 bits a SAMPLE_RATE', () => {
  const b = wavBytes(new Float32Array(10));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt16LE(22), 1);
  assert.equal(b.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(b.readUInt32LE(40), 20);
});

test('cada receta de SFX es determinista, dura entre 20 ms y 3 s y no pasa de ±1', () => {
  for (const key of SFX_KEYS) {
    const a = renderSfx(key);
    const b = renderSfx(key);
    assert.deepEqual(a, b, `${key} no es determinista`);
    assert.ok(a.length >= secs(0.02) && a.length <= secs(3), `${key}: ${a.length / SAMPLE_RATE} s`);
    assert.ok(peakOf(a) <= 1 && peakOf(a) > 0.2, `${key}: pico ${peakOf(a)}`);
  }
});

test('las dos variantes de cada paso suenan distinto y hay receta para todas las superficies del motor', () => {
  for (const s of SURFACES) {
    assert.ok(SFX[`step_${s}_1`] && SFX[`step_${s}_2`], `faltan recetas de ${s}`);
    assert.notDeepEqual(renderSfx(`step_${s}_1`), renderSfx(`step_${s}_2`));
  }
});

test('cada receta tiene su mp3 en assets/audio/sfx y está en sfxKeys de PreloadScene', () => {
  const preload = readFileSync(new URL('../src/scenes/PreloadScene.ts', import.meta.url), 'utf8');
  const keys = [...preload.match(/const sfxKeys = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const key of SFX_KEYS) {
    assert.ok(existsSync(new URL(`../assets/audio/sfx/${key}.mp3`, import.meta.url)), `falta ${key}.mp3 (node scripts/audio/make-sfx.mjs)`);
    assert.ok(keys.includes(key), `${key} no está en sfxKeys de PreloadScene`);
  }
});

test('ambientes: duran LOOP_SEC + PAD_SEC, son periódicos y el config generado está al día', () => {
  for (const key of Object.keys(AMB)) {
    const { loop, file } = renderAmbience(key);
    assert.equal(loop.length, secs(LOOP_SEC), key);
    assert.equal(file.length, secs(LOOP_SEC + PAD_SEC), key);
    for (let i = 0; i < secs(PAD_SEC); i += 97) assert.equal(file[loop.length + i], loop[i], `${key}: el relleno no repite el principio`);
    assert.ok(peakOf(loop) <= 1 && rmsOf(loop) > 0.02, `${key}: pico ${peakOf(loop)} rms ${rmsOf(loop)}`);
    assert.ok(AMB[key].gain > 0 && AMB[key].gain <= 1);
  }
  assert.ok(SEAM_SEC > 0 && SEAM_SEC < LOOP_SEC);
  const current = readFileSync(new URL('../src/config/ambience.config.ts', import.meta.url), 'utf8');
  assert.equal(current, configSource(), 'src/config/ambience.config.ts no es lo que genera make-ambience.mjs');
});

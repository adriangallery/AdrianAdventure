// A4.5 (plan SCUMM): stingers (src/systems/Stingers.ts) y la estimación de tonalidad (scripts/audio/analyze-music.mjs).
// CI (Node 22): node --experimental-strip-types --test tests/stingers.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { stingerFor, goalStingers, transposeSemitones, isStingerKind, STINGER_KINDS, STINGER_SFX_KEYS, STINGER_MS } = await import(
  process.env.STINGERS_PATH ?? '../src/systems/Stingers.ts'
);
const { MUSIC_KEYS } = await import(process.env.MUSIC_CONFIG_PATH ?? '../src/config/music.config.ts');
const { detectKey, chroma, configSource, analyzeAll, NOTE_NAMES } = await import('../scripts/audio/analyze-music.mjs');

test('transposeSemitones: hasta una cuarta hacia arriba, si no hacia abajo', () => {
  assert.equal(transposeSemitones(0), 0);
  assert.equal(transposeSemitones(2), 2, 'Re: +2');
  assert.equal(transposeSemitones(5), 5, 'Fa: +5');
  assert.equal(transposeSemitones(7), -5, 'Sol: -5');
  assert.equal(transposeSemitones(9), -3, 'La: -3');
  assert.equal(transposeSemitones(11), -1);
  assert.equal(transposeSemitones(14), 2);
});

test('stingerFor: clip por clase y modo, desafino a la tónica y duración ajustada a la velocidad', () => {
  assert.deepEqual(stingerFor('item', null), { key: 'stinger_item', detune: 0, ms: 750 });
  assert.deepEqual(stingerFor('puzzle', { tonic: 2, mode: 'major' }), { key: 'stinger_puzzle_major', detune: 200, ms: Math.round(1300 / Math.pow(2, 200 / 1200)) });
  assert.equal(stingerFor('puzzle', { tonic: 4, mode: 'minor' }).key, 'stinger_puzzle_minor');
  assert.equal(stingerFor('chapter', { tonic: 7, mode: 'minor' }).detune, -500);
  assert.ok(stingerFor('chapter', { tonic: 7, mode: 'minor' }).ms > 2300, 'hacia abajo dura más');
  assert.equal(stingerFor('fail', { tonic: 4, mode: 'minor' }).key, 'stinger_fail', 'sin tercera: no cambia con el modo');
  assert.equal(stingerFor('item', { tonic: 4, mode: 'minor' }).key, 'stinger_item');
  for (const kind of STINGER_KINDS) assert.ok(isStingerKind(kind));
  assert.equal(isStingerKind('polka'), false);
});

test('goalStingers: un puzle por objetivo cumplido, un capítulo si avanza, nada la primera vez ni hacia atrás', () => {
  assert.deepEqual(goalStingers(null, { chapter: 1, done: 2 }), []);
  assert.deepEqual(goalStingers({ chapter: 1, done: 1 }, { chapter: 1, done: 1 }), []);
  assert.deepEqual(goalStingers({ chapter: 1, done: 1 }, { chapter: 1, done: 2 }), ['puzzle']);
  assert.deepEqual(goalStingers({ chapter: 1, done: 0 }, { chapter: 1, done: 2 }), ['puzzle', 'puzzle']);
  assert.deepEqual(goalStingers({ chapter: 1, done: 3 }, { chapter: 2, done: 0 }), ['chapter']);
  assert.deepEqual(goalStingers({ chapter: 2, done: 1 }, { chapter: 1, done: 3 }), [], 'una partida cargada más atrás no suena');
});

test('cada clip stinger_* existe, está en sfxKeys de PreloadScene y su duración cuadra con la receta', async () => {
  const preload = readFileSync(new URL('../src/scenes/PreloadScene.ts', import.meta.url), 'utf8');
  const { RECIPES } = await import('../scripts/audio/stinger-recipes.mjs');
  const { SAMPLE_RATE } = await import('../scripts/audio/synth.mjs');
  for (const key of STINGER_SFX_KEYS) {
    assert.ok(existsSync(new URL(`../assets/audio/sfx/${key}.mp3`, import.meta.url)), `falta ${key}.mp3`);
    assert.ok(preload.includes(`'${key}'`), `${key} no está en sfxKeys`);
    assert.ok(RECIPES[key], `${key} sin receta`);
    assert.equal(Math.round((RECIPES[key]().length / SAMPLE_RATE) * 1000), STINGER_MS[key], `${key}: STINGER_MS no cuadra con la receta`);
  }
});

test('detectKey: cromagramas sintéticos de Do mayor, La menor y Mi menor', () => {
  const vec = (notes) => NOTE_NAMES.map((_, i) => (notes.includes(i) ? 1 : 0.05));
  // Do mayor: do mi sol (con fa y la): tónica 0 mayor; La menor comparte notas pero pesa la, do, mi
  assert.deepEqual([detectKey(vec([0, 4, 7, 5, 9, 2, 11])).tonic, detectKey(vec([0, 4, 7, 5, 9, 2, 11])).mode], [0, 'major']);
  const amin = NOTE_NAMES.map((_, i) => ({ 9: 1, 0: 0.8, 4: 0.9, 2: 0.4, 5: 0.4, 7: 0.4, 11: 0.3 }[i] ?? 0.05));
  assert.deepEqual([detectKey(amin).tonic, detectKey(amin).mode], [9, 'minor']);
  const emin = NOTE_NAMES.map((_, i) => ({ 4: 1, 7: 0.9, 11: 0.8, 9: 0.4, 0: 0.4, 2: 0.4, 6: 0.3 }[i] ?? 0.05));
  assert.deepEqual([detectKey(emin).tonic, detectKey(emin).mode], [4, 'minor']);
});

test('chroma: un La 440 puro cae en la clase de altura 9', () => {
  const SR = 11025;
  const pcm = new Float32Array(SR * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
  const c = chroma(pcm);
  assert.equal(c.indexOf(Math.max(...c)), 9);
});

test('music.config.ts cubre todas las pistas y es lo que genera analyze-music.mjs (si hay ffmpeg)', { timeout: 120000 }, () => {
  const tracks = ['clinical', 'epilogue', 'retro-adventure', 'retroadrian', 'tension', 'vista'];
  for (const t of tracks) assert.ok(MUSIC_KEYS[t], `falta ${t} en MUSIC_KEYS`);
  const ffmpeg = spawnSync('ffmpeg', ['-version']);
  if (ffmpeg.error) { console.log('sin ffmpeg: no se recalcula la tonalidad'); return; }
  const current = readFileSync(new URL('../src/config/music.config.ts', import.meta.url), 'utf8');
  assert.equal(current, configSource(analyzeAll(() => {})), 'src/config/music.config.ts no es lo que genera analyze-music.mjs');
});

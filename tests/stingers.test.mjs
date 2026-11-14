// A4.5 (plan SCUMM): stingers (src/systems/Stingers.ts) y la estimación de tonalidad (scripts/audio/analyze-music.mjs).
// CI (Node 22): node --experimental-strip-types --test tests/stingers.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { stingerFor, eventStingerFor, goalStingers, transposeSemitones, isStingerKind, STINGER_KINDS, STINGER_SFX_KEYS, STINGER_MS, STINGER_GEN, STINGER_GEN_KEYS, STINGER_GEN_MAX_SHIFT } = await import(
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

test('A8.3b eventStingerFor: el grabado solo si encaja (modo y ≤ 2 semitonos) y no hay voz; si no, el sintetizado', () => {
  // sin música: el grabado tal cual
  assert.deepEqual(eventStingerFor('chapter', null), { key: 'stinger_gen_chapter_major', detune: 0, ms: STINGER_GEN.stinger_gen_chapter_major.ms });
  // Re mayor (dex, aventura): capítulo grabado en Do → +2
  const d = eventStingerFor('chapter', { tonic: 2, mode: 'major' });
  assert.equal(d.key, 'stinger_gen_chapter_major');
  assert.equal(d.detune, 200);
  assert.equal(d.ms, Math.round(STINGER_GEN.stinger_gen_chapter_major.ms / Math.pow(2, 200 / 1200)));
  // Sol mayor (adrianlab, final): el capítulo en Do quedaría a −5 → sintetizado; el puzle grabado (medido en Sol) va tal cual
  assert.equal(eventStingerFor('chapter', { tonic: 7, mode: 'major' }).key, 'stinger_chapter_major');
  assert.deepEqual(eventStingerFor('puzzle', { tonic: 7, mode: 'major' }), { key: 'stinger_gen_puzzle_major', detune: 0, ms: STINGER_GEN.stinger_gen_puzzle_major.ms });
  // Mi menor (sótano): no hay grabados en menor → sintetizados
  assert.equal(eventStingerFor('puzzle', { tonic: 4, mode: 'minor' }).key, 'stinger_puzzle_minor');
  assert.equal(eventStingerFor('chapter', { tonic: 4, mode: 'minor' }).key, 'stinger_chapter_minor');
  // fallo sin tercera: vale en menor si está cerca (Re menor, +2), no en Mi (+4)
  assert.equal(eventStingerFor('fail', { tonic: 2, mode: 'minor' }).key, 'stinger_gen_fail');
  assert.equal(eventStingerFor('fail', { tonic: 4, mode: 'minor' }).key, 'stinger_fail');
  // objeto: no hay grabado
  assert.deepEqual(eventStingerFor('item', null), stingerFor('item', null));
  // con una voz hablando: siempre el sintetizado (corto)
  assert.deepEqual(eventStingerFor('chapter', null, { voice: true }), stingerFor('chapter', null));
  for (const kind of STINGER_KINDS) {
    for (let t = 0; t < 12; t++) for (const mode of ['major', 'minor']) {
      const r = eventStingerFor(kind, { tonic: t, mode });
      if (r.key.startsWith('stinger_gen_')) assert.ok(Math.abs(r.detune) <= STINGER_GEN_MAX_SHIFT * 100, `${kind} ${t} ${mode}`);
    }
  }
});

test('A8.3b: cada stinger grabado existe, está en sfxKeys, no es un puente y su duración cuadra con el mp3 (si hay ffprobe)', () => {
  const preload = readFileSync(new URL('../src/scenes/PreloadScene.ts', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../src/systems/MusicPlanner.ts', import.meta.url), 'utf8');
  assert.ok(!planner.includes('stinger_gen_'), 'los puentes siguen siendo los sintetizados');
  for (const key of STINGER_GEN_KEYS) {
    assert.ok(!STINGER_SFX_KEYS.includes(key), `${key} no debe estar en STINGER_MS (receta sintetizada)`);
    const file = new URL(`../assets/audio/sfx/${key}.mp3`, import.meta.url);
    assert.ok(existsSync(file), `falta ${key}.mp3`);
    assert.ok(preload.includes(`'${key}'`), `${key} no está en sfxKeys`);
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.pathname]);
    if (r.error || r.status !== 0) continue;
    const ms = Math.round(parseFloat(String(r.stdout)) * 1000);
    assert.ok(Math.abs(ms - STINGER_GEN[key].ms) <= 60, `${key}: ${ms} ms en el mp3, ${STINGER_GEN[key].ms} declarados`);
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

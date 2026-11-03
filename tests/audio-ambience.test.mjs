// A4.4 (plan SCUMM): bucles de ambiente, lógica pura (src/systems/Ambience.ts) y su config generada.
// CI (Node 22): node --experimental-strip-types --test tests/audio-ambience.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const { resolveAmbience, ambienceLoopPoints, ambienceTransition, ambienceUrl, ambienceCacheKey, AMBIENCE_BASE_GAIN } = await import(
  process.env.AMBIENCE_PATH ?? '../src/systems/Ambience.ts'
);
const { AMBIENCE_LOOPS, AMBIENCE_PAD_SEC } = await import(process.env.AMBIENCE_CONFIG_PATH ?? '../src/config/ambience.config.ts');

test('resolveAmbience: clave conocida con su ganancia × volumen de la escena; desconocida o vacía = null', () => {
  const loops = { crickets: { loopSec: 16, gain: 0.5 } };
  const warnings = [];
  const r = resolveAmbience({ ambience: 'crickets' }, loops, (m) => warnings.push(m));
  assert.deepEqual(r, { key: 'crickets', gain: 0.5 * AMBIENCE_BASE_GAIN, loopSec: 16 });
  assert.equal(resolveAmbience({ ambience: 'crickets', ambienceVolume: 0.5 }, loops).gain, 0.25 * AMBIENCE_BASE_GAIN);
  assert.equal(resolveAmbience({ ambience: 'crickets', ambienceVolume: 9 }, loops).gain, 2 * 0.5 * AMBIENCE_BASE_GAIN, 'tope 2');
  assert.equal(resolveAmbience({ ambience: null }, loops), null);
  assert.equal(resolveAmbience(undefined, loops), null);
  assert.equal(resolveAmbience({ ambience: 'nope' }, loops, (m) => warnings.push(m)), null);
  assert.equal(warnings.length, 1);
  assert.ok(resolveAmbience({ ambience: 'crickets', ambienceVolume: 0 }, loops).gain > 0, 'nunca 0 (rampas exponenciales)');
});

test('ambienceLoopPoints: centrados en el relleno; con un buffer corto se usa lo que hay', () => {
  assert.deepEqual(ambienceLoopPoints(16, 16.25, 0.25), { start: 0.125, end: 16.125 });
  assert.deepEqual(ambienceLoopPoints(16, 16.3, 0.25), { start: 0.125, end: 16.125 }, 'el retardo del descodificador no mueve los puntos');
  const short = ambienceLoopPoints(16, 10, 0.25);
  assert.equal(short.end, 10);
  assert.ok(short.start >= 0 && short.start < short.end);
});

test('ambienceTransition: seguir, fundir, apagar o nada', () => {
  const next = { key: 'wind', gain: 0.5, loopSec: 16 };
  assert.equal(ambienceTransition(null, null), 'none');
  assert.equal(ambienceTransition('wind', null), 'silence');
  assert.equal(ambienceTransition('wind', next), 'keep');
  assert.equal(ambienceTransition('crickets', next), 'crossfade');
  assert.equal(ambienceTransition(null, next), 'crossfade');
});

test('rutas y claves de caché', () => {
  assert.equal(ambienceUrl('wind', '?v=1'), 'assets/audio/ambience/wind.mp3?v=1');
  assert.equal(ambienceCacheKey('wind'), 'amb_wind');
});

test('ambience.config.ts: cada bucle existe en disco y cada mp3 de ambience está en el config; todas las escenas piden uno conocido', () => {
  assert.ok(AMBIENCE_PAD_SEC > 0);
  for (const [key, info] of Object.entries(AMBIENCE_LOOPS)) {
    assert.ok(existsSync(new URL(`../assets/audio/ambience/${key}.mp3`, import.meta.url)), `falta ${key}.mp3`);
    assert.ok(info.loopSec > 0 && info.gain > 0 && info.gain <= 1, `${key}: loopSec/gain fuera de rango`);
  }
  for (const f of readdirSync(new URL('../assets/audio/ambience/', import.meta.url))) {
    if (f.endsWith('.mp3')) assert.ok(AMBIENCE_LOOPS[f.replace(/\.mp3$/, '')], `${f} no está en AMBIENCE_LOOPS`);
  }
  for (const id of readdirSync(new URL('../assets/scenes/', import.meta.url))) {
    const file = new URL(`../assets/scenes/${id}/scene.json`, import.meta.url);
    if (!existsSync(file)) continue;
    const audio = JSON.parse(readFileSync(file, 'utf8')).audio ?? {};
    if (audio.ambience) assert.ok(AMBIENCE_LOOPS[audio.ambience], `${id}: ambiente «${audio.ambience}» desconocido`);
  }
});

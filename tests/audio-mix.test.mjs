// A4.8 (plan SCUMM): volumen por defecto alto, migración de una vez y mezcla por categorías (src/systems/Settings.ts,
// src/systems/AudioMix.ts). CI (Node 22): node --experimental-strip-types --test tests/audio-mix.test.mjs (va en
// `npm run test:engine`). En Node 20: compila los .ts con esbuild y pasa SETTINGS_PATH / AUDIO_MIX_PATH / CINEMATICS_PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import(process.env.SETTINGS_PATH ?? '../src/systems/Settings.ts');
const M = await import(process.env.AUDIO_MIX_PATH ?? '../src/systems/AudioMix.ts');
const { DUCK_LEVEL } = await import(process.env.CINEMATICS_PATH ?? '../src/systems/Cinematics.ts');

/** localStorage de mentira (Settings lee y escribe con try/catch sobre el global) */
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return m;
}

test('migrateMusicLevel: sin marca, nada guardado o «low» (el defecto antiguo) → High y se escribe', () => {
  assert.deepEqual(S.migrateMusicLevel(null, null), { level: 'high', write: true });
  assert.deepEqual(S.migrateMusicLevel('low', null), { level: 'high', write: true });
  assert.deepEqual(S.migrateMusicLevel('basura', null), { level: 'high', write: true });
});

test('migrateMusicLevel: sin marca, «medium»/«high» los eligió el jugador → se quedan', () => {
  assert.deepEqual(S.migrateMusicLevel('medium', null), { level: 'medium', write: true });
  assert.deepEqual(S.migrateMusicLevel('high', null), { level: 'high', write: true });
});

test('migrateMusicLevel: ya migrado, se respeta lo guardado (también «low») y no se escribe', () => {
  assert.deepEqual(S.migrateMusicLevel('low', '1'), { level: 'low', write: false });
  assert.deepEqual(S.migrateMusicLevel('medium', '1'), { level: 'medium', write: false });
  assert.deepEqual(S.migrateMusicLevel(null, '1'), { level: 'high', write: false });
});

test('getMusicLevel: sin localStorage → High (0,9) y deja la marca; luego Low a mano se respeta', () => {
  const m = fakeStorage();
  assert.equal(S.getMusicLevel(), 'high');
  assert.equal(S.musicVolumeFor(S.getMusicLevel()), 0.9);
  assert.equal(m.get(S.STORE_MUSIC_MIGRATED), '1');
  S.setMusicLevel('low');
  assert.equal(S.getMusicLevel(), 'low', 'cambio a mano después de la migración');
  assert.equal(S.musicVolumeFor(S.getMusicLevel()), 0.25);
});

test('getMusicLevel: jugador antiguo con «low» guardado → High una sola vez', () => {
  const m = fakeStorage({ [S.STORE_MUSIC_LEVEL]: 'low' });
  assert.equal(S.getMusicLevel(), 'high');
  assert.equal(m.get(S.STORE_MUSIC_LEVEL), 'high');
  m.set(S.STORE_MUSIC_LEVEL, 'low');
  assert.equal(S.getMusicLevel(), 'low', 'la segunda vez ya no migra');
});

test('la migración no toca otras claves (partidas guardadas, silencio, velocidad del texto)', () => {
  const m = fakeStorage({ adrian_adventure_save: '{"x":1}', adrian_adventure_muted: 'false', adrian_adventure_text_speed: 'fast' });
  S.getMusicLevel();
  assert.equal(m.get('adrian_adventure_save'), '{"x":1}');
  assert.equal(m.get('adrian_adventure_muted'), 'false');
  assert.equal(m.get('adrian_adventure_text_speed'), 'fast');
  assert.deepEqual([...m.keys()].sort(), ['adrian_adventure_muted', 'adrian_adventure_save', 'adrian_adventure_text_speed', S.STORE_MUSIC_LEVEL, S.STORE_MUSIC_MIGRATED].sort());
});

test('voces: por defecto High = ganancia 1,0, independiente del ajuste de música', () => {
  fakeStorage({ [S.STORE_MUSIC_LEVEL]: 'low', [S.STORE_MUSIC_MIGRATED]: '1' });
  assert.equal(S.getVoiceLevel(), 'high');
  assert.equal(S.voiceGainFor(S.getVoiceLevel()), 1);
  assert.equal(M.voiceEffectiveGain(1), M.VOICE_BOOST, 'efectiva = boost × 1,0 (el maestro de Phaser se compensa)');
  S.setVoiceLevel('medium');
  assert.equal(S.getVoiceLevel(), 'medium');
  assert.ok(S.voiceGainFor('low') < S.voiceGainFor('medium') && S.voiceGainFor('medium') < S.voiceGainFor('high'));
  assert.equal(S.nextLevel('high'), 'low');
  assert.equal(S.nextLevel('low'), 'medium');
});

// Medidas de docs/progreso/A4.8.md (mediana de la muestra)
const VOICE_LUFS = -25.6;
const MUSIC_LUFS = -14.5;

test('mezcla: voz ≈ −14/−15 LUFS (antes del limitador) y la música bajo la voz 8–10 dB por debajo en High', () => {
  const voice = M.outputLufs(VOICE_LUFS, M.voiceEffectiveGain(S.voiceGainFor('high')));
  assert.ok(voice >= -16 && voice <= -13, `voz ${voice}`);
  const music = M.outputLufs(MUSIC_LUFS, S.musicVolumeFor('high'));
  const ducked = M.outputLufs(MUSIC_LUFS, S.musicVolumeFor('high'), DUCK_LEVEL);
  // el limitador le quita ~1 dB a la voz: el hueco real queda ≈ 1 dB por debajo de esta cuenta
  const gap = voice - ducked;
  assert.ok(gap >= 9 && gap <= 11, `hueco voz-música ${gap} dB`);
  assert.ok(music <= voice + 1, `sin voz la música (${music}) no pasa de la voz (${voice}) + 1 dB`);
});

test('mezcla: los efectos suben todos igual (SFX_GAIN en el maestro) y el limitador queda por debajo de 0 dBFS', () => {
  assert.equal(M.SFX_GAIN, 2);
  assert.ok(M.MASTER_LIMIT_DB <= -2 && M.MASTER_LIMIT_DB >= -6);
  assert.ok(M.MASTER_LIMIT.ratio >= 12 && M.MASTER_LIMIT.attack <= 0.005);
  assert.equal(M.voiceClipVolume(1), Math.round((M.VOICE_BOOST / M.SFX_GAIN) * 1000) / 1000);
  assert.equal(M.voiceClipVolume(Number.NaN), M.voiceClipVolume(1));
  assert.equal(Math.round(M.toDb(M.fromDb(-9.1)) * 10) / 10, -9.1);
});

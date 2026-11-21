// F1.4 (plan FUNTICO_ADVENTURE): música de Triage (src/funtico/triage/triageMusic.js), lógica pura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIVO, CALMA, LEVELS, RACE_THEME, RELAPSE_THEME, TENSION, TENSION_MS, TRIUMPH_MS, TRIUNFO,
  isGoodResult, musicFor, pushHistory, tracksToPrefetch,
} from '../src/funtico/triage/triageMusic.js';

const map = JSON.parse(readFileSync(new URL('../assets/config/music-map.json', import.meta.url), 'utf-8'));
const planner = readFileSync(new URL('../src/systems/MusicPlanner.ts', import.meta.url), 'utf-8');

test('los temas existen en music-map.json con sus cuatro niveles medidos, y RELAPSE es el de recovery_pool', () => {
  for (const th of [RACE_THEME, RELAPSE_THEME]) {
    const t = map.themes[th];
    assert.ok(t, th);
    assert.equal(t.levels.length, 4);
    for (const k of t.levels) assert.ok(map.tracks[k], `${k} sin rejilla`);
  }
  assert.ok(map.themes[RELAPSE_THEME].scenes.includes('recovery_pool'));
  assert.notEqual(RACE_THEME, RELAPSE_THEME);
});

test('los nombres de nivel son los del iMUSE del juego', () => {
  assert.match(planner, /LEVEL_NAMES = \['calma', 'activo', 'tension', 'triunfo'\]/);
  assert.deepEqual(LEVELS, ['calma', 'activo', 'tension', 'triunfo']);
});

test('carrera: calma al empezar, activo tras el primer acierto o con racha, tensión en los últimos 30 s', () => {
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: 180000, streak: 0, hits: 0 }), { theme: RACE_THEME, level: CALMA });
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: 150000, streak: 1, hits: 1 }), { theme: RACE_THEME, level: ACTIVO });
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: 150000, streak: 0, hits: 1 }), { theme: RACE_THEME, level: ACTIVO });
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: 150000, streak: 2, hits: 0 }), { theme: RACE_THEME, level: ACTIVO });
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: TENSION_MS, streak: 0, hits: 0 }), { theme: RACE_THEME, level: TENSION });
  assert.deepEqual(musicFor({ phase: 'race', remainingMs: 1000, streak: 5, hits: 5 }), { theme: RACE_THEME, level: TENSION });
  assert.equal(musicFor({ phase: 'race', remainingMs: TENSION_MS + 1, hits: 0 }).level, CALMA);
});

test('RELAPSE: tema de recovery_pool en tensión, también en los últimos segundos', () => {
  assert.deepEqual(musicFor({ phase: 'relapse', remainingMs: 100000 }), { theme: RELAPSE_THEME, level: TENSION });
  assert.deepEqual(musicFor({ phase: 'relapse', remainingMs: 5000 }), { theme: RELAPSE_THEME, level: TENSION });
});

test('resultado: triunfo con buena puntuación y luego calma; con mala, calma; off = silencio', () => {
  assert.deepEqual(musicFor({ phase: 'result', good: true, resultMs: 0 }), { theme: RACE_THEME, level: TRIUNFO });
  assert.deepEqual(musicFor({ phase: 'result', good: true, resultMs: TRIUMPH_MS }), { theme: RACE_THEME, level: CALMA });
  assert.deepEqual(musicFor({ phase: 'result', good: false, resultMs: 0 }), { theme: RACE_THEME, level: CALMA });
  assert.equal(musicFor({ phase: 'off' }), null);
  assert.equal(isGoodResult({ hits: 6, stations: 9 }), true);
  assert.equal(isGoodResult({ hits: 5, stations: 9 }), false);
  assert.equal(isGoodResult({ hits: 0, stations: 0 }), false);
});

test('solo se descargan las pistas que usa Triage (≤ 5 de las del juego)', () => {
  const race = map.themes[RACE_THEME];
  const rel = map.themes[RELAPSE_THEME];
  const all = tracksToPrefetch(race, rel, true);
  assert.deepEqual(all, [race.levels[0], race.levels[1], rel.levels[2], race.levels[2], race.levels[3]]);
  assert.ok(!tracksToPrefetch(race, rel, false).some((t) => rel.levels.includes(t)));
});

test('historial: solo cambios', () => {
  const h = [];
  assert.equal(pushHistory(h, 0, { theme: 'a', level: 0 }), true);
  assert.equal(pushHistory(h, 10, { theme: 'a', level: 0 }), false);
  assert.equal(pushHistory(h, 20, { theme: 'a', level: 1 }), true);
  assert.equal(pushHistory(h, 30, null), true);
  assert.deepEqual(h.map((e) => [e.theme, e.name]), [['a', 'calma'], ['a', 'activo'], [null, null]]);
});

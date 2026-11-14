// A9.4 (plan SCUMM): el final que cierra. Regla de los 3 s de los créditos, resumen (formato del tiempo, llamadas a Anon,
// nombres de los logros), partida terminada y campos nuevos de la partida (tiempo jugado y `completedAt`), y la
// comprobación `expect.ending` del walkthrough. Lógica pura (src/systems/Ending.ts), sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/ending.test.mjs (va en `npm run test:engine`)
// ENDING_PATH / SAVE_MIGRATION_PATH permiten apuntar a copias ya transpiladas a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnding, check } from '../scripts/lib/walkthrough-core.mjs';

const E = await import(process.env.ENDING_PATH ?? '../src/systems/Ending.ts');
const { migrateGameState } = await import(process.env.SAVE_MIGRATION_PATH ?? '../src/systems/SaveMigration.ts');
const {
  CREDITS_LOCK_MS, CREDITS_HOLD_MS, ENDING_TAP_GUARD_MS, PLAYTIME_MAX_STEP_MS,
  creditsSkipAllowed, endingTapAllowed, addPlayTime, formatPlayTime, anonCalls, anonCallsText,
  achievementName, achievementNames, endingSummary, isFinishedRun,
} = E;

const DEFS = [
  { id: 'ch1_complete', name: 'Breaking & Entering' },
  { id: 'patient_zero', name: 'Patient Zero' },
  { id: 'game_complete', name: 'Game Complete' },
  { id: 'alpha_leak', name: 'Alpha Leak' },
];

test('créditos: un toque no los salta nunca; mantener o Esc, solo pasados 3 s', () => {
  assert.equal(CREDITS_LOCK_MS, 3000);
  assert.ok(CREDITS_HOLD_MS >= 400 && CREDITS_HOLD_MS <= 1000);
  for (const ms of [0, 1000, 2999, 3000, 10_000, 600_000]) assert.equal(creditsSkipAllowed('tap', ms), false, `tap a ${ms}`);
  for (const input of ['hold', 'esc']) {
    assert.equal(creditsSkipAllowed(input, 0), false);
    assert.equal(creditsSkipAllowed(input, 1000), false, `${input} a 1 s`);
    assert.equal(creditsSkipAllowed(input, 2999), false);
    assert.equal(creditsSkipAllowed(input, 3000), true);
    assert.equal(creditsSkipAllowed(input, 45_000), true);
    assert.equal(creditsSkipAllowed(input, Number.NaN), false);
  }
});

test('«THE END»: un toque no lo cierra antes de que dé tiempo a leerlo', () => {
  assert.equal(endingTapAllowed(0), false);
  assert.equal(endingTapAllowed(ENDING_TAP_GUARD_MS - 1), false);
  assert.equal(endingTapAllowed(ENDING_TAP_GUARD_MS), true);
  assert.equal(endingTapAllowed(Number.NaN), false);
});

test('tiempo jugado: suma fotogramas con tope y aguanta valores raros', () => {
  assert.equal(addPlayTime(undefined, 16), 16);
  assert.equal(addPlayTime(1000, 16.5), 1016.5);
  assert.equal(addPlayTime(1000, 60_000), 1000 + PLAYTIME_MAX_STEP_MS, 'una pestaña oculta no suma un minuto');
  assert.equal(addPlayTime(1000, -5), 1000);
  assert.equal(addPlayTime(Number.NaN, 10), 10);
  assert.equal(addPlayTime(-20, 10), 10);
});

test('formato del tiempo jugado', () => {
  assert.equal(formatPlayTime(undefined), '0m 00s');
  assert.equal(formatPlayTime(0), '0m 00s');
  assert.equal(formatPlayTime(999), '0m 00s');
  assert.equal(formatPlayTime(45_000), '45s');
  assert.equal(formatPlayTime(60_000), '1m 00s');
  assert.equal(formatPlayTime(12 * 60_000 + 5_000), '12m 05s');
  assert.equal(formatPlayTime(59 * 60_000 + 59_999), '59m 59s');
  assert.equal(formatPlayTime(3_600_000), '1h 00m');
  assert.equal(formatPlayTime(3_600_000 + 7 * 60_000 + 30_000), '1h 07m');
  assert.equal(formatPlayTime(26 * 3_600_000), '26h 00m');
  assert.equal(formatPlayTime(Number.POSITIVE_INFINITY), '0m 00s');
});

test('llamadas a Anon: de journal.calls, sin diario = 0', () => {
  assert.equal(anonCalls(undefined), 0);
  assert.equal(anonCalls(null), 0);
  assert.equal(anonCalls({}), 0);
  assert.equal(anonCalls({ calls: 7 }), 7);
  assert.equal(anonCalls({ calls: 2.9 }), 2);
  assert.equal(anonCalls({ calls: -1 }), 0);
  assert.equal(anonCalls({ calls: '3' }), 0);
  assert.equal(anonCallsText(0), 'never');
  assert.equal(anonCallsText(1), '1 time');
  assert.equal(anonCallsText(15), '15 times');
});

test('logros: nombre legible de la definición, en el orden del juego y sin repetir', () => {
  assert.equal(achievementName('game_complete', DEFS), 'Game Complete');
  assert.equal(achievementName('sector_zero', DEFS), 'Sector Zero', 'sin definición: el id con mayúsculas');
  assert.deepEqual(
    achievementNames(['game_complete', 'ch1_complete', 'mystery_box', 'patient_zero', 'ch1_complete'], DEFS),
    ['Breaking & Entering', 'Patient Zero', 'Game Complete', 'Mystery Box'],
  );
  assert.deepEqual(achievementNames([], DEFS), []);
});

test('resumen del final: tiempo, llamadas a Anon y logros con su nombre', () => {
  const s = endingSummary({ playTimeMs: 3_600_000 + 5 * 60_000, journal: { calls: 15 }, achievements: ['patient_zero', 'game_complete'] }, DEFS);
  assert.equal(s.playTime, '1h 05m');
  assert.equal(s.anonCalls, 15);
  assert.deepEqual(s.achievements, ['Patient Zero', 'Game Complete']);
  assert.deepEqual(s.lines, [
    'Time played: 1h 05m',
    'Called Anon: 15 times',
    'Achievements: 2 of 4',
    '★ Patient Zero',
    '★ Game Complete',
  ]);
  // Partida de antes de A9.4: sin tiempo ni diario
  const old = endingSummary({ achievements: [] }, DEFS);
  assert.deepEqual(old.lines.slice(0, 3), ['Time played: 0m 00s', 'Called Anon: never', 'Achievements: 0 of 4']);
  // Ningún id crudo («game_complete») en pantalla
  for (const l of s.lines) assert.doesNotMatch(l, /_/);
});

test('el resumen con los logros reales del juego no enseña el nombre viejo del juego', async () => {
  const { ACHIEVEMENTS } = await import(process.env.ACHIEVEMENTS_PATH ?? '../src/config/achievements.config.ts');
  const s = endingSummary({ achievements: ACHIEVEMENTS.map((a) => a.id) }, ACHIEVEMENTS);
  assert.equal(s.achievements.length, ACHIEVEMENTS.length);
  for (const l of s.lines) assert.doesNotMatch(l, /ZEROadventure/i, l);
});

test('partida terminada: completedAt', () => {
  assert.equal(isFinishedRun(undefined), false);
  assert.equal(isFinishedRun({}), false);
  assert.equal(isFinishedRun({ completedAt: 0 }), false);
  assert.equal(isFinishedRun({ completedAt: 'ayer' }), false);
  assert.equal(isFinishedRun({ completedAt: 1_763_000_000_000 }), true);
});

test('partidas: playTimeMs y completedAt son opcionales; corruptos se descartan sin tocar el resto', () => {
  const old = { currentScene: 'lobby', flags: { a: true }, inventory: [], visited: ['lobby'], firedTriggers: [], dialogueProgress: {}, achievements: [] };
  const migrated = migrateGameState(structuredClone(old));
  assert.equal(migrated.playTimeMs, undefined);
  assert.equal(migrated.completedAt, undefined);
  assert.deepEqual(migrated.flags, { a: true });
  const ok = migrateGameState({ ...structuredClone(old), playTimeMs: 1234.7, completedAt: 1_763_000_000_000 });
  assert.equal(ok.playTimeMs, 1234);
  assert.equal(ok.completedAt, 1_763_000_000_000);
  const bad = migrateGameState({ ...structuredClone(old), playTimeMs: -3, completedAt: 'x' });
  assert.equal('playTimeMs' in bad, false);
  assert.equal('completedAt' in bad, false);
  assert.equal(migrateGameState({ ...structuredClone(old), playTimeMs: Number.NaN }).playTimeMs, undefined);
});

test('walkthrough: expect.ending y expect.menu', () => {
  const st = {
    menu: true, flags: { game_complete: true }, completedAt: 1, playTimeMs: 90_000,
    ending: {
      phase: 'menu', returnedToMenu: true,
      credits: { tapsIgnored: 12, skipped: false, skipInput: null, skippedAtMs: null },
      ending: { theEnd: true },
      summary: ['Time played: 1m 30s', 'Called Anon: 15 times', 'Achievements: 6 of 20', '★ Patient Zero', '★ Game Complete'],
    },
  };
  const want = {
    creditsSkipped: false, tapsIgnoredMin: 1, theEnd: true, returnedToMenu: true, finished: true, playTimeMin: 60_000,
    summary: ['^Time played: \\d+(h|m|s)', '^Called Anon: \\d+ times$', '^Achievements: \\d+ of \\d+$', 'Game Complete$', 'Patient Zero$'],
  };
  assert.deepEqual(checkEnding(want, st), []);
  assert.deepEqual(check({ menu: true, ending: want, flags: { game_complete: true } }, st), []);
  assert.equal(check({ menu: false }, st).length, 1);
  const skipped = { ...st, ending: { ...st.ending, credits: { tapsIgnored: 0, skipped: true, skipInput: 'tap', skippedAtMs: 800 } } };
  const f = checkEnding({ creditsSkipped: false, tapsIgnoredMin: 1 }, skipped);
  assert.equal(f.length, 2);
  assert.match(f[0], /tap a los 800 ms/);
  assert.match(checkEnding({ summary: ['Called Anon'] }, { ...st, ending: { ...st.ending, summary: [] } })[0], /no tiene/);
  assert.match(checkEnding({ theEnd: true }, { ending: undefined })[0], /anterior a A9\.4/);
  assert.match(checkEnding({ theEnd: true }, { ending: null })[0], /no se llegó/);
  assert.equal(checkEnding({ finished: true, playTimeMin: 1 }, { ...st, completedAt: null, playTimeMs: 0 }).length, 2);
});

// A1.5 (plan SCUMM): con el sonido apagado no se descargan música ni voces. Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/audio-policy.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mutedFromStored, shouldFetchAudio, musicToPreload, loadingTipsFor, MUTED_STORAGE_KEY } = await import(
  process.env.AUDIO_POLICY_PATH ?? '../src/systems/AudioPolicy.ts'
);

test('la clave guardada es la de siempre (partidas y ajustes ya guardados siguen valiendo)', () => {
  assert.equal(MUTED_STORAGE_KEY, 'adrian_adventure_muted');
});

test('primera visita (sin valor guardado) = silencio; "false" = sonido; "true" = silencio', () => {
  assert.equal(mutedFromStored(null), true);
  assert.equal(mutedFromStored('false'), false);
  assert.equal(mutedFromStored('true'), true);
});

test('solo se descarga audio con el sonido activado', () => {
  assert.equal(shouldFetchAudio(true), false);
  assert.equal(shouldFetchAudio(false), true);
});

test('PreloadScene no encola música en silencio, y con sonido solo la que no está en caché', () => {
  const none = () => false;
  assert.deepEqual(musicToPreload(['retro-adventure'], true, none), []);
  assert.deepEqual(musicToPreload(['retro-adventure'], false, none), ['retro-adventure']);
  assert.deepEqual(musicToPreload(['retro-adventure', 'vista'], false, (k) => k === 'retro-adventure'), ['vista']);
});

test('en silencio la pantalla de carga no promete voces', () => {
  const tips = ['Polishing the rubber duck...', 'Loading 1,388 voice clips...', 'Rehearsing voice lines...'];
  assert.deepEqual(loadingTipsFor(tips, true), ['Polishing the rubber duck...']);
  assert.deepEqual(loadingTipsFor(tips, false), tips);
  assert.notEqual(loadingTipsFor(tips, false), tips, 'devuelve una copia (PreloadScene la baraja)');
});

test('A9.5: tras activar el sonido, un toque reanuda el AudioContext parado o interrumpido (Chrome de iOS)', async () => {
  const { shouldResumeOnGesture } = await import(process.env.AUDIO_POLICY_PATH ?? '../src/systems/AudioPolicy.ts');
  assert.equal(shouldResumeOnGesture('suspended', true, false), true);
  assert.equal(shouldResumeOnGesture('interrupted', true, false), true);
  assert.equal(shouldResumeOnGesture('running', true, false), false);
  assert.equal(shouldResumeOnGesture('closed', true, false), false);
  assert.equal(shouldResumeOnGesture('suspended', false, false), false, 'sin «Enable Sound» no se toca');
  assert.equal(shouldResumeOnGesture('suspended', true, true), false, 'en silencio no se toca');
});

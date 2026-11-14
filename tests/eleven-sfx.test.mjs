// A8.4 (plan SCUMM): efectos de ElevenLabs. Lógica pura de scripts/audio/eleven-sfx.mjs (sin red ni ffmpeg).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const { MANIFEST, bodyOf, hashOf, keysOf, splitHits, trim, activeRms, ELEVEN_KEYS } = await import('../scripts/audio/eleven-sfx.mjs');
const SR = 44100;

/** n golpes de ruido con caída exponencial separados `gap` s, sobre silencio */
function hits(n, gap = 0.6, amps = []) {
  const x = new Float32Array(Math.round((n * gap + 0.5) * SR));
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  for (let k = 0; k < n; k++) {
    const a = Math.round((0.2 + k * gap) * SR);
    for (let i = 0; i < 0.15 * SR; i++) x[a + i] = (amps[k] ?? 0.5) * rnd() * Math.exp(-i / (0.03 * SR));
  }
  return x;
}

test('cada efecto lleva prompt en inglés corto y duración explícita dentro de lo que admite la API (0,5–30 s)', () => {
  const ids = new Set();
  for (const e of MANIFEST.efectos) {
    assert.ok(!ids.has(e.id), `id repetido ${e.id}`);
    ids.add(e.id);
    assert.ok(typeof e.dur === 'number' && e.dur >= 0.5 && e.dur <= 30, `${e.id}: dur`);
    assert.ok(e.prompt.length > 10 && e.prompt.length < 450, `${e.id}: prompt`);
    assert.equal(bodyOf(e).duration_seconds, e.dur);
  }
});

test('hash estable (la caché no vuelve a cobrar) y cambia con el prompt', () => {
  const e = MANIFEST.efectos[0];
  assert.equal(hashOf(e), hashOf({ ...e }));
  assert.notEqual(hashOf(e), hashOf({ ...e, prompt: e.prompt + '!' }));
});

test('los pasos se cortan en N variantes con la clave step_<superficie>_1..N', () => {
  const steps = MANIFEST.efectos.filter((e) => e.grupo === 'pasos');
  assert.ok(steps.length >= 7);
  for (const e of steps) assert.deepEqual(keysOf(e), Array.from({ length: e.split }, (_, i) => `${e.id}_${i + 1}`));
  assert.ok(ELEVEN_KEYS.includes('step_wood_4'));
});

test('splitHits: se queda con los N golpes más fuertes, en orden de tiempo y sin silencio delante', () => {
  const x = hits(6, 0.6, [0.5, 0.1, 0.6, 0.55, 0.05, 0.4]);
  const out = splitHits(x, 4);
  assert.equal(out.length, 4);
  for (const h of out) {
    assert.ok(h.length / SR < 0.43, 'cada paso cabe en su hueco');
    assert.ok(Math.abs(h[Math.round(0.01 * SR)]) > 0 || Math.abs(h[Math.round(0.006 * SR)]) > 0, 'empieza con el golpe');
  }
});

test('trim quita silencio de delante y de detrás; activeRms no depende del silencio', () => {
  const x = hits(1);
  const t = trim(x);
  assert.ok(t.length < x.length / 2);
  assert.ok(Math.abs(activeRms(t) - activeRms(x)) / activeRms(x) < 0.25);
});

test('lo apuntado en art/sfx/generados.json existe en assets/audio/sfx y está en sfxKeys de PreloadScene', () => {
  const gen = new URL('../art/sfx/generados.json', import.meta.url);
  if (!existsSync(gen)) return;
  const preload = readFileSync(new URL('../src/scenes/PreloadScene.ts', import.meta.url), 'utf8');
  const keys = [...preload.match(/const sfxKeys = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const k of Object.keys(JSON.parse(readFileSync(gen, 'utf8')))) {
    assert.ok(existsSync(new URL(`../assets/audio/sfx/${k}.mp3`, import.meta.url)), `falta ${k}.mp3`);
    assert.ok(keys.includes(k), `${k} no está en sfxKeys`);
  }
});

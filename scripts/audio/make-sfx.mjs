// A4.4 (plan SCUMM): escribe los efectos de sonido sintetizados en `assets/audio/sfx/<clave>.mp3` a partir de
// `scripts/audio/sfx-recipes.mjs` (Node puro para el WAV; ffmpeg para el MP3, como las voces de voices.yml y los
// GIF de las demos). Determinista: la semilla de cada receta sale de su nombre, así repetirlo da el mismo WAV
// (el MP3 depende de la versión de LAME, por eso los MP3 van en el repo y el CI no los regenera).
//
//   node scripts/audio/make-sfx.mjs            todos los efectos de las recetas
//   node scripts/audio/make-sfx.mjs duck_squeak step_wood_1   solo esos
//   node scripts/audio/make-sfx.mjs --list     claves que generaría
//   node scripts/audio/make-sfx.mjs --wav <dir>  deja también los WAV en esa carpeta (para escucharlos sin MP3)
//
// Los 22 efectos anteriores a A4.4 (ui_click, item_pickup, door_open…) no tienen receta y no se tocan.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECIPES } from './sfx-recipes.mjs';
import { rng, writeWav, peakOf, SAMPLE_RATE } from './synth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SFX_DIR = join(ROOT, 'assets', 'audio', 'sfx');

/** Semilla estable por nombre (FNV-1a) */
export function seedOf(name) {
  let h = 0x811c9dc5;
  for (const ch of name) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Renderiza una receta por nombre (buffer mono). Exportada para las pruebas. */
export function renderSfx(name) {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`No hay receta para «${name}»`);
  const buf = recipe(rng(seedOf(name)));
  if (!(buf instanceof Float32Array) || !buf.length) throw new Error(`La receta «${name}» no devolvió audio`);
  if (peakOf(buf) > 1.0001) throw new Error(`La receta «${name}» pasa de ±1 (pico ${peakOf(buf).toFixed(3)})`);
  return buf;
}

/** WAV → MP3 mono con LAME (VBR calidad 4 ≈ 128 kbps a 22 kHz: de sobra para efectos cortos) */
export function encodeMp3(wavPath, mp3Path, { quality = 4, bitrate = null } = {}) {
  const args = ['-loglevel', 'error', '-y', '-i', wavPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-codec:a', 'libmp3lame'];
  if (bitrate) args.push('-b:a', bitrate); else args.push('-q:a', String(quality));
  args.push(mp3Path);
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.error) throw new Error(`ffmpeg no disponible: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg falló (${r.status}) con ${mp3Path}`);
}

export function makeSfx(names, { wavDir = null, outDir = SFX_DIR, log = console.log } = {}) {
  mkdirSync(outDir, { recursive: true });
  const tmp = wavDir ?? mkdtempSync(join(tmpdir(), 'sfx-'));
  mkdirSync(tmp, { recursive: true });
  const made = [];
  try {
    for (const name of names) {
      const buf = renderSfx(name);
      const wav = join(tmp, `${name}.wav`);
      writeWav(wav, buf);
      const mp3 = join(outDir, `${name}.mp3`);
      encodeMp3(wav, mp3);
      const kb = statSync(mp3).size / 1024;
      made.push({ name, secs: buf.length / SAMPLE_RATE, kb });
      log(`${name}: ${(buf.length / SAMPLE_RATE).toFixed(2)} s · ${kb.toFixed(1)} KB`);
    }
  } finally {
    if (!wavDir) rmSync(tmp, { recursive: true, force: true });
  }
  return made;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(Object.keys(RECIPES).join('\n'));
    process.exit(0);
  }
  let wavDir = null;
  const wi = args.indexOf('--wav');
  if (wi >= 0) { wavDir = resolve(args[wi + 1]); args.splice(wi, 2); }
  const names = args.length ? args : Object.keys(RECIPES);
  try {
    const made = makeSfx(names, { wavDir });
    console.log(`${made.length} efectos · ${made.reduce((a, m) => a + m.kb, 0).toFixed(0)} KB en total`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

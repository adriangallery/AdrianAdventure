// A4.7 (plan SCUMM): escribe las tres propuestas de pasos (`?steps=a|b|c`) en
// assets/audio/steps/<variante>/<superficie>_<n>.mp3 a partir de scripts/audio/step-variant-recipes.mjs.
// Mismo método que make-sfx.mjs (Node puro para el WAV, ffmpeg/LAME para el MP3, semilla por nombre).
//
//   node scripts/audio/make-steps.mjs          las tres
//   node scripts/audio/make-steps.mjs b        solo la b
//   node scripts/audio/make-steps.mjs --list   claves que generaría
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANT_RECIPES } from './step-variant-recipes.mjs';
import { seedOf, encodeMp3 } from './make-sfx.mjs';
import { rng, writeWav, peakOf, SAMPLE_RATE } from './synth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STEPS_DIR = join(ROOT, 'assets', 'audio', 'steps');

/** `stepb_wood_3` → { variant: 'b', file: 'wood_3' } */
export function splitKey(key) {
  const m = /^step([abc])_(.+)$/.exec(key);
  if (!m) throw new Error(`Clave de paso rara: ${key}`);
  return { variant: m[1], file: m[2] };
}

export function renderStep(key) {
  const { variant } = splitKey(key);
  const recipe = VARIANT_RECIPES[variant]?.[key];
  if (!recipe) throw new Error(`No hay receta para «${key}»`);
  const buf = recipe(rng(seedOf(key)));
  if (!(buf instanceof Float32Array) || !buf.length) throw new Error(`La receta «${key}» no devolvió audio`);
  if (peakOf(buf) > 1.0001) throw new Error(`La receta «${key}» pasa de ±1`);
  return buf;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const variants = args.filter((a) => /^[abc]$/.test(a));
  const keys = (variants.length ? variants : Object.keys(VARIANT_RECIPES)).flatMap((v) => Object.keys(VARIANT_RECIPES[v]));
  if (args.includes('--list')) { console.log(keys.join('\n')); process.exit(0); }
  const tmp = '/var/tmp/adv-pasos/wav';
  mkdirSync(tmp, { recursive: true });
  let kb = 0;
  for (const key of keys) {
    const { variant, file } = splitKey(key);
    const buf = renderStep(key);
    const wav = join(tmp, `${key}.wav`);
    writeWav(wav, buf);
    mkdirSync(join(STEPS_DIR, variant), { recursive: true });
    const mp3 = join(STEPS_DIR, variant, `${file}.mp3`);
    encodeMp3(wav, mp3);
    rmSync(wav, { force: true });
    kb += statSync(mp3).size / 1024;
    console.log(`${variant}/${file}: ${(buf.length / SAMPLE_RATE).toFixed(2)} s`);
  }
  console.log(`${keys.length} pasos · ${kb.toFixed(0)} KB`);
}

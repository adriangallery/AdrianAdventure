// A4.4 (plan SCUMM): escribe los bucles de ambiente en `assets/audio/ambience/<clave>.mp3` desde
// `scripts/audio/ambience-recipes.mjs` y regenera `src/config/ambience.config.ts` (duración del bucle, relleno y
// ganancia de cada uno: lo que MusicManager necesita para `loopStart`/`loopEnd`). Determinista como make-sfx.
//
//   node scripts/audio/make-ambience.mjs            todos
//   node scripts/audio/make-ambience.mjs crickets   solo ese
//   node scripts/audio/make-ambience.mjs --check    solo comprueba que ambience.config.ts está al día (job lint)
//   node scripts/audio/make-ambience.mjs --wav <dir>  deja también los WAV
//
// Por qué el relleno: un MP3 descodificado trae ~25 ms de retardo del codificador que no todos los navegadores
// quitan. Si el fichero es «bucle + los primeros PAD_SEC del bucle», cualquier ventana de LOOP_SEC segundos que
// empiece antes de PAD_SEC es un bucle perfecto, esté o no ese retardo: MusicManager pone loopStart = PAD_SEC/2 y
// loopEnd = PAD_SEC/2 + LOOP_SEC (src/systems/Ambience.ts).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECIPES, LOOP_SEC, PAD_SEC, SEAM_SEC } from './ambience-recipes.mjs';
import { rng, writeWav, seamless, padLoop, peakOf, secs, SAMPLE_RATE } from './synth.mjs';
import { encodeMp3, seedOf } from './make-sfx.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AMBIENCE_DIR = join(ROOT, 'assets', 'audio', 'ambience');
export const CONFIG_PATH = join(ROOT, 'src', 'config', 'ambience.config.ts');

/** Bucle ya sin costura y con relleno (lo que va al fichero). Exportada para las pruebas. */
export function renderAmbience(name) {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`No hay receta de ambiente para «${name}»`);
  const raw = recipe.render(rng(seedOf(`ambience:${name}`)));
  if (raw.length !== secs(LOOP_SEC + SEAM_SEC)) throw new Error(`«${name}»: la receta debe durar LOOP_SEC + SEAM_SEC (${LOOP_SEC + SEAM_SEC} s), dura ${raw.length / SAMPLE_RATE}`);
  const loop = seamless(raw, SEAM_SEC);
  if (peakOf(loop) > 1.0001) throw new Error(`«${name}» pasa de ±1`);
  return { loop, file: padLoop(loop, PAD_SEC) };
}

export function configSource() {
  const entries = Object.entries(RECIPES).map(([k, r]) => `  ${k}: { loopSec: ${LOOP_SEC}, gain: ${r.gain} },`).join('\n');
  return `// Generado por scripts/audio/make-ambience.mjs (A4.4). No editar a mano: \`node scripts/audio/make-ambience.mjs\`.
// Cada bucle de assets/audio/ambience/<clave>.mp3 dura loopSec segundos y lleva AMBIENCE_PAD_SEC más del principio
// repetido al final (ver src/systems/Ambience.ts). \`gain\`: volumen relativo con el que suena.
export const AMBIENCE_PAD_SEC = ${PAD_SEC};

export interface AmbienceLoopInfo {
  loopSec: number;
  gain: number;
}

export const AMBIENCE_LOOPS: Record<string, AmbienceLoopInfo> = {
${entries}
};
`;
}

export function makeAmbience(names, { wavDir = null, outDir = AMBIENCE_DIR, log = console.log } = {}) {
  mkdirSync(outDir, { recursive: true });
  const tmp = wavDir ?? mkdtempSync(join(tmpdir(), 'ambience-'));
  mkdirSync(tmp, { recursive: true });
  const made = [];
  try {
    for (const name of names) {
      const { file } = renderAmbience(name);
      const wav = join(tmp, `${name}.wav`);
      writeWav(wav, file);
      const mp3 = join(outDir, `${name}.mp3`);
      encodeMp3(wav, mp3, { bitrate: '64k' });
      const kb = statSync(mp3).size / 1024;
      made.push({ name, kb });
      log(`${name}: ${LOOP_SEC} s + ${PAD_SEC} s · ${kb.toFixed(0)} KB`);
    }
  } finally {
    if (!wavDir) rmSync(tmp, { recursive: true, force: true });
  }
  return made;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--check')) {
      let current = '';
      try { current = readFileSync(CONFIG_PATH, 'utf8'); } catch { /* no existe */ }
      if (current !== configSource()) {
        console.error(`${CONFIG_PATH} no es lo que genera make-ambience.mjs: ejecuta node scripts/audio/make-ambience.mjs`);
        process.exit(1);
      }
      console.log('ambience.config.ts al día');
      process.exit(0);
    }
    let wavDir = null;
    const wi = args.indexOf('--wav');
    if (wi >= 0) { wavDir = resolve(args[wi + 1]); args.splice(wi, 2); }
    const names = args.length ? args : Object.keys(RECIPES);
    const made = makeAmbience(names, { wavDir });
    writeFileSync(CONFIG_PATH, configSource());
    console.log(`${made.length} ambientes · ${made.reduce((a, m) => a + m.kb, 0).toFixed(0)} KB · ${CONFIG_PATH} regenerado`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

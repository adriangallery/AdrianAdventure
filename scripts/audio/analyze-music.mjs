// A4.5 (plan SCUMM): tonalidad de cada pista de `assets/audio/music/` para transportar los stingers (sintetizados en
// Do) a la tonalidad de la música que suena. Descodifica con ffmpeg a PCM mono 11025 Hz, saca un cromagrama (12
// clases de altura) por Goertzel sobre ventanas de ~0,37 s y lo compara con los perfiles de Krumhansl-Kessler de
// mayor y menor en las 12 transposiciones. Escribe `src/config/music.config.ts` (`MUSIC_KEYS`).
//
//   node scripts/audio/analyze-music.mjs            analiza y escribe el config
//   node scripts/audio/analyze-music.mjs --check    comprueba que el config está al día (job lint)
// Tarda unos segundos por pista (son 27 MB de MP3). Determinista.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MUSIC_DIR = join(ROOT, 'assets', 'audio', 'music');
export const CONFIG_PATH = join(ROOT, 'src', 'config', 'music.config.ts');

const SR = 11025;
const FRAME = 4096;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Krumhansl-Kessler
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function decode(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg falló con ${file}: ${r.stderr}`);
  const buf = r.stdout;
  const out = new Float32Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** Energía de una frecuencia en una ventana (Goertzel) */
function goertzel(frame, freq) {
  const k = Math.round((FRAME * freq) / SR);
  const w = (2 * Math.PI * k) / FRAME;
  const c = 2 * Math.cos(w);
  let s0 = 0; let s1 = 0; let s2 = 0;
  for (let i = 0; i < FRAME; i++) {
    s0 = frame[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Cromagrama medio (12 valores, normalizados) de una señal: notas de A2 (110 Hz) a G#6 */
export function chroma(pcm) {
  const chromaSum = new Float64Array(12);
  const freqs = [];
  for (let midi = 45; midi < 93; midi++) freqs.push({ f: 440 * Math.pow(2, (midi - 69) / 12), pc: midi % 12 });
  const hop = FRAME * 2;
  const frame = new Float32Array(FRAME);
  let frames = 0;
  for (let start = 0; start + FRAME <= pcm.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
      frame[i] = pcm[start + i] * w;
      energy += frame[i] * frame[i];
    }
    if (energy < 1e-4) continue; // silencio
    for (const { f, pc } of freqs) chromaSum[pc] += Math.sqrt(goertzel(frame, f));
    frames++;
  }
  const max = Math.max(...chromaSum, 1e-9);
  return Array.from(chromaSum, (v) => v / max);
}

function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1e-12);
}

/** Tonalidad más probable de un cromagrama: { tonic: 0-11, mode: 'major' | 'minor', score } */
export function detectKey(chromaVec) {
  let best = { tonic: 0, mode: 'major', score: -2 };
  for (let t = 0; t < 12; t++) {
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const rotated = profile.map((_, i) => profile[(i - t + 12) % 12]);
      const score = corr(chromaVec, rotated);
      if (score > best.score) best = { tonic: t, mode, score };
    }
  }
  return best;
}

export function analyzeAll(log = console.log) {
  const keys = {};
  for (const f of readdirSync(MUSIC_DIR).filter((x) => x.endsWith('.mp3')).sort()) {
    const name = f.replace(/\.mp3$/, '');
    const pcm = decode(join(MUSIC_DIR, f));
    const k = detectKey(chroma(pcm));
    keys[name] = { tonic: k.tonic, mode: k.mode };
    log(`${name}: ${NOTE_NAMES[k.tonic]} ${k.mode} (correlación ${k.score.toFixed(2)}, ${(pcm.length / SR).toFixed(0)} s)`);
  }
  return keys;
}

export function configSource(keys) {
  const rows = Object.entries(keys).map(([k, v]) => `  '${k}': { tonic: ${v.tonic}, mode: '${v.mode}' }, // ${NOTE_NAMES[v.tonic]} ${v.mode}`).join('\n');
  return `// Generado por scripts/audio/analyze-music.mjs (A4.5). No editar a mano.
// Tonalidad estimada de cada pista de assets/audio/music (cromagrama + perfiles de Krumhansl): los stingers, sintetizados
// en Do, se transportan a la tónica de la pista que suena (src/systems/Stingers.ts).
export interface MusicKey {
  /** Clase de altura de la tónica (0 = Do … 11 = Si) */
  tonic: number;
  mode: 'major' | 'minor';
}

export const MUSIC_KEYS: Record<string, MusicKey> = {
${rows}
};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const keys = analyzeAll();
    const src = configSource(keys);
    if (process.argv.includes('--check')) {
      let current = '';
      try { current = readFileSync(CONFIG_PATH, 'utf8'); } catch { /* no existe */ }
      if (current !== src) {
        console.error(`${CONFIG_PATH} no es lo que genera analyze-music.mjs: ejecuta node scripts/audio/analyze-music.mjs`);
        process.exit(1);
      }
      console.log('music.config.ts al día');
    } else {
      writeFileSync(CONFIG_PATH, src);
      console.log(`${CONFIG_PATH} escrito`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

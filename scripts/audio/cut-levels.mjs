// A8.3 (plan SCUMM): corta una generación «completo» de ElevenLabs en sus niveles de intensidad.
//
//   node scripts/audio/cut-levels.mjs <tema> <generacion.mp3> [--lufs -15]
//
// - Lee `art/music/<tema>/plan.json` (`partes.completo`: BPM, compases y duración de cada bloque).
// - Volumen: loudnorm de ffmpeg sobre la generación ENTERA (un solo ajuste por tema, así los niveles conservan su
//   diferencia de energía), a -15 LUFS integrados / -1,5 dBTP: las pistas de A4 están en -14,1 a -14,8 LUFS.
// - Corte: cada nivel empieza justo en el límite de su bloque (más `desdeCompas` compases, si el bloque empieza en silencio)
//   y dura sus compases enteros (bpm del plan).
// - Bucle sin clic: los primeros 150 ms del nivel se mezclan (potencia constante) con lo que sigue a su final en la
//   generación, de modo que al dar la vuelta el final enlaza con el principio; el último nivel (triunfo, sin bucle) solo
//   lleva un fundido de 30 ms al final.
// - Salida: assets/audio/music/<tema>-n<nivel>.mp3 a 192 kbps (libmp3lame, sin cabecera ID3 de metadatos variables).
// Después: `node scripts/audio/analyze-music.mjs && node scripts/audio/analyze-tempo.mjs` (rejilla declarada, ver
// music-levels.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SR = 44100;
const XF_SEC = 0.15;
const PAD_SEC = 0.05;

const args = process.argv.slice(2);
const [tema, src] = args;
if (!tema || !src) {
  console.error('uso: cut-levels.mjs <tema> <generacion.mp3> [--lufs -15]');
  process.exit(1);
}
const li = args.indexOf('--lufs');
const lufs = li >= 0 ? Number(args[li + 1]) : -15;
const plan = JSON.parse(readFileSync(join(ROOT, 'art', 'music', tema, 'plan.json'), 'utf8'));
const part = plan.partes.completo;
const barSec = (60 / plan.bpm) * 4;

const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=14`, '-ar', String(SR), '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const frames = pcm.length / 2;

let startBar = 0;
const report = [];
for (let i = 0; i < part.niveles.length; i++) {
  const n = part.niveles[i];
  // `desdeCompas`: compases del principio del bloque que se saltan (p. ej. silencio inicial); `compases` = lo que queda
  const S = Math.round((startBar + (n.desdeCompas ?? 0)) * barSec * SR);
  const L = Math.round(n.compases * barSec * SR);
  startBar += part.compases[i];
  // + PAD: unos ms de lo que sigue tras el último compás, para que el fichero dure algo más que el bucle (loopEnd del
  // motor = compases × compás redondeado a 0,1 ms; no se oye: el bucle vuelve antes)
  const pad = Math.round(PAD_SEC * SR);
  const out = new Float32Array((L + pad) * 2);
  for (let i = 0; i < (L + pad) * 2; i++) out[i] = S * 2 + i < pcm.length ? pcm[S * 2 + i] : 0;
  const xf = Math.round(XF_SEC * SR);
  const hasTail = n.bucle !== false && S + L + xf <= frames;
  if (hasTail) {
    for (let f = 0; f < xf; f++) {
      const a = (f / xf) * (Math.PI / 2);
      for (let c = 0; c < 2; c++) out[f * 2 + c] = out[f * 2 + c] * Math.sin(a) + pcm[(S + L + f) * 2 + c] * Math.cos(a);
    }
  } else {
    const fo = Math.round(0.03 * SR);
    for (let f = 0; f < fo; f++) for (let c = 0; c < 2; c++) out[(L - 1 - f) * 2 + c] *= f / fo;
    out.fill(0, L * 2);
  }
  const dest = join(ROOT, 'assets', 'audio', 'music', `${tema}-n${n.nivel}.mp3`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', dest], { input: Buffer.from(out.buffer) });
  report.push({ nivel: n.nivel, nombre: n.nombre, desdeSec: +(S / SR).toFixed(3), compases: n.compases, segundos: +(L / SR).toFixed(3), bucle: hasTail ? 'fundido 150 ms' : 'sin bucle', archivo: dest.replace(ROOT + '/', '') });
}
console.log(JSON.stringify({ tema, bpm: plan.bpm, key: plan.key, lufs, niveles: report }, null, 2));

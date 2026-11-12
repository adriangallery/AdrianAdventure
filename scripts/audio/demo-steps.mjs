// A4.7 (plan SCUMM): clips de muestra de los pasos para que Adrián elija, montados offline y deterministas (capturar
// el audio de un navegador headless es frágil). Usa el MISMO código que el juego: FootstepTracker (una pisada cada
// STRIDE_ART_PX píxeles de arte, a la velocidad del andar) y, según la variante, Footsteps.stepSound (los de siempre)
// o StepVariants.StepPicker (a/b/c) con la semilla de ?qa=1. 5 s andando por `outside` (grava) y 5 s por `lobby`
// (baldosa), con el ambiente de cada escena a su volumen del juego (música aparte: no se mezcla).
//
// Node 22: node --experimental-strip-types scripts/audio/demo-steps.mjs [actual|a|b|c …] [--out /var/tmp/adv-pasos]
// Deja <out>/pasos-<variante>.mp4 (H.264 + AAC, se reproduce en el móvil) con el fondo de la escena y Dex andando.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWav, SAMPLE_RATE } from './synth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { FootstepTracker, stepSound, STEP_VOLUME } = await import(join(ROOT, 'src/systems/Footsteps.ts'));
const { StepPicker, QA_STEP_SEED, mulberry32, variantUrl } = await import(join(ROOT, 'src/systems/StepVariants.ts'));
const { AMBIENCE_LOOPS } = await import(join(ROOT, 'src/config/ambience.config.ts'));
const { AMBIENCE_BASE_GAIN } = await import(join(ROOT, 'src/systems/Ambience.ts'));

/** Velocidad del andar (px de arte/s, A2.15: 8 fotogramas × 100 ms = 2 zancadas de ~30 px) y fotogramas por segundo */
export const WALK_ART_PX_PER_S = 74;
const FPS = 60;
/** Volumen de la música por defecto (MusicManager.DEFAULT_VOLUME): el ambiente cuelga de él */
const MUSIC_MASTER = 0.25;
export const LEGS = [
  { scene: 'outside', surface: 'gravel', ambience: 'crickets', secs: 5 },
  { scene: 'lobby', surface: 'tile', ambience: 'office_hum', secs: 5 },
];

/**
 * Pisadas del clip: [{ at (s), key, url, rate, volume }]. Puro y determinista (lo comprueban los tests).
 * `variant` = 'actual' (A4.4 a mitad de volumen) | 'a' | 'b' | 'c'.
 */
export function demoSteps(variant, legs = LEGS) {
  const out = [];
  const picker = variant === 'actual' ? null : new StepPicker(variant, QA_STEP_SEED);
  const random = mulberry32(QA_STEP_SEED);
  let t0 = 0;
  for (const leg of legs) {
    const tracker = new FootstepTracker(); // cada escena empieza de cero (como al cambiar de escena)
    const frames = Math.round(leg.secs * FPS);
    for (let f = 1; f <= frames; f++) {
      const foot = tracker.advance(WALK_ART_PX_PER_S / FPS);
      if (foot === null) continue;
      const at = t0 + f / FPS;
      if (!picker) {
        const s = stepSound(leg.surface, foot, random(), 1);
        out.push({ at, key: s.key, url: `assets/audio/sfx/${s.key}.mp3`, rate: 2 ** (s.detune / 1200), volume: s.volume });
      } else {
        const s = picker.next(leg.surface, 1);
        if (!s) continue;
        const [, file] = /^step[abc]_(.+)$/.exec(s.key);
        const [surface, n] = [file.slice(0, file.lastIndexOf('_')), Number(file.slice(file.lastIndexOf('_') + 1))];
        out.push({ at: at + s.delayMs / 1000, key: s.key, url: variantUrl(variant, surface, n), rate: s.rate, volume: s.volume });
      }
    }
    t0 += leg.secs;
  }
  return out;
}

function decode(path) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1'], { maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg no pudo leer ${path}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

/** Como Phaser con `rate`: más rápido = más agudo y más corto (interpolación lineal) */
function playRate(buf, rate) {
  const n = Math.floor(buf.length / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * rate;
    const j = Math.floor(x);
    out[i] = (buf[j] ?? 0) + ((buf[j + 1] ?? 0) - (buf[j] ?? 0)) * (x - j);
  }
  return out;
}

export function renderDemo(variant, legs = LEGS) {
  const total = legs.reduce((a, l) => a + l.secs, 0);
  const mixBuf = new Float32Array(Math.ceil(total * SAMPLE_RATE) + SAMPLE_RATE);
  // Ambiente de cada escena, a su ganancia del juego
  let t0 = 0;
  for (const leg of legs) {
    const amb = decode(join(ROOT, 'assets/audio/ambience', `${leg.ambience}.mp3`));
    const gain = AMBIENCE_LOOPS[leg.ambience].gain * AMBIENCE_BASE_GAIN * MUSIC_MASTER;
    const start = Math.round(t0 * SAMPLE_RATE);
    const n = Math.round(leg.secs * SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, i / 4000, (n - i) / 4000);
      mixBuf[start + i] += amb[i % amb.length] * gain * fade;
    }
    t0 += leg.secs;
  }
  const cache = new Map();
  const steps = demoSteps(variant, legs);
  for (const s of steps) {
    if (!cache.has(s.url)) cache.set(s.url, decode(join(ROOT, s.url)));
    const src = playRate(cache.get(s.url), s.rate);
    const at = Math.round(s.at * SAMPLE_RATE);
    for (let i = 0; i < src.length && at + i < mixBuf.length; i++) mixBuf[at + i] += src[i] * s.volume;
  }
  for (let i = 0; i < mixBuf.length; i++) mixBuf[i] = Math.max(-1, Math.min(1, mixBuf[i]));
  return { buf: mixBuf.subarray(0, Math.ceil(total * SAMPLE_RATE)), steps };
}

const LABEL = { actual: 'actual (A4.4) a mitad de volumen', a: 'a - clasica', b: 'b - cartoon', c: 'c - discreta' };

function makeVideo(variant, wav, mp4) {
  const bg = (scene) => join(ROOT, `assets/scenes/${scene}/background@1280.webp`);
  const walk = join(ROOT, 'assets/sprites/player/dex2d/walk_r_%d.png');
  const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const [l1, l2] = LEGS;
  const text = (t) => `drawtext=fontfile=${font}:text='${t}':fontcolor=white:fontsize=34:x=(w-tw)/2:y=60:box=1:boxcolor=black@0.5:boxborderw=12`;
  const filter = [
    `[0:v]scale=1280:-2,pad=1280:720:0:(oh-ih)/2:color=0x101018,setsar=1,${text(`Pasos ${LABEL[variant]}`)},drawtext=fontfile=${font}:text='${l1.scene} (${l1.surface})':fontcolor=white:fontsize=26:x=(w-tw)/2:y=640[o]`,
    `[1:v]scale=1280:-2,pad=1280:720:0:(oh-ih)/2:color=0x101018,setsar=1,${text(`Pasos ${LABEL[variant]}`)},drawtext=fontfile=${font}:text='${l2.scene} (${l2.surface})':fontcolor=white:fontsize=26:x=(w-tw)/2:y=640[l]`,
    '[o][l]concat=n=2:v=1:a=0,fps=25[bg]',
    '[2:v]scale=iw*2:ih*2:flags=neighbor[dex]',
    `[bg][dex]overlay=x='120+mod(t\\,${l1.secs})*${WALK_ART_PX_PER_S * 2}':y=535-h:shortest=1,format=yuv420p[v]`,
  ].join(';');
  const args = [
    '-loglevel', 'error', '-y',
    '-loop', '1', '-t', String(l1.secs), '-framerate', '25', '-i', bg(l1.scene),
    '-loop', '1', '-t', String(l2.secs), '-framerate', '25', '-i', bg(l2.scene),
    '-stream_loop', '-1', '-framerate', '10', '-i', walk,
    '-i', wav,
    '-filter_complex', filter, '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', '-t', String(l1.secs + l2.secs), mp4,
  ];
  const r = spawnSync('nice', ['ffmpeg', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falló con ${mp4}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let outDir = '/var/tmp/adv-pasos';
  const oi = args.indexOf('--out');
  if (oi >= 0) { outDir = resolve(args[oi + 1]); args.splice(oi, 2); }
  const variants = args.length ? args : ['actual', 'a', 'b', 'c'];
  mkdirSync(outDir, { recursive: true });
  for (const v of variants) {
    const { buf, steps } = renderDemo(v);
    const wav = join(outDir, `pasos-${v}.wav`);
    writeWav(wav, buf);
    const mp4 = join(outDir, `pasos-${v}.mp4`);
    makeVideo(v, wav, mp4);
    rmSync(wav, { force: true });
    const vols = steps.map((s) => s.volume);
    console.log(`${mp4}: ${steps.length} pisadas · volumen ${Math.min(...vols).toFixed(2)}–${Math.max(...vols).toFixed(2)} · muestras ${[...new Set(steps.map((s) => s.key))].length} (STEP_VOLUME actual ${STEP_VOLUME})`);
  }
}

// A12 (tráiler): premontaje MUDO de la versión 16:9 de 80 s siguiendo la tabla del guion (docs/progreso/A12.md).
//
//   node scripts/trailer/premontaje.mjs [--clips DIR] [--out FICHERO] [--contactos FICHERO]
//
// Por cada fila de EDL: un trozo del plano grabado (saltando su margen de 1 s), un rótulo (Press Start 2P del repo,
// blanco sobre negro) o, si el plano no existe todavía, negro con su nombre. Todo a 1920×1080, 60 fps, escalado
// siempre con flags=neighbor. Después concatena (concat demuxer, sin recodificar). Con --contactos además hace la
// hoja de contactos (un fotograma central de cada plano grabado con su nombre).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONT = join(ROOT, 'assets', 'fonts', 'PressStart2P-Regular.ttf');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const CLIPS = resolve(opt('clips', '/var/tmp/adv-trailer/clips'));
const OUT = resolve(opt('out', '/var/tmp/adv-trailer/out/premontaje-v0.mp4'));
const CONTACTS = opt('contactos', '/var/tmp/adv-trailer/out/contactos.png');
const TMP = join(dirname(OUT), 'premontaje-tmp');
const MARGIN = 1000;
const W = 1920, H = 1080, FPS = 60;

// La escena ocupa los 810 px de arriba del plano (debajo, la franja de la interfaz): se recorta y va centrada con bandas
// iguales, como en montaje.mjs (que además quita la banda de las cinemáticas y amplía los planos de pantalla).
const ESCENA_VF = `crop=iw:trunc(ih*3/8)*2:0:0,scale=${W}:808:flags=neighbor,pad=${W}:${H}:0:136:black`;

const clip = (name, dur, from = 0) => ({ clip: name, dur, from });
const card = (text, dur) => ({ card: text, dur });

/** Tabla del guion: [fila, segmentos]. Duraciones en ms; `from` = ms dentro del plano útil. */
export const EDL = [
  [1, [clip('01-crt-escaped', 4000, 600)]],
  [2, [card('THREE WEEKS AGO,\nTHE FOUNDER VANISHED.', 4000)]],
  [3, [clip('03-outside-intro', 6000, 1500)]],
  [4, [card('HE LEFT ONE MESSAGE.', 2000)]],
  [5, [clip('05a-dex-acera', 3000, 500), clip('05b-dex-idle', 2000, 4000), clip('05c-dooris-87', 5000, 7400)]],
  [6, [card('ONE DETECTIVE.\nZERO SOLVED CASES.', 2000)]],
  [7, [clip('07a-lobby-penny', 2000, 300), clip('07b-upstairs-rig', 2000, 500), clip('07c-rig-dashboard', 2000, 1500),
    clip('07d-cajon', 2000, 1000), clip('07e-sotano', 2000, 500), clip('07f-server-room', 2000, 500)]],
  [8, [card('FIVE CHAPTERS.', 2000)]],
  [9, [clip('09a-pzbot-terminal', 1500, 1500), clip('09b-chad-fud', 1500, 3000), clip('09c-montana', 1500, 500),
    clip('09d-clinica-fuera', 1500, 500), clip('09e-nurse-gwei', 1500, 1500), clip('09f-dr-satoshi', 1500, 1500),
    clip('09g-veleta', 1500, 1000), clip('09h-dex-mono', 1500, 500)]],
  [10, [card('ONE DUCK.', 1000), clip('10-gerald', 1000, 500)]],
  [11, [clip('11a-coger', 600), clip('11b-puerta', 600), clip('11c-escotilla', 600), clip('11d-pantalla', 600),
    clip('11e-correr', 700), clip('11f-transicion', 700), clip('11g-coger2', 600), clip('11h-puerta2', 600),
    clip('11i-cinematica', 700), clip('11j-correr2', 700), clip('11k-destello', 600), clip('13-lambo', 1000, 2500)]],
  [12, [card('ZERO EXCUSES.', 2000)]],
  [13, [clip('13-lambo', 6000, 300)]],
  [14, [clip('14-titulo', 4000, 500), card('PLAY FREE\nIN YOUR BROWSER', 2000), card('adventure.adrianzero.com', 2000)]],
];

function ff(argv) {
  const r = spawnSync('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', ...argv], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falló: ${argv.join(' ').slice(0, 300)}`);
}
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];

function textCard(file, text, dur, color = 'white', size = 40) {
  const lines = text.split('\n');
  const tf = lines.map((l, i) => {
    const p = `${file}.${i}.txt`;
    writeFileSync(p, l);
    const y = `(h-${lines.length}*${size * 2})/2+${i}*${size * 2}`;
    return `drawtext=fontfile=${FONT}:textfile=${p}:fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
  });
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${dur / 1000}`, '-vf', tf.join(','), ...ENC, file]);
}

function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const parts = [];
  const report = [];
  let n = 0;
  let t = 0;
  for (const [row, segs] of EDL) {
    for (const s of segs) {
      const file = join(TMP, `${String(n++).padStart(3, '0')}.mp4`);
      if (s.card) {
        textCard(file, s.card, s.dur);
        report.push(`${(t / 1000).toFixed(1).padStart(5)} s  fila ${row}  rótulo «${s.card.replace('\n', ' ')}»`);
      } else {
        const src = join(CLIPS, `${s.clip}.mp4`);
        if (existsSync(src)) {
          ff(['-ss', String((MARGIN + s.from) / 1000), '-t', String(s.dur / 1000), '-i', src,
            '-vf', `${ESCENA_VF},setsar=1,fps=${FPS}`, ...ENC, file]);
          report.push(`${(t / 1000).toFixed(1).padStart(5)} s  fila ${row}  ${s.clip}`);
        } else {
          textCard(file, `[FALTA] ${s.clip}`, s.dur, 'gray', 24);
          report.push(`${(t / 1000).toFixed(1).padStart(5)} s  fila ${row}  ${s.clip}  ← FALTA (negro)`);
        }
      }
      parts.push(file);
      t += s.dur;
    }
  }
  const list = join(TMP, 'lista.txt');
  writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  mkdirSync(dirname(OUT), { recursive: true });
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  console.log(report.join('\n'));
  console.log(`\n${OUT} · ${(t / 1000).toFixed(1)} s`);
  rmSync(TMP, { recursive: true, force: true });
}

/** Hoja de contactos: fotograma central de cada plano grabado, 4 columnas, con el nombre debajo */
function contacts() {
  const files = existsSync(CLIPS) ? readdirSync(CLIPS).filter((f) => f.endsWith('.mp4')).sort() : [];
  if (!files.length) { console.log('Sin planos: no hay hoja de contactos'); return; }
  const dir = join(dirname(CONTACTS), 'contactos-tmp');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const thumbs = [];
  for (const f of files) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(CLIPS, f)], { encoding: 'utf8' });
    const mid = (Number(probe.stdout.trim()) || 2) / 2;
    const png = join(dir, f.replace(/\.mp4$/, '.png'));
    const name = f.replace(/\.mp4$/, '');
    const isV = /^v/.test(name);
    ff(['-ss', String(mid), '-i', join(CLIPS, f), '-frames:v', '1', '-vf',
      `${isV ? 'scale=-1:360' : 'crop=iw:trunc(ih*3/8)*2:0:0,scale=640:-2'}:flags=neighbor,pad=640:400:(ow-iw)/2:0:black,drawtext=fontfile=${FONT}:text='${name}':fontcolor=white:fontsize=14:x=8:y=372`, png]);
    thumbs.push(png);
  }
  const r = spawnSync('magick', ['montage', ...thumbs, '-tile', '4x', '-geometry', '+4+4', '-background', '#222', CONTACTS], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('montage falló');
  rmSync(dir, { recursive: true, force: true });
  console.log(`${CONTACTS} · ${thumbs.length} planos`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!args.includes('--solo-contactos')) main();
  if (args.includes('--contactos') || args.includes('--solo-contactos')) contacts();
}

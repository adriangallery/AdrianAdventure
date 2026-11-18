// A12 (tráiler): MONTAJE FINAL con imagen y sonido a partir de los planos grabados (record.mjs) y del audio del tráiler.
//
//   node scripts/trailer/montaje.mjs [opciones]
//     --solo 80|30|vertical|thumbs   una sola versión (por defecto, todas; si una falla las demás siguen)
//     --borrador                     un plano que falte sale en negro con su nombre (sin esto: ERROR con la lista)
//     --escala 0.25                  todo a esa fracción de la resolución (pruebas rápidas; los fps no cambian)
//     --clips DIR                    planos (por defecto /var/tmp/adv-trailer/clips)
//     --audio DIR                    música, narrador y golpes (por defecto /var/tmp/adv-trailer/audio)
//     --out DIR                      salida (por defecto /var/tmp/adv-trailer/out)
//     --comprobar                    valida SIN renderizar: planos (existen y duran bastante), sonidos del repo,
//                                    ficheros de audio del tráiler y que las EDL sumen 80 000 / 30 000 ms exactos
//
// Salidas: trailer-80s.mp4 (16:9 1920×1080 60 fps), trailer-30s.mp4 (16:9), trailer-vertical.mp4 (9:16 1080×1920),
// thumb-1.png … thumb-3.png (1920×1080). H.264 yuv420p crf 16, AAC 192 kbps, +faststart; mezcla a −14 LUFS y pico
// real ≤ −1 dBTP (loudnorm en dos pasadas a −2 dBTP: el AAC sube algo el pico). Escalado SIEMPRE flags=neighbor (pixel art).
//
// Imagen: cada segmento de la EDL es un trozo de un plano (saltando su margen de 1 s; `from` = ms dentro del plano útil)
// o un rótulo (Press Start 2P del repo, blanco sobre negro, entrada con golpe: destello blanco + sacudida). Opcional por
// segmento: `kb: [z0, z1]` zoom lento tipo Ken Burns (escala por fotograma con neighbor + recorte centrado; factor
// pequeño y solo en planos quietos), `fi`/`fo` fundidos a/desde negro en ms (por defecto 100 ms en los bordes de bloque).
// Sonido del juego: `sonidos: [regex…]` sobre la ruta del fichero de `clips/<plano>.audio.json` (t = ms desde el primer
// fotograma del mp4); cada sonido cae en salida = inicio del segmento + (t − margen − from); `cola` = ms que puede sonar
// pasado el corte (J/L-cut). Las voces del juego bajan la música 9 dB (rampa 150 ms / vuelta 300 ms).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDL as EDL_PREMONTAJE } from './premontaje.mjs';
import { SHOTS } from './shots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONT = join(ROOT, 'assets', 'fonts', 'PressStart2P-Regular.ttf');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const CLIPS = resolve(opt('clips', '/var/tmp/adv-trailer/clips'));
const AUDIO = resolve(opt('audio', '/var/tmp/adv-trailer/audio'));
const OUT = resolve(opt('out', '/var/tmp/adv-trailer/out'));
const SOLO = opt('solo', null);
const BORRADOR = has('borrador');
const ESCALA = Number(opt('escala', '1'));
const MARGIN = 1000;
const FPS = 60;
const SR = 48000;
const LUFS = -14;
const TP = -2; // objetivo del loudnorm (deja margen al AAC, que sube el pico ~0,5 dB: el máximo admitido es −1 dBTP)
const DUCK_DB = -9;

// ─────────────────────────────── EDL ───────────────────────────────
const clip = (name, dur, from = 0, extra = {}) => ({ clip: name, dur, from, ...extra });
const card = (text, dur, extra = {}) => ({ card: text, dur, ...extra });
const VOZ = ['/voice/'];
const SFX = ['/sfx/'];

/**
 * 80 s (tabla del guion). Igual que EDL de premontaje.mjs salvo (ver `--comprobar`, que lista las diferencias):
 *  - 05c-dooris-87 desde 6900 (con 7400 + 5000 el premontaje pide 400 ms más de lo que tiene el mp4: 11 s útiles + 1 s);
 *  - 07a-lobby-penny desde 0 (la voz de Penny arranca en el 0 del plano útil);
 *  - fila 9 reordenada: Chad (09b) desde 0 en 48,0 s, después de que acabe el narrador 4 (42,2–47,3), con su réplica
 *    sonando por debajo de los planos siguientes; el resto, igual que en el premontaje.
 */
export const EDL80 = [
  [1, [clip('01-crt-escaped', 4000, 600, { fi: 600, sonidos: SFX })]],
  [2, [card('THREE WEEKS AGO,\nTHE FOUNDER VANISHED.', 4000)]],
  [3, [clip('03-outside-intro', 6000, 1500, { fi: 250 })]],
  [4, [card('HE LEFT ONE MESSAGE.', 2000)]],
  [5, [clip('05a-dex-acera', 3000, 500), clip('05b-dex-idle', 2000, 4000, { kb: [1, 1.03] }),
    clip('05c-dooris-87', 5000, 6900, { sonidos: VOZ, cola: 2000 })]],
  [6, [card('ONE DETECTIVE.\nZERO SOLVED CASES.', 2000)]],
  [7, [clip('07a-lobby-penny', 2000, 0, { sonidos: VOZ, cola: 1500 }), clip('07b-upstairs-rig', 2000, 500, { kb: [1, 1.04] }),
    clip('07c-rig-dashboard', 2000, 1500), clip('07d-cajon', 2000, 1000, { sonidos: VOZ, cola: 2000 }),
    clip('07e-sotano', 2000, 500), clip('07f-server-room', 2000, 500)]],
  [8, [card('FIVE CHAPTERS.', 2000)]],
  [9, [clip('09a-pzbot-terminal', 1500, 1500), clip('09c-montana', 1500, 500, { kb: [1, 1.04] }),
    clip('09d-clinica-fuera', 1500, 500), clip('09e-nurse-gwei', 1500, 1500),
    clip('09b-chad-fud', 1500, 0, { sonidos: VOZ, cola: 2600 }), clip('09f-dr-satoshi', 1500, 1500),
    clip('09g-veleta', 1500, 1000), clip('09h-dex-mono', 1500, 500)]],
  [10, [card('ONE DUCK.', 1000), clip('10-gerald', 1000, 500, { kb: [1, 1.06], fi: 0 })]],
  [11, [clip('11a-coger', 600), clip('11b-puerta', 600), clip('11c-escotilla', 600), clip('11d-pantalla', 600),
    clip('11e-correr', 700), clip('11f-transicion', 700), clip('11g-coger2', 600), clip('11h-puerta2', 600),
    clip('11i-cinematica', 700), clip('11j-correr2', 700), clip('11k-destello', 600), clip('13-lambo', 1000, 2500, { fo: 0 })]],
  [12, [card('ZERO EXCUSES.', 2000)]],
  [13, [clip('13-lambo', 6000, 300, { fi: 300, sonidos: [...VOZ, ...SFX], cola: 300 })]],
  [14, [clip('14-titulo', 4000, 500, { fi: 200, kb: [1, 1.03] }), card('PLAY FREE\nIN YOUR BROWSER', 2000, { golpe: false, fi: 150 }),
    card('adventure.adrianzero.com', 2000, { golpe: false, fo: 900 })]],
];
/** Base del audio de 80 s: la premezcla (música + narrador + golpes). Ventanas en las que NO se baja (golpes de rótulo). */
const AUDIO80 = [{ file: 'premezcla-80s.wav', at: 0, start: 0, len: 80000, kind: 'musica', fi: 0, fo: 0 }];
const PROTEGER80 = [[26000, 26700], [40000, 40700], [54000, 55000], [64000, 66000]];

/** 30 s (cortes derivados): 1 (3 s) → DOORIS (6 s) → rótulos con 9 y 11 (14 s) → Lambo (3 s) → título + URL (4 s) */
export const EDL30 = [
  [1, [clip('01-crt-escaped', 3000, 600, { fi: 400, sonidos: SFX })]],
  [5, [clip('05c-dooris-87', 6000, 5900, { sonidos: VOZ, cola: 2000 })]],
  [8, [card('FIVE CHAPTERS.', 1500)]],
  [9, [clip('09a-pzbot-terminal', 1000, 1500), clip('09b-chad-fud', 1000, 3000), clip('09e-nurse-gwei', 1000, 1500),
    clip('09g-veleta', 1500, 1000)]],
  [10, [card('ONE DUCK.', 1000), clip('10-gerald', 1000, 500, { kb: [1, 1.06], fi: 0 })]],
  [11, [clip('11a-coger', 500), clip('11b-puerta', 500), clip('11c-escotilla', 500), clip('11d-pantalla', 500),
    clip('11e-correr', 500), clip('11i-cinematica', 500), clip('11k-destello', 500), clip('11h-puerta2', 500, 0, { fo: 0 })]],
  [12, [card('ZERO EXCUSES.', 2000)]],
  [13, [clip('13-lambo', 3000, 300, { fi: 200, sonidos: SFX, cola: 0 })]], // solo el motor: el narrador 5 entra en 25,2 s
  [14, [clip('14-titulo', 2000, 1000, { fi: 150 }), card('PLAY FREE\nadventure.adrianzero.com', 2000, { golpe: false, fo: 700, size: 32 })]],
];
/** música-80s en tramos de compases (2 s a 120 BPM; la rejilla ya cae en segundos pares) + golpes + narrador 5 */
const tramo = (srcMs, len, at, extra = {}) => ({ file: 'musica-80s.wav', start: srcMs, len, at, kind: 'musica', fi: 30, fo: 30, ...extra });
const AUDIO30 = [
  tramo(0, 3000, 0, { fi: 0 }), // aire del principio
  tramo(14000, 6000, 3000, { fo: 120 }), // tensión (3 compases) bajo DOORIS (baja sola bajo su voz)
  { file: 'hit-1.wav', at: 3000, gainDb: -6 },
  tramo(42000, 6000, 9000), // doble tiempo (3 compases) con rótulo y fila 9
  { file: 'hit-4.wav', at: 9000, gainDb: -6 },
  { file: 'hit-5.wav', at: 15000, gainDb: -6 }, // 15–17 corte seco de música
  { file: 'quack-gerald.wav', at: 16000, gainDb: -4 },
  tramo(60000, 4000, 17000), // final del crescendo (2 compases) hasta el golpe
  { file: 'riser-4s.wav', at: 17077, gainDb: -8 },
  { file: 'hit-6.wav', at: 21000, gainDb: -6 }, // 21–26 sin música (rótulo + Lambo)
  tramo(72000, 4000, 26000, { fo: 1200 }), // acorde final
  { file: 'nar-5.wav', at: 25200, gainDb: 4 },
];

/** Vertical 9:16 (planos v… grabados en viewport móvil 390×844 ×2,77 = 1080×2337; se recorta el alto a 1080×1920) */
export const EDLV = [
  [1, [clip('v01-crt-escaped', 2500, 600, { fi: 400, sonidos: SFX })]],
  [5, [clip('v05a-dex-acera', 2000, 500), clip('v05c-dooris-87', 6000, 5900, { sonidos: VOZ, cola: 1500 })]],
  [9, [clip('v09b-chad-fud', 500, 0), clip('v11c-escotilla', 500, 0), clip('v09b-chad-fud', 750, 3000),
    clip('v13-lambo', 750, 2500), clip('v11c-escotilla', 750, 1000), clip('v13-lambo', 750, 4000, { fo: 0 })]],
  [14, [clip('v14-titulo', 4000, 500, { fi: 150, kb: [1, 1.03] }), card('PLAY FREE\nIN YOUR\nBROWSER', 1500, { golpe: false, size: 44 }),
    card('adventure.\nadrianzero.com', 2000, { golpe: false, fo: 700, size: 44 })]],
];
const AUDIOV = [
  tramo(0, 2500, 0, { fi: 0 }),
  tramo(12000, 8000, 2500, { fo: 120 }), // tensión bajo Dex y DOORIS (baja sola bajo la voz)
  { file: 'hit-2.wav', at: 2500, gainDb: -6 },
  tramo(44000, 4000, 10500), // planos rápidos
  { file: 'hit-3.wav', at: 10500, gainDb: -6 },
  tramo(72000, 7500, 14500, { fo: 1500 }), // acorde final y cola
  { file: 'hit-4.wav', at: 14500, gainDb: -6 },
  { file: 'nar-5.wav', at: 16800, gainDb: 4 },
];
const DUR_V = [20000, 25000];

/** Miniaturas: plano, ms dentro del plano útil, título encima */
export const THUMBS = [
  { clip: '05c-dooris-87', ms: 9000, titulo: true },
  { clip: '13-lambo', ms: 4000, titulo: true },
  { clip: '09b-chad-fud', ms: 3500, titulo: false },
];
const TITULO = 'ZEROadventure II';

/** Planos con cartera/$ZERO (corte sin web3 de Steam) */
const WEB3 = new Set(SHOTS.filter((s) => s.web3).map((s) => s.name));

const VERSIONES = {
  80: { edl: EDL80, audio: AUDIO80, proteger: PROTEGER80, total: 80000, w: 1920, h: 1080, out: 'trailer-80s.mp4' },
  30: { edl: EDL30, audio: AUDIO30, proteger: [], total: 30000, w: 1920, h: 1080, out: 'trailer-30s.mp4' },
  vertical: { edl: EDLV, audio: AUDIOV, proteger: [], total: null, w: 1080, h: 1920, out: 'trailer-vertical.mp4', vertical: true },
};

// ─────────────────────────────── utilidades ───────────────────────────────
function ff(argv, { quiet = false } = {}) {
  const r = spawnSync('nice', ['-n', '10', 'ffmpeg', '-hide_banner', '-nostats', '-loglevel', quiet ? 'info' : 'error', '-y', ...argv],
    { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'], maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg falló: ${argv.join(' ').slice(0, 400)}\n${(r.stderr ?? '').slice(-1500)}`);
  return r.stderr ?? '';
}
const probeCache = new Map();
function durMs(file) {
  if (!probeCache.has(file)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    probeCache.set(file, Math.round(Number(r.stdout.trim()) * 1000) || 0);
  }
  return probeCache.get(file);
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const fr = (ms) => Math.round((ms * FPS) / 1000);
const s3 = (ms) => (ms / 1000).toFixed(3);
const clipPath = (name) => join(CLIPS, `${name}.mp4`);
const segsOf = (edl) => edl.flatMap(([row, segs]) => segs.map((s, i) => ({ ...s, row, first: i === 0, last: i === segs.length - 1 })));
const totalOf = (edl) => segsOf(edl).reduce((a, s) => a + s.dur, 0);

/** clave de sonido → fichero del repo (misma regla que record.mjs, por si el audio.json trae file: null) */
let audioIndex = null;
function audioFile(key) {
  if (!audioIndex) {
    audioIndex = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mp3|ogg|wav|m4a)$/.test(e.name)) {
          const k = e.name.replace(/\.[^.]+$/, '');
          if (!audioIndex.has(k) || e.name.endsWith('.mp3')) audioIndex.set(k, p.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, 'assets', 'audio'));
  }
  return audioIndex.get(key) ?? audioIndex.get(key.replace(/^(sfx|amb|music|voice)_/, '')) ?? null;
}
const jsonCache = new Map();
function audioJson(name) {
  if (!jsonCache.has(name)) {
    const p = join(CLIPS, `${name}.audio.json`);
    jsonCache.set(name, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  }
  return jsonCache.get(name);
}

/** Sonidos del juego de un segmento, colocados en la línea de tiempo de salida */
function gameSounds(seg, segStart, total, notes) {
  if (!seg.sonidos?.length) return [];
  const j = audioJson(seg.clip);
  if (!j) { notes.push(`${seg.clip}: sin ${seg.clip}.audio.json (pedía sonido del juego)`); return []; }
  const margin = j.marginMs ?? MARGIN;
  const ws = margin + seg.from, we = ws + seg.dur;
  const res = [];
  for (const a of j.clips ?? []) {
    if (a.loop && !seg.bucles) continue;
    const rel = a.file ?? audioFile(a.key);
    if (!rel) { notes.push(`${seg.clip}: sonido «${a.key}» sin fichero en assets/audio`); continue; }
    if (!seg.sonidos.some((re) => new RegExp(re).test(`/${rel}`))) continue;
    const file = join(ROOT, rel);
    if (!existsSync(file)) { notes.push(`${seg.clip}: no existe ${rel}`); continue; }
    const sd = durMs(file);
    if (a.t >= we || a.t + sd <= ws) continue;
    const head = Math.max(0, ws - a.t);
    const at = segStart + Math.max(0, a.t - ws);
    const end = Math.min(segStart + seg.dur + (seg.cola ?? 0), total);
    const len = Math.min(sd - head, end - at);
    if (len < 80) continue;
    const cut = sd - head - len;
    const voz = /\/voice\//.test(`/${rel}`);
    res.push({ file, rel, at, start: head, len, kind: voz ? 'voz' : 'efecto', lufs: voz ? -16 : /lambo/.test(rel) ? -15 : -22,
      fi: head ? 20 : 0, fo: cut > 0 ? 60 : 10 });
    if (head > 60) notes.push(`${seg.clip}: ${rel.split('/').pop()} empieza ${head} ms antes del corte (se pierde la cabeza)`);
    if (cut > 150) notes.push(`${seg.clip}: ${rel.split('/').pop()} recortado ${cut} ms al final (en ${s3(at + len)} s)`);
  }
  return res;
}

// ─────────────────────────────── comprobar ───────────────────────────────
function comprobar() {
  let errores = 0;
  const err = (m) => { errores++; console.log(`  ✖ ${m}`); };
  const shot = (n) => SHOTS.find((s) => s.name === n);
  for (const [ver, v] of Object.entries(VERSIONES)) {
    console.log(`\n== ${ver} (${v.out})`);
    const total = totalOf(v.edl);
    if (v.total != null && total !== v.total) err(`la EDL suma ${total} ms, no ${v.total}`);
    else if (v.total == null && (total < DUR_V[0] || total > DUR_V[1])) err(`la EDL suma ${total} ms (fuera de ${DUR_V.join('–')})`);
    else console.log(`  ✔ EDL: ${total} ms`);
    const faltan = new Set();
    let t = 0;
    const notes = [];
    const sounds = [];
    for (const s of segsOf(v.edl)) {
      if (s.clip) {
        const sh = shot(s.clip);
        if (!sh) err(`${s.clip}: no está en shots.mjs`);
        else if (s.from + s.dur > sh.dur + MARGIN) err(`${s.clip}: from ${s.from} + ${s.dur} ms se sale del plano (${sh.dur} ms útiles + 1 s de margen)`);
        else if (s.from + s.dur > sh.dur) console.log(`  · ${s.clip}: usa ${s.from + s.dur - sh.dur} ms del margen de detrás`);
        const p = clipPath(s.clip);
        if (!existsSync(p)) faltan.add(s.clip);
        else {
          const need = MARGIN + s.from + s.dur, have = durMs(p);
          if (have + 1000 / FPS < need) err(`${s.clip}: dura ${have} ms y hacen falta ${need} (margen + from + dur)`);
          sounds.push(...gameSounds(s, t, total, notes));
        }
      }
      t += s.dur;
    }
    if (faltan.size) err(`faltan ${faltan.size} planos: ${[...faltan].join(' ')}`);
    else console.log('  ✔ todos los planos existen y duran bastante');
    for (const a of v.audio) if (!existsSync(join(AUDIO, a.file))) err(`no existe ${join(AUDIO, a.file)}`);
    for (const a of v.audio) {
      if (a.kind === 'musica' && existsSync(join(AUDIO, a.file)) && a.start + a.len > durMs(join(AUDIO, a.file))) err(`${a.file}: ${a.start}+${a.len} se sale`);
    }
    for (const n of notes) console.log(`  ! ${n}`);
    for (const x of sounds) console.log(`  ♪ ${s3(x.at)}–${s3(x.at + x.len)} s  ${x.kind}  ${x.rel}`);
    const w3 = [...new Set(segsOf(v.edl).filter((s) => s.clip && WEB3.has(s.clip.replace(/^v/, ''))).map((s) => s.clip))];
    if (w3.length) console.log(`  · enseñan cartera/$ZERO: ${w3.join(', ')}`);
  }
  console.log('\n== thumbs');
  for (const th of THUMBS) {
    const sh = shot(th.clip);
    if (!sh) err(`${th.clip}: no está en shots.mjs`);
    else if (th.ms > sh.dur) err(`${th.clip}: ${th.ms} ms pasa del plano útil (${sh.dur})`);
    if (!existsSync(clipPath(th.clip))) err(`falta ${th.clip}`);
  }
  // diferencias con el premontaje (por si se retoca allí un recorte después de mirar la hoja de contactos)
  const key = (s) => `${s.row}:${s.clip ?? s.card}`;
  const pre = new Map(segsOf(EDL_PREMONTAJE).map((s) => [key(s), s]));
  const dif = segsOf(EDL80).filter((s) => s.clip).flatMap((s) => {
    const p = pre.get(key(s));
    return !p ? [`${s.clip} (fila ${s.row}) no está en el premontaje`] : p.from !== s.from || p.dur !== s.dur ? [`${s.clip}: premontaje ${p.from}/${p.dur}, montaje ${s.from}/${s.dur}`] : [];
  });
  if (dif.length) console.log(`\n· EDL80 frente a premontaje.mjs (from/dur):\n  ${dif.join('\n  ')}`);
  console.log(errores ? `\n${errores} problema(s)` : '\nTodo en orden');
  return errores ? 1 : 0;
}

// ─────────────────────────────── vídeo ───────────────────────────────
const ENC_TMP = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];

function cardSeg(file, s, W, H, k) {
  const lines = s.card.split('\n');
  const size = Math.max(6, Math.round((s.size ?? 40) * k));
  const lh = size * 2;
  const golpe = s.golpe !== false;
  const amp = Math.max(1, Math.round(6 * k));
  const shake = golpe ? `+if(lt(t\\,0.2)\\,round(${amp}*sin(t*130)*(1-t/0.2))\\,0)` : '';
  const vf = lines.map((l, i) => {
    const p = `${file}.${i}.txt`;
    writeFileSync(p, l);
    return `drawtext=fontfile=${FONT}:textfile=${p}:fontcolor=${s.color ?? 'white'}:fontsize=${size}:x=(w-text_w)/2${shake}:y=(h-${lines.length * lh})/2+${i * lh}+${Math.round(size / 2)}`;
  });
  if (golpe) vf.push('fade=t=in:st=0:d=0.1:color=white');
  else if (s.fi) vf.push(`fade=t=in:st=0:d=${s.fi / 1000}`);
  if (s.fo) vf.push(`fade=t=out:st=${(s.dur - s.fo) / 1000}:d=${s.fo / 1000}`);
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`, '-vf', vf.join(','), '-frames:v', String(fr(s.dur)), ...ENC_TMP, file]);
}

/** Cadena de filtros de un plano: encuadre (16:9 o 9:16 recortado), Ken Burns opcional y fundidos */
function clipChain(s, W, H, vertical, fade = true) {
  const f = ['setpts=PTS-STARTPTS', `fps=${FPS}`];
  if (vertical) f.push(`crop=iw:trunc(iw*16/9/2)*2:0:(ih-oh)*${s.cy ?? 0.5}`);
  f.push(`scale=${W}:${H}:flags=neighbor`);
  if (s.kb) {
    const [z0, z1] = s.kb;
    const z = `(${z0}+${z1 - z0}*t/${s.dur / 1000})`;
    f.push(`scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame:flags=neighbor`,
      `crop=${W}:${H}:(iw-${W})*${s.ax ?? 0.5}:(ih-${H})*${s.ay ?? 0.5}`);
  }
  if (fade) {
    const fi = s.fi ?? (s.first ? 100 : 0), fo = s.fo ?? (s.last ? 100 : 0);
    if (fi) f.push(`fade=t=in:st=0:d=${fi / 1000}`);
    if (fo) f.push(`fade=t=out:st=${(s.dur - fo) / 1000}:d=${fo / 1000}`);
  }
  f.push('setsar=1', 'format=yuv420p', 'tpad=stop_mode=clone:stop_duration=1');
  return f.join(',');
}

function clipSeg(file, s, W, H, vertical) {
  ff(['-ss', s3(MARGIN + s.from), '-i', clipPath(s.clip), '-vf', clipChain(s, W, H, vertical), '-frames:v', String(fr(s.dur)), ...ENC_TMP, file]);
}

// ─────────────────────────────── audio ───────────────────────────────
const lufsCache = new Map();
/** Sonoridad integrada de un sonido del juego (o pico si es demasiado corto para medirla) */
function measure(file) {
  if (!lufsCache.has(file)) {
    const e = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { quiet: true });
    const sum = e.slice(e.lastIndexOf('Summary:'));
    const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]);
    const P = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(sum)?.[1]);
    lufsCache.set(file, { I: Number.isFinite(I) && I > -60 ? I : null, P: Number.isFinite(P) ? P : -6 });
  }
  return lufsCache.get(file);
}

/** Mezcla: capas de música/base (bajan 9 dB bajo las voces del juego, salvo en `proteger`) + el resto, en float */
function mix(layers, total, proteger, outWav) {
  const inputs = [];
  const chains = [];
  const mus = [], rest = [];
  const voces = [];
  layers.forEach((L, k) => {
    inputs.push('-i', L.file);
    let g = L.gainDb ?? 0;
    if (L.lufs != null) {
      const m = measure(L.file);
      g = m.I != null ? L.lufs - m.I : -6 - m.P;
      g = Math.max(-30, Math.min(18, g));
      if (m.I != null && m.P + g > -1) g = -1 - m.P; // ninguna voz suelta pasa de −1 dBFS antes del máster
    }
    const c = [`aresample=${SR}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', `atrim=start=${s3(L.start ?? 0)}:duration=${s3(L.len)}`,
      'asetpts=PTS-STARTPTS', `volume=${g.toFixed(2)}dB`];
    if (L.fi) c.push(`afade=t=in:st=0:d=${L.fi / 1000}`);
    if (L.fo) c.push(`afade=t=out:st=${Math.max(0, L.len - L.fo) / 1000}:d=${L.fo / 1000}`);
    c.push(`adelay=${Math.round(L.at)}:all=1`, `apad=whole_dur=${s3(total)}`);
    chains.push(`[${k}:a]${c.join(',')}[l${k}]`);
    (L.kind === 'musica' ? mus : rest).push(`[l${k}]`);
    if (L.kind === 'voz') voces.push([L.at, L.at + L.len]);
  });
  const G = 10 ** (DUCK_DB / 20);
  const ramps = voces.map(([a, b]) => `min(clip((t-${s3(a - 150)})/0.15\\,0\\,1)\\,clip((${s3(b + 300)}-t)/0.3\\,0\\,1))`);
  let duck = ramps.length ? ramps.reduce((acc, r) => (acc ? `max(${acc}\\,${r})` : r), '') : '0';
  if (ramps.length && proteger.length) duck = `${duck}*(1-(${proteger.map(([a, b]) => `between(t\\,${s3(a)}\\,${s3(b)})`).join('+')}))`;
  const amix = (ins, label) => (ins.length === 1 ? `${ins[0]}anull[${label}]` : `${ins.join('')}amix=inputs=${ins.length}:normalize=0:duration=longest[${label}]`);
  if (mus.length) {
    chains.push(amix(mus, 'mus'));
    chains.push(`[mus]volume='1-${(1 - G).toFixed(4)}*(${duck})':eval=frame[musd]`);
    rest.unshift('[musd]');
  }
  chains.push(amix(rest, 'pre'));
  chains.push(`[pre]atrim=duration=${s3(total)}[out]`);
  ff([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', String(SR), outWav]);
  return voces;
}

/** loudnorm en dos pasadas a −14 LUFS / −2 dBTP; si aun así el pico real pasa de −1,8, baja la ganancia */
function master(inWav, outWav) {
  const e = ff(['-i', inWav, '-af', `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-'], { quiet: true });
  const m = JSON.parse(e.slice(e.lastIndexOf('{'), e.lastIndexOf('}') + 1));
  const ln = `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
  ff(['-i', inWav, '-af', `${ln},aresample=${SR}`, '-c:a', 'pcm_f32le', outWav]);
  let r = loudness(outWav);
  if (r.tp > -1.8) {
    const tmp = `${outWav}.tmp.wav`;
    ff(['-i', outWav, '-af', `volume=${(-1.8 - r.tp).toFixed(2)}dB`, '-c:a', 'pcm_f32le', tmp]);
    ff(['-i', tmp, '-c', 'copy', outWav]);
    rmSync(tmp, { force: true });
    r = loudness(outWav);
  }
  return r;
}
function loudness(file) {
  const e = ff(['-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { quiet: true });
  const sum = e.slice(e.lastIndexOf('Summary:'));
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), tp: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]), lra: Number(/LRA:\s+(-?[\d.]+) LU/.exec(sum)?.[1]) };
}

// ─────────────────────────────── versiones ───────────────────────────────
function render(ver) {
  const v = VERSIONES[ver];
  const W = even(v.w * ESCALA), H = even(v.h * ESCALA), k = (v.vertical ? v.w : v.h) / (v.vertical ? 1080 : 1080) * ESCALA;
  const total = totalOf(v.edl);
  if (v.total != null && total !== v.total) throw new Error(`EDL de ${ver} suma ${total} ms, no ${v.total}`);
  const segs = segsOf(v.edl);
  const faltan = [...new Set(segs.filter((s) => s.clip && !existsSync(clipPath(s.clip))).map((s) => s.clip))];
  if (faltan.length && !BORRADOR) {
    throw new Error(`faltan ${faltan.length} planos para ${ver}${v.vertical ? ' (verticales: record.mjs v)' : ''}: ${faltan.join(' ')} (o --borrador)`);
  }
  for (const a of v.audio) if (!existsSync(join(AUDIO, a.file))) throw new Error(`no existe ${join(AUDIO, a.file)}`);
  const TMP = join(OUT, `montaje-tmp-${ver}`);
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const parts = [], report = [], notes = [], game = [];
  let t = 0;
  segs.forEach((s, n) => {
    const file = join(TMP, `${String(n).padStart(3, '0')}.mp4`);
    if (s.card) {
      cardSeg(file, s, W, H, k);
      report.push(`${s3(t).padStart(7)}  fila ${String(s.row).padStart(2)}  rótulo «${s.card.replace(/\n/g, ' ')}»`);
    } else if (existsSync(clipPath(s.clip))) {
      clipSeg(file, s, W, H, v.vertical);
      game.push(...gameSounds(s, t, total, notes));
      report.push(`${s3(t).padStart(7)}  fila ${String(s.row).padStart(2)}  ${s.clip} [${s.from}+${s.dur}]${s.kb ? ` kb ${s.kb.join('→')}` : ''}`);
    } else {
      cardSeg(file, { card: `[FALTA]\n${s.clip}`, dur: s.dur, color: 'gray', size: 24, golpe: false }, W, H, k);
      report.push(`${s3(t).padStart(7)}  fila ${String(s.row).padStart(2)}  ${s.clip}  ← FALTA (negro)`);
    }
    parts.push(file);
    t += s.dur;
  });
  // audio
  const layers = [...v.audio.map((a) => ({ fi: 0, fo: 0, start: 0, kind: 'efecto', ...a, file: join(AUDIO, a.file),
    len: a.len ?? Math.min(durMs(join(AUDIO, a.file)), total - a.at) })), ...game];
  const pre = join(TMP, 'mezcla-pre.wav'), wav = join(TMP, 'mezcla.wav');
  mix(layers, total, v.proteger, pre);
  const lw = master(pre, wav);
  // vídeo final
  const list = join(TMP, 'lista.txt');
  writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  mkdirSync(OUT, { recursive: true });
  const out = join(OUT, v.out);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', ESCALA < 1 ? 'veryfast' : 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-t', s3(total), '-movflags', '+faststart', out]);
  const lm = loudness(out);
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames', '-of', 'compact=p=0', out], { encoding: 'utf8' }).stdout.trim();
  console.log(`\n== ${ver}\n${report.join('\n')}`);
  for (const g of game) console.log(`  ♪ ${s3(g.at)}–${s3(g.at + g.len)} s  ${g.kind}  ${g.rel}`);
  for (const x of notes) console.log(`  ! ${x}`);
  console.log(`${out}\n  ${pr.replace(/\n/g, '\n  ')}\n  mezcla (wav): ${lw.I} LUFS, pico real ${lw.tp} dBTP, LRA ${lw.lra} · mp4: ${lm.I} LUFS, pico real ${lm.tp} dBTP`);
  rmSync(TMP, { recursive: true, force: true });
  return { out, faltan };
}

function thumbs() {
  const W = even(1920 * ESCALA), H = even(1080 * ESCALA), k = ESCALA;
  const faltan = THUMBS.filter((th) => !existsSync(clipPath(th.clip))).map((th) => th.clip);
  if (faltan.length && !BORRADOR) throw new Error(`faltan planos para las miniaturas: ${faltan.join(' ')}`);
  mkdirSync(OUT, { recursive: true });
  const TMP = join(OUT, 'montaje-tmp-thumbs');
  mkdirSync(TMP, { recursive: true });
  THUMBS.forEach((th, i) => {
    const out = join(OUT, `thumb-${i + 1}.png`);
    const tf = join(TMP, 'titulo.txt');
    writeFileSync(tf, TITULO);
    const title = th.titulo ? `,drawtext=fontfile=${FONT}:textfile=${tf}:fontcolor=white:fontsize=${Math.round(72 * k)}:borderw=${Math.max(1, Math.round(8 * k))}:bordercolor=black:x=(w-text_w)/2:y=h*0.08` : '';
    if (!existsSync(clipPath(th.clip))) {
      ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1', '-vf', `drawtext=fontfile=${FONT}:text='FALTA ${th.clip}':fontcolor=gray:fontsize=${Math.round(24 * k)}:x=(w-text_w)/2:y=(h-text_h)/2${title}`, out]);
    } else {
      ff(['-ss', s3(MARGIN + th.ms), '-i', clipPath(th.clip), '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=neighbor,setsar=1${title}`, out]);
    }
    console.log(`${out}  ← ${th.clip} @ ${th.ms} ms${th.titulo ? ' + título' : ''}`);
  });
  rmSync(TMP, { recursive: true, force: true });
}

// ─────────────────────────────── main ───────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (has('comprobar')) process.exit(comprobar());
  if (!(ESCALA > 0 && ESCALA <= 1)) throw new Error('--escala entre 0 y 1');
  const todas = ['80', '30', 'vertical', 'thumbs'];
  const pedir = SOLO ? [SOLO] : todas;
  if (pedir.some((p) => !todas.includes(p))) throw new Error(`--solo ${SOLO}: usa 80|30|vertical|thumbs`);
  const fallos = [];
  for (const p of pedir) {
    try {
      if (p === 'thumbs') thumbs(); else render(p);
    } catch (e) {
      fallos.push(p);
      console.error(`\n✖ ${p}: ${e.message}`);
    }
  }
  console.log(fallos.length ? `\nFallaron: ${fallos.join(', ')}` : '\nHecho');
  process.exit(fallos.length ? 1 : 0);
}

// A8.4 (plan SCUMM): efectos de sonido con ElevenLabs (Sound Effects API) a partir de `art/sfx/sfx.json`.
//
//   node scripts/audio/eleven-sfx.mjs [ids…] [--grupo pasos] [--dry] [--solo-cache] [--min-libres 15000] [--tope 6000]
//
// - Clave: ~/.secrets/elevenlabs.key (o ELEVENLABS_KEY_FILE). No se imprime nunca: ni en logs ni en errores.
// - Cuerpo: { text, duration_seconds, prompt_influence, model_id } (duración SIEMPRE explícita: controla el coste).
// - Caché: /var/tmp/adv-sfx/cache/<id>.<hash12>.mp3 (hash del cuerpo + formato). Si existe no se pide: relanzar no cobra.
//   `--solo-cache` no llama nunca a la API (reprocesa lo descargado).
// - Lote: lee el saldo (GET /v1/user/subscription) antes; si quedan menos de `--min-libres` + lo que costaría el lote
//   (estimado a la tarifa medida), no genera. Después relee el saldo y apunta UNA línea por lote en elevenlabs-gasto.tsv
//   con los créditos reales (diferencia de character_count; ojo: otro proceso gastando a la vez se suma).
// - `--no-escribe <ids>`: no hay; para quedarse con el sintetizado de una clave: `git checkout` del mp3 y quitarla de
//   art/sfx/generados.json.
// - Proceso (ffmpeg): mono 44,1 kHz, recorte de silencios, `split` = cortar en N golpes (pasos), nivel igualado al
//   RMS (parte con sonido) del mp3 sintetizado de `ref_commit` (mismo volumen relativo que hoy), pico ≤ −1 dBFS,
//   fundidos de 3 ms / 25 ms (sin clic), MP3 VBR q2 → assets/audio/sfx/<id>.mp3 (o <id>_1..N.mp3 con split).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.elevenlabs.io';
const KEY_FILE = process.env.ELEVENLABS_KEY_FILE || join(homedir(), '.secrets', 'elevenlabs.key');
const GASTO = process.env.ELEVENLABS_GASTO_TSV || join(homedir(), 'srv', 'orquestador', 'planes', 'ADVENTURE_SCUMM', 'elevenlabs-gasto.tsv');
const CACHE = process.env.ADV_SFX_CACHE || '/var/tmp/adv-sfx/cache';
const OUT = join(ROOT, 'assets', 'audio', 'sfx');
const USD_POR_CREDITO = 0.0002;
/** Créditos por segundo pedidos (medido en el primer lote, ver docs/progreso/A8.4.md); solo para la estimación previa */
export const TARIFA_ESTIMADA = 18; // medida el 14-nov: 122 créditos por 7 s (17,4/s)
const SR = 44100;

export const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'art', 'sfx', 'sfx.json'), 'utf8'));

export function bodyOf(e, m = MANIFEST) {
  return { text: e.prompt, duration_seconds: e.dur, prompt_influence: e.influence ?? m.prompt_influence, model_id: m.model_id };
}
export function hashOf(e, m = MANIFEST) {
  return createHash('sha256').update(JSON.stringify({ ...bodyOf(e, m), f: m.output_format, seed: e.seed ?? null })).digest('hex').slice(0, 12);
}
/** Claves de assets/audio/sfx que escribe una entrada */
export function keysOf(e) {
  return e.split ? Array.from({ length: e.split }, (_, i) => `${e.id}_${i + 1}`) : [e.id];
}
/** Todas las claves que salen de ElevenLabs (make-sfx.mjs no las pisa) */
export const ELEVEN_KEYS = MANIFEST.efectos.flatMap(keysOf);

// ---------- audio (Float32 mono) ----------
function decode(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg no pudo leer ${file}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
}
function decodeBuf(buf) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', '-', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { input: buf, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg no pudo leer el audio de referencia');
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
}
function encode(x, mp3) {
  const pcm = Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-q:a', '5', mp3], { input: pcm });
  if (r.status !== 0) throw new Error(`ffmpeg no pudo escribir ${mp3}`);
}
const peak = (x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
/** Envolvente RMS en ventanas de `win` muestras */
function envelope(x, win = 220) {
  const n = Math.ceil(x.length / win);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * win, b = Math.min(x.length, a + win);
    for (let j = a; j < b; j++) s += x[j] * x[j];
    env[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  return env;
}
/** RMS de la parte con sonido (ventanas por encima de −40 dB del máximo) */
export function activeRms(x) {
  const env = envelope(x);
  const mx = env.reduce((a, v) => Math.max(a, v), 0);
  const on = [...env].filter((v) => v > mx * 0.01);
  return on.length ? Math.sqrt(on.reduce((a, v) => a + v * v, 0) / on.length) : 0;
}
function fades(x, inMs = 3, outMs = 25) {
  const fi = Math.min(x.length, Math.round((inMs / 1000) * SR)), fo = Math.min(x.length, Math.round((outMs / 1000) * SR));
  for (let i = 0; i < fi; i++) x[i] *= i / fi;
  for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= i / fo;
  return x;
}
/** Recorta el silencio de delante y de detrás (umbral relativo al pico) */
export function trim(x, startDb = -40, endDb = -48, tailMs = 40) {
  const p = peak(x);
  if (!p) return x;
  const ts = p * 10 ** (startDb / 20), te = p * 10 ** (endDb / 20);
  let a = 0;
  while (a < x.length && Math.abs(x[a]) < ts) a++;
  let b = x.length - 1;
  while (b > a && Math.abs(x[b]) < te) b--;
  a = Math.max(0, a - Math.round(0.004 * SR));
  b = Math.min(x.length, b + Math.round((tailMs / 1000) * SR));
  return x.slice(a, b);
}
/** Corta un clip de varios golpes (pasos) en `n` efectos: los n golpes más fuertes, en orden de tiempo */
export function splitHits(x, n, maxMs = 420) {
  const win = 110; // 2,5 ms
  const env = envelope(x, win);
  const mx = env.reduce((a, v) => Math.max(a, v), 0);
  const hi = mx * 0.22, lo = mx * 0.08;
  const onsets = [];
  let armed = true, quiet = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] < lo) quiet++; else quiet = 0;
    if (!armed && quiet * win > 0.09 * SR) armed = true;
    if (armed && env[i] > hi) { onsets.push(i * win); armed = false; quiet = 0; }
  }
  const segs = onsets.map((o, k) => {
    const a = Math.max(0, o - Math.round(0.006 * SR));
    const next = onsets[k + 1] ?? x.length;
    const b = Math.min(x.length, next - Math.round(0.01 * SR), a + Math.round((maxMs / 1000) * SR));
    const s = x.slice(a, Math.max(a + 1, b));
    return { a, s, p: peak(s) };
  }).filter((g) => g.s.length > 0.06 * SR);
  const best = [...segs].sort((u, v) => v.p - u.p).slice(0, n).sort((u, v) => u.a - v.a);
  return best.map((g) => trim(g.s, -40, -42, 30));
}
/** Limitador con anticipación (ffmpeg alimiter) a −1 dBFS: deja subir el cuerpo de golpes muy picudos (pasos) */
function limit(x) {
  const pcm = Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-',
    '-af', 'alimiter=limit=0.89:attack=1:release=40:asc=1:level=0', '-f', 'f32le', '-'], { input: pcm, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg alimiter');
  const y = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  return y.length >= x.length ? y.slice(0, x.length) : y;
}
/**
 * Iguala el RMS (parte con sonido) al de referencia. Sin `maxLimitDb`, el pico manda (≤ −1 dBFS) aunque quede más
 * flojo; con `maxLimitDb`, hasta esos dB de los picos se los come el limitador para llegar al nivel del sintetizado.
 */
export function level(x, refRms, maxLimitDb = 0) {
  const r = activeRms(x);
  let g = r ? refRms / r : 1;
  const p = peak(x) * g;
  if (p <= 0.89) return fades(x.map((v) => v * g));
  const over = 20 * Math.log10(p / 0.89);
  if (over > maxLimitDb) g *= 10 ** (-(over - maxLimitDb) / 20);
  if (!maxLimitDb) return fades(x.map((v) => v * g));
  let y = limit(x.map((v) => v * g));
  // el limitador baja algo el RMS: una pasada de corrección (acotada al mismo margen)
  const r2 = activeRms(y);
  const g2 = Math.min(r2 ? refRms / r2 : 1, 10 ** (maxLimitDb / 40));
  if (g2 > 1.01) y = limit(x.map((v) => v * g * g2));
  const p2 = peak(y);
  if (p2 > 0.891) y = y.map((v) => (v * 0.89) / p2);
  return fades(y);
}

const refCache = new Map();
function refRmsOf(key) {
  if (refCache.has(key)) return refCache.get(key);
  const r = spawnSync('git', ['-C', ROOT, 'show', `${MANIFEST.ref_commit}:assets/audio/sfx/${key}.mp3`], { maxBuffer: 1 << 26 });
  // Efecto nuevo (sin sintetizado previo): nivel de un efecto de objeto de A4.4 (item_pickup)
  const v = r.status === 0 ? activeRms(decodeBuf(r.stdout)) : refRmsOf('item_pickup');
  refCache.set(key, v);
  return v;
}

export function processEntry(e, cached) {
  const x = decode(cached);
  const out = [];
  if (e.split) {
    const hits = splitHits(x, e.split, e.maxMs ?? 420);
    if (hits.length < e.split) throw new Error(`${e.id}: solo ${hits.length} golpes de ${e.split}`);
    const ref = refRmsOf(e.ref ?? `${e.id}_1`);
    hits.forEach((h, i) => out.push({ key: `${e.id}_${i + 1}`, x: level(h, ref, e.limitDb ?? MANIFEST.limitDb ?? 0) }));
  } else {
    out.push({ key: e.id, x: level(trim(x, -40, e.endDb ?? -48, e.tailMs ?? 60), refRmsOf(e.ref ?? e.id), e.limitDb ?? MANIFEST.limitDb ?? 0) });
  }
  for (const o of out) encode(o.x, join(OUT, `${o.key}.mp3`));
  // Registro versionado de lo que hay en assets (make-sfx.mjs no pisa estas claves)
  const gen = join(ROOT, 'art', 'sfx', 'generados.json');
  const reg = existsSync(gen) ? JSON.parse(readFileSync(gen, 'utf8')) : {};
  for (const o of out) reg[o.key] = { de: e.id, hash: hashOf(e), segundos: +(o.x.length / SR).toFixed(3) };
  writeFileSync(gen, JSON.stringify(Object.fromEntries(Object.entries(reg).sort()), null, 2) + '\n');
  return out.map((o) => ({ key: o.key, secs: +(o.x.length / SR).toFixed(3) }));
}

// ---------- API ----------
let KEY = null;
const scrub = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));
async function saldo() {
  const r = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`subscription ${r.status}: ${scrub(await r.text())}`);
  const j = await r.json();
  return { usados: j.character_count, limite: j.character_limit, libres: j.character_limit - j.character_count };
}
function apunta(para, creditos) {
  const fecha = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T').slice(0, 16);
  appendFileSync(GASTO, `${fecha}\t${para}\t${creditos}\t${(creditos * USD_POR_CREDITO).toFixed(4)}\n`);
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(e) {
  const res = await fetch(`${API}/v1/sound-generation?output_format=${MANIFEST.output_format}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(bodyOf(e)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${e.id}: ${scrub(await res.text())}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const grupo = opt('--grupo', null);
  const minLibres = Number(opt('--min-libres', 15000));
  const tope = Number(opt('--tope', 6000));
  const dry = args.includes('--dry');
  const soloCache = args.includes('--solo-cache');
  const ids = args.filter((a) => !a.startsWith('--'));
  const sel = MANIFEST.efectos.filter((e) => (!ids.length || ids.includes(e.id)) && (!grupo || e.grupo === grupo));
  mkdirSync(CACHE, { recursive: true });
  const pend = sel.filter((e) => !existsSync(join(CACHE, `${e.id}.${hashOf(e)}.mp3`)));
  const segs = pend.reduce((a, e) => a + e.dur, 0);
  console.log(`${sel.length} efectos, ${pend.length} sin caché (${segs.toFixed(1)} s ≈ ${Math.round(segs * TARIFA_ESTIMADA)} créditos a ${TARIFA_ESTIMADA}/s)`);
  if (dry) process.exit(0);
  if (pend.length && !soloCache) {
    KEY = readFileSync(KEY_FILE, 'utf8').trim();
    const antes = await saldo();
    const estim = Math.round(segs * TARIFA_ESTIMADA);
    if (antes.libres - estim < minLibres || estim > tope) {
      console.error(`NO genero: libres ${antes.libres}, lote ≈ ${estim}, mínimo ${minLibres}, tope ${tope}`);
      process.exit(3);
    }
    // Se apunta ANTES lo previsto; al acabar, una línea de ajuste (real − previsto) para que la suma cuadre.
    apunta(`A8.4 efectos PREVISTO: ${pend.length} clips (${segs.toFixed(1)} s; ${pend.map((e) => e.id).join(',')}; libres ${antes.libres}; se ajusta en la línea siguiente)`, estim);
    let fallos = 0;
    for (const e of pend) {
      try {
        const buf = await generate(e);
        writeFileSync(join(CACHE, `${e.id}.${hashOf(e)}.mp3`), buf);
        writeFileSync(join(CACHE, `${e.id}.${hashOf(e)}.json`), JSON.stringify({ ...bodyOf(e), output_format: MANIFEST.output_format, bytes: buf.length }, null, 2));
        console.log(`  ${e.id}: ${(buf.length / 1024).toFixed(0)} KB`);
      } catch (err) {
        fallos++;
        console.error(`  ${scrub(err.message)}`);
      }
    }
    let despues = await saldo();
    for (let i = 0; i < 12 && despues.usados === antes.usados; i++) { await pausa(10000); despues = await saldo(); }
    const cred = despues.usados - antes.usados;
    const ok = pend.length - fallos;
    apunta(`A8.4 efectos AJUSTE (real ${cred} − previsto ${estim}): ${ok} clips (sound-generation ${MANIFEST.model_id}, ${segs.toFixed(1)} s pedidos${fallos ? `, ${fallos} errores` : ''}; ${pend.map((e) => e.id).join(',')}; saldo ${antes.libres}→${despues.libres} libres)`, cred - estim);
    console.log(JSON.stringify({ saldoAntes: antes.libres, saldoDespues: despues.libres, creditos: cred, segundos: segs, porSegundo: +(cred / segs).toFixed(1) }));
  }
  for (const e of sel) {
    const c = join(CACHE, `${e.id}.${hashOf(e)}.mp3`);
    if (!existsSync(c)) { console.log(`  ${e.id}: sin generar`); continue; }
    try {
      for (const o of processEntry(e, c)) console.log(`  → ${o.key}.mp3 ${o.secs} s`);
    } catch (err) {
      console.error(`  ${err.message}`);
    }
  }
}

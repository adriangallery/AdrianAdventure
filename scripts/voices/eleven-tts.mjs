#!/usr/bin/env node
// A6.3 (plan SCUMM, preparado en A6.2): genera las voces con ElevenLabs a partir del guion congelado y el reparto.
// Node 20+ (fetch), ESM, sin dependencias; necesita ffmpeg en el PATH.
//
//   node scripts/voices/eleven-tts.mjs --dry-run [--solo player,anon]
//   node scripts/voices/eleven-tts.mjs --limite-creditos 30000 [--solo <papel>] [--lote 25] [--max-lineas N] [--keys k1,k2]
//
// Entradas: qa/voices-script.lock.json (scripts/voices/script-lock.mjs: clave, papel, texto TTS, hash) y
// scripts/voices/elevenlabs-cast.json (papel → voz, modelo, ajustes, filtro). Salida: assets/audio/voice/<clave>.mp3,
// la MISMA ruta y nombre que el clip Kokoro (lo sustituye; src/config/voice.config.ts no cambia), en MP3 mono 24 kHz
// libmp3lame -q:a 2 como los Kokoro, con el volumen llevado a `loudness_lufs` (media medida de los Kokoro: -26 LUFS).
//
// Caché y reanudación: scripts/voices/elevenlabs-done.json guarda por clave la firma (hash del lock + voz + modelo +
// ajustes + filtro + volumen). Una clave con la misma firma no se vuelve a pedir; el fichero se escribe tras cada clip,
// así que cortar y relanzar sigue donde se quedó. Si cambia el texto o el reparto de un papel, cambia la firma.
//
// Gasto: antes de cada lote se añade (>>) UNA línea al tsv de gasto (--tsv) con el nº de llamadas y los créditos
// estimados del lote (--lote 1 = una línea por llamada). --limite-creditos corta antes de pasarse: cuenta lo real
// (cabecera `character-cost` de cada respuesta) y no empieza un clip cuyo coste estimado lo haría pasar del límite.
// --entero no empieza si lo pendiente (medido) no cabe entero en el límite: para no dejar a Dex a medias.
// --dry-run no llama a la API (ni lee la clave): lista lo pendiente por papel con su coste a la tarifa medida y a la
// de lista. La clave sale de $ELEVENLABS_API_KEY o de ~/.secrets/elevenlabs.key y no se imprime nunca.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LOCK = 'qa/voices-script.lock.json';
const CAST = 'scripts/voices/elevenlabs-cast.json';
const DONE = 'scripts/voices/elevenlabs-done.json';
const VOICE_DIR = 'assets/audio/voice';
const DEFAULT_TSV = path.join(os.homedir(), 'srv/orquestador/planes/ADVENTURE_SCUMM/elevenlabs-gasto.tsv');

export function parseArgs(argv) {
  const o = { entero: false, dryRun: false, limit: Infinity, solo: null, lote: 25, max: Infinity, keys: null, tsv: DEFAULT_TSV, root: ROOT, etiqueta: 'A6.3' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`falta el valor de ${a}`); return argv[++i]; };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--limite-creditos') o.limit = Number(next());
    else if (a === '--entero') o.entero = true;
    else if (a === '--solo') o.solo = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--lote') o.lote = Math.max(1, Number(next()));
    else if (a === '--max-lineas') o.max = Number(next());
    else if (a === '--keys') o.keys = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--tsv') o.tsv = next();
    else if (a === '--etiqueta') o.etiqueta = next();
    else if (a === '--root') o.root = path.resolve(next());
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (!o.dryRun && !Number.isFinite(o.limit)) throw new Error('falta --limite-creditos <n> (o --dry-run)');
  return o;
}

/** Ajustes efectivos de un papel (defaults + papel). null si el papel se queda en Kokoro o no está en el reparto. */
export function roleConfig(cast, role) {
  const r = cast.roles?.[role];
  if (!r || r.engine === 'kokoro') return null;
  if (r.requires_role && roleConfig(cast, r.requires_role) === null) return null; // PZ-BOT sigue a Dex
  const d = cast.defaults ?? {};
  return {
    role,
    name: r.name,
    voice_id: r.voice_id,
    model: r.model ?? d.model,
    voice_settings: { ...(d.voice_settings ?? {}), ...(r.voice_settings ?? {}) },
    output_format: r.output_format ?? d.output_format ?? 'mp3_44100_128',
    loudness_lufs: r.loudness_lufs ?? d.loudness_lufs ?? -26,
    ffmpeg_filter: r.ffmpeg_filter ?? '',
    credits_per_char: r.credits_per_char ?? d.credits_per_char ?? 0.5,
    credits_per_char_list: d.credits_per_char_list ?? 0.5,
  };
}

export function signature(line, cfg) {
  const s = JSON.stringify([line.hash, cfg.voice_id, cfg.model, cfg.voice_settings, cfg.ffmpeg_filter, cfg.loudness_lufs]);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Líneas pendientes: [{ line, cfg, sig, est }] en el orden del lock. */
export function pending(lock, cast, done, opts) {
  const out = [];
  for (const line of lock.lines) {
    if (opts.solo && !opts.solo.has(line.role) && !opts.solo.has(line.speaker)) continue;
    if (opts.keys && !opts.keys.has(line.key)) continue;
    const cfg = roleConfig(cast, line.role);
    if (!cfg) continue;
    const sig = signature(line, cfg);
    if (done[line.key]?.sig === sig) continue;
    out.push({ line, cfg, sig, est: Math.ceil(line.chars * cfg.credits_per_char), list: Math.ceil(line.chars * cfg.credits_per_char_list) });
    if (out.length >= opts.max) break;
  }
  return out;
}

function summary(todo) {
  const by = new Map();
  for (const t of todo) {
    const s = by.get(t.line.role) ?? { role: t.line.role, voice: `${t.cfg.name} (${t.cfg.model})`, lines: 0, chars: 0, est: 0, list: 0 };
    s.lines++; s.chars += t.line.chars; s.est += t.est; s.list += t.list;
    by.set(t.line.role, s);
  }
  const rows = [...by.values()].sort((a, b) => b.chars - a.chars);
  const tot = rows.reduce((a, r) => ({ lines: a.lines + r.lines, chars: a.chars + r.chars, est: a.est + r.est, list: a.list + r.list }), { lines: 0, chars: 0, est: 0, list: 0 });
  return { rows, tot };
}

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);

function writeDone(file, done) {
  const sorted = Object.fromEntries(Object.keys(done).sort().map((k) => [k, done[k]]));
  fs.writeFileSync(file + '.tmp', JSON.stringify(sorted, null, 1) + '\n');
  fs.renameSync(file + '.tmp', file);
}

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const f = path.join(os.homedir(), '.secrets/elevenlabs.key');
  if (!fs.existsSync(f)) throw new Error('no hay clave: ELEVENLABS_API_KEY o ~/.secrets/elevenlabs.key');
  return fs.readFileSync(f, 'utf8').trim();
}

const nowCET = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 16);

async function tts(key, t) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${t.cfg.voice_id}?output_format=${t.cfg.output_format}`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: t.line.tts, model_id: t.cfg.model, voice_settings: t.cfg.voice_settings }),
    });
    if (r.ok) return { buf: Buffer.from(await r.arrayBuffer()), cost: Number(r.headers.get('character-cost') ?? t.est) };
    const body = (await r.text()).slice(0, 300);
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise((s) => setTimeout(s, 2000 * attempt * attempt)); continue; }
    throw new Error(`HTTP ${r.status}: ${body}`);
  }
}

/** mp3 de la API → mp3 mono 24 kHz como los Kokoro, con el volumen a loudness_lufs y el filtro del papel. */
function postprocess(raw, out, cfg) {
  const meas = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...(meas.stderr ?? '').matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const I = m ? Number(m[1]) : NaN;
  const gain = Number.isFinite(I) && I > -70 ? Math.max(-12, Math.min(12, cfg.loudness_lufs - I)) : 0;
  const af = [cfg.ffmpeg_filter, `volume=${gain.toFixed(2)}dB`, 'alimiter=limit=0.95'].filter(Boolean).join(',');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', af, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-q:a', '2', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return { lufs_in: I, gain };
}

async function main(argv) {
  const o = parseArgs(argv);
  const lock = readJson(path.join(o.root, LOCK), null);
  if (!lock) throw new Error(`no existe ${LOCK}: node scripts/voices/script-lock.mjs`);
  const cast = readJson(path.join(o.root, CAST), null);
  const doneFile = path.join(o.root, DONE);
  const done = readJson(doneFile, {});
  const todo = pending(lock, cast, done, o);
  const { rows, tot } = summary(todo);

  console.log('papel\tvoz\tlíneas\tcaracteres\tcréditos (medida)\tcréditos (lista)');
  for (const r of rows) console.log(`${r.role}\t${r.voice}\t${r.lines}\t${r.chars}\t${r.est}\t${r.list}`);
  console.log(`TOTAL pendiente\t\t${tot.lines}\t${tot.chars}\t${tot.est}\t${tot.list}`);
  console.log(`con margen de reintentos 25 %: ${Math.ceil(tot.est * 1.25)} (medida) / ${Math.ceil(tot.list * 1.25)} (lista)`);
  if (o.dryRun) return 0;
  if (!todo.length) { console.log('nada pendiente'); return 0; }
  if (o.entero && tot.est > o.limit) { console.error(`--entero: lo pendiente (${tot.est} créditos medidos) no cabe en --limite-creditos ${o.limit}; no empiezo`); return 3; }

  const key = apiKey();
  const tmp = fs.mkdtempSync(path.join('/var/tmp', 'eleven-tts-'));
  const voiceDir = path.join(o.root, VOICE_DIR);
  let spent = 0;
  let ok = 0;
  const failed = [];
  try {
    for (let i = 0; i < todo.length; i += o.lote) {
      const batch = [];
      let batchEst = 0;
      for (const t of todo.slice(i, i + o.lote)) {
        if (spent + batchEst + t.est > o.limit) break;
        batch.push(t); batchEst += t.est;
      }
      if (!batch.length) { console.log(`límite de ${o.limit} créditos: paro (gastados ${spent})`); break; }
      const roles = [...new Set(batch.map((t) => t.line.role))].join(',');
      fs.appendFileSync(o.tsv, `${nowCET()}\t${o.etiqueta} voces ${roles}: ${batch.length} clips (${batch[0].cfg.model}, ${batch.reduce((n, t) => n + t.line.chars, 0)} car.)\t${batchEst}\t${(batchEst * 0.0002).toFixed(4)}\n`);
      for (const t of batch) {
        try {
          const { buf, cost } = await tts(key, t);
          spent += cost;
          const raw = path.join(tmp, `${t.line.key}.api.mp3`);
          fs.writeFileSync(raw, buf);
          const out = path.join(voiceDir, `${t.line.key}.mp3`);
          const pp = postprocess(raw, out, t.cfg);
          fs.unlinkSync(raw);
          done[t.line.key] = { sig: t.sig, role: t.line.role, voice: t.cfg.name, model: t.cfg.model, cost, lufs_in: Number.isFinite(pp.lufs_in) ? pp.lufs_in : null };
          writeDone(doneFile, done);
          ok++;
          console.log(`[${ok}/${todo.length}] OK ${t.line.key} (${cost} cr., total ${spent})`);
        } catch (e) {
          failed.push(t.line.key);
          console.error(`FALLO ${t.line.key}: ${e.message}`);
          if (failed.length >= 10 && failed.length > ok) throw new Error('demasiados fallos seguidos: paro');
        }
      }
      if (batch.length < Math.min(o.lote, todo.length - i)) { console.log(`límite de ${o.limit} créditos: paro (gastados ${spent})`); break; }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`hechos ${ok}, fallos ${failed.length}, créditos (cabecera character-cost) ${spent}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 2; });
}

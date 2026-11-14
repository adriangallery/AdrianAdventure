// A8.1 (plan SCUMM): tempo, compás y secciones de cada pista de `assets/audio/music/` para la música adaptativa a lo iMUSE.
// Descodifica con ffmpeg a PCM mono 11025 Hz y saca:
//   - envolvente de ataques (flujo de energía en 3 bandas, rectificado) con salto de 256 muestras (~23 ms);
//   - tempo y fase de pulso: barrido fino de BPM (60-180, paso 0,02) por peine sobre la envolvente (suma de la envolvente
//     en los pulsos previstos, con un peso suave hacia 90-130 BPM para no elegir el doble/la mitad sin motivo);
//   - primer tiempo fuerte: de las 4 fases posibles de un 4/4, la que tiene más ataque en graves (banda < 200 Hz);
//   - secciones: novedad entre bloques de 4 compases (energía + cromagrama por compás) → límites en múltiplos de 4
//     compases, separados al menos 8; etiquetas A, B, C… por parecido con las anteriores;
//   - tonalidad: la de `src/config/music.config.ts` (analyze-music.mjs, A4.5), no se vuelve a estimar.
// Escribe SOLO la clave `tracks` de `assets/config/music-map.json`; los estados, lugares y capas son a mano.
//
//   node scripts/audio/analyze-tempo.mjs            mide y escribe
//   node scripts/audio/analyze-tempo.mjs --check    comprueba que `tracks` está al día (lint:audio)
// Determinista. Unos segundos por pista.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { declaredLevels } from './music-levels.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chroma, detectKey } from './analyze-music.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MUSIC_DIR = join(ROOT, 'assets', 'audio', 'music');
export const MAP_PATH = join(ROOT, 'assets', 'config', 'music-map.json');
const SR = 11025;
const HOP = 256;
const FPS = SR / HOP;
const BEATS_PER_BAR = 4;

function decode(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg falló con ${file}: ${r.stderr}`);
  const buf = r.stdout;
  const out = new Float32Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** Filtro de un polo (paso bajo) — para separar graves / medios / agudos sin FFT */
function onePole(x, fc) {
  const a = Math.exp((-2 * Math.PI * fc) / SR);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; }
  return y;
}

/** Envolvente de ataques: suma del flujo positivo de log-energía en 3 bandas; también la de graves sola */
export function onsetEnvelope(pcm) {
  const low = onePole(pcm, 200);
  const lowmid = onePole(pcm, 2000);
  const bands = [low, new Float32Array(pcm.length), new Float32Array(pcm.length)];
  for (let i = 0; i < pcm.length; i++) { bands[1][i] = lowmid[i] - low[i]; bands[2][i] = pcm[i] - lowmid[i]; }
  const n = Math.floor(pcm.length / HOP);
  const env = new Float32Array(n);
  const bass = new Float32Array(n);
  const energy = new Float32Array(n);
  bands.forEach((b, bi) => {
    let prev = 0;
    for (let f = 0; f < n; f++) {
      let e = 0;
      for (let i = f * HOP; i < (f + 1) * HOP; i++) e += b[i] * b[i];
      if (bi === 0) energy[f] = e;
      const l = Math.log(1e-6 + e);
      const d = Math.max(0, l - prev);
      prev = l;
      env[f] += d;
      if (bi === 0) bass[f] = d;
    }
  });
  // quitar la media local (2 s) para que las subidas de volumen no cuenten como ataques
  const w = Math.round(FPS);
  const out = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) {
    acc += env[f];
    if (f >= 2 * w) acc -= env[f - 2 * w];
    const mean = acc / Math.min(f + 1, 2 * w);
    out[f] = Math.max(0, env[f] - mean);
  }
  return { env: out, bass, energy };
}

function sampleAt(env, t) {
  const i = Math.floor(t);
  if (i < 0 || i + 1 >= env.length) return 0;
  const fr = t - i;
  return env[i] * (1 - fr) + env[i + 1] * fr;
}

/** Puntuación de un tempo (en frames por pulso) y su mejor fase */
function combScore(env, period) {
  let best = { score: -1, phase: 0 };
  const steps = Math.ceil(period);
  for (let p = 0; p < steps; p += 0.5) {
    let s = 0; let k = 0;
    for (let t = p; t < env.length; t += period) { s += sampleAt(env, t); k++; }
    s /= k || 1;
    if (s > best.score) best = { score: s, phase: p };
  }
  return best;
}

export function detectTempo(env) {
  const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
  let best = { bpm: 0, score: -1, raw: 0, phase: 0 };
  const scores = [];
  // barrido grueso (paso 0,5) y luego fino (paso 0,02) alrededor del mejor
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const c = combScore(env, (60 / bpm) * FPS);
    const sc = c.score * prior(bpm);
    scores.push({ bpm, raw: c.score });
    if (sc > best.score) best = { bpm, score: sc, raw: c.score, phase: c.phase };
  }
  for (let bpm = best.bpm - 0.6; bpm <= best.bpm + 0.6; bpm += 0.02) {
    const c = combScore(env, (60 / bpm) * FPS);
    const sc = c.score * prior(bpm);
    if (sc > best.score) best = { bpm, score: sc, raw: c.score, phase: c.phase };
  }
  // confianza: cuánto destaca el pico sobre la mediana de todo el barrido
  const sorted = scores.map((s) => s.raw).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { bpm: Math.round(best.bpm * 100) / 100, phaseFrames: best.phase, salience: best.raw / (median || 1e-9) };
}

/** Primer tiempo fuerte: de las 4 fases de compás, la de más ataque en graves */
function detectDownbeat(bass, bpm, phaseFrames) {
  const period = (60 / bpm) * FPS;
  const sums = [0, 0, 0, 0];
  let k = 0;
  for (let t = phaseFrames; t < bass.length; t += period, k++) sums[k % 4] += sampleAt(bass, t) + sampleAt(bass, t + 1);
  const best = sums.indexOf(Math.max(...sums));
  const sorted = [...sums].sort((a, b) => b - a);
  return { beat: best, contrast: sorted[0] / (sorted[1] || 1e-9) };
}

function cosine(a, b) {
  let d = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / Math.sqrt(na * nb || 1e-12);
}

/** Rasgos por compás: energía (dB) y cromagrama */
function barFeatures(pcm, firstDownbeatSec, barSec, bars) {
  const feats = [];
  for (let b = 0; b < bars; b++) {
    const s = Math.round((firstDownbeatSec + b * barSec) * SR);
    const e = Math.round((firstDownbeatSec + (b + 1) * barSec) * SR);
    const seg = pcm.subarray(s, e);
    let en = 0;
    for (let i = 0; i < seg.length; i++) en += seg[i] * seg[i];
    feats.push({ db: 10 * Math.log10(1e-9 + en / (seg.length || 1)), chroma: chroma(seg) });
  }
  return feats;
}

/** Límites de sección (en compases, múltiplos de 4) por novedad entre bloques de 4 compases */
export function sectionBounds(feats, minLen = 8) {
  const bars = feats.length;
  const blocks = Math.floor(bars / 4);
  const blockVec = [];
  for (let i = 0; i < blocks; i++) {
    const ch = new Array(12).fill(0);
    let db = 0;
    for (let b = i * 4; b < i * 4 + 4; b++) { feats[b].chroma.forEach((v, j) => { ch[j] += v; }); db += feats[b].db / 4; }
    blockVec.push({ ch, db });
  }
  const nov = [0];
  for (let i = 1; i < blocks; i++) {
    const dc = 1 - cosine(blockVec[i].ch, blockVec[i - 1].ch);
    const dd = Math.abs(blockVec[i].db - blockVec[i - 1].db) / 6;
    nov.push(dc * 4 + dd);
  }
  // picos de novedad por encima de media + 0,5 sd, separados ≥ minLen compases, de mayor a menor
  const mean = nov.reduce((a, b) => a + b, 0) / nov.length;
  const sd = Math.sqrt(nov.reduce((a, b) => a + (b - mean) ** 2, 0) / nov.length);
  const cands = nov.map((v, i) => ({ v, bar: i * 4 })).filter((c) => c.bar > 0 && c.v > mean + 0.5 * sd).sort((a, b) => b.v - a.v);
  const chosen = [0];
  for (const c of cands) {
    if (chosen.every((x) => Math.abs(x - c.bar) >= minLen) && bars - c.bar >= minLen) chosen.push(c.bar);
  }
  chosen.sort((a, b) => a - b);
  // etiquetas por parecido de cromagrama + energía con las secciones anteriores
  const secs = chosen.map((start, i) => ({ start, end: chosen[i + 1] ?? bars }));
  const proto = [];
  const labels = [];
  for (const s of secs) {
    const ch = new Array(12).fill(0);
    let db = 0;
    for (let b = s.start; b < s.end; b++) { feats[b].chroma.forEach((v, j) => { ch[j] += v; }); db += feats[b].db / (s.end - s.start); }
    let label = null;
    for (const p of proto) if (cosine(p.ch, ch) > 0.985 && Math.abs(p.db - db) < 2.5) { label = p.label; break; }
    if (!label) { label = String.fromCharCode(65 + proto.length); proto.push({ ch, db, label }); }
    labels.push({ label, db });
  }
  return secs.map((s, i) => ({ id: `${labels[i].label}${secs.slice(0, i).filter((_, j) => labels[j].label === labels[i].label).length + 1}`, startBar: s.start, bars: s.end - s.start, energyDb: Math.round(labels[i].db * 10) / 10 }));
}

/**
 * `declared` (A8.3, scripts/audio/music-levels.mjs): nivel de intensidad cortado en compases enteros de una generación
 * pedida a un BPM y tonalidad: la rejilla es la declarada (primer tiempo en 0) y lo medido queda en `confidence` para
 * comprobarla (BPM medido igual, la mitad o el doble).
 */
export function analyzeTrack(file, log = console.log, declared = null) {
  const pcm = decode(file);
  const durationSec = pcm.length / SR;
  const { env, bass } = onsetEnvelope(pcm);
  const t = detectTempo(env);
  const bpm = declared ? declared.bpm : t.bpm;
  const beatSec = 60 / bpm;
  const db = detectDownbeat(bass, t.bpm, t.phaseFrames);
  let firstDownbeatSec = declared ? 0 : t.phaseFrames / FPS + db.beat * beatSec;
  const barSec = beatSec * BEATS_PER_BAR;
  while (firstDownbeatSec - barSec >= 0) firstDownbeatSec -= barSec;
  const bars = declared ? Math.min(declared.bars, Math.floor(durationSec / barSec + 0.01)) : Math.floor((durationSec - firstDownbeatSec) / barSec);
  const feats = barFeatures(pcm, firstDownbeatSec, barSec, bars);
  const sections = sectionBounds(feats);
  const measuredKey = detectKey(chroma(pcm));
  const k = declared ? { ...declared.key, score: measuredKey.score } : measuredKey;
  const r = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
  // el final del bucle sale de los valores ya redondeados: así cae exactamente en compás para el motor
  const fd = r(firstDownbeatSec);
  const bs = r(barSec, 4);
  const out = {
    bpm,
    beatsPerBar: BEATS_PER_BAR,
    firstDownbeatSec: fd,
    barSec: bs,
    bars,
    durationSec: r(durationSec, 2),
    loopStartSec: fd,
    loopEndSec: r(fd + bars * bs, 4),
    key: { tonic: k.tonic, mode: k.mode },
    confidence: {
      /** pico del peine sobre la mediana del barrido: > 1,6 claro; < 1,3 dudoso */
      tempo: r(t.salience, 2),
      /** ataque en graves del tiempo elegido sobre la segunda fase: < 1,15 = el tiempo 1 es dudoso */
      downbeat: r(db.contrast, 2),
      key: r(k.score, 2),
      ...(declared ? { declared: true, measuredBpm: t.bpm, measuredKey: { tonic: measuredKey.tonic, mode: measuredKey.mode } } : {}),
    },
    sections,
  };
  log(`${file.split('/').pop()}: ${out.bpm} BPM (pico ${out.confidence.tempo}), 1.er tiempo ${out.firstDownbeatSec} s (contraste ${out.confidence.downbeat}), ${bars} compases, secciones ${sections.map((s) => `${s.id}@${s.startBar}`).join(' ')}`);
  return out;
}

export function analyzeAll(log = console.log) {
  const tracks = {};
  const decl = declaredLevels();
  for (const f of readdirSync(MUSIC_DIR).filter((x) => x.endsWith('.mp3')).sort()) {
    const name = f.replace(/\.mp3$/, '');
    tracks[name] = analyzeTrack(join(MUSIC_DIR, f), log, decl[name] ?? null);
  }
  return tracks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tracks = analyzeAll();
    let map = {};
    try { map = JSON.parse(readFileSync(MAP_PATH, 'utf8')); } catch { /* aún no existe */ }
    if (process.argv.includes('--check')) {
      if (JSON.stringify(map.tracks) !== JSON.stringify(tracks)) {
        console.error(`${MAP_PATH}: «tracks» no es lo que mide analyze-tempo.mjs: ejecuta node scripts/audio/analyze-tempo.mjs`);
        process.exit(1);
      }
      console.log('music-map.json (tracks) al día');
    } else {
      map.tracks = tracks;
      writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
      console.log(`${MAP_PATH} escrito`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

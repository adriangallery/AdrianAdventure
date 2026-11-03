// A4.4 (plan SCUMM): sintetizador de audio en Node puro, sin dependencias (decisión D2: nada descargado ni de
// pago). Produce buffers mono Float32Array a SAMPLE_RATE y los escribe en WAV; `scripts/audio/make-sfx.mjs` y
// `scripts/audio/make-ambience.mjs` los convierten a MP3 con ffmpeg. Todo es determinista: el generador de
// números (mulberry32) va con semilla y cada receta usa la suya, así repetir el script da los mismos bytes WAV.
//
// Vocabulario (todas devuelven Float32Array nuevos salvo las que terminan en «In», que modifican en sitio):
//   secs(s)                 muestras que ocupan s segundos
//   osc(kind, freq, n)      sine | square | saw | tri; `freq` número o función (i) → Hz
//   noise(rng, n)           ruido blanco en [-1, 1]
//   envelope(n, a, d, s, r) ADSR en segundos (sustain en 0-1), o `adsr`
//   mulIn(a, b)             a[i] *= b[i] (o número)
//   mix(...bufs)            suma muestra a muestra (longitud = la mayor)
//   lowpass / highpass      filtro RC de un polo (cutoff fijo o función (i) → Hz)
//   bandpass(buf, f, q)     biquad (RBJ)
//   fadeIn/fadeOut(buf, s)  rampas lineales
//   normalize(buf, peak)    escala al pico pedido
//   delayMix(buf, s, fb, w) eco simple
//   seamless(buf, s)        bucle sin costura: funde el final sobre el principio (s segundos)
//   writeWav(path, buf)     PCM 16 bits mono

import { writeFileSync } from 'node:fs';

export const SAMPLE_RATE = 22050;

export const secs = (s) => Math.round(s * SAMPLE_RATE);

/** mulberry32: generador determinista de 32 bits */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

export function silence(n) {
  return new Float32Array(Math.max(0, Math.round(n)));
}

/** Oscilador; `freq` puede ser una función de la muestra (glissandos, vibrato). Fase acumulada: sin saltos. */
export function osc(kind, freq, n, phase0 = 0) {
  const out = new Float32Array(n);
  const f = typeof freq === 'function' ? freq : () => freq;
  let phase = phase0;
  for (let i = 0; i < n; i++) {
    phase += f(i) / SAMPLE_RATE;
    const p = phase - Math.floor(phase);
    switch (kind) {
      case 'square': out[i] = p < 0.5 ? 1 : -1; break;
      case 'saw': out[i] = 2 * p - 1; break;
      case 'tri': out[i] = 1 - 4 * Math.abs(p - 0.5); break;
      default: out[i] = Math.sin(2 * Math.PI * p);
    }
  }
  return out;
}

export function noise(random, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = random() * 2 - 1;
  return out;
}

/** ADSR lineal (segundos; sustain = nivel 0-1). Si la nota es más corta que A+D+R, se recorta la liberación. */
export function envelope(n, a, d, s, r) {
  const out = new Float32Array(n);
  const A = secs(a);
  const D = secs(d);
  const R = secs(r);
  const relStart = Math.max(A + D, n - R);
  for (let i = 0; i < n; i++) {
    let v;
    if (i < A) v = A ? i / A : 1;
    else if (i < A + D) v = 1 - (1 - s) * ((i - A) / Math.max(1, D));
    else if (i < relStart) v = s;
    else v = s * (1 - (i - relStart) / Math.max(1, n - relStart));
    out[i] = Math.max(0, v);
  }
  return out;
}

/** Caída exponencial desde 1 (constante de tiempo tau en segundos) */
export function decay(n, tau) {
  const out = new Float32Array(n);
  const k = 1 / secs(tau);
  for (let i = 0; i < n; i++) out[i] = Math.exp(-i * k);
  return out;
}

export function mulIn(a, b) {
  if (typeof b === 'number') { for (let i = 0; i < a.length; i++) a[i] *= b; return a; }
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] *= b[i];
  for (let i = n; i < a.length; i++) a[i] = 0;
  return a;
}

export function mix(...bufs) {
  const n = Math.max(0, ...bufs.map((b) => b.length));
  const out = new Float32Array(n);
  for (const b of bufs) for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

/** Coloca `src` sumado en `dst` a partir de la muestra `at` (lo que sobresale se recorta) */
export function placeIn(dst, src, at, gain = 1) {
  const start = Math.round(at);
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j < 0) continue;
    if (j >= dst.length) break;
    dst[j] += src[i] * gain;
  }
  return dst;
}

export function lowpass(buf, cutoff) {
  const out = new Float32Array(buf.length);
  const f = typeof cutoff === 'function' ? cutoff : () => cutoff;
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    const rc = 1 / (2 * Math.PI * Math.max(1, f(i)));
    const alpha = (1 / SAMPLE_RATE) / (rc + 1 / SAMPLE_RATE);
    y += alpha * (buf[i] - y);
    out[i] = y;
  }
  return out;
}

export function highpass(buf, cutoff) {
  const out = new Float32Array(buf.length);
  const f = typeof cutoff === 'function' ? cutoff : () => cutoff;
  let y = 0;
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const rc = 1 / (2 * Math.PI * Math.max(1, f(i)));
    const alpha = rc / (rc + 1 / SAMPLE_RATE);
    y = alpha * (y + buf[i] - prev);
    prev = buf[i];
    out[i] = y;
  }
  return out;
}

/** Biquad paso banda (RBJ, ganancia de pico constante) con frecuencia fija */
export function bandpass(buf, freq, q = 1) {
  const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  const out = new Float32Array(buf.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

export function fadeIn(buf, s) {
  const n = Math.min(buf.length, secs(s));
  for (let i = 0; i < n; i++) buf[i] *= i / n;
  return buf;
}

export function fadeOut(buf, s) {
  const n = Math.min(buf.length, secs(s));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

export function peakOf(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

export function rmsOf(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

export function normalize(buf, peak = 0.9) {
  const p = peakOf(buf);
  if (p > 0) mulIn(buf, peak / p);
  return buf;
}

/** Recorte suave (tanh) para que un empalme no pase de ±1 */
export function softClip(buf, drive = 1) {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive);
  return buf;
}

export function delayMix(buf, s, feedback = 0.3, wet = 0.3) {
  const d = secs(s);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const echo = i >= d ? out[i - d] * feedback + buf[i - d] * wet : 0;
    out[i] = buf[i] + echo;
  }
  return out;
}

/**
 * Bucle sin costura: los últimos `s` segundos se funden (potencia constante) sobre los primeros y se descartan.
 * El resultado dura `len - s` y empieza y acaba por el mismo sitio.
 */
export function seamless(buf, s) {
  const x = secs(s);
  const n = buf.length - x;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[i];
  for (let i = 0; i < x; i++) {
    const t = i / x;
    const a = Math.cos((t * Math.PI) / 2);
    const b = Math.sin((t * Math.PI) / 2);
    out[i] = buf[i] * b + buf[n + i] * a;
  }
  return out;
}

/** Repite el principio del bucle al final (`s` segundos): el fichero es periódico para cualquier ventana de `len` */
export function padLoop(loop, s) {
  const x = secs(s);
  const out = new Float32Array(loop.length + x);
  out.set(loop, 0);
  for (let i = 0; i < x; i++) out[loop.length + i] = loop[i % loop.length];
  return out;
}

/** Lee una muestra con interpolación lineal (índice fraccionario) */
function at(buf, i) {
  const j = Math.floor(i);
  if (j < 0 || j >= buf.length - 1) return 0;
  const t = i - j;
  return buf[j] * (1 - t) + buf[j + 1] * t;
}

/** Cambia la altura (y la duración) de un buffer: factor 2 = una octava arriba y la mitad de largo */
export function resample(buf, factor) {
  const n = Math.floor(buf.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = at(buf, i * factor);
  return out;
}

/** Reverberación de peine corta (cuatro líneas), para dar «sala» a un golpe */
export function room(buf, size = 0.03, wet = 0.25) {
  const taps = [1, 1.37, 1.79, 2.31].map((m) => secs(size * m));
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i];
    for (const d of taps) if (i >= d) v += out[i - d] * 0.35 * wet + buf[i - d] * 0.2 * wet;
    out[i] = v;
  }
  return out;
}

/** Suma `wobble` (0-1) de LFO a una frecuencia: f(i) = base·(1 + depth·sin(2π·rate·t)) */
export const vibrato = (base, rate, depth) => (i) => base * (1 + depth * Math.sin((2 * Math.PI * rate * i) / SAMPLE_RATE));

/** Glissando exponencial de f0 a f1 a lo largo de n muestras */
export const glide = (f0, f1, n) => (i) => f0 * Math.pow(f1 / f0, Math.min(1, i / Math.max(1, n)));

/** WAV PCM 16 bits mono */
export function wavBytes(buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}

export function writeWav(path, buf) {
  writeFileSync(path, wavBytes(buf));
}

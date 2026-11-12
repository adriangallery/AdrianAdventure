// A4.7 (plan SCUMM): recetas de las tres propuestas de pasos (`?steps=a|b|c`, src/systems/StepVariants.ts).
// Mismo sintetizador que los efectos de A4.4 (scripts/audio/synth.mjs); `make-steps.mjs` las escribe en
// assets/audio/steps/<variante>/<superficie>_<n>.mp3. Clave de receta = clave de Phaser: `step<v>_<superficie>_<n>`.
// Cada muestra de una superficie sale de la misma receta con su propia semilla y su índice `k` (0..3), que mueve
// un poco el tono, la caída y el «peso» del pie: cuatro pisadas parecidas pero no iguales.
//
//   a «clásica»   golpe sordo y corto (seno grave con caída + ruido muy filtrado), todo por debajo de ~1,5 kHz
//   b «cartoon»   «pat» gomoso: seno que cae de tono rápido (boink corto) + un «squish» de ruido; la 5.ª muestra de
//                 cada superficie es la rara: chirrido de zapatilla (o «boing» en madera, moqueta y césped)
//   c «discreta»  toques muy cortos y bajos, solo en madera, metal, grava y baldosa
import {
  secs, osc, noise, decay, mulIn, mix, placeIn, lowpass, highpass, bandpass, normalize, room, vibrato, glide, silence, envelope,
} from './synth.mjs';

/** Golpe sordo: seno grave con caída y ruido filtrado por debajo de `cut` */
function thud(random, { freq = 80, tau = 0.035, cut = 400, noiseTau = 0.015, noiseGain = 0.6, len = 0.18 } = {}) {
  const n = secs(len);
  const body = mulIn(osc('sine', glide(freq * 1.4, freq, secs(0.025)), n), decay(n, tau));
  const scuff = mulIn(lowpass(lowpass(noise(random, n), cut), cut), decay(n, noiseTau));
  // Ataque de 3 ms: sin el «clic» del primer instante
  return mulIn(mix(body, mulIn(scuff, noiseGain * 3)), envelope(n, 0.003, 0, 1, 0.02));
}

function grain(random, { len = 0.04, freq = 1000, q = 1, tau = 0.01 } = {}) {
  const n = secs(len);
  return mulIn(bandpass(noise(random, n), freq, q), decay(n, tau));
}

// ── a «clásica» ───────────────────────────────────────────────────────────────────────────────────────────
const classic = {
  wood(r, k) {
    const out = thud(r, { freq: 92 + k * 5, tau: 0.04, cut: 650, len: 0.2 });
    // Hueco de tarima: una resonancia grave corta
    const n = secs(0.12);
    placeIn(out, mulIn(osc('sine', 190 + k * 9, n), decay(n, 0.025)), secs(0.002), 0.35);
    return normalize(lowpass(room(out, 0.01, 0.1), 1400), 0.8);
  },
  gravel(r, k) {
    const out = thud(r, { freq: 72 + k * 4, tau: 0.03, cut: 350, len: 0.22 });
    for (let i = 0; i < 6 + k; i++) {
      placeIn(out, grain(r, { len: 0.03, freq: r.range(700, 1300), q: 0.9, tau: r.range(0.004, 0.009) }), secs(r.range(0.005, 0.11)), r.range(0.25, 0.6));
    }
    return normalize(lowpass(out, 1500), 0.75);
  },
  concrete(r, k) {
    const out = thud(r, { freq: 100 - k * 4, tau: 0.022, cut: 600, noiseTau: 0.01, len: 0.16 });
    return normalize(lowpass(room(out, 0.018, 0.18), 1300), 0.75);
  },
  tile(r, k) {
    const out = thud(r, { freq: 115 + k * 4, tau: 0.018, cut: 900, noiseTau: 0.008, len: 0.16 });
    placeIn(out, grain(r, { len: 0.03, freq: 1100 + k * 60, q: 2, tau: 0.006 }), 0, 0.25);
    return normalize(lowpass(room(out, 0.022, 0.22), 1600), 0.75);
  },
  metal(r, k) {
    const n = secs(0.28);
    const out = thud(r, { freq: 82 + k * 3, tau: 0.03, cut: 500, len: 0.28 });
    [240, 520].forEach((f, i) => placeIn(out, mulIn(osc('sine', f * (1 + k * 0.025), n), decay(n, 0.07 - i * 0.025)), 0, 0.22 / (i + 1)));
    return normalize(lowpass(room(out, 0.025, 0.2), 1500), 0.72);
  },
  carpet(r, k) {
    const out = thud(r, { freq: 62 + k * 3, tau: 0.028, cut: 220, noiseGain: 0.8, len: 0.14 });
    return normalize(lowpass(out, 700), 0.6);
  },
  grass(r, k) {
    const out = thud(r, { freq: 66 + k * 3, tau: 0.026, cut: 260, len: 0.2 });
    for (let i = 0; i < 4 + k; i++) {
      placeIn(out, grain(r, { len: 0.05, freq: r.range(500, 1000), q: 0.6, tau: r.range(0.01, 0.02) }), secs(r.range(0, 0.09)), r.range(0.2, 0.45));
    }
    return normalize(lowpass(out, 1200), 0.62);
  },
};

// ── b «cartoon» ───────────────────────────────────────────────────────────────────────────────────────────
/** «pat» gomoso: seno que cae de f0 a f1 en `fall` s, con caída de volumen; un pelín de cuerpo de ruido */
function pat(r, { f0 = 340, f1 = 150, fall = 0.045, tau = 0.04, len = 0.16, squish = 0.35, squishFreq = 900 } = {}) {
  const n = secs(len);
  const body = mulIn(osc('sine', glide(f0, f1, secs(fall)), n), decay(n, tau));
  const sq = mulIn(bandpass(noise(r, n), squishFreq, 1.2), decay(n, tau * 0.5));
  return mulIn(mix(body, mulIn(sq, squish)), envelope(n, 0.004, 0, 1, 0.02));
}

/** Chirrido de zapatilla: seno agudo que sube y baja con vibrato, áspero */
function squeak(r, k) {
  const n = secs(0.13);
  const f = (i) => (1900 + k * 120 + 500 * Math.sin(Math.PI * i / n)) * (1 + 0.03 * Math.sin(2 * Math.PI * 38 * i / 22050));
  const tone = mulIn(osc('tri', f, n), envelope(n, 0.015, 0.03, 0.6, 0.05));
  const rasp = mulIn(bandpass(noise(r, n), 2400, 3), envelope(n, 0.01, 0.03, 0.5, 0.05));
  return mix(mulIn(tone, 0.35), mulIn(rasp, 0.25));
}

/** «Boing»: seno grave con vibrato rápido que se apaga (muelle) */
function boing(r, k) {
  const n = secs(0.32);
  const tone = mulIn(osc('sine', vibrato(170 + k * 10, 22, 0.12), n), decay(n, 0.09));
  return mulIn(tone, envelope(n, 0.005, 0, 1, 0.05));
}

const cartoonBase = {
  wood: (r, k) => { const o = pat(r, { f0: 420 + k * 25, f1: 190, squishFreq: 700, tau: 0.035 }); placeIn(o, grain(r, { len: 0.03, freq: 650, q: 4, tau: 0.008 }), 0, 0.4); return o; },
  gravel: (r, k) => {
    const o = pat(r, { f0: 300 + k * 20, f1: 140, squish: 0.25, len: 0.2 });
    for (let i = 0; i < 4 + k; i++) placeIn(o, grain(r, { len: 0.025, freq: r.range(1500, 2600), q: 1, tau: 0.004 }), secs(r.range(0.01, 0.09)), r.range(0.15, 0.3));
    return o;
  },
  concrete: (r, k) => pat(r, { f0: 360 + k * 20, f1: 170, squishFreq: 1100, tau: 0.03 }),
  tile: (r, k) => { const o = pat(r, { f0: 480 + k * 25, f1: 230, squishFreq: 1500, tau: 0.028 }); placeIn(o, grain(r, { len: 0.02, freq: 2300, q: 3, tau: 0.004 }), 0, 0.3); return o; },
  metal: (r, k) => {
    const n = secs(0.22);
    const o = pat(r, { f0: 380 + k * 20, f1: 180, tau: 0.03, len: 0.22 });
    placeIn(o, mulIn(osc('sine', 1250 + k * 70, n), decay(n, 0.04)), 0, 0.18);
    return o;
  },
  carpet: (r, k) => pat(r, { f0: 260 + k * 15, f1: 120, squishFreq: 500, squish: 0.5, tau: 0.03, len: 0.14 }),
  grass: (r, k) => {
    const o = pat(r, { f0: 280 + k * 15, f1: 130, squishFreq: 1200, squish: 0.6, tau: 0.035, len: 0.18 });
    placeIn(o, mulIn(highpass(bandpass(noise(r, secs(0.08)), 1800, 0.7), 900), decay(secs(0.08), 0.02)), secs(0.01), 0.3);
    return o;
  },
};
const BOING = new Set(['wood', 'carpet', 'grass']);
const cartoon = Object.fromEntries(Object.entries(cartoonBase).map(([s, fn]) => [s, (r, k) => {
  if (k < 4) return normalize(room(fn(r, k), 0.01, 0.08), 0.8);
  // La rara: el pat normal y, encima, el chirrido (o el boing)
  const base = fn(r, 1);
  const extra = BOING.has(s) ? boing(r, 0) : squeak(r, 0);
  const out = silence(Math.max(base.length, extra.length + secs(0.02)));
  placeIn(out, base, 0, 1);
  placeIn(out, extra, secs(0.02), BOING.has(s) ? 0.7 : 0.55);
  return normalize(out, 0.8);
}]));

// ── c «discreta» ──────────────────────────────────────────────────────────────────────────────────────────
const discreet = {
  wood(r, k) {
    const out = thud(r, { freq: 105 + k * 6, tau: 0.02, cut: 900, noiseTau: 0.006, noiseGain: 0.4, len: 0.1 });
    placeIn(out, grain(r, { len: 0.02, freq: 900 + k * 40, q: 3, tau: 0.004 }), 0, 0.3);
    return normalize(out, 0.55);
  },
  metal(r, k) {
    const n = secs(0.14);
    const out = thud(r, { freq: 95, tau: 0.015, cut: 700, len: 0.14, noiseGain: 0.3 });
    placeIn(out, mulIn(osc('sine', 1450 + k * 90, n), decay(n, 0.025)), 0, 0.12);
    return normalize(out, 0.5);
  },
  gravel(r, k) {
    const out = silence(secs(0.12));
    for (let i = 0; i < 3 + k; i++) {
      placeIn(out, grain(r, { len: 0.02, freq: r.range(1800, 3200), q: 1, tau: r.range(0.003, 0.006) }), secs(r.range(0, 0.06)), r.range(0.5, 1));
    }
    placeIn(out, thud(r, { freq: 75, tau: 0.015, cut: 300, len: 0.08 }), 0, 0.5);
    return normalize(out, 0.5);
  },
  tile(r, k) {
    const out = thud(r, { freq: 125 + k * 5, tau: 0.012, cut: 1400, noiseTau: 0.005, noiseGain: 0.4, len: 0.1 });
    return normalize(room(out, 0.015, 0.15), 0.5);
  },
};

function family(prefix, table, count) {
  return Object.fromEntries(Object.entries(table).flatMap(([surface, fn]) => Array.from({ length: count }, (_, k) => [`${prefix}_${surface}_${k + 1}`, (random) => fn(random, k)])));
}

/** Recetas por variante: { a: { stepa_wood_1: fn, … }, b: …, c: … } */
export const VARIANT_RECIPES = {
  a: family('stepa', classic, 4),
  b: family('stepb', cartoon, 5),
  c: family('stepc', discreet, 4),
};

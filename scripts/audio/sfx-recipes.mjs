// A4.4 (plan SCUMM): recetas de los efectos de sonido sintetizados (una función por fichero de
// `assets/audio/sfx/`). Cada receta recibe su generador con semilla y devuelve un Float32Array mono a SAMPLE_RATE
// (scripts/audio/synth.mjs). Las claves son las que usan `playSound`, `audio.footstep`/`audio.surfaces` y la
// interfaz (src/systems/Sfx.ts); `scripts/audio/make-sfx.mjs` las escribe. Añadir un efecto = añadir una receta.
//
// Familias:
//   step_<superficie>_1/2   pasos (dos variantes por superficie; el motor alterna y desafina ±1 semitono)
//   door_*, hatch_metal     puertas y escotillas
//   inv_*, verb_select, journal_*, phone_*   interfaz (cajón del inventario, verbo, móvil de Dex)
//   duck_squeak, intercom_buzz, glass_break, paper_rustle, plank_pull, switch_flip, crt_on, floppy_insert, splash,
//   coin_ping, thud          objetos y personajes de la biblia (Gerald, Nurse Gwei, el interruptor, el CRT…)
//   stinger_*                A4.5: stingers musicales en Do (scripts/audio/stinger-recipes.mjs)
import {
  secs, osc, noise, envelope, decay, mulIn, mix, placeIn, lowpass, highpass, bandpass, fadeIn, fadeOut, normalize,
  softClip, room, resample, vibrato, glide, silence,
} from './synth.mjs';
import { RECIPES as STINGERS } from './stinger-recipes.mjs';

/** Golpe sordo: seno grave con caída rápida y un poco de ruido filtrado */
function thump(random, { freq = 90, tau = 0.045, noiseTau = 0.02, noiseCut = 500, len = 0.2 } = {}) {
  const n = secs(len);
  const body = mulIn(osc('sine', glide(freq * 1.6, freq, secs(0.02)), n), decay(n, tau));
  const click = mulIn(lowpass(noise(random, n), noiseCut), decay(n, noiseTau));
  return mix(body, mulIn(click, 0.8));
}

/** Grano de ruido en una banda, con caída exponencial */
function grain(random, { len = 0.05, freq = 2000, q = 1, tau = 0.012 } = {}) {
  const n = secs(len);
  return mulIn(bandpass(noise(random, n), freq, q), decay(n, tau));
}

/** Pasos: dos variantes por superficie con semillas distintas (make-sfx las llama con `variant`) */
const steps = {
  wood(random, variant) {
    const out = thump(random, { freq: 95 + variant * 6, tau: 0.04, noiseCut: 700, len: 0.18 });
    placeIn(out, grain(random, { len: 0.04, freq: 1400, q: 2, tau: 0.006 }), 0, 0.35);
    return normalize(room(out, 0.012, 0.15), 0.8);
  },
  gravel(random, variant) {
    const out = silence(secs(0.2));
    const grains = 7 + variant;
    for (let i = 0; i < grains; i++) {
      const g = grain(random, { len: 0.03, freq: random.range(2200, 4800), q: 0.8, tau: random.range(0.004, 0.009) });
      placeIn(out, g, secs(random.range(0, 0.12)), random.range(0.4, 1));
    }
    placeIn(out, thump(random, { freq: 70, tau: 0.03, noiseCut: 300, len: 0.1 }), 0, 0.35);
    return normalize(out, 0.75);
  },
  concrete(random, variant) {
    const out = thump(random, { freq: 110 - variant * 8, tau: 0.02, noiseCut: 1200, noiseTau: 0.012, len: 0.14 });
    placeIn(out, grain(random, { len: 0.05, freq: 1800, q: 1.2, tau: 0.01 }), 0, 0.6);
    return normalize(room(out, 0.02, 0.25), 0.75);
  },
  tile(random, variant) {
    const out = thump(random, { freq: 130, tau: 0.015, noiseCut: 2500, noiseTau: 0.008, len: 0.16 });
    const n = secs(0.12);
    const ring = mulIn(osc('sine', 3100 + variant * 240, n), decay(n, 0.02));
    placeIn(out, ring, 0, 0.3);
    placeIn(out, grain(random, { len: 0.04, freq: 4200, q: 3, tau: 0.008 }), 0, 0.4);
    return normalize(room(out, 0.025, 0.35), 0.75);
  },
  metal(random, variant) {
    const n = secs(0.3);
    const out = silence(n);
    const partials = [410, 1130, 1840].map((f) => f * (1 + variant * 0.04));
    partials.forEach((f, k) => placeIn(out, mulIn(osc('sine', f, n), decay(n, 0.09 - k * 0.02)), 0, 0.3 / (k + 1)));
    placeIn(out, thump(random, { freq: 85, tau: 0.03, noiseCut: 900, len: 0.12 }), 0, 0.8);
    placeIn(out, grain(random, { len: 0.06, freq: 2600, q: 1.5, tau: 0.012 }), 0, 0.5);
    return normalize(room(out, 0.03, 0.3), 0.7);
  },
  carpet(random, variant) {
    const n = secs(0.14);
    const out = mulIn(lowpass(noise(random, n), 260 + variant * 40), decay(n, 0.035));
    placeIn(out, thump(random, { freq: 60, tau: 0.03, noiseCut: 200, len: 0.1 }), 0, 0.5);
    return normalize(out, 0.55);
  },
  grass(random, variant) {
    const out = silence(secs(0.2));
    for (let i = 0; i < 5 + variant; i++) {
      placeIn(out, grain(random, { len: 0.06, freq: random.range(1200, 2600), q: 0.6, tau: random.range(0.01, 0.02) }), secs(random.range(0, 0.1)), random.range(0.4, 1));
    }
    placeIn(out, thump(random, { freq: 65, tau: 0.03, noiseCut: 250, len: 0.1 }), 0, 0.4);
    return normalize(out, 0.6);
  },
};

export const RECIPES = {
  // ── pasos ───────────────────────────────────────────────────────────────────────────────────────────────
  ...Object.fromEntries(Object.entries(steps).flatMap(([surface, fn]) => [1, 2].map((v) => [`step_${surface}_${v}`, (random) => fn(random, v - 1)]))),

  // ── puertas ─────────────────────────────────────────────────────────────────────────────────────────────
  door_creak(random) {
    const n = secs(0.8);
    const wob = noise(random, n);
    const slow = lowpass(wob, 9);
    const f = (i) => 190 * Math.pow(1.35, i / n) * (1 + 0.06 * slow[i] * 8);
    let body = osc('saw', f, n);
    body = lowpass(body, (i) => 900 + 600 * Math.abs(slow[i] * 8));
    const amp = mulIn(envelope(n, 0.05, 0.1, 0.7, 0.25), 1);
    for (let i = 0; i < n; i++) amp[i] *= 0.75 + 0.25 * Math.abs(slow[i] * 10);
    body = mulIn(body, amp);
    placeIn(body, thump(random, { freq: 80, tau: 0.05, noiseCut: 600, len: 0.2 }), secs(0.62), 0.9);
    return normalize(room(body, 0.02, 0.2), 0.75);
  },
  door_close(random) {
    const out = thump(random, { freq: 72, tau: 0.08, noiseCut: 900, noiseTau: 0.02, len: 0.35 });
    placeIn(out, grain(random, { len: 0.05, freq: 1500, q: 1, tau: 0.01 }), secs(0.012), 0.5);
    return normalize(room(out, 0.035, 0.4), 0.85);
  },
  door_knock(random) {
    const out = silence(secs(0.75));
    for (const t of [0, 0.21, 0.42]) placeIn(out, thump(random, { freq: 125, tau: 0.03, noiseCut: 800, noiseTau: 0.012, len: 0.18 }), secs(t), 0.9 - (t > 0.3 ? 0.1 : 0));
    return normalize(room(out, 0.025, 0.3), 0.8);
  },
  hatch_metal(random) {
    const n = secs(0.9);
    const out = silence(n);
    // raspado del pestillo
    const scrape = mulIn(bandpass(noise(random, secs(0.35)), 1800, 2), envelope(secs(0.35), 0.03, 0.1, 0.6, 0.15));
    placeIn(out, scrape, 0, 0.35);
    // clang inarmónico
    const ring = silence(secs(0.6));
    [310, 742, 1190, 1960, 2630].forEach((f, k) => placeIn(ring, mulIn(osc('sine', f, secs(0.6)), decay(secs(0.6), 0.16 - k * 0.025)), 0, 0.35 / (k + 1)));
    placeIn(out, ring, secs(0.36), 1);
    placeIn(out, thump(random, { freq: 70, tau: 0.06, noiseCut: 1500, noiseTau: 0.015, len: 0.3 }), secs(0.36), 0.9);
    return normalize(room(out, 0.04, 0.4), 0.8);
  },
  door_slide(random) {
    const n = secs(0.7);
    const hiss = mulIn(lowpass(highpass(noise(random, n), 300), 2200), envelope(n, 0.12, 0.15, 0.55, 0.3));
    placeIn(hiss, grain(random, { len: 0.05, freq: 1200, q: 1.5, tau: 0.01 }), secs(0.6), 0.6);
    return normalize(hiss, 0.6);
  },

  // ── interfaz ────────────────────────────────────────────────────────────────────────────────────────────
  inv_open() {
    const a = mulIn(osc('tri', 520, secs(0.06)), envelope(secs(0.06), 0.004, 0.02, 0.6, 0.03));
    const b = mulIn(osc('tri', 780, secs(0.08)), envelope(secs(0.08), 0.004, 0.02, 0.6, 0.05));
    const out = silence(secs(0.15));
    placeIn(out, a, 0, 0.8);
    placeIn(out, b, secs(0.055), 0.8);
    return normalize(out, 0.55);
  },
  inv_close() {
    const a = mulIn(osc('tri', 780, secs(0.06)), envelope(secs(0.06), 0.004, 0.02, 0.6, 0.03));
    const b = mulIn(osc('tri', 520, secs(0.08)), envelope(secs(0.08), 0.004, 0.02, 0.6, 0.05));
    const out = silence(secs(0.15));
    placeIn(out, a, 0, 0.8);
    placeIn(out, b, secs(0.055), 0.8);
    return normalize(out, 0.55);
  },
  verb_select(random) {
    return normalize(grain(random, { len: 0.03, freq: 3800, q: 2.5, tau: 0.004 }), 0.5);
  },
  journal_open() {
    const out = silence(secs(0.2));
    placeIn(out, mulIn(osc('sine', 880, secs(0.05)), envelope(secs(0.05), 0.003, 0.01, 0.8, 0.03)), 0, 0.8);
    placeIn(out, mulIn(osc('sine', 1320, secs(0.09)), envelope(secs(0.09), 0.003, 0.02, 0.7, 0.06)), secs(0.06), 0.8);
    return normalize(out, 0.5);
  },
  journal_close() {
    const out = silence(secs(0.2));
    placeIn(out, mulIn(osc('sine', 1320, secs(0.05)), envelope(secs(0.05), 0.003, 0.01, 0.8, 0.03)), 0, 0.8);
    placeIn(out, mulIn(osc('sine', 880, secs(0.09)), envelope(secs(0.09), 0.003, 0.02, 0.7, 0.06)), secs(0.06), 0.8);
    return normalize(out, 0.5);
  },
  journal_note(random) {
    const n = secs(0.4);
    const out = bandpass(noise(random, n), 2600, 0.9);
    const strokes = lowpass(noise(random, n), 14);
    for (let i = 0; i < n; i++) out[i] *= Math.max(0, strokes[i] * 6) * envelope(n, 0.02, 0.05, 0.9, 0.1)[i];
    return normalize(out, 0.5);
  },
  phone_ring() {
    // Tono de móvil: dos ráfagas de 1000 + 1250 Hz dentro de RING_MS (900 ms, JournalPanel)
    const n = secs(0.9);
    const out = silence(n);
    const beep = (len) => mulIn(mix(osc('sine', 1000, secs(len)), mulIn(osc('sine', 1250, secs(len)), 0.7)), envelope(secs(len), 0.005, 0.01, 0.9, 0.02));
    for (const t of [0, 0.14, 0.45, 0.59]) placeIn(out, beep(0.11), secs(t), 0.5);
    return normalize(out, 0.5);
  },
  phone_pickup(random) {
    const out = silence(secs(0.18));
    placeIn(out, grain(random, { len: 0.03, freq: 2200, q: 2, tau: 0.004 }), 0, 1);
    placeIn(out, mulIn(lowpass(noise(random, secs(0.12)), 1500), envelope(secs(0.12), 0.01, 0.03, 0.4, 0.06)), secs(0.03), 0.3);
    return normalize(out, 0.5);
  },
  phone_hangup(random) {
    const out = silence(secs(0.12));
    placeIn(out, grain(random, { len: 0.03, freq: 1600, q: 2, tau: 0.004 }), 0, 1);
    placeIn(out, grain(random, { len: 0.03, freq: 900, q: 2, tau: 0.006 }), secs(0.03), 0.7);
    return normalize(out, 0.5);
  },

  // ── objetos y personajes ────────────────────────────────────────────────────────────────────────────────
  duck_squeak(random) {
    // Gerald: chirrido de goma, dos pitidos con glissando y vibrato rápido
    const squeak = (len, f0, f1, seed) => {
      const n = secs(len);
      const g = glide(f0, f1, n);
      const v = vibrato(1, 28 + seed, 0.03);
      const f = (i) => g(i) * v(i);
      let s = osc('saw', f, n);
      s = bandpass(s, (f0 + f1) / 2 * 1.3, 1.2);
      return mulIn(s, envelope(n, 0.02, 0.05, 0.75, 0.08));
    };
    const out = silence(secs(0.55));
    placeIn(out, squeak(0.26, 1500, 1150, 0), 0, 1);
    placeIn(out, squeak(0.2, 1250, 1600, 7), secs(0.3), 0.7);
    void random;
    return normalize(softClip(out, 1.5), 0.6);
  },
  intercom_buzz(random) {
    const n = secs(0.45);
    const buzz = mix(osc('square', 118, n), mulIn(osc('square', 236, n), 0.5), mulIn(noise(random, n), 0.25));
    const out = mulIn(bandpass(buzz, 1100, 0.7), envelope(n, 0.01, 0.05, 0.9, 0.04));
    placeIn(out, grain(random, { len: 0.03, freq: 2400, q: 2, tau: 0.004 }), secs(0.43), 0.5);
    return normalize(out, 0.5);
  },
  glass_break(random) {
    const n = secs(0.8);
    const out = silence(n);
    placeIn(out, mulIn(bandpass(noise(random, secs(0.25)), 4200, 0.5), decay(secs(0.25), 0.05)), 0, 1);
    for (let i = 0; i < 28; i++) {
      const len = random.range(0.05, 0.3);
      const f = random.range(2200, 8500);
      placeIn(out, mulIn(osc('sine', f, secs(len)), decay(secs(len), len / 4)), secs(random.range(0, 0.45)), random.range(0.05, 0.25));
    }
    placeIn(out, thump(random, { freq: 95, tau: 0.03, noiseCut: 2000, len: 0.15 }), 0, 0.6);
    return normalize(room(out, 0.03, 0.3), 0.8);
  },
  paper_rustle(random) {
    const n = secs(0.45);
    const out = bandpass(noise(random, n), 2000, 0.6);
    const g = lowpass(noise(random, n), 22);
    const env = envelope(n, 0.03, 0.1, 0.8, 0.15);
    for (let i = 0; i < n; i++) out[i] *= Math.max(0.1, Math.abs(g[i] * 7)) * env[i];
    return normalize(out, 0.45);
  },
  plank_pull(random) {
    const n = secs(0.5);
    const slow = lowpass(noise(random, n), 12);
    const f = (i) => 140 * Math.pow(0.7, i / n) * (1 + 0.08 * slow[i] * 8);
    const creak = mulIn(lowpass(osc('saw', f, n), 700), envelope(n, 0.05, 0.1, 0.8, 0.1));
    const out = silence(secs(0.8));
    placeIn(out, creak, 0, 0.7);
    placeIn(out, thump(random, { freq: 160, tau: 0.02, noiseCut: 2500, noiseTau: 0.01, len: 0.2 }), secs(0.5), 1);
    placeIn(out, grain(random, { len: 0.08, freq: 1200, q: 1, tau: 0.02 }), secs(0.5), 0.6);
    return normalize(room(out, 0.02, 0.2), 0.75);
  },
  switch_flip(random) {
    const out = silence(secs(0.3));
    placeIn(out, thump(random, { freq: 150, tau: 0.015, noiseCut: 1800, noiseTau: 0.006, len: 0.1 }), 0, 1);
    placeIn(out, thump(random, { freq: 110, tau: 0.03, noiseCut: 900, noiseTau: 0.01, len: 0.15 }), secs(0.07), 1);
    return normalize(room(out, 0.03, 0.4), 0.8);
  },
  crt_on(random) {
    const n = secs(1.2);
    const out = silence(n);
    placeIn(out, grain(random, { len: 0.04, freq: 1500, q: 1.5, tau: 0.006 }), 0, 0.6);
    placeIn(out, mulIn(osc('sine', glide(60, 50, n), n), envelope(n, 0.3, 0.2, 0.7, 0.3)), 0, 0.25);
    placeIn(out, mulIn(osc('sine', glide(300, 7800, secs(0.5)), secs(0.6)), envelope(secs(0.6), 0.05, 0.3, 0.2, 0.2)), secs(0.05), 0.15);
    placeIn(out, mulIn(highpass(noise(random, n), 3000), envelope(n, 0.1, 0.4, 0.15, 0.5)), secs(0.1), 0.2);
    return normalize(out, 0.6);
  },
  floppy_insert(random) {
    const n = secs(0.9);
    const out = silence(n);
    placeIn(out, grain(random, { len: 0.04, freq: 1800, q: 1.5, tau: 0.006 }), 0, 0.8);
    const motor = mulIn(lowpass(noise(random, secs(0.6)), 900), envelope(secs(0.6), 0.05, 0.1, 0.8, 0.1));
    const am = osc('sine', 47, secs(0.6));
    for (let i = 0; i < motor.length; i++) motor[i] *= 0.7 + 0.3 * am[i];
    placeIn(out, motor, secs(0.1), 0.6);
    placeIn(out, grain(random, { len: 0.04, freq: 1400, q: 1.5, tau: 0.006 }), secs(0.75), 0.7);
    return normalize(out, 0.55);
  },
  splash(random) {
    const n = secs(0.7);
    const out = mulIn(lowpass(noise(random, n), glide(3500, 400, n)), envelope(n, 0.01, 0.2, 0.3, 0.35));
    for (let i = 0; i < 10; i++) {
      const len = random.range(0.03, 0.08);
      placeIn(out, mulIn(osc('sine', glide(random.range(600, 1200), random.range(1500, 2600), secs(len)), secs(len)), envelope(secs(len), 0.005, 0.01, 0.6, 0.02)), secs(random.range(0.1, 0.55)), 0.12);
    }
    return normalize(out, 0.65);
  },
  coin_ping(random) {
    const n = secs(0.5);
    const out = silence(n);
    [2100, 3340, 5200].forEach((f, k) => placeIn(out, mulIn(osc('sine', f, n), decay(n, 0.12 - k * 0.03)), 0, 0.5 / (k + 1)));
    placeIn(out, grain(random, { len: 0.02, freq: 4000, q: 1, tau: 0.003 }), 0, 0.4);
    return normalize(out, 0.5);
  },
  thud(random) {
    return normalize(room(thump(random, { freq: 65, tau: 0.07, noiseCut: 500, noiseTau: 0.02, len: 0.3 }), 0.03, 0.3), 0.8);
  },
  nest_fall(random) {
    const out = silence(secs(0.7));
    const rustle = RECIPES.paper_rustle(random);
    placeIn(out, resample(rustle, 0.8), 0, 0.5);
    placeIn(out, thump(random, { freq: 70, tau: 0.05, noiseCut: 400, len: 0.25 }), secs(0.42), 0.9);
    return normalize(out, 0.7);
  },

  // ── A4.5: stingers musicales ─────────────────────────────────────────────────────────────────────────────
  ...STINGERS,
};

export const SFX_KEYS = Object.keys(RECIPES);
/** Superficies con pasos (step_<superficie>_1/2) */
export const SURFACES = Object.keys(steps);
// Silencio: fadeIn/fadeOut quedan a disposición de recetas futuras
void fadeIn; void fadeOut;

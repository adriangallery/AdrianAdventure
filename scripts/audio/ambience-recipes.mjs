// A4.4 (plan SCUMM): recetas de los bucles de ambiente (uno por `assets/audio/ambience/<clave>.mp3`). Cada receta
// devuelve `LOOP_SEC` segundos de audio mono que `make-ambience.mjs` deja sin costura (funde el final sobre el
// principio) y rellena al final con el principio repetido (`PAD_SEC`): así el fichero es periódico y MusicManager
// puede poner `loopStart`/`loopEnd` sin que importe el retardo del descodificador de MP3 (ver
// src/systems/Ambience.ts). `gain` es el volumen relativo con el que suena (la música de fondo manda).
//
// Escenas (biblia § 8 y el plan A4.4): grillos al atardecer (outside), viento (mountain, rooftop, clinic_exterior),
// zumbido de servidores (server_room), goteo del sótano (basement), ventilación de la clínica (clinic_interior,
// treatment_room), oficina (lobby, upstairs), agua de la piscina (recovery_pool), burbujeo del laboratorio
// (memelab) y pájaros del amanecer (epilogue_outside).
import {
  secs, osc, noise, envelope, decay, mulIn, mix, placeIn, lowpass, highpass, bandpass, normalize, glide, silence, vibrato, SAMPLE_RATE,
} from './synth.mjs';

export const LOOP_SEC = 16;
export const PAD_SEC = 0.25;
/** Fundido del final sobre el principio al cerrar el bucle */
export const SEAM_SEC = 1.5;

const N = () => secs(LOOP_SEC + SEAM_SEC);

/** Paso bajo de dos polos (12 dB/oct): el de un polo deja demasiado siseo en un fondo de ruido */
const lp2 = (buf, cutoff) => lowpass(lowpass(buf, cutoff), cutoff);

/** Ruido de fondo filtrado con una ondulación lenta de volumen (viento, ventilación, agua) */
function bed(random, { cutoff = 500, hp = 40, rate = 0.08, depth = 0.4, gain = 1 } = {}) {
  const n = N();
  const base = lp2(highpass(noise(random, n), hp), cutoff);
  const lfo = lowpass(noise(random, n), rate);
  for (let i = 0; i < n; i++) base[i] *= gain * (1 - depth + depth * Math.min(1.5, Math.abs(lfo[i] * 12)));
  return base;
}

/** Zumbido eléctrico: fundamental + armónicos impares, un poco inestable */
function hum(freq, n, { harmonics = 4, wob = 0.002 } = {}) {
  const out = silence(n);
  for (let k = 1; k <= harmonics; k++) {
    const f = freq * (2 * k - 1);
    placeIn(out, osc(k % 2 ? 'sine' : 'tri', vibrato(f, 0.3 * k, wob), n), 0, 1 / (k * k));
  }
  return out;
}

export const RECIPES = {
  crickets: {
    gain: 0.55,
    render(random) {
      const n = N();
      const out = mulIn(bed(random, { cutoff: 300, rate: 0.05, depth: 0.5 }), 0.12);
      // Tres grillos con cadencias y alturas distintas: ráfagas de pulsos a 4-5 kHz moduladas a 16-22 Hz
      const crickets = [[4200, 18, 0.9], [4700, 21, 1.3], [3900, 16, 0.7]];
      for (const [freq, pulseHz, period] of crickets) {
        const tone = osc('sine', vibrato(freq, 7, 0.01), n);
        let t = random.range(0, 1);
        while (t < LOOP_SEC + SEAM_SEC) {
          const len = random.range(0.5, 1.6);
          const start = secs(t);
          const stop = Math.min(n, start + secs(len));
          for (let i = start; i < stop; i++) {
            const local = (i - start) / SAMPLE_RATE;
            const pulse = Math.max(0, Math.sin(2 * Math.PI * pulseHz * local)) ** 3;
            const env = Math.min(1, local / 0.08, (len - local) / 0.12);
            out[i] += tone[i] * pulse * env * 0.22;
          }
          t += len + random.range(period * 0.6, period * 1.4);
        }
      }
      return normalize(out, 0.7);
    },
  },
  wind: {
    gain: 0.5,
    render(random) {
      const n = N();
      const out = bed(random, { cutoff: 420, hp: 30, rate: 0.06, depth: 0.6 });
      // Ráfagas: silbido en banda alta que sube y baja
      const gust = bandpass(noise(random, n), 900, 0.5);
      const lfo = lowpass(noise(random, n), 0.12);
      for (let i = 0; i < n; i++) out[i] += gust[i] * Math.max(0, lfo[i] * 14 - 0.3) * 0.5;
      return normalize(out, 0.7);
    },
  },
  server_hum: {
    gain: 0.45,
    render(random) {
      const n = N();
      const out = mulIn(hum(50, n, { harmonics: 5 }), 0.35);
      // Ventiladores: ruido en banda media con batido lento, y un disco que chasca de vez en cuando
      const fans = mulIn(bandpass(noise(random, n), 700, 0.6), 0.5);
      const beat = osc('sine', 0.7, n);
      for (let i = 0; i < n; i++) out[i] += fans[i] * (0.8 + 0.2 * beat[i]);
      out.set(mix(out, mulIn(lp2(noise(random, n), 160), 0.35)));
      for (let i = 0; i < 9; i++) {
        const len = secs(0.03);
        placeIn(out, mulIn(bandpass(noise(random, len), 2500, 3), decay(len, 0.005)), secs(random.range(0, LOOP_SEC + SEAM_SEC)), 0.18);
      }
      return normalize(out, 0.7);
    },
  },
  basement_drip: {
    gain: 0.45,
    render(random) {
      const n = N();
      const out = mulIn(hum(60, n, { harmonics: 3, wob: 0.004 }), 0.2);
      out.set(mix(out, mulIn(lp2(noise(random, n), 120), 0.45)));
      // Goteo: «plink» con glissando descendente y cola de sala, a ritmo casi regular (la biblia: «Drip. Drip. Buy.»)
      let t = 0.4;
      while (t < LOOP_SEC + SEAM_SEC) {
        const len = secs(0.25);
        const f0 = random.range(1800, 2600);
        const drop = mulIn(osc('sine', glide(f0, f0 * 0.55, secs(0.06)), len), decay(len, 0.04));
        placeIn(out, drop, secs(t), random.range(0.25, 0.45));
        placeIn(out, mulIn(lowpass(noise(random, secs(0.08)), 1500), decay(secs(0.08), 0.01)), secs(t), 0.15);
        t += random.range(1.4, 2.6);
      }
      return normalize(out, 0.7);
    },
  },
  clinic_vent: {
    gain: 0.4,
    render(random) {
      const n = N();
      const out = bed(random, { cutoff: 380, hp: 50, rate: 0.04, depth: 0.15, gain: 0.8 });
      out.set(mix(out, mulIn(hum(120, n, { harmonics: 2 }), 0.08)));
      out.set(mix(out, mulIn(highpass(lowpass(noise(random, n), 6000), 3500), 0.05)));
      // Un pitido de monitor lejano cada ~4 s
      for (let t = 1.1; t < LOOP_SEC + SEAM_SEC; t += 4) {
        placeIn(out, mulIn(osc('sine', 1760, secs(0.09)), envelope(secs(0.09), 0.005, 0.02, 0.6, 0.04)), secs(t), 0.09);
      }
      return normalize(out, 0.7);
    },
  },
  office_hum: {
    gain: 0.35,
    render(random) {
      const n = N();
      const out = mulIn(hum(120, n, { harmonics: 3, wob: 0.003 }), 0.18);
      out.set(mix(out, mulIn(lp2(noise(random, n), 90), 0.7)));
      // Reloj de pared: tic cada segundo
      for (let t = 0.25; t < LOOP_SEC + SEAM_SEC; t += 1) {
        const len = secs(0.03);
        placeIn(out, mulIn(bandpass(noise(random, len), 3000, 2.5), decay(len, 0.004)), secs(t), 0.14);
      }
      return normalize(out, 0.7);
    },
  },
  pool_water: {
    gain: 0.5,
    render(random) {
      const n = N();
      const out = bed(random, { cutoff: 700, hp: 120, rate: 0.25, depth: 0.7, gain: 0.8 });
      const lap = bandpass(noise(random, n), 1600, 0.8);
      const wave = osc('sine', 0.35, n);
      for (let i = 0; i < n; i++) out[i] += lap[i] * Math.max(0, wave[i]) ** 2 * 0.35;
      // Burbujas: glissandos cortos hacia arriba
      for (let i = 0; i < 26; i++) {
        const len = secs(random.range(0.04, 0.12));
        const f0 = random.range(500, 1400);
        placeIn(out, mulIn(osc('sine', glide(f0, f0 * 1.8, len), len), envelope(len, 0.005, 0.02, 0.6, 0.03)), secs(random.range(0, LOOP_SEC + SEAM_SEC)), 0.12);
      }
      return normalize(out, 0.7);
    },
  },
  lab_bubbles: {
    gain: 0.45,
    render(random) {
      const n = N();
      const out = mulIn(hum(55, n, { harmonics: 4, wob: 0.006 }), 0.25);
      out.set(mix(out, mulIn(bandpass(noise(random, n), 2400, 1.5), 0.08)));
      // Burbujeo de probetas
      for (let i = 0; i < 48; i++) {
        const len = secs(random.range(0.03, 0.09));
        const f0 = random.range(700, 2200);
        placeIn(out, mulIn(osc('sine', glide(f0, f0 * 1.6, len), len), envelope(len, 0.004, 0.02, 0.5, 0.03)), secs(random.range(0, LOOP_SEC + SEAM_SEC)), 0.11);
      }
      // Un tono modulado que sube y baja: el experimento en marcha
      const mod = osc('sine', 0.09, n);
      const tone = osc('tri', (i) => 220 + 60 * mod[i], n);
      for (let i = 0; i < n; i++) out[i] += tone[i] * 0.06 * (0.5 + 0.5 * mod[i]);
      return normalize(out, 0.7);
    },
  },
  dawn_birds: {
    gain: 0.5,
    render(random) {
      const n = N();
      const out = mulIn(bed(random, { cutoff: 350, rate: 0.05, depth: 0.4 }), 0.35);
      // Trinos: series de 3-6 notas con glissando descendente o ascendente, en 2-5 kHz
      let t = random.range(0.2, 1);
      while (t < LOOP_SEC + SEAM_SEC) {
        const notes = random.int(3, 6);
        const base = random.range(2400, 4600);
        let at = t;
        for (let k = 0; k < notes; k++) {
          const len = secs(random.range(0.05, 0.12));
          const f0 = base * random.range(0.9, 1.15);
          const f1 = f0 * random.range(0.8, 1.3);
          placeIn(out, mulIn(osc('sine', glide(f0, f1, len), len), envelope(len, 0.008, 0.02, 0.7, 0.03)), secs(at), 0.16);
          at += len / SAMPLE_RATE + random.range(0.03, 0.09);
        }
        t = at + random.range(0.8, 2.4);
      }
      return normalize(out, 0.7);
    },
  },
};

export const AMBIENCE_KEYS = Object.keys(RECIPES);

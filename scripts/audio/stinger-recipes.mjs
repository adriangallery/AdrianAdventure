// A4.5 (plan SCUMM): stingers musicales sintetizados (chiptune: triángulo + cuadrada con envolvente y un poco de eco),
// todos en DO para que el motor los transporte con `detune` a la tónica de la pista que suena
// (src/config/music.config.ts, src/systems/Stingers.ts). Las variantes _major/_minor siguen el modo de la pista;
// `stinger_item` (quinta justa) y `stinger_fail` (deslizamiento cromático) valen en los dos modos.
// make-sfx.mjs los escribe en assets/audio/sfx/ como un efecto más.
import { secs, osc, envelope, mulIn, placeIn, delayMix, normalize, silence, vibrato, glide, lowpass } from './synth.mjs';

/** Frecuencia de una nota MIDI */
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// Do mayor / menor (grados relativos a C5 = 72)
const C5 = 72;

/** Nota chiptune: triángulo + cuadrada suave, ADSR corto, con vibrato opcional */
function note(midi, len, { vib = 0, square = 0.35, a = 0.01, d = 0.08, s = 0.6, r = 0.12 } = {}) {
  const n = secs(len);
  const f = vib ? vibrato(hz(midi), 5.5, vib) : hz(midi);
  const tri = osc('tri', f, n);
  const sq = mulIn(lowpass(osc('square', f, n), 3500), square);
  const out = tri;
  for (let i = 0; i < n; i++) out[i] += sq[i];
  return mulIn(out, envelope(n, a, d, s, r));
}

/** Secuencia [[midi, inicio s, duración s, opciones]] sobre `total` segundos */
function seq(notes, total, gain = 0.5) {
  const out = silence(secs(total));
  for (const [midi, at, len, opts] of notes) placeIn(out, note(midi, len, opts), secs(at), gain);
  return out;
}

export const RECIPES = {
  // Objeto encontrado: do-sol-do', un destello corto (neutro: sin tercera)
  stinger_item() {
    const out = seq([[C5, 0, 0.12], [C5 + 7, 0.1, 0.12], [C5 + 12, 0.2, 0.4, { vib: 0.004 }]], 0.75, 0.45);
    return normalize(delayMix(out, 0.11, 0.25, 0.25), 0.7);
  },
  // Puzle resuelto (mayor): arpegio do-mi-sol-do' y do' sostenido con vibrato
  stinger_puzzle_major() {
    const out = seq([[C5, 0, 0.11], [C5 + 4, 0.1, 0.11], [C5 + 7, 0.2, 0.11], [C5 + 12, 0.3, 0.55, { vib: 0.006 }], [C5 + 7, 0.3, 0.55]], 1.3, 0.42);
    return normalize(delayMix(out, 0.15, 0.3, 0.3), 0.75);
  },
  // Puzle resuelto (menor): do-mib-sol-do'
  stinger_puzzle_minor() {
    const out = seq([[C5, 0, 0.11], [C5 + 3, 0.1, 0.11], [C5 + 7, 0.2, 0.11], [C5 + 12, 0.3, 0.55, { vib: 0.006 }], [C5 + 7, 0.3, 0.55]], 1.3, 0.42);
    return normalize(delayMix(out, 0.15, 0.3, 0.3), 0.75);
  },
  // Capítulo cerrado (mayor): fanfarria corta do do sol | mi do' (con quinta debajo)
  stinger_chapter_major() {
    const out = seq([
      [C5, 0, 0.14], [C5, 0.16, 0.14], [C5 + 7, 0.32, 0.3], [C5 + 4, 0.66, 0.16],
      [C5 + 12, 0.84, 1.1, { vib: 0.007 }], [C5 + 7, 0.84, 1.1], [C5 - 12, 0.84, 1.1, { square: 0.15 }],
    ], 2.3, 0.38);
    return normalize(delayMix(out, 0.17, 0.3, 0.3), 0.8);
  },
  // Capítulo cerrado (menor): do do sol | mib do'
  stinger_chapter_minor() {
    const out = seq([
      [C5, 0, 0.14], [C5, 0.16, 0.14], [C5 + 7, 0.32, 0.3], [C5 + 3, 0.66, 0.16],
      [C5 + 12, 0.84, 1.1, { vib: 0.007 }], [C5 + 7, 0.84, 1.1], [C5 - 12, 0.84, 1.1, { square: 0.15 }],
    ], 2.3, 0.38);
    return normalize(delayMix(out, 0.17, 0.3, 0.3), 0.8);
  },
  // Fallo (duelo perdido, intento inútil): «wah wah» cromático descendente, sin tercera
  stinger_fail() {
    const n = secs(1.1);
    const f = glide(hz(C5 + 7), hz(C5 + 2), n);
    const tone = mulIn(osc('tri', (i) => f(i) * (1 + 0.01 * Math.sin(i / 400)), n), envelope(n, 0.02, 0.2, 0.7, 0.4));
    const low = mulIn(osc('square', (i) => f(i) / 2, n), envelope(n, 0.02, 0.2, 0.5, 0.4));
    const out = silence(n);
    placeIn(out, tone, 0, 0.5);
    placeIn(out, lowpass(low, 1200), 0, 0.2);
    return normalize(out, 0.6);
  },
};

export const STINGER_KEYS = Object.keys(RECIPES);

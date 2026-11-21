// F1.1 (plan FUNTICO_ADVENTURE): generador pseudoaleatorio con semilla, determinista y portable (navegador y Node,
// sin dependencias). La cadena semilla se resume con cyrb128 (4 palabras de 32 bits) y alimenta sfc32. Todo son
// operaciones enteras de 32 bits (Math.imul, >>>), así que da la misma secuencia en cualquier motor de JS.
// ESM puro con tipos en rng.d.ts: lo importan el cliente (Vite) y el save-server (F2.2) sin paso de build.

/**
 * cyrb128 (bryc, dominio público): hash de 128 bits de una cadena (por unidades UTF-16).
 * @param {string} str
 * @returns {[number, number, number, number]}
 */
export function hashSeed(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Generador sfc32 sembrado con hashSeed(seed).
 * @param {string} seed
 */
export function createRng(seed) {
  let [a, b, c, d] = hashSeed(String(seed));
  const nextU32 = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return r >>> 0;
  };
  // calentamiento: las primeras salidas de sfc32 se parecen entre semillas cercanas
  for (let i = 0; i < 15; i++) nextU32();
  const next = () => nextU32() / 4294967296;
  /** @param {number} n entero ≥ 1 → entero en [0, n) */
  const int = (n) => Math.floor(next() * n);
  return {
    nextU32,
    next,
    int,
    /** @template T @param {readonly T[]} arr @returns {T} */
    pick: (arr) => arr[int(arr.length)],
    /** Fisher–Yates sobre una copia. @template T @param {readonly T[]} arr @returns {T[]} */
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
  };
}

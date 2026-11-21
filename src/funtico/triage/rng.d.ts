// F1.1 (plan FUNTICO_ADVENTURE): tipos de rng.js (ESM puro, sin paso de build).

export interface Rng {
  /** Entero sin signo de 32 bits. */
  nextU32(): number;
  /** Real en [0, 1). */
  next(): number;
  /** Entero en [0, n). */
  int(n: number): number;
  pick<T>(arr: readonly T[]): T;
  /** Copia barajada (Fisher–Yates). */
  shuffle<T>(arr: readonly T[]): T[];
}

/** cyrb128 de la cadena: 4 enteros sin signo de 32 bits. */
export function hashSeed(str: string): [number, number, number, number];

/** sfc32 sembrado con hashSeed(seed). Misma semilla → misma secuencia en cualquier motor. */
export function createRng(seed: string): Rng;

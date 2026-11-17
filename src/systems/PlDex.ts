/**
 * A2.21 (plan SCUMM): PRUEBA del andar «Dex PixelLab», detrás de `?dex=pl`. Sin el parámetro el juego es el de A2.15.
 * Solo cambia el ANDAR (8 fotogramas × 4 direcciones, assets/sprites/player/dexpl/walk_<dir>_<i>.png, 60×105, pies
 * en la última fila); quieto, hablar, coger y manías siguen siendo los del rig dex2d.
 *
 * Lógica pura, sin Phaser ni imports (tests/pl-dex.test.mjs, en `npm run test:engine`).
 */
export type PlDir = 'left' | 'right' | 'up' | 'down';
export const PL_PREFIX = 'dexpl';
export const PL_DIRS: readonly PlDir[] = ['left', 'right', 'up', 'down'];
export const PL_WALK_FRAMES = 8;
/**
 * De perfil: zancada medida en los fotogramas ≈ 40 px de arte por paso (2 pasos por ciclo); a 74 px/s (A2.12)
 * el ciclo dura ~1,08 s → 130 ms por fotograma para que no patine. Arriba/abajo: el mismo ciclo de 800 ms del rig.
 */
export const PL_SIDE_FRAME_MS = 130;
export const PL_VERT_FRAME_MS = 100;

/** `?dex=pl` → true; cualquier otra cosa, false (el Dex de siempre) */
export function parsePlMode(search: string): boolean {
  return new URLSearchParams(search).get("dex")?.trim().toLowerCase() === "pl";
}

export const plKey = (dir: PlDir, i: number): string => `${PL_PREFIX}_walk_${dir}_${i}`;

/** Fotograma de andar para el reloj de andar (ms, ya multiplicado por la velocidad como en el rig) */
export function plWalkKey(dir: PlDir, tMs: number): string {
  const ms = dir === "left" || dir === "right" ? PL_SIDE_FRAME_MS : PL_VERT_FRAME_MS;
  return plKey(dir, Math.floor(Math.max(0, tMs) / ms) % PL_WALK_FRAMES);
}

/** Ficheros a cargar (solo si se pide `?dex=pl`) */
export function plFiles(): Array<{ key: string; url: string }> {
  const out: Array<{ key: string; url: string }> = [];
  for (const d of PL_DIRS) for (let i = 0; i < PL_WALK_FRAMES; i++) out.push({ key: plKey(d, i), url: `assets/sprites/player/${PL_PREFIX}/walk_${d}_${i}.png` });
  return out;
}

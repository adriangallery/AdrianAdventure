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
 * De perfil: en los PNG el pie apoyado retrocede 9,25–9,5 px de arte por fotograma (pasos de 37 y 38 px, 2 por
 * ciclo). A2.21 (demo-a2-21-pldex): en el juego Dex avanza 78 px de arte/s en outside y 81 en lobby (más que los
 * 74 de diseño de A2.12 por la escala entera de A2.8) → 120 ms por fotograma: 9,4–9,7 px, el pie no patina
 * (con 130 ms eran 10,2–10,5 px). Arriba/abajo: el mismo ciclo de 800 ms del rig.
 */
export const PL_SIDE_FRAME_MS = 120;
/** Lo que retrocede el pie apoyado en el arte de perfil, px de arte por fotograma (medido en walk_right/left_*.png) */
export const PL_SIDE_STEP_ART_PX: readonly [number, number] = [9.25, 9.5];
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

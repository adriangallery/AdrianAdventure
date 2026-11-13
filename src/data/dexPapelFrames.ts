// GENERADO por art/dex2d/papel.py (A2.16: prueba «Dex de papel», ?dex=papel). No editar a mano.
// Claves de Phaser: `dexpapel_<anim>_<i>` y `dexpapel_jaw_<front|r|l>` (assets/sprites/player/dexpapel/).
// `jaw`: esquina superior izquierda de la mandíbula en cada fotograma de hablar (píxeles de arte del lienzo).
export interface DexPapelAnim { frames: number; ms: number; w: number; h: number; jaw?: ReadonlyArray<readonly [number, number]> }
export const DEXPAPEL_WALK_POSES = 4;
export const DEXPAPEL_WALK_POSE_MS = 150;
export const DEXPAPEL_STEP_ART_PX = 22.2;
/** Pie de apoyo respecto a la cadera en cada pose de andar (px de arte; + = hacia donde anda) */
export const DEXPAPEL_STANCE_X: readonly number[] = [5.55, -5.55, 5.55, -5.55];
export const DEXPAPEL_JAW_SIZE: Record<string, readonly [number, number]> = {
  front: [10, 4],
  r: [8, 4],
  l: [8, 4],
};
export const DEXPAPEL_ANIMS: Record<string, DexPapelAnim> = {
  walk_r_suave: { frames: 4, ms: 150, w: 48, h: 103 },
  walk_r_media: { frames: 4, ms: 150, w: 48, h: 103 },
  walk_r_tope: { frames: 4, ms: 150, w: 48, h: 103 },
  talk_front: { frames: 5, ms: 0, w: 37, h: 103, jaw: [[17, 19], [17, 19], [16, 19], [17, 18], [18, 19]] },
  talk_r: { frames: 4, ms: 0, w: 48, h: 103, jaw: [[24, 21], [24, 21], [24, 21], [24, 21]] },
  walk_l_suave: { frames: 4, ms: 150, w: 48, h: 103 },
  walk_l_media: { frames: 4, ms: 150, w: 48, h: 103 },
  walk_l_tope: { frames: 4, ms: 150, w: 48, h: 103 },
  talk_l: { frames: 4, ms: 0, w: 48, h: 103, jaw: [[16, 21], [16, 21], [16, 21], [16, 21]] },
};

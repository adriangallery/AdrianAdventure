// GENERADO por art/dex2d/build.py (A2.15: rig 2D de Dex pre-renderizado). No editar a mano.
// Claves de Phaser: `dex2d_<anim>_<i>` (assets/sprites/player/dex2d/<anim>_<i>.png).
export interface Dex2dAnim { frames: number; ms: number; loop: boolean; w: number; h: number }
export const DEX2D_WALK_STEP_ART_PX = 29.6;
export const DEX2D_ANIMS: Record<string, Dex2dAnim> = {
  walk_r: { frames: 8, ms: 100, loop: true, w: 48, h: 103 },
  walk_down: { frames: 6, ms: 133, loop: true, w: 37, h: 103 },
  walk_up: { frames: 6, ms: 133, loop: true, w: 28, h: 103 },
  idle: { frames: 4, ms: 450, loop: true, w: 37, h: 103 },
  tic_scratch: { frames: 8, ms: 140, loop: false, w: 37, h: 103 },
  tic_glasses: { frames: 5, ms: 220, loop: false, w: 37, h: 103 },
  tic_sway: { frames: 6, ms: 220, loop: false, w: 37, h: 103 },
  tic_yawn: { frames: 5, ms: 220, loop: false, w: 37, h: 103 },
  talk_front: { frames: 4, ms: 140, loop: true, w: 37, h: 103 },
  talk_r: { frames: 4, ms: 140, loop: true, w: 48, h: 103 },
  pick_r_high: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
  pick_r_mid: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
  pick_r_low: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
  shrug: { frames: 5, ms: 130, loop: false, w: 37, h: 103 },
  walk_l: { frames: 8, ms: 100, loop: true, w: 48, h: 103 },
  talk_l: { frames: 4, ms: 140, loop: true, w: 48, h: 103 },
  pick_l_high: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
  pick_l_mid: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
  pick_l_low: { frames: 4, ms: 90, loop: false, w: 48, h: 103 },
};

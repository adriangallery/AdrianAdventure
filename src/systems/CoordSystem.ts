/**
 * Single source of truth for all coordinate math.
 *
 * TWO MODES:
 * - **Landscape**: Background contain-scaled (letterboxed, no scroll).
 * - **Portrait**:  Background cover-scaled (fills viewport entirely), camera scrolls horizontally.
 *
 * All game positions use PERCENTAGE coordinates (0-100) of the original image.
 */
export class CoordSystem {
  /** Original image dimensions */
  readonly imgW: number;
  readonly imgH: number;

  /** Current viewport dimensions (game area, excludes SCUMM panel) */
  vpW = 0;
  vpH = 0;

  /** Is the viewport in portrait orientation? */
  isPortrait = false;

  /** Is the background panoramic (wider than viewport after height-fill)? */
  isPanoramic = false;

  /** Uniform scale factor (image → screen) */
  scale = 1;

  /** Rendered background size in screen pixels */
  bgW = 0;
  bgH = 0;

  /** Background offset in world coordinates */
  bgX = 0;
  bgY = 0;

  constructor(imgW: number, imgH: number) {
    this.imgW = imgW;
    this.imgH = imgH;
  }

  /** Recalculate all derived values. Call on create and resize. */
  recalculate(vpW: number, vpH: number): void {
    this.vpW = vpW;
    this.vpH = vpH;
    this.isPortrait = vpH > vpW;

    // Detect if background is panoramic (much wider than tall relative to viewport)
    const bgAspect = this.imgW / this.imgH;
    const vpAspect = vpW / vpH;
    this.isPanoramic = bgAspect > vpAspect * 1.2; // bg is significantly wider than viewport

    if (this.isPortrait || this.isPanoramic) {
      // Portrait OR Panoramic: COVER height — fill viewport height, camera scrolls horizontally.
      this.scale = vpH / this.imgH;
      this.bgW = this.imgW * this.scale;
      this.bgH = this.imgH * this.scale;
      this.bgX = 0;
      this.bgY = 0;
    } else {
      // Landscape non-panoramic: contain — image fits viewport without cropping
      this.scale = Math.min(vpW / this.imgW, vpH / this.imgH);
      this.bgW = this.imgW * this.scale;
      this.bgH = this.imgH * this.scale;
      this.bgX = (vpW - this.bgW) / 2;
      this.bgY = (vpH - this.bgH) / 2;
    }
  }

  /** Convert percentage coords (0-100) to world pixel position. */
  pctToScreen(pctX: number, pctY: number): { x: number; y: number } {
    return {
      x: (pctX / 100) * this.bgW + this.bgX,
      y: (pctY / 100) * this.bgH + this.bgY,
    };
  }

  /** Convert world pixel position to percentage coords (0-100). */
  screenToPct(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: ((worldX - this.bgX) / this.bgW) * 100,
      y: ((worldY - this.bgY) / this.bgH) * 100,
    };
  }

  /** Is a world point within the rendered background area? */
  isInBgArea(worldX: number, worldY: number): boolean {
    return (
      worldX >= this.bgX &&
      worldX <= this.bgX + this.bgW &&
      worldY >= this.bgY &&
      worldY <= this.bgY + this.bgH
    );
  }

  /** Maximum horizontal scroll for camera (portrait mode). */
  getMaxScrollX(): number {
    return Math.max(0, this.bgW - this.vpW);
  }

  /** Scale factor for sprites (same as background scale). */
  getScale(): number {
    return this.scale;
  }

  /** Background transform for Phaser image positioning. */
  getBgTransform(): { x: number; y: number; scaleX: number; scaleY: number } {
    return { x: this.bgX, y: this.bgY, scaleX: this.scale, scaleY: this.scale };
  }
}

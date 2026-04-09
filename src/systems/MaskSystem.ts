import { MaskMapping } from '@/types/scene.types';
import { MASK_COLORS } from '@/config/game.config';

/**
 * Reads a color-coded walkmask PNG to determine walkable areas, hotspots, and triggers.
 * Colors: blue = walkable, yellow = hotspot, magenta = trigger.
 */
export class MaskSystem {
  private imageData: ImageData | null = null;
  private maskWidth = 0;
  private maskHeight = 0;
  private mapping: MaskMapping = {
    walkableColor: MASK_COLORS.WALKABLE,
    hotspotColor: MASK_COLORS.HOTSPOT,
    triggerColor: MASK_COLORS.TRIGGER,
    regionIdStrategy: 'manual',
  };

  /**
   * Initialize from a Phaser scene's loaded texture.
   * Must be called after the mask image is loaded in PreloadScene.
   */
  initFromTexture(scene: Phaser.Scene, textureKey: string, mapping?: MaskMapping): void {
    if (mapping) {
      this.mapping = mapping;
    }

    const source = scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    this.maskWidth = source.width;
    this.maskHeight = source.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('MaskSystem: Could not get 2D context');
      return;
    }

    ctx.drawImage(source, 0, 0);
    this.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Get the hex color at a pixel coordinate.
   * Returns null if out of bounds or transparent.
   */
  getPixelColor(x: number, y: number): string | null {
    if (!this.imageData) return null;

    const px = Math.floor(x);
    const py = Math.floor(y);

    if (px < 0 || px >= this.maskWidth || py < 0 || py >= this.maskHeight) return null;

    const index = (py * this.maskWidth + px) * 4;
    const r = this.imageData.data[index];
    const g = this.imageData.data[index + 1];
    const b = this.imageData.data[index + 2];
    const a = this.imageData.data[index + 3];

    if (a < 128) return null; // Treat semi-transparent as empty

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  }

  private colorMatch(pixel: string | null, target: string): boolean {
    if (!pixel) return false;
    return pixel.toUpperCase() === target.toUpperCase();
  }

  isWalkable(x: number, y: number): boolean {
    return this.colorMatch(this.getPixelColor(x, y), this.mapping.walkableColor);
  }

  isHotspot(x: number, y: number): boolean {
    return this.colorMatch(this.getPixelColor(x, y), this.mapping.hotspotColor);
  }

  isTrigger(x: number, y: number): boolean {
    return this.colorMatch(this.getPixelColor(x, y), this.mapping.triggerColor);
  }

  /**
   * Check if a point is any interactive type (walkable, hotspot, or trigger).
   */
  isInteractive(x: number, y: number): boolean {
    return this.isWalkable(x, y) || this.isHotspot(x, y) || this.isTrigger(x, y);
  }

  /**
   * Find the nearest walkable point to (x, y) by spiral search.
   * Returns the point itself if already walkable, or the nearest one within maxRadius.
   */
  findNearestWalkable(x: number, y: number, maxRadius = 50): { x: number; y: number } | null {
    if (this.isWalkable(x, y)) return { x, y };

    for (let r = 1; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // Only check perimeter
          if (this.isWalkable(x + dx, y + dy)) {
            return { x: x + dx, y: y + dy };
          }
        }
      }
    }

    return null;
  }

  getWidth(): number {
    return this.maskWidth;
  }

  getHeight(): number {
    return this.maskHeight;
  }

  destroy(): void {
    this.imageData = null;
  }
}

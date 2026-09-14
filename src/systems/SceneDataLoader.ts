import type { SceneData, HotspotData, TriggerData } from '@/types/scene.types';

/**
 * Loads and queries scene data.
 * All bounds are in PERCENTAGE coordinates (0-100) relative to background.
 */
export class SceneDataLoader {
  private data: SceneData;

  constructor(data: SceneData) { this.data = data; }

  getSceneData(): SceneData { return this.data; }
  getHotspots(): HotspotData[] { return this.data.regions.hotspots; }
  getTriggers(): TriggerData[] { return this.data.regions.triggers; }

  /** Find hotspot at percentage coordinates (0-100) */
  getHotspotAtPct(px: number, py: number): HotspotData | null {
    for (const hs of this.data.regions.hotspots) {
      if (!hs.bounds) continue;
      const b = hs.bounds;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        return hs;
      }
    }
    return null;
  }

  /**
   * V6 (controles táctiles): hotspot bajo el dedo con margen. Si el punto no cae dentro de ningún
   * hotspot visible, devuelve el visible más cercano cuyo rectángulo ampliado en padX/padY (%) lo
   * contiene. Solo se usa con toques; el ratón sigue con getHotspotAtPct exacto.
   */
  getHotspotNearPct(px: number, py: number, padX: number, padY: number, isVisible: (hs: HotspotData) => boolean = () => true): HotspotData | null {
    let best: HotspotData | null = null;
    let bestDist = Infinity;
    for (const hs of this.data.regions.hotspots) {
      if (!hs.bounds || !isVisible(hs)) continue;
      const b = hs.bounds;
      const dx = px < b.x ? b.x - px : px > b.x + b.w ? px - (b.x + b.w) : 0;
      const dy = py < b.y ? b.y - py : py > b.y + b.h ? py - (b.y + b.h) : 0;
      if (dx === 0 && dy === 0) return hs;
      if (dx <= padX && dy <= padY) {
        const dist = Math.hypot(dx / Math.max(padX, 1e-6), dy / Math.max(padY, 1e-6));
        if (dist < bestDist) {
          bestDist = dist;
          best = hs;
        }
      }
    }
    return best;
  }

  /** Find trigger at percentage coordinates (0-100) */
  getTriggerAtPct(px: number, py: number): TriggerData | null {
    for (const tr of this.data.regions.triggers) {
      if (!tr.bounds) continue;
      const b = tr.bounds;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        return tr;
      }
    }
    return null;
  }

  // Keep old methods for backwards compat (unused but prevents compile errors)
  getHotspotAt(wx: number, wy: number): HotspotData | null { return this.getHotspotAtPct(wx, wy); }
  getTriggerAt(wx: number, wy: number): TriggerData | null { return this.getTriggerAtPct(wx, wy); }
}

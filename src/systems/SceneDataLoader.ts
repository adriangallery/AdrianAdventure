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

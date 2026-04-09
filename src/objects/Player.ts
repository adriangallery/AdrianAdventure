import Phaser from 'phaser';
import type { SceneData } from '@/types/scene.types';
import type { CoordSystem } from '@/systems/CoordSystem';

const WALK_FRAME_MS = 180;
const IDLE_FRAME_MS = 400;

/**
 * Player character.
 * Position stored in PERCENTAGE coordinates (0-100).
 * Screen position derived from CoordSystem each frame.
 */
export class Player extends Phaser.GameObjects.Sprite {
  private coordSystem: CoordSystem;
  private walkableAreas: Array<{ x: number; y: number; w: number; h: number }>;

  /** Global scale multiplier from config */
  private playerScaleMultiplier: number;

  /** Current position in % coords */
  pctX: number;
  pctY: number;

  /** Movement target in % coords (null = not moving) */
  private targetPctX: number | null = null;
  private targetPctY: number | null = null;

  /** Movement speed in % per second */
  private pctSpeed: number;

  private walkFrameIndex = 0;
  private walkTimer = 0;
  private idleFrameIndex = 0;
  private idleTimer = 0;

  constructor(scene: Phaser.Scene, coordSystem: CoordSystem, spawnPctX: number, spawnPctY: number, sceneData: SceneData) {
    const screen = coordSystem.pctToScreen(spawnPctX, spawnPctY);
    super(scene, screen.x, screen.y, 'player_idle1');

    this.coordSystem = coordSystem;
    this.pctX = spawnPctX;
    this.pctY = spawnPctY;
    this.walkableAreas = sceneData.walkableAreas ?? [];

    // Per-scene playerScale overrides global config
    const globalConfig = scene.cache.json.get('globalConfig') as { playerScale?: number } | undefined;
    this.playerScaleMultiplier = sceneData.player.playerScale ?? globalConfig?.playerScale ?? 1.0;

    // Speed: convert from pixels/sec to %/sec (relative to image height)
    const rawSpeed = sceneData.player.speed ?? 200;
    this.pctSpeed = (rawSpeed / coordSystem.imgH) * 100;

    this.setOrigin(0.5, 1); // bottom-center (feet = position)
    this.setScale(coordSystem.getScale() * this.playerScaleMultiplier);
    this.setDepth(10);

    scene.add.existing(this);
  }

  /** Walk to a target in % coords, clamped to walkable areas. */
  walkToPct(pctX: number, pctY: number): void {
    const clamped = this.clampToWalkable(pctX, pctY);
    this.targetPctX = clamped.x;
    this.targetPctY = clamped.y;
  }

  halt(): void {
    this.targetPctX = null;
    this.targetPctY = null;
    this.setTexture('player_idle1');
  }

  isMoving(): boolean {
    return this.targetPctX !== null;
  }

  /** Called on viewport resize — reposition and rescale. */
  onResize(coordSystem: CoordSystem): void {
    this.coordSystem = coordSystem;
    const screen = coordSystem.pctToScreen(this.pctX, this.pctY);
    this.setPosition(screen.x, screen.y);
    this.setScale(coordSystem.getScale() * this.playerScaleMultiplier);
  }

  update(_time: number, delta: number): void {
    if (this.targetPctX === null || this.targetPctY === null) {
      // Idle animation
      this.idleTimer += delta;
      if (this.idleTimer >= IDLE_FRAME_MS) {
        this.idleTimer = 0;
        this.idleFrameIndex = (this.idleFrameIndex + 1) % 4;
        this.setTexture(`player_idle${this.idleFrameIndex + 1}`);
      }
      return;
    }

    const dx = this.targetPctX - this.pctX;
    const dy = this.targetPctY - this.pctY;
    const dist = Math.hypot(dx, dy);

    // Arrived?
    if (dist < 0.3) {
      this.pctX = this.targetPctX;
      this.pctY = this.targetPctY;
      this.targetPctX = null;
      this.targetPctY = null;
      this.setTexture('player_idle1');
      this.syncScreenPosition();
      this.scene.events.emit('player:arrived');
      return;
    }

    // Walk animation (sprite direction is mirrored from movement direction)
    const direction = dx > 0 ? 'left' : 'right';
    this.walkTimer += delta;
    if (this.walkTimer >= WALK_FRAME_MS) {
      this.walkTimer = 0;
      this.walkFrameIndex = (this.walkFrameIndex + 1) % 3;
      this.setTexture(`player_walk_${direction}_${this.walkFrameIndex}`);
    }

    // Move in % space
    const step = Math.min(1, (this.pctSpeed * delta / 1000) / dist);
    const nextX = this.pctX + dx * step;
    const nextY = this.pctY + dy * step;

    // Check walkability
    if (this.isWalkablePct(nextX, nextY)) {
      this.pctX = nextX;
      this.pctY = nextY;
    } else if (this.isWalkablePct(nextX, this.pctY)) {
      this.pctX = nextX;
    } else if (this.isWalkablePct(this.pctX, nextY)) {
      this.pctY = nextY;
    } else {
      // Can't move in any direction — stop and notify arrival (so pending actions fire)
      this.targetPctX = null;
      this.targetPctY = null;
      this.setTexture('player_idle1');
      this.scene.events.emit('player:arrived');
    }

    this.syncScreenPosition();
  }

  private syncScreenPosition(): void {
    const screen = this.coordSystem.pctToScreen(this.pctX, this.pctY);
    this.setPosition(screen.x, screen.y);
  }

  private isWalkablePct(px: number, py: number): boolean {
    for (const a of this.walkableAreas) {
      if (px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return true;
    }
    return this.walkableAreas.length === 0; // If no areas defined, allow everywhere
  }

  /** Check if a target point (or its nearest walkable clamp) is reachable — i.e. within a walkable area. */
  canReachPct(px: number, py: number): boolean {
    return this.isWalkablePct(px, py) || this.walkableAreas.length === 0;
  }

  private clampToWalkable(px: number, py: number): { x: number; y: number } {
    if (this.isWalkablePct(px, py)) return { x: px, y: py };
    if (this.walkableAreas.length === 0) return { x: px, y: py };

    let bestX = px, bestY = py, bestDist = Infinity;
    for (const a of this.walkableAreas) {
      const cx = Phaser.Math.Clamp(px, a.x, a.x + a.w);
      const cy = Phaser.Math.Clamp(py, a.y, a.y + a.h);
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestDist) { bestDist = d; bestX = cx; bestY = cy; }
    }
    return { x: bestX, y: bestY };
  }
}

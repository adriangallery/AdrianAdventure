import Phaser from 'phaser';
import type { SceneData } from '@/types/scene.types';
import type { CoordSystem } from '@/systems/CoordSystem';
import { NavGrid, type Point } from '@/systems/Pathfinding';

const WALK_FRAME_MS = 180;
const IDLE_FRAME_MS = 400;
/**
 * A2.1: tramo máximo (en %) entre dos comprobaciones de triggers. Un frame largo se parte en tramos de este tamaño
 * y tras cada uno se llama a `onStep`; es menor que el trigger más estrecho (1,6 % en mountain), así que el
 * personaje nunca se salta un trigger, vaya a la velocidad que vaya.
 */
const MAX_SUBSTEP_PCT = 0.5;

/**
 * Player character.
 * Position stored in PERCENTAGE coordinates (0-100).
 * Screen position derived from CoordSystem each frame.
 */
export class Player extends Phaser.GameObjects.Sprite {
  private coordSystem: CoordSystem;
  /** A2.1: rejilla de navegación (walkableAreas menos blockedAreas) */
  private nav: NavGrid;
  /** Puntos de paso que quedan después del objetivo actual */
  private waypoints: Point[] = [];
  /** Última ruta calculada: origen, puntos de paso y destino (para la API de QA) */
  private lastPath: Point[] | null = null;

  /**
   * A2.1: se llama tras cada tramo de movimiento (≤ MAX_SUBSTEP_PCT). GameScene comprueba ahí los triggers; si
   * devuelve true (saltó uno y paró al personaje), se deja de mover en este frame.
   */
  onStep: (() => boolean) | null = null;

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

  /** Sprite prefix — 'player' by default, 'ape' when costume worn */
  private spritePrefix = 'player';

  constructor(scene: Phaser.Scene, coordSystem: CoordSystem, spawnPctX: number, spawnPctY: number, sceneData: SceneData) {
    const screen = coordSystem.pctToScreen(spawnPctX, spawnPctY);
    super(scene, screen.x, screen.y, 'player_idle1');

    this.coordSystem = coordSystem;
    this.pctX = spawnPctX;
    this.pctY = spawnPctY;
    this.nav = new NavGrid(sceneData.walkableAreas, sceneData.blockedAreas);

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

  /**
   * Walk to a target in % coords. A2.1: ruta A* por las zonas caminables; si el destino no se pisa o está en otra
   * isla, va al punto alcanzable más cercano. La firma no cambia (TrailerScene la usa).
   */
  walkToPct(pctX: number, pctY: number): void {
    const start = { x: this.pctX, y: this.pctY };
    const route = this.nav.findPath(start, { x: pctX, y: pctY });
    this.lastPath = [start, ...route.points];
    // Sin puntos (ya está en el destino) se «llega» en el siguiente frame, como antes: el verbo pendiente se ejecuta
    const [first, ...rest] = route.points.length ? route.points : [route.goal];
    this.waypoints = rest;
    this.targetPctX = first.x;
    this.targetPctY = first.y;
  }

  halt(): void {
    this.targetPctX = null;
    this.targetPctY = null;
    this.waypoints = [];
    this.setTexture(`${this.spritePrefix}_idle1`);
  }

  /** Change player costume. Pass 'ape' for ape costume, 'player' to revert. */
  setCostume(prefix: string): void {
    this.spritePrefix = prefix;
    this.setTexture(`${prefix}_idle1`);
  }

  getCostume(): string {
    return this.spritePrefix;
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
    // Check costume flag from gameState each frame (driven by ScummUI toggle)
    const state = this.scene.registry.get('gameState') as { flags?: Record<string, boolean> } | undefined;
    const wantApe = state?.flags?.['ape_costume_worn'] ?? false;
    const wantPrefix = wantApe ? 'ape' : 'player';
    if (wantPrefix !== this.spritePrefix) {
      this.spritePrefix = wantPrefix;
      // Reset ALL animation counters to avoid freeze on costume swap
      this.idleTimer = IDLE_FRAME_MS;
      this.walkFrameIndex = 0;
      this.walkTimer = 0;
      this.idleFrameIndex = 0;
    }

    if (this.targetPctX === null || this.targetPctY === null) {
      // Idle animation
      this.idleTimer += delta;
      if (this.idleTimer >= IDLE_FRAME_MS) {
        this.idleTimer = 0;
        this.idleFrameIndex = (this.idleFrameIndex + 1) % 4;
        this.setTexture(`${this.spritePrefix}_idle${this.idleFrameIndex + 1}`);
      }
      return;
    }

    // Walk animation (sprite direction is mirrored from movement direction)
    const direction = this.targetPctX - this.pctX > 0 ? 'left' : 'right';
    this.walkTimer += delta;
    if (this.walkTimer >= WALK_FRAME_MS) {
      this.walkTimer = 0;
      this.walkFrameIndex = (this.walkFrameIndex + 1) % 3;
      this.setTexture(`${this.spritePrefix}_walk_${direction}_${this.walkFrameIndex}`);
    }

    // A2.1: el avance del frame se reparte en tramos cortos por los puntos de paso; tras cada tramo, onStep
    let budget = this.pctSpeed * delta / 1000;
    while (budget > 1e-9 && this.targetPctX !== null && this.targetPctY !== null) {
      const dx = this.targetPctX - this.pctX;
      const dy = this.targetPctY - this.pctY;
      const dist = Math.hypot(dx, dy);
      const next = this.waypoints[0];

      // Punto de paso intermedio alcanzado: al siguiente sin parar
      if (next && dist <= 1e-6) {
        this.waypoints.shift();
        this.targetPctX = next.x;
        this.targetPctY = next.y;
        continue;
      }
      // Arrived?
      if (!next && dist < 0.3) {
        this.arrive();
        return;
      }

      const move = Math.min(budget, MAX_SUBSTEP_PCT, dist);
      budget -= move;
      const nextX = this.pctX + (dx / dist) * move;
      const nextY = this.pctY + (dy / dist) * move;

      // Check walkability (fuera de zona —spawn mal puesto, partida vieja— se anda libre hasta volver a entrar)
      const fromX = this.pctX;
      const fromY = this.pctY;
      if (!this.isWalkablePct(this.pctX, this.pctY) || this.isWalkablePct(nextX, nextY)) {
        this.pctX = nextX;
        this.pctY = nextY;
      } else if (this.isWalkablePct(nextX, this.pctY)) {
        this.pctX = nextX;
      } else if (this.isWalkablePct(this.pctX, nextY)) {
        this.pctY = nextY;
      }
      // Atascado (no avanza o solo se arrastra en el sitio): salta al siguiente punto de paso o, si era el último,
      // se para y avisa de la llegada (so pending actions fire)
      if (Math.hypot(this.pctX - fromX, this.pctY - fromY) < move * 0.1) {
        const skip = this.waypoints.shift();
        if (skip) {
          this.targetPctX = skip.x;
          this.targetPctY = skip.y;
          continue;
        }
        this.targetPctX = null;
        this.targetPctY = null;
        this.setTexture(`${this.spritePrefix}_idle1`);
        this.syncScreenPosition();
        this.scene.events.emit('player:arrived');
        return;
      }
      if (this.onStep?.()) break;
    }

    this.syncScreenPosition();
  }

  private arrive(): void {
    this.pctX = this.targetPctX ?? this.pctX;
    this.pctY = this.targetPctY ?? this.pctY;
    this.targetPctX = null;
    this.targetPctY = null;
    this.waypoints = [];
    this.setTexture(`${this.spritePrefix}_idle1`);
    this.syncScreenPosition();
    this.scene.events.emit('player:arrived');
  }

  private syncScreenPosition(): void {
    const screen = this.coordSystem.pctToScreen(this.pctX, this.pctY);
    this.setPosition(screen.x, screen.y);
  }

  /** ¿Se puede pisar el punto? (walkableAreas menos blockedAreas; sin áreas, sí) */
  isWalkablePct(px: number, py: number): boolean {
    return this.nav.isWalkable(px, py);
  }

  /**
   * ¿Se puede ir andando hasta el punto? Tiene que ser caminable y estar en la misma zona conexa que el personaje.
   * Si no, GameScene ejecuta el verbo sin andar.
   */
  canReachPct(px: number, py: number): boolean {
    return this.nav.canReach({ x: this.pctX, y: this.pctY }, { x: px, y: py });
  }

  /** A2.1: última ruta calculada (origen, puntos de paso y destino), para la API de QA y la demo */
  getLastPath(): Point[] | null {
    return this.lastPath ? this.lastPath.map((p) => ({ ...p })) : null;
  }
}

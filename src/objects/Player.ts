import Phaser from 'phaser';
import type { SceneData } from '@/types/scene.types';
import type { CoordSystem } from '@/systems/CoordSystem';
import { NavGrid, type Point } from '@/systems/Pathfinding';
import type { Facing } from '@/systems/Facing';
import { resolvePixelScale, spriteScale, artHeightPct, type DepthScale, type PixelGlobalConfig } from '@/systems/PixelScale';
import { FootstepTracker } from '@/systems/Footsteps';
import { actorDepth, sceneObstacles, speedMultiplier, stepToward, walkSpeedWorldPx } from '@/systems/WalkMotion';
import {
  DEX_ART_HEIGHT, IdleTicker, QA_IDLE_SEED, facingForDir, facingTexture, gesturePose, idleTicPose, isVertical, moveDir, talkPose, walkPose,
  type AnimDir, type AnimPose, type Gesture3d, type IdleTic, type IdleTicKind, type Side,
} from '@/systems/PlayerAnim';

const IDLE_FRAME_MS = 400;

/** A4.1: estado de la animación para la API de QA (`state().anim`) */
export interface PlayerAnimQa {
  /** Textura que se ve ahora */
  texture: string;
  moving: boolean;
  /** Dirección del último tramo andado (left | right | up | down; se queda al parar); null si aún no ha andado */
  dir: AnimDir | null;
  /** Andando (o lo último que anduvo) en vertical: Front-* / Back-* con balanceo */
  vertical: boolean;
  /** Cabeceo de hablar en marcha (texto del jugador en pantalla y quieto) */
  talking: boolean;
  /** Gesto de coger/usar en marcha */
  gesture: boolean;
  /** Tic de reposo en curso (null si ninguno) y cuántos van en la escena */
  idleTick: IdleTicKind | null;
  idleTicks: number;
  /** Juego de sprites: player | ape; `preview` = el de __qa.previewCostume (null si no hay) */
  costume: string;
  preview: string | null;
  /** Giro (grados) y elevación (píxeles de pantalla) del tween; 0 y 0 en reposo */
  angle: number;
  liftPx: number;
  /** Escala aplicada (scaleY), la que pide A2.8 y si coinciden: `rest` = sin tween y con la escala base */
  scale: number;
  baseScale: number;
  rest: boolean;
}
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

  /**
   * A4.4: pasos. Cuenta la distancia andada en píxeles de arte (world px / unidad de píxel, con la profundidad) y
   * avisa de cada paso con `player:footstep` ({ x, y, foot }); GameScene elige la superficie y lo hace sonar.
   */
  private footsteps = new FootstepTracker();

  /** A2.8: unidad de píxel de la escena (píxeles de fondo por píxel de arte) y escala por profundidad */
  private pixelScale: number;
  private depthScale: DepthScale | null;
  /** A2.8: última escala calculada (para la API de QA) */
  private lastScale = { scale: 1, base: 1, snapped: false, depth: 1 };

  /** Current position in % coords */
  pctX: number;
  pctY: number;

  /** Movement target in % coords (null = not moving) */
  private targetPctX: number | null = null;
  private targetPctY: number | null = null;

  /** A2.12: multiplicador de `player.speed` de la escena (avance y reloj de la animación; ver WalkMotion) */
  private speedMul: number;
  private rawSpeed: number;
  /** A2.12: orden de dibujado por la y de los pies (false si la escena fija `player.playerDepth`) */
  private ySort = true;

  private idleFrameIndex = 0;
  private idleTimer = 0;

  /** Sprite prefix — 'player' by default, 'ape' when costume worn */
  private spritePrefix = 'player';
  /** A4.1 (QA): juego de sprites forzado por __qa.previewCostume (solo los sprites: ni inventario ni flags) */
  private costumePreview: string | null = null;

  // A4.1: animación (src/systems/PlayerAnim.ts decide; aquí solo se aplica)
  /** Dirección del tramo actual (con histéresis); null parado */
  private walkDir: AnimDir | null = null;
  /** Dirección del último tramo andado (QA) */
  private lastDir: AnimDir | null = null;
  /** Tiempo andando (elige fotograma y balanceo) */
  private walkClock = 0;
  /** Lo dice GameScene cada frame: el jugador tiene texto en pantalla / la escena está libre para un tic */
  private talkWanted = false;
  private idleFree = false;
  private talkClock = 0;
  private gestureAnim: { t: number; aim: Side | null; anim?: Gesture3d } | null = null;
  private idleTicker: IdleTicker;
  private ticActive = false;
  /** pose(key) de una cinemática: hablar solo cabecea, sin cambiar la textura, y no hay tics */
  private posed = false;
  /** Giro y elevación del tween ahora mismo (0 y 0 en reposo) */
  private animAngle = 0;
  private animLiftPx = 0;

  /**
   * A2.2: hacia dónde mira. 'front' = idle animado (Idle-1..4); el resto, un sprite quieto (ver facingTexture).
   * Al andar pasa a 'left'/'right' según hacia dónde va y así se queda al llegar; GameScene lo gira con face().
   */
  private facing: Facing = 'front';
  /** Último lado hacia el que miró de perfil (elige la variante de espaldas: girado a un lado u otro) */
  private lastSide: 'left' | 'right' = 'right';
  /** Textura quieta de la orientación actual; null = idle animado */
  private staticKey: string | null = null;

  constructor(scene: Phaser.Scene, coordSystem: CoordSystem, spawnPctX: number, spawnPctY: number, sceneData: SceneData) {
    const screen = coordSystem.pctToScreen(spawnPctX, spawnPctY);
    super(scene, screen.x, screen.y, 'player_idle1');

    this.coordSystem = coordSystem;
    this.pctX = spawnPctX;
    this.pctY = spawnPctY;
    // A2.12: las NPC que están sobre el suelo también son obstáculo (su huella; ver WalkMotion.sceneObstacles)
    this.nav = new NavGrid(sceneData.walkableAreas, sceneObstacles(sceneData.walkableAreas, sceneData.blockedAreas, sceneData.npcs));

    // A2.8: unidad de píxel de la escena (pixelScale; si no, el playerScale antiguo, el global o el de por defecto)
    const globalConfig = scene.cache.json.get('globalConfig') as PixelGlobalConfig | undefined;
    this.pixelScale = resolvePixelScale(sceneData, globalConfig);
    this.depthScale = sceneData.depthScale ?? null;

    // A2.12: velocidad en píxeles de arte por segundo (escala con Dex; ver WalkMotion); `player.speed` la multiplica
    this.rawSpeed = sceneData.player.speed ?? 140;
    this.speedMul = speedMultiplier(this.rawSpeed);

    // A4.1: tics de reposo deterministas con ?qa=1 (demos y rutas repetibles); si no, al azar
    const qa = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('qa') === '1';
    this.idleTicker = new IdleTicker(qa ? QA_IDLE_SEED : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);

    // bottom-center (feet = position); A2.14: en los fotogramas 3D los pies están en la fila DEX_ART_HEIGHT
    this.setOrigin(0.5, (this.frame?.realHeight ?? 0) > DEX_ART_HEIGHT ? DEX_ART_HEIGHT / this.frame.realHeight : 1);
    this.applyPixelScale();
    this.setDepth(actorDepth(spawnPctY, true));

    scene.add.existing(this);
  }

  /**
   * Walk to a target in % coords. A2.1: ruta A* por las zonas caminables; si el destino no se pisa o está en otra
   * isla, va al punto alcanzable más cercano. La firma no cambia (TrailerScene la usa).
   */
  walkToPct(pctX: number, pctY: number): void {
    this.endGesture();
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
    this.walkDir = null;
    this.footsteps.reset();
    this.endGesture();
    this.applyFacing();
  }

  /**
   * A2.2: girarse. Sprites (las claves de perfil están espejadas, como las de andar: `player_left` = Left.png, que
   * mira a la DERECHA de la pantalla):
   *  - right → player_left (Left.png) · left → player_right (Right.png)
   *  - back  → player_back_left (Back-Left.png, de espaldas girado a la derecha) o player_back_right (Back-Right.png,
   *            girado a la izquierda), según el último lado al que miró
   *  - front → idle animado (Idle-1..4, de frente)
   * Disfraz de mono: solo hay idle y andar; de perfil usa el primer fotograma de andar y de espaldas, el idle.
   * Si está andando no hace nada (al llegar ya se gira GameScene).
   */
  face(dir: Facing): void {
    if (this.isMoving()) return;
    this.setFacing(dir);
    this.applyFacing();
  }

  getFacing(): Facing {
    return this.facing;
  }

  private setFacing(dir: Facing): void {
    this.facing = dir;
    if (dir === 'left' || dir === 'right') this.lastSide = dir;
  }

  /** ¿Existe la textura? (para PlayerAnim: el tráiler no carga todas y el mono no tiene Front/Back) */
  private has = (key: string): boolean => this.scene.textures.exists(key);

  /** Textura quieta para la orientación actual con el disfraz actual, o null si toca el idle animado. */
  private facingTexture(): string | null {
    return facingTexture(this.spritePrefix, this.facing, this.lastSide, this.has);
  }

  /**
   * Pone la textura de la orientación actual (quieta, o el primer fotograma del idle si mira de frente). A4.1: y quita
   * cualquier tween (ángulo 0, sin elevación, escala base de A2.8) y el tic de reposo en curso.
   */
  private applyFacing(): void {
    this.staticKey = this.facingTexture();
    this.posed = false;
    this.idleTimer = 0;
    this.idleFrameIndex = 0;
    this.idleTicker.reset();
    this.ticActive = false;
    this.setTexture(this.staticKey ?? `${this.spritePrefix}_idle1`);
    this.clearAnimTransform();
  }

  /**
   * A4.1: vuelve a la pose de reposo sin cambiar la orientación ni reiniciar el idle: textura de la orientación (o el
   * fotograma de idle en el que iba), ángulo 0, sin elevación y la escala base de A2.8 (el tween nunca la toca).
   */
  private restoreRest(): void {
    this.ticActive = false;
    this.setTextureIfNeeded(this.staticKey ?? `${this.spritePrefix}_idle${this.idleFrameIndex + 1}`);
    this.clearAnimTransform();
  }

  private clearAnimTransform(): void {
    const moved = this.animLiftPx !== 0;
    this.animAngle = 0;
    this.animLiftPx = 0;
    if (this.angle !== 0) this.setAngle(0);
    if (moved) this.syncScreenPosition();
    this.applyPixelScale();
  }

  /**
   * A2.14: los fotogramas 3D miden 108 de alto con los pies en la fila 103 (5 filas debajo para el pie adelantado al
   * andar hacia cámara): el origen se pone en los pies para cualquier textura más alta que DEX_ART_HEIGHT, así el
   * punto de los pies y el alto de Dex quedan como siempre (A2.11).
   */
  setTexture(key: string | Phaser.Textures.Texture, frame?: string | number): this {
    super.setTexture(key, frame);
    const h = this.frame?.realHeight ?? 0;
    this.setOrigin(0.5, h > DEX_ART_HEIGHT ? DEX_ART_HEIGHT / h : 1);
    return this;
  }

  private setTextureIfNeeded(key: string): void {
    if (this.texture?.key !== key && this.has(key)) this.setTexture(key);
  }

  /**
   * A4.1: aplica una pose de PlayerAnim: textura (null = la de la orientación o el fotograma de idle en curso), giro
   * sobre los pies y elevación en píxeles de arte (redondeada a píxeles de pantalla enteros con la escala aplicada).
   */
  private applyPose(pose: AnimPose, fallback: string | null): void {
    const tex = pose.texture ?? fallback;
    if (tex) this.setTextureIfNeeded(tex);
    if (this.animAngle !== pose.angle) {
      this.animAngle = pose.angle;
      this.setAngle(pose.angle);
    }
    const lift = Math.round(pose.lift * this.scaleY);
    if (lift !== this.animLiftPx) {
      this.animLiftPx = lift;
      this.syncScreenPosition();
    }
  }

  /** Change player costume. Pass 'ape' for ape costume, 'player' to revert. */
  setCostume(prefix: string): void {
    this.spritePrefix = prefix;
    if (!this.isMoving()) this.applyFacing();
  }

  /**
   * A4.1 (QA, `__qa.previewCostume`): fuerza el juego de sprites ('ape' | 'player') o lo suelta (null: vuelve a mandar
   * la flag `ape_costume_worn`). Solo cambia los sprites de esta escena; ni inventario ni flags.
   */
  setCostumePreview(prefix: string | null): void {
    this.costumePreview = prefix;
  }

  /**
   * A4.1: lo que GameScene sabe y Player no: si el jugador tiene texto en pantalla (cabecea mientras dure) y si la
   * escena está libre para un tic de reposo (sin script, texto, diálogo, cinemática ni diario).
   */
  setAnimContext(ctx: { talking: boolean; idleFree: boolean }): void {
    this.talkWanted = ctx.talking;
    this.idleFree = ctx.idleFree;
  }

  /**
   * A4.1: gesto breve de alcanzar o coger (PlayerAnim.GESTURE_MS) al actuar sobre un hotspot; `aim` = lado de la
   * pantalla en el que está el objetivo. Va a la vez que el script: no lo retrasa. Andando no hace nada.
   */
  gesture(aim: Side | null, anim?: Gesture3d): void {
    if (this.isMoving() || !this.visible) return;
    this.gestureAnim = { t: 0, aim, anim };
    this.idleTicker.reset();
    this.ticActive = false;
  }

  isGesturing(): boolean {
    return this.gestureAnim !== null;
  }

  private endGesture(): void {
    if (!this.gestureAnim) return;
    this.gestureAnim = null;
    this.restoreRest();
  }

  /** A4.1 (QA): ver PlayerAnimQa */
  getAnimState(): PlayerAnimQa {
    const tic: IdleTic | null = this.ticActive ? this.idleTicker.current() : null;
    const moving = this.isMoving();
    return {
      texture: this.texture?.key ?? '',
      moving,
      dir: moving ? this.walkDir : this.lastDir,
      vertical: isVertical(moving ? this.walkDir : this.lastDir),
      talking: !moving && this.talkClock > 0,
      gesture: this.gestureAnim !== null,
      idleTick: tic?.kind ?? null,
      idleTicks: this.idleTicker.count,
      costume: this.spritePrefix,
      preview: this.costumePreview,
      angle: Math.round(this.angle * 100) / 100,
      liftPx: this.animLiftPx,
      scale: this.scaleY,
      baseScale: this.lastScale.scale,
      rest: this.angle === 0 && this.animLiftPx === 0 && this.scaleX === this.lastScale.scale && this.scaleY === this.lastScale.scale,
    };
  }

  /** A4.1: y de los pies en pantalla sin la elevación del gesto (el texto sobre la cabeza no salta con el tween) */
  getFootY(): number {
    return this.y + this.animLiftPx;
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
    this.setPosition(screen.x, screen.y - this.animLiftPx);
    this.applyPixelScale();
  }

  /**
   * A2.8: escala = unidad de píxel × escala del fondo, redondeada a un entero de pantalla cuando se puede, × el factor
   * de profundidad en la y de los pies (src/systems/PixelScale.ts). Los pies no se mueven: el origen está en ellos.
   */
  private applyPixelScale(): void {
    this.lastScale = spriteScale({
      pixelScale: this.pixelScale, coordScale: this.coordSystem.getScale(), depth: this.depthScale, yPct: this.pctY,
    });
    if (this.scaleX !== this.lastScale.scale || this.scaleY !== this.lastScale.scale) this.setScale(this.lastScale.scale);
  }

  /** A2.8: unidad de píxel de la escena */
  getPixelScale(): number {
    return this.pixelScale;
  }

  /** A2.8: escala por profundidad de la escena (null si no tiene) */
  getDepthScale(): DepthScale | null {
    return this.depthScale;
  }

  /** A2.8: escala aplicada (píxeles de pantalla por píxel de arte), base redondeada, si es entera y factor de profundidad */
  getScaleInfo(): { scale: number; base: number; snapped: boolean; depth: number } {
    return { ...this.lastScale };
  }

  /**
   * A2.8: altura del personaje en % del alto del fondo según el mundo (unidad de píxel × profundidad, sin el redondeo
   * de pantalla), para Facing: girarse no depende del tamaño de la ventana. 103 = alto de la hoja de idle.
   */
  getWorldHeightPct(): number {
    return artHeightPct(Math.min(this.frame?.realHeight || DEX_ART_HEIGHT, DEX_ART_HEIGHT), this.pixelScale, this.coordSystem.imgH, this.lastScale.depth);
  }

  update(_time: number, delta: number): void {
    // Check costume flag from gameState each frame (driven by ScummUI toggle)
    const state = this.scene.registry.get('gameState') as { flags?: Record<string, boolean> } | undefined;
    const wantApe = state?.flags?.['ape_costume_worn'] ?? false;
    const wantPrefix = this.costumePreview ?? (wantApe ? 'ape' : 'player');
    if (wantPrefix !== this.spritePrefix) {
      this.spritePrefix = wantPrefix;
      // Reset ALL animation counters to avoid freeze on costume swap
      this.idleTimer = IDLE_FRAME_MS;
      this.walkClock = 0;
      this.idleFrameIndex = 0;
      if (this.targetPctX === null) this.applyFacing();
    }

    if (this.targetPctX === null || this.targetPctY === null) {
      this.updateStill(delta);
      return;
    }

    // A4.1: andar. Dirección del tramo en píxeles de mundo (con histéresis entre perfil y vertical): de perfil los 3
    // fotogramas de siempre; arriba/abajo Back-*/Front-* alternando como paso, con balanceo (PlayerAnim.walkPose)
    const dxPx = ((this.targetPctX - this.pctX) / 100) * this.coordSystem.imgW;
    const dyPx = ((this.targetPctY - this.pctY) / 100) * this.coordSystem.imgH;
    // Ya en el destino (llega en este mismo frame): no se gira ni cambia de fotograma
    if (Math.abs(dxPx) > 1e-6 || Math.abs(dyPx) > 1e-6) {
      const dir = moveDir(dxPx, dyPx, this.walkDir);
      if (this.walkDir === null) {
        this.walkClock = 0;
        this.talkClock = 0;
        this.ticActive = false;
        this.idleTicker.reset();
      }
      this.walkDir = dir;
      this.lastDir = dir;
      // A2.2: mira hacia donde anda; A4.1: de espaldas al subir y de frente al bajar (y así se queda al llegar)
      this.setFacing(facingForDir(dir));
      // A2.12: la animación va al mismo ritmo que el avance (zancada fija en píxeles de arte)
      this.walkClock += delta * this.speedMul;
      this.applyPose(walkPose({ prefix: this.spritePrefix, dir, side: this.lastSide, tMs: this.walkClock, has: this.has }), null);
    }

    // A2.1: el avance del frame se reparte en tramos cortos por los puntos de paso; tras cada tramo, onStep
    // A2.12: presupuesto en píxeles de mundo, igual en cualquier dirección y proporcional al tamaño de Dex
    let budget = walkSpeedWorldPx(this.pixelScale, this.lastScale.depth, this.rawSpeed) * delta / 1000;
    const { imgW, imgH } = this.coordSystem;
    while (budget > 1e-6 && this.targetPctX !== null && this.targetPctY !== null) {
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

      const { movePct: move, usedPx } = stepToward(dx, dy, budget, imgW, imgH, MAX_SUBSTEP_PCT);
      if (move <= 0) break;
      budget -= usedPx;
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
      const movedPct = Math.hypot(this.pctX - fromX, this.pctY - fromY);
      // A4.4: distancia en píxeles de arte (un píxel de arte mide pixelScale × profundidad píxeles de mundo)
      if (movedPct > 0) {
        const movedPx = Math.hypot(((this.pctX - fromX) / 100) * this.coordSystem.imgW, ((this.pctY - fromY) / 100) * this.coordSystem.imgH);
        const foot = this.footsteps.advance(movedPx / (this.pixelScale * Math.max(0.2, this.lastScale.depth)));
        if (foot !== null) this.scene.events.emit('player:footstep', { x: this.pctX, y: this.pctY, foot, depth: this.lastScale.depth });
      }
      // Atascado (no avanza o solo se arrastra en el sitio): salta al siguiente punto de paso o, si era el último,
      // se para y avisa de la llegada (so pending actions fire)
      if (movedPct < move * 0.1) {
        const skip = this.waypoints.shift();
        if (skip) {
          this.targetPctX = skip.x;
          this.targetPctY = skip.y;
          continue;
        }
        this.targetPctX = null;
        this.targetPctY = null;
        this.walkDir = null;
        this.footsteps.reset();
        this.applyFacing();
        this.syncScreenPosition();
        this.scene.events.emit('player:arrived');
        return;
      }
      if (this.onStep?.()) break;
    }

    this.syncScreenPosition();
  }

  /** A4.4 (QA): pasos dados en esta escena */
  getFootstepCount(): number {
    return this.footsteps.count();
  }

  private arrive(): void {
    this.pctX = this.targetPctX ?? this.pctX;
    this.pctY = this.targetPctY ?? this.pctY;
    this.targetPctX = null;
    this.targetPctY = null;
    this.waypoints = [];
    this.walkDir = null;
    this.footsteps.reset();
    this.applyFacing();
    this.syncScreenPosition();
    this.scene.events.emit('player:arrived');
  }

  /**
   * A4.1: quieto. Por orden: gesto de coger/usar, cabeceo de hablar (texto del jugador en pantalla), tic de reposo y,
   * si no, lo de siempre (idle animado de frente; de perfil o de espaldas, quieto). Al acabar cada uno vuelve a la
   * pose de reposo (ángulo 0, sin elevación, escala base).
   */
  private updateStill(delta: number): void {
    const fallback = () => this.staticKey ?? `${this.spritePrefix}_idle${this.idleFrameIndex + 1}`;
    if (this.gestureAnim) {
      this.gestureAnim.t += delta;
      const pose = gesturePose({
        prefix: this.spritePrefix, facing: this.facing, side: this.lastSide, aim: this.gestureAnim.aim, tMs: this.gestureAnim.t, has: this.has, anim: this.gestureAnim.anim,
      });
      if (pose) {
        this.applyPose(pose, fallback());
        return;
      }
      this.gestureAnim = null;
      this.restoreRest();
    }

    if (this.talkWanted && this.visible) {
      this.talkClock += delta;
      this.idleTicker.reset();
      this.ticActive = false;
      this.applyPose(talkPose({ prefix: this.spritePrefix, facing: this.facing, tMs: this.talkClock, has: this.has, posed: this.posed }), fallback());
      return;
    }
    if (this.talkClock > 0) {
      this.talkClock = 0;
      this.restoreRest();
    }

    const tick = this.idleTicker.update(delta, this.idleFree && this.visible && !this.posed, this.facing, this.lastSide);
    if (tick) {
      this.ticActive = true;
      this.applyPose(idleTicPose(tick.tic, tick.t, { prefix: this.spritePrefix, has: this.has }), fallback());
      return;
    }
    if (this.ticActive) this.restoreRest();

    // A2.2: mirando a un lado o de espaldas se queda quieto; el idle animado es de frente
    if (this.staticKey) return;
    this.idleTimer += delta;
    if (this.idleTimer >= IDLE_FRAME_MS) {
      this.idleTimer = 0;
      this.idleFrameIndex = (this.idleFrameIndex + 1) % 4;
      this.setTexture(`${this.spritePrefix}_idle${this.idleFrameIndex + 1}`);
    }
  }

  /**
   * A2.12: velocidad de andar en % del alto del fondo por segundo en el punto más lento de la escena (donde Dex es más
   * pequeño), para que CinematicDirector calcule un tiempo máximo de actorMove que no se quede corto.
   */
  slowestSpeedPct(): number {
    const d = this.depthScale ? Math.min(this.depthScale.scaleTop, this.depthScale.scaleBottom) : 1;
    return (walkSpeedWorldPx(this.pixelScale, d, this.rawSpeed) / this.coordSystem.imgH) * 100;
  }

  /** A2.12: la escena fija la profundidad del jugador (`player.playerDepth`): sin orden por y */
  setFixedDepth(depth: number): void {
    this.ySort = false;
    this.setDepth(depth);
  }

  private syncScreenPosition(): void {
    const screen = this.coordSystem.pctToScreen(this.pctX, this.pctY);
    // A2.12: delante o detrás de las NPC según la y de los pies
    if (this.ySort) this.setDepth(actorDepth(this.pctY, true));
    // A4.1: de puntillas en el gesto (píxeles de pantalla enteros; 0 en reposo)
    this.setPosition(screen.x, screen.y - this.animLiftPx);
    // A2.8: con depthScale la escala cambia con la y de los pies
    if (this.depthScale) this.applyPixelScale();
  }

  /** A2.10 (actorTeleport y el salto de actorMove): coloca al personaje en un punto (en %) sin andar. */
  teleportPct(pctX: number, pctY: number): void {
    this.halt();
    this.pctX = pctX;
    this.pctY = pctY;
    this.syncScreenPosition();
  }

  /**
   * A2.10 (actorAnim): deja al personaje en una textura quieta que ya exista (`key`) hasta que ande o se gire;
   * `walk` = primer fotograma de andar hacia donde mira; null = la de su orientación (idle animado de frente).
   * Devuelve false si la textura no existe.
   */
  pose(key: string | null): boolean {
    if (key === null) {
      this.applyFacing();
      return true;
    }
    const tex = key === 'walk' ? `${this.spritePrefix}_walk_${this.lastSide === 'right' ? 'left' : 'right'}_0` : key;
    if (!this.scene.textures.exists(tex)) return false;
    this.endGesture();
    this.clearAnimTransform();
    this.staticKey = tex;
    this.posed = true;
    this.ticActive = false;
    this.idleTicker.reset();
    this.setTexture(tex);
    return true;
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

  /**
   * A2.2: punto alcanzable más cercano a `p` desde donde está el personaje, o null si `p` está en otra isla de la
   * zona caminable (ver NavGrid.approach). Es la `Reach` de Facing.
   */
  approachPct(p: Point): Point | null {
    return this.nav.approach({ x: this.pctX, y: this.pctY }, p);
  }

  /** A2.1: última ruta calculada (origen, puntos de paso y destino), para la API de QA y la demo */
  getLastPath(): Point[] | null {
    return this.lastPath ? this.lastPath.map((p) => ({ ...p })) : null;
  }
}

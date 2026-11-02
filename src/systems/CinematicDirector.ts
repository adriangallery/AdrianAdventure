import Phaser from 'phaser';
import type { ScriptOp } from '@/types/scene.types';
import { FONT } from '@/config/theme';
import type { Player } from '@/objects/Player';
import { facingForDir, moveDir } from './PlayerAnim';
import type { NPC } from '@/objects/NPC';
import type { CoordSystem } from './CoordSystem';
import type { MusicManager } from './MusicManager';
import type { CinemaHooks } from './ScriptEngine';
import {
  CAMERA_MS, CINEMATIC_OPS, IRIS_MS, LETTERBOX_MS, WIPE_MS,
  cameraFocusOf, cameraScrollFor, clampZoom, durationOf, easeName, irisMaxRadius, irisQuads, irisRadiusAt, isActorFacing,
  isPoint, letterboxAt, letterboxBars, lerpPoint, parseTransition, skipActionFor, slideDurationMs, wipeRect, worldToScreen,
  type CameraView, type Point, type Rect, type TransitionMode, type TransitionSpec, type WipeDir,
} from './Cinematics';

/** Lo que el director necesita de UIScene (franjas, iris y el texto hablado se pintan ahí: sin el zoom de la cámara). */
export interface CinematicUi extends Phaser.Scene {
  setCinematicChrome(hidden: boolean, keep?: Phaser.GameObjects.GameObject[]): void;
  isChromeHidden(): boolean;
  skipSpeech(): void;
}

/** Lo que el director necesita de GameScene. */
export interface CinematicHost {
  scene: Phaser.Scene;
  player: () => Player | undefined;
  npcs: () => NPC[];
  coords: () => CoordSystem;
  panelHeight: () => number;
  /** Vuelve a poner la cámara como la deja GameScene (`setupCamera`: seguir al jugador o fija) */
  restoreCamera: () => void;
  ui: () => CinematicUi | null;
  music: () => MusicManager | null;
  /** Velocidad andante en % del alto del fondo por segundo (la del jugador en la escena) */
  walkSpeedPct: () => number;
  /** Al entrar en cinemática: cancelar lo que el jugador tuviera a medias (toque mantenido, resaltado de Tab) */
  onBegin?: () => void;
}

/** A2.10 (QA): estado del sistema de cinemáticas (`__qa.state().cinematic`). */
export interface CinematicQaState {
  /** Modo cinemática abierto */
  active: boolean;
  /** Franjas puestas (o entrando) */
  letterbox: boolean;
  /** Interfaz de UIScene oculta */
  chromeHidden: boolean;
  /** Cámara principal: scroll, zoom y si sigue al jugador (fuera de cinemática: true, la cámara es la de siempre) */
  camera: { x: number; y: number; zoom: number; following: boolean };
  /** Transición en pantalla y si deja la pantalla tapada (iris o cortinilla cerrada) */
  transition: 'none' | 'iris' | 'wipe';
  covered: boolean;
  /** La última cinemática de la escena se saltó */
  skipped: boolean;
  /** Cinemáticas terminadas en esta escena */
  ended: number;
  /** Hay animaciones del director en marcha (franjas, cámara, actores, transición) */
  animating: boolean;
  /** La música está bajada por la cinemática */
  ducked: boolean;
}

interface Anim {
  finish: () => void;
}

type Actor = { kind: 'player'; player: Player } | { kind: 'npc'; npc: NPC };

const BARS_DEPTH = 590; // por encima del panel SCUMM (500) y de las elecciones (510), por debajo del texto (600)
const TRANSITION_DEPTH_CINEMATIC = 595; // en cinemática, el texto (600) se ve sobre la iris cerrada
const TRANSITION_DEPTH = 995; // fuera de cinemática, por encima de toda la interfaz (salvo CinematicOverlay)
const HINT_DEPTH = 597;
const FOLLOW_LERP = 0.15;

/**
 * A2.10 (plan SCUMM): director de cinemáticas de GameScene. Ejecuta los ops de cámara, transiciones y actores que le
 * pasa el ScriptEngine (`CinemaHooks`) y lleva el modo cinemática: franjas negras (letterbox) con tween, interfaz
 * oculta (y por tanto sin entrada), música bajada y, al salir, todo como estaba (cámara incluida). La lógica pura
 * (geometría, cámara, salto) está en `Cinematics.ts`.
 *
 * - Todo lo que anima va por `animate`/`waitUntil` y queda en `anims`: el salto (`finishAll`) lo termina de golpe en
 *   su estado final, y `destroy` (SHUTDOWN) lo suelta sin tocar objetos ya destruidos. Ningún op se queda colgado.
 * - Franjas, iris, cortinilla y aviso de salto se pintan en UIScene (su cámara no tiene zoom); si UIScene aún no está
 *   (la transición de entrada de una escena), la transición va en GameScene sin scroll.
 * - Una escena nueva arranca siempre limpia: el director es de la escena y UIScene se recrea en cada cambio.
 */
export class CinematicDirector {
  private readonly host: CinematicHost;
  private readonly scene: Phaser.Scene;
  private alive = true;
  private active = false;
  private anims = new Set<Anim>();
  private lastSkipped = false;
  private endedCount = 0;

  // Cámara
  private ownsCamera = false;
  private focus: Point | null = null;
  private zoom = 1;
  private following = false;

  // Franjas
  private barsG: Phaser.GameObjects.Graphics | null = null;
  private barsTarget = { top: 0, bottom: 0 };
  private barsShown = { top: 0, bottom: 0 };

  // Transición (iris / cortinilla)
  private transG: Phaser.GameObjects.Graphics | null = null;
  private trans: { type: 'iris' | 'wipe'; mode: TransitionMode; p: number; center: Point; dir: WipeDir } | null = null;

  private hint: Phaser.GameObjects.Text | null = null;

  constructor(host: CinematicHost) {
    this.host = host;
    this.scene = host.scene;
    this.scene.events.on('update', this.onUpdate, this);
    this.scene.scale.on('resize', this.onResize, this);
  }

  // ─── Puente con el ScriptEngine ────────────────────────────────────────────────────────────────────────

  hooks(): CinemaHooks {
    return {
      handles: (name) => CINEMATIC_OPS.includes(name),
      skipAction: (op) => skipActionFor(op),
      begin: () => this.begin(),
      end: (opts) => this.end(opts),
      run: (op, instant) => this.run(op, instant),
      finishAll: () => this.finishAll(),
    };
  }

  isActive(): boolean {
    return this.active;
  }

  /** La cámara es del director (GameScene no debe tocarla al redimensionar). */
  cameraOwned(): boolean {
    return this.ownsCamera;
  }

  /** `transition` de un op (`fadeToScene`), validada. */
  parseTransition(raw: unknown): TransitionSpec | null {
    return parseTransition(raw);
  }

  // ─── Modo cinemática ───────────────────────────────────────────────────────────────────────────────────

  begin(): void {
    if (this.active || !this.alive) return;
    this.finishAnimations();
    this.active = true;
    this.lastSkipped = false;
    this.host.onBegin?.();
    this.scene.registry.set('cinematicMode', true);
    this.takeCamera();
    this.following = false;

    const ui = this.host.ui();
    this.barsTarget = letterboxBars(this.scene.scale, this.host.panelHeight());
    this.scene.registry.set('cinematicBand', { ...this.barsTarget });
    if (ui) {
      this.barsG?.destroy();
      this.barsG = ui.add.graphics().setDepth(BARS_DEPTH).setScrollFactor(0);
      const keep: Phaser.GameObjects.GameObject[] = [this.barsG];
      if (this.transG) keep.push(this.transG);
      ui.setCinematicChrome(true, keep);
      if (this.transG && this.transG.scene === ui) this.transG.setDepth(TRANSITION_DEPTH_CINEMATIC);
      const target = { ...this.barsTarget };
      void this.animate(LETTERBOX_MS, 'Sine.easeOut', (p) => this.drawBars(letterboxAt(target, p)), false);
    }
    this.host.music()?.setDuck('cinematic', true);
  }

  end(opts: { instant: boolean; skipped: boolean }): void {
    if (!this.active || !this.alive) return;
    this.finishAnimations();
    this.active = false;
    this.lastSkipped = opts.skipped;
    this.endedCount++;
    const instant = opts.instant;
    this.scene.registry.set('cinematicMode', false);
    this.scene.registry.set('cinematicBand', null);
    this.host.music()?.setDuck('cinematic', false);
    this.host.ui()?.setCinematicChrome(false);
    this.hint?.destroy();
    this.hint = null;

    // Franjas fuera
    const from = { ...this.barsShown };
    this.barsTarget = { top: 0, bottom: 0 };
    const bars = this.barsG;
    void this.animate(instant ? 0 : LETTERBOX_MS, 'Sine.easeIn', (p) => { if (this.barsG === bars) this.drawBars(letterboxAt(from, 1 - p)); }, false).then(() => {
      // Si entretanto empezó otra cinemática, sus franjas son otras: estas ya las quitó begin()
      if (this.barsG !== bars) return;
      bars?.destroy();
      this.barsG = null;
    });

    // Una iris o cortinilla que dejó la pantalla tapada se abre (o se quita, si es al momento)
    if (this.trans && this.trans.mode === 'out') {
      const t = this.trans;
      if (instant) this.clearTransition();
      else void this.runTransition(t.type, 'in', t.type === 'iris' ? IRIS_MS / 2 : WIPE_MS / 2, t.center, t.dir, false);
    } else if (this.trans) {
      this.clearTransition();
    }
    if (this.transG && this.transG.scene === this.host.ui()) this.transG.setDepth(TRANSITION_DEPTH);

    // Cámara: vuelve al jugador con zoom 1 (animado) y GameScene la deja como siempre
    this.following = false;
    if (instant || !this.ownsCamera) {
      this.releaseCamera();
    } else {
      const player = this.host.player();
      const to = player ? this.actorCenter({ kind: 'player', player }) : this.currentFocus();
      void this.moveCamera(to, 1, 400, 'Sine.easeInOut', false).then(() => {
        // Una cinemática que empieza justo después se queda con la cámara (begin termina esta vuelta antes)
        if (!this.active) this.releaseCamera();
      });
    }
  }

  // ─── Ops ───────────────────────────────────────────────────────────────────────────────────────────────

  async run(op: ScriptOp, instant: boolean): Promise<void> {
    if (!this.alive) return;
    try {
      switch (op.op) {
        case 'cameraPan': return await this.cameraPan(op, instant);
        case 'cameraZoom': return await this.cameraZoom(op, instant);
        case 'cameraShake': return await this.cameraShake(op, instant);
        case 'cameraFollow': return await this.cameraFollow(op, instant);
        case 'iris':
        case 'wipe': return await this.transitionOp(op, instant);
        case 'actorMove': return await this.actorMove(op, instant);
        case 'actorFace': return this.actorFace(op);
        case 'actorAnim': return this.actorAnim(op);
        case 'actorShow':
        case 'actorHide': return await this.actorShow(op, op.op === 'actorShow', instant);
        case 'actorTeleport': return this.actorTeleport(op);
        default: return;
      }
    } catch (err) {
      console.warn(`[Cinematic] «${op.op}» falló:`, err);
    }
  }

  /** El salto: todas las animaciones a su estado final y el texto en pantalla cerrado. */
  finishAll(): void {
    this.finishAnimations();
    this.host.ui()?.skipSpeech();
  }

  /** Transición de salida de `fadeToScene`/`gotoScene` con `transition` (iris o cortinilla). */
  transitionOut(spec: TransitionSpec): Promise<void> {
    if (!this.alive || spec.type === 'fade') return Promise.resolve();
    const ms = spec.ms ?? (spec.type === 'iris' ? IRIS_MS : WIPE_MS);
    return this.runTransition(spec.type, 'out', ms, this.resolveAt(spec.at), spec.dir ?? 'left', false);
  }

  /** Transición de entrada de la escena nueva (la misma que la de salida, abriéndose). */
  transitionIn(spec: TransitionSpec): Promise<void> {
    if (!this.alive || spec.type === 'fade') return Promise.resolve();
    const ms = spec.ms ?? (spec.type === 'iris' ? IRIS_MS : WIPE_MS);
    return this.runTransition(spec.type, 'in', ms, this.resolveAt(spec.at), spec.dir ?? 'left', false);
  }

  /** Un toque durante la cinemática: aviso de cómo saltarla (mantener pulsado; con ratón, también Esc). */
  noteTap(touch: boolean): void {
    if (!this.active || !this.alive) return;
    const ui = this.host.ui();
    if (!ui) return;
    const label = touch ? 'HOLD TO SKIP' : 'ESC / HOLD TO SKIP';
    if (!this.hint || !this.hint.active) {
      const y = Math.max(6, (this.barsTarget.top - 12) / 2);
      this.hint = ui.add.text(ui.scale.width - 10, y, label, {
        fontFamily: FONT.FAMILY, fontSize: '11px', color: '#c8c0e0',
      }).setOrigin(1, 0).setDepth(HINT_DEPTH).setScrollFactor(0).setAlpha(0);
    }
    const hint = this.hint;
    hint.setText(label);
    ui.tweens.killTweensOf(hint);
    ui.tweens.add({ targets: hint, alpha: 0.9, duration: 150, hold: 1500, yoyo: true });
  }

  qaState(): CinematicQaState {
    const cam = this.scene.cameras?.main;
    return {
      active: this.active,
      letterbox: this.active && this.barsTarget.top > 0,
      chromeHidden: this.host.ui()?.isChromeHidden() ?? false,
      camera: {
        x: cam ? Math.round(cam.scrollX * 100) / 100 : 0,
        y: cam ? Math.round(cam.scrollY * 100) / 100 : 0,
        zoom: cam ? Math.round(cam.zoom * 1000) / 1000 : 1,
        following: this.active ? this.following : !this.ownsCamera,
      },
      transition: this.trans?.type ?? 'none',
      covered: !!this.trans && this.trans.mode === 'out' && this.trans.p >= 1,
      skipped: this.lastSkipped,
      ended: this.endedCount,
      animating: this.anims.size > 0,
      ducked: this.host.music()?.getDuckSources().includes('cinematic') ?? false,
    };
  }

  /** SHUTDOWN de GameScene: suelta las animaciones (sin tocar objetos ya destruidos) y los listeners. Idempotente. */
  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const a of [...this.anims]) a.finish();
    this.anims.clear();
    this.scene.events.off('update', this.onUpdate, this);
    this.scene.scale.off('resize', this.onResize, this);
    this.scene.registry.set('cinematicMode', false);
    this.scene.registry.set('cinematicBand', null);
    this.host.music()?.setDuck('cinematic', false);
    if (this.active) {
      try { this.host.ui()?.setCinematicChrome(false); } catch { /* UIScene ya cerrada */ }
    }
    this.active = false;
    for (const o of [this.barsG, this.transG, this.hint]) {
      try { if (o?.active) o.destroy(); } catch { /* ya destruido con su escena */ }
    }
    this.barsG = null;
    this.transG = null;
    this.hint = null;
    this.trans = null;
  }

  // ─── Cámara ────────────────────────────────────────────────────────────────────────────────────────────

  private cam(): Phaser.Cameras.Scene2D.Camera {
    return this.scene.cameras.main;
  }

  private view(): CameraView {
    const cam = this.cam();
    return { width: cam.width, height: cam.height, top: this.barsTarget.top, bottom: this.barsTarget.bottom };
  }

  private bounds(): Rect {
    const cs = this.host.coords();
    return { x: cs.bgX, y: cs.bgY, w: cs.bgW, h: cs.bgH };
  }

  private currentFocus(): Point {
    if (this.focus) return { ...this.focus };
    const cam = this.cam();
    return cameraFocusOf({ scrollX: cam.scrollX, scrollY: cam.scrollY }, cam.zoom, this.view());
  }

  private applyCamera(): void {
    if (!this.alive || !this.ownsCamera || !this.focus) return;
    const cam = this.cam();
    const s = cameraScrollFor(this.focus, this.zoom, this.view(), this.bounds());
    cam.setZoom(this.zoom);
    cam.setScroll(s.scrollX, s.scrollY);
  }

  /** La cámara pasa al director: deja de seguir al jugador y sin límites de Phaser (los pone `cameraScrollFor`). */
  private takeCamera(): void {
    if (this.ownsCamera) return;
    const cam = this.cam();
    this.zoom = cam.zoom || 1;
    this.focus = cameraFocusOf({ scrollX: cam.scrollX, scrollY: cam.scrollY }, this.zoom, { width: cam.width, height: cam.height });
    cam.stopFollow();
    cam.removeBounds();
    this.ownsCamera = true;
  }

  private releaseCamera(): void {
    if (!this.ownsCamera) return;
    this.ownsCamera = false;
    this.focus = null;
    this.zoom = 1;
    this.following = false;
    const cam = this.scene.cameras?.main;
    if (!this.alive || !cam) return;
    cam.setZoom(1);
    this.host.restoreCamera();
  }

  /** Mueve foco y/o zoom de la cámara (null = se queda como está). */
  private moveCamera(to: Point | null, toZoom: number | null, ms: number, ease: string, instant: boolean): Promise<void> {
    if (!this.ownsCamera) return Promise.resolve();
    const from = this.currentFocus();
    const target = to ?? from;
    const z0 = this.zoom;
    const z1 = toZoom ?? z0;
    return this.animate(ms, ease, (p) => {
      this.focus = lerpPoint(from, target, p);
      this.zoom = z0 + (z1 - z0) * p;
      this.applyCamera();
    }, instant);
  }

  /** Destino de cámara de un op: `actor` o `x`/`y` en % del fondo. */
  private cameraTarget(op: ScriptOp): Point | null {
    if (typeof op.actor === 'string') {
      const a = this.actor(op.actor);
      if (!a) {
        console.warn(`[Cinematic] ${op.op}: no hay actor «${op.actor}» en la escena`);
        return null;
      }
      return this.actorCenter(a);
    }
    if (isPoint({ x: op.x, y: op.y })) {
      return this.host.coords().pctToScreen(op.x as number, op.y as number);
    }
    return null;
  }

  private needsCinematic(op: ScriptOp): boolean {
    if (this.active && this.ownsCamera) return true;
    console.warn(`[Cinematic] «${op.op}» solo funciona dentro de una cinemática (cinematic / cinematicStart); se omite`);
    return false;
  }

  /** { op: "cameraPan", x: 24, y: 60 } o { op: "cameraPan", actor: "npc_receptionist", ms: 1200, ease: "sine" } */
  private async cameraPan(op: ScriptOp, instant: boolean): Promise<void> {
    if (!this.needsCinematic(op)) return;
    const to = this.cameraTarget(op);
    if (!to) return;
    this.following = false;
    await this.moveCamera(to, null, durationOf(op, CAMERA_MS), easeName(op.ease), instant);
  }

  /** { op: "cameraZoom", zoom: 2, ms: 800 } (opcional `actor` o `x`/`y`: acerca hacia ese punto a la vez) */
  private async cameraZoom(op: ScriptOp, instant: boolean): Promise<void> {
    if (!this.needsCinematic(op)) return;
    const z = clampZoom(op.zoom ?? op.factor, 1);
    const to = op.actor !== undefined || op.x !== undefined ? this.cameraTarget(op) : null;
    if (to) this.following = false;
    await this.moveCamera(to, z, durationOf(op, CAMERA_MS), easeName(op.ease), instant);
  }

  /** { op: "cameraShake", intensity: 0.01, ms: 300 } — vale también fuera de cinemática */
  private async cameraShake(op: ScriptOp, instant: boolean): Promise<void> {
    if (instant) return;
    const ms = durationOf(op, 300);
    const raw = typeof op.intensity === 'number' && Number.isFinite(op.intensity) ? op.intensity : 0.01;
    const intensity = Math.min(0.1, Math.max(0, raw));
    const cam = this.cam();
    cam.shake(ms, intensity);
    const end = this.scene.time.now + ms;
    await this.waitUntil(() => this.scene.time.now >= end, ms + 1000, () => {
      if (this.alive) this.cam().shakeEffect.reset();
    });
  }

  /** { op: "cameraFollow", ms: 600 } — la cámara vuelve al jugador y lo sigue (fuera de cinemática, la de siempre) */
  private async cameraFollow(op: ScriptOp, instant: boolean): Promise<void> {
    if (!this.active || !this.ownsCamera) {
      this.host.restoreCamera();
      return;
    }
    const player = this.host.player();
    if (player) await this.moveCamera(this.actorCenter({ kind: 'player', player }), op.zoom !== undefined ? clampZoom(op.zoom) : null, durationOf(op, 600), easeName(op.ease), instant);
    this.following = true;
  }

  private onUpdate(): void {
    if (!this.alive || !this.following || !this.ownsCamera || !this.active) return;
    const player = this.host.player();
    if (!player) return;
    const want = this.actorCenter({ kind: 'player', player });
    this.focus = lerpPoint(this.currentFocus(), want, FOLLOW_LERP);
    this.applyCamera();
  }

  private onResize(): void {
    if (!this.alive) return;
    if (this.active) {
      this.barsTarget = letterboxBars(this.scene.scale, this.host.panelHeight());
      this.scene.registry.set('cinematicBand', { ...this.barsTarget });
      this.drawBars(this.barsTarget);
    }
    this.applyCamera();
    this.drawTransition();
  }

  // ─── Franjas ───────────────────────────────────────────────────────────────────────────────────────────

  private drawBars(b: { top: number; bottom: number }): void {
    this.barsShown = { top: b.top, bottom: b.bottom };
    const g = this.barsG;
    if (!this.alive || !g?.active) return;
    const { width, height } = g.scene.scale;
    g.clear();
    g.fillStyle(0x000000, 1);
    if (b.top > 0) g.fillRect(0, 0, width, Math.ceil(b.top));
    if (b.bottom > 0) g.fillRect(0, height - Math.ceil(b.bottom), width, Math.ceil(b.bottom));
  }

  // ─── Iris y cortinilla ─────────────────────────────────────────────────────────────────────────────────

  /** { op: "iris", mode: "out"|"in", actor?: "player", x?, y?, ms? } · { op: "wipe", mode: "out"|"in", dir: "left", ms? } */
  private async transitionOp(op: ScriptOp, instant: boolean): Promise<void> {
    const type = op.op === 'iris' ? 'iris' : 'wipe';
    const mode: TransitionMode = op.mode === 'in' || op.mode === 'open' ? 'in' : 'out';
    const at = typeof op.actor === 'string' ? op.actor : isPoint({ x: op.x, y: op.y }) ? { x: op.x as number, y: op.y as number } : undefined;
    const dir = (['left', 'right', 'up', 'down'].includes(op.dir as string) ? op.dir : 'left') as WipeDir;
    await this.runTransition(type, mode, durationOf(op, type === 'iris' ? IRIS_MS : WIPE_MS), this.resolveAt(at), dir, instant);
  }

  /** Centro de la iris en pantalla: un actor, un punto en % del fondo o (por defecto) el jugador. */
  private resolveAt(at: Point | string | undefined): Point {
    const cam = this.cam();
    const screen = (w: Point) => worldToScreen(w, { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom, width: cam.width, height: cam.height });
    if (isPoint(at)) return screen(this.host.coords().pctToScreen(at.x, at.y));
    const a = this.actor(typeof at === 'string' ? at : 'player');
    if (a) return screen(this.actorCenter(a));
    return { x: cam.width / 2, y: cam.height / 2 };
  }

  private transitionLayer(): Phaser.GameObjects.Graphics | null {
    const ui = this.host.ui();
    const target: Phaser.Scene = ui ?? this.scene;
    if (this.transG?.active && this.transG.scene === target) return this.transG;
    if (this.transG?.active) this.transG.destroy();
    const depth = ui ? (this.active ? TRANSITION_DEPTH_CINEMATIC : TRANSITION_DEPTH) : 2000;
    this.transG = target.add.graphics().setDepth(depth).setScrollFactor(0);
    return this.transG;
  }

  private runTransition(type: 'iris' | 'wipe', mode: TransitionMode, ms: number, center: Point, dir: WipeDir, instant: boolean): Promise<void> {
    if (!this.alive) return Promise.resolve();
    const layer = this.transitionLayer();
    if (!layer) return Promise.resolve();
    this.trans = { type, mode, p: 0, center, dir };
    const t = this.trans;
    this.drawTransition();
    return this.animate(ms, type === 'iris' ? 'Sine.easeInOut' : 'Linear', (p) => {
      t.p = p;
      if (this.trans === t) this.drawTransition();
    }, instant).then(() => {
      // Abierta del todo: no queda nada que pintar
      if (this.trans === t && mode === 'in') this.clearTransition();
    });
  }

  private clearTransition(): void {
    this.trans = null;
    if (this.transG?.active) this.transG.clear();
  }

  private drawTransition(): void {
    const g = this.transG;
    const t = this.trans;
    if (!this.alive || !g?.active) return;
    g.clear();
    if (!t) return;
    const vp = { width: g.scene.scale.width, height: g.scene.scale.height };
    g.fillStyle(0x000000, 1);
    if (t.type === 'wipe') {
      const r = wipeRect(t.mode, t.dir, t.p, vp);
      if (r.w > 0 && r.h > 0) g.fillRect(r.x, r.y, r.w, r.h);
      return;
    }
    const maxR = irisMaxRadius(t.center, vp);
    const r = irisRadiusAt(t.mode, t.p, maxR);
    if (r <= 0.5) {
      g.fillRect(0, 0, vp.width, vp.height);
      return;
    }
    if (r >= maxR) return;
    for (const quad of irisQuads(t.center, r, maxR)) g.fillPoints(quad, true);
  }

  // ─── Actores ───────────────────────────────────────────────────────────────────────────────────────────

  /** 'player' (o sin actor) = el jugador; si no, id o nombre de una NPC de la escena. */
  private actor(id: unknown): Actor | null {
    const key = typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : 'player';
    if (key === 'player') {
      const player = this.host.player();
      return player ? { kind: 'player', player } : null;
    }
    const npc = this.host.npcs().find((n) => n.active && (n.npcId.toLowerCase() === key || n.npcName.toLowerCase() === key));
    return npc ? { kind: 'npc', npc } : null;
  }

  private actorOrWarn(op: ScriptOp): Actor | null {
    const a = this.actor(op.actor);
    if (!a) console.warn(`[Cinematic] ${op.op}: no hay actor «${String(op.actor ?? 'player')}» en la escena`);
    return a;
  }

  /** Centro del cuerpo del actor en el mundo (para la cámara y la iris). */
  private actorCenter(a: Actor): Point {
    if (a.kind === 'player') return { x: a.player.x, y: a.player.y - a.player.displayHeight / 2 };
    const h = a.npc.height * a.npc.scaleY;
    return { x: a.npc.x, y: a.npc.y - h / 2 };
  }

  private npcPct(npc: NPC): Point {
    return npc.pctPosition ? { ...npc.pctPosition } : this.host.coords().screenToPct(npc.x, npc.y);
  }

  private placeNpc(npc: NPC, p: Point): void {
    npc.pctPosition = { x: p.x, y: p.y };
    const s = this.host.coords().pctToScreen(p.x, p.y);
    npc.setPosition(s.x, s.y);
  }

  /**
   * { op: "actorMove", actor: "player", x: 55, y: 92 } — el jugador anda por el pathfinding (A2.1) y el op espera a
   * que llegue; una NPC (sin sprites de andar) se desliza a velocidad andante (`ms` la fija). Al saltar, acaba en el
   * destino al momento.
   */
  private async actorMove(op: ScriptOp, instant: boolean): Promise<void> {
    const a = this.actorOrWarn(op);
    if (!a) return;
    if (!isPoint({ x: op.x, y: op.y })) {
      console.warn(`[Cinematic] actorMove sin x/y numéricos`);
      return;
    }
    const target = { x: op.x as number, y: op.y as number };
    const cs = this.host.coords();
    const aspect = cs.imgW / cs.imgH;
    const speed = this.host.walkSpeedPct();
    if (a.kind === 'player') {
      const p = a.player;
      const from = { x: p.pctX, y: p.pctY };
      // Mismo destino andando o saltando: el punto alcanzable más cercano (como walkToPct)
      const dest = p.approachPct(target) ?? target;
      const land = () => {
        if (!this.alive || !p.active) return;
        if (Math.hypot(p.pctX - dest.x, p.pctY - dest.y) > 0.01) p.teleportPct(dest.x, dest.y);
        else p.halt();
        // A4.1: como al llegar andando: de perfil hacia donde iba, de espaldas si subía y de frente si bajaba
        const dxPx = ((dest.x - from.x) / 100) * cs.imgW;
        const dyPx = ((dest.y - from.y) / 100) * cs.imgH;
        if (Math.abs(dest.x - from.x) > 0.01 || Math.abs(dest.y - from.y) > 0.01) p.face(facingForDir(moveDir(dxPx, dyPx, null)));
      };
      if (instant) {
        land();
        return;
      }
      p.walkToPct(dest.x, dest.y);
      const limit = slideDurationMs(from, dest, speed, aspect) * 3 + 3000;
      await this.waitUntil(() => !p.active || !p.isMoving(), limit, land, true);
      return;
    }
    const npc = a.npc;
    const from = this.npcPct(npc);
    const ms = durationOf(op, slideDurationMs(from, target, speed, aspect));
    await this.animate(ms, 'Linear', (t) => { if (npc.active) this.placeNpc(npc, lerpPoint(from, target, t)); }, instant);
  }

  /** { op: "actorFace", actor: "player", dir: "left"|"right"|"front"|"back" } (NPC: left = sprite espejado) */
  private actorFace(op: ScriptOp): void {
    const a = this.actorOrWarn(op);
    const dir = op.dir ?? op.face;
    if (!a || !isActorFacing(dir)) return;
    if (a.kind === 'player') a.player.face(dir);
    else if (dir === 'left' || dir === 'right') a.npc.setMirrored(dir === 'left');
  }

  /** { op: "actorAnim", actor: "npc_receptionist", anim: "talk"|"idle"|"walk"|<clave de textura> } */
  private actorAnim(op: ScriptOp): void {
    const a = this.actorOrWarn(op);
    const anim = typeof op.anim === 'string' ? op.anim : 'idle';
    if (!a) return;
    if (a.kind === 'player') {
      const ok = a.player.pose(anim === 'idle' || anim === 'talk' ? null : anim);
      if (!ok) console.warn(`[Cinematic] actorAnim: no existe la textura «${anim}»`);
      return;
    }
    if (anim === 'talk') a.npc.startTalking();
    else if (anim === 'idle' || anim === 'walk') { a.npc.stopTalking(); a.npc.setPose(null); }
    else if (!a.npc.setPose(anim)) console.warn(`[Cinematic] actorAnim: no existe la textura «${anim}»`);
  }

  /** { op: "actorShow"|"actorHide", actor, ms? } — con `ms`, fundido */
  private async actorShow(op: ScriptOp, show: boolean, instant: boolean): Promise<void> {
    const a = this.actorOrWarn(op);
    if (!a) return;
    const obj: { alpha: number; visible: boolean; setAlpha(v: number): unknown; setVisible(v: boolean): unknown } = a.kind === 'player' ? a.player : a.npc;
    const ms = durationOf(op, 0);
    if (show) {
      if (!obj.visible) obj.setAlpha(ms > 0 && !instant ? 0 : 1);
      obj.setVisible(true);
    }
    const from = obj.alpha;
    const to = show ? 1 : 0;
    await this.animate(ms, 'Linear', (p) => { obj.setAlpha(from + (to - from) * p); }, instant);
    if (!show && this.alive) {
      obj.setVisible(false);
      obj.setAlpha(1);
    }
  }

  /** { op: "actorTeleport", actor, x, y, dir? } */
  private actorTeleport(op: ScriptOp): void {
    const a = this.actorOrWarn(op);
    if (!a || !isPoint({ x: op.x, y: op.y })) return;
    const p = { x: op.x as number, y: op.y as number };
    if (a.kind === 'player') a.player.teleportPct(p.x, p.y);
    else this.placeNpc(a.npc, p);
    if (op.dir !== undefined) this.actorFace(op);
  }

  // ─── Animaciones ───────────────────────────────────────────────────────────────────────────────────────

  private finishAnimations(): void {
    for (const a of [...this.anims]) a.finish();
  }

  /**
   * Tween de 0 a 1 en `ms` que llama a `apply(p)`. Termina solo, o de golpe con `finishAll` (aplica p = 1) o con
   * `destroy` (no aplica nada: los objetos ya no existen). Con `instant` o `ms` = 0, aplica 1 y resuelve al momento.
   */
  private animate(ms: number, ease: string, apply: (p: number) => void, instant: boolean): Promise<void> {
    if (instant || ms <= 0 || !this.alive) {
      if (this.alive) apply(1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const proxy = { p: 0 };
      let settled = false;
      let tween: Phaser.Tweens.Tween | null = null;
      const anim: Anim = {
        finish: () => {
          if (settled) return;
          settled = true;
          this.anims.delete(anim);
          try { tween?.stop(); } catch { /* ya parado */ }
          if (this.alive) apply(1);
          resolve();
        },
      };
      this.anims.add(anim);
      tween = this.scene.tweens.add({
        targets: proxy,
        p: 1,
        duration: ms,
        ease,
        onUpdate: () => { if (!settled && this.alive) apply(proxy.p); },
        onComplete: () => { tween = null; anim.finish(); },
      });
    });
  }

  /**
   * Espera a que `done()` (mirado cada frame) o a `limitMs`; al terminar —solo, por tiempo o con el salto— llama a
   * `onFinish`. Con `finishOnLimit`, pasar el tope cuenta como terminar (el personaje que no llega aparece).
   */
  private waitUntil(done: () => boolean, limitMs: number, onFinish: () => void, finishOnLimit = true): Promise<void> {
    if (!this.alive) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const started = Date.now();
      let settled = false;
      const check = () => {
        if (settled) return;
        if (done()) { settle(false); return; }
        if (Date.now() - started >= limitMs) settle(finishOnLimit);
      };
      const settle = (runFinish: boolean) => {
        if (settled) return;
        settled = true;
        this.anims.delete(anim);
        this.scene.events.off('update', check);
        if (runFinish && this.alive) onFinish();
        resolve();
      };
      const anim: Anim = { finish: () => settle(true) };
      this.anims.add(anim);
      this.scene.events.on('update', check);
    });
  }
}

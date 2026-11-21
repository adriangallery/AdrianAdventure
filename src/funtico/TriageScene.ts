/**
 * F1.2 (plan FUNTICO_ADVENTURE): Triage jugable en vertical Y horizontal. Toque directo, sin personaje.
 *
 * Modelo y vista separados: el estado de la carrera vive en `TriageModel` (carrera, toques, estación abierta, reloj y
 * desplazamiento) y `layout(w, h)` solo recoloca y reescala, así que girar o redimensionar en caliente no pierde nada.
 *
 * Dos cámaras: `sceneCam` pinta la escena (fondo + primer plano en coordenadas de textura, origen 0,0) dentro de su
 * panel; `uiCam` pinta la UI encima en px de pantalla (= px CSS). En vertical la escena llena el ancho con alto
 * generoso y se desplaza arrastrando (con inercia); en horizontal cabe entera a lo ancho en su panel.
 */
import Phaser from 'phaser';
import { TriageModel, type TapOutcome } from './triage/TriageModel';
import type { RelapseStation, SpotStation, Station, TriageRun } from './triage/triage';
import { Button, C, MIN_TEXT, MIN_TOUCH, safeInsets, textBound, txt, type Rect, type UiBound } from './ui';

/** Escenas con primer plano (foreground@*.webp) en assets/scenes/<id>/. */
const FOREGROUND = new Set(['outside', 'lobby']);
const RELAPSE_SCENE = 'recovery_pool';
const MUSIC_KEY = 'tri-music';
const MUSIC_URL = 'assets/audio/music/clinical.mp3';
const SFX_HIT = 'assets/audio/sfx/keypad_success.mp3';
const SFX_MISS = 'assets/audio/sfx/keypad_fail.mp3';
const MUTE_KEY = 'adrian_adventure_funtico_muted';
/** Movimiento máximo (px CSS) para que un toque cuente como toque y no como arrastre. */
const TAP_SLOP = 10;
/** Pausa de la vista entre estaciones (ms): el modelo ya abrió la siguiente; es < minReactionMs (300). */
const SWAP_MS = 280;

export interface TriageSceneData { run: TriageRun }

type Orientation = 'portrait' | 'landscape';

export class TriageScene extends Phaser.Scene {
  model!: TriageModel;
  private variant: '@1280' | '@2048' = '@2048';
  private texW = 2048;
  private texH = 636;
  private sceneCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private worldObjs = new Set<Phaser.GameObjects.GameObject>();

  // Vista
  private bg!: Phaser.GameObjects.Image;
  private fg!: Phaser.GameObjects.Image;
  private shade!: Phaser.GameObjects.Rectangle;
  private hudBg!: Phaser.GameObjects.Rectangle;
  private tTimer!: Phaser.GameObjects.Text;
  private tScore!: Phaser.GameObjects.Text;
  private tStreak!: Phaser.GameObjects.Text;
  private tProgress!: Phaser.GameObjects.Text;
  private speedBack!: Phaser.GameObjects.Rectangle;
  private speedBar!: Phaser.GameObjects.Rectangle;
  private muteBtn!: Button;
  private cardBg!: Phaser.GameObjects.Rectangle;
  private cardTitle!: Phaser.GameObjects.Text;
  private cardText!: Phaser.GameObjects.Text;
  private cropImg!: Phaser.GameObjects.Image;
  private cropFg!: Phaser.GameObjects.Image;
  private cropFrame!: Phaser.GameObjects.Rectangle;
  private stripBack!: Phaser.GameObjects.Rectangle;
  private stripThumb!: Phaser.GameObjects.Rectangle;
  private panelFrame!: Phaser.GameObjects.Rectangle;
  private options: Button[] = [];

  /** Estación que pinta la vista (puede ir SWAP_MS por detrás del modelo). */
  private shown = -1;
  private locked = false;
  private ending = false;
  private orientation: Orientation = 'portrait';
  private W = 0;
  private H = 0;
  private panel: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private view: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private zoom = 1;
  private scrollable = false;
  private drag: { id: number; x0: number; y0: number; lastX: number; lastT: number; moved: number } | null = null;
  private velocity = 0;
  private frameMs: number[] = [];
  private currentVoice: Phaser.Sound.BaseSound | null = null;

  constructor() {
    super('TriageScene');
  }

  init(data: TriageSceneData): void {
    this.model = new TriageModel(data.run);
    this.shown = -1;
    this.locked = false;
    this.ending = false;
    this.options = [];
    this.worldObjs = new Set();
    this.frameMs = [];
    this.velocity = 0;
    this.drag = null;
    // Variante ligera según la pantalla (px físicos del lado mayor)
    const dpr = window.devicePixelRatio || 1;
    const big = Math.max(window.innerWidth, window.innerHeight) * dpr;
    this.variant = big >= 1600 ? '@2048' : '@1280';
    this.texW = this.variant === '@2048' ? 2048 : 1280;
    this.texH = this.variant === '@2048' ? 636 : 397;
  }

  preload(): void {
    const run = this.model.run;
    const ids = new Set<string>(Object.keys(run.scenes));
    ids.add(RELAPSE_SCENE);
    for (const id of ids) {
      this.load.image(`tri-bg-${id}${this.variant}`, `assets/scenes/${id}/background${this.variant}.webp`);
      if (FOREGROUND.has(id)) this.load.image(`tri-fg-${id}${this.variant}`, `assets/scenes/${id}/foreground${this.variant}.webp`);
    }
    for (const st of run.stations) {
      for (const v of voicesOf(st)) if (!this.cache.audio.exists(v)) this.load.audio(v, v);
    }
    if (!this.cache.audio.exists(SFX_HIT)) this.load.audio(SFX_HIT, SFX_HIT);
    if (!this.cache.audio.exists(SFX_MISS)) this.load.audio(SFX_MISS, SFX_MISS);
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    const label = this.add.text(w / 2, h / 2, 'PREPPING THE WARD...', { fontFamily: '"Press Start 2P", monospace', fontSize: '14px', color: C.yellow }).setOrigin(0.5);
    // Se quita al acabar: la música reutiliza el loader después y el texto ya no existe
    const onProgress = (p: number) => label.setText(`PREPPING THE WARD... ${Math.round(p * 100)}%`);
    this.load.on('progress', onProgress);
    this.load.once('complete', () => { this.load.off('progress', onProgress); label.destroy(); });
  }

  create(): void {
    // El reloj empieza cuando todo está cargado: se rehace el modelo con la misma carrera
    this.model = new TriageModel(this.model.run);
    this.sound.mute = readMuted();
    this.sceneCam = this.cameras.main;
    this.sceneCam.setOrigin(0, 0).setBackgroundColor(C.bg);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'ui');

    // Mundo (cámara de escena)
    const first = this.model.run.stations[0];
    this.bg = this.worldAdd(this.add.image(0, 0, this.bgKey(first.scene)).setOrigin(0, 0));
    this.fg = this.worldAdd(this.add.image(0, 0, this.bgKey(first.scene)).setOrigin(0, 0).setVisible(false));

    // UI
    this.shade = this.add.rectangle(0, 0, 10, 10, C.bgN, 0.72).setOrigin(0, 0);
    this.panelFrame = this.add.rectangle(0, 0, 10, 10).setOrigin(0, 0).setStrokeStyle(2, C.borderN).setFillStyle(0, 0);
    this.hudBg = this.add.rectangle(0, 0, 10, 10, C.panelN, 0.92).setOrigin(0, 0);
    this.tTimer = txt(this, '3:00', MIN_TEXT, C.yellow);
    this.tProgress = txt(this, '1/9', MIN_TEXT, C.lilac);
    this.tStreak = txt(this, 'x1.0', MIN_TEXT, C.lilac);
    this.tScore = txt(this, '0', MIN_TEXT, C.white, 'right');
    this.speedBack = this.add.rectangle(0, 0, 10, 6, C.panel2N).setOrigin(0, 0);
    this.speedBar = this.add.rectangle(0, 0, 10, 6, C.greenN).setOrigin(0, 0);
    this.muteBtn = new Button(this, 'mute', this.sound.mute ? 'OFF' : 'SND', () => this.toggleMute());
    this.cardBg = this.add.rectangle(0, 0, 10, 10, C.panelN, 0.94).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.cardTitle = txt(this, '', MIN_TEXT, C.yellow);
    this.cardText = txt(this, '', MIN_TEXT, C.white);
    this.cropImg = this.add.image(0, 0, this.bgKey(first.scene)).setOrigin(0.5, 0.5).setVisible(false);
    this.cropFg = this.add.image(0, 0, this.bgKey(first.scene)).setOrigin(0.5, 0.5).setVisible(false);
    this.cropFrame = this.add.rectangle(0, 0, 10, 10).setOrigin(0.5, 0.5).setStrokeStyle(3, C.yellowN).setFillStyle(0, 0);
    this.stripBack = this.add.rectangle(0, 0, 10, 8, C.panel2N).setOrigin(0, 0);
    this.stripThumb = this.add.rectangle(0, 0, 10, 8, C.yellowN).setOrigin(0, 0);
    for (let i = 0; i < 4; i++) this.options.push(new Button(this, `option-${i}`, '', () => this.onPick(i), { color: C.white }));

    // Cada cámara ignora lo de la otra
    this.uiCam.ignore([...this.worldObjs]);
    this.sceneCam.ignore(this.children.list.filter((o) => !this.worldObjs.has(o)));

    this.buildCrops();
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.currentVoice?.stop();
      const hook = funticoHook();
      if (hook.triage?.scene === this) delete hook.triage;
    });

    this.showStation(0);
    this.layout(this.scale.width, this.scale.height);
    this.startMusic();
    this.registerHook();
  }

  // ───────────────────────────── Bucle ─────────────────────────────

  update(_time: number, delta: number): void {
    this.frameMs.push(delta);
    if (this.frameMs.length > 240) this.frameMs.shift();
    if (this.ending) return;
    const t = this.model.now();
    if (this.model.tick(t)) {
      this.finish();
      return;
    }
    // Inercia del desplazamiento
    if (!this.drag && Math.abs(this.velocity) > 0.01 && this.scrollable) {
      this.scrollBy(-this.velocity * delta);
      this.velocity *= Math.pow(0.9, delta / 16.7);
    }
    this.updateHud(t);
  }

  private updateHud(t: number): void {
    const m = this.model;
    const rem = m.remainingMs(t);
    const s = Math.ceil(rem / 1000);
    this.tTimer.setText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    this.tTimer.setColor(rem < 20000 ? C.red : C.yellow);
    this.tTimer.setAlpha(rem < 20000 && Math.floor(t / 300) % 2 === 1 ? 0.35 : 1);
    this.tScore.setText(String(m.score.score));
    this.tStreak.setText(`x${m.multiplier.toFixed(m.multiplier * 10 % 1 === 0 ? 1 : 2)}`);
    this.tProgress.setText(`${Math.min(m.current + 1, m.run.stations.length)}/${m.run.stations.length}`);
    const f = m.speedFraction(t);
    this.speedBar.setSize(Math.max(0, Math.round(this.speedBack.width * f)), this.speedBack.height);
    this.speedBar.setFillStyle(f > 0.5 ? C.greenN : f > 0.2 ? C.yellowN : C.redN);
  }

  // ───────────────────────────── Estaciones ─────────────────────────────

  private bgKey(scene: string): string {
    return `tri-bg-${scene}${this.variant}`;
  }

  private worldAdd<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.worldObjs.add(o);
    this.uiCam?.ignore(o);
    return o;
  }

  private uiAdd<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.sceneCam.ignore(o);
    return o;
  }

  /**
   * Recortes de SAMPLE: un frame `crop-<i>` en la textura del fondo (y otro en la del primer plano, que se pinta encima).
   * Sin RenderTexture: la imagen del recorte es la misma textura, escalada nearest (pixelArt).
   */
  private buildCrops(): void {
    const k = this.texW / 3712;
    for (const st of this.model.run.stations) {
      if (st.kind !== 'sample' || !st.crop) continue;
      const cx = Math.round(st.crop.x * k);
      const cy = Math.round(st.crop.y * k);
      const cw = Math.max(8, Math.min(this.texW - cx, Math.round(st.crop.w * k)));
      const ch = Math.max(8, Math.min(this.texH - cy, Math.round(st.crop.h * k)));
      const keys = [this.bgKey(st.scene), ...(FOREGROUND.has(st.scene) ? [`tri-fg-${st.scene}${this.variant}`] : [])];
      for (const key of keys) {
        if (!this.textures.exists(key)) continue;
        const tex = this.textures.get(key);
        if (!tex.has(`crop-${st.i}`)) tex.add(`crop-${st.i}`, 0, cx, cy, cw, ch);
      }
    }
  }

  private showStation(i: number): void {
    this.shown = i;
    this.locked = false;
    const st = this.model.run.stations[i];
    if (!st) return;
    const sceneId = st.kind === 'relapse' ? RELAPSE_SCENE : st.scene;
    this.bg.setTexture(this.bgKey(sceneId));
    const fgKey = `tri-fg-${sceneId}${this.variant}`;
    this.fg.setVisible(FOREGROUND.has(sceneId) && this.textures.exists(fgKey));
    if (this.fg.visible) this.fg.setTexture(fgKey);
    this.velocity = 0;
    if (st.kind === 'sample') {
      this.cardTitle.setText('FIND THIS SAMPLE');
      this.cardText.setText('');
      this.cropImg.setTexture(this.bgKey(st.scene), `crop-${st.i}`);
      const fgKey2 = `tri-fg-${st.scene}${this.variant}`;
      const hasFg = FOREGROUND.has(st.scene) && this.textures.exists(fgKey2);
      if (hasFg) this.cropFg.setTexture(fgKey2, `crop-${st.i}`);
      this.cropFg.setData('on', hasFg);
    } else if (st.kind === 'symptom') {
      this.cardTitle.setText('PATIENT SAYS:');
      this.cardText.setText(`"${st.phrase ?? ''}"`);
      this.playVoice(st.voice ?? null);
    } else {
      const rel = st as RelapseStation;
      this.cardTitle.setText('CHAD SAYS:');
      this.cardText.setText(`"${rel.fud}"`);
      rel.options.forEach((o, k) => this.options[k].setText(o.text).setEnabled(true));
      this.playVoice(rel.fudVoice);
    }
    if (this.W) this.layout(this.W, this.H);
  }

  private toggleMute(): void {
    this.sound.mute = !this.sound.mute;
    this.muteBtn.setText(this.sound.mute ? 'OFF' : 'SND');
    try { localStorage.setItem(MUTE_KEY, this.sound.mute ? '1' : '0'); } catch { /* sin storage */ }
  }

  private playVoice(key: string | null): void {
    this.currentVoice?.stop();
    this.currentVoice = null;
    if (!key || !this.cache.audio.exists(key)) return;
    try {
      this.currentVoice = this.sound.add(key, { volume: 0.9 });
      this.currentVoice.once('complete', () => { this.currentVoice?.destroy(); this.currentVoice = null; });
      this.currentVoice.play();
    } catch { /* sin audio */ }
  }

  private sfx(key: string): void {
    if (this.cache.audio.exists(key)) this.sound.play(key, { volume: 0.5 });
  }

  /** Música del juego a volumen bajo; se carga sin bloquear el inicio. */
  private startMusic(): void {
    const play = () => {
      if (!this.sys.isActive()) return;
      const existing = this.sound.get(MUSIC_KEY);
      if (existing?.isPlaying) return;
      this.sound.add(MUSIC_KEY, { loop: true, volume: 0.18 }).play();
    };
    if (this.cache.audio.exists(MUSIC_KEY)) { play(); return; }
    this.load.audio(MUSIC_KEY, MUSIC_URL);
    this.load.once('complete', play);
    this.load.start();
  }

  // ───────────────────────────── Entrada ─────────────────────────────

  private inView(x: number, y: number): boolean {
    const v = this.view;
    return x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const st = this.model.run.stations[this.shown];
    if (!st || st.kind === 'relapse' || this.ending) return;
    if (!this.inView(p.x, p.y)) return;
    this.drag = { id: p.id, x0: p.x, y0: p.y, lastX: p.x, lastT: performance.now(), moved: 0 };
    this.velocity = 0;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d || d.id !== p.id || !p.isDown) return;
    d.moved = Math.max(d.moved, Math.hypot(p.x - d.x0, p.y - d.y0));
    const now = performance.now();
    const dx = p.x - d.lastX;
    if (this.scrollable && d.moved >= TAP_SLOP) {
      this.scrollBy(-dx);
      const dt = Math.max(1, now - d.lastT);
      this.velocity = 0.7 * this.velocity + 0.3 * (dx / dt);
    }
    d.lastX = p.x;
    d.lastT = now;
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d || d.id !== p.id) return;
    this.drag = null;
    if (d.moved >= TAP_SLOP) {
      if (performance.now() - d.lastT > 80) this.velocity = 0;
      return;
    }
    this.velocity = 0;
    const w = this.screenToWorld(d.x0, d.y0);
    this.sceneTap(w.x, w.y, d.x0, d.y0);
  }

  /** Desplaza la escena `dxScreen` px de pantalla (positivo = ver más a la derecha). */
  private scrollBy(dxScreen: number): void {
    const max = this.maxScroll();
    if (max <= 0) return;
    const sx = Phaser.Math.Clamp(this.sceneCam.scrollX + dxScreen / this.zoom, 0, max);
    if (sx === 0 || sx === max) this.velocity = 0;
    this.model.pan = sx / max;
    this.applyScroll();
  }

  private maxScroll(): number {
    return Math.max(0, this.texW - this.view.w / this.zoom);
  }

  private applyScroll(): void {
    const max = this.maxScroll();
    this.sceneCam.setScroll(Math.round(max * this.model.pan * 100) / 100, 0);
    if (this.scrollable) {
      const tw = Math.max(16, Math.round(this.stripBack.width * (this.view.w / this.zoom) / this.texW));
      this.stripThumb.setSize(tw, this.stripBack.height);
      this.stripThumb.x = Math.round(this.stripBack.x + (this.stripBack.width - tw) * this.model.pan);
    }
  }

  /** Pantalla → % del mundo. */
  private screenToWorld(x: number, y: number): { x: number; y: number } {
    const tx = this.sceneCam.scrollX + (x - this.view.x) / this.zoom;
    const ty = this.sceneCam.scrollY + (y - this.view.y) / this.zoom;
    return { x: (tx / this.texW) * 100, y: (ty / this.texH) * 100 };
  }

  /** % del mundo → pantalla (para el feedback y el gancho de pruebas). */
  worldToScreen(xPct: number, yPct: number): { x: number; y: number; visible: boolean } {
    const x = this.view.x + ((xPct / 100) * this.texW - this.sceneCam.scrollX) * this.zoom;
    const y = this.view.y + ((yPct / 100) * this.texH - this.sceneCam.scrollY) * this.zoom;
    return { x, y, visible: this.inView(x, y) };
  }

  /** Toque en la escena (real o del gancho de pruebas): mismo camino. */
  private sceneTap(xPct: number, yPct: number, sx: number, sy: number): TapOutcome | null {
    const st = this.model.run.stations[this.shown];
    if (this.locked || this.ending || !st || st.kind === 'relapse' || this.model.current !== this.shown) return null;
    const out = this.model.tapWorld(xPct, yPct);
    if (out.kind === 'ignored') return out;
    const spot = st as SpotStation;
    if (out.kind === 'hit') {
      this.sfx(SFX_HIT);
      this.flashBounds(spot, C.greenN);
      this.floatText(sx, sy, `+${out.points}`, C.green);
      this.advance();
    } else {
      this.sfx(SFX_MISS);
      this.missMark(xPct, yPct);
      this.floatText(sx, sy, `-${out.penalty}`, C.red);
      this.sceneCam.shake(140, 0.006);
      if (out.closed) {
        this.flashBounds(spot, C.yellowN);
        this.revealPan(spot);
        this.advance(SWAP_MS + 300);
      }
    }
    return out;
  }

  private onPick(i: number): TapOutcome | null {
    const st = this.model.run.stations[this.shown];
    if (this.locked || this.ending || !st || st.kind !== 'relapse' || this.model.current !== this.shown) return null;
    const out = this.model.pickOption(i);
    if (out.kind === 'ignored') return out;
    const rel = st as RelapseStation;
    this.options.forEach((b) => b.setEnabled(false));
    this.options[rel.correct].bg.setFillStyle(0x1f5a30);
    const b = this.options[i].bg;
    if (out.kind === 'hit') {
      this.sfx(SFX_HIT);
      this.floatText(b.x + b.width / 2, b.y, `+${out.points}`, C.green);
    } else {
      this.sfx(SFX_MISS);
      b.setFillStyle(0x6a1f28);
      this.floatText(b.x + b.width / 2, b.y, `-${out.penalty}`, C.red);
    }
    this.playVoice(rel.options[i].voice);
    this.advance(SWAP_MS + 200);
    return out;
  }

  /** Tras cerrar una estación: breve pausa de la vista y la siguiente (o el resultado). */
  private advance(ms = SWAP_MS): void {
    this.locked = true;
    this.time.delayedCall(ms, () => {
      if (this.ending) return;
      if (this.model.finished) { this.finish(); return; }
      this.options.forEach((b) => b.bg.setFillStyle(C.panel2N));
      this.showStation(this.model.current);
    });
  }

  private finish(): void {
    if (this.ending) return;
    this.ending = true;
    this.currentVoice?.stop();
    this.time.delayedCall(250, () => this.scene.start('TriageResultScene', { model: this.model }));
  }

  // ───────────────────────────── Feedback ─────────────────────────────

  private flashBounds(st: SpotStation, color: number): void {
    const b = st.bounds;
    const r = this.worldAdd(this.add.rectangle((b.x / 100) * this.texW, (b.y / 100) * this.texH, (b.w / 100) * this.texW, (b.h / 100) * this.texH, color, 0.35)
      .setOrigin(0, 0).setStrokeStyle(Math.max(2, 3 / this.zoom), color));
    this.tweens.add({ targets: r, alpha: 0, delay: 150, duration: 350, onComplete: () => r.destroy() });
  }

  private missMark(xPct: number, yPct: number): void {
    const c = this.worldAdd(this.add.circle((xPct / 100) * this.texW, (yPct / 100) * this.texH, 14 / this.zoom, C.redN, 0.45)
      .setStrokeStyle(Math.max(2, 3 / this.zoom), C.redN));
    this.tweens.add({ targets: c, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }

  /** Al 3.er fallo, en vertical, centra el objetivo revelado. */
  private revealPan(st: SpotStation): void {
    if (!this.scrollable) return;
    const max = this.maxScroll();
    const cx = ((st.bounds.x + st.bounds.w / 2) / 100) * this.texW;
    this.model.pan = Phaser.Math.Clamp((cx - this.view.w / this.zoom / 2) / max, 0, 1);
    this.applyScroll();
  }

  private floatText(x: number, y: number, s: string, color: string): void {
    const t = this.uiAdd(txt(this, s, Math.max(16, this.basePx() + 2), color).setOrigin(0.5, 1).setStroke('#000000', 4));
    t.setPosition(Phaser.Math.Clamp(x, 40, this.W - 40), Phaser.Math.Clamp(y, 40, this.H - 10));
    this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 650, onComplete: () => t.destroy() });
  }

  // ───────────────────────────── Layout ─────────────────────────────

  private onResize(size: Phaser.Structs.Size): void {
    this.layout(size.width, size.height);
  }

  private basePx(): number {
    return Phaser.Math.Clamp(Math.round(Math.min(this.W, this.H) / 46), MIN_TEXT, 22);
  }

  /** Recoloca y reescala TODO para el tamaño de ventana; no toca el estado de la carrera. */
  layout(width: number, height: number): void {
    this.W = width;
    this.H = height;
    this.uiCam.setSize(width, height);
    this.orientation = height > width ? 'portrait' : 'landscape';
    const ins = safeInsets();
    const area: Rect = { x: ins.left, y: ins.top, w: width - ins.left - ins.right, h: height - ins.top - ins.bottom };
    const st = this.model.run.stations[this.shown];
    const px = this.basePx();
    const pad = 8;
    for (const t of [this.tTimer, this.tProgress, this.tStreak, this.tScore]) t.setFontSize(px);
    this.cardTitle.setFontSize(px);
    this.muteBtn.label.setFontSize(MIN_TEXT);

    const relapse = st?.kind === 'relapse';
    this.options.forEach((b) => b.setVisible(relapse));
    this.cropImg.setVisible(st?.kind === 'sample');
    this.cropFg.setVisible(st?.kind === 'sample' && this.cropFg.getData('on') === true);
    this.cropFrame.setVisible(st?.kind === 'sample');
    this.shade.setVisible(relapse);
    this.panelFrame.setVisible(!relapse);

    if (relapse) {
      this.layoutRelapse(area, px, pad);
    } else if (this.orientation === 'portrait') {
      // HUD fino arriba, escena a todo el ancho, franja de posición y tarjeta debajo
      const hud: Rect = { x: area.x, y: area.y, w: area.w, h: MIN_TOUCH + 14 };
      this.layoutHud(hud, px, pad, 'row');
      const sceneH = Math.round(Phaser.Math.Clamp(area.h * 0.5, 160, area.h - hud.h - 150));
      this.panel = { x: area.x, y: hud.y + hud.h, w: area.w, h: sceneH };
      this.fitScene(true);
      const stripY = this.panel.y + this.panel.h + 4;
      this.stripBack.setPosition(area.x + pad, stripY).setSize(area.w - pad * 2, 8).setVisible(true);
      this.stripThumb.setPosition(area.x + pad, stripY).setSize(16, 8).setVisible(true);
      const cardY = stripY + 8 + pad;
      this.layoutCard({ x: area.x + pad, y: cardY, w: area.w - pad * 2, h: area.y + area.h - pad - cardY }, px, st);
    } else {
      // Escena a la izquierda (≈70 %), columna de estación a la derecha (HUD + tarjeta)
      const sw = Math.round(area.w * 0.7);
      this.panel = { x: area.x, y: area.y, w: sw, h: area.h };
      this.fitScene(false);
      const col: Rect = { x: area.x + sw + pad, y: area.y + pad, w: area.w - sw - pad * 2, h: area.h - pad * 2 };
      const hud: Rect = { x: col.x, y: col.y, w: col.w, h: MIN_TOUCH * 2 + 16 };
      this.layoutHud(hud, px, 0, 'grid');
      this.stripBack.setVisible(false);
      this.stripThumb.setVisible(false);
      this.layoutCard({ x: col.x, y: hud.y + hud.h + pad, w: col.w, h: col.y + col.h - (hud.y + hud.h + pad) }, px, st);
    }
    this.applyScroll();
  }

  /** Coloca la cámara de escena: vertical = alto del panel y desplazable; horizontal = cabe entera a lo ancho. */
  private fitScene(portrait: boolean): void {
    const p = this.panel;
    if (portrait) {
      this.zoom = p.h / this.texH;
      const visW = Math.min(p.w, this.texW * this.zoom);
      this.view = { x: p.x + Math.round((p.w - visW) / 2), y: p.y, w: Math.round(visW), h: p.h };
    } else {
      this.zoom = Math.min(p.w / this.texW, p.h / this.texH);
      const w = Math.floor(this.texW * this.zoom);
      const h = Math.floor(this.texH * this.zoom);
      this.view = { x: p.x + Math.round((p.w - w) / 2), y: p.y + Math.round((p.h - h) / 2), w, h };
    }
    this.scrollable = this.maxScrollFor(this.view.w) > 1;
    this.sceneCam.setViewport(this.view.x, this.view.y, this.view.w, this.view.h).setZoom(this.zoom);
    this.panelFrame.setPosition(this.view.x, this.view.y).setSize(this.view.w, this.view.h);
  }

  private maxScrollFor(viewW: number): number {
    return Math.max(0, this.texW - viewW / this.zoom);
  }

  private layoutHud(r: Rect, px: number, pad: number, mode: 'row' | 'grid'): void {
    this.hudBg.setPosition(r.x, r.y).setSize(r.w, r.h).setVisible(true);
    const bar = 6;
    if (mode === 'row') {
      const rowH = r.h - bar - 8;
      const cy = r.y + Math.round(rowH / 2) + 2;
      this.muteBtn.place(r.x + r.w - pad - MIN_TOUCH - 20, r.y + 2, MIN_TOUCH + 20, MIN_TOUCH);
      const left = r.x + pad;
      const right = r.x + r.w - pad - MIN_TOUCH - 20 - pad;
      this.tTimer.setOrigin(0, 0.5).setPosition(left, cy);
      this.tProgress.setOrigin(0, 0.5).setPosition(left + this.tTimer.width + px * 1.2, cy);
      this.tStreak.setOrigin(0, 0.5).setPosition(this.tProgress.x + Math.max(this.tProgress.width, px * 3) + px * 1.2, cy);
      this.tScore.setOrigin(1, 0.5).setPosition(right, cy);
      this.speedBack.setPosition(r.x + pad, r.y + r.h - bar - 4).setSize(r.w - pad * 2, bar);
    } else {
      const row = MIN_TOUCH;
      this.muteBtn.place(r.x + r.w - MIN_TOUCH - 20, r.y + 2, MIN_TOUCH + 20, MIN_TOUCH);
      this.tTimer.setOrigin(0, 0.5).setPosition(r.x + 6, r.y + row / 2 + 2);
      this.tScore.setOrigin(1, 0.5).setPosition(r.x + r.w - MIN_TOUCH - 30, r.y + row / 2 + 2);
      this.tProgress.setOrigin(0, 0.5).setPosition(r.x + 6, r.y + row * 1.5 + 2);
      this.tStreak.setOrigin(1, 0.5).setPosition(r.x + r.w - 6, r.y + row * 1.5 + 2);
      this.speedBack.setPosition(r.x + 6, r.y + r.h - bar - 4).setSize(r.w - 12, bar);
    }
    this.speedBar.setPosition(this.speedBack.x, this.speedBack.y).setSize(this.speedBack.width, bar);
  }

  private layoutCard(r: Rect, px: number, st: Station | undefined): void {
    this.cardBg.setVisible(true).setPosition(r.x, r.y).setSize(r.w, Math.max(10, r.h));
    const inner = 10;
    this.cardTitle.setOrigin(0, 0).setWordWrapWidth(r.w - inner * 2, true).setPosition(r.x + inner, r.y + inner).setVisible(true);
    const top = this.cardTitle.y + this.cardTitle.height + inner;
    const avail = r.y + r.h - inner - top;
    this.cardText.setVisible(false);
    if (st?.kind === 'sample') {
      const side = Math.max(48, Math.min(r.w - inner * 2, avail));
      this.cropImg.setDisplaySize(side, side).setPosition(Math.round(r.x + r.w / 2), Math.round(top + side / 2));
      this.cropFg.setDisplaySize(side, side).setPosition(this.cropImg.x, this.cropImg.y);
      this.cropFrame.setPosition(this.cropImg.x, this.cropImg.y).setSize(side + 6, side + 6);
    } else if (st) {
      // La frase: la mayor fuente (≥ 14) que quepa en la tarjeta
      let f = Math.max(MIN_TEXT, px + 2);
      for (; f > MIN_TEXT; f--) {
        this.cardText.setFontSize(f).setLineSpacing(Math.round(f * 0.5)).setWordWrapWidth(r.w - inner * 2, true);
        if (this.cardText.height <= avail) break;
      }
      this.cardText.setFontSize(f).setLineSpacing(Math.round(f * 0.5)).setWordWrapWidth(r.w - inner * 2, true);
      this.cardText.setOrigin(0, 0).setPosition(r.x + inner, top).setVisible(true).setColor(C.white);
    }
  }

  private layoutRelapse(area: Rect, px: number, pad: number): void {
    // Fondo: la piscina de Chad oscurecida, cubriendo la ventana
    this.zoom = Math.max(area.w / this.texW, area.h / this.texH, this.W / this.texW, this.H / this.texH);
    this.view = { x: 0, y: 0, w: this.W, h: this.H };
    this.scrollable = false;
    this.sceneCam.setViewport(0, 0, this.W, this.H).setZoom(this.zoom);
    this.model.pan = 0.5;
    this.shade.setPosition(0, 0).setSize(this.W, this.H);
    this.stripBack.setVisible(false);
    this.stripThumb.setVisible(false);
    const hud: Rect = { x: area.x, y: area.y, w: area.w, h: MIN_TOUCH + 14 };
    this.layoutHud(hud, px, pad, 'row');
    const colW = Math.min(area.w - pad * 2, 900);
    const x = Math.round(area.x + (area.w - colW) / 2);
    let y = hud.y + hud.h + pad;
    const bottom = area.y + area.h - pad;
    // Se busca la mayor fuente que deja caber FUD + 4 réplicas
    let f = Math.max(MIN_TEXT, px);
    const gap = 8;
    const measure = (font: number): number => {
      this.cardTitle.setFontSize(font);
      this.cardText.setFontSize(font).setLineSpacing(Math.round(font * 0.45)).setWordWrapWidth(colW - 20, true);
      let h = this.cardTitle.height + 6 + this.cardText.height + 12 + 20;
      for (const b of this.options) h += b.place(x, 0, colW, MIN_TOUCH, font) + gap;
      return h;
    };
    for (; f > MIN_TEXT; f--) if (measure(f) <= bottom - y) break;
    const total = measure(f);
    const cardH = this.cardTitle.height + 6 + this.cardText.height + 20;
    this.cardBg.setVisible(true).setPosition(x, y).setSize(colW, cardH);
    this.cardTitle.setOrigin(0, 0).setPosition(x + 10, y + 10).setVisible(true);
    this.cardText.setOrigin(0, 0).setPosition(x + 10, this.cardTitle.y + this.cardTitle.height + 6).setVisible(true).setColor(C.yellow);
    y += cardH + 12;
    // Si sobra alto, las réplicas bajan un poco (zona del pulgar)
    const spare = Math.max(0, bottom - (hud.y + hud.h + pad) - total);
    y += Math.round(spare * 0.4);
    for (const b of this.options) y += b.place(x, y, colW, MIN_TOUCH, f) + gap;
  }

  // ───────────────────────────── Gancho de pruebas ─────────────────────────────

  private fpsMedian(): number {
    if (!this.frameMs.length) return 0;
    const s = [...this.frameMs].sort((a, b) => a - b);
    return Math.round((1000 / s[Math.floor(s.length / 2)]) * 10) / 10;
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [];
    const st = this.model.run.stations[this.shown];
    for (const [id, t] of [['timer', this.tTimer], ['progress', this.tProgress], ['streak', this.tStreak], ['score', this.tScore], ['card-title', this.cardTitle], ['card-text', this.cardText]] as const) {
      if (t.visible && t.text) out.push(textBound(id, t));
    }
    out.push(this.muteBtn.bound());
    if (st?.kind === 'relapse') this.options.forEach((b) => out.push(b.bound()));
    else {
      out.push({ id: 'scene', kind: 'area', ...this.view });
      if (st?.kind === 'sample') {
        const b = this.cropImg.getBounds();
        out.push({ id: 'crop', kind: 'area', x: b.x, y: b.y, w: b.width, h: b.height });
      }
    }
    return out;
  }

  private registerHook(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters del gancho de pruebas
    const scene = this;
    funticoHook().triage = {
      scene,
      get run() { return scene.model.run; },
      get taps() { return [...scene.model.taps]; },
      state() {
        const m = scene.model;
        const st = m.station;
        return {
          index: m.current,
          shown: scene.shown,
          ready: !scene.locked && !scene.ending && scene.shown === m.current,
          kind: st?.kind ?? null,
          obj: st?.obj ?? null,
          scene: st ? (st.kind === 'relapse' ? RELAPSE_SCENE : st.scene) : null,
          remainingMs: m.remainingMs(),
          elapsedMs: m.now(),
          score: m.score.score,
          raw: m.score.raw,
          streak: m.streak,
          misses: m.misses,
          orientation: scene.orientation,
          taps: m.taps.length,
          finished: m.finished,
          pan: m.pan,
          scrollable: scene.scrollable,
          view: { ...scene.view },
          zoom: scene.zoom,
          variant: scene.variant,
        };
      },
      /** Toque en % del mundo por el MISMO camino que un toque real (sin arrastre). */
      tapWorld(xPct: number, yPct: number) {
        const s = scene.worldToScreen(xPct, yPct);
        return scene.sceneTap(xPct, yPct, s.x, s.y);
      },
      pickOption(i: number) { return scene.onPick(i); },
      worldToScreen(xPct: number, yPct: number) { return scene.worldToScreen(xPct, yPct); },
      uiBounds() { return scene.uiBounds(); },
      fps() { return scene.fpsMedian(); },
    };
  }
}

function voicesOf(st: Station): string[] {
  if (st.kind === 'relapse') return [st.fudVoice, ...st.options.map((o) => o.voice)].filter((v): v is string => !!v);
  return st.voice ? [st.voice] : [];
}

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function funticoHook(): Record<string, any> {
  const w = window as unknown as { __funtico?: Record<string, unknown> };
  w.__funtico ??= {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return w.__funtico as Record<string, any>;
}

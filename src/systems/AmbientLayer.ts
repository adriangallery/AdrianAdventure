// A4.3 (plan SCUMM): capa Phaser de la animación ambiental (src/systems/Ambient.ts decide; esto dibuja).
//
// Un Graphics por elemento (puntos, formas, líneas) y, para lo suave (niebla, nubes, vapor), un pequeño pool de Images
// con una textura radial generada una vez por juego (`ambient_soft`, filtro LINEAR: el resto del juego va en nearest).
// Todo se coloca en coordenadas del mundo a partir de la transformación del fondo (CoordSystem.getBgTransform), así
// sigue a la cámara y al zoom de las cinemáticas, y `layout()` basta al cambiar el tamaño de la ventana. Sin tweens ni
// temporizadores: GameScene.update llama a `update` cada frame y en SHUTDOWN `destroy` solo suelta referencias (los
// objetos ya los destruyó la escena).
import Phaser from 'phaser';
import type { CoordSystem } from './CoordSystem';
import {
  AmbientElementState, ambientSeed, createAmbientSim, parseAmbient,
  type AmbientBlend, type AmbientFrame, type AmbientQa, type AmbientSpec,
} from './Ambient';

const SOFT_SIZE = 64;
/** Clave de la textura radial de un color (`ambient_soft_rrggbb`) */
export const softKey = (color: number) => `ambient_soft_${color.toString(16).padStart(6, '0')}`;

const BLENDS: Record<AmbientBlend, Phaser.BlendModes> = {
  normal: Phaser.BlendModes.NORMAL,
  add: Phaser.BlendModes.ADD,
  screen: Phaser.BlendModes.SCREEN,
  multiply: Phaser.BlendModes.MULTIPLY,
};

interface Element {
  state: AmbientElementState;
  g: Phaser.GameObjects.Graphics;
  images: Phaser.GameObjects.Image[];
  visible: boolean;
}

export interface AmbientLayerOptions {
  coords: CoordSystem;
  /** Primer plano de la escena (para `sway`); su x base es la del fondo */
  fg?: Phaser.GameObjects.Image;
  getFlag: (flag: string) => boolean;
  hasItem: (id: string) => boolean;
  /** ?qa=1: semillas fijas */
  qa: boolean;
}

/**
 * Textura radial de un color (centro opaco → borde transparente), una por color y por juego. Ya teñida al generarla: el
 * renderer Canvas (el del CI headless y el de algún móvil sin WebGL) ignora setTint, así que no se tiñe al dibujar.
 */
export function ensureSoftTexture(scene: Phaser.Scene, color: number): string {
  const key = softKey(color);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, SOFT_SIZE, SOFT_SIZE);
  if (!tex) return key;
  const ctx = tex.getContext();
  const r = SOFT_SIZE / 2;
  const rgb = `${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff}`;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.45, `rgba(${rgb},0.55)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SOFT_SIZE, SOFT_SIZE);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

export class AmbientLayer {
  private els: Element[] = [];
  private fgBaseX = 0;
  private fgOffsetPx = 0;
  readonly problems: string[];
  private alive = true;

  constructor(private scene: Phaser.Scene, raw: unknown, sceneId: string, private opts: AmbientLayerOptions) {
    const { specs, problems } = parseAmbient(raw, sceneId);
    this.problems = problems;
    for (const p of problems) console.warn(`Ambient: ${p}`);
    const g = { w: opts.coords.imgW, h: opts.coords.imgH };
    for (const spec of specs) {
      const sim = createAmbientSim(spec, ambientSeed(spec.id, opts.qa, Math.random()), g);
      const gfx = scene.add.graphics().setDepth(spec.depth).setBlendMode(BLENDS[spec.blend]);
      this.els.push({ state: new AmbientElementState(sim), g: gfx, images: [], visible: true });
    }
    this.layout();
  }

  /** Al cambiar la ventana: el primer plano vuelve a su x base (el frame siguiente aplica el vaivén) */
  layout(): void {
    if (!this.alive) return;
    const t = this.opts.coords.getBgTransform();
    this.fgBaseX = t.x;
    if (this.opts.fg?.active) this.opts.fg.setX(this.fgBaseX + this.fgOffsetPx);
  }

  /** Un frame: `dtMs` acotados (reloj real de GameScene) y scrollX de la cámara (px del mundo) */
  update(dtMs: number, scrollX: number): void {
    if (!this.alive) return;
    const t = this.opts.coords.getBgTransform();
    const scale = t.scaleX;
    const scroll = scale > 0 ? scrollX / scale : 0;
    let fgOffset = 0;
    for (const el of this.els) {
      const active = el.state.refresh(this.opts.getFlag, this.opts.hasItem);
      if (active !== el.visible) {
        el.visible = active;
        el.g.setVisible(active);
        for (const im of el.images) im.setVisible(false);
        if (!active) el.g.clear();
      }
      if (!active) continue;
      const frame = el.state.step({ dt: dtMs, scroll });
      this.draw(el, frame, t);
      if (el.state.spec.kind === 'sway') fgOffset += frame.fgOffset;
    }
    const px = Math.round(fgOffset * scale);
    if (px !== this.fgOffsetPx) {
      this.fgOffsetPx = px;
      if (this.opts.fg?.active) this.opts.fg.setX(this.fgBaseX + px);
    }
  }

  private draw(el: Element, f: AmbientFrame, t: { x: number; y: number; scaleX: number; scaleY: number }): void {
    const g = el.g;
    const s = t.scaleX;
    const X = (v: number) => t.x + v * s;
    const Y = (v: number) => t.y + v * t.scaleY;
    g.clear();
    for (const d of f.dots) {
      // Puntos como cuadrados de píxeles enteros: a juego con el pixel art y nítidos a cualquier escala
      const r = Math.max(1, Math.round(d.r * s));
      g.fillStyle(d.color, d.alpha);
      g.fillRect(Math.round(X(d.x) - r / 2), Math.round(Y(d.y) - r / 2), r, r);
    }
    for (const sh of f.shapes) {
      const x = X(sh.x);
      const y = Y(sh.y);
      const w = sh.w * s;
      const h = sh.h * t.scaleY;
      if (sh.stroke > 0) {
        g.lineStyle(Math.max(1, sh.stroke * s), sh.color, sh.alpha);
        if (sh.shape === 'ellipse') g.strokeEllipse(x + w / 2, y + h / 2, w, h);
        else g.strokeRect(x, y, w, h);
      } else {
        g.fillStyle(sh.color, sh.alpha);
        if (sh.shape === 'ellipse') g.fillEllipse(x + w / 2, y + h / 2, w, h);
        else g.fillRect(x, y, w, h);
      }
    }
    for (const l of f.lines) {
      g.lineStyle(Math.max(1, l.width * s), l.color, l.alpha);
      g.lineBetween(X(l.x1), Y(l.y1), X(l.x2), Y(l.y2));
    }
    // Manchas suaves: pool de Images con la textura radial del color del elemento
    while (el.images.length < f.blobs.length) {
      const im = this.scene.add.image(0, 0, ensureSoftTexture(this.scene, el.state.spec.color)).setDepth(el.state.spec.depth).setBlendMode(BLENDS[el.state.spec.blend]);
      el.images.push(im);
    }
    el.images.forEach((im, i) => {
      const b = f.blobs[i];
      if (!b) { if (im.visible) im.setVisible(false); return; }
      im.setVisible(true).setPosition(X(b.x), Y(b.y)).setDisplaySize(b.w * s, b.h * t.scaleY).setAlpha(b.alpha);
    });
  }

  /** Op `ambient` on/off/auto (presentación: no toca la partida). false si no hay un elemento con ese id */
  setOverride(id: string, forced: 'on' | 'off' | null): boolean {
    const el = this.els.find((e) => e.state.spec.id === id);
    if (!el) return false;
    el.state.forced = forced;
    return true;
  }

  /** Op `ambient` burst. false si no existe o su tipo no tiene ráfaga */
  burst(id: string): boolean {
    const el = this.els.find((e) => e.state.spec.id === id);
    return el ? el.state.burst() : false;
  }

  ids(): string[] {
    return this.els.map((e) => e.state.spec.id);
  }

  specs(): AmbientSpec[] {
    return this.els.map((e) => e.state.spec);
  }

  qaState(): AmbientQa[] {
    return this.els.map((e) => e.state.qa());
  }

  /** SHUTDOWN: los objetos ya los destruyó la escena; aquí solo se sueltan las referencias */
  destroy(): void {
    this.alive = false;
    this.els = [];
  }
}

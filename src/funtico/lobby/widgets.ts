/**
 * F1.5: piezas reutilizables de las pantallas del lobby (barra superior, botón de icono, pestañas, deslizador). Mismo
 * estilo que ui.ts (paleta SCUMM, fuente píxel, rectángulos con borde; nada de degradados ni esquinas redondeadas).
 */
import Phaser from 'phaser';
import type { FunticoBridge } from '../FunticoBridge';
import { fitName } from '../fitName';
import { Button, C, MIN_TEXT, MIN_TOUCH, REG, safeInsets, textBound, txt, type Insets, type Rect, type UiBound } from '../ui';
import { iconTexture, type IconId } from './icons';

export const BAR_BTN = 48;

/** Botón cuadrado con un icono píxel. */
export class IconButton {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, readonly id: string, icon: IconId, onTap: () => void) {
    this.bg = scene.add.rectangle(0, 0, BAR_BTN, BAR_BTN, C.panel2N).setOrigin(0, 0).setStrokeStyle(2, C.borderN).setInteractive({ useHandCursor: true });
    this.icon = scene.add.image(0, 0, iconTexture(scene, icon)).setOrigin(0.5, 0.5);
    this.bg.on('pointerdown', () => this.bg.setFillStyle(C.borderN));
    this.bg.on('pointerout', () => this.bg.setFillStyle(C.panel2N));
    this.bg.on('pointerup', () => { this.bg.setFillStyle(C.panel2N); onTap(); });
  }

  place(x: number, y: number, s = BAR_BTN): void {
    this.bg.setPosition(Math.round(x), Math.round(y)).setSize(s, s);
    this.bg.input?.hitArea.setTo(0, 0, s, s);
    this.icon.setPosition(Math.round(x + s / 2), Math.round(y + s / 2));
  }

  setVisible(v: boolean): this {
    this.bg.setVisible(v); this.icon.setVisible(v);
    if (this.bg.input) this.bg.input.enabled = v;
    return this;
  }

  bound(): UiBound {
    return { id: this.id, kind: 'button', x: this.bg.x, y: this.bg.y, w: this.bg.width, h: this.bg.height };
  }
}

/** Usuario del puente (nombre e inicial). Se pide una vez y se comparte entre pantallas. */
let userCache: { name: string; id: number | null } | null = null;
export async function loadUser(scene: Phaser.Scene): Promise<{ name: string; id: number | null }> {
  if (userCache) return userCache;
  const bridge = scene.registry.get(REG.bridge) as FunticoBridge | undefined;
  if (!bridge) return { name: '', id: null };
  await bridge.init();
  const u = await bridge.getUser();
  userCache = u.ok ? { name: u.value.Name, id: u.value.UserId } : { name: '', id: null };
  return userCache;
}

/** Cuadro de avatar: inicial en un cuadro píxel. */
export class Avatar {
  readonly box: Phaser.GameObjects.Rectangle;
  readonly letter: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, name: string, me = false) {
    this.box = scene.add.rectangle(0, 0, 32, 32, me ? 0x2a2450 : C.panel2N).setOrigin(0, 0).setStrokeStyle(2, me ? C.yellowN : C.borderN);
    this.letter = txt(scene, (name.trim()[0] ?? '?').toUpperCase(), MIN_TEXT, C.yellow, 'center').setOrigin(0.5, 0.5);
  }

  place(x: number, y: number, s: number): void {
    this.box.setPosition(Math.round(x), Math.round(y)).setSize(s, s);
    this.letter.setPosition(Math.round(x + s / 2), Math.round(y + s / 2 + 1));
  }

  setText(name: string): void { this.letter.setText((name.trim()[0] ?? '?').toUpperCase()); }
  setVisible(v: boolean): void { this.box.setVisible(v); this.letter.setVisible(v); }
  destroy(): void { this.box.destroy(); this.letter.destroy(); }
}

/**
 * Barra superior fija (respeta safe-area). Izquierda: Hall of Fame + Mis resultados (o BACK en las pantallas
 * secundarias). Centro: avatar + nombre del usuario del puente. Derecha: Ajustes. El saldo de Tico no se enseña: el SDK
 * no lo da (si llegase, iría en el chip central).
 */
export class TopBar {
  private crown?: IconButton;
  private list?: IconButton;
  private back?: IconButton;
  private gear: IconButton;
  private chip: Phaser.GameObjects.Rectangle;
  private avatar: Avatar;
  private name: Phaser.GameObjects.Text;
  private userName = '';
  bottom = 0;

  constructor(private scene: Phaser.Scene, opts: { onBack?: () => void; here: string }) {
    const go = (key: string) => () => { if (key !== opts.here) scene.scene.start(key, { from: opts.here }); };
    if (opts.onBack) this.back = new IconButton(scene, 'bar-back', 'back', opts.onBack);
    else {
      this.crown = new IconButton(scene, 'bar-hof', 'crown', go('HallOfFameScene'));
      this.list = new IconButton(scene, 'bar-results', 'list', go('MyResultsScene'));
    }
    this.gear = new IconButton(scene, 'bar-settings', 'gear', go('SettingsScene'));
    this.chip = scene.add.rectangle(0, 0, 10, 40, C.panelN).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.avatar = new Avatar(scene, '?', true);
    this.name = txt(scene, '', MIN_TEXT, C.lilac, 'left').setOrigin(0, 0.5);
    this.chip.setVisible(false); this.avatar.setVisible(false);
    void loadUser(scene).then((u) => {
      if (!scene.sys.isActive() || !u.name) return;
      this.userName = u.name;
      this.avatar.setText(u.name);
      this.chip.setVisible(true); this.avatar.setVisible(true);
      this.layout(scene.scale.width);
    });
  }

  /** Coloca la barra; devuelve la y donde empieza el contenido. */
  layout(width: number): number {
    const ins: Insets = safeInsets();
    const m = 10;
    const y = ins.top + m;
    let lx = ins.left + m;
    for (const b of [this.back, this.crown, this.list]) if (b) { b.place(lx, y); lx += BAR_BTN + 8; }
    const rx = width - ins.right - m - BAR_BTN;
    this.gear.place(rx, y);
    // Chip del usuario: centrado si cabe entre los botones; si no, pegado a la izquierda del hueco
    const room = rx - 8 - lx;
    const chars = Math.max(0, Math.floor((Math.min(room, 260) - 32 - 24 - 12) / MIN_TEXT));
    const shown = this.userName && chars >= 3 ? fitName(this.userName, chars) : '';
    this.name.setText(shown);
    const cw = shown ? 32 + 24 + this.name.width : 0;
    const cx = Math.max(lx, Math.min(width / 2 - cw / 2, rx - 8 - cw));
    this.chip.setPosition(Math.round(cx), y + 4).setSize(Math.round(cw), 40).setVisible(!!shown);
    this.avatar.place(cx + 6, y + 8, 32);
    this.avatar.setVisible(!!shown);
    this.name.setPosition(Math.round(cx + 46), y + 24);
    this.bottom = y + BAR_BTN + m;
    return this.bottom;
  }

  bounds(): UiBound[] {
    const out = [this.back, this.crown, this.list, this.gear].filter((b): b is IconButton => !!b).map((b) => b.bound());
    if (this.name.text) out.push(textBound('bar-user', this.name));
    return out;
  }
}

/** Fila de pestañas (botones con la elegida resaltada). */
export class Tabs {
  readonly buttons: Button[];
  current: number;

  constructor(scene: Phaser.Scene, idPrefix: string, labels: string[], onPick: (i: number) => void, current = 0) {
    this.current = current;
    this.buttons = labels.map((l, i) => new Button(scene, `${idPrefix}-${l.toLowerCase()}`, l, () => { this.pick(i); onPick(i); }));
    this.pick(current);
  }

  pick(i: number): void {
    this.current = i;
    this.buttons.forEach((b, j) => {
      b.bg.setFillStyle(j === i ? 0x2a2450 : C.panel2N).setStrokeStyle(j === i ? 3 : 2, j === i ? C.yellowN : C.borderN);
      b.label.setColor(j === i ? C.yellow : C.white);
      (b as unknown as { fill: number }).fill = j === i ? 0x2a2450 : C.panel2N;
    });
  }

  place(x: number, y: number, w: number, fontPx = MIN_TEXT): number {
    const gap = 8;
    const bw = (w - gap * (this.buttons.length - 1)) / this.buttons.length;
    let h = MIN_TOUCH;
    this.buttons.forEach((b, i) => { h = Math.max(h, b.place(x + i * (bw + gap), y, bw, 48, fontPx)); });
    return h;
  }

  bounds(): UiBound[] { return this.buttons.map((b) => b.bound()); }
}

/** Deslizador 0–1 (arrastre o toque en la pista). */
export class Slider {
  private track: Phaser.GameObjects.Rectangle;
  private fillBar: Phaser.GameObjects.Rectangle;
  private knob: Phaser.GameObjects.Rectangle;
  private zone: Phaser.GameObjects.Zone;
  private r: Rect = { x: 0, y: 0, w: 10, h: 44 };
  value: number;

  constructor(scene: Phaser.Scene, readonly id: string, value: number, private onChange: (v: number) => void) {
    this.value = value;
    this.track = scene.add.rectangle(0, 0, 10, 10, C.panel2N).setOrigin(0, 0.5).setStrokeStyle(2, C.borderN);
    this.fillBar = scene.add.rectangle(0, 0, 10, 10, 0xb8a8f0).setOrigin(0, 0.5);
    this.knob = scene.add.rectangle(0, 0, 24, 28, C.yellowN).setOrigin(0.5, 0.5);
    this.zone = scene.add.zone(0, 0, 10, 44).setOrigin(0, 0).setInteractive({ useHandCursor: true, draggable: false });
    const set = (p: Phaser.Input.Pointer) => {
      const v = Phaser.Math.Clamp((p.x - this.r.x) / this.r.w, 0, 1);
      this.value = Math.round(v * 20) / 20;
      this.draw();
      this.onChange(this.value);
    };
    this.zone.on('pointerdown', set);
    this.zone.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) set(p); });
  }

  place(x: number, y: number, w: number): number {
    this.r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: 48 };
    this.zone.setPosition(this.r.x - 12, this.r.y).setSize(this.r.w + 24, 48);
    this.zone.input?.hitArea.setTo(0, 0, this.r.w + 24, 48);
    this.draw();
    return 48;
  }

  private draw(): void {
    const cy = this.r.y + 24;
    this.track.setPosition(this.r.x, cy).setSize(this.r.w, 10);
    this.fillBar.setPosition(this.r.x, cy).setSize(Math.max(1, this.r.w * this.value), 10);
    this.knob.setPosition(this.r.x + this.r.w * this.value, cy);
  }

  bound(): UiBound { return { id: this.id, kind: 'button', x: this.r.x - 12, y: this.r.y, w: this.r.w + 24, h: 48 }; }
}

/** Recorte del fondo de una escena (variante ligera @1280) para el arte de tarjetas y del how-to. */
export const ART = {
  triage: { key: 'f15-art-lobby', url: 'assets/scenes/lobby/background@1280.webp' },
  campaign: { key: 'f15-art-clinic', url: 'assets/scenes/clinic_interior/background@1280.webp' },
  campaign2: { key: 'f15-art-treatment', url: 'assets/scenes/treatment_room/background@1280.webp' },
  triage2: { key: 'f15-art-server', url: 'assets/scenes/server_room/background@1280.webp' },
  triage3: { key: 'f15-art-pool', url: 'assets/scenes/recovery_pool/background@1280.webp' },
  campaign3: { key: 'f15-art-upstairs', url: 'assets/scenes/upstairs/background@1280.webp' },
} as const;
export type ArtId = keyof typeof ART;

export function preloadArt(scene: Phaser.Scene, ids: ArtId[]): void {
  for (const id of ids) if (!scene.textures.exists(ART[id].key)) scene.load.image(ART[id].key, ART[id].url);
}

/** Imagen recortada que cubre el rectángulo (cover) con máscara de recorte por crop. */
export function coverImage(img: Phaser.GameObjects.Image, x: number, y: number, w: number, h: number): void {
  const fw = img.frame.realWidth || 1;
  const fh = img.frame.realHeight || 1;
  const s = Math.max(w / fw, h / fh);
  const cw = w / s;
  const ch = h / s;
  img.setOrigin(0, 0).setScale(s).setCrop((fw - cw) / 2, (fh - ch) / 2, cw, ch);
  img.setPosition(Math.round(x - ((fw - cw) / 2) * s), Math.round(y - ((fh - ch) / 2) * s));
}

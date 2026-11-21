/**
 * F1.5 (plan FUNTICO_ADVENTURE): lobby del build Funtico con el layout del UI kit (pantallas «home» vertical y
 * horizontal), con nuestro estilo. Barra superior (Hall of Fame, Mis resultados, usuario, Ajustes), HOW TO PLAY,
 * dos tarjetas de modo con arte de las escenas (TRIAGE = práctica, CAMPAIGN = expedientes) y PLAY grande.
 * En vertical las tarjetas van en carrusel (arrastre + toque, la elegida resaltada); en horizontal, en fila.
 * Sustituye a FunticoMenuScene y usa su misma clave de escena (MENU del resultado y BACK del mapa vuelven aquí).
 * Gancho de QA: `window.__funtico.menu` = { uiBounds, selected, select(i), ready }.
 */
import Phaser from 'phaser';
import { Button, C, MIN_TEXT, safeInsets, textBound, txt, type UiBound } from '../ui';
import { funticoHook } from '../TriageScene';
import { startTriage } from '../FunticoMenuScene';
import { HOWTO_SEEN_KEY } from './HowToPlayScene';
import { LOBBY } from './Screen';
import { ART, TopBar, coverImage, preloadArt, type ArtId } from './widgets';

interface Card { id: string; art: ArtId; title: string; sub: string; frame: Phaser.GameObjects.Rectangle; img: Phaser.GameObjects.Image; band: Phaser.GameObjects.Rectangle; t1: Phaser.GameObjects.Text; t2: Phaser.GameObjects.Text; x: number; y: number; w: number; h: number }

const MODES = [
  { id: 'triage', art: 'triage' as ArtId, title: 'TRIAGE', sub: 'PRACTICE' },
  { id: 'campaign', art: 'campaign' as ArtId, title: 'CAMPAIGN', sub: 'CASE FILES' },
];

let lastSelected = 0;

export class LobbyScene extends Phaser.Scene {
  private bar!: TopBar;
  private howto!: Button;
  private play!: Button;
  private cards: Card[] = [];
  private dots: Phaser.GameObjects.Rectangle[] = [];
  private selected = 0;
  /** Posición del carrusel en «tarjetas» (0 = la primera centrada). */
  private pos = 0;
  private drag: { x: number; pos: number; moved: boolean } | null = null;
  private portrait = true;
  private band = { y: 0, h: 0 };
  private cardW = 0;
  private gap = 16;

  constructor() { super(LOBBY); }

  preload(): void {
    preloadArt(this, MODES.map((m) => m.art));
  }

  create(): void {
    this.selected = lastSelected;
    this.pos = this.selected;
    this.bar = new TopBar(this, { here: LOBBY });
    this.howto = new Button(this, 'howto', '? HOW TO PLAY', () => this.scene.start('HowToPlayScene', { from: LOBBY, mode: MODES[this.selected].id }));
    this.cards = MODES.map((m) => ({
      ...m,
      frame: this.add.rectangle(0, 0, 10, 10, C.panelN).setOrigin(0, 0),
      img: this.add.image(0, 0, ART[m.art].key),
      band: this.add.rectangle(0, 0, 10, 10, C.panel2N).setOrigin(0, 0),
      t1: txt(this, m.title, 18, C.white, 'center').setOrigin(0.5, 0.5),
      t2: txt(this, m.sub, MIN_TEXT, C.lilacDim, 'center').setOrigin(0.5, 0.5),
      x: 0, y: 0, w: 0, h: 0,
    }));
    this.dots = MODES.map(() => this.add.rectangle(0, 0, 10, 10, C.yellowN).setOrigin(0, 0));
    this.play = new Button(this, 'play', 'PLAY', () => this.startMode(), { fill: 0x2a2450 });
    this.play.bg.setStrokeStyle(3, C.yellowN);
    this.setupInput();
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      delete funticoHook().menu;
    });
    funticoHook().menu = {
      scene: this,
      uiBounds: () => this.uiBounds(),
      selected: () => MODES[this.selected].id,
      select: (i: number) => this.select(i),
    };
    // How to play automático la primera vez (`?howto=0` lo apaga para las pruebas)
    let seen = true;
    try { seen = !!localStorage.getItem(HOWTO_SEEN_KEY); } catch { /* sin almacén */ }
    if (!seen && new URLSearchParams(location.search).get('howto') !== '0') {
      this.time.delayedCall(50, () => this.scene.start('HowToPlayScene', { from: LOBBY, mode: 'triage' }));
    }
  }

  private startMode(): void {
    if (MODES[this.selected].id === 'triage') startTriage(this);
    else this.scene.start('CampaignMapScene');
  }

  select(i: number): void {
    this.selected = Phaser.Math.Clamp(i, 0, MODES.length - 1);
    lastSelected = this.selected;
    if (this.portrait) {
      this.tweens.killTweensOf(this);
      this.tweens.add({ targets: this, pos: this.selected, duration: 180, ease: 'Quad.easeOut', onUpdate: () => this.placeCards() });
    }
    this.placeCards();
  }

  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.band.y || p.y > this.band.y + this.band.h) return;
      this.drag = { x: p.x, pos: this.pos, moved: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      const dx = p.x - this.drag.x;
      if (Math.abs(dx) > 10) this.drag.moved = true;
      if (this.portrait && this.drag.moved) {
        this.pos = Phaser.Math.Clamp(this.drag.pos - dx / (this.cardW + this.gap), -0.3, MODES.length - 0.7);
        this.placeCards();
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.moved && this.portrait) {
        this.select(Math.round(this.pos));
        return;
      }
      const hit = this.cards.findIndex((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h);
      if (hit >= 0) this.select(hit);
    });
  }

  layout(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setSize(width, height);
    const ins = safeInsets();
    const ax = ins.left + 12;
    const aw = width - ins.left - ins.right - 24;
    const bottom = height - ins.bottom - 12;
    this.portrait = height > width;
    let y = this.bar.layout(width) + 4;
    if (this.portrait) {
      const hh = this.howto.place(ax, y, Math.min(260, aw), 48);
      y += hh + 16;
      const playH = 68;
      const playY = bottom - playH;
      this.play.place(ax, playY, aw, playH, 24);
      const dotsY = playY - 30;
      const cardH = Math.max(160, dotsY - 14 - y);
      this.cardW = Math.min(Math.round(aw * 0.74), Math.round(cardH * 0.68), 340);
      this.band = { y, h: cardH };
      this.cards.forEach((c) => { c.y = y; c.h = cardH; c.w = this.cardW; });
      this.dots.forEach((d, i) => d.setPosition(Math.round(width / 2 - 14 + i * 20), dotsY).setSize(10, 10).setVisible(true));
      this.pos = this.selected;
    } else {
      const rowW = Math.min(aw, 2 * 300 + this.gap);
      const rx = ax + (aw - rowW) / 2;
      const hh = this.howto.place(rx, y, Math.min(260, rowW), 44);
      y += hh + 10;
      const playH = 52;
      const playY = bottom - playH;
      this.play.place(width / 2 - 140, playY, 280, playH, 20);
      const cardH = Math.max(120, playY - 10 - y);
      this.cardW = (rowW - this.gap) / 2;
      this.band = { y, h: cardH };
      this.cards.forEach((c, i) => { c.x = rx + i * (this.cardW + this.gap); c.y = y; c.w = this.cardW; c.h = cardH; });
      this.dots.forEach((d) => d.setVisible(false));
    }
    this.placeCards();
  }

  private placeCards(): void {
    const width = this.scale.width;
    this.cards.forEach((c, i) => {
      if (this.portrait) c.x = Math.round(width / 2 - this.cardW / 2 + (i - this.pos) * (this.cardW + this.gap));
      const sel = i === this.selected;
      const labelH = Math.min(72, Math.max(56, Math.round(c.h * 0.2)));
      c.frame.setPosition(c.x, c.y).setSize(c.w, c.h).setStrokeStyle(sel ? 4 : 2, sel ? C.yellowN : C.borderN);
      coverImage(c.img, c.x + 4, c.y + 4, c.w - 8, c.h - labelH - 4);
      c.img.setAlpha(sel ? 1 : 0.55);
      c.band.setPosition(c.x + 4, c.y + c.h - labelH).setSize(c.w - 8, labelH - 4).setFillStyle(sel ? 0x2a2450 : C.panel2N);
      const tp = Math.min(20, Math.max(16, Math.floor((c.w - 24) / 9)));
      c.t1.setFontSize(tp).setColor(sel ? C.yellow : C.white).setPosition(Math.round(c.x + c.w / 2), Math.round(c.y + c.h - labelH + (labelH - 4) * 0.33));
      c.t2.setColor(sel ? C.lilac : C.lilacDim).setPosition(Math.round(c.x + c.w / 2), Math.round(c.y + c.h - labelH + (labelH - 4) * 0.72));
    });
    this.dots.forEach((d, i) => d.setFillStyle(i === this.selected ? C.yellowN : 0x5c587a));
  }

  uiBounds(): UiBound[] {
    const w = this.scale.width;
    const out: UiBound[] = [...this.bar.bounds(), this.howto.bound(), this.play.bound()];
    this.cards.forEach((c) => {
      // Recortada al viewport (en el carrusel la otra tarjeta asoma por el borde)
      const x0 = Math.max(0, c.x);
      const x1 = Math.min(w, c.x + c.w);
      if (x1 - x0 < 1) return;
      out.push({ id: `card-${c.id}`, kind: 'button', x: x0, y: c.y, w: x1 - x0, h: c.h, text: c.title });
      if (c.t1.x > 0 && c.t1.x < w) {
        const b = c.t1.getBounds();
        if (b.x >= 0 && b.right <= w) out.push(textBound(`card-${c.id}-title`, c.t1));
      }
    });
    return out;
  }
}

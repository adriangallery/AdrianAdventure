/**
 * F1.5: base de las pantallas del lobby (Hall of Fame, Mis resultados, How to play, Ajustes). Barra superior con BACK,
 * recolocación en caliente al girar o redimensionar y gancho de QA `window.__funtico.screen` = { name, uiBounds }.
 */
import Phaser from 'phaser';
import { funticoHook } from '../TriageScene';
import { C, safeInsets, txt, type UiBound } from '../ui';
import { TopBar } from './widgets';

/** Clave de la escena del lobby (la de siempre: TriageResultScene y CampaignMapScene vuelven a ella). */
export const LOBBY = 'FunticoMenuScene';

export abstract class Screen extends Phaser.Scene {
  protected bar!: TopBar;
  protected heading!: Phaser.GameObjects.Text;
  protected headBox!: Phaser.GameObjects.Rectangle;
  protected from: string = LOBBY;

  init(data?: { from?: string }): void {
    this.from = data?.from && data.from !== this.scene.key ? data.from : LOBBY;
  }

  /** Llamar al final de create(): barra, título, resize y gancho. */
  protected setupScreen(name: string, title: string): void {
    this.bar = new TopBar(this, { here: this.scene.key, onBack: () => this.goBack() });
    this.headBox = this.add.rectangle(0, 0, 10, 10, C.panelN).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.heading = txt(this, title, 18, C.yellow, 'center').setOrigin(0.5, 0.5);
    this.doLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.doLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.doLayout, this);
      if (funticoHook().screen?.scene === this) delete funticoHook().screen;
    });
    funticoHook().screen = { scene: this, name, uiBounds: () => this.allBounds() };
  }

  goBack(): void {
    this.scene.start(this.from);
  }

  protected doLayout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setSize(w, h);
    const ins = safeInsets();
    let y = this.bar.layout(w);
    const ax = ins.left + 12;
    const aw = w - ins.left - ins.right - 24;
    const portrait = h > w;
    const hh = portrait ? 52 : 44;
    this.heading.setFontSize(Math.min(22, Math.max(16, Math.floor(aw / 18))));
    this.headBox.setPosition(ax, y).setSize(aw, hh);
    this.heading.setPosition(Math.round(ax + aw / 2), Math.round(y + hh / 2 + 1));
    y += hh + 10;
    this.layoutBody({ x: ax, y, w: aw, h: h - ins.bottom - 10 - y }, portrait);
  }

  protected abstract layoutBody(area: { x: number; y: number; w: number; h: number }, portrait: boolean): void;
  protected abstract bodyBounds(): UiBound[];

  allBounds(): UiBound[] {
    const b = this.heading.getBounds();
    return [...this.bar.bounds(), { id: 'heading', kind: 'text', x: b.x, y: b.y, w: b.width, h: b.height, fontPx: parseFloat(String(this.heading.style.fontSize)) }, ...this.bodyBounds()];
  }
}

/**
 * Lista desplazable sencilla (arrastre vertical o rueda): filas de alto fijo; las que no caben enteras en el hueco se
 * ocultan (sin máscaras). `rows[i].place(x, y, w)` coloca la fila i; `rows[i].setVisible`.
 */
export interface Row { place(x: number, y: number, w: number, h: number): void; setVisible(v: boolean): void; bounds(): UiBound[] }

export class ScrollList {
  rows: Row[] = [];
  private area = { x: 0, y: 0, w: 0, h: 0 };
  private scroll = 0;
  private dragY: number | null = null;
  private start = 0;
  constructor(scene: Phaser.Scene, public rowH: number, public gap = 8) {
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.inside(p)) { this.dragY = p.y; this.start = this.scroll; } });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragY === null || !p.isDown) return;
      this.setScroll(this.start - (p.y - this.dragY));
    });
    scene.input.on('pointerup', () => { this.dragY = null; });
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => { if (this.inside(p)) this.setScroll(this.scroll + dy); });
  }

  private inside(p: Phaser.Input.Pointer): boolean {
    const a = this.area;
    return p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h;
  }

  setRows(rows: Row[]): void {
    this.rows = rows;
    this.scroll = 0;
    this.render();
  }

  place(x: number, y: number, w: number, h: number): void {
    this.area = { x, y, w, h };
    this.setScroll(this.scroll);
  }

  setScroll(s: number): void {
    const total = this.rows.length * (this.rowH + this.gap) - this.gap;
    this.scroll = Phaser.Math.Clamp(s, 0, Math.max(0, total - this.area.h));
    this.render();
  }

  private render(): void {
    const a = this.area;
    this.rows.forEach((r, i) => {
      const y = a.y + i * (this.rowH + this.gap) - this.scroll;
      const vis = y >= a.y - 0.5 && y + this.rowH <= a.y + a.h + 0.5;
      r.setVisible(vis);
      if (vis) r.place(a.x, Math.round(y), a.w, this.rowH);
    });
  }

  bounds(): UiBound[] {
    const a = this.area;
    return this.rows.flatMap((r, i) => {
      const y = a.y + i * (this.rowH + this.gap) - this.scroll;
      return y >= a.y - 0.5 && y + this.rowH <= a.y + a.h + 0.5 ? r.bounds() : [];
    });
  }
}

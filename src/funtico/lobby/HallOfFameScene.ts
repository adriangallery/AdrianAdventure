/**
 * F1.5 (plan FUNTICO_ADVENTURE): Hall of Fame a pantalla completa (pantalla «crown» del kit). Pestañas GLOBAL / MONTHLY
 * (el puente y el SDK distinguen el periodo: `GetHallOfFame(period)`; en simulado MONTHLY filtra por fecha), fila fija
 * «YOU» con la posición y lista TOP desplazable con avatar (inicial en cuadro píxel), puntos y fecha.
 */
import Phaser from 'phaser';
import type { FunticoBridge } from '../FunticoBridge';
import type { HallOfFamePlayerEntry } from '../sdk/FunticoPhaserSDK';
import { fitName } from '../fitName';
import { C, MIN_TEXT, REG, textBound, txt, type UiBound } from '../ui';
import { shortDate } from '../history';
import { Screen, ScrollList, type Row } from './Screen';
import { Avatar, Tabs, loadUser } from './widgets';

const PERIODS = ['global', 'monthly'] as const;

/** Fila del Hall of Fame: posición, avatar, nombre, puntos y fecha. */
class HofRow implements Row {
  private bg: Phaser.GameObjects.Rectangle;
  private rank: Phaser.GameObjects.Text;
  private av: Avatar;
  private name: Phaser.GameObjects.Text;
  private pts: Phaser.GameObjects.Text;
  private date: Phaser.GameObjects.Text;
  constructor(scene: Phaser.Scene, readonly id: string, private e: HallOfFamePlayerEntry, me: boolean) {
    this.bg = scene.add.rectangle(0, 0, 10, 10, me ? 0x2a2450 : C.panelN).setOrigin(0, 0).setStrokeStyle(2, me ? C.yellowN : C.borderN);
    this.rank = txt(scene, String(e.rank), MIN_TEXT, C.yellow).setOrigin(0, 0.5);
    this.av = new Avatar(scene, e.displayName, me);
    this.name = txt(scene, '', MIN_TEXT, C.white).setOrigin(0, 0.5);
    this.pts = txt(scene, String(e.totalPoints), MIN_TEXT, C.yellow, 'right').setOrigin(1, 0);
    this.date = txt(scene, e.playedAt ? shortDate(Date.parse(e.playedAt)).slice(0, 8) : '', MIN_TEXT, C.lilacDim, 'right').setOrigin(1, 1);
  }
  place(x: number, y: number, w: number, h: number): void {
    this.bg.setPosition(x, y).setSize(w, h);
    const rw = 14 * Math.max(2, String(this.e.rank).length) + 8;
    this.rank.setPosition(x + 10, y + h / 2);
    this.av.place(x + 10 + rw, y + (h - 32) / 2, 32);
    const rightW = 14 * 8 + 12;
    const nx = x + 10 + rw + 42;
    const chars = Math.max(3, Math.floor((x + w - rightW - nx - 6) / 14));
    this.name.setText(fitName(this.e.displayName, chars)).setPosition(nx, y + h / 2);
    this.pts.setPosition(x + w - 10, y + 7);
    this.date.setPosition(x + w - 10, y + h - 6);
  }
  setVisible(v: boolean): void {
    for (const o of [this.bg, this.rank, this.name, this.pts, this.date]) o.setVisible(v);
    this.av.setVisible(v);
  }
  bounds(): UiBound[] {
    return [{ id: this.id, kind: 'area', x: this.bg.x, y: this.bg.y, w: this.bg.width, h: this.bg.height },
      textBound(`${this.id}-name`, this.name), textBound(`${this.id}-pts`, this.pts)];
  }
  destroy(): void { for (const o of [this.bg, this.rank, this.name, this.pts, this.date]) o.destroy(); this.av.destroy(); }
}

export class HallOfFameScene extends Screen {
  private tabs!: Tabs;
  private youLbl!: Phaser.GameObjects.Text;
  private topLbl!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private foot!: Phaser.GameObjects.Text;
  private you: HofRow | null = null;
  private list!: ScrollList;
  private period = 0;
  private loaded = false;
  private req = 0;

  constructor() { super('HallOfFameScene'); }

  create(): void {
    this.loaded = false;
    this.you = null;
    this.tabs = new Tabs(this, 'tab', ['GLOBAL', 'MONTHLY'], (i) => { this.period = i; void this.fetchHof(); }, this.period);
    this.youLbl = txt(this, 'YOU', 16, C.lilac);
    this.topLbl = txt(this, 'TOP', 16, C.lilac);
    this.status = txt(this, 'loading...', MIN_TEXT, C.lilacDim);
    this.foot = txt(this, '', MIN_TEXT, C.lilacDim, 'center').setOrigin(0.5, 1);
    this.list = new ScrollList(this, 52, 8);
    this.setupScreen('hof', 'HALL OF FAME');
    const hook = (window as unknown as { __funtico: Record<string, unknown> }).__funtico.screen as Record<string, unknown>;
    Object.assign(hook, { loaded: () => this.loaded, period: () => PERIODS[this.period], rows: () => this.list.rows.length });
    void this.fetchHof();
  }

  private async fetchHof(): Promise<void> {
    const n = ++this.req;
    this.loaded = false;
    this.status.setText('loading...').setVisible(true);
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (!bridge) return;
    const me = await loadUser(this);
    const h = await bridge.getHallOfFame({ period: PERIODS[this.period], limit: 50, gameMode: 'practice' });
    if (!this.sys.isActive() || n !== this.req) return;
    this.you?.destroy();
    this.you = null;
    for (const r of this.list.rows as HofRow[]) r.destroy();
    if (!h.ok) {
      this.list.setRows([]);
      this.status.setText('Hall of Fame unavailable');
    } else {
      const cur = h.value.currentPlayer ?? null;
      if (cur) this.you = new HofRow(this, 'you', cur, true);
      this.list.setRows(h.value.leaderboard.map((e, i) => new HofRow(this, `top-${i + 1}`, e, e.userId === me.id)));
      this.status.setText(cur ? '' : 'No run yet: play TRIAGE!');
      this.foot.setText(`${h.value.leaderboard.length} of ${h.value.totalPlayers}`);
    }
    this.loaded = true;
    this.doLayout();
  }

  protected layoutBody(a: { x: number; y: number; w: number; h: number }, portrait: boolean): void {
    let y = a.y;
    const lw = Math.min(a.w, 640);
    const lx = a.x + (a.w - lw) / 2;
    y += this.tabs.place(lx, y, lw) + 10;
    if (!portrait && a.h < 300) {
      // Horizontal bajo: YOU a la izquierda, TOP a la derecha
      const half = (lw - 12) / 2;
      this.youLbl.setPosition(lx, y);
      this.you?.place(lx, y + 24, half, 52);
      this.status.setPosition(lx, y + 24 + (this.you ? 60 : 0));
      this.topLbl.setPosition(lx + half + 12, y);
      this.foot.setPosition(lx + half / 2, a.y + a.h);
      this.list.place(lx + half + 12, y + 24, half, a.y + a.h - y - 24);
      return;
    }
    this.youLbl.setPosition(lx, y); y += 24;
    if (this.you) { this.you.place(lx, y, lw, 52); y += 60; }
    this.status.setPosition(lx, y);
    if (this.status.text) y += 26;
    this.topLbl.setPosition(lx, y); y += 24;
    this.foot.setPosition(lx + lw / 2, a.y + a.h);
    this.list.place(lx, y, lw, a.y + a.h - 24 - y);
  }

  protected bodyBounds(): UiBound[] {
    const out = [...this.tabs.bounds(), textBound('you-label', this.youLbl), textBound('top-label', this.topLbl), ...(this.you?.bounds() ?? []), ...this.list.bounds()];
    if (this.status.text) out.push(textBound('status', this.status));
    if (this.foot.text) out.push(textBound('foot', this.foot));
    return out;
  }
}

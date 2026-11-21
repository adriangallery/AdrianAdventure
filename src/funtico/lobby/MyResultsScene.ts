/**
 * F1.5 (plan FUNTICO_ADVENTURE): «MY RESULTS» (pantalla «list» del kit). Pestañas TRIAGE / CAMPAIGN con el guardado
 * local: carreras de Triage (history.ts: puntuación y fecha, la mejor marcada) y expedientes de Campaign
 * (campaign/progress.ts: estrellas, veces terminado y mejor tiempo).
 */
import Phaser from 'phaser';
import { C, MIN_TEXT, textBound, txt, type UiBound } from '../ui';
import { bestScore, loadTriageHistory, shortDate } from '../history';
import { CASE_COUNT, PLAYABLE_CASES, caseRecord, loadProgress } from '../campaign/progress';
import { StarRow } from '../campaign/widgets';
import { Screen, ScrollList, type Row } from './Screen';
import { Tabs, loadUser } from './widgets';

class ResultRow implements Row {
  private bg: Phaser.GameObjects.Rectangle;
  private t1: Phaser.GameObjects.Text;
  private t2: Phaser.GameObjects.Text;
  private r1: Phaser.GameObjects.Text;
  private r2: Phaser.GameObjects.Text;
  private stars: StarRow | null;
  constructor(scene: Phaser.Scene, readonly id: string, title: string, sub: string, rTop: string, rBottom: string, private starCount: number | null, hi = false) {
    this.bg = scene.add.rectangle(0, 0, 10, 10, hi ? 0x2a2450 : C.panelN).setOrigin(0, 0).setStrokeStyle(2, hi ? C.yellowN : C.borderN);
    this.t1 = txt(scene, title, MIN_TEXT, C.white);
    this.t2 = txt(scene, sub, MIN_TEXT, C.lilacDim);
    this.r1 = txt(scene, rTop, MIN_TEXT, C.lilacDim, 'right').setOrigin(1, 0);
    this.r2 = txt(scene, rBottom, 16, C.yellow, 'right').setOrigin(1, 0);
    this.stars = starCount === null ? null : new StarRow(scene, 3);
  }
  place(x: number, y: number, w: number, h: number): void {
    this.bg.setPosition(x, y).setSize(w, h);
    this.t1.setPosition(x + 12, y + 12);
    this.t2.setPosition(x + 12, y + h - 12 - 16);
    this.r1.setPosition(x + w - 12, y + 12);
    if (this.stars) this.stars.place(x + w - 12 - 3 * 20 - 10, y + h - 12 - 20, 20, this.starCount ?? 0);
    this.r2.setPosition(x + w - 12, y + h - 12 - 18);
  }
  setVisible(v: boolean): void {
    for (const o of [this.bg, this.t1, this.t2, this.r1, this.r2]) o.setVisible(v);
    this.stars?.setVisible(v);
  }
  bounds(): UiBound[] {
    return [{ id: this.id, kind: 'area', x: this.bg.x, y: this.bg.y, w: this.bg.width, h: this.bg.height }, textBound(`${this.id}-title`, this.t1), ...(this.r2.text ? [textBound(`${this.id}-value`, this.r2)] : [])];
  }
  destroy(): void { for (const o of [this.bg, this.t1, this.t2, this.r1, this.r2]) o.destroy(); for (const s of this.stars?.stars ?? []) s.destroy(); }
}

export class MyResultsScene extends Screen {
  private tabs!: Tabs;
  private list!: ScrollList;
  private empty!: Phaser.GameObjects.Text;
  private tab = 0;
  private userId: number | null = null;

  constructor() { super('MyResultsScene'); }

  create(): void {
    this.tabs = new Tabs(this, 'tab', ['TRIAGE', 'CAMPAIGN'], (i) => { this.tab = i; this.fill(); }, this.tab);
    this.list = new ScrollList(this, 76, 8);
    this.empty = txt(this, '', MIN_TEXT, C.lilacDim, 'center').setOrigin(0.5, 0);
    this.setupScreen('results', 'MY RESULTS');
    const hook = (window as unknown as { __funtico: Record<string, unknown> }).__funtico.screen as Record<string, unknown>;
    Object.assign(hook, { tab: () => (this.tab ? 'campaign' : 'triage'), rows: () => this.list.rows.length });
    void loadUser(this).then((u) => { if (this.sys.isActive()) { this.userId = u.id; this.fill(); } });
  }

  private fill(): void {
    for (const r of this.list.rows as ResultRow[]) r.destroy();
    let rows: ResultRow[] = [];
    if (this.tab === 0) {
      const runs = loadTriageHistory(localStorage, this.userId);
      const best = bestScore(runs);
      let marked = false;
      rows = runs.map((r, i) => {
        const isBest = !marked && r.score === best;
        if (isBest) marked = true;
        return new ResultRow(this, `run-${i + 1}`, isBest ? 'TRIAGE  BEST' : 'TRIAGE', shortDate(r.at), 'SCORE', String(r.score), null, isBest);
      });
      this.empty.setText(rows.length ? '' : 'No runs yet.\nPick TRIAGE and PLAY!');
    } else {
      const p = loadProgress(localStorage, this.userId);
      for (let ch = 1; ch <= CASE_COUNT; ch++) {
        if (!PLAYABLE_CASES.includes(ch)) continue;
        const rec = caseRecord(p, ch);
        const t = rec.bestTimeS === null ? '--:--' : `${Math.floor(rec.bestTimeS / 60)}:${String(Math.floor(rec.bestTimeS % 60)).padStart(2, '0')}`;
        rows.push(new ResultRow(this, `case-${ch}`, `CASE ${ch}`, rec.completions ? `DONE x${rec.completions}  ${t}` : 'NOT SOLVED', '', '', rec.stars));
      }
      this.empty.setText('');
    }
    this.list.setRows(rows);
    this.doLayout();
  }

  protected layoutBody(a: { x: number; y: number; w: number; h: number }): void {
    const lw = Math.min(a.w, 640);
    const lx = a.x + (a.w - lw) / 2;
    const y = a.y + this.tabs.place(lx, a.y, lw) + 12;
    this.empty.setPosition(lx + lw / 2, y + 20);
    this.list.place(lx, y, lw, a.y + a.h - y);
  }

  protected bodyBounds(): UiBound[] {
    return [...this.tabs.bounds(), ...this.list.bounds(), ...(this.empty.text ? [textBound('empty', this.empty)] : [])];
  }
}

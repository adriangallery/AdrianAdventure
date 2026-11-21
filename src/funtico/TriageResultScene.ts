/**
 * F1.2 (plan FUNTICO_ADVENTURE): resultado de Triage. `scoreRun` con el registro de toques, envío por el puente
 * (`CompletePractice`, simulado en modo mock) y Hall of Fame con la posición del jugador. PLAY AGAIN y MENU.
 */
import Phaser from 'phaser';
import type { FunticoBridge } from './FunticoBridge';
import type { TriageModel } from './triage/TriageModel';
import type { ScoreResult } from './triage/triage';
import { Button, C, MIN_TEXT, REG, safeInsets, textBound, txt, type UiBound } from './ui';
import { funticoHook } from './TriageScene';
import { hofLines, startTriage } from './FunticoMenuScene';

const KIND: Record<string, string> = { sample: 'SAMPLE', symptom: 'SYMPTOM', relapse: 'RELAPSE' };

export class TriageResultScene extends Phaser.Scene {
  private model!: TriageModel;
  private result!: ScoreResult;
  private head!: Phaser.GameObjects.Text;
  private big!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private breakdown!: Phaser.GameObjects.Text;
  private hofTitle!: Phaser.GameObjects.Text;
  private hof!: Phaser.GameObjects.Text;
  private again!: Button;
  private menu!: Button;
  private submitted: { ok: boolean; rank: number | null; inHof: boolean; hof: Array<{ name: string; points: number; rank: number; me: boolean }> } | null = null;

  constructor() {
    super('TriageResultScene');
  }

  init(data: { model: TriageModel }): void {
    this.model = data.model;
    this.result = data.model.result();
    this.submitted = null;
  }

  create(): void {
    this.sound.stopByKey('tri-music');
    const r = this.result;
    const n = this.model.run.stations.length;
    this.head = txt(this, r.completed ? 'SHIFT COMPLETE' : 'TIME\'S UP, DOCTOR', MIN_TEXT, C.lilac, 'center').setOrigin(0.5, 0);
    this.big = txt(this, String(r.score), 40, C.yellow, 'center').setOrigin(0.5, 0);
    this.stats = txt(this, [
      `HITS ${r.hits}/${n}   MISSES ${r.misses}`,
      `TIME BONUS +${r.leftoverBonus}`,
      `BEST STREAK ${this.model.bestStreak}`,
    ].join('\n'), MIN_TEXT, C.white, 'center').setOrigin(0.5, 0);
    this.breakdown = txt(this, r.stations.map((s) => {
      const res = s.closedAt === null ? '----' : s.hit ? 'CURED' : 'LOST';
      return `${s.i + 1} ${KIND[s.kind].padEnd(7)} ${res.padEnd(5)} ${String(s.points).padStart(5)}`;
    }).join('\n'), MIN_TEXT, C.lilac, 'left').setOrigin(0.5, 0);
    this.hofTitle = txt(this, 'HALL OF FAME', MIN_TEXT, C.yellow, 'center').setOrigin(0.5, 0);
    this.hof = txt(this, 'sending...', MIN_TEXT, C.white, 'left').setOrigin(0.5, 0);
    this.again = new Button(this, 'play-again', 'PLAY AGAIN', () => startTriage(this), { fill: 0x2a2450 });
    this.menu = new Button(this, 'menu', 'MENU', () => this.scene.start('FunticoMenuScene'));
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      delete funticoHook().result;
    });
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters del gancho de pruebas
    const scene = this;
    funticoHook().result = {
      score: r.score,
      result: r,
      taps: [...this.model.taps],
      run: this.model.run,
      get shownScore() { return Number(scene.big.text); },
      get submitted() { return scene.submitted; },
      uiBounds: () => this.uiBounds(),
    };
    void this.submit();
  }

  private async submit(): Promise<void> {
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (!bridge) return;
    await bridge.init();
    const events = this.model.taps.map((e) => JSON.stringify(e));
    const sent = await bridge.completePractice(this.result.score, { gameEvents: events });
    const u = await bridge.getUser();
    const h = await bridge.getHallOfFame({ period: 'monthly', limit: 5, gameMode: 'practice' });
    if (!this.sys.isActive()) return;
    const me = u.ok ? u.value.UserId : -1;
    if (h.ok) {
      const top = h.value.leaderboard.slice(0, 5);
      const cur = h.value.currentPlayer ?? null;
      let text = hofLines(top, me, 10);
      if (cur && !top.some((e) => e.userId === me)) text += `\n  ...\n${hofLines([cur], me, 10)}`;
      this.hof.setText(text);
      this.submitted = {
        ok: sent.ok,
        rank: cur?.rank ?? null,
        inHof: !!cur && cur.totalPoints >= this.result.score,
        hof: [...top, ...(cur && !top.some((e) => e.userId === me) ? [cur] : [])].map((e) => ({ name: e.displayName, points: e.totalPoints, rank: e.rank, me: e.userId === me })),
      };
      if (cur) this.hofTitle.setText(`HALL OF FAME - YOU: #${cur.rank}`);
    } else {
      this.hof.setText('Hall of Fame unavailable');
      this.submitted = { ok: sent.ok, rank: null, inHof: false, hof: [] };
    }
    this.layout(this.scale.width, this.scale.height);
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.layout(size.width, size.height);
  }

  layout(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
    const ins = safeInsets();
    const ax = ins.left;
    const aw = width - ins.left - ins.right;
    const ay = ins.top;
    const ah = height - ins.top - ins.bottom;
    const portrait = height > width;
    const base = Phaser.Math.Clamp(Math.round(Math.min(width, height) / 50), MIN_TEXT, 20);
    for (const t of [this.head, this.stats, this.breakdown, this.hofTitle, this.hof]) t.setFontSize(base).setLineSpacing(Math.round(base * 0.45));
    this.big.setFontSize(Phaser.Math.Clamp(Math.round(Math.min(width, height) / 12), 28, 72));
    const btnW = Math.min(portrait ? (aw - 40) / 2 : 220, 260);
    if (portrait) {
      const cx = ax + aw / 2;
      let y = ay + 14;
      this.head.setPosition(cx, y); y += this.head.height + 8;
      this.big.setPosition(cx, y); y += this.big.height + 10;
      this.stats.setPosition(cx, y); y += this.stats.height + 14;
      this.breakdown.setPosition(cx, y); y += this.breakdown.height + 14;
      this.hofTitle.setPosition(cx, y); y += this.hofTitle.height + 8;
      this.hof.setPosition(cx, y);
      const by = ay + ah - 12 - 52;
      this.again.place(cx - btnW - 6, by, btnW, 52, base);
      this.menu.place(cx + 6, by, btnW, 52, base);
    } else {
      const lx = ax + aw * 0.27;
      const rx = ax + aw * 0.72;
      let y = ay + 10;
      this.head.setPosition(lx, y); y += this.head.height + 6;
      this.big.setPosition(lx, y); y += this.big.height + 8;
      this.stats.setPosition(lx, y); y += this.stats.height + 12;
      const by = Math.min(y, ay + ah - 8 - 2 * 48 - 8);
      this.again.place(lx - btnW / 2, by, btnW, 44, base);
      this.menu.place(lx - btnW / 2, by + 52, btnW, 44, base);
      let ry = ay + 10;
      this.breakdown.setPosition(rx, ry); ry += this.breakdown.height + 10;
      this.hofTitle.setPosition(rx, ry); ry += this.hofTitle.height + 6;
      this.hof.setPosition(rx, ry);
    }
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [this.again.bound(), this.menu.bound()];
    for (const [id, t] of [['head', this.head], ['score', this.big], ['stats', this.stats], ['breakdown', this.breakdown], ['hof-title', this.hofTitle], ['hof', this.hof]] as const) {
      if (t.text) out.push(textBound(id, t));
    }
    return out;
  }
}

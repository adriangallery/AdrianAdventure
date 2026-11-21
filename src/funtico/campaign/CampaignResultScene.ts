/**
 * F3.2a (plan FUNTICO_ADVENTURE): resultado de un expediente. Se abre encima del juego (GameScene y UIScene en pausa)
 * cuando llega `onChapterComplete(N)` del capítulo que se juega. Pinta las métricas (time_s, hints, fails, actions,
 * optional), las estrellas SIMULADAS con las reglas locales (stars.ts) y las reglas con su marca; apunta el progreso
 * (progress.ts), avisa al puente (`completeCampaignLevel`, en mock) y ofrece NEXT CASE / MAP / RETRY.
 * Vertical y horizontal, recolocación en caliente.
 */
import Phaser from 'phaser';
import { CHAPTERS } from '@/systems/ChapterManager';
import type { FunticoBridge } from '../FunticoBridge';
import type { ChapterMetrics } from '../CampaignMetrics';
import { Button, C, MIN_TEXT, REG, safeInsets, textBound, txt, type UiBound } from '../ui';
import { computeStars, formatTime, parFor, starChecks, starRuleLines } from './stars';
import {
  UNLOCKS, caseState, loadProgress, recordResult, saveProgressTo, PLAYABLE_CASES, type RecordOutcome,
} from './progress';
import { StarRow } from './widgets';
import { campaignHook, chapterUrl, go, mapUrl } from './context';

export interface ResultData {
  chapter: number;
  metrics: ChapterMetrics;
  userId: number | string | null;
  /** Se llama al guardar el resultado (borra la partida en curso del capítulo). */
  onRecorded?: () => void;
}

export class CampaignResultScene extends Phaser.Scene {
  private data0!: ResultData;
  private dim!: Phaser.GameObjects.Rectangle;
  private panel!: Phaser.GameObjects.Rectangle;
  private heading!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private stars!: StarRow;
  private stats!: Phaser.GameObjects.Text;
  private rulesTitle!: Phaser.GameObjects.Text;
  private rules!: Phaser.GameObjects.Text;
  private news!: Phaser.GameObjects.Text;
  private next!: Button;
  private map!: Button;
  private retry!: Button;
  private starCount = 0;
  private outcome: RecordOutcome | null = null;

  constructor() {
    super('CampaignResultScene');
  }

  init(data: ResultData): void {
    this.data0 = data;
  }

  create(): void {
    const { chapter, metrics, userId } = this.data0;
    this.starCount = computeStars(chapter, metrics);
    const before = loadProgress(localStorage, userId);
    this.outcome = recordResult(before, chapter, this.starCount, metrics.time_s);
    saveProgressTo(localStorage, userId, this.outcome.progress);
    this.data0.onRecorded?.();
    const hook = campaignHook();
    hook.result = { chapter, stars: this.starCount, metrics, outcome: this.outcome, uiBounds: () => this.uiBounds(), bridge: null };
    void this.report(hook.result as Record<string, unknown>);

    this.dim = this.add.rectangle(0, 0, 10, 10, C.bgN, 0.88).setOrigin(0, 0).setInteractive();
    this.panel = this.add.rectangle(0, 0, 10, 10, C.panelN, 0.96).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    const title = CHAPTERS.find((c) => c.id === chapter)?.title.toUpperCase() ?? `CHAPTER ${chapter}`;
    this.heading = txt(this, this.starCount > 0 ? `CASE ${chapter} CLOSED` : `CASE ${chapter}`, 24, C.yellow, 'center').setOrigin(0.5, 0);
    this.sub = txt(this, title, MIN_TEXT, C.lilac, 'center').setOrigin(0.5, 0);
    this.stars = new StarRow(this);
    const par = parFor(chapter);
    this.stats = txt(this, [
      `TIME     ${formatTime(metrics.time_s)}${par !== null ? `  PAR ${formatTime(par)}` : ''}`,
      `HINTS    ${metrics.hints}  (MAX LEVEL ${metrics.hint_max_level})`,
      `FAILS    ${metrics.fails}`,
      `ACTIONS  ${metrics.actions}`,
      `EXTRAS   ${metrics.optional}`,
    ].join('\n'), MIN_TEXT, C.white, 'left');
    const ok = starChecks(chapter, metrics);
    const marks = [ok.finish, ok.finish && ok.lowHints, this.starCount >= 3];
    this.rulesTitle = txt(this, 'STAR RULES (LOCAL)', MIN_TEXT, C.yellow, 'left');
    this.rules = txt(this, starRuleLines(chapter).map((l, i) => `${marks[i] ? '[x]' : '[ ]'} ${'*'.repeat(i + 1)} ${l}`).join('\n'), MIN_TEXT, C.white, 'left');
    const news: string[] = [];
    if (this.outcome.newBestStars && before.cases[String(chapter)]) news.push('NEW BEST STARS');
    if (this.outcome.unlockedCase) news.push(`CASE ${this.outcome.unlockedCase} UNLOCKED`);
    for (const id of this.outcome.newUnlocks) news.push(`UNLOCKED: ${UNLOCKS.find((u) => u.id === id)?.label ?? id}`);
    this.news = txt(this, news.join('\n'), MIN_TEXT, C.green, 'center').setOrigin(0.5, 0);
    const nextCase = chapter + 1;
    const nextOpen = PLAYABLE_CASES.includes(nextCase) && caseState(this.outcome.progress, nextCase) === 'open';
    this.next = new Button(this, 'next', 'NEXT CASE', () => go(chapterUrl(nextCase)), { fill: 0x2a2450 }).setEnabled(nextOpen);
    this.map = new Button(this, 'map', 'MAP', () => go(mapUrl()));
    this.retry = new Button(this, 'retry', 'RETRY', () => go(chapterUrl(chapter)));
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  /** Avisa al puente (en mock calcula y guarda sus propias estrellas; F3.4 usará las del servidor). */
  private async report(hook: Record<string, unknown>): Promise<void> {
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (!bridge) return;
    const m = this.data0.metrics;
    const r = await bridge.completeCampaignLevel({
      completed: m.completed, time_s: m.time_s, hints: m.hints, hint_max_level: m.hint_max_level, fails: m.fails,
      duel_losses: m.duel_losses, optional: m.optional, actions: m.actions,
    });
    hook.bridge = r.ok ? { ok: true, stars: r.value.Stars, isWin: r.value.IsWin } : { ok: false, error: r.error.code };
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.layout(size.width, size.height);
  }

  layout(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
    this.dim.setSize(width, height);
    this.dim.input?.hitArea.setTo(0, 0, width, height);
    const ins = safeInsets();
    const m = 12;
    const ax = ins.left + m;
    const ay = ins.top + m;
    const aw = width - ins.left - ins.right - 2 * m;
    const ah = height - ins.top - ins.bottom - 2 * m;
    const portrait = height >= width;
    const base = Phaser.Math.Clamp(Math.round(Math.min(width, height) / 46), MIN_TEXT, 20);
    const gap = Math.max(6, Math.round(base * 0.6));
    for (const t of [this.sub, this.stats, this.rulesTitle, this.rules, this.news]) t.setFontSize(base).setLineSpacing(Math.round(base * 0.45));
    const starSize = Math.round(base * 2.6);
    const placeButtons = (x: number, y: number, w: number): number => {
      const bw = (w - 2 * gap) / 3;
      const hs = [this.next, this.map, this.retry].map((b, i) => b.place(x + i * (bw + gap), y, bw, 52, base));
      const h = Math.max(...hs);
      [this.next, this.map, this.retry].forEach((b, i) => b.place(x + i * (bw + gap), y, bw, h, base));
      return h;
    };
    if (portrait) {
      const w = Math.min(aw, 560);
      const x = ax + (aw - w) / 2;
      const cx = x + w / 2;
      this.heading.setFontSize(Phaser.Math.Clamp(Math.floor((w - 2 * gap) / 16), 18, 32));
      for (const t of [this.sub, this.rules, this.news]) t.setWordWrapWidth(w - 2 * gap, true);
      const place = (top: number): number => {
        let y = top + gap;
        this.heading.setPosition(cx, y);
        y += this.heading.height + gap;
        this.sub.setPosition(cx, y);
        y += this.sub.height + gap * 2;
        const sw = this.stars.place(0, 0, starSize, this.starCount);
        this.stars.place(cx - sw / 2, y, starSize, this.starCount);
        y += starSize + gap * 2;
        this.stats.setPosition(x + gap, y);
        y += this.stats.height + gap * 2;
        this.rulesTitle.setPosition(x + gap, y);
        y += this.rulesTitle.height + gap;
        this.rules.setPosition(x + gap, y);
        y += this.rules.height + gap * 2;
        if (this.news.text) {
          this.news.setPosition(cx, y);
          y += this.news.height + gap * 2;
        }
        y += placeButtons(x, y, w) + gap;
        return y - top;
      };
      const total = place(ay);
      const top = ay + Math.max(0, Math.round((ah - total) / 2));
      place(top);
      this.panel.setPosition(x - 4, top - 4).setSize(w + 8, Math.min(total + 8, height - top + 4));
    } else {
      const w = Math.min(aw, 1100);
      const x = ax + (aw - w) / 2;
      const lw = Math.round(w * 0.42);
      const lcx = x + lw / 2;
      const rx = x + lw + gap * 2;
      const rw = x + w - rx;
      this.heading.setFontSize(Phaser.Math.Clamp(Math.floor((lw - 2 * gap) / 16), 18, 36));
      this.sub.setWordWrapWidth(lw - 2 * gap, true);
      this.news.setWordWrapWidth(lw - 2 * gap, true);
      this.rules.setWordWrapWidth(rw - gap, true);
      const place = (top: number): number => {
        let y = top + gap;
        this.heading.setPosition(lcx, y);
        y += this.heading.height + gap;
        this.sub.setPosition(lcx, y);
        y += this.sub.height + gap * 2;
        const sw = this.stars.place(0, 0, starSize, this.starCount);
        this.stars.place(lcx - sw / 2, y, starSize, this.starCount);
        y += starSize + gap * 2;
        if (this.news.text) {
          this.news.setPosition(lcx, y);
          y += this.news.height + gap;
        }
        let ry = top + gap;
        this.stats.setPosition(rx, ry);
        ry += this.stats.height + gap * 2;
        this.rulesTitle.setPosition(rx, ry);
        ry += this.rulesTitle.height + gap;
        this.rules.setPosition(rx, ry);
        ry += this.rules.height + gap * 2;
        let by = Math.max(y, ry);
        by += placeButtons(x + gap, by, w - 2 * gap) + gap;
        return by - top;
      };
      const total = place(ay);
      const top = ay + Math.max(0, Math.round((ah - total) / 2));
      place(top);
      this.panel.setPosition(x - 4, top - 4).setSize(w + 8, Math.min(total + 8, height - top + 4));
    }
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [this.next.bound(), this.map.bound(), this.retry.bound()];
    for (const [id, t] of [['heading', this.heading], ['subtitle', this.sub], ['stats', this.stats], ['rules-title', this.rulesTitle], ['rules', this.rules], ['news', this.news]] as const) {
      if (t.text) out.push(textBound(id, t));
    }
    return out;
  }
}

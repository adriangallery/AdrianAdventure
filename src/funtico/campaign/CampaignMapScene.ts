/**
 * F3.2a (plan FUNTICO_ADVENTURE): mapa de Campaign. Cinco expedientes («case files», los títulos de
 * ChapterManager.CHAPTERS): 1 y 2 jugables (el 2 se abre con ≥ 1 estrella en el 1), 3–5 «COMING SOON». Cada expediente
 * pinta sus estrellas (0–3) y su mejor tiempo. Debajo, los desbloqueos cosméticos por estrellas totales (se encienden y
 * apagan aquí). En vertical, una columna; en horizontal, panel a la izquierda y expedientes en dos columnas. Se
 * recoloca en caliente (Scale.RESIZE). Abrir un expediente navega a campaign.html?chapter=N.
 */
import Phaser from 'phaser';
import { CHAPTERS } from '@/systems/ChapterManager';
import type { FunticoBridge } from '../FunticoBridge';
import { Button, C, MIN_TEXT, MIN_TOUCH, REG, safeInsets, textBound, txt, type UiBound } from '../ui';
import { formatTime } from './stars';
import {
  CASE_COUNT, UNLOCKS, caseRecord, caseState, isActive, isUnlocked, loadProgress, saveProgressTo, toggleCosmetic,
  totalStars, type CampaignProgress, type CaseState, type CosmeticId,
} from './progress';
import { StarRow } from './widgets';
import { campaignHook, chapterUrl, go } from './context';

interface Card {
  chapter: number;
  state: CaseState;
  bg: Phaser.GameObjects.Rectangle;
  head: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  stars: StarRow;
}

export class CampaignMapScene extends Phaser.Scene {
  private heading!: Phaser.GameObjects.Text;
  private total!: Phaser.GameObjects.Text;
  private extrasTitle!: Phaser.GameObjects.Text;
  private cards: Card[] = [];
  private cosmetics: Array<{ id: CosmeticId; btn: Button }> = [];
  private back!: Button;
  private progress: CampaignProgress = loadProgress({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, null);
  private userId: number | string | null = null;
  private ready = false;

  constructor() {
    super('CampaignMapScene');
  }

  create(): void {
    this.cards = [];
    this.cosmetics = [];
    this.ready = false;
    this.heading = txt(this, 'CASE FILES', 24, C.yellow, 'left');
    this.total = txt(this, '', MIN_TEXT, C.lilac, 'left');
    this.extrasTitle = txt(this, 'UNLOCKS', MIN_TEXT, C.yellow, 'left');
    for (let n = 1; n <= CASE_COUNT; n++) {
      const bg = this.add.rectangle(0, 0, 10, 10, C.panel2N).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
      const card: Card = {
        chapter: n,
        state: 'soon',
        bg,
        head: txt(this, `CASE ${n}`, MIN_TEXT, C.yellow, 'left'),
        title: txt(this, CHAPTERS.find((c) => c.id === n)?.title.toUpperCase() ?? `CHAPTER ${n}`, MIN_TEXT, C.white, 'left'),
        status: txt(this, '', MIN_TEXT, C.lilacDim, 'left'),
        stars: new StarRow(this),
      };
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => { if (card.state === 'open') bg.setFillStyle(C.borderN); });
      bg.on('pointerout', () => bg.setFillStyle(card.state === 'open' ? C.panel2N : C.panelN));
      bg.on('pointerup', () => {
        bg.setFillStyle(card.state === 'open' ? C.panel2N : C.panelN);
        if (card.state === 'open') this.openCase(n);
      });
      this.cards.push(card);
    }
    for (const u of UNLOCKS) {
      this.cosmetics.push({ id: u.id, btn: new Button(this, `unlock-${u.id}`, u.label, () => this.toggle(u.id)) });
    }
    this.back = new Button(this, 'back', 'BACK', () => this.scene.start('FunticoMenuScene'));
    this.refresh();
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      delete campaignHook().map;
    });
    campaignHook().map = {
      uiBounds: () => this.uiBounds(),
      ready: () => this.ready,
      progress: () => this.progress,
      userId: () => this.userId,
      cases: () => this.cards.map((c) => ({ chapter: c.chapter, state: c.state, ...caseRecord(this.progress, c.chapter) })),
      open: (n: number) => this.openCase(n),
      toggle: (id: CosmeticId) => this.toggle(id),
    };
    void this.loadUser();
  }

  private async loadUser(): Promise<void> {
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (bridge) {
      await bridge.init();
      const u = await bridge.getUser();
      if (!this.sys.isActive()) return;
      this.userId = u.ok ? u.value.UserId : null;
    }
    this.progress = loadProgress(localStorage, this.userId);
    this.ready = true;
    this.refresh();
    this.layout(this.scale.width, this.scale.height);
  }

  private openCase(n: number): void {
    if (!this.ready || caseState(this.progress, n) !== 'open') return;
    go(chapterUrl(n));
  }

  private toggle(id: CosmeticId): void {
    if (!this.ready || !isUnlocked(this.progress, id)) return;
    this.progress = toggleCosmetic(this.progress, id);
    saveProgressTo(localStorage, this.userId, this.progress);
    this.refresh();
    this.layout(this.scale.width, this.scale.height);
  }

  private refresh(): void {
    const total = totalStars(this.progress);
    this.total.setText(`STARS ${total}/${CASE_COUNT * 3}`);
    for (const c of this.cards) {
      c.state = this.ready ? caseState(this.progress, c.chapter) : (c.chapter <= 2 ? 'locked' : 'soon');
      const rec = caseRecord(this.progress, c.chapter);
      if (c.state === 'soon') c.status.setText('COMING SOON').setColor(C.grey);
      else if (c.state === 'locked') c.status.setText(`LOCKED: CASE ${c.chapter - 1} FIRST`).setColor(C.grey);
      else if (rec.bestTimeS !== null) c.status.setText(`BEST ${formatTime(rec.bestTimeS)}  PLAY`).setColor(C.green);
      else c.status.setText('PLAY').setColor(C.green);
      c.bg.setFillStyle(c.state === 'open' ? C.panel2N : C.panelN);
      c.head.setAlpha(c.state === 'open' ? 1 : 0.6);
      c.title.setColor(c.state === 'soon' ? C.grey : C.white);
      c.stars.setVisible(c.state !== 'soon');
    }
    for (const { id, btn } of this.cosmetics) {
      const def = UNLOCKS.find((u) => u.id === id)!;
      if (!isUnlocked(this.progress, id)) btn.setText(`${def.label}\nLOCKED: ${def.stars} STARS`).setEnabled(false);
      else btn.setText(`${def.label}\n${isActive(this.progress, id) ? 'ON' : 'OFF'}`).setEnabled(true);
    }
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.layout(size.width, size.height);
  }

  /** Coloca un expediente en (x, y) con ancho w; devuelve su alto. */
  private placeCard(c: Card, x: number, y: number, w: number, fs: number, minH = 0): number {
    const pad = Math.max(8, Math.round(fs * 0.6));
    const starSize = Math.round(fs * 1.3);
    const starsW = 3 * starSize + 2 * Math.round(starSize * 0.25);
    for (const t of [c.head, c.title, c.status]) t.setFontSize(fs).setLineSpacing(Math.round(fs * 0.4));
    c.title.setWordWrapWidth(Math.max(40, w - 2 * pad), true);
    c.status.setWordWrapWidth(Math.max(40, w - 2 * pad), true);
    let yy = y + pad;
    c.head.setPosition(Math.round(x + pad), Math.round(yy));
    c.stars.place(x + w - pad - starsW, yy + (c.head.height - starSize) / 2, starSize, caseRecord(this.progress, c.chapter).stars);
    yy += Math.max(c.head.height, starSize) + Math.round(fs * 0.4);
    c.title.setPosition(Math.round(x + pad), Math.round(yy));
    yy += c.title.height + Math.round(fs * 0.4);
    c.status.setPosition(Math.round(x + pad), Math.round(yy));
    yy += c.status.height + pad;
    const h = Math.max(MIN_TOUCH, minH, Math.ceil(yy - y));
    c.bg.setPosition(Math.round(x), Math.round(y)).setSize(Math.round(w), h);
    c.bg.input?.hitArea.setTo(0, 0, Math.round(w), h);
    return h;
  }

  layout(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
    const ins = safeInsets();
    const m = 12;
    const ax = ins.left + m;
    const ay = ins.top + m;
    const aw = width - ins.left - ins.right - 2 * m;
    const ah = height - ins.top - ins.bottom - 2 * m;
    const portrait = height >= width;
    const base = Phaser.Math.Clamp(Math.round(Math.min(width, height) / 46), MIN_TEXT, 20);
    this.total.setFontSize(base);
    this.extrasTitle.setFontSize(base);
    const gap = Math.max(6, Math.round(base * 0.5));
    if (portrait) {
      const w = Math.min(aw, 560);
      const x = ax + (aw - w) / 2;
      this.heading.setFontSize(Phaser.Math.Clamp(Math.floor(w / 12), 18, 36));
      const place = (top: number): number => {
        let y = top;
        this.heading.setPosition(x, y);
        y += this.heading.height + gap;
        this.total.setPosition(x, y);
        y += this.total.height + gap * 2;
        for (const c of this.cards) y += this.placeCard(c, x, y, w, base) + gap;
        y += gap;
        this.extrasTitle.setPosition(x, y);
        y += this.extrasTitle.height + gap;
        const bw = (w - gap) / 2;
        const hs = this.cosmetics.map(({ btn }, i) => btn.place(x + i * (bw + gap), y, bw, 48, base));
        // los dos del mismo alto
        const hh = Math.max(...hs);
        this.cosmetics.forEach(({ btn }, i) => btn.place(x + i * (bw + gap), y, bw, hh, base));
        y += hh + gap * 2;
        y += this.back.place(x, y, w, MIN_TOUCH + 4, base);
        return y - top;
      };
      const total = place(ay);
      if (total < ah) place(ay + Math.round((ah - total) / 2));
    } else {
      const lw = Math.min(Math.round(aw * 0.34), 420);
      const lx = ax;
      this.heading.setFontSize(Phaser.Math.Clamp(Math.floor(lw / 11), 18, 40));
      let y = ay;
      this.heading.setPosition(lx, y);
      y += this.heading.height + gap;
      this.total.setPosition(lx, y);
      y += this.total.height + gap * 3;
      this.extrasTitle.setPosition(lx, y);
      y += this.extrasTitle.height + gap;
      for (const { btn } of this.cosmetics) y += btn.place(lx, y, lw, 48, base) + gap;
      this.back.place(lx, Math.max(y + gap, ay + ah - Math.max(MIN_TOUCH, 48)), lw, MIN_TOUCH + 4, base);
      const rx = lx + lw + 2 * gap + 8;
      const rw = ax + aw - rx;
      const cw = (rw - gap) / 2;
      const rows = Math.ceil(this.cards.length / 2);
      const rowH = Math.floor((ah - (rows - 1) * gap) / rows);
      // primero se mide (alto natural), luego todos al alto de la fila más alta que quepa
      let need = 0;
      this.cards.forEach((c, i) => { need = Math.max(need, this.placeCard(c, rx + (i % 2) * (cw + gap), ay, cw, base)); });
      const h = Math.max(need, Math.min(rowH, Math.round(need * 1.4)));
      const blockH = rows * h + (rows - 1) * gap;
      const top = ay + Math.max(0, Math.round((ah - blockH) / 2));
      this.cards.forEach((c, i) => this.placeCard(c, rx + (i % 2) * (cw + gap), top + Math.floor(i / 2) * (h + gap), cw, base, h));
    }
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [];
    for (const c of this.cards) {
      out.push({ id: `case-${c.chapter}`, kind: 'button', x: c.bg.x, y: c.bg.y, w: c.bg.width, h: c.bg.height, fontPx: parseFloat(String(c.head.style.fontSize)) || 0, text: `${c.head.text} ${c.status.text}` });
      out.push(textBound(`case-${c.chapter}-head`, c.head), textBound(`case-${c.chapter}-title`, c.title), textBound(`case-${c.chapter}-status`, c.status));
    }
    for (const { btn } of this.cosmetics) out.push(btn.bound());
    out.push(this.back.bound());
    for (const [id, t] of [['heading', this.heading], ['total', this.total], ['unlocks', this.extrasTitle]] as const) out.push(textBound(id, t));
    return out;
  }
}

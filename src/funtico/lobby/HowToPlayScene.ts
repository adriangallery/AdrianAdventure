/**
 * F1.5 (plan FUNTICO_ADVENTURE): «HOW TO PLAY» (pantalla «howto» del kit). Tres pasos deslizables por modo (arte arriba,
 * texto abajo, flechas y DONE). Se abre sola la primera vez que se entra al lobby (marca HOWTO_SEEN_KEY).
 */
import Phaser from 'phaser';
import { Button, C, MIN_TEXT, textBound, txt, type UiBound } from '../ui';
import { Screen } from './Screen';
import { coverImage, preloadArt, IconButton, ART, type ArtId } from './widgets';

export const HOWTO_SEEN_KEY = 'adrian_adventure_funtico_howto_seen';
export type HowMode = 'triage' | 'campaign';

export const STEPS: Record<HowMode, Array<{ art: ArtId; title: string; body: string }>> = {
  triage: [
    { art: 'triage', title: 'OBJECTIVE', body: 'Patients come in one by one. Treat each one before the shift clock runs out.' },
    { art: 'triage2', title: 'SAMPLE / SYMPTOM', body: 'Read the card, then tap the right spot in the room. Drag to look around.' },
    { art: 'triage3', title: 'RELAPSE', body: 'A patient is back! Pick the right cure from the options. Streaks score more.' },
  ],
  campaign: [
    { art: 'campaign', title: 'VERBS', body: 'Tap something in the scene and choose a verb: look, use, talk, take.' },
    { art: 'campaign2', title: 'INVENTORY', body: 'Slide up the drawer to see your items. Use them on the world.' },
    { art: 'campaign3', title: 'STARS', body: 'Solve the case. Fewer hints and a fast time earn up to 3 stars.' },
  ],
};

export class HowToPlayScene extends Screen {
  private mode: HowMode = 'triage';
  private step = 0;
  private sub!: Phaser.GameObjects.Text;
  private artFrame!: Phaser.GameObjects.Rectangle;
  private art!: Phaser.GameObjects.Image;
  private textBox!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private dots: Phaser.GameObjects.Rectangle[] = [];
  private prev!: IconButton;
  private next!: IconButton;
  private done!: Button;
  private artRect = { x: 0, y: 0, w: 1, h: 1 };
  private swipeX: number | null = null;

  constructor() { super('HowToPlayScene'); }

  init(data?: { from?: string; mode?: HowMode }): void {
    super.init(data);
    this.mode = data?.mode === 'campaign' ? 'campaign' : 'triage';
    this.step = 0;
  }

  preload(): void {
    preloadArt(this, STEPS[this.mode].map((s) => s.art));
  }

  create(): void {
    try { localStorage.setItem(HOWTO_SEEN_KEY, '1'); } catch { /* sin almacén */ }
    this.sub = txt(this, '', MIN_TEXT, C.lilac, 'center').setOrigin(0.5, 0);
    this.artFrame = this.add.rectangle(0, 0, 10, 10, C.panelN).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.art = this.add.image(0, 0, ART[STEPS[this.mode][0].art].key);
    this.textBox = this.add.rectangle(0, 0, 10, 10, C.panelN).setOrigin(0, 0).setStrokeStyle(2, C.borderN);
    this.title = txt(this, '', 16, C.yellow);
    this.body = txt(this, '', MIN_TEXT, C.white);
    this.dots = [0, 1, 2].map(() => this.add.rectangle(0, 0, 10, 10, C.yellowN).setOrigin(0, 0));
    this.prev = new IconButton(this, 'prev', 'left', () => this.go(-1));
    this.next = new IconButton(this, 'next', 'right', () => this.go(1));
    this.done = new Button(this, 'done', 'DONE', () => this.goBack(), { fill: 0x2a2450 });
    // Deslizar sobre el arte o el texto cambia de paso
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.swipeX = p.y < this.done.bg.y - 8 && p.y > this.artRect.y ? p.x : null; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.swipeX === null) return;
      const dx = p.x - this.swipeX;
      this.swipeX = null;
      if (Math.abs(dx) > 40) this.go(dx < 0 ? 1 : -1);
    });
    this.setupScreen('howto', 'HOW TO PLAY');
    const hook = (window as unknown as { __funtico: Record<string, unknown> }).__funtico.screen as Record<string, unknown>;
    Object.assign(hook, { step: () => this.step, mode: () => this.mode });
    this.show();
  }

  private go(d: number): void {
    this.step = Phaser.Math.Clamp(this.step + d, 0, 2);
    this.show();
  }

  private show(): void {
    const s = STEPS[this.mode][this.step];
    this.sub.setText(`${this.mode.toUpperCase()} - STEP ${this.step + 1} OF 3`);
    this.art.setTexture(ART[s.art].key);
    this.title.setText(s.title);
    this.body.setText(s.body);
    this.dots.forEach((d, i) => d.setFillStyle(i === this.step ? C.yellowN : 0x5c587a));
    this.prev.setVisible(this.step > 0);
    this.next.setVisible(this.step < 2);
    this.doLayout();
  }

  protected layoutBody(a: { x: number; y: number; w: number; h: number }, portrait: boolean): void {
    const lw = Math.min(a.w, portrait ? 520 : a.w);
    const lx = a.x + (a.w - lw) / 2;
    const navH = 56;
    const navY = a.y + a.h - navH;
    this.prev.place(lx, navY + 4);
    this.next.place(lx + lw - 48, navY + 4);
    this.done.place(lx + lw / 2 - 80, navY, 160, navH, 16);
    this.sub.setPosition(lx + lw / 2, a.y);
    const top = a.y + 24;
    const room = navY - 10 - top;
    if (portrait) {
      const artH = Math.round(room * 0.55);
      this.placeArt(lx, top, lw, artH);
      this.placeText(lx, top + artH + 10, lw, room - artH - 10);
    } else {
      const artW = Math.round(lw * 0.5);
      this.placeArt(lx, top, artW, room);
      this.placeText(lx + artW + 10, top, lw - artW - 10, room);
    }
  }

  private placeArt(x: number, y: number, w: number, h: number): void {
    this.artRect = { x, y, w, h };
    this.artFrame.setPosition(x, y).setSize(w, h);
    coverImage(this.art, x + 4, y + 4, w - 8, h - 8);
  }

  private placeText(x: number, y: number, w: number, h: number): void {
    this.textBox.setPosition(x, y).setSize(w, h);
    this.title.setPosition(x + 16, y + 16);
    this.body.setWordWrapWidth(w - 32, true).setPosition(x + 16, y + 16 + this.title.height + 14);
    this.dots.forEach((d, i) => d.setPosition(Math.round(x + w / 2 - 26 + i * 20), Math.round(y + h - 20)).setSize(10, 10));
  }

  protected bodyBounds(): UiBound[] {
    const out: UiBound[] = [textBound('step', this.sub), textBound('step-title', this.title), textBound('step-body', this.body), this.done.bound()];
    if (this.step > 0) out.push(this.prev.bound());
    if (this.step < 2) out.push(this.next.bound());
    return out;
  }
}

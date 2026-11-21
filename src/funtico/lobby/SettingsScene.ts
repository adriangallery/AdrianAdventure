/**
 * F1.5 (plan FUNTICO_ADVENTURE): ajustes (pantalla «settings» del kit). Volumen de sonido y de música por separado
 * (settings.ts; se guardan al momento) e idioma: solo EN activo, ES/JA «soon» (llegan en otro checkpoint).
 */
import Phaser from 'phaser';
import { Button, C, MIN_TEXT, textBound, txt, type UiBound } from '../ui';
import { getSettings, setMusicVolume, setSfxVolume } from '../settings';
import { Screen } from './Screen';
import { Slider } from './widgets';

export class SettingsScene extends Screen {
  private sfxLbl!: Phaser.GameObjects.Text;
  private musLbl!: Phaser.GameObjects.Text;
  private langLbl!: Phaser.GameObjects.Text;
  private saved!: Phaser.GameObjects.Text;
  private sfx!: Slider;
  private mus!: Slider;
  private langs!: Button[];
  private close!: Button;

  constructor() { super('SettingsScene'); }

  create(): void {
    const s = getSettings();
    this.sfxLbl = txt(this, '', MIN_TEXT, C.white, 'center').setOrigin(0.5, 0);
    this.musLbl = txt(this, '', MIN_TEXT, C.white, 'center').setOrigin(0.5, 0);
    this.sfx = new Slider(this, 'sound', s.sfx, (v) => { setSfxVolume(v); this.labels(); });
    this.mus = new Slider(this, 'music', s.music, (v) => { setMusicVolume(v); this.labels(); });
    this.langLbl = txt(this, 'LANGUAGE', MIN_TEXT, C.white, 'center').setOrigin(0.5, 0);
    this.langs = [['EN', true], ['ES', false], ['JA', false]].map(([l, on]) => {
      const b = new Button(this, `lang-${String(l).toLowerCase()}`, on ? String(l) : `${l}\nsoon`, () => undefined, { fill: on ? 0x2a2450 : C.panelN, color: on ? C.yellow : C.lilacDim });
      if (on) b.bg.setStrokeStyle(3, C.yellowN);
      else b.setEnabled(false);
      return b;
    });
    this.saved = txt(this, 'Changes are saved', MIN_TEXT, C.lilacDim, 'center').setOrigin(0.5, 0);
    this.close = new Button(this, 'close', 'CLOSE', () => this.goBack(), { fill: 0x2a2450 });
    this.labels();
    this.setupScreen('settings', 'SETTINGS');
    const hook = (window as unknown as { __funtico: Record<string, unknown> }).__funtico.screen as Record<string, unknown>;
    Object.assign(hook, { values: () => getSettings() });
  }

  private labels(): void {
    this.sfxLbl.setText(`SOUND ${Math.round(this.sfx.value * 100)}%`);
    this.musLbl.setText(`MUSIC ${Math.round(this.mus.value * 100)}%`);
  }

  protected layoutBody(a: { x: number; y: number; w: number; h: number }, portrait: boolean): void {
    const lw = Math.min(a.w, 520);
    const lx = a.x + (a.w - lw) / 2;
    const cx = lx + lw / 2;
    let y = a.y + (portrait ? 16 : 0);
    if (!portrait && a.h < 300) {
      // Horizontal bajo: volúmenes a la izquierda, idioma a la derecha y CLOSE abajo
      const half = (a.w - 24) / 2;
      const l = a.x;
      const r = a.x + half + 24;
      this.sfxLbl.setPosition(l + half / 2, y); this.sfx.place(l + 16, y + 20, half - 32);
      this.musLbl.setPosition(l + half / 2, y + 76); this.mus.place(l + 16, y + 96, half - 32);
      this.langLbl.setPosition(r + half / 2, y);
      const bw = (half - 16) / 3;
      this.langs.forEach((b, i) => b.place(r + i * (bw + 8), y + 24, bw, 52));
      this.saved.setPosition(r + half / 2, y + 96);
      this.close.place(a.x + a.w / 2 - 130, a.y + a.h - 48, 260, 48, 16);
      return;
    }
    this.sfxLbl.setPosition(cx, y); y += 22;
    y += this.sfx.place(lx + 16, y, lw - 32) + 18;
    this.musLbl.setPosition(cx, y); y += 22;
    y += this.mus.place(lx + 16, y, lw - 32) + 28;
    this.langLbl.setPosition(cx, y); y += 26;
    const bw = (lw - 16) / 3;
    let bh = 0;
    this.langs.forEach((b, i) => { bh = Math.max(bh, b.place(lx + i * (bw + 8), y, bw, 52)); });
    y += bh + 20;
    this.saved.setPosition(cx, y);
    this.close.place(lx, a.y + a.h - 56, lw, 56, 16);
  }

  protected bodyBounds(): UiBound[] {
    return [textBound('sound-label', this.sfxLbl), this.sfx.bound(), textBound('music-label', this.musLbl), this.mus.bound(),
      textBound('lang-label', this.langLbl), ...this.langs.map((b) => b.bound()), textBound('saved', this.saved), this.close.bound()];
  }
}

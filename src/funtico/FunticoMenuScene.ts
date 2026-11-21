/**
 * F1.2 (plan FUNTICO_ADVENTURE): menú del build Funtico. Título, TRIAGE (jugar), CAMPAIGN (próximamente), el nombre del
 * usuario del puente y un Hall of Fame corto (top 5). Se recoloca en caliente al girar o redimensionar.
 * El toque en TRIAGE es el gesto que desbloquea el audio.
 */
import Phaser from 'phaser';
import type { FunticoBridge } from './FunticoBridge';
import { generateRun } from './triage/triage.js';
import type { TriageCatalog } from './triage/triage';
import catalog from './triage/catalog.json';
import { Button, C, MIN_TEXT, REG, safeInsets, textBound, txt, type UiBound } from './ui';
import { funticoHook } from './TriageScene';

export function newSeed(): string {
  const fixed = new URLSearchParams(location.search).get('seed');
  if (fixed) return fixed;
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `local-${a[0].toString(36)}${a[1].toString(36)}`;
}

/** Arranca una carrera de Triage (desde el menú o PLAY AGAIN). */
export function startTriage(scene: Phaser.Scene): void {
  const run = generateRun(newSeed(), catalog as unknown as TriageCatalog);
  scene.scene.start('TriageScene', { run });
}

export class FunticoMenuScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private user!: Phaser.GameObjects.Text;
  private hofTitle!: Phaser.GameObjects.Text;
  private hof!: Phaser.GameObjects.Text;
  private triage!: Button;
  private campaign!: Button;

  constructor() {
    super('FunticoMenuScene');
  }

  create(): void {
    this.title = txt(this, 'ZEROadventure', 32, C.yellow, 'center').setOrigin(0.5, 0);
    this.sub = txt(this, 'THE CLINIC IS OPEN', MIN_TEXT, C.lilacDim, 'center').setOrigin(0.5, 0);
    this.user = txt(this, '', MIN_TEXT, C.lilac, 'center').setOrigin(0.5, 0);
    this.triage = new Button(this, 'triage', 'TRIAGE', () => startTriage(this), { fill: 0x2a2450 });
    this.campaign = new Button(this, 'campaign', 'CAMPAIGN\nCOMING SOON', () => undefined, { color: C.grey }).setEnabled(false);
    this.hofTitle = txt(this, 'HALL OF FAME', MIN_TEXT, C.yellow, 'center').setOrigin(0.5, 0);
    this.hof = txt(this, 'loading...', MIN_TEXT, C.white, 'left').setOrigin(0.5, 0);
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      delete funticoHook().menu;
    });
    funticoHook().menu = { uiBounds: () => this.uiBounds() };
    void this.loadData();
  }

  private async loadData(): Promise<void> {
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (!bridge) return;
    await bridge.init();
    const u = await bridge.getUser();
    if (!this.sys.isActive()) return;
    if (u.ok) this.user.setText(`PLAYER: ${u.value.Name}`);
    const h = await bridge.getHallOfFame({ period: 'monthly', limit: 5, gameMode: 'practice' });
    if (!this.sys.isActive()) return;
    this.hof.setText(h.ok ? hofLines(h.value.leaderboard.slice(0, 5), u.ok ? u.value.UserId : -1) : 'unavailable');
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
    const base = Phaser.Math.Clamp(Math.round(Math.min(width, height) / 46), MIN_TEXT, 22);
    const titlePx = Phaser.Math.Clamp(Math.floor((aw * (portrait ? 0.88 : 0.5)) / 13), 18, 64);
    this.title.setFontSize(titlePx);
    this.sub.setFontSize(base);
    this.user.setFontSize(base);
    this.hofTitle.setFontSize(base);
    this.hof.setFontSize(base).setLineSpacing(Math.round(base * 0.6));
    const btnW = Math.min(aw - 32, portrait ? 360 : 380);
    if (portrait) {
      // Centrado en vertical: se coloca una vez para medir y otra en su sitio. El Hall of Fame reserva sus 5 líneas
      // para que el bloque no salte cuando llega.
      const cx = ax + aw / 2;
      const hofH = Math.max(this.hof.height, 5 * base + 4 * Math.round(base * 0.6));
      const place = (top: number): number => {
        let y = top;
        this.title.setPosition(cx, y);
        y += this.title.height + 14;
        this.sub.setPosition(cx, y);
        y += this.sub.height + 28;
        y += this.triage.place(cx - btnW / 2, y, btnW, 64, base + 4) + 14;
        y += this.campaign.place(cx - btnW / 2, y, btnW, 56, base) + 24;
        this.user.setPosition(cx, y);
        y += this.user.height + 24;
        this.hofTitle.setPosition(cx, y);
        this.hof.setPosition(cx, y + this.hofTitle.height + 12);
        return y + this.hofTitle.height + 12 + hofH - top;
      };
      const total = place(ay);
      place(ay + Math.max(24, Math.round((ah - total) / 2)));
    } else {
      const lx = ax + aw * 0.28;
      const rx = ax + aw * 0.72;
      let y = ay + Math.max(16, ah * 0.1);
      this.title.setPosition(lx, y);
      y += this.title.height + 12;
      this.sub.setPosition(lx, y);
      y += this.sub.height + 20;
      y += this.triage.place(lx - btnW / 2, y, btnW, 56, base + 2) + 10;
      this.campaign.place(lx - btnW / 2, y, btnW, 48, base);
      let ry = ay + Math.max(16, ah * 0.1);
      this.user.setPosition(rx, ry);
      ry += this.user.height + 20;
      this.hofTitle.setPosition(rx, ry);
      this.hof.setPosition(rx, ry + this.hofTitle.height + 12);
    }
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [this.triage.bound(), this.campaign.bound()];
    for (const [id, t] of [['title', this.title], ['subtitle', this.sub], ['user', this.user], ['hof-title', this.hofTitle], ['hof', this.hof]] as const) {
      if (t.text) out.push(textBound(id, t));
    }
    return out;
  }
}

/** Líneas del Hall of Fame (posición, nombre recortado, puntos); el jugador marcado con «>». */
export function hofLines(list: Array<{ rank: number; displayName: string; totalPoints: number; userId: number }>, me: number, nameChars = 12): string {
  return list.map((e) => {
    const name = e.displayName.length > nameChars ? e.displayName.slice(0, nameChars - 1) + '.' : e.displayName;
    return `${e.userId === me ? '>' : ' '}${String(e.rank).padStart(2)} ${name.padEnd(nameChars)} ${String(e.totalPoints).padStart(6)}`;
  }).join('\n');
}

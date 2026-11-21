/**
 * F2.2 (plan FUNTICO_ADVENTURE), cliente: arranque de una carrera de Triage en modo LIVE. Pide la carrera al
 * servidor (`POST <apiBaseUrl>/run/start`, por el puente), comprueba que el catálogo del servidor es el de este build
 * y pasa a TriageScene con esa semilla y ese `runId`. Si algo falla: mensaje claro, RETRY y MENU. Nunca juega una
 * carrera «local» en live (no se podría enviar).
 *
 * En simulado no se usa: `startTriage()` va directa a TriageScene con la semilla local, sin red.
 */
import Phaser from 'phaser';
import type { FunticoBridge, FunticoError } from './FunticoBridge';
import { catalogId, generateRun } from './triage/triage.js';
import type { TriageCatalog } from './triage/triage';
import catalog from './triage/catalog.json';
import { Button, C, MIN_TEXT, REG, safeInsets, textBound, txt, type UiBound } from './ui';
import { funticoHook } from './TriageScene';

const CATALOG = catalog as unknown as TriageCatalog;

/** Mensaje para el jugador según el error de run/start. */
export function startErrorText(e: FunticoError): string {
  switch (e.serverCode) {
    case 'too_many_open_runs': return 'TOO MANY OPEN SHIFTS.\nFINISH ONE OR WAIT A FEW MINUTES.';
    case 'rate_limited': return 'TOO MANY SHIFTS THIS HOUR.\nTRY AGAIN LATER.';
    case 'catalog_mismatch': return 'THIS GAME VERSION IS OUTDATED.\nRELOAD THE PAGE.';
    default: break;
  }
  if (e.code === 'network') return 'COULD NOT REACH THE CLINIC.\nCHECK YOUR CONNECTION AND RETRY.';
  if (e.status === 401 || e.code === 'not_initialized') return 'YOUR FUNTICO SESSION EXPIRED.\nREOPEN THE GAME FROM FUNTICO.';
  return `THE CLINIC REFUSED THE SHIFT${e.serverCode ? ` (${e.serverCode})` : ''}.\nTRY AGAIN LATER.`;
}

export class TriageStartScene extends Phaser.Scene {
  private msg!: Phaser.GameObjects.Text;
  private retry!: Button;
  private menu!: Button;
  private status: 'loading' | 'error' = 'loading';
  private error: FunticoError | null = null;

  constructor() {
    super('TriageStartScene');
  }

  create(): void {
    this.status = 'loading';
    this.error = null;
    this.msg = txt(this, 'OPENING YOUR SHIFT...', MIN_TEXT, C.yellow, 'center').setOrigin(0.5, 0.5);
    this.retry = new Button(this, 'retry', 'RETRY', () => void this.request(), { fill: 0x2a2450 });
    this.menu = new Button(this, 'menu', 'MENU', () => this.scene.start('FunticoMenuScene'));
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      delete funticoHook().start;
    });
    funticoHook().start = {
      state: () => ({ status: this.status, error: this.error }),
      uiBounds: () => this.uiBounds(),
    };
    void this.request();
  }

  private async request(): Promise<void> {
    this.status = 'loading';
    this.error = null;
    this.msg.setText('OPENING YOUR SHIFT...').setColor(C.yellow);
    this.layout(this.scale.width, this.scale.height);
    const bridge = this.registry.get(REG.bridge) as FunticoBridge | undefined;
    if (!bridge) return this.fail({ code: 'not_initialized', message: 'no bridge' });
    const ready = await bridge.init();
    if (!this.sys.isActive()) return;
    if (!ready.ok) return this.fail(ready.error);
    const r = await bridge.startTriageRun();
    if (!this.sys.isActive()) return;
    if (!r.ok) return this.fail(r.error);
    const ticket = r.value;
    if (!ticket) return this.fail({ code: 'invalid', message: 'no server run in live mode' });
    if (ticket.catalog !== catalogId(CATALOG)) {
      return this.fail({ code: 'rejected', message: `catalog ${ticket.catalog}`, serverCode: 'catalog_mismatch' });
    }
    const run = generateRun(ticket.seed, CATALOG);
    this.scene.start('TriageScene', { run, runId: ticket.runId });
  }

  private fail(e: FunticoError): void {
    this.status = 'error';
    this.error = e;
    this.msg.setText(startErrorText(e)).setColor(C.white);
    this.layout(this.scale.width, this.scale.height);
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.layout(size.width, size.height);
  }

  layout(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
    const ins = safeInsets();
    const aw = width - ins.left - ins.right;
    const cx = ins.left + aw / 2;
    const cy = ins.top + (height - ins.top - ins.bottom) / 2;
    const px = Phaser.Math.Clamp(Math.round(Math.min(width, height) / 40), MIN_TEXT, 20);
    this.msg.setFontSize(px).setLineSpacing(Math.round(px * 0.5)).setWordWrapWidth(aw - 32).setPosition(cx, cy - 50);
    const err = this.status === 'error';
    this.retry.setVisible(err);
    this.menu.setVisible(err);
    const bw = Math.min((aw - 40) / 2, 220);
    this.retry.place(cx - bw - 6, cy + 10, bw, 52, px);
    this.menu.place(cx + 6, cy + 10, bw, 52, px);
  }

  uiBounds(): UiBound[] {
    const out: UiBound[] = [textBound('message', this.msg)];
    if (this.status === 'error') out.push(this.retry.bound(), this.menu.bound());
    return out;
  }
}

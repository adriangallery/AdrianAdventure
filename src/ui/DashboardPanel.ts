import { FONT } from '@/config/theme';
import { RIG_PIN_TIP, TRAITLAB_URL, dashboardRows, dashboardStatus, type DashboardData } from '@/web3/dashboardData';

/**
 * A3.10 (plan SCUMM): dashboard TraitLab del Mining Rig (upstairs, op `showDashboard`). Panel HTML a pantalla completa,
 * estilo terminal, con los datos REALES de la cartera (src/web3/dashboard.ts, solo lecturas) o los simulados de
 * `__qa.mockWeb3` (solo ?qa=1).
 *
 * - Mobile-first: legible en 390×844 y 844×390, fuentes ≥ 11 px y zonas táctiles ≥ 44 px (A5.2).
 * - Se cierra con la X, tocando fuera de la terminal, con Esc y en el SHUTDOWN de GameScene (`destroy`).
 * - Estados: cargando («SYNCING…»), datos (con los fallos parciales marcados) y error total (sin cartera o sin red: lo dice
 *   y deja la nota del sysadmin igual). Web3 nunca bloquea: cerrar siempre funciona y el script sigue.
 * - Todo el texto entra con `textContent` (nunca innerHTML con datos de fuera). El enlace a TraitLab abre pestaña
 *   nueva con `rel="noopener noreferrer"`.
 */

export interface DashboardQaState {
  open: boolean;
  /** loading | ready | error */
  phase: 'loading' | 'ready' | 'error' | null;
  /** Filas que se ven (etiqueta: valor) */
  rows: string[];
  status: string | null;
  tip: string | null;
}

const STYLE_ID = 'rigdash-style';
/** Un toque que abre el panel no lo cierra con el clic emulado que llega después sobre el fondo */
const OPEN_GUARD_MS = 350;
const CSS = `
#rigdash-overlay{position:fixed;inset:0;z-index:9100;background:rgba(2,6,4,.82);display:flex;align-items:center;justify-content:center;
  font-family:${FONT.FAMILY_READABLE};-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#rigdash-term{box-sizing:border-box;width:min(94vw,520px);max-height:min(88vh,720px);background:#030a05;border:3px solid #2f7a3a;border-radius:10px;
  box-shadow:0 0 0 2px #010402,0 0 24px rgba(80,255,120,.18);display:flex;flex-direction:column;overflow:hidden;color:#8cf070}
@media (orientation:landscape){#rigdash-term{width:min(92vw,760px);max-height:92vh}}
#rigdash-term .rd-head{display:flex;align-items:center;gap:8px;padding:8px 10px 6px 12px;border-bottom:1px solid #1d4a24}
#rigdash-term .rd-title{flex:1;min-width:0;font-size:12px;line-height:1.5;color:#b8ff9a}
#rigdash-term .rd-sub{font-size:11px;color:#4f9a5a;margin-top:2px}
#rigdash-close{flex:0 0 auto;width:44px;height:44px;background:transparent;border:1px solid #2f7a3a;color:#8cf070;border-radius:6px;font:inherit;font-size:12px;cursor:pointer}
#rigdash-term .rd-body{flex:1;overflow-y:auto;padding:8px 14px 12px;font-size:11px;line-height:1.8;-webkit-overflow-scrolling:touch}
@media (min-width:700px) and (min-height:600px){#rigdash-term .rd-body{font-size:12px}}
#rigdash-term .rd-row{display:flex;gap:10px;padding:4px 0;border-bottom:1px dashed #12301a}
#rigdash-term .rd-k{flex:0 0 9.5em;color:#4f9a5a}
#rigdash-term .rd-v{flex:1;min-width:0;word-break:break-word;color:#d8ffc8}
#rigdash-term .rd-row.warn .rd-v{color:#f8c848}
#rigdash-term .rd-status{margin:10px 0 0;color:#4f9a5a}
#rigdash-term .rd-tip{margin:12px 0 0;padding:8px 10px;border:1px solid #f8e848;border-radius:6px;color:#f8e848;background:#141205}
#rigdash-term .rd-tip-h{font-size:11px;color:#b0a040;margin-bottom:2px}
#rigdash-term .rd-foot{display:flex;gap:8px;padding:8px 12px 10px;border-top:1px solid #1d4a24}
#rigdash-link{flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;font:inherit;font-size:11px;color:#030a05;background:#8cf070;
  border-radius:22px;text-decoration:none;text-align:center;padding:0 10px}
#rigdash-term .rd-cursor{display:inline-block;width:.6em;animation:rdblink 1s steps(1) infinite}
@keyframes rdblink{50%{opacity:0}}
`;

export class DashboardPanel {
  private overlay: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private resolveClose: (() => void) | null = null;
  private openedAt = 0;
  private qa: DashboardQaState = { open: false, phase: null, rows: [], status: null, tip: null };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
  };

  /** Abre el panel en «cargando», espera los datos y se resuelve al cerrarse. `tip` = nota del sysadmin (recompensa). */
  open(data: Promise<DashboardData | null>): Promise<void> {
    this.close();
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const overlay = document.createElement('div');
    overlay.id = 'rigdash-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'TraitLab dashboard');
    const term = document.createElement('div');
    term.id = 'rigdash-term';

    const head = document.createElement('div');
    head.className = 'rd-head';
    const titleBox = document.createElement('div');
    titleBox.className = 'rd-title';
    titleBox.textContent = 'TRAITLAB // RIG-01';
    const sub = document.createElement('div');
    sub.className = 'rd-sub';
    sub.textContent = 'holder console · read-only';
    titleBox.appendChild(sub);
    const close = document.createElement('button');
    close.id = 'rigdash-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'X';
    close.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    head.append(titleBox, close);

    const body = document.createElement('div');
    body.className = 'rd-body';
    const loading = document.createElement('div');
    loading.textContent = '> SYNCING WITH BASE…';
    const cursor = document.createElement('span');
    cursor.className = 'rd-cursor';
    cursor.textContent = '_';
    loading.appendChild(cursor);
    body.appendChild(loading);

    const foot = document.createElement('div');
    foot.className = 'rd-foot';
    const link = document.createElement('a');
    link.id = 'rigdash-link';
    link.href = TRAITLAB_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'OPEN TRAITLAB ↗';
    link.addEventListener('click', (e) => e.stopPropagation());
    foot.appendChild(link);

    term.append(head, body, foot);
    term.addEventListener('click', (e) => e.stopPropagation());
    term.addEventListener('pointerdown', (e) => e.stopPropagation());
    overlay.appendChild(term);
    overlay.addEventListener('click', () => {
      if (performance.now() - this.openedAt < OPEN_GUARD_MS) return;
      this.close();
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', this.onKey, true);
    this.overlay = overlay;
    this.body = body;
    this.openedAt = performance.now();
    this.qa = { open: true, phase: 'loading', rows: [], status: null, tip: null };

    const done = new Promise<void>((resolve) => { this.resolveClose = resolve; });
    const mine = overlay;
    void data
      .catch(() => null)
      .then((d) => { if (this.overlay === mine) this.render(d); });
    return done;
  }

  private render(d: DashboardData | null): void {
    const body = this.body;
    if (!body) return;
    body.textContent = '';
    const rows: string[] = [];
    let status: string;
    if (!d) {
      status = 'NO WALLET SIGNAL. The rig sees a very confident nobody.';
      this.qa.phase = 'error';
    } else {
      for (const r of dashboardRows(d)) {
        const row = document.createElement('div');
        row.className = r.warn ? 'rd-row warn' : 'rd-row';
        const k = document.createElement('span');
        k.className = 'rd-k';
        k.textContent = r.label;
        const v = document.createElement('span');
        v.className = 'rd-v';
        v.textContent = r.value;
        row.append(k, v);
        body.appendChild(row);
        rows.push(`${r.label}: ${r.value}`);
      }
      status = dashboardStatus(d);
      this.qa.phase = d.errors.length >= 3 ? 'error' : 'ready';
    }
    const st = document.createElement('div');
    st.className = 'rd-status';
    st.textContent = `> ${status}`;
    body.appendChild(st);
    // La recompensa jugable: la nota del sysadmin (atajo del PIN del Ledger, cap. 3)
    const tip = document.createElement('div');
    tip.className = 'rd-tip';
    tip.id = 'rigdash-tip';
    const tipH = document.createElement('div');
    tipH.className = 'rd-tip-h';
    tipH.textContent = 'SYSADMIN NOTE (holders only)';
    const tipT = document.createElement('div');
    tipT.textContent = RIG_PIN_TIP;
    tip.append(tipH, tipT);
    body.appendChild(tip);
    this.qa.rows = rows;
    this.qa.status = status;
    this.qa.tip = RIG_PIN_TIP;
  }

  isOpen(): boolean {
    return !!this.overlay;
  }

  qaState(): DashboardQaState {
    return { ...this.qa, rows: [...this.qa.rows], open: !!this.overlay };
  }

  /** Cierra (idempotente) y resuelve la promesa de `open` */
  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.overlay?.remove();
    this.overlay = null;
    this.body = null;
    this.qa.open = false;
    const r = this.resolveClose;
    this.resolveClose = null;
    r?.();
  }

  destroy(): void {
    this.close();
    document.getElementById(STYLE_ID)?.remove();
  }
}

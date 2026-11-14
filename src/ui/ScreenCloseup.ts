import { FONT } from '@/config/theme';
import { SCREEN_PALETTES, screenCharDelay, type CloseupReason, type ScreenColor } from '@/systems/ScreenText';

/**
 * A2.19 (plan SCUMM): PRIMER PLANO de una pantalla a pantalla completa, como los close-ups de SCUMM. Para textos largos
 * (Términos, logs, DOORIS, PZ-BOT…) y, automático, cuando la pantalla del fondo es demasiado pequeña para leerse en el
 * viewport (src/systems/ScreenText.ts → closeupReason). Panel HTML (como el dashboard del rig, A3.10): marco de monitor,
 * fósforo del color de la pantalla, scanlines, parpadeo leve, tecleo con cursor y scroll propio si no cabe.
 *
 * - Se cierra con clic o toque (el primero termina el tecleo si aún escribe), con la X, con Esc/Enter/Espacio y en el
 *   SHUTDOWN de GameScene (`destroy`). Siempre se puede cerrar: el script sigue.
 * - Mobile-first: legible en 390×844 y 844×390 (letra ≥ 11 px), X de 44 px.
 * - Todo el texto entra con `textContent` (nunca innerHTML).
 */

export interface CloseupQaState {
  open: boolean;
  screen: string | null;
  text: string | null;
  reason: CloseupReason | null;
  typing: boolean;
}

const STYLE_ID = 'scrclose-style';
const OPEN_GUARD_MS = 350;
const CSS = `
#scrclose-overlay{position:fixed;inset:0;z-index:9050;background:rgba(0,0,0,.84);display:flex;align-items:center;justify-content:center;
  font-family:${FONT.FAMILY_READABLE};-webkit-tap-highlight-color:transparent;touch-action:manipulation;cursor:pointer}
#scrclose-bezel{box-sizing:border-box;width:min(94vw,640px);max-height:90vh;padding:14px;background:#2b2a26;border-radius:18px;
  box-shadow:inset 0 0 0 3px #44423b,inset 0 0 0 6px #1a1916,0 10px 40px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:8px}
@media (orientation:landscape) and (max-height:500px){#scrclose-bezel{width:min(92vw,760px);padding:10px;border-radius:14px}}
#scrclose-head{display:flex;align-items:center;gap:8px}
#scrclose-title{flex:1;min-width:0;font-size:11px;color:#b8b29c;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#scrclose-close{flex:0 0 auto;width:44px;height:44px;background:#1a1916;border:1px solid #5a574d;color:#d8d2bc;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}
#scrclose-glass{position:relative;flex:1;min-height:120px;max-height:calc(90vh - 90px);border-radius:12px/16px;overflow:hidden;
  box-shadow:inset 0 0 28px rgba(0,0,0,.85)}
#scrclose-text{box-sizing:border-box;height:100%;max-height:calc(90vh - 90px);overflow-y:auto;padding:16px 18px;margin:0;white-space:pre-wrap;word-break:break-word;
  font:inherit;font-size:12px;line-height:1.75;-webkit-overflow-scrolling:touch;animation:scrflick 2.2s steps(1) infinite}
@media (min-width:700px) and (min-height:600px){#scrclose-text{font-size:14px}}
#scrclose-glass::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(to bottom,rgba(0,0,0,.28) 0 1px,transparent 1px 3px)}
#scrclose-text .sc-cursor{animation:scblink 1s steps(1) infinite}
#scrclose-hint{font-size:10px;color:#8a8573;text-align:center}
@keyframes scblink{50%{opacity:0}}
@keyframes scrflick{0%{opacity:1}96%{opacity:1}97%{opacity:.88}98%{opacity:1}}
@media (prefers-reduced-motion:reduce){#scrclose-text{animation:none}#scrclose-text .sc-cursor{animation:none}}
`;

export class ScreenCloseup {
  private overlay: HTMLDivElement | null = null;
  private pre: HTMLPreElement | null = null;
  private textNode: Text | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resolveClose: (() => void) | null = null;
  private openedAt = 0;
  private full = '';
  private typed = 0;
  private qa: CloseupQaState = { open: false, screen: null, text: null, reason: null, typing: false };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== 'Escape' && this.typed < this.full.length) this.finishTyping();
      else this.close();
    }
  };

  /** Abre el primer plano y se resuelve al cerrarlo */
  open(opts: { screen: string; label: string; text: string; color: ScreenColor; reason: CloseupReason; instant: boolean }): Promise<void> {
    this.close();
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const pal = SCREEN_PALETTES[opts.color] ?? SCREEN_PALETTES.green;
    const overlay = document.createElement('div');
    overlay.id = 'scrclose-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', opts.label);
    overlay.dataset.screen = opts.screen;
    overlay.dataset.reason = opts.reason;

    const bezel = document.createElement('div');
    bezel.id = 'scrclose-bezel';
    const head = document.createElement('div');
    head.id = 'scrclose-head';
    const title = document.createElement('div');
    title.id = 'scrclose-title';
    title.textContent = opts.label;
    const close = document.createElement('button');
    close.id = 'scrclose-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'X';
    close.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    head.append(title, close);

    const glass = document.createElement('div');
    glass.id = 'scrclose-glass';
    glass.style.background = `radial-gradient(ellipse at center, ${pal.bg} 55%, #000 130%)`;
    const pre = document.createElement('pre');
    pre.id = 'scrclose-text';
    pre.style.color = pal.fg;
    pre.style.textShadow = `0 0 6px ${pal.glow}`;
    const textNode = document.createTextNode('');
    const cursor = document.createElement('span');
    cursor.className = 'sc-cursor';
    cursor.textContent = '_';
    pre.append(textNode, cursor);
    glass.appendChild(pre);
    // Un toque dentro del cristal también cierra (o termina el tecleo); la rueda/arrastre hacen scroll
    const hint = document.createElement('div');
    hint.id = 'scrclose-hint';
    hint.textContent = 'tap / click / Esc to close';
    bezel.append(head, glass, hint);
    overlay.appendChild(bezel);
    overlay.addEventListener('click', () => {
      if (performance.now() - this.openedAt < OPEN_GUARD_MS) return;
      if (this.typed < this.full.length) this.finishTyping();
      else this.close();
    });
    document.body.appendChild(overlay);
    window.addEventListener('keydown', this.onKey, true);

    this.overlay = overlay;
    this.pre = pre;
    this.textNode = textNode;
    this.full = opts.text;
    this.openedAt = performance.now();
    this.qa = { open: true, screen: opts.screen, text: opts.text, reason: opts.reason, typing: !opts.instant };
    if (opts.instant) {
      this.finishTyping();
    } else {
      this.typed = 0;
      // El primer plano teclea por bloques para que un texto de 38 páginas no tarde un minuto
      const step = Math.max(1, Math.ceil(this.full.length / 400));
      this.timer = setInterval(() => {
        this.typed = Math.min(this.full.length, this.typed + step);
        this.paint();
        if (this.typed >= this.full.length) this.finishTyping();
      }, screenCharDelay(Math.min(this.full.length, 400), 22));
    }
    return new Promise<void>((resolve) => { this.resolveClose = resolve; });
  }

  isOpen(): boolean {
    return this.overlay !== null;
  }

  qaState(): CloseupQaState {
    return { ...this.qa };
  }

  finishTyping(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.typed = this.full.length;
    this.qa.typing = false;
    this.paint();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay?.remove();
    this.overlay = null;
    this.pre = null;
    this.textNode = null;
    this.qa = { open: false, screen: null, text: null, reason: null, typing: false };
    const r = this.resolveClose;
    this.resolveClose = null;
    r?.();
  }

  destroy(): void {
    this.close();
  }

  private paint(): void {
    if (!this.textNode || !this.pre) return;
    this.textNode.data = this.full.slice(0, this.typed);
    // Scroll de terminal mientras escribe: se ve lo último
    if (this.typed < this.full.length) this.pre.scrollTop = this.pre.scrollHeight;
  }
}

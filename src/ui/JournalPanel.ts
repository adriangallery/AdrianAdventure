import Phaser from 'phaser';
import { FONT, SPEECH_COLORS, TWP } from '@/config/theme';
import { setTouchInteractive, touchContains } from './touchTarget';
import { iconEl } from './icons';
import { sfxOf } from '@/systems/Sfx';
import { goalStingers, type GoalSnapshot } from '@/systems/Stingers';
import { playStinger } from '@/systems/StingerPlayer';
import type { GameState } from '@/types/game.types';
import { CHAPTERS } from '@/systems/ChapterManager';
import { JOURNAL_CHAPTERS, journalChapter, journalProgress, journalWorld } from '@/systems/JournalData';
import {
  HINT_LEVELS, callAnon, chapterData, findNote, goalsView, markSeen, openPuzzleLevel, syncNotes, unseenIds,
  type AnonCall, type JournalProgress, type JournalWorld,
} from '@/systems/Journal';

/**
 * A2.9 + A2.9a (plan SCUMM): el diario es el móvil de Dex. Botón pequeño con un móvil dibujado (Graphics, sin assets) en
 * la barra de arriba, junto a Save y los trofeos, con un punto amarillo si hay un objetivo cumplido o una nota que aún no
 * se ha visto. Al tocarlo abre un panel HTML casi a pantalla completa con tres pestañas: Goals (objetivos del capítulo
 * con tic), Notes (notas apuntadas, de la más nueva a la más vieja) y Call Anon (la escalera de pistas: cada llamada da
 * el siguiente nivel del puzle abierto más avanzado; Anon habla con su voz y cuelga, *click*).
 *
 * - No se abre en cinemática, con diálogo, con texto en pantalla, con un script en marcha ni cambiando de escena
 *   (`blockedReason`, lo decide UIScene). Se cierra con la X, tocando fuera del móvil, con Esc o J (GameScene), si llega
 *   un texto hablado o una cinemática, y en el SHUTDOWN de UIScene (`destroy`, que también quita el DOM y el estilo).
 * - Mientras está abierto: registry `journalOpen` = true (GameScene no acepta toques ni teclas de juego, la pista por
 *   inactividad no cuenta) y el HTML tapa el lienzo.
 * - Todo el texto entra con `textContent` (nunca innerHTML con datos).
 * - Lógica pura en `src/systems/Journal.ts`; datos en `assets/journal/chapter-<n>.json`; progreso en `GameState.journal`.
 */

export type JournalTab = 'goals' | 'notes' | 'anon';

export interface JournalQaState {
  open: boolean;
  tab: JournalTab | null;
  chapter: number;
  goals: { id: string; done: boolean }[];
  notes: string[];
  /** Última llamada a Anon (sobrevive al cambio de escena); null si aún no se ha llamado */
  anon: { puzzle: string | null; level: number; text: string } | null;
  /** Puzle abierto ahora y nivel de pista ya dado (0 = ninguno); null si no hay */
  openPuzzle: { puzzle: string; level: number } | null;
  /** Objetivos cumplidos y notas sin ver (el punto del botón) */
  unseen: number;
  calling: boolean;
}

export interface JournalHooks {
  /** null = se puede abrir; si no, por qué no (cinemática, diálogo, script…) */
  blockedReason: () => string | null;
  /** Voz de Anon (VoiceSystem.play con el texto) */
  playVoice: (text: string) => void;
  stopVoice: () => void;
  /**
   * A1.14: si lo único que lo bloquea es una frase suelta en pantalla, la cierra y devuelve true (el botón se abre al
   * quedar libre: el toque no se pierde en cerrar la frase).
   */
  skipText?: () => boolean;
}

/** Botón: a la derecha del de trofeos (BadgePanel, x 33-63), misma altura y tamaño que Save. */
// A5.2: x 67 → 100 para dejar sitio a las zonas táctiles de 44×44 de guardar y logros (se ve igual de grande)
const BTN = { x: 100, y: 8, w: 30, h: 24 };
/** Lo que tarda en «dar tono» antes de que Anon conteste */
export const RING_MS = 900;
/** Un toque que abre el diario no lo cierra con el clic emulado que llega después sobre el fondo */
const OPEN_GUARD_MS = 350;
const ANON_COLOR = SPEECH_COLORS.anon ?? '#9fd8ff';

const STYLE_ID = 'journal-style';
const CSS = `
#journal-overlay{position:fixed;inset:0;z-index:9000;background:rgba(4,4,10,.74);display:flex;align-items:center;justify-content:center;
  font-family:${FONT.FAMILY_READABLE};-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#journal-phone{box-sizing:border-box;width:min(92vw,440px);height:min(84vh,720px);background:#0b0b16;border:3px solid #504878;border-radius:22px;
  box-shadow:0 0 0 2px #08080f,0 10px 40px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;color:#f0e8d8}
@media (orientation:landscape){#journal-phone{width:min(90vw,720px);height:min(88vh,520px);border-radius:16px}}
#journal-phone .jr-head{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;border-bottom:1px solid #2a2a40}
#journal-phone .jr-title{flex:1;min-width:0;font-size:11px;color:#f8e848;line-height:1.5}
#journal-phone .jr-sub{font-size:11px;color:#8878a8;margin-top:3px}
#journal-close{flex:0 0 auto;width:44px;height:44px;background:transparent;border:1px solid #504878;color:#c0b0d8;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}
#journal-phone .jr-tabs{display:flex;gap:6px;padding:8px 10px}
#journal-phone .jr-tab{flex:1;min-height:44px;font:inherit;font-size:11px;line-height:1.4;color:#8878a8;background:#12121e;border:1px solid #2a2a40;border-radius:8px;position:relative;cursor:pointer;padding:0 2px}
#journal-phone .jr-tab[aria-selected=true]{color:#f8e848;border-color:#f8e848;background:#1a1a30}
#journal-phone .jr-new{position:absolute;top:4px;right:5px;width:7px;height:7px;border-radius:50%;background:#f8e848}
#journal-phone .jr-body{flex:1;overflow-y:auto;padding:4px 14px 14px;font-size:11px;line-height:1.8;-webkit-overflow-scrolling:touch}
@media (min-width:700px) and (min-height:600px){#journal-phone .jr-body{font-size:12px}}
#journal-phone .jr-goal{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed #1f1f33}
#journal-phone .jr-box{flex:0 0 14px;height:14px;border:2px solid #504878;border-radius:3px;display:flex;align-items:center;justify-content:center;
  font-size:10px;line-height:1;margin-top:1px;color:#08080f;font-family:sans-serif;font-weight:bold}
#journal-phone .jr-goal.done .jr-box{background:#8cf070;border-color:#8cf070}
#journal-phone .jr-goal.done .jr-text{color:#9aa890}
#journal-phone .jr-badge{display:inline-block;font-size:11px;color:#08080f;background:#f8e848;border-radius:3px;padding:2px 4px;margin-left:6px;vertical-align:middle}
#journal-phone .jr-section{font-size:11px;color:#6a5a90;margin:14px 0 4px}
#journal-phone .jr-note{background:#12121e;border:1px solid #2a2a40;border-radius:8px;padding:8px 10px;margin:8px 0}
#journal-phone .jr-note-ch{font-size:11px;color:#8878a8;margin-bottom:4px}
#journal-phone .jr-empty{color:#8878a8;font-size:11px;padding:16px 0;text-align:center}
#journal-phone .jr-contact{display:flex;align-items:center;gap:10px;margin:8px 0 10px}
#journal-phone .jr-avatar{flex:0 0 34px;height:34px;border-radius:50%;background:#1a1a30;border:2px solid ${ANON_COLOR};display:flex;align-items:center;justify-content:center;color:${ANON_COLOR};font-size:12px}
#journal-call{width:100%;min-height:44px;font:inherit;font-size:11px;color:#08080f;background:#8cf070;border:none;border-radius:22px;cursor:pointer}
#journal-call:disabled{background:#2a3a2a;color:#5f8090;cursor:default}
#journal-phone .jr-level{font-size:11px;color:#8878a8;margin:10px 0 0}
#journal-phone .jr-bubble{background:#10202a;border:1px solid #1a2a38;color:${ANON_COLOR};border-radius:10px 10px 10px 2px;padding:10px 12px;margin-top:10px}
#journal-phone .jr-click{font-size:11px;color:#5f8090;margin-top:6px;text-align:right}
`;

export class JournalPanel {
  private readonly scene: Phaser.Scene;
  private readonly hooks: JournalHooks;
  private readonly button: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly dot: Phaser.GameObjects.Arc;
  private overlay: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private tab: JournalTab = 'goals';
  /** Ids que eran nuevos al abrir (para la etiqueta NEW mientras está abierto) */
  private freshIds = new Set<string>();
  private openedAt = 0;
  private calling = false;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, hooks: JournalHooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.button = scene.add.container(BTN.x, BTN.y).setDepth(600).setScrollFactor(0);
    this.bg = setTouchInteractive(scene.add.rectangle(0, 0, BTN.w, BTN.h, TWP.WALLET_BG, 0.85)
      .setStrokeStyle(1, TWP.WALLET_BORDER, 0.6)
      .setOrigin(0, 0), BTN.w, BTN.h);
    // Móvil dibujado: carcasa, pantalla y botón
    const icon = scene.add.graphics();
    icon.lineStyle(1.5, 0xc0b0d8, 1);
    icon.strokeRoundedRect(10, 3.5, 10, 17, 2);
    icon.fillStyle(0x48d8e8, 0.85);
    icon.fillRect(12, 6, 6, 10);
    icon.fillStyle(0xc0b0d8, 1);
    icon.fillCircle(15, 18, 1);
    this.dot = scene.add.circle(BTN.w - 3, 3, 4, 0xf8e848).setStrokeStyle(1, 0x08080f, 1).setVisible(false);
    this.button.add([this.bg, icon, this.dot]);
    this.bg.on('pointerover', () => this.bg.setStrokeStyle(1, TWP.WALLET_BORDER_ON, 0.9));
    this.bg.on('pointerout', () => this.bg.setStrokeStyle(1, TWP.WALLET_BORDER, 0.6));
    this.bg.on('pointerdown', () => this.toggle());
    scene.registry.set('journalOpen', false);
  }

  /** A0.5: si el punto de pantalla cae en el botón (hit-test de la API de QA, como Save y Wallet). */
  containsButton(x: number, y: number): boolean {
    return this.button.active && this.button.visible && this.bg.active && touchContains(this.bg, x, y);
  }

  /** Centro del botón en coordenadas del juego (smoke y demo tocan ahí con el dedo). */
  buttonCenter(): { x: number; y: number } {
    const b = this.bg.getBounds();
    return { x: b.centerX, y: b.centerY };
  }

  isOpen(): boolean {
    return !!this.overlay;
  }

  isCalling(): boolean {
    return this.calling;
  }

  /** Lo que hace el botón: abre (si se puede) o cierra. */
  toggle(): boolean {
    if (this.overlay) {
      this.close();
      return false;
    }
    return this.open();
  }

  /** Abre el diario. false si ahora no se puede (cinemática, diálogo, script…; `blockedReason`). */
  open(tab: JournalTab = 'goals', retry = 1): boolean {
    if (this.destroyed) return false;
    if (this.overlay) {
      this.showTab(tab);
      return true;
    }
    if (this.hooks.blockedReason()) {
      // A1.14: el toque que cierra una frase suelta también abre el diario (reintenta cuando acaba el script)
      if (retry > 0 && this.hooks.skipText?.()) {
        this.scene.time.delayedCall(60, () => { this.open(tab, retry - 1); });
        return false;
      }
      this.scene.tweens.add({ targets: this.button, x: BTN.x + 3, duration: 50, yoyo: true, repeat: 2, onComplete: () => this.button.setX(BTN.x) });
      return false;
    }
    this.refresh();
    // Lo que estaba sin ver se enseña con NEW y pasa a visto
    const state = this.state();
    const chapter = journalChapter(state);
    const world = journalWorld(state);
    const progress = journalProgress(state);
    this.freshIds = new Set(unseenIds(JOURNAL_CHAPTERS, chapter, world, progress));
    this.save(markSeen(JOURNAL_CHAPTERS, chapter, world, progress));
    this.dot.setVisible(false);
    this.build();
    this.showTab(tab);
    this.openedAt = performance.now();
    this.scene.registry.set('journalOpen', true);
    sfxOf(this.scene)?.play('journal_open', { volume: 0.4 });
    return true;
  }

  close(): void {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
    this.calling = false;
    if (!this.overlay) return;
    sfxOf(this.scene)?.play('journal_close', { volume: 0.35 });
    this.hooks.stopVoice();
    this.overlay.remove();
    this.overlay = null;
    this.body = null;
    this.freshIds.clear();
    if (!this.destroyed) this.scene.registry.set('journalOpen', false);
  }

  showTab(tab: JournalTab): void {
    this.tab = tab;
    if (!this.overlay) return;
    for (const b of this.overlay.querySelectorAll<HTMLButtonElement>('.jr-tab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    this.renderBody();
  }

  /**
   * Llamar a Anon desde el panel (pestaña Call Anon): da tono RING_MS, apunta el nivel de pista en la partida, enseña
   * el texto y lo dice con su voz. null si el diario está cerrado o ya hay una llamada en curso.
   */
  callAnon(): Promise<AnonCall | null> {
    if (!this.overlay || this.calling) return Promise.resolve(null);
    if (this.tab !== 'anon') this.showTab('anon');
    this.calling = true;
    this.renderBody();
    // A4.4: tono de llamada (phone_ring dura RING_MS) y descolgar al contestar
    sfxOf(this.scene)?.play('phone_ring', { volume: 0.45 });
    return new Promise((resolve) => {
      this.ringTimer = setTimeout(() => {
        this.ringTimer = null;
        if (!this.overlay || !this.calling || this.destroyed) {
          this.calling = false;
          resolve(null);
          return;
        }
        const state = this.state();
        const { call, progress } = callAnon(JOURNAL_CHAPTERS, journalChapter(state), journalWorld(state), journalProgress(state));
        this.save(progress);
        this.scene.registry.set('journalLastCall', call);
        this.calling = false;
        this.renderBody();
        sfxOf(this.scene)?.play('phone_pickup', { volume: 0.4 });
        this.hooks.playVoice(call.text);
        resolve(call);
      }, RING_MS);
    });
  }

  /**
   * Cada pocos cientos de ms (UIScene) y al abrir: apunta las notas cuya condición ya se cumple y pone el punto del
   * botón si hay algo sin ver (con un pequeño latido cuando aparece).
   */
  refresh(): void {
    if (this.destroyed) return;
    const state = this.state();
    if (!state) return;
    const chapter = journalChapter(state);
    const world = journalWorld(state);
    const progress = journalProgress(state);
    const synced = syncNotes(JOURNAL_CHAPTERS, chapter, world, progress);
    if (synced !== progress) {
      this.save(synced);
      // A4.4: Dex apunta algo en el móvil (garabato) cuando aparece una nota nueva
      if (synced.notes.length > progress.notes.length) sfxOf(this.scene)?.play('journal_note', { volume: 0.35 });
    }
    // A4.5: puzle resuelto (objetivo cumplido) o capítulo cerrado = stinger. La instantánea vive en el registry del juego, así
    // un objetivo que se cumple justo antes de cambiar de escena suena al entrar en la siguiente; la primera vez solo apunta
    const snapshot: GoalSnapshot = { chapter, done: goalsView(chapterData(JOURNAL_CHAPTERS, chapter), world).filter((g) => g.done).length };
    const prev = this.scene.game.registry.get('stingerGoals') as GoalSnapshot | undefined;
    for (const kind of goalStingers(prev, snapshot)) playStinger(this.scene, kind);
    if (!prev || prev.chapter !== snapshot.chapter || prev.done !== snapshot.done) this.scene.game.registry.set('stingerGoals', snapshot);
    const unseen = this.overlay ? 0 : unseenIds(JOURNAL_CHAPTERS, chapter, world, synced).length;
    if (unseen > 0 && !this.dot.visible) {
      this.dot.setVisible(true).setScale(1);
      this.scene.tweens.add({ targets: this.dot, scale: 1.6, duration: 180, yoyo: true, repeat: 2 });
    } else if (unseen === 0 && this.dot.visible) {
      this.dot.setVisible(false);
    }
  }

  qaState(): JournalQaState {
    const state = this.state();
    const chapter = journalChapter(state);
    const world = journalWorld(state);
    const progress = journalProgress(state);
    const last = this.scene.registry.get('journalLastCall') as AnonCall | undefined;
    return {
      open: this.isOpen(),
      tab: this.overlay ? this.tab : null,
      chapter,
      goals: goalsView(chapterData(JOURNAL_CHAPTERS, chapter), world).map((g) => ({ id: g.id, done: g.done })),
      notes: [...progress.notes],
      anon: last ? { puzzle: last.puzzle, level: last.level, text: last.text } : null,
      openPuzzle: openPuzzleLevel(JOURNAL_CHAPTERS, chapter, world, progress),
      unseen: unseenIds(JOURNAL_CHAPTERS, chapter, world, progress).length,
      calling: this.calling,
    };
  }

  destroy(): void {
    this.close();
    this.destroyed = true;
    document.getElementById('journal-overlay')?.remove();
    document.getElementById(STYLE_ID)?.remove();
    this.button.destroy();
  }

  // ─── interno ─────────────────────────────────────────────

  private state(): GameState | undefined {
    return this.scene.registry.get('gameState') as GameState | undefined;
  }

  /** Guarda el progreso en la partida viva (mismo patrón que las opciones usadas de A2.6). */
  private save(progress: JournalProgress): void {
    const state = this.state();
    if (!state) return;
    state.journal = progress;
    this.scene.registry.set('gameState', state);
  }

  private build(): void {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    document.getElementById('journal-overlay')?.remove();
    const overlay = el('div');
    overlay.id = 'journal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', "Dex's phone");
    // Toque fuera del móvil: cierra. Con pointerdown (no click) y tras OPEN_GUARD_MS, para que el clic emulado del mismo
    // toque que lo abrió no lo cierre al momento
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay && performance.now() - this.openedAt > OPEN_GUARD_MS) this.close();
    });

    const phone = el('div');
    phone.id = 'journal-phone';
    const head = el('div', 'jr-head');
    const titles = el('div', 'jr-title');
    titles.dataset.role = 'title';
    const close = el('button');
    close.id = 'journal-close';
    close.type = 'button';
    close.textContent = 'X';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(titles, close);

    const tabs = el('div', 'jr-tabs');
    for (const [id, label] of [['goals', 'GOALS'], ['notes', 'NOTES'], ['anon', 'CALL ANON']] as const) {
      const b = el('button', 'jr-tab');
      b.type = 'button';
      b.dataset.tab = id;
      b.textContent = label;
      b.addEventListener('click', () => this.showTab(id));
      tabs.appendChild(b);
    }
    const body = el('div', 'jr-body');
    phone.append(head, tabs, body);
    overlay.appendChild(phone);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.body = body;
  }

  private renderBody(): void {
    const overlay = this.overlay;
    const body = this.body;
    if (!overlay || !body) return;
    const state = this.state();
    const chapter = journalChapter(state);
    const world = journalWorld(state);
    const progress = journalProgress(state);
    const def = CHAPTERS.find((c) => c.id === chapter);

    const title = overlay.querySelector<HTMLDivElement>('[data-role=title]');
    if (title) {
      title.textContent = '';
      title.append(text(`CHAPTER ${chapter}`), el('br'));
      const sub = el('div', 'jr-sub');
      sub.textContent = def?.title ?? '';
      title.appendChild(sub);
    }
    // Punto NEW en las pestañas con algo nuevo
    const goalIds = new Set((chapterData(JOURNAL_CHAPTERS, chapter)?.goals ?? []).map((g) => g.id));
    const hasNew = { goals: [...this.freshIds].some((id) => goalIds.has(id)), notes: [...this.freshIds].some((id) => !goalIds.has(id)), anon: false };
    for (const b of overlay.querySelectorAll<HTMLButtonElement>('.jr-tab')) {
      b.querySelector('.jr-new')?.remove();
      if (hasNew[b.dataset.tab as JournalTab] && b.dataset.tab !== this.tab) b.appendChild(el('span', 'jr-new'));
    }

    body.textContent = '';
    body.dataset.tab = this.tab;
    if (this.tab === 'goals') this.renderGoals(body, chapter, world);
    else if (this.tab === 'notes') this.renderNotes(body, progress);
    else this.renderAnon(body, chapter, world, progress);
  }

  private renderGoals(body: HTMLDivElement, chapter: number, world: JournalWorld): void {
    const goals = goalsView(chapterData(JOURNAL_CHAPTERS, chapter), world);
    if (!goals.length) body.appendChild(empty('No goals. Suspicious.'));
    for (const g of goals) {
      const row = el('div', `jr-goal${g.done ? ' done' : ''}`);
      row.dataset.goal = g.id;
      row.dataset.done = String(g.done);
      const box = el('span', 'jr-box');
      if (g.done) box.appendChild(iconEl('check', 10, undefined, '#08080f'));
      const t = el('span', 'jr-text');
      t.textContent = g.text;
      if (g.done && this.freshIds.has(g.id)) t.appendChild(badge('NEW'));
      row.append(box, t);
      body.appendChild(row);
    }
    const earlier = CHAPTERS.filter((c) => c.id < chapter);
    if (earlier.length) {
      const sec = el('div', 'jr-section');
      sec.textContent = 'CLOSED CASES';
      body.appendChild(sec);
      for (const c of earlier) {
        const row = el('div', 'jr-goal done');
        const box = el('span', 'jr-box');
        box.appendChild(iconEl('check', 10, undefined, '#08080f'));
        const t = el('span', 'jr-text');
        t.textContent = `${c.id}. ${c.title}`;
        row.append(box, t);
        body.appendChild(row);
      }
    }
  }

  private renderNotes(body: HTMLDivElement, progress: JournalProgress): void {
    const notes = [...progress.notes].reverse().map((id) => findNote(JOURNAL_CHAPTERS, id))
      .filter((n): n is NonNullable<ReturnType<typeof findNote>> => n !== null);
    if (!notes.length) {
      body.appendChild(empty('Nothing written down yet. Look at things. Read things.'));
      return;
    }
    for (const n of notes) {
      const card = el('div', 'jr-note');
      card.dataset.note = n.id;
      const ch = el('div', 'jr-note-ch');
      ch.textContent = `CH ${n.chapter}`;
      if (this.freshIds.has(n.id)) ch.appendChild(badge('NEW'));
      const t = el('div');
      t.textContent = n.text;
      card.append(ch, t);
      body.appendChild(card);
    }
  }

  private renderAnon(body: HTMLDivElement, chapter: number, world: JournalWorld, progress: JournalProgress): void {
    const contact = el('div', 'jr-contact');
    const avatar = el('div', 'jr-avatar');
    avatar.textContent = '?';
    const who = el('div');
    who.append(text('ANON'));
    const sub = el('div', 'jr-sub');
    sub.textContent = 'Unknown number. Calls when it feels like it.';
    who.appendChild(sub);
    contact.append(avatar, who);
    body.appendChild(contact);

    const call = el('button');
    call.id = 'journal-call';
    call.type = 'button';
    call.disabled = this.calling;
    call.textContent = this.calling ? 'CALLING...' : 'CALL ANON';
    call.addEventListener('click', () => { void this.callAnon(); });
    body.appendChild(call);

    const open = openPuzzleLevel(JOURNAL_CHAPTERS, chapter, world, progress);
    const level = el('div', 'jr-level');
    level.textContent = open
      ? `Hints for this lead: ${open.level}/${HINT_LEVELS}${open.level >= HINT_LEVELS ? ' (that was the answer)' : ''}`
      : 'No open leads. He will still pick up.';
    body.appendChild(level);

    const transcript = el('div');
    transcript.id = 'journal-transcript';
    const last = this.scene.registry.get('journalLastCall') as AnonCall | undefined;
    if (this.calling) {
      const ring = el('div', 'jr-click');
      ring.style.textAlign = 'left';
      ring.textContent = 'Ringing...';
      transcript.appendChild(ring);
    } else if (last) {
      const bubble = el('div', 'jr-bubble');
      bubble.dataset.puzzle = last.puzzle ?? '';
      bubble.dataset.level = String(last.level);
      bubble.textContent = last.text;
      const click = el('div', 'jr-click');
      click.textContent = '*click*';
      transcript.append(bubble, click);
    }
    body.appendChild(transcript);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(s: string): Text {
  return document.createTextNode(s);
}

function badge(s: string): HTMLSpanElement {
  const b = el('span', 'jr-badge');
  b.textContent = s;
  return b;
}

function empty(s: string): HTMLDivElement {
  const d = el('div', 'jr-empty');
  d.textContent = s;
  return d;
}

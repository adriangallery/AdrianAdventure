import Phaser from 'phaser';
import { migrateSave } from '@/systems/SaveMigration';
import { collectLocalCandidates, pickContinue, cloudBeatsLocal, type ContinueCandidate } from '@/systems/SaveProgress';
import { getWalletState } from '@/web3/wallet';
import { loadRemoteSlots } from '@/web3/wallet-save';
import type { MusicManager } from '@/systems/MusicManager';
import { TWP, FONT } from '@/config/theme';
import { iconSvg, setIconLabel } from '@/ui/icons';
import { ACHIEVEMENTS } from '@/config/achievements.config';
import { resolveEnsMany } from '@/web3/ens';
import { bindShutdown } from './lifecycle';
import { BRANDING } from '@/config/branding';
import { formatPlayTime, isFinishedRun } from '@/systems/Ending';

/** Fila del leaderboard de save.zerothetoken.com */
interface LeaderboardPlayer {
  /** A1.6: truncada por el servidor (`0x13fc…7f23`); un servidor (o caché) antiguo aún puede mandarla completa */
  address: string;
  /** A1.6: nombre ENS resuelto en el servidor (null si no tiene o aún no está resuelto) */
  ens?: string | null;
  score?: number;
  chapters?: number;
  sceneName?: string;
  gameComplete?: boolean;
  items?: number;
  scenesVisited?: number;
  puzzles?: number;
  lastSaved: number | string;
  holderBadges?: string[];
  achievements?: string[];
}

/** Texto del servidor que va a innerHTML */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * Title/Menu screen — Thimbleweed Park noir atmosphere.
 */
export class MenuScene extends Phaser.Scene {
  private resizeHandler: (() => void) | null = null;

  constructor() {
    super({ key: 'MenuScene' });
  }

  preload(): void {
    if (!this.textures.exists('intro')) {
      this.load.image('intro', 'assets/ui/intro.png');
    }
  }

  create(): void {
    bindShutdown(this); // A1.10: Phaser no llama a shutdown() solo
    this.syncCanvasToWindow();
    this.buildMenu();
    this.resizeHandler = () => {
      if (!this.scene.isActive('MenuScene')) return;
      if (!this.cameras?.main) return;
      this.children.removeAll(true);
      this.tweens.killAll();
      this.buildMenu();
    };
    this.scale.on('resize', this.resizeHandler);

    // A9.5 (iPhone): al girar, iOS (Safari y Chrome) da medidas viejas durante el giro y el ScaleManager no
    // siempre se entera del tamaño final: la portada quedaba montada para la orientación anterior. Igual que
    // GameScene: se escucha también visualViewport y orientationchange y se vuelve a medir la ventana tras
    // dejar asentar el giro (100 ms y 400 ms).
    this.boundSchedule = () => this.scheduleViewportSync();
    window.visualViewport?.addEventListener('resize', this.boundSchedule);
    window.addEventListener('orientationchange', this.boundSchedule);
    window.addEventListener('resize', this.boundSchedule);
  }

  private boundSchedule: (() => void) | null = null;
  private syncTimers: ReturnType<typeof setTimeout>[] = [];

  private scheduleViewportSync(): void {
    this.syncTimers.forEach(clearTimeout);
    this.syncTimers = [
      setTimeout(() => this.syncCanvasToWindow(), 100),
      setTimeout(() => this.syncCanvasToWindow(), 400),
    ];
  }

  /** Lleva el lienzo al tamaño real de la ventana; si cambia, el ScaleManager emite 'resize' y se rehace el menú. */
  private syncCanvasToWindow(): void {
    if (!this.scene.isActive('MenuScene')) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(this.scale.width - w) > 1 || Math.abs(this.scale.height - h) > 1) {
      this.scale.resize(w, h);
    }
  }

  shutdown(): void {
    if (this.resizeHandler) {
      this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    this.syncTimers.forEach(clearTimeout);
    this.syncTimers = [];
    if (this.boundSchedule) {
      window.visualViewport?.removeEventListener('resize', this.boundSchedule);
      window.removeEventListener('orientationchange', this.boundSchedule);
      window.removeEventListener('resize', this.boundSchedule);
      this.boundSchedule = null;
    }
  }

  private buildMenu(): void {
    if (!this.cameras?.main) return;
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const refSize = isPortrait ? Math.max(width, height * 0.45) : width;

    this.cameras.main.setBackgroundColor('#000000');

    // Buttons config (need count to calculate available space)
    // A1.13: «Continue» = la partida MÁS RECIENTE CON PROGRESO de todas las fuentes (slots 0-2, «Before load»,
    // «Previous autosave», partidas de cartera de este dispositivo y, si llega a tiempo, la nube de la wallet).
    // Antes solo miraba el autoguardado (slot 0), que podía ser el estado vacío de un «New Game».
    let chosen: ContinueCandidate | null = MenuScene.bestLocalSave();
    const hasSave = !!chosen;
    const btnSize = Math.max(14, Math.min(20, Math.floor(refSize * 0.022)));
    const btnSpacing = Math.max(btnSize * 2.5, 44);
    const btnCount = hasSave ? 3 : 2; // New Game + Leaderboard + optional Continue
    const subSize = Math.max(11, Math.min(14, Math.floor(refSize * 0.014)));
    const rotateHintH = isPortrait ? 40 : 0;

    // Subtitle — A1.7: el arte del título llega con los personajes hasta su borde inferior, así que el
    // subtítulo va DEBAJO del arte (nunca encima). Se crea primero para medir su alto real (con el
    // wordWrap puede ocupar dos líneas en vertical) y reservarle sitio antes de escalar la imagen.
    const subtitle = this.add.text(width / 2, 0, BRANDING.tagline, {
      fontFamily: FONT.FAMILY,
      fontSize: `${subSize}px`,
      color: TWP.MENU_SUBTITLE,
      wordWrap: { width: width * 0.85 },
      align: 'center',
      lineSpacing: Math.round(subSize * 0.4),
      stroke: '#000000',
      strokeThickness: 4,
      shadow: { offsetX: 0, offsetY: 0, color: '#000000', blur: 8, fill: true, stroke: true },
    }).setOrigin(0.5, 0);
    const subGap = Math.max(6, Math.round(subSize * 0.6));
    const subBlockH = subtitle.height + subGap * 2;

    // Reserve space for subtitle + buttons at the bottom
    const btnsH = btnCount * btnSpacing + 8;
    const bottomZone = btnsH + rotateHintH + 16 + subBlockH;

    // Logo image — fills full width, black bg blends with menu bg
    let imgBottomY = height * 0.5;
    if (this.textures.exists('intro')) {
      const img = this.add.image(width / 2, 0, 'intro').setOrigin(0.5, 0);
      const maxImgH = height - bottomZone;
      const scale = Math.min(width / img.width, maxImgH / img.height);
      img.setScale(scale);
      imgBottomY = img.height * scale;
    }

    // Subtitle just below the art (never over the characters)
    subtitle.setY(imgBottomY + subGap).setName('menu-subtitle');
    const subBottomY = imgBottomY + subBlockH;

    // Buttons — centered in the space between subtitle and bottom edge
    const btnBlockH = btnCount * btnSpacing;
    const spaceBelow = height - rotateHintH - subBottomY;
    const btnY = subBottomY + (spaceBelow - btnBlockH) / 2 + btnSpacing / 2;

    const startGame = (loadSave: boolean) => {
      if (loadSave) {
        if (!chosen) return;
        const state = structuredClone(chosen.state);
        if (!state.firedTriggers) state.firedTriggers = [];
        if (!state.dialogueProgress) state.dialogueProgress = {};
        if (!state.achievements) state.achievements = [];
        if (!Array.isArray(state.visited)) state.visited = [state.currentScene];
        this.registry.set('gameState', state);
        this.registry.set('currentSceneId', state.currentScene);
        if (chosen.source !== 'slot' && state.playerPosition) {
          this.registry.set('spawnOverride', { x: state.playerPosition.pctX, y: state.playerPosition.pctY });
        }
      } else {
        this.registry.remove('gameState');
      }
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('PreloadScene');
      });
    };

    const musicManager = this.game.registry.get('musicManager') as MusicManager | null;

    // A1.13: un solo arranque por menú. En móvil, el toque en el aviso de sonido (touchend) quitaba el aviso y el
    // clic de ratón que el navegador emula después caía en el lienzo: si debajo estaba «New Game», tras «Continue»
    // arrancaba también una partida nueva (vacía) que se autoguardaba encima.
    let starting = false;
    const choose = (loadSave: boolean) => {
      if (starting) return;
      starting = true;
      this.showAudioPrompt(musicManager, () => startGame(loadSave));
    };

    this.createButton(width / 2, btnY, 'New Game', btnSize, () => choose(false));

    if (hasSave) {
      this.createButton(width / 2, btnY + btnSpacing, 'Continue', btnSize, () => choose(true));
      // V6: dónde y cuándo se guardó la partida que se va a continuar (A1.13: la que de verdad se carga)
      const detail = this.add.text(width / 2, btnY + btnSpacing + btnSize * 1.05, MenuScene.continueDetail(chosen), {
        fontFamily: FONT.FAMILY,
        fontSize: `${Math.max(11, Math.round(subSize * 0.8))}px`,
        color: TWP.MENU_SUBTITLE,
      }).setOrigin(0.5, 0).setAlpha(0.8).setName('continue-detail');
      // La nube (wallet ya conectada) no bloquea el menú: si llega y es más nueva y con más progreso, pasa a ser la elegida
      const addr = getWalletState().address;
      if (addr) {
        void loadRemoteSlots(addr).then((slots) => {
          if (!slots || !detail.active) return;
          const cloud = pickContinue(Object.entries(slots).map(([id, w]) => (w?.state ? {
            source: 'cloud' as const, slotId: Number(id), state: w.state, sceneName: w.sceneName ?? 'Unknown', timestamp: w.timestamp ?? 0,
          } : null)));
          if (cloudBeatsLocal(chosen, cloud)) {
            chosen = cloud;
            detail.setText(MenuScene.continueDetail(chosen));
          }
        }).catch(() => {});
      }
    }
    (window as unknown as { __continuePick?: unknown }).__continuePick = chosen
      ? { source: chosen.source, slotId: chosen.slotId ?? null, key: chosen.key ?? null, sceneName: chosen.sceneName, timestamp: chosen.timestamp }
      : null;

    // Leaderboard button
    const lbY = hasSave ? btnY + btnSpacing * 2 : btnY + btnSpacing;
    this.createButton(width / 2, lbY, 'Leaderboard', btnSize, () => this.showLeaderboard());

    // Rotate hint in portrait
    if (isPortrait) {
      const hintSize = Math.max(11, Math.min(12, Math.floor(refSize * 0.012)));
      this.add.text(width / 2, height - 30, 'Rotate for best experience', {
        fontFamily: FONT.FAMILY,
        fontSize: `${hintSize}px`,
        color: TWP.MENU_SUBTITLE,
      }).setOrigin(0.5);
    }
  }

  /**
   * Native DOM modal asking the user to enable sound.
   * The "enable" button's touchstart/click is a real browser gesture
   * that unlocks AudioContext on mobile (iOS Safari included).
   */
  private showAudioPrompt(musicManager: MusicManager | null, onProceed: () => void): void {
    // Only skip the prompt if audio was explicitly unlocked THIS session.
    // localStorage "muted=false" from a previous session doesn't count —
    // mobile browsers require a fresh user gesture each page load.
    if (musicManager?.isUnlockedThisSession()) {
      onProceed();
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(6,6,12,0.92);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace;
      -webkit-tap-highlight-color: transparent;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1a1a2e; border: 2px solid #f8e848;
      border-radius: 8px; padding: 28px 24px; text-align: center;
      max-width: 420px; width: 90%;
    `;

    const icon = document.createElement('div');
    // A7.3: altavoz dibujado (el emoji 🔊 salía como cuadradito sin fuente de emoji)
    icon.innerHTML = iconSvg('speaker', 40);
    icon.style.cssText = 'line-height: 0; margin-bottom: 16px;';
    modal.appendChild(icon);

    const msg = document.createElement('div');
    msg.textContent = 'This adventure has music, voices & sound effects!';
    msg.style.cssText = 'color: #e8d5f5; font-size: 11px; line-height: 1.8; margin-bottom: 20px;';
    modal.appendChild(msg);

    const btnStyle = `
      display: block; width: 100%; padding: 14px 16px; margin-bottom: 10px;
      font-family: 'Press Start 2P', monospace; font-size: 11px;
      border-radius: 6px; cursor: pointer; border: none;
      -webkit-tap-highlight-color: transparent;
    `;

    // --- "Enable" button — this is the native gesture that unlocks audio ---
    const yesBtn = document.createElement('button');
    setIconLabel(yesBtn, 'note', 'Enable Sound', 14);
    yesBtn.style.cssText = btnStyle + `
      background: #5b3a8c; color: #f8e848;
      border: 2px solid #f8e848;
    `;

    // CRITICAL for iOS: use touchend (NOT touchstart) and do NOT preventDefault.
    // iOS Safari only recognises a completed tap (touchend) as a valid user
    // gesture for AudioContext unlock.  preventDefault() voids the gesture.
    let acted = false;
    const enableAndProceed = () => {
      if (acted) return;  // guard against touchend + click double-fire
      acted = true;
      if (musicManager) {
        musicManager.unlockFromGesture();
        if (musicManager.isMuted()) musicManager.toggleMute();
      }
      MenuScene.dismissAfterGhostClick(overlay);
      onProceed();
    };
    yesBtn.addEventListener('touchend', enableAndProceed);
    yesBtn.addEventListener('click', enableAndProceed);
    modal.appendChild(yesBtn);

    // --- "No thanks" button ---
    const noBtn = document.createElement('button');
    setIconLabel(noBtn, 'mute', 'No thanks, silence is golden', 12);
    noBtn.style.cssText = btnStyle + `
      background: transparent; color: #665577;
      border: 1px solid #333;
    `;
    let skipped = false;
    const skipAndProceed = () => {
      if (skipped) return;
      skipped = true;
      // Re-apply mute — the click gesture may trigger Phaser's auto-unlock
      // which can reset game.sound.mute. Explicitly enforce silence.
      if (musicManager) {
        if (!musicManager.isMuted()) musicManager.toggleMute();
        this.game.sound.mute = true;
      }
      MenuScene.dismissAfterGhostClick(overlay);
      onProceed();
    };
    noBtn.addEventListener('touchend', skipAndProceed);
    noBtn.addEventListener('click', skipAndProceed);
    modal.appendChild(noBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  private async showLeaderboard(): Promise<void> {
    const overlay = document.createElement('div');
    overlay.id = 'leaderboard-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(6,6,12,0.95);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1a1a2e; border: 2px solid #f8e848;
      border-radius: 8px; padding: 24px; text-align: center;
      max-width: 500px; width: 95%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('div');
    setIconLabel(title, 'trophy', 'LEADERBOARD', 18);
    title.style.cssText = 'color: #f8e848; font-size: 16px; margin-bottom: 20px;';
    modal.appendChild(title);

    const loading = document.createElement('div');
    loading.textContent = 'Loading...';
    loading.style.cssText = 'color: #888; font-size: 11px; margin: 20px 0;';
    modal.appendChild(loading);

    const cleanup = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      display: block; width: 100%; padding: 8px 16px; margin-top: 16px;
      background: transparent; border: 1px solid #444; border-radius: 6px;
      color: #888; font-family: 'Press Start 2P', monospace; font-size: 8px;
      cursor: pointer;
    `;
    closeBtn.onclick = cleanup;
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Fetch leaderboard
    try {
      const resp = await fetch('https://save.zerothetoken.com/leaderboard');
      const data = await resp.json() as { players?: LeaderboardPlayer[]; total?: number };
      loading.remove();

      if (!data.players || data.players.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No players yet. Be the first!';
        empty.style.cssText = 'color: #888; font-size: 11px; margin: 20px 0;';
        modal.insertBefore(empty, closeBtn);
        return;
      }

      const table = document.createElement('div');
      table.style.cssText = 'text-align: left; margin-bottom: 8px;';

      // Top 5 only
      const top = data.players.slice(0, 5);

      // A1.6: el servidor manda la dirección truncada y el ENS. Compatibilidad con un servidor antiguo (dirección
      // completa, sin `ens`): se trunca aquí y solo entonces se resuelve el ENS en el cliente.
      const shorten = (a: string) => (a.length === 42 ? a.slice(0, 6) + '\u2026' + a.slice(-4) : a);
      const legacy = top.filter((p) => p.address.length === 42 && !p.ens).map((p) => p.address.toLowerCase());
      if (legacy.length > 0) {
        resolveEnsMany(legacy).then((map) => {
          for (const [full, name] of Object.entries(map)) {
            if (!name) continue;
            const el = table.querySelector(`[data-addr="${shorten(full)}"] .lb-name`);
            if (el) el.textContent = name;
          }
        }).catch(() => {});
      }

      top.forEach((p, i) => {
        const row = document.createElement('div');
        const medal = i === 0 ? iconSvg('medal_gold', 18) : i === 1 ? iconSvg('medal_silver', 18) : i === 2 ? iconSvg('medal_bronze', 18) : `#${i + 1}`;
        const shortAddr = shorten(p.address.toLowerCase());
        const addr = escapeHtml(p.ens || shortAddr);
        const sceneName = (p.sceneName || 'Unknown').replace(/^(The |AdrianLAB )/, '');
        const complete = p.gameComplete ? ` ${iconSvg('star', 10)}` : '';
        const items = p.items ?? 0;
        const scenes = p.scenesVisited ?? 0;
        const puzzles = p.puzzles ?? 0;
        const date = new Date(p.lastSaved).toLocaleDateString();
        const badges = (p.holderBadges ?? []) as string[];
        const isHolder = badges.length > 0;

        row.style.cssText = `
          padding: 12px 10px; margin-bottom: 8px;
          background: ${i === 0 ? '#2a2a1e' : isHolder ? '#1e1e2e' : '#1a1a24'};
          border: 1px solid ${i === 0 ? '#f8e848' : isHolder ? '#3396ff' : i < 3 ? '#5b3a8c' : '#333'};
          border-radius: 6px;
        `;

        // Achievement badges earned
        const achIds = (p.achievements ?? []) as string[];
        const achNames = achIds.map((id: string) => {
          const def = ACHIEVEMENTS.find(a => a.id === id);
          return def ? def.name : id;
        });

        let badgeHtml = '';
        // Holder badges
        if (badges.length > 0) {
          badgeHtml += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;">${
            badges.map((b: string) => `<span style="font-size:7px; padding:2px 5px; background:#3396ff22; border:1px solid #3396ff44; border-radius:3px; color:#3396ff;">${b}</span>`).join('')
          }</div>`;
        }
        // Game achievements
        if (achNames.length > 0) {
          badgeHtml += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:${badges.length > 0 ? '4' : '6'}px;">${
            achNames.map((n: string) => `<span style="font-size:7px; padding:2px 5px; background:#f8e84822; border:1px solid #f8e84844; border-radius:3px; color:#f8e848;">${iconSvg('trophy', 8)} ${n}</span>`).join('')
          }</div>`;
        }

        row.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
            <span style="font-size:16px;">${medal}</span>
            <span data-addr="${escapeHtml(shortAddr)}" style="font-size:11px; color:#e8d5f5; flex:1; margin-left:8px;"><span class="lb-name">${addr}</span>${complete}</span>
            <span style="font-size:14px; color:#f8e848;">${p.score} pts</span>
          </div>
          <div style="display:flex; gap:10px; font-size:9px; color:#999;">
            <span>${p.chapters}/5 ch</span>
            <span>${scenes}/12 scenes</span>
            <span>${items}/20 found</span>
            <span>${puzzles}/5 puzzles</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:8px; color:#666; margin-top:4px;">
            <span>@ ${sceneName}</span>
            <span>${date}</span>
          </div>
          ${badgeHtml}
        `;
        table.appendChild(row);
      });

      const total = document.createElement('div');
      total.textContent = `${data.total} adventurer${data.total !== 1 ? 's' : ''} exploring`;
      total.style.cssText = 'color: #555; font-size: 9px; margin-top: 12px;';
      table.appendChild(total);

      modal.insertBefore(table, closeBtn);
    } catch {
      loading.textContent = 'Failed to load leaderboard';
      loading.style.color = '#e94560';
    }
  }

  /** «just now» · «5 min ago» · «3 h ago» · «2 d ago» */
  /**
   * A1.13: quita el aviso sin dejar pasar el clic emulado tras el toque: se hace invisible al instante pero sigue
   * encima (tapando el lienzo) unos 450 ms, lo que tarda el navegador en mandar el mousedown/click de compatibilidad.
   */
  static dismissAfterGhostClick(overlay: HTMLElement): void {
    overlay.style.opacity = '0';
    overlay.style.background = 'transparent';
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => overlay.remove(), 450);
  }

  /** A1.13: la mejor partida local para «Continue» (ver SaveProgress.pickContinue), ya migrada. */
  static bestLocalSave(): ContinueCandidate | null {
    try {
      const cands = collectLocalCandidates(localStorage);
      for (const c of cands) migrateSave(c);
      return pickContinue(cands);
    } catch {
      return null;
    }
  }

  static continueDetail(c: ContinueCandidate | null): string {
    if (!c) return '';
    // A9.4: partida terminada: «Continue» vuelve al epílogo (el camino de bajada repite el final); se dice en la portada
    if (isFinishedRun(c.state)) return `THE END · ${formatPlayTime(c.state.playTimeMs)} · epilogue`;
    return `${c.sceneName} · ${MenuScene.timeAgo(c.timestamp)}`;
  }

  static timeAgo(ts: number): string {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }

  private createButton(x: number, y: number, label: string, size: number, onClick: () => void): void {
    const text = this.add.text(x, y, `[ ${label} ]`, {
      fontFamily: FONT.FAMILY,
      fontSize: `${size}px`,
      color: TWP.MENU_BTN,
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      // A5.2: 14 px arriba y abajo → zona táctil ≥ 40 px de alto en un iPhone (antes 39)
      .setPadding(16, 14)
      .setName(`menu-btn-${label.toLowerCase().replace(/\s+/g, '-')}`);

    text.on('pointerover', () => text.setColor(TWP.MENU_BTN_HOVER));
    text.on('pointerout', () => text.setColor(TWP.MENU_BTN));
    text.on('pointerdown', onClick);
  }
}

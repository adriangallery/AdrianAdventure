import Phaser from 'phaser';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import type { MusicManager } from '@/systems/MusicManager';
import { TWP, FONT } from '@/config/theme';
import { ACHIEVEMENTS } from '@/config/achievements.config';
import { resolveEnsMany } from '@/web3/ens';

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
    this.buildMenu();
    this.resizeHandler = () => {
      if (!this.scene.isActive('MenuScene')) return;
      if (!this.cameras?.main) return;
      this.children.removeAll(true);
      this.tweens.killAll();
      this.buildMenu();
    };
    this.scale.on('resize', this.resizeHandler);
  }

  shutdown(): void {
    if (this.resizeHandler) {
      this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  private buildMenu(): void {
    if (!this.cameras?.main) return;
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const refSize = isPortrait ? Math.max(width, height * 0.45) : width;

    this.cameras.main.setBackgroundColor('#000000');

    // Buttons config (need count to calculate available space)
    const saveSystem = new SaveLoadSystem();
    const hasSave = saveSystem.hasSave();
    const btnSize = Math.max(14, Math.min(20, Math.floor(refSize * 0.022)));
    const btnSpacing = Math.max(btnSize * 2.5, 44);
    const btnCount = hasSave ? 4 : 3; // New Game + Leaderboard + Audio + optional Continue
    const subSize = Math.max(10, Math.min(14, Math.floor(refSize * 0.014)));
    const rotateHintH = isPortrait ? 40 : 0;

    // Reserve space for buttons at the bottom
    const btnsH = btnCount * btnSpacing + 8;
    const bottomZone = btnsH + rotateHintH + 16;

    // Logo image — fills full width, black bg blends with menu bg
    let imgBottomY = height * 0.5;
    if (this.textures.exists('intro')) {
      const img = this.add.image(width / 2, 0, 'intro').setOrigin(0.5, 0);
      const maxImgH = height - bottomZone;
      const scale = Math.min(width / img.width, maxImgH / img.height);
      img.setScale(scale);
      imgBottomY = img.height * scale;
    }

    // Subtitle — overlays the bottom edge of the image with glow for readability
    const subY = Math.min(imgBottomY - subSize * 0.5, height - bottomZone - subSize - 8);
    this.add.text(width / 2, subY, 'A Point & Click Web3 Adventure on Base', {
      fontFamily: FONT.FAMILY,
      fontSize: `${subSize}px`,
      color: TWP.MENU_SUBTITLE,
      wordWrap: { width: width * 0.85 },
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4,
      shadow: { offsetX: 0, offsetY: 0, color: '#000000', blur: 8, fill: true, stroke: true },
    }).setOrigin(0.5);

    // Buttons — centered in the space between image and bottom edge
    const btnBlockH = btnCount * btnSpacing;
    const spaceBelow = height - rotateHintH - imgBottomY;
    const btnY = imgBottomY + (spaceBelow - btnBlockH) / 2;

    this.createButton(width / 2, btnY, 'New Game', btnSize, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.registry.remove('gameState');
        this.scene.start('PreloadScene');
      });
    });

    if (hasSave) {
      this.createButton(width / 2, btnY + btnSpacing, 'Continue', btnSize, () => {
        const slot = saveSystem.loadAutoSave();
        if (slot) {
          this.registry.set('gameState', slot.state);
          this.registry.set('currentSceneId', slot.state.currentScene);
          this.cameras.main.fadeOut(400, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('PreloadScene');
          });
        }
      });
    }

    // Leaderboard button
    const lbY = hasSave ? btnY + btnSpacing * 2 : btnY + btnSpacing;
    this.createButton(width / 2, lbY, 'Leaderboard', btnSize, () => this.showLeaderboard());

    // Audio toggle — uses a NATIVE DOM button so the browser recognises
    // the tap as a real user gesture (Phaser's synthetic events don't count
    // for AudioContext unlock on iOS Safari).
    const musicManager = this.game.registry.get('musicManager') as MusicManager | null;
    const isMuted = musicManager?.isMuted() ?? true;

    // Remove any leftover toggle from a previous resize rebuild
    document.getElementById('audio-toggle-btn')?.remove();

    const btn = document.createElement('button');
    btn.id = 'audio-toggle-btn';
    btn.textContent = isMuted ? '\u{1F507} Sound OFF' : '\u{1F50A} Sound ON';
    btn.style.cssText = `
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: ${isPortrait ? '70px' : '30px'};
      font-family: 'Press Start 2P', cursive;
      font-size: ${Math.max(10, Math.min(14, Math.floor(refSize * 0.014)))}px;
      color: ${isMuted ? '#665577' : '#8878a8'};
      background: transparent; border: none; cursor: pointer;
      padding: 12px 20px; z-index: 1000;
      -webkit-tap-highlight-color: transparent;
    `;

    // touchstart + click cover all mobile & desktop browsers.
    // Both fire synchronously in the native gesture call-stack.
    const toggle = (e: Event) => {
      e.preventDefault();
      if (!musicManager) return;
      // Unlock AudioContext with native gesture — plays silent buffer for iOS
      musicManager.unlockFromGesture();
      const nowMuted = musicManager.toggleMute();
      btn.textContent = nowMuted ? '\u{1F507} Sound OFF' : '\u{1F50A} Sound ON';
      btn.style.color = nowMuted ? '#665577' : '#f8e848';
    };
    btn.addEventListener('touchstart', toggle, { passive: false });
    btn.addEventListener('click', toggle);

    document.body.appendChild(btn);

    // Clean up DOM button when leaving MenuScene
    this.events.once('shutdown', () => btn.remove());

    // Rotate hint in portrait
    if (isPortrait) {
      const hintSize = Math.max(9, Math.min(12, Math.floor(refSize * 0.012)));
      this.add.text(width / 2, height - 30, '\u{1F504} Rotate for best experience', {
        fontFamily: FONT.FAMILY,
        fontSize: `${hintSize}px`,
        color: TWP.MENU_SUBTITLE,
      }).setOrigin(0.5);
    }
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
    title.textContent = '\u{1F3C6} LEADERBOARD';
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
      const resp = await fetch('https://enchanting-reflection-production-a838.up.railway.app/leaderboard');
      const data = await resp.json();
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

      // Resolve ENS names in parallel (non-blocking — updates DOM when ready)
      const addresses = top.map((p: any) => p.address as string);
      const ensMap: Record<string, string | null> = {};
      resolveEnsMany(addresses).then((map) => {
        Object.assign(ensMap, map);
        // Update displayed names
        for (const [addr, name] of Object.entries(map)) {
          if (name) {
            const el = table.querySelector(`[data-addr="${addr.toLowerCase()}"]`);
            if (el) el.textContent = name;
          }
        }
      });

      top.forEach((p: any, i: number) => {
        const row = document.createElement('div');
        const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `#${i + 1}`;
        const shortAddr = p.address.slice(0, 6) + '...' + p.address.slice(-4);
        const cachedEns = ensMap[p.address.toLowerCase()];
        const addr = cachedEns || shortAddr;
        const sceneName = (p.sceneName || 'Unknown').replace(/^(The |AdrianLAB )/, '');
        const complete = p.gameComplete ? ' \u{2B50}' : '';
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
            achNames.map((n: string) => `<span style="font-size:7px; padding:2px 5px; background:#f8e84822; border:1px solid #f8e84844; border-radius:3px; color:#f8e848;">\u{1F3C6} ${n}</span>`).join('')
          }</div>`;
        }

        row.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
            <span style="font-size:16px;">${medal}</span>
            <span data-addr="${p.address.toLowerCase()}" style="font-size:11px; color:#e8d5f5; flex:1; margin-left:8px;">${addr}${complete}</span>
            <span style="font-size:14px; color:#f8e848;">${p.score} pts</span>
          </div>
          <div style="display:flex; gap:10px; font-size:9px; color:#999;">
            <span>\u{1F4D6} ${p.chapters}/5 ch</span>
            <span>\u{1F5FA} ${scenes}/12 scenes</span>
            <span>\u{1F50D} ${items}/20 found</span>
            <span>\u{1F9E9} ${puzzles}/5 puzzles</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:8px; color:#666; margin-top:4px;">
            <span>\u{1F3AE} ${sceneName}</span>
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

  private createButton(x: number, y: number, label: string, size: number, onClick: () => void): void {
    const text = this.add.text(x, y, `[ ${label} ]`, {
      fontFamily: FONT.FAMILY,
      fontSize: `${size}px`,
      color: TWP.MENU_BTN,
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setPadding(16, 12);

    text.on('pointerover', () => text.setColor(TWP.MENU_BTN_HOVER));
    text.on('pointerout', () => text.setColor(TWP.MENU_BTN));
    text.on('pointerdown', onClick);
  }
}

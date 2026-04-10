import Phaser from 'phaser';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { TWP, FONT } from '@/config/theme';

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

    this.cameras.main.setBackgroundColor(TWP.MENU_BG);

    // Logo image — contains title "ZERO ADVENTURES"
    if (this.textures.exists('intro')) {
      const imgY = isPortrait ? height * 0.32 : height * 0.38;
      const img = this.add.image(width / 2, imgY, 'intro');
      const maxW = width * (isPortrait ? 0.92 : 0.65);
      const maxH = height * (isPortrait ? 0.38 : 0.55);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      img.setScale(scale);
    }

    // Subtitle — below logo
    const subSize = Math.max(10, Math.min(14, Math.floor(refSize * 0.014)));
    const subY = isPortrait ? height * 0.56 : height * 0.68;
    this.add.text(width / 2, subY, 'A Point & Click Web3 Adventure on Base', {
      fontFamily: FONT.FAMILY,
      fontSize: `${subSize}px`,
      color: TWP.MENU_SUBTITLE,
      wordWrap: { width: width * 0.85 },
      align: 'center',
    }).setOrigin(0.5);

    // Buttons
    const saveSystem = new SaveLoadSystem();
    const hasSave = saveSystem.hasSave();
    const btnSize = Math.max(14, Math.min(20, Math.floor(refSize * 0.022)));
    const btnSpacing = Math.max(btnSize * 2.5, 44);
    const btnY = isPortrait ? height * 0.68 : height * 0.80;

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

      top.forEach((p: any, i: number) => {
        const row = document.createElement('div');
        const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `#${i + 1}`;
        const addr = p.address.slice(0, 6) + '...' + p.address.slice(-4);
        const sceneName = (p.sceneName || 'Unknown').replace(/^(The |AdrianLAB )/, '');
        const complete = p.gameComplete ? ' \u{2B50}' : '';
        const items = p.items ?? 0;
        const scenes = p.scenesVisited ?? 0;
        const date = new Date(p.lastSaved).toLocaleDateString();

        row.style.cssText = `
          padding: 10px 8px; margin-bottom: 6px;
          background: ${i === 0 ? '#2a2a1e' : '#1e1e2e'};
          border: 1px solid ${i === 0 ? '#f8e848' : i < 3 ? '#5b3a8c' : '#333'};
          border-radius: 6px;
        `;
        row.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
            <span style="font-size:14px;">${medal}</span>
            <span style="font-size:11px; color:#e8d5f5; flex:1; margin-left:8px;">${addr}${complete}</span>
            <span style="font-size:13px; color:#f8e848; font-weight:bold;">${p.score} pts</span>
          </div>
          <div style="display:flex; gap:12px; font-size:9px; color:#888;">
            <span>\u{1F4D6} Ch ${p.chapters}/5</span>
            <span>\u{1F5FA} ${scenes} scenes</span>
            <span>\u{1F392} ${items} items</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:8px; color:#555; margin-top:4px;">
            <span>\u{1F3AE} ${sceneName}</span>
            <span>${date}</span>
          </div>
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

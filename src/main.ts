import Phaser from 'phaser';
import { GAME_CONFIG, DEFAULT_SCENE_ID } from '@/config/game.config';

const game = new Phaser.Game(GAME_CONFIG);

// Hide loading screen once Phaser is ready
game.events.once('ready', () => {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 500);
  }
  game.scale.refresh();

  const params = new URLSearchParams(window.location.search);

  // ?scene=sceneId — jump directly to any scene (dev/testing)
  const sceneParam = params.get('scene');
  if (sceneParam) {
    game.registry.set('currentSceneId', sceneParam);
    game.scene.stop('MenuScene');
    game.scene.start('PreloadScene');
  }
  // ?skip — bypass menu, load default scene
  else if (params.has('skip')) {
    game.registry.set('currentSceneId', DEFAULT_SCENE_ID);
    game.scene.stop('MenuScene');
    game.scene.start('PreloadScene');
  }

  // ?dev — show floating scene selector button
  if (params.has('dev')) {
    createSceneSelector(game);
  }
});

// Expose for debugging
(window as any).__game = game;

/** Floating scene selector for dev/testing */
function createSceneSelector(g: Phaser.Game): void {
  const scenes = [
    'outside', 'mountain', 'clinic_exterior', 'clinic_interior',
    'lobby', 'upstairs', 'rooftop', 'basement', 'server_room',
    'treatment_room', 'epilogue_outside', 'recovery_pool',
  ];

  const btn = document.createElement('button');
  btn.textContent = '\u{1F3AC}';
  btn.title = 'Scene Selector';
  btn.style.cssText = `
    position: fixed; bottom: 8px; left: 8px; z-index: 9999;
    width: 36px; height: 36px; border-radius: 50%;
    background: #1a1a2e; border: 2px solid #5b3a8c;
    font-size: 18px; cursor: pointer; opacity: 0.7;
  `;
  btn.onmouseenter = () => { btn.style.opacity = '1'; };
  btn.onmouseleave = () => { btn.style.opacity = '0.7'; };
  document.body.appendChild(btn);

  btn.onclick = () => {
    const existing = document.getElementById('scene-selector');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'scene-selector';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(6,6,12,0.92);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1a1a2e; border: 2px solid #5b3a8c;
      border-radius: 8px; padding: 20px; text-align: center;
      max-width: 400px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('div');
    title.textContent = '\u{1F3AC} Scene Select';
    title.style.cssText = 'color: #f8e848; font-size: 12px; margin-bottom: 16px;';
    modal.appendChild(title);

    for (const id of scenes) {
      const sceneBtn = document.createElement('button');
      sceneBtn.textContent = id.replace(/_/g, ' ');
      sceneBtn.style.cssText = `
        display: block; width: 100%; padding: 10px 12px; margin-bottom: 6px;
        background: #2a2a4e; border: 1px solid #5b3a8c; border-radius: 6px;
        color: #e8d5f5; font-family: 'Press Start 2P', monospace; font-size: 9px;
        cursor: pointer; text-transform: capitalize;
      `;
      sceneBtn.onmouseenter = () => { sceneBtn.style.background = '#3a3a6e'; };
      sceneBtn.onmouseleave = () => { sceneBtn.style.background = '#2a2a4e'; };
      sceneBtn.onclick = () => {
        overlay.remove();
        g.registry.set('currentSceneId', id);
        g.scene.stop('UIScene');
        g.scene.stop('GameScene');
        g.scene.stop('MenuScene');
        g.scene.start('PreloadScene');
      };
      modal.appendChild(sceneBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      display: block; width: 100%; padding: 8px; margin-top: 12px;
      background: transparent; border: 1px solid #444; border-radius: 6px;
      color: #888; font-family: 'Press Start 2P', monospace; font-size: 8px;
      cursor: pointer;
    `;
    closeBtn.onclick = () => overlay.remove();
    modal.appendChild(closeBtn);

    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  };
}

export default game;

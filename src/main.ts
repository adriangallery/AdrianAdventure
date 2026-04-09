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

  // ?skip query param: bypass menu and go straight to game (dev only)
  if (new URLSearchParams(window.location.search).has('skip')) {
    game.registry.set('currentSceneId', DEFAULT_SCENE_ID);
    game.scene.stop('MenuScene');
    game.scene.start('PreloadScene');
  }
});

// Expose for debugging
(window as any).__game = game;

export default game;

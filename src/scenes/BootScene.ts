import Phaser from 'phaser';
import { DEFAULT_SCENE_ID } from '@/config/game.config';
import { MusicManager } from '@/systems/MusicManager';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  init(): void {
    this.registry.set('currentSceneId', DEFAULT_SCENE_ID);
  }

  create(): void {
    // Hide HTML loading screen
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }

    // Create persistent MusicManager (survives scene transitions)
    const musicManager = new MusicManager(this.game);
    this.game.registry.set('musicManager', musicManager);

    this.scene.start('MenuScene');
  }
}

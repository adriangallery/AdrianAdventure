import Phaser from 'phaser';
import { DEFAULT_SCENE_ID } from '@/config/game.config';
import { MusicManager } from '@/systems/MusicManager';
import { AnaglyphPipeline } from '@/shaders/AnaglyphPipeline';

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

    // Register custom post-processing pipelines (WebGL only)
    const renderer = this.game.renderer;
    if (renderer.type === Phaser.WEBGL) {
      (renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.addPostPipeline('AnaglyphPipeline', AnaglyphPipeline);
    }

    // Create persistent MusicManager (survives scene transitions)
    const musicManager = new MusicManager(this.game);
    this.game.registry.set('musicManager', musicManager);

    const params = new URLSearchParams(window.location.search);

    // ?trailer — launch cinematic trailer (add &record to auto-capture WebM)
    if (params.has('trailer')) {
      this.scene.start('TrailerScene');
      return;
    }

    // ?scene=sceneId — skip menu, jump directly to scene (dev/testing)
    const sceneParam = params.get('scene');
    if (sceneParam) {
      this.registry.set('currentSceneId', sceneParam);
      this.scene.start('PreloadScene');
    } else {
      this.scene.start('MenuScene');
    }
  }
}

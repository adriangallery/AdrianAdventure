/**
 * F3.2a (plan FUNTICO_ADVENTURE): en la página del capítulo ocupa el sitio de MenuScene (misma clave), así que BootScene
 * entra directo en el expediente sin el menú del juego normal (New Game / Continue / web3). Pone el estado inicial
 * canónico del capítulo (states.ts) con los cosméticos activos y arranca PreloadScene. Si el juego vuelve a «la
 * portada» (p. ej. tras el final), se vuelve al mapa de campaña.
 */
import Phaser from 'phaser';
import { chapterStart } from './states';
import { mapUrl, go } from './context';

export const CAMPAIGN_CTX = 'funtico.campaign';

export interface CampaignCtx {
  chapter: number;
  userId: number | string | null;
  costume: boolean;
  phoneTheme: boolean;
}

export class CampaignEntryScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create(): void {
    if (this.registry.get('funtico.campaignStarted')) {
      go(mapUrl());
      return;
    }
    this.registry.set('funtico.campaignStarted', true);
    const ctx = this.registry.get(CAMPAIGN_CTX) as CampaignCtx;
    const { state, spawn } = chapterStart(ctx.chapter);
    if (ctx.costume) state.flags.ape_costume_worn = true;
    this.registry.set('gameState', state);
    this.registry.set('currentSceneId', state.currentScene);
    if (spawn) this.registry.set('spawnOverride', spawn);
    this.scene.start('PreloadScene');
  }
}

import Phaser from 'phaser';

declare const __BUILD_HASH__: string;
const v = typeof __BUILD_HASH__ !== 'undefined' ? `?v=${__BUILD_HASH__}` : '';

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'PreloadScene' }); }

  preload(): void {
    const sceneId = this.registry.get('currentSceneId') as string;
    const basePath = `assets/scenes/${sceneId}`;

    // Global config (player scale, etc.)
    if (!this.cache.json.has('globalConfig')) {
      this.load.json('globalConfig', `assets/config/global.json${v}`);
    }

    // Always reload scene JSON (may change between deploys)
    this.cache.json.remove(`scene_${sceneId}`);
    this.load.json(`scene_${sceneId}`, `${basePath}/scene.json${v}`);

    if (!this.textures.exists(`bg_${sceneId}`)) {
      this.load.image(`bg_${sceneId}`, `${basePath}/background.png${v}`);
    }

    // Foreground layer (optional — fails silently if file doesn't exist)
    const fgKey = `fg_${sceneId}`;
    if (!this.textures.exists(fgKey)) {
      this.load.image(fgKey, `${basePath}/foreground.png${v}`);
    }

    // Player sprites (load once)
    if (!this.textures.exists('player_idle1')) {
      for (let i = 1; i <= 4; i++) {
        this.load.image(`player_idle${i}`, `assets/sprites/player/Idle-${i}.png${v}`);
      }
      for (let i = 0; i <= 2; i++) {
        this.load.image(`player_walk_left_${i}`, `assets/sprites/player/Walk-Left-${i}.png${v}`);
        this.load.image(`player_walk_right_${i}`, `assets/sprites/player/Walk-Right-${i}.png${v}`);
      }
      this.load.image('player_left', `assets/sprites/player/Left.png${v}`);
      this.load.image('player_right', `assets/sprites/player/Right.png${v}`);
      this.load.image('player_front_left', `assets/sprites/player/Front-Left.png${v}`);
      this.load.image('player_front_right', `assets/sprites/player/Front-Right.png${v}`);
    }

    // Item sprites (load once)
    const itemIds = [
      'code_note', 'ledger', 'keycard', 'floppy_disk', 'printout',
      'water_bottle', 'golden_token', 'terminal_key', 'antenna',
      'sign_in_sheet', 'monkey_sticker',
      'mystery_envelope', 'mystery_envelope_opened', 'server_log', 'burned_chip', 'dr_satoshi_badge',
      'clinic_photo', 'adrian_note',
      'rubber_duck', 'receipt', 'broken_mouse',
      'floppy_box',
    ];
    for (const id of itemIds) {
      const key = `item_${id}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/sprites/items/${id}.png${v}`);
      }
    }

    // NPC sprites (load once)
    const npcIds = ['receptionist', 'receptionist_talk', 'dr_satoshi'];
    for (const id of npcIds) {
      const key = `npc_${id}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/sprites/npcs/${id}.png${v}`);
      }
    }


    // Audio
    if (!this.cache.audio.has('retro-adventure')) {
      this.load.audio('retro-adventure', `assets/audio/music/retro-adventure.mp3${v}`);
    }
    if (!this.cache.audio.has('retroadrian')) {
      this.load.audio('retroadrian', `assets/audio/music/retroadrian.mp3${v}`);
    }

    // Log load errors so they don't fail silently
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[PreloadScene] Failed to load: ${file.key} (${file.url})`);
    });

    // Progress bar
    const { width, height } = this.scale;
    const barW = Math.min(width * 0.5, 200);
    const barY = height / 2;
    const bg = this.add.rectangle(width / 2, barY, barW, 6, 0x222222);
    const fill = this.add.rectangle(width / 2 - barW / 2, barY, 0, 6, 0x5b3a8c).setOrigin(0, 0.5);
    this.load.on('progress', (v: number) => { fill.width = barW * v; });
    this.load.on('complete', () => { bg.destroy(); fill.destroy(); });
  }

  create(): void {
    // Load web3Visual sprites from scene JSON (requires scene data to be parsed first)
    const sceneId = this.registry.get('currentSceneId') as string;
    const sceneData = this.cache.json.get(`scene_${sceneId}`) as any;
    if (sceneData?.web3Visuals?.length) {
      const basePath = `assets/scenes/${sceneId}`;
      let needsLoad = false;
      for (const visual of sceneData.web3Visuals) {
        // Load default sprite
        if (!this.textures.exists(visual.defaultSprite)) {
          this.load.image(visual.defaultSprite, `${basePath}/${visual.defaultSprite}.png${v}`);
          needsLoad = true;
        }
        // Load variant sprites
        for (const variant of visual.variants ?? []) {
          if (!this.textures.exists(variant.sprite)) {
            this.load.image(variant.sprite, `${basePath}/${variant.sprite}.png${v}`);
            needsLoad = true;
          }
        }
      }
      if (needsLoad) {
        this.load.once('complete', () => this.scene.start('GameScene'));
        this.load.start();
        return;
      }
    }
    this.scene.start('GameScene');
  }
}

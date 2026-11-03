import type { SceneData } from '@/types/scene.types';
import Phaser from 'phaser';
// Voice audio is lazy-loaded by VoiceSystem on demand
import { FONT } from '@/config/theme';
import type { MusicManager } from '@/systems/MusicManager';
import { loadingTipsFor, musicToPreload } from '@/systems/AudioPolicy';
import { ScenePrefetcher, ASSET_V as v } from '@/systems/ScenePrefetcher';
import { FADE_FIRST_MS, FADE_SHORT_MS, sceneImageAssets, transitionMode, type TransitionMode } from '@/systems/ScenePrefetch';

/** A2.7: medida del último cambio de escena (`__qa.state().lastTransition`) */
export interface LastTransition {
  from: string | null;
  to: string;
  /** Desde que se pidió el cambio (gotoScene, antes del fundido de salida) hasta GameScene creada */
  ms: number;
  /** Momento en que quedó creada, en ms desde que se abrió la página (performance.now): tiempo hasta jugable */
  at: number;
  /** Lo que tardó PreloadScene (carga incluida) */
  loadMs: number;
  mode: TransitionMode;
  /** true solo con la pantalla de carga completa (barra, porcentaje y frases) */
  loadingScreen: boolean;
  fadeMs: number;
}

const LOADING_TIPS: string[] = [
  'Calibrating pixel dimensions...',
  'Teaching NPCs sarcasm...',
  'Hiding keys in obvious places...',
  'Rehearsing voice lines...',
  'Warming up the FloorEngine...',
  'Convincing the receptionist to stay...',
  'Decrypting Patient Zero\'s diary...',
  'Polishing the rubber duck...',
  'Brewing on-chain coffee...',
  'Tuning the chimney\'s consensus...',
  'Defragmenting floppy discs...',
  'Bribing the doormat...',
  'Loading 1,388 voice clips...',
  'Auditing Adrian\'s ledger...',
  'Feeding the three-headed monkey...',
  'Synthesizing rare Pepes...',
  'Calibrating anaglyph distortion...',
  'Compiling gas fees...',
  'Minting loading screen NFT...',
  'Verifying doormat authenticity...',
  'Reticulating blockchains...',
  'Asking B.O.T. for drink recipes...',
  'Dr. Satoshi is warming up...',
  'Sweeping the floor (engine)...',
  'Staking patience tokens...',
  'Downloading more RAM (on-chain)...',
];

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'PreloadScene' }); }

  /** A2.7: cómo se enseña esta carga y desde cuándo cuenta */
  private mode: TransitionMode = 'full';
  private startedAt = 0;
  private requestedAt = 0;

  preload(): void {
    const sceneId = this.registry.get('currentSceneId') as string;
    const basePath = `assets/scenes/${sceneId}`;
    // A2.7: la precarga de la escena anterior se para (salvo lo que esté bajando de esta escena)
    const prefetcher = ScenePrefetcher.of(this.game);
    prefetcher.cancel((url) => url.startsWith(`${basePath}/`));
    this.startedAt = performance.now();
    this.requestedAt = (this.registry.get('transitionRequestedAt') as number | undefined) ?? this.startedAt;
    this.registry.remove('transitionRequestedAt');
    const firstLoad = !this.registry.get('gameBooted');
    // A1.5: con el sonido apagado no se precarga música (ni se prometen voces en los consejos de carga).
    const musicManager = this.registry.get('musicManager') as MusicManager | undefined;
    const muted = musicManager ? musicManager.isMuted() : this.sound.mute;

    // Global config (player scale, etc.)
    if (!this.cache.json.has('globalConfig')) {
      this.load.json('globalConfig', `assets/config/global.json${v}`);
    }

    // Scene JSON. A2.7: si ya se tiene (visitada o precargada en esta sesión, mismo `?v=`) se usa una copia sin
    // pedirlo; en desarrollo se pide siempre (el editor de hotspots lo reescribe).
    const jsonKey = `scene_${sceneId}`;
    this.cache.json.remove(jsonKey);
    const known = import.meta.env.DEV ? undefined : prefetcher.sceneData<SceneData>(sceneId);
    // Imágenes de la escena: fondo, primer plano (solo si `assets.foreground`; antes se pedía siempre y en las
    // escenas sin primer plano dejaba un error de consola), overlays condicionales y sprites web3. A2.7: todo en
    // esta pasada (antes los overlays y web3 iban en una segunda carga desde create()).
    const queueImages = (data: SceneData | undefined) => {
      for (const a of sceneImageAssets(sceneId, data, v)) {
        if (!this.textures.exists(a.key)) this.load.image(a.key, a.url);
      }
    };
    if (known) {
      this.cache.json.add(jsonKey, known);
      queueImages(known);
    } else {
      this.load.json(jsonKey, `${basePath}/scene.json${v}`);
      queueImages(undefined); // el fondo ya; el resto cuando llegue el JSON (Phaser lo carga en esta pasada)
      this.load.once(`filecomplete-json-${jsonKey}`, (_key: string, _type: string, data: SceneData) => {
        prefetcher.rememberScene(sceneId, data);
        queueImages(data);
      });
    }
    // A2.7: sin pantalla de carga si todo está ya en Phaser o en la caché HTTP (precargado); si falta algo, una
    // barrita; la pantalla completa solo al arrancar el juego.
    this.mode = transitionMode({ firstLoad, missing: known ? prefetcher.missingImages(sceneId, known).length : 1 });
    this.registry.set('fadeInMs', this.mode === 'full' ? FADE_FIRST_MS : FADE_SHORT_MS);

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
    // A2.2: de espaldas (Player.face('back')); como las de perfil, la clave sigue el nombre del PNG. Aparte del bloque
    // de arriba porque TrailerScene carga las demás del personaje y no estas.
    if (!this.textures.exists('player_back_left')) {
      this.load.image('player_back_left', `assets/sprites/player/Back-Left.png${v}`);
      this.load.image('player_back_right', `assets/sprites/player/Back-Right.png${v}`);
    }

    // Ape costume sprites (load once, separate from player check)
    // Note: ape sprites use normal orientation (Left=faces left), but Player.ts
    // mirrors direction (dx>0 uses 'left' key), so we swap Left↔Right on load.
    if (!this.textures.exists('ape_idle1')) {
      for (let i = 1; i <= 4; i++) {
        this.load.image(`ape_idle${i}`, `assets/sprites/player/Ape-Idle-${i}.png${v}`);
      }
      for (let i = 0; i <= 2; i++) {
        this.load.image(`ape_walk_left_${i}`, `assets/sprites/player/Ape-Walk-Right-${i}.png${v}`);
        this.load.image(`ape_walk_right_${i}`, `assets/sprites/player/Ape-Walk-Left-${i}.png${v}`);
      }
    }

    // Item sprites (load once)
    const itemIds = [
      'code_note', 'ledger', 'keycard', 'floppy_disk', 'printout',
      'water_bottle', 'golden_token', 'terminal_key', 'antenna',
      'sign_in_sheet', 'monkey_sticker',
      'mystery_envelope', 'mystery_envelope_opened', 'server_log', 'burned_chip', 'dr_satoshi_badge',
      'clinic_photo', 'adrian_note',
      'rubber_duck', 'receipt', 'broken_mouse',
      'floppy_box', 'energy_drink', 'clinic_sign_in_sheet', 'clinic_note', 'luxury_watch',
      'glasses_3d', 'pepememe', 'ape_costume',
      'note_half_a', 'note_half_b', 'fence_plank', // A3.3c: PIN partido
    ];
    for (const id of itemIds) {
      const key = `item_${id}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/sprites/items/${id}.png${v}`);
      }
    }

    // Achievement badge sprites (load once)
    const badgeIds = [
      'ch1_complete', 'ch2_complete', 'ch3_complete', 'ch4_complete',
      'patient_zero', 'game_complete',
      'holder_vip_floppy', 'vip_access', 'archivist', 'alpha_leak',
      'genesis_miner', 'diamond_hands', 'meme_achievement',
    ];
    for (const id of badgeIds) {
      const key = `badge_${id}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/sprites/badges/${id}.png${v}`);
      }
    }

    // NPC sprites (load once)
    // A4.2: con su boca abierta (`_talk`) para hablar al ritmo de la voz
    const npcIds = ['receptionist', 'receptionist_talk', 'dr_satoshi', 'dr_satoshi_talk'];
    for (const id of npcIds) {
      const key = `npc_${id}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/sprites/npcs/${id}.png${v}`);
      }
    }


    // Audio
    // V5 (14-sep-2026): solo la pista de la escena inicial. Las otras 5 (~21 MB) las carga
    // MusicManager al entrar en la escena que las usa.
    // A1.5: en silencio, ninguna; MusicManager la pide al activar el sonido.
    const musicTracks = ['retro-adventure'];
    for (const track of musicToPreload(musicTracks, muted, (k) => this.cache.audio.has(k))) {
      this.load.audio(track, `assets/audio/music/${track}.mp3${v}`);
    }

    // SFX
    // A4.4: los nuevos (pasos por superficie, puertas, interfaz, objetos) los genera scripts/audio/make-sfx.mjs
    const sfxKeys = [
      'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error',
      'item_pickup', 'item_use', 'item_combo', 'item_unlock',
      'door_open', 'door_locked', 'keypad_beep', 'keypad_success', 'keypad_fail', 'footstep',
      'achievement', 'chapter_transition', 'discovery',
      'wallet_connect', 'npc_talk', 'save_game', 'typewriter',
      'step_wood_1', 'step_wood_2', 'step_gravel_1', 'step_gravel_2', 'step_concrete_1', 'step_concrete_2',
      'step_tile_1', 'step_tile_2', 'step_metal_1', 'step_metal_2', 'step_carpet_1', 'step_carpet_2', 'step_grass_1', 'step_grass_2',
      'door_creak', 'door_close', 'door_knock', 'hatch_metal', 'door_slide',
      'inv_open', 'inv_close', 'verb_select', 'journal_open', 'journal_close', 'journal_note', 'phone_ring', 'phone_pickup', 'phone_hangup',
      'duck_squeak', 'intercom_buzz', 'glass_break', 'paper_rustle', 'plank_pull', 'switch_flip', 'crt_on', 'floppy_insert',
      'splash', 'coin_ping', 'thud', 'nest_fall',
    ];
    for (const key of sfxKeys) {
      if (!this.cache.audio.has(key)) {
        this.load.audio(key, `assets/audio/sfx/${key}.mp3${v}`);
      }
    }

    // Voice audio — loaded on-demand by VoiceSystem (too many to preload all at once)

    // Log load errors so they don't fail silently
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[PreloadScene] Failed to load: ${file.key} (${file.url})`);
    });

    if (this.mode === 'instant') return;
    if (this.mode === 'indicator') {
      this.showIndicator();
      return;
    }

    // Progress bar + funny loading tips
    const { width, height } = this.scale;
    const barW = Math.min(width * 0.5, 200);
    const barY = height / 2;
    const bg = this.add.rectangle(width / 2, barY, barW, 6, 0x222222);
    const fill = this.add.rectangle(width / 2 - barW / 2, barY, 0, 6, 0x5b3a8c).setOrigin(0, 0.5);

    const fontSize = Math.max(7, Math.min(10, Math.floor(width * 0.009)));
    const tipText = this.add.text(width / 2, barY + 20, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${fontSize}px`,
      color: '#504878',
      align: 'center',
    }).setOrigin(0.5, 0);

    const pctText = this.add.text(width / 2, barY - 14, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${fontSize}px`,
      color: '#a090c0',
      align: 'center',
    }).setOrigin(0.5, 1);

    // Shuffle tips
    const tips = loadingTipsFor(LOADING_TIPS, muted).sort(() => Math.random() - 0.5);
    let tipIndex = 0;
    tipText.setText(tips[0]);

    // Rotate tip every 2.5s
    const tipTimer = this.time.addEvent({
      delay: 2500,
      loop: true,
      callback: () => {
        tipIndex = (tipIndex + 1) % tips.length;
        tipText.setText(tips[tipIndex]);
      },
    });

    let destroyed = false;
    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      tipTimer.remove();
      this.load.off('progress', onProgress);
      bg.destroy(); fill.destroy();
      tipText.destroy(); pctText.destroy();
    };
    const onProgress = (p: number) => {
      if (destroyed) return;
      fill.width = barW * p;
      pctText.setText(`${Math.floor(p * 100)}%`);
    };
    this.load.on('progress', onProgress);
    this.load.on('complete', cleanup);
  }

  /** A2.7: barrita discreta abajo (sin texto) para una escena que aún no está en caché; sale a los 150 ms */
  private showIndicator(): void {
    const { width, height } = this.scale;
    const w = Math.min(96, width * 0.2);
    const y = height - 18;
    const track = this.add.rectangle(width / 2, y, w, 3, 0x222222).setAlpha(0);
    const fill = this.add.rectangle(width / 2 - w / 2, y, 0, 3, 0x5b3a8c).setOrigin(0, 0.5).setAlpha(0);
    const reveal = this.time.delayedCall(150, () => { track.setAlpha(1); fill.setAlpha(1); });
    const onProgress = (p: number) => { fill.width = w * p; };
    this.load.on('progress', onProgress);
    this.load.once('complete', () => {
      reveal.remove();
      this.load.off('progress', onProgress);
      track.destroy();
      fill.destroy();
    });
  }

  /** A2.7: arranca GameScene; cuando está creada apunta la medida y, tras el primer frame, empieza la precarga. */
  private startGame(): void {
    const game = this.game;
    const sceneId = this.registry.get('currentSceneId') as string;
    const { mode, startedAt, requestedAt } = this;
    const fadeMs = (this.registry.get('fadeInMs') as number | undefined) ?? FADE_FIRST_MS;
    game.scene.getScene('GameScene').events.once(Phaser.Scenes.Events.CREATE, () => {
      const now = performance.now();
      const t: LastTransition = {
        from: (game.registry.get('lastSceneId') as string | undefined) ?? null,
        to: sceneId,
        ms: Math.round(now - requestedAt),
        at: Math.round(now),
        loadMs: Math.round(now - startedAt),
        mode,
        loadingScreen: mode === 'full',
        fadeMs,
      };
      game.registry.set('lastTransition', t);
      game.registry.set('lastSceneId', sceneId);
      game.registry.set('gameBooted', true);
      if (game.registry.get('trailerMode')) return;
      game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        if (game.registry.get('currentSceneId') === sceneId) ScenePrefetcher.of(game).start(sceneId);
      });
    });
    this.scene.start('GameScene');
  }

  create(): void {
    // Red de seguridad (A2.7: preload() ya encola todo esto en la misma pasada; aquí normalmente no falta nada).
    // Load web3Visual sprites from scene JSON (requires scene data to be parsed first)
    const sceneId = this.registry.get('currentSceneId') as string;
    const sceneData = this.cache.json.get(`scene_${sceneId}`) as SceneData | undefined;
    const basePath = `assets/scenes/${sceneId}`;
    // A1.3: web3Visuals y conditionalOverlays van en UNA sola cola. Antes, si faltaba algún sprite
    // web3 se arrancaba GameScene al terminar esa carga y los overlays nunca se pedían: en la
    // primera visita al lobby `overlay_lobby_plant_revived` no existía y GameScene lo saltaba.
    let needsLoad = false;
    const queue = (key: string, url: string) => {
      if (this.textures.exists(key)) return;
      this.load.image(key, url);
      needsLoad = true;
    };

    // Sprites web3 (por defecto y variantes para holders)
    for (const visual of sceneData?.web3Visuals ?? []) {
      queue(visual.defaultSprite, `${basePath}/${visual.defaultSprite}.png${v}`);
      for (const variant of visual.variants ?? []) {
        queue(variant.sprite, `${basePath}/${variant.sprite}.png${v}`);
      }
    }

    // Overlays condicionados por flags
    for (const co of sceneData?.conditionalOverlays ?? []) {
      const ext = co.format === 'webp' ? 'webp' : 'png';
      queue(`overlay_${sceneId}_${co.id}`, `${basePath}/${co.sprite}.${ext}${v}`);
    }

    if (needsLoad) {
      this.load.once('complete', () => this.startGame());
      this.load.start();
      return;
    }

    this.startGame();
  }
}

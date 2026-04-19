import Phaser from 'phaser';
import { FONT } from '@/config/theme';
import { createInitialState } from '@/types/game.types';
import type { Player } from '@/objects/Player';

/**
 * 30-second cinematic trailer — orchestrates real GameScene + UIScene.
 *
 * Launch:  http://localhost:3000?trailer
 * Record:  http://localhost:3000?trailer&record  (downloads .webm)
 *
 * Post-process:
 *   ffmpeg -i adrian-adventure-trailer.webm -i assets/audio/music/tension.mp3 \
 *          -c:v libx264 -c:a aac -shortest -pix_fmt yuv420p trailer.mp4
 */

const MONTAGE_SCENES = ['memelab', 'rooftop', 'mountain'] as const;

export class TrailerScene extends Phaser.Scene {
  /* overlay elements */
  private mainText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private beatText!: Phaser.GameObjects.Text;
  private black!: Phaser.GameObjects.Rectangle;
  private letterboxTop!: Phaser.GameObjects.Rectangle;
  private letterboxBot!: Phaser.GameObjects.Rectangle;

  /* montage */
  private montageBgs = new Map<string, Phaser.GameObjects.Image>();

  /* recording */
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];

  constructor() { super({ key: 'TrailerScene' }); }

  // ─── Preload ────────────────────────────────────────────

  preload(): void {
    // Pre-load ALL scene backgrounds so transitions via PreloadScene are near-instant
    const allScenes = ['outside', 'lobby', 'server_room', 'memelab', 'rooftop', 'mountain'];
    for (const id of allScenes) {
      const key = `bg_${id}`;
      if (!this.textures.exists(key))
        this.load.image(key, `assets/scenes/${id}/background.webp`);
    }

    // Player sprites (same as PreloadScene)
    if (!this.textures.exists('player_idle1')) {
      for (let i = 1; i <= 4; i++)
        this.load.image(`player_idle${i}`, `assets/sprites/player/Idle-${i}.png`);
      for (let i = 0; i <= 2; i++) {
        this.load.image(`player_walk_left_${i}`, `assets/sprites/player/Walk-Left-${i}.png`);
        this.load.image(`player_walk_right_${i}`, `assets/sprites/player/Walk-Right-${i}.png`);
      }
      this.load.image('player_left', 'assets/sprites/player/Left.png');
      this.load.image('player_right', 'assets/sprites/player/Right.png');
      this.load.image('player_front_left', 'assets/sprites/player/Front-Left.png');
      this.load.image('player_front_right', 'assets/sprites/player/Front-Right.png');
    }

    // Ape costume
    if (!this.textures.exists('ape_idle1')) {
      for (let i = 1; i <= 4; i++)
        this.load.image(`ape_idle${i}`, `assets/sprites/player/Ape-Idle-${i}.png`);
      for (let i = 0; i <= 2; i++) {
        this.load.image(`ape_walk_left_${i}`, `assets/sprites/player/Ape-Walk-Right-${i}.png`);
        this.load.image(`ape_walk_right_${i}`, `assets/sprites/player/Ape-Walk-Left-${i}.png`);
      }
    }

    // Item sprites
    const items = [
      'code_note', 'ledger', 'keycard', 'floppy_disk', 'printout',
      'water_bottle', 'golden_token', 'terminal_key', 'antenna',
      'sign_in_sheet', 'monkey_sticker', 'mystery_envelope', 'mystery_envelope_opened',
      'server_log', 'burned_chip', 'dr_satoshi_badge', 'clinic_photo', 'adrian_note',
      'rubber_duck', 'receipt', 'broken_mouse', 'floppy_box', 'energy_drink',
      'clinic_sign_in_sheet', 'clinic_note', 'luxury_watch', 'glasses_3d',
      'pepememe', 'ape_costume',
    ];
    for (const id of items) {
      const key = `item_${id}`;
      if (!this.textures.exists(key))
        this.load.image(key, `assets/sprites/items/${id}.png`);
    }

    // NPC sprites
    for (const id of ['receptionist', 'receptionist_talk', 'dr_satoshi']) {
      const key = `npc_${id}`;
      if (!this.textures.exists(key))
        this.load.image(key, `assets/sprites/npcs/${id}.png`);
    }

    // Audio — music + SFX
    for (const t of ['retro-adventure', 'tension', 'vista', 'clinical', 'epilogue', 'retroadrian']) {
      if (!this.cache.audio.has(t))
        this.load.audio(t, `assets/audio/music/${t}.mp3`);
    }
    const sfx = [
      'ui_click', 'ui_hover', 'ui_open', 'ui_close', 'ui_error',
      'item_pickup', 'item_use', 'item_combo', 'item_unlock',
      'door_open', 'door_locked', 'keypad_beep', 'keypad_success', 'keypad_fail', 'footstep',
      'achievement', 'chapter_transition', 'discovery', 'wallet_connect', 'npc_talk',
      'save_game', 'typewriter',
    ];
    for (const s of sfx) {
      if (!this.cache.audio.has(s))
        this.load.audio(s, `assets/audio/sfx/${s}.mp3`);
    }

    // Global config
    if (!this.cache.json.has('globalConfig'))
      this.load.json('globalConfig', 'assets/config/global.json');
  }

  // ─── Create ─────────────────────────────────────────────

  create(): void {
    this.cameras.main.transparent = true;
    this.registry.set('trailerMode', true);

    const state = createInitialState('outside');
    state.inventory = [
      { id: 'floppy_disk', name: 'Floppy Disk', icon: null, fromNFT: false },
      { id: 'keycard', name: 'Keycard', icon: null, fromNFT: false },
      { id: 'mystery_envelope', name: 'Mystery Envelope', icon: null, fromNFT: false },
      { id: 'code_note', name: 'Code Note', icon: null, fromNFT: false },
    ];
    this.registry.set('gameState', state);

    const { width, height } = this.scale;

    // Black overlay (starts opaque)
    this.black = this.add.rectangle(width / 2, height / 2, width * 2, height * 2, 0x000000, 1)
      .setOrigin(0.5).setDepth(50).setScrollFactor(0);

    // Letterbox bars
    const barH = Math.floor(height * 0.04);
    this.letterboxTop = this.add.rectangle(width / 2, barH / 2, width * 2, barH, 0x000000, 1)
      .setOrigin(0.5).setDepth(95).setScrollFactor(0);
    this.letterboxBot = this.add.rectangle(width / 2, height - barH / 2, width * 2, barH, 0x000000, 1)
      .setOrigin(0.5).setDepth(95).setScrollFactor(0);

    // Text layers
    this.mainText = this.createText(100).setDepth(100);
    this.subText = this.createText(100).setDepth(100);
    this.beatText = this.createText(100).setDepth(101);

    // Montage backgrounds
    for (const id of MONTAGE_SCENES) {
      const key = `bg_${id}`;
      if (!this.textures.exists(key)) continue;
      const img = this.add.image(0, 0, key).setOrigin(0, 0).setVisible(false).setDepth(40);
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
      img.setScale(height / src.height);
      this.montageBgs.set(id, img);
    }

    if (new URLSearchParams(window.location.search).has('record'))
      this.startRecording();

    this.runTimeline();
  }

  private createText(depth: number): Phaser.GameObjects.Text {
    const { width, height } = this.scale;
    return this.add.text(width / 2, height / 2, '', {
      fontFamily: FONT.FAMILY, fontSize: '24px', color: '#ffffff',
      align: 'center', stroke: '#000000', strokeThickness: 8, lineSpacing: 16,
      shadow: { offsetX: 0, offsetY: 0, color: '#000000', blur: 12, fill: true, stroke: true },
    }).setOrigin(0.5).setDepth(depth).setAlpha(0).setScrollFactor(0);
  }

  // ─── Timeline ──────────────────────────────────────────

  private async runTimeline(): Promise<void> {
    const { width, height } = this.scale;
    const refDim = Math.max(width, height * 0.6);

    // ── BEAT 1 (0-3s): Opening slam ─────────────────────
    await this.wait(500);
    this.slamText(this.mainText, 'EVERY CHAIN\nHAS A SECRET', '#ffffff',
      height * 0.42, Math.floor(refDim * 0.030));
    await this.wait(2200);
    this.zoomOutText(this.mainText, 300);
    await this.wait(400);

    // ── BEAT 2: Outside ─────────────────────────────────
    this.flashWhite(250); // flash into scene
    await this.jumpToScene('outside', { x: 82, y: 98 });
    this.fadeFromBlack(600);
    await this.wait(300);
    this.getPlayer()?.walkToPct(30, 98);
    await this.wait(1200);
    this.slamText(this.mainText, 'TRUST NO ONE', '#f8e848',
      height * 0.20, Math.floor(refDim * 0.028));
    await this.wait(2000);
    this.zoomOutText(this.mainText, 250);
    await this.wait(300);
    this.flashWhite(150); // flash out
    this.fadeToBlack(350);
    await this.wait(450);

    // ── BEAT 3: Lobby — investigation ───────────────────
    this.flashWhite(250); // flash into scene
    await this.jumpToScene('lobby', { x: 85, y: 98 });
    this.fadeFromBlack(500);
    await this.wait(200);
    this.getPlayer()?.walkToPct(25, 98);
    await this.wait(1800);
    this.playSound('item_pickup');
    this.flashWhite(200);
    this.shakeScreen(250, 0.008);
    await this.wait(300);
    this.slamText(this.mainText, 'EVERY PIXEL\nHIDES SOMETHING', '#f0e8d8',
      height * 0.20, Math.floor(refDim * 0.024));
    await this.wait(2000);
    this.zoomOutText(this.mainText, 250);
    this.flashWhite(150);
    this.fadeToBlack(350);
    await this.wait(450);

    // ── BEAT 4: Server Room — costume ───────────────────
    this.flashWhite(250); // flash into scene
    await this.jumpToScene('server_room', { x: 25, y: 96 });
    this.fadeFromBlack(500);
    await this.wait(300);
    this.getPlayer()?.walkToPct(55, 96);
    await this.wait(1200);
    // Text appears WHILE player is still walking toward center
    this.slamText(this.mainText, 'BECOME\nSOMEONE ELSE', '#f8e848',
      height * 0.20, Math.floor(refDim * 0.032));
    await this.wait(800);
    // Dramatic costume change with text still visible
    this.playSound('chapter_transition');
    this.flashWhite(350);
    this.shakeScreen(400, 0.012);
    await this.wait(200);
    const player = this.getPlayer();
    if (player) {
      player.setCostume('ape');
      const gs = this.registry.get('gameState') as any;
      if (gs) { gs.flags['ape_costume_worn'] = true; this.registry.set('gameState', gs); }
    }
    await this.wait(1800);
    this.zoomOutText(this.mainText, 200);
    this.flashWhite(150);
    this.fadeToBlack(250);
    await this.wait(350);

    // ── BEAT 5: Montage — varied transitions ────────────
    this.scene.stop('UIScene');
    this.scene.stop('GameScene');

    // Scene 1: memelab — glitch flash in, hard cut out
    this.flashWhite(120);
    await this.wait(80);
    this.showMontageBg('memelab', -0.2, -0.8);
    this.fadeFromBlack(100);
    await this.wait(1300);
    this.hideMontageBgs();
    this.black.setAlpha(1);

    // Scene 2: rooftop — slow fade in, flash out
    await this.wait(100);
    this.showMontageBg('rooftop', -0.6, -0.2);
    this.fadeFromBlack(400);
    await this.wait(1300);
    this.flashWhite(200);
    this.fadeToBlack(80);
    await this.wait(120);
    this.hideMontageBgs();

    // Scene 3: mountain — slam in (instant), zoom-drift out
    await this.wait(80);
    this.showMontageBg('mountain', -0.4, -0.6);
    this.black.setAlpha(0); // instant reveal
    await this.wait(1300);
    this.fadeToBlack(300);
    await this.wait(350);
    this.hideMontageBgs();

    // ── BEAT 6: ZEROadventure II title ──────────────────
    await this.wait(200);

    // Title — dramatic zoom slam
    const titleSize = Math.max(24, Math.min(48, Math.floor(width * 0.038)));
    this.slamText(this.mainText, 'ZEROadventure II', '#f8e848',
      height * 0.38, titleSize);
    this.tweens.add({
      targets: this.mainText,
      alpha: { from: 0.85, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      delay: 500,
    });
    await this.wait(2000);

    // Subtitle — slides up
    const subSize = Math.max(10, Math.min(16, Math.floor(refDim * 0.013)));
    this.slideUpText(this.subText, 'A Web3 Mystery on Base', '#8878a8',
      height * 0.58, subSize);
    await this.wait(1800);

    // "PLAY FOR FREE NOW" — beat drop
    this.flashWhite(300);
    const beatSize = Math.max(14, Math.min(22, Math.floor(refDim * 0.020)));
    this.beatDrop(this.beatText, 'PLAY FOR FREE NOW', '#48d8e8',
      height * 0.72, beatSize);
    await this.wait(2800);

    // Final fadeout
    this.tweens.killTweensOf(this.mainText);
    this.tweens.killTweensOf(this.beatText);
    this.fadeToBlack(700);
    await this.wait(900);

    this.stopRecording();
  }

  // ─── Text effects ──────────────────────────────────────

  /** Slam: text punches in from 3x scale to 1x with bounce */
  private slamText(txt: Phaser.GameObjects.Text, text: string, color: string,
    y: number, size: number): void {
    txt.setText(text).setColor(color).setFontSize(`${size}px`)
      .setPosition(this.scale.width / 2, y).setScale(3).setAlpha(1);
    this.tweens.killTweensOf(txt);
    this.tweens.add({
      targets: txt,
      scaleX: 1, scaleY: 1,
      duration: 350,
      ease: 'Back.easeOut',
    });
  }

  /** Zoom out: text scales up and fades out */
  private zoomOutText(txt: Phaser.GameObjects.Text, ms: number): void {
    this.tweens.killTweensOf(txt);
    this.tweens.add({
      targets: txt,
      scaleX: 2, scaleY: 2,
      alpha: 0,
      duration: ms,
      ease: 'Power2',
    });
  }

  /** Slide up: text rises from below with fade-in */
  private slideUpText(txt: Phaser.GameObjects.Text, text: string, color: string,
    y: number, size: number): void {
    txt.setText(text).setColor(color).setFontSize(`${size}px`)
      .setPosition(this.scale.width / 2, y + 30).setScale(1).setAlpha(0);
    this.tweens.killTweensOf(txt);
    this.tweens.add({
      targets: txt,
      y, alpha: 1,
      duration: 500,
      ease: 'Power2',
    });
  }

  /** Beat drop: flash + elastic pop + pulsing glow */
  private beatDrop(txt: Phaser.GameObjects.Text, text: string, color: string,
    y: number, size: number): void {
    txt.setText(text).setColor(color).setFontSize(`${size}px`)
      .setPosition(this.scale.width / 2, y).setScale(4).setAlpha(1);
    this.tweens.killTweensOf(txt);
    // Elastic punch in
    this.tweens.add({
      targets: txt,
      scaleX: 1, scaleY: 1,
      duration: 600,
      ease: 'Elastic.easeOut',
      onComplete: () => {
        // Continuous pulse
        this.tweens.add({
          targets: txt,
          scaleX: 1.12, scaleY: 1.12,
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  private hideTexts(): void {
    for (const txt of [this.mainText, this.subText, this.beatText]) {
      this.tweens.killTweensOf(txt);
      this.tweens.add({ targets: txt, alpha: 0, duration: 250 });
    }
  }

  // ─── Scene orchestration ───────────────────────────────

  private jumpToScene(sceneId: string, spawn: { x: number; y: number }): Promise<void> {
    return new Promise(resolve => {
      if (this.scene.isActive('UIScene')) this.scene.stop('UIScene');
      if (this.scene.isActive('GameScene')) this.scene.stop('GameScene');
      if (this.scene.isActive('PreloadScene')) this.scene.stop('PreloadScene');

      this.registry.set('currentSceneId', sceneId);
      this.registry.set('spawnOverride', spawn);
      this.scene.launch('PreloadScene');

      const check = () => {
        if (this.scene.isActive('GameScene') && this.scene.isActive('UIScene')) {
          this.scene.bringToTop();
          this.time.delayedCall(150, resolve);
        } else {
          this.time.delayedCall(60, check);
        }
      };
      this.time.delayedCall(100, check);
    });
  }

  private getPlayer(): Player | null {
    return (this.scene.get('GameScene') as any)?.player ?? null;
  }

  // ─── Montage ───────────────────────────────────────────

  private showMontageBg(id: string, panStart = -0.2, panEnd = -0.8): void {
    const img = this.montageBgs.get(id);
    if (!img) return;
    const scaledW = img.width * img.scaleX;
    const maxPan = Math.max(0, scaledW - this.scale.width);
    img.setPosition(-(maxPan * Math.abs(panStart)), 0).setVisible(true);
    this.tweens.add({
      targets: img,
      x: -(maxPan * Math.abs(panEnd)),
      duration: 1600,
      ease: 'Sine.easeInOut',
    });
  }

  private hideMontageBgs(): void {
    for (const img of this.montageBgs.values()) {
      img.setVisible(false);
      this.tweens.killTweensOf(img);
    }
  }

  // ─── Transitions ──────────────────────────────────────

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => this.time.delayedCall(ms, resolve));
  }

  private fadeToBlack(ms: number): void {
    this.tweens.add({ targets: this.black, alpha: 1, duration: ms });
  }

  private fadeFromBlack(ms: number): void {
    this.black.setAlpha(1);
    this.tweens.add({ targets: this.black, alpha: 0, duration: ms });
  }

  private flashWhite(ms: number): void {
    const { width, height } = this.scale;
    const flash = this.add.rectangle(width / 2, height / 2, width * 2, height * 2, 0xffffff, 1)
      .setOrigin(0.5).setDepth(80).setScrollFactor(0);
    this.tweens.add({ targets: flash, alpha: 0, duration: ms, onComplete: () => flash.destroy() });
  }

  private shakeScreen(duration: number, intensity: number): void {
    try {
      const gs = this.scene.get('GameScene') as Phaser.Scene;
      gs?.cameras?.main?.shake(duration, intensity);
    } catch { /* scene may not be active */ }
  }

  // ─── Audio ─────────────────────────────────────────────

  private playSound(key: string): void {
    try {
      const gs = this.scene.get('GameScene') as Phaser.Scene;
      if (gs?.cache.audio.has(key)) gs.sound.play(key, { volume: 0.6 });
    } catch { /* noop */ }
  }

  // ─── Recording ─────────────────────────────────────────

  private startRecording(): void {
    const stream = this.game.canvas.captureStream(60);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.downloadRecording();
    this.recorder.start();
    console.log('[Trailer] Recording — %s', mimeType);
  }

  private stopRecording(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
      console.log('[Trailer] Recording stopped');
    }
  }

  private downloadRecording(): void {
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zeroadventure-ii-trailer.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log('[Trailer] Downloaded: zeroadventure-ii-trailer.webm (%.1f MB)', blob.size / 1e6);
  }

  shutdown(): void {
    this.registry.set('trailerMode', false);
    this.stopRecording();
  }
}

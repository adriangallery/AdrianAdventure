import Phaser from 'phaser';
import { Player } from '@/objects/Player';
import { CoordSystem } from '@/systems/CoordSystem';
import { SceneDataLoader } from '@/systems/SceneDataLoader';
import { ScriptEngine, type ScriptContext } from '@/systems/ScriptEngine';
import { InventorySystem } from '@/systems/InventorySystem';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import type { MusicManager } from '@/systems/MusicManager';
import { CinematicOverlay } from '@/ui/CinematicOverlay';
import { Web3VisualSystem } from '@/systems/Web3VisualSystem';
import { NPC } from '@/objects/NPC';
import type { SceneData, HotspotData } from '@/types/scene.types';
import { type GameState, Verb, createInitialState } from '@/types/game.types';
import { TWP, FONT, LAYOUT } from '@/config/theme';
import { getWalletState, onWalletChange } from '@/web3/wallet';
import { checkGatingRule, checkGatingRuleCached, type GatingRule } from '@/web3/gating';
import { mintItem, mintAchievement, type MintResult } from '@/web3/contracts';
import { TransactionToast } from '@/ui/TransactionToast';
import type { Address } from 'viem';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private coordSystem!: CoordSystem;
  private sceneDataLoader!: SceneDataLoader;
  private scriptEngine!: ScriptEngine;
  private inventorySystem!: InventorySystem;
  private saveSystem!: SaveLoadSystem;
  private musicManager!: MusicManager;
  private cinematicOverlay!: CinematicOverlay;
  private transactionToast!: TransactionToast;
  private web3VisualSystem?: Web3VisualSystem;
  private npcs: NPC[] = [];
  private gameState!: GameState;
  private bgFill!: Phaser.GameObjects.Image;
  private bg!: Phaser.GameObjects.Image;
  private fg?: Phaser.GameObjects.Image;
  private badge?: Phaser.GameObjects.Image;
  private debugContainer?: Phaser.GameObjects.Container;
  private static DEBUG = import.meta.env.DEV;
  private pendingHotspot: HotspotData | null = null;
  /** Persisted across sessions via gameState.firedTriggers */
  private firedTriggers: Set<string> = new Set();
  /** Frame-based cooldown: ignore clicks for 1 frame after script finishes */
  private inputCooldownFrames = 0;
  private walletUnsub: (() => void) | null = null;

  constructor() { super({ key: 'GameScene' }); }

  init(data?: { sceneId?: string; spawn?: { x: number; y: number } }): void {
    if (data?.sceneId) this.registry.set('currentSceneId', data.sceneId);
    if (data?.spawn) this.registry.set('spawnOverride', data.spawn);
  }

  create(): void {
    const sceneId = this.registry.get('currentSceneId') as string;
    const sceneData = this.cache.json.get(`scene_${sceneId}`) as SceneData;
    this.sceneDataLoader = new SceneDataLoader(sceneData);
    this.saveSystem = new SaveLoadSystem();

    // Sync save system with wallet state
    const { address: currentAddr } = getWalletState();
    if (currentAddr) this.saveSystem.setWalletAddress(currentAddr);
    this.walletUnsub = onWalletChange((ws) => {
      this.saveSystem.setWalletAddress(ws.address);
    });

    // Game state
    this.gameState = (this.registry.get('gameState') as GameState) ?? createInitialState(sceneId);
    this.gameState.currentScene = sceneId;
    if (!this.gameState.visited.includes(sceneId)) this.gameState.visited.push(sceneId);
    // Ensure new fields exist (backward compat with old saves)
    if (!this.gameState.firedTriggers) this.gameState.firedTriggers = [];
    if (!this.gameState.dialogueProgress) this.gameState.dialogueProgress = {};
    // Restore persisted fired triggers
    this.firedTriggers = new Set(this.gameState.firedTriggers);
    this.registry.set('gameState', this.gameState);

    // Inventory
    this.inventorySystem = new InventorySystem(
      () => this.gameState,
      (updater) => { this.gameState = updater(this.gameState); this.registry.set('gameState', this.gameState); },
    );

    // Background — get actual image dimensions
    const bgTexture = this.textures.get(`bg_${sceneId}`);
    const imgSource = bgTexture.getSourceImage() as HTMLImageElement;
    const imgW = imgSource.width;
    const imgH = imgSource.height;

    // Panel height
    const panelH = this.getEffectivePanelHeight();
    this.registry.set('scummPanelHeight', panelH);

    // Coordinate system
    this.coordSystem = new CoordSystem(imgW, imgH);
    this.coordSystem.recalculate(this.scale.width, this.scale.height - panelH);
    this.registry.set('coordSystem', this.coordSystem);

    // Fill background — darkened cover (landscape letterbox filler)
    const gameAreaH = this.scale.height - panelH;
    const coverScale = Math.max(this.scale.width / imgW, gameAreaH / imgH);
    this.bgFill = this.add.image(this.scale.width / 2, gameAreaH / 2, `bg_${sceneId}`)
      .setScale(coverScale)
      .setOrigin(0.5)
      .setTint(0x444444)
      .setDepth(-1)
      .setScrollFactor(0); // fixed to camera so it always fills letterbox

    // Main background
    this.bg = this.add.image(0, 0, `bg_${sceneId}`).setOrigin(0, 0);
    const t = this.coordSystem.getBgTransform();
    this.bg.setPosition(t.x, t.y).setScale(t.scaleX, t.scaleY);

    // Player
    const spawnOverride = this.registry.get('spawnOverride') as { x: number; y: number } | undefined;
    const spawn = spawnOverride ?? sceneData.player.spawn;
    this.registry.remove('spawnOverride');
    this.player = new Player(this, this.coordSystem, spawn.x, spawn.y, sceneData);

    // Hide player for closeup/cinematic scenes
    if (sceneData.player.hidePlayer) {
      this.player.setVisible(false);
    }

    // Foreground layer — renders above player for depth (walk behind bushes/rocks)
    const fgKey = `fg_${sceneId}`;
    if (this.textures.exists(fgKey)) {
      this.fg = this.add.image(0, 0, fgKey).setOrigin(0, 0);
      const ft = this.coordSystem.getBgTransform();
      this.fg.setPosition(ft.x, ft.y).setScale(ft.scaleX, ft.scaleY);
      this.fg.setDepth(15);
    }

    // Game badge — covers watermark in bottom-right of background
    if (this.textures.exists('game_badge')) {
      const bt = this.coordSystem.getBgTransform();
      const badgeX = bt.x + this.coordSystem.bgW - 8;
      const badgeY = bt.y + this.coordSystem.bgH - 8;
      this.badge = this.add.image(badgeX, badgeY, 'game_badge')
        .setOrigin(1, 1)
        .setDepth(1)
        .setAlpha(0.9);
      // Scale badge to ~3% of background width
      const targetW = this.coordSystem.bgW * 0.03;
      this.badge.setScale(targetW / this.badge.width);
    }

    // Camera setup based on orientation
    this.setupCamera();
    this.cameras.main.fadeIn(400, 0, 0, 0);

    // Cinematic overlay (full-screen story moments)
    this.cinematicOverlay = new CinematicOverlay(this);
    this.transactionToast = new TransactionToast(this);

    // If scene has onEnter scripts, show black cover immediately to prevent scene flash
    if (sceneData.onEnter?.length) {
      this.cinematicOverlay.showBlackCover();
    }

    // Script engine
    this.scriptEngine = new ScriptEngine(this.buildScriptContext());

    // Input — use worldX/worldY for game area (accounts for camera scroll)
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);

    // Execute pending verb when player arrives at hotspot
    this.events.on('player:arrived', () => {
      if (this.pendingHotspot) {
        const hotspot = this.pendingHotspot;
        this.pendingHotspot = null;
        this.events.emit('hotspot:tapped', hotspot);
      }
    });

    // Audio — MusicManager persists across scenes (singleton on game.registry)
    this.musicManager = this.game.registry.get('musicManager') as MusicManager;
    this.musicManager.transitionToScene(sceneData.audio);

    // NPCs
    this.npcs = [];
    if (sceneData.npcs) {
      for (const nd of sceneData.npcs) {
        const npcScreen = this.coordSystem.pctToScreen(nd.position.x, nd.position.y);
        const npc = new NPC(this, npcScreen.x, npcScreen.y, nd.id, nd.name, nd.dialogueTreeId, nd.color ? parseInt(nd.color, 16) : undefined);
        npc.setScale(this.coordSystem.getScale());
        npc.startIdle();
        this.npcs.push(npc);
      }
    }

    // Web3 dynamic visuals (conditional sprites based on wallet/NFT state)
    if (sceneData.web3Visuals?.length) {
      this.web3VisualSystem = new Web3VisualSystem(this, this.coordSystem, sceneData.web3Visuals);
    }

    // Debug overlays
    this.drawDebugBounds(sceneData);

    // Store refs
    this.registry.set('sceneData', sceneData);
    this.registry.set('sceneDataLoader', this.sceneDataLoader);
    this.registry.set('inventorySystem', this.inventorySystem);
    this.registry.set('saveSystem', this.saveSystem);

    // Launch UI
    if (!this.scene.isActive('UIScene')) this.scene.launch('UIScene');
    else this.scene.get('UIScene').events.emit('scene:changed');

    // Listen for panel toggle (mobile collapse/expand)
    this.scene.get('UIScene').events.on('panel:toggled', () => this.handleResize());

    this.showSceneTitle(sceneData.title);
    this.gameState.playerPosition = { pctX: spawn.x, pctY: spawn.y };
    this.gameState.savedAt = Date.now();
    this.saveSystem.autoSave(this.gameState, sceneData.title);

    // Run scene onEnter scripts (chapter intros, premise, etc.)
    if (sceneData.onEnter?.length) {
      // Run immediately — black cover prevents scene flash
      this.time.delayedCall(100, () => {
        this.scriptEngine.updateContext(this.buildScriptContext());
        this.scriptEngine.execute(sceneData.onEnter!).then(() => {
          this.cinematicOverlay.hideBlackCover();
          this.checkSpawnTriggers(sceneData);
        });
      });
    } else {
      this.time.delayedCall(300, () => this.checkSpawnTriggers(sceneData));
    }

    // Force correct dimensions on initial create (iOS Safari workaround)
    this.forceCanvasResize();

    // Resize listeners
    this.scale.on('resize', () => this.handleResize());

    // iOS Safari: visualViewport is more reliable than Phaser's scale manager
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', () => this.scheduleResize());
    }
    window.addEventListener('orientationchange', () => this.scheduleResize());
    window.addEventListener('resize', () => this.scheduleResize());
  }

  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleResize(): void {
    // Debounce + retry: iOS Safari needs time to settle after orientation change
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.forceCanvasResize();
    this.resizeTimer = setTimeout(() => {
      this.forceCanvasResize();
      this.resizeTimer = setTimeout(() => this.forceCanvasResize(), 300);
    }, 100);
  }

  /** Force Phaser canvas to match actual window dimensions */
  private forceCanvasResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(this.scale.width - w) > 1 || Math.abs(this.scale.height - h) > 1) {
      this.scale.resize(w, h);
    }
    this.handleResize();
  }

  update(time: number, delta: number): void {
    this.player.update(time, delta);

    // Tick down input cooldown (prevents dismiss-click from triggering next action)
    if (this.inputCooldownFrames > 0) this.inputCooldownFrames--;

    // Walk-through trigger detection — check player position against triggers each frame
    if (this.player.isMoving() && !this.scriptEngine.isRunning()) {
      const sceneData = this.registry.get('sceneData') as SceneData | undefined;
      if (sceneData) {
        for (const tr of sceneData.regions.triggers) {
          if (!tr.bounds) continue;
          if (tr.once && this.firedTriggers.has(tr.id)) continue;
          // Check trigger gate synchronously (uses cache, skips if not cached yet)
          if (tr.gate) {
            const { address } = getWalletState();
            if (!address) continue;
            const gateResult = checkGatingRuleCached(address as Address, tr.gate as GatingRule);
            if (gateResult === null || gateResult === false) continue;
          }
          const b = tr.bounds;
          if (this.player.pctX >= b.x && this.player.pctX <= b.x + b.w &&
              this.player.pctY >= b.y && this.player.pctY <= b.y + b.h) {
            this.firedTriggers.add(tr.id);
            this.persistFiredTriggers();
            this.player.halt();
            this.scriptEngine.execute(tr.onEnter);
            break;
          }
        }
      }
    }
  }

  // ─── Camera ───────────────────────────────

  private setupCamera(): void {
    const cam = this.cameras.main;

    if (this.coordSystem.isPortrait || this.coordSystem.isPanoramic) {
      // Portrait or Panoramic: scene extends horizontally, camera follows player
      const boundsH = Math.max(this.coordSystem.bgH, this.scale.height);
      cam.setBounds(0, this.coordSystem.bgY, this.coordSystem.bgW, boundsH);
      cam.startFollow(this.player, true, 0.08, 0);
      cam.setDeadzone(this.coordSystem.vpW * 0.3, boundsH);
      this.bgFill.setVisible(false);
    } else {
      // Landscape non-panoramic: static camera, letterboxed
      cam.removeBounds();
      cam.stopFollow();
      cam.setScroll(0, 0);
      this.bgFill.setVisible(true);
    }
  }

  // ─── Input ────────────────────────────────

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.scriptEngine.isRunning()) return;
    if (this.inputCooldownFrames > 0) return;

    // Ignore the click that just dismissed a dialogue (same frame / same tick)
    const dismissedAt = this.registry.get('dialogueDismissedAt') as number | undefined;
    if (dismissedAt !== undefined && this.time.now - dismissedAt < 50) return;

    // Panel check uses SCREEN Y (panel is fixed to bottom of screen)
    const panelH = this.getEffectivePanelHeight();
    if (pointer.y >= this.scale.height - panelH) return;

    // Game area check uses WORLD coords (accounts for camera scroll)
    const wx = pointer.worldX;
    const wy = pointer.worldY;
    if (!this.coordSystem.isInBgArea(wx, wy)) return;

    const pct = this.coordSystem.screenToPct(wx, wy);

    // NPC click detection — check if click is near any NPC
    for (const npc of this.npcs) {
      if (!npc.dialogueTreeId) continue;
      const npcScreen = npc.getWorldTransformMatrix();
      const dx = wx - npcScreen.tx;
      const dy = wy - npcScreen.ty;
      if (Math.abs(dx) < 30 * this.coordSystem.getScale() && Math.abs(dy) < 50 * this.coordSystem.getScale()) {
        this.events.emit('npc:tapped', npc.npcId, npc.dialogueTreeId);
        return;
      }
    }

    // Check hotspot
    const hotspot = this.sceneDataLoader.getHotspotAtPct(pct.x, pct.y);

    // Get current verb and selected item from UI
    const uiScene = this.scene.get('UIScene') as Phaser.Scene;
    const scummUI = (uiScene as any).scummUI;
    const verb: Verb = scummUI?.getSelectedVerb?.() ?? Verb.WALK;
    const selectedItem = scummUI?.getSelectedItem?.() ?? null;

    // Item combo mode: USE [item] with [hotspot]
    if (selectedItem && hotspot) {
      scummUI?.clearSelectedItem?.();
      const sceneData = this.registry.get('sceneData') as SceneData;
      const combo = sceneData.combos?.find(
        (c: { items: string[] }) => c.items.includes(selectedItem.id) && c.items.includes(hotspot.id)
      );
      if (combo) {
        this.scriptEngine.updateContext(this.buildScriptContext());
        this.scriptEngine.execute(combo.script);
      } else {
        this.scene.get('UIScene').events.emit('say', `I can't use ${selectedItem.name} with ${hotspot.name}.`);
      }
      return;
    }

    if (verb === Verb.WALK || !hotspot) {
      this.pendingHotspot = null;
      this.player.walkToPct(pct.x, pct.y);
    } else if (verb === Verb.LOOK || verb === Verb.TALK) {
      // LOOK/TALK: execute immediately (no walk needed)
      this.pendingHotspot = null;
      this.events.emit('hotspot:tapped', hotspot);
    } else {
      // USE, PICK, OPEN, CLOSE: walk to hotspot, execute on arrival
      const b = hotspot.bounds!;
      const targetX = b.x + b.w / 2;
      const targetY = Math.min(b.y + b.h, 100);
      if (this.player.canReachPct(targetX, targetY)) {
        this.pendingHotspot = hotspot;
        this.player.walkToPct(targetX, targetY);
      } else {
        this.pendingHotspot = null;
        this.events.emit('hotspot:tapped', hotspot);
      }
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const panelH = this.getEffectivePanelHeight();
    if (pointer.y >= this.scale.height - panelH) {
      this.events.emit('hotspot:hover', null);
      return;
    }

    const wx = pointer.worldX;
    const wy = pointer.worldY;
    if (!this.coordSystem.isInBgArea(wx, wy)) {
      this.events.emit('hotspot:hover', null);
      return;
    }

    const pct = this.coordSystem.screenToPct(wx, wy);
    const hs = this.sceneDataLoader.getHotspotAtPct(pct.x, pct.y);
    this.events.emit('hotspot:hover', hs ? hs.name : null);
  }

  // ─── Resize ───────────────────────────────

  private handleResize(): void {
    // Use actual game dimensions (after forceCanvasResize)
    const w = this.scale.width;
    const h = this.scale.height;
    const panelH = this.getEffectivePanelHeight();
    this.registry.set('scummPanelHeight', panelH);
    this.coordSystem.recalculate(w, h - panelH);

    // Fill background (landscape only)
    const gameAreaH = h - panelH;
    const coverScale = Math.max(w / this.coordSystem.imgW, gameAreaH / this.coordSystem.imgH);
    this.bgFill.setPosition(w / 2, gameAreaH / 2).setScale(coverScale);

    const t = this.coordSystem.getBgTransform();
    this.bg.setPosition(t.x, t.y).setScale(t.scaleX, t.scaleY);

    // Foreground layer follows background transform
    if (this.fg) {
      this.fg.setPosition(t.x, t.y).setScale(t.scaleX, t.scaleY);
    }

    // Reposition watermark badge
    if (this.badge) {
      const badgeX = t.x + this.coordSystem.bgW - 8;
      const badgeY = t.y + this.coordSystem.bgH - 8;
      this.badge.setPosition(badgeX, badgeY);
      const targetW = this.coordSystem.bgW * 0.03;
      this.badge.setScale(targetW / this.badge.width);
    }

    this.player.onResize(this.coordSystem);

    for (const npc of this.npcs) {
      npc.setScale(this.coordSystem.getScale());
    }

    this.web3VisualSystem?.onResize(this.coordSystem);

    // Update camera for new orientation
    this.setupCamera();

    const sceneData = this.registry.get('sceneData') as SceneData;
    if (sceneData) this.drawDebugBounds(sceneData);

  }

  /** Get panel height — reads ScummUI effective height if available, falls back to formula */
  private getEffectivePanelHeight(): number {
    const stored = this.registry.get('scummPanelHeight') as number | undefined;
    if (stored !== undefined) return stored;
    return this.computePanelHeight();
  }

  /** Compute panel height — compact on mobile, standard on desktop */
  private computePanelHeight(): number {
    const { width, height } = this.scale;
    const isMobile = height > width || Math.min(width, height) < 600;
    const isLandscape = width > height;
    const panelRatio = isMobile ? (isLandscape ? 0.22 : 0.15) : 0.25;
    const minH = isMobile && isLandscape ? 100 : LAYOUT.PANEL_MIN_HEIGHT;
    return Math.max(minH, Math.floor(height * panelRatio));
  }

  // ─── Verb execution ───────────────────────

  private static VERB_DEFAULTS: Record<string, string> = {
    [Verb.LOOK]: 'Nothing special about it.',
    [Verb.USE]: "I can't use that.",
    [Verb.TALK]: "I don't think it wants to talk.",
    [Verb.PICK]: "I can't pick that up.",
    [Verb.OPEN]: "It doesn't open.",
    [Verb.CLOSE]: "It's not something I can close.",
    [Verb.PUSH]: "I can't push that.",
    [Verb.PULL]: "I can't pull that.",
    [Verb.GIVE]: "I have nobody to give that to.",
    [Verb.WALK]: "I'll walk there.",
  };

  /** Execute an item-to-item combo script (called from UIScene) */
  executeItemComboScript(script: import('@/types/scene.types').ScriptOp[]): void {
    this.scriptEngine.updateContext(this.buildScriptContext());
    this.scriptEngine.execute(script).then(() => {
      this.inputCooldownFrames = 2;
    });
  }

  async executeHotspotVerb(hotspot: HotspotData, verb: Verb): Promise<void> {
    // Check hotspot-level gate if present
    if (hotspot.gate) {
      const { address } = getWalletState();
      let gatePassed = false;
      if (address) {
        gatePassed = await checkGatingRule(address as Address, hotspot.gate as GatingRule);
      }
      if (!gatePassed) {
        this.scriptEngine.updateContext(this.buildScriptContext());
        if (hotspot.gateFallback?.length) {
          this.scriptEngine.execute(hotspot.gateFallback).then(() => { this.inputCooldownFrames = 2; });
        } else {
          this.scene.get('UIScene').events.emit('say', 'Something about this feels locked away...');
        }
        return;
      }
    }

    const scripts = hotspot.scripts[verb];
    if (scripts?.length) {
      this.scriptEngine.updateContext(this.buildScriptContext());
      this.scriptEngine.execute(scripts).then(() => {
        // After script finishes (say dismissed, etc.), ignore clicks for 2 frames
        // so the dismiss-click doesn't accidentally trigger the next action
        this.inputCooldownFrames = 2;
      });
    } else {
      const fallback = GameScene.VERB_DEFAULTS[verb] || 'Nothing interesting happens.';
      this.scene.get('UIScene').events.emit('say', fallback);
    }
  }

  private buildScriptContext(): ScriptContext {
    return {
      state: this.gameState,
      setState: (updater) => { this.gameState = updater(this.gameState); this.registry.set('gameState', this.gameState); },
      say: (text, speaker) => new Promise<void>((resolve) => {
        this.scene.get('UIScene').events.emit('say', text, speaker, resolve);
      }),
      sayBrief: (text, durationMs, speaker) => new Promise<void>((resolve) => {
        this.scene.get('UIScene').events.emit('sayBrief', text, durationMs, speaker, resolve);
      }),
      gotoScene: (sceneId, spawn) => {
        // Clear player position on scene transition (new scene uses its own spawn)
        this.gameState.playerPosition = undefined;
        this.saveSystem.autoSave(this.gameState, this.sceneDataLoader.getSceneData().title);
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.registry.set('currentSceneId', sceneId);
          if (spawn) this.registry.set('spawnOverride', spawn);
          this.scene.stop('UIScene');
          this.scene.start('PreloadScene');
        });
      },
      addItem: (id, name) => this.inventorySystem.addItem(id, name),
      removeItem: (id) => this.inventorySystem.removeItem(id),
      isWalletConnected: () => getWalletState().connected,
      checkGating: async (rule: GatingRule) => {
        const { address } = getWalletState();
        return address ? checkGatingRule(address as Address, rule) : false;
      },
      mintItem: async (tokenId): Promise<MintResult> => mintItem({ tokenId }),
      mintAchievement: async (achievementId): Promise<MintResult> => mintAchievement(achievementId),
      playSound: (key) => {
        if (this.cache.audio.has(key)) this.sound.play(key, { volume: 0.7 });
      },
      startDialogue: async (_npcId, treeId) => {
        const ui = this.scene.get('UIScene');
        ui.events.emit('startDialogue', _npcId, treeId);
        await new Promise<void>((r) => ui.events.once('dialogueComplete', r));
      },
      showTitleCard: (chapter, title, subtitle) => this.cinematicOverlay.showTitleCard(chapter, title, subtitle),
      showNarrative: (lines) => this.cinematicOverlay.showNarrative(lines),
      showAchievement: (text) => { this.cinematicOverlay.showAchievement(text); },
      showToast: (status, message) => { this.transactionToast.show(status, message); },
    };
  }

  private showSceneTitle(title: string): void {
    const center = this.coordSystem.pctToScreen(50, 5);
    const fontSize = Math.max(8, Math.min(14, Math.floor(this.coordSystem.bgW * 0.012)));
    const text = this.add.text(center.x, center.y, title, {
      fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`,
      color: TWP.SCENE_TITLE, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: text, alpha: { from: 0, to: 1 }, duration: 500, hold: 2000, yoyo: true, onComplete: () => text.destroy() });
  }

  private drawDebugBounds(sceneData: SceneData): void {
    if (!GameScene.DEBUG) return;
    this.debugContainer?.destroy();

    const container = this.add.container(0, 0).setDepth(50);
    this.debugContainer = container;
    const gfx = this.add.graphics();
    container.add(gfx);

    gfx.lineStyle(2, TWP.DEBUG_WALK, 0.6);
    for (const area of sceneData.walkableAreas ?? []) {
      const tl = this.coordSystem.pctToScreen(area.x, area.y);
      const br = this.coordSystem.pctToScreen(area.x + area.w, area.y + area.h);
      gfx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    gfx.lineStyle(2, TWP.DEBUG_HOTSPOT, 0.6);
    for (const hs of sceneData.regions.hotspots) {
      if (!hs.bounds) continue;
      const tl = this.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
      const br = this.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
      gfx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      const label = this.add.text(tl.x + 2, tl.y + 2, hs.name, {
        fontSize: '8px', color: '#ffff00', backgroundColor: 'rgba(0,0,0,0.5)',
      });
      container.add(label);
    }

    gfx.lineStyle(2, TWP.DEBUG_TRIGGER, 0.6);
    for (const tr of sceneData.regions.triggers) {
      if (!tr.bounds) continue;
      const tl = this.coordSystem.pctToScreen(tr.bounds.x, tr.bounds.y);
      const br = this.coordSystem.pctToScreen(tr.bounds.x + tr.bounds.w, tr.bounds.y + tr.bounds.h);
      gfx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    const spawn = sceneData.player.spawn;
    const spawnScreen = this.coordSystem.pctToScreen(spawn.x, spawn.y);
    gfx.fillStyle(TWP.DEBUG_SPAWN, 0.8);
    gfx.fillCircle(spawnScreen.x, spawnScreen.y, 5);
  }

  /** Check if player spawn position overlaps any triggers (fires once on scene load) */
  private checkSpawnTriggers(sceneData: SceneData): void {
    if (this.scriptEngine.isRunning()) return;
    for (const tr of sceneData.regions.triggers) {
      if (!tr.bounds) continue;
      if (tr.once && this.firedTriggers.has(tr.id)) continue;
      const b = tr.bounds;
      if (this.player.pctX >= b.x && this.player.pctX <= b.x + b.w &&
          this.player.pctY >= b.y && this.player.pctY <= b.y + b.h) {
        this.firedTriggers.add(tr.id);
        this.persistFiredTriggers();
        this.scriptEngine.updateContext(this.buildScriptContext());
        this.scriptEngine.execute(tr.onEnter);
        break;
      }
    }
  }

  /** Sync firedTriggers Set back to gameState for persistence */
  private persistFiredTriggers(): void {
    this.gameState.firedTriggers = [...this.firedTriggers];
    this.registry.set('gameState', this.gameState);
  }

  shutdown(): void {
    this.cinematicOverlay?.destroy();
    this.transactionToast?.destroy();
    this.web3VisualSystem?.destroy();
    this.walletUnsub?.();
  }
}

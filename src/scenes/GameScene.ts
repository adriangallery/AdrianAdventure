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
import { WEB3_ENABLED } from '@/config/platform';
import { NPC } from '@/objects/NPC';
import type { SceneData, HotspotData } from '@/types/scene.types';
import { type GameState, Verb, createInitialState } from '@/types/game.types';
import { TWP, FONT, LAYOUT } from '@/config/theme';
import { getWalletState, onWalletChange } from '@/web3/wallet';
import { checkGatingRule, checkGatingRuleCached, type GatingRule } from '@/web3/gating';
import { mintItem, mintAchievement, type MintResult } from '@/web3/contracts';
import { TransactionToast } from '@/ui/TransactionToast';
import { getAchievementByText } from '@/config/achievements.config';
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
  private conditionalOverlays: Array<{ sprite: Phaser.GameObjects.Image; flag: string; invert?: boolean }> = [];
  private debugContainer?: Phaser.GameObjects.Container;
  private static DEBUG = import.meta.env.DEV;
  private get isTrailer(): boolean { return !!this.registry.get('trailerMode'); }
  private pendingHotspot: HotspotData | null = null;
  /** V6: verbo a ejecutar al llegar (mantener pulsado = acción principal); null = el verbo del panel */
  private pendingVerb: Verb | null = null;
  /** V6: toque en curso sobre un hotspot (tocar = mirar, mantener = acción principal) */
  private touchHold: { hotspot: HotspotData; x: number; y: number; timer: Phaser.Time.TimerEvent; ring: Phaser.GameObjects.Graphics; onUp: () => void; onMove: (p: Phaser.Input.Pointer) => void } | null = null;
  private static readonly HOLD_MS = 450;
  /** V6: pistas cuando el jugador lleva un rato sin avanzar (sin cambiar escena, inventario ni flags) */
  private touchedHotspots = new Set<string>();
  private progressSig = '';
  private lastProgressAt = 0;
  private lastHintAt = 0;
  private static readonly HINT_AFTER_MS = 3 * 60 * 1000;
  private static readonly HINT_REPEAT_MS = 150 * 1000;
  /** V6: mantener pulsado en cinemática/diálogo = avance rápido (toques sintéticos cada FF_STEP_MS) */
  private fastForward: { timer: Phaser.Time.TimerEvent; ticker?: Phaser.Time.TimerEvent; label?: Phaser.GameObjects.Text; onUp: () => void } | null = null;
  private emittingSynthetic = false;
  private static readonly FF_HOLD_MS = 600;
  private static readonly FF_STEP_MS = 180;
  private static readonly HOLD_SLOP_PX = 16;
  private activeCameraEffect: { type: string; disableFlag?: string } | null = null;
  /** Persisted across sessions via gameState.firedTriggers */
  private firedTriggers: Set<string> = new Set();
  /** Frame-based cooldown: ignore clicks for 1 frame after script finishes */
  private inputCooldownFrames = 0;
  private walletUnsub: (() => void) | null = null;
  private boundScheduleResize: (() => void) | null = null;

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
    if (!this.gameState.achievements) this.gameState.achievements = [];
    // Retroactive achievement repair: backfill achievements for flags already earned
    this.repairAchievements();
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

    // Apply costume if flag is set (persists across scene transitions)
    if (this.gameState.flags.ape_costume_worn) {
      this.player.setCostume('ape');
    }

    // Per-scene player depth override (default 10, foreground is 15)
    // Set > 15 to render player ABOVE the foreground layer
    if ((sceneData.player as any).playerDepth) {
      this.player.setDepth((sceneData.player as any).playerDepth);
    }

    // Foreground layer — renders above player for depth (walk behind bushes/rocks)
    const fgKey = `fg_${sceneId}`;
    if (this.textures.exists(fgKey)) {
      this.fg = this.add.image(0, 0, fgKey).setOrigin(0, 0);
      const ft = this.coordSystem.getBgTransform();
      this.fg.setPosition(ft.x, ft.y).setScale(ft.scaleX, ft.scaleY);
      this.fg.setDepth(15);
    }


    // Conditional overlays — sprites shown/hidden based on game flags
    this.conditionalOverlays = [];
    const overlayConfigs = (sceneData as any).conditionalOverlays ?? [];
    for (const co of overlayConfigs) {
      const key = `overlay_${sceneId}_${co.id}`;
      if (this.textures.exists(key)) {
        const overlay = this.add.image(0, 0, key).setOrigin(0, 0);
        const ot = this.coordSystem.getBgTransform();
        overlay.setPosition(ot.x, ot.y).setScale(ot.scaleX, ot.scaleY);
        overlay.setDepth(co.depth ?? 12);
        const flagVal = this.gameState.flags[co.flag] ?? false;
        const show = co.invert ? !flagVal : flagVal;
        overlay.setVisible(show);
        this.conditionalOverlays.push({ sprite: overlay, flag: co.flag, invert: co.invert });
      }
    }

    // Camera setup based on orientation
    this.setupCamera();
    if (!this.isTrailer) this.cameras.main.fadeIn(400, 0, 0, 0);

    // Cinematic overlay (full-screen story moments)
    this.cinematicOverlay = new CinematicOverlay(this);
    this.transactionToast = new TransactionToast(this);

    // If scene has onEnter scripts, show black cover immediately to prevent scene flash
    if (sceneData.onEnter?.length && !this.isTrailer) {
      this.cinematicOverlay.showBlackCover();
    }

    // Script engine
    this.scriptEngine = new ScriptEngine(this.buildScriptContext());

    // Input — disabled in trailer mode
    if (!this.isTrailer) {
      this.input.on('pointerdown', this.handlePointerDown, this);
      this.input.on('pointermove', this.handlePointerMove, this);
    }

    // Execute pending verb when player arrives at hotspot
    this.events.on('player:arrived', () => {
      if (this.pendingHotspot) {
        const hotspot = this.pendingHotspot;
        const verb = this.pendingVerb ?? undefined;
        this.pendingHotspot = null;
        this.pendingVerb = null;
        this.events.emit('hotspot:tapped', hotspot, verb);
      }
    });

    // Costume: Player.update() reads ape_costume_worn flag directly from gameState

    // Audio — MusicManager persists across scenes (singleton on game.registry)
    this.musicManager = this.game.registry.get('musicManager') as MusicManager;
    this.musicManager.transitionToScene(sceneData.audio);

    // NPCs
    this.npcs = [];
    // V6: estado de las pistas por inactividad (por escena)
    this.touchedHotspots = new Set<string>();
    this.progressSig = '';
    this.lastProgressAt = Date.now();
    this.lastHintAt = 0;
    if (sceneData.npcs) {
      for (const nd of sceneData.npcs) {
        const npcScreen = this.coordSystem.pctToScreen(nd.position.x, nd.position.y);
        const npc = new NPC(this, npcScreen.x, npcScreen.y, nd.id, nd.name, nd.dialogueTreeId, nd.color ? parseInt(nd.color, 16) : undefined);
        const npcScale = this.coordSystem.getScale() * (nd.scale ?? 1);
        npc.setScale(npcScale);
        (npc as any)._npcDataScale = nd.scale ?? 1; // store for resize
        (npc as any)._npcPctPosition = { x: nd.position.x, y: nd.position.y }; // store for resize repositioning
        npc.startIdle();
        this.npcs.push(npc);
      }
    }

    // Web3 dynamic visuals (conditional sprites based on wallet/NFT state)
    if (WEB3_ENABLED && sceneData.web3Visuals?.length) {
      this.web3VisualSystem = new Web3VisualSystem(this, this.coordSystem, sceneData.web3Visuals);
    }

    // Camera post-processing effect (e.g., anaglyph for MemeLAB)
    this.activeCameraEffect = null;
    const cameraEffect = (sceneData as any).cameraEffect as { type: string; disableFlag?: string } | undefined;
    if (cameraEffect?.type === 'anaglyph') {
      const disableFlag = cameraEffect.disableFlag;
      if (!disableFlag || !(this.gameState.flags[disableFlag] ?? false)) {
        if (this.game.renderer.type === Phaser.WEBGL) {
          this.cameras.main.setPostPipeline('AnaglyphPipeline');
          this.activeCameraEffect = cameraEffect;
        }
      }
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

    if (!this.isTrailer) {
      this.showSceneTitle(sceneData.title);
      this.gameState.savedAt = Date.now();
      this.gameState.playerPosition = { pctX: spawn.x, pctY: spawn.y };
      this.saveSystem.autoSave(this.gameState, sceneData.title);
      this.time.addEvent({ delay: 5000, loop: true, callback: () => this.checkIdleHint() });
      // V6: aviso de autoguardado; si la escena abre con cinemática, se enseña al terminarla
      if (!sceneData.onEnter?.length) this.showAutosaveIndicator();
    }

    // Run scene onEnter scripts (chapter intros, premise, etc.) — skipped in trailer
    if (sceneData.onEnter?.length && !this.isTrailer) {
      this.time.delayedCall(100, () => {
        this.scriptEngine.updateContext(this.buildScriptContext());
        this.scriptEngine.execute(sceneData.onEnter!).then(() => {
          this.cinematicOverlay.hideBlackCover();
          this.showAutosaveIndicator();
          this.checkSpawnTriggers(sceneData);
        });
      });
    } else if (!this.isTrailer) {
      this.time.delayedCall(300, () => this.checkSpawnTriggers(sceneData));
    }

    // Force correct dimensions on initial create (iOS Safari workaround)
    this.forceCanvasResize();

    // Resize listeners
    this.scale.on('resize', () => this.handleResize());

    // iOS Safari: visualViewport is more reliable than Phaser's scale manager
    // Store bound reference so we can remove listeners on shutdown
    this.boundScheduleResize = () => this.scheduleResize();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', this.boundScheduleResize);
    }
    window.addEventListener('orientationchange', this.boundScheduleResize);
    window.addEventListener('resize', this.boundScheduleResize);
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

    // Refresh conditional overlays when flags change
    for (const co of this.conditionalOverlays) {
      const flagVal = this.gameState.flags[co.flag] ?? false;
      const show = co.invert ? !flagVal : flagVal;
      if (co.sprite.visible !== show) co.sprite.setVisible(show);
    }

    // Check if camera effect should be disabled (e.g., glasses used in MemeLAB)
    if (this.activeCameraEffect?.disableFlag) {
      if (this.gameState.flags[this.activeCameraEffect.disableFlag] ?? false) {
        this.cameras.main.removePostPipeline('AnaglyphPipeline');
        this.activeCameraEffect = null;
      }
    }

    // Tick down input cooldown (prevents dismiss-click from triggering next action)
    if (this.inputCooldownFrames > 0) this.inputCooldownFrames--;

    // Walk-through trigger detection — disabled in trailer mode
    if (this.player.isMoving() && !this.scriptEngine.isRunning() && !this.isTrailer) {
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
    if (this.emittingSynthetic) return;
    const blocked = this.scriptEngine.isRunning() || !!this.registry.get('dialogueActive') || !!this.registry.get('dialogueShowing');
    if (blocked) this.beginFastForwardHold(pointer);
    if (this.scriptEngine.isRunning()) return;
    if (this.inputCooldownFrames > 0) return;
    // Block all game input while dialogue tree is running (choices, etc.)
    if (this.registry.get('dialogueActive')) return;
    // Block game input while any dialogue text is showing (including fallback messages)
    if (this.registry.get('dialogueShowing')) return;

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

    // Get current verb and selected item from UI (needed for NPC item interactions)
    const uiScene = this.scene.get('UIScene') as Phaser.Scene;
    const scummUI = (uiScene as any).scummUI;
    const verb: Verb = scummUI?.getSelectedVerb?.() ?? Verb.WALK;
    const selectedItem = scummUI?.getSelectedItem?.() ?? null;

    // NPC click detection — use actual sprite bounds for accurate hit testing
    for (const npc of this.npcs) {
      if (!npc.dialogueTreeId) continue;
      const npcScreen = npc.getWorldTransformMatrix();
      const npcScale = npc.scale;
      const bodyW = (npc.width * npcScale) / 2;
      const bodyH = npc.height * npcScale;
      const dx = wx - npcScreen.tx;
      const dy = wy - npcScreen.ty;
      if (Math.abs(dx) < bodyW && dy > -bodyH && dy < 10 * npcScale) {
        // GIVE/USE item on NPC — show fun response instead of dialogue
        if (selectedItem && (verb === Verb.USE || verb === Verb.GIVE)) {
          scummUI?.clearSelectedItem?.();
          const sceneData = this.registry.get('sceneData') as SceneData;
          const npcData = sceneData.npcs?.find(n => n.id === npc.npcId);
          const responseMap = verb === Verb.GIVE
            ? (npcData as any)?.giveResponses
            : (npcData as any)?.useResponses;
          const response = responseMap?.[selectedItem.id]
            ?? responseMap?._default?.replace('{item}', selectedItem.name)
            ?? (verb === Verb.GIVE
              ? `${npc.npcName} doesn't want ${selectedItem.name}.`
              : `I can't use ${selectedItem.name} on ${npc.npcName}.`);
          this.scene.get('UIScene').events.emit('say', response, npc.npcName);
          return;
        }
        this.events.emit('npc:tapped', npc.npcId, npc.dialogueTreeId);
        return;
      }
    }

    // Check hotspot
    const rawHotspot = this.sceneDataLoader.getHotspotAtPct(pct.x, pct.y);
    let hotspot = rawHotspot && this.isHotspotVisible(rawHotspot) ? rawHotspot : null;
    // V6: con el dedo, 22 px de margen alrededor de cada hotspot (área táctil de al menos 44 px)
    if (!hotspot && pointer.wasTouch) {
      const pad = this.touchPadPct();
      hotspot = this.sceneDataLoader.getHotspotNearPct(pct.x, pct.y, pad.x, pad.y, (hs) => this.isHotspotVisible(hs));
    }
    if (hotspot) this.flashHotspot(hotspot);
    if (hotspot) this.events.emit('hotspot:focus', hotspot);

    // V6: con el dedo y sin verbo elegido, tocar un hotspot = mirar y mantener pulsado = acción principal
    if (pointer.wasTouch && hotspot && !selectedItem && verb === Verb.WALK) {
      this.beginTouchHold(pointer, hotspot);
      return;
    }

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
      if (!hotspot.bounds) {
        // No explicit bounds — execute immediately without walking
        this.pendingHotspot = null;
        this.events.emit('hotspot:tapped', hotspot);
        return;
      }
      const b = hotspot.bounds;
      const targetX = b.x + b.w / 2;
      const targetY = Math.min(b.y + b.h, 100);
      if (this.player.canReachPct(targetX, targetY)) {
        this.pendingHotspot = hotspot;
        this.pendingVerb = null;
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

    // Check NPC hover first (same hitbox as click detection)
    for (const npc of this.npcs) {
      if (!npc.dialogueTreeId) continue;
      const npcScreen = npc.getWorldTransformMatrix();
      const npcScale = npc.scale;
      const bodyW = (npc.width * npcScale) / 2;
      const bodyH = npc.height * npcScale;
      const dx = wx - npcScreen.tx;
      const dy = wy - npcScreen.ty;
      if (Math.abs(dx) < bodyW && dy > -bodyH && dy < 10 * npcScale) {
        this.events.emit('hotspot:hover', npc.npcName);
        return;
      }
    }

    const pct = this.coordSystem.screenToPct(wx, wy);
    const hs = this.sceneDataLoader.getHotspotAtPct(pct.x, pct.y);
    this.events.emit('hotspot:hover', hs ? hs.name : null);
    if (hs && this.isHotspotVisible(hs)) this.events.emit('hotspot:focus', hs);
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

    this.player.onResize(this.coordSystem);

    for (const npc of this.npcs) {
      const npcDataScale = (npc as any)._npcDataScale ?? 1;
      const npcPctPos = (npc as any)._npcPctPosition as { x: number; y: number } | undefined;
      if (npcPctPos) {
        const newPos = this.coordSystem.pctToScreen(npcPctPos.x, npcPctPos.y);
        npc.setPosition(newPos.x, newPos.y);
      }
      npc.setScale(this.coordSystem.getScale() * npcDataScale);
    }

    // Conditional overlays follow background transform
    for (const co of this.conditionalOverlays) {
      co.sprite.setPosition(t.x, t.y).setScale(t.scaleX, t.scaleY);
    }

    this.web3VisualSystem?.onResize(this.coordSystem);

    // Update camera for new orientation
    this.setupCamera();

    const sceneData = this.registry.get('sceneData') as SceneData;
    if (sceneData) this.drawDebugBounds(sceneData);

  }

  /** Get panel height — reads ScummUI effective height if available, falls back to formula */
  /** Check if a hotspot should be visible (not hidden/shown by a flag) */
  /** V6: 22 px de pantalla expresados en % del fondo (la mitad del área táctil mínima de 44 px). */
  private touchPadPct(): { x: number; y: number } {
    const o = this.coordSystem.pctToScreen(0, 0);
    const f = this.coordSystem.pctToScreen(100, 100);
    const w = Math.max(1, f.x - o.x);
    const h = Math.max(1, f.y - o.y);
    return { x: (22 / w) * 100, y: (22 / h) * 100 };
  }

  /**
   * V6: si el jugador mantiene pulsado durante una cinemática o un diálogo, pasado FF_HOLD_MS se activa el
   * avance rápido: las esperas del script terminan al momento y se reparten toques sintéticos que revelan y
   * cierran textos. Las elecciones de diálogo siguen necesitando un toque real (los toques sintéticos no
   * golpean botones).
   */
  private beginFastForwardHold(pointer: Phaser.Input.Pointer): void {
    if (this.fastForward) return;
    const onUp = () => this.endFastForward();
    const timer = this.time.delayedCall(GameScene.FF_HOLD_MS, () => {
      if (!this.fastForward || !pointer.isDown) { this.endFastForward(); return; }
      this.scriptEngine.setFastForward(true);
      this.fastForward.label = this.add.text(this.scale.width - 12, 12, '>> FAST', {
        fontFamily: FONT.FAMILY, fontSize: '12px', color: TWP.HINT_TEXT, backgroundColor: TWP.HINT_BG, padding: { x: 6, y: 3 },
      }).setOrigin(1, 0).setDepth(400).setScrollFactor(0);
      const ui = this.scene.get('UIScene');
      this.fastForward.ticker = this.time.addEvent({
        delay: GameScene.FF_STEP_MS,
        loop: true,
        callback: () => {
          this.emittingSynthetic = true;
          try {
            this.input.emit('pointerdown', pointer);
            if (ui && ui !== this) ui.input.emit('pointerdown', pointer);
          } finally {
            this.emittingSynthetic = false;
          }
        },
      });
    });
    this.input.once('pointerup', onUp);
    this.fastForward = { timer, onUp };
  }

  private endFastForward(): void {
    const ff = this.fastForward;
    if (!ff) return;
    ff.timer.remove();
    ff.ticker?.remove();
    ff.label?.destroy();
    this.input.off('pointerup', ff.onUp);
    this.fastForward = null;
    this.scriptEngine?.setFastForward(false);
    // que el dedo al soltar no mande al personaje a andar
    this.inputCooldownFrames = Math.max(this.inputCooldownFrames, 6);
  }

  /** V6: empieza un toque sobre un hotspot; al soltar antes de HOLD_MS se mira y si se mantiene se hace la acción principal. */
  private beginTouchHold(pointer: Phaser.Input.Pointer, hotspot: HotspotData): void {
    this.cancelTouchHold();
    this.events.emit('hotspot:hover', hotspot.name);
    const x = pointer.x, y = pointer.y;
    const ring = this.add.graphics().setDepth(60).setScrollFactor(0);
    const startedAt = this.time.now;
    const draw = () => {
      const t = Math.min(1, (this.time.now - startedAt) / GameScene.HOLD_MS);
      ring.clear();
      if (t < 0.15) return; // un toque rápido no llega a enseñar el anillo
      ring.lineStyle(4, TWP.INV_SLOT_SELECT, 0.9);
      ring.beginPath();
      ring.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ring.strokePath();
    };
    this.events.on('update', draw);
    const cleanup = () => {
      this.events.off('update', draw);
      ring.destroy();
      this.input.off('pointerup', onUp);
      this.input.off('pointermove', onMove);
      this.touchHold = null;
    };
    const onUp = () => {
      if (!this.touchHold) return;
      this.touchHold.timer.remove();
      cleanup();
      this.runHotspotVerb(hotspot, Verb.LOOK);
    };
    const onMove = (p: Phaser.Input.Pointer) => {
      if (Math.hypot(p.x - x, p.y - y) > GameScene.HOLD_SLOP_PX && this.touchHold) {
        this.touchHold.timer.remove();
        cleanup(); // arrastrar cancela: ni mirar ni actuar
      }
    };
    const timer = this.time.delayedCall(GameScene.HOLD_MS, () => {
      if (!this.touchHold) return;
      cleanup();
      this.flashHotspot(hotspot);
      this.runHotspotVerb(hotspot, GameScene.mainVerbFor(hotspot));
    });
    this.input.on('pointerup', onUp);
    this.input.on('pointermove', onMove);
    this.touchHold = { hotspot, x, y, timer, ring, onUp, onMove };
  }

  private cancelTouchHold(): void {
    const h = this.touchHold;
    if (!h) return;
    h.timer.remove();
    h.ring.destroy();
    this.input.off('pointerup', h.onUp);
    this.input.off('pointermove', h.onMove);
    this.touchHold = null;
  }

  /** Ejecuta un verbo concreto sobre un hotspot: mirar y hablar al momento; el resto andando hasta él. */
  private runHotspotVerb(hotspot: HotspotData, verb: Verb): void {
    if (verb === Verb.LOOK || verb === Verb.TALK || !hotspot.bounds) {
      this.pendingHotspot = null;
      this.pendingVerb = null;
      this.events.emit('hotspot:tapped', hotspot, verb);
      return;
    }
    const b = hotspot.bounds;
    const targetX = b.x + b.w / 2;
    const targetY = Math.min(b.y + b.h, 100);
    if (this.player.canReachPct(targetX, targetY)) {
      this.pendingHotspot = hotspot;
      this.pendingVerb = verb;
      this.player.walkToPct(targetX, targetY);
    } else {
      this.pendingHotspot = null;
      this.pendingVerb = null;
      this.events.emit('hotspot:tapped', hotspot, verb);
    }
  }

  /** Verbos que cuentan como «acción principal», por orden de preferencia. */
  private static readonly MAIN_VERB_ORDER: Verb[] = [Verb.PICK, Verb.OPEN, Verb.USE, Verb.TALK, Verb.PUSH, Verb.PULL, Verb.CLOSE, Verb.GIVE];
  private static readonly FLAVOR_OPS = new Set(['say', 'sayBrief', 'ifFlag', 'wait', 'playSound']);

  /**
   * V6: la acción principal de un hotspot es el primer verbo cuyo script hace algo más que hablar
   * (coger, cambiar de escena, poner un flag…). Si ninguno lo hace, USE.
   */
  static mainVerbFor(hotspot: HotspotData): Verb {
    const walk = (ops: unknown): string[] => {
      if (!Array.isArray(ops)) return [];
      const out: string[] = [];
      for (const o of ops as Array<Record<string, unknown>>) {
        if (!o || typeof o.op !== 'string') continue;
        out.push(o.op);
        for (const k of ['then', 'else', 'steps', 'script']) out.push(...walk(o[k]));
      }
      return out;
    };
    for (const v of GameScene.MAIN_VERB_ORDER) {
      const ops = walk(hotspot.scripts?.[v]);
      if (ops.some((op) => !GameScene.FLAVOR_OPS.has(op))) return v;
    }
    return Verb.USE;
  }

  /** Firma del progreso: cambia al cambiar de escena, coger/soltar objetos o activar flags. */
  private currentProgressSig(): string {
    const flags = Object.values(this.gameState.flags ?? {}).filter(Boolean).length;
    const inv = (this.gameState.inventory ?? []).map((i) => i.id).join(',');
    return `${this.gameState.currentScene}|${inv}|${flags}`;
  }

  /**
   * V6: si el jugador lleva HINT_AFTER_MS sin avanzar (se puede acortar con ?hintAfter=<segundos> para
   * pruebas), una pista breve: primero un objeto que aún no ha tocado y que hace algo (con resaltado); si ya
   * los tocó todos, el inventario; si no hay inventario, probar otros verbos.
   */
  private checkIdleHint(): void {
    if (this.isTrailer) return;
    const now = Date.now();
    const sig = this.currentProgressSig();
    if (sig !== this.progressSig) { this.progressSig = sig; this.lastProgressAt = now; return; }
    if (this.scriptEngine.isRunning() || this.registry.get('dialogueShowing') || this.registry.get('dialogueActive')) {
      this.lastProgressAt = Math.max(this.lastProgressAt, now - 1000);
      return;
    }
    const override = Number(new URLSearchParams(window.location.search).get('hintAfter'));
    const after = override > 0 ? override * 1000 : GameScene.HINT_AFTER_MS;
    if (now - this.lastProgressAt < after) return;
    if (this.lastHintAt && now - this.lastHintAt < Math.min(GameScene.HINT_REPEAT_MS, after * 2)) return;

    const sceneData = this.registry.get('sceneData') as SceneData;
    const candidates = (sceneData?.regions?.hotspots ?? [])
      .filter((h) => h.bounds && this.isHotspotVisible(h) && !this.touchedHotspots.has(h.id));
    const useful = candidates.find((h) => GameScene.mainVerbFor(h) !== Verb.USE) ?? candidates[0];
    let text: string;
    if (useful) {
      text = `Hint: take a closer look at the ${useful.name}.`;
      this.flashHotspot(useful);
      this.time.delayedCall(450, () => this.flashHotspot(useful));
    } else if ((this.gameState.inventory ?? []).length) {
      text = 'Hint: something in your inventory might help here.';
    } else {
      text = 'Hint: try other verbs (Open, Pick up, Push), not just Look.';
    }
    this.lastHintAt = now;
    this.registry.set('lastHint', { at: now, text });
    this.scene.get('UIScene').events.emit('sayBrief', text, 4000, undefined, () => {});
  }

  /** V6: aviso breve «AUTOSAVED» sobre el panel, abajo a la derecha del área de juego. */
  private showAutosaveIndicator(): void {
    if (this.isTrailer) return;
    this.registry.set('lastAutosaveAt', Date.now());
    const panelH = this.getEffectivePanelHeight();
    const label = this.add.text(this.scale.width - 12, this.scale.height - panelH - 10, 'AUTOSAVED', {
      fontFamily: FONT.FAMILY, fontSize: '10px', color: TWP.HINT_TEXT, backgroundColor: TWP.HINT_BG, padding: { x: 6, y: 3 },
    }).setOrigin(1, 1).setDepth(400).setScrollFactor(0).setAlpha(0).setName('autosave-indicator');
    this.tweens.add({
      targets: label, alpha: 1, duration: 200, hold: 1600, yoyo: true,
      onComplete: () => label.destroy(),
    });
  }

  /** V6: resaltado breve del hotspot pulsado, para que el toque se note. */
  private flashHotspot(hs: HotspotData): void {
    if (!hs.bounds) return;
    const a = this.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
    const b = this.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
    const g = this.add.graphics().setDepth(50);
    g.lineStyle(3, TWP.INV_SLOT_SELECT, 1);
    g.strokeRoundedRect(a.x, a.y, b.x - a.x, b.y - a.y, 6);
    this.tweens.add({ targets: g, alpha: 0, duration: 350, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  private isHotspotVisible(hs: HotspotData): boolean {
    const hideFlag = (hs as any).hideWhenFlag;
    if (hideFlag && (this.gameState.flags[hideFlag] ?? false)) return false;
    const showFlag = (hs as any).showWhenFlag;
    if (showFlag && !(this.gameState.flags[showFlag] ?? false)) return false;
    return true;
  }

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

  /**
   * Run a script with a watchdog that force-resets the engine if it never
   * resolves (defence against lost Promise resolvers in dialogue/UI chains
   * that would otherwise freeze all input until a scene transition).
   */
  private runScriptWithWatchdog(
    script: import('@/types/scene.types').ScriptOp[],
    label: string,
  ): void {
    this.scriptEngine.updateContext(this.buildScriptContext());
    let settled = false;
    const watchdog = window.setTimeout(() => {
      if (!settled && this.scriptEngine.isRunning()) {
        this.scriptEngine.forceReset(`watchdog timeout: ${label}`);
        this.inputCooldownFrames = 2;
      }
    }, 30_000);
    this.scriptEngine.execute(script).finally(() => {
      settled = true;
      clearTimeout(watchdog);
      this.inputCooldownFrames = 2;
    });
  }

  /** Execute an item-to-item combo script (called from UIScene) */
  executeItemComboScript(script: import('@/types/scene.types').ScriptOp[]): void {
    this.runScriptWithWatchdog(script, 'item combo');
  }

  async executeHotspotVerb(hotspot: HotspotData, verb: Verb): Promise<void> {
    this.touchedHotspots.add(hotspot.id);
    // Check hotspot-level gate if present
    if (hotspot.gate) {
      const { address } = getWalletState();
      let gatePassed = false;
      if (address) {
        gatePassed = await checkGatingRule(address as Address, hotspot.gate as GatingRule);
      }
      if (!gatePassed) {
        if (hotspot.gateFallback?.length) {
          this.runScriptWithWatchdog(hotspot.gateFallback, `gate fallback ${hotspot.id}`);
        } else {
          this.scene.get('UIScene').events.emit('say', 'Something about this feels locked away...');
        }
        return;
      }
    }

    const scripts = hotspot.scripts[verb];
    if (scripts?.length) {
      this.runScriptWithWatchdog(scripts, `${hotspot.id}/${verb}`);
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
      addItem: (id, name) => {
        this.inventorySystem.addItem(id, name);
        if (this.cache.audio.has('item_pickup')) this.sound.play('item_pickup', { volume: 0.6 });
      },
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
      showTitleCard: (chapter, title, subtitle) => {
        const ui = this.scene.get('UIScene');
        return new Promise<void>((resolve) => {
          ui.events.emit('showTitleCard', chapter, title, subtitle, resolve);
        });
      },
      showNarrative: (lines) => {
        const ui = this.scene.get('UIScene');
        return new Promise<void>((resolve) => {
          ui.events.emit('showNarrative', lines, resolve);
        });
      },
      showAchievement: (text) => {
        // Track achievement in gameState
        const achDef = getAchievementByText(text);
        if (achDef) {
          if (!this.gameState.achievements) this.gameState.achievements = [];
          if (!this.gameState.achievements.includes(achDef.id)) {
            this.gameState.achievements.push(achDef.id);
            this.registry.set('gameState', this.gameState);
          }
        }
        if (this.cache.audio.has('achievement')) this.sound.play('achievement', { volume: 0.6 });
        const ui = this.scene.get('UIScene');
        ui.events.emit('showAchievement', text);
      },
      showToast: (status, message) => { this.transactionToast.show(status, message); },
      setCostume: (prefix) => { this.player.setCostume(prefix); },
      showCredits: () => {
        const ui = this.scene.get('UIScene');
        return new Promise<void>((resolve) => {
          ui.events.emit('showCredits', resolve);
        });
      },
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
    if (!GameScene.DEBUG || this.isTrailer) return;
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

  /** Update gameState with current player position (call before manual save) */
  syncPlayerPosition(): void {
    if (this.player) {
      this.gameState.playerPosition = { pctX: this.player.pctX, pctY: this.player.pctY };
      this.registry.set('gameState', this.gameState);
    }
  }

  /** Sync firedTriggers Set back to gameState for persistence */
  private persistFiredTriggers(): void {
    this.gameState.firedTriggers = [...this.firedTriggers];
    this.registry.set('gameState', this.gameState);
  }

  /** Retroactive achievement repair — backfill achievements for flags already earned */
  private repairAchievements(): void {
    const flags = this.gameState.flags;
    const earned = this.gameState.achievements;
    const repairs: Array<{ flag: string; id: string }> = [
      { flag: 'chapter_1_complete', id: 'ch1_complete' },
      { flag: 'chapter_2_complete', id: 'ch2_complete' },
      { flag: 'chapter_3_complete', id: 'ch3_complete' },
      { flag: 'chapter_4_complete', id: 'ch4_complete' },
    ];
    for (const { flag, id } of repairs) {
      if (flags[flag] && !earned.includes(id)) {
        earned.push(id);
      }
    }
  }

  shutdown(): void {
    this.cancelTouchHold();
    this.endFastForward();
    // Remove window listeners to prevent memory leaks
    if (this.boundScheduleResize) {
      window.removeEventListener('orientationchange', this.boundScheduleResize);
      window.removeEventListener('resize', this.boundScheduleResize);
      const vv = window.visualViewport;
      if (vv) vv.removeEventListener('resize', this.boundScheduleResize);
      this.boundScheduleResize = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.cinematicOverlay?.destroy();
    this.transactionToast?.destroy();
    this.web3VisualSystem?.destroy();
    this.walletUnsub?.();
    if (this.activeCameraEffect) {
      this.cameras.main.removePostPipeline('AnaglyphPipeline');
      this.activeCameraEffect = null;
    }
  }
}

import Phaser from 'phaser';
import { sceneTitlePlacement } from '@/ui/achievementLayout';
import { Player, type PlayerAnimQa } from '@/objects/Player';
import { CoordSystem } from '@/systems/CoordSystem';
import { SceneDataLoader } from '@/systems/SceneDataLoader';
import { ScriptEngine, type ScriptContext } from '@/systems/ScriptEngine';
import { DialogueScriptRunner } from '@/systems/DialogueScripts';
import { InventorySystem } from '@/systems/InventorySystem';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { migrateGameState } from '@/systems/SaveMigration';
import { isValidRunId, newRunId } from '@/systems/SaveProgress';
import { addPlayTime } from '@/systems/Ending';
import type { MusicManager } from '@/systems/MusicManager';
import { CinematicOverlay } from '@/ui/CinematicOverlay';
import { Web3VisualSystem } from '@/systems/Web3VisualSystem';
import { WEB3_ENABLED } from '@/config/platform';
import { NPC, type NpcLifeQa } from '@/objects/NPC';
import type { SceneData, HotspotData } from '@/types/scene.types';
import { type GameState, type InventoryItem, Verb, createInitialState } from '@/types/game.types';
import { TWP, FONT, LAYOUT } from '@/config/theme';
import { getWalletState, onWalletChange } from '@/web3/wallet';
import { checkGatingRule, checkGatingRuleCached, gateAddress, type GatingRule } from '@/web3/gating';
import { mintItem, mintAchievement, type MintResult } from '@/web3/contracts';
import { TransactionToast } from '@/ui/TransactionToast';
import { DashboardPanel, type DashboardQaState } from '@/ui/DashboardPanel';
import { loadDashboard } from '@/web3/dashboard';
import { getAchievementByText } from '@/config/achievements.config';
import { bindShutdown } from './lifecycle';
import { gameUrlParams } from '@/config/debugParams';
import type { Address } from 'viem';
import { ScummUI } from '@/ui/ScummUI';
import type { UIScene } from '@/scenes/UIScene';
import { actorDepth, foregroundBands } from '@/systems/WalkMotion';
import { decideTap, deferredTapVerdict, textTapPolicy, walkPointFor } from '@/systems/TapDecision';
import { approachHotspot, approachTalk, lookFacing, type Approach, type ApproachTarget, type Facing, type FacingOptions } from '@/systems/Facing';
import { defaultVerbFor, exitVerbFor, focusOf, isDoubleClick, keyAction, primaryVerb } from '@/systems/DesktopControls';
import { CinematicDirector, type CinematicQaState, type CinematicUi } from '@/systems/CinematicDirector';
import { parseTransition, worldToScreen, type TransitionSpec } from '@/systems/Cinematics';
import { overlayTransform, type PctRect } from '@/systems/OverlayPlacement';
import { fitScale, worldSize } from '@/systems/SceneTextures';
import { FADE_FIRST_MS, FADE_SHORT_MS } from '@/systems/ScenePrefetch';
import { addNote, callAnon } from '@/systems/Journal';
import { JOURNAL_CHAPTERS, journalChapter, journalProgress, journalWorld } from '@/systems/JournalData';
import { spriteScale, worldToArt, isIntegerScale } from '@/systems/PixelScale';
import { pickLevel, wantsGesture } from '@/systems/PlayerAnim';
import { defaultFacing, lifeSeed, type VoiceState } from '@/systems/NpcLife';
import { AmbientLayer } from '@/systems/AmbientLayer';
import type { AmbientQa } from '@/systems/Ambient';
import type { VoiceSystem } from '@/systems/VoiceSystem';
import { failResponses } from '@/systems/FailResponsesData';
import { isNpcBag } from '@/systems/FailResponses';
import { surfaceAt, stepSound } from '@/systems/Footsteps';
import { sfxOf } from '@/systems/Sfx';
import { isStingerKind } from '@/systems/Stingers';
import { playStinger } from '@/systems/StingerPlayer';

/** A2.4 (QA): cómo pulsa la API de QA: botón derecho o clic de ratón (cuenta para el doble clic). */
type QaClick = { button?: 'left' | 'right'; mouse?: boolean };

/** Resultado del hit-test de un toque: nada (panel, fuera del fondo), un NPC o un punto del fondo. */
type TapHit =
  | { kind: 'none'; reason: string }
  | { kind: 'npc'; npc: NPC }
  | { kind: 'scene'; pct: { x: number; y: number }; hotspot: HotspotData | null; rawHotspot: HotspotData | null };

/** A2.17 fase 3: clave de la máscara de un trozo del primer plano (la misma que ScenePrefetch.sceneImageAssets) */
const fgMaskKey = (sceneId: string, layerId: string) => `fgmask_${sceneId}_${layerId}`;

/** A2.17 fase 2: caja en % → píxeles enteros de una textura de w×h */
function pctRectToPx(b: { x: number; y: number; w: number; h: number }, w: number, h: number) {
  const x0 = Math.max(0, Math.round((b.x / 100) * w));
  const y0 = Math.max(0, Math.round((b.y / 100) * h));
  const x1 = Math.min(w, Math.round(((b.x + b.w) / 100) * w));
  const y1 = Math.min(h, Math.round(((b.y + b.h) / 100) * h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private coordSystem!: CoordSystem;
  private sceneDataLoader!: SceneDataLoader;
  private scriptEngine!: ScriptEngine;
  /** A1.9: motor aparte para los onEnter de los nodos de diálogo (ver DialogueScripts.ts) */
  private dialogueScripts!: DialogueScriptRunner;
  private inventorySystem!: InventorySystem;
  private saveSystem!: SaveLoadSystem;
  /** A1.12: el último autoguardado se escribió y releyó bien (si no, no se enseña «AUTOSAVED»). */
  private autosaveOk = false;
  /** A1.13: hubo progreso desde el último autoguardado (ver autosaveProgressIfIdle). */
  private progressDirty = false;
  private musicManager!: MusicManager;
  /** A4.4 (QA): último paso (superficie bajo los pies y efecto que sonó, null si la superficie es muda) */
  private lastFootstep: { surface: string | null; key: string | null; at: number } | null = null;
  private cinematicOverlay!: CinematicOverlay;
  /** A3.10: dashboard TraitLab del Mining Rig (op showDashboard); se crea al abrirlo y se destruye en el SHUTDOWN */
  private dashboardPanel: DashboardPanel | null = null;
  /** A2.10: cinemáticas (cámara, franjas, actores, transiciones); uno por escena, se destruye en SHUTDOWN */
  private cinema?: CinematicDirector;
  private transactionToast!: TransactionToast;
  private web3VisualSystem?: Web3VisualSystem;
  private npcs: NPC[] = [];
  /** A4.3: animación ambiental de la escena (`ambient[]` de scene.json); se crea en create() y se suelta en SHUTDOWN */
  private ambient?: AmbientLayer;
  /**
   * A4.2: hora (la `time` de update, reloj real) del último frame de vida de las NPC. La boca sigue a un clip de voz que
   * suena en tiempo real: con el `delta` suavizado de Phaser, en un frame lento iría por detrás del audio.
   */
  private lifeClock = 0;
  private gameState!: GameState;
  private bgFill!: Phaser.GameObjects.Image;
  private bg!: Phaser.GameObjects.Image;
  private fg?: Phaser.GameObjects.Image;
  /** A2.17 fase 2: trozos del primer plano con walk-behind (foregroundLayers), a la profundidad de su base */
  private fgLayers: Array<{ img: Phaser.GameObjects.Image; bounds?: PctRect; id?: string; band?: number }> = [];
  private conditionalOverlays: Array<{ id: string; sprite: Phaser.GameObjects.Image; flag: string; invert?: boolean; bounds?: PctRect }> = [];
  /**
   * A1.4: visibilidad forzada por el op `flicker` (id del overlay → visible), por encima de la flag. Es solo
   * presentación: no se guarda. Se vacía al crear la escena y en SHUTDOWN.
   */
  private overlayOverrides = new Map<string, boolean>();
  /** P1: Dex sentado (scene.player.seated), solo en escenas con hidePlayer */
  private seatedDex: { img: Phaser.GameObjects.Image; flag: string; x: number; y: number } | null = null;
  /**
   * A1.4: Phaser reutiliza la instancia de la escena; cada create() sube este contador y el contexto de scripts
   * guarda el suyo, así un flicker de la escena anterior que siga esperando no toca los overlays de la nueva.
   */
  private sceneRun = 0;
  private debugContainer?: Phaser.GameObjects.Container;
  private static DEBUG = import.meta.env.DEV;
  private get isTrailer(): boolean { return !!this.registry.get('trailerMode'); }
  /**
   * Acción que espera a que el jugador llegue (player:arrived): A2.2 se gira a `face` y ejecuta `run` (el verbo sobre
   * el hotspot, el combo o hablar con la NPC). Lo cancelan un trigger que lo para, un script o un diálogo en marcha.
   */
  private pending: { face: Facing | null; run: () => void; verb: Verb; aim: { x: number; y: number } | null } | null = null;
  /** A2.2: último acercamiento (objetivo, verbo, punto de llegada y orientación), para la API de QA */
  private lastApproach: { target: string; verb: Verb; walkTo: { x: number; y: number } | null; face: Facing | null } | null = null;
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
  /**
   * V6: mantener pulsado en cinemática/diálogo = avance rápido (toques sintéticos cada FF_STEP_MS). A2.4: Esc lanza el
   * mismo avance rápido sin dedo (`byKey`): sin espera previa y hasta que no quede nada que saltar.
   */
  private fastForward: { timer?: Phaser.Time.TimerEvent; ticker?: Phaser.Time.TimerEvent; label?: Phaser.GameObjects.Text; onUp?: () => void; byKey?: boolean } | null = null;
  /** A2.4: tope del avance rápido de Esc (por si algo no deja de estar «en pantalla») */
  private static readonly KEY_SKIP_MAX_MS = 30_000;
  /** A2.4: último clic izquierdo de ratón (hotspot y hora), para el doble clic en una salida */
  private lastClick: { id: string | null; at: number } | null = null;
  /** A2.4: resaltado de hotspots mientras se mantiene Tab (objetos dibujados e ids resaltados) */
  private highlight: { objects: Phaser.GameObjects.GameObject[]; ids: string[] } | null = null;
  /** A2.4: listeners de teclado y del lienzo (fuera de la escena: se quitan en shutdown) */
  private desktopInput: { keydown: (e: KeyboardEvent) => void; keyup: (e: KeyboardEvent) => void; blur: () => void; contextmenu: (e: Event) => void; canvas: HTMLCanvasElement } | null = null;
  /** A2.4 (QA): listeners de DOM vivos de todas las GameScene; si no vuelve al valor de antes, alguien no los quita */
  private static liveDomListeners = 0;
  private emittingSynthetic = false;
  private static readonly FF_HOLD_MS = 600;
  private static readonly FF_STEP_MS = 180;
  private static readonly HOLD_SLOP_PX = 16;
  private activeCameraEffect: { type: string; disableFlag?: string } | null = null;
  /** Persisted across sessions via gameState.firedTriggers */
  private firedTriggers: Set<string> = new Set();
  /** Frame-based cooldown: ignore clicks for 1 frame after script finishes */
  private inputCooldownFrames = 0;
  /** A1.14: toque que saltó una frase, a ejecutar cuando el juego quede libre */
  private deferredTap: { wx: number; wy: number; sy: number; touch: boolean; button: number; at: number } | null = null;
  /** A1.14: el último toque fue con el dedo (al llegar se limpia la línea de acción: no hay ratón que la refresque) */
  private lastInputTouch = false;
  private walletUnsub: (() => void) | null = null;
  private boundScheduleResize: (() => void) | null = null;

  constructor() { super({ key: 'GameScene' }); }

  init(data?: { sceneId?: string; spawn?: { x: number; y: number } }): void {
    if (data?.sceneId) this.registry.set('currentSceneId', data.sceneId);
    if (data?.spawn) this.registry.set('spawnOverride', data.spawn);
  }

  create(): void {
    // A1.10: Phaser no llama a shutdown() solo; sin esto cada cambio de escena dejaba vivos los listeners de resize
    bindShutdown(this);
    this.sceneRun++;
    this.overlayOverrides.clear();
    const sceneId = this.registry.get('currentSceneId') as string;
    // A0.1: la API de QA espera a que termine el cambio de escena y a que pasen onEnter y los triggers de spawn
    this.registry.remove('sceneTransition');
    this.registry.set('sceneCreatedAt', Date.now());
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
    // A1.4: red de seguridad; las cargas ya migran, pero cualquier estado que llegue al registry pasa por aquí
    this.gameState = migrateGameState((this.registry.get('gameState') as GameState) ?? createInitialState(sceneId));
    this.gameState.currentScene = sceneId;
    // A1.13: id de partida; a una partida vieja (sin id) se le pone uno al cargarla
    if (!isValidRunId(this.gameState.runId)) this.gameState.runId = newRunId(Date.now(), Math.random());
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

    // Background. A5.1: el tamaño LÓGICO de la escena (render.world: al que se refieren las coordenadas en %, la unidad de
    // píxel de A2.8 y la velocidad) ya no es el de la textura: el fondo se sube a la GPU en una variante más pequeña
    // (background@2048.webp) y se estira con fitScale (src/systems/SceneTextures.ts). Sin render.world, el de la textura.
    const bgTexture = this.textures.get(`bg_${sceneId}`);
    const imgSource = bgTexture.getSourceImage() as HTMLImageElement;
    const world = worldSize(sceneData, { w: imgSource.width, h: imgSource.height });
    const imgW = world.w;
    const imgH = world.h;

    // Panel height
    const panelH = this.getEffectivePanelHeight();
    this.registry.set('scummPanelHeight', panelH);

    // Coordinate system
    this.coordSystem = new CoordSystem(imgW, imgH);
    this.coordSystem.recalculate(this.scale.width, this.scale.height - panelH);
    this.registry.set('coordSystem', this.coordSystem);

    // Fill background — darkened cover (landscape letterbox filler)
    const gameAreaH = this.scale.height - panelH;
    const coverScale = Math.max(this.scale.width / imgW, gameAreaH / imgH) * fitScale(world, { w: imgSource.width, h: imgSource.height }).x;
    this.bgFill = this.add.image(this.scale.width / 2, gameAreaH / 2, `bg_${sceneId}`)
      .setScale(coverScale)
      .setOrigin(0.5)
      .setTint(0x444444)
      .setDepth(-1)
      .setScrollFactor(0); // fixed to camera so it always fills letterbox

    // Main background
    this.bg = this.add.image(0, 0, `bg_${sceneId}`).setOrigin(0, 0);
    this.placeOverlay(this.bg);

    // Player
    const spawnOverride = this.registry.get('spawnOverride') as { x: number; y: number } | undefined;
    const spawn = spawnOverride ?? sceneData.player.spawn;
    this.registry.remove('spawnOverride');
    this.player = new Player(this, this.coordSystem, spawn.x, spawn.y, sceneData);
    this.player.onStep = () => this.checkWalkTriggers();
    // A2.15: «no puedo» = Dex se encoge de hombros con cada respuesta de fallo (el texto sale a la vez, sin esperar)
    failResponses.onFail = () => this.player?.shrug();

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
    if (sceneData.player.playerDepth) {
      this.player.setFixedDepth(sceneData.player.playerDepth);
    }

    // Foreground layer — renders above player for depth (walk behind bushes/rocks)
    // A5.1: la instancia de GameScene se reutiliza entre escenas; sin esto, en una escena sin primer plano `this.fg`
    // seguía apuntando al de la anterior (ya destruido) y, al liberar su textura, handleResize() rompía en
    // getSourceImage() («reading 'source'»: los rojos de smoke y walkthrough en la PR #56).
    this.fg = undefined;
    this.fgLayers = [];
    const fgKey = `fg_${sceneId}`;
    if (this.textures.exists(fgKey)) {
      // A2.17 fase 3: un trozo con `mask` sin su máscara cargada se ignora (sus píxeles se quedan en el primer plano)
      const layers = (sceneData.foregroundLayers ?? []).filter((l) => l.bounds && Number.isFinite(l.baseY)
        && (!l.mask || this.textures.exists(fgMaskKey(sceneId, l.id))));
      this.fg = this.add.image(0, 0, layers.length ? this.foregroundRest(fgKey, sceneId, layers) : fgKey).setOrigin(0, 0);
      this.placeOverlay(this.fg);
      this.fg.setDepth(15);
      // A2.17 fase 2: walk-behind por objeto: cada trozo, recortado de la misma textura, a la profundidad de su base.
      // Fase 3: con `mask`, solo los píxeles de la máscara (textura canvas del tamaño de bounds).
      const src = this.textures.get(fgKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      for (const k of this.textures.getTextureKeys()) if (k.startsWith('fglayer_')) this.textures.remove(k);
      for (const l of layers) {
        const r = pctRectToPx(l.bounds, src.width, src.height);
        const piece = l.mask ? this.maskedForegroundPiece(src, r, `fglayer_${sceneId}_${l.id}`, fgMaskKey(sceneId, l.id)) : null;
        // A2.17 fase 4: con `bandStep`, una imagen por franja (la misma textura recortada a sus filas), cada una a la
        // profundidad de su base: el trozo tapa a Dex siempre lo mismo por encima de sus pies (maleza alta)
        const bands = foregroundBands(l);
        bands.forEach((band, k) => {
          const f0 = (band.top - l.bounds.y) / l.bounds.h;
          const f1 = (band.bottom - l.bounds.y) / l.bounds.h;
          const rows = { y: Math.round(f0 * r.h), h: Math.round(f1 * r.h) - Math.round(f0 * r.h) };
          if (rows.h <= 0) return;
          let img: Phaser.GameObjects.Image;
          let bounds: PctRect | undefined;
          if (piece) {
            img = this.add.image(0, 0, piece).setOrigin(0, 0).setCrop(0, rows.y, r.w, rows.h);
            bounds = l.bounds;
          } else {
            img = this.add.image(0, 0, fgKey).setOrigin(0, 0).setCrop(r.x, r.y + rows.y, r.w, rows.h);
            bounds = undefined;
          }
          this.placeOverlay(img, bounds);
          img.setDepth(actorDepth(band.baseY));
          this.fgLayers.push({ img, bounds, id: l.id, band: bands.length > 1 ? k : undefined });
        });
      }
    }


    // Conditional overlays — sprites shown/hidden based on game flags
    this.conditionalOverlays = [];
    const overlayConfigs = sceneData.conditionalOverlays ?? [];
    for (const co of overlayConfigs) {
      const key = `overlay_${sceneId}_${co.id}`;
      if (this.textures.exists(key)) {
        const overlay = this.add.image(0, 0, key).setOrigin(0, 0);
        this.placeOverlay(overlay, co.bounds);
        overlay.setDepth(co.depth ?? 12);
        const flagVal = this.gameState.flags[co.flag] ?? false;
        const show = co.invert ? !flagVal : flagVal;
        overlay.setVisible(show);
        this.conditionalOverlays.push({ id: co.id, sprite: overlay, flag: co.flag, invert: co.invert, bounds: co.bounds });
      }
    }

    // P1: Dex sentado (treatment_room, flag patient_seated). La escena sigue con hidePlayer: es solo una imagen del rig
    this.seatedDex = null;
    const seat = sceneData.player.seated;
    if (seat && this.textures.exists('dex2d_sit_0')) {
      const img = this.add.image(0, 0, 'dex2d_sit_0').setOrigin(0.5, 1).setDepth(seat.depth ?? 12).setVisible(false);
      this.seatedDex = { img, flag: seat.flag, x: seat.x, y: seat.y };
      this.placeSeatedDex();
    }

    // A4.3: animación ambiental declarada en scene.json (`ambient[]`): polillas, polvo, LEDs, niebla, nubes, luces… Sin
    // assets: Graphics y una textura radial generada. Con ?qa=1 las semillas son fijas (como la vida de las NPC)
    const qaMode = new URLSearchParams(window.location.search).get('qa') === '1';
    this.ambient?.destroy();
    this.ambient = new AmbientLayer(this, sceneData.ambient, sceneId, {
      coords: this.coordSystem,
      fg: this.fg,
      getFlag: (flag) => this.gameState.flags[flag] ?? false,
      hasItem: (id) => this.inventorySystem.hasItem(id),
      qa: qaMode,
    });

    // Camera setup based on orientation
    this.setupCamera();
    // A2.10: director de cinemáticas de esta escena (las NPC se le dan por función: se crean más abajo)
    this.cinema?.destroy();
    this.cinema = new CinematicDirector(this.cinematicHost());
    // A2.7: si no, fundido corto entre escenas (PreloadScene deja `fadeInMs`; 400 ms al arrancar)
    // A2.10: la escena entra con la transición con la que salió la anterior (fadeToScene con `transition`)
    const transitionIn = this.registry.get('transitionIn') as TransitionSpec | undefined;
    this.registry.remove('transitionIn');
    if (transitionIn && !this.isTrailer) void this.cinema.transitionIn(transitionIn);
    else if (!this.isTrailer) this.cameras.main.fadeIn((this.registry.get('fadeInMs') as number | undefined) ?? FADE_FIRST_MS, 0, 0, 0);

    // Cinematic overlay (full-screen story moments)
    this.cinematicOverlay = new CinematicOverlay(this);
    this.transactionToast = new TransactionToast(this);

    // If scene has onEnter scripts, show black cover immediately to prevent scene flash
    if (sceneData.onEnter?.length && !this.isTrailer) {
      this.cinematicOverlay.showBlackCover();
    }

    // Script engine
    this.scriptEngine = new ScriptEngine(this.buildScriptContext());
    this.dialogueScripts = new DialogueScriptRunner(new ScriptEngine(this.buildScriptContext()), () => this.buildScriptContext());

    // Input — disabled in trailer mode
    this.lastClick = null;
    if (!this.isTrailer) {
      this.input.on('pointerdown', this.handlePointerDown, this);
      this.input.on('pointermove', this.handlePointerMove, this);
      // A2.4: teclado (verbos, Tab, Esc, I) y clic derecho sin menú contextual en el lienzo
      this.bindDesktopInput();
    }

    // Execute pending verb when player arrives at hotspot
    // A0.1: los eventos de la escena sobreviven al reinicio; sin quitar el anterior se acumulaba uno por escena
    this.events.removeAllListeners('player:arrived');
    this.pending = null;
    this.lastApproach = null;
    this.deferredTap = null;
    this.events.on('player:arrived', () => {
      const pending = this.pending;
      // A1.14: con el dedo no hay hover que refresque la línea de acción: al llegar queda limpia
      if (!pending && this.lastInputTouch) this.events.emit('hotspot:hover', null);
      if (!pending) return;
      this.pending = null;
      // Algo tomó el control mientras andaba: no se actúa
      if (this.scriptEngine.isRunning() || this.registry.get('dialogueActive')) return;
      // A2.2: se gira hacia el objetivo antes de actuar
      if (pending.face) this.player.face(pending.face);
      this.noteQaAction();
      // A4.1: gesto de alcanzar o coger a la vez que arranca el script (no lo retrasa)
      this.startGesture(pending.verb, pending.aim);
      pending.run();
    });

    // Costume: Player.update() reads ape_costume_worn flag directly from gameState

    // Audio — MusicManager persists across scenes (singleton on game.registry)
    this.musicManager = this.game.registry.get('musicManager') as MusicManager;
    this.musicManager.transitionToScene(sceneData.audio);

    // A4.4: pasos según la superficie bajo los pies (audio.footstep / audio.surfaces); el mismo listener único que
    // player:arrived (los eventos de la escena sobreviven al reinicio)
    this.events.removeAllListeners('player:footstep');
    this.lastFootstep = null;
    this.events.on('player:footstep', (step: { x: number; y: number; foot: 0 | 1; depth: number }) => {
      if (this.isTrailer) return;
      const surface = surfaceAt(sceneData.audio, step.x, step.y);
      this.lastFootstep = { surface, key: null, at: Math.round(performance.now()) };
      if (!surface) return;
      const sound = stepSound(surface, step.foot, Math.random(), step.depth);
      this.lastFootstep.key = sound.key;
      sfxOf(this)?.play(sound.key, { volume: sound.volume, detune: sound.detune });
    });

    // NPCs
    this.npcs = [];
    this.lifeClock = 0;
    // V6: estado de las pistas por inactividad (por escena)
    this.touchedHotspots = new Set<string>();
    this.progressSig = '';
    this.lastProgressAt = Date.now();
    this.lastHintAt = 0;
    if (sceneData.npcs) {
      for (const nd of sceneData.npcs) {
        const npcScreen = this.coordSystem.pctToScreen(nd.position.x, nd.position.y);
        const npc = new NPC(this, npcScreen.x, npcScreen.y, nd.id, nd.name, nd.dialogueTreeId, nd.color ? parseInt(nd.color, 16) : undefined);
        // A2.8: misma unidad de píxel que el jugador (× artScale de la hoja); el `scale` a mano antiguo se ignora
        npc.artScale = nd.artScale ?? 1;
        npc.pctPosition = { x: nd.position.x, y: nd.position.y }; // store for resize repositioning
        npc.setScale(this.npcPixelScale(npc));
        // A2.12: delante o detrás del jugador según la y de los pies
        npc.setDepth(actorDepth(nd.position.y));
        // A4.2: respira, parpadea, se gira hacia el jugador y mueve la boca con la voz (semilla fija con ?qa=1)
        npc.startLife(lifeSeed(nd.id, qaMode, Math.random()), defaultFacing(nd.facing));
        this.npcs.push(npc);
      }
    }

    // A2.8: el arte de la escena (fondo, primer plano, overlays, sprites web3) se filtra en lineal; los personajes,
    // en nearest (pixelArt). Ver applySceneArtFilter.
    this.applySceneArtFilter(sceneId, sceneData);

    // Web3 dynamic visuals (conditional sprites based on wallet/NFT state)
    if (WEB3_ENABLED && sceneData.web3Visuals?.length) {
      this.web3VisualSystem = new Web3VisualSystem(this, this.coordSystem, sceneData.web3Visuals);
    }

    // Camera post-processing effect (e.g., anaglyph for MemeLAB)
    this.activeCameraEffect = null;
    const cameraEffect = sceneData.cameraEffect;
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
    const uiEvents = this.scene.get('UIScene').events;
    uiEvents.removeAllListeners('panel:toggled');
    uiEvents.on('panel:toggled', this.handleResize, this);

    if (!this.isTrailer) {
      this.showSceneTitle(sceneData.title);
      this.gameState.savedAt = Date.now();
      this.gameState.playerPosition = { pctX: spawn.x, pctY: spawn.y };
      // A1.12: «AUTOSAVED» solo si el autoguardado se pudo releer
      this.autosaveOk = this.saveSystem.autoSave(this.gameState, sceneData.title);
      this.time.addEvent({ delay: 5000, loop: true, callback: () => this.checkIdleHint() });
    }

    // A1.1: un solo watchdog para todos los scripts (hotspots, combos, onEnter y triggers). Va con el reloj de
    // Phaser: con la pestaña oculta no avanza, y mientras hay algo en pantalla para el jugador no cuenta.
    this.time.addEvent({
      delay: GameScene.WATCHDOG_TICK_MS,
      loop: true,
      callback: () => {
        if (this.scriptEngine.watchdogTick(GameScene.WATCHDOG_TICK_MS, this.isPresentingToPlayer())) {
          this.inputCooldownFrames = 2;
        }
        // A1.9: el árbol abierto no cuenta como «en pantalla» para su propio onEnter; el texto o la elección sí
        this.dialogueScripts.watchdogTick(GameScene.WATCHDOG_TICK_MS, this.isPresentingToPlayer(false));
      },
    });

    if (!this.isTrailer) {
      // V6: aviso de autoguardado; si la escena abre con cinemática, se enseña al terminarla
      if (!sceneData.onEnter?.length) this.showAutosaveIndicator();
    }

    // Run scene onEnter scripts (chapter intros, premise, etc.) — skipped in trailer
    if (sceneData.onEnter?.length && !this.isTrailer) {
      this.time.delayedCall(100, () => {
        this.scriptEngine.updateContext(this.buildScriptContext());
        this.scriptEngine.execute(sceneData.onEnter!, `${sceneId}/onEnter`).then(() => {
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

    // Resize listeners. A1.10: el ScaleManager es del juego, no de la escena: con referencia para quitarlo en shutdown
    this.scale.off('resize', this.handleResize, this);
    this.scale.on('resize', this.handleResize, this);

    // iOS Safari: visualViewport is more reliable than Phaser's scale manager
    // Store bound reference so we can remove listeners on shutdown
    this.removeViewportListeners();
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
    // A9.4: tiempo jugado (con tope por fotograma: una pestaña oculta o una pausa del navegador no suman)
    if (!this.isTrailer && this.gameState) this.gameState.playTimeMs = addPlayTime(this.gameState.playTimeMs, delta);
    this.player.setAnimContext(this.playerAnimContext());
    this.player.update(time, delta);
    const lifeDt = this.lifeClock ? Math.min(250, Math.max(0, time - this.lifeClock)) : delta;
    this.lifeClock = time;
    this.updateNpcLife(lifeDt);
    // A2.12: orden por la y de los pies (una cinemática puede mover a la NPC)
    for (const npc of this.npcs) {
      const d = actorDepth(npc.pctPosition?.y ?? 100);
      if (npc.depth !== d) npc.setDepth(d);
    }
    // A4.3: la animación ambiental sigue el mismo reloj real (y el scroll de la cámara, para el parallax de nubes y niebla)
    this.ambient?.update(lifeDt, this.cameras.main.scrollX);

    // Refresh conditional overlays when flags change (A1.4: un flicker en marcha manda sobre la flag)
    for (const co of this.conditionalOverlays) {
      const flagVal = this.gameState.flags[co.flag] ?? false;
      const show = this.overlayOverrides.get(co.id) ?? (co.invert ? !flagVal : flagVal);
      if (co.sprite.visible !== show) co.sprite.setVisible(show);
    }
    if (this.seatedDex) {
      const sd = this.seatedDex;
      const show = (this.gameState.flags[sd.flag] ?? false) && this.player.getCostume() === 'player';
      if (sd.img.visible !== show) sd.img.setVisible(show);
      // habla: boca y mano arriba en fotogramas alternos de 140 ms (como talk_r del rig)
      const talking = show && this.playerAnimContext().talking && Math.floor(this.time.now / 140) % 2 === 1;
      const key = talking && this.textures.exists('dex2d_sit_talk_0') ? 'dex2d_sit_talk_0' : 'dex2d_sit_0';
      if (sd.img.texture.key !== key) sd.img.setTexture(key);
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
    // A1.14: el toque que saltó una frase se ejecuta en cuanto no hay nada que lo bloquee
    if (this.deferredTap) this.tickDeferredTap();

    // Walk-through trigger detection — disabled in trailer mode. A2.1: Player también la llama tras cada tramo del
    // camino (onStep), así que un frame largo no se salta un trigger estrecho
    this.checkWalkTriggers();
  }

  /** Trigger que pisa el personaje andando: lo marca, para al personaje y ejecuta su onEnter. true si saltó uno. */
  private checkWalkTriggers(): boolean {
    if (!this.player.isMoving() || this.scriptEngine.isRunning() || this.isTrailer) return false;
    const sceneData = this.registry.get('sceneData') as SceneData | undefined;
    if (!sceneData) return false;
    for (const tr of sceneData.regions.triggers) {
      if (!tr.bounds) continue;
      if (tr.once && this.firedTriggers.has(tr.id)) continue;
      // Check trigger gate synchronously (uses cache, skips if not cached yet)
      if (tr.gate) {
        const address = gateAddress();
        if (!address) continue;
        const gateResult = checkGatingRuleCached(address as Address, tr.gate as GatingRule);
        if (gateResult === null || gateResult === false) continue;
      }
      const b = tr.bounds;
      if (this.player.pctX >= b.x && this.player.pctX <= b.x + b.w &&
          this.player.pctY >= b.y && this.player.pctY <= b.y + b.h) {
        this.firedTriggers.add(tr.id);
        this.persistFiredTriggers();
        // A2.2: si iba a usar algo (no andar sin más), el trigger lo para igual; al acabar su script, si sigue en la
        // escena y nadie le ha dado otra orden, retoma el camino y actúa al llegar (el trigger ya disparó)
        const pending = this.pending;
        const resumeTo = pending && this.lastApproach?.walkTo ? { ...this.lastApproach.walkTo } : null;
        const run = this.sceneRun;
        this.player.halt();
        this.pending = null;
        void this.scriptEngine.execute(tr.onEnter, `${tr.id}/onEnter`).finally(() => {
          if (!pending || !resumeTo || run !== this.sceneRun || this.pending || this.player.isMoving()) return;
          if (this.registry.get('sceneTransition') || this.registry.get('dialogueActive')) return;
          this.pending = pending;
          this.player.walkToPct(resumeTo.x, resumeTo.y);
        });
        return true;
      }
    }
    return false;
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
    // A2.9: con el diario abierto el HTML tapa el lienzo; por si acaso, la escena no recibe toques
    if (this.registry.get('journalOpen') || this.registry.get('dashboardOpen')) return;
    // A2.10: un toque en cinemática enseña cómo saltarla (mantener pulsado; con ratón, también Esc)
    if (this.cinema?.isActive()) this.cinema.noteTap(pointer.wasTouch);
    const blocked = this.scriptEngine.isRunning() || !!this.registry.get('dialogueActive') || !!this.registry.get('dialogueShowing');
    if (blocked) this.beginFastForwardHold(pointer);
    // A1.14: un toque durante una frase suelta (no cinemática ni diálogo) la salta Y se ejecuta en cuanto el juego
    // queda libre (antes se «gastaba» en cerrarla, o se perdía del todo antes del tiempo mínimo de lectura). En
    // cinemáticas, árboles de diálogo y elecciones sigue siendo solo «siguiente».
    const dismissedAt = this.registry.get('dialogueDismissedAt') as number | undefined;
    const policy = textTapPolicy({
      textShowing: !!this.registry.get('dialogueShowing'),
      justDismissed: dismissedAt !== undefined && this.time.now - dismissedAt < 50,
      cinematic: this.isCinematicNow(),
      dialogueActive: !!this.registry.get('dialogueActive'),
      awaitingChoice: this.awaitingChoice(),
      scriptRunning: this.scriptEngine.isRunning(),
    });
    if (policy === 'skip-and-execute') {
      if (this.registry.get('dialogueShowing')) this.skipBark();
      this.deferredTap = { wx: pointer.worldX, wy: pointer.worldY, sy: pointer.y, touch: pointer.wasTouch, button: pointer.button, at: this.time.now };
      return;
    }
    if (policy === 'skip-only') return;
    if (this.inputCooldownFrames > 0) return;
    this.deferredTap = null;
    this.executeTap(pointer.worldX, pointer.worldY, pointer.y, pointer.wasTouch, pointer.button, pointer);
  }

  /** A1.14: cinemática en marcha (modo cine, overlay o director): ahí un toque solo avanza. */
  private isCinematicNow(): boolean {
    return !!this.registry.get('cinematicMode') || ((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0
      || !!this.cinema?.isActive();
  }

  /** A1.14: cierra la frase en pantalla (UIScene/DialogueBox), sin esperar al tiempo mínimo de lectura. */
  private skipBark(): void {
    if (!this.scene.isActive('UIScene')) return;
    (this.scene.get('UIScene') as UIScene).skipBark?.();
  }

  /** A1.14: ejecuta el toque guardado al saltar una frase cuando el juego queda libre (o lo descarta). */
  private tickDeferredTap(): void {
    const t = this.deferredTap;
    if (!t) return;
    const verdict = deferredTapVerdict({
      textShowing: !!this.registry.get('dialogueShowing'),
      scriptRunning: this.scriptEngine.isRunning(),
      dialogueActive: !!this.registry.get('dialogueActive') || this.awaitingChoice(),
      cinematic: this.isCinematicNow(),
      sceneChanging: !!this.registry.get('sceneTransition') || !!this.registry.get('journalOpen'),
    }, this.time.now - t.at);
    if (verdict === 'wait') return;
    this.deferredTap = null;
    if (verdict === 'run') this.executeTap(t.wx, t.wy, t.sy, t.touch, t.button, null);
  }

  /**
   * El toque ya admitido (nada que lo bloquee). `pointer` solo si el dedo sigue siendo el de este toque (para
   * mantener pulsado); un toque diferido tras saltar una frase llega sin él y se trata como un toque corto.
   */
  private executeTap(wx: number, wy: number, sy: number, touch: boolean, button: number, pointer: Phaser.Input.Pointer | null): void {
    this.lastInputTouch = touch;
    const hit = this.hitTestAt(wx, wy, sy, touch);
    if (hit.kind === 'none') return;

    // A2.4: clic derecho (solo ratón) = verbo por defecto del hotspot o NPC, sin mirar el panel
    if (!touch && button === 2) {
      this.lastClick = null;
      this.rightClickHit(hit);
      return;
    }

    // Get current verb and selected item from UI (needed for NPC item interactions)
    const { scummUI, verb, selectedItem } = this.uiSelection();

    if (hit.kind === 'npc') {
      this.lastClick = null;
      this.dispatchNpcTap(hit.npc, verb, selectedItem, scummUI);
      return;
    }

    const { pct, hotspot } = hit;
    if (hotspot) this.flashHotspot(hotspot);
    if (hotspot) this.events.emit('hotspot:focus', hotspot);

    // V6 + A1.14: con el dedo y sin verbo elegido, tocar un hotspot = ANDAR hacia él (antes era mirar sin andar) y
    // mantener pulsado = acción principal
    const action = decideTap({ verb, target: hotspot ? 'hotspot' : 'floor', hasItem: !!selectedItem, touch });
    if (action === 'hold-or-walk' && hotspot) {
      if (pointer?.isDown) this.beginTouchHold(pointer, hotspot, pct);
      else this.walkToHotspot(hotspot, pct);
      return;
    }

    this.leftClickScene(pct, hotspot, !touch);
  }

  /**
   * Clic izquierdo (o toque) en la escena ya resuelto, con el verbo y el objeto del panel. A2.4: con el ratón, el
   * segundo clic de un doble clic sobre una salida la cruza al momento (`runExitNow`); en cualquier otro hotspot el
   * doble clic es un clic más.
   */
  private leftClickScene(pct: { x: number; y: number }, hotspot: HotspotData | null, mouse: boolean): void {
    const { scummUI, verb, selectedItem } = this.uiSelection();
    if (mouse) {
      const now = performance.now();
      const id = hotspot?.id ?? null;
      const second = isDoubleClick(this.lastClick, id, now);
      this.lastClick = id && !second ? { id, at: now } : null;
      if (second && hotspot && !selectedItem && this.runExitNow(hotspot)) return;
    }
    this.dispatchTap(pct, hotspot, verb, selectedItem, scummUI);
  }

  /**
   * A2.4: clic derecho. NPC → TALK; hotspot → su verbo por defecto (`defaultVerbFor`: el que hace algo de verdad, o
   * LOOK); fondo → andar. No cambia el verbo elegido en el panel. A2.18: con un objeto elegido (frase a medias) solo la cancela.
   */
  private rightClickHit(hit: Exclude<TapHit, { kind: 'none' }>): void {
    // A2.18: con una frase a medias («Give X to …») el clic derecho solo la cancela, como SCUMM
    const { scummUI, selectedItem } = this.uiSelection();
    if (selectedItem) {
      scummUI?.resetSelection?.();
      scummUI?.setHoveredObject?.(null);
      return;
    }
    if (hit.kind === 'npc') {
      this.dispatchNpcTap(hit.npc, Verb.TALK, null, undefined);
      return;
    }
    const { pct, hotspot } = hit;
    if (!hotspot) {
      this.dispatchTap(pct, null, Verb.WALK, null, undefined);
      return;
    }
    this.flashHotspot(hotspot);
    this.events.emit('hotspot:focus', hotspot);
    this.runHotspotVerb(hotspot, defaultVerbFor(hotspot) as Verb);
  }

  /**
   * A2.4: doble clic en una salida. Sin andar: se para donde esté y ejecuta al momento el script de salida (su verbo
   * por defecto, si cambia de escena), con su transición. Devuelve false si el hotspot no es una salida.
   */
  private runExitNow(hotspot: HotspotData): boolean {
    const exitVerb = exitVerbFor(hotspot);
    if (!exitVerb) return false;
    const verb = exitVerb as Verb;
    this.flashHotspot(hotspot);
    this.approachAndRun(hotspot.id, verb, { walkTo: null, face: null, aim: null }, () => this.events.emit('hotspot:tapped', hotspot, verb));
    return true;
  }

  /**
   * Qué recibe un toque en ese punto (coordenadas de mundo e Y de pantalla), con las reglas del clic real:
   * el panel SCUMM y lo que cae fuera del fondo no cuentan; los NPC con diálogo van antes que los hotspots
   * (hitbox del sprite); manda el primer hotspot de la lista que contiene el punto, y si está oculto el
   * punto se queda sin hotspot. Con el dedo, 22 px de margen alrededor de cada hotspot (V6).
   * A0.1: la API de QA resuelve sus toques aquí, así que no puede pulsar lo que el ratón no alcanza.
   */
  private hitTestAt(wx: number, wy: number, screenY: number, wasTouch: boolean): TapHit {
    // Panel check uses SCREEN Y (panel is fixed to bottom of screen)
    if (screenY >= this.scale.height - this.getEffectivePanelHeight()) return { kind: 'none', reason: 'el panel de verbos' };
    // A0.5: los botones de UIScene (Save, Wallet) se quedan el clic antes que la escena (Phaser entrega el toque solo a
    // la escena de arriba). Para un clic real esto ya no llega aquí; la API de QA lo necesita para no pulsar debajo.
    const uiButton = this.uiButtonAt(wx - this.cameras.main.scrollX, screenY);
    if (uiButton) return { kind: 'none', reason: uiButton };
    // Game area check uses WORLD coords (accounts for camera scroll)
    if (!this.coordSystem.isInBgArea(wx, wy)) return { kind: 'none', reason: 'fuera del fondo' };

    // NPC click detection — use actual sprite bounds for accurate hit testing
    for (const npc of this.npcs) {
      if (!npc.dialogueTreeId) continue;
      if (this.npcHit(npc, wx, wy)) return { kind: 'npc', npc };
    }

    const pct = this.coordSystem.screenToPct(wx, wy);
    const rawHotspot = this.sceneDataLoader.getHotspotAtPct(pct.x, pct.y);
    let hotspot = rawHotspot && this.isHotspotVisible(rawHotspot) ? rawHotspot : null;
    if (!hotspot && wasTouch) {
      const pad = this.touchPadPct();
      hotspot = this.sceneDataLoader.getHotspotNearPct(pct.x, pct.y, pad.x, pad.y, (hs) => this.isHotspotVisible(hs));
    }
    return { kind: 'scene', pct, hotspot, rawHotspot };
  }

  /** Botón interactivo de UIScene bajo ese punto de pantalla (Save, Wallet), o null. */
  private uiButtonAt(screenX: number, screenY: number): string | null {
    if (!this.scene.isActive('UIScene')) return null;
    const ui = this.scene.get('UIScene') as unknown as UIScene;
    return ui.uiButtonAt?.(screenX, screenY) ?? null;
  }

  /** Verbo y objeto elegidos en el panel SCUMM (WALK y ninguno si el panel aún no existe). */
  private uiSelection(): { scummUI: ScummUI | undefined; verb: Verb; selectedItem: InventoryItem | null } {
    const uiScene = this.scene.get('UIScene') as Phaser.Scene;
    const scummUI = (uiScene as unknown as { scummUI?: ScummUI }).scummUI;
    return {
      scummUI,
      verb: scummUI?.getSelectedVerb?.() ?? Verb.WALK,
      selectedItem: scummUI?.getSelectedItem?.() ?? null,
    };
  }

  /**
   * Toque sobre un NPC ya localizado: dar o usar el objeto elegido, o empezar su diálogo. A2.2: antes anda hasta la
   * distancia de conversación y se gira hacia él; con LOOK solo se gira.
   */
  private dispatchNpcTap(npc: NPC, verb: Verb, selectedItem: InventoryItem | null, scummUI: ScummUI | undefined): void {
    const sceneData = this.registry.get('sceneData') as SceneData;
    const npcData = sceneData.npcs?.find(n => n.id === npc.npcId);
    const target: ApproachTarget = { position: npc.pctPosition ?? undefined, walkTo: npcData?.walkTo, face: npcData?.face };
    const plan: Approach = verb === Verb.LOOK
      ? { walkTo: null, face: lookFacing(target, this.playerPct(), this.facingOpts()), aim: null }
      : approachTalk(target, this.playerPct(), this.reachPct, this.facingOpts());
    // A4.2: va a hablarle o a darle/usar algo con ella: se gira hacia el jugador mientras se acerca y dura la charla
    if (verb !== Verb.LOOK) npc.engage();
    // GIVE/USE item on NPC — show fun response instead of dialogue
    if (selectedItem && (verb === Verb.USE || verb === Verb.GIVE)) {
      scummUI?.clearSelectedItem?.();
      // A2.6: la NPC reacciona a ese objeto con un árbol (o un nodo de su árbol) en vez de una frase suelta
      const itemDialogue = npcData?.itemDialogues?.[selectedItem.id];
      const itemTree = itemDialogue ? (itemDialogue.tree ?? npc.dialogueTreeId) : null;
      if (itemDialogue && itemTree && sceneData.dialogues?.[itemTree]) {
        // A2.2: también se acerca y se gira antes de enseñar el objeto
        this.approachAndRun(npc.npcId, verb, plan, () => {
          if (itemDialogue.setFlag) {
            this.gameState = { ...this.gameState, flags: { ...this.gameState.flags, [itemDialogue.setFlag]: true } };
            this.registry.set('gameState', this.gameState);
          }
          this.events.emit('npc:tapped', npc.npcId, itemTree, itemDialogue.node);
        });
        this.afterVerbAction(scummUI);
        return;
      }
      // A2.5: pareja específica > _default de la NPC > bolsa del objeto > bolsa genérica (src/systems/FailResponses.ts)
      const npcVerb = verb === Verb.GIVE ? 'GIVE' : 'USE';
      const responses = npcVerb === 'GIVE' ? npcData?.giveResponses : npcData?.useResponses;
      // A2.18: con GIVE, la frase propia del objeto (Dex se niega a darlo) va tras la pareja específica de la NPC
      const own = npcVerb === 'GIVE' ? ScummUI.giveLine(selectedItem.id) : null;
      const r = failResponses.itemOnNpc(npcVerb, selectedItem.id, { id: npc.npcId, responses }, this.currentSceneId(), own);
      // A2.18: lo del mapa de la NPC lo dice ella; las bolsas generales y la negativa propia del objeto, Dex
      const speaker = isNpcBag(r.bag) ? npc.npcName : undefined;
      this.approachAndRun(npc.npcId, verb, plan, () => this.scene.get('UIScene').events.emit('say', r.text, speaker));
      this.afterVerbAction(scummUI);
      return;
    }
    this.approachAndRun(npc.npcId, verb, plan, () => this.events.emit('npc:tapped', npc.npcId, npc.dialogueTreeId));
    this.afterVerbAction(scummUI);
  }

  // ─── A2.2: acercarse y mirar hacia el objetivo ───

  /** A2.5: id de la escena cargada (las bolsas de fallo de un hotspot se identifican por escena + id) */
  private currentSceneId(): string {
    return (this.registry.get('currentSceneId') as string | undefined) ?? '';
  }

  private playerPct(): { x: number; y: number } {
    return { x: this.player.pctX, y: this.player.pctY };
  }

  /** Reach de Facing: punto alcanzable más cercano desde el jugador, o null si está en otra isla */
  private reachPct = (p: { x: number; y: number }) => this.player.approachPct(p);

  /** Proporción del fondo y altura del personaje en %, para decidir si algo está por encima de la cabeza o a los pies */
  private facingOpts(): FacingOptions {
    const bgH = this.coordSystem.bgH;
    return {
      aspect: this.coordSystem.imgW / this.coordSystem.imgH,
      // A2.8: altura del mundo (unidad de píxel × profundidad), no la de pantalla: no depende del tamaño de la ventana
      playerHeight: bgH > 0 ? this.player.getWorldHeightPct() : undefined,
    };
  }

  /** Plan para un verbo sobre un hotspot: LOOK solo gira; TALK, a distancia de conversación; el resto, a su walkTo. */
  private planHotspot(hotspot: HotspotData, verb: Verb): Approach {
    const player = this.playerPct();
    if (verb === Verb.LOOK) return { walkTo: null, face: lookFacing(hotspot, player, this.facingOpts()), aim: null };
    if (verb === Verb.TALK) return approachTalk(hotspot, player, this.reachPct, this.facingOpts());
    return approachHotspot(hotspot, player, this.reachPct, this.facingOpts());
  }

  /**
   * Con punto de llegada, anda hasta él y al llegar (player:arrived) se gira y ejecuta `run`. Sin él (LOOK, ya está
   * allí, sin bounds o en otra isla), se para si andaba, se gira y ejecuta al momento.
   */
  private approachAndRun(id: string, verb: Verb, plan: Approach, run: () => void): void {
    this.lastApproach = { target: id, verb, walkTo: plan.walkTo ? { ...plan.walkTo } : null, face: plan.face };
    if (plan.walkTo) {
      this.pending = { face: plan.face, run, verb, aim: plan.aim ? { ...plan.aim } : null };
      this.player.walkToPct(plan.walkTo.x, plan.walkTo.y);
      return;
    }
    this.pending = null;
    if (this.player.isMoving()) this.player.halt();
    if (plan.face) this.player.face(plan.face);
    this.noteQaAction();
    this.startGesture(verb, plan.aim);
    run();
  }

  /**
   * A4.1: gesto breve del jugador (≈ 320 ms, PlayerAnim.gesturePose) al actuar con PICK/USE/OPEN/CLOSE/PUSH/PULL/GIVE
   * sobre algo con posición (sin `aim`, p. ej. el doble clic en una salida, no hay gesto). No espera: el script
   * arranca a la vez.
   */
  private startGesture(verb: Verb, aim: { x: number; y: number } | null): void {
    if (!aim || this.isTrailer || !wantsGesture(verb)) return;
    const dx = aim.x - this.player.pctX;
    // A2.15: altura del objetivo sobre los pies en altos de Dex (coger del suelo, a media altura o en alto)
    const h = this.player.getWorldHeightPct();
    const level = pickLevel(h > 0 ? (this.player.pctY - aim.y) / h : null);
    this.player.gesture(Math.abs(dx) < 0.5 ? null : dx > 0 ? 'right' : 'left', level);
  }

  /**
   * A4.1: lo que la animación del jugador necesita saber de la escena: si tiene texto en pantalla (UIScene, A2.3:
   * speaker vacío o del jugador) y si la escena está libre para un tic de reposo.
   */
  private playerAnimContext(): { talking: boolean; idleFree: boolean; voiceLevel: number | null } {
    const ui = this.scene.isActive('UIScene') ? (this.scene.get('UIScene') as UIScene) : null;
    const speech = ui?.getSpeech() ?? null;
    const talking = speech?.kind === 'player';
    // A2.16: nivel de la voz del jugador (mandíbula del «Dex de papel»); null si no suena su clip o no se puede medir
    let voiceLevel: number | null = null;
    if (talking && this.player?.isPaper()) {
      const voice = this.registry.get('voiceSystem') as VoiceSystem | undefined;
      const clip = voice?.clipInfo();
      if (clip?.playing && clip.text === speech?.text) voiceLevel = voice?.level() ?? null;
    }
    const idleFree = !this.isTrailer && !this.scriptEngine?.isRunning()
      && !this.registry.get('dialogueActive') && !this.registry.get('dialogueShowing')
      && !this.registry.get('cinematicMode') && !this.registry.get('journalOpen');
    return { talking, idleFree, voiceLevel };
  }

  /**
   * A4.2: un frame de vida de cada NPC (NpcLife): quién tiene su texto en pantalla (A2.3: speaker = su nombre o su id),
   * el clip de voz de esa frase (VoiceSystem: sonando, descargándose, ya sonó o sin voz; y el nivel de señal si hay
   * analizador), dónde está el jugador (para girarse) y si la conversación sigue en marcha.
   */
  private updateNpcLife(delta: number): void {
    if (!this.npcs.length) return;
    const ui = this.scene.isActive('UIScene') ? (this.scene.get('UIScene') as UIScene) : null;
    const speech = ui?.getSpeech() ?? null;
    const voice = this.registry.get('voiceSystem') as VoiceSystem | undefined;
    const clip = voice?.clipInfo();
    const busy = !!this.pending || !!this.registry.get('dialogueActive') || !!this.registry.get('dialogueShowing')
      || !!this.scriptEngine?.isRunning();
    const cinematic = !!this.registry.get('cinematicMode');
    const p = this.player;
    const playerX = p?.active && p.visible ? p.x : null;
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const who = speech?.kind === 'npc' ? (speech.speaker ?? '').trim().toLowerCase() : '';
      const line = speech && who !== '' && (who === npc.npcId.toLowerCase() || who === npc.npcName.toLowerCase()) ? speech.text : null;
      const talking = line !== null;
      let state: VoiceState = 'none';
      let level: number | null = null;
      if (line !== null && clip && clip.text === line) {
        if (clip.playing) {
          state = 'playing';
          level = voice?.level() ?? null;
        } else if (clip.loading) state = 'loading';
        else if (clip.durationMs !== null) state = 'done';
      }
      npc.updateLife(delta, { playerX, talking, line: line ?? '', voice: state, level, busy, cinematic });
    }
  }

  /** A4.2 (QA): vida de cada NPC de la escena (respiración, parpadeos, boca, giro, última conversación) */
  qaNpcLife(): NpcLifeQa[] {
    return this.npcs.filter((n) => n.active).map((n) => n.getLifeState());
  }

  /** A4.3 (QA): elementos de animación ambiental de la escena (condición, forzado, cosas dibujadas, firma del frame) */
  qaAmbient(): AmbientQa[] {
    return this.ambient?.qaState() ?? [];
  }

  /** A5.1 (QA): tamaño lógico de la escena (el de las coordenadas en %) y tamaño real de la textura del fondo */
  qaSceneArt(): { world: { w: number; h: number }; bgTexture: { w: number; h: number } } {
    const src = this.bg.texture.getSourceImage() as { width: number; height: number };
    return { world: { w: this.coordSystem.imgW, h: this.coordSystem.imgH }, bgTexture: { w: src.width, h: src.height } };
  }

  /**
   * Toque en la escena ya resuelto (punto en % y hotspot visible bajo él, si hay): combo con el objeto
   * elegido, andar, mirar/hablar al momento o ir hasta el hotspot y actuar al llegar. A0.1: la API de QA
   * entra por aquí, así que un clic real y una prueba siguen exactamente el mismo camino.
   */
  private dispatchTap(
    pct: { x: number; y: number },
    hotspot: HotspotData | null,
    verb: Verb,
    selectedItem: InventoryItem | null,
    scummUI: ScummUI | undefined,
  ): void {
    // A2.18: GIVE [item] to [hotspot]: un hotspot no es una persona (va hasta él y Dex lo dice; nunca dispara un combo de USE)
    if (selectedItem && hotspot && verb === Verb.GIVE) {
      const item = selectedItem;
      const hs = hotspot;
      scummUI?.clearSelectedItem?.();
      this.approachAndRun(hs.id, Verb.GIVE, this.planHotspot(hs, Verb.GIVE), () => {
        this.scene.get('UIScene').events.emit('say', failResponses.itemGive(item.id, hs.id).text);
      });
      this.afterVerbAction(scummUI);
      return;
    }

    // Item combo mode: USE [item] with [hotspot]
    if (selectedItem && hotspot) {
      const item = selectedItem;
      const hs = hotspot;
      scummUI?.clearSelectedItem?.();
      const sceneData = this.registry.get('sceneData') as SceneData;
      const combo = sceneData.combos?.find(
        (c: { items: string[] }) => c.items.includes(item.id) && c.items.includes(hs.id)
      );
      // A2.2: USE objeto con hotspot también va hasta él y se gira antes
      this.approachAndRun(hs.id, Verb.USE, this.planHotspot(hs, Verb.USE), () => {
        if (combo) {
          this.runScript(combo.script, `combo ${item.id}+${hs.id}`);
        } else {
          // A2.5: pareja específica del hotspot > su _default > bolsa del objeto > bolsa genérica
          this.scene.get('UIScene').events.emit('say', failResponses.itemOnHotspot(item.id, hs, this.currentSceneId()).text);
        }
      });
      this.afterVerbAction(scummUI);
      return;
    }

    if (!hotspot) {
      this.pending = null;
      this.lastApproach = null;
      this.player.walkToPct(pct.x, pct.y);
      return;
    }
    // A1.14: WALK sobre un hotspot = andar (al punto tocado si es suelo, si no a su walkTo), sin frase
    if (verb === Verb.WALK) {
      this.walkToHotspot(hotspot, pct);
      return;
    }
    // A2.2: LOOK se gira sin andar; TALK anda a distancia de conversación; USE, PICK, OPEN… a su walkTo
    this.runHotspotVerb(hotspot, verb);
    this.afterVerbAction(scummUI);
  }

  /**
   * A1.14: WALK sobre un hotspot. Al punto tocado si se pisa y se llega (hotspots de suelo: camino, carport,
   * baldosas), si no a su `walkTo` explícito, y si no al tocado (la ruta lleva al alcanzable más cercano). Sin frase.
   */
  private walkToHotspot(hotspot: HotspotData, pct: { x: number; y: number }): void {
    const reachable = this.player.canReachPct(pct.x, pct.y);
    const explicit = hotspot.walkTo && Number.isFinite(hotspot.walkTo.x) && Number.isFinite(hotspot.walkTo.y) ? hotspot.walkTo : null;
    const to = walkPointFor(pct, reachable, explicit);
    this.pending = null;
    this.lastApproach = { target: hotspot.id, verb: Verb.WALK, walkTo: { ...to }, face: null };
    this.player.walkToPct(to.x, to.y);
  }

  /**
   * A1.14: tras una acción con verbo u objeto elegidos en el panel, el verbo vuelve a WALK (SCUMM clásico) y la línea
   * de acción se limpia (antes se quedaba «Open Carport» o «Talk to Checkered Floor» con texto viejo).
   */
  private afterVerbAction(scummUI: ScummUI | undefined): void {
    if (!scummUI) return;
    scummUI.resetSelection?.();
    scummUI.setHoveredObject?.(null);
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
      if (this.npcHit(npc, wx, wy)) {
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
    const bgSrc = this.bg.texture.getSourceImage() as { width: number; height: number };
    const coverScale = Math.max(w / this.coordSystem.imgW, gameAreaH / this.coordSystem.imgH)
      * fitScale({ w: this.coordSystem.imgW, h: this.coordSystem.imgH }, { w: bgSrc.width, h: bgSrc.height }).x;
    this.bgFill.setPosition(w / 2, gameAreaH / 2).setScale(coverScale);

    // A5.1: fondo y primer plano como un overlay a tamaño de fondo (escala del fondo × mundo/textura)
    this.placeOverlay(this.bg);
    if (this.fg) this.placeOverlay(this.fg);
    for (const l of this.fgLayers) this.placeOverlay(l.img, l.bounds);

    this.player.onResize(this.coordSystem);

    for (const npc of this.npcs) {
      const npcPctPos = npc.pctPosition;
      if (npcPctPos) {
        const newPos = this.coordSystem.pctToScreen(npcPctPos.x, npcPctPos.y);
        npc.setPosition(newPos.x, newPos.y);
      }
      npc.setScale(this.npcPixelScale(npc));
    }

    // Conditional overlays follow background transform
    for (const co of this.conditionalOverlays) {
      this.placeOverlay(co.sprite, co.bounds);
    }
    this.placeSeatedDex();
    // A4.3: el ambiente se recoloca solo con la transformación del fondo; el vaivén del primer plano parte de la x nueva
    this.ambient?.layout();

    this.web3VisualSystem?.onResize(this.coordSystem);

    // Update camera for new orientation. A2.10: en cinemática la cámara es del director (la recoloca él)
    if (this.cinema?.cameraOwned()) this.bgFill.setVisible(!(this.coordSystem.isPortrait || this.coordSystem.isPanoramic));
    else this.setupCamera();

    const sceneData = this.registry.get('sceneData') as SceneData;
    if (sceneData) this.drawDebugBounds(sceneData);

  }

  /**
   * A2.7: overlay condicional sobre el fondo; con `bounds` (recortado) en su caja, si no, entero como el fondo.
   * A5.1: también el fondo y el primer plano: la textura puede ser una variante más pequeña que el mundo (render.world) y
   * overlayTransform la estira (mundo / textura) para que cada píxel caiga donde caía.
   */
  /**
   * A2.17 fase 2: textura del primer plano SIN los trozos de `foregroundLayers` (borrados con clearRect), para que esos
   * trozos solo se dibujen una vez (a su profundidad). Se rehace en cada entrada; las de otras escenas se liberan.
   */
  private foregroundRest(fgKey: string, sceneId: string, layers: NonNullable<SceneData['foregroundLayers']>): string {
    const key = `fgrest_${fgKey}`;
    for (const k of this.textures.getTextureKeys()) if (k.startsWith('fgrest_')) this.textures.remove(k);
    const src = this.textures.get(fgKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const tex = this.textures.createCanvas(key, src.width, src.height);
    if (!tex) return fgKey;
    const ctx = tex.getContext();
    ctx.drawImage(src, 0, 0);
    for (const l of layers) {
      const r = pctRectToPx(l.bounds, src.width, src.height);
      if (!l.mask) {
        ctx.clearRect(r.x, r.y, r.w, r.h);
        continue;
      }
      // A2.17 fase 3: con máscara, solo se borran sus píxeles (el resto del rectángulo sigue a depth 15)
      const mask = this.textures.get(fgMaskKey(sceneId, l.id)).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(mask, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    tex.refresh();
    return key;
  }

  /**
   * A2.17 fase 3: trozo del primer plano recortado a `r` (píxeles de la textura del primer plano) y enmascarado: los
   * mismos píxeles que el resto del primer plano (la misma variante: sin costura ni halo) solo donde la máscara es opaca.
   */
  private maskedForegroundPiece(src: HTMLImageElement | HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, key: string, maskKey: string): string | null {
    if (r.w <= 0 || r.h <= 0) return null;
    const tex = this.textures.createCanvas(key, r.w, r.h);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.textures.get(maskKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement, 0, 0, r.w, r.h);
    ctx.globalCompositeOperation = 'source-over';
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return key;
  }

  private placeOverlay(sprite: Phaser.GameObjects.Image, bounds?: PctRect): void {
    const src = sprite.texture.getSourceImage() as { width: number; height: number };
    const o = overlayTransform(
      this.coordSystem.getBgTransform(),
      { w: this.coordSystem.imgW, h: this.coordSystem.imgH },
      { w: src.width, h: src.height },
      bounds,
    );
    sprite.setPosition(o.x, o.y).setScale(o.scaleX, o.scaleY);
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
      this.runFastForward(() => this.emitSyntheticTap(pointer));
    });
    this.input.once('pointerup', onUp);
    this.fastForward = { timer, onUp };
  }

  /** Activa el avance rápido ya decidido (mantener pulsado o Esc): esperas al momento, aviso «>> FAST» y toques. */
  private runFastForward(tick: () => void): void {
    if (!this.fastForward) return;
    this.scriptEngine.setFastForward(true);
    this.dialogueScripts.setFastForward(true);
    // A2.10: en una cinemática, mantener pulsado o Esc la saltan entera (estado final aplicado, nada a medias)
    this.scriptEngine.skipCinematic();
    this.dialogueScripts.skipCinematic();
    this.fastForward.label = this.add.text(this.scale.width - 12, 12, '>> FAST', {
      fontFamily: FONT.FAMILY, fontSize: '12px', color: TWP.HINT_TEXT, backgroundColor: TWP.HINT_BG, padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setDepth(400).setScrollFactor(0);
    this.fastForward.ticker = this.time.addEvent({ delay: GameScene.FF_STEP_MS, loop: true, callback: tick });
  }

  /** A2.4: hay algo que Esc puede saltar: script en marcha (cinemática, onEnter), texto o cinemática en pantalla. */
  private hasSkippable(): boolean {
    if (this.scriptEngine.isRunning() || this.registry.get('dialogueShowing')) return true;
    return ((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0;
  }

  /** A2.4: una elección de diálogo espera al jugador (Esc no la responde: hace falta elegir). */
  private awaitingChoice(): boolean {
    if (!this.scene.isActive('UIScene')) return false;
    return (this.scene.get('UIScene') as UIScene).getChoicePanel()?.isAwaitingChoice() ?? false;
  }

  /**
   * A2.4: Esc. Con una cinemática, un texto o un script en marcha, el mismo avance rápido que mantener pulsado (V6),
   * sin espera previa, hasta que no quede nada que saltar, salga una elección o pasen KEY_SKIP_MAX_MS. Si no hay
   * nada, suelta el objeto y el verbo elegidos en el panel y quita el resaltado de Tab.
   */
  private handleEscape(): void {
    if (this.fastForward) return;
    if (this.hasSkippable() && !this.awaitingChoice()) {
      const pointer = this.input.activePointer;
      const startedAt = this.time.now;
      this.fastForward = { byKey: true };
      this.runFastForward(() => {
        if (!this.hasSkippable() || this.awaitingChoice() || this.time.now - startedAt > GameScene.KEY_SKIP_MAX_MS) {
          this.endFastForward();
          return;
        }
        this.emitSyntheticTap(pointer);
      });
      this.emitSyntheticTap(pointer);
      return;
    }
    this.hideHighlights();
    this.uiSelection().scummUI?.resetSelection?.();
  }

  private endFastForward(): void {
    const ff = this.fastForward;
    if (!ff) return;
    ff.timer?.remove();
    ff.ticker?.remove();
    ff.label?.destroy();
    if (ff.onUp) this.input.off('pointerup', ff.onUp);
    this.fastForward = null;
    this.scriptEngine?.setFastForward(false);
    this.dialogueScripts?.setFastForward(false);
    // que el dedo al soltar no mande al personaje a andar
    this.inputCooldownFrames = Math.max(this.inputCooldownFrames, 6);
  }

  /** V6: empieza un toque sobre un hotspot; al soltar antes de HOLD_MS anda hacia él (A1.14) y si se mantiene hace la acción principal. */
  private beginTouchHold(pointer: Phaser.Input.Pointer, hotspot: HotspotData, pct: { x: number; y: number }): void {
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
      // A1.14: toque corto con WALK = andar hacia el hotspot (antes: LOOK sin andar)
      this.walkToHotspot(hotspot, pct);
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

  /**
   * Ejecuta un verbo concreto sobre un hotspot. A2.2: LOOK se gira hacia él sin andar; TALK anda a distancia de
   * conversación; el resto anda a su `walkTo` (por defecto, el centro-abajo de los bounds llevado a lo alcanzable).
   * Al llegar se gira (`face`) y ejecuta. Sin punto alcanzable, se gira y ejecuta sin andar.
   */
  private runHotspotVerb(hotspot: HotspotData, verb: Verb): void {
    this.approachAndRun(hotspot.id, verb, this.planHotspot(hotspot, verb), () => this.events.emit('hotspot:tapped', hotspot, verb));
  }

  /**
   * V6: la acción principal de un hotspot (mantener pulsado en táctil) es el primer verbo cuyo script hace algo más
   * que hablar (coger, cambiar de escena, poner un flag…). Si ninguno lo hace, USE. A2.4: la regla y el orden viven en
   * src/systems/DesktopControls.ts (`primaryVerb`), compartidos con el clic derecho, que en vez de USE cae en LOOK.
   */
  static mainVerbFor(hotspot: HotspotData): Verb {
    return (primaryVerb(hotspot) as Verb | null) ?? Verb.USE;
  }

  // ─── A2.4: teclado y resaltado de hotspots (escritorio) ───

  private bindDesktopInput(): void {
    this.unbindDesktopInput();
    const canvas = this.game.canvas;
    const keydown = (e: KeyboardEvent) => this.handleKeyDown(e);
    const keyup = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (this.highlight) e.preventDefault();
      this.hideHighlights();
    };
    // Al cambiar de ventana con Tab pulsado no llega el keyup: se quita igual
    const blur = () => this.hideHighlights();
    // Sin menú contextual del navegador sobre el lienzo: el clic derecho es del juego
    const contextmenu = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    canvas.addEventListener('contextmenu', contextmenu);
    GameScene.liveDomListeners += 4;
    // A2.4 (QA): `state().inputListeners`, en el registry (sobrevive al cambio de escena) como `qaActions`
    this.registry.set('qaInputListeners', GameScene.liveDomListeners);
    this.desktopInput = { keydown, keyup, blur, contextmenu, canvas };
  }

  private unbindDesktopInput(): void {
    const d = this.desktopInput;
    if (!d) return;
    window.removeEventListener('keydown', d.keydown);
    window.removeEventListener('keyup', d.keyup);
    window.removeEventListener('blur', d.blur);
    d.canvas.removeEventListener('contextmenu', d.contextmenu);
    GameScene.liveDomListeners -= 4;
    this.registry.set('qaInputListeners', GameScene.liveDomListeners);
    this.desktopInput = null;
  }

  /** Tabla de teclas en src/systems/DesktopControls.ts. Nada mientras se escribe en un campo ni con Ctrl/Cmd/Alt. */
  private handleKeyDown(e: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement | null;
    const action = keyAction(e, focusOf(active, active === this.game.canvas));
    if (!action) return;
    if (action.kind === 'highlight') {
      e.preventDefault(); // que Tab no mueva el foco fuera del juego
      if (!e.repeat && !this.highlight && !this.cinema?.isActive()) this.showHighlights();
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    // A2.9: con el diario abierto, Esc y J lo cierran y ninguna otra tecla llega al juego
    const journal = this.scene.isActive('UIScene') ? (this.scene.get('UIScene') as UIScene).getJournal?.() : undefined;
    if (journal?.isOpen()) {
      if (action.kind === 'skip' || action.kind === 'journal') journal.close();
      return;
    }
    // A2.10: en cinemática la interfaz está oculta: solo Esc (saltar)
    if (this.cinema?.isActive() && action.kind !== 'skip') return;
    const scummUI = this.uiSelection().scummUI;
    switch (action.kind) {
      case 'verb': scummUI?.selectVerb(action.verb as Verb); break;
      case 'inventory': scummUI?.toggle(); break;
      case 'skip': this.handleEscape(); break;
      // A2.9: J abre el diario (no se abre si hay cinemática, diálogo, texto o script: lo decide UIScene)
      case 'journal': journal?.open(); break;
    }
  }

  /**
   * A2.4: mientras se mantiene Tab, contorno y nombre de cada hotspot que el ratón puede pulsar ahora (visible por sus
   * flags `hideWhenFlag`/`showWhenFlag` y con algún punto que reciba el clic: ni tapado ni bajo el panel) y de cada NPC
   * con diálogo. Los hotspots con gate de wallet salen: se pueden pulsar (responden con su `gateFallback`).
   */
  private showHighlights(): void {
    this.hideHighlights();
    const data = this.registry.get('sceneData') as SceneData | undefined;
    if (!data || !this.coordSystem) return;
    const g = this.add.graphics().setDepth(45);
    const objects: Phaser.GameObjects.GameObject[] = [g];
    const ids: string[] = [];
    const label = (x: number, y: number, text: string) => {
      objects.push(this.add.text(x, y, text, {
        fontFamily: FONT.FAMILY, fontSize: '11px', color: TWP.ACTION_LINE, backgroundColor: TWP.HINT_BG, padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(46));
    };
    g.lineStyle(2, TWP.HOTSPOT_HIGHLIGHT, 0.9);
    for (const hs of data.regions?.hotspots ?? []) {
      if (!hs.bounds || !this.isHotspotVisible(hs) || !this.clickablePoint(hs)) continue;
      const a = this.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
      const b = this.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
      g.strokeRoundedRect(a.x, a.y, b.x - a.x, b.y - a.y, 4);
      label((a.x + b.x) / 2, (a.y + b.y) / 2, hs.name);
      ids.push(hs.id);
    }
    for (const npc of this.npcs) {
      if (!npc.dialogueTreeId || !npc.visible) continue;
      const m = npc.getWorldTransformMatrix();
      const w = (npc.width * npc.scale) / 2;
      const h = npc.height * npc.scale;
      g.strokeRoundedRect(m.tx - w, m.ty - h, w * 2, h, 4);
      label(m.tx, m.ty - h - 8, npc.npcName);
      ids.push(npc.npcId);
    }
    this.highlight = { objects, ids };
  }

  private hideHighlights(): void {
    const h = this.highlight;
    if (!h) return;
    this.highlight = null;
    // Tras SHUTDOWN la lista de objetos ya los destruyó; destroy() dos veces no rompe
    for (const o of h.objects) o.destroy();
  }

  /** Un punto del hotspot (en %) donde un clic de ratón cae en él (centro y rejilla de 7×7), o null si no lo hay. */
  private clickablePoint(hotspot: HotspotData): { x: number; y: number } | null {
    for (const p of this.hotspotProbePoints(hotspot)) {
      const { wx, wy, sy } = this.qaPoint(p.x, p.y);
      const hit = this.hitTestAt(wx, wy, sy, false);
      if (hit.kind === 'scene' && hit.hotspot === hotspot) return p;
    }
    return null;
  }

  private hotspotProbePoints(hotspot: HotspotData): { x: number; y: number }[] {
    const b = hotspot.bounds;
    if (!b) return [];
    const points = [{ x: b.x + b.w / 2, y: b.y + b.h / 2 }];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) points.push({ x: b.x + (b.w * (i + 0.5)) / 7, y: b.y + (b.h * (j + 0.5)) / 7 });
    }
    return points;
  }

  /**
   * A1.13: autoguardado por progreso. Antes solo se autoguardaba al entrar en una escena, y todo el capítulo 1 pasa en
   * `outside`: el slot 0 se quedaba con el estado de «New Game» aunque el jugador llevara un rato jugando. Ahora, cuando
   * cambia el inventario o las flags y no hay script, diálogo ni diario en marcha, se autoguarda (sin aviso en pantalla).
   */
  private autosaveProgressIfIdle(): void {
    if (!this.progressDirty || this.isTrailer) return;
    if (this.scriptEngine.isRunning() || this.registry.get('dialogueShowing') || this.registry.get('dialogueActive')
      || this.registry.get('journalOpen') || this.registry.get('dashboardOpen') || this.registry.get('sceneTransition')) return;
    this.progressDirty = false;
    this.gameState.savedAt = Date.now();
    const title = this.sceneDataLoader?.getSceneData()?.title ?? this.gameState.currentScene;
    this.saveSystem.autoSave(this.gameState, title);
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
    const changed = sig !== this.progressSig;
    if (changed) {
      // A1.13: hay avance (objeto, flag): se marca para autoguardar en cuanto no haya script ni diálogo en marcha
      if (this.progressSig) this.progressDirty = true;
      this.progressSig = sig; this.lastProgressAt = now;
    }
    this.autosaveProgressIfIdle();
    if (changed) return;
    // A2.9: leyendo el diario tampoco cuenta como atascado
    if (this.scriptEngine.isRunning() || this.registry.get('dialogueShowing') || this.registry.get('dialogueActive') || this.registry.get('journalOpen')) {
      this.lastProgressAt = Math.max(this.lastProgressAt, now - 1000);
      return;
    }
    // A1.8: ?hintAfter solo en dev o con ?qa=1
    const override = Number(gameUrlParams(window.location.search, import.meta.env.DEV).get('hintAfter'));
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
    this.showHintLabel(text);
  }

  /**
   * Etiqueta de pista arriba del área de juego. No usa el cuadro de diálogo a propósito: `sayBrief` marca
   * `dialogueShowing` y bloquearía los toques en la escena mientras se lee.
   */
  private showHintLabel(text: string): void {
    this.children.list.filter((c) => c.name === 'hint-label').forEach((c) => c.destroy());
    const label = this.add.text(this.scale.width / 2, Math.max(20, this.scale.height * 0.06), text, {
      fontFamily: FONT.FAMILY, fontSize: '11px', color: TWP.HINT_TEXT, backgroundColor: TWP.HINT_BG,
      padding: { x: 8, y: 4 }, align: 'center', wordWrap: { width: Math.min(this.scale.width - 48, 600) },
    }).setOrigin(0.5, 0).setDepth(400).setScrollFactor(0).setAlpha(0).setName('hint-label');
    this.tweens.add({ targets: label, alpha: 1, duration: 250, hold: 4000, yoyo: true, onComplete: () => label.destroy() });
  }

  /** V6: aviso breve «AUTOSAVED» sobre el panel, abajo a la derecha del área de juego. */
  private showAutosaveIndicator(): void {
    if (!this.autosaveOk) return;
    if (this.isTrailer) return;
    this.registry.set('lastAutosaveAt', Date.now());
    const panelH = this.getEffectivePanelHeight();
    const label = this.add.text(this.scale.width - 12, this.scale.height - panelH - 10, 'AUTOSAVED', {
      fontFamily: FONT.FAMILY, fontSize: '11px', color: TWP.HINT_TEXT, backgroundColor: TWP.HINT_BG, padding: { x: 6, y: 3 },
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
    const hideFlag = hs.hideWhenFlag;
    if (hideFlag && (this.gameState.flags[hideFlag] ?? false)) return false;
    const showFlag = hs.showWhenFlag;
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
    return GameScene.panelHeightFor(this.scale.width, this.scale.height);
  }

  /** Alto del panel SCUMM para un viewport (A5.1: PreloadScene lo usa para elegir la variante de fondo antes de que exista la escena) */
  static panelHeightFor(width: number, height: number): number {
    const isMobile = height > width || Math.min(width, height) < 600;
    const isLandscape = width > height;
    const panelRatio = isMobile ? (isLandscape ? 0.22 : 0.15) : 0.25;
    const minH = isMobile && isLandscape ? 100 : LAYOUT.PANEL_MIN_HEIGHT;
    return Math.max(minH, Math.floor(height * panelRatio));
  }

  // ─── Verb execution ───────────────────────

  private static readonly WATCHDOG_TICK_MS = 1000;

  /**
   * A1.1: hay algo en pantalla esperando al jugador (texto, árbol de diálogo, elección o cinemática). Mientras
   * tanto el watchdog de scripts no cuenta: dejar un texto abierto no es un cuelgue.
   */
  private isPresentingToPlayer(countDialogueTree = true): boolean {
    if (this.registry.get('dialogueShowing')) return true;
    // A3.10: el dashboard del rig espera a que el jugador lo cierre
    if (this.registry.get('dashboardOpen')) return true;
    if (countDialogueTree && this.registry.get('dialogueActive')) return true;
    if (((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0) return true;
    if (!this.scene.isActive('UIScene')) return false;
    return (this.scene.get('UIScene') as UIScene).getChoicePanel()?.isAwaitingChoice() ?? false;
  }

  /**
   * Ejecuta un script de hotspot o combo. El watchdog (A1.1) es uno solo para todos los scripts, en create();
   * `label` sale en su aviso si alguna vez tiene que forzar el reinicio.
   */
  private runScript(script: import('@/types/scene.types').ScriptOp[], label: string): void {
    this.scriptEngine.updateContext(this.buildScriptContext());
    this.scriptEngine.execute(script, label).finally(() => {
      this.inputCooldownFrames = 2;
    });
  }

  /**
   * A1.9: onEnter de un nodo de diálogo (lo llama el DialogueSystem de UIScene), con todos los opcodes de
   * ScriptEngine y el estado vivo, en un motor aparte del principal para no bloquearse cuando el diálogo lo
   * lanzó el op `dialogue` de un script que sigue esperando. `where` = `<treeId>.<nodeId>`.
   */
  runDialogueScripts(ops: import('@/types/scene.types').ScriptOp[], where: string): Promise<void> {
    return this.dialogueScripts.run(ops, where);
  }

  /** A1.9: el árbol de diálogo se ha cerrado; aplica el cambio de escena que un onEnter dejó aplazado. */
  finishDialogueScripts(): void {
    this.dialogueScripts?.finishTree();
  }

  /** Execute an item-to-item combo script (called from UIScene) */
  executeItemComboScript(script: import('@/types/scene.types').ScriptOp[]): void {
    this.runScript(script, 'item combo');
  }

  async executeHotspotVerb(hotspot: HotspotData, verb: Verb): Promise<void> {
    this.touchedHotspots.add(hotspot.id);
    // Check hotspot-level gate if present
    if (hotspot.gate) {
      const address = gateAddress();
      let gatePassed = false;
      if (address) {
        gatePassed = await checkGatingRule(address as Address, hotspot.gate as GatingRule);
      }
      if (!gatePassed) {
        if (hotspot.gateFallback?.length) {
          this.runScript(hotspot.gateFallback, `gate fallback ${hotspot.id}`);
        } else {
          this.scene.get('UIScene').events.emit('say', 'Something about this feels locked away...');
        }
        return;
      }
    }

    const scripts = hotspot.scripts[verb];
    if (scripts?.length) {
      this.runScript(scripts, `${hotspot.id}/${verb}`);
    } else {
      // A2.5: bolsa del verbo (assets/config/fail-responses.json verbDefaults), sin repetir la última
      this.scene.get('UIScene').events.emit('say', failResponses.verb(verb, hotspot.id).text);
    }
  }

  private buildScriptContext(): ScriptContext {
    const run = this.sceneRun;
    return {
      // A1.1: siempre el estado vivo (setState e InventorySystem sustituyen el objeto)
      getState: () => this.gameState,
      setState: (updater) => { this.gameState = updater(this.gameState); this.registry.set('gameState', this.gameState); },
      say: (text, speaker) => new Promise<void>((resolve) => {
        this.scene.get('UIScene').events.emit('say', text, speaker, resolve);
      }),
      sayBrief: (text, durationMs, speaker) => new Promise<void>((resolve) => {
        this.scene.get('UIScene').events.emit('sayBrief', text, durationMs, speaker, resolve);
      }),
      gotoScene: (sceneId, spawn, transition) => {
        // A0.1: marca de cambio de escena en curso (la quita create() de la escena nueva)
        this.registry.set('sceneTransition', sceneId);
        // A2.7: desde aquí cuenta `lastTransition.ms` (PreloadScene)
        this.registry.set('transitionRequestedAt', performance.now());
        // Clear player position on scene transition (new scene uses its own spawn)
        this.gameState.playerPosition = undefined;
        this.saveSystem.autoSave(this.gameState, this.sceneDataLoader.getSceneData().title);
        const go = () => {
          this.registry.set('currentSceneId', sceneId);
          if (spawn) this.registry.set('spawnOverride', spawn);
          this.scene.stop('UIScene');
          this.scene.start('PreloadScene');
        };
        // A2.10: `transition` (iris o cortinilla) en vez del fundido; la escena nueva entra con la misma
        if (transition && transition.type !== 'fade' && this.cinema) {
          this.registry.set('transitionIn', transition);
          void this.cinema.transitionOut(transition).then(go);
          return;
        }
        this.cameras.main.fadeOut(FADE_SHORT_MS, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', go);
      },
      addItem: (id, name) => {
        const isNew = !this.inventorySystem.hasItem(id);
        this.inventorySystem.addItem(id, name);
        // A4.5: objeto encontrado = stinger en la tonalidad de la música (antes, item_pickup a secas)
        if (isNew) playStinger(this, 'item'); else sfxOf(this)?.play('item_pickup', { volume: 0.6 });
      },
      removeItem: (id) => this.inventorySystem.removeItem(id),
      // A3.10: con __qa.mockWeb3 (solo ?qa=1) cuenta la cartera simulada
      isWalletConnected: () => gateAddress() !== null,
      checkGating: async (rule: GatingRule) => {
        const address = gateAddress();
        return address ? checkGatingRule(address as Address, rule) : false;
      },
      mintItem: async (tokenId): Promise<MintResult> => mintItem({ tokenId }),
      mintAchievement: async (achievementId): Promise<MintResult> => mintAchievement(achievementId),
      playSound: (key) => {
        sfxOf(this)?.play(key, { volume: 0.7 });
      },
      playStinger: (kind) => {
        if (isStingerKind(kind)) playStinger(this, kind);
        else console.warn(`[ScriptEngine] stinger: kind «${kind}» desconocido (item | puzzle | chapter | fail)`);
      },
      startDialogue: async (_npcId, treeId) => {
        const ui = this.scene.get('UIScene');
        // A1.1: escuchar antes de emitir; un árbol que no existe emite `dialogueComplete` al momento y la
        // promesa se quedaba sin resolver (el watchdog tenía que forzar el reinicio)
        const done = new Promise<void>((r) => ui.events.once('dialogueComplete', r));
        ui.events.emit('startDialogue', _npcId, treeId);
        await done;
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
        sfxOf(this)?.play('achievement', { volume: 0.6 });
        const ui = this.scene.get('UIScene');
        ui.events.emit('showAchievement', text);
      },
      showToast: (status, message) => { this.transactionToast.show(status, message); },
      setCostume: (prefix) => { this.player.setCostume(prefix); },
      // A1.4: op flicker. Solo el mapa de forzados (update() lo aplica en el siguiente frame); nunca el sprite,
      // que tras SHUTDOWN ya está destruido, ni el estado
      setOverlayOverride: (overlayId, visible) => {
        if (run !== this.sceneRun) return false;
        if (!this.conditionalOverlays.some((co) => co.id === overlayId)) return false;
        if (visible === null) this.overlayOverrides.delete(overlayId);
        else this.overlayOverrides.set(overlayId, visible);
        return true;
      },
      clearOverlayOverrides: () => {
        if (run === this.sceneRun) this.overlayOverrides.clear();
      },
      // A4.3: op ambient (forzar o ráfaga de un elemento de animación ambiental). Solo en la escena de este contexto
      ambient: (id, action) => {
        if (run !== this.sceneRun || !this.ambient) return false;
        if (action === 'burst') return this.ambient.burst(id);
        return this.ambient.setOverride(id, action === 'auto' ? null : action);
      },
      // A9.4: créditos (un toque no los salta) → partida terminada y guardada → «THE END» y resumen → portada
      showCredits: async () => {
        if (run !== this.sceneRun) return;
        const ui = this.scene.get('UIScene');
        await new Promise<void>((resolve) => { ui.events.emit('showCredits', () => resolve()); });
        if (run !== this.sceneRun || this.isTrailer) return;
        // el avance rápido (mantener o Esc) no sigue repartiendo toques sobre el resumen
        this.endFastForward();
        this.gameState.completedAt = Date.now();
        this.gameState.savedAt = Date.now();
        const title = this.sceneDataLoader?.getSceneData()?.title ?? this.gameState.currentScene;
        this.saveSystem.autoSave(this.gameState, title);
        this.registry.set('gameState', this.gameState);
        await new Promise<void>((resolve) => { ui.events.emit('showEnding', resolve); });
        if (run !== this.sceneRun) return;
        this.returnToTitle();
      },
      // A3.10: op showDashboard (Mining Rig). Solo lecturas; se resuelve al cerrar el panel
      showDashboard: async () => {
        if (run !== this.sceneRun) return;
        this.dashboardPanel ??= new DashboardPanel();
        this.registry.set('dashboardOpen', true);
        try {
          await this.dashboardPanel.open(loadDashboard());
        } finally {
          this.registry.set('dashboardOpen', false);
        }
      },
      showMonitorReveal: () => {
        const ui = this.scene.get('UIScene');
        return new Promise<void>((resolve) => {
          ui.events.emit('showMonitorReveal', resolve);
        });
      },
      // A2.10: cinemáticas. Se resuelve al llamar: un script de la escena anterior no toca el director de esta
      cinema: this.cinemaHooks(run),
      parseTransition,
      // A2.9: op journalNote (apunta una nota del diario; estado) y op callAnon (Anon da la pista del puzle abierto)
      journalNote: (id) => {
        const { progress, added } = addNote(JOURNAL_CHAPTERS, journalProgress(this.gameState), id);
        if (added) {
          this.gameState = { ...this.gameState, journal: progress };
          this.registry.set('gameState', this.gameState);
        }
        return added || journalProgress(this.gameState).notes.includes(id);
      },
      callAnon: async () => {
        const { call, progress } = callAnon(JOURNAL_CHAPTERS, journalChapter(this.gameState), journalWorld(this.gameState), journalProgress(this.gameState));
        this.gameState = { ...this.gameState, journal: progress };
        this.registry.set('gameState', this.gameState);
        this.registry.set('journalLastCall', call);
        // A4.4: Dex descuelga (el tono de llamada es cosa del móvil, JournalPanel.callAnon)
        sfxOf(this)?.play('phone_pickup', { volume: 0.4 });
        await new Promise<void>((resolve) => {
          this.scene.get('UIScene').events.emit('say', call.text, 'Anon', resolve);
        });
      },
    };
  }

  /** A2.10: puente del ScriptEngine con el director de cinemáticas de ESTA escena (`run` = su create()). */
  private cinemaHooks(run: number): NonNullable<ScriptContext['cinema']> {
    const live = () => (run === this.sceneRun ? this.cinema : undefined);
    return {
      handles: (name) => live()?.hooks().handles(name) ?? false,
      skipAction: (op) => live()?.hooks().skipAction(op) ?? 'skip',
      begin: () => live()?.begin(),
      end: (opts) => live()?.end(opts),
      run: (op, instant) => live()?.run(op, instant) ?? Promise.resolve(),
      finishAll: () => live()?.finishAll(),
    };
  }

  /** A2.10: lo que el director de cinemáticas necesita de la escena. */
  private cinematicHost(): ConstructorParameters<typeof CinematicDirector>[0] {
    return {
      scene: this,
      player: () => this.player,
      npcs: () => this.npcs,
      coords: () => this.coordSystem,
      panelHeight: () => this.getEffectivePanelHeight(),
      restoreCamera: () => this.setupCamera(),
      ui: () => (this.scene.isActive('UIScene') ? (this.scene.get('UIScene') as unknown as CinematicUi) : null),
      music: () => this.musicManager ?? null,
      walkSpeedPct: () => {
        // A2.12: la del punto más lento de la escena (el tiempo máximo de actorMove no se queda corto)
        return this.player.slowestSpeedPct();
      },
      onBegin: () => {
        // A3.2: una cinemática en el onEnter (la apertura) se ve: fuera la cortina negra que tapa la entrada a la escena
        this.cinematicOverlay?.hideBlackCover();
        this.cancelTouchHold();
        this.hideHighlights();
        this.pending = null;
      },
    };
  }

  /** A9.3: último título de escena (la demo mide su caja) */
  sceneTitleText: Phaser.GameObjects.Text | null = null;

  private showSceneTitle(title: string): void {
    const center = this.coordSystem.pctToScreen(50, 5);
    // A5.2: mínimo 11 px (legible en un iPhone en horizontal; antes 8)
    const fontSize = Math.max(11, Math.min(14, Math.floor(this.coordSystem.bgW * 0.012)));
    // A9.3: centrado en la pantalla (en vertical el fondo es más ancho y la cámara lo recorta) y bajo los botones de
    // arriba; antes asomaba cortado bajo «Connect» en 390×844
    const cam = this.cameras.main;
    const place = sceneTitlePlacement(this.scale.width, center.y - cam.scrollY);
    const text = this.add.text(place.x, place.y, title, {
      fontFamily: FONT.FAMILY, fontSize: `${fontSize}px`,
      color: TWP.SCENE_TITLE, stroke: '#000000', strokeThickness: 3, align: 'center',
      wordWrap: { width: place.wrapW },
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0).setScrollFactor(0);
    this.sceneTitleText = text;
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

    // A2.1: obstáculos (blockedAreas) rellenos, para ver lo que rodea el personaje
    gfx.fillStyle(TWP.DEBUG_SPAWN, 0.25);
    for (const area of sceneData.blockedAreas ?? []) {
      const tl = this.coordSystem.pctToScreen(area.x, area.y);
      const br = this.coordSystem.pctToScreen(area.x + area.w, area.y + area.h);
      gfx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
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
        this.scriptEngine.execute(tr.onEnter, `${tr.id}/onEnter`);
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

  /** Toque sintético en GameScene y UIScene (avance rápido y QA): cierra textos y cinemáticas; handlePointerDown lo ignora. */
  private emitSyntheticTap(pointer: Phaser.Input.Pointer): void {
    const ui = this.scene.get('UIScene');
    this.emittingSynthetic = true;
    try {
      this.input.emit('pointerdown', pointer);
      if (ui && ui !== this) ui.input.emit('pointerdown', pointer);
    } finally {
      this.emittingSynthetic = false;
    }
  }

  // ─── A0.1: puente para la API de QA (solo lo usa src/qa/QaApi.ts con ?qa=1) ───

  /**
   * A0.5: cuenta (en el registry, sobrevive al cambio de escena) cada verbo que llega a ejecutarse sobre un hotspot o
   * NPC: al saltar player:arrived o al momento si no hace falta andar. La API de QA lo expone como `actions` para que
   * el runner sepa si el intento de un atajo se llegó a ejecutar o el personaje se quedó por el camino.
   */
  private noteQaAction(): void {
    this.registry.set('qaActions', ((this.registry.get('qaActions') as number | undefined) ?? 0) + 1);
  }

  /** Lo mismo que comprueba handlePointerDown antes de aceptar un toque en la escena. */
  qaIsInputBlocked(): boolean {
    if (this.scriptEngine.isRunning() || this.inputCooldownFrames > 0) return true;
    // A2.9: el diario abierto tapa la escena
    if (this.registry.get('journalOpen')) return true;
    if (this.registry.get('dialogueActive') || this.registry.get('dialogueShowing')) return true;
    const dismissedAt = this.registry.get('dialogueDismissedAt') as number | undefined;
    return dismissedAt !== undefined && this.time.now - dismissedAt < 50;
  }

  /** Qué hay en marcha en la escena: script, personaje andando o fundido de cámara. */
  qaBusy(): { script: boolean; walking: boolean; fading: boolean; gesture: boolean } {
    return {
      script: this.scriptEngine.isRunning(),
      walking: this.player.isMoving(),
      fading: this.cameras.main.fadeEffect.isRunning,
      // A4.1: el gesto de coger/usar (≤ 400 ms) acaba antes de dar el paso por terminado: la escala vuelve a la base
      gesture: this.player.isGesturing(),
    };
  }

  /** Toque sintético del avance rápido: cierra el texto o la cinemática en pantalla sin mandar andar. */
  /**
   * A9.4: tras «THE END», de vuelta a la portada. Se paran el script en marcha (el de los créditos ya terminó) y la
   * interfaz; MenuScene vuelve a montar sus botones y «Continue» ve la partida terminada.
   */
  private returnToTitle(): void {
    this.registry.set('endingQa', { ...((this.registry.get('endingQa') as Record<string, unknown> | undefined) ?? {}), phase: 'menu', returnedToMenu: true });
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (this.scene.isActive('UIScene')) this.scene.stop('UIScene');
      this.scene.start('MenuScene');
    });
  }

  qaSyntheticTap(): void {
    this.emitSyntheticTap(this.input.activePointer);
  }

  /** Coordenadas de un punto del fondo (en %) tal y como las recibiría un clic: mundo e Y de pantalla. */
  private qaPoint(pctX: number, pctY: number): { wx: number; wy: number; sy: number } {
    const w = this.coordSystem.pctToScreen(pctX, pctY);
    return { wx: w.x, wy: w.y, sy: w.y - this.cameras.main.scrollY };
  }

  private describeHit(hit: TapHit): string {
    if (hit.kind === 'none') return hit.reason;
    if (hit.kind === 'npc') return `el NPC ${hit.npc.npcId}`;
    if (!hit.rawHotspot) return 'fondo sin hotspot';
    return hit.hotspot ? `el hotspot ${hit.rawHotspot.id}` : `el hotspot oculto ${hit.rawHotspot.id}`;
  }

  /**
   * Clic de ratón sobre un hotspot con el verbo y el objeto elegidos en el panel. Busca dentro de sus bounds
   * (centro y rejilla de 7×7) un punto donde `hitTestAt` devuelva ese mismo hotspot y hace clic ahí.
   * Devuelve null si ha pulsado, o por qué el ratón no puede pulsarlo (tapado, sin bounds, bajo el panel…).
   */
  qaTapHotspot(hotspot: HotspotData, opts: QaClick = {}): string | null {
    if (!hotspot.bounds) return 'no tiene bounds, ningún clic cae en él';
    const covers = new Set<string>();
    for (const p of this.hotspotProbePoints(hotspot)) {
      const { wx, wy, sy } = this.qaPoint(p.x, p.y);
      const hit = this.hitTestAt(wx, wy, sy, false);
      if (hit.kind === 'scene' && hit.hotspot === hotspot) {
        // A2.4: clic derecho y clics de ratón (doble clic) por el mismo camino que handlePointerDown
        if (opts.button === 'right') {
          this.lastClick = null;
          this.rightClickHit(hit);
          return null;
        }
        this.flashHotspot(hotspot);
        this.events.emit('hotspot:focus', hotspot);
        this.leftClickScene(hit.pct, hotspot, !!opts.mouse);
        return null;
      }
      covers.add(this.describeHit(hit));
    }
    return `ningún punto suyo recibe el clic (encima: ${[...covers].join(', ')})`;
  }

  /** Clic de ratón sobre un NPC con diálogo, buscando un punto de su hitbox que no tape otro NPC. */
  qaTapNpc(npcId: string, opts: QaClick = {}): string | null {
    const npc = this.npcs.find((n) => n.npcId === npcId && n.dialogueTreeId);
    if (!npc) return 'no existe o no tiene diálogo';
    const m = npc.getWorldTransformMatrix();
    const tx = m.tx;
    const ty = m.ty;
    const bodyW = (npc.width * npc.scale) / 2;
    const bodyH = npc.height * npc.scale;
    const cam = this.cameras.main;
    const covers = new Set<string>();
    for (const fy of [0.5, 0.25, 0.75, 0.05]) {
      for (const fx of [0, -0.5, 0.5]) {
        const wx = tx + fx * bodyW;
        const wy = ty - fy * bodyH;
        const hit = this.hitTestAt(wx, wy, wy - cam.scrollY, false);
        if (hit.kind === 'npc' && hit.npc === npc) {
          if (opts.button === 'right') {
            this.lastClick = null;
            this.rightClickHit(hit);
            return null;
          }
          if (opts.mouse) this.lastClick = null;
          const { scummUI, verb, selectedItem } = this.uiSelection();
          this.dispatchNpcTap(npc, verb, selectedItem, scummUI);
          return null;
        }
        covers.add(this.describeHit(hit));
      }
    }
    return `ningún punto de su sprite recibe el clic (encima: ${[...covers].join(', ')})`;
  }

  /** Clic de ratón en un punto del fondo (en %) con el verbo elegido: andar hasta allí. null si ha pulsado. */
  qaWalk(pctX: number, pctY: number): string | null {
    const { wx, wy, sy } = this.qaPoint(pctX, pctY);
    const hit = this.hitTestAt(wx, wy, sy, false);
    if (hit.kind === 'none') return `el punto cae en ${hit.reason}`;
    if (hit.kind === 'npc') return `el punto cae en el NPC ${hit.npc.npcId}: el clic abriría su diálogo`;
    const { scummUI, verb, selectedItem } = this.uiSelection();
    if (hit.hotspot) this.events.emit('hotspot:focus', hit.hotspot);
    this.dispatchTap(hit.pct, hit.hotspot, verb, selectedItem, scummUI);
    return null;
  }

  /** Triggers de la escena con bounds (para comprobar si el personaje llegó a pisarlos). */
  qaTriggers(): { id: string; bounds: { x: number; y: number; w: number; h: number } }[] {
    const data = this.registry.get('sceneData') as SceneData | undefined;
    return (data?.regions.triggers ?? []).flatMap((t) => (t.bounds ? [{ id: t.id, bounds: { ...t.bounds } }] : []));
  }

  /** Cambio de escena por el mismo camino que `gotoScene`/`fadeToScene` de los scripts. */
  qaGoto(sceneId: string, spawn?: { x: number; y: number }): void {
    this.buildScriptContext().gotoScene(sceneId, spawn);
  }

  qaIsHotspotVisible(hotspot: HotspotData): boolean {
    return this.isHotspotVisible(hotspot);
  }

  qaPlayer(): { x: number; y: number } {
    return { x: this.player.pctX, y: this.player.pctY };
  }

  /** A2.1: última ruta calculada (origen, puntos de paso y destino, en %) */
  qaPath(): { x: number; y: number }[] | null {
    return this.player.getLastPath();
  }

  /** A2.2: hacia dónde mira el personaje */
  qaFacing(): Facing {
    return this.player.getFacing();
  }

  /** A2.2: último acercamiento a un hotspot/NPC (null tras andar libremente o al entrar en la escena) */
  qaWalkTarget(): { target: string; verb: Verb; walkTo: { x: number; y: number } | null; face: Facing | null } | null {
    return this.lastApproach ? { ...this.lastApproach, walkTo: this.lastApproach.walkTo ? { ...this.lastApproach.walkTo } : null } : null;
  }

  /** A2.1: ¿se puede pisar el punto (en %)? walkableAreas menos blockedAreas */
  /** A2.12 (QA, demo a2-12-walk): punto de llegada para hablar con una NPC desde donde está el jugador (null = no anda) */
  qaPlanTalk(npcId: string): { x: number; y: number } | null {
    const npc = this.npcs.find(n => n.npcId === npcId);
    if (!npc) return null;
    const npcData = (this.registry.get('sceneData') as SceneData).npcs?.find(n => n.id === npcId);
    const target: ApproachTarget = { position: npc.pctPosition ?? undefined, walkTo: npcData?.walkTo, face: npcData?.face };
    return approachTalk(target, this.playerPct(), this.reachPct, this.facingOpts()).walkTo;
  }

  qaIsWalkable(pctX: number, pctY: number): boolean {
    return this.player.isWalkablePct(pctX, pctY);
  }

  /**
   * A2.3: cabeza y pies en pantalla de quien habla (`who` = 'player' o nombre/id de una NPC), para el texto sobre
   * la cabeza de UIScene (DialogueBox). null si no está en la escena o no se ve (hidePlayer, oculto, tráiler).
   */
  speakerHead(who: string): { id: string; x: number; headY: number; footY: number } | null {
    if (this.isTrailer) return null;
    const cam = this.cameras?.main;
    if (!cam) return null;
    // A2.10: con el zoom de una cinemática (pantalla = (mundo − scroll − centro)·zoom + centro)
    const view = { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom, width: cam.width, height: cam.height };
    const anchor = (id: string, x: number, topY: number, footY: number) => {
      const head = worldToScreen({ x, y: topY }, view);
      return { id, x: head.x, headY: head.y, footY: worldToScreen({ x, y: footY }, view).y };
    };
    if (who === 'player') {
      const p = this.player;
      if (!p?.active || !p.visible || p.alpha === 0) return null;
      // A4.1: sin la elevación del gesto: el texto no salta con el tween
      const footY = p.getFootY();
      return anchor('player', p.x, footY - p.displayHeight, footY);
    }
    const key = who.trim().toLowerCase();
    const npc = this.npcs.find((n) => n.active && n.visible && (n.npcId.toLowerCase() === key || n.npcName.toLowerCase() === key));
    if (!npc) return null;
    const h = npc.height * npc.scaleY;
    return anchor(npc.npcId, npc.x, npc.y - h, npc.y);
  }

  /** A2.10 (QA): estado del sistema de cinemáticas */
  qaCinematic(): CinematicQaState | null {
    return this.cinema?.qaState() ?? null;
  }

  /**
   * A2.10 (QA): ejecuta un script arbitrario por el ScriptEngine principal (el mismo que hotspots y onEnter). Se
   * resuelve cuando termina; si el motor está ocupado, se encola detrás (y se resuelve al encolarlo: la API espera).
   */
  qaRunScript(ops: import('@/types/scene.types').ScriptOp[]): Promise<void> {
    this.scriptEngine.updateContext(this.buildScriptContext());
    return this.scriptEngine.execute(ops, 'qa/runScript').finally(() => {
      this.inputCooldownFrames = 2;
    });
  }

  /**
   * A2.8: filtro LINEAR para el arte de la escena: fondos de 3712×1152 pintados a ≈ 5 px por píxel de arte que se
   * reducen a ×0,25-0,7. En nearest se pierden muestras: los cables y bordes de 1 píxel de arte salen a trozos y los
   * tramados hacen moiré al mover la cámara. En lineal se ven continuos (capturas en la PR de A2.8). Los personajes
   * (escala ≥ 1, entera cuando se puede) siguen en NEAREST, el de `pixelArt: true`. bgFill usa la misma textura.
   */
  private applySceneArtFilter(sceneId: string, sceneData: SceneData): void {
    const keys = [`bg_${sceneId}`, `fg_${sceneId}`, ...(sceneData.conditionalOverlays ?? []).map((co) => `overlay_${sceneId}_${co.id}`)];
    for (const v of sceneData.web3Visuals ?? []) keys.push(v.defaultSprite, ...(v.variants ?? []).map((x) => x.sprite));
    for (const key of keys) {
      if (this.textures.exists(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
  }

  /** P1: coloca y escala a Dex sentado como al jugador (unidad de píxel × escala del fondo × profundidad) */
  private placeSeatedDex(): void {
    const sd = this.seatedDex;
    if (!sd) return;
    const p = this.coordSystem.pctToScreen(sd.x, sd.y);
    sd.img.setPosition(p.x, p.y);
    sd.img.setScale(spriteScale({
      pixelScale: this.player.getPixelScale(), coordScale: this.coordSystem.getScale(), depth: this.player.getDepthScale(), yPct: sd.y,
    }).scale);
  }

  /**
   * A2.8: escala de una NPC: la unidad de píxel de la escena × su artScale × la escala del fondo (redondeada a un
   * entero de pantalla cuando se puede) × el factor de profundidad en la y de sus pies (src/systems/PixelScale.ts).
   */
  private npcPixelScale(npc: NPC): number {
    return spriteScale({
      pixelScale: this.player.getPixelScale(),
      artScale: npc.artScale,
      coordScale: this.coordSystem.getScale(),
      depth: this.player.getDepthScale(),
      yPct: npc.pctPosition?.y ?? 100,
    }).scale;
  }

  /**
   * A2.8: ¿el punto del mundo cae en el hitbox de la NPC? Su hoja (ancho × alto en píxeles de arte, pies abajo en el
   * centro) más 10 píxeles de arte por debajo de los pies. Es la inversa de la escala, así vale con cualquier escala.
   */
  private npcHit(npc: NPC, wx: number, wy: number): boolean {
    const m = npc.getWorldTransformMatrix();
    return worldToArt({ x: wx, y: wy }, { x: m.tx, y: m.ty }, npc.scale, npc.width, npc.height, 10).inside;
  }

  /**
   * A2.8 (QA): densidad de píxel: unidad de la escena, escala del jugador (píxeles de pantalla por píxel de arte), si
   * es entera, factor de profundidad, alto del jugador en % del fondo (en pantalla y del mundo) y escala de cada NPC.
   */
  qaPixel(): {
    pixelScale: number; playerScale: number; playerBase: number; snapped: boolean; integer: boolean; depth: number;
    playerHeightPct: number; worldHeightPct: number; coordScale: number;
    npcs: { id: string; scale: number; integer: boolean; heightPct: number }[];
  } {
    const info = this.player.getScaleInfo();
    const bgH = this.coordSystem.bgH;
    const pct = (px: number) => (bgH > 0 ? Math.round((px / bgH) * 10000) / 100 : 0);
    return {
      pixelScale: this.player.getPixelScale(),
      playerScale: info.scale,
      playerBase: info.base,
      snapped: info.snapped,
      integer: isIntegerScale(this.player.scaleY),
      depth: info.depth,
      playerHeightPct: pct(this.player.displayHeight),
      worldHeightPct: Math.round(this.player.getWorldHeightPct() * 100) / 100,
      coordScale: this.coordSystem.getScale(),
      npcs: this.npcs.map((n) => ({ id: n.npcId, scale: n.scaleY, integer: isIntegerScale(n.scaleY), heightPct: pct(n.height * n.scaleY) })),
    };
  }

  /** A4.1 (QA): animación del jugador (textura, dirección, hablar, gesto, tics, disfraz, giro y escala) */
  qaAnim(): PlayerAnimQa {
    return this.player.getAnimState();
  }

  /** A4.4 (QA): pasos dados en esta escena, superficie bajo los pies ahora y el último paso que sonó */
  qaFootsteps(): { count: number; surface: string | null; last: { surface: string | null; key: string | null; at: number } | null } {
    const audio = (this.registry.get('sceneData') as SceneData | undefined)?.audio;
    return {
      count: this.player.getFootstepCount(),
      surface: surfaceAt(audio, this.player.pctX, this.player.pctY),
      last: this.lastFootstep ? { ...this.lastFootstep } : null,
    };
  }

  /** A4.1 (QA): enseña el juego de sprites del disfraz ('ape') o el normal sin tocar inventario ni flags; null = el de la partida */
  qaPreviewCostume(costume: 'ape' | 'player' | null): void {
    this.player.setCostumePreview(costume);
  }

  qaNpcIds(): string[] {
    return this.npcs.filter((n) => n.dialogueTreeId).map((n) => n.npcId);
  }

  /** A2.4: ids de los hotspots y NPC resaltados con Tab ahora mismo (vacío sin Tab pulsado) */
  qaHighlighted(): string[] {
    return this.highlight ? [...this.highlight.ids] : [];
  }

  private removeViewportListeners(): void {
    if (!this.boundScheduleResize) return;
    window.removeEventListener('orientationchange', this.boundScheduleResize);
    window.removeEventListener('resize', this.boundScheduleResize);
    const vv = window.visualViewport;
    if (vv) vv.removeEventListener('resize', this.boundScheduleResize);
    this.boundScheduleResize = null;
  }

  /**
   * A1.10: enganchado a SHUTDOWN en create() (`bindShutdown`). Idempotente: llamarlo dos veces no rompe. Cuando
   * llega, los plugins de la escena ya han destruido cámaras, objetos, tweens y relojes (ver lifecycle.ts).
   */
  /** A3.10 (QA): estado del dashboard del Mining Rig */
  getDashboardQa(): DashboardQaState {
    return this.dashboardPanel?.qaState() ?? { open: false, phase: null, rows: [], status: null, tip: null };
  }

  shutdown(): void {
    // A1.4: corta un flicker en marcha (el contexto ya no toca overlays de la escena que viene). A2.10: y cierra la
    // cinemática de estos motores; el director suelta sus animaciones (la escena nueva arranca sin franjas)
    this.cinema?.destroy();
    this.cinema = undefined;
    // A3.10: el dashboard del rig se cierra con la escena (su script, si sigue vivo, continúa y lo corta el cambio)
    this.dashboardPanel?.destroy();
    this.dashboardPanel = null;
    this.registry.set('dashboardOpen', false);
    failResponses.onFail = null;
    this.scriptEngine?.cancelEffects();
    this.dialogueScripts?.cancelEffects();
    this.overlayOverrides.clear();
    this.cancelTouchHold();
    this.endFastForward();
    // A2.4: teclado, lienzo y resaltado de Tab
    this.unbindDesktopInput();
    this.hideHighlights();
    this.lastClick = null;
    // Listeners fuera de la escena: ScaleManager (global), UIScene, window y visualViewport
    this.scale.off('resize', this.handleResize, this);
    this.scene.get('UIScene')?.events.off('panel:toggled', this.handleResize, this);
    this.input.off('pointerdown', this.handlePointerDown, this);
    this.input.off('pointermove', this.handlePointerMove, this);
    this.removeViewportListeners();
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.cinematicOverlay?.destroy();
    this.transactionToast?.destroy();
    this.web3VisualSystem?.destroy();
    this.web3VisualSystem = undefined;
    // A4.3: sus Graphics e Images ya los destruyó la escena; solo se sueltan referencias
    this.ambient?.destroy();
    this.ambient = undefined;
    this.walletUnsub?.();
    this.walletUnsub = null;
    if (this.activeCameraEffect) {
      // La cámara principal ya no existe si el CameraManager se cerró antes (siempre, al venir de SHUTDOWN)
      this.cameras.main?.removePostPipeline('AnaglyphPipeline');
      this.activeCameraEffect = null;
    }
  }
}

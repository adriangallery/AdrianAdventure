import Phaser from 'phaser';
import { achievementDecision, POLL_MS as ACH_POLL_MS, type ScreenBusy, type Rect } from '@/ui/achievementLayout';
import { ScummUI } from '@/ui/ScummUI';
import { DialogueBox, type SpeechState } from '@/ui/DialogueBox';
import { ChoicePanel } from '@/ui/ChoicePanel';
import { WalletButton } from '@/ui/WalletButton';
import { SaveButton } from '@/ui/SaveButton';
import { VerbWheel } from '@/ui/VerbWheel';
import { CinematicOverlay } from '@/ui/CinematicOverlay';
import { BadgePanel } from '@/ui/BadgePanel';
import { JournalPanel } from '@/ui/JournalPanel';
import { DialogueSystem, type DialogueTree } from '@/systems/DialogueSystem';
import { VoiceSystem } from '@/systems/VoiceSystem';
import { sfxOf } from '@/systems/Sfx';
import type { InventorySystem } from '@/systems/InventorySystem';
import type { SceneData, HotspotData, ScriptOp } from '@/types/scene.types';
import type { Verb, GameState } from '@/types/game.types';
import type { GameScene } from './GameScene';
import { WEB3_ENABLED } from '@/config/platform';
import { getAchievementByText } from '@/config/achievements.config';
import { VOICE_TEXT_MAP, NARRATOR_SEQUENCES } from '@/config/voice.config';
import { getWalletState } from '@/web3/wallet';
import { loadPatientFile } from '@/web3/tx-history';
import { checkGatingRule, gateAddress, type GatingRule } from '@/web3/gating';
import type { Address } from 'viem';
import { bindShutdown } from './lifecycle';
import { TITLE_CARD_AUTO_MS, subtitleHoldMs } from '@/systems/Cinematics';
import { charDelayMs } from '@/systems/Settings';
import { failResponses } from '@/systems/FailResponsesData';

/**
 * UI overlay — LucasArts SCUMM-style bottom panel.
 */
export class UIScene extends Phaser.Scene {
  private scummUI!: ScummUI;
  private verbWheel!: VerbWheel;
  private dialogueBox!: DialogueBox;
  private choicePanel!: ChoicePanel;
  /** A9.3: logros esperando a que la pantalla quede libre */
  private achievementQueue: string[] = [];
  private achievementPumping = false;
  private walletButton!: WalletButton;
  private saveButton!: SaveButton;
  private dialogueSystem!: DialogueSystem;
  private voiceSystem!: VoiceSystem;
  private cinematicOverlay!: CinematicOverlay;
  private badgePanel!: BadgePanel;
  /** A2.9: el diario (móvil de Dex): botón en la barra de arriba y panel con objetivos, notas y «Call Anon» */
  private journal!: JournalPanel;
  private isMobile = false;
  /** A2.10: objetos de la interfaz que oculta el modo cinemática (y que vuelve a enseñar al salir) */
  private hiddenChrome: Phaser.GameObjects.GameObject[] | null = null;
  /** A2.10: temporizador del subtítulo de cinemática que avanza solo */
  private subtitleTimer: Phaser.Time.TimerEvent | null = null;

  /** Eventos de GameScene que escucha UIScene (se re-registran en cada create) */
  private static readonly GAME_SCENE_EVENTS = ['hotspot:tapped', 'hotspot:focus', 'hotspot:hover', 'npc:tapped'];
  /** Eventos propios que escucha UIScene (se re-registran en cada create) */
  private static readonly OWN_EVENTS = [
    'say', 'sayBrief', 'startDialogue', 'showTitleCard', 'showMonitorReveal', 'showNarrative', 'showAchievement', 'showCredits', 'scene:changed',
  ];

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // A1.10: GameScene para UIScene (scene.stop) en cada cambio de escena y la relanza (scene.launch) en su create():
    // todo lo que se crea aquí se limpia en shutdown(), que Phaser no llama solo
    bindShutdown(this);
    const inventorySystem = this.registry.get('inventorySystem') as InventorySystem;

    const { width, height } = this.scale;
    this.isMobile = height > width || Math.min(width, height) < 600;

    // SCUMM UI panel
    this.scummUI = new ScummUI(this);
    this.scummUI.setInventory(inventorySystem);

    // VerbWheel — mobile-first radial menu for hotspot interaction
    this.verbWheel = new VerbWheel(this);

    // Dialogue box (overlays on top of panel). A2.3: el texto va sobre la cabeza de quien habla (GameScene la da)
    this.dialogueBox = new DialogueBox(this, (who) => {
      if (!this.scene.isActive('GameScene')) return null;
      return (this.scene.get('GameScene') as GameScene).speakerHead(who);
    });
    this.choicePanel = new ChoicePanel(this);

    // Wallet button (top-right, small) — hidden on Steam where Web3 is disabled
    if (WEB3_ENABLED) {
      this.walletButton = new WalletButton(this);
      this.walletButton.setInventory(inventorySystem);
    }

    // Save button (top-right, next to wallet)
    this.saveButton = new SaveButton(this);

    // Voice system — plays audio clips alongside dialogue text
    this.voiceSystem = new VoiceSystem(this);
    this.voiceSystem.registerAll(VOICE_TEXT_MAP);
    this.registry.set('voiceSystem', this.voiceSystem);

    // Dialogue system
    this.dialogueSystem = new DialogueSystem({
      say: (text, speaker) => {
        this.voiceSystem.play(text);
        // A3.3e: la QA (`window.__qa`, `rejects` de las rutas) apunta también las frases de los nodos de diálogo
        this.events.emit('dialogueLine', text, speaker);
        return this.dialogueBox.say(text, speaker);
      },
      showChoices: (choices) => this.choicePanel.show(choices),
      checkGating: async (rule: GatingRule) => {
        const address = gateAddress(); // A3.10: cartera real o la simulada de __qa.mockWeb3
        if (!address) return false;
        return checkGatingRule(address as Address, rule);
      },
      getFlag: (flag) => {
        const state = this.registry.get('gameState');
        return state?.flags?.[flag] ?? false;
      },
      setFlag: (flag, value) => {
        const state = this.registry.get('gameState');
        if (state) {
          state.flags[flag] = value;
          this.registry.set('gameState', state);
        }
      },
      // A2.6a: condiciones `item:` de las elecciones
      hasItem: (itemId) => (this.registry.get('inventorySystem') as InventorySystem | undefined)?.hasItem(itemId) ?? false,
      // A2.6: opciones usadas, en la partida (GameState.dialogueUsed, por árbol)
      isChoiceUsed: (treeId, key) => {
        const state = this.registry.get('gameState') as GameState | undefined;
        return state?.dialogueUsed?.[treeId]?.includes(key) ?? false;
      },
      markChoiceUsed: (treeId, key) => {
        const state = this.registry.get('gameState') as GameState | undefined;
        if (!state) return;
        if (!state.dialogueUsed) state.dialogueUsed = {};
        const list = state.dialogueUsed[treeId] ?? (state.dialogueUsed[treeId] = []);
        if (!list.includes(key)) list.push(key);
        this.registry.set('gameState', state);
      },
      // A1.9: los onEnter de nodo se ejecutan con todos los opcodes de ScriptEngine, en el motor de diálogo de
      // GameScene (aparte del principal: un diálogo lanzado por el op `dialogue` de un script en curso no se bloquea)
      runScripts: (ops, where) => {
        const gs = this.scene.get('GameScene') as GameScene;
        return gs.runDialogueScripts(ops as ScriptOp[], where);
      },
      onDialogueComplete: (treeId) => {
        const state = this.registry.get('gameState') as import('@/types/game.types').GameState | undefined;
        if (state) {
          if (!state.dialogueProgress) state.dialogueProgress = {};
          // Find which NPC this tree belongs to
          const sceneData = this.registry.get('sceneData') as SceneData | undefined;
          const npc = sceneData?.npcs?.find(n => n.dialogueTreeId === treeId);
          const key = npc?.id ?? '_script';
          if (!state.dialogueProgress[key]) state.dialogueProgress[key] = [];
          if (!state.dialogueProgress[key].includes(treeId)) {
            state.dialogueProgress[key].push(treeId);
          }
          this.registry.set('gameState', state);
        }
      },
    });

    // Cinematic overlay (for scripts running from UIScene context)
    this.cinematicOverlay = new CinematicOverlay(this);

    // Badge panel (trophy button for viewing/minting achievements)
    this.badgePanel = new BadgePanel(this);

    // A2.9: diario = móvil de Dex (a la derecha del botón de trofeos). No se abre con cinemática, diálogo, texto,
    // script en marcha ni cambio de escena; las notas se apuntan solas en cuanto se cumple su condición (refresh)
    this.journal = new JournalPanel(this, {
      blockedReason: () => this.journalBlockedReason(),
      playVoice: (text) => this.voiceSystem.play(text),
      stopVoice: () => this.voiceSystem.stop(),
      skipText: () => (this.journalBlockedReason() === 'texto en pantalla' || this.journalBlockedReason() === 'script en marcha')
        && this.skipBark(),
    });
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.journal?.refresh() });

    // Store panel height for GameScene camera adjustment
    this.registry.set('scummPanelHeight', this.scummUI.getPanelHeight());

    // --- Item-to-item combo handler ---
    this.scummUI.onCombo((item1, item2) => {
      const globalConfig = this.cache.json.get('globalConfig') as { itemCombos?: Array<{ item1: string; item2: string; result: string | null; script: ScriptOp[] }> } | null;
      const combos = globalConfig?.itemCombos ?? [];
      const match = combos.find(c =>
        (c.item1 === item1.id && c.item2 === item2.id) ||
        (c.item1 === item2.id && c.item2 === item1.id)
      );
      if (match) {
        const gs = this.scene.get('GameScene') as GameScene;
        gs.executeItemComboScript(match.script);
      } else {
        // A2.5: pareja específica (fail-responses.json itemItem.pairs) o bolsa general, sin repetir la última
        this.events.emit('say', failResponses.itemOnItem(item1.id, item2.id).text);
      }
    });

    // --- Event listeners ---
    const gameScene = this.scene.get('GameScene');

    // A0.1 (hallazgo del walkthrough): los emisores de eventos de GameScene y UIScene sobreviven a stop/launch
    // y create() se ejecuta en cada cambio de escena (desde A1.10 shutdown() también los quita). Sin esto cada
    // escena nueva añadía otra copia de estos listeners: en la escena N cada acción se ejecutaba N veces, y el
    // sayBrief duplicado de un cambio de escena dejaba `dialogueShowing` colgado y la escena siguiente sin
    // aceptar toques. También se limpia el estado de texto/diálogo que pudo quedar de la escena anterior.
    for (const ev of UIScene.GAME_SCENE_EVENTS) gameScene.events.removeAllListeners(ev);
    for (const ev of UIScene.OWN_EVENTS) this.events.removeAllListeners(ev);
    this.registry.set('dialogueShowing', false);
    this.registry.set('dialogueActive', false);
    this.registry.set('cinematicActive', 0);
    this.hiddenChrome = null;
    this.subtitleTimer = null;

    // Hotspot tapped → execute selected verb (SCUMM style)
    gameScene.events.on('hotspot:tapped', (hotspot: HotspotData, verbOverride?: Verb) => {
      // V6: el toque (mirar) o el mantener pulsado (acción principal) traen su verbo; si no, el del panel
      const verb = verbOverride ?? this.scummUI.getSelectedVerb();
      const gs = this.scene.get('GameScene') as GameScene;
      gs.executeHotspotVerb(hotspot, verb);
    });

    // V6: panel contextual — resalta los verbos que hacen algo con el objeto enfocado y atenúa los que no tienen respuesta
    gameScene.events.on('hotspot:focus', (hotspot: HotspotData) => this.scummUI.setContextHotspot(hotspot));

    // Hotspot hover → update action line
    gameScene.events.on('hotspot:hover', (name: string | null) => {
      this.scummUI.setHoveredObject(name);
    });

    // NPC tapped → start dialogue with talk animation
    // A2.6: `startNode` (opcional) = nodo de entrada (NPC que reacciona a un objeto, `itemDialogues`)
    gameScene.events.on('npc:tapped', (npcId: string, treeId: string, startNode?: string) => {
      // Prevent double-triggering while dialogue is active
      if (this.registry.get('dialogueActive')) return;
      sfxOf(this)?.play('npc_talk', { volume: 0.4 });
      // A4.2: la NPC se gira hacia el jugador durante la charla; la boca ya no se mueve todo el diálogo a 200 ms fijos,
      // solo con sus frases y al ritmo de su voz (GameScene.updateNpcLife)
      const npcs = (gameScene as unknown as { npcs?: import('@/objects/NPC').NPC[] }).npcs;
      npcs?.find((n) => n.npcId === npcId)?.engage();
      this.registry.set('dialogueActive', true);
      this.startDialogueFromScene(treeId, startNode).finally(() => {
        this.registry.set('dialogueActive', false);
      });
    });

    // Say requests from ScriptEngine
    this.events.on('say', (text: string, speaker?: string, resolve?: () => void) => {
      // A2.9: un texto hablado (p. ej. un trigger con temporizador) cierra el diario: el móvil no tapa a quien habla
      this.journal?.close();
      this.voiceSystem.play(text);
      const shown = this.dialogueBox.say(text, speaker);
      // A2.10: en cinemática el texto avanza solo al ritmo de su voz (o por caracteres); un toque lo adelanta
      if (this.registry.get('cinematicMode')) this.autoAdvance(text, shown);
      shown.then(() => {
        this.voiceSystem.stop();
        resolve?.();
      });
    });

    // Brief say (auto-dismiss, no click)
    this.events.on('sayBrief', (text: string, durationMs?: number, speaker?: string, resolve?: () => void) => {
      this.dialogueBox.sayBrief(text, durationMs, speaker).then(() => resolve?.());
    });

    // Dialogue requests (from ScriptEngine opcode)
    this.events.on('startDialogue', (_npcId: string, treeId: string) => {
      this.journal?.close();
      this.registry.set('dialogueActive', true);
      this.startDialogueFromScene(treeId).finally(() => {
        this.registry.set('dialogueActive', false);
      });
    });

    // Cinematic events (so scripts running from UIScene context can trigger them)
    this.events.on('showTitleCard', async (chapter: string, title: string, subtitle?: string, resolve?: () => void) => {
      sfxOf(this)?.play('chapter_transition', { volume: 0.4 });
      // Title card narration disabled for now (kept for potential re-enable)
      // const sceneId = this.registry.get('currentSceneId') as string;
      // const narKeys = NARRATOR_SEQUENCES[`${sceneId}:titleCard`];
      // if (narKeys) this.voiceSystem.playSequence(narKeys);
      // A3.2: dentro de una cinemática del motor la tarjeta se cierra sola (como los subtítulos); fuera, con un toque
      const autoMs = this.registry.get('cinematicMode') ? TITLE_CARD_AUTO_MS : undefined;
      await this.duringCinematic(this.cinematicOverlay.showTitleCard(chapter, title, subtitle, autoMs));
      this.voiceSystem.stop();
      resolve?.();
    });

    // V6b: el expediente se pide al abrir la cinemática; la lluvia arranca ya y el texto llega al resolver
    this.events.on('showMonitorReveal', async (resolve?: () => void) => {
      const { address } = getWalletState();
      await this.duringCinematic(this.cinematicOverlay.showMonitorReveal(loadPatientFile(address)));
      resolve?.();
    });

    this.events.on('showNarrative', async (lines: string[], resolve?: () => void) => {
      const sceneId = this.registry.get('currentSceneId') as string;
      const narKeys = NARRATOR_SEQUENCES[`${sceneId}:narrative`];
      if (narKeys) this.voiceSystem.playSequence(narKeys);
      await this.duringCinematic(this.cinematicOverlay.showNarrative(lines));
      this.voiceSystem.stop();
      resolve?.();
    });

    this.events.on('showAchievement', (text: string) => {
      // Track achievement in gameState
      const achDef = getAchievementByText(text);
      if (achDef) {
        const state = this.registry.get('gameState') as GameState | undefined;
        if (state) {
          if (!state.achievements) state.achievements = [];
          if (!state.achievements.includes(achDef.id)) {
            state.achievements.push(achDef.id);
            this.registry.set('gameState', state);
          }
        }
      }
      // A9.3: a la cola; sale cuando no hay frase, diálogo ni cinemática en pantalla
      this.achievementQueue.push(text);
      this.pumpAchievements();
    });

    // Rolling end credits
    this.events.on('showCredits', (resolve?: () => void) => {
      const state = this.registry.get('gameState') as GameState | undefined;
      const earned = state?.achievements ?? [];
      this.duringCinematic(this.cinematicOverlay.showCredits(earned)).then(() => resolve?.());
    });

    // Scene change refresh
    this.events.on('scene:changed', () => {
      // Nothing to refresh — panel persists
    });
  }

  /**
   * A1.1: cuenta la cinemática como «en pantalla» (registry `cinematicActive`) mientras dura, para que el
   * watchdog de scripts de GameScene no corra durante una tarjeta de capítulo, una narración o los créditos.
   */
  private async duringCinematic(shown: Promise<void>): Promise<void> {
    this.registry.set('cinematicActive', ((this.registry.get('cinematicActive') as number | undefined) ?? 0) + 1);
    try {
      await shown;
    } finally {
      this.registry.set('cinematicActive', Math.max(0, ((this.registry.get('cinematicActive') as number | undefined) ?? 1) - 1));
    }
  }

  /**
   * A2.10: subtítulo de cinemática. Se cierra solo cuando acaba su clip de voz (más un margen) o, sin voz, cuando
   * ha dado tiempo a escribirlo y leerlo (`subtitleHoldMs`). Mientras la voz se descarga o suena, espera (con tope).
   */
  private autoAdvance(text: string, shown: Promise<void>): void {
    this.subtitleTimer?.remove();
    const startedAt = this.time.now;
    let done = false;
    void shown.then(() => { done = true; });
    const timer = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (done || !this.dialogueBox) { timer.remove(); return; }
        const elapsed = this.time.now - startedAt;
        const clip = this.voiceSystem.clipInfo();
        const byChars = subtitleHoldMs(text.length, charDelayMs(), null);
        // Voz descargándose o sonando: se espera, con un tope por si nunca acaba
        if ((clip.loading || clip.playing) && elapsed < byChars + 8000) return;
        if (elapsed < subtitleHoldMs(text.length, charDelayMs(), clip.durationMs)) return;
        timer.remove();
        this.dialogueBox.advanceIfShowing(text);
      },
    });
    this.subtitleTimer = timer;
  }

  /**
   * A2.10: modo cinemática. `hidden` oculta toda la interfaz de esta escena (panel SCUMM, botones Save/Wallet,
   * trofeos, rueda de verbos) salvo el texto hablado, las elecciones de diálogo, las cinemáticas a pantalla
   * completa (profundidad ≥ 1000) y lo que pase en `keep` (franjas, iris). Al quitarlo vuelve a enseñar solo lo que
   * ocultó. Lo oculto no recibe toques (Phaser no da entrada a objetos invisibles). Idempotente.
   */
  setCinematicChrome(hidden: boolean, keep: Phaser.GameObjects.GameObject[] = []): void {
    if (hidden) {
      // A2.9: el diario no se queda abierto encima de una cinemática
      this.journal?.close();
      if (this.hiddenChrome) return;
      const skip = new Set<Phaser.GameObjects.GameObject>([...keep, ...(this.dialogueBox?.getObjects() ?? [])]);
      const root = this.choicePanel?.getRoot();
      if (root) skip.add(root);
      const out: Phaser.GameObjects.GameObject[] = [];
      for (const o of this.children.list) {
        const v = o as unknown as { visible?: boolean; depth?: number; setVisible?: (b: boolean) => unknown };
        if (skip.has(o) || !v.visible || !v.setVisible || (v.depth ?? 0) >= 1000) continue;
        v.setVisible(false);
        out.push(o);
      }
      this.hiddenChrome = out;
      return;
    }
    const list = this.hiddenChrome;
    this.hiddenChrome = null;
    for (const o of list ?? []) {
      if (o.active) (o as unknown as { setVisible: (b: boolean) => unknown }).setVisible(true);
    }
  }

  /** A2.10: ¿está la interfaz oculta por una cinemática? (QA) */
  isChromeHidden(): boolean {
    return !!this.hiddenChrome;
  }

  /** A2.10: salto de cinemática: cierra el texto hablado en pantalla al momento. */
  skipSpeech(): void {
    this.subtitleTimer?.remove();
    this.subtitleTimer = null;
    this.dialogueBox?.skip();
  }

  /** A0.1 (QA): panel SCUMM y panel de elecciones, para la API de QA (?qa=1). */
  getScummUI(): ScummUI { return this.scummUI; }
  getChoicePanel(): ChoicePanel { return this.choicePanel; }
  /** A2.3 (QA): texto hablado en pantalla y su colocación (null si no hay). */
  getSpeech(): SpeechState | null { return this.dialogueBox?.getSpeech() ?? null; }

  /** A0.5: botón interactivo bajo ese punto de pantalla (se queda el clic antes que GameScene), o null. */
  uiButtonAt(x: number, y: number): string | null {
    if (this.saveButton?.contains(x, y)) return 'el botón Save';
    if (this.walletButton?.contains(x, y)) return 'el botón Wallet';
    if (this.journal?.containsButton(x, y)) return 'el botón del diario';
    return null;
  }

  /**
   * A1.14: cierra la frase suelta en pantalla (no cinemática, no árbol de diálogo, sin elección pendiente) sin esperar
   * al tiempo mínimo de lectura. true si cerró una.
   */
  skipBark(): boolean {
    if (!this.dialogueBox?.isVisible()) return false;
    if (this.registry.get('cinematicMode') || ((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0) return false;
    if (this.registry.get('dialogueActive') || this.choicePanel?.isAwaitingChoice()) return false;
    this.dialogueBox.skip();
    return true;
  }

  /** A9.3: qué ocupa la pantalla ahora (la franja de logro espera a que no haya nada). */
  private screenBusy(): ScreenBusy {
    return {
      speech: !!this.registry.get('dialogueShowing') || !!this.dialogueBox?.isVisible(),
      dialogue: !!this.registry.get('dialogueActive'),
      choices: !!this.choicePanel?.isAwaitingChoice(),
      cinematic: !!this.registry.get('cinematicMode') || ((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0,
      transition: !!this.registry.get('sceneTransition'),
    };
  }

  /** A9.3: saca los logros de la cola de uno en uno, cada uno cuando la pantalla está libre. */
  private async pumpAchievements(): Promise<void> {
    if (this.achievementPumping) return;
    this.achievementPumping = true;
    try {
      while (this.achievementQueue.length > 0) {
        const t0 = this.time.now;
        while (achievementDecision(this.screenBusy(), this.time.now - t0) === 'wait') {
          await new Promise<void>((r) => this.time.delayedCall(ACH_POLL_MS, r));
          if (!this.sys.isActive()) return;
        }
        const text = this.achievementQueue.shift()!;
        const panelH = (this.registry.get('scummPanelHeight') as number | undefined) ?? 0;
        await this.cinematicOverlay.showAchievement(text, panelH);
      }
    } finally {
      this.achievementPumping = false;
    }
  }

  /** A9.3: caja de la franja de logro visible (null si no hay) y logros en cola, para la demo. */
  getAchievementStatus(): { rect: Rect | null; queued: number } {
    return { rect: this.cinematicOverlay?.lastAchievementRect ?? null, queued: this.achievementQueue.length };
  }

  /** A2.9: el diario (GameScene lo abre y cierra con J/Esc; la API de QA lo lee). */
  getJournal(): JournalPanel { return this.journal; }

  /** A2.9: por qué no se puede abrir el diario ahora (null = se puede). */
  private journalBlockedReason(): string | null {
    if (this.hiddenChrome || this.registry.get('cinematicMode') || ((this.registry.get('cinematicActive') as number | undefined) ?? 0) > 0) return 'cinemática';
    if (this.registry.get('dialogueActive') || this.choicePanel?.isAwaitingChoice()) return 'diálogo';
    if (this.registry.get('dialogueShowing')) return 'texto en pantalla';
    if (this.registry.get('sceneTransition')) return 'cambio de escena';
    if (!this.scene.isActive('GameScene')) return 'sin partida';
    if ((this.scene.get('GameScene') as GameScene).qaBusy().script) return 'script en marcha';
    return null;
  }

  private async startDialogueFromScene(treeId: string, startNode?: string): Promise<void> {
    const sceneData = this.registry.get('sceneData') as SceneData;
    const treeData = sceneData.dialogues?.[treeId];
    if (!treeData) {
      this.events.emit('dialogueComplete');
      return;
    }

    const tree: DialogueTree = {
      id: treeData.id,
      start: treeData.start,
      nodes: {},
    };

    for (const [nodeId, nodeData] of Object.entries(treeData.nodes)) {
      tree.nodes[nodeId] = {
        speaker: nodeData.speaker,
        text: nodeData.text,
        next: nodeData.next,
        end: nodeData.end,
        onEnter: nodeData.onEnter,
        when: nodeData.when,
        choices: nodeData.choices?.map((c) => ({
          id: c.id,
          text: c.text,
          next: c.next,
          gate: c.gate as import('@/web3/gating').GatingRule | undefined,
          flag: c.flag,
          setFlag: c.setFlag,
          when: c.when,
          hideIfLocked: c.hideIfLocked,
          once: c.once,
          exit: c.exit,
        })),
      };
    }

    if (startNode && !tree.nodes[startNode]) {
      console.warn(`UIScene: el nodo «${startNode}» no está en el árbol «${treeId}»; se empieza por «${tree.start}»`);
      startNode = undefined;
    }

    try {
      await this.dialogueSystem.run(tree, startNode);
    } finally {
      // A1.9: el cambio de escena aplazado de un onEnter se aplica al cerrar el árbol
      (this.scene.get('GameScene') as GameScene).finishDialogueScripts();
    }
    this.voiceSystem.stop();
    this.events.emit('dialogueComplete');
  }

  /**
   * A1.10: enganchado a SHUTDOWN en create() (`bindShutdown`). Idempotente. Quita los listeners del ScaleManager
   * (global) de ScummUI, DialogueBox y WalletButton, la suscripción a la wallet, los temporizadores y la voz en
   * curso, y los listeners que esta escena puso en los eventos de GameScene y en los suyos.
   */
  shutdown(): void {
    this.subtitleTimer?.remove();
    this.subtitleTimer = null;
    this.hiddenChrome = null;
    this.voiceSystem?.destroy();
    this.scummUI?.destroy();
    this.verbWheel?.destroy();
    this.dialogueBox?.destroy();
    this.choicePanel?.destroy();
    this.walletButton?.destroy();
    this.cinematicOverlay?.destroy();
    this.badgePanel?.destroy();
    this.journal?.destroy();
    const gameScene = this.scene.get('GameScene');
    if (gameScene) for (const ev of UIScene.GAME_SCENE_EVENTS) gameScene.events.removeAllListeners(ev);
    for (const ev of UIScene.OWN_EVENTS) this.events.removeAllListeners(ev);
  }
}

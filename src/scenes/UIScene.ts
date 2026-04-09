import Phaser from 'phaser';
import { ScummUI, SCUMM_PANEL_MIN_HEIGHT } from '@/ui/ScummUI';
import { DialogueBox } from '@/ui/DialogueBox';
import { ChoicePanel } from '@/ui/ChoicePanel';
import { WalletButton } from '@/ui/WalletButton';
import { VerbWheel } from '@/ui/VerbWheel';
import { CinematicOverlay } from '@/ui/CinematicOverlay';
import { DialogueSystem, type DialogueTree } from '@/systems/DialogueSystem';
import type { InventorySystem } from '@/systems/InventorySystem';
import type { SceneData, HotspotData } from '@/types/scene.types';
import type { Verb } from '@/types/game.types';
import type { GameScene } from './GameScene';
import { getWalletState } from '@/web3/wallet';
import { checkGatingRule, type GatingRule } from '@/web3/gating';
import type { Address } from 'viem';

/**
 * UI overlay — LucasArts SCUMM-style bottom panel.
 */
export class UIScene extends Phaser.Scene {
  private scummUI!: ScummUI;
  private verbWheel!: VerbWheel;
  private dialogueBox!: DialogueBox;
  private choicePanel!: ChoicePanel;
  private walletButton!: WalletButton;
  private dialogueSystem!: DialogueSystem;
  private cinematicOverlay!: CinematicOverlay;
  private isMobile = false;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    const sceneData = this.registry.get('sceneData') as SceneData;
    const inventorySystem = this.registry.get('inventorySystem') as InventorySystem;

    const { width, height } = this.scale;
    this.isMobile = height > width || Math.min(width, height) < 600;

    // SCUMM UI panel
    this.scummUI = new ScummUI(this);
    this.scummUI.setInventory(inventorySystem);

    // VerbWheel — mobile-first radial menu for hotspot interaction
    this.verbWheel = new VerbWheel(this);

    // Dialogue box (overlays on top of panel)
    this.dialogueBox = new DialogueBox(this);
    this.choicePanel = new ChoicePanel(this);

    // Wallet button (top-right, small)
    this.walletButton = new WalletButton(this);
    this.walletButton.setInventory(inventorySystem);

    // Dialogue system
    this.dialogueSystem = new DialogueSystem({
      say: (text, speaker) => this.dialogueBox.say(text, speaker),
      showChoices: (choices) => this.choicePanel.show(choices),
      checkGating: async (rule: GatingRule) => {
        const { address } = getWalletState();
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
    });

    // Cinematic overlay (for scripts running from UIScene context)
    this.cinematicOverlay = new CinematicOverlay(this);

    // Store panel height for GameScene camera adjustment
    this.registry.set('scummPanelHeight', this.scummUI.getPanelHeight());

    // --- Item-to-item combo handler ---
    this.scummUI.onCombo((item1, item2) => {
      const globalConfig = this.cache.json.get('globalConfig') as { itemCombos?: Array<{ item1: string; item2: string; result: string | null; script: any[] }> } | null;
      const combos = globalConfig?.itemCombos ?? [];
      const match = combos.find(c =>
        (c.item1 === item1.id && c.item2 === item2.id) ||
        (c.item1 === item2.id && c.item2 === item1.id)
      );
      if (match) {
        const gs = this.scene.get('GameScene') as GameScene;
        gs.executeItemComboScript(match.script);
      } else {
        this.events.emit('say', `I can't use ${item1.name} with ${item2.name}. Creative, though.`);
      }
    });

    // --- Event listeners ---
    const gameScene = this.scene.get('GameScene');

    // Hotspot tapped → execute selected verb (SCUMM style)
    gameScene.events.on('hotspot:tapped', (hotspot: HotspotData) => {
      const verb = this.scummUI.getSelectedVerb();
      const gs = this.scene.get('GameScene') as GameScene;
      gs.executeHotspotVerb(hotspot, verb);
    });

    // Hotspot hover → update action line
    gameScene.events.on('hotspot:hover', (name: string | null) => {
      this.scummUI.setHoveredObject(name);
    });

    // NPC tapped → start dialogue
    gameScene.events.on('npc:tapped', (_npcId: string, treeId: string) => {
      this.startDialogueFromScene(treeId);
    });

    // Say requests from ScriptEngine
    this.events.on('say', (text: string, speaker?: string, resolve?: () => void) => {
      this.dialogueBox.say(text, speaker).then(() => resolve?.());
    });

    // Brief say (auto-dismiss, no click)
    this.events.on('sayBrief', (text: string, durationMs?: number, speaker?: string, resolve?: () => void) => {
      this.dialogueBox.sayBrief(text, durationMs, speaker).then(() => resolve?.());
    });

    // Dialogue requests
    this.events.on('startDialogue', (_npcId: string, treeId: string) => {
      this.startDialogueFromScene(treeId);
    });

    // Cinematic events (so scripts running from UIScene context can trigger them)
    this.events.on('showTitleCard', async (chapter: string, title: string, subtitle?: string, resolve?: () => void) => {
      await this.cinematicOverlay.showTitleCard(chapter, title, subtitle);
      resolve?.();
    });

    this.events.on('showNarrative', async (lines: string[], resolve?: () => void) => {
      await this.cinematicOverlay.showNarrative(lines);
      resolve?.();
    });

    this.events.on('showAchievement', (text: string) => {
      this.cinematicOverlay.showAchievement(text);
    });

    // Scene change refresh
    this.events.on('scene:changed', () => {
      // Nothing to refresh — panel persists
    });
  }

  private async startDialogueFromScene(treeId: string): Promise<void> {
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
        choices: nodeData.choices?.map((c) => ({
          text: c.text,
          next: c.next,
          gate: c.gate as import('@/web3/gating').GatingRule | undefined,
          flag: c.flag,
          setFlag: c.setFlag,
        })),
      };
    }

    await this.dialogueSystem.run(tree);
    this.events.emit('dialogueComplete');
  }

  shutdown(): void {
    this.scummUI?.destroy();
    this.verbWheel?.destroy();
    this.dialogueBox?.destroy();
    this.choicePanel?.destroy();
    this.walletButton?.destroy();
    this.cinematicOverlay?.destroy();
  }
}

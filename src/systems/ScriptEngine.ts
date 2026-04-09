import type { ScriptOp } from '@/types/scene.types';
import type { GameState } from '@/types/game.types';
import type { GatingRule } from '@/web3/gating';

export interface ScriptContext {
  state: GameState;
  setState: (updater: (s: GameState) => GameState) => void;
  say: (text: string, speaker?: string) => Promise<void>;
  sayBrief?: (text: string, durationMs?: number, speaker?: string) => Promise<void>;
  gotoScene: (sceneId: string, spawn?: { x: number; y: number }) => void;
  addItem: (id: string, name: string) => void;
  removeItem: (id: string) => void;
  playSound?: (key: string) => void;
  // Web3 callbacks (optional — only available when wallet connected)
  isWalletConnected?: () => boolean;
  checkGating?: (rule: GatingRule) => Promise<boolean>;
  mintItem?: (tokenId: number) => Promise<boolean>;
  // Dialogue callback
  startDialogue?: (npcId: string, treeId: string) => Promise<void>;
  // Cinematic callbacks
  showTitleCard?: (chapter: string, title: string, subtitle?: string) => Promise<void>;
  showNarrative?: (lines: string[]) => Promise<void>;
  showAchievement?: (text: string) => void;
}

export class ScriptEngine {
  private ctx: ScriptContext;
  private running = false;

  constructor(ctx: ScriptContext) {
    this.ctx = ctx;
  }

  updateContext(ctx: ScriptContext): void {
    this.ctx = ctx;
  }

  isRunning(): boolean {
    return this.running;
  }

  async execute(ops: ScriptOp[]): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.runOps(ops);
    } finally {
      this.running = false;
    }
  }

  private async runOps(ops: ScriptOp[]): Promise<void> {
    for (const op of ops) {
      await this.runOp(op);
    }
  }

  private async runOp(op: ScriptOp): Promise<void> {
    switch (op.op) {
      case 'say':
        await this.ctx.say(op.text as string, op.speaker as string | undefined);
        break;

      case 'sayBrief':
        // Show text briefly (auto-dismiss), no click needed. Optional duration in ms.
        if (this.ctx.sayBrief) {
          await this.ctx.sayBrief(op.text as string, (op.duration as number) ?? 1500, op.speaker as string | undefined);
        } else {
          await this.ctx.say(op.text as string, op.speaker as string | undefined);
        }
        break;

      case 'setFlag':
        this.ctx.setState((s) => ({
          ...s,
          flags: { ...s.flags, [op.flag as string]: op.value as boolean },
        }));
        break;

      case 'ifFlag': {
        const flagValue = this.ctx.state.flags[op.flag as string] ?? false;
        if (flagValue && op.then) {
          await this.runOps(op.then as ScriptOp[]);
        } else if (!flagValue && op.else) {
          await this.runOps(op.else as ScriptOp[]);
        }
        break;
      }

      case 'addItem':
        this.ctx.addItem(op.id as string, op.name as string);
        break;

      case 'removeItem':
        this.ctx.removeItem(op.id as string);
        break;

      case 'gotoScene':
      case 'fadeToScene':
        this.ctx.gotoScene(
          op.sceneId as string,
          op.spawn as { x: number; y: number } | undefined,
        );
        break;

      case 'wait':
        await new Promise<void>((resolve) =>
          setTimeout(resolve, (op.ms as number) ?? 1000),
        );
        break;

      case 'playSound':
        this.ctx.playSound?.(op.key as string);
        break;

      // ─── Web3 opcodes ──────────────────────────────────

      case 'ifWalletConnected': {
        const connected = this.ctx.isWalletConnected?.() ?? false;
        if (connected && op.then) {
          await this.runOps(op.then as ScriptOp[]);
        } else if (!connected && op.else) {
          await this.runOps(op.else as ScriptOp[]);
        }
        break;
      }

      case 'web3Require': {
        // Check a gating rule; run then/else based on result
        // { op: "web3Require", rule: { type: "ERC721", contract: "..." }, then: [...], else: [...] }
        if (!this.ctx.checkGating) {
          if (op.else) await this.runOps(op.else as ScriptOp[]);
          break;
        }
        const rule = op.rule as GatingRule;
        const passed = await this.ctx.checkGating(rule);
        if (passed && op.then) {
          await this.runOps(op.then as ScriptOp[]);
        } else if (!passed && op.else) {
          await this.runOps(op.else as ScriptOp[]);
        }
        break;
      }

      case 'mintNFT': {
        // { op: "mintNFT", tokenId: 99, onSuccess: [...], onFail: [...] }
        if (!this.ctx.mintItem) {
          await this.ctx.say('Wallet not connected. Cannot mint.');
          if (op.onFail) await this.runOps(op.onFail as ScriptOp[]);
          break;
        }
        await this.ctx.say('Minting...');
        const success = await this.ctx.mintItem(op.tokenId as number);
        if (success && op.onSuccess) {
          await this.runOps(op.onSuccess as ScriptOp[]);
        } else if (!success && op.onFail) {
          await this.runOps(op.onFail as ScriptOp[]);
        }
        break;
      }

      case 'dialogue': {
        // { op: "dialogue", npcId: "old_man", treeId: "intro" }
        if (this.ctx.startDialogue) {
          await this.ctx.startDialogue(op.npcId as string, op.treeId as string);
        }
        break;
      }

      case 'ifHasItem': {
        // { op: "ifHasItem", id: "keycard", then: [...], else: [...] }
        const hasIt = this.ctx.state.inventory.some((i) => i.id === (op.id as string));
        if (hasIt && op.then) {
          await this.runOps(op.then as ScriptOp[]);
        } else if (!hasIt && op.else) {
          await this.runOps(op.else as ScriptOp[]);
        }
        break;
      }

      case 'ifVisited': {
        // { op: "ifVisited", sceneId: "basement", then: [...], else: [...] }
        const visited = this.ctx.state.visited.includes(op.sceneId as string);
        if (visited && op.then) {
          await this.runOps(op.then as ScriptOp[]);
        } else if (!visited && op.else) {
          await this.runOps(op.else as ScriptOp[]);
        }
        break;
      }

      // ─── Cinematic opcodes ────────────────────────────
      case 'titleCard': {
        // { op: "titleCard", chapter: "CHAPTER 1", title: "Breaking & Entering", subtitle: "optional" }
        if (this.ctx.showTitleCard) {
          await this.ctx.showTitleCard(op.chapter as string, op.title as string, op.subtitle as string | undefined);
        }
        break;
      }

      case 'narrative': {
        // { op: "narrative", lines: ["Line 1", "Line 2", ...] }
        if (this.ctx.showNarrative) {
          await this.ctx.showNarrative(op.lines as string[]);
        }
        break;
      }

      case 'achievement': {
        // { op: "achievement", text: "Chapter 1 Complete" }
        // Non-blocking — fire and forget
        this.ctx.showAchievement?.(op.text as string);
        break;
      }

      case 'stop':
        return;

      default:
        console.warn(`ScriptEngine: unknown opcode "${op.op}"`);
    }
  }
}

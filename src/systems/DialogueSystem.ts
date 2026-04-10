import type { GatingRule } from '@/web3/gating';

// ─── Data types ──────────────────────────────────────────────

export interface DialogueTree {
  id: string;
  start: string; // node ID to begin with
  nodes: Record<string, DialogueNode>;
}

export interface DialogueNode {
  speaker?: string;
  text: string;
  choices?: DialogueChoice[];
  next?: string; // auto-advance to this node after text is shown (no choices)
  onEnter?: unknown[]; // ScriptOp[] — run when entering this node
  end?: boolean; // if true, conversation ends after this node
}

export interface DialogueChoice {
  text: string;
  next: string; // node ID to jump to
  gate?: GatingRule; // if set, choice is hidden unless gate passes
  flag?: string; // if set, choice is hidden unless this flag is true
  setFlag?: string; // set this flag to true when this choice is picked
}

// ─── Callbacks ───────────────────────────────────────────────

export interface DialogueCallbacks {
  /** Show a line of dialogue. Must return a Promise that resolves when player dismisses. */
  say: (text: string, speaker?: string) => Promise<void>;
  /** Show choices and return the index the player picked. */
  showChoices: (choices: { text: string; enabled: boolean }[]) => Promise<number>;
  /** Check a gating rule. */
  checkGating?: (rule: GatingRule) => Promise<boolean>;
  /** Read a game flag. */
  getFlag?: (flag: string) => boolean;
  /** Set a game flag. */
  setFlag?: (flag: string, value: boolean) => void;
  /** Run script ops (onEnter hooks). */
  runScripts?: (ops: unknown[]) => Promise<void>;
  /** Track dialogue completion. */
  onDialogueComplete?: (treeId: string) => void;
}

// ─── Engine ──────────────────────────────────────────────────

/**
 * Runs a branching dialogue tree.
 * Fully async — waits for player input at each step.
 */
export class DialogueSystem {
  private callbacks: DialogueCallbacks;

  constructor(callbacks: DialogueCallbacks) {
    this.callbacks = callbacks;
  }

  updateCallbacks(cb: DialogueCallbacks): void {
    this.callbacks = cb;
  }

  async run(tree: DialogueTree): Promise<void> {
    let currentNodeId: string | undefined = tree.start;

    while (currentNodeId) {
      const node: DialogueNode | undefined = tree.nodes[currentNodeId];
      if (!node) {
        console.warn(`DialogueSystem: node "${currentNodeId}" not found`);
        break;
      }

      // Run onEnter scripts
      if (node.onEnter && this.callbacks.runScripts) {
        await this.callbacks.runScripts(node.onEnter);
      }

      // Show text
      await this.callbacks.say(node.text, node.speaker);

      // End node
      if (node.end) break;

      // Auto-advance (no choices)
      if (!node.choices || node.choices.length === 0) {
        currentNodeId = node.next;
        if (!currentNodeId) break; // no next = end
        continue;
      }

      // Filter choices by gates and flags
      const resolvedChoices = await this.resolveChoices(node.choices);

      if (resolvedChoices.length === 0) {
        // All choices gated out — auto-advance or end
        currentNodeId = node.next;
        if (!currentNodeId) break;
        continue;
      }

      // Show choices
      const choiceIndex = await this.callbacks.showChoices(
        resolvedChoices.map((c) => ({ text: c.choice.text, enabled: c.enabled })),
      );

      const picked = resolvedChoices[choiceIndex];
      if (!picked) break;

      // Set flag if choice has setFlag
      if (picked.choice.setFlag && this.callbacks.setFlag) {
        this.callbacks.setFlag(picked.choice.setFlag, true);
      }

      currentNodeId = picked.choice.next;
    }

    // Track dialogue completion
    this.callbacks.onDialogueComplete?.(tree.id);
  }

  private async resolveChoices(
    choices: DialogueChoice[],
  ): Promise<Array<{ choice: DialogueChoice; enabled: boolean }>> {
    const results: Array<{ choice: DialogueChoice; enabled: boolean }> = [];

    for (const choice of choices) {
      let enabled = true;

      // Check flag gate
      if (choice.flag && this.callbacks.getFlag) {
        if (!this.callbacks.getFlag(choice.flag)) {
          enabled = false;
        }
      }

      // Check web3 gate
      if (choice.gate && this.callbacks.checkGating) {
        const passed = await this.callbacks.checkGating(choice.gate);
        if (!passed) enabled = false;
      }

      results.push({ choice, enabled });
    }

    return results;
  }
}

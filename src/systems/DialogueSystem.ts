import type { GatingRule } from '@/web3/gating';

/*
 * Motor de árboles de diálogo. Lógica pura, sin Phaser ni imports de valores: se prueba con
 * `node --experimental-strip-types --test tests/dialogue-system.test.mjs`.
 *
 * A2.6 (plan SCUMM):
 *   - Opciones ya usadas: se marcan por árbol (`isChoiceUsed`/`markChoiceUsed`, en la partida: `GameState.dialogueUsed`)
 *     y se pintan en gris pero se pueden volver a elegir (estilo Monkey Island). `once: true` → se oculta tras usarla.
 *   - Salida explícita: una elección con `exit: true` cierra la conversación (tras enseñar su nodo `next`, si lo tiene,
 *     sea cual sea el `next` de ese nodo). Las salidas no se marcan como usadas.
 *   - Hub: un nodo sin `text` solo enseña sus opciones (no repite el saludo). Las ramas vuelven a él con `next: "hub"`.
 *     Un nodo con opciones que se queda sin ninguna elegible sigue por su `next` o, si no tiene, termina.
 *   - A2.6a, condiciones `when` (en elecciones y en nodos): lista de condiciones en texto; si alguna no se cumple, la
 *     elección se OCULTA (y el nodo se salta: se sigue por su `next`). Sintaxis: `flag`, `!flag`, `item:id`, `!item:id`
 *     (también `flag:nombre`). `flag`/`gate` (lo de antes) siguen enseñando la opción bloqueada con su texto, salvo con
 *     `hideIfLocked: true`, que la oculta.
 */

// ─── Data types ──────────────────────────────────────────────

export interface DialogueTree {
  id: string;
  start: string; // node ID to begin with
  nodes: Record<string, DialogueNode>;
}

export interface DialogueNode extends DialogueNodeScreen {
  speaker?: string;
  /** A2.6: sin texto (p. ej. el hub) el nodo no dice nada y enseña sus opciones directamente */
  text?: string;
  choices?: DialogueChoice[];
  next?: string; // auto-advance to this node after text is shown (no choices)
  onEnter?: unknown[]; // ScriptOp[] — run when entering this node
  end?: boolean; // if true, conversation ends after this node
  /** A2.6a: si no se cumple, el nodo se salta (sin onEnter ni texto) y se sigue por `next` */
  when?: string | string[];
}

export interface DialogueChoice {
  /** A2.6: clave estable para «ya usada» (por defecto `<nodo>:<texto>`) */
  id?: string;
  text: string;
  /** Nodo al que salta. Opcional solo con `exit: true` (sin `next`, la salida cierra sin más texto). */
  next?: string;
  gate?: GatingRule; // if set and it fails, the choice is shown locked (or hidden with hideIfLocked)
  flag?: string; // if set and the flag is false, the choice is shown locked (or hidden with hideIfLocked)
  setFlag?: string; // set this flag to true when this choice is picked
  /** A2.6a: condiciones; si alguna falla la opción NO se enseña */
  when?: string | string[];
  /** A2.6a: con `flag`/`gate` sin cumplir, ocultar la opción en vez de enseñarla bloqueada */
  hideIfLocked?: boolean;
  /** A2.6: se oculta después de elegirla una vez */
  once?: boolean;
  /** A2.6: cierra la conversación (después de su nodo `next`, si lo tiene) */
  exit?: boolean;
}

/** Lo que recibe la UI por cada opción visible. */
export interface ChoiceView {
  text: string;
  enabled: boolean;
  /** A2.6: ya elegida antes en este árbol (gris, pero se puede volver a elegir) */
  used: boolean;
}

// ─── Callbacks ───────────────────────────────────────────────

/** A2.19: el nodo dice algo que sale en una pantalla de la escena (`screen`, `display`, `closeup` como en el op `say`) */
export interface DialogueNodeScreen {
  screen?: string;
  display?: string;
  closeup?: boolean;
}

export interface DialogueCallbacks {
  /** Show a line of dialogue. Must return a Promise that resolves when player dismisses. */
  say: (text: string, speaker?: string, node?: DialogueNodeScreen) => Promise<void>;
  /** Show choices and return the index the player picked. */
  showChoices: (choices: ChoiceView[]) => Promise<number>;
  /** Check a gating rule. */
  checkGating?: (rule: GatingRule) => Promise<boolean>;
  /** Read a game flag. */
  getFlag?: (flag: string) => boolean;
  /** Set a game flag. */
  setFlag?: (flag: string, value: boolean) => void;
  /** A2.6a: ¿tiene el jugador este objeto? (condiciones `item:`). Sin callback, nunca. */
  hasItem?: (itemId: string) => boolean;
  /** A2.6: opciones usadas, persistentes. Sin estos callbacks se recuerdan solo en memoria (esta instancia). */
  isChoiceUsed?: (treeId: string, key: string) => boolean;
  markChoiceUsed?: (treeId: string, key: string) => void;
  /**
   * Run script ops (onEnter hooks). A1.9: con el mismo repertorio que ScriptEngine (UIScene → GameScene
   * `runDialogueScripts`). `where` = `<treeId>.<nodeId>`, para los avisos.
   */
  runScripts?: (ops: unknown[], where: string) => Promise<void>;
  /** Track dialogue completion. */
  onDialogueComplete?: (treeId: string) => void;
}

// ─── Condiciones (A2.6a) ─────────────────────────────────────

export interface ParsedCondition {
  kind: 'flag' | 'item';
  name: string;
  negated: boolean;
}

/** Sintaxis de una condición (la misma regla vive en scripts/lint-scenes.mjs). */
export const CONDITION_RE = /^(!?)(?:(flag|item):)?([A-Za-z0-9_.-]+)$/;

/** Interpreta una condición en texto; null si no es válida. */
export function parseCondition(raw: string): ParsedCondition | null {
  if (typeof raw !== 'string') return null;
  const m = CONDITION_RE.exec(raw.trim());
  if (!m) return null;
  return { kind: m[2] === 'item' ? 'item' : 'flag', name: m[3], negated: m[1] === '!' };
}

/** Normaliza `when` (texto suelto o lista) a lista. */
export function conditionList(when: string | string[] | undefined): string[] {
  if (!when) return [];
  return Array.isArray(when) ? when : [when];
}

/**
 * true si se cumplen TODAS las condiciones. Una condición mal escrita no se cumple (y avisa): mejor ocultar una
 * opción que enseñar la respuesta de un puzle.
 */
export function conditionsMet(
  when: string | string[] | undefined,
  ctx: { getFlag?: (flag: string) => boolean; hasItem?: (itemId: string) => boolean },
): boolean {
  for (const raw of conditionList(when)) {
    const c = parseCondition(raw);
    if (!c) {
      console.warn(`DialogueSystem: condición no válida «${String(raw)}»`);
      return false;
    }
    const value = c.kind === 'item' ? Boolean(ctx.hasItem?.(c.name)) : Boolean(ctx.getFlag?.(c.name));
    if (value === c.negated) return false;
  }
  return true;
}

/** Clave de «ya usada» de una elección. */
export function choiceKey(nodeId: string, choice: DialogueChoice): string {
  return choice.id ?? `${nodeId}:${choice.text}`;
}

/** Tope de saltos seguidos sin que el jugador haga nada (p. ej. nodos saltados por `when` en bucle). */
const MAX_SILENT_STEPS = 200;

// ─── Engine ──────────────────────────────────────────────────

interface ResolvedChoice {
  choice: DialogueChoice;
  enabled: boolean;
  used: boolean;
  key: string;
}

/**
 * Runs a branching dialogue tree.
 * Fully async — waits for player input at each step.
 */
export class DialogueSystem {
  private callbacks: DialogueCallbacks;
  /** Usadas en memoria, si no hay callbacks de persistencia: treeId → claves */
  private memoryUsed = new Map<string, Set<string>>();

  constructor(callbacks: DialogueCallbacks) {
    this.callbacks = callbacks;
  }

  updateCallbacks(cb: DialogueCallbacks): void {
    this.callbacks = cb;
  }

  /** Ejecuta el árbol desde `tree.start` o, si se da, desde `startNode` (A2.6: NPC que reaccionan a objetos). */
  async run(tree: DialogueTree, startNode?: string): Promise<void> {
    let currentNodeId: string | undefined = startNode ?? tree.start;
    let exiting = false;
    let silent = 0;

    while (currentNodeId) {
      if (++silent > MAX_SILENT_STEPS) {
        console.warn(`DialogueSystem: ${tree.id}: demasiados saltos sin texto ni elección (¿bucle en «${currentNodeId}»?)`);
        break;
      }
      const nodeId: string = currentNodeId;
      const node: DialogueNode | undefined = tree.nodes[nodeId];
      if (!node) {
        console.warn(`DialogueSystem: node "${nodeId}" not found`);
        break;
      }

      // A2.6a: nodo con condición no cumplida → se salta
      if (node.when !== undefined && !conditionsMet(node.when, this.callbacks)) {
        if (exiting) break;
        currentNodeId = node.next;
        continue;
      }

      // Run onEnter scripts
      if (node.onEnter && this.callbacks.runScripts) {
        await this.callbacks.runScripts(node.onEnter, `${tree.id}.${nodeId}`);
      }

      // Show text (un hub sin texto no dice nada)
      if (node.text) {
        silent = 0;
        // A2.19: con `screen` la línea también se teclea en esa pantalla de la escena
        if (node.screen) await this.callbacks.say(node.text, node.speaker, { screen: node.screen, display: node.display, closeup: node.closeup });
        else await this.callbacks.say(node.text, node.speaker);
      }

      // End node, o el nodo de despedida de una salida
      if (node.end || exiting) break;

      // Auto-advance (no choices)
      if (!node.choices || node.choices.length === 0) {
        currentNodeId = node.next;
        continue;
      }

      const resolvedChoices = await this.resolveChoices(tree.id, nodeId, node.choices);

      // Sin nada que elegir (todo oculto o bloqueado): sigue por `next` o termina. Enseñar solo opciones
      // bloqueadas dejaría al jugador atascado en el panel.
      if (!resolvedChoices.some((c) => c.enabled)) {
        currentNodeId = node.next;
        continue;
      }

      silent = 0;
      const choiceIndex = await this.callbacks.showChoices(
        resolvedChoices.map((c) => ({ text: c.choice.text, enabled: c.enabled, used: c.used })),
      );

      const picked = resolvedChoices[choiceIndex];
      if (!picked || !picked.enabled) break;

      // Set flag if choice has setFlag
      if (picked.choice.setFlag && this.callbacks.setFlag) {
        this.callbacks.setFlag(picked.choice.setFlag, true);
      }

      if (picked.choice.exit) {
        exiting = true;
      } else {
        this.markUsed(tree.id, picked.key);
      }

      currentNodeId = picked.choice.next;
    }

    // Track dialogue completion
    this.callbacks.onDialogueComplete?.(tree.id);
  }

  /** Opciones visibles del nodo, en orden, con su estado (las ocultas no salen). */
  private async resolveChoices(treeId: string, nodeId: string, choices: DialogueChoice[]): Promise<ResolvedChoice[]> {
    const results: ResolvedChoice[] = [];

    for (const choice of choices) {
      // A2.6a: condición no cumplida → oculta
      if (choice.when !== undefined && !conditionsMet(choice.when, this.callbacks)) continue;

      const key = choiceKey(nodeId, choice);
      const used = !choice.exit && this.isUsed(treeId, key);
      // A2.6: de un solo uso y ya usada → oculta
      if (choice.once && used) continue;

      let enabled = true;

      // Check flag gate
      if (choice.flag && this.callbacks.getFlag) {
        if (!this.callbacks.getFlag(choice.flag)) {
          enabled = false;
        }
      }

      // Check web3 gate
      if (enabled && choice.gate && this.callbacks.checkGating) {
        const passed = await this.callbacks.checkGating(choice.gate);
        if (!passed) enabled = false;
      }

      if (!enabled && choice.hideIfLocked) continue;

      results.push({ choice, enabled, used, key });
    }

    return results;
  }

  private isUsed(treeId: string, key: string): boolean {
    if (this.callbacks.isChoiceUsed) return this.callbacks.isChoiceUsed(treeId, key);
    return this.memoryUsed.get(treeId)?.has(key) ?? false;
  }

  private markUsed(treeId: string, key: string): void {
    if (this.callbacks.markChoiceUsed) {
      this.callbacks.markChoiceUsed(treeId, key);
      return;
    }
    let set = this.memoryUsed.get(treeId);
    if (!set) {
      set = new Set();
      this.memoryUsed.set(treeId, set);
    }
    set.add(key);
  }
}

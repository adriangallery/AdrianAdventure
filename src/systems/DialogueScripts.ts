import type { ScriptOp } from '@/types/scene.types';
import type { ScriptContext, ScriptEngine } from './ScriptEngine';

/**
 * A1.9: ejecuta los `onEnter` de los nodos de diálogo con el mismo repertorio de opcodes que cualquier script
 * (`ScriptEngine`), en un ScriptEngine APARTE del de GameScene.
 *
 * Por qué un motor aparte y no el de GameScene: un diálogo puede empezar desde un script en curso (op
 * `dialogue`), que espera a que el árbol termine. Si los onEnter de ese árbol fueran al mismo motor, `execute`
 * los encolaría detrás del script que espera al diálogo, y el diálogo esperaría a su onEnter: bloqueo. Con un
 * motor propio no hay cola ni generación compartidas: el watchdog y `forceReset` del motor principal siguen
 * igual (mientras hay diálogo, `dialogueActive` lo pausa) y este motor tiene su propio watchdog (GameScene lo
 * avanza con lo que hay en pantalla dentro del árbol), así que un onEnter colgado se abandona a los 30 s sin
 * perder sus ops de estado y el árbol sigue.
 *
 * El contexto es el de GameScene (`buildScriptContext`, estado vivo por `getState()`/registry `gameState`), con
 * dos excepciones mientras el árbol está abierto, porque solo hay un DialogueBox/ChoicePanel y la escena no
 * puede cambiar debajo de una conversación:
 * - `gotoScene`/`fadeToScene`: se aplaza hasta que el árbol se cierra (`finishTree`). El resto del onEnter y del
 *   árbol sigue; si hay varios, gana el último.
 * - `dialogue`: no se anidan árboles. Se descarta con `console.warn` y el onEnter sigue.
 */
export class DialogueScriptRunner {
  private readonly engine: ScriptEngine;
  private readonly baseContext: () => ScriptContext;
  /** Hay un árbol abierto (desde el primer onEnter hasta `finishTree`). */
  private treeOpen = false;
  private pendingScene: { sceneId: string; spawn?: { x: number; y: number } } | null = null;

  constructor(engine: ScriptEngine, baseContext: () => ScriptContext) {
    this.engine = engine;
    this.baseContext = baseContext;
  }

  /** onEnter de un nodo. `label` sale en los avisos del watchdog (p. ej. `dr_satoshi_intro.evidence_accepted`). */
  async run(ops: ScriptOp[], label: string): Promise<void> {
    if (!ops.length) return;
    this.treeOpen = true;
    this.engine.updateContext(this.treeContext(this.baseContext()));
    await this.engine.execute(ops, `${label}/onEnter`);
  }

  /** Cierre del árbol: aplica el cambio de escena aplazado, si lo hay. */
  finishTree(): void {
    this.treeOpen = false;
    const pending = this.pendingScene;
    this.pendingScene = null;
    // Lo que llegue después (p. ej. el resultado tardío de un mint lanzado en un onEnter) usa el contexto normal
    this.engine.updateContext(this.baseContext());
    if (pending) this.baseContext().gotoScene(pending.sceneId, pending.spawn);
  }

  isRunning(): boolean {
    return this.engine.isRunning();
  }

  /** A1.4 + A1.9: corta un `flicker` lanzado desde un onEnter cuando la escena se cierra (SHUTDOWN). */
  cancelEffects(): void {
    this.engine.cancelEffects();
  }

  setFastForward(on: boolean): void {
    this.engine.setFastForward(on);
  }

  /** Watchdog del motor de onEnter: `presenting` = hay texto, elección o cinemática en pantalla. */
  watchdogTick(elapsedMs: number, presenting: boolean): boolean {
    return this.engine.watchdogTick(elapsedMs, presenting);
  }

  private treeContext(base: ScriptContext): ScriptContext {
    return {
      ...base,
      gotoScene: (sceneId, spawn) => {
        if (!this.treeOpen) {
          base.gotoScene(sceneId, spawn);
          return;
        }
        if (this.pendingScene) {
          console.warn(`[DialogueScripts] gotoScene «${sceneId}» sustituye al aplazado «${this.pendingScene.sceneId}»`);
        }
        this.pendingScene = { sceneId, spawn };
      },
      startDialogue: async (npcId, treeId) => {
        if (!this.treeOpen && base.startDialogue) {
          await base.startDialogue(npcId, treeId);
          return;
        }
        console.warn(`[DialogueScripts] opcode «dialogue» (${npcId}/${treeId}) en un onEnter de diálogo: no se anidan árboles, se omite`);
      },
    };
  }
}

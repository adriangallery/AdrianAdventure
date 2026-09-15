import type { ScriptOp } from '@/types/scene.types';
import type { GameState } from '@/types/game.types';
import type { GatingRule } from '@/web3/gating';

export interface MintResult {
  status: 'success' | 'pending' | 'failed' | 'not-configured';
  txHash?: string;
  error?: string;
}

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
  mintItem?: (tokenId: number) => Promise<MintResult>;
  mintAchievement?: (achievementId: number) => Promise<MintResult>;
  // Dialogue callback
  startDialogue?: (npcId: string, treeId: string) => Promise<void>;
  // Cinematic callbacks
  showTitleCard?: (chapter: string, title: string, subtitle?: string) => Promise<void>;
  showNarrative?: (lines: string[]) => Promise<void>;
  showAchievement?: (text: string) => void;
  showCredits?: () => Promise<void>;
  /** V6b: monitor del treatment_room — lluvia verde + expediente real de la wallet */
  showMonitorReveal?: () => Promise<void>;
  // Transaction toast
  showToast?: (status: 'pending' | 'success' | 'failed', message: string) => void;
  // Costume change
  setCostume?: (prefix: string) => void;
}

/**
 * A1.1: tiempo que un script puede estar parado sin nada en pantalla que espere al jugador antes de que el
 * watchdog lo dé por colgado (una promesa de la UI que nunca se resuelve).
 */
export const WATCHDOG_MS = 30_000;

/**
 * A1.1: ops que esperan algo que termina solo (temporizador, red, confirmación en la wallet). Mientras el
 * script está en una de ellas el watchdog no cuenta: no es un cuelgue aunque tarde.
 */
const SELF_RESOLVING_OPS = new Set(['wait', 'web3Require', 'mintNFT', 'mintAchievement']);

/** Script en la cola, con una etiqueta para los avisos (p. ej. `hs_porch_light/LOOK`). */
interface QueuedScript {
  ops: ScriptOp[];
  label: string;
}

/** Bloque de ops en ejecución y la posición del op en curso (un script con ramas apila varios). */
interface Frame {
  ops: ScriptOp[];
  index: number;
}

export class ScriptEngine {
  private ctx: ScriptContext;
  private running = false;
  private stopped = false;
  private pendingQueue: QueuedScript[] = [];
  /** V6: mientras el jugador mantiene pulsado, las esperas de presentación terminan al momento */
  private fastForward = false;
  /**
   * A1.1: cada `execute` que arranca la cola lleva una generación. `forceReset` la incrementa: la ejecución
   * abandonada deja de avanzar en cuanto se resuelve lo que esperaba, así nunca corre a la vez que la siguiente.
   */
  private generation = 0;
  /** A1.1: pila de bloques del script en curso (el último es el más interno) */
  private frames: Frame[] = [];
  private currentLabel = '';
  /** A1.1: tiempo parado sin nada en pantalla; vuelve a cero al empezar o terminar cada op */
  private stallMs = 0;

  constructor(ctx: ScriptContext) {
    this.ctx = ctx;
  }

  updateContext(ctx: ScriptContext): void {
    this.ctx = ctx;
  }

  isRunning(): boolean {
    return this.running;
  }

  setFastForward(on: boolean): void {
    this.fastForward = on;
  }

  /** Espera ms milisegundos, o menos si se activa el avance rápido. */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const end = Date.now() + ms;
      const tick = () => (this.fastForward || Date.now() >= end ? resolve() : setTimeout(tick, 50));
      tick();
    });
  }

  /** Op que el script está esperando ahora mismo (el del bloque más interno). */
  private currentOp(): ScriptOp | null {
    const frame = this.frames[this.frames.length - 1];
    return frame ? frame.ops[frame.index] ?? null : null;
  }

  /**
   * A1.1: avanza el watchdog `elapsedMs`. Solo cuenta el tiempo en que el script no avanza, no hay nada en
   * pantalla esperando al jugador (`presenting`: texto, diálogo, elección o cinemática) y el op en curso no es
   * de los que terminan solos. Cualquier avance o algo en pantalla pone el contador a cero. Al llegar a
   * WATCHDOG_MS fuerza el reinicio (sin perder operaciones de estado) y devuelve true.
   */
  watchdogTick(elapsedMs: number, presenting: boolean): boolean {
    if (!this.running) {
      this.stallMs = 0;
      return false;
    }
    const op = this.currentOp();
    if (presenting || (op && SELF_RESOLVING_OPS.has(op.op))) {
      this.stallMs = 0;
      return false;
    }
    this.stallMs += elapsedMs;
    if (this.stallMs < WATCHDOG_MS) return false;
    const where = this.currentLabel ? ` en ${this.currentLabel}` : '';
    this.forceReset(`watchdog: «${op?.op ?? '?'}»${where} lleva ${Math.round(this.stallMs / 1000)} s sin resolverse y sin nada en pantalla`);
    return true;
  }

  /**
   * Last-resort recovery when a script awaits a Promise that never resolves (e.g., a lost dialogue resolver).
   * A1.1: se abandona el op colgado y lo que quedaba de presentación, pero las operaciones de estado del resto
   * del script y de los scripts en cola (setFlag, addItem, removeItem, cambios de escena, logros, disfraz, con
   * sus ramas evaluadas) se aplican en orden, así que la partida queda como si el jugador hubiera seguido.
   */
  forceReset(reason: string): void {
    const wasRunning = this.running;
    const current: ScriptOp[][] = [];
    if (!this.stopped) {
      // Resto del script en curso, del bloque más interno al más externo; el op colgado no se repite
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const frame = this.frames[i];
        current.push(frame.ops.slice(frame.index + 1));
      }
    }
    const queued = this.pendingQueue;

    this.generation++;
    this.running = false;
    this.stopped = false;
    this.pendingQueue = [];
    this.frames = [];
    this.currentLabel = '';
    this.stallMs = 0;

    const applied: string[] = [];
    for (const block of current) {
      if (this.salvage(block, applied)) break; // un `stop` corta el resto de ese script
    }
    for (const script of queued) this.salvage(script.ops, applied);

    if (wasRunning || applied.length) {
      const summary = applied.length ? `${applied.length} op(s) de estado aplicadas (${applied.join(', ')})` : 'sin ops de estado pendientes';
      console.warn(`[ScriptEngine] forceReset: ${reason} · ${summary}; ${queued.length} script(s) en cola`);
    }
  }

  /** Aplica solo las operaciones de estado de `ops` (ramas incluidas). Devuelve true si encontró `stop`. */
  private salvage(ops: ScriptOp[], applied: string[]): boolean {
    for (const op of ops) {
      if (op.op === 'stop') return true;
      if (this.applyStateOp(op)) {
        applied.push(op.op === 'setFlag' ? `setFlag ${String(op.flag)}` : op.op === 'addItem' ? `addItem ${String(op.id)}` : op.op);
        continue;
      }
      if (op.op === 'mintAchievement' && op.text) {
        // El logro visual y su registro en la partida son estado; el mint on-chain no se reintenta
        this.ctx.showAchievement?.(op.text as string);
        applied.push('achievement');
        continue;
      }
      const branch = this.branchOf(op);
      if (branch && this.salvage(branch, applied)) return true;
      // Presentación (say, cinemáticas, diálogo, sonido, esperas) y web3 asíncrono: se omiten
    }
    return false;
  }

  /** Ops de estado síncronas. Devuelve true si `op` lo era (y lo ha aplicado). */
  private applyStateOp(op: ScriptOp): boolean {
    switch (op.op) {
      case 'setFlag':
        this.ctx.setState((s) => ({
          ...s,
          flags: { ...s.flags, [op.flag as string]: op.value as boolean },
        }));
        return true;
      case 'addItem':
        this.ctx.addItem(op.id as string, op.name as string);
        return true;
      case 'removeItem':
        this.ctx.removeItem(op.id as string);
        return true;
      case 'gotoScene':
      case 'fadeToScene':
        this.ctx.gotoScene(op.sceneId as string, op.spawn as { x: number; y: number } | undefined);
        return true;
      case 'achievement':
        // { op: "achievement", text: "Chapter 1 Complete" } — non-blocking
        this.ctx.showAchievement?.(op.text as string);
        return true;
      case 'setCostume':
        // { op: "setCostume", prefix: "ape" } — changes player sprite
        this.ctx.setCostume?.(op.prefix as string);
        return true;
      default:
        return false;
    }
  }

  /**
   * Rama elegida por un condicional síncrono (ifFlag, ifHasItem, ifVisited, ifWalletConnected); undefined si
   * `op` no es uno de ellos o la rama elegida no existe.
   */
  private branchOf(op: ScriptOp): ScriptOp[] | undefined {
    let cond: boolean;
    switch (op.op) {
      case 'ifFlag':
        cond = this.ctx.state.flags[op.flag as string] ?? false;
        break;
      case 'ifHasItem':
        // { op: "ifHasItem", id: "keycard", then: [...], else: [...] }
        cond = this.ctx.state.inventory.some((i) => i.id === (op.id as string));
        break;
      case 'ifVisited':
        // { op: "ifVisited", sceneId: "basement", then: [...], else: [...] }
        cond = this.ctx.state.visited.includes(op.sceneId as string);
        break;
      case 'ifWalletConnected':
        cond = this.ctx.isWalletConnected?.() ?? false;
        break;
      default:
        return undefined;
    }
    return (cond ? op.then : op.else) as ScriptOp[] | undefined;
  }

  async execute(ops: ScriptOp[], label = ''): Promise<void> {
    if (this.running) {
      // Queue instead of silently dropping — prevents once-triggers from being lost
      this.pendingQueue.push({ ops, label });
      return;
    }
    const gen = ++this.generation;
    this.running = true;
    this.stopped = false;
    this.currentLabel = label;
    this.stallMs = 0;

    try {
      await this.runOps(ops, gen);
      // Drain queued scripts (FIFO)
      while (gen === this.generation && this.pendingQueue.length > 0) {
        this.stopped = false;
        const next = this.pendingQueue.shift()!;
        this.currentLabel = next.label;
        await this.runOps(next.ops, gen);
      }
    } finally {
      // Una ejecución abandonada por forceReset no toca el estado de la que vino después
      if (gen === this.generation) {
        this.running = false;
        this.stopped = false;
        this.frames = [];
        this.currentLabel = '';
      }
    }
  }

  private async runOps(ops: ScriptOp[], gen: number): Promise<void> {
    const frame: Frame = { ops, index: 0 };
    this.frames.push(frame);
    try {
      for (; frame.index < ops.length; frame.index++) {
        if (this.stopped || gen !== this.generation) break;
        this.stallMs = 0;
        await this.runOp(ops[frame.index], gen);
        if (gen === this.generation) this.stallMs = 0;
      }
    } finally {
      if (gen === this.generation) this.frames.pop();
    }
  }

  private async runOp(op: ScriptOp, gen: number): Promise<void> {
    if (this.applyStateOp(op)) return;
    const branch = this.branchOf(op);
    if (branch) {
      await this.runOps(branch, gen);
      return;
    }

    switch (op.op) {
      case 'say':
        await this.ctx.say(op.text as string, op.speaker as string | undefined);
        break;

      case 'sayBrief':
        // Show text briefly (auto-dismiss), no click needed. Optional duration in ms.
        if (this.ctx.sayBrief) {
          await this.ctx.sayBrief(op.text as string, this.fastForward ? 250 : (op.duration as number) ?? 1500, op.speaker as string | undefined);
        } else {
          await this.ctx.say(op.text as string, op.speaker as string | undefined);
        }
        break;

      case 'wait':
        await this.sleep((op.ms as number) ?? 1000);
        break;

      case 'playSound':
        this.ctx.playSound?.(op.key as string);
        break;

      // ─── Web3 opcodes ──────────────────────────────────

      case 'web3Require': {
        // Check a gating rule; run then/else based on result
        // { op: "web3Require", rule: { type: "ERC721", contract: "..." }, then: [...], else: [...] }
        if (!this.ctx.checkGating) {
          if (op.else) await this.runOps(op.else as ScriptOp[], gen);
          break;
        }
        const rule = op.rule as GatingRule;
        const passed = await this.ctx.checkGating(rule);
        if (passed && op.then) {
          await this.runOps(op.then as ScriptOp[], gen);
        } else if (!passed && op.else) {
          await this.runOps(op.else as ScriptOp[], gen);
        }
        break;
      }

      case 'mintNFT': {
        // { op: "mintNFT", tokenId: 99, onSuccess: [...], onFail: [...] }
        if (!this.ctx.mintItem) {
          await this.ctx.say('Wallet not connected. Cannot mint.');
          if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
          break;
        }
        this.ctx.showToast?.('pending', 'Minting... (confirm in wallet)');
        const mintResult = await this.ctx.mintItem(op.tokenId as number);
        if (gen !== this.generation) break;
        if (mintResult.status === 'success') {
          this.ctx.showToast?.('success', 'Minted successfully!');
          if (op.onSuccess) await this.runOps(op.onSuccess as ScriptOp[], gen);
        } else if (mintResult.status === 'not-configured') {
          this.ctx.showToast?.('failed', 'Minting not available yet');
          if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
        } else {
          this.ctx.showToast?.('failed', mintResult.error ?? 'Mint failed');
          if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
        }
        break;
      }

      case 'mintAchievement': {
        // { op: "mintAchievement", achievementId: 1, text: "Chapter 1 Complete", onSuccess: [...], onFail: [...] }
        // Always show visual achievement first
        if (op.text) this.ctx.showAchievement?.(op.text as string);
        // Then attempt on-chain mint if wallet connected and configured
        if (this.ctx.mintAchievement) {
          const result = await this.ctx.mintAchievement(op.achievementId as number);
          if (gen !== this.generation) break;
          if (result.status === 'success') {
            this.ctx.showToast?.('success', `Achievement minted on-chain!`);
            if (op.onSuccess) await this.runOps(op.onSuccess as ScriptOp[], gen);
          } else if (result.status === 'not-configured') {
            // Silently skip — visual achievement still shown
            if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
          } else if (result.status === 'failed') {
            // Don't interrupt gameplay for a failed achievement mint
            console.warn('Achievement mint failed:', result.error);
            if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
          }
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

      case 'credits': {
        // { op: "credits" } — show scrolling end credits
        if (this.ctx.showCredits) {
          await this.ctx.showCredits();
        }
        break;
      }

      case 'monitorReveal': {
        // { op: "monitorReveal" } — full-screen monitor with the player's real wallet history
        if (this.ctx.showMonitorReveal) {
          await this.ctx.showMonitorReveal();
        }
        break;
      }

      case 'stop':
        if (gen === this.generation) this.stopped = true;
        return;

      case 'ifFlag':
      case 'ifHasItem':
      case 'ifVisited':
      case 'ifWalletConnected':
        // Condicional sin rama para el valor actual: no hace nada
        break;

      default:
        console.warn(`ScriptEngine: unknown opcode "${op.op}"`);
    }
  }
}

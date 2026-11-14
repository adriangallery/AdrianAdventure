import type { ScriptOp } from '@/types/scene.types';
import type { GameState } from '@/types/game.types';
import type { GatingRule } from '@/web3/gating';
import type { SkipAction, TransitionSpec } from './Cinematics';

export interface MintResult {
  status: 'success' | 'pending' | 'failed' | 'not-configured';
  txHash?: string;
  error?: string;
}

/**
 * A2.10: puente del ScriptEngine con el director de cinemáticas (`src/systems/CinematicDirector.ts`, en GameScene).
 * El motor solo decide el orden y el salto; la cámara, las franjas y los actores son cosa del director. La lógica
 * pura (qué op es de cinemática, qué hace cada uno al saltar) está en `src/systems/Cinematics.ts`.
 */
export interface CinemaHooks {
  /** ¿Es un op de cámara, transición o actor (`CINEMATIC_OPS`)? */
  handles: (opName: string) => boolean;
  /** Qué hacer con el op al saltar la cinemática (`skipActionFor`) */
  skipAction: (op: ScriptOp) => SkipAction;
  /** Entra en modo cinemática: franjas, interfaz oculta, entrada bloqueada, música baja. Idempotente. */
  begin: () => void;
  /** Sale del modo cinemática y lo deja todo como estaba (cámara incluida). `instant` = sin animar. Idempotente. */
  end: (opts: { instant: boolean; skipped: boolean }) => void;
  /** Ejecuta un op de `handles`; con `instant` aplica su estado final al momento. Siempre termina. */
  run: (op: ScriptOp, instant: boolean) => Promise<void>;
  /** Termina de golpe las animaciones en curso (estado final) y cierra el texto en pantalla: el salto. */
  finishAll: () => void;
}

export interface ScriptContext {
  /**
   * A1.1: estado VIVO de la partida. Es una función y no un valor porque `setState` e `InventorySystem`
   * sustituyen el objeto: un `state` copiado al crear el contexto hacía que `ifFlag`/`ifHasItem`/`ifVisited`
   * leyeran el estado anterior a un `setFlag`/`addItem` del mismo script (y el rescate de `forceReset` igual).
   */
  getState: () => GameState;
  setState: (updater: (s: GameState) => GameState) => void;
  say: (text: string, speaker?: string) => Promise<void>;
  sayBrief?: (text: string, durationMs?: number, speaker?: string) => Promise<void>;
  /** A2.10: `transition` opcional (iris, cortinilla o fundido) del op `fadeToScene`/`gotoScene` */
  gotoScene: (sceneId: string, spawn?: { x: number; y: number }, transition?: TransitionSpec | null) => void;
  addItem: (id: string, name: string) => void;
  removeItem: (id: string) => void;
  playSound?: (key: string) => void;
  /** A4.5: op `stinger` ({ kind: item | puzzle | chapter | fail }): un stinger en la tonalidad de la música. Presentación. */
  playStinger?: (kind: string) => void;
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
  /**
   * A3.10: op `showDashboard` — abre el dashboard TraitLab del Mining Rig (panel a pantalla completa con el saldo de
   * $ZERO, los AdrianZERO y los traits de la cartera, solo lecturas) y se resuelve al cerrarlo. Presentación pura: no
   * toca la partida (la recompensa la ponen los ops de estado que vengan detrás en el `then`).
   */
  showDashboard?: (mode?: 'holder' | 'founder') => Promise<void>;
  // Transaction toast
  showToast?: (status: 'pending' | 'success' | 'failed', message: string) => void;
  // Costume change
  setCostume?: (prefix: string) => void;
  /**
   * A1.4: fuerza la visibilidad de un overlay condicional de la escena actual (`conditionalOverlays[].id`) sin
   * tocar su flag; `null` quita el forzado y vuelve a mandar la flag. Devuelve false si la escena no tiene ese
   * overlay (o su textura no cargó). Es presentación pura: no cambia el estado ni dispara el autoguardado.
   */
  setOverlayOverride?: (overlayId: string, visible: boolean | null) => boolean;
  /** A1.4: quita todos los forzados de overlays (los deja como dicte su flag). */
  clearOverlayOverrides?: () => void;
  /** A2.10: cinemáticas (cámara, franjas, actores, transiciones). Sin él, esos ops no hacen nada. */
  cinema?: CinemaHooks;
  /** A2.10: `transition` de un op ya validada (Cinematics.parseTransition); sin ella, null */
  parseTransition?: (raw: unknown) => TransitionSpec | null;
  /**
   * A2.9: op `journalNote` — apunta una nota del diario (`assets/journal/*.json`, `notes[].id`) en la partida. Es estado
   * (se aplica al saltar una cinemática y en el rescate de `forceReset`). Devuelve false si la nota no existe (ya
   * apuntada = true, sin cambios).
   */
  journalNote?: (id: string) => boolean;
  /** A2.9: op `callAnon` — una llamada a Anon (la pista del puzle abierto, `say` con speaker «Anon»). Presentación. */
  callAnon?: () => Promise<void>;
  /**
   * A4.3: op `ambient` — { op: "ambient", id: "<ambient[].id>", action: "on" | "off" | "auto" | "burst" }: fuerza un elemento de
   * animación ambiental de la escena actual (encendido, apagado o según su `when`) o lanza una ráfaga (dust/rise con `burst`).
   * Presentación pura: no toca la partida. Devuelve false si el elemento no existe (o su tipo no tiene ráfaga).
   */
  ambient?: (id: string, action: 'on' | 'off' | 'auto' | 'burst') => boolean;
}

/**
 * A1.1: tiempo que un script puede estar parado sin nada en pantalla que espere al jugador antes de que el
 * watchdog lo dé por colgado (una promesa de la UI que nunca se resuelve).
 */
export const WATCHDOG_MS = 30_000;

/**
 * A1.1: ops que esperan algo que seguro termina solo. Mientras el script está en una de ellas el watchdog no
 * cuenta: no es un cuelgue aunque tarde.
 * - `wait`: temporizador propio.
 * - `web3Require`: solo lecturas RPC (`checkGatingRule` → `publicClient.readContract`), y el transporte `http`
 *   de viem corta cada petición por tiempo, así que acaba (en `else` si falla).
 * Los mints NO están: `walletClient.writeContract` espera a que el jugador confirme en la wallet, sin límite de
 * tiempo y sin nada en pantalla del juego. `mintAchievement` ya no bloquea el script, y un `mintNFT` que
 * pasa de 30 s se abandona como cualquier cuelgue, pero su resultado tardío sigue ejecutando onSuccess/onFail.
 */
const SELF_RESOLVING_OPS = new Set(['wait', 'web3Require', 'flicker', 'cinematic', 'cinematicStart', 'cinematicEnd']);
/** A4.3: acciones del op `ambient` */
export const AMBIENT_ACTIONS = new Set(['on', 'off', 'auto', 'burst']);

/**
 * A1.4: patrón de `flicker` ya validado: duraciones (ms) finitas y no negativas. Devuelve null si `pattern` no es
 * una lista de números. Exportada para las pruebas.
 */
export function flickerPattern(op: ScriptOp): number[] | null {
  const raw = op.pattern;
  if (Array.isArray(raw)) {
    if (!raw.length || !raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null;
    return raw as number[];
  }
  // Forma corta: { times, onMs, offMs } = times parpadeos de onMs visible y offMs oculto
  const { times, onMs, offMs } = op;
  if (typeof times !== 'number' || !Number.isInteger(times) || times < 1) return null;
  const on = typeof onMs === 'number' && Number.isFinite(onMs) && onMs >= 0 ? onMs : 100;
  const off = typeof offMs === 'number' && Number.isFinite(offMs) && offMs >= 0 ? offMs : 100;
  const out: number[] = [];
  for (let i = 0; i < times; i++) out.push(on, off);
  return out;
}

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
  /**
   * A1.10: resuelve la promesa de `execute()` de la ejecución en curso. `forceReset` la llama para que quien
   * esperaba ese script (p. ej. el onEnter de `GameScene.create`, que quita la cortina negra y lanza los triggers
   * de spawn al terminar) no se quede esperando para siempre a un op colgado que ya no se va a resolver.
   */
  private abandonCurrent: (() => void) | null = null;
  /** A1.1: pila de bloques del script en curso (el último es el más interno) */
  private frames: Frame[] = [];
  private currentLabel = '';
  /** A1.1: tiempo parado sin nada en pantalla; vuelve a cero al empezar o terminar cada op */
  private stallMs = 0;
  /**
   * A1.4: `cancelEffects` (y `forceReset`) la incrementan; un `flicker` en marcha deja de tocar el overlay en
   * cuanto ve que cambió.
   */
  private effectsEpoch = 0;
  /**
   * A2.10: este motor abrió el modo cinemática (`cinematic`/`cinematicStart`) y aún no lo ha cerrado. Al acabar el
   * script, en `forceReset` y en `cancelEffects` se cierra solo: nunca se quedan las franjas puestas.
   */
  private cinematicOwned = false;
  /** A2.10: el jugador saltó la cinemática: hasta su fin, cada op va por `runSkipped` (Cinematics.skipActionFor) */
  private skipping = false;

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

  /** A2.10: hay una cinemática abierta por este motor. */
  inCinematic(): boolean {
    return this.cinematicOwned;
  }

  /**
   * A2.10: salta la cinemática en curso (mantener pulsado o Esc). Las animaciones terminan en su estado final, el
   * texto en pantalla se cierra, y el resto de ops hasta su fin se resuelve sin esperar: los de estado se aplican,
   * los de cámara y actores saltan a su estado final y la presentación se omite. Devuelve false si no hay
   * cinemática de este motor o ya se está saltando.
   */
  skipCinematic(): boolean {
    if (!this.running || !this.cinematicOwned || this.skipping) return false;
    this.skipping = true;
    this.ctx.cinema?.finishAll();
    return true;
  }

  /** A2.10: cierra la cinemática de este motor (fin explícito, fin del script, reinicio o cierre de escena). */
  private endCinematic(instant: boolean): void {
    if (!this.cinematicOwned) return;
    const skipped = this.skipping;
    this.cinematicOwned = false;
    this.skipping = false;
    this.ctx.cinema?.end({ instant: instant || skipped, skipped });
  }

  /** Espera ms milisegundos, o menos si se activa el avance rápido (o, A1.4, si `cancelled()` pasa a true). */
  private sleep(ms: number, cancelled?: () => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      const end = Date.now() + ms;
      const tick = () => (this.fastForward || this.skipping || Date.now() >= end || cancelled?.() ? resolve() : setTimeout(tick, 50));
      tick();
    });
  }

  /**
   * A1.4: corta los efectos de presentación en curso (`flicker`) y devuelve los overlays a lo que dicte su flag.
   * No toca el estado ni el script: lo llaman `forceReset` y el SHUTDOWN de la escena.
   */
  cancelEffects(): void {
    this.effectsEpoch++;
    this.ctx.clearOverlayOverrides?.();
    // A2.10: ni franjas ni cámara a medias tras un reinicio o al cerrar la escena
    this.endCinematic(true);
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
    // A2.10: los ops de cámara, actores y transiciones terminan solos (tween o tope de tiempo): no son un cuelgue
    if (presenting || (op && (SELF_RESOLVING_OPS.has(op.op) || this.ctx.cinema?.handles(op.op)))) {
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
    const abandon = this.abandonCurrent;
    this.abandonCurrent = null;
    // A1.4: un flicker colgado o abandonado no deja el overlay a medias. A2.10: y cierra la cinemática al momento
    this.cancelEffects();

    const applied: string[] = [];
    for (const block of current) {
      if (this.salvage(block, applied)) break; // un `stop` corta el resto de ese script
    }
    for (const script of queued) this.salvage(script.ops, applied);

    if (wasRunning || applied.length) {
      const summary = applied.length ? `${applied.length} op(s) de estado aplicadas (${applied.join(', ')})` : 'sin ops de estado pendientes';
      console.warn(`[ScriptEngine] forceReset: ${reason} · ${summary}; ${queued.length} script(s) en cola`);
    }
    // A1.10: después del rescate, para que quien esperaba el script vea ya el estado con las ops aplicadas
    abandon?.();
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
        // El logro visual y su registro en la partida son estado. El mint on-chain no se lanza desde el rescate
        // (abriría la wallet de golpe): el jugador puede reclamarlo después desde el panel de logros
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
      case 'fadeToScene': {
        // A2.10: `transition` opcional: "iris" | "wipe" | "fade" | { type, at, dir, ms }
        const transition = op.transition !== undefined ? this.ctx.parseTransition?.(op.transition) ?? null : null;
        if (transition) this.ctx.gotoScene(op.sceneId as string, op.spawn as { x: number; y: number } | undefined, transition);
        else this.ctx.gotoScene(op.sceneId as string, op.spawn as { x: number; y: number } | undefined);
        return true;
      }
      case 'achievement':
        // { op: "achievement", text: "Chapter 1 Complete" } — non-blocking
        this.ctx.showAchievement?.(op.text as string);
        return true;
      case 'setCostume':
        // { op: "setCostume", prefix: "ape" } — changes player sprite
        this.ctx.setCostume?.(op.prefix as string);
        return true;
      case 'journalNote':
        // A2.9: { op: "journalNote", id: "n2_receptionist" } — apunta la nota en el diario (sin la nota, aviso)
        if (typeof op.id !== 'string' || !this.ctx.journalNote) {
          console.warn(`ScriptEngine: journalNote sin id o sin diario en ${this.currentLabel || 'script'}`);
        } else if (!this.ctx.journalNote(op.id)) {
          console.warn(`ScriptEngine: journalNote «${op.id}» no está en assets/journal`);
        }
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
        cond = this.ctx.getState().flags[op.flag as string] ?? false;
        break;
      case 'ifHasItem':
        // { op: "ifHasItem", id: "keycard", then: [...], else: [...] }
        cond = this.ctx.getState().inventory.some((i) => i.id === (op.id as string));
        break;
      case 'ifVisited':
        // { op: "ifVisited", sceneId: "basement", then: [...], else: [...] }
        cond = this.ctx.getState().visited.includes(op.sceneId as string);
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

    // A1.10: si forceReset abandona esta ejecución, la promesa se resuelve igual (el op colgado puede no
    // resolverse nunca y la ejecución vieja ya no avanza aunque se resuelva)
    const abandoned = new Promise<void>((resolve) => { this.abandonCurrent = resolve; });
    try {
      await Promise.race([this.drain(ops, gen), abandoned]);
    } finally {
      // Una ejecución abandonada por forceReset no toca el estado de la que vino después
      if (gen === this.generation) {
        this.endCinematic(false);
        this.running = false;
        this.stopped = false;
        this.frames = [];
        this.currentLabel = '';
        this.abandonCurrent = null;
      }
    }
  }

  /** El script y después los que llegaron a la cola mientras tanto (FIFO), mientras siga siendo la generación viva. */
  private async drain(ops: ScriptOp[], gen: number): Promise<void> {
    await this.runOps(ops, gen);
    // A2.10: un script que abre una cinemática y no la cierra no deja las franjas a los que vienen en cola
    if (gen === this.generation) this.endCinematic(false);
    while (gen === this.generation && this.pendingQueue.length > 0) {
      this.stopped = false;
      const next = this.pendingQueue.shift()!;
      this.currentLabel = next.label;
      await this.runOps(next.ops, gen);
      if (gen === this.generation) this.endCinematic(false);
    }
  }

  private async runOps(ops: ScriptOp[], gen: number): Promise<void> {
    // A1.10: una ejecución abandonada que entra en una rama tras resolverse lo que esperaba (web3Require, mintNFT)
    // no apila su bloque en la pila de la generación viva: el watchdog y el rescate de forceReset lo leerían
    if (gen !== this.generation) return;
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

  /**
   * A1.4: { op: "flicker", overlay: "lamp_empty", pattern: [400, 100, 150, 60], startVisible?: true }
   * (o { op: "flicker", overlay, times: 3, onMs: 100, offMs: 80 }). Alterna la visibilidad del overlay condicional
   * `overlay` de la escena actual: el primer tramo lo enseña (u oculta con `startVisible: false`) y cada tramo
   * siguiente lo invierte, durante los ms de cada número del patrón. Al terminar el overlay vuelve a lo que dicte
   * su flag. No toca el estado (antes se hacía encendiendo y apagando la flag con `wait`, lo que ensuciaba la
   * partida guardada). Bloquea como mucho la suma del patrón (menos con el avance rápido); el watchdog no lo cuenta
   * como cuelgue, y `forceReset`, `cancelEffects` o el cambio de escena lo cortan.
   */
  private async flicker(op: ScriptOp, gen: number): Promise<void> {
    const pattern = flickerPattern(op);
    const overlay = op.overlay;
    if (!pattern || typeof overlay !== 'string') {
      console.warn(`ScriptEngine: flicker mal definido en ${this.currentLabel || 'script'} (overlay y pattern o times)`);
      return;
    }
    const setter = this.ctx.setOverlayOverride;
    const epoch = this.effectsEpoch;
    const live = () => gen === this.generation && epoch === this.effectsEpoch;
    let visible = op.startVisible !== false;
    // Sin overlay en la escena (o sin contexto gráfico) no hay nada que parpadear: solo se respeta la duración
    const drawable = setter ? setter(overlay, visible) : false;
    const show = (v: boolean | null) => { if (drawable && setter) setter(overlay, v); };
    try {
      for (let i = 0; i < pattern.length; i++) {
        if (!live()) return;
        if (i > 0) show(visible);
        await this.sleep(pattern[i], () => !live());
        visible = !visible;
      }
    } finally {
      if (live()) show(null);
    }
  }

  private async runOp(op: ScriptOp, gen: number): Promise<void> {
    if (this.skipping && gen === this.generation) {
      await this.runSkipped(op, gen);
      return;
    }
    await this.runOpNormal(op, gen);
  }

  /**
   * A2.10: un op mientras se salta la cinemática (ver `SkipAction` en Cinematics.ts): estado se aplica, ramas se
   * evalúan, cámara/actores/transiciones saltan a su estado final, lo que espera algo que el salto no decide
   * (diálogo, web3) se ejecuta normal, la presentación se omite, y el fin de la cinemática deja de saltar.
   */
  private async runSkipped(op: ScriptOp, gen: number): Promise<void> {
    const action: SkipAction = this.ctx.cinema?.skipAction(op) ?? 'skip';
    switch (action) {
      case 'state':
        this.applyStateOp(op);
        return;
      case 'branch': {
        const branch = this.branchOf(op);
        if (branch) await this.runOps(branch, gen);
        return;
      }
      case 'end':
        this.endCinematic(true);
        return;
      case 'instant':
        // `cinematic {on:true}` dentro de la misma cinemática: ya está abierta
        if (this.ctx.cinema?.handles(op.op)) await this.ctx.cinema.run(op, true);
        return;
      case 'run':
        await this.runOpNormal(op, gen);
        return;
      case 'stop':
        if (gen === this.generation) this.stopped = true;
        return;
      default:
        return;
    }
  }

  private async runOpNormal(op: ScriptOp, gen: number): Promise<void> {
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

      case 'stinger':
        this.ctx.playStinger?.(op.kind as string);
        break;

      case 'flicker':
        await this.flicker(op, gen);
        break;

      case 'ambient': {
        // A4.3: { op: "ambient", id, action: on | off | auto | burst } — instantáneo, presentación pura
        const action = op.action;
        if (typeof op.id !== 'string' || !AMBIENT_ACTIONS.has(String(action))) {
          console.warn(`ScriptEngine: ambient mal definido en ${this.currentLabel || 'script'} (id y action on|off|auto|burst)`);
          break;
        }
        if (!this.ctx.ambient?.(op.id, action as 'on' | 'off' | 'auto' | 'burst')) {
          console.warn(`ScriptEngine: ambient «${op.id}» no está en la escena (o no admite ${String(action)})`);
        }
        break;
      }

      case 'callAnon':
        // A2.9: { op: "callAnon" } — Anon llama: la pista del puzle abierto más avanzado (o una frase de relleno)
        await this.ctx.callAnon?.();
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

      case 'showDashboard':
        // A3.10: { op: "showDashboard" } — panel del Mining Rig; el script sigue al cerrarlo (X, toque fuera, Esc)
        // A9.13: { op: "showDashboard", mode: "founder" } — Founder Mode: cifras globales reales del Diamond (sin cartera)
        if (this.ctx.showDashboard) await this.ctx.showDashboard(op.mode === 'founder' ? 'founder' : 'holder');
        else console.warn(`ScriptEngine: showDashboard sin panel en ${this.currentLabel || 'script'}`);
        break;

      case 'mintNFT': {
        // { op: "mintNFT", tokenId: 99, onSuccess: [...], onFail: [...] }
        if (!this.ctx.mintItem) {
          await this.ctx.say('Wallet not connected. Cannot mint.');
          if (op.onFail) await this.runOps(op.onFail as ScriptOp[], gen);
          break;
        }
        this.ctx.showToast?.('pending', 'Minting... (confirm in wallet)');
        const mintLabel = `${this.currentLabel || 'script'}/mintNFT`;
        const mintResult = await this.ctx.mintItem(op.tokenId as number).catch((err: unknown): MintResult => ({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
        let branch: ScriptOp[] | undefined;
        if (mintResult.status === 'success') {
          this.ctx.showToast?.('success', 'Minted successfully!');
          branch = op.onSuccess as ScriptOp[] | undefined;
        } else if (mintResult.status === 'not-configured') {
          this.ctx.showToast?.('failed', 'Minting not available yet');
          branch = op.onFail as ScriptOp[] | undefined;
        } else {
          this.ctx.showToast?.('failed', mintResult.error ?? 'Mint failed');
          branch = op.onFail as ScriptOp[] | undefined;
        }
        if (!branch) break;
        if (gen === this.generation) {
          await this.runOps(branch, gen);
        } else {
          // A1.1: el watchdog abandonó este script mientras el jugador tardaba en confirmar en la wallet, pero la
          // transacción ha terminado igual: su rama (p. ej. el addItem del objeto minteado) no se pierde
          void this.execute(branch, `${mintLabel} (resultado tras reinicio)`);
        }
        break;
      }

      case 'mintAchievement': {
        // { op: "mintAchievement", achievementId: 1, text: "Chapter 1 Complete", onSuccess: [...], onFail: [...] }
        // Always show visual achievement first
        if (op.text) this.ctx.showAchievement?.(op.text as string);
        // A1.1: el mint on-chain va en segundo plano. Espera a que el jugador confirme en la wallet sin límite de
        // tiempo y sin nada del juego en pantalla: si bloqueara el script, la entrada quedaría bloqueada para
        // siempre (p. ej. WalletConnect en el móvil sin mirar). El logro visual ya está; los avisos y las ramas
        // onSuccess/onFail llegan después como un script aparte.
        if (this.ctx.mintAchievement) {
          const achLabel = `${this.currentLabel || 'script'}/mintAchievement`;
          void this.ctx.mintAchievement(op.achievementId as number)
            .catch((err: unknown): MintResult => ({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' }))
            .then((result) => {
              let later: ScriptOp[] | undefined;
              if (result.status === 'success') {
                this.ctx.showToast?.('success', `Achievement minted on-chain!`);
                later = op.onSuccess as ScriptOp[] | undefined;
              } else if (result.status === 'not-configured') {
                // Silently skip — visual achievement still shown
                later = op.onFail as ScriptOp[] | undefined;
              } else if (result.status === 'failed') {
                // Don't interrupt gameplay for a failed achievement mint
                console.warn('Achievement mint failed:', result.error);
                later = op.onFail as ScriptOp[] | undefined;
              }
              if (later?.length) void this.execute(later, `${achLabel} (resultado)`);
            });
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

      // ─── A2.10: modo cinemática ───────────────────────
      case 'cinematic':
      case 'cinematicStart':
      case 'cinematicEnd': {
        // { op: "cinematic", on: true|false } o { op: "cinematicStart" } / { op: "cinematicEnd" }
        const start = op.op === 'cinematicStart' || (op.op === 'cinematic' && op.on !== false);
        if (gen !== this.generation) break;
        if (start) {
          if (!this.ctx.cinema) break;
          this.cinematicOwned = true;
          this.ctx.cinema.begin();
        } else {
          this.endCinematic(false);
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
        // A2.10: cámara, transiciones y actores (CINEMATIC_OPS) van al director de cinemáticas
        if (this.ctx.cinema?.handles(op.op)) {
          await this.ctx.cinema.run(op, false);
          break;
        }
        console.warn(`ScriptEngine: unknown opcode "${op.op}"`);
    }
  }
}

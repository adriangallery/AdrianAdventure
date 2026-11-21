/**
 * F1.2 (plan FUNTICO_ADVENTURE): estado de UNA carrera de Triage, separado de la vista. La vista (TriageScene) se puede
 * recolocar entera al girar o redimensionar sin tocar nada de aquí: carrera, toques, estación abierta, reloj (basado en
 * el `performance.now()` del inicio) y desplazamiento de la escena en vertical.
 *
 * Los toques se registran con el formato de F1.1 (`{t, est, obj, x, y}`) y la puntuación sale SIEMPRE de `scoreRun`,
 * así que lo que se pinta es exactamente lo que recalculará el servidor. Los toques que el servidor rechazaría
 * (`validateTaps`: menos de `minGapMs` entre toques o de `minReactionMs` desde que abre la estación) se ignoran aquí
 * en vez de registrarse.
 */
import { inBounds, scoreRun } from './triage.js';
import type { ScoreResult, Station, TapEvent, TriageRun } from './triage';

export type TapOutcome =
  | { kind: 'ignored'; reason: 'finished' | 'too_soon' | 'wrong_kind' }
  /** Acierto: la estación se cierra y abre la siguiente (o se acaba). */
  | { kind: 'hit'; station: Station; points: number; event: TapEvent }
  /** Fallo; `closed` = era el último intento (se revela el objetivo y pasa). */
  | { kind: 'miss'; station: Station; penalty: number; closed: boolean; event: TapEvent };

export class TriageModel {
  readonly run: TriageRun;
  readonly taps: TapEvent[] = [];
  /** performance.now() del inicio de la carrera (t = 0). */
  readonly startedAt: number;
  /** Estación abierta (índice); = stations.length cuando se han cerrado todas. */
  current = 0;
  /** ms (desde el inicio) en que abrió la estación actual. */
  openedAt = 0;
  /** Fallos en la estación actual. */
  misses = 0;
  /** Desplazamiento horizontal de la escena en vertical: 0 = borde izquierdo, 1 = borde derecho. */
  pan = 0.5;
  /** Puntuación con los toques hasta ahora (scoreRun). */
  score: ScoreResult;
  /** ms en que terminó (todas cerradas o se acabó el tiempo); null mientras sigue. */
  finishedAt: number | null = null;
  /** F2.2: `runId` del servidor (`run/start`) en live; null en simulado (semilla local). */
  runId: string | null = null;

  private readonly clock: () => number;

  constructor(run: TriageRun, clock: () => number = () => performance.now()) {
    this.run = run;
    this.clock = clock;
    this.startedAt = clock();
    this.score = scoreRun(run, this.taps);
  }

  /** ms enteros desde el inicio. */
  now(): number {
    return Math.max(0, Math.round(this.clock() - this.startedAt));
  }

  remainingMs(t = this.now()): number {
    return Math.max(0, this.run.durationMs - t);
  }

  get station(): Station | null {
    return this.run.stations[this.current] ?? null;
  }

  get finished(): boolean {
    return this.finishedAt !== null;
  }

  /** Comprueba el reloj; devuelve true si la carrera acaba de terminar por tiempo. */
  tick(t = this.now()): boolean {
    if (this.finished) return false;
    if (t >= this.run.durationMs) {
      this.finishedAt = this.run.durationMs;
      return true;
    }
    return false;
  }

  /** Racha actual (aciertos seguidos antes del próximo toque). */
  get streak(): number {
    let s = 0;
    for (const st of this.score.stations) {
      if (st.closedAt === null) break;
      s = st.hit ? s + 1 : 0;
    }
    return s;
  }

  /** Multiplicador de racha (×1.0…×2.0) del próximo acierto. */
  get multiplier(): number {
    const table = this.run.rules.streakPermille;
    return table[Math.min(this.streak, table.length - 1)] / 1000;
  }

  /** Mejor racha de la carrera. */
  get bestStreak(): number {
    let s = 0;
    let best = 0;
    for (const st of this.score.stations) {
      if (st.closedAt === null) break;
      s = st.hit ? s + 1 : 0;
      best = Math.max(best, s);
    }
    return best;
  }

  /** Fracción (1 → 0) de la bonificación de rapidez que queda en la estación abierta. */
  speedFraction(t = this.now()): number {
    const st = this.station;
    if (!st) return 0;
    const over = t - this.openedAt - st.graceMs;
    if (over <= 0) return 1;
    return Math.max(0, 1 - over / this.run.rules.windowMs);
  }

  /** Toque en la escena, en % del mundo (0–100). Mismo camino para el toque real y el gancho de pruebas. */
  tapWorld(xPct: number, yPct: number): TapOutcome {
    const st = this.station;
    if (!st || st.kind === 'relapse') return { kind: 'ignored', reason: this.finished || !st ? 'finished' : 'wrong_kind' };
    const x = Math.round(Math.min(100, Math.max(0, xPct)) * 100) / 100;
    const y = Math.round(Math.min(100, Math.max(0, yPct)) * 100) / 100;
    return this.record(st, x, y, inBounds(x, y, st.bounds));
  }

  /** Réplica elegida en RELAPSE (índice 0–3). */
  pickOption(i: number): TapOutcome {
    const st = this.station;
    if (!st || st.kind !== 'relapse') return { kind: 'ignored', reason: this.finished || !st ? 'finished' : 'wrong_kind' };
    return this.record(st, i, 0, i === st.correct);
  }

  private record(st: Station, x: number, y: number, hit: boolean): TapOutcome {
    const t = this.now();
    if (this.tick(t) || this.finished) return { kind: 'ignored', reason: 'finished' };
    const last = this.taps[this.taps.length - 1];
    if (t - this.openedAt < this.run.rules.minReactionMs || (last && t - last.t < this.run.rules.minGapMs)) {
      return { kind: 'ignored', reason: 'too_soon' };
    }
    const event: TapEvent = { t, est: st.i, obj: st.obj, x, y };
    this.taps.push(event);
    this.score = scoreRun(this.run, this.taps);
    if (hit) {
      const points = this.score.stations[st.i].points;
      this.close(t);
      return { kind: 'hit', station: st, points, event };
    }
    this.misses++;
    const closed = this.misses >= st.maxMisses;
    if (closed) this.close(t);
    return { kind: 'miss', station: st, penalty: this.run.rules.missPenalty, closed, event };
  }

  private close(t: number): void {
    this.current++;
    this.openedAt = t;
    this.misses = 0;
    this.pan = 0.5;
    if (this.current >= this.run.stations.length) this.finishedAt = t;
    // Con todas cerradas, scoreRun ya suma el sobrante: se recalcula con el registro completo
    this.score = scoreRun(this.run, this.taps);
  }

  /** Resultado final (lo que se envía a CompletePractice). */
  result(): ScoreResult {
    return scoreRun(this.run, this.taps);
  }
}

/**
 * F2.2 + F2.4 (plan FUNTICO_ADVENTURE): formato de lo que el cliente manda sobre una carrera de Triage.
 *
 * Dos cosas distintas (ver docs/funtico/VERIFIER.md):
 *  - `gameEvents` de `CompletePractice`: el contrato EXACTO que valida el save-server (F2.2): cabecera
 *    `{triage:1, catalog}` y un toque por cadena con solo `{t, est, obj, x, y}`. Cualquier clave de más → 400.
 *  - Eventos de `RecordEvent_Client` (F2.4, para el Verifier de Funtico): compactos, uno por cadena:
 *      inicio  `{ev:'start', v, run, cat, n, dur}`
 *      toque   `{t, est, obj, x, y, ok}`   (ok = 1 acierto / 0 fallo, según el cliente)
 *      fin     `{ev:'end', t, score, hits, misses, done}`
 *    Se encolan y se entregan fuera del camino del toque (`EventQueue`).
 */
import type { TapEvent } from './triage';

/** Versión del formato de eventos de RecordEvent_Client. */
export const VERIFIER_EVENTS_VERSION = 1;

/** `GameEvents` de CompletePractice tal y como los valida el servidor (F2.2). */
export function gameEventsFor(catalog: string, taps: readonly TapEvent[]): string[] {
  return [
    JSON.stringify({ triage: 1, catalog }),
    ...taps.map((e) => JSON.stringify({ t: e.t, est: e.est, obj: e.obj, x: e.x, y: e.y })),
  ];
}

export function startEvent(o: { runId: string | null; catalog: string; stations: number; durationMs: number }): string {
  return JSON.stringify({ ev: 'start', v: VERIFIER_EVENTS_VERSION, run: o.runId ?? 'local', cat: o.catalog, n: o.stations, dur: o.durationMs });
}

export function tapEvent(e: TapEvent, ok: boolean): string {
  return JSON.stringify({ t: e.t, est: e.est, obj: e.obj, x: e.x, y: e.y, ok: ok ? 1 : 0 });
}

export function endEvent(o: { t: number; score: number; hits: number; misses: number; completed: boolean }): string {
  return JSON.stringify({ ev: 'end', t: o.t, score: o.score, hits: o.hits, misses: o.misses, done: o.completed ? 1 : 0 });
}

/**
 * Cola de eventos: `push` no hace nada más que apuntar y programar una entrega (setTimeout 0), así el toque no espera
 * al SDK. `flush()` entrega lo pendiente en el acto (al acabar la carrera). Un sumidero que lanza no rompe el juego.
 */
export class EventQueue {
  private pending: string[] = [];
  private scheduled = false;
  private readonly sink: (line: string) => void;
  private readonly schedule: (fn: () => void) => void;

  constructor(sink: (line: string) => void, schedule: (fn: () => void) => void = (fn) => { setTimeout(fn, 0); }) {
    this.sink = sink;
    this.schedule = schedule;
  }

  push(line: string): void {
    this.pending.push(line);
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }

  flush(): void {
    this.scheduled = false;
    const lines = this.pending;
    this.pending = [];
    for (const l of lines) {
      try { this.sink(l); } catch { /* el registro nunca para la carrera */ }
    }
  }

  get size(): number {
    return this.pending.length;
  }
}

/**
 * F3.1 (plan FUNTICO_ADVENTURE): recolector de las métricas de Campaign por capítulo. Implementa los ganchos de
 * plataforma (`src/platform/PlatformHooks.ts`) y acumula, por capítulo:
 *
 *   completed      0/1: se vio `chapter_N_complete` (onChapterComplete)
 *   time_s         segundos ENTEROS de tiempo de juego (onPlayTime: el mismo reloj que `playTimeMs`, con tope por
 *                  fotograma, sin pestaña oculta ni menú; además `pause()`/`resume()` para pantallas propias)
 *   hints          llamadas a Anon que dieron pista (nivel ≥ 1; la frase de relleno sin puzle abierto no cuenta)
 *   hint_max_level nivel más alto de pista dado (0–3)
 *   fails          respuestas de fallo («no puedo»), sin las de LOOK (mirar es explorar, no fallar) ni los duelos
 *   duel_losses    duelos perdidos (nodo `lose` de un árbol: FUD con Chad, PZ-BOT)
 *   optional       logros opcionales distintos conseguidos (categorías `explorer` y `secret`)
 *   actions        verbos ejecutados sobre la escena (hotspot o NPC), el mismo punto que `qaActions`
 *
 * Cada evento va al capítulo EN CURSO (`chapter`): empieza en el que se le diga y, al cerrarse ese, pasa al siguiente
 * (lo que pase después del cierre ya no ensucia el capítulo cerrado). El tiempo de un capítulo cerrado no sigue
 * corriendo.
 *
 * Lógica pura (solo imports de tipos): se prueba en Node con `--experimental-strip-types`. El reloj es inyectable
 * porque no hay reloj propio: el tiempo solo entra por `onPlayTime(ms)` (en el juego, cada fotograma de GameScene; en
 * los tests, a mano). Serializable (`toJSON` / `CampaignMetrics.restore`) para la reanudación de F3.3.
 */
import type { PlatformAction, PlatformFail, PlatformHint, PlatformHooks } from '../platform/PlatformHooks';

export const METRICS_VERSION = 1;
export const MAX_CHAPTER = 5;
/** Tope de un tic de tiempo (igual que PLAYTIME_MAX_STEP_MS de Ending.ts): un valor raro no infla el reloj */
export const MAX_TICK_MS = 250;

/** Lo que se manda a `CompleteCampaignLevel` (métricas planas, enteros). */
export interface ChapterMetrics {
  completed: 0 | 1;
  time_s: number;
  hints: number;
  hint_max_level: number;
  fails: number;
  duel_losses: number;
  optional: number;
  actions: number;
}

/** Estado interno de un capítulo (serializable). */
export interface ChapterTally {
  completed: boolean;
  timeMs: number;
  hints: number;
  hintMax: number;
  fails: number;
  duelLosses: number;
  optional: string[];
  actions: number;
}

export interface CampaignMetricsJSON {
  v: number;
  chapter: number;
  paused: boolean;
  chapters: Record<string, ChapterTally>;
}

const emptyTally = (): ChapterTally => ({
  completed: false, timeMs: 0, hints: 0, hintMax: 0, fails: 0, duelLosses: 0, optional: [], actions: 0,
});

const validChapter = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_CHAPTER;
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export class CampaignMetrics implements PlatformHooks {
  private chapterNow: number;
  private paused = false;
  private readonly tallies = new Map<number, ChapterTally>();

  constructor(opts: { chapter?: number } = {}) {
    this.chapterNow = validChapter(opts.chapter) ? opts.chapter : 1;
  }

  /** Capítulo en curso (al que van los eventos). */
  get chapter(): number {
    return this.chapterNow;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Empieza (o reanuda) a medir el capítulo `n`. No borra lo ya medido. */
  startChapter(n: number): void {
    if (validChapter(n)) this.chapterNow = n;
  }

  /** Borra lo medido del capítulo `n` (repetir un nivel desde cero). */
  resetChapter(n: number): void {
    if (validChapter(n)) this.tallies.delete(n);
  }

  /** Para el reloj (pantallas de la plataforma por encima del juego). Los eventos siguen contando. */
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  private tally(n = this.chapterNow): ChapterTally {
    let t = this.tallies.get(n);
    if (!t) { t = emptyTally(); this.tallies.set(n, t); }
    return t;
  }

  // ─── PlatformHooks ───

  onPlayTime(ms: number): void {
    if (this.paused || !Number.isFinite(ms) || ms <= 0) return;
    const t = this.tally();
    if (t.completed) return;
    t.timeMs += Math.min(ms, MAX_TICK_MS);
  }

  onAction(_action: PlatformAction): void {
    this.tally().actions++;
  }

  onHint(level: number, _info?: PlatformHint): void {
    if (!Number.isFinite(level) || level < 1) return;
    const t = this.tally();
    t.hints++;
    t.hintMax = Math.max(t.hintMax, Math.min(3, Math.floor(level)));
  }

  onFail(fail: PlatformFail): void {
    if (!fail || typeof fail.kind !== 'string') return;
    const t = this.tally();
    if (fail.kind === 'duel') { t.duelLosses++; return; }
    if (fail.verb === 'LOOK') return;
    t.fails++;
  }

  onChapterComplete(chapter: number): void {
    if (!validChapter(chapter)) return;
    this.tally(chapter).completed = true;
    if (chapter >= this.chapterNow) this.chapterNow = Math.min(MAX_CHAPTER, chapter + 1);
  }

  onOptional(id: string): void {
    if (typeof id !== 'string' || !id) return;
    const t = this.tally();
    if (!t.optional.includes(id)) t.optional.push(id);
  }

  // ─── Lectura ───

  /** Métricas planas del capítulo `n` (por defecto, el en curso). */
  metrics(n: number = this.chapterNow): ChapterMetrics {
    const t = this.tallies.get(n) ?? emptyTally();
    return {
      completed: t.completed ? 1 : 0,
      time_s: Math.floor(t.timeMs / 1000),
      hints: t.hints,
      hint_max_level: t.hintMax,
      fails: t.fails,
      duel_losses: t.duelLosses,
      optional: t.optional.length,
      actions: t.actions,
    };
  }

  /** Capítulos con algo medido, en orden. */
  chapters(): number[] {
    return [...this.tallies.keys()].sort((a, b) => a - b);
  }

  toJSON(): CampaignMetricsJSON {
    const chapters: Record<string, ChapterTally> = {};
    for (const n of this.chapters()) {
      const t = this.tallies.get(n)!;
      chapters[n] = { ...t, optional: [...t.optional] };
    }
    return { v: METRICS_VERSION, chapter: this.chapterNow, paused: this.paused, chapters };
  }

  /** Rehace un recolector desde `toJSON()` (o algo parecido): lo que no cuadra se descarta, nunca lanza. */
  static restore(raw: unknown): CampaignMetrics {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CampaignMetricsJSON>;
    const m = new CampaignMetrics({ chapter: validChapter(r.chapter) ? r.chapter : 1 });
    if (r.v !== METRICS_VERSION) return m;
    m.paused = r.paused === true;
    const chapters = r.chapters && typeof r.chapters === 'object' ? r.chapters : {};
    for (const [k, v] of Object.entries(chapters)) {
      const n = Number(k);
      if (!validChapter(n) || !v || typeof v !== 'object') continue;
      const t = v as Partial<ChapterTally>;
      m.tallies.set(n, {
        completed: t.completed === true,
        timeMs: count(t.timeMs),
        hints: count(t.hints),
        hintMax: Math.min(3, count(t.hintMax)),
        fails: count(t.fails),
        duelLosses: count(t.duelLosses),
        optional: Array.isArray(t.optional) ? [...new Set(t.optional.filter((x): x is string => typeof x === 'string' && !!x))] : [],
        actions: count(t.actions),
      });
    }
    return m;
  }
}

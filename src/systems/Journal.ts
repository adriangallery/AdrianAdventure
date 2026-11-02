/*
 * A2.9 + A2.9a (plan SCUMM): el diario de Dex, que es su móvil. Lógica pura, sin Phaser ni imports con valor (se prueba
 * con `node --experimental-strip-types --test tests/journal.test.mjs`).
 *
 * Datos: `assets/journal/chapter-<n>.json`, uno por capítulo (los carga `src/ui/JournalPanel.ts` con import.meta.glob y
 * los revisa `scripts/lint-scenes.mjs`, regla h). Cada fichero:
 *   { chapter: n,
 *     goals:   [{ id, text, doneWhen }],                  objetivos del capítulo; tic cuando se cumple `doneWhen`
 *     notes:   [{ id, text, shownWhen? }],                 notas: se apuntan solas al cumplirse `shownWhen` o con el
 *                                                         op `journalNote` (sin `shownWhen`, solo con el op)
 *     puzzles: [{ id, openWhen?, doneWhen, hints: [h1, h2, h3] }],   escalera de pistas de Anon (dirección → objeto →
 *                                                         solución casi literal), en el orden de la ruta
 *     anonIdle: [frases] }                                lo que dice Anon si no hay ningún puzle abierto
 * Condiciones: la gramática de `when` de A2.6a (`flag`, `!flag`, `item:id`, `!item:id`, también `flag:x`; texto suelto
 * o lista = todas). La misma expresión regular vive en DialogueSystem.ts y en scripts/lint-scenes.mjs.
 *
 * «Call Anon» (`callAnon`): elige el puzle ABIERTO más avanzado del capítulo actual (el último de la lista cuyo
 * `openWhen` se cumple y cuyo `doneWhen` todavía no) y da el siguiente nivel de su escalera (1 → 2 → 3; a partir de ahí
 * repite el 3). Sin puzle abierto, una frase de `anonIdle` (rota con cada llamada). El progreso (notas apuntadas, lo ya
 * visto en el diario, nivel por puzle, llamadas) va en `GameState.journal` y lo sanea `SaveMigration.ts`.
 */

export type Condition = string | string[] | undefined;

export interface JournalGoal {
  id: string;
  text: string;
  doneWhen: Condition;
}

export interface JournalNote {
  id: string;
  text: string;
  /** Sin condición: la nota solo se apunta con el op `journalNote` */
  shownWhen?: Condition;
}

export interface AnonPuzzle {
  id: string;
  /** Sin condición: abierto desde que empieza el capítulo */
  openWhen?: Condition;
  doneWhen: Condition;
  /** Tres niveles: dirección, objeto, solución casi literal */
  hints: string[];
}

export interface JournalChapter {
  chapter: number;
  goals: JournalGoal[];
  notes: JournalNote[];
  puzzles: AnonPuzzle[];
  anonIdle: string[];
}

/** Progreso del diario en la partida (`GameState.journal`). */
export interface JournalProgress {
  /** Notas apuntadas, en el orden en que se apuntaron */
  notes: string[];
  /** Objetivos cumplidos y notas que el jugador ya vio con el diario abierto (para el punto de «nuevo») */
  seen: string[];
  /** Nivel de pista dado por puzle (1-3) */
  hints: Record<string, number>;
  /** Llamadas a Anon hechas (rota las frases de relleno) */
  calls: number;
}

/** Lo que hace falta del mundo para evaluar condiciones. */
export interface JournalWorld {
  flags: Record<string, boolean | undefined>;
  items: readonly string[];
}

export interface AnonCall {
  /** Puzle del que se dio la pista; null = frase de relleno (ningún puzle abierto) */
  puzzle: string | null;
  /** Nivel dado (1-3); 0 en la frase de relleno */
  level: number;
  text: string;
  chapter: number;
}

export const HINT_LEVELS = 3;

/** Misma sintaxis que CONDITION_RE de DialogueSystem.ts (A2.6a) y de scripts/lint-scenes.mjs. */
export const JOURNAL_CONDITION_RE = /^(!?)(?:(flag|item):)?([A-Za-z0-9_.-]+)$/;

export function emptyProgress(): JournalProgress {
  return { notes: [], seen: [], hints: {}, calls: 0 };
}

/** Normaliza `when` (texto suelto o lista) a lista. */
export function conditionList(when: Condition): string[] {
  if (when === undefined || when === null || when === '') return [];
  return Array.isArray(when) ? when : [when];
}

/** true si se cumplen todas; una condición mal escrita no se cumple (así una pista nunca sale antes de tiempo). */
export function conditionsMet(when: Condition, world: JournalWorld): boolean {
  for (const raw of conditionList(when)) {
    const m = typeof raw === 'string' ? JOURNAL_CONDITION_RE.exec(raw.trim()) : null;
    if (!m) return false;
    const value = m[2] === 'item' ? world.items.includes(m[3]) : Boolean(world.flags[m[3]]);
    if (value === (m[1] === '!')) return false;
  }
  return true;
}

// ─── Carga ─────────────────────────────────────────────────────────────────────────────────────────────────

const isCond = (v: unknown): v is Condition =>
  v === undefined || typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Un fichero de capítulo tal como llega del JSON → capítulo con solo las entradas bien formadas (lo malo se descarta
 * con aviso; el linter, regla h, lo marca como error). null si no tiene `chapter`.
 */
export function parseChapter(raw: unknown, warn: (msg: string) => void = () => {}): JournalChapter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.chapter !== 'number' || !Number.isInteger(r.chapter)) {
    warn('diario: fichero sin "chapter" entero');
    return null;
  }
  const chapter: number = r.chapter;
  const list = (k: string): Record<string, unknown>[] =>
    (Array.isArray(r[k]) ? (r[k] as unknown[]) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  const goals: JournalGoal[] = [];
  for (const g of list('goals')) {
    if (nonEmpty(g.id) && nonEmpty(g.text) && isCond(g.doneWhen) && conditionList(g.doneWhen).length) {
      goals.push({ id: g.id, text: g.text, doneWhen: g.doneWhen });
    } else warn(`diario cap. ${chapter}: objetivo mal formado ${JSON.stringify(g).slice(0, 80)}`);
  }
  const notes: JournalNote[] = [];
  for (const n of list('notes')) {
    if (nonEmpty(n.id) && nonEmpty(n.text) && isCond(n.shownWhen)) notes.push({ id: n.id, text: n.text, shownWhen: n.shownWhen });
    else warn(`diario cap. ${chapter}: nota mal formada ${JSON.stringify(n).slice(0, 80)}`);
  }
  const puzzles: AnonPuzzle[] = [];
  for (const p of list('puzzles')) {
    const hints = Array.isArray(p.hints) ? p.hints : [];
    if (nonEmpty(p.id) && isCond(p.openWhen) && isCond(p.doneWhen) && conditionList(p.doneWhen).length
      && hints.length === HINT_LEVELS && hints.every(nonEmpty)) {
      puzzles.push({ id: p.id, openWhen: p.openWhen, doneWhen: p.doneWhen, hints: hints as string[] });
    } else warn(`diario cap. ${chapter}: puzle mal formado ${JSON.stringify(p).slice(0, 80)}`);
  }
  const anonIdle = (Array.isArray(r.anonIdle) ? r.anonIdle : []).filter(nonEmpty);
  return { chapter, goals, notes, puzzles, anonIdle };
}

/** Varios ficheros → capítulos ordenados (si dos dicen el mismo número, gana el primero). */
export function parseChapters(raws: unknown[], warn?: (msg: string) => void): JournalChapter[] {
  const out = new Map<number, JournalChapter>();
  for (const raw of raws) {
    const ch = parseChapter(raw, warn);
    if (ch && !out.has(ch.chapter)) out.set(ch.chapter, ch);
  }
  return [...out.values()].sort((a, b) => a.chapter - b.chapter);
}

export function chapterData(chapters: readonly JournalChapter[], chapter: number): JournalChapter | null {
  return chapters.find((c) => c.chapter === chapter) ?? null;
}

// ─── Vista ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface GoalView {
  id: string;
  text: string;
  done: boolean;
}

export function goalsView(ch: JournalChapter | null, world: JournalWorld): GoalView[] {
  return (ch?.goals ?? []).map((g) => ({ id: g.id, text: g.text, done: conditionsMet(g.doneWhen, world) }));
}

/** Busca una nota por id en todos los capítulos. */
export function findNote(chapters: readonly JournalChapter[], id: string): (JournalNote & { chapter: number }) | null {
  for (const ch of chapters) {
    const n = ch.notes.find((x) => x.id === id);
    if (n) return { ...n, chapter: ch.chapter };
  }
  return null;
}

/**
 * Notas que tocan apuntar ya y aún no están en el progreso: las que tienen `shownWhen` y se cumple, de cualquier
 * capítulo hasta el actual (una flag de un capítulo posterior no puede estar puesta, pero así no se adelanta nada).
 */
export function pendingNotes(chapters: readonly JournalChapter[], chapter: number, world: JournalWorld, progress: JournalProgress): string[] {
  const have = new Set(progress.notes);
  const out: string[] = [];
  for (const ch of chapters) {
    if (ch.chapter > chapter) continue;
    for (const n of ch.notes) {
      if (have.has(n.id) || conditionList(n.shownWhen).length === 0) continue;
      if (conditionsMet(n.shownWhen, world)) out.push(n.id);
    }
  }
  return out;
}

/** Progreso con las notas pendientes ya apuntadas (el mismo objeto si no hay ninguna). */
export function syncNotes(chapters: readonly JournalChapter[], chapter: number, world: JournalWorld, progress: JournalProgress): JournalProgress {
  const pending = pendingNotes(chapters, chapter, world, progress);
  return pending.length ? { ...progress, notes: [...progress.notes, ...pending] } : progress;
}

/** Op `journalNote`: apunta una nota por id (false si no existe o ya estaba). */
export function addNote(chapters: readonly JournalChapter[], progress: JournalProgress, id: string): { progress: JournalProgress; added: boolean } {
  if (!findNote(chapters, id) || progress.notes.includes(id)) return { progress, added: false };
  return { progress: { ...progress, notes: [...progress.notes, id] }, added: true };
}

/** Lo que el diario marca como nuevo (punto en el botón): objetivos cumplidos y notas apuntadas que aún no se vieron. */
export function unseenIds(chapters: readonly JournalChapter[], chapter: number, world: JournalWorld, progress: JournalProgress): string[] {
  const seen = new Set(progress.seen);
  const done = goalsView(chapterData(chapters, chapter), world).filter((g) => g.done).map((g) => g.id);
  return [...done, ...progress.notes].filter((id) => !seen.has(id));
}

/** Al abrir el diario: todo lo que está a la vista pasa a visto. */
export function markSeen(chapters: readonly JournalChapter[], chapter: number, world: JournalWorld, progress: JournalProgress): JournalProgress {
  const unseen = unseenIds(chapters, chapter, world, progress);
  return unseen.length ? { ...progress, seen: [...progress.seen, ...unseen] } : progress;
}

// ─── Anon ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Puzle abierto más avanzado del capítulo: el último de la lista con `openWhen` cumplido y `doneWhen` sin cumplir. */
export function openPuzzle(ch: JournalChapter | null, world: JournalWorld): AnonPuzzle | null {
  const list = ch?.puzzles ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (conditionsMet(p.openWhen, world) && !conditionsMet(p.doneWhen, world)) return p;
  }
  return null;
}

/** Frase de relleno de Anon si el capítulo no trae ninguna. Tiene voz (scripts/voices/extract.mjs la lee de aquí). */
export const ANON_FALLBACK = 'Nothing to say. Keep walking.';

/**
 * Una llamada a Anon: el siguiente nivel de la escalera del puzle abierto más avanzado (y el progreso nuevo, con ese
 * nivel apuntado y una llamada más), o una frase de relleno si no hay puzle abierto. No muta `progress`.
 */
export function callAnon(
  chapters: readonly JournalChapter[],
  chapter: number,
  world: JournalWorld,
  progress: JournalProgress,
): { call: AnonCall; progress: JournalProgress } {
  const ch = chapterData(chapters, chapter);
  const puzzle = openPuzzle(ch, world);
  const calls = progress.calls + 1;
  if (!puzzle) {
    const idle = ch?.anonIdle.length ? ch.anonIdle : [ANON_FALLBACK];
    const text = idle[progress.calls % idle.length];
    return { call: { puzzle: null, level: 0, text, chapter }, progress: { ...progress, calls } };
  }
  const level = Math.min(HINT_LEVELS, (progress.hints[puzzle.id] ?? 0) + 1);
  return {
    call: { puzzle: puzzle.id, level, text: puzzle.hints[level - 1], chapter },
    progress: { ...progress, calls, hints: { ...progress.hints, [puzzle.id]: level } },
  };
}

/** Nivel de pista ya dado del puzle abierto (para el panel: «hint 2/3»); null si no hay puzle abierto. */
export function openPuzzleLevel(chapters: readonly JournalChapter[], chapter: number, world: JournalWorld, progress: JournalProgress): { puzzle: string; level: number } | null {
  const p = openPuzzle(chapterData(chapters, chapter), world);
  return p ? { puzzle: p.id, level: progress.hints[p.id] ?? 0 } : null;
}

/** Progreso tal como llega de una partida (o nada) → progreso válido. La misma regla que SaveMigration.ts. */
export function progressFrom(raw: unknown): JournalProgress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyProgress();
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const hints: Record<string, number> = {};
  if (r.hints && typeof r.hints === 'object' && !Array.isArray(r.hints)) {
    for (const [k, v] of Object.entries(r.hints as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 1) hints[k] = Math.min(HINT_LEVELS, Math.floor(v));
    }
  }
  const calls = typeof r.calls === 'number' && Number.isFinite(r.calls) && r.calls >= 0 ? Math.floor(r.calls) : 0;
  return { notes: [...new Set(strings(r.notes))], seen: [...new Set(strings(r.seen))], hints, calls };
}

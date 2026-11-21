/**
 * F1.5 (plan FUNTICO_ADVENTURE): historial local de carreras de Triage para «MY RESULTS» (las de Campaign salen de
 * campaign/progress.ts). Lógica pura con almacenamiento inyectable; probado en Node (tests/funtico-history.test.mjs).
 * Clave: `adrian_adventure_funtico_triage_history_<userId>`; guarda las últimas MAX_RUNS, la más reciente primero.
 */

export const HISTORY_PREFIX = 'adrian_adventure_funtico_triage_history_';
export const MAX_RUNS = 50;

export interface TriageRunRecord { score: number; at: number; completed: boolean; hits: number; misses: number }
export interface KVLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function historyKey(userId: string | number | null | undefined): string {
  const s = String(userId ?? 'anon').replace(/[^A-Za-z0-9-]/g, '_');
  return HISTORY_PREFIX + (s || 'anon');
}

function valid(r: unknown): r is TriageRunRecord {
  const o = r as TriageRunRecord;
  return !!o && typeof o === 'object' && Number.isFinite(o.score) && Number.isFinite(o.at);
}

export function loadTriageHistory(store: KVLike, userId: string | number | null | undefined): TriageRunRecord[] {
  let arr: unknown;
  try { arr = JSON.parse(store.getItem(historyKey(userId)) ?? '[]'); } catch { arr = []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(valid).map((r) => ({ score: r.score, at: r.at, completed: !!r.completed, hits: r.hits | 0, misses: r.misses | 0 }))
    .sort((a, b) => b.at - a.at).slice(0, MAX_RUNS);
}

export function addTriageRun(store: KVLike, userId: string | number | null | undefined, run: TriageRunRecord): TriageRunRecord[] {
  const list = [run, ...loadTriageHistory(store, userId)].sort((a, b) => b.at - a.at).slice(0, MAX_RUNS);
  try { store.setItem(historyKey(userId), JSON.stringify(list)); } catch { /* almacén lleno: no se guarda */ }
  return list;
}

/** Mejor puntuación del historial (null si está vacío). */
export function bestScore(list: TriageRunRecord[]): number | null {
  return list.length ? Math.max(...list.map((r) => r.score)) : null;
}

/** Fecha corta «DD/MM/YY HH:MM» en hora local. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

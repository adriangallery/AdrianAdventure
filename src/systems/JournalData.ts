import { parseChapters, progressFrom, type JournalChapter, type JournalProgress, type JournalWorld } from './Journal';
import { ChapterManager } from './ChapterManager';
import type { GameState } from '@/types/game.types';
import { gateAddress } from '@/web3/gating';

/**
 * A2.9: datos del diario (`assets/journal/chapter-<n>.json`), metidos en el bundle por Vite al compilar (no hay que
 * precargarlos). Un capítulo nuevo (A3.x) es un fichero más; la lógica está en `Journal.ts` y la interfaz en
 * `src/ui/JournalPanel.ts`.
 */
const files = import.meta.glob('../../assets/journal/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const JOURNAL_CHAPTERS: readonly JournalChapter[] = parseChapters(
  Object.keys(files).sort().map((k) => files[k]),
  (msg) => console.warn(`[journal] ${msg}`),
);

/**
 * Lo que el diario necesita de la partida: flags, objetos del inventario y capítulo actual (ChapterManager).
 * A9.8: más la pseudo-flag 'wallet_connected' (cartera conectada, o la simulada de __qa.mockWeb3 con ?qa=1), que no se
 * guarda en la partida: la leen las notas «Badge available» del cierre de cada capítulo (biblia § 7), solo sin wallet.
 */
export function journalWorld(state: GameState | undefined): JournalWorld {
  return { flags: { ...(state?.flags ?? {}), wallet_connected: gateAddress() !== null }, items: (state?.inventory ?? []).map((i) => i.id) };
}

export function journalChapter(state: GameState | undefined): number {
  return ChapterManager.getCurrentChapter(state?.flags ?? {});
}

export function journalProgress(state: GameState | undefined): JournalProgress {
  return progressFrom(state?.journal);
}

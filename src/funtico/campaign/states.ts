/**
 * F3.2a (plan FUNTICO_ADVENTURE): estado inicial de cada expediente. El 1 empieza de cero (como «New Game»: la
 * apertura del capítulo corre); el 2, con el estado que deja la ruta crítica al cerrar el 1 (states.json, generado por
 * scripts/funtico/build-campaign-states.mjs y comprobado con `--check` en el e2e).
 */
import { createInitialState, type GameState } from '@/types/game.types';
import data from './states.json';

interface Canon {
  currentScene: string;
  spawn?: { x: number; y: number };
  [k: string]: unknown;
}

export interface ChapterStart {
  state: GameState;
  spawn: { x: number; y: number } | null;
}

export function chapterStart(chapter: number): ChapterStart {
  const entry = (data.chapters as Record<string, unknown>)[String(chapter)] as (Canon & { fresh?: boolean; scene?: string }) | undefined;
  if (!entry || entry.fresh) return { state: createInitialState(entry?.scene ?? 'outside'), spawn: null };
  const { spawn, ...canon } = structuredClone(entry) as Canon;
  const base = createInitialState(canon.currentScene);
  const state = { ...base, ...canon, runId: base.runId, saveVersion: base.saveVersion } as unknown as GameState;
  return { state, spawn: spawn ?? null };
}

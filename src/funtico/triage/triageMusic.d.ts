// F1.4 (plan FUNTICO_ADVENTURE): tipos de triageMusic.js (ESM puro, sin paso de build).

export type TriagePhase = 'off' | 'race' | 'relapse' | 'result';
export interface ThemeLevel { theme: string; level: number }
export interface MusicHistoryEntry { t: number; theme: string | null; level: number | null; name: string | null }

export const LEVELS: readonly string[];
export const CALMA: number;
export const ACTIVO: number;
export const TENSION: number;
export const TRIUNFO: number;
export const RACE_THEME: string;
export const RELAPSE_THEME: string;
export const RELAPSE_LEVEL: number;
export const TENSION_MS: number;
export const ACTIVE_STREAK: number;
export const TRIUMPH_MS: number;
export const GOOD_RATIO: number;

export function isGoodResult(r: { hits: number; stations: number }): boolean;
export function musicFor(s: { phase: TriagePhase; remainingMs?: number; streak?: number; hits?: number; good?: boolean; resultMs?: number }): ThemeLevel | null;
export function tracksToPrefetch(race: { levels: string[] }, relapse: { levels: string[] }, hasRelapse: boolean): string[];
export function levelName(level: number): string | null;
export function pushHistory(history: MusicHistoryEntry[], t: number, m: ThemeLevel | null, max?: number): boolean;

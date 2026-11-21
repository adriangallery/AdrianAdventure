// F1.1 (plan FUNTICO_ADVENTURE): tipos de triage.js (ESM puro, sin paso de build). Unidades de `bounds`, `crop` y de
// x/y de los toques: % del mundo de la escena (0–100 en x sobre el ancho, 0–100 en y sobre el alto), las mismas que
// `regions.hotspots[].bounds` de assets/scenes/<id>/scene.json.

export interface Box { x: number; y: number; w: number; h: number }
export type Bucket = 'easy' | 'medium' | 'hard';
export type StationKind = 'sample' | 'symptom' | 'relapse';

export interface VoiceRef { key: string; file: string }

export interface CatalogTarget {
  /** «<escena>:<id del hotspot>» */
  id: string;
  scene: string;
  hotspot: string;
  name: string;
  bounds: Box;
  /** Frases de Dex al mirar en el estado inicial, en orden. */
  look: string[];
  /** La que usa SYMPTOM (la primera que no dice el nombre; si todas lo dicen, la primera). */
  phrase: string;
  voice: VoiceRef | null;
  nameLeak: boolean;
  size: number;
  effective: number;
  similar: string[];
  bucket: Bucket;
}

export interface CatalogRelapseRound {
  id: string;
  fud: string;
  fudVoice: VoiceRef | null;
  options: Array<{ text: string; learn: string; voice: VoiceRef | null }>;
  correct: number;
}

export interface TriageCatalog {
  schema: number;
  units: 'percent-of-world';
  scenes: Record<string, { world: { width: number; height: number }; background: string }>;
  targets: CatalogTarget[];
  relapse: { scene: string; tree: string; rounds: CatalogRelapseRound[] };
  /** sha256 (hex) del JSON canónico del catálogo sin este campo. */
  hash: string;
}

export interface TriageRules {
  durationMs: number;
  hitBase: number;
  speedMax: number;
  missPenalty: number;
  streakPermille: readonly number[];
  leftoverPerSecond: number;
  windowMs: number;
  graceBaseMs: number;
  graceSymptomPerCharMs: number;
  graceRelapsePerCharMs: number;
  maxMissesSpot: number;
  maxMissesRelapse: number;
  minGapMs: number;
  minReactionMs: number;
  cropMinPx: number;
  cropMaxPx: number;
}

interface StationBase {
  i: number;
  kind: StationKind;
  /** Objetivo de la estación: id del catálogo, o «chad_fud:<nodo>» en RELAPSE. */
  obj: string;
  scene: string;
  maxMisses: number;
  /** Bonificación de rapidez completa hasta aquí (ms desde que abre la estación). */
  graceMs: number;
}

export interface SpotStation extends StationBase {
  kind: 'sample' | 'symptom';
  hotspot: string;
  name: string;
  bucket: Bucket;
  bounds: Box;
  /** SAMPLE: recorte cuadrado (en píxeles) del fondo que se enseña. */
  crop?: Box;
  /** SYMPTOM: frase LOOK y ruta de su mp3 (null si no tiene voz). */
  phrase?: string;
  voice?: string | null;
}

export interface RelapseStation extends StationBase {
  kind: 'relapse';
  fud: string;
  fudVoice: string | null;
  options: Array<{ text: string; voice: string | null }>;
  /** Índice de la réplica buena dentro de `options` (ya barajadas). */
  correct: number;
}

export type Station = SpotStation | RelapseStation;

export interface TriageRun {
  v: number;
  seed: string;
  /** catalogId(catalog) */
  catalog: string;
  durationMs: number;
  rules: TriageRules;
  scenes: Record<string, { world: { width: number; height: number }; background: string }>;
  stations: Station[];
}

/**
 * Evento del registro de toques. t = ms desde el inicio de la carrera (entero); est = índice de la estación abierta;
 * obj = su `obj`; x/y en % del mundo; en RELAPSE, x = índice de la opción elegida e y = 0.
 */
export interface TapEvent { t: number; est: number; obj: string; x: number; y: number }

export interface GenerateOptions {
  scenes?: string[];
  relapseRounds?: number;
  rules?: Partial<TriageRules>;
}

export interface StationScore {
  i: number;
  kind: StationKind;
  obj: string;
  hit: boolean;
  misses: number;
  closedAt: number | null;
  elapsedMs: number | null;
  speed: number;
  multiplier: number;
  points: number;
}

export interface ScoreResult {
  /** Puntuación final: entero ≥ 0. */
  score: number;
  /** Lo mismo antes del suelo de 0. */
  raw: number;
  hits: number;
  misses: number;
  /** Todas las estaciones cerradas antes de durationMs. */
  completed: boolean;
  endMs: number | null;
  leftoverSeconds: number;
  leftoverBonus: number;
  stations: StationScore[];
}

export type ValidateReason =
  | 'bad_run' | 'not_array' | 'too_many_events' | 'bad_event' | 'time_out_of_range' | 'time_not_increasing'
  | 'too_fast' | 'after_finish' | 'wrong_station' | 'wrong_objective' | 'reaction_too_fast' | 'bad_option'
  | 'out_of_scene';

export type ValidateResult = { ok: true; reason: null } | { ok: false; reason: ValidateReason; at: number | null };

export const RUN_VERSION: number;
export const DEFAULT_SCENES: readonly string[];
export const BUCKETS: readonly Bucket[];
export const RULES: Readonly<TriageRules>;

export function catalogId(catalog: Pick<TriageCatalog, 'schema' | 'hash'>): string;
export function inBounds(x: number, y: number, b: Box): boolean;
export function generateRun(seed: string, catalog: TriageCatalog, opts?: GenerateOptions): TriageRun;
export function speedPoints(elapsed: number, graceMs: number, rules?: TriageRules): number;
export function streakPermille(streak: number, rules?: TriageRules): number;
export function scoreRun(run: TriageRun, taps: readonly TapEvent[]): ScoreResult;
export function maxEvents(run: TriageRun): number;
export function validateTaps(run: TriageRun, taps: readonly TapEvent[]): ValidateResult;

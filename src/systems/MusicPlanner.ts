/**
 * A8.1 (plan SCUMM): música adaptativa a lo iMUSE. Lógica PURA, sin Phaser ni imports (tests/music-planner.test.mjs).
 *
 * - Re-secuenciado horizontal: cada pista tiene una rejilla medida (BPM, primer tiempo fuerte, compases, secciones; la mide
 *   scripts/audio/analyze-tempo.mjs y queda en assets/config/music-map.json). Un cambio de escena o de situación no corta:
 *   espera al siguiente punto de salida (inicio de sección > final de frase > línea de compás) sin pasar de `maxWaitBars`
 *   compases, y entra por un puente (stinger transportado a la tonalidad de DESTINO) si cambia la tonalidad.
 * - Capas verticales: el estado del juego (explorar, conversación, tensión, puzle resuelto, final de capítulo, peligro) elige
 *   qué capas sintetizadas suenan encima (en la tonalidad y el tempo medidos) y qué sección de la pista prefiere.
 * - Variación por lugar: cada escena puede arreglar el mismo motivo de otra forma (registro, timbre, densidad, eco).
 * - Estados del juego → música: tabla de reglas con prioridad (escena, diálogo abierto, flags, objeto en el inventario,
 *   objetivos que faltan del capítulo).
 * Quien suena es MusicManager (WebAudio, reloj de AudioContext.currentTime).
 */

export interface KeyLike {
  /** 0 = Do … 11 = Si */
  tonic: number;
  mode: 'major' | 'minor';
}

export interface MusicSection {
  id: string;
  startBar: number;
  bars: number;
  energyDb: number;
}

/** Rejilla medida de una pista (music-map.json → tracks) */
export interface TrackGrid {
  bpm: number;
  beatsPerBar: number;
  firstDownbeatSec: number;
  barSec: number;
  bars: number;
  durationSec: number;
  loopStartSec: number;
  loopEndSec: number;
  key: KeyLike;
  sections: MusicSection[];
}

export interface PlannerOptions {
  /** Un cambio nunca espera más de estos compases (si no hay salida musical antes, sale en la siguiente línea de compás) */
  maxWaitBars: number;
  /** Final de frase cada N compases (salida preferida si no hay inicio de sección cerca) */
  phraseBars: number;
  /** Margen mínimo (s) entre que se pide y la salida, para que WebAudio programe a tiempo */
  minLeadSec: number;
}

export const DEFAULT_PLANNER: PlannerOptions = { maxWaitBars: 4, phraseBars: 4, minLeadSec: 0.12 };

export type ExitKind = 'section' | 'phrase' | 'bar';

export interface ExitPoint {
  /** Compás de la salida (0 … bars-1, ya con la vuelta del bucle) */
  bar: number;
  /** Compases enteros desde el inicio de la pista hasta la salida, sin vuelta (para encadenar) */
  absBar: number;
  /** Segundos que faltan desde `posSec` */
  waitSec: number;
  kind: ExitKind;
  /** Sección que empieza (si kind = section) */
  section: string | null;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Posición dentro del buffer (s) para un tiempo transcurrido desde que arrancó en `startOffsetSec`, con el bucle */
export function trackPosition(grid: TrackGrid, startOffsetSec: number, elapsedSec: number): number {
  const p = startOffsetSec + elapsedSec;
  if (p < grid.loopEndSec) return p;
  const len = grid.loopEndSec - grid.loopStartSec;
  return grid.loopStartSec + mod(p - grid.loopStartSec, len);
}

/** Compás (con decimales) en una posición del buffer; negativo en la anacrusa antes del primer tiempo fuerte */
export function barAt(grid: TrackGrid, posSec: number): number {
  return (posSec - grid.firstDownbeatSec) / grid.barSec;
}

/** Posición (s) del buffer donde empieza un compás */
export function barStartSec(grid: TrackGrid, bar: number): number {
  return grid.firstDownbeatSec + mod(bar, grid.bars) * grid.barSec;
}

export function sectionAtBar(grid: TrackGrid, bar: number): MusicSection | null {
  const b = mod(Math.floor(bar), grid.bars);
  let cur: MusicSection | null = null;
  for (const s of grid.sections) if (s.startBar <= b) cur = s;
  return cur;
}

/**
 * Siguiente punto de salida desde `posSec`: el primer inicio de sección o, si no, el primer final de frase dentro de
 * `maxWaitBars` compases; si no hay ninguno, la siguiente línea de compás. Siempre cae en un compás entero.
 */
export function nextExit(grid: TrackGrid, posSec: number, opts: PlannerOptions = DEFAULT_PLANNER): ExitPoint {
  const lead = barAt(grid, posSec + opts.minLeadSec);
  const first = Math.max(0, Math.ceil(lead - 1e-9));
  const starts = new Map(grid.sections.map((s) => [s.startBar, s.id]));
  let phrase: number | null = null;
  for (let b = first; b <= first + Math.max(0, opts.maxWaitBars); b++) {
    if (b - lead > opts.maxWaitBars + 1e-9) break;
    const m = mod(b, grid.bars);
    if (starts.has(m)) return mk(b, 'section', starts.get(m) ?? null);
    if (phrase === null && m % opts.phraseBars === 0) phrase = b;
  }
  if (phrase !== null) return mk(phrase, 'phrase', null);
  return mk(first, 'bar', null);

  function mk(absBar: number, kind: ExitKind, section: string | null): ExitPoint {
    const at = grid.firstDownbeatSec + absBar * grid.barSec;
    return { bar: mod(absBar, grid.bars), absBar, waitSec: at - posSec, kind, section };
  }
}

/** Semitonos de Do a la tónica por el camino corto (igual que Stingers.transposeSemitones) */
export function transposeSemitones(tonic: number): number {
  const t = mod(Math.round(tonic), 12);
  return t <= 5 ? t : t - 12;
}

/** Mismas notas: misma tonalidad o relativas (Do mayor / La menor) */
export function sameKeySet(a: KeyLike, b: KeyLike): boolean {
  const rel = (k: KeyLike) => (k.mode === 'major' ? mod(k.tonic, 12) : mod(k.tonic + 3, 12));
  return rel(a) === rel(b);
}

export interface BridgePlan {
  /** 'none' = entra en el compás con un fundido de un tiempo; 'stinger' = puente transportado a la tonalidad de destino */
  type: 'none' | 'stinger';
  /** Clip de assets/audio/sfx (sintetizado en Do) */
  clip: string | null;
  /** Desafino en cents para llevarlo a la tónica de destino */
  detune: number;
  /** Tonalidad en la que suena el puente (la de destino) */
  key: KeyLike;
  reason: string;
}

/**
 * Puente entre dos pistas: si las notas son las mismas (misma tonalidad o relativa) no hace falta; si no, el stinger
 * neutro (tónica-quinta-octava, sin tercera) transportado a la tónica de destino, o la fanfarria en el modo de destino si
 * el cambio es de capítulo.
 */
export function chooseBridge(from: KeyLike | null, to: KeyLike, cause: 'scene' | 'state' | 'chapter' = 'scene'): BridgePlan {
  const detune = transposeSemitones(to.tonic) * 100;
  if (cause === 'chapter') return { type: 'stinger', clip: `stinger_chapter_${to.mode}`, detune, key: to, reason: 'capítulo' };
  if (!from) return { type: 'none', clip: null, detune: 0, key: to, reason: 'sin música antes' };
  if (sameKeySet(from, to)) return { type: 'none', clip: null, detune: 0, key: to, reason: 'mismas notas' };
  return { type: 'stinger', clip: 'stinger_item', detune, key: to, reason: 'cambio de tonalidad' };
}

// ─── Estados del juego → música ─────────────────────────────

export interface MusicContext {
  scene: string | null;
  dialogue: boolean;
  flags: Record<string, boolean>;
  inventory: string[];
  /** Objetivos que faltan en el capítulo actual (null = no se sabe) */
  goalsLeft: number | null;
  /** Estado puntual (p. ej. `solved` tras resolver un puzle) mientras dure */
  transient: string | null;
}

export interface StateRuleWhen {
  dialogue?: boolean;
  scene?: string | string[];
  flag?: string;
  notFlag?: string;
  item?: string;
  goalsLeftMax?: number;
  transient?: string;
}

export interface StateRule {
  state: string;
  priority: number;
  when: StateRuleWhen;
}

export interface StateMusic {
  /** Capas sintetizadas encima de la pista */
  layers: string[];
  /** Sección preferida: 'calm' (la de menos energía), 'intense' (la de más) o 'any' (no salta) */
  section: 'calm' | 'intense' | 'any';
  /** Ganancia de la pista base en este estado (las capas aparte) */
  gain: number;
}

export interface PlaceArrangement {
  /** Octava del motivo y del bajo respecto a la central (-1 sótano, +1 porche…) */
  octave: number;
  /** Timbre del motivo */
  wave: 'triangle' | 'sine' | 'square';
  /** Notas del motivo por compás (2, 4 u 8) */
  density: number;
  /** Eco (0-0.6) del motivo y el pad */
  echo: number;
  /** Corte del filtro de las capas (Hz) */
  cutoff: number;
}

export interface MusicMap {
  tracks: Record<string, TrackGrid>;
  planner?: Partial<PlannerOptions>;
  rules: StateRule[];
  states: Record<string, StateMusic>;
  places: Record<string, Partial<PlaceArrangement>>;
  defaultPlace: PlaceArrangement;
}

export const DEFAULT_STATE = 'explore';

export function ruleMatches(w: StateRuleWhen, ctx: MusicContext): boolean {
  if (w.dialogue !== undefined && w.dialogue !== ctx.dialogue) return false;
  if (w.scene !== undefined) {
    const list = Array.isArray(w.scene) ? w.scene : [w.scene];
    if (!ctx.scene || !list.includes(ctx.scene)) return false;
  }
  if (w.flag !== undefined && !ctx.flags[w.flag]) return false;
  if (w.notFlag !== undefined && ctx.flags[w.notFlag]) return false;
  if (w.item !== undefined && !ctx.inventory.includes(w.item)) return false;
  if (w.goalsLeftMax !== undefined && (ctx.goalsLeft === null || ctx.goalsLeft > w.goalsLeftMax)) return false;
  if (w.transient !== undefined && ctx.transient !== w.transient) return false;
  return true;
}

/** Estado musical: la regla que se cumple con más prioridad (empate: la primera de la tabla); si ninguna, `explore` */
export function resolveState(rules: readonly StateRule[], ctx: MusicContext): { state: string; rule: number } {
  let best = -1;
  for (let i = 0; i < rules.length; i++) {
    if (!ruleMatches(rules[i].when, ctx)) continue;
    if (best < 0 || rules[i].priority > rules[best].priority) best = i;
  }
  return best < 0 ? { state: DEFAULT_STATE, rule: -1 } : { state: rules[best].state, rule: best };
}

/** Sección que pide un estado en una pista (por la energía medida); null = no hace falta saltar */
export function sectionFor(grid: TrackGrid, pref: StateMusic['section']): MusicSection | null {
  if (pref === 'any' || grid.sections.length === 0) return null;
  const sorted = [...grid.sections].sort((a, b) => a.energyDb - b.energyDb || a.startBar - b.startBar);
  return pref === 'calm' ? sorted[0] : sorted[sorted.length - 1];
}

/** ¿Hay que saltar de sección? Solo si el estado pide otra y no estamos ya en una con la misma letra */
export function needsSectionJump(grid: TrackGrid, bar: number, pref: StateMusic['section']): MusicSection | null {
  const target = sectionFor(grid, pref);
  if (!target) return null;
  const cur = sectionAtBar(grid, bar);
  if (cur && cur.id.charAt(0) === target.id.charAt(0)) return null;
  return target;
}

export function placeFor(map: Pick<MusicMap, 'places' | 'defaultPlace'>, scene: string | null): PlaceArrangement {
  return { ...map.defaultPlace, ...(scene ? map.places[scene] ?? {} : {}) };
}

// ─── Capas sintetizadas: notas en la tonalidad y el tempo ───────

export interface LayerNote {
  layer: string;
  /** Tiempo (en pulsos desde el inicio del compás) */
  beat: number;
  /** Duración en pulsos */
  dur: number;
  /** Nota MIDI */
  midi: number;
  /** 0-1 */
  vel: number;
  /** 'noise' para la percusión */
  wave: 'triangle' | 'sine' | 'square' | 'noise';
}

/** Grados del acorde de tónica (tercera según el modo) */
function triad(key: KeyLike): number[] {
  return [0, key.mode === 'minor' ? 3 : 4, 7, 12];
}

/**
 * Notas de un compás de cada capa. Todas son del acorde de tónica (o la quinta), así que no chocan con la pista:
 *   pad: tónica + quinta tenidas; pulse: tónica grave en negras (corcheas en `danger`); tick: ruido en los contratiempos;
 *   motif: el motivo 1-3-5-8 arreglado por lugar (octava, timbre, densidad).
 */
export function layerNotes(layer: string, key: KeyLike, place: PlaceArrangement, beatsPerBar: number, barIndex: number, fast = false): LayerNote[] {
  const root = 48 + mod(key.tonic, 12) + (key.tonic > 6 ? -12 : 0); // tónica en la octava de Do3
  const t = triad(key);
  const out: LayerNote[] = [];
  switch (layer) {
    case 'pad':
      out.push({ layer, beat: 0, dur: beatsPerBar, midi: root + 12, vel: 0.5, wave: 'sine' });
      out.push({ layer, beat: 0, dur: beatsPerBar, midi: root + 19, vel: 0.35, wave: 'sine' });
      break;
    case 'pulse': {
      const step = fast ? 0.5 : 1;
      for (let b = 0; b < beatsPerBar; b += step) out.push({ layer, beat: b, dur: step * 0.6, midi: root - 12 + Math.min(0, place.octave) * 12, vel: b === 0 ? 0.9 : 0.6, wave: 'triangle' });
      break;
    }
    case 'tick':
      for (let b = 0; b < beatsPerBar; b++) out.push({ layer, beat: b + 0.5, dur: 0.12, midi: 0, vel: fast ? 0.7 : 0.45, wave: 'noise' });
      break;
    case 'motif': {
      const n = Math.max(1, Math.min(8, Math.round(place.density)));
      const step = beatsPerBar / n;
      // el motivo sube en los compases pares y baja en los impares (pregunta-respuesta)
      const seq = mod(barIndex, 2) === 0 ? [t[0], t[1], t[2], t[3]] : [t[3], t[2], t[1], t[2]];
      for (let i = 0; i < n; i++) out.push({ layer, beat: i * step, dur: step * 0.8, midi: root + 24 + place.octave * 12 + seq[i % 4], vel: i === 0 ? 0.8 : 0.6, wave: place.wave });
      break;
    }
    default:
      break;
  }
  return out;
}

/** Pitch class de una nota MIDI */
export const pitchClass = (midi: number) => mod(midi, 12);

/** ¿La nota pertenece a la escala de la tonalidad? (natural menor / mayor) */
export function inKey(midi: number, key: KeyLike): boolean {
  const scale = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return scale.includes(mod(midi - key.tonic, 12));
}

/** Ganancia de cada capa (mezcla de fondo: que se oiga sin tapar la pista) */
export const LAYER_GAIN: Record<string, number> = { pad: 0.05, pulse: 0.07, tick: 0.035, motif: 0.04 };

/** Fundido de una capa: un tiempo, empezando en la siguiente línea de pulso */
export function nextBeatSec(grid: TrackGrid, posSec: number): number {
  const beat = grid.barSec / grid.beatsPerBar;
  const k = Math.ceil((posSec - grid.firstDownbeatSec) / beat - 1e-9);
  return grid.firstDownbeatSec + k * beat - posSec;
}

// F1.1 (plan FUNTICO_ADVENTURE): lógica PURA de Triage — generador de carrera por semilla, puntuación desde el
// registro de toques y validación de plausibilidad. Sin Phaser, sin DOM, sin red, sin reloj ni azar propios: la
// semilla y los tiempos entran como datos. ESM puro con tipos en triage.d.ts, para que lo importen igual el cliente
// (Vite) y el save-server (F2.2, Node sin paso de build). Reglas y decisiones: docs/progreso/F1.1.md.

import { createRng } from './rng.js';

/** Versión del formato de carrera (sube si cambian reglas, generador o forma del objeto). */
export const RUN_VERSION = 1;
export const DEFAULT_SCENES = Object.freeze(['outside', 'lobby', 'rooftop']);
export const BUCKETS = Object.freeze(['easy', 'medium', 'hard']);

/** Reglas por defecto. Viajan dentro de cada carrera (`run.rules`) y la puntuación usa las de la carrera. */
export const RULES = Object.freeze({
  durationMs: 180000,
  hitBase: 1000,
  speedMax: 1000,
  missPenalty: 250,
  /** Multiplicador de racha en milésimas por aciertos consecutivos previos (×1,1 cada uno, tope ×2), entero exacto. */
  streakPermille: Object.freeze([1000, 1100, 1210, 1331, 1464, 1611, 1772, 1949, 2000]),
  leftoverPerSecond: 50,
  /** La bonificación de rapidez es completa hasta graceMs y baja en línea recta hasta 0 en graceMs + windowMs. */
  windowMs: 10000,
  graceBaseMs: 1500,
  graceSymptomPerCharMs: 50,
  graceRelapsePerCharMs: 20,
  /** Fallos que cierran una estación: SAMPLE/SYMPTOM admiten reintentos; RELAPSE es a una (como el duelo). */
  maxMissesSpot: 3,
  maxMissesRelapse: 1,
  /** Plausibilidad (validateTaps): separación mínima entre toques y reacción mínima desde que abre una estación. */
  minGapMs: 150,
  minReactionMs: 300,
  /** Recorte de SAMPLE: lado en píxeles del mundo. */
  cropMinPx: 128,
  cropMaxPx: 384,
});

const SPOT_KINDS = ['sample', 'symptom'];
const r2 = (n) => Math.round(n * 100) / 100;
const roundTo = (n, step) => Math.round(n / step) * step;

/** «<schema>:<12 primeros del hash>»: lo que registra el servidor con cada carrera. */
export function catalogId(catalog) {
  return `${catalog.schema}:${String(catalog.hash).slice(0, 12)}`;
}

/** (x, y) dentro de `bounds` (mismas unidades, bordes incluidos). */
export function inBounds(x, y, b) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Recorte cuadrado (en píxeles) de SAMPLE dentro del hotspot, en % del mundo. */
function makeCrop(rng, bounds, world, rules) {
  const W = world.width;
  const H = world.height;
  const b = { x: (bounds.x / 100) * W, y: (bounds.y / 100) * H, w: (bounds.w / 100) * W, h: (bounds.h / 100) * H };
  const side = Math.min(Math.max(Math.min(b.w, b.h), rules.cropMinPx), rules.cropMaxPx, W, H);
  const axis = (start, extent, limit) => {
    // si cabe dentro del hotspot, en cualquier punto de él; si no, conteniéndolo entero en ese eje
    const lo = side <= extent ? start : start + extent - side;
    const hi = side <= extent ? start + extent - side : start;
    const v = lo + rng.next() * (hi - lo);
    return Math.min(Math.max(v, 0), limit - side);
  };
  const cx = axis(b.x, b.w, W);
  const cy = axis(b.y, b.h, H);
  return { x: r2((cx / W) * 100), y: r2((cy / H) * 100), w: r2((side / W) * 100), h: r2((side / H) * 100) };
}

/**
 * Carrera determinista a partir de la semilla. 2 objetivos por escena con cubos distintos (cada cubo sale el mismo
 * número de veces en todas las carreras) y, en cada escena y en cada cubo, uno SAMPLE y uno SYMPTOM; orden de las
 * estaciones barajado; detrás, `relapseRounds` rondas de RELAPSE con rondas y respuestas barajadas.
 */
export function generateRun(seed, catalog, opts = {}) {
  if (typeof seed !== 'string' || !seed) throw new Error('triage: la semilla tiene que ser una cadena no vacía');
  if (!catalog || !Array.isArray(catalog.targets) || !catalog.relapse) throw new Error('triage: catálogo no válido');
  const rules = { ...RULES, ...(opts.rules ?? {}) };
  const scenes = opts.scenes ? [...opts.scenes] : [...DEFAULT_SCENES];
  const relapseCount = opts.relapseRounds ?? 3;
  const rng = createRng(`triage:v${RUN_VERSION}:${seed}`);

  // 1. escenas barajadas: la de la posición i lleva los cubos i y i+1 (módulo 3) → con 3 escenas, cada cubo 2 veces
  const order = rng.shuffle(scenes);
  const flip = rng.int(2);
  const picks = [];
  order.forEach((scene, i) => {
    if (!catalog.scenes?.[scene]) throw new Error(`triage: la escena ${scene} no está en el catálogo`);
    const pair = [BUCKETS[i % 3], BUCKETS[(i + 1) % 3]];
    pair.forEach((bucket, j) => {
      const pool = catalog.targets.filter((t) => t.scene === scene && t.bucket === bucket);
      if (!pool.length) throw new Error(`triage: no hay objetivos ${bucket} en ${scene}`);
      picks.push({ target: rng.pick(pool), kind: SPOT_KINDS[(j + flip) % 2] });
    });
  });

  // 2. estaciones SAMPLE/SYMPTOM en orden barajado
  const spots = rng.shuffle(picks).map(({ target, kind }) => {
    const st = {
      kind,
      obj: target.id,
      scene: target.scene,
      hotspot: target.hotspot,
      name: target.name,
      bucket: target.bucket,
      bounds: { ...target.bounds },
      maxMisses: rules.maxMissesSpot,
    };
    if (kind === 'sample') {
      st.crop = makeCrop(rng, target.bounds, catalog.scenes[target.scene].world, rules);
      st.graceMs = rules.graceBaseMs;
    } else {
      st.phrase = target.phrase;
      st.voice = target.voice ? target.voice.file : null;
      st.graceMs = roundTo(rules.graceBaseMs + rules.graceSymptomPerCharMs * target.phrase.length, 100);
    }
    return st;
  });

  // 3. RELAPSE: rondas del duelo barajadas y respuestas barajadas
  const rounds = rng.shuffle(catalog.relapse.rounds);
  if (rounds.length < relapseCount) throw new Error(`triage: el catálogo solo tiene ${rounds.length} rondas de RELAPSE`);
  const relapse = rounds.slice(0, relapseCount).map((round) => {
    const perm = rng.shuffle(round.options.map((_, k) => k));
    const options = perm.map((k) => ({ text: round.options[k].text, voice: round.options[k].voice ? round.options[k].voice.file : null }));
    const chars = round.fud.length + options.reduce((n, o) => n + o.text.length, 0);
    return {
      kind: 'relapse',
      obj: `${catalog.relapse.tree}:${round.id}`,
      scene: catalog.relapse.scene,
      fud: round.fud,
      fudVoice: round.fudVoice ? round.fudVoice.file : null,
      options,
      correct: perm.indexOf(round.correct),
      maxMisses: rules.maxMissesRelapse,
      graceMs: roundTo(rules.graceBaseMs + rules.graceRelapsePerCharMs * chars, 100),
    };
  });

  const usedScenes = {};
  for (const s of order) usedScenes[s] = catalog.scenes[s];
  return {
    v: RUN_VERSION,
    seed,
    catalog: catalogId(catalog),
    durationMs: rules.durationMs,
    rules,
    scenes: usedScenes,
    stations: [...spots, ...relapse].map((st, i) => ({ i, ...st })),
  };
}

/** Puntos de rapidez (entero 0–speedMax) para `elapsed` ms en una estación con `graceMs`. */
export function speedPoints(elapsed, graceMs, rules = RULES) {
  const over = Math.max(0, elapsed - graceMs);
  if (over >= rules.windowMs) return 0;
  return Math.floor((rules.speedMax * (rules.windowMs - over)) / rules.windowMs);
}

/** Multiplicador de racha (milésimas) con `streak` aciertos consecutivos previos. */
export function streakPermille(streak, rules = RULES) {
  const t = rules.streakPermille;
  return t[Math.min(streak, t.length - 1)];
}

const isTap = (e) => !!e && typeof e === 'object' && Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y);
const isHit = (st, e) => (st.kind === 'relapse' ? e.x === st.correct : inBounds(e.x, e.y, st.bounds));

/**
 * Puntuación (entero ≥ 0) recalculada SOLO desde el registro de toques: no lee ningún `ok` del cliente. Recorre los
 * toques en orden como la máquina de estaciones; ignora los mal formados, los de fuera de tiempo (> durationMs), los
 * que no son de la estación abierta y los de después de acabar. No valida plausibilidad: eso es validateTaps.
 */
export function scoreRun(run, taps) {
  const rules = run.rules ?? RULES;
  const stations = run.stations;
  const duration = run.durationMs ?? rules.durationMs;
  let cur = 0;
  let openedAt = 0;
  let misses = 0;
  let streak = 0;
  let total = 0;
  let hits = 0;
  let missCount = 0;
  let endMs = null;
  const perStation = stations.map((st) => ({ i: st.i, kind: st.kind, obj: st.obj, hit: false, misses: 0, closedAt: null, elapsedMs: null, speed: 0, multiplier: 0, points: 0 }));
  for (const e of Array.isArray(taps) ? taps : []) {
    if (cur >= stations.length) break;
    if (!isTap(e) || e.t < openedAt || e.t > duration || e.est !== cur) continue;
    const st = stations[cur];
    const ps = perStation[cur];
    let closed = false;
    if (isHit(st, e)) {
      const elapsed = e.t - openedAt;
      const speed = speedPoints(elapsed, st.graceMs, rules);
      const mult = streakPermille(streak, rules);
      const pts = Math.floor(((rules.hitBase + speed) * mult) / 1000);
      total += pts;
      streak++;
      hits++;
      Object.assign(ps, { hit: true, elapsedMs: elapsed, speed, multiplier: mult, points: ps.points + pts });
      closed = true;
    } else {
      total -= rules.missPenalty;
      streak = 0;
      misses++;
      missCount++;
      ps.misses = misses;
      ps.points -= rules.missPenalty;
      closed = misses >= st.maxMisses;
    }
    if (closed) {
      ps.closedAt = e.t;
      cur++;
      openedAt = e.t;
      misses = 0;
      if (cur === stations.length) endMs = e.t;
    }
  }
  const completed = endMs !== null;
  const leftoverSeconds = completed ? Math.floor((duration - endMs) / 1000) : 0;
  // sobrante ×50 por segundo, en proporción a las estaciones acertadas (fallarlo todo deprisa no da puntos)
  const leftoverBonus = completed ? Math.floor((leftoverSeconds * rules.leftoverPerSecond * hits) / stations.length) : 0;
  return {
    score: Math.max(0, total + leftoverBonus),
    raw: total + leftoverBonus,
    hits,
    misses: missCount,
    completed,
    endMs,
    leftoverSeconds,
    leftoverBonus,
    stations: perStation,
  };
}

/** Eventos máximos de una carrera legal: cada estación se cierra, como tarde, en su fallo número maxMisses. */
export function maxEvents(run) {
  return run.stations.reduce((n, st) => n + st.maxMisses, 0);
}

/**
 * Plausibilidad del registro (la usa el servidor en F2.2 antes de puntuar). Devuelve { ok: true, reason: null } o
 * { ok: false, reason, at } con `at` = índice del primer evento que falla.
 */
export function validateTaps(run, taps) {
  const fail = (reason, at = null) => ({ ok: false, reason, at });
  if (!run || run.v !== RUN_VERSION || !Array.isArray(run.stations)) return fail('bad_run');
  if (!Array.isArray(taps)) return fail('not_array');
  if (taps.length > maxEvents(run)) return fail('too_many_events');
  const rules = run.rules ?? RULES;
  const duration = run.durationMs ?? rules.durationMs;
  const stations = run.stations;
  let cur = 0;
  let openedAt = 0;
  let misses = 0;
  let prev = null;
  for (let k = 0; k < taps.length; k++) {
    const e = taps[k];
    if (!e || typeof e !== 'object' || !Number.isInteger(e.t) || !Number.isInteger(e.est) || typeof e.obj !== 'string'
      || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return fail('bad_event', k);
    if (e.t < 0 || e.t > duration) return fail('time_out_of_range', k);
    if (prev !== null && e.t <= prev) return fail('time_not_increasing', k);
    if (prev !== null && e.t - prev < rules.minGapMs) return fail('too_fast', k);
    if (cur >= stations.length) return fail('after_finish', k);
    if (e.est !== cur) return fail('wrong_station', k);
    const st = stations[cur];
    if (e.obj !== st.obj) return fail('wrong_objective', k);
    if (e.t - openedAt < rules.minReactionMs) return fail('reaction_too_fast', k);
    if (st.kind === 'relapse') {
      if (!Number.isInteger(e.x) || e.x < 0 || e.x >= st.options.length) return fail('bad_option', k);
    } else if (e.x < 0 || e.x > 100 || e.y < 0 || e.y > 100) {
      return fail('out_of_scene', k);
    }
    prev = e.t;
    if (isHit(st, e)) {
      cur++;
      openedAt = e.t;
      misses = 0;
    } else if (++misses >= st.maxMisses) {
      cur++;
      openedAt = e.t;
      misses = 0;
    }
  }
  return { ok: true, reason: null };
}

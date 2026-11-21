// F1.4 (plan FUNTICO_ADVENTURE): música de Triage con el iMUSE del juego. Lógica PURA (sin Phaser ni imports):
// estado de la carrera → { tema, nivel } de assets/config/music-map.json. Quien la usa (src/funtico/triage/TriageAudio.ts)
// se lo pasa a MusicManager, que hace el cambio en compás. Se prueba con node --test (tests/funtico-triage-music.test.mjs).

/** Niveles de un tema (mismo orden que LEVEL_NAMES de src/systems/MusicPlanner.ts). */
export const LEVELS = ['calma', 'activo', 'tension', 'triunfo'];
export const CALMA = 0;
export const ACTIVO = 1;
export const TENSION = 2;
export const TRIUNFO = 3;

/** Tema de la carrera: el de AdrianLAB (lobby/upstairs), uno de los temas con niveles del juego. */
export const RACE_THEME = 'adrianlab';
/** Tema de las rondas RELAPSE: el de la escena recovery_pool (la piscina de Chad), en nivel de duelo. */
export const RELAPSE_THEME = 'clinica';
/** Nivel del duelo con Chad (el estado `duel` del juego tiene intensidad 2). */
export const RELAPSE_LEVEL = TENSION;
/** Últimos ms de la carrera en tensión. */
export const TENSION_MS = 30000;
/** Racha que pone la carrera en «activo» (además del primer acierto). */
export const ACTIVE_STREAK = 2;
/** Cuánto suena el triunfo en el resultado antes de volver a la calma (el nivel 3 es un remate de ~16 s). */
export const TRIUMPH_MS = 16000;
/** Fracción de aciertos para que el resultado suene a triunfo. */
export const GOOD_RATIO = 0.6;

/**
 * ¿Buen resultado? Al menos GOOD_RATIO de las estaciones acertadas.
 * @param {{ hits: number, stations: number }} r
 */
export function isGoodResult(r) {
  return r.stations > 0 && r.hits / r.stations >= GOOD_RATIO;
}

/**
 * Tema y nivel que tocan ahora.
 * - `race`: calma al empezar; activo tras el primer acierto o con racha ≥ ACTIVE_STREAK; tensión en los últimos 30 s.
 * - `relapse`: tema de recovery_pool en tensión (el duelo con Chad).
 * - `result`: triunfo con buen resultado durante TRIUMPH_MS y luego calma; con mal resultado, calma.
 * - `off`: sin música (null).
 * @param {{ phase: 'off'|'race'|'relapse'|'result', remainingMs?: number, streak?: number, hits?: number,
 *   good?: boolean, resultMs?: number }} s
 * @returns {{ theme: string, level: number } | null}
 */
export function musicFor(s) {
  switch (s.phase) {
    case 'race': {
      const rem = s.remainingMs ?? Infinity;
      if (rem <= TENSION_MS) return { theme: RACE_THEME, level: TENSION };
      if ((s.hits ?? 0) >= 1 || (s.streak ?? 0) >= ACTIVE_STREAK) return { theme: RACE_THEME, level: ACTIVO };
      return { theme: RACE_THEME, level: CALMA };
    }
    case 'relapse':
      return { theme: RELAPSE_THEME, level: RELAPSE_LEVEL };
    case 'result':
      if (s.good && (s.resultMs ?? 0) < TRIUMPH_MS) return { theme: RACE_THEME, level: TRIUNFO };
      return { theme: RACE_THEME, level: CALMA };
    default:
      return null;
  }
}

/**
 * Pistas que Triage puede necesitar, en orden de uso (para descargarlas en segundo plano, nunca todas las del juego).
 * @param {{ levels: string[] }} race  tema de la carrera en music-map.json
 * @param {{ levels: string[] }} relapse  tema de RELAPSE
 * @param {boolean} hasRelapse
 * @returns {string[]}
 */
export function tracksToPrefetch(race, relapse, hasRelapse) {
  const out = [race.levels[CALMA], race.levels[ACTIVO]];
  if (hasRelapse) out.push(relapse.levels[RELAPSE_LEVEL]);
  out.push(race.levels[TENSION], race.levels[TRIUNFO]);
  return out.filter((t, i) => !!t && out.indexOf(t) === i);
}

/** Nombre legible de un nivel. */
export function levelName(level) {
  return LEVELS[level] ?? null;
}

/**
 * Añade una entrada al historial si cambia el tema o el nivel (null = sin música). Devuelve true si la añadió.
 * @param {Array<{ t: number, theme: string|null, level: number|null, name: string|null }>} history
 * @param {number} t
 * @param {{ theme: string, level: number } | null} m
 */
export function pushHistory(history, t, m, max = 50) {
  const last = history[history.length - 1];
  const theme = m?.theme ?? null;
  const level = m?.level ?? null;
  if (last && last.theme === theme && last.level === level) return false;
  history.push({ t: Math.round(t), theme, level, name: level === null ? null : levelName(level) });
  if (history.length > max) history.shift();
  return true;
}

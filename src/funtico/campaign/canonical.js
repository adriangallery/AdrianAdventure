// F3.2a (plan FUNTICO_ADVENTURE): estado inicial canónico de un capítulo a partir de la partida que deja la ruta
// crítica al cerrar el anterior. JS puro (sin imports): lo usan el navegador (states.ts), el generador
// (scripts/funtico/build-campaign-states.mjs) y los tests de Node.
//
// Se queda con lo que es MUNDO (escena, flags, inventario, visitas, triggers, diálogos, diario, logros, posición) y
// tira lo que es de ESTA partida: runId, savedAt, saveVersion, playTimeMs, chapterTimes, finishedAt. Así el reloj y
// las marcas de capítulo empiezan de cero en el capítulo nuevo (PlayStats no vuelve a avisar del cierre del anterior).

/** Claves de GameState que pasan al estado canónico, en este orden (el JSON sale estable). */
export const CANON_KEYS = [
  'currentScene', 'flags', 'inventory', 'visited', 'firedTriggers', 'dialogueProgress', 'dialogueUsed', 'journal',
  'achievements',
];

const sortObj = (o) => {
  if (Array.isArray(o)) return o.map(sortObj);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = sortObj(o[k]);
    return out;
  }
  return o;
};

// Posición redondeada al 1 % (el reloj del navegador mueve décimas entre una ejecución y otra)
const round2 = (n) => Math.round(Number(n));

/**
 * @param {Record<string, unknown>} state  GameState del juego
 * @param {{ x: number, y: number } | null} [pos]  posición del jugador en % de la escena (spawn)
 */
export function canonicalChapterState(state, pos = null) {
  if (!state || typeof state !== 'object') throw new Error('canonicalChapterState: no hay estado');
  const out = {};
  for (const k of CANON_KEYS) {
    if (state[k] === undefined) continue;
    let v = state[k];
    if (k === 'flags') v = Object.fromEntries(Object.entries(v ?? {}).filter(([, b]) => b === true));
    if (k === 'visited' || k === 'firedTriggers' || k === 'achievements') v = [...new Set(v)].sort();
    out[k] = sortObj(v);
  }
  const p = pos ?? (state.playerPosition ? { x: state.playerPosition.pctX, y: state.playerPosition.pctY } : null);
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.spawn = { x: round2(p.x), y: round2(p.y) };
  return out;
}

/** El JSON versionado (`src/funtico/campaign/states.json`). */
export function statesFile(chapter2State) {
  return {
    version: 1,
    note: 'Generado por scripts/funtico/build-campaign-states.mjs (ruta-critica de qa/walkthrough.json hasta chapter:1). No editar a mano.',
    chapters: {
      1: { fresh: true, scene: 'outside' },
      2: chapter2State,
    },
  };
}

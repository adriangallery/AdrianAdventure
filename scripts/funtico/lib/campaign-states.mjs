// F3.2a: comparar/escribir src/funtico/campaign/states.json (lo usan build-campaign-states.mjs y campaign-e2e.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalChapterState, statesFile } from '../../../src/funtico/campaign/canonical.js';

export const STATES_PATH = 'src/funtico/campaign/states.json';

export function statesFromSnapshot(snap) {
  if (!snap?.state) throw new Error('no hay gameState al cerrar el capítulo 1');
  return statesFile(canonicalChapterState(snap.state, snap.pos));
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';

/** null si cuadra; si no, un texto con la primera diferencia. */
export function diffStates(generated) {
  let current = '';
  try { current = readFileSync(STATES_PATH, 'utf-8'); } catch { return `${STATES_PATH} no existe`; }
  const want = serialize(generated);
  if (current === want) return null;
  const a = current.split('\n');
  const b = want.split('\n');
  const i = a.findIndex((l, k) => l !== b[k]);
  return `${STATES_PATH} desfasado (línea ${i + 1}: versionado «${(a[i] ?? '').trim()}», generado «${(b[i] ?? '').trim()}»)`;
}

export function writeStates(generated) {
  writeFileSync(STATES_PATH, serialize(generated));
}

// A3.11 (plan SCUMM): LO QUE YA COGISTE DESAPARECE DE LA ESCENA. Visibilidad de un hotspot según el estado de la
// partida (flags e inventario). Sin dependencias de Phaser: lo usan GameScene, el linter de escenas y los tests.
//
//   hideWhenFlag: "found_x"            oculto con esa flag puesta (lo normal para lo que se coge: la flag «ya cogido»
//                                      no se borra, así que sigue oculto aunque el objeto se gaste y salga del inventario)
//   showWhenFlag: "y"                  solo visible con esa flag
//   hideWhen: "cond" | ["c1", "c2"]    oculto si se cumplen TODAS; gramática `when` de A2.6a/A4.3: `flag`, `flag:x`,
//                                      `item:x` y su negación `!…` (p. ej. la lata de upstairs: oculta mientras la
//                                      llevas, vuelve si la gastas porque hay otra detrás del monitor)
//
// Al cargar partida o volver a la escena no hay nada que restaurar: se evalúa cada vez contra el estado actual.

export interface HotspotVisibilityRule {
  hideWhenFlag?: string;
  showWhenFlag?: string;
  hideWhen?: string | string[];
}

export const HOTSPOT_CONDITION_RE = /^(!?)(?:(flag|item):)?([A-Za-z0-9_.-]+)$/;

/** Lista de condiciones de `hideWhen` (vacía si no hay) */
export function conditionList(when: string | string[] | undefined): string[] {
  if (when === undefined || when === null) return [];
  return Array.isArray(when) ? when : [when];
}

/** true si la condición se cumple; null si está mal escrita */
export function conditionHolds(cond: string, getFlag: (f: string) => boolean, hasItem: (i: string) => boolean): boolean | null {
  const m = typeof cond === 'string' ? HOTSPOT_CONDITION_RE.exec(cond.trim()) : null;
  if (!m) return null;
  const v = m[2] === 'item' ? hasItem(m[3]) : getFlag(m[3]);
  return m[1] === '!' ? !v : v;
}

export function hotspotVisible(hs: HotspotVisibilityRule, getFlag: (f: string) => boolean, hasItem: (i: string) => boolean): boolean {
  if (hs.hideWhenFlag && getFlag(hs.hideWhenFlag)) return false;
  if (hs.showWhenFlag && !getFlag(hs.showWhenFlag)) return false;
  const conds = conditionList(hs.hideWhen);
  if (conds.length && conds.every((c) => conditionHolds(c, getFlag, hasItem) === true)) return false;
  return true;
}

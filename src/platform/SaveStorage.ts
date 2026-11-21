/**
 * F3.2a: almacén de las partidas guardadas. Gancho neutro (sin imports, sin nombrar plataformas): por defecto es
 * `localStorage`, exactamente como antes, y `SaveLoadSystem` lo pide en cada lectura o escritura. Un build de
 * plataforma puede cambiarlo (p. ej. por uno que guarde con otras claves) ANTES de arrancar el juego.
 */
export interface SaveStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let override: SaveStore | null = null;

/** Cambia el almacén de partidas; `null` vuelve a `localStorage`. */
export function setSaveStorage(store: SaveStore | null): void {
  override = store;
}

/** El almacén de partidas en uso (por defecto `localStorage`). */
export function saveStorage(): SaveStore {
  return override ?? localStorage;
}

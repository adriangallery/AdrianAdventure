/**
 * Ganchos de plataforma (F3.1): el juego avisa de lo que pasa en la partida (acción del jugador, pista, fallo, fin de
 * capítulo…) a quien quiera escucharlo. Por defecto NADIE escucha: el objeto por defecto no hace nada, así que el juego
 * se comporta exactamente igual que sin ganchos (ni tiempos, ni orden, ni guardados cambian).
 *
 * Una plataforma (otro build) instala los suyos con `setPlatformHooks()` antes de arrancar el juego. Las llamadas
 * pasan SIEMPRE por `emitPlatform()`, que se traga cualquier excepción del gancho: un gancho roto no rompe el juego.
 *
 * Lógica pura, sin imports: se prueba en Node con `--experimental-strip-types`.
 */

/** Verbo (LOOK, USE, PICK, TALK, GIVE…) ejecutado sobre un objetivo de la escena (hotspot o NPC). */
export interface PlatformAction {
  verb: string;
  target: string;
}

/** Llamada a Anon desde el diario o desde el op `callAnon`. `level` 0 = no había puzle abierto (frase de relleno). */
export interface PlatformHint {
  level: number;
  puzzle: string | null;
  chapter: number;
}

/**
 * Fallo: `kind` es el tipo de respuesta de fallo de `FailResponses` (`verb`, `item-hotspot`, `item-npc`, `item-item`,
 * `item-verb`…) o `duel` (duelo perdido: nodo `lose` de un árbol de diálogo). `verb` va si el fallo lo trae.
 */
export interface PlatformFail {
  kind: string;
  verb?: string | null;
  target?: string | null;
}

export interface PlatformHooks {
  /** Acción del jugador resuelta (al llegar y actuar; un toque cancelado por otro no cuenta). */
  onAction(action: PlatformAction): void;
  /** Pista pedida a Anon y ya dada, con su nivel (1 dirección · 2 objeto · 3 solución; 0 sin puzle abierto). */
  onHint(level: number, info: PlatformHint): void;
  /** Respuesta de fallo / «no puedo», o derrota en duelo (`kind: 'duel'`). */
  onFail(fail: PlatformFail): void;
  /** Se acaba de cerrar el capítulo `chapter` (primera vez que se ve `chapter_N_complete` en una partida medida). */
  onChapterComplete(chapter: number): void;
  /** Objetivo opcional conseguido (logro de categoría `explorer` o `secret`, la primera vez). */
  onOptional(id: string): void;
  /** Tiempo de JUEGO sumado en este fotograma (ms, el mismo que `playTimeMs`: con tope y sin pestaña oculta). */
  onPlayTime(ms: number): void;
}

export type PlatformHookName = keyof PlatformHooks;

const noop = (): void => {};

/** Implementación por defecto: no hace nada. */
export const NOOP_PLATFORM_HOOKS: Readonly<PlatformHooks> = Object.freeze({
  onAction: noop,
  onHint: noop,
  onFail: noop,
  onChapterComplete: noop,
  onOptional: noop,
  onPlayTime: noop,
});

let current: PlatformHooks = NOOP_PLATFORM_HOOKS;

/** Instala los ganchos de la plataforma (los que falten siguen sin hacer nada). null = vuelve al no-op. */
export function setPlatformHooks(hooks: Partial<PlatformHooks> | null | undefined): void {
  if (!hooks) { current = NOOP_PLATFORM_HOOKS; return; }
  // Métodos atados a su objeto (vale una instancia de clase: sus métodos están en el prototipo, no se pueden esparcir)
  const bound = { ...NOOP_PLATFORM_HOOKS } as Record<PlatformHookName, (...a: never[]) => void>;
  for (const name of Object.keys(NOOP_PLATFORM_HOOKS) as PlatformHookName[]) {
    const fn = (hooks as Record<string, unknown>)[name];
    if (typeof fn === 'function') bound[name] = fn.bind(hooks);
  }
  current = bound as unknown as PlatformHooks;
}

export function getPlatformHooks(): PlatformHooks {
  return current;
}

/** Avisa a la plataforma. Nunca lanza: si el gancho falla, se avisa por consola y el juego sigue. */
export function emitPlatform<K extends PlatformHookName>(name: K, ...args: Parameters<PlatformHooks[K]>): void {
  const hooks = current;
  if (hooks === NOOP_PLATFORM_HOOKS) return;
  try {
    (hooks[name] as (...a: Parameters<PlatformHooks[K]>) => void)(...args);
  } catch (err) {
    try { console.warn(`[platform] el gancho ${name} ha fallado`, err); } catch { /* sin consola */ }
  }
}

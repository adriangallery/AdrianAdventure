/**
 * A1.5 (plan SCUMM): «¿se descarga audio?». Con el sonido apagado (silencio elegido en el aviso del menú o
 * `adrian_adventure_muted` guardado) no se piden la música ni las voces: ni en la precarga de PreloadScene, ni
 * en MusicManager al cambiar de escena, ni en VoiceSystem al hablar. Al activar el sonido (botón «Enable Sound»
 * o ajustes del menú del disquete) MusicManager pide la música de la escena actual y las voces vuelven a
 * pedirse bajo demanda, sin recargar.
 *
 * Funciones puras y sin imports para probarlas con `node --test` (tests/audio-policy.test.mjs).
 */

/** Clave de localStorage del silencio (la escribe MusicManager.toggleMute). */
export const MUTED_STORAGE_KEY = 'adrian_adventure_muted';

/**
 * Silencio a partir del valor guardado. Sin valor (primera visita) = silencio: el jugador tiene que pulsar
 * «Enable Sound», que es el gesto que desbloquea el AudioContext en móvil.
 */
export function mutedFromStored(stored: string | null): boolean {
  return stored === null ? true : stored === 'true';
}

/** Música y voces solo se descargan con el sonido activado. */
export function shouldFetchAudio(muted: boolean): boolean {
  return !muted;
}

/** Pistas que PreloadScene tiene que encolar: ninguna en silencio, y nunca las que ya están en caché. */
export function musicToPreload(tracks: readonly string[], muted: boolean, isCached: (key: string) => boolean): string[] {
  if (!shouldFetchAudio(muted)) return [];
  return tracks.filter((t) => !isCached(t));
}

/**
 * A4.9 (iPhone): tras activar el sonido, un toque, la vuelta a la pestaña o un cambio de estado del AudioContext a
 * «suspended»/«interrupted» (bloqueo de pantalla, llamada, cambio de app, Chrome de iOS) lo reanudan. Solo si el
 * jugador activó el sonido en esta carga y no lo ha silenciado.
 */
export function shouldResumeOnGesture(state: string, unlockedThisSession: boolean, muted: boolean): boolean {
  return unlockedThisSession && !muted && state !== 'running' && state !== 'closed';
}

/**
 * A4.9: ¿mostrar el aviso tocable «Tap to enable sound»? Cuando, pasado un rato desde el gesto, el contexto sigue sin
 * correr aunque el jugador pidió sonido (iOS no aceptó el desbloqueo, o lo interrumpió y no volvió solo).
 */
export function shouldShowSoundNotice(state: string, unlockedThisSession: boolean, muted: boolean): boolean {
  return shouldResumeOnGesture(state, unlockedThisSession, muted);
}

/**
 * A4.9: Phaser deja `sound.locked` a true hasta que SU propio desbloqueo (escuchadores en <body>) termina; si ese
 * intento falla (en iOS un `resume()` lanzado en touchstart se rechaza y Phaser quita sus escuchadores sin volver a
 * probar), la música esperaba el evento UNLOCKED para siempre. Manda el estado real del contexto: si corre, no está
 * bloqueado.
 */
export function phaserStillLocked(phaserLocked: boolean, contextState: string): boolean {
  return phaserLocked && contextState !== 'running';
}

/** Frases de la pantalla de carga: en silencio se quitan las que hablan de voces (no se carga ninguna). */
export function loadingTipsFor(tips: readonly string[], muted: boolean): string[] {
  return muted ? tips.filter((t) => !/\bvoice/i.test(t)) : [...tips];
}

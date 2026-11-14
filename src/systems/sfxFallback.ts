/**
 * A8.4 (plan SCUMM): respaldo de efectos. Los mp3 de ElevenLabs sustituyen a los sintetizados en la misma ruta; si
 * uno no llegó a cargar (fallo de red, despliegue a medias), `SfxPlayer` prueba estas claves en orden y toca la
 * primera que esté en caché. Lógica pura (tests/footsteps.test.mjs).
 */
export function sfxFallbacks(key: string): string[] {
  const m = /^step_([a-z]+)_(old_)?(\d+)$/.exec(key);
  if (m) {
    const [, surface, old, nStr] = m;
    const n = Number(nStr);
    const foot = ((n - 1) % 2) + 1; // 1 = izquierdo, 2 = derecho
    // nueva _3/_4 → _1/_2 del mismo pie → sintetizado (_old) del mismo pie; un _old que falte → el nuevo
    if (old) return [`step_${surface}_${foot}`];
    return [...(n > 2 ? [`step_${surface}_${foot}`] : []), `step_${surface}_old_${foot}`];
  }
  const extra: Record<string, string[]> = {
    drawer_open: ['item_use'],
    drawer_close: ['thud'],
    magpie_chatter: [],
  };
  return extra[key] ?? [];
}

/** Volumen de un efecto con el mismo ducking que la música (bajo la voz o en cinemática: × duckLevel) */
export function duckedVolume(volume: number, duckSources: readonly string[], duckLevel: number): number {
  return duckSources.length > 0 ? Math.round(volume * duckLevel * 1000) / 1000 : volume;
}

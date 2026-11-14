import { telemetryAllowed, type ChapterSample } from '@/systems/ChapterTiming';

/**
 * A9.14: manda al save-server la duración de un capítulo, sin nada más (ni cartera, ni id de partida, ni escena).
 * Dispara y olvida: un fallo de red no molesta al jugador ni se reintenta.
 */
const TELEMETRY_URL = 'https://save.zerothetoken.com/telemetry/chapter';

let allowed: boolean | null = null;

function isAllowed(): boolean {
  if (allowed === null) {
    try {
      allowed = telemetryAllowed({
        search: window.location.search,
        hostname: window.location.hostname,
        isDev: !!import.meta.env.DEV,
        webdriver: !!navigator.webdriver,
      });
    } catch {
      allowed = false;
    }
  }
  return allowed;
}

export function sendChapterSamples(samples: ChapterSample[]): void {
  if (samples.length === 0 || !isAllowed()) return;
  for (const s of samples) {
    try {
      void fetch(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter: s.chapter, seconds: s.seconds }),
        keepalive: true,
        credentials: 'omit',
        cache: 'no-store',
      }).catch(() => {});
    } catch { /* sin red o sin fetch: no pasa nada */ }
  }
}

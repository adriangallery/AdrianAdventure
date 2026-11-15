import { telemetryAllowed, noteChapterMarks, CHAPTER_COUNT, type ChapterSample } from '@/systems/ChapterTiming';

/**
 * A9.17 (plan SCUMM): estadísticas ANÓNIMAS de juego. Amplía la telemetría de A9.14 con el mismo filtro (nada desde
 * QA/CI, `?qa=1`, navegador automatizado, desarrollo o localhost) y un interruptor en los ajustes (apagado = no se
 * manda nada, tampoco la duración de A9.14).
 *
 * Qué se manda (POST https://save.zerothetoken.com/stats/event, texto JSON): tipo de evento, un id de partida
 * ALEATORIO guardado en localStorage (sin cookies ni huellas; el servidor lo guarda hasheado), capítulo/segundos/escena
 * si aplica, móvil o escritorio, familia genérica del navegador y si hay cartera conectada (booleano, NUNCA la
 * dirección). El servidor no guarda la IP.
 */
const STATS_URL = 'https://save.zerothetoken.com/stats/event';
export const STORE_PLAY_STATS = 'adrian_adventure_play_stats';
const STORE_SID = 'adrian_adventure_stats_sid';

export type PlayEvent = 'session_start' | 'new_game' | 'continue' | 'chapter_start' | 'chapter_complete' | 'game_complete' | 'quit_scene';
export type BrowserFamily = 'chrome' | 'safari' | 'firefox' | 'edge' | 'other';

/** Familia genérica del navegador a partir del user agent (el UA no se manda). */
export function browserFamily(ua: string): BrowserFamily {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function isMobileUa(ua: string): boolean {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

function read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

/** Interruptor de los ajustes (por defecto encendido; «off» = no se manda nada). */
export function playStatsEnabled(): boolean { return read(STORE_PLAY_STATS) !== 'off'; }
export function setPlayStatsEnabled(on: boolean): void { write(STORE_PLAY_STATS, on ? 'on' : 'off'); }

let allowed: boolean | null = null;
function envAllowed(): boolean {
  if (allowed === null) {
    try {
      allowed = telemetryAllowed({
        search: window.location.search, hostname: window.location.hostname,
        isDev: !!import.meta.env.DEV, webdriver: !!navigator.webdriver,
      });
    } catch { allowed = false; }
  }
  return allowed;
}
/** ¿Se puede mandar algo ahora? (entorno de verdad + interruptor encendido) */
export function statsActive(): boolean { return envAllowed() && playStatsEnabled(); }

function sessionId(): string {
  let sid = read(STORE_SID);
  if (!sid || !/^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    sid = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    write(STORE_SID, sid);
  }
  return sid;
}

let walletProbe: () => boolean = () => false;
/** El juego dice cómo saber si hay cartera conectada (sin importar web3 aquí). */
export function setWalletProbe(fn: () => boolean): void { walletProbe = fn; }

export function trackEvent(t: PlayEvent, extra: { ch?: number; s?: number; scene?: string } = {}, beacon = false): void {
  if (!statsActive()) return;
  try {
    const ua = navigator.userAgent;
    let w = false;
    try { w = walletProbe(); } catch { w = false; }
    const body = JSON.stringify({ t, sid: sessionId(), m: isMobileUa(ua), br: browserFamily(ua), w, ...extra });
    // text/plain: petición «simple», sin preflight CORS (y vale para sendBeacon)
    if (beacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(STATS_URL, new Blob([body], { type: 'text/plain' }));
      return;
    }
    void fetch(STATS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true, credentials: 'omit', cache: 'no-store',
    }).catch(() => {});
  } catch { /* sin red: no pasa nada */ }
}

let sessionSent = false;
let lastScene: string | null = null;
let quitHooked = false;

/** Una vez por carga de página (menú). Engancha el aviso de abandono (última escena al ocultar/cerrar). */
export function trackSessionStart(): void {
  if (sessionSent) return;
  sessionSent = true;
  trackEvent('session_start');
  if (quitHooked || typeof window === 'undefined') return;
  quitHooked = true;
  const quit = () => { if (lastScene) trackEvent('quit_scene', { scene: lastScene }, true); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') quit(); });
  window.addEventListener('pagehide', quit);
}

export function trackScene(sceneId: string): void {
  if (/^[a-z0-9_]{1,40}$/.test(sceneId)) lastScene = sceneId;
}

export function trackNewGame(): void { trackEvent('new_game'); trackEvent('chapter_start', { ch: 1 }); }
export function trackContinue(): void { trackEvent('continue'); }

interface TrackedState {
  flags?: Record<string, boolean> | null;
  playTimeMs?: number;
  chapterTimes?: { start: number; marks: Record<string, number> };
}

let completeSeen: boolean | null = null;

/**
 * Sustituye a `noteChapterMarks` en el bucle de GameScene: devuelve lo mismo (las muestras de A9.14) y, si se acaba de
 * cerrar un capítulo, manda `chapter_complete` (con segundos si se midió entero) y `chapter_start` del siguiente; la
 * primera vez que se ve `game_complete` en esta carga (y no estaba ya al cargar), `game_complete`.
 */
export function noteChapters(state: TrackedState): ChapterSample[] {
  const had = !!state.chapterTimes;
  const before = had ? Object.keys(state.chapterTimes!.marks) : [];
  const samples = noteChapterMarks(state);
  const flags = state.flags ?? {};
  if (had && Object.keys(state.chapterTimes!.marks).length !== before.length) {
    for (let n = 1; n <= CHAPTER_COUNT; n++) {
      if (before.includes(String(n)) || state.chapterTimes!.marks[n] === undefined) continue;
      const s = samples.find((x) => x.chapter === n)?.seconds;
      trackEvent('chapter_complete', s !== undefined ? { ch: n, s } : { ch: n });
      if (n < CHAPTER_COUNT) trackEvent('chapter_start', { ch: n + 1 });
    }
  }
  const done = !!flags.game_complete;
  if (completeSeen === null) completeSeen = done;
  else if (done && !completeSeen) { completeSeen = true; trackEvent('game_complete'); }
  return samples;
}

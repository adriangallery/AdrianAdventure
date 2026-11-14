// A9.3 (plan SCUMM): la franja de logro no tapa frases ni botones. Lógica pura (sin Phaser), la usan
// src/ui/CinematicOverlay.ts y src/scenes/UIScene.ts y la prueba tests/achievement-layout.test.mjs.
//
// Antes la franja bajaba desde arriba en cuanto se ganaba el logro: tapaba Save, trofeos y móvil, y cortaba la primera
// línea de lo que estuviera diciendo Dex (rooftop, final del cap. 2). Ahora:
//   - espera en cola a que no haya frase, diálogo, elección, cinemática ni cambio de escena (como mucho MAX_WAIT_MS);
//   - sale ABAJO de la escena, justo encima del panel de verbos: entre la franja de botones de arriba y el panel, donde
//     no hay ningún botón; y como espera a que no haya texto, tampoco pisa frases;
//   - los logros que llegan juntos salen uno detrás de otro.

/** Alto de la franja de botones de arriba (= TOP_UI_INSET de speechLayout: Save, ayuda, móvil y cartera). */
export const ACH_TOP_INSET = 32;
/** Separación con el panel de verbos y con la franja de arriba. */
export const ACH_GAP = 6;
/** Como mucho se espera esto a que la pantalla quede libre; luego sale igual (en su sitio, sin tapar botones). */
export const MAX_WAIT_MS = 20000;
/** Cada cuánto se mira si ya está libre. */
export const POLL_MS = 200;

export interface Rect { x: number; y: number; w: number; h: number }

/** Qué tiene la pantalla ahora mismo. */
export interface ScreenBusy {
  speech?: boolean;
  dialogue?: boolean;
  choices?: boolean;
  cinematic?: boolean;
  transition?: boolean;
}

export function isScreenBusy(b: ScreenBusy): boolean {
  return !!(b.speech || b.dialogue || b.choices || b.cinematic || b.transition);
}

/** ¿Sale ya el logro de la cabeza de la cola? 'wait' mientras la pantalla esté ocupada y no se haya agotado la espera. */
export function achievementDecision(busy: ScreenBusy, waitedMs: number, maxWaitMs = MAX_WAIT_MS): 'show' | 'wait' {
  if (!isScreenBusy(busy)) return 'show';
  return waitedMs >= maxWaitMs ? 'show' : 'wait';
}

/**
 * Caja de la franja: todo el ancho, `stripH` de alto, apoyada sobre el panel de verbos (`panelH`). Si la escena es tan
 * baja que no cabe entre la franja de arriba y el panel, se pega bajo la franja de arriba (sin subir nunca encima).
 */
export function achievementRect(width: number, height: number, panelH: number, stripH: number): Rect {
  const bottom = height - panelH - ACH_GAP;
  const y = Math.max(ACH_TOP_INSET + ACH_GAP, bottom - stripH);
  return { x: 0, y, w: width, h: stripH };
}

/** Alto de la franja según el tamaño de letra (dos líneas: «ACHIEVEMENT UNLOCKED» y el nombre). */
export function achievementStripHeight(fontSize: number): number {
  return Math.max(50, Math.floor(fontSize * 5));
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Título de escena (A9.3): centrado en la PANTALLA (no en el fondo, que en vertical es más ancho que la pantalla y lo
 * cortaba) y bajo la franja de botones de arriba; envuelto si no cabe a lo ancho.
 */
export function sceneTitlePlacement(width: number, wantedY: number): { x: number; y: number; wrapW: number } {
  const margin = 12;
  return { x: width / 2, y: Math.max(ACH_TOP_INSET + ACH_GAP, wantedY), wrapW: Math.max(40, width - margin * 2) };
}

// A2.4 (plan SCUMM): controles de escritorio (ratón y teclado). Lógica pura, sin Phaser ni imports con valor (se
// prueba en Node: tests/desktop-controls.test.mjs). En táctil no cambia nada: el clic derecho, el doble clic y el
// teclado solo existen con ratón y teclado; las letras del panel solo se pintan con puntero fino (ScummUI).
//
// Teclas (sin Ctrl/Cmd/Alt, para no pisar los atajos del navegador; se ignoran mientras se escribe en un campo):
//   O Open · P Pick up · S Push · C Close · L Look at · Y Pull · G Give · T Talk to · U Use   (tabla de Monkey Island)
//   pulsar la tecla del verbo ya elegido lo suelta (vuelve a Walk), como al pulsarlo en el panel
//   Tab (mantener) resalta los hotspots y NPC que se pueden pulsar; se quita al soltar
//   I   plegar/desplegar el panel de verbos e inventario (solo cambia algo con el panel plegable, en pantallas pequeñas)
//   J   abrir/cerrar el diario (A2.9: el móvil de Dex); con el diario abierto, Esc también lo cierra y el resto de teclas
//       no llega al juego
//   Esc salta la cinemática o el texto en curso (el mismo avance rápido que mantener pulsado); si no hay ninguno,
//       suelta el objeto y el verbo elegidos y quita el resaltado
//
// Verbo por defecto (clic derecho; ver `defaultVerbFor`): el primer verbo de PRIMARY_VERB_ORDER cuyo script hace algo
// más que hablar (coger, abrir, cambiar de escena, poner una flag…). Así una salida da OPEN/USE/PUSH (lo que la abre),
// un objeto que se coge da PICK y una NPC (que no es hotspot) da TALK. Si ningún verbo hace nada de verdad, LOOK.
// Es la misma regla que la acción principal de mantener pulsado en táctil (V6, `mainVerbFor`), salvo el último
// recurso: en táctil USE (mirar ya es el toque corto), con el ratón LOOK.

/** Lo mínimo de un hotspot que hace falta aquí (HotspotData lo cumple). */
export interface HotspotScripts {
  scripts?: Record<string, unknown[] | undefined>;
}

/** Verbos que cuentan como acción principal, por orden de preferencia (valores de `Verb`). */
export const PRIMARY_VERB_ORDER = ['PICK', 'OPEN', 'USE', 'TALK', 'PUSH', 'PULL', 'CLOSE', 'GIVE'] as const;

/** Ops que solo hablan o esperan: no cambian nada del juego (igual que HotspotVerbs.ts). */
export const FLAVOR_OPS: ReadonlySet<string> = new Set(['say', 'sayBrief', 'ifFlag', 'wait', 'playSound']);

/** Ops que cambian de escena: un hotspot cuyo verbo por defecto los lleva es una salida. */
export const EXIT_OPS: ReadonlySet<string> = new Set(['gotoScene', 'fadeToScene']);

/** Tecla (en minúscula) de cada verbo del panel. */
export const VERB_KEYS: Readonly<Record<string, string>> = {
  OPEN: 'o',
  PICK: 'p',
  PUSH: 's',
  CLOSE: 'c',
  LOOK: 'l',
  PULL: 'y',
  GIVE: 'g',
  TALK: 't',
  USE: 'u',
};

/** Milisegundos máximos entre los dos clics de un doble clic. */
export const DOUBLE_CLICK_MS = 350;

/** Todas las ops de un script, también las anidadas (then, else, steps, script). */
export function opsOf(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const out: string[] = [];
  for (const o of steps as Array<Record<string, unknown>>) {
    if (!o || typeof o.op !== 'string') continue;
    out.push(o.op);
    for (const k of ['then', 'else', 'steps', 'script']) out.push(...opsOf(o[k]));
  }
  return out;
}

/** Primer verbo de PRIMARY_VERB_ORDER cuyo script hace algo más que hablar, o null si ninguno. */
export function primaryVerb(hotspot: HotspotScripts): string | null {
  for (const v of PRIMARY_VERB_ORDER) {
    if (opsOf(hotspot.scripts?.[v]).some((op) => !FLAVOR_OPS.has(op))) return v;
  }
  return null;
}

/** Verbo del clic derecho sobre un hotspot (ver la cabecera). Las NPC van aparte: siempre TALK. */
export function defaultVerbFor(hotspot: HotspotScripts): string {
  return primaryVerb(hotspot) ?? 'LOOK';
}

/** Verbo con el que se sale por un hotspot (su verbo por defecto, si su script cambia de escena), o null. */
export function exitVerbFor(hotspot: HotspotScripts): string | null {
  const v = primaryVerb(hotspot);
  if (!v) return null;
  return opsOf(hotspot.scripts?.[v]).some((op) => EXIT_OPS.has(op)) ? v : null;
}

/** ¿Es el segundo clic de un doble clic? `prev` = último clic de ratón (objetivo y hora en ms). */
export function isDoubleClick(prev: { id: string | null; at: number } | null, id: string | null, now: number): boolean {
  return !!prev && id !== null && prev.id === id && now - prev.at >= 0 && now - prev.at <= DOUBLE_CLICK_MS;
}

/** Dónde está el foco del teclado: en el juego, escribiendo en un campo o en otro control de la página (botón, enlace). */
export type KeyFocus = 'game' | 'typing' | 'elsewhere';

export type KeyAction =
  | { kind: 'verb'; verb: string }
  | { kind: 'highlight' }
  | { kind: 'skip' }
  | { kind: 'inventory' }
  | { kind: 'journal' };

/**
 * Qué hace una pulsación (keydown). null = no es nuestra: el navegador la recibe tal cual (sin preventDefault).
 * Tab solo con el foco en el juego (en un diálogo HTML sigue moviendo el foco); las letras y Esc, salvo escribiendo.
 */
export function keyAction(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  focus: KeyFocus,
): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (focus === 'typing') return null;
  if (e.key === 'Tab') return focus === 'game' ? { kind: 'highlight' } : null;
  if (e.key === 'Escape' || e.key === 'Esc') return { kind: 'skip' };
  if (e.key.length !== 1) return null;
  const k = e.key.toLowerCase();
  if (k === 'i') return { kind: 'inventory' };
  if (k === 'j') return { kind: 'journal' };
  for (const [verb, key] of Object.entries(VERB_KEYS)) if (key === k) return { kind: 'verb', verb };
  return null;
}

/** Foco del teclado a partir del elemento activo (`document.activeElement`) y del lienzo del juego. */
export function focusOf(
  active: { tagName?: string; isContentEditable?: boolean } | null | undefined,
  isGameSurface: boolean,
): KeyFocus {
  if (!active || isGameSurface) return 'game';
  const tag = (active.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) return 'typing';
  if (tag === 'BODY' || tag === 'HTML' || tag === 'CANVAS') return 'game';
  return 'elsewhere';
}

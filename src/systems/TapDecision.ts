/**
 * A1.14 (plan SCUMM): qué hace un toque o clic en la escena. Lógica pura (sin Phaser), probada en
 * tests/tap-decision.test.mjs; GameScene la aplica.
 *
 * Reglas (SCUMM clásico):
 *  - WALK sobre un hotspot = andar, SIN frase: al punto tocado si se pisa y se llega (hotspots «de suelo»: camino,
 *    carport, baldosas), si no a su punto de llegada (`walkTo` o el de Facing), y si no hay, al punto tocado (la ruta
 *    lleva al alcanzable más cercano). Antes de A1.14 un toque con el dedo y WALK sobre un hotspot era LOOK sin andar
 *    y en outside todo el suelo está cubierto por hotspots: no se podía andar tocando el suelo.
 *  - Un toque durante una frase suelta (no cinemática, no árbol de diálogo, sin elección pendiente) la salta Y se
 *    ejecuta en cuanto el juego queda libre; en cinemáticas y diálogos solo avanza.
 *  - Tras una acción con verbo (o un objeto) el panel vuelve a WALK y la línea de acción se limpia.
 */

export interface TapPoint {
  x: number;
  y: number;
}

export type TapTarget = 'floor' | 'hotspot' | 'npc';

export interface TapInput {
  /** Verbo del panel ('WALK', 'LOOK', 'OPEN'…) */
  verb: string;
  /** Lo que hay bajo el toque */
  target: TapTarget;
  /** Hay un objeto del inventario elegido («Use X with…») */
  hasItem: boolean;
  /** Toque con el dedo (no ratón) */
  touch: boolean;
}

export type TapAction =
  /** Andar al punto tocado (suelo sin hotspot) */
  | 'walk'
  /** Andar hacia el hotspot (punto tocado o su punto de llegada: `walkPointFor`), sin frase */
  | 'walk-hotspot'
  /** Con el dedo y WALK sobre un hotspot: al soltar, `walk-hotspot`; manteniendo, la acción principal (V6) */
  | 'hold-or-walk'
  /** Ejecutar el verbo sobre el hotspot (yendo a su punto de llegada) */
  | 'verb'
  /** Usar el objeto elegido con el hotspot */
  | 'combo'
  /** NPC: acercarse y hablar / dar / usar (LOOK: mirarla) */
  | 'npc';

export function decideTap(t: TapInput): TapAction {
  if (t.target === 'npc') return 'npc';
  if (t.target === 'floor') return 'walk';
  if (t.hasItem) return 'combo';
  if (t.verb !== 'WALK') return 'verb';
  return t.touch ? 'hold-or-walk' : 'walk-hotspot';
}

/**
 * Punto al que anda WALK sobre un hotspot: el tocado si se puede pisar y alcanzar desde donde está (suelo cubierto
 * por un hotspot grande), si no su punto de llegada, y si no tiene (otra isla, sin bounds) el tocado igualmente: la
 * ruta lleva al alcanzable más cercano. Nunca null: un toque siempre mueve (o «llega» si ya está ahí).
 */
export function walkPointFor(tapped: TapPoint, tappedReachable: boolean, approach: TapPoint | null): TapPoint {
  if (tappedReachable) return { x: tapped.x, y: tapped.y };
  if (approach) return { x: approach.x, y: approach.y };
  return { x: tapped.x, y: tapped.y };
}

/** Estado de texto y bloqueo en el momento del toque */
export interface TextTapState {
  /** Hay un texto en pantalla (dialogueShowing) */
  textShowing: boolean;
  /** Este mismo toque acaba de cerrar un texto (DialogueBox lo cerró antes que la escena) */
  justDismissed: boolean;
  /** Cinemática en marcha (cinematicMode / cinematicActive / CinematicOverlay) */
  cinematic: boolean;
  /** Árbol de diálogo en marcha */
  dialogueActive: boolean;
  /** Elección de diálogo esperando */
  awaitingChoice: boolean;
  /** Script en marcha (ScriptEngine) */
  scriptRunning: boolean;
}

export type TextTapPolicy =
  /** Nada que saltar ni bloqueo: el toque se ejecuta ya */
  | 'execute'
  /** Saltar la frase (si sigue en pantalla) y ejecutar el toque en cuanto el juego quede libre */
  | 'skip-and-execute'
  /** Solo avanzar / ignorar (cinemática, diálogo, elección, script sin texto) */
  | 'skip-only';

export function textTapPolicy(s: TextTapState): TextTapPolicy {
  if (s.cinematic || s.dialogueActive || s.awaitingChoice) return 'skip-only';
  if (s.textShowing || s.justDismissed) return 'skip-and-execute';
  if (s.scriptRunning) return 'skip-only';
  return 'execute';
}

/**
 * Un toque guardado tras saltar una frase se ejecuta cuando no queda nada que lo bloquee; se descarta si sale otro
 * texto (el script seguía: el toque era «siguiente»), empieza un diálogo o cinemática, o pasa `maxMs`.
 */
export type DeferredTapVerdict = 'run' | 'wait' | 'drop';

export const DEFERRED_TAP_MAX_MS = 600;

export function deferredTapVerdict(
  s: { textShowing: boolean; scriptRunning: boolean; dialogueActive: boolean; cinematic: boolean; sceneChanging: boolean },
  ageMs: number,
  maxMs = DEFERRED_TAP_MAX_MS,
): DeferredTapVerdict {
  if (s.textShowing || s.dialogueActive || s.cinematic || s.sceneChanging) return 'drop';
  if (s.scriptRunning) return ageMs > maxMs ? 'drop' : 'wait';
  return 'run';
}

/** Verbo del panel después de ejecutar una acción: siempre WALK (SCUMM clásico). */
export function verbAfterAction(_verb: string): 'WALK' {
  return 'WALK';
}

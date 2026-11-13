/**
 * A2.18 (plan SCUMM): la frase de dos pasos «Give X to …» / «Use X with …». Lógica pura, sin Phaser (se prueba en Node:
 * tests/sentence.test.mjs, en `npm run test:engine`). ScummUI guarda el estado y aplica lo que decide esto.
 *
 * Máquina de estados (verbo del panel + objeto elegido):
 *
 *   IDLE (verbo, sin objeto)
 *     ── toca objeto con USE (o WALK) ──▶ PENDING(USE, X)    «Use X with …»   (WALK cambia el verbo a USE)
 *     ── toca objeto con GIVE ─────────▶ PENDING(GIVE, X)   «Give X to …»
 *     ── toca objeto con otro verbo ───▶ se resuelve al momento (LOOK describe; OPEN, PUSH, PULL, PICK, TALK, CLOSE:
 *                                         respuesta del objeto), sigue IDLE
 *   PENDING(V, X)
 *     ── toca el mismo X ──────────────▶ IDLE(V)            (suelta el objeto, el verbo sigue elegido)
 *     ── toca otro objeto Y ───────────▶ resolver V X con Y (objeto + objeto) y WALK
 *     ── toca NPC u hotspot ───────────▶ resolver V X con él (GameScene) y WALK
 *     ── toca suelo vacío ─────────────▶ anda, PENDING sigue (como SCUMM)
 *     ── otro verbo / el mismo verbo ──▶ IDLE con ese verbo (o WALK si era el mismo): la frase se cancela
 *     ── clic derecho / Esc ───────────▶ IDLE(WALK): cancelada, sin hacer nada más
 */

/** Verbos de dos objetos y su preposición en la línea de acción. */
export const TWO_OBJECT_VERBS: Readonly<Record<string, string>> = { USE: 'with', GIVE: 'to' };

export interface Sentence {
  /** Verbo del panel ('WALK', 'USE', 'GIVE', 'LOOK'…) */
  verb: string;
  /** Objeto del inventario elegido (primer objeto de la frase), o null */
  item: string | null;
}

export type ItemTap =
  /** Verbo de un objeto (LOOK, OPEN, PUSH…): se resuelve al momento sobre ese objeto */
  | { kind: 'immediate'; verb: string; item: string }
  /** Queda la frase a medias esperando destino */
  | { kind: 'pending'; verb: string; item: string }
  /** Se ha soltado el objeto (tocar el mismo otra vez) */
  | { kind: 'drop' }
  /** Objeto + objeto: «Use X with Y» / «Give X to Y» */
  | { kind: 'resolve'; verb: string; item: string; target: string };

export const idle = (verb = 'WALK'): Sentence => ({ verb, item: null });

export const isTwoObject = (verb: string): boolean => Object.prototype.hasOwnProperty.call(TWO_OBJECT_VERBS, verb);

/** ¿Hay una frase a medias («Give X to …»)? */
export const isPending = (s: Sentence): boolean => !!s.item && isTwoObject(s.verb);

/**
 * Tocar un objeto del inventario. `immediateUse`: objetos que con USE se usan solos (el disfraz de mono: ponérselo o
 * quitárselo), sin esperar destino.
 */
export function tapItem(s: Sentence, itemId: string, opts: { immediateUse?: (id: string) => boolean } = {}): { next: Sentence; action: ItemTap } {
  if (isPending(s)) {
    if (s.item === itemId) return { next: idle(s.verb), action: { kind: 'drop' } };
    return { next: idle('WALK'), action: { kind: 'resolve', verb: s.verb, item: s.item as string, target: itemId } };
  }
  const verb = s.verb === 'WALK' ? 'USE' : s.verb;
  if (verb === 'USE' && opts.immediateUse?.(itemId)) return { next: idle(s.verb), action: { kind: 'immediate', verb: 'USE', item: itemId } };
  if (isTwoObject(verb)) return { next: { verb, item: itemId }, action: { kind: 'pending', verb, item: itemId } };
  return { next: s, action: { kind: 'immediate', verb, item: itemId } };
}

/** Pulsar un verbo del panel (o su tecla): el mismo verbo lo suelta (WALK); cualquier cambio cancela la frase a medias. */
export function selectVerb(s: Sentence, verb: string): Sentence {
  if (verb === s.verb && verb !== 'WALK') return idle('WALK');
  return idle(verb);
}

/** Clic derecho o Esc: cancela la frase (y el verbo). Devuelve también si había algo que cancelar. */
export function cancel(s: Sentence): { next: Sentence; had: boolean } {
  return { next: idle('WALK'), had: !!s.item || s.verb !== 'WALK' };
}

/** Toque en suelo vacío: se anda y la frase sigue a medias (SCUMM). */
export const tapFloor = (s: Sentence): Sentence => s;

/** Tras resolver la frase contra un NPC, hotspot u objeto: vuelta a WALK (A1.14). */
export const resolved = (): Sentence => idle('WALK');

/**
 * Texto de la línea de acción. `label`: etiqueta del verbo en el panel («Give», «Use», «Look at»…); `itemName` el
 * nombre del objeto elegido; `hovered` lo que hay bajo el ratón (en táctil no hay: «Give X to …»).
 */
export function sentenceText(s: Sentence, label: string, itemName: string | null, hovered: string | null): string {
  if (s.item && isTwoObject(s.verb)) {
    const prep = TWO_OBJECT_VERBS[s.verb];
    const name = itemName ?? s.item;
    // pasar el ratón por encima del propio objeto no lo convierte en destino
    return hovered && hovered !== name ? `${label} ${name} ${prep} ${hovered}` : `${label} ${name} ${prep}...`;
  }
  if (s.verb === 'WALK') return hovered ? `Walk to ${hovered}` : '';
  return hovered ? `${label} ${hovered}` : label;
}

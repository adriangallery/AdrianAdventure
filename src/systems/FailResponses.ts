// A2.5 (plan SCUMM): respuestas de fallo con personalidad. Lógica pura, sin Phaser ni imports en tiempo de ejecución (se
// prueba en Node: tests/fail-responses.test.mjs, en `npm run test:engine`). Los datos van en JSON:
//
//   - assets/config/fail-responses.json (global): `verbDefaults` (verbo sin script en un hotspot), `itemVerbDefaults`
//     (verbo sobre un objeto del inventario sin respuesta propia en ScummUI.ITEM_VERB_RESPONSES), `itemHotspot` (objeto
//     en un hotspot, último recurso), `itemNpc.USE/GIVE` (objeto a una NPC, último recurso), `itemItem.default` y
//     `itemItem.pairs[{ items: [a, b], lines }]` (objeto + objeto sin combo) e `items.<id>` (bolsa de «mal uso» de cada
//     objeto: usarlo en algo que no toca).
//   - scene.json: `regions.hotspots[].useResponses` ({ _default: [...], <itemId>: [...] }) y
//     `npcs[].useResponses/giveResponses` (cada valor, una frase o una lista).
//
// Prioridad (objeto sobre hotspot o NPC): pareja específica (`useResponses[item]` del hotspot o la NPC) > `_default`
// del hotspot o la NPC > bolsa del objeto (`items.<id>`) > bolsa genérica (`itemHotspot` / `itemNpc.<verbo>`).
// Objeto + objeto: pareja de `itemItem.pairs` (sin orden) > `itemItem.default`. Verbo sin script: `verbDefaults.<verbo>`.
// Verbo sobre un objeto: lo propio del objeto (lo pasa ScummUI) > `itemVerbDefaults.<verbo>`.
//
// Elección: cada bolsa recuerda su última frase y no la repite (al azar entre las demás). Con `deterministic` (?qa=1)
// cada bolsa va en ronda desde 0 (frase 0, 1, 2… y vuelta), para que el walkthrough pueda poner `rejects` exactos.
// Ningún texto lleva marcadores ni interpolación ({item}, ${…}): todos son literales y tienen clip de voz
// (scripts/voices/extract.mjs los extrae con hablante player).

export type FailKind = 'item-hotspot' | 'item-npc' | 'item-item' | 'verb' | 'item-verb';

/** Lo que se dijo la última vez (QaApi: `state().lastFailResponse`). `bag` = id de la bolsa de la que salió. */
export interface FailResponse {
  kind: FailKind;
  item: string | null;
  target: string | null;
  verb: string | null;
  text: string;
  bag: string;
}

export type ResponseBag = string | string[];
/** `useResponses`/`giveResponses` de hotspot o NPC: id de objeto (o `_default`) → frase o lista de frases */
export type ResponseMap = Record<string, ResponseBag>;

export interface FailResponsesData {
  verbDefaults?: Record<string, string[]>;
  itemVerbDefaults?: Record<string, string[]>;
  itemHotspot?: string[];
  itemNpc?: Record<string, string[]>;
  itemItem?: { default?: string[]; pairs?: { items: string[]; lines: string[] }[] };
  items?: Record<string, string[]>;
}

export interface FailResponsesOptions {
  /** ?qa=1: ronda desde 0 en cada bolsa, sin azar */
  deterministic?: boolean;
  /** Fuente de azar [0, 1) (tests) */
  random?: () => number;
}

/** Último recurso si los datos no traen ninguna bolsa (no debería pasar: el linter y los tests lo impiden). */
export const LAST_RESORT = 'Nothing interesting happens.';

/** Verbos del panel que pueden caer en `verbDefaults` / `itemVerbDefaults`. */
export const FAIL_VERBS = ['LOOK', 'USE', 'TALK', 'PICK', 'OPEN', 'CLOSE', 'PUSH', 'PULL', 'GIVE'] as const;

/** Mínimo de frases de «mal uso» por objeto (el linter avisa por debajo) y por bolsa general. */
export const MIN_ITEM_LINES = 3;
export const MIN_VERB_LINES = 3;
export const MIN_ITEM_ITEM_LINES = 5;

/** ¿Lleva un marcador o interpolación? ({item}, {name}, ${…}) */
export function hasMarker(text: string): boolean {
  return /\$\{|\{[^{}]*\}/.test(text);
}

/** Frase o lista → lista de frases válidas (cadenas con letras, sin marcador). */
export function toLines(bag: unknown): string[] {
  const list: unknown[] = Array.isArray(bag) ? bag : bag === undefined || bag === null ? [] : [bag];
  return list.filter((t): t is string => typeof t === 'string' && /[A-Za-z0-9]/.test(t) && !hasMarker(t));
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}+${b}` : `${b}+${a}`);

export class FailResponses {
  private readonly data: FailResponsesData;
  private readonly deterministic: boolean;
  private readonly random: () => number;
  /** Bolsa → índice de la última frase (azar) o siguiente ronda (determinista) */
  private readonly lastIndex = new Map<string, number>();
  private readonly rounds = new Map<string, number>();
  private readonly pairs = new Map<string, string[]>();
  last: FailResponse | null = null;
  /** A2.14: se llama con cada respuesta de fallo (GameScene: Dex se encoge de hombros); null = nadie escucha */
  onFail: ((r: FailResponse) => void) | null = null;

  constructor(data: FailResponsesData, opts: FailResponsesOptions = {}) {
    this.data = data ?? {};
    this.deterministic = !!opts.deterministic;
    this.random = opts.random ?? Math.random;
    for (const p of this.data.itemItem?.pairs ?? []) {
      if (!Array.isArray(p?.items) || p.items.length !== 2) continue;
      const lines = toLines(p.lines);
      if (lines.length) this.pairs.set(pairKey(p.items[0], p.items[1]), lines);
    }
  }

  /** Elige de una bolsa sin repetir la última (o en ronda si es determinista). null si la bolsa está vacía. */
  pick(bagId: string, bag: unknown): string | null {
    const lines = toLines(bag);
    if (!lines.length) return null;
    if (this.deterministic) {
      const n = this.rounds.get(bagId) ?? 0;
      this.rounds.set(bagId, n + 1);
      return lines[n % lines.length];
    }
    if (lines.length === 1) return lines[0];
    const prev = this.lastIndex.get(bagId);
    const r = Math.min(Math.max(this.random(), 0), 0.999999);
    let i: number;
    if (prev === undefined || prev >= lines.length) {
      i = Math.floor(r * lines.length);
    } else {
      // una de las n-1 que no son la anterior
      i = Math.floor(r * (lines.length - 1));
      if (i >= prev) i++;
    }
    this.lastIndex.set(bagId, i);
    return lines[i];
  }

  /** Recorre candidatos [bagId, bolsa] en orden de prioridad; se queda con la primera bolsa no vacía. */
  private resolve(kind: FailKind, item: string | null, target: string | null, verb: string | null, candidates: [string, unknown][]): FailResponse {
    for (const [bag, lines] of candidates) {
      const text = this.pick(bag, lines);
      if (text !== null) return this.remember({ kind, item, target, verb, text, bag });
    }
    return this.remember({ kind, item, target, verb, text: LAST_RESORT, bag: 'last-resort' });
  }

  private remember(r: FailResponse): FailResponse {
    this.last = r;
    this.onFail?.(r);
    return r;
  }

  /**
   * Objeto sobre un hotspot sin combo. `scene` y `hotspot.id` identifican la bolsa (los ids de hotspot se repiten entre
   * escenas).
   */
  itemOnHotspot(itemId: string, hotspot: { id: string; useResponses?: ResponseMap }, scene = ''): FailResponse {
    const where = `${scene}/${hotspot.id}`;
    const map = hotspot.useResponses ?? {};
    return this.resolve('item-hotspot', itemId, hotspot.id, 'USE', [
      [`hotspot:${where}:${itemId}`, map[itemId]],
      [`hotspot:${where}:_default`, map._default],
      [`item:${itemId}`, this.data.items?.[itemId]],
      ['itemHotspot', this.data.itemHotspot],
    ]);
  }

  /** Objeto a una NPC (USE o GIVE) sin itemDialogues: su mapa (useResponses o giveResponses según el verbo). */
  itemOnNpc(verb: 'USE' | 'GIVE', itemId: string, npc: { id: string; responses?: ResponseMap }, scene = ''): FailResponse {
    const where = `${scene}/${npc.id}:${verb}`;
    const map = npc.responses ?? {};
    return this.resolve('item-npc', itemId, npc.id, verb, [
      [`npc:${where}:${itemId}`, map[itemId]],
      [`npc:${where}:_default`, map._default],
      [`item:${itemId}`, this.data.items?.[itemId]],
      [`itemNpc:${verb}`, this.data.itemNpc?.[verb]],
    ]);
  }

  /** Objeto + objeto sin combo de global.json. */
  itemOnItem(a: string, b: string): FailResponse {
    const key = pairKey(a, b);
    return this.resolve('item-item', a, b, 'USE', [
      [`itemItem:${key}`, this.pairs.get(key)],
      ['itemItem', this.data.itemItem?.default],
    ]);
  }

  /** Verbo sin script en un hotspot. */
  verb(verb: string, target: string | null = null): FailResponse {
    return this.resolve('verb', null, target, verb, [[`verb:${verb}`, this.data.verbDefaults?.[verb]]]);
  }

  /** Verbo sobre un objeto del inventario sin respuesta propia. */
  itemVerb(verb: string, itemId: string): FailResponse {
    return this.resolve('item-verb', itemId, null, verb, [[`itemVerb:${verb}`, this.data.itemVerbDefaults?.[verb]]]);
  }
}

/**
 * Defectos de los datos globales (vacío = válidos): bolsas vacías o con marcador, verbos que faltan o con menos de
 * MIN_VERB_LINES frases, objeto + objeto con menos de MIN_ITEM_ITEM_LINES, parejas mal formadas y objetos que no
 * existen (si se pasa `knownItems`). Lo usa el linter (regla j) y los tests; el juego solo avisa por consola.
 */
export function validateFailData(data: FailResponsesData, knownItems?: Iterable<string>): string[] {
  const out: string[] = [];
  const known = knownItems ? new Set(knownItems) : null;
  const checkBag = (where: string, bag: unknown, min = 1) => {
    if (!Array.isArray(bag)) { out.push(`${where}: tiene que ser una lista de frases`); return; }
    if (!bag.length) out.push(`${where}: bolsa vacía`);
    bag.forEach((t, i) => {
      if (typeof t !== 'string' || !/[A-Za-z0-9]/.test(t)) out.push(`${where}[${i}]: no es una frase`);
      else if (hasMarker(t)) out.push(`${where}[${i}]: lleva marcador o interpolación («${t.slice(0, 40)}»): no tendría voz`);
    });
    if (bag.length && bag.length < min) out.push(`${where}: ${bag.length} frase(s), mínimo ${min}`);
  };
  if (!data || typeof data !== 'object') return ['fail-responses.json no es un objeto'];
  for (const v of FAIL_VERBS) checkBag(`verbDefaults.${v}`, data.verbDefaults?.[v], MIN_VERB_LINES);
  for (const v of FAIL_VERBS) if (v !== 'USE') checkBag(`itemVerbDefaults.${v}`, data.itemVerbDefaults?.[v], MIN_VERB_LINES);
  checkBag('itemHotspot', data.itemHotspot, MIN_ITEM_ITEM_LINES);
  for (const v of ['USE', 'GIVE']) checkBag(`itemNpc.${v}`, data.itemNpc?.[v], MIN_VERB_LINES);
  checkBag('itemItem.default', data.itemItem?.default, MIN_ITEM_ITEM_LINES);
  const seen = new Set<string>();
  (data.itemItem?.pairs ?? []).forEach((p, i) => {
    const where = `itemItem.pairs[${i}]`;
    if (!Array.isArray(p?.items) || p.items.length !== 2 || p.items.some((x) => typeof x !== 'string')) { out.push(`${where}.items: tienen que ser dos ids de objeto`); return; }
    if (p.items[0] === p.items[1]) out.push(`${where}.items: el mismo objeto dos veces`);
    const k = pairKey(p.items[0], p.items[1]);
    if (seen.has(k)) out.push(`${where}: pareja repetida (${k})`);
    seen.add(k);
    if (known) for (const it of p.items) if (!known.has(it)) out.push(`${where}.items: el objeto «${it}» no existe`);
    checkBag(`${where}.lines`, p.lines);
  });
  for (const [id, bag] of Object.entries(data.items ?? {})) {
    if (known && !known.has(id)) out.push(`items.${id}: el objeto no existe`);
    checkBag(`items.${id}`, bag);
  }
  return out;
}

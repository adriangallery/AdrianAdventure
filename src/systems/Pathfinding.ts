// A2.1 (plan SCUMM): pathfinding por las zonas caminables. Lógica pura, sin Phaser ni imports (se prueba en Node:
// tests/pathfinding.test.mjs).
//
// Modelo: la zona caminable es la unión de `walkableAreas` (rectángulos en % del fondo, bordes incluidos) menos
// `blockedAreas` (rectángulos en %, cerrados: su borde tampoco se pisa). Sin `walkableAreas` se anda por todas partes.
//
// Sobre esa zona se monta una rejilla que cubre el rectángulo envolvente de las áreas (celdas de 0,5 % × 1 % por
// defecto: ≈ 18×12 px en un fondo de 3712×1152; como mucho 200×100 celdas). Una celda es caminable si su centro lo
// es. Las componentes conexas (4-vecinas) se calculan una vez al crear la rejilla. Cada orden de andar hace una
// búsqueda A* (8 vecinas sin cortar esquinas, coste euclídeo en %, montículo binario) y suaviza la ruta con línea
// de visión (string pulling: desde cada punto se salta al más lejano que se ve en línea recta sobre la zona real,
// no sobre la rejilla), así que los puntos de paso son pocos y no se nota la rejilla.
//
// Destino no caminable o en otra isla → el punto caminable más cercano DE LA COMPONENTE DEL JUGADOR (proyección
// sobre los rectángulos caminables y sobre los bordes de los bloqueados, o el centro de celda más cercano).
// Origen fuera de zona (spawn mal puesto, partida vieja) → se sale hacia la celda caminable más cercana.
//
// Distancias en % sin corregir el aspecto, igual que el movimiento de Player (que avanza en % por segundo).

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NavOptions {
  /** Ancho de celda en % del fondo (0,5 por defecto) */
  cellW?: number;
  /** Alto de celda en % del fondo (1 por defecto) */
  cellH?: number;
  /** Paso del muestreo de línea de visión, en % (0,1 por defecto) */
  losStep?: number;
}

export interface PathResult {
  /** Puntos de paso después del origen; el último es `goal`. Vacío si no hay que moverse. */
  points: Point[];
  /** Destino real: el pedido o el punto alcanzable más cercano */
  goal: Point;
  /** true si `goal` es exactamente el destino pedido */
  exact: boolean;
  /** Nodos que expandió A* (0 si fue en línea recta) */
  expanded: number;
}

export const DEFAULT_CELL_W = 0.5;
export const DEFAULT_CELL_H = 1;
/** Tope de celdas: si el envolvente pide más, las celdas crecen */
export const MAX_CELLS = 200 * 100;
const EPS = 1e-6;
/** Separación al proyectar fuera de un bloqueado (su borde no es caminable) */
const BLOCK_MARGIN = 0.05;

const inRect = (x: number, y: number, r: Rect): boolean =>
  x >= r.x - EPS && x <= r.x + r.w + EPS && y >= r.y - EPS && y <= r.y + r.h + EPS;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const validRect = (r: Rect | null | undefined): r is Rect =>
  !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.w >= 0 && r.h >= 0;

/** ¿Se puede pisar (x, y)? Dentro de algún área caminable y fuera de todo bloqueado. Sin áreas, sí. */
export function isWalkableIn(walkable: Rect[], blocked: Rect[], x: number, y: number): boolean {
  if (walkable.length === 0) return true;
  let inside = false;
  for (const a of walkable) {
    if (inRect(x, y, a)) {
      inside = true;
      break;
    }
  }
  if (!inside) return false;
  for (const b of blocked) if (inRect(x, y, b)) return false;
  return true;
}

/** Montículo binario de mínimos sobre (prioridad, nodo) en arrays paralelos. */
class MinHeap {
  private keys: number[] = [];
  private nodes: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.keys.length = 0;
    this.nodes.length = 0;
  }

  push(key: number, node: number): void {
    const k = this.keys;
    const n = this.nodes;
    let i = n.length;
    k.push(key);
    n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      n[i] = n[p];
      i = p;
    }
    k[i] = key;
    n[i] = node;
  }

  pop(): number {
    const k = this.keys;
    const n = this.nodes;
    const top = n[0];
    const lastK = k.pop()!;
    const lastN = n.pop()!;
    const len = n.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        n[i] = n[c];
        i = c;
      }
      k[i] = lastK;
      n[i] = lastN;
    }
    return top;
  }
}

export class NavGrid {
  readonly walkable: Rect[];
  readonly blocked: Rect[];
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly x0: number;
  readonly y0: number;
  private readonly losStep: number;
  /** 1 si la celda es caminable */
  private readonly open: Uint8Array;
  /** Componente conexa de cada celda (-1 si no es caminable) */
  private readonly comp: Int32Array;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  /** Búsqueda en la que se tocó la celda (evita reiniciar g/parent en cada búsqueda) */
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private searchId = 0;
  private readonly heap = new MinHeap();

  constructor(walkable: Rect[] | undefined, blocked: Rect[] | undefined = [], opts: NavOptions = {}) {
    this.walkable = (walkable ?? []).filter(validRect).map((r) => ({ ...r }));
    this.blocked = this.walkable.length ? (blocked ?? []).filter(validRect).map((r) => ({ ...r })) : [];
    this.losStep = opts.losStep ?? 0.1;
    let cw = opts.cellW ?? DEFAULT_CELL_W;
    let ch = opts.cellH ?? DEFAULT_CELL_H;
    if (this.walkable.length === 0) {
      this.x0 = 0;
      this.y0 = 0;
      this.cols = 0;
      this.rows = 0;
    } else {
      const minX = Math.min(...this.walkable.map((a) => a.x));
      const minY = Math.min(...this.walkable.map((a) => a.y));
      const maxX = Math.max(...this.walkable.map((a) => a.x + a.w));
      const maxY = Math.max(...this.walkable.map((a) => a.y + a.h));
      const spanX = Math.max(maxX - minX, cw);
      const spanY = Math.max(maxY - minY, ch);
      const cells = Math.ceil(spanX / cw) * Math.ceil(spanY / ch);
      if (cells > MAX_CELLS) {
        const k = Math.sqrt(cells / MAX_CELLS);
        cw *= k;
        ch *= k;
      }
      this.x0 = minX;
      this.y0 = minY;
      // La última columna/fila puede sobresalir: su centro decide si se pisa
      this.cols = Math.max(1, Math.ceil(spanX / cw - EPS));
      this.rows = Math.max(1, Math.ceil(spanY / ch - EPS));
    }
    this.cellW = cw;
    this.cellH = ch;
    const n = this.cols * this.rows;
    this.open = new Uint8Array(n);
    this.comp = new Int32Array(n).fill(-1);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.center(i);
      this.open[i] = this.isWalkable(c.x, c.y) ? 1 : 0;
    }
    this.labelComponents();
  }

  /** Sin áreas caminables: se anda por todas partes */
  get unrestricted(): boolean {
    return this.walkable.length === 0;
  }

  get cellCount(): number {
    return this.cols * this.rows;
  }

  /** Número de componentes conexas de la rejilla */
  get componentCount(): number {
    let max = -1;
    for (let i = 0; i < this.comp.length; i++) if (this.comp[i] > max) max = this.comp[i];
    return max + 1;
  }

  isWalkable(x: number, y: number): boolean {
    return isWalkableIn(this.walkable, this.blocked, x, y);
  }

  /** ¿Se ve b desde a en línea recta sin pisar zona no caminable? (muestreo cada `losStep` %, extremos incluidos) */
  segmentClear(a: Point, b: Point): boolean {
    if (this.unrestricted) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / this.losStep));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(a.x + dx * t, a.y + dy * t)) return false;
    }
    return true;
  }

  /** Componente del punto (la de la celda a la que se ancla), -1 si no se puede anclar */
  componentAt(p: Point): number {
    const c = this.anchorCell(p);
    return c < 0 ? -1 : this.comp[c];
  }

  /** ¿Se puede llegar andando de `from` a `to`? `to` tiene que ser caminable y estar en la misma componente. */
  canReach(from: Point, to: Point): boolean {
    if (this.unrestricted) return true;
    if (!this.isWalkable(to.x, to.y)) return false;
    const start = this.startCell(from);
    const end = this.anchorCell(to);
    return start >= 0 && end >= 0 && this.comp[start] === this.comp[end];
  }

  /** Punto caminable más cercano a `target` dentro de la componente `comp`. */
  nearestReachable(target: Point, comp: number): Point {
    if (this.unrestricted) return { ...target };
    if (this.isWalkable(target.x, target.y) && this.componentAt(target) === comp) return { ...target };
    const cands: Point[] = [];
    const refs: Point[] = [target];
    for (const a of this.walkable) {
      const p = { x: clamp(target.x, a.x, a.x + a.w), y: clamp(target.y, a.y, a.y + a.h) };
      cands.push(p);
      refs.push(p);
    }
    for (const b of this.blocked) {
      for (const r of refs) {
        const cx = clamp(r.x, b.x, b.x + b.w);
        const cy = clamp(r.y, b.y, b.y + b.h);
        cands.push({ x: b.x - BLOCK_MARGIN, y: cy }, { x: b.x + b.w + BLOCK_MARGIN, y: cy });
        cands.push({ x: cx, y: b.y - BLOCK_MARGIN }, { x: cx, y: b.y + b.h + BLOCK_MARGIN });
      }
    }
    let best: Point | null = null;
    let bestD = Infinity;
    for (const p of cands) {
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d >= bestD || !this.isWalkable(p.x, p.y) || this.componentAt(p) !== comp) continue;
      best = p;
      bestD = d;
    }
    // Siempre hay un centro de celda de la componente: cubre zonas que las proyecciones no alcanzan
    const cell = this.nearestCell(target, comp);
    if (cell >= 0) {
      const c = this.center(cell);
      if (Math.hypot(c.x - target.x, c.y - target.y) < bestD) best = c;
    }
    return best ?? { ...target };
  }

  /** Ruta de `start` a `target` (o al punto alcanzable más cercano). */
  findPath(start: Point, target: Point): PathResult {
    if (this.unrestricted) {
      return { points: [{ ...target }], goal: { ...target }, exact: true, expanded: 0 };
    }
    const sCell = this.startCell(start);
    if (sCell < 0) return { points: [], goal: { ...start }, exact: false, expanded: 0 };
    const comp = this.comp[sCell];
    let goal = this.nearestReachable(target, comp);
    let gCell = this.anchorCell(goal);
    if (gCell < 0 || this.comp[gCell] !== comp) {
      gCell = this.nearestCell(goal, comp);
      goal = this.center(gCell);
    }
    const exact = goal.x === target.x && goal.y === target.y;
    const startOk = this.isWalkable(start.x, start.y);
    if (startOk && this.segmentClear(start, goal)) {
      const same = Math.hypot(goal.x - start.x, goal.y - start.y) < EPS;
      return { points: same ? [] : [goal], goal, exact, expanded: 0 };
    }
    const { cells, expanded } = this.astar(sCell, gCell);
    const raw: Point[] = [{ ...start }, ...this.corners(cells).map((c) => this.center(c)), goal];
    const points = this.smooth(raw).slice(1);
    return { points, goal, exact, expanded };
  }

  // ── Interno ──────────────────────────────────────────────

  private center(i: number): Point {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    return { x: this.x0 + (c + 0.5) * this.cellW, y: this.y0 + (r + 0.5) * this.cellH };
  }

  /** Celda que contiene p (fila y columna recortadas a la rejilla) */
  private cellAt(p: Point): number {
    const c = clamp(Math.floor((p.x - this.x0) / this.cellW), 0, this.cols - 1);
    const r = clamp(Math.floor((p.y - this.y0) / this.cellH), 0, this.rows - 1);
    return r * this.cols + c;
  }

  /**
   * Celda caminable a la que se ancla un punto caminable: la suya si su centro se ve desde p; si no, la más
   * cercana de las de alrededor (radio 2) que se vea. -1 si ninguna.
   */
  private anchorCell(p: Point): number {
    if (this.cols === 0) return -1;
    const own = this.cellAt(p);
    if (this.open[own] && this.segmentClear(p, this.center(own))) return own;
    const c0 = own % this.cols;
    const r0 = (own - c0) / this.cols;
    let best = -1;
    let bestD = Infinity;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
        const i = r * this.cols + c;
        if (!this.open[i]) continue;
        const ctr = this.center(i);
        const d = Math.hypot(ctr.x - p.x, ctr.y - p.y);
        if (d < bestD && this.segmentClear(p, ctr)) {
          best = i;
          bestD = d;
        }
      }
    }
    return best;
  }

  /** Celda de salida: la de anclaje si el origen es caminable; si no (origen fuera de zona), la más cercana. */
  private startCell(p: Point): number {
    if (this.isWalkable(p.x, p.y)) {
      const a = this.anchorCell(p);
      if (a >= 0) return a;
    }
    return this.nearestCell(p, -1);
  }

  /** Centro de celda caminable más cercano a p (de la componente `comp`, o de cualquiera con -1) */
  private nearestCell(p: Point, comp: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.open.length; i++) {
      if (!this.open[i] || (comp >= 0 && this.comp[i] !== comp)) continue;
      const c = this.center(i);
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private labelComponents(): void {
    const n = this.open.length;
    const stack: number[] = [];
    let label = 0;
    for (let s = 0; s < n; s++) {
      if (!this.open[s] || this.comp[s] >= 0) continue;
      this.comp[s] = label;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        const c = i % this.cols;
        const neigh = [c > 0 ? i - 1 : -1, c < this.cols - 1 ? i + 1 : -1, i - this.cols, i + this.cols];
        for (const j of neigh) {
          if (j < 0 || j >= n || !this.open[j] || this.comp[j] >= 0) continue;
          this.comp[j] = label;
          stack.push(j);
        }
      }
      label++;
    }
  }

  /** A* de celda a celda (misma componente). 8 vecinas; en diagonal solo si las dos ortogonales están libres. */
  private astar(from: number, to: number): { cells: number[]; expanded: number } {
    if (from === to) return { cells: [from], expanded: 0 };
    const id = ++this.searchId;
    const { cols, rows, cellW: cw, cellH: ch } = this;
    const diag = Math.hypot(cw, ch);
    // Heurística euclídea en % (ningún paso cuesta menos que su distancia en línea recta)
    const gc = to % cols;
    const gr = (to - gc) / cols;
    const h = (i: number): number => {
      const c = i % cols;
      const dx = (c - gc) * cw;
      const dy = ((i - c) / cols - gr) * ch;
      // Desempate hacia el destino (×1,001): con costes iguales expande menos nodos y la ruta sigue siendo
      // óptima salvo un 0,1 %
      return Math.sqrt(dx * dx + dy * dy) * 1.001;
    };
    const heap = this.heap;
    heap.clear();
    this.seen[from] = id;
    this.g[from] = 0;
    this.parent[from] = -1;
    heap.push(h(from), from);
    let expanded = 0;
    let found = false;
    while (heap.size) {
      const i = heap.pop();
      if (this.closed[i] === id) continue;
      this.closed[i] = id;
      expanded++;
      if (i === to) {
        found = true;
        break;
      }
      const c = i % cols;
      const r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          const j = nr * cols + nc;
          if (!this.open[j] || this.closed[j] === id) continue;
          if (dr !== 0 && dc !== 0 && (!this.open[r * cols + nc] || !this.open[nr * cols + c])) continue;
          const step = dr === 0 ? cw : dc === 0 ? ch : diag;
          const ng = this.g[i] + step;
          if (this.seen[j] === id && ng >= this.g[j]) continue;
          this.seen[j] = id;
          this.g[j] = ng;
          this.parent[j] = i;
          heap.push(ng + h(j), j);
        }
      }
    }
    if (!found) return { cells: [from], expanded };
    const cells: number[] = [];
    for (let i = to; i >= 0; i = this.parent[i]) {
      cells.push(i);
      if (i === from) break;
    }
    cells.reverse();
    return { cells, expanded };
  }

  /** Quita las celdas intermedias de los tramos rectos de la ruta de A* (el suavizado solo necesita los giros). */
  private corners(cells: number[]): number[] {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    for (let k = 1; k < cells.length - 1; k++) {
      if (cells[k] - cells[k - 1] !== cells[k + 1] - cells[k]) out.push(cells[k]);
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  /** String pulling: desde cada ancla, el punto más lejano de la ruta que se ve en línea recta. */
  private smooth(raw: Point[]): Point[] {
    const out: Point[] = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = i + 1;
      while (j + 1 < raw.length && this.segmentClear(raw[i], raw[j + 1])) j++;
      out.push(raw[j]);
      i = j;
    }
    // Quita puntos repetidos (centro de celda que coincide con el destino)
    return out.filter((p, k) => k === 0 || Math.hypot(p.x - out[k - 1].x, p.y - out[k - 1].y) > EPS);
  }
}

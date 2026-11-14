// A4.3 (plan SCUMM): animación ambiental por código, declarada en scene.json bajo `ambient[]`.
// Lógica pura, sin Phaser (se prueba en Node: tests/ambient.test.mjs, en `npm run test:engine`): la especificación de cada
// elemento con sus valores por defecto y su validación (`parseAmbient`), y la simulación determinista de cada tipo
// (`createAmbientSim`). src/systems/AmbientLayer.ts (Phaser) la dibuja cada frame desde GameScene.update.
//
// Un elemento es { id, kind, …campos del tipo… } con, opcionalmente, `when` (condición de A2.6a: `flag`, `!flag`, `item:id`,
// `!item:id`; texto o lista = todas) que lo enciende o apaga en cuanto cambia la partida (como un conditionalOverlay, pero
// con la gramática de `when`), `depth` (por defecto DEFAULT_DEPTH: encima del jugador y debajo del primer plano) y `blend`.
// Las posiciones (`at`, `area`, `cells`, `floorY`) van en % del fondo, como los hotspots; los tamaños (`size`, `amplitude`)
// en píxeles del FONDO (la pintura de 3712×1152), para que se vean igual con cualquier ventana; `radius` en % del alto.
//
// Tipos (`kind`), con sus campos propios:
//   moths    polillas alrededor de un punto: `at`, `radius`, `count`, `size`, `speed`
//   dust     motas que flotan y centellean en `area`: `count`, `size`, `speed` (0 = quietas, solo centellean: estrellas,
//            luces lejanas, reflejos del agua), `burst` (motas extra de una ráfaga, op `ambient` → burst)
//   leds     luces que parpadean: `cells` [{x,y}] o `area` + `cols`/`rows`; `colors` (lista), `period`, `size`
//   fog      niebla: bancos suaves que cruzan `area`: `count`, `size` (alto de cada banco), `speed`, `parallax`
//   clouds   nubes con parallax en `area`: `count`, `size`, `speed`, `parallax` (< 1 = se mueven menos que el fondo)
//   flicker  luz que titila (fluorescente, bombilla): `area`, `shape`, `alpha` (máx.), `alphaMin`, `period` (ms de cada tic)
//   glow     brillo que respira (monitor, lámpara): `area`, `shape`, `alpha` (máx.), `alphaMin`, `period` (ciclo). Con
//            `rect`, una mancha rectangular de bordes difuminados (A9.6); `area` = la pantalla o ventana que emite
//   scan     línea de barrido de un CRT: `area`, `period` (ms de arriba abajo), `size` (grosor)
//   rise     partículas que suben (burbujas, vapor, chispas): `area` (nacen abajo, mueren arriba), `count`, `size`, `speed`,
//            `soft` (manchas suaves en vez de puntos), `burst`
//   drip     gotera: una gota cae de `at` a `floorY` cada `period` ms y salpica
//   birds    pájaros lejanos que vuelan en `area`: `count`, `size` (envergadura), `speed`
//   sway     vaivén del primer plano (`assets.foreground`): `amplitude` (px del fondo), `period`
//
// Determinismo: con ?qa=1 la semilla es fija (QA_LIFE_SEED de NpcLife mezclada con el id), así una demo graba siempre lo
// mismo. El tiempo lo lleva GameScene (reloj real, como la vida de las NPC): la simulación solo recibe dt.

// Sin imports de valores: Node (type stripping, tests) no resuelve './NpcLife' sin extensión; el PRNG y el hash son los
// mismos de NpcLife.ts (mulberry32 y FNV-1a), repetidos aquí por eso.

/** PRNG pequeño y determinista (mulberry32, el mismo que NpcLife y PlayerAnim) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits de un texto (semilla por id) */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const AMBIENT_KINDS = ['moths', 'dust', 'leds', 'fog', 'clouds', 'flicker', 'glow', 'scan', 'rise', 'drip', 'birds', 'sway'] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];
export const AMBIENT_BLENDS = ['normal', 'add', 'screen', 'multiply'] as const;
export type AmbientBlend = (typeof AMBIENT_BLENDS)[number];
export type AmbientShape = 'rect' | 'ellipse';

/** Tope de partículas por elemento y de elementos por escena (scripts/lint-scenes.mjs repite los mismos valores) */
export const AMBIENT_MAX_COUNT = 200;
export const AMBIENT_MAX_PER_SCENE = 24;
/**
 * Profundidad por defecto: encima de Dex y las NPC (9-10, ordenados por la y de los pies desde A2.12, actorDepth de
 * WalkMotion.ts), a la altura de los overlays condicionales (12; el ambiente se crea después y queda encima) y debajo del
 * primer plano (15). Lo que es pared o fondo (LEDs, brillos, niebla, goteras) va a 5, detrás de los actores; nubes y
 * pájaros, a 1
 */
export const DEFAULT_DEPTH = 12;
/** Alto de referencia del fondo (px): los valores por defecto de tamaño están pensados para esta pintura */
export const REF_BG_H = 1152;
/** A4.3 (QA): decimales con los que se redondea la salida para la firma de un frame */
const SIG_ROUND = 2;

export interface PctRect { x: number; y: number; w: number; h: number }
export interface PctPoint { x: number; y: number }
/** Misma sintaxis que CONDITION_RE de src/systems/DialogueSystem.ts (A2.6a) y de scripts/lint-scenes.mjs */
export const AMBIENT_CONDITION_RE = /^(!?)(?:(flag|item):)?([A-Za-z0-9_.-]+)$/;
export interface AmbientCondition { kind: 'flag' | 'item'; name: string; negated: boolean }

/** Elemento ya validado, con todos los campos (los que no aplican a su tipo quedan con el valor por defecto) */
export interface AmbientSpec {
  id: string;
  kind: AmbientKind;
  when: AmbientCondition[];
  depth: number;
  alpha: number;
  alphaMin: number;
  color: number;
  colors: number[];
  count: number;
  size: number;
  speed: number;
  period: number;
  area: PctRect | null;
  at: PctPoint | null;
  radius: number;
  parallax: number;
  blend: AmbientBlend;
  shape: AmbientShape;
  floorY: number | null;
  burst: number;
  soft: boolean;
  cells: PctPoint[] | null;
  cols: number;
  rows: number;
  amplitude: number;
}

type Defaults = Partial<Omit<AmbientSpec, 'id' | 'kind' | 'when' | 'area' | 'at' | 'cells' | 'floorY'>>;

const BASE: Omit<AmbientSpec, 'id' | 'kind'> = {
  when: [], depth: DEFAULT_DEPTH, alpha: 1, alphaMin: -1, color: 0xffffff, colors: [], count: 1, size: 3, speed: 1, period: 1000,
  area: null, at: null, radius: 3, parallax: 1, blend: 'normal', shape: 'rect', floorY: null, burst: 0, soft: false, cells: null,
  cols: 1, rows: 1, amplitude: 4,
};

/** Valores por defecto de cada tipo (alphaMin -1 = el 30 % de alpha) */
// Tamaños pensados en píxeles de ARTE: un píxel de arte de los personajes son ≈ 5,5 px del fondo (A2.8), así que un
// punto de 6 px del fondo se ve como un píxel de arte y uno de 3 desaparecería al reducir
export const KIND_DEFAULTS: Record<AmbientKind, Defaults> = {
  // Polillas oscuras, como siluetas contra la luz (con blend add se perdían en el halo de la lámpara)
  moths: { count: 4, size: 8, color: 0x2b1d12, alpha: 0.9, radius: 3 },
  dust: { count: 20, size: 4, color: 0xfff1c8, alpha: 0.5, blend: 'add' },
  leds: { size: 5, colors: [0x4cff6a, 0xffb02e, 0x3fa7ff], alpha: 1, period: 700, blend: 'add', depth: 5 },
  fog: { count: 4, size: 220, color: 0xe6e0f8, alpha: 0.3, depth: 5 },
  clouds: { count: 3, size: 140, color: 0xfff2f6, alpha: 0.4, parallax: 0.6, depth: 1 },
  flicker: { color: 0xe8f4ff, alpha: 0.18, alphaMin: 0, period: 90, depth: 5, blend: 'add' },
  glow: { color: 0x9cffb0, alpha: 0.25, period: 2600, depth: 5, blend: 'add', shape: 'ellipse' },
  scan: { color: 0xffffff, alpha: 0.12, period: 2200, size: 6, depth: 5, blend: 'add' },
  rise: { count: 10, size: 5, color: 0xd0ffe0, alpha: 0.7, blend: 'add' },
  drip: { period: 2600, size: 5, color: 0xa8d8ff, alpha: 0.85, depth: 5 },
  birds: { count: 3, size: 12, color: 0x2a2436, alpha: 0.9, depth: 1 },
  sway: { amplitude: 4, period: 3400 },
};

/** Tipos que necesitan `area`, y los que necesitan `at` */
const NEEDS_AREA = new Set<AmbientKind>(['dust', 'fog', 'clouds', 'flicker', 'glow', 'scan', 'rise', 'birds']);
const NEEDS_AT = new Set<AmbientKind>(['moths', 'drip']);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseRect(v: unknown): PctRect | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
  if (r.w <= 0 || r.h <= 0 || r.x < -10 || r.y < -10 || r.x + r.w > 110 || r.y + r.h > 110) return null;
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

export function parsePoint(v: unknown): PctPoint | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (!isNum(p.x) || !isNum(p.y) || p.x < -10 || p.x > 110 || p.y < -10 || p.y > 110) return null;
  return { x: p.x, y: p.y };
}

/** `#rrggbb`, `0xrrggbb` o un número → número; null si no vale */
export function parseColor(v: unknown): number | null {
  if (isNum(v) && v >= 0 && v <= 0xffffff && Number.isInteger(v)) return v;
  if (typeof v !== 'string') return null;
  const m = /^(?:#|0x)?([0-9a-fA-F]{6})$/.exec(v.trim());
  return m ? parseInt(m[1], 16) : null;
}

export function parseConditions(when: unknown): { ok: AmbientCondition[]; bad: string[] } {
  const ok: AmbientCondition[] = [];
  const bad: string[] = [];
  const list = when === undefined || when === null ? [] : Array.isArray(when) ? when : [when];
  for (const raw of list) {
    const m = typeof raw === 'string' ? AMBIENT_CONDITION_RE.exec(raw.trim()) : null;
    if (m) ok.push({ kind: m[2] === 'item' ? 'item' : 'flag', name: m[3], negated: m[1] === '!' });
    else bad.push(String(raw));
  }
  return { ok, bad };
}

/** true si se cumplen TODAS las condiciones (vacío = siempre) */
export function conditionsHold(when: AmbientCondition[], getFlag: (f: string) => boolean, hasItem: (i: string) => boolean): boolean {
  for (const c of when) {
    const v = c.kind === 'item' ? hasItem(c.name) : getFlag(c.name);
    if (v === c.negated) return false;
  }
  return true;
}

/**
 * Valida `ambient[]` de un scene.json. Un elemento mal definido se salta (el juego funciona sin él) y queda en `problems`
 * (el linter de escenas los marca; GameScene los avisa por consola).
 */
export function parseAmbient(raw: unknown, sceneId = 'scene'): { specs: AmbientSpec[]; problems: string[] } {
  const specs: AmbientSpec[] = [];
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { specs, problems };
  if (!Array.isArray(raw)) return { specs, problems: [`${sceneId}.ambient tiene que ser una lista`] };
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    const where = `${sceneId}.ambient[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${where}: no es un objeto`); return; }
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[a-z0-9_]+$/i.test(o.id) ? o.id : null;
    if (!id) { problems.push(`${where}: sin id (letras, números y _)`); return; }
    if (ids.has(id)) { problems.push(`${where}: id «${id}» repetido`); return; }
    const kind = (AMBIENT_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as AmbientKind) : null;
    if (!kind) { problems.push(`${where} (${id}): kind «${String(o.kind)}» desconocido (${AMBIENT_KINDS.join(', ')})`); return; }
    const bad: string[] = [];
    const s: AmbientSpec = { ...BASE, ...KIND_DEFAULTS[kind], id, kind, when: [] };
    const cond = parseConditions(o.when);
    if (cond.bad.length) bad.push(`when «${cond.bad.join('», «')}» no válido (flag, !flag, item:id, !item:id)`);
    s.when = cond.ok;
    const num = (k: keyof AmbientSpec, lo: number, hi: number) => {
      if (o[k] === undefined) return;
      if (isNum(o[k]) && (o[k] as number) >= lo && (o[k] as number) <= hi) (s as unknown as Record<string, unknown>)[k] = o[k];
      else bad.push(`${k} = ${JSON.stringify(o[k])} fuera de ${lo}-${hi}`);
    };
    num('depth', -10, 100);
    num('alpha', 0, 1);
    num('alphaMin', 0, 1);
    num('count', 0, AMBIENT_MAX_COUNT);
    num('size', 0.5, 2000);
    num('speed', 0, 20);
    num('period', 16, 600000);
    num('radius', 0.1, 50);
    num('parallax', 0, 1);
    num('burst', 0, AMBIENT_MAX_COUNT);
    num('cols', 1, 64);
    num('rows', 1, 64);
    num('amplitude', 0, 200);
    if (o.floorY !== undefined) { if (isNum(o.floorY) && o.floorY >= 0 && o.floorY <= 110) s.floorY = o.floorY; else bad.push('floorY fuera de 0-110'); }
    if (o.color !== undefined) { const c = parseColor(o.color); if (c === null) bad.push(`color ${JSON.stringify(o.color)} no válido (#rrggbb)`); else s.color = c; }
    if (o.colors !== undefined) {
      const list = Array.isArray(o.colors) ? o.colors.map(parseColor) : null;
      if (!list || !list.length || list.some((c) => c === null)) bad.push('colors tiene que ser una lista de #rrggbb');
      else s.colors = list as number[];
    }
    if (o.blend !== undefined) { if ((AMBIENT_BLENDS as readonly string[]).includes(String(o.blend))) s.blend = o.blend as AmbientBlend; else bad.push(`blend «${String(o.blend)}» no válido (${AMBIENT_BLENDS.join(', ')})`); }
    if (o.shape !== undefined) { if (o.shape === 'rect' || o.shape === 'ellipse') s.shape = o.shape; else bad.push('shape tiene que ser rect o ellipse'); }
    if (o.soft !== undefined) { if (typeof o.soft === 'boolean') s.soft = o.soft; else bad.push('soft tiene que ser true o false'); }
    if (o.area !== undefined) { const r = parseRect(o.area); if (r) s.area = r; else bad.push('area tiene que ser {x, y, w, h} en % (w, h > 0)'); }
    if (o.at !== undefined) { const p = parsePoint(o.at); if (p) s.at = p; else bad.push('at tiene que ser {x, y} en %'); }
    if (o.cells !== undefined) {
      const list = Array.isArray(o.cells) ? o.cells.map(parsePoint) : null;
      if (!list || !list.length || list.some((p) => p === null) || list.length > AMBIENT_MAX_COUNT) bad.push(`cells tiene que ser una lista de {x, y} (máx. ${AMBIENT_MAX_COUNT})`);
      else s.cells = list as PctPoint[];
    }
    if (NEEDS_AREA.has(kind) && !s.area) bad.push(`${kind} necesita area`);
    if (NEEDS_AT.has(kind) && !s.at) bad.push(`${kind} necesita at`);
    if (kind === 'drip' && s.floorY === null) bad.push('drip necesita floorY');
    if (kind === 'drip' && s.at && s.floorY !== null && s.floorY <= s.at.y) bad.push('drip: floorY tiene que estar por debajo de at.y');
    if (kind === 'leds' && !s.cells && !s.area) bad.push('leds necesita cells o area (con cols y rows)');
    if (kind === 'leds' && s.area && s.cols * s.rows > AMBIENT_MAX_COUNT) bad.push(`leds: cols × rows > ${AMBIENT_MAX_COUNT}`);
    if (s.alphaMin < 0) s.alphaMin = Math.round(s.alpha * 0.3 * 1000) / 1000;
    if (s.alphaMin > s.alpha) bad.push('alphaMin tiene que ser ≤ alpha');
    if (bad.length) { problems.push(`${where} (${id}): ${bad.join('; ')}`); return; }
    ids.add(id);
    specs.push(s);
  });
  if (specs.length > AMBIENT_MAX_PER_SCENE) problems.push(`${sceneId}.ambient: ${specs.length} elementos, máximo ${AMBIENT_MAX_PER_SCENE} (se usan los primeros)`);
  return { specs: specs.slice(0, AMBIENT_MAX_PER_SCENE), problems };
}

// ─── Simulación ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que se dibuja en un frame: todo en píxeles del FONDO (origen arriba a la izquierda de la pintura) */
export interface Dot { x: number; y: number; r: number; alpha: number; color: number }
/** `rect`: mancha rectangular de bordes difuminados (glow `rect`, A9.6) en vez de la radial */
export interface Blob { x: number; y: number; w: number; h: number; alpha: number; color: number; rect?: boolean }
export interface Shape { x: number; y: number; w: number; h: number; alpha: number; color: number; shape: AmbientShape; stroke: number }
export interface Line { x1: number; y1: number; x2: number; y2: number; alpha: number; color: number; width: number }
export interface AmbientFrame {
  dots: Dot[];
  blobs: Blob[];
  shapes: Shape[];
  lines: Line[];
  /** Desplazamiento horizontal del primer plano (sway), px del fondo */
  fgOffset: number;
}

export interface SimInput {
  /** ms desde el frame anterior (ya acotados por GameScene) */
  dt: number;
  /** Desplazamiento de la cámara (scrollX) en px del FONDO: para el parallax y el envoltorio de nubes y niebla */
  scroll: number;
}

export interface AmbientSim {
  readonly spec: AmbientSpec;
  /** Avanza y devuelve el frame */
  step(i: SimInput): AmbientFrame;
  /** Ráfaga (op ambient burst): partículas extra de una vez. false si el tipo no tiene ráfaga */
  burst(): boolean;
  /** Último frame (sin avanzar) */
  last(): AmbientFrame;
}

const emptyFrame = (): AmbientFrame => ({ dots: [], blobs: [], shapes: [], lines: [], fgOffset: 0 });
const TAU = Math.PI * 2;

/** Geometría del fondo: convierte % a px del fondo */
export interface BgGeom { w: number; h: number }
const px = (g: BgGeom, p: PctPoint) => ({ x: (p.x / 100) * g.w, y: (p.y / 100) * g.h });
const rectPx = (g: BgGeom, r: PctRect) => ({ x: (r.x / 100) * g.w, y: (r.y / 100) * g.h, w: (r.w / 100) * g.w, h: (r.h / 100) * g.h });
/** Los tamaños por defecto están pensados para un fondo de REF_BG_H de alto: en otro se escalan */
const sizeScale = (g: BgGeom) => g.h / REF_BG_H;

abstract class BaseSim implements AmbientSim {
  readonly spec: AmbientSpec;
  readonly g: BgGeom;
  readonly rng: () => number;
  protected t = 0;
  protected frame = emptyFrame();
  // Sin «parameter properties»: Node (type stripping) no las admite y las pruebas importan este fichero tal cual
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    this.spec = spec;
    this.g = g;
    this.rng = mulberry32(seed);
  }
  protected between(a: number, b: number): number { return a + this.rng() * (b - a); }
  abstract step(i: SimInput): AmbientFrame;
  burst(): boolean { return false; }
  last(): AmbientFrame { return this.frame; }
}

/** moths: polillas que orbitan un punto con giros y arranques, aleteando (alfa) */
class MothsSim extends BaseSim {
  private m: Array<{ a: number; r: number; tr: number; w: number; retarget: number; flap: number; flapHz: number }> = [];
  private c: PctPoint;
  private R: number;
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.c = px(g, spec.at!);
    this.R = (spec.radius / 100) * g.h;
    for (let i = 0; i < spec.count; i++) {
      const w = this.between(1.6, 3.4) * (this.rng() < 0.5 ? -1 : 1);
      this.m.push({ a: this.rng() * TAU, r: this.between(0.3, 1), tr: this.between(0.25, 1), w, retarget: this.between(300, 1100), flap: this.rng() * TAU, flapHz: this.between(9, 14) });
    }
  }
  step({ dt }: SimInput): AmbientFrame {
    const s = dt / 1000;
    this.t += dt;
    const sp = this.spec.speed;
    const dots: Dot[] = [];
    for (const m of this.m) {
      m.a += m.w * sp * s;
      m.retarget -= dt;
      if (m.retarget <= 0) {
        m.retarget = this.between(300, 1100);
        m.tr = this.between(0.2, 1);
        if (this.rng() < 0.3) m.w = -m.w;
      }
      m.r += (m.tr - m.r) * Math.min(1, 2.5 * sp * s);
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(m.flap + (this.t / 1000) * m.flapHz * TAU * Math.max(0.2, sp)));
      dots.push({
        x: this.c.x + Math.cos(m.a) * m.r * this.R,
        y: this.c.y + Math.sin(m.a) * m.r * this.R * 0.7,
        r: this.spec.size * sizeScale(this.g),
        alpha: this.spec.alpha * flap,
        color: this.spec.color,
      });
    }
    this.frame = { ...emptyFrame(), dots };
    return this.frame;
  }
}

interface Particle { x: number; y: number; vx: number; vy: number; ph: number; hz: number; life: number; lifeMs: number; size: number; temp: boolean }

/** dust: motas que derivan despacio y centellean dentro de un área (con speed 0 solo centellean); ráfaga opcional */
class DustSim extends BaseSim {
  private p: Particle[] = [];
  private area: { x: number; y: number; w: number; h: number };
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.area = rectPx(g, spec.area!);
    for (let i = 0; i < spec.count; i++) this.p.push(this.make(false));
  }
  private make(temp: boolean): Particle {
    const a = this.area;
    const k = sizeScale(this.g);
    const base = temp ? this.between(60, 160) : this.between(3, 9);
    return {
      x: temp ? a.x + a.w * this.between(0.3, 0.7) : a.x + this.rng() * a.w,
      y: temp ? a.y + a.h * this.between(0.4, 0.9) : a.y + this.rng() * a.h,
      vx: base * k * (this.rng() < 0.5 ? -1 : 1) * this.spec.speed,
      vy: (temp ? -this.between(40, 120) : this.between(-4, 4)) * k * this.spec.speed,
      ph: this.rng() * TAU, hz: this.between(0.25, 0.8), life: 0, lifeMs: temp ? this.between(900, 1500) : 0,
      size: this.spec.size * k * this.between(0.7, 1.3), temp,
    };
  }
  burst(): boolean {
    if (!this.spec.burst) return false;
    for (let i = 0; i < this.spec.burst; i++) this.p.push(this.make(true));
    return true;
  }
  step({ dt }: SimInput): AmbientFrame {
    const s = dt / 1000;
    this.t += dt;
    const a = this.area;
    const dots: Dot[] = [];
    this.p = this.p.filter((q) => {
      q.life += dt;
      if (q.temp && q.life >= q.lifeMs) return false;
      q.x += q.vx * s;
      q.y += q.vy * s;
      if (q.temp) { q.vx *= Math.max(0, 1 - 2.2 * s); q.vy += 90 * sizeScale(this.g) * s; } else {
        if (q.x < a.x) q.x += a.w; else if (q.x > a.x + a.w) q.x -= a.w;
        if (q.y < a.y) q.y += a.h; else if (q.y > a.y + a.h) q.y -= a.h;
      }
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(q.ph + (this.t / 1000) * q.hz * TAU));
      const fade = q.temp ? 1 - q.life / q.lifeMs : 1;
      dots.push({ x: q.x, y: q.y, r: q.size, alpha: this.spec.alpha * tw * fade, color: this.spec.color });
      return true;
    });
    this.frame = { ...emptyFrame(), dots };
    return this.frame;
  }
}

/** leds: cada celda enciende y apaga con su propio reloj (encendida el 70 % de las veces), color fijo por celda */
class LedsSim extends BaseSim {
  private cells: Array<{ x: number; y: number; on: boolean; left: number; color: number }> = [];
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    const pts: PctPoint[] = spec.cells ? spec.cells : [];
    if (!spec.cells && spec.area) {
      const a = spec.area;
      for (let r = 0; r < spec.rows; r++) {
        for (let c = 0; c < spec.cols; c++) {
          pts.push({ x: a.x + (spec.cols === 1 ? a.w / 2 : (c / (spec.cols - 1)) * a.w), y: a.y + (spec.rows === 1 ? a.h / 2 : (r / (spec.rows - 1)) * a.h) });
        }
      }
    }
    const colors = spec.colors.length ? spec.colors : [spec.color];
    for (const p of pts) {
      const q = px(g, p);
      this.cells.push({ x: q.x, y: q.y, on: this.rng() < 0.7, left: this.rng() * spec.period * 1.5, color: colors[Math.floor(this.rng() * colors.length)] });
    }
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt;
    const r = this.spec.size * sizeScale(this.g);
    const dots: Dot[] = [];
    for (const c of this.cells) {
      c.left -= dt * Math.max(0.05, this.spec.speed);
      if (c.left <= 0) {
        c.on = this.rng() < 0.7;
        c.left = this.spec.period * this.between(0.3, 1.7);
      }
      dots.push({ x: c.x, y: c.y, r, alpha: c.on ? this.spec.alpha : this.spec.alpha * 0.15, color: c.color });
    }
    this.frame = { ...emptyFrame(), dots };
    return this.frame;
  }
}

/** fog y clouds: manchas suaves que cruzan el área en horizontal, envueltas; con parallax se mueven menos que el fondo */
class DriftSim extends BaseSim {
  private items: Array<{ u: number; v: number; w: number; h: number; vx: number; ph: number; parts: Array<{ dx: number; dy: number; k: number }> }> = [];
  private area: { x: number; y: number; w: number; h: number };
  private cloud: boolean;
  constructor(spec: AmbientSpec, seed: number, g: BgGeom, cloud: boolean) {
    super(spec, seed, g);
    this.cloud = cloud;
    this.area = rectPx(g, spec.area!);
    const k = sizeScale(g);
    const base = (cloud ? 3 : 8) * k * spec.speed;
    for (let i = 0; i < spec.count; i++) {
      const h = spec.size * k * this.between(0.7, 1.2);
      const parts = cloud
        ? Array.from({ length: 3 + Math.floor(this.rng() * 3) }, () => ({ dx: this.between(-1, 1), dy: this.between(-0.25, 0.25), k: this.between(0.5, 1) }))
        : [{ dx: 0, dy: 0, k: 1 }];
      this.items.push({ u: this.rng() * this.area.w, v: this.rng() * this.area.h, w: h * (cloud ? 2 : this.between(1.8, 2.8)), h, vx: base * this.between(0.6, 1.3), ph: this.rng() * TAU, parts });
    }
  }
  step({ dt, scroll }: SimInput): AmbientFrame {
    const s = dt / 1000;
    this.t += dt;
    const a = this.area;
    const off = (1 - this.spec.parallax) * scroll;
    const blobs: Blob[] = [];
    for (const it of this.items) {
      it.u += it.vx * s;
      if (it.u > a.w + it.w) it.u -= a.w + it.w * 2;
      const pulse = this.cloud ? 1 : 0.75 + 0.25 * Math.sin(it.ph + (this.t / 1000) * 0.3 * TAU);
      // El envoltorio también con el parallax: la nube siempre dentro de la banda, mire donde mire la cámara
      const span = a.w + it.w * 2;
      let x = a.x + (((it.u + off + it.w) % span) + span) % span - it.w;
      if (x > a.x + a.w + it.w) x -= span;
      for (const p of it.parts) {
        blobs.push({ x: x + p.dx * it.w * 0.45, y: a.y + it.v + p.dy * it.h, w: it.w * p.k, h: it.h * p.k, alpha: this.spec.alpha * pulse, color: this.spec.color });
      }
    }
    this.frame = { ...emptyFrame(), blobs };
    return this.frame;
  }
}

/** flicker: casi siempre al máximo; de vez en cuando una ráfaga de tics (cada `period` ms) que bajan hacia alphaMin */
class FlickerSim extends BaseSim {
  private alpha: number;
  private untilBurst: number;
  private ticks = 0;
  private tickLeft = 0;
  private area: { x: number; y: number; w: number; h: number };
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.alpha = spec.alpha;
    this.area = rectPx(g, spec.area!);
    this.untilBurst = this.between(400, 2600);
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt;
    const sp = Math.max(0.05, this.spec.speed);
    if (this.ticks > 0) {
      this.tickLeft -= dt * sp;
      if (this.tickLeft <= 0) {
        this.ticks--;
        this.tickLeft = this.spec.period * this.between(0.5, 1.5);
        this.alpha = this.ticks > 0 ? this.between(this.spec.alphaMin, (this.spec.alphaMin + this.spec.alpha) / 2) : this.spec.alpha;
      }
    } else {
      this.untilBurst -= dt * sp;
      if (this.untilBurst <= 0) {
        this.ticks = 2 + Math.floor(this.rng() * 5);
        this.tickLeft = 0;
        this.untilBurst = this.between(800, 3200);
      }
    }
    this.frame = lightFrame(this.area, this.alpha, this.spec);
    return this.frame;
  }
}

/**
 * A9.6: un glow `rect` se dibuja como una mancha rectangular con los cuatro bordes difuminados (textura
 * `ambient_softrect_*` de AmbientLayer): ocupa GLOW_RECT_SPREAD veces el área, centrada, y en cada lado cae a cero en la
 * fracción GLOW_RECT_FADE de la textura (smoothstep, sin escalón). Con 1,4 y 0,25 la meseta a plena luz es el 70 % central
 * del área y la luz llega a media intensidad más o menos en el borde del área y a cero un 20 % por fuera: el área es la
 * pantalla o ventana que emite, y el halo se derrama un poco alrededor. scripts/demo-a9-6-glows.mjs repite los dos valores
 */
export const GLOW_RECT_SPREAD = 1.4;
export const GLOW_RECT_FADE = 0.25;

/** A9.6: opacidad de la textura rectangular difuminada en (u, v) ∈ [0, 1]² (producto de dos smoothstep) */
export function softRectAlpha(u: number, v: number, fade = GLOW_RECT_FADE): number {
  const ss = (e: number) => { const t = Math.min(1, Math.max(0, e / fade)); return t * t * (3 - 2 * t); };
  return ss(Math.min(u, 1 - u)) * ss(Math.min(v, 1 - v));
}

/**
 * Una luz sobre `area`: con `shape` rect, un rectángulo (tubos que titilan; el glow rect va difuminado, A9.6); con
 * ellipse, una mancha radial suave que se desvanece hacia el borde (lámparas, halos), un poco mayor que el área para que
 * lo iluminado sea más o menos el área.
 */
function lightFrame(area: { x: number; y: number; w: number; h: number }, alpha: number, spec: AmbientSpec): AmbientFrame {
  if (spec.shape === 'ellipse') {
    return { ...emptyFrame(), blobs: [{ x: area.x + area.w / 2, y: area.y + area.h / 2, w: area.w * 1.5, h: area.h * 1.5, alpha: Math.min(1, alpha * 1.4), color: spec.color }] };
  }
  if (spec.kind === 'glow') {
    return { ...emptyFrame(), blobs: [{ x: area.x + area.w / 2, y: area.y + area.h / 2, w: area.w * GLOW_RECT_SPREAD, h: area.h * GLOW_RECT_SPREAD, alpha, color: spec.color, rect: true }] };
  }
  return { ...emptyFrame(), shapes: [{ ...area, alpha, color: spec.color, shape: 'rect', stroke: 0 }] };
}

/** glow: alfa que respira en seno entre alphaMin y alpha */
class GlowSim extends BaseSim {
  private ph: number;
  private area: { x: number; y: number; w: number; h: number };
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.ph = this.rng() * TAU;
    this.area = rectPx(g, spec.area!);
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt * Math.max(0.05, this.spec.speed);
    const k = 0.5 + 0.5 * Math.sin(this.ph + (this.t / this.spec.period) * TAU);
    const alpha = this.spec.alphaMin + (this.spec.alpha - this.spec.alphaMin) * k;
    this.frame = lightFrame(this.area, alpha, this.spec);
    return this.frame;
  }
}

/** scan: una línea baja por el área cada `period` ms, con una estela más tenue */
class ScanSim extends BaseSim {
  private area: { x: number; y: number; w: number; h: number };
  private ph: number;
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.area = rectPx(g, spec.area!);
    this.ph = this.rng();
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt * Math.max(0.05, this.spec.speed);
    const a = this.area;
    const u = (this.ph + this.t / this.spec.period) % 1;
    const w = this.spec.size * sizeScale(this.g);
    const y = a.y + u * a.h;
    const lines: Line[] = [{ x1: a.x, y1: y, x2: a.x + a.w, y2: y, alpha: this.spec.alpha, color: this.spec.color, width: w }];
    const y2 = y - w * 2;
    if (y2 > a.y) lines.push({ x1: a.x, y1: y2, x2: a.x + a.w, y2, alpha: this.spec.alpha * 0.4, color: this.spec.color, width: w });
    this.frame = { ...emptyFrame(), lines };
    return this.frame;
  }
}

/** rise: partículas que nacen abajo del área y suben serpenteando hasta arriba, donde se desvanecen; ráfaga opcional */
class RiseSim extends BaseSim {
  private p: Particle[] = [];
  private area: { x: number; y: number; w: number; h: number };
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.area = rectPx(g, spec.area!);
    for (let i = 0; i < spec.count; i++) {
      const q = this.make(false);
      q.life = this.rng() * q.lifeMs; // escalonadas desde el primer frame
      this.p.push(q);
    }
  }
  private make(temp: boolean): Particle {
    const a = this.area;
    const lifeMs = this.between(2500, 4500) / Math.max(0.05, this.spec.speed);
    return {
      x: a.x + this.rng() * a.w, y: a.y + a.h, vx: 0, vy: -a.h / (lifeMs / 1000), ph: this.rng() * TAU, hz: this.between(0.4, 1.1),
      life: 0, lifeMs, size: this.spec.size * sizeScale(this.g) * this.between(0.6, 1.4), temp,
    };
  }
  burst(): boolean {
    if (!this.spec.burst) return false;
    for (let i = 0; i < this.spec.burst; i++) {
      const q = this.make(true);
      q.lifeMs *= 0.5;
      q.vy *= 2;
      this.p.push(q);
    }
    return true;
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt;
    const a = this.area;
    const dots: Dot[] = [];
    const blobs: Blob[] = [];
    this.p = this.p.filter((q) => {
      q.life += dt;
      if (q.life >= q.lifeMs) {
        if (q.temp) return false;
        Object.assign(q, this.make(false));
      }
      const u = q.life / q.lifeMs;
      const y = a.y + a.h - u * a.h;
      const x = q.x + Math.sin(q.ph + u * q.hz * TAU) * q.size * 1.5;
      const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
      const alpha = this.spec.alpha * fade;
      if (this.spec.soft) blobs.push({ x, y, w: q.size * (1 + u), h: q.size * (1 + u), alpha: alpha * 0.8, color: this.spec.color });
      else dots.push({ x, y, r: q.size, alpha, color: this.spec.color });
      return true;
    });
    this.frame = { ...emptyFrame(), dots, blobs };
    return this.frame;
  }
}

/** drip: la gota se forma, cae con gravedad y salpica en floorY; luego espera `period` ms (±30 %) */
class DripSim extends BaseSim {
  private phase: 'wait' | 'fall' | 'splash' = 'wait';
  private left: number;
  private fallT = 0;
  private src: PctPoint;
  private floor: number;
  private readonly G: number;
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.src = px(g, spec.at!);
    this.floor = (spec.floorY! / 100) * g.h;
    this.G = 2000 * sizeScale(g);
    this.left = this.between(200, spec.period);
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt;
    const sp = Math.max(0.05, this.spec.speed);
    const size = this.spec.size * sizeScale(this.g);
    const f = emptyFrame();
    const { color, alpha } = this.spec;
    if (this.phase === 'wait') {
      this.left -= dt * sp;
      const total = this.spec.period;
      const k = Math.max(0, 1 - this.left / (total * 0.5)); // la gota crece en la segunda mitad de la espera
      if (k > 0) f.dots.push({ x: this.src.x, y: this.src.y + size * 0.5 * k, r: size * (0.4 + 0.6 * k), alpha: alpha * (0.5 + 0.5 * k), color });
      if (this.left <= 0) { this.phase = 'fall'; this.fallT = 0; }
    } else if (this.phase === 'fall') {
      this.fallT += (dt / 1000) * sp;
      const y = this.src.y + 0.5 * this.G * this.fallT * this.fallT;
      if (y >= this.floor) { this.phase = 'splash'; this.left = 220; } else {
        f.lines.push({ x1: this.src.x, y1: y - size * 2, x2: this.src.x, y2: y, alpha, color, width: size * 0.8 });
      }
    } else {
      this.left -= dt * sp;
      const k = 1 - Math.max(0, this.left) / 220;
      const w = size * (1 + 5 * k);
      f.shapes.push({ x: this.src.x - w / 2, y: this.floor - w * 0.18, w, h: w * 0.36, alpha: alpha * (1 - k), color, shape: 'ellipse', stroke: Math.max(1, size * 0.4) });
      if (this.left <= 0) { this.phase = 'wait'; this.left = this.spec.period * this.between(0.7, 1.3); }
    }
    this.frame = f;
    return this.frame;
  }
}

/** birds: cada pájaro recorre una elipse del área batiendo las alas (dos trazos en V) */
class BirdsSim extends BaseSim {
  private b: Array<{ cx: number; cy: number; rx: number; ry: number; a: number; w: number; flap: number; hz: number; s: number }> = [];
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    const a = rectPx(g, spec.area!);
    const k = sizeScale(g);
    for (let i = 0; i < spec.count; i++) {
      const rx = a.w * this.between(0.15, 0.35);
      const ry = a.h * this.between(0.2, 0.45);
      this.b.push({
        cx: a.x + rx + this.rng() * Math.max(0, a.w - rx * 2), cy: a.y + ry + this.rng() * Math.max(0, a.h - ry * 2), rx, ry,
        a: this.rng() * TAU, w: this.between(0.25, 0.45) * (this.rng() < 0.5 ? -1 : 1), flap: this.rng() * TAU, hz: this.between(2.5, 4.5), s: spec.size * k * this.between(0.8, 1.2),
      });
    }
  }
  step({ dt }: SimInput): AmbientFrame {
    const s = dt / 1000;
    this.t += dt;
    const lines: Line[] = [];
    const { color, alpha } = this.spec;
    for (const b of this.b) {
      b.a += b.w * this.spec.speed * s;
      const x = b.cx + Math.cos(b.a) * b.rx;
      const y = b.cy + Math.sin(b.a) * b.ry;
      const flap = Math.sin(b.flap + (this.t / 1000) * b.hz * TAU * Math.max(0.2, this.spec.speed));
      const dy = -b.s * 0.3 * flap;
      const width = Math.max(1, b.s * 0.12);
      lines.push({ x1: x - b.s / 2, y1: y + dy, x2: x, y2: y, alpha, color, width });
      lines.push({ x1: x, y1: y, x2: x + b.s / 2, y2: y + dy, alpha, color, width });
    }
    this.frame = { ...emptyFrame(), lines };
    return this.frame;
  }
}

/** sway: el primer plano oscila en horizontal (seno) */
class SwaySim extends BaseSim {
  private ph: number;
  constructor(spec: AmbientSpec, seed: number, g: BgGeom) {
    super(spec, seed, g);
    this.ph = this.rng() * TAU;
  }
  step({ dt }: SimInput): AmbientFrame {
    this.t += dt * Math.max(0.05, this.spec.speed);
    this.frame = { ...emptyFrame(), fgOffset: Math.sin(this.ph + (this.t / this.spec.period) * TAU) * this.spec.amplitude * sizeScale(this.g) };
    return this.frame;
  }
}

/** Simulación de un elemento ya validado. `seed`: lifeSeed de NpcLife (fija con ?qa=1) */
export function createAmbientSim(spec: AmbientSpec, seed: number, g: BgGeom): AmbientSim {
  switch (spec.kind) {
    case 'moths': return new MothsSim(spec, seed, g);
    case 'dust': return new DustSim(spec, seed, g);
    case 'leds': return new LedsSim(spec, seed, g);
    case 'fog': return new DriftSim(spec, seed, g, false);
    case 'clouds': return new DriftSim(spec, seed, g, true);
    case 'flicker': return new FlickerSim(spec, seed, g);
    case 'glow': return new GlowSim(spec, seed, g);
    case 'scan': return new ScanSim(spec, seed, g);
    case 'rise': return new RiseSim(spec, seed, g);
    case 'drip': return new DripSim(spec, seed, g);
    case 'birds': return new BirdsSim(spec, seed, g);
    case 'sway': return new SwaySim(spec, seed, g);
  }
}

/** Semilla de un elemento (como lifeSeed de NpcLife: fija con ?qa=1, mezclada con el id) */
export function ambientSeed(id: string, qa: boolean, random = 0): number {
  const base = qa ? 0x4a43 : Math.floor(random * 0x7fffffff);
  return (hashId(`ambient:${id}`) ^ base) >>> 0;
}

/** Cuántas cosas dibuja un frame */
export function frameCount(f: AmbientFrame): number {
  return f.dots.length + f.blobs.length + f.shapes.length + f.lines.length;
}

/** A4.3 (QA): firma de un frame (hash de todo lo que se dibuja, redondeado): dos frames iguales → misma firma */
export function frameSignature(f: AmbientFrame): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    const v = Math.round(n * 10 ** SIG_ROUND);
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const d of f.dots) { mix(d.x); mix(d.y); mix(d.r); mix(d.alpha); }
  for (const b of f.blobs) { mix(b.x); mix(b.y); mix(b.w); mix(b.h); mix(b.alpha); if (b.rect) mix(1); }
  for (const s of f.shapes) { mix(s.x); mix(s.y); mix(s.w); mix(s.h); mix(s.alpha); mix(s.stroke); }
  for (const l of f.lines) { mix(l.x1); mix(l.y1); mix(l.x2); mix(l.y2); mix(l.alpha); }
  mix(f.fgOffset);
  return h >>> 0;
}

/** A4.3 (QA): un elemento en `state().ambient` */
export interface AmbientQa {
  id: string;
  kind: AmbientKind;
  /** La condición `when` se cumple (o no hay) */
  conditionMet: boolean;
  /** Forzado por el op `ambient` (on | off) o null */
  forced: 'on' | 'off' | null;
  /** Se ve: condición cumplida (o forzado on) y no forzado off */
  active: boolean;
  /** Cosas dibujadas en el último frame y firma de ese frame (cambia cuando algo se mueve) */
  count: number;
  sig: number;
  /** Solo dibuja en una ráfaga (count 0 y burst > 0): en reposo no hay nada que ver */
  burstOnly: boolean;
  /** Frames simulados en la escena y ráfagas lanzadas */
  frames: number;
  bursts: number;
}

/** Estado de un elemento (condición, forzado, contadores) sin nada de Phaser: lo usa AmbientLayer y las pruebas */
export class AmbientElementState {
  readonly sim: AmbientSim;
  forced: 'on' | 'off' | null = null;
  frames = 0;
  bursts = 0;
  conditionMet = true;
  constructor(sim: AmbientSim) {
    this.sim = sim;
  }
  get spec(): AmbientSpec { return this.sim.spec; }
  /** Actualiza la condición y devuelve si el elemento está activo */
  refresh(getFlag: (f: string) => boolean, hasItem: (i: string) => boolean): boolean {
    this.conditionMet = conditionsHold(this.spec.when, getFlag, hasItem);
    return this.active();
  }
  active(): boolean {
    if (this.forced === 'off') return false;
    return this.forced === 'on' || this.conditionMet;
  }
  step(i: SimInput): AmbientFrame {
    this.frames++;
    return this.sim.step(i);
  }
  burst(): boolean {
    const ok = this.sim.burst();
    if (ok) this.bursts++;
    return ok;
  }
  qa(): AmbientQa {
    const f = this.sim.last();
    return {
      id: this.spec.id, kind: this.spec.kind, conditionMet: this.conditionMet, forced: this.forced, active: this.active(),
      count: frameCount(f), sig: frameSignature(f), burstOnly: this.spec.count === 0 && this.spec.burst > 0, frames: this.frames, bursts: this.bursts,
    };
  }
}

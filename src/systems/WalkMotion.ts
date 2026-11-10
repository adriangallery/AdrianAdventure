// A2.12 (plan SCUMM): «walk limpio». Lógica pura, sin Phaser ni imports (se prueba en Node: tests/walk-clean.test.mjs).
//
// 1) Velocidad de avance acorde a la animación (sin patinar). Antes el personaje avanzaba `player.speed` en % del ALTO
//    del fondo por segundo aplicado a distancias en % sin corregir el aspecto: en un fondo de 3712×1152 iba 3,2 veces
//    más rápido en horizontal que en vertical (en píxeles), y a la misma velocidad en pantalla midiera lo que midiera
//    Dex (A2.11 cambió `pixelScale`/`depthScale` por escena). La cadencia de pasos es fija en tiempo (PlayerAnim:
//    WALK_FRAME_MS, STEP_MS), así que en unas escenas patinaba (avanza más de lo que dan los pies) y en otras pisaba
//    sin avanzar. Ahora avanza en PÍXELES DE ARTE por segundo, igual en cualquier dirección: la velocidad en pantalla
//    escala con el tamaño de Dex (unidad de píxel × factor de profundidad) y cada zancada (Footsteps.STRIDE_ART_PX)
//    dura lo mismo en todas las escenas. `player.speed` de la escena (140 = normal) multiplica a la vez el avance y el
//    reloj de la animación: más rápido = pasos más rápidos, la zancada no cambia.
//
// 2) Orden de dibujado por la y de los pies (jugador y NPC): quien tiene los pies más abajo se dibuja delante. Todo
//    queda en la franja [ACTOR_DEPTH_MIN, ACTOR_DEPTH_MAX) = [9, 10), por debajo de los overlays (12), el primer plano
//    (15) y la UI (≥ 45), como antes (NPC 9, jugador 10).
//
// 3) Huella de una NPC en el suelo: rectángulo bajo sus pies que el jugador no pisa (se suma a blockedAreas en la
//    rejilla de navegación) y en el que no puede caer un punto de llegada (tests/walk-clean.test.mjs).

export interface WalkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WalkPoint {
  x: number;
  y: number;
}

/** Avance en píxeles de arte por segundo con `player.speed` = REF_SPEED (≈ 1 zancada de 20 px de arte cada 270 ms) */
export const WALK_ART_PX_PER_S = 74;
/** `player.speed` de referencia (el de casi todas las escenas) */
export const REF_SPEED = 140;
/** Límites del multiplicador de `player.speed` (escenas con valores raros no se disparan) */
const SPEED_MUL_MIN = 0.5;
const SPEED_MUL_MAX = 1.6;
/** Factor de profundidad mínimo que se tiene en cuenta (como Footsteps en Player) */
const MIN_DEPTH = 0.2;

/** Multiplicador de velocidad de la escena: `player.speed` / REF_SPEED, acotado */
export function speedMultiplier(speed: number | null | undefined): number {
  const s = typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : REF_SPEED;
  return Math.min(SPEED_MUL_MAX, Math.max(SPEED_MUL_MIN, s / REF_SPEED));
}

/** Velocidad de avance en píxeles de MUNDO (del fondo) por segundo con esta unidad de píxel y factor de profundidad */
export function walkSpeedWorldPx(pixelScale: number, depth: number, speed?: number | null): number {
  const ps = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const d = Number.isFinite(depth) ? Math.max(MIN_DEPTH, depth) : 1;
  return WALK_ART_PX_PER_S * speedMultiplier(speed) * ps * d;
}

/** Distancia en píxeles de mundo de un desplazamiento en % (dx en % del ancho, dy en % del alto) */
export function pctToWorldPx(dxPct: number, dyPct: number, imgW: number, imgH: number): number {
  return Math.hypot((dxPct / 100) * imgW, (dyPct / 100) * imgH);
}

/**
 * Cuánto avanzar (en %) hacia un objetivo que está a (dxPct, dyPct) con `budgetPx` píxeles de mundo disponibles y sin
 * pasar de `maxPct` % de distancia por tramo. Devuelve el avance en % y los píxeles gastados.
 */
export function stepToward(
  dxPct: number, dyPct: number, budgetPx: number, imgW: number, imgH: number, maxPct = Infinity,
): { movePct: number; usedPx: number } {
  const distPct = Math.hypot(dxPct, dyPct);
  const distPx = pctToWorldPx(dxPct, dyPct, imgW, imgH);
  if (distPct <= 0 || distPx <= 0 || budgetPx <= 0) return { movePct: 0, usedPx: 0 };
  const pxPerPct = distPx / distPct;
  const movePct = Math.min(budgetPx / pxPerPct, maxPct, distPct);
  return { movePct, usedPx: movePct * pxPerPct };
}

/**
 * Avance en píxeles de arte por ciclo de andar (`cycleMs` de animación), con el reloj de animación acelerado por el
 * mismo multiplicador que la velocidad: no depende de la escena ni de la dirección (es lo que comprueba la demo).
 */
export function artPxPerCycle(cycleMs: number): number {
  return (WALK_ART_PX_PER_S * cycleMs) / 1000;
}

// ── Orden de dibujado por la y de los pies ─────────────────

export const ACTOR_DEPTH_MIN = 9;
export const ACTOR_DEPTH_MAX = 10;
/** Desempate: a la misma y, el jugador delante de la NPC */
const PLAYER_TIE = 0.0005;

/** Profundidad (Phaser) de un actor con los pies en `yPct` (% del alto del fondo). Más abajo = delante. */
export function actorDepth(yPct: number, isPlayer = false): number {
  const y = Number.isFinite(yPct) ? Math.min(100, Math.max(0, yPct)) : 100;
  return ACTOR_DEPTH_MIN + (y / 100) * 0.99 + (isPlayer ? PLAYER_TIE : 0);
}

// ── Huella de las NPC ─────────────────────────────────────

/** Medio ancho (en % del ancho del fondo) y alto hacia el fondo / hacia delante (en % del alto) de la huella */
export const NPC_FOOT_HALF_W = 1.6;
export const NPC_FOOT_BACK = 2.5;
export const NPC_FOOT_FRONT = 0.8;

/** Rectángulo (en %) que ocupa en el suelo una NPC con los pies en `p` */
export function npcFootprint(p: WalkPoint): WalkRect {
  return { x: p.x - NPC_FOOT_HALF_W, y: p.y - NPC_FOOT_BACK, w: NPC_FOOT_HALF_W * 2, h: NPC_FOOT_BACK + NPC_FOOT_FRONT };
}

const inside = (p: WalkPoint, r: WalkRect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Obstáculos de la escena para la rejilla: `blockedAreas` más la huella de cada NPC que está sobre la zona caminable
 * (las que están detrás de un mostrador o fuera del suelo no hacen falta y no se añaden).
 */
export function sceneObstacles(
  walkable: WalkRect[] | undefined, blocked: WalkRect[] | undefined, npcs: Array<{ position: WalkPoint }> | undefined,
): WalkRect[] {
  const out = (blocked ?? []).map((r) => ({ ...r }));
  for (const n of npcs ?? []) {
    if (!n?.position) continue;
    if ((walkable ?? []).some((a) => inside(n.position, a))) out.push(npcFootprint(n.position));
  }
  return out;
}

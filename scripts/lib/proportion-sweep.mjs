// A2.17: lógica pura del revisor de proporción y profundidad (scripts/proportion-sweep.mjs, tests/proportion-sweep.test.mjs).
// Todo en % del fondo (las mismas unidades que scene.json). Sin navegador ni disco salvo loadScaleRefs/loadSceneJson.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEX_M = 1.75;
/** Desviación de alto (Dex frente a lo esperado por la referencia) que cuenta como fallo */
export const SCALE_TOL = 0.15;
/** Una referencia solo sirve para medir la escala si su línea de suelo está a menos de esto (en % de alto) de los pies */
export const NEAR_BASE = 10;

export function loadScaleRefs(root, scene) {
  const p = join(root, 'assets/scenes', scene, 'scale-refs.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function loadSceneJson(root, scene) {
  return JSON.parse(readFileSync(join(root, 'assets/scenes', scene, 'scene.json'), 'utf8'));
}

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** walkableAreas menos blockedAreas (rectángulos), como Pathfinding/qa.isWalkable */
export function isWalkableRects(scene, x, y) {
  return (scene.walkableAreas || []).some((r) => inRect(r, x, y)) && !(scene.blockedAreas || []).some((r) => inRect(r, x, y));
}

/** Rejilla de puntos andables: `step` en % (x) y `stepY` (y), centrados en cada celda */
export function gridPoints(scene, step = 8, stepY = 3) {
  const out = [];
  for (const r of scene.walkableAreas || []) {
    const nx = Math.max(1, Math.round(r.w / step));
    const ny = Math.max(1, Math.round(r.h / stepY));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x = round1(r.x + ((i + 0.5) * r.w) / nx);
        const y = round1(r.y + ((j + 0.5) * r.h) / ny);
        if (isWalkableRects(scene, x, y) && !out.some((p) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5)) {
          out.push({ x, y, kind: 'grid', id: `grid-${x}-${y}` });
        }
      }
    }
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

/** Punto andable más cercano a (x, y) entre los rectángulos (para «junto a» una referencia u hotspot sin walkTo) */
export function nearestWalkable(scene, x, y) {
  let best = null;
  for (const r of scene.walkableAreas || []) {
    const px = Math.min(Math.max(x, r.x + 0.5), r.x + r.w - 0.5);
    const py = Math.min(Math.max(y, r.y + 0.5), r.y + r.h - 0.5);
    if (!isWalkableRects(scene, px, py)) continue;
    const d = Math.hypot(px - x, (py - y) * 2);
    if (!best || d < best.d) best = { x: round1(px), y: round1(py), d };
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Puntos del barrido: rejilla + llegada de cada hotspot/NPC (walkTo; si no hay, el andable más cercano a su base, que
 * es donde el juego deja a Dex) + junto a cada referencia (a su izquierda y derecha, a la altura de su base).
 */
export function sweepPoints(scene, refs, { step = 8, stepY = 3 } = {}) {
  const pts = gridPoints(scene, step, stepY);
  const add = (p, kind, id) => {
    if (!p) return;
    pts.push({ x: round1(p.x), y: round1(p.y), kind, id });
  };
  for (const h of scene.regions?.hotspots || []) {
    const b = h.bounds;
    if (h.walkTo) add(h.walkTo, 'arrival', h.id);
    else if (b) add(nearestWalkable(scene, b.x + b.w / 2, b.y + b.h), 'arrival', h.id);
  }
  for (const n of scene.npcs || []) add(n.walkTo || nearestWalkable(scene, n.position.x, n.position.y), 'arrival', n.id);
  for (const r of refs?.refs || []) {
    if (!r.box) continue;
    add(nearestWalkable(scene, r.box.x - 2, r.baseY), 'ref', `${r.id}:izq`);
    add(nearestWalkable(scene, r.box.x + r.box.w + 2, r.baseY), 'ref', `${r.id}:der`);
    add(nearestWalkable(scene, r.box.x + r.box.w / 2, r.baseY - 1), 'ref', `${r.id}:detrás`);
  }
  return pts;
}

/** Alto esperado de Dex (en % del fondo) con los pies en la línea de suelo de la referencia */
export function expectedDexPct(ref, refHeightPct = ref.box?.h, dexM = DEX_M) {
  if (!refHeightPct || !ref.realHeightM) return null;
  return (refHeightPct * dexM) / ref.realHeightM;
}

/** Referencia con la línea de suelo más cercana a los pies (solo las de alto conocido); null si ninguna está a < NEAR_BASE */
export function nearestRef(refs, feetY, feetX = null) {
  let best = null;
  for (const r of refs) {
    const h = r.heightPct ?? r.box?.h;
    if (!h || !r.realHeightM) continue;
    const dy = Math.abs(r.baseY - feetY);
    const dx = feetX == null || !r.box ? 0 : Math.max(0, Math.abs(feetX - (r.box.x + r.box.w / 2)) - r.box.w / 2);
    const score = dy + dx * 0.05;
    if (!best || score < best.score) best = { ref: r, dy, score };
  }
  return best && best.dy <= NEAR_BASE ? best : null;
}

export const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Evalúa una posición medida. `m` = { x, y (pies pedidos), feetX, feetY (reales), box ({x,y,w,h} de Dex en %),
 * heightPct, walkable (qa.isWalkable en los pies), maskOk (walkmask azul en los pies; null si no hay walkmask),
 * cover: { [refId]: fracción de la caja de Dex ∩ ref tapada por foreground.png (0..1) } }.
 * Devuelve { failures: [{ type, ref?, dev?, msg }], info: [...], score }.
 *   scale     — alto de Dex frente al esperado (> SCALE_TOL); con scalePolicy fixed va a info
 *   feet      — los pies no quedan en suelo andable (qa.isWalkable); fuera de la walkmask = info (el juego no la usa)
 *   occlusion — objeto de primer plano que debería tapar a Dex (pies por encima de su base y solape) y no le tapa
 *   overdraw  — algo del foreground le tapa estando Dex delante (pies por debajo de la base)
 */
export function evaluatePosition(m, refsDoc, npcRefs = []) {
  const failures = [];
  const info = [];
  const refs = [...(refsDoc?.refs || []).filter((r) => !r.npc), ...npcRefs];
  const fixed = refsDoc?.scalePolicy === 'fixed';
  // Solo cuentan para fallar las referencias medidas a ojo (measured !== false) y las NPC; las demás, informativas
  const near = nearestRef(refs.filter((r) => r.measured !== false), m.feetY, m.feetX);
  const rough = nearestRef(refs.filter((r) => r.measured === false), m.feetY, m.feetX);
  if (rough) {
    const exp = expectedDexPct(rough.ref, rough.ref.box.h);
    const dev = m.heightPct / exp - 1;
    if (Math.abs(dev) > SCALE_TOL) info.push({ type: 'scale-rough', ref: rough.ref.id, dev: r2(dev), msg: `Dex ${pc(dev)} frente a ${rough.ref.label} (caja sin medir: bounds del hotspot)` });
  }
  let scale = null;
  if (near) {
    const exp = expectedDexPct(near.ref, near.ref.heightPct ?? near.ref.box.h);
    const dev = m.heightPct / exp - 1;
    scale = { ref: near.ref.id, expected: r2(exp), got: r2(m.heightPct), dev: r2(dev), baseDy: r2(near.dy) };
    if (Math.abs(dev) > SCALE_TOL) {
      const f = { type: 'scale', ref: near.ref.id, dev: r2(dev), msg: `Dex ${pc(dev)} frente a ${near.ref.label} (${r2(m.heightPct)} % y se esperaba ${r2(exp)} %)` };
      (fixed ? info : failures).push(fixed ? { ...f, informative: 'scalePolicy fixed' } : f);
    }
  } else info.push({ type: 'scale-noref', msg: 'ninguna referencia con la base a menos de 10 % de los pies' });
  if (m.walkable === false) failures.push({ type: 'feet', msg: `pies fuera de la zona andable (${r2(m.feetX)}, ${r2(m.feetY)})` });
  // walkmask.png no la usa el juego (manda walkableAreas) y en varias escenas está desfasada: solo informativo
  else if (m.maskOk === false) info.push({ type: 'walkmask', msg: `pies fuera del azul de la walkmask (${r2(m.feetX)}, ${r2(m.feetY)})` });
  if (Math.abs(m.feetY - m.y) > 1.5 || Math.abs(m.feetX - m.x) > 1.5) {
    info.push({ type: 'moved', msg: `el juego movió los pies de (${m.x}, ${m.y}) a (${r2(m.feetX)}, ${r2(m.feetY)})` });
  }
  for (const r of refsDoc?.refs || []) {
    if (!r.box || r.npc) continue;
    const ov = overlap(m.box, r.box);
    if (!ov) continue;
    const frac = ov / (m.box.w * m.box.h);
    if (frac < 0.03) continue;
    const covered = m.cover?.[r.id] ?? 0;
    const behind = m.feetY < r.baseY;
    if (r.foreground && behind && occludes(covered, m.coverMax?.[r.id]) === false) {
      failures.push({ type: 'occlusion', ref: r.id, dev: r2(frac), msg: `pies por detrás de la base de ${r.label} (${r2(m.feetY)} < ${r.baseY}) y no le tapa (tapado ${pc(covered)}${m.coverMax?.[r.id] != null ? ` de ${pc(m.coverMax[r.id])} posible` : ''})` });
    } else if (!behind && covered >= 0.5) {
      failures.push({ type: 'overdraw', ref: r.id, dev: r2(covered), msg: `Dex está delante de ${r.label} (pies ${r2(m.feetY)} ≥ ${r.baseY}) y el primer plano le tapa (${pc(covered)})` });
    } else if (!r.foreground && behind && frac > 0.15) {
      info.push({ type: 'behind', ref: r.id, msg: `pies por detrás de ${r.label} y se solapan (${pc(frac)}): ¿debería taparle?` });
    }
  }
  const score = failures.reduce((s, f) => s + (f.type === 'scale' ? Math.abs(f.dev) * 2 : f.type === 'feet' ? 1.5 : 1 + (f.dev || 0)), 0);
  return { scale, failures, info, score: r2(score) };
}

/**
 * A2.17 fase 3: ¿le tapa lo bastante? `covered` = fracción de la caja común Dex ∩ referencia tapada por el primer plano
 * (lo que se dibuja por encima de Dex); `possible` = fracción de esa misma caja con píxeles opacos del primer plano,
 * estén delante o detrás de Dex (lo que la referencia PUEDE tapar: una roca con hueco o un arbusto ralo no cubre la caja
 * entera). Con `possible` el umbral es relativo: falla si tapa menos de la mitad de lo que podría. Sin él (medidas
 * antiguas) se usa el absoluto de la fase 1 (50 % de la caja). Si la referencia apenas tiene píxeles en la caja común
 * (< OCCLUSION_MIN_POSSIBLE) no hay nada que juzgar: null.
 */
export const OCCLUSION_MIN_POSSIBLE = 0.05;
export function occludes(covered, possible) {
  if (possible == null) return covered >= 0.5;
  if (possible < OCCLUSION_MIN_POSSIBLE) return null;
  return covered >= 0.5 * possible;
}

const r2 = (v) => Math.round(v * 100) / 100;
const pc = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`;

/** Clave estable de un fallo (para la base de fallos conocidos): escena|tipo|ref|punto */
export const failureKey = (scene, pos, f) => `${scene}|${f.type}|${f.ref || '-'}|${pos.kind}:${pos.id}`;

/** Fallos nuevos frente a la base (`baseline.known` = lista de claves) */
export function newFailures(results, baseline) {
  const known = new Set(baseline?.known || []);
  const out = [];
  for (const r of results) for (const p of r.positions) for (const f of p.failures) {
    const k = failureKey(r.scene, p, f);
    if (!known.has(k)) out.push(k);
  }
  return out;
}

/** Resumen por escena: n.º de posiciones, fallos por tipo y peores (por score) */
export function summarize(scene, positions, worstN = 12) {
  const byType = {};
  for (const p of positions) for (const f of p.failures) byType[f.type] = (byType[f.type] || 0) + 1;
  const worst = positions.filter((p) => p.failures.length).sort((a, b) => b.score - a.score).slice(0, worstN);
  return { scene, positions: positions.length, failing: positions.filter((p) => p.failures.length).length, byType, worst: worst.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, score: p.score, failures: p.failures.map((f) => f.msg) })) };
}

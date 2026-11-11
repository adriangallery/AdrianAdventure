// A2.11 (plan SCUMM): proporción de Dex al estilo SCUMM. Lógica pura (sin Phaser ni navegador) que comparten la demo
// `scripts/demo-a2-11-proportion.mjs`, la tabla analítica `node scripts/lib/proportion.mjs table` y los tests
// (tests/proportion.test.mjs). Repite las fórmulas de src/systems/PixelScale.ts (resolvePixelScale, depthFactor,
// artHeightPct): los scripts corren en Node sin type stripping; tests/proportion.test.mjs comprueba que coinciden.
//
// Umbrales (Monkey Island 1-2, Day of the Tentacle, Thimbleweed Park):
//   - junto a la puerta de referencia Dex mide el 85-100 % de su alto; se acepta 80-105 % (DOOR_RANGE) porque el alto
//     de la puerta se ha medido a ojo sobre el fondo (rejilla del 10 %, error ±1-2 % del fondo ≈ ±3-5 % del cociente);
//   - escenas sin puerta: un mueble con su cociente esperado (Dex/mueble) declarado en qa/proportion-refs.json;
//   - NPC a la misma profundidad: misma escala ±10 % (NPC_TOL);
//   - dos sitios a la misma profundidad visual (misma y, x distinta; o escenas de un mismo grupo en su plano delantero):
//     ≤ 20 % de diferencia (SAME_DEPTH_TOL).
// Las alturas son «del mundo» (% del fondo, sin el redondeo a entero de la pantalla de A2.8): el redondeo cambia el
// tamaño en pantalla hasta un 20 % según el viewport y no es una decisión de la escena.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAYER_ART_H = 103;
export const DEFAULT_PIXEL_SCALE = 5.5;
export const DOOR_RANGE = [0.8, 1.05];
export const NPC_TOL = 0.1;
export const SAME_DEPTH_TOL = 0.2;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validPS = (v) => isNum(v) && v >= 1 && v <= 12;

/** = PixelScale.resolvePixelScale */
export function resolvePixelScale(scene, global) {
  return [scene?.pixelScale, scene?.player?.playerScale, global?.pixelScale, global?.playerScale].find(validPS) ?? DEFAULT_PIXEL_SCALE;
}

/** = PixelScale.depthFactor (sin validar rangos: el linter ya lo hace) */
export function depthFactor(d, yPct) {
  if (!d || !['yTop', 'yBottom', 'scaleTop', 'scaleBottom'].every((k) => isNum(d[k])) || !(d.yTop < d.yBottom)) return 1;
  const t = Math.min(1, Math.max(0, (yPct - d.yTop) / (d.yBottom - d.yTop)));
  return d.scaleTop + (d.scaleBottom - d.scaleTop) * t;
}

/** Alto del mundo (en % del fondo) de un sprite de `artH` píxeles de arte con los pies en `yPct`. */
export function heightPct(scene, global, yPct, artH = PLAYER_ART_H, artScale = 1) {
  // El alto real de background.png (loadScene lo apunta en `_imgH`): render.world no es fiable (server_room y
  // treatment_room dicen 1024/1536 y el fondo mide 1152)
  const imgH = scene?._imgH || scene?.render?.world?.height || 1152;
  return (artH * resolvePixelScale(scene, global) * artScale * depthFactor(scene?.depthScale, yPct) / imgH) * 100;
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * A2.13: cambio máximo de tamaño por profundidad entre el punto más cercano y el más lejano (min/max ≥ 1 − 0,25).
 * Lo repite scripts/lint-scenes.mjs (regla l); tests/proportion.test.mjs comprueba que coinciden.
 */
export const MAX_DEPTH_CHANGE = 0.25;

/** A2.13: cambio relativo de tamaño de un depthScale (0 = escala fija; sin depthScale o inválido, 0). */
export function depthChange(d) {
  if (!d || !['yTop', 'yBottom', 'scaleTop', 'scaleBottom'].every((k) => isNum(d[k])) || !(d.yTop < d.yBottom)) return 0;
  const lo = Math.min(d.scaleTop, d.scaleBottom), hi = Math.max(d.scaleTop, d.scaleBottom);
  return hi > 0 ? 1 - lo / hi : 0;
}

/**
 * A2.13: el modo de escala declarado en qa/proportion-refs.json (`scale`: fixed | variable) frente al scene.json.
 * fixed = sin cambio de tamaño en toda la zona andable; variable = depthScale con un cambio ≤ MAX_DEPTH_CHANGE.
 */
export function scaleModeProblems(ref, scene) {
  const out = [];
  const ch = depthChange(scene?.depthScale);
  if (ref.scale !== 'fixed' && ref.scale !== 'variable') out.push(`${ref.scene}: falta scale (fixed | variable) en qa/proportion-refs.json`);
  if (ref.scale === 'fixed' && ch > 1e-9) out.push(`${ref.scene}: declarada de escala fija y su depthScale cambia el tamaño un ${Math.round(ch * 100)} %`);
  if (ref.scale === 'variable' && !(ch > 1e-9)) out.push(`${ref.scene}: declarada variable y no tiene depthScale que cambie el tamaño (¿fixed?)`);
  if (ch > MAX_DEPTH_CHANGE + 1e-9) out.push(`${ref.scene}: el depthScale cambia el tamaño un ${Math.round(ch * 100)} % (máximo ${MAX_DEPTH_CHANGE * 100} %: min/max ≥ ${1 - MAX_DEPTH_CHANGE})`);
  return out;
}

/**
 * Mide una escena con su referencia de qa/proportion-refs.json. `measure(y)` da el alto de Dex (% del fondo) con los
 * pies en y; por defecto, el analítico. Devuelve { row, problems }.
 */
export function evaluateScene(ref, scene, global, measure = (y) => heightPct(scene, global, y), npcMeasures = null) {
  const problems = [];
  const row = { scene: ref.scene, pixelScale: resolvePixelScale(scene, global), depthScale: scene?.depthScale ?? null };
  const at = {};
  for (const [k, p] of Object.entries(ref.positions || {})) at[k] = r2(measure(p.y, p.x, k));
  row.dex = at;
  // Alto de la zona jugable: del techo de la zona andable al suelo del fondo; «plano medio» = la posición mid
  const walkTop = Math.min(...(scene?.walkableAreas || [{ y: 0 }]).map((a) => a.y));
  row.walkTop = walkTop;
  if (isNum(at.mid)) row.midOverHeight = r2(at.mid / 100);
  if (ref.reference) {
    const h = ref.reference.bottom - ref.reference.top;
    row.refHeight = r2(h);
    const dexAtRef = at.ref ?? at.front;
    row.ratio = r2(dexAtRef / h);
    const [lo, hi] = ref.reference.kind === 'door' ? DOOR_RANGE : ref.reference.expected;
    row.range = [lo, hi];
    if (!ref.exception && !(row.ratio >= lo && row.ratio <= hi)) {
      problems.push(`${ref.scene}: Dex/${ref.reference.label} = ${row.ratio} fuera de ${lo}-${hi} (Dex ${dexAtRef} %, ${ref.reference.label} ${r2(h)} %)`);
    }
  }
  // Misma profundidad: pares a la misma y y distinta x
  for (const [a, b] of ref.sameDepth || []) {
    const ha = at[a], hb = at[b];
    if (isNum(ha) && isNum(hb) && Math.abs(ha - hb) / Math.max(ha, hb) > SAME_DEPTH_TOL) {
      problems.push(`${ref.scene}: ${a} (${ha} %) y ${b} (${hb} %) a la misma profundidad difieren más de un ${SAME_DEPTH_TOL * 100} %`);
    }
  }
  // NPC: misma escala que Dex a su misma y (±10 %)
  row.npcs = [];
  for (const n of scene?.npcs || []) {
    const want = (resolvePixelScale(scene, global) * (n.artScale ?? 1) * depthFactor(scene?.depthScale, n.position?.y ?? 100));
    const got = npcMeasures?.[n.id] ?? want;
    const dexScale = resolvePixelScale(scene, global) * depthFactor(scene?.depthScale, n.position?.y ?? 100);
    const rel = got / (dexScale * (n.artScale ?? 1));
    row.npcs.push({ id: n.id, y: n.position?.y, rel: r2(rel) });
    if (Math.abs(rel - 1) > NPC_TOL) problems.push(`${ref.scene}: ${n.id} a ${r2(rel)}× la escala de Dex a su misma profundidad (±${NPC_TOL * 100} %)`);
  }
  // A2.13: escala fija o cambio ≤ 25 %; en las fijas, todas las posiciones miden lo mismo
  row.scale = ref.scale ?? null;
  row.depthChange = r2(depthChange(scene?.depthScale));
  if (ref.scale) problems.push(...scaleModeProblems(ref, scene));
  if (ref.scale === 'fixed') {
    const hs = Object.values(at).filter(isNum);
    if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 0.01) problems.push(`${ref.scene}: escala fija y Dex mide de ${Math.min(...hs)} % a ${Math.max(...hs)} % según dónde esté`);
  }
  if (ref.exception) row.exception = ref.exception;
  return { row, problems };
}

/** Grupos de escenas contiguas (misma casa, mismo edificio): el plano delantero (front) no difiere más de un 20 %. */
export function groupProblems(groups, rows) {
  const out = [];
  for (const g of groups || []) {
    const hs = g.scenes.map((s) => [s, rows.find((r) => r.scene === s)?.dex?.front]).filter(([, h]) => isNum(h));
    const max = Math.max(...hs.map(([, h]) => h)), min = Math.min(...hs.map(([, h]) => h));
    if (hs.length > 1 && (max - min) / max > SAME_DEPTH_TOL) {
      out.push(`grupo ${g.name}: Dex delante va de ${r2(min)} % a ${r2(max)} % (> ${SAME_DEPTH_TOL * 100} %): ${hs.map(([s, h]) => `${s} ${h}`).join(', ')}`);
    }
  }
  return out;
}

const fmtDepth = (d) => (d ? `${d.yTop}–${d.yBottom}: ${d.scaleTop}–${d.scaleBottom}` : '—');

/** Tabla markdown antes/después (filas de evaluateScene). */
export function markdownTable(before, after) {
  const lines = [
    '| escena | pixelScale antes → después | depthScale antes → después | Dex delante (% fondo) | referencia (alto %) | Dex/ref antes → después | rango | estado |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const a of after) {
    const b = before.find((x) => x.scene === a.scene) || {};
    const ok = a.exception ? 'excepción' : a.ratio >= a.range?.[0] && a.ratio <= a.range?.[1] ? 'ok' : 'FUERA';
    lines.push(`| ${a.scene} | ${b.pixelScale ?? '?'} → ${a.pixelScale} | ${fmtDepth(b.depthScale)} → ${fmtDepth(a.depthScale)} | ${b.dex?.front ?? '?'} → ${a.dex?.front} | ${a.refLabel ?? ''} (${a.refHeight ?? '—'}) | ${b.ratio ?? '—'} → ${a.ratio ?? '—'} | ${a.range ? a.range.join('–') : '—'} | ${ok} |`);
  }
  return lines.join('\n');
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadRefs(root = ROOT) {
  return JSON.parse(readFileSync(resolve(root, 'qa/proportion-refs.json'), 'utf8'));
}

/** Alto de un PNG (cabecera IHDR: bytes 20-23), o null. */
export function pngHeight(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return buf.readUInt32BE(20);
}

/** scene.json de la escena (del árbol de trabajo o, con `rev`, de ese commit) con `_imgH` = alto real del fondo. */
export function loadScene(id, { root = ROOT, rev = null } = {}) {
  const rel = `assets/scenes/${id}/scene.json`;
  let scene;
  if (!rev) scene = existsSync(resolve(root, rel)) ? JSON.parse(readFileSync(resolve(root, rel), 'utf8')) : null;
  else scene = JSON.parse(execFileSync('git', ['-C', root, 'show', `${rev}:${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
  const bg = resolve(root, `assets/scenes/${id}/${scene?.assets?.background || 'background.png'}`);
  if (scene && existsSync(bg)) {
    const h = pngHeight(readFileSync(bg).subarray(0, 32));
    if (h) scene._imgH = h;
  }
  return scene;
}

export function loadGlobal({ root = ROOT, rev = null } = {}) {
  const rel = 'assets/config/global.json';
  if (!rev) return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
  return JSON.parse(execFileSync('git', ['-C', root, 'show', `${rev}:${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
}

/** Evalúa todas las escenas de refs (analítico). */
export function evaluateAll(refs, { rev = null, root = ROOT } = {}) {
  const global = loadGlobal({ root, rev });
  const rows = [];
  const problems = [];
  for (const ref of refs.scenes) {
    const scene = loadScene(ref.scene, { root, rev });
    const { row, problems: p } = evaluateScene(ref, scene, global);
    row.refLabel = ref.reference?.label;
    rows.push(row);
    problems.push(...p);
  }
  problems.push(...groupProblems(refs.groups, rows));
  return { rows, problems };
}

// CLI: node scripts/lib/proportion.mjs table [rev-antes]  → tabla antes (rev, por defecto origin/main) / después (árbol)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, rev = 'origin/main'] = process.argv.slice(2);
  if (cmd === 'table') {
    const refs = loadRefs();
    const before = evaluateAll(refs, { rev });
    const after = evaluateAll(refs);
    console.log(markdownTable(before.rows, after.rows));
    console.log(`\nAntes (${rev}): ${before.problems.length} problemas${before.problems.length ? `\n- ${before.problems.join('\n- ')}` : ''}`);
    console.log(`Después: ${after.problems.length} problemas${after.problems.length ? `\n- ${after.problems.join('\n- ')}` : ''}`);
    process.exit(after.problems.length ? 1 : 0);
  } else {
    console.error('uso: node scripts/lib/proportion.mjs table [rev-antes]');
    process.exit(2);
  }
}

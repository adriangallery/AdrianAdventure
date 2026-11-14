// A9.16 (plan SCUMM): comprobaciones de píxel de los overlays condicionales contra el fondo de su escena, y el
// manifiesto de hashes (qa/overlays.lock.json). Node puro: lo usa scripts/crop-overlays.mjs --check (que
// decodifica con sharp) y lo prueban tests/overlay-crop.test.mjs y tests/vane-overlay.test.mjs.
import { createHash } from 'node:crypto';

/** Diferencia «casi igual»: 0 < max(|ΔR|,|ΔG|,|ΔB|) ≤ NEAR_DELTA. Ni el ojo ni el overlay la necesitan: si es una zona
 *  grande, se ve como una mancha de otro tono (la veleta de A9.12 llevaba cielo del espejo alrededor de la B). */
export const NEAR_DELTA = 12;
/** Tope de píxeles opacos casi iguales al fondo: falla si se pasan los DOS (cuenta y fracción de los opacos). La veleta
 *  de A9.12 daba 6556 px y 13,1 %; la de A9.16, 4910 px y 10,4 % (el halo del JPEG que se borra alrededor de la B y la
 *  flecha viejas: cambia poco, pero hace falta). El margen es corto (recovery_pool/door_closed da 12,0 %): es un tope
 *  grueso; la garantía fina de la veleta es tests/vane-overlay.test.mjs. Los demás overlays de hoy quedan por debajo
 *  salvo los anotados como aviso en el manifiesto. */
export const NEAR_MAX_PX = 2500;
export const NEAR_MAX_FRACTION = 0.125;

/**
 * Cuenta los píxeles opacos (alfa ≥ 250) de un overlay RGBA (`ov`, ow×oh) colocado en (left, top) de un fondo RGB/RGBA
 * (`bg`, bw de ancho, `bch` canales) según cuánto difieren: `equal` (idénticos: no hacen nada), `near` (casi iguales),
 * `far` (los que se ven). `semi` = alfa entre 5 y 249.
 */
export function overlayVsBackground(ov, ow, oh, bg, bw, bch, left, top, { near = NEAR_DELTA } = {}) {
  let opaque = 0, equal = 0, nearN = 0, far = 0, semi = 0;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const o = (y * ow + x) * 4;
      const a = ov[o + 3];
      if (a <= 4) continue;
      if (a < 250) { semi++; continue; }
      opaque++;
      const b = ((top + y) * bw + (left + x)) * bch;
      const d = Math.max(Math.abs(ov[o] - bg[b]), Math.abs(ov[o + 1] - bg[b + 1]), Math.abs(ov[o + 2] - bg[b + 2]));
      if (d === 0) equal++;
      else if (d <= near) nearN++;
      else far++;
    }
  }
  return { opaque, equal, near: nearN, far, semi };
}

/** ¿Defecto «mancha casi igual al fondo»? (regla de A9.16) */
export const isNearPatchDefect = (s) => s.near > NEAR_MAX_PX && s.near / Math.max(1, s.opaque) > NEAR_MAX_FRACTION;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Compara el manifiesto con los hashes actuales. `current` = { '<escena>/<overlay>': { background, overlay } }.
 * Devuelve la lista de problemas (vacía si todo cuadra).
 */
export function lockProblems(lock, current) {
  const problems = [];
  const entries = lock?.overlays ?? {};
  for (const [key, cur] of Object.entries(current)) {
    const e = entries[key];
    if (!e) { problems.push(`${key}: no está en qa/overlays.lock.json (revísalo sobre su fondo y node scripts/crop-overlays.mjs --update-lock)`); continue; }
    if (e.background !== cur.background) problems.push(`${key}: el fondo de la escena cambió desde que se validó el overlay (hash ${String(e.background).slice(0, 12)}… → ${cur.background.slice(0, 12)}…): regenéralo o revísalo encima del fondo nuevo y node scripts/crop-overlays.mjs --update-lock`);
    if (e.overlay !== cur.overlay) problems.push(`${key}: el overlay cambió sin revalidar (hash ${String(e.overlay).slice(0, 12)}… → ${cur.overlay.slice(0, 12)}…): node scripts/crop-overlays.mjs --update-lock`);
  }
  for (const key of Object.keys(entries)) if (!(key in current)) problems.push(`${key}: está en overlays.lock.json y ya no existe (node scripts/crop-overlays.mjs --update-lock)`);
  return problems;
}

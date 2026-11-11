// A5.2 (plan SCUMM): QA móvil. Lógica pura de la auditoría de legibilidad y áreas táctiles (sin navegador).
//
// La demo `scripts/demo-a5-2-mobile.mjs` mide en Chrome (viewport de iPhone, táctil, DPR 3) los textos y los
// elementos interactivos de la interfaz (lienzo de Phaser y paneles HTML) y pasa aquí lo medido, en píxeles CSS:
//   texts:   [{ id, text, px }]                     tamaño de fuente efectivo (fontSize × escala × zoom × lienzo/CSS)
//   targets: [{ id, label, w, h }]                  zona táctil efectiva (hitArea o caja) en px CSS
// `auditSnapshot` devuelve lo que incumple los umbrales, quitando lo que cubre la lista blanca justificada
// (`EXCEPTIONS`, ver docs/progreso/A5.2.md). Los tests están en tests/mobile-audit.test.mjs.

/** Umbrales: fuente mínima de interfaz y lado mínimo de una zona táctil (objetivo 44, guía de Apple). */
export const THRESHOLDS = Object.freeze({ minFontPx: 11, minTouchPx: 40, goalTouchPx: 44 });

/** Viewports de iPhone (14/15: 390×844 CSS, DPR 3) en vertical y horizontal, táctiles. */
export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const VIEWPORTS = Object.freeze({
  portrait: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
  landscape: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
});

/**
 * Excepciones documentadas: `{ kind: 'font'|'touch', match: RegExp sobre el id, orientation?: 'portrait'|'landscape',
 * min?: valor mínimo que se tolera, reason }`. Una excepción sin `reason` no vale.
 */
export const EXCEPTIONS = Object.freeze([
  {
    kind: 'touch',
    match: /^UIScene:Text:(Give|Pick up|Use|Open|Look at|Push|Close|Talk to|Pull)$/,
    orientation: 'landscape',
    min: 26,
    reason: 'Rejilla SCUMM de 9 verbos en 844×390: filas de 28 px (el panel ya ocupa el 31 % del alto; 3 filas de 40 px '
      + 'lo llevarían al 40 %). Cada verbo se toca en su celda entera (76-130 px de ancho, sin huecos entre filas). '
      + 'En vertical sí llegan a 44 px.',
  },
  {
    kind: 'touch',
    match: /^UIScene:Text:[▲▼]$/,
    min: 24,
    reason: 'Flechas del inventario: el hueco entre la rejilla de verbos y las casillas mide 26-28 px de ancho en un '
      + 'iPhone; la zona táctil ocupa todo ese hueco y media columna de alto (42-66 px). Solo se usan con más de '
      + '4 objetos (2 en vertical).',
  },
]);

/** ¿Es un texto de letras/números (se exige tamaño mínimo) o un icono (flechas, emojis, «×»)? */
export function isWordText(text) {
  return /[\p{L}\p{N}]{2,}/u.test(String(text ?? ''));
}

/** Excepción que cubre este incumplimiento, o null. */
export function findException(kind, item, orientation, exceptions = EXCEPTIONS) {
  for (const ex of exceptions) {
    if (!ex || ex.kind !== kind || !ex.reason) continue;
    if (ex.orientation && ex.orientation !== orientation) continue;
    if (!(ex.match instanceof RegExp ? ex.match : new RegExp(ex.match)).test(item.id)) continue;
    const value = kind === 'font' ? item.px : Math.min(item.w, item.h);
    if (ex.min !== undefined && value < ex.min) continue;
    return ex;
  }
  return null;
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * Audita una captura: `{ texts, targets }` medidos en una escena y orientación.
 * Devuelve `{ fontFails, touchFails, touchBelowGoal, excepted, minFont, minTouch, counts }`.
 */
export function auditSnapshot(snap, { orientation, thresholds = THRESHOLDS, exceptions = EXCEPTIONS } = {}) {
  const fontFails = [];
  const touchFails = [];
  const touchBelowGoal = [];
  const excepted = [];
  let minFont = Infinity;
  let minTouch = Infinity;
  const texts = (snap?.texts ?? []).filter((t) => isWordText(t.text) && t.px > 0);
  for (const t of texts) {
    minFont = Math.min(minFont, t.px);
    if (t.px + 1e-6 >= thresholds.minFontPx) continue;
    const ex = findException('font', t, orientation, exceptions);
    const row = { id: t.id, text: String(t.text).slice(0, 40), px: round(t.px) };
    if (ex) excepted.push({ kind: 'font', ...row, reason: ex.reason });
    else fontFails.push(row);
  }
  const targets = (snap?.targets ?? []).filter((t) => t.w > 0 && t.h > 0);
  for (const t of targets) {
    const side = Math.min(t.w, t.h);
    minTouch = Math.min(minTouch, side);
    const row = { id: t.id, label: t.label ?? '', w: round(t.w), h: round(t.h) };
    if (side + 1e-6 < thresholds.minTouchPx) {
      const ex = findException('touch', t, orientation, exceptions);
      if (ex) excepted.push({ kind: 'touch', ...row, reason: ex.reason });
      else touchFails.push(row);
    } else if (side + 1e-6 < thresholds.goalTouchPx) touchBelowGoal.push(row);
  }
  return {
    fontFails,
    touchFails,
    touchBelowGoal,
    excepted,
    minFont: Number.isFinite(minFont) ? round(minFont) : null,
    minTouch: Number.isFinite(minTouch) ? round(minTouch) : null,
    counts: { texts: texts.length, targets: targets.length },
  };
}

/** ¿Algún elemento de la interfaz se sale del viewport? `boxes`: [{ id, x, y, w, h }] en px CSS; tolerancia 1 px. */
export function offscreen(boxes, viewport, tol = 1) {
  return (boxes ?? []).filter((b) => b.w > 0 && b.h > 0
    && (b.x < -tol || b.y < -tol || b.x + b.w > viewport.width + tol || b.y + b.h > viewport.height + tol))
    .map((b) => ({ id: b.id, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }));
}

/** Fila de la tabla del informe para una escena y orientación. */
export function summarizeRow(scene, orientation, audit, extra = {}) {
  const ok = audit.fontFails.length === 0 && audit.touchFails.length === 0 && !(extra.offscreen?.length);
  return {
    scene,
    orientation,
    ok,
    minFont: audit.minFont,
    minTouch: audit.minTouch,
    fontFails: audit.fontFails.length,
    touchFails: audit.touchFails.length,
    belowGoal: audit.touchBelowGoal.length,
    excepted: audit.excepted.length,
    offscreen: extra.offscreen?.length ?? 0,
  };
}

/** Pasos del capítulo 1 de la ruta crítica: desde New Game hasta el primero que acaba en `untilScene` (incluido). */
export function chapterSteps(route, untilScene = 'lobby') {
  const out = [];
  for (const s of route?.steps ?? []) {
    // Sin esperas largas a propósito (holdTextMs de 35 s del watchdog): aquí solo interesa la interfaz
    const step = { ...s };
    delete step.holdTextMs;
    out.push(step);
    if (s.expect?.scene === untilScene) return out;
  }
  throw new Error(`la ruta ${route?.id ?? '?'} no llega a «${untilScene}»`);
}

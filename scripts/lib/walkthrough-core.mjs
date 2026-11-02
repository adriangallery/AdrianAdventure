// A0.5 (plan SCUMM): lógica pura del runner de walkthrough (scripts/walkthrough.mjs), sin navegador ni disco,
// para poder probarla con `node --test` (tests/walkthrough-core.test.mjs). Aquí viven las reglas de definición
// de las rutas (routeDefects), las comprobaciones de estado (check, rejects), la clasificación del resultado
// (classify) y el veredicto del selftest (selftestMismatch).

export const STATUSES = ['pass', 'fail', 'xfail', 'xpass', 'error'];

export function describe(s) {
  switch (s.do) {
    case 'act': return `${s.verb} ${s.target}${s.holdTextMs ? ` (texto ${s.holdTextMs / 1000} s)` : ''}`;
    case 'use': return `USE ${s.item} → ${s.target}`;
    case 'combine': return `USE ${s.items.join(' + ')}`;
    case 'talk': return `TALK ${s.npc}${s.choices?.length ? ` [${s.choices.join(' / ')}]` : ''}`;
    case 'walk': return `WALK ${s.x},${s.y}${s.trigger ? ` (${s.trigger})` : ''}${s.untilScene ? ` → ${s.untilScene}` : ''}`;
    case 'goto': return `GOTO ${s.scene}`;
    case 'wait': return `WAIT ${s.ms} ms`;
    case 'resize': return `RESIZE ${s.width}x${s.height}`;
    default: return s.do;
  }
}

/**
 * Comprobaciones de estado: scene, has, lacks, flags, unsetFlags, visited, achievements, (A2.6) lastChoices, (A2.2) facing y (A1.10) noListenerGrowth, que
 * compara `st.resizeListeners` con `ctx.listenersBaseline` (lo que había tras el primer paso de la ruta). `flags` trata
 * una flag ausente como false; (A1.4) `unsetFlags` exige que la flag no esté en la partida, ni a false: nadie la ha
 * escrito (p. ej. un parpadeo que antes se hacía encendiendo y apagando la flag). Devuelve los fallos.
 */
export function check(expect, st, ctx = {}) {
  if (!expect) return [];
  if (!st) return ['sin estado del juego'];
  const f = [];
  if (expect.scene && st.scene !== expect.scene) f.push(`escena «${st.scene}», se esperaba «${expect.scene}»`);
  for (const id of expect.has ?? []) if (!st.inventory.includes(id)) f.push(`falta «${id}» en el inventario`);
  for (const id of expect.lacks ?? []) if (st.inventory.includes(id)) f.push(`«${id}» no debería estar en el inventario`);
  for (const [flag, want] of Object.entries(expect.flags ?? {})) {
    if (Boolean(st.flags[flag]) !== want) f.push(`flag ${flag} = ${Boolean(st.flags[flag])}, se esperaba ${want}`);
  }
  for (const flag of expect.unsetFlags ?? []) {
    if (Object.prototype.hasOwnProperty.call(st.flags, flag)) f.push(`flag ${flag} = ${st.flags[flag]} escrita en la partida, se esperaba sin escribir`);
  }
  for (const id of expect.visited ?? []) if (!st.visited.includes(id)) f.push(`no se visitó «${id}»`);
  for (const id of expect.achievements ?? []) if (!st.achievements.includes(id)) f.push(`falta el logro «${id}»`);
  // A2.2: orientación del personaje al terminar el paso (left | right | front | back)
  if (expect.facing !== undefined) {
    if (typeof st.facing !== 'string') f.push('el juego no expone `facing` en state() (API de QA anterior a A2.2)');
    else if (st.facing !== expect.facing) f.push(`el personaje mira «${st.facing}», se esperaba «${expect.facing}»`);
  }
  if (expect.noListenerGrowth) f.push(...checkListenerGrowth(st, ctx.listenersBaseline));
  if (expect.lastChoices) f.push(...checkLastChoices(expect.lastChoices, st));
  return f;
}

/**
 * A2.6: `expect.lastChoices` compara la última elección que salió en el paso (`st.lastChoices`, antes de responderla)
 * por texto contenido, sin mayúsculas: `used` (está y en gris: ya elegida), `fresh` (está y sin usar), `locked`
 * (está bloqueada, con candado) y `absent` (no está: oculta por `when`/`once`/`hideIfLocked`).
 */
export function checkLastChoices(want, st) {
  if (st.lastChoices === undefined) return ['el juego no expone `lastChoices` en el estado (API de QA anterior a A2.6)'];
  if (!st.lastChoices) return ['el paso no pidió elegir ninguna opción de diálogo'];
  const opts = st.lastChoices;
  const find = (needle) => opts.find((o) => o.text.toLowerCase().includes(String(needle).toLowerCase()));
  const shown = () => opts.map((o) => `${o.text}${!o.enabled ? ' (bloqueada)' : o.used ? ' (usada)' : ''}`).join(' | ');
  const f = [];
  for (const t of want.used ?? []) {
    const o = find(t);
    if (!o) f.push(`la opción «${t}» no salió en la última elección (${shown()})`);
    else if (!o.used) f.push(`la opción «${o.text}» debería salir en gris (usada) y sale sin usar`);
  }
  for (const t of want.fresh ?? []) {
    const o = find(t);
    if (!o) f.push(`la opción «${t}» no salió en la última elección (${shown()})`);
    else if (o.used) f.push(`la opción «${o.text}» sale en gris (usada) y no debería`);
  }
  for (const t of want.locked ?? []) {
    const o = find(t);
    if (!o) f.push(`la opción «${t}» no salió en la última elección (${shown()})`);
    else if (o.enabled) f.push(`la opción «${o.text}» debería salir bloqueada`);
  }
  for (const t of want.absent ?? []) {
    const o = find(t);
    if (o) f.push(`la opción «${o.text}» no debería salir (oculta) en la última elección`);
  }
  return f;
}

/**
 * A1.10: los listeners de `resize` del ScaleManager no pueden crecer con los cambios de escena. `baseline` es el
 * recuento tras el primer paso de la ruta (New Game: GameScene y UIScene ya creadas una vez).
 */
export function checkListenerGrowth(st, baseline) {
  const n = st?.resizeListeners;
  if (typeof n !== 'number') return ['el juego no expone `resizeListeners` en state() (API de QA anterior a A1.10)'];
  if (typeof baseline !== 'number') return ['sin recuento de referencia de listeners de resize (se toma tras el primer paso)'];
  if (n > baseline) {
    return [`listeners de resize del ScaleManager: ${n}, tras el primer paso había ${baseline}: se acumulan con los cambios de escena`];
  }
  return [];
}

/** Líneas del log de la API de QA que aparecieron entre dos estados (usa `logTotal`, el log es circular). */
export function newLogLines(before, after) {
  const log = after?.log ?? [];
  if (typeof after?.logTotal !== 'number' || typeof before?.logTotal !== 'number') return log;
  const added = Math.max(0, after.logTotal - before.logTotal);
  return added === 0 ? [] : log.slice(-Math.min(added, log.length));
}

/**
 * `rejects`: el texto (expresión regular, sin distinguir mayúsculas) con el que el juego rechaza la acción. Tiene
 * que aparecer en los textos mostrados durante el paso; si no, es un fallo de comprobación.
 */
export function checkRejects(step, before, after) {
  if (!step.rejects) return [];
  const lines = newLogLines(before, after);
  const re = new RegExp(step.rejects, 'i');
  if (lines.some((l) => re.test(l))) return [];
  const seen = lines.filter((l) => l.startsWith('«')).slice(-3).join(' ');
  return [`no apareció el rechazo /${step.rejects}/ (textos del paso: ${seen || 'ninguno'})`];
}

/** Pasos que hacen clic en un hotspot o NPC de la escena (y no combinan objetos del inventario). */
export function tapsScene(step, before) {
  if (step.do === 'act' || step.do === 'talk') return true;
  if (step.do === 'use') return !(before?.inventory ?? []).includes(step.target);
  return false;
}

/**
 * Comprobación extra del paso del intento: la acción tuvo que ejecutarse de verdad. La API de QA cuenta en
 * `actions` cada verbo que llega a su hotspot/NPC (al saltar player:arrived, o al momento si no hace falta andar);
 * si el contador no se movió, el personaje no llegó y no hubo nada que el juego pudiera rechazar.
 */
export function checkAttemptRan(step, before, after) {
  if (!tapsScene(step, before)) return [];
  if (typeof before?.actions !== 'number' || typeof after?.actions !== 'number') return [];
  if (after.actions > before.actions) return [];
  return ['la acción del intento no llegó a ejecutarse (no saltó player:arrived ni hubo respuesta del juego)'];
}

export const inBounds = (p, b) => !!p && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
export const fmtPoint = (p) => (p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : '?');
export const kindOf = (message) => (/\[qa:blocked\]/.test(message) ? 'blocked' : 'error');

/** Paso que intenta el atajo en una ruta sequence-break: el marcado con `attempt`, o el último. */
export const attemptIndex = (route) => {
  const i = (route.steps ?? []).findIndex((s) => s.attempt);
  return i >= 0 ? i : (route.steps?.length ?? 0) - 1;
};

/** Un walk con `trigger` y `untilScene` solo se da por parado si el personaje pisó el trigger: ya es un rechazo visible. */
const walkWithTrigger = (s) => s.do === 'walk' && !!s.trigger && !!s.untilScene;

/**
 * Defectos de definición: una ruta mal escrita no se ejecuta y sale ERROR.
 *  - `goto` se salta el juego (cambia de escena sin pasar por puertas ni gates): no vale en ninguna ruta, salvo en
 *    las del selftest que lo pidan con `"allowGoto": true` (opts.allowGoto lo pone el runner solo en --selftest).
 *  - sequence-break: `goal`, pasos, un solo `attempt`, `expect` en todos los pasos anteriores al intento, y el
 *    intento con `expect` o `rejects` (salvo un walk con trigger y untilScene, que ya exige pisar el trigger).
 */
export function routeDefects(route, opts = {}) {
  const out = [];
  const steps = route.steps ?? [];
  if (!steps.length) out.push('no tiene pasos');
  steps.forEach((s, i) => {
    if (s.do === 'resize' && !(Number.isInteger(s.width) && Number.isInteger(s.height) && s.width > 0 && s.height > 0)) {
      out.push(`paso ${i + 1} (${describe(s)}): "resize" necesita "width" y "height" enteros positivos`);
    }
    if (s.do === 'goto' && !opts.allowGoto) {
      out.push(`paso ${i + 1} (${describe(s)}): "goto" se salta puertas y gates; solo vale en rutas del selftest con "allowGoto"`);
    }
  });
  if ((route.kind ?? 'walkthrough') !== 'sequence-break') return out;
  if (!route.goal) out.push('falta "goal"');
  if (steps.filter((s) => s.attempt).length > 1) out.push('más de un paso con "attempt"');
  const attempt = attemptIndex(route);
  steps.slice(0, attempt).forEach((s, i) => {
    if (!s.expect) out.push(`paso ${i + 1} (${describe(s)}): los pasos anteriores al intento necesitan "expect"`);
  });
  const a = steps[attempt];
  if (a && !a.expect && !a.rejects && !walkWithTrigger(a)) {
    out.push(`paso ${attempt + 1} (${describe(a)}): el intento necesita "expect" o "rejects" para que un rechazo sea observable`);
  }
  return out;
}

/**
 * Resultado de una ruta a partir de lo que pasó al ejecutarla.
 * run = { stopped: null | { kind: 'error'|'blocked'|'assert', index (1-based; 0 = antes del primer paso), message },
 *         goalReached, goalFails (fallos de `goal` con el último estado, para walkthrough), problems: string[],
 *         stepLabel(index) → etiqueta del paso }
 */
export function classify(route, run) {
  const kind = route.kind ?? 'walkthrough';
  const knownBreak = route.knownBreak ?? null;
  const { stopped, goalReached, problems = [] } = run;
  const label = (i) => run.stepLabel?.(i) ?? '?';
  let status = 'pass';
  let detail = '';
  if (kind === 'sequence-break') {
    const attempt = attemptIndex(route);
    const atAttempt = !!stopped && stopped.index - 1 === attempt;
    const atGate = !!stopped && route.steps[stopped.index - 1]?.gate === true;
    // Cierra la ruta un [qa:blocked] en el intento, o un [qa:blocked]/comprobación fallida en un paso con gate. Un
    // `expect`/`rejects` que falla en el intento no cierra: no se vio el rechazo, así que no se sabe qué pasó.
    const closingStep = !!stopped && stopped.index > 0
      && ((atAttempt && stopped.kind === 'blocked') || (atGate && stopped.kind !== 'error'));
    if (stopped?.kind === 'error') {
      status = 'error';
      detail = `paso ${stopped.index}: ${stopped.message}`;
    } else if (goalReached) {
      status = knownBreak ? 'xfail' : 'fail';
      detail = knownBreak ? `atajo abierto, conocido: lo cierra ${knownBreak}` : 'atajo abierto: se llega antes de tiempo';
    } else if (atAttempt && !closingStep) {
      status = 'error';
      detail = `paso ${stopped.index} (intento): no hubo un rechazo observable, así que no se sabe si el atajo está cerrado: ${stopped.message}`;
    } else if (stopped && !closingStep) {
      status = 'error';
      detail = `paso de preparación ${stopped.index} (${label(stopped.index)}) no salió como se esperaba, así que el atajo no se llegó a intentar: ${stopped.message}`;
    } else {
      const why = stopped
        ? `paso ${stopped.index}${atAttempt ? ' (intento)' : ' (gate)'}: ${stopped.message}`
        : `el intento (paso ${attempt + 1}) terminó sin cumplir ${JSON.stringify(route.goal)}`;
      status = knownBreak ? 'xpass' : 'pass';
      detail = knownBreak ? `el atajo ya está cerrado (${why}): quita "knownBreak" de la ruta` : `cerrado (${why})`;
    }
  } else if (stopped) {
    status = 'fail';
    detail = `paso ${stopped.index}: ${stopped.message}`;
  } else if (route.goal && !goalReached) {
    status = 'fail';
    detail = `sin objetivo: ${(run.goalFails ?? []).join('; ')}`;
  }
  if (problems.length && !['fail', 'error'].includes(status)) {
    status = 'fail';
    detail = `${detail ? `${detail} · ` : ''}${problems.length} error(es) del juego: ${problems[0]}`;
  }
  return { status, detail };
}

/** Defectos de una ruta del selftest: tiene que decir qué resultado espera. */
export function selftestDefects(route) {
  const out = [];
  if (!STATUSES.includes(route.expectStatus)) out.push(`"expectStatus" debe ser uno de ${STATUSES.join('/')}`);
  if (route.expectDetail !== undefined) {
    try { new RegExp(route.expectDetail); } catch (err) { out.push(`"expectDetail" no es una expresión regular válida: ${err.message}`); }
  }
  return out;
}

/** Veredicto del selftest para una ruta ya ejecutada: null si la clasificación es la esperada, o por qué no. */
export function selftestMismatch(route, result) {
  const defects = selftestDefects(route);
  if (defects.length) return `ruta del selftest mal definida: ${defects.join('; ')}`;
  if (result.status !== route.expectStatus) return `salió ${result.status.toUpperCase()}, se esperaba ${route.expectStatus.toUpperCase()}`;
  if (route.expectDetail !== undefined && !new RegExp(route.expectDetail).test(result.detail)) {
    return `el detalle no casa con /${route.expectDetail}/`;
  }
  return null;
}

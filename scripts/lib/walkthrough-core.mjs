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
    // A2.4: controles de escritorio
    case 'key': return `KEY ${s.key}${s.phase && s.phase !== 'press' ? ` (${s.phase})` : ''}`;
    case 'click': return `CLICK ${s.target}`;
    case 'rightclick': return `RIGHTCLICK ${s.target}`;
    case 'doubleclick': return `DOUBLECLICK ${s.target}`;
    // A2.10: script de QA por el ScriptEngine (cinemáticas)
    case 'runScript': return `RUNSCRIPT ${Array.isArray(s.ops) ? s.ops.length : '?'} op(s)${s.skipAfterMs !== undefined ? ` (Esc a los ${s.skipAfterMs} ms)` : ''}`;
    // A2.9: diario (móvil de Dex) y llamada a Anon
    case 'journal': return `JOURNAL ${s.action ?? 'open'}${s.tab ? ` (${s.tab})` : ''}`;
    case 'callAnon': return 'CALL ANON';
    default: return s.do;
  }
}

/**
 * Comprobaciones de estado: scene, has, lacks, flags, unsetFlags, visited, achievements, (A2.6) lastChoices, (A2.2) facing,
 * (A2.4) verb, walkTarget y highlighted, (A2.10) cinematic y playerNear, (A2.8) pixel, (A4.1) anim y (A1.10) noListenerGrowth, que
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
  // A2.4: verbo elegido en el panel, último acercamiento (objetivo y verbo) y resaltado de Tab
  if (expect.verb !== undefined) {
    if (st.verb === undefined) f.push('el juego no expone `verb` en state() (API de QA anterior a A2.4)');
    else if (st.verb !== expect.verb) f.push(`verbo del panel «${st.verb}», se esperaba «${expect.verb}»`);
  }
  if (expect.walkTarget) f.push(...checkWalkTarget(expect.walkTarget, st));
  if (expect.highlighted) f.push(...checkHighlighted(expect.highlighted, st));
  if (expect.noListenerGrowth) f.push(...checkListenerGrowth(st, ctx.listenersBaseline, ctx.inputListenersBaseline));
  if (expect.lastChoices) f.push(...checkLastChoices(expect.lastChoices, st));
  if (expect.cinematic) f.push(...checkCinematic(expect.cinematic, st));
  if (expect.journal) f.push(...checkJournal(expect.journal, st));
  // A2.10: el personaje acabó cerca de un punto (en %), p. ej. tras un actorMove andado o saltado
  if (expect.playerNear) {
    const { x, y, tol = 1.5 } = expect.playerNear;
    if (!st.player) f.push('sin posición del personaje');
    else if (Math.hypot(st.player.x - x, st.player.y - y) > tol) f.push(`el personaje está en ${fmtPoint(st.player)}, se esperaba cerca de ${x},${y} (±${tol})`);
  }
  // A2.8: densidad de píxel (escala entera, unidad de la escena, misma altura que en otras escenas de la ruta)
  if (expect.pixel) f.push(...checkPixel(expect.pixel, st, ctx.pixelRefs));
  // A4.1: animación del jugador (dirección del último tramo, cabeceo, textura, reposo)
  if (expect.anim) f.push(...checkAnim(expect.anim, st));
  // A2.5: última respuesta de fallo (tipo, objeto, objetivo, verbo, bolsa y texto)
  if (expect.failResponse) f.push(...checkFailResponse(expect.failResponse, st));
  return f;
}

/**
 * A4.1: `expect.anim` contra `st.anim` (subconjunto):
 *  - `dir`: dirección del último tramo andado (left | right | up | down);
 *  - `talking` / `moving` / `gesture`: booleanos;
 *  - `texture`: expresión regular (sin mayúsculas) sobre la textura que se ve, p. ej. `^player_back_`;
 *  - `costume`: juego de sprites (player | ape);
 *  - `rest: true`: sin tween (giro 0, sin elevación) y con la escala base de A2.8 (la del paso `expect.pixel`).
 */
export function checkAnim(want, st) {
  const a = st.anim;
  if (a === undefined) return ['el juego no expone `anim` en state() (API de QA anterior a A4.1)'];
  if (!a) return ['sin animación del jugador (no hay escena de juego)'];
  const f = [];
  if (want.dir !== undefined && a.dir !== want.dir) f.push(`animación: último tramo «${a.dir}», se esperaba «${want.dir}»`);
  for (const k of ['talking', 'moving', 'gesture']) {
    if (want[k] !== undefined && Boolean(a[k]) !== want[k]) f.push(`animación: ${k} = ${Boolean(a[k])}, se esperaba ${want[k]}`);
  }
  if (want.texture !== undefined && !new RegExp(want.texture, 'i').test(String(a.texture ?? ''))) {
    f.push(`animación: textura «${a.texture}», se esperaba /${want.texture}/`);
  }
  if (want.costume !== undefined && a.costume !== want.costume) f.push(`animación: disfraz «${a.costume}», se esperaba «${want.costume}»`);
  if (want.rest && !a.rest) f.push(`animación: no está en reposo (giro ${a.angle}°, elevación ${a.liftPx} px, escala ${a.scale} y base ${a.baseScale})`);
  return f;
}

/**
 * A2.5: `expect.failResponse` contra `st.lastFailResponse`: `kind` (item-hotspot | item-npc | item-item | verb | item-verb),
 * `item`, `target`, `verb` y `bag` (iguales) y `text` (expresión regular, sin mayúsculas). Con ?qa=1 cada bolsa va en ronda
 * desde 0, así que la primera vez sale su frase 0.
 */
export function checkFailResponse(want, st) {
  const r = st.lastFailResponse;
  if (r === undefined) return ['el juego no expone `lastFailResponse` en state() (API de QA anterior a A2.5)'];
  if (!r) return ['no ha habido ninguna respuesta de fallo'];
  const f = [];
  for (const k of ['kind', 'item', 'target', 'verb', 'bag']) {
    if (want[k] !== undefined && r[k] !== want[k]) f.push(`respuesta de fallo: ${k} «${r[k]}», se esperaba «${want[k]}»`);
  }
  if (want.text !== undefined && !new RegExp(want.text, 'i').test(r.text ?? '')) f.push(`respuesta de fallo «${r.text}», no casa con /${want.text}/`);
  return f;
}

/**
 * A2.8: `expect.pixel` contra `st.pixel`:
 *  - `integer: true`: la escala del jugador y la de cada NPC son múltiplos enteros del píxel de arte;
 *  - `pixelScale`: unidad de píxel de la escena (±0,01);
 *  - `heightPct`: `{ min, max }` del alto del jugador en pantalla, en % del alto del fondo;
 *  - `sameHeightAs`: escena (o lista) ya vista en la ruta; el alto del jugador tiene que coincidir con el que tuvo allí
 *    (en la franja sin profundidad, ver `notePixel`) con una tolerancia relativa `tol` (0,1 por defecto).
 */
export function checkPixel(want, st, refs = {}) {
  const p = st.pixel;
  if (p === undefined) return ['el juego no expone `pixel` en state() (API de QA anterior a A2.8)'];
  if (!p) return ['sin densidad de píxel (no hay escena de juego)'];
  const f = [];
  if (want.integer) {
    if (!p.integer) f.push(`escala del jugador ${round3(p.playerScale)}: no es un múltiplo entero del píxel de arte`);
    for (const n of p.npcs ?? []) if (!n.integer) f.push(`escala de ${n.id} ${round3(n.scale)}: no es un múltiplo entero del píxel de arte`);
  }
  if (typeof want.pixelScale === 'number' && !(Math.abs(p.pixelScale - want.pixelScale) <= 0.01)) {
    f.push(`unidad de píxel ${p.pixelScale}, se esperaba ${want.pixelScale}`);
  }
  if (want.heightPct) {
    const { min = -Infinity, max = Infinity } = want.heightPct;
    if (!(p.playerHeightPct >= min && p.playerHeightPct <= max)) f.push(`el jugador mide el ${p.playerHeightPct} % del fondo, se esperaba entre ${min} y ${max}`);
  }
  const tol = typeof want.tol === 'number' ? want.tol : 0.1;
  for (const scene of [want.sameHeightAs ?? []].flat()) {
    const ref = refs?.[scene];
    if (!ref) { f.push(`sin altura de referencia de «${scene}» (la ruta no ha pasado por allí con el jugador en la franja sin profundidad)`); continue; }
    const rel = Math.abs(p.playerHeightPct - ref.heightPct) / ref.heightPct;
    if (rel > tol) f.push(`el jugador mide el ${p.playerHeightPct} % del fondo y en «${scene}» medía el ${ref.heightPct} % (${Math.round(rel * 100)} % de diferencia, tolerancia ${Math.round(tol * 100)} %)`);
  }
  return f;
}

/**
 * A2.8: apunta en `refs` el alto del jugador de la escena actual (para `expect.pixel.sameHeightAs`), solo si está en
 * la franja sin profundidad (`depth` = 1): con depthScale el alto cambia con la y de los pies.
 */
export function notePixel(refs, st) {
  const p = st?.pixel;
  if (!refs || !p || !st.scene || Math.abs((p.depth ?? 1) - 1) > 1e-6) return refs;
  refs[st.scene] = { heightPct: p.playerHeightPct, playerScale: p.playerScale };
  return refs;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * A2.10: `expect.cinematic` contra `st.cinematic`: booleanos `active`, `letterbox`, `chromeHidden`, `following`
 * (cámara), `skipped`, `covered` y `ducked`; `zoom` (número, ±0,01); `transition` (none|iris|wipe); `endedMin`
 * (cinemáticas terminadas en la escena, como mínimo).
 */
export function checkCinematic(want, st) {
  const c = st.cinematic;
  if (c === undefined) return ['el juego no expone `cinematic` en state() (API de QA anterior a A2.10)'];
  if (!c) return ['sin estado de cinemáticas (no hay escena de juego)'];
  const f = [];
  for (const k of ['active', 'letterbox', 'chromeHidden', 'skipped', 'covered', 'ducked']) {
    if (want[k] !== undefined && Boolean(c[k]) !== want[k]) f.push(`cinemática: ${k} = ${Boolean(c[k])}, se esperaba ${want[k]}`);
  }
  if (want.following !== undefined && Boolean(c.camera?.following) !== want.following) {
    f.push(`cinemática: la cámara ${c.camera?.following ? 'sigue' : 'no sigue'} al jugador, se esperaba que ${want.following ? 'sí' : 'no'}`);
  }
  if (typeof want.zoom === 'number' && !(Math.abs((c.camera?.zoom ?? NaN) - want.zoom) <= 0.01)) {
    f.push(`cinemática: zoom de la cámara ${c.camera?.zoom}, se esperaba ${want.zoom}`);
  }
  if (want.transition !== undefined && c.transition !== want.transition) f.push(`cinemática: transición «${c.transition}», se esperaba «${want.transition}»`);
  if (typeof want.endedMin === 'number' && !(c.ended >= want.endedMin)) f.push(`cinemática: ${c.ended} terminada(s) en la escena, se esperaban al menos ${want.endedMin}`);
  return f;
}

/**
 * A2.9: `expect.journal` contra `st.journal`: `open` (booleano), `chapter` (número), `done`/`pending` (ids de objetivos
 * del capítulo con y sin tic), `notes`/`noNotes` (ids de notas apuntadas y sin apuntar) y `anon` (última llamada):
 * `puzzle` (id, o null = frase de relleno), `level` (1-3), `notPuzzle` (id o lista: la pista no puede ser de ese
 * puzle, p. ej. uno ya resuelto) y `text` (expresión regular, sin mayúsculas).
 */
export function checkJournal(want, st) {
  const j = st.journal;
  if (j === undefined) return ['el juego no expone `journal` en state() (API de QA anterior a A2.9)'];
  if (!j) return ['sin diario (no hay escena de juego)'];
  const f = [];
  if (want.open !== undefined && Boolean(j.open) !== want.open) f.push(`diario ${j.open ? 'abierto' : 'cerrado'}, se esperaba ${want.open ? 'abierto' : 'cerrado'}`);
  if (want.chapter !== undefined && j.chapter !== want.chapter) f.push(`diario en el capítulo ${j.chapter}, se esperaba el ${want.chapter}`);
  const goal = (id) => (j.goals ?? []).find((g) => g.id === id);
  for (const id of want.done ?? []) {
    const g = goal(id);
    if (!g) f.push(`el objetivo «${id}» no está en el diario (capítulo ${j.chapter}: ${(j.goals ?? []).map((x) => x.id).join(', ')})`);
    else if (!g.done) f.push(`el objetivo «${id}» sigue sin tic`);
  }
  for (const id of want.pending ?? []) {
    const g = goal(id);
    if (!g) f.push(`el objetivo «${id}» no está en el diario (capítulo ${j.chapter})`);
    else if (g.done) f.push(`el objetivo «${id}» ya tiene tic y no debería`);
  }
  for (const id of want.notes ?? []) if (!(j.notes ?? []).includes(id)) f.push(`la nota «${id}» no está apuntada en el diario`);
  for (const id of want.noNotes ?? []) if ((j.notes ?? []).includes(id)) f.push(`la nota «${id}» está apuntada y no debería`);
  if (want.anon) {
    const a = j.anon;
    if (!a) f.push('no hay ninguna llamada a Anon en el diario');
    else {
      if (want.anon.puzzle !== undefined && a.puzzle !== want.anon.puzzle) f.push(`Anon dio pista de «${a.puzzle}», se esperaba de «${want.anon.puzzle}»`);
      if (want.anon.level !== undefined && a.level !== want.anon.level) f.push(`Anon dio el nivel ${a.level} de «${a.puzzle}», se esperaba el ${want.anon.level}`);
      const not = want.anon.notPuzzle === undefined ? [] : [].concat(want.anon.notPuzzle);
      if (not.includes(a.puzzle)) f.push(`Anon dio pista de «${a.puzzle}», que no debería (ya resuelto)`);
      if (want.anon.text !== undefined && !new RegExp(want.anon.text, 'i').test(a.text ?? '')) f.push(`Anon dijo «${a.text}», no casa con /${want.anon.text}/`);
    }
  }
  return f;
}

/** A2.10: ops que un `runScript` de una ruta no puede llevar: cambiarían la partida por un atajo (como `goto`). */
/** A2.9: `journalNote` y `callAnon` también: apuntan notas y suben el nivel de pista de Anon en la partida. */
const RUNSCRIPT_FORBIDDEN = new Set(['addItem', 'removeItem', 'gotoScene', 'fadeToScene', 'setCostume', 'mintNFT', 'mintAchievement', 'achievement', 'dialogue', 'web3Require', 'journalNote', 'callAnon']);

/**
 * A2.10: defectos de los ops de un paso `runScript`: lista no vacía de `{ op }`, sin ops que cambien la partida
 * (objetos, escena, disfraz, logros, mints, diálogos) y `setFlag` solo de flags `qa_*` (de la prueba, no del juego).
 * Recorre las ramas `then`/`else`.
 */
export function runScriptDefects(ops) {
  if (!Array.isArray(ops) || !ops.length) return ['"runScript" necesita "ops": una lista de ops no vacía'];
  const out = [];
  const walk = (list) => {
    for (const op of list) {
      if (!op || typeof op.op !== 'string') { out.push('cada op necesita "op"'); continue; }
      if (RUNSCRIPT_FORBIDDEN.has(op.op)) out.push(`el op «${op.op}» cambia la partida: no vale en runScript`);
      if (op.op === 'setFlag' && !/^qa_/.test(String(op.flag))) out.push(`setFlag «${op.flag}»: en runScript solo flags qa_* (de la prueba)`);
      for (const k of ['then', 'else']) if (Array.isArray(op[k])) walk(op[k]);
    }
  };
  walk(ops);
  return out;
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
 * recuento tras el primer paso de la ruta (New Game: GameScene y UIScene ya creadas una vez). A2.4: lo mismo con los
 * de teclado y del lienzo (`st.inputListeners` frente a `inputBaseline`), si el juego los expone.
 */
export function checkListenerGrowth(st, baseline, inputBaseline) {
  const n = st?.resizeListeners;
  if (typeof n !== 'number') return ['el juego no expone `resizeListeners` en state() (API de QA anterior a A1.10)'];
  if (typeof baseline !== 'number') return ['sin recuento de referencia de listeners de resize (se toma tras el primer paso)'];
  const f = [];
  if (n > baseline) {
    f.push(`listeners de resize del ScaleManager: ${n}, tras el primer paso había ${baseline}: se acumulan con los cambios de escena`);
  }
  const k = st?.inputListeners;
  if (typeof k === 'number' && typeof inputBaseline === 'number' && k > inputBaseline) {
    f.push(`listeners de teclado y del lienzo: ${k}, tras el primer paso había ${inputBaseline}: se acumulan con los cambios de escena`);
  }
  return f;
}

/** A2.4: `expect.walkTarget` = { target?, verb? } contra el último acercamiento (`st.walkTarget`). */
export function checkWalkTarget(want, st) {
  if (st.walkTarget === undefined) return ['el juego no expone `walkTarget` en state() (API de QA anterior a A2.2)'];
  const wt = st.walkTarget;
  if (!wt) return [`no hubo acercamiento a ningún objetivo (se esperaba ${JSON.stringify(want)})`];
  const f = [];
  if (want.target !== undefined && wt.target !== want.target) f.push(`el último objetivo fue «${wt.target}», se esperaba «${want.target}»`);
  if (want.verb !== undefined && wt.verb !== want.verb) f.push(`el último verbo sobre «${wt.target}» fue ${wt.verb}, se esperaba ${want.verb}`);
  return f;
}

/** A2.4: `expect.highlighted` = { min?, max?, includes?, excludes? } contra los resaltados de Tab (`st.highlightedHotspots`). */
export function checkHighlighted(want, st) {
  const ids = st.highlightedHotspots;
  if (!Array.isArray(ids)) return ['el juego no expone `highlightedHotspots` en state() (API de QA anterior a A2.4)'];
  const f = [];
  if (typeof want.min === 'number' && ids.length < want.min) f.push(`${ids.length} resaltados con Tab, se esperaban al menos ${want.min}`);
  if (typeof want.max === 'number' && ids.length > want.max) f.push(`${ids.length} resaltados con Tab, se esperaban como mucho ${want.max}`);
  for (const id of want.includes ?? []) if (!ids.includes(id)) f.push(`«${id}» no sale resaltado con Tab`);
  for (const id of want.excludes ?? []) if (ids.includes(id)) f.push(`«${id}» sale resaltado con Tab y no debería`);
  return f;
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
  if (['act', 'talk', 'click', 'rightclick', 'doubleclick'].includes(step.do)) return true;
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
    if (s.do === 'key' && (typeof s.key !== 'string' || !s.key || !['press', 'down', 'up', undefined].includes(s.phase))) {
      out.push(`paso ${i + 1} (${describe(s)}): "key" necesita "key" (KeyboardEvent.key) y "phase" press|down|up si lo lleva`);
    }
    if (['click', 'rightclick', 'doubleclick'].includes(s.do) && (typeof s.target !== 'string' || !s.target)) {
      out.push(`paso ${i + 1} (${describe(s)}): "${s.do}" necesita "target"`);
    }
    if (s.do === 'runScript') {
      for (const d of runScriptDefects(s.ops)) out.push(`paso ${i + 1} (${describe(s)}): ${d}`);
      if (s.skipAfterMs !== undefined && !(typeof s.skipAfterMs === 'number' && s.skipAfterMs >= 0)) {
        out.push(`paso ${i + 1} (${describe(s)}): "skipAfterMs" tiene que ser un número ≥ 0`);
      }
    }
    if (s.do === 'journal' && (!['open', 'close', undefined].includes(s.action) || !['goals', 'notes', 'anon', undefined].includes(s.tab))) {
      out.push(`paso ${i + 1} (${describe(s)}): "journal" lleva "action" open|close y "tab" goals|notes|anon (opcionales)`);
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

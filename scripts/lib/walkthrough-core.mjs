// A0.5 (plan SCUMM): lógica pura del runner de walkthrough (scripts/walkthrough.mjs), sin navegador ni disco,
// para poder probarla con `node --test` (tests/walkthrough-core.test.mjs). Aquí viven las reglas de definición
// de las rutas (routeDefects), las comprobaciones de estado (check, rejects), la clasificación del resultado
// (classify) y el veredicto del selftest (selftestMismatch).

export const STATUSES = ['pass', 'fail', 'xfail', 'xpass', 'error'];

export function describe(s) {
  switch (s.do) {
    case 'act': return `${s.verb} ${s.target}${s.holdTextMs ? ` (texto ${s.holdTextMs / 1000} s)` : ''}`;
    case 'use': return `USE ${s.item} → ${s.target}`;
    // A2.18
    case 'give': return `GIVE ${s.item} → ${s.target}`;
    case 'pick': return `${s.verb} ${s.item} (inventario)`;
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
    case 'mockWeb3': return `MOCK WEB3 ${s.web3 === null || s.web3 === undefined ? '(sin cartera)' : s.web3 === 'off' ? 'off' : `${s.web3.zero ?? 0} $ZERO`}`;
    default: return s.do;
  }
}

/**
 * Comprobaciones de estado: scene, has, lacks, (A9.7) inventoryMax, flags, unsetFlags, visited, achievements, (A2.6) lastChoices, (A2.2) facing,
 * (A2.4) verb, walkTarget y highlighted, (A2.10) cinematic y playerNear, (A2.8) pixel, (A4.1) anim, (A4.2) npc, (A4.3) ambient, (A4.4) audio
 * (compara con `ctx.before`, el estado de antes del paso) y (A1.10) noListenerGrowth, que
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
  // A9.7: tope de objetos en el inventario (lo gastado se retira; en el móvil cada página de más estorba)
  if (expect.inventoryMax !== undefined && st.inventory.length > expect.inventoryMax) {
    f.push(`${st.inventory.length} objetos en el inventario (${st.inventory.join(', ')}), máximo ${expect.inventoryMax}`);
  }
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
  // A9.4: de vuelta en la portada (MenuScene) y el final (créditos, THE END, resumen, partida terminada)
  if (expect.menu !== undefined && Boolean(st.menu) !== expect.menu) f.push(`en la portada = ${Boolean(st.menu)}, se esperaba ${expect.menu}`);
  if (expect.ending) f.push(...checkEnding(expect.ending, st));
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
  // A4.2: vida de las NPC (giro hacia el jugador, boca, respiración, parpadeos, última conversación)
  if (expect.npc) f.push(...checkNpc(expect.npc, st));
  // A4.3: animación ambiental (elemento presente, activo según su `when`, con cosas dibujadas)
  if (expect.ambient) f.push(...checkAmbient(expect.ambient, st));
  // A2.5: última respuesta de fallo (tipo, objeto, objetivo, verbo, bolsa y texto)
  if (expect.failResponse) f.push(...checkFailResponse(expect.failResponse, st));
  // A2.18: frase de la línea de acción («Give X to …» pendiente o ya resuelta)
  if (expect.sentence) f.push(...checkSentence(expect.sentence, st));
  // A4.4: audio (ambiente pedido, superficie bajo los pies, pasos, efectos pedidos durante el paso)
  if (expect.audio) f.push(...checkAudio(expect.audio, st, ctx.before));
  // A3.10: dashboard del Mining Rig
  if (expect.dashboard) f.push(...checkDashboard(expect.dashboard, st));
  return f;
}

/**
 * A3.10: `expect.dashboard` contra `st.lastDashboard` (el dashboard del rig que salió en el paso, leído antes de cerrarlo):
 *  - `shown: false` = no salió; `shown: true` (o cualquier otra clave) = salió;
 *  - `phase` (loading | ready | error), `rows` (textos que tiene que contener alguna fila, sin mayúsculas), `tip` (true =
 *    lleva la nota del sysadmin).
 * Además exige que ya esté cerrado (`st.dashboard.open` false): el juego sigue.
 */
export function checkDashboard(exp, st) {
  const f = [];
  const d = st.lastDashboard;
  if (st.dashboard?.open) f.push('el dashboard sigue abierto tras el paso');
  if (exp.shown === false) {
    if (d) f.push(`salió el dashboard y no debía (${d.rows.join(' | ')})`);
    return f;
  }
  if (!d) return [...f, 'no salió el dashboard del rig'];
  if (exp.phase && d.phase !== exp.phase) f.push(`dashboard en «${d.phase}», se esperaba «${exp.phase}»`);
  for (const want of exp.rows ?? []) {
    if (!d.rows.some((r) => r.toLowerCase().includes(String(want).toLowerCase()))) f.push(`el dashboard no enseña «${want}» (filas: ${d.rows.join(' | ')})`);
  }
  if (exp.tip === true && !d.tip) f.push('el dashboard no lleva la nota del sysadmin');
  return f;
}

/**
 * A4.4: `expect.audio` contra `st.audio` (y el estado de antes del paso, para lo que sonó durante el paso):
 *  - `ambience`: bucle que pide la escena (`audio.ambience.requested`; null = ninguno). Con el sonido apagado no suena
 *    pero la petición se apunta igual;
 *  - `surface`: superficie bajo los pies al acabar (null = muda);
 *  - `footstepsMin`: pasos dados en la escena (como mínimo);
 *  - `sfxPlayed` / `sfxNotPlayed`: claves de efectos que se pidieron (o no) durante el paso (sube `sfx.counts[clave]`);
 *  - `missing: false`: ningún efecto pedido hasta ahora faltaba en la caché (`sfx.missing` vacío);
 *  - `muted`: silencio activado o no.
 */
export function checkAudio(want, st, before) {
  const a = st.audio;
  if (a === undefined) return ['el juego no expone `audio` en state() (API de QA anterior a A4.4)'];
  if (!a) return ['sin estado de audio (no hay escena de juego)'];
  const f = [];
  if (want.ambience !== undefined && a.ambience.requested !== want.ambience) f.push(`audio: ambiente pedido «${a.ambience.requested}», se esperaba «${want.ambience}»`);
  if (want.surface !== undefined && (a.footsteps?.surface ?? null) !== want.surface) f.push(`audio: superficie «${a.footsteps?.surface ?? null}», se esperaba «${want.surface}»`);
  if (want.footstepsMin !== undefined && (a.footsteps?.count ?? 0) < want.footstepsMin) f.push(`audio: ${a.footsteps?.count ?? 0} paso(s) en la escena, se esperaban al menos ${want.footstepsMin}`);
  const played = (key) => (a.sfx.counts[key] ?? 0) - (before?.audio?.sfx?.counts?.[key] ?? 0);
  for (const key of want.sfxPlayed ?? []) if (played(key) <= 0) f.push(`audio: el efecto «${key}» no se pidió durante el paso (pedidos: ${Object.keys(a.sfx.counts).filter((k) => played(k) > 0).join(', ') || 'ninguno'})`);
  for (const key of want.sfxNotPlayed ?? []) if (played(key) > 0) f.push(`audio: el efecto «${key}» se pidió ${played(key)} vez/veces y no debía`);
  if (want.missing === false && a.sfx.missing.length) f.push(`audio: efectos pedidos que no estaban en caché: ${a.sfx.missing.join(', ')}`);
  if (want.muted !== undefined && a.muted !== want.muted) f.push(`audio: muted = ${a.muted}, se esperaba ${want.muted}`);
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
 * A4.2: `expect.npc` (un objeto o una lista) contra `st.npcLife` (la NPC con ese `id`):
 *  - `mirrored`, `facing` (left | right), `talking`, `engaged`, `mouthOpen`, `rest` (sin conversación, boca cerrada y con
 *    su orientación por defecto): iguales;
 *  - `minBlinks`, `minTurns`, `minMouthMoves`: mínimos de `blinkCount`, `turns` y `mouthMoves` (en la escena);
 *  - `lastTalk`: última conversación: `facedPlayer` y `faced` (iguales), `voice` (clip | text), `minLines` y `minMouthMoves`.
 */
export function checkNpc(want, st) {
  const list = st.npcLife;
  if (list === undefined) return ['el juego no expone `npcLife` en state() (API de QA anterior a A4.2)'];
  const f = [];
  for (const w of Array.isArray(want) ? want : [want]) {
    const n = (list ?? []).find((x) => x.id === w.id);
    if (!n) { f.push(`NPC «${w.id}»: no está en la escena (${(list ?? []).map((x) => x.id).join(', ') || 'ninguna'})`); continue; }
    for (const k of ['mirrored', 'talking', 'engaged', 'mouthOpen', 'rest']) {
      if (w[k] !== undefined && Boolean(n[k]) !== w[k]) f.push(`NPC «${w.id}»: ${k} = ${Boolean(n[k])}, se esperaba ${w[k]}`);
    }
    if (w.facing !== undefined && n.facing !== w.facing) f.push(`NPC «${w.id}»: mira «${n.facing}», se esperaba «${w.facing}»`);
    for (const [k, field] of [['minBlinks', 'blinkCount'], ['minTurns', 'turns'], ['minMouthMoves', 'mouthMoves']]) {
      if (w[k] !== undefined && !(n[field] >= w[k])) f.push(`NPC «${w.id}»: ${field} = ${n[field]}, se esperaban al menos ${w[k]}`);
    }
    if (w.lastTalk) {
      const t = n.lastTalk;
      if (!t) { f.push(`NPC «${w.id}»: no ha hablado`); continue; }
      for (const k of ['facedPlayer', 'faced', 'voice']) {
        if (w.lastTalk[k] !== undefined && t[k] !== w.lastTalk[k]) f.push(`NPC «${w.id}»: al hablar ${k} = ${t[k]}, se esperaba ${w.lastTalk[k]}`);
      }
      if (w.lastTalk.minLines !== undefined && !(t.lines >= w.lastTalk.minLines)) f.push(`NPC «${w.id}»: dijo ${t.lines} línea(s), se esperaban al menos ${w.lastTalk.minLines}`);
      if (w.lastTalk.minMouthMoves !== undefined && !(t.mouthMoves >= w.lastTalk.minMouthMoves)) {
        f.push(`NPC «${w.id}»: al hablar abrió la boca ${t.mouthMoves} vez/veces, se esperaban al menos ${w.lastTalk.minMouthMoves}`);
      }
    }
  }
  return f;
}

/**
 * A4.3: `expect.ambient` (un objeto o una lista) contra `st.ambient` (el elemento con ese `id`):
 *  - `active` (se ve: su `when` se cumple o está forzado), `conditionMet`, `kind`, `forced` (on | off | null): iguales;
 *  - `minCount`: cosas dibujadas en el último frame, al menos; `minFrames` / `minBursts`: mínimos de los contadores;
 *  - `absent: true`: no hay ningún elemento con ese id en la escena.
 */
export function checkAmbient(want, st) {
  const list = st.ambient;
  if (list === undefined) return ['el juego no expone `ambient` en state() (API de QA anterior a A4.3)'];
  const f = [];
  for (const w of Array.isArray(want) ? want : [want]) {
    const a = (list ?? []).find((x) => x.id === w.id);
    if (w.absent) { if (a) f.push(`ambiente «${w.id}»: está en la escena y se esperaba ausente`); continue; }
    if (!a) { f.push(`ambiente «${w.id}»: no está en la escena (${(list ?? []).map((x) => x.id).join(', ') || 'ninguno'})`); continue; }
    for (const k of ['active', 'conditionMet']) {
      if (w[k] !== undefined && Boolean(a[k]) !== w[k]) f.push(`ambiente «${w.id}»: ${k} = ${Boolean(a[k])}, se esperaba ${w[k]}`);
    }
    if (w.kind !== undefined && a.kind !== w.kind) f.push(`ambiente «${w.id}»: kind «${a.kind}», se esperaba «${w.kind}»`);
    if (w.forced !== undefined && a.forced !== w.forced) f.push(`ambiente «${w.id}»: forced = ${a.forced}, se esperaba ${w.forced}`);
    for (const [k, field] of [['minCount', 'count'], ['minFrames', 'frames'], ['minBursts', 'bursts']]) {
      if (w[k] !== undefined && !(a[field] >= w[k])) f.push(`ambiente «${w.id}»: ${field} = ${a[field]}, se esperaban al menos ${w[k]}`);
    }
  }
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
 * A2.18: `expect.sentence` contra `st.sentence` (línea de acción): `verb`, `item` (null = sin objeto) y `pending` (iguales) y
 * `text` (expresión regular, sin mayúsculas: lo que se ve, p. ej. «^Give .* to\\.\\.\\.$»).
 */
export function checkSentence(want, st) {
  const s = st.sentence;
  if (s === undefined) return ['el juego no expone `sentence` en state() (API de QA anterior a A2.18)'];
  if (!s) return ['sin línea de acción (no hay partida)'];
  const f = [];
  for (const k of ['verb', 'item', 'pending']) {
    if (want[k] !== undefined && s[k] !== want[k]) f.push(`frase: ${k} «${s[k]}», se esperaba «${want[k]}»`);
  }
  if (want.text !== undefined && !new RegExp(want.text, 'i').test(s.text ?? '')) f.push(`frase «${s.text}», no casa con /${want.text}/`);
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
 * A9.4: `expect.ending` contra `st.ending` (registry `endingQa`) y la partida en memoria: `creditsSkipped` (bool),
 * `tapsIgnoredMin` (toques que NO saltaron los créditos), `theEnd` (se vio «THE END»), `summary` (patrones que tiene que
 * casar alguna línea del resumen, sin mayúsculas), `returnedToMenu` (bool), `finished` (la partida lleva `completedAt`) y
 * `playTimeMin` (ms jugados como mínimo).
 */
export function checkEnding(want, st) {
  const e = st.ending;
  if (e === undefined) return ['el juego no expone `ending` en state() (API de QA anterior a A9.4)'];
  if (e === null) return ['no se llegó al final (sin créditos en esta sesión)'];
  const f = [];
  const credits = e.credits ?? null;
  if (want.creditsSkipped !== undefined) {
    if (!credits) f.push('no hubo créditos');
    else if (Boolean(credits.skipped) !== want.creditsSkipped) f.push(`créditos saltados = ${Boolean(credits.skipped)}${credits.skipInput ? ` (${credits.skipInput} a los ${credits.skippedAtMs} ms)` : ''}, se esperaba ${want.creditsSkipped}`);
  }
  if (want.tapsIgnoredMin !== undefined && !((credits?.tapsIgnored ?? 0) >= want.tapsIgnoredMin)) {
    f.push(`toques ignorados en los créditos: ${credits?.tapsIgnored ?? 0}, se esperaban al menos ${want.tapsIgnoredMin}`);
  }
  if (want.theEnd !== undefined && Boolean(e.ending?.theEnd) !== want.theEnd) f.push(`«THE END» = ${Boolean(e.ending?.theEnd)}, se esperaba ${want.theEnd}`);
  const lines = Array.isArray(e.summary) ? e.summary : [];
  for (const pat of want.summary ?? []) {
    if (!lines.some((l) => new RegExp(pat, 'i').test(l))) f.push(`el resumen no tiene «${pat}»: ${lines.join(' | ') || '(vacío)'}`);
  }
  if (want.returnedToMenu !== undefined && Boolean(e.returnedToMenu) !== want.returnedToMenu) f.push(`vuelta a la portada = ${Boolean(e.returnedToMenu)}, se esperaba ${want.returnedToMenu}`);
  if (want.finished !== undefined && (typeof st.completedAt === 'number') !== want.finished) f.push(`partida terminada (completedAt) = ${typeof st.completedAt === 'number'}, se esperaba ${want.finished}`);
  if (want.playTimeMin !== undefined && !((st.playTimeMs ?? 0) >= want.playTimeMin)) f.push(`tiempo jugado ${st.playTimeMs ?? 0} ms, se esperaban al menos ${want.playTimeMin}`);
  return f;
}

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
  if (step.do === 'use' || step.do === 'give') return !(before?.inventory ?? []).includes(step.target);
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
    if (s.do === 'give' && (typeof s.item !== 'string' || typeof s.target !== 'string' || !s.item || !s.target)) {
      out.push(`paso ${i + 1} (${describe(s)}): "give" necesita "item" y "target"`);
    }
    if (s.do === 'pick' && (typeof s.verb !== 'string' || typeof s.item !== 'string' || !s.verb || !s.item)) {
      out.push(`paso ${i + 1} (${describe(s)}): "pick" necesita "verb" e "item"`);
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
    if (s.do === 'mockWeb3' && !(s.web3 === null || s.web3 === 'off' || (typeof s.web3 === 'object' && !Array.isArray(s.web3)))) {
      out.push(`paso ${i + 1} (${describe(s)}): "mockWeb3" lleva "web3": objeto (cartera), null (sin cartera) u "off"`);
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

// ── A0.6: reparto de rutas entre trabajos paralelos del CI (`--shard i/n`, `--only id,…`) ──────────────────────
/** `"2/4"` → `{ index: 2, total: 4 }` (índice desde 1). Lanza si no es `i/n` con 1 ≤ i ≤ n. */
export function parseShard(s) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(s ?? ''));
  const index = m ? Number(m[1]) : NaN;
  const total = m ? Number(m[2]) : NaN;
  if (!m || total < 1 || index < 1 || index > total) throw new Error(`--shard «${s}» no vale: tiene que ser i/n con 1 ≤ i ≤ n (p. ej. 2/4)`);
  return { index, total };
}
/** `"a, b,,c"` → `['a', 'b', 'c']`. */
export const parseOnly = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/**
 * Rutas que le tocan a este trabajo. `routes` es la lista ordenada de todas las rutas de los ficheros pedidos
 * (`{ file, id }`). Reparto por índice global (ruta k → trozo (k mod n) + 1): determinista, cada ruta en un solo
 * trozo y la unión de los n trozos es la lista entera. `only` filtra por id después del reparto (no lo cambia).
 * Devuelve `{ selected, unknown }`: ids de `only` que no existen en los ficheros (un error tipográfico no puede
 * dejar una ruta sin ejecutar en silencio).
 */
export function selectRoutes(routes, { shard = null, only = [] } = {}) {
  const ids = new Set(routes.map((r) => r.id));
  const unknown = only.filter((id) => !ids.has(id));
  const selected = routes.filter((r, k) => (!shard || k % shard.total === shard.index - 1) && (!only.length || only.includes(r.id)));
  return { selected, unknown };
}
// ── fin A0.6 ──────────────────────────────────────────────────────────────────────────────────────────────────

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

// ── A9.5: cortar una ruta (`--until`) — el CI de WebKit juega solo el capítulo 1 de la ruta crítica ─────────────────
/** `"chapter:1"` / `"cap1"` → `{ chapter: 1 }`; `"31"` / `"step:31"` → `{ step: 31 }` (paso desde 1). Lanza si no vale. */
export function parseUntil(s) {
  const t = String(s ?? '').trim().toLowerCase();
  let m = /^(?:chapter|cap(?:itulo)?)[:\s]?(\d+)$/.exec(t);
  if (m && Number(m[1]) >= 1) return { chapter: Number(m[1]) };
  m = /^(?:step:)?(\d+)$/.exec(t);
  if (m && Number(m[1]) >= 1) return { step: Number(m[1]) };
  throw new Error(`--until «${s}» no vale: chapter:<n> (o cap<n>) o el número de paso (desde 1)`);
}
/**
 * La ruta hasta `until`, inclusive, sin copiar pasos a mano. Con `{ chapter: n }` corta en el primer paso cuyo `expect`
 * pide `chapter_<n>_complete: true` (y ese paso es el nuevo objetivo); con `{ step: k }` en el paso k (el objetivo
 * pasa a ser su `expect`, si lo tiene). Solo para rutas `walkthrough`: en un atajo cortar cambiaría su veredicto.
 * Lanza si la ruta no llega a ese punto.
 */
export function cutRoute(route, until) {
  if ((route.kind ?? 'walkthrough') !== 'walkthrough') throw new Error(`--until solo vale con rutas walkthrough («${route.id}» es ${route.kind})`);
  let idx;
  let goal;
  if (until.chapter !== undefined) {
    const flag = `chapter_${until.chapter}_complete`;
    idx = route.steps.findIndex((s) => s.expect?.flags?.[flag] === true);
    if (idx < 0) throw new Error(`la ruta «${route.id}» no tiene ningún paso que compruebe ${flag}: no se puede cortar en el capítulo ${until.chapter}`);
    goal = { flags: { [flag]: true } };
  } else {
    idx = until.step - 1;
    if (idx >= route.steps.length) throw new Error(`la ruta «${route.id}» tiene ${route.steps.length} pasos: no llega al ${until.step}`);
    const e = route.steps[idx].expect;
    goal = e && (e.scene || e.flags || e.has) ? { ...(e.scene ? { scene: e.scene } : {}), ...(e.flags ? { flags: e.flags } : {}), ...(e.has ? { has: e.has } : {}) } : null;
  }
  const label = until.chapter !== undefined ? `hasta el final del capítulo ${until.chapter}` : `hasta el paso ${until.step}`;
  return { ...route, title: `${route.title ?? route.id} (${label}, paso ${idx + 1} de ${route.steps.length})`, goal, steps: route.steps.slice(0, idx + 1) };
}
// ── fin A9.5 ──────────────────────────────────────────────────────────────────────────────────────────────────

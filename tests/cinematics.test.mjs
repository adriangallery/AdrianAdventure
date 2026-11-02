// A2.10 (plan SCUMM): lógica pura del sistema de cinemáticas (src/systems/Cinematics.ts): planificador del salto,
// geometría de letterbox / iris / cortinilla, cámara con zoom y límites, subtítulos y ducking; la banda de subtítulos
// de src/ui/speechLayout.ts; y el modo cinemática y el salto en ScriptEngine con un director falso. Sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/cinematics.test.mjs (va en `npm run test:engine`)
// CINEMATICS_PATH / SCRIPT_ENGINE_PATH / SPEECH_LAYOUT_PATH permiten apuntar a copias ya transpiladas a JS.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const C = await import(process.env.CINEMATICS_PATH ?? '../src/systems/Cinematics.ts');
const { ScriptEngine, WATCHDOG_MS } = await import(process.env.SCRIPT_ENGINE_PATH ?? '../src/systems/ScriptEngine.ts');
const L = await import(process.env.SPEECH_LAYOUT_PATH ?? '../src/ui/speechLayout.ts');

const LAND = { width: 844, height: 390 };
const DESK = { width: 1280, height: 720 };
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ─── Planificador del salto ───────────────────────────────────────────────────────────────────────────────

test('skipActionFor: estado se aplica, cámara/actores al estado final, presentación fuera, fin y stop', () => {
  const act = (op, extra = {}) => C.skipActionFor({ op, ...extra });
  for (const op of ['setFlag', 'addItem', 'removeItem', 'gotoScene', 'fadeToScene', 'achievement', 'setCostume']) assert.equal(act(op), 'state', op);
  // A2.9: una nota del diario es estado (se apunta aunque se salte); una llamada de Anon es presentación
  assert.equal(act('journalNote'), 'state');
  assert.equal(act('callAnon'), 'skip');
  for (const op of ['ifFlag', 'ifHasItem', 'ifVisited', 'ifWalletConnected']) assert.equal(act(op), 'branch', op);
  for (const op of ['cameraPan', 'cameraZoom', 'cameraFollow', 'iris', 'wipe', 'actorMove', 'actorFace', 'actorAnim', 'actorShow', 'actorHide', 'actorTeleport']) {
    assert.equal(act(op), 'instant', op);
  }
  for (const op of ['say', 'sayBrief', 'wait', 'playSound', 'flicker', 'cameraShake', 'titleCard', 'narrative', 'monitorReveal', 'credits', 'loQueSea']) {
    assert.equal(act(op), 'skip', op);
  }
  for (const op of ['dialogue', 'web3Require', 'mintNFT', 'mintAchievement']) assert.equal(act(op), 'run', op);
  assert.equal(act('cinematicEnd'), 'end');
  assert.equal(act('cinematic', { on: false }), 'end');
  assert.equal(act('cinematic', { on: true }), 'instant');
  assert.equal(act('cinematic'), 'instant', 'cinematic sin `on` = abrir');
  assert.equal(act('cinematicStart'), 'instant');
  assert.equal(act('stop'), 'stop');
  assert.equal(C.cinematicModeOf({ op: 'say' }), null);
  for (const op of C.CINEMATIC_OPS) assert.ok(!C.CINEMATIC_MODE_OPS.includes(op));
});

test('planSkip: aplica estado y estados finales hasta el fin de la cinemática; ramas según el estado', () => {
  const ops = [
    { op: 'cameraPan', actor: 'npc' },
    { op: 'say', text: 'hola' },
    { op: 'setFlag', flag: 'a', value: true },
    { op: 'ifFlag', flag: 'a', then: [{ op: 'addItem', id: 'x' }, { op: 'wait', ms: 900 }], else: [{ op: 'addItem', id: 'y' }] },
    { op: 'actorMove', x: 50, y: 90 },
    { op: 'cameraShake' },
    { op: 'cinematicEnd' },
    { op: 'setFlag', flag: 'despues', value: true },
  ];
  const branchOf = (op) => (op.op === 'ifFlag' ? op.then : undefined);
  const plan = C.planSkip(ops, branchOf, 1);
  assert.deepEqual(plan.applied.map((s) => `${s.op.op}:${s.action}`), ['setFlag:state', 'addItem:state', 'actorMove:instant', 'cinematicEnd:end']);
  assert.ok(plan.ended && !plan.stopped);
  assert.ok(!plan.applied.some((s) => s.op.flag === 'despues'), 'lo de después del fin ya no es del salto');

  const stopped = C.planSkip([{ op: 'setFlag', flag: 'a' }, { op: 'ifFlag', then: [{ op: 'stop' }] }, { op: 'addItem', id: 'z' }], (op) => op.then);
  assert.ok(stopped.stopped && !stopped.ended);
  assert.deepEqual(stopped.applied.map((s) => s.op.op), ['setFlag']);
  assert.ok(!C.planSkip([{ op: 'say' }]).ended, 'sin fin explícito: hasta el final del script');
});


// A3.2: las aperturas de outside y del lobby son cinemáticas del onEnter. Saltadas desde el primer op (Esc al momento),
// aplican sus flags y dejan a los actores en su estado final: lo mismo que vistas enteras.
test('aperturas (A3.2): saltadas desde el principio dejan flags, Dex y la cámara como vistas enteras', async () => {
  const fs = await import('node:fs');
  const scene = (id) => JSON.parse(fs.readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
  const opening = (id, flag) => {
    const first = scene(id).onEnter[0];
    assert.equal(first.op, 'ifFlag');
    assert.equal(first.flag, flag);
    return first.else;
  };
  const out = opening('outside', 'premise_shown');
  assert.equal(C.cinematicModeOf(out[0]), 'start');
  assert.equal(C.cinematicModeOf(out[out.length - 1]), 'end');
  const plan = C.planSkip(out, () => undefined, 1);
  assert.ok(plan.ended && !plan.stopped);
  const flags = plan.applied.filter((a) => a.op.op === 'setFlag').map((a) => a.op.flag);
  assert.deepEqual(flags.sort(), ['chapter_1_intro_shown', 'premise_shown']);
  // Dex acaba donde acaba andando (el último actorMove) y mirando a la izquierda
  const moves = plan.applied.filter((a) => a.op.op === 'actorMove').map((a) => a.op);
  assert.deepEqual({ x: moves.at(-1).x, y: moves.at(-1).y }, { x: 39, y: 93 });
  assert.equal(plan.applied.filter((a) => a.op.op === 'actorFace').at(-1).op.dir, 'left');
  // Narrador ≤ 3 líneas (biblia § 3) y nadie dice quién es Patient Zero
  const says = out.filter((o) => o.op === 'say');
  assert.ok(says.filter((o) => /narrator/i.test(o.speaker ?? '')).length <= 3);
  assert.ok(!out.some((o) => o.op === 'narrative'), 'sin muro de texto (narrative)');
  assert.ok(!scene('outside').regions.triggers.some((t) => t.id === 'tr_game_opening'), 'una sola fuente del guion');

  const lob = opening('lobby', 'chapter_2_intro_shown');
  const lplan = C.planSkip(lob, () => undefined, 1);
  assert.ok(lplan.ended);
  assert.deepEqual(lplan.applied.filter((a) => a.op.op === 'setFlag').map((a) => a.op.flag), ['chapter_2_intro_shown']);
  assert.ok(lob.some((o) => o.op === 'cameraPan' && o.actor === 'npc_receptionist'), 'pan a Penny');
  assert.ok(lob.filter((o) => o.op === 'say' && /narrator/i.test(o.speaker ?? '')).length <= 3);
  assert.equal(C.TITLE_CARD_AUTO_MS > 0, true);
});

// ─── Letterbox ────────────────────────────────────────────────────────────────────────────────────────────

test('letterboxBars: franja superior del 10 % (24–64 px) y la inferior tapa el panel', () => {
  assert.deepEqual(C.letterboxBars(LAND, 100), { top: 39, bottom: 100 });
  assert.deepEqual(C.letterboxBars(DESK, 180), { top: 64, bottom: 180 });
  assert.deepEqual(C.letterboxBars(LAND, 0), { top: 39, bottom: 39 }, 'sin panel, simétricas');
  assert.deepEqual(C.letterboxBars({ width: 300, height: 120 }, 0), { top: 24, bottom: 24 });
  const tiny = C.letterboxBars({ width: 200, height: 60 }, 500);
  assert.ok(tiny.top <= 15 && tiny.bottom <= 30, 'nunca más de un cuarto arriba ni media pantalla abajo');
  assert.deepEqual(C.letterboxAt({ top: 40, bottom: 100 }, 0.5), { top: 20, bottom: 50 });
  assert.deepEqual(C.letterboxAt({ top: 40, bottom: 100 }, 7), { top: 40, bottom: 100 });
});

// ─── Iris y cortinilla ────────────────────────────────────────────────────────────────────────────────────

/** ¿Está p dentro del cuadrilátero convexo q (o en su borde)? */
function inConvex(p, q) {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

test('iris: radio máximo, radio en el tiempo y negro sin huecos fuera del agujero', () => {
  const c = { x: 600, y: 100 };
  const maxR = C.irisMaxRadius(c, LAND);
  assert.ok(close(maxR, Math.hypot(600, 290)), 'distancia a la esquina más lejana');
  assert.equal(C.irisRadiusAt('out', 0, maxR), maxR);
  assert.equal(C.irisRadiusAt('out', 1, maxR), 0);
  assert.equal(C.irisRadiusAt('in', 0, maxR), 0);
  assert.ok(close(C.irisRadiusAt('in', 0.5, maxR), maxR / 2));

  const r = 60;
  const quads = C.irisQuads(c, r, maxR, 32);
  assert.equal(quads.length, 32);
  const covered = (p) => quads.some((q) => inConvex(p, q));
  // Toda la pantalla fuera del agujero (con margen por el polígono) está tapada; dentro del radio no
  for (let x = 0; x <= LAND.width; x += 37) {
    for (let y = 0; y <= LAND.height; y += 29) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d > r + 1) assert.ok(covered({ x, y }), `tapa (${x},${y})`);
      if (d < r * Math.cos(Math.PI / 32) - 1) assert.ok(!covered({ x, y }), `deja ver (${x},${y})`);
    }
  }
  for (const corner of [{ x: 0, y: 0 }, { x: 844, y: 0 }, { x: 0, y: 390 }, { x: 844, y: 390 }]) assert.ok(covered(corner));
});

test('wipeRect: cuatro direcciones, cubrir y destapar', () => {
  const vp = { width: 800, height: 400 };
  // out: entra por el lado contrario a `dir` y cubre todo al final
  assert.deepEqual(C.wipeRect('out', 'left', 0.25, vp), { x: 600, y: 0, w: 200, h: 400 });
  assert.deepEqual(C.wipeRect('out', 'right', 0.25, vp), { x: 0, y: 0, w: 200, h: 400 });
  assert.deepEqual(C.wipeRect('out', 'up', 0.5, vp), { x: 0, y: 200, w: 800, h: 200 });
  assert.deepEqual(C.wipeRect('out', 'down', 0.5, vp), { x: 0, y: 0, w: 800, h: 200 });
  for (const dir of ['left', 'right', 'up', 'down']) {
    assert.deepEqual(C.wipeRect('out', dir, 1, vp), { x: 0, y: 0, w: 800, h: 400 }, `out ${dir} acaba cubriendo`);
    const done = C.wipeRect('in', dir, 1, vp);
    assert.equal(done.w * done.h, 0, `in ${dir} acaba destapado`);
    const start = C.wipeRect('in', dir, 0, vp);
    assert.equal(start.w * start.h, 800 * 400, `in ${dir} empieza cubierto`);
  }
  // in: el borde sigue avanzando en la misma dirección (left: se destapa por la derecha)
  assert.deepEqual(C.wipeRect('in', 'left', 0.25, vp), { x: 0, y: 0, w: 600, h: 400 });
  assert.deepEqual(C.wipeRect('in', 'right', 0.25, vp), { x: 200, y: 0, w: 600, h: 400 });
});

test('parseTransition: cadena u objeto; lo que no se entiende es el fundido de siempre (null)', () => {
  assert.deepEqual(C.parseTransition('iris'), { type: 'iris' });
  assert.deepEqual(C.parseTransition({ type: 'wipe', dir: 'up', ms: 300 }), { type: 'wipe', dir: 'up', ms: 300 });
  assert.deepEqual(C.parseTransition({ type: 'iris', at: { x: 20, y: 80 } }), { type: 'iris', at: { x: 20, y: 80 } });
  assert.deepEqual(C.parseTransition({ type: 'iris', at: 'npc_receptionist', dir: 'diagonal', ms: -1 }), { type: 'iris', at: 'npc_receptionist' });
  assert.equal(C.parseTransition('spin'), null);
  assert.equal(C.parseTransition({ type: 'spin' }), null);
  assert.equal(C.parseTransition(undefined), null);
});

// ─── Cámara ───────────────────────────────────────────────────────────────────────────────────────────────

test('cameraScrollFor: centra el punto en la zona entre franjas y no se sale del fondo', () => {
  const view = { width: 844, height: 390, top: 39, bottom: 100 };
  // Lobby en 844×390 (panel 100): fondo 3712×1152 contenido en 844×290 → 844×262 en y = 14
  const bounds = { x: 0, y: 14, w: 844, h: 262 };
  // Zoom 1: el fondo entero cabe a lo ancho → centrado en x (scroll 0) aunque el foco esté a la izquierda
  const z1 = C.cameraScrollFor({ x: 100, y: 150 }, 1, view, bounds);
  assert.ok(close(z1.scrollX, 0));
  // Zoom 2 hacia la recepcionista (24 % del ancho): se acerca a ella pero sin enseñar nada a la izquierda del fondo
  const target = { x: 0.242 * 844, y: 14 + 0.5 * 262 };
  const z2 = C.cameraScrollFor(target, 2, view, bounds);
  const cam2 = { scrollX: z2.scrollX, scrollY: z2.scrollY, zoom: 2, width: 844, height: 390 };
  const leftEdge = C.worldToScreen({ x: 0, y: 0 }, cam2);
  assert.ok(close(leftEdge.x, 0, 1e-6), 'el borde izquierdo del fondo queda pegado al de la pantalla');
  // Sin límites, el foco queda exactamente en el centro de la zona visible
  const free = C.cameraScrollFor(target, 2, view, null);
  const centre = C.worldToScreen(target, { ...free, zoom: 2, width: 844, height: 390 });
  assert.ok(close(centre.x, 422) && close(centre.y, (39 + 290) / 2));
  // Ida y vuelta: el foco que se lee de un scroll es el que lo produjo
  const back = C.cameraFocusOf(free, 2, view);
  assert.ok(close(back.x, target.x) && close(back.y, target.y));
  // Visible más grande que los límites: centrados
  assert.ok(close(C.axisScroll(5, 0, 100, 100, 1, 0, 50), -25));
  // Zoom fuera de rango se acota
  assert.equal(C.clampZoom(99), C.ZOOM_MAX);
  assert.equal(C.clampZoom('x'), 1);
});

test('worldToScreen con zoom 1 es restar el scroll', () => {
  assert.deepEqual(C.worldToScreen({ x: 500, y: 200 }, { scrollX: 100, scrollY: 20, zoom: 1, width: 844, height: 390 }), { x: 400, y: 180 });
  const z = C.worldToScreen({ x: 422, y: 195 }, { scrollX: 0, scrollY: 0, zoom: 3, width: 844, height: 390 });
  assert.deepEqual(z, { x: 422, y: 195 }, 'el centro de la cámara no se mueve con el zoom');
});

test('easeName, durationOf, slideDurationMs', () => {
  assert.equal(C.easeName(undefined), 'Sine.easeInOut');
  assert.equal(C.easeName('linear'), 'Linear');
  assert.equal(C.easeName('Back.easeOut'), 'Back.easeOut');
  assert.equal(C.durationOf({ op: 'x', ms: 250 }, 1000), 250);
  assert.equal(C.durationOf({ op: 'x', ms: -5 }, 1000), 1000);
  assert.equal(C.durationOf({ op: 'x' }, 1000), 1000);
  // 12 % de alto a 12 %/s = 1 s; en x se corrige con el aspecto del fondo
  assert.equal(C.slideDurationMs({ x: 0, y: 0 }, { x: 0, y: 12 }, 12), 1000);
  assert.equal(C.slideDurationMs({ x: 0, y: 0 }, { x: 4, y: 0 }, 12, 3), 1000);
  assert.equal(C.slideDurationMs({ x: 0, y: 0 }, { x: 4, y: 0 }, 0), 0);
});

// ─── Subtítulos y música ──────────────────────────────────────────────────────────────────────────────────

test('subtitleHoldMs: sigue a la voz si la hay; si no, escribir + leer (mínimo 1,5 s)', () => {
  assert.equal(C.subtitleHoldMs(80, 25, 4200), 4200 + C.VOICE_TAIL_MS);
  assert.equal(C.subtitleHoldMs(10, 0, null), C.SUBTITLE_MIN_MS);
  assert.equal(C.subtitleHoldMs(60, 25, null), 60 * 25 + 60 * C.READ_MS_PER_CHAR + 600);
  assert.ok(C.subtitleHoldMs(60, 45, null) > C.subtitleHoldMs(60, 10, null), 'texto lento = más tiempo');
  assert.equal(C.subtitleHoldMs(60, 25, 0), C.subtitleHoldMs(60, 25, null), 'un clip sin duración cuenta como sin voz');
});

test('ducking: 35 % con alguna fuente, 100 % sin ninguna, fundido de 200 ms', () => {
  assert.equal(C.duckGainFor(new Set()), 1);
  assert.equal(C.duckGainFor(new Set(['voice'])), 0.35);
  assert.equal(C.duckGainFor(new Set(['voice', 'cinematic'])), 0.35);
  assert.equal(C.DUCK_FADE_MS, 200);
});

test('speechLayout: en cinemática quien no se ve habla en la franja inferior; sobre la cabeza no pisa las franjas', () => {
  const band = { top: 39, bottom: 100 };
  const off = L.placeSpeech({ head: null, vp: LAND, textW: 300, textH: 40, band });
  assert.equal(off.mode, 'band');
  assert.ok(off.y >= LAND.height - band.bottom && off.y + 40 <= LAND.height, 'dentro de la franja');
  assert.equal(L.placeSpeech({ head: null, vp: LAND, textW: 300, textH: 40 }).mode, 'top', 'sin cinemática, arriba como siempre');
  // Cabeza muy arriba: el texto baja hasta debajo de la franja superior
  const high = L.placeSpeech({ head: { x: 400, headY: 20, footY: 200 }, vp: LAND, textW: 200, textH: 40, band });
  assert.equal(high.mode, 'head');
  assert.ok(high.y >= band.top, 'no se mete en la franja superior');
  // Cabeza muy abajo: no baja a la franja inferior
  const low = L.placeSpeech({ head: { x: 400, headY: 330, footY: 380 }, vp: LAND, textW: 200, textH: 40, band });
  assert.ok(low.y + 40 <= LAND.height - band.bottom);
  assert.equal(L.speechWrapWidth(LAND, 'band'), L.speechWrapWidth(LAND, 'top'));
  assert.ok(L.bandY(LAND, 100, 200) + 200 <= LAND.height || L.bandY(LAND, 100, 200) >= LAND.height - 100);
});

// ─── ScriptEngine: modo cinemática y salto ────────────────────────────────────────────────────────────────

/** Contexto de prueba con un director falso: los ops de cámara/actor duran hasta `finishAll` (o se piden al momento). */
function makeCtx() {
  let gameState = { flags: {}, inventory: [], visited: [], achievements: [] };
  const log = [];
  const says = [];
  const pending = new Set();
  const cinema = {
    handles: (name) => C.CINEMATIC_OPS.includes(name),
    skipAction: (op) => C.skipActionFor(op),
    begin: () => log.push('begin'),
    end: (opts) => log.push(`end instant=${opts.instant} skipped=${opts.skipped}`),
    run: (op, instant) => {
      log.push(`run ${op.op}${instant ? ' (al momento)' : ''}`);
      if (instant) return Promise.resolve();
      return new Promise((resolve) => pending.add(resolve));
    },
    finishAll: () => {
      log.push('finishAll');
      for (const r of pending) r();
      pending.clear();
      // El salto cierra el texto en pantalla
      for (const s of says.splice(0)) s.resolve();
    },
  };
  const ctx = {
    log, says, pending, cinema,
    getState: () => gameState,
    setState: (u) => { gameState = u(gameState); },
    say(text) { log.push(`say ${text}`); return new Promise((resolve) => says.push({ text, resolve })); },
    gotoScene(id, _spawn, transition) { log.push(`goto ${id}${transition ? ` ${transition.type}` : ''}`); },
    addItem(id, name) { log.push(`addItem ${id}`); gameState = { ...gameState, inventory: [...gameState.inventory, { id, name }] }; },
    removeItem(id) { log.push(`removeItem ${id}`); },
    showAchievement(text) { log.push(`achievement ${text}`); },
    playSound(key) { log.push(`sound ${key}`); },
    parseTransition: C.parseTransition,
  };
  return ctx;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('salto: estado aplicado, cámara/actores al momento, presentación omitida y lo de después normal', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  const ops = [
    { op: 'cinematicStart' },
    { op: 'cameraPan', actor: 'npc_receptionist' },
    { op: 'say', text: 'uno' },
    { op: 'setFlag', flag: 'f', value: true },
    { op: 'actorMove', x: 50, y: 92 },
    { op: 'wait', ms: 60_000 },
    { op: 'addItem', id: 'key', name: 'Key' },
    { op: 'ifFlag', flag: 'f', then: [{ op: 'setFlag', flag: 'g', value: true }, { op: 'say', text: 'en rama' }] },
    { op: 'cameraShake', ms: 300 },
    { op: 'cinematic', on: false },
    { op: 'setFlag', flag: 'despues', value: true },
    { op: 'say', text: 'tras la cinemática' },
  ];
  const done = engine.execute(ops, 'prueba');
  await tick();
  assert.ok(engine.inCinematic());
  assert.deepEqual(ctx.log, ['begin', 'run cameraPan']);
  assert.ok(engine.skipCinematic());
  assert.ok(!engine.skipCinematic(), 'saltar dos veces no hace nada');
  await tick(10);
  // El say de después del fin se enseña normal y espera al jugador
  assert.equal(ctx.says.length, 1);
  assert.equal(ctx.says[0].text, 'tras la cinemática');
  ctx.says[0].resolve();
  await done;
  assert.deepEqual(ctx.log, [
    'begin', 'run cameraPan', 'finishAll',
    'run actorMove (al momento)',
    'addItem key',
    'end instant=true skipped=true',
    'say tras la cinemática',
  ]);
  const st = ctx.getState();
  assert.deepEqual(st.flags, { f: true, g: true, despues: true });
  assert.deepEqual(st.inventory.map((i) => i.id), ['key']);
  assert.ok(!engine.inCinematic() && !engine.isRunning());
});

test('sin salto: los ops van al director en orden y el fin cierra la cinemática sin prisa', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([
    { op: 'cinematic', on: true },
    { op: 'cameraZoom', zoom: 2 },
    { op: 'cinematicEnd' },
    { op: 'fadeToScene', sceneId: 'upstairs', transition: 'iris' },
  ]);
  await tick();
  assert.deepEqual(ctx.log, ['begin', 'run cameraZoom']);
  for (const r of ctx.pending) r();
  await done;
  assert.deepEqual(ctx.log, ['begin', 'run cameraZoom', 'end instant=false skipped=false', 'goto upstairs iris']);
});

test('una cinemática sin fin se cierra al acabar su script; forceReset la cierra al momento', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  await engine.execute([{ op: 'cinematicStart' }, { op: 'setFlag', flag: 'x', value: true }]);
  assert.deepEqual(ctx.log, ['begin', 'end instant=false skipped=false']);

  const ctx2 = makeCtx();
  const e2 = new ScriptEngine(ctx2);
  const p = e2.execute([{ op: 'cinematicStart' }, { op: 'say', text: 'colgado' }, { op: 'setFlag', flag: 'y', value: true }]);
  await tick();
  e2.forceReset('prueba');
  await p;
  assert.ok(ctx2.log.includes('end instant=true skipped=false'));
  assert.equal(ctx2.getState().flags.y, true, 'el rescate sigue aplicando el estado');
  assert.ok(!e2.inCinematic());
});

test('watchdog: un op de cámara o actor largo no es un cuelgue; sin director los ops de cinemática no rompen', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  const p = engine.execute([{ op: 'cinematicStart' }, { op: 'actorMove', x: 10, y: 90 }]);
  await tick();
  for (let t = 0; t < WATCHDOG_MS * 2; t += 1000) assert.equal(engine.watchdogTick(1000, false), false);
  assert.ok(engine.isRunning());
  engine.skipCinematic();
  await p;

  const bare = makeCtx();
  delete bare.cinema;
  const e3 = new ScriptEngine(bare);
  await e3.execute([{ op: 'cinematicStart' }, { op: 'setFlag', flag: 'z', value: true }, { op: 'cinematicEnd' }]);
  assert.equal(bare.getState().flags.z, true);
  assert.ok(!e3.inCinematic());
});

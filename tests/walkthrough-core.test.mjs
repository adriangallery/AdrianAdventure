// A0.5 (plan SCUMM): pruebas de la lógica pura del runner de walkthrough (sin navegador ni node_modules).
// node --test tests/walkthrough-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attemptIndex, check, checkAttemptRan, checkListenerGrowth, checkRejects, classify, describe, kindOf, newLogLines,
  routeDefects, selftestDefects, selftestMismatch,
} from '../scripts/lib/walkthrough-core.mjs';

const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const st = (extra = {}) => ({ scene: 'outside', inventory: [], flags: {}, visited: [], achievements: [], log: [], logTotal: 0, actions: 0, ...extra });
const sb = (steps, extra = {}) => ({ id: 'r', kind: 'sequence-break', goal: { scene: 'lobby' }, steps, ...extra });
const NEW = { do: 'newGame', expect: { scene: 'outside' } };
const KEYPAD = { do: 'act', verb: 'USE', target: 'hs_keypad', attempt: true, rejects: 'INVALID' };
const WALK_TR = { do: 'walk', x: 70, y: 95, trigger: 'tr_x', untilScene: 'lobby' };

test('check: escena, inventario, flags, visitados y logros', () => {
  const s = st({ inventory: ['a'], flags: { f: true }, visited: ['outside'], achievements: ['x'] });
  assert.deepEqual(check({ scene: 'outside', has: ['a'], lacks: ['b'], flags: { f: true, g: false }, visited: ['outside'], achievements: ['x'] }, s), []);
  assert.equal(check({ scene: 'lobby', has: ['b'], lacks: ['a'], flags: { f: false } }, s).length, 4);
  assert.deepEqual(check(undefined, s), []);
  assert.deepEqual(check({ scene: 'x' }, null), ['sin estado del juego']);
});

test('kindOf: [qa:blocked] es bloqueo; lo demás, error', () => {
  assert.equal(kindOf('[qa:blocked] no tengo «x»'), 'blocked');
  assert.equal(kindOf('[qa:error] el ratón no puede pulsar «x»'), 'error');
  assert.equal(kindOf('TypeError: boom'), 'error');
});

test('attemptIndex: el paso con attempt o el último', () => {
  assert.equal(attemptIndex(sb([NEW, { ...KEYPAD, attempt: undefined }])), 1);
  assert.equal(attemptIndex(sb([NEW, { ...WALK_TR, attempt: true, expect: {} }, { do: 'wait', ms: 1 }])), 1);
});

test('routeDefects: goto rechazado en walkthrough y sequence-break salvo allowGoto del selftest', () => {
  const wt = { id: 'w', steps: [NEW, { do: 'goto', scene: 'lobby', expect: { scene: 'lobby' } }] };
  assert.match(routeDefects(wt).join(), /paso 2 \(GOTO lobby\): "goto" se salta puertas y gates/);
  assert.deepEqual(routeDefects(wt, { allowGoto: true }), []);
  const seq = sb([NEW, { do: 'goto', scene: 'lobby', expect: { scene: 'lobby' } }, KEYPAD]);
  assert.equal(routeDefects(seq).length, 1);
  assert.deepEqual(routeDefects(seq, { allowGoto: true }), []);
});

test('routeDefects: sequence-break bien definida no tiene defectos', () => {
  assert.deepEqual(routeDefects(sb([NEW, KEYPAD])), []);
  assert.deepEqual(routeDefects(sb([NEW, { ...KEYPAD, rejects: undefined, expect: { scene: 'outside' } }])), []);
  // walk con trigger y untilScene: pisar el trigger ya es el rechazo observable
  assert.deepEqual(routeDefects(sb([NEW, { ...WALK_TR, attempt: true }])), []);
});

test('routeDefects: sequence-break mal definida', () => {
  assert.match(routeDefects(sb([NEW, KEYPAD], { goal: undefined })).join(), /falta "goal"/);
  assert.match(routeDefects(sb([])).join(), /no tiene pasos/);
  assert.match(routeDefects(sb([{ ...NEW, attempt: true }, KEYPAD])).join(), /más de un paso con "attempt"/);
  assert.match(routeDefects(sb([{ do: 'newGame' }, KEYPAD])).join(), /paso 1 \(newGame\): los pasos anteriores al intento necesitan "expect"/);
  const noEvidence = routeDefects(sb([NEW, { ...KEYPAD, rejects: undefined }]));
  assert.match(noEvidence.join(), /paso 2 \(USE hs_keypad\): el intento necesita "expect" o "rejects"/);
  // walk sin trigger en el intento: no hay rechazo observable
  assert.match(routeDefects(sb([NEW, { do: 'walk', x: 1, y: 1, untilScene: 'lobby', attempt: true }])).join(), /el intento necesita/);
});

test('newLogLines / checkRejects: solo cuentan los textos del paso', () => {
  const before = st({ log: ['«viejo INVALID»'], logTotal: 1 });
  const after = st({ log: ['«viejo INVALID»', 'USE hs_keypad', '«BZZZ INVALID CODE»'], logTotal: 3 });
  assert.deepEqual(newLogLines(before, after), ['USE hs_keypad', '«BZZZ INVALID CODE»']);
  assert.deepEqual(checkRejects({ rejects: 'invalid code' }, before, after), []);
  const same = st({ log: ['«viejo INVALID»'], logTotal: 1 });
  assert.match(checkRejects({ rejects: 'INVALID' }, before, same).join(), /no apareció el rechazo \/INVALID\/ \(textos del paso: ninguno\)/);
  assert.deepEqual(checkRejects({}, before, same), []);
  // log circular: logTotal manda aunque el array no crezca
  const full = st({ log: ['b', 'c', '«nuevo»'], logTotal: 61 });
  assert.deepEqual(newLogLines(st({ logTotal: 60 }), full), ['«nuevo»']);
});

test('checkAttemptRan: el intento tiene que llegar a ejecutarse (player:arrived)', () => {
  const act = { do: 'act', verb: 'USE', target: 'hs_door' };
  assert.deepEqual(checkAttemptRan(act, st({ actions: 3 }), st({ actions: 4 })), []);
  assert.match(checkAttemptRan(act, st({ actions: 3 }), st({ actions: 3 })).join(), /no llegó a ejecutarse \(no saltó player:arrived/);
  // use con un objeto del inventario es combinar, no hay clic en la escena
  assert.deepEqual(checkAttemptRan({ do: 'use', item: 'a', target: 'b' }, st({ inventory: ['a', 'b'] }), st()), []);
  assert.equal(checkAttemptRan({ do: 'use', item: 'a', target: 'hs' }, st({ inventory: ['a'] }), st()).length, 1);
  assert.deepEqual(checkAttemptRan({ do: 'walk', x: 1, y: 1 }, st(), st()), []);
  // sin contador (API antigua) no se puede saber: no se exige
  assert.deepEqual(checkAttemptRan(act, { inventory: [] }, {}), []);
});

const run = (stopped, extra = {}) => ({ stopped, goalReached: false, problems: [], stepLabel: (i) => `paso-${i}`, ...extra });

test('classify walkthrough: pass, fail por paso, fail sin objetivo, fail por errores del juego', () => {
  const wt = { id: 'w', goal: { has: ['x'] }, steps: [NEW] };
  assert.deepEqual(classify(wt, run(null, { goalReached: true })), { status: 'pass', detail: '' });
  assert.deepEqual(classify(wt, run({ kind: 'error', index: 1, message: '[qa:error] m' })), { status: 'fail', detail: 'paso 1: [qa:error] m' });
  assert.deepEqual(classify(wt, run(null, { goalFails: ['falta «x»'] })), { status: 'fail', detail: 'sin objetivo: falta «x»' });
  const r = classify(wt, run(null, { goalReached: true, problems: ['console.error: boom'] }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /1 error\(es\) del juego: console.error: boom/);
});

test('classify sequence-break: atajo abierto → FAIL o XFAIL, aunque falle el expect del intento', () => {
  const route = sb([NEW, KEYPAD]);
  assert.deepEqual(classify(route, run(null, { goalReached: true })), { status: 'fail', detail: 'atajo abierto: se llega antes de tiempo' });
  assert.deepEqual(classify({ ...route, knownBreak: 'A1.2' }, run(null, { goalReached: true })), { status: 'xfail', detail: 'atajo abierto, conocido: lo cierra A1.2' });
  // un [qa:error] manda sobre todo
  assert.equal(classify(route, run({ kind: 'error', index: 2, message: 'x' }, { goalReached: true })).status, 'error');
});

test('classify sequence-break: cerrado por [qa:blocked] en el intento → PASS o XPASS', () => {
  const route = sb([NEW, { ...WALK_TR, attempt: true }]);
  const blocked = { kind: 'blocked', index: 2, message: '[qa:blocked] llegó a tr_x' };
  assert.deepEqual(classify(route, run(blocked)), { status: 'pass', detail: 'cerrado (paso 2 (intento): [qa:blocked] llegó a tr_x)' });
  const x = classify({ ...route, knownBreak: 'A1.2' }, run(blocked));
  assert.equal(x.status, 'xpass');
  assert.match(x.detail, /quita "knownBreak"/);
  // el intento acaba sin objetivo ni tropiezo (expect/rejects cumplidos) → cerrado
  assert.match(classify(sb([NEW, KEYPAD]), run(null)).detail, /^cerrado \(el intento \(paso 2\) terminó sin cumplir/);
});

test('classify sequence-break: cerrado por un gate (bloqueo o comprobación)', () => {
  const route = sb([NEW, { ...WALK_TR, gate: true, expect: { scene: 'lobby' } }, KEYPAD]);
  assert.match(classify(route, run({ kind: 'blocked', index: 2, message: 'b' })).detail, /^cerrado \(paso 2 \(gate\): b\)/);
  assert.equal(classify(route, run({ kind: 'assert', index: 2, message: 'a' })).status, 'pass');
  assert.equal(classify(route, run({ kind: 'error', index: 2, message: 'e' })).status, 'error');
});

test('classify sequence-break: el intento sin rechazo observable es ERROR, no cerrado', () => {
  const route = sb([NEW, KEYPAD]);
  const r = classify(route, run({ kind: 'assert', index: 2, message: 'no apareció el rechazo /INVALID/' }));
  assert.equal(r.status, 'error');
  assert.match(r.detail, /^paso 2 \(intento\): no hubo un rechazo observable/);
  const ran = classify(route, run({ kind: 'assert', index: 2, message: 'la acción del intento no llegó a ejecutarse' }));
  assert.equal(ran.status, 'error');
  // con knownBreak tampoco es XPASS
  assert.equal(classify({ ...route, knownBreak: 'A1.2' }, run({ kind: 'assert', index: 2, message: 'm' })).status, 'error');
});

test('classify sequence-break: tropiezo en la preparación → ERROR', () => {
  const route = sb([NEW, { ...WALK_TR, expect: { scene: 'lobby' } }, KEYPAD]);
  const blocked = classify(route, run({ kind: 'blocked', index: 2, message: '[qa:blocked] llegó a tr_x' }));
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.detail, 'paso de preparación 2 (paso-2) no salió como se esperaba, así que el atajo no se llegó a intentar: [qa:blocked] llegó a tr_x');
  assert.match(classify(route, run({ kind: 'assert', index: 1, message: 'falta «k»' })).detail, /^paso de preparación 1/);
  assert.equal(classify(route, run({ kind: 'error', index: 0, message: 'sin __qa' })).detail, 'paso 0: sin __qa');
});

test('selftestMismatch / selftestDefects', () => {
  const route = { expectStatus: 'error', expectDetail: '^ruta mal definida' };
  assert.equal(selftestMismatch(route, { status: 'error', detail: 'ruta mal definida: x' }), null);
  assert.equal(selftestMismatch(route, { status: 'pass', detail: 'ruta mal definida' }), 'salió PASS, se esperaba ERROR');
  assert.equal(selftestMismatch(route, { status: 'error', detail: 'otra cosa' }), 'el detalle no casa con /^ruta mal definida/');
  assert.equal(selftestMismatch({ expectStatus: 'pass' }, { status: 'pass', detail: 'lo que sea' }), null);
  assert.match(selftestDefects({}).join(), /"expectStatus" debe ser uno de pass\/fail\/xfail\/xpass\/error/);
  assert.match(selftestDefects({ expectStatus: 'pass', expectDetail: '(' }).join(), /no es una expresión regular válida/);
  assert.match(selftestMismatch({ expectStatus: 'ok' }, { status: 'pass', detail: '' }), /ruta del selftest mal definida/);
});

test('qa/selftest.json: cada ruta dice su resultado y cubre todas las clasificaciones', () => {
  const spec = readJson('qa/selftest.json');
  const ids = new Set();
  for (const r of spec.routes) {
    assert.ok(!ids.has(r.id), `id repetido ${r.id}`);
    ids.add(r.id);
    assert.deepEqual(selftestDefects(r), [], r.id);
  }
  const statuses = new Set(spec.routes.map((r) => r.expectStatus));
  for (const s of ['pass', 'fail', 'xfail', 'xpass', 'error']) assert.ok(statuses.has(s), `ninguna ruta espera ${s}`);
});

test('qa/selftest.json: las rutas que esperan «ruta mal definida» lo son, y el resto no', () => {
  for (const r of readJson('qa/selftest.json').routes) {
    const defects = routeDefects(r, { allowGoto: r.allowGoto === true });
    if (/^\^?ruta mal definida/.test(r.expectDetail ?? '')) {
      const result = { status: 'error', detail: `ruta mal definida: ${defects.join('; ')}` };
      assert.ok(defects.length, `${r.id} debería tener defectos`);
      assert.equal(selftestMismatch(r, result), null, r.id);
    } else {
      assert.deepEqual(defects, [], r.id);
    }
  }
});

test('las rutas reales (walkthrough y atajos) siguen bien definidas', () => {
  for (const file of ['qa/walkthrough.json', 'qa/sequence-breaks.json']) {
    for (const r of readJson(file).routes) assert.deepEqual(routeDefects(r), [], `${file} · ${r.id}`);
  }
});

test('A1.10: noListenerGrowth compara los listeners de resize con los del primer paso', () => {
  const exp = { scene: 'rooftop', noListenerGrowth: true };
  assert.deepEqual(check(exp, st({ scene: 'rooftop', resizeListeners: 9 }), { listenersBaseline: 9 }), []);
  assert.deepEqual(check(exp, st({ scene: 'rooftop', resizeListeners: 8 }), { listenersBaseline: 9 }), [], 'bajar no es fuga');
  const grown = check(exp, st({ scene: 'rooftop', resizeListeners: 18 }), { listenersBaseline: 9 });
  assert.equal(grown.length, 1);
  assert.match(grown[0], /18, tras el primer paso había 9/);
  assert.match(check(exp, st({ scene: 'rooftop' }), { listenersBaseline: 9 })[0], /no expone `resizeListeners`/);
  assert.match(check(exp, st({ scene: 'rooftop', resizeListeners: 9 }))[0], /sin recuento de referencia/);
  assert.deepEqual(check({ scene: 'rooftop' }, st({ scene: 'rooftop', resizeListeners: 99 }), { listenersBaseline: 1 }), [], 'sin la clave no se mira');
  assert.deepEqual(checkListenerGrowth({ resizeListeners: 3 }, 3), []);
});

test('A1.10: resize necesita width y height enteros positivos', () => {
  const wt = (step) => ({ id: 'w', steps: [NEW, step] });
  assert.deepEqual(routeDefects(wt({ do: 'resize', width: 844, height: 390 })), []);
  assert.equal(describe({ do: 'resize', width: 844, height: 390 }), 'RESIZE 844x390');
  for (const bad of [{ width: 844 }, { width: 0, height: 390 }, { width: '844', height: 390 }, { width: 844.5, height: 390 }]) {
    const d = routeDefects(wt({ do: 'resize', ...bad }));
    assert.equal(d.length, 1, JSON.stringify(bad));
    assert.match(d[0], /"resize" necesita "width" y "height"/);
  }
});

test('A1.10: la ruta crítica comprueba los listeners de resize tras varios cambios de escena', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica');
  const checks = route.steps.filter((s) => s.do === 'resize' && s.expect?.noListenerGrowth);
  assert.ok(checks.length >= 2, 'al menos una redimensión con noListenerGrowth');
});

// A0.5 (plan SCUMM): pruebas de la lógica pura del runner de walkthrough (sin navegador ni node_modules).
// node --test tests/walkthrough-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attemptIndex, check, checkAttemptRan, checkCinematic, checkFailResponse, checkHighlighted, checkJournal, checkLastChoices, checkListenerGrowth, checkRejects, checkWalkTarget, classify,
  describe, kindOf, newLogLines, routeDefects, runScriptDefects, selftestDefects, selftestMismatch, tapsScene,
  checkPixel, notePixel, checkAnim, checkNpc, checkAudio,
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
  // A1.4: unsetFlags distingue «nunca escrita» de «escrita a false»
  assert.deepEqual(check({ unsetFlags: ['nunca'] }, s), []);
  assert.deepEqual(check({ unsetFlags: ['g'], flags: { g: false } }, st({ flags: { g: false } })), ['flag g = false escrita en la partida, se esperaba sin escribir']);
  assert.deepEqual(check(undefined, s), []);
  assert.deepEqual(check({ scene: 'x' }, null), ['sin estado del juego']);
});

test('check: expect.facing (A2.2) compara la orientación del personaje', () => {
  assert.deepEqual(check({ facing: 'left' }, st({ facing: 'left' })), []);
  assert.deepEqual(check({ facing: 'back' }, st({ facing: 'left' })), ['el personaje mira «left», se esperaba «back»']);
  // API de QA anterior a A2.2: sin `facing` en el estado es un fallo claro, no un pase silencioso
  assert.deepEqual(check({ facing: 'front' }, st()), ['el juego no expone `facing` en state() (API de QA anterior a A2.2)']);
  // Sin expect.facing no se mira
  assert.deepEqual(check({ scene: 'outside' }, st({ facing: 'right' })), []);
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

test('A2.6: lastChoices comprueba opciones usadas, sin usar, bloqueadas y ocultas de la última elección', () => {
  const lastChoices = [
    { text: 'The tour, please.', enabled: true, used: false },
    { text: 'What about Patient Zero?', enabled: true, used: true },
    { text: '[Requires AdrianZERO] Show my badge.', enabled: false, used: false },
    { text: "I'll come back later.", enabled: true, used: false },
  ];
  const want = { used: ['patient zero'], fresh: ['tour', 'come back'], locked: ['badge'], absent: ['confidential'] };
  assert.deepEqual(check({ lastChoices: want }, st({ lastChoices })), []);
  const bad = check({ lastChoices: { used: ['tour', 'nada'], fresh: ['Patient Zero'], locked: ['tour'], absent: ['badge'] } }, st({ lastChoices }));
  assert.equal(bad.length, 5, bad.join('\n'));
  assert.match(bad.join('\n'), /«The tour, please\.» debería salir en gris/);
  assert.match(bad.join('\n'), /«nada» no salió en la última elección/);
  assert.match(bad.join('\n'), /«What about Patient Zero\?» sale en gris/);
  assert.match(bad.join('\n'), /«The tour, please\.» debería salir bloqueada/);
  assert.match(bad.join('\n'), /no debería salir \(oculta\)/);
  assert.match(check({ lastChoices: want }, st({ lastChoices: null }))[0], /no pidió elegir/);
  assert.match(checkLastChoices(want, st())[0], /API de QA anterior a A2\.6/);
  assert.deepEqual(check({ scene: 'outside' }, st()), [], 'sin la clave no se mira');
});

test('A2.6: la ruta crítica comprueba la opción usada en gris, la oculta por `when` y la salida explícita', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica');
  const talks = route.steps.filter((s) => s.do === 'talk' && s.expect?.lastChoices);
  assert.ok(talks.some((s) => s.expect.lastChoices.used?.length), 'una opción usada en gris');
  assert.ok(talks.some((s) => s.expect.lastChoices.absent?.length), 'una opción oculta');
  assert.ok(talks.every((s) => /come back later|goodbye/i.test(s.choices.at(-1))), 'cada charla termina por su salida explícita');
});

test('A2.4: pasos de escritorio (key, click, rightclick, doubleclick): descripción y definición', () => {
  const wt = (step) => ({ id: 'w', steps: [NEW, step] });
  assert.equal(describe({ do: 'key', key: 'l' }), 'KEY l');
  assert.equal(describe({ do: 'key', key: 'Tab', phase: 'down' }), 'KEY Tab (down)');
  assert.equal(describe({ do: 'click', target: 'hs_plant' }), 'CLICK hs_plant');
  assert.equal(describe({ do: 'rightclick', target: 'npc_receptionist' }), 'RIGHTCLICK npc_receptionist');
  assert.equal(describe({ do: 'doubleclick', target: 'hs_stairs_up' }), 'DOUBLECLICK hs_stairs_up');
  for (const ok of [{ do: 'key', key: 'Escape' }, { do: 'key', key: 'Tab', phase: 'up' }, { do: 'rightclick', target: 'x' }]) {
    assert.deepEqual(routeDefects(wt(ok)), [], JSON.stringify(ok));
  }
  for (const bad of [{ do: 'key' }, { do: 'key', key: '' }, { do: 'key', key: 'l', phase: 'hold' }, { do: 'click' }, { do: 'doubleclick', target: '' }]) {
    assert.equal(routeDefects(wt(bad)).length, 1, JSON.stringify(bad));
  }
  assert.ok(tapsScene({ do: 'rightclick', target: 'x' }) && tapsScene({ do: 'doubleclick', target: 'x' }) && tapsScene({ do: 'click', target: 'x' }));
  assert.ok(!tapsScene({ do: 'key', key: 'l' }));
});

test('A2.4: expect.verb, expect.walkTarget y expect.highlighted', () => {
  assert.deepEqual(check({ verb: 'LOOK' }, st({ verb: 'LOOK' })), []);
  assert.match(check({ verb: 'LOOK' }, st({ verb: 'WALK' }))[0], /verbo del panel «WALK», se esperaba «LOOK»/);
  assert.match(check({ verb: 'LOOK' }, st())[0], /anterior a A2\.4/);

  const walkTarget = { target: 'npc_receptionist', verb: 'TALK', walkTo: { x: 30, y: 90 }, face: 'left' };
  assert.deepEqual(check({ walkTarget: { target: 'npc_receptionist', verb: 'TALK' } }, st({ walkTarget })), []);
  assert.equal(checkWalkTarget({ target: 'hs_coat', verb: 'PICK' }, st({ walkTarget })).length, 2);
  assert.match(checkWalkTarget({ verb: 'TALK' }, st({ walkTarget: null }))[0], /no hubo acercamiento/);

  const highlightedHotspots = ['hs_a', 'hs_b', 'npc_c'];
  assert.deepEqual(check({ highlighted: { min: 3, includes: ['npc_c'], excludes: ['hs_z'] } }, st({ highlightedHotspots })), []);
  assert.equal(checkHighlighted({ min: 4, max: 1, includes: ['hs_z'], excludes: ['hs_a'] }, st({ highlightedHotspots })).length, 4);
  assert.deepEqual(check({ highlighted: { max: 0 } }, st({ highlightedHotspots: [] })), []);
  assert.match(checkHighlighted({ min: 1 }, st())[0], /anterior a A2\.4/);
});

test('A2.4: noListenerGrowth también mira los listeners de teclado y del lienzo si el juego los expone', () => {
  const exp = { noListenerGrowth: true };
  assert.deepEqual(check(exp, st({ resizeListeners: 9, inputListeners: 4 }), { listenersBaseline: 9, inputListenersBaseline: 4 }), []);
  const grown = check(exp, st({ resizeListeners: 9, inputListeners: 8 }), { listenersBaseline: 9, inputListenersBaseline: 4 });
  assert.equal(grown.length, 1);
  assert.match(grown[0], /teclado y del lienzo: 8, tras el primer paso había 4/);
  assert.deepEqual(checkListenerGrowth({ resizeListeners: 9 }, 9, 4), [], 'sin inputListeners (API anterior) no se mira');
});

test('A2.4: la ruta de escritorio prueba Tab, una tecla de verbo, el clic derecho en una NPC y el doble clic en una salida', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'controles-escritorio');
  assert.ok(route, 'existe la ruta controles-escritorio');
  const steps = route.steps;
  assert.ok(steps.some((s) => s.do === 'key' && s.key === 'Tab' && s.phase === 'down' && s.expect?.highlighted?.min > 0), 'Tab resalta');
  assert.ok(steps.some((s) => s.do === 'key' && s.key === 'Tab' && s.phase === 'up' && s.expect?.highlighted?.max === 0), 'soltar Tab quita');
  const l = steps.findIndex((s) => s.do === 'key' && s.key === 'l');
  assert.ok(l >= 0 && steps[l + 1].do === 'click' && steps[l + 1].expect.walkTarget.verb === 'LOOK', 'L + clic = LOOK');
  assert.ok(steps.some((s) => s.do === 'rightclick' && /^npc_/.test(s.target) && s.expect?.walkTarget?.verb === 'TALK'), 'clic derecho en NPC = hablar');
  const dbl = steps.find((s) => s.do === 'doubleclick');
  assert.ok(dbl && dbl.expect?.scene && dbl.expect.noListenerGrowth, 'doble clic en una salida cambia de escena y no deja listeners');
});

test('A2.10: paso runScript: descripción, ops válidos y sin atajos que cambien la partida', () => {
  const ok = { do: 'runScript', ops: [{ op: 'cinematicStart' }, { op: 'setFlag', flag: 'qa_x', value: true }, { op: 'cinematicEnd' }], skipAfterMs: 800 };
  assert.equal(describe(ok), 'RUNSCRIPT 3 op(s) (Esc a los 800 ms)');
  assert.deepEqual(routeDefects({ id: 'r', steps: [NEW, ok] }), []);
  assert.deepEqual(runScriptDefects(ok.ops), []);
  assert.match(runScriptDefects([])[0], /lista de ops no vacía/);
  assert.match(runScriptDefects([{ op: 'addItem', id: 'keycard' }])[0], /cambia la partida/);
  assert.match(runScriptDefects([{ op: 'setFlag', flag: 'chapter_1_complete', value: true }])[0], /solo flags qa_/);
  // También dentro de las ramas
  assert.equal(runScriptDefects([{ op: 'ifFlag', flag: 'a', then: [{ op: 'gotoScene', sceneId: 'x' }], else: [{ op: 'achievement' }] }]).length, 2);
  const bad = routeDefects({ id: 'r', steps: [NEW, { do: 'runScript', ops: [{ op: 'fadeToScene', sceneId: 'x' }], skipAfterMs: -1 }] });
  assert.equal(bad.length, 2);
  assert.match(bad[1], /skipAfterMs/);
});

test('A2.10: expect.cinematic y expect.playerNear', () => {
  const cinematic = { active: false, letterbox: false, chromeHidden: false, camera: { x: 0, y: 0, zoom: 1, following: true }, transition: 'none', covered: false, skipped: true, ended: 2, animating: false, ducked: false };
  const want = { active: false, letterbox: false, following: true, zoom: 1, transition: 'none', skipped: true, endedMin: 2, ducked: false };
  assert.deepEqual(check({ cinematic: want }, st({ cinematic })), []);
  const midway = { ...cinematic, active: true, letterbox: true, camera: { x: 120, y: 30, zoom: 2, following: false }, transition: 'iris', skipped: false, ended: 1 };
  const f = checkCinematic(want, st({ cinematic: midway }));
  assert.equal(f.length, 7);
  assert.ok(f.some((m) => /zoom de la cámara 2, se esperaba 1/.test(m)));
  assert.ok(f.some((m) => /no sigue al jugador/.test(m)));
  assert.match(checkCinematic({ active: false }, st())[0], /anterior a A2\.10/);
  assert.match(checkCinematic({ active: false }, st({ cinematic: null }))[0], /sin estado de cinemáticas/);
  assert.deepEqual(check({ playerNear: { x: 52, y: 92 } }, st({ player: { x: 52.4, y: 91.5 } })), []);
  assert.match(check({ playerNear: { x: 52, y: 92 } }, st({ player: { x: 80, y: 95 } }))[0], /se esperaba cerca de 52,92/);
});

test('A2.10: la ruta cinematica ve la cinemática entera y saltada con Esc y exige el mismo estado final', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'cinematica');
  assert.ok(route, 'existe la ruta cinematica');
  assert.deepEqual(routeDefects(route), []);
  const runs = route.steps.filter((s) => s.do === 'runScript' && s.ops.some((o) => o.op === 'cinematicStart'));
  assert.equal(runs.length, 2, 'una entera y otra saltada');
  const [full, skipped] = runs;
  assert.equal(full.skipAfterMs, undefined);
  assert.ok(typeof skipped.skipAfterMs === 'number');
  assert.deepEqual(full.ops, skipped.ops, 'la misma cinemática');
  for (const op of ['cameraPan', 'cameraZoom', 'actorMove', 'actorFace', 'say', 'cameraShake', 'iris', 'cinematicEnd']) {
    assert.ok(full.ops.some((o) => o.op === op), `usa ${op}`);
  }
  // Mismo estado final (salvo `skipped`) y todo restaurado
  const strip = (e) => ({ ...e, cinematic: { ...e.cinematic, skipped: undefined, endedMin: undefined }, noListenerGrowth: undefined });
  assert.deepEqual(strip(full.expect), strip(skipped.expect));
  assert.equal(full.expect.cinematic.skipped, false);
  assert.equal(skipped.expect.cinematic.skipped, true);
  for (const e of [full.expect, skipped.expect]) {
    assert.equal(e.cinematic.active, false);
    assert.equal(e.cinematic.letterbox, false);
    assert.equal(e.cinematic.following, true);
    assert.equal(e.cinematic.zoom, 1);
  }
});

test('A2.9: pasos journal y callAnon: descripción, definición y runScript sin ops del diario', () => {
  assert.equal(describe({ do: 'journal' }), 'JOURNAL open');
  assert.equal(describe({ do: 'journal', action: 'close' }), 'JOURNAL close');
  assert.equal(describe({ do: 'journal', action: 'open', tab: 'notes' }), 'JOURNAL open (notes)');
  assert.equal(describe({ do: 'callAnon' }), 'CALL ANON');
  const route = (steps) => ({ id: 'r', steps: [NEW, ...steps] });
  assert.deepEqual(routeDefects(route([{ do: 'journal', action: 'open', tab: 'anon' }, { do: 'journal', action: 'close' }, { do: 'callAnon' }])), []);
  assert.equal(routeDefects(route([{ do: 'journal', action: 'toggle' }])).length, 1);
  assert.equal(routeDefects(route([{ do: 'journal', tab: 'inbox' }])).length, 1);
  assert.equal(runScriptDefects([{ op: 'journalNote', id: 'n1' }]).length, 1, 'apuntar una nota cambia la partida');
  assert.equal(runScriptDefects([{ op: 'callAnon' }]).length, 1, 'llamar sube el nivel de pista en la partida');
  assert.equal(tapsScene({ do: 'callAnon' }, st()), false);
});

test('A2.9: expect.journal (abierto, capítulo, objetivos con y sin tic, notas, llamada de Anon)', () => {
  const journal = {
    open: false, tab: null, chapter: 1,
    goals: [{ id: 'g1_code', done: true }, { id: 'g1_inside', done: false }],
    notes: ['n1_code'],
    anon: { puzzle: 'p1_door', level: 1, text: 'You have numbers. Doors like numbers.' },
    openPuzzle: { puzzle: 'p1_door', level: 1 }, unseen: 0, calling: false,
  };
  const s = st({ journal });
  assert.deepEqual(checkJournal({ open: false, chapter: 1, done: ['g1_code'], pending: ['g1_inside'], notes: ['n1_code'], noNotes: ['n1_ledger'],
    anon: { puzzle: 'p1_door', level: 1, notPuzzle: 'p1_code', text: 'doors like' } }, s), []);
  assert.deepEqual(check({ journal: { chapter: 1 } }, s), []);
  const fails = checkJournal({ open: true, chapter: 2, done: ['g1_inside', 'nope'], pending: ['g1_code'], notes: ['n9'], noNotes: ['n1_code'],
    anon: { puzzle: 'p1_code', level: 2, notPuzzle: ['p1_door'], text: 'porch' } }, s);
  assert.equal(fails.length, 11, fails.join('\n'));
  assert.match(checkJournal({ anon: { level: 1 } }, st({ journal: { ...journal, anon: null } }))[0], /ninguna llamada/);
  assert.match(checkJournal({ open: true }, st())[0], /anterior a A2.9/);
  assert.match(checkJournal({ open: true }, st({ journal: null }))[0], /sin diario/);
});

test('A2.9: la ruta crítica comprueba el tic de un objetivo, la escalera de Anon (1 y 2) y que no repite un puzle resuelto', () => {
  const steps = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica').steps;
  const calls = steps.filter((s) => s.do === 'callAnon').map((s) => s.expect?.journal?.anon);
  // A3.3c: el PIN partido: la escalera empieza por p1_lamp y sigue la ruta (p1_nest, p1_combine) hasta p1_door
  assert.deepEqual(calls.slice(0, 2).map((a) => [a.puzzle, a.level]), [['p1_lamp', 1], ['p1_lamp', 2]]);
  assert.deepEqual(calls.slice(2, 5).map((a) => a.puzzle), ['p1_nest', 'p1_combine', 'p1_door']);
  assert.ok(calls.some((a) => a.puzzle === 'p1_door' && a.notPuzzle === 'p1_combine'));
  assert.ok(steps.some((s) => s.do === 'journal' && s.expect?.journal?.done?.includes('g1_code')));
  // Los pasos del diario van entre la puerta sin nota y el felpudo, sin tocar el resto de la ruta
  const i = steps.findIndex((s) => s.do === 'callAnon');
  assert.equal(steps[i - 1].target, 'hs_front_door');
});

// A2.8: densidad de píxel
const px = (extra = {}) => ({
  pixelScale: 5.5, playerScale: 3, playerBase: 3, snapped: true, integer: true, depth: 1, playerHeightPct: 57.2,
  worldHeightPct: 49.18, coordScale: 0.46875, npcs: [{ id: 'npc_receptionist', scale: 3, integer: true, heightPct: 20.6 }], ...extra,
});

test('A2.8: expect.pixel comprueba escala entera, unidad y alto', () => {
  assert.deepEqual(checkPixel({ integer: true, pixelScale: 5.5, heightPct: { min: 40, max: 60 } }, st({ pixel: px() })), []);
  assert.match(checkPixel({ integer: true }, st({ pixel: px({ playerScale: 2.58, integer: false }) }))[0], /no es un múltiplo entero/);
  assert.match(checkPixel({ integer: true }, st({ pixel: px({ npcs: [{ id: 'n', scale: 1.38, integer: false }] }) }))[0], /escala de n/);
  assert.match(checkPixel({ pixelScale: 6 }, st({ pixel: px() }))[0], /unidad de píxel 5.5/);
  assert.match(checkPixel({ heightPct: { max: 50 } }, st({ pixel: px() }))[0], /57.2 %/);
  assert.match(checkPixel({ integer: true }, st())[0], /no expone `pixel`/);
  assert.match(checkPixel({ integer: true }, st({ pixel: null }))[0], /sin densidad/);
  // Va por check()
  assert.equal(check({ pixel: { integer: true } }, st({ pixel: px({ integer: false }) })).length, 1);
});

test('A2.8: sameHeightAs compara con el alto apuntado en otra escena (±tol) y notePixel ignora la profundidad', () => {
  const refs = {};
  notePixel(refs, st({ scene: 'outside', pixel: px({ depth: 0.6, playerHeightPct: 30 }) }));
  assert.deepEqual(refs, {}, 'con profundidad no se apunta');
  notePixel(refs, st({ scene: 'outside', pixel: px() }));
  assert.equal(refs.outside.heightPct, 57.2);
  const lobby = st({ scene: 'lobby', pixel: px({ playerHeightPct: 60 }) });
  assert.deepEqual(check({ pixel: { sameHeightAs: 'outside' } }, lobby, { pixelRefs: refs }), []);
  assert.match(check({ pixel: { sameHeightAs: 'outside', tol: 0.02 } }, lobby, { pixelRefs: refs })[0], /medía el 57.2 %/);
  assert.match(check({ pixel: { sameHeightAs: ['outside', 'lobby'] } }, lobby, { pixelRefs: refs })[0], /sin altura de referencia de «lobby»/);
  assert.equal(notePixel(undefined, lobby), undefined);
});

test('A2.8: la ruta crítica comprueba la escala entera y el mismo alto en outside, lobby y clinic_interior', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica');
  const withPixel = route.steps.filter((s) => s.expect?.pixel);
  assert.deepEqual(withPixel.map((s) => s.expect.scene), ['outside', 'lobby', 'clinic_interior']);
  for (const s of withPixel) assert.equal(s.expect.pixel.integer, true);
  assert.deepEqual([withPixel[2].expect.pixel.sameHeightAs].flat(), ['outside', 'lobby']);
  assert.ok(withPixel.slice(1).every((s) => (s.expect.pixel.tol ?? 0.1) <= 0.1));
});

const anim = (extra = {}) => ({
  texture: 'player_back_left', moving: false, dir: 'up', vertical: true, talking: false, gesture: false, idleTick: null, idleTicks: 0,
  costume: 'player', preview: null, angle: 0, liftPx: 0, scale: 3, baseScale: 3, rest: true, ...extra,
});

test('A4.1: expect.anim comprueba dirección, hablar, textura (regex), disfraz y reposo', () => {
  assert.deepEqual(checkAnim({ dir: 'up', talking: false, moving: false, texture: '^player_back_', costume: 'player', rest: true }, st({ anim: anim() })), []);
  assert.match(checkAnim({ dir: 'down' }, st({ anim: anim() }))[0], /último tramo «up», se esperaba «down»/);
  assert.match(checkAnim({ talking: true }, st({ anim: anim() }))[0], /talking = false/);
  assert.match(checkAnim({ texture: '^player_front' }, st({ anim: anim() }))[0], /textura «player_back_left»/);
  assert.deepEqual(checkAnim({ texture: 'BACK_LEFT' }, st({ anim: anim() })), [], 'regex sin mayúsculas');
  assert.match(checkAnim({ costume: 'ape' }, st({ anim: anim() }))[0], /disfraz «player»/);
  assert.match(checkAnim({ rest: true }, st({ anim: anim({ rest: false, angle: 2.1 }) }))[0], /no está en reposo \(giro 2.1°/);
  assert.match(checkAnim({ dir: 'up' }, st())[0], /anterior a A4\.1/);
  assert.match(checkAnim({ dir: 'up' }, st({ anim: null }))[0], /sin animación/);
  // Va por check()
  assert.equal(check({ anim: { dir: 'left', talking: true } }, st({ anim: anim() })).length, 2);
  assert.deepEqual(check({ scene: 'outside' }, st({ anim: anim({ dir: 'left' }) })), [], 'sin expect.anim no se mira');
});

test('A4.1: la ruta crítica anda en vertical en el lobby (abajo de frente, arriba de espaldas) sin romper facing ni la escala', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica');
  const withAnim = route.steps.filter((s) => s.expect?.anim);
  assert.deepEqual(withAnim.map((s) => [s.do, s.expect.scene, s.expect.anim.dir, s.expect.facing]), [
    ['walk', 'lobby', 'down', 'front'],
    ['walk', 'lobby', 'up', 'back'],
  ]);
  for (const s of withAnim) {
    assert.equal(s.expect.anim.rest, true, 'al parar, sin tween y con la escala base');
    assert.ok(Math.abs(s.y - (s === withAnim[0] ? 98 : 85)) < 1e-9);
  }
  // Van justo después de coger el abrigo (lobby, sin triggers en x = 55,5) y antes de hablar con la recepcionista
  const i = route.steps.indexOf(withAnim[0]);
  assert.equal(route.steps[i - 1].target, 'hs_coat');
  assert.equal(route.steps[i + 2].npc, 'npc_receptionist');
});

const npcL = (extra = {}) => ({
  id: 'npc_receptionist', mirrored: false, facing: 'right', defaultFacing: 'right', engaged: false, talking: false, mouthOpen: false,
  breathPx: 1, blinking: false, blinkCount: 2, turns: 1, mouthMoves: 9, talkMs: 2400, rest: true, faceLocked: false,
  lastTalk: { faced: 'right', facedPlayer: true, lines: 3, ms: 2400, mouthMoves: 9, voice: 'clip', level: false }, ...extra,
});

test('A4.2: expect.npc comprueba giro, boca, reposo, parpadeos y la última conversación', () => {
  const s = st({ npcLife: [npcL()] });
  assert.deepEqual(checkNpc({ id: 'npc_receptionist', facing: 'right', mirrored: false, rest: true, talking: false, minBlinks: 2, minTurns: 1, minMouthMoves: 9,
    lastTalk: { facedPlayer: true, faced: 'right', voice: 'clip', minLines: 3, minMouthMoves: 9 } }, s), []);
  assert.match(checkNpc({ id: 'npc_receptionist', facing: 'left' }, s)[0], /mira «right», se esperaba «left»/);
  assert.match(checkNpc({ id: 'npc_receptionist', talking: true }, s)[0], /talking = false, se esperaba true/);
  assert.match(checkNpc({ id: 'npc_receptionist', minBlinks: 3 }, s)[0], /blinkCount = 2, se esperaban al menos 3/);
  assert.match(checkNpc({ id: 'npc_receptionist', lastTalk: { facedPlayer: false } }, s)[0], /facedPlayer = true/);
  assert.match(checkNpc({ id: 'npc_receptionist', lastTalk: { minLines: 4 } }, s)[0], /dijo 3 línea/);
  assert.match(checkNpc({ id: 'npc_receptionist', lastTalk: { minMouthMoves: 10 } }, s)[0], /abrió la boca 9/);
  assert.match(checkNpc({ id: 'npc_receptionist', lastTalk: { faced: 'right' } }, st({ npcLife: [npcL({ lastTalk: null })] }))[0], /no ha hablado/);
  assert.match(checkNpc({ id: 'npc_x' }, s)[0], /«npc_x»: no está en la escena \(npc_receptionist\)/);
  assert.match(checkNpc({ id: 'npc_receptionist' }, st())[0], /anterior a A4\.2/);
  // Lista de NPC y por check()
  assert.equal(checkNpc([{ id: 'npc_receptionist', rest: false }, { id: 'npc_dr_satoshi' }], s).length, 2);
  assert.equal(check({ npc: { id: 'npc_receptionist', engaged: true } }, s).length, 1);
  assert.deepEqual(check({ scene: 'outside' }, s), [], 'sin expect.npc no se mira');
});

test('A4.2: la ruta crítica comprueba que Penny habla mirando a Dex y vuelve al reposo después', () => {
  const route = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica');
  const withNpc = route.steps.filter((s) => s.expect?.npc);
  assert.deepEqual(withNpc.map((s) => [s.do, s.npc ?? s.target, s.expect.npc.id]), [
    ['talk', 'npc_receptionist', 'npc_receptionist'],
    ['act', 'hs_poster', 'npc_receptionist'],
  ]);
  assert.equal(withNpc[0].expect.npc.lastTalk.facedPlayer, true);
  assert.ok(withNpc[0].expect.npc.lastTalk.minMouthMoves >= 1);
  assert.equal(withNpc[1].expect.npc.rest, true);
  // La comprobación de reposo va justo después de la charla
  assert.equal(route.steps.indexOf(withNpc[1]), route.steps.indexOf(withNpc[0]) + 1);
});

test('A2.5: expect.failResponse contra state().lastFailResponse', () => {
  const last = { kind: 'item-hotspot', item: 'keycard', target: 'hs_coat', verb: 'USE', text: "I put the keycard back in the coat.", bag: 'hotspot:lobby/hs_coat:keycard' };
  const s = st({ lastFailResponse: last });
  assert.deepEqual(checkFailResponse({ kind: 'item-hotspot', item: 'keycard', target: 'hs_coat', bag: 'hotspot:lobby/hs_coat:keycard', text: 'back in the COAT' }, s), []);
  assert.deepEqual(check({ failResponse: { kind: 'item-hotspot' } }, s), []);
  const fails = checkFailResponse({ kind: 'verb', item: 'ledger', target: 'hs_x', verb: 'PUSH', bag: 'verb:PUSH', text: 'nope' }, s);
  assert.equal(fails.length, 6, fails.join('\n'));
  assert.match(checkFailResponse({ kind: 'verb' }, st())[0], /anterior a A2.5/);
  assert.match(checkFailResponse({ kind: 'verb' }, st({ lastFailResponse: null }))[0], /ninguna respuesta/);
});

test('A2.5: los rejects de respuestas de fallo de la ruta crítica casan con la frase 0 de su bolsa (ronda fija con ?qa=1)', () => {
  const fail = readJson('assets/config/fail-responses.json');
  const sceneOf = (id) => readJson(`assets/scenes/${id}/scene.json`);
  const steps = readJson('qa/walkthrough.json').routes.find((r) => r.id === 'ruta-critica').steps.filter((s) => s.expect?.failResponse);
  assert.ok(steps.length >= 5, 'PUSH/PULL/GIVE por defecto, una pareja específica y una bolsa de objeto');
  const bagText = (bag) => {
    const [kind, rest] = [bag.slice(0, bag.indexOf(':')), bag.slice(bag.indexOf(':') + 1)];
    if (kind === 'verb') return fail.verbDefaults[rest][0];
    if (kind === 'item') return fail.items[rest][0];
    if (kind === 'hotspot') {
      const [where, item] = rest.split(':');
      const [sceneId, hsId] = where.split('/');
      const hs = sceneOf(sceneId).regions.hotspots.find((h) => h.id === hsId);
      return hs.useResponses[item][0];
    }
    throw new Error(`bolsa no prevista en la prueba: ${bag}`);
  };
  const kinds = new Set();
  for (const s of steps) {
    kinds.add(s.expect.failResponse.bag.split(':')[0]);
    assert.match(bagText(s.expect.failResponse.bag), new RegExp(s.rejects, 'i'), `${describe(s)}: rejects /${s.rejects}/`);
  }
  assert.deepEqual([...kinds].sort(), ['hotspot', 'item', 'verb']);
  // Ningún rejects de las rutas casa con las plantillas viejas («I can't use X with Y», «can't push that»…)
  for (const f of ['qa/walkthrough.json', 'qa/sequence-breaks.json', 'qa/selftest.json']) {
    for (const r of readJson(f).routes) for (const s of r.steps) if (s.rejects) assert.doesNotMatch(s.rejects, /can't (use|push|pull|pick)|nobody to give|doesn't want/i, `${f} ${r.id}`);
  }
});

test('checkAudio (A4.4): ambiente pedido, superficie, pasos y efectos pedidos durante el paso', () => {
  const audio = (counts, extra = {}) => ({
    muted: true, music: { key: null, pending: 'retro-adventure', gain: null },
    ambience: { key: null, requested: 'crickets', pending: null, gain: null, loop: null }, duck: [], duckGain: 1,
    sfx: { last: [], total: 3, counts, missing: [] }, footsteps: { count: 4, surface: 'gravel', last: null }, ...extra,
  });
  const before = st({ audio: audio({ step_gravel_1: 1 }) });
  const after = st({ audio: audio({ step_gravel_1: 2, plank_pull: 1 }) });
  assert.deepEqual(checkAudio({ ambience: 'crickets', surface: 'gravel', footstepsMin: 4, sfxPlayed: ['plank_pull', 'step_gravel_1'], sfxNotPlayed: ['door_creak'], missing: false, muted: true }, after, before), []);
  assert.deepEqual(check({ audio: { ambience: 'crickets' } }, after, { before }), []);
  const f = checkAudio({ ambience: 'wind', surface: 'wood', footstepsMin: 5, sfxPlayed: ['door_creak'], sfxNotPlayed: ['plank_pull'], muted: false }, after, before);
  assert.equal(f.length, 6, f.join(' | '));
  assert.match(f[0], /ambiente pedido «crickets», se esperaba «wind»/);
  assert.match(f[3], /«door_creak» no se pidió durante el paso \(pedidos: step_gravel_1, plank_pull\)/);
  // Sin estado de antes, cuenta todo lo pedido desde que arrancó la página
  assert.deepEqual(checkAudio({ sfxPlayed: ['step_gravel_1'] }, after, undefined), []);
  assert.deepEqual(checkAudio({ missing: false }, st({ audio: audio({}, { sfx: { last: [], total: 1, counts: { x: 1 }, missing: ['x'] } }) })), ['audio: efectos pedidos que no estaban en caché: x']);
  assert.deepEqual(checkAudio({ ambience: null }, st({ audio: null })), ['sin estado de audio (no hay escena de juego)']);
  assert.match(checkAudio({ ambience: null }, st()).join(), /anterior a A4.4/);
});

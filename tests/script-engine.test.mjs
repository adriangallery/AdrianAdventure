// A1.1 (plan SCUMM): pruebas del watchdog de ScriptEngine sin navegador. A1.9: onEnter de nodos de diálogo.
// CI (Node 22): node --experimental-strip-types --test tests/script-engine.test.mjs
// SCRIPT_ENGINE_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ScriptEngine, WATCHDOG_MS, flickerPattern } = await import(process.env.SCRIPT_ENGINE_PATH ?? '../src/systems/ScriptEngine.ts');
// A1.9: onEnter de los nodos de diálogo
const { DialogueSystem } = await import(process.env.DIALOGUE_SYSTEM_PATH ?? '../src/systems/DialogueSystem.ts');
const { DialogueScriptRunner } = await import(process.env.DIALOGUE_SCRIPTS_PATH ?? '../src/systems/DialogueScripts.ts');

const TICK = 1000;

/**
 * Contexto falso que se comporta como `GameScene.buildScriptContext`: el estado vive fuera del contexto,
 * `setState` y el inventario lo SUSTITUYEN por un objeto nuevo (como `InventorySystem`) y el motor solo lo ve
 * por `getState()`. Si alguien vuelve a copiar el estado por valor, las pruebas de «escribir y leer en el mismo
 * script» fallan. `say` devuelve una promesa que la prueba resuelve (o nunca) a mano.
 */
function makeCtx({ mintAchievement, mintItem } = {}) {
  let gameState = { flags: {}, inventory: [], visited: [], achievements: [] };
  const setState = (updater) => { gameState = updater(gameState); };
  const inventory = {
    hasItem: (id) => gameState.inventory.some((i) => i.id === id),
    addItem(id, name) {
      if (inventory.hasItem(id)) return;
      setState((s) => ({ ...s, inventory: [...s.inventory, { id, name, icon: null, fromNFT: false }] }));
    },
    removeItem(id) {
      setState((s) => ({ ...s, inventory: s.inventory.filter((i) => i.id !== id) }));
    },
  };
  const says = [];
  const toasts = [];
  const ctx = {
    log: [],
    says,
    toasts,
    getState: () => gameState,
    setState,
    say(text) {
      ctx.log.push(`say ${text}`);
      return new Promise((resolve) => says.push({ text, resolve }));
    },
    gotoScene(sceneId) { ctx.log.push(`goto ${sceneId}`); },
    addItem(id, name) {
      ctx.log.push(`addItem ${id}`);
      inventory.addItem(id, name);
    },
    removeItem(id) {
      ctx.log.push(`removeItem ${id}`);
      inventory.removeItem(id);
    },
    showAchievement(text) { ctx.log.push(`achievement ${text}`); },
    showToast(status, message) { toasts.push(`${status} ${message}`); },
    playSound(key) { ctx.log.push(`sound ${key}`); },
  };
  if (mintAchievement) ctx.mintAchievement = mintAchievement;
  if (mintItem) ctx.mintItem = mintItem;
  return ctx;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const setFlag = (ctx, flag, value = true) => ctx.setState((s) => ({ ...s, flags: { ...s.flags, [flag]: value } }));
/** Promesa que la prueba resuelve a mano (o nunca). */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** Captura console.warn durante `fn`. */
async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn(warnings);
  } finally {
    console.warn = original;
  }
  return warnings;
}

function ticks(engine, n, presenting) {
  let resets = 0;
  for (let i = 0; i < n; i++) if (engine.watchdogTick(TICK, presenting)) resets++;
  return resets;
}

test('un texto 35 s en pantalla no dispara el watchdog y las ops de después se ejecutan', async () => {
  const warnings = await withWarnings(async () => {
    const ctx = makeCtx();
    const engine = new ScriptEngine(ctx);
    const done = engine.execute([
      { op: 'say', text: 'sobre' },
      { op: 'addItem', id: 'mystery_envelope', name: 'Mystery Envelope' },
      { op: 'setFlag', flag: 'found_envelope', value: true },
    ], 'hs_mailbox/PICK');
    await flush();
    assert.equal(ticks(engine, 35, true), 0, 'con texto en pantalla no debe reiniciar');
    assert.equal(engine.isRunning(), true);
    ctx.says[0].resolve();
    await done;
    assert.deepEqual(ctx.getState().inventory.map((i) => i.id), ['mystery_envelope']);
    assert.equal(ctx.getState().flags.found_envelope, true);
    assert.equal(engine.isRunning(), false);
  });
  assert.deepEqual(warnings, []);
});

test('el contador vuelve a cero cuando el script avanza o hay algo en pantalla', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  engine.execute([{ op: 'say', text: 'uno' }, { op: 'say', text: 'dos' }]);
  await flush();
  assert.equal(ticks(engine, 20, false), 0);
  ctx.says[0].resolve();
  await flush();
  assert.equal(ticks(engine, 20, false), 0, 'el avance al segundo say reinicia la cuenta');
  assert.equal(ticks(engine, 1, true), 0);
  assert.equal(ticks(engine, WATCHDOG_MS / TICK - 1, false), 0, 'algo en pantalla reinicia la cuenta');
  assert.equal(engine.isRunning(), true);
  ctx.says[1].resolve();
});

test('una espera larga (wait) no cuenta como cuelgue', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([{ op: 'wait', ms: 120_000 }, { op: 'setFlag', flag: 'after_wait', value: true }]);
  await flush();
  assert.equal(ticks(engine, 60, false), 0);
  engine.setFastForward(true);
  await done;
  assert.equal(ctx.getState().flags.after_wait, true);
});

test('escribir y leer en el mismo script: ifFlag/ifHasItem ven el estado ya cambiado', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  await engine.execute([
    { op: 'setFlag', flag: 'door_open', value: true },
    { op: 'ifFlag', flag: 'door_open', then: [{ op: 'setFlag', flag: 'saw_open', value: true }], else: [{ op: 'setFlag', flag: 'saw_closed', value: true }] },
    { op: 'addItem', id: 'key', name: 'Key' },
    { op: 'ifHasItem', id: 'key', then: [{ op: 'setFlag', flag: 'saw_key', value: true }], else: [{ op: 'setFlag', flag: 'saw_no_key', value: true }] },
    { op: 'removeItem', id: 'key' },
    { op: 'ifHasItem', id: 'key', then: [{ op: 'setFlag', flag: 'saw_key_after_remove', value: true }] },
  ], 'hs_door/OPEN');
  const { flags } = ctx.getState();
  assert.equal(flags.saw_open, true, 'ifFlag tras setFlag del mismo flag');
  assert.equal(flags.saw_closed, undefined);
  assert.equal(flags.saw_key, true, 'ifHasItem tras addItem');
  assert.equal(flags.saw_no_key, undefined);
  assert.equal(flags.saw_key_after_remove, undefined, 'ifHasItem tras removeItem');
});

test('una promesa perdida sin nada en pantalla: reinicio a los 30 s sin perder ops de estado', async () => {
  const warnings = await withWarnings(async () => {
    const ctx = makeCtx();
    const engine = new ScriptEngine(ctx);
    setFlag(ctx, 'lamp_on');
    engine.execute([
      {
        op: 'ifFlag', flag: 'lamp_on',
        then: [
          { op: 'say', text: 'colgado' },
          { op: 'setFlag', flag: 'inner', value: true },
          { op: 'say', text: 'presentación que se omite' },
        ],
      },
      { op: 'addItem', id: 'code_note', name: 'Code Note' },
      { op: 'ifHasItem', id: 'code_note', then: [{ op: 'setFlag', flag: 'has_code', value: true }], else: [{ op: 'setFlag', flag: 'wrong_branch', value: true }] },
      // Mismo flag escrito y leído dentro del rescate
      { op: 'setFlag', flag: 'lamp_on', value: false },
      { op: 'ifFlag', flag: 'lamp_on', then: [{ op: 'setFlag', flag: 'stale_lamp', value: true }], else: [{ op: 'setFlag', flag: 'lamp_off_seen', value: true }] },
      { op: 'playSound', key: 'omitido' },
    ], 'hs_porch_light/PICK');
    await flush();
    // Scripts que llegan mientras tanto (triggers, onEnter) se encolan
    engine.execute([{ op: 'say', text: 'en cola' }, { op: 'removeItem', id: 'code_note' }, { op: 'achievement', text: 'Logro' }], 'tr_x/onEnter');
    engine.execute([
      { op: 'setFlag', flag: 'q2', value: true },
      { op: 'ifFlag', flag: 'q2', then: [{ op: 'setFlag', flag: 'q2_seen', value: true }] },
      { op: 'ifHasItem', id: 'code_note', then: [{ op: 'setFlag', flag: 'note_still_there', value: true }] },
      { op: 'stop' },
      { op: 'setFlag', flag: 'after_stop', value: true },
    ], 'tr_y/onEnter');

    assert.equal(ticks(engine, WATCHDOG_MS / TICK - 1, false), 0, 'antes de 30 s no reinicia');
    assert.equal(ticks(engine, 1, false), 1, 'a los 30 s reinicia');
    assert.equal(engine.isRunning(), false);

    const { flags, inventory } = ctx.getState();
    assert.equal(flags.inner, true, 'setFlag del resto de la rama');
    assert.equal(flags.has_code, true, 'rama evaluada con el addItem ya aplicado');
    assert.equal(flags.wrong_branch, undefined);
    assert.equal(flags.lamp_off_seen, true, 'ifFlag tras setFlag del mismo flag, dentro del rescate');
    assert.equal(flags.stale_lamp, undefined);
    assert.equal(flags.q2, true, 'op de estado de un script en cola');
    assert.equal(flags.q2_seen, true, 'ifFlag tras setFlag en un script en cola');
    assert.equal(flags.note_still_there, undefined, 'ifHasItem tras el removeItem del script en cola anterior');
    assert.equal(flags.after_stop, undefined, 'stop corta el resto de ese script');
    assert.deepEqual(inventory.map((i) => i.id), [], 'addItem y después removeItem del script en cola');
    assert.ok(ctx.log.includes('achievement Logro'));
    assert.ok(!ctx.log.includes('say presentación que se omite'), 'la presentación no se repite');
    assert.ok(!ctx.log.includes('sound omitido'));

    // La ejecución abandonada no sigue cuando por fin se resuelve lo que esperaba
    const logBefore = ctx.log.length;
    ctx.says[0].resolve();
    await flush();
    await flush();
    assert.equal(ctx.log.length, logBefore, 'la ejecución abandonada no ejecuta nada más');

    // Y el motor acepta scripts nuevos con normalidad
    await engine.execute([{ op: 'setFlag', flag: 'fresh', value: true }]);
    assert.equal(ctx.getState().flags.fresh, true);
    assert.equal(engine.isRunning(), false);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /forceReset/);
  assert.match(warnings[0], /hs_porch_light\/PICK/);
});

test('la ejecución abandonada no pisa el estado del script que vino después', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  engine.execute([{ op: 'say', text: 'viejo' }, { op: 'stop' }]);
  await flush();
  await withWarnings(async () => {
    assert.equal(ticks(engine, WATCHDOG_MS / TICK, false), 1);
  });
  const fresh = engine.execute([{ op: 'say', text: 'nuevo' }, { op: 'setFlag', flag: 'nuevo_ok', value: true }]);
  await flush();
  ctx.says[0].resolve(); // el script viejo termina ahora: su `stop` y su finally no deben afectar al nuevo
  await flush();
  assert.equal(engine.isRunning(), true, 'el nuevo script sigue en marcha');
  ctx.says[1].resolve();
  await fresh;
  assert.equal(ctx.getState().flags.nuevo_ok, true);
  assert.equal(engine.isRunning(), false);
});

test('mintAchievement sin confirmar en la wallet y nada en pantalla no bloquea el motor', async () => {
  const warnings = await withWarnings(async () => {
    const mint = deferred(); // el jugador nunca confirma
    const ctx = makeCtx({ mintAchievement: () => mint.promise });
    const engine = new ScriptEngine(ctx);
    await engine.execute([
      { op: 'mintAchievement', achievementId: 20022, text: 'MEME ACHIEVEMENT' },
      { op: 'setFlag', flag: 'after_mint', value: true },
    ], 'pepe combo');
    assert.equal(engine.isRunning(), false, 'el script termina sin esperar a la wallet');
    assert.ok(ctx.log.includes('achievement MEME ACHIEVEMENT'), 'el logro visual sale al momento');
    assert.equal(ctx.getState().flags.after_mint, true);
    assert.equal(ticks(engine, WATCHDOG_MS / TICK + 5, false), 0, 'no hay nada que el watchdog tenga que cortar');
    // Un script nuevo corre con normalidad aunque el mint siga pendiente
    await engine.execute([{ op: 'setFlag', flag: 'next_script', value: true }]);
    assert.equal(ctx.getState().flags.next_script, true);
  });
  assert.deepEqual(warnings, []);
});

test('mintAchievement confirmado tarde: aviso y onSuccess como script aparte', async () => {
  const mint = deferred();
  const ctx = makeCtx({ mintAchievement: () => mint.promise });
  const engine = new ScriptEngine(ctx);
  await engine.execute([
    { op: 'mintAchievement', achievementId: 1, text: 'Logro', onSuccess: [{ op: 'setFlag', flag: 'minted', value: true }], onFail: [{ op: 'setFlag', flag: 'mint_failed', value: true }] },
  ]);
  assert.equal(ctx.getState().flags.minted, undefined);
  mint.resolve({ status: 'success', txHash: '0x1' });
  await flush();
  await flush();
  assert.ok(ctx.toasts.includes('success Achievement minted on-chain!'));
  assert.equal(ctx.getState().flags.minted, true);
  assert.equal(ctx.getState().flags.mint_failed, undefined);
  assert.equal(engine.isRunning(), false);
});

test('mintNFT sin confirmar: el watchdog lo corta a los 30 s y el resultado tardío no se pierde', async () => {
  const warnings = await withWarnings(async () => {
    const mint = deferred();
    const ctx = makeCtx({ mintItem: () => mint.promise });
    const engine = new ScriptEngine(ctx);
    engine.execute([
      { op: 'mintNFT', tokenId: 99, onSuccess: [{ op: 'addItem', id: 'minted_item', name: 'Minted Item' }] },
      { op: 'setFlag', flag: 'after_mint', value: true },
    ], 'hs_shop/USE');
    await flush();
    assert.equal(ticks(engine, WATCHDOG_MS / TICK - 1, false), 0);
    assert.equal(ticks(engine, 1, false), 1, 'sin nada en pantalla, a los 30 s se abandona');
    assert.equal(engine.isRunning(), false, 'la entrada vuelve al jugador');
    assert.equal(ctx.getState().flags.after_mint, true, 'ops de estado de después del mint rescatadas');
    mint.resolve({ status: 'success', txHash: '0x2' });
    await flush();
    await flush();
    assert.deepEqual(ctx.getState().inventory.map((i) => i.id), ['minted_item'], 'onSuccess del mint confirmado tarde');
    assert.equal(engine.isRunning(), false);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /mintNFT/);
});

test('web3Require (lectura RPC lenta) sigue sin contar como cuelgue', async () => {
  const read = deferred();
  const ctx = makeCtx();
  ctx.checkGating = () => read.promise;
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([
    { op: 'web3Require', rule: { type: 'ERC721' }, then: [{ op: 'setFlag', flag: 'gated_ok', value: true }] },
  ]);
  await flush();
  assert.equal(ticks(engine, 60, false), 0);
  read.resolve(true);
  await done;
  assert.equal(ctx.getState().flags.gated_ok, true);
});

test('A1.10: forceReset resuelve la promesa de la ejecución abandonada (onEnter de GameScene.create)', async () => {
  const ctx = makeCtx();
  const engine = new ScriptEngine(ctx);
  let resolved = false;
  const onEnter = engine.execute([{ op: 'say', text: 'nunca se cierra' }, { op: 'setFlag', flag: 'tras_texto', value: true }], 'outside/onEnter');
  onEnter.then(() => { resolved = true; });
  await flush();
  assert.equal(resolved, false, 'mientras el texto sigue esperando, la promesa no se resuelve');
  await withWarnings(async () => {
    assert.equal(ticks(engine, WATCHDOG_MS / TICK, false), 1);
  });
  await flush();
  assert.equal(resolved, true, 'tras el reinicio, quien esperaba el onEnter sigue (quita la cortina, triggers de spawn)');
  assert.equal(ctx.getState().flags.tras_texto, true, 'y ya ve las ops de estado rescatadas');
  // La ejecución vieja termina tarde sin tocar nada ni resolver dos veces
  const logBefore = ctx.log.length;
  ctx.says[0].resolve();
  await flush();
  assert.equal(ctx.log.length, logBefore);
  assert.equal(engine.isRunning(), false);
  // forceReset sin nada en marcha no rompe (idempotente)
  engine.forceReset('prueba');
  await engine.execute([{ op: 'setFlag', flag: 'fresh', value: true }]);
  assert.equal(ctx.getState().flags.fresh, true);
});

test('A1.10: una ejecución abandonada que entra en una rama no apila su bloque en la generación viva', async () => {
  const read = deferred();
  const ctx = makeCtx();
  ctx.checkGating = () => read.promise;
  const engine = new ScriptEngine(ctx);
  engine.execute([
    // La rama del script viejo: un `wait` (no cuenta como cuelgue) y un setFlag que el rescate no debe aplicar
    { op: 'web3Require', rule: { type: 'ERC721' }, then: [{ op: 'wait', ms: 10 }, { op: 'setFlag', flag: 'rama_vieja', value: true }] },
  ], 'viejo');
  await flush();
  await withWarnings(async () => engine.forceReset('prueba'));
  // Script nuevo colgado en un texto perdido, sin nada en pantalla
  engine.execute([{ op: 'say', text: 'colgado' }], 'nuevo');
  await flush();
  // Ahora se resuelve la lectura del script viejo y entra en su rama `then`
  read.resolve(true);
  await flush();
  await flush();
  const warnings = await withWarnings(async () => {
    assert.equal(ticks(engine, WATCHDOG_MS / TICK, false), 1, 'el watchdog ve el `say` del script nuevo, no el `wait` del viejo');
  });
  assert.match(warnings[0], /«say» en nuevo/);
  assert.equal(ctx.getState().flags.rama_vieja, undefined, 'el rescate no aplica la rama del script abandonado');
  assert.equal(engine.isRunning(), false);
});

// ── A4.3: op ambient (forzar o lanzar una ráfaga de un elemento de animación ambiental, sin tocar el estado) ──

test('A4.3: ambient llama al contexto con id y acción, es instantáneo y no toca el estado; mal definido o inexistente solo avisa', async () => {
  const ctx = makeCtx();
  const calls = [];
  ctx.ambient = (id, action) => { calls.push(`${id}:${action}`); return id === 'moths'; };
  let setStateCalls = 0;
  const setState = ctx.setState;
  ctx.setState = (u) => { setStateCalls++; setState(u); };
  const warns = [];
  const warn = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    const engine = new ScriptEngine(ctx);
    await engine.execute([
      { op: 'ambient', id: 'moths', action: 'off' },
      { op: 'ambient', id: 'moths', action: 'burst' },
      { op: 'ambient', id: 'moths', action: 'auto' },
      { op: 'ambient', id: 'nope', action: 'on' },
      { op: 'ambient', id: 'moths', action: 'explode' },
      { op: 'ambient', action: 'on' },
      { op: 'setFlag', flag: 'after', value: true },
    ], 'x');
    assert.deepEqual(calls, ['moths:off', 'moths:burst', 'moths:auto', 'nope:on']);
    assert.equal(ctx.getState().flags.after, true, 'el script sigue tras los avisos');
    assert.equal(setStateCalls, 1, 'solo el setFlag toca el estado');
    assert.equal(warns.filter((w) => /ambient/.test(w)).length, 3);
    // Sin contexto gráfico (p. ej. el runner de onEnter de diálogo sin escena): avisa y sigue
    const bare = new ScriptEngine(makeCtx());
    await bare.execute([{ op: 'ambient', id: 'moths', action: 'on' }], 'y');
    assert.equal(warns.filter((w) => /ambient/.test(w)).length, 4);
  } finally {
    console.warn = warn;
  }
});

// ── A1.4: flicker (parpadeo de un overlay sin tocar el estado) ──

/** Contexto con overlays: `overlays` son los ids que existen en la escena; apunta cada forzado con su instante. */
function withOverlays(ctx, overlays = ['lamp_empty']) {
  const calls = [];
  let setStateCalls = 0;
  const setState = ctx.setState;
  ctx.setState = (u) => { setStateCalls++; setState(u); };
  ctx.overlayCalls = calls;
  ctx.setStateCalls = () => setStateCalls;
  ctx.setOverlayOverride = (id, visible) => {
    if (!overlays.includes(id)) return false;
    calls.push({ id, visible, at: Date.now() });
    return true;
  };
  ctx.clearOverlayOverrides = () => calls.push({ id: '*', visible: null, at: Date.now() });
  return ctx;
}

test('A1.4: flicker alterna el overlay, lo devuelve a su flag y no toca el estado', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  const t0 = Date.now();
  await engine.execute([{ op: 'flicker', overlay: 'lamp_empty', pattern: [60, 60, 60] }], 'hs_porch_light/PICK');
  const elapsed = Date.now() - t0;
  assert.deepEqual(ctx.overlayCalls.map((c) => c.visible), [true, false, true, null], 'visible, oculto, visible y vuelta a la flag');
  assert.ok(ctx.overlayCalls.every((c) => c.id === 'lamp_empty'));
  assert.ok(elapsed >= 180, `dura al menos la suma del patrón (${elapsed} ms)`);
  assert.ok(elapsed < 1000, `y no mucho más (${elapsed} ms)`);
  assert.equal(ctx.setStateCalls(), 0, 'ni un setState');
  assert.deepEqual(ctx.getState().flags, {});
  assert.equal(engine.isRunning(), false);
});

test('A1.4: flicker con startVisible false empieza oculto (parpadeo de la puerta)', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  engine.setFastForward(true);
  await engine.execute([{ op: 'flicker', overlay: 'lamp_empty', startVisible: false, pattern: [400, 100, 150, 60, 250, 80] }]);
  assert.deepEqual(ctx.overlayCalls.map((c) => c.visible), [false, true, false, true, false, true, null]);
  assert.deepEqual(ctx.getState().flags, {});
});

test('A1.4: la puerta y la lámpara: el estado final es el de las flags reales', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  engine.setFastForward(true);
  const lamp = [
    { op: 'ifFlag', flag: 'found_code_note', then: [], else: [
      { op: 'flicker', overlay: 'lamp_empty', pattern: [80, 120, 50, 200] },
      { op: 'setFlag', flag: 'found_code_note', value: true },
    ] },
  ];
  await engine.execute([{ op: 'ifFlag', flag: 'found_code_note', then: [], else: [{ op: 'flicker', overlay: 'lamp_empty', startVisible: false, pattern: [10, 10] }] }]);
  assert.equal('found_code_note' in ctx.getState().flags, false, 'el parpadeo de la puerta no escribe la flag');
  await engine.execute(lamp);
  assert.deepEqual(ctx.getState().flags, { found_code_note: true });
  assert.equal(ctx.setStateCalls(), 1, 'un solo setFlag, el real');
});

test('A1.4: flicker de un overlay que la escena no tiene solo espera, sin forzar nada', async () => {
  const ctx = withOverlays(makeCtx(), []);
  const engine = new ScriptEngine(ctx);
  const t0 = Date.now();
  await engine.execute([{ op: 'flicker', overlay: 'lamp_empty', pattern: [60, 60] }, { op: 'setFlag', flag: 'after', value: true }]);
  assert.ok(Date.now() - t0 >= 120);
  assert.deepEqual(ctx.overlayCalls, []);
  assert.equal(ctx.getState().flags.after, true);
});

test('A1.4: flicker mal definido avisa y sigue', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  const warnings = await withWarnings(async () => {
    await engine.execute([{ op: 'flicker', overlay: 'lamp_empty', pattern: [100, -1] }, { op: 'flicker', pattern: [10] }, { op: 'setFlag', flag: 'after', value: true }], 'x/USE');
  });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /flicker mal definido en x\/USE/);
  assert.deepEqual(ctx.overlayCalls, []);
  assert.equal(ctx.getState().flags.after, true);
});

test('A1.4: flickerPattern acepta pattern o times/onMs/offMs', () => {
  assert.deepEqual(flickerPattern({ op: 'flicker', pattern: [1, 2, 3] }), [1, 2, 3]);
  assert.deepEqual(flickerPattern({ op: 'flicker', times: 2, onMs: 30, offMs: 10 }), [30, 10, 30, 10]);
  assert.deepEqual(flickerPattern({ op: 'flicker', times: 1 }), [100, 100]);
  assert.equal(flickerPattern({ op: 'flicker', pattern: [] }), null);
  assert.equal(flickerPattern({ op: 'flicker', pattern: ['100'] }), null);
  assert.equal(flickerPattern({ op: 'flicker', pattern: [Infinity] }), null);
  assert.equal(flickerPattern({ op: 'flicker', times: 0 }), null);
  assert.equal(flickerPattern({ op: 'flicker' }), null);
});

test('A1.4: flicker no cuenta como cuelgue para el watchdog', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([{ op: 'flicker', overlay: 'lamp_empty', pattern: [60_000] }]);
  await flush();
  assert.equal(ticks(engine, 40, false), 0);
  engine.setFastForward(true);
  await done;
  assert.deepEqual(ctx.overlayCalls.map((c) => c.visible), [true, null]);
});

test('A1.4: forceReset a mitad de un flicker quita los forzados y no vuelve a tocar el overlay', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([
    { op: 'flicker', overlay: 'lamp_empty', pattern: [80, 80, 80, 80] },
    { op: 'setFlag', flag: 'found_code_note', value: true },
  ]);
  await new Promise((r) => setTimeout(r, 100));
  await withWarnings(async () => engine.forceReset('prueba'));
  await done;
  const afterReset = ctx.overlayCalls.findIndex((c) => c.id === '*');
  assert.ok(afterReset > 0, 'clearOverlayOverrides');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ctx.overlayCalls.length, afterReset + 1, 'el bucle abandonado no vuelve a forzar el overlay');
  assert.equal(ctx.getState().flags.found_code_note, true, 'el rescate aplica el setFlag de después');
  assert.equal(engine.isRunning(), false);
});

test('A1.4: cancelEffects (SHUTDOWN de la escena) corta el flicker y el script sigue', async () => {
  const ctx = withOverlays(makeCtx());
  const engine = new ScriptEngine(ctx);
  const t0 = Date.now();
  const done = engine.execute([
    { op: 'flicker', overlay: 'lamp_empty', pattern: [5000, 5000] },
    { op: 'setFlag', flag: 'after', value: true },
  ]);
  await new Promise((r) => setTimeout(r, 60));
  engine.cancelEffects();
  await done;
  assert.ok(Date.now() - t0 < 2000, 'no espera el resto del patrón');
  assert.deepEqual(ctx.overlayCalls.map((c) => c.visible), [true, null]);
  assert.equal(ctx.overlayCalls[1].id, '*');
  assert.equal(ctx.getState().flags.after, true);
});

// ─── A1.9: onEnter de los nodos de diálogo ───────────────────

/**
 * Monta lo mismo que GameScene + UIScene: el motor principal, cuyo `startDialogue` corre un árbol en un
 * DialogueSystem, y el DialogueScriptRunner (motor aparte) para los onEnter. `say` del árbol se cierra solo y
 * las elecciones toman la primera; el `say` de los scripts lo resuelve la prueba (o nunca).
 */
function makeDialogueRig(trees, ctx = makeCtx()) {
  const runner = new DialogueScriptRunner(new ScriptEngine(ctx), () => ctx);
  const shown = [];
  const dialogue = new DialogueSystem({
    say: async (text) => { shown.push(text); },
    showChoices: async () => 0,
    runScripts: (ops, where) => runner.run(ops, where),
  });
  ctx.startDialogue = async (_npcId, treeId) => {
    try {
      await dialogue.run(trees[treeId]);
    } finally {
      runner.finishTree();
    }
  };
  return { ctx, runner, shown, main: new ScriptEngine(ctx) };
}

/** Falla si `promise` no termina en `ms` (un bloqueo sale como fallo, no como prueba colgada). */
function within(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`bloqueado: ${what}`)), ms); }),
  ]);
}

const EVIDENCE_TREE = {
  id: 'dr_satoshi_intro',
  start: 'evidence_accepted',
  nodes: {
    evidence_accepted: {
      speaker: 'Dr. Satoshi',
      text: 'Treatment room access granted.',
      onEnter: [
        { op: 'setFlag', flag: 'treatment_room_unlocked', value: true },
        { op: 'setFlag', flag: 'chapter_4_complete', value: true },
        { op: 'removeItem', id: 'mystery_envelope' },
        { op: 'achievement', text: 'Chapter 4 Complete: The Mountain Path' },
        { op: 'ifHasItem', id: 'mystery_envelope', then: [{ op: 'setFlag', flag: 'sobre_sigue', value: true }], else: [{ op: 'setFlag', flag: 'sobre_entregado', value: true }] },
      ],
      end: true,
    },
  },
};

test('A1.9: onEnter con removeItem + achievement desde un diálogo lanzado por el op `dialogue` de un script en curso', async () => {
  const { ctx, main, runner } = makeDialogueRig({ dr_satoshi_intro: EVIDENCE_TREE });
  ctx.addItem('mystery_envelope', 'Mystery Envelope');
  await within(main.execute([
    { op: 'dialogue', npcId: 'npc_dr_satoshi', treeId: 'dr_satoshi_intro' },
    { op: 'setFlag', flag: 'tras_dialogo', value: true },
  ], 'hs_x/USE'), 2000, 'el script que lanzó el diálogo');
  const st = ctx.getState();
  assert.equal(st.flags.treatment_room_unlocked, true);
  assert.equal(st.flags.chapter_4_complete, true);
  assert.equal(st.inventory.some((i) => i.id === 'mystery_envelope'), false, 'removeItem se ejecuta');
  assert.ok(ctx.log.includes('achievement Chapter 4 Complete: The Mountain Path'), 'achievement se ejecuta');
  assert.equal(st.flags.sobre_entregado, true, 'ifHasItem ve el estado vivo tras el removeItem');
  assert.equal(st.flags.tras_dialogo, true, 'el script principal sigue tras el diálogo');
  assert.equal(main.isRunning(), false);
  assert.equal(runner.isRunning(), false);
});

test('A1.9: el onEnter con texto espera al jugador sin bloquear y el árbol sigue después', async () => {
  const tree = {
    id: 't', start: 'a',
    nodes: {
      a: { text: 'A', onEnter: [{ op: 'say', text: 'en onEnter' }, { op: 'addItem', id: 'llave', name: 'Llave' }], next: 'b' },
      b: { text: 'B', end: true },
    },
  };
  const { ctx, main, shown } = makeDialogueRig({ t: tree });
  const done = main.execute([{ op: 'dialogue', npcId: 'n', treeId: 't' }]);
  await flush();
  assert.deepEqual(shown, [], 'el texto del nodo sale después de su onEnter');
  assert.equal(ticks(main, 60, true), 0, 'el motor principal no cuenta mientras hay diálogo');
  ctx.says[0].resolve();
  await within(done, 2000, 'diálogo con texto en onEnter');
  assert.deepEqual(shown, ['A', 'B']);
  assert.equal(ctx.getState().inventory.some((i) => i.id === 'llave'), true);
});

test('A1.9: un onEnter colgado sin nada en pantalla lo corta su watchdog sin perder ops de estado y el árbol sigue', async () => {
  const lost = deferred();
  const ctx = makeCtx();
  ctx.showNarrative = () => lost.promise; // promesa perdida de la UI
  const tree = {
    id: 't', start: 'a',
    nodes: { a: { text: 'A', onEnter: [{ op: 'narrative', lines: ['x'] }, { op: 'removeItem', id: 'sobre' }], end: true } },
  };
  const { main, runner, shown } = makeDialogueRig({ t: tree }, ctx);
  ctx.addItem('sobre', 'Sobre');
  const done = main.execute([{ op: 'dialogue', npcId: 'n', treeId: 't' }]);
  await flush();
  const warnings = await withWarnings(async () => {
    assert.equal(runner.watchdogTick(WATCHDOG_MS, false), true);
  });
  assert.match(warnings[0], /t\.a\/onEnter/);
  await within(done, 2000, 'árbol tras el reinicio del motor de onEnter');
  assert.deepEqual(shown, ['A']);
  assert.equal(ctx.getState().inventory.length, 0, 'el rescate aplica el removeItem pendiente');
});

test('A1.9: gotoScene en un onEnter se aplaza al cierre del árbol; `dialogue` anidado se omite con aviso', async () => {
  const tree = {
    id: 't', start: 'a',
    nodes: {
      a: {
        text: 'A',
        onEnter: [
          { op: 'fadeToScene', sceneId: 'treatment_room' },
          { op: 'dialogue', npcId: 'n', treeId: 'otro' },
          { op: 'setFlag', flag: 'tras_goto', value: true },
        ],
        next: 'b',
      },
      b: { text: 'B', end: true },
    },
  };
  const { ctx, main, shown } = makeDialogueRig({ t: tree, otro: { id: 'otro', start: 'x', nodes: { x: { text: 'NO', end: true } } } });
  let gotoAt = -1;
  const origGoto = ctx.gotoScene;
  ctx.gotoScene = (id) => { gotoAt = shown.length; origGoto(id); };
  const warnings = await withWarnings(async () => {
    await within(main.execute([{ op: 'dialogue', npcId: 'n', treeId: 't' }]), 2000, 'árbol con gotoScene y dialogue');
  });
  assert.deepEqual(shown, ['A', 'B'], 'el árbol llega a su final y no se abre el anidado');
  assert.equal(gotoAt, 2, 'el cambio de escena llega al cerrar el árbol');
  assert.ok(ctx.log.includes('goto treatment_room'));
  assert.equal(ctx.getState().flags.tras_goto, true);
  assert.ok(warnings.some((w) => /«dialogue» \(n\/otro\)/.test(w)), 'aviso del dialogue anidado');
});

// ── A2.9: diario (journalNote es estado; callAnon es presentación) ──

test('A2.9: journalNote apunta la nota por el contexto; sin nota o sin diario, aviso y el script sigue', async () => {
  const warnings = await withWarnings(async () => {
    const ctx = makeCtx();
    const noted = [];
    ctx.journalNote = (id) => { if (id === 'nope') return false; noted.push(id); return true; };
    const engine = new ScriptEngine(ctx);
    await engine.execute([
      { op: 'journalNote', id: 'n2_receptionist' },
      { op: 'journalNote', id: 'nope' },
      { op: 'journalNote' },
      { op: 'setFlag', flag: 'after', value: true },
    ], 'hs_x/LOOK');
    assert.deepEqual(noted, ['n2_receptionist']);
    assert.equal(ctx.getState().flags.after, true);
  });
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings[0], /nope/);
});

test('A2.9: el rescate del watchdog aplica journalNote como estado; callAnon espera su say', async () => {
  await withWarnings(async () => {
    const ctx = makeCtx();
    const noted = [];
    ctx.journalNote = (id) => { noted.push(id); return true; };
    const engine = new ScriptEngine(ctx);
    const hang = deferred();
    ctx.say = () => hang.promise; // un texto que nunca se cierra y sin nada en pantalla: cuelgue
    engine.execute([{ op: 'say', text: 'colgado' }, { op: 'journalNote', id: 'n_rescued' }], 'hs_y/USE');
    await flush();
    assert.equal(ticks(engine, WATCHDOG_MS / TICK, false), 1);
    assert.deepEqual(noted, ['n_rescued']);
  });
  const ctx = makeCtx();
  let calls = 0;
  const answered = deferred();
  ctx.callAnon = () => { calls++; return answered.promise; };
  const engine = new ScriptEngine(ctx);
  const done = engine.execute([{ op: 'callAnon' }, { op: 'setFlag', flag: 'after_call', value: true }], 'tr_phone');
  await flush();
  assert.equal(calls, 1);
  assert.equal(ctx.getState().flags.after_call, undefined, 'espera a que Anon cuelgue');
  answered.resolve();
  await done;
  assert.equal(ctx.getState().flags.after_call, true);
});

// A3.4d/A3.4e (`trampilla-vip-sin-keycard`): la trampilla VIP del felpudo (outside.hs_doormat, tras la rama VIP de
// Penny, que pide un AdrianZERO real) tiene el mismo lector y la misma cerradura que la escotilla: sin keycard o sin
// terminal_key no baja al sótano. El runner del walkthrough no puede simular la posesión de un NFT (el gate ERC721
// del diálogo lee la cadena), así que el atajo se prueba aquí con los scripts del scene.json.
test('A3.4d: la trampilla VIP pide keycard y terminal_key y ahorra solo la veleta', async () => {
  const { readFileSync } = await import('node:fs');
  const outside = JSON.parse(readFileSync(new URL('../assets/scenes/outside/scene.json', import.meta.url), 'utf8'));
  const mat = outside.regions.hotspots.find((h) => h.id === 'hs_doormat');
  const run = async (verb, { flags = {}, items = [] }) => {
    const ctx = makeCtx();
    for (const [f, v] of Object.entries(flags)) setFlag(ctx, f, v);
    for (const id of items) ctx.addItem(id, id);
    ctx.log.length = 0;
    const done = new ScriptEngine(ctx).execute(mat.scripts[verb]);
    for (let i = 0; i < 50 && !ctx.log.some((l) => l.startsWith('goto')); i++) {
      await flush();
      while (ctx.says.length) ctx.says.shift().resolve();
    }
    await done;
    return { ctx, state: ctx.getState() };
  };
  for (const verb of ['USE', 'OPEN', 'PUSH', 'PULL']) {
    // Sin la pista de Penny (sin AdrianZERO), el felpudo no enseña ninguna trampilla
    let r = await run(verb, { items: ['keycard', 'terminal_key'] });
    assert.ok(!r.ctx.log.some((l) => l.startsWith('goto')), `${verb} sin vip_rug_hint no baja`);
    // trampilla-vip-sin-keycard: con la pista y la terminal_key, sin keycard
    r = await run(verb, { flags: { vip_rug_hint: true }, items: ['terminal_key'] });
    assert.ok(!r.ctx.log.some((l) => l.startsWith('goto')), `${verb} sin keycard no baja`);
    assert.ok(r.ctx.log.some((l) => /waiting for Adrian's keycard/.test(l)), `${verb} dice que falta la keycard`);
    assert.equal(r.state.flags.basement_unlocked, undefined);
    assert.equal(r.state.flags.chapter_2_complete, undefined);
    // sin terminal_key
    r = await run(verb, { flags: { vip_rug_hint: true }, items: ['keycard'] });
    assert.ok(!r.ctx.log.some((l) => l.startsWith('goto')), `${verb} sin terminal_key no baja`);
    assert.ok(r.ctx.log.some((l) => /keyhole wants the key/.test(l)));
    // con las dos (sin veleta ni pizza): baja, cierra el capítulo 2 y no gasta nada
    r = await run(verb, { flags: { vip_rug_hint: true }, items: ['keycard', 'terminal_key'] });
    assert.ok(r.ctx.log.includes('goto basement'), `${verb} con keycard y terminal_key baja al sótano`);
    assert.equal(r.state.flags.basement_unlocked, true);
    assert.equal(r.state.flags.chapter_2_complete, true);
    assert.equal(r.state.flags.vane_turned, undefined);
    assert.deepEqual(r.state.inventory.map((i) => i.id).sort(), ['keycard', 'terminal_key']);
  }
});

// ─── A3.10: el Mining Rig enseña el dashboard y las recompensas web3 hacen algo ───────────────────
test('A3.10: showDashboard espera a que se cierre el panel; el rig da logro, flag y la pista del PIN una vez', async () => {
  const { readFileSync } = await import('node:fs');
  const upstairs = JSON.parse(readFileSync(new URL('../assets/scenes/upstairs/scene.json', import.meta.url), 'utf8'));
  const rig = upstairs.regions.hotspots.find((h) => h.id === 'hs_computer');
  const run = async (holder, flags = {}) => {
    const ctx = makeCtx();
    for (const [f, v] of Object.entries(flags)) setFlag(ctx, f, v);
    ctx.log.length = 0;
    let closePanel = null;
    ctx.checkGating = async (rule) => { ctx.log.push(`gate ${rule.type} ${rule.minBalance}`); return holder; };
    ctx.showDashboard = () => { ctx.log.push('dashboard'); return new Promise((r) => { closePanel = r; }); };
    const done = new ScriptEngine(ctx).execute(rig.scripts.USE);
    for (let i = 0; i < 60; i++) {
      await flush();
      while (ctx.says.length) ctx.says.shift().resolve();
      if (closePanel) {
        // Mientras el panel está abierto el script no sigue
        assert.ok(!ctx.log.some((l) => l.startsWith('achievement')), 'el logro llega al cerrar el panel');
        const c = closePanel; closePanel = null; c();
      }
    }
    await done;
    return { ctx, state: ctx.getState() };
  };
  let r = await run(true);
  assert.ok(r.ctx.log.includes('gate ZERO_BALANCE 1000'));
  assert.ok(r.ctx.log.includes('dashboard'));
  assert.equal(r.state.flags.rig_dashboard_seen, true);
  assert.ok(r.ctx.log.includes('achievement HOLDER: TraitLab Insider — the rig read your real wallet'));
  assert.ok(r.ctx.log.some((l) => /0301/.test(l) && l.startsWith('say')), 'dice el PIN al cerrar');
  // Segunda vez: panel otra vez, sin logro repetido
  r = await run(true, { rig_dashboard_seen: true });
  assert.ok(r.ctx.log.includes('dashboard'));
  assert.ok(!r.ctx.log.some((l) => l.startsWith('achievement')));
  // Sin $ZERO: la respuesta del else, sin panel ni recompensa, y el script termina
  r = await run(false);
  assert.ok(!r.ctx.log.includes('dashboard'));
  assert.equal(r.state.flags.rig_dashboard_seen, undefined);
  assert.ok(r.ctx.log.some((l) => /Needs 1000 \$ZERO/.test(l)));
});

test('A3.10: showDashboard sin panel en el contexto avisa y el script sigue', async () => {
  const ctx = makeCtx();
  const done = new ScriptEngine(ctx).execute([{ op: 'showDashboard' }, { op: 'setFlag', flag: 'after', value: true }]);
  await flush();
  await done;
  assert.equal(ctx.getState().flags.after, true);
});

test('A3.10: auditoría — cada web3Require tiene regla válida, su then hace algo más que hablar y su else contesta', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../assets/scenes/', import.meta.url);
  const found = [];
  const walk = (ops, where) => {
    for (const op of ops ?? []) {
      if (!op || typeof op !== 'object') continue;
      if (op.op === 'web3Require') found.push({ op, where });
      for (const k of ['then', 'else', 'onSuccess', 'onFail']) if (Array.isArray(op[k])) walk(op[k], where);
    }
  };
  for (const id of readdirSync(dir)) {
    let scene;
    try { scene = JSON.parse(readFileSync(new URL(`${id}/scene.json`, dir), 'utf8')); } catch { continue; }
    for (const h of scene.regions?.hotspots ?? []) for (const [verb, ops] of Object.entries(h.scripts ?? {})) walk(ops, `${id}.${h.id}.${verb}`);
  }
  assert.ok(found.length >= 6, `esperaba al menos 6 web3Require (hay ${found.length})`);
  const deep = (ops) => (ops ?? []).flatMap((o) => [o, ...deep(o.then), ...deep(o.else)]);
  for (const { op, where } of found) {
    assert.ok(op.rule && ['ERC721', 'ERC1155', 'ERC20', 'ZERO_BALANCE'].includes(op.rule.type), `${where}: regla sin type válido`);
    const thenOps = deep(op.then).map((o) => o.op);
    const hasEffect = thenOps.some((o) => !['say', 'sayBrief', 'wait', 'ifFlag'].includes(o));
    assert.ok(hasEffect, `${where}: el then solo habla (${thenOps.join(', ')})`);
    assert.ok(Array.isArray(op.else) && op.else.length, `${where}: sin else`);
  }
});

test('A3.10: mock web3 de QA — gates sin red y filas del dashboard', async () => {
  const { normalizeWeb3Mock, mockGateResult, setWeb3Mock, getWeb3Mock, MOCK_CONTRACTS } = await import('../src/web3/web3Mock.ts');
  const { dashboardRows, dashboardStatus, formatZero, shortAddress } = await import('../src/web3/dashboardData.ts');
  assert.equal(getWeb3Mock(), undefined, 'sin activar = red real');
  const m = normalizeWeb3Mock({ zero: '5000', adrianZero: [7, { id: 12, name: 'ZERO Twelve' }], lab: [{ id: 1001, name: 'Cap', balance: 2 }], punks: 1 });
  assert.equal(mockGateResult({ type: 'ZERO_BALANCE', minBalance: '1000' }, m), true);
  assert.equal(mockGateResult({ type: 'ZERO_BALANCE', minBalance: '9000' }, m), false);
  assert.equal(mockGateResult({ type: 'ERC721', contract: MOCK_CONTRACTS.ADRIAN_ZERO, minBalance: 1 }, m), true);
  assert.equal(mockGateResult({ type: 'ERC721', contract: MOCK_CONTRACTS.ADRIAN_PUNKS, minBalance: 1 }, m), true);
  assert.equal(mockGateResult({ type: 'ERC1155', tokenId: 1001, minBalance: 2 }, m), true);
  assert.equal(mockGateResult({ type: 'ZERO_BALANCE', minBalance: '1' }, null), false, 'null = sin cartera');
  assert.equal(mockGateResult(undefined, m), false, 'regla rota = no se cumple');
  assert.throws(() => normalizeWeb3Mock({ zero: '1e18' }));
  setWeb3Mock(m); assert.equal(getWeb3Mock(), m); setWeb3Mock(undefined);
  assert.equal(formatZero(5000n * 10n ** 18n), '5,000');
  assert.equal(formatZero(1234n * 10n ** 18n + 5n * 10n ** 17n), '1,234.5');
  assert.equal(shortAddress('0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678');
  const rows = dashboardRows({ address: m.address, zeroWei: 5000n * 10n ** 18n, adrianZeroCount: 2, punksCount: 1, tokens: { adrianZero: ['AdrianZERO #7', 'ZERO Twelve'], lab: ['Cap x2'], labCount: 2 }, errors: [], simulated: true });
  const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n');
  assert.match(text, /\$ZERO: 5,000/);
  assert.match(text, /AdrianZERO: 2/);
  assert.match(text, /ZERO Twelve/);
  assert.match(text, /Traits \(LAB\): 2: Cap x2/);
  // Lectura parcial: lo que falló avisa y lo demás se enseña
  const partial = { address: m.address, zeroWei: null, adrianZeroCount: 3, punksCount: null, tokens: null, errors: ['zero', 'tokens'], simulated: false };
  const prow = dashboardRows(partial);
  assert.ok(prow.find((r) => r.label === '$ZERO').warn);
  assert.equal(prow.find((r) => r.label === 'AdrianZERO').value, '3');
  assert.match(dashboardStatus(partial), /PARTIAL READ/);
});

// ─── A9.13: Founder Mode con datos reales del Diamond (nunca cifras inventadas) ───────────────────────────────────────
test('A9.13: Founder Mode abre el panel founder y ya no dice cifras inventadas', async () => {
  const { readFileSync } = await import('node:fs');
  const upstairs = JSON.parse(readFileSync(new URL('../assets/scenes/upstairs/scene.json', import.meta.url), 'utf8'));
  const combo = upstairs.combos.find((c) => c.result === 'founder_mode');
  const raw = JSON.stringify(combo);
  assert.ok(!/847|12,459|403 days/.test(raw), 'sin las cifras inventadas de antes');
  const ctx = makeCtx();
  const modes = [];
  ctx.showDashboard = (mode) => { modes.push(mode); return Promise.resolve(); };
  const done = new ScriptEngine(ctx).execute(combo.script);
  // El combo lleva un `wait` de 500 ms (temporizador real): se van contestando las frases hasta que acaba
  let fin = false;
  void done.then(() => { fin = true; });
  for (let t = 0; !fin && t < 200; t++) { await new Promise((r) => setTimeout(r, 20)); while (ctx.says.length) ctx.says.shift().resolve(); }
  await done;
  assert.deepEqual(modes, ['founder']);
  assert.equal(ctx.getState().flags.founder_mode, true);
  // Sin `mode` sigue siendo el panel del holder (A3.10)
  const ctx2 = makeCtx();
  const m2 = [];
  ctx2.showDashboard = (mode) => { m2.push(mode); return Promise.resolve(); };
  await new ScriptEngine(ctx2).execute([{ op: 'showDashboard' }]);
  assert.deepEqual(m2, ['holder']);
});

test('A9.13: cifras de Founder Mode — formato, fallo de red, corte de tiempo, caché y sin cartera', async () => {
  const d = await import('../src/web3/dashboardData.ts');
  const e = 10n ** 18n;
  // Valores reales leídos el 14-nov-2026 (eth_call contra Base), redondeados a unidades
  const ok = { supply: async () => 53_456_172n * e, max: async () => 100_000_000n * e, burned: async () => 18_530_728n * e, staked: async () => 8_031_578n * e, adrianZeroSupply: async () => 1338n };
  // Sin cartera: las lecturas no necesitan dirección; todo sale
  let cache = d.newFounderCache();
  const s = await d.readFounderStats(ok, cache, { now: 1000 });
  assert.equal(d.founderMissing(s), 0);
  const text = d.founderRows(s).map((r) => `${r.label}: ${r.value}`).join('\n');
  assert.match(text, /\$ZERO supply: 53,456,172/);
  assert.match(text, /\$ZERO max: 100,000,000/);
  assert.match(text, /\$ZERO burned: 18,530,728 \(18\.5 % of max\)/);
  assert.match(text, /\$ZERO staked: 8,031,578 \(15\.0 % of supply\)/);
  assert.match(text, /AdrianZERO minted: 1,338/);
  assert.ok(!/simulated/.test(text));
  assert.match(d.founderStatus(s), /LIVE FROM BASE/);
  // Caché: dentro de 5 min no se vuelve a leer; pasado, sí
  let calls = 0;
  const counting = Object.fromEntries(Object.entries(ok).map(([k, f]) => [k, () => { calls++; return f(); }]));
  assert.equal(await d.readFounderStats(counting, cache, { now: 1000 + 60_000 }), s);
  assert.equal(calls, 0);
  await d.readFounderStats(counting, cache, { now: 1000 + d.FOUNDER_CACHE_MS + 1 });
  assert.equal(calls, 5);
  // Red caída: todo «—», nada con aspecto de cifra, estado honesto, y no se guarda en caché
  cache = d.newFounderCache();
  const boom = async () => { throw new Error('fetch failed'); };
  const down = await d.readFounderStats({ supply: boom, max: boom, burned: boom, staked: boom, adrianZeroSupply: boom }, cache, { now: 5 });
  assert.equal(d.founderMissing(down), 5);
  for (const r of d.founderRows(down)) { assert.equal(r.value, d.UNAVAILABLE); assert.ok(r.warn); }
  assert.match(d.founderStatus(down), /BASE UNREACHABLE/);
  assert.equal(cache.stats, null);
  // Parcial + corte de tiempo: la lectura que no contesta cae a «—» y el resto se enseña; sin porcentaje inventado
  const hang = () => new Promise(() => {});
  const part = await d.readFounderStats({ ...ok, max: hang, adrianZeroSupply: async () => 'basura' }, d.newFounderCache(), { timeoutMs: 30 });
  assert.equal(part.zeroMaxSupplyWei, null);
  assert.equal(part.adrianZeroSupply, null, 'un valor que no es entero no se enseña');
  const prow = d.founderRows(part);
  assert.equal(prow.find((r) => r.label === '$ZERO burned').value, '18,530,728', 'sin máximo no hay % del máximo');
  assert.equal(prow.find((r) => r.label === '$ZERO max').value, '—');
  assert.match(d.founderStatus(part), /PARTIAL READ \(2 of 5/);
  // QA: simuladas, marcadas como tales; fail = todo «—»
  assert.match(d.founderRows(d.simulatedFounderStats(false)).map((r) => r.value).join(' '), /simulated/);
  assert.equal(d.founderMissing(d.simulatedFounderStats(true)), 5);
  assert.equal(d.formatZeroWhole(999n * 10n ** 17n), '99');
  assert.equal(d.percentOf(1n, 0n), null);
});

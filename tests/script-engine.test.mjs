// A1.1 (plan SCUMM): pruebas del watchdog de ScriptEngine sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/script-engine.test.mjs
// SCRIPT_ENGINE_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ScriptEngine, WATCHDOG_MS } = await import(process.env.SCRIPT_ENGINE_PATH ?? '../src/systems/ScriptEngine.ts');

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

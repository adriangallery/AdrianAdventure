// A1.1 (plan SCUMM): pruebas del watchdog de ScriptEngine sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/script-engine.test.mjs
// SCRIPT_ENGINE_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ScriptEngine, WATCHDOG_MS } = await import(process.env.SCRIPT_ENGINE_PATH ?? '../src/systems/ScriptEngine.ts');

const TICK = 1000;

/** Contexto falso: `say` devuelve una promesa que la prueba resuelve (o nunca) a mano. */
function makeCtx() {
  const says = [];
  const ctx = {
    state: { flags: {}, inventory: [], visited: [], achievements: [] },
    log: [],
    says,
    setState(updater) { ctx.state = updater(ctx.state); },
    say(text) {
      ctx.log.push(`say ${text}`);
      return new Promise((resolve) => says.push({ text, resolve }));
    },
    gotoScene(sceneId) { ctx.log.push(`goto ${sceneId}`); },
    addItem(id) {
      ctx.log.push(`addItem ${id}`);
      ctx.state = { ...ctx.state, inventory: [...ctx.state.inventory, { id }] };
    },
    removeItem(id) {
      ctx.log.push(`removeItem ${id}`);
      ctx.state = { ...ctx.state, inventory: ctx.state.inventory.filter((i) => i.id !== id) };
    },
    showAchievement(text) { ctx.log.push(`achievement ${text}`); },
    playSound(key) { ctx.log.push(`sound ${key}`); },
  };
  return ctx;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    assert.deepEqual(ctx.state.inventory.map((i) => i.id), ['mystery_envelope']);
    assert.equal(ctx.state.flags.found_envelope, true);
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
  assert.equal(ctx.state.flags.after_wait, true);
});

test('una promesa perdida sin nada en pantalla: reinicio a los 30 s sin perder ops de estado', async () => {
  const warnings = await withWarnings(async () => {
    const ctx = makeCtx();
    const engine = new ScriptEngine(ctx);
    ctx.state.flags.lamp_on = true;
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
      { op: 'playSound', key: 'omitido' },
    ], 'hs_porch_light/PICK');
    await flush();
    // Scripts que llegan mientras tanto (triggers, onEnter) se encolan
    engine.execute([{ op: 'say', text: 'en cola' }, { op: 'removeItem', id: 'code_note' }, { op: 'achievement', text: 'Logro' }], 'tr_x/onEnter');
    engine.execute([{ op: 'setFlag', flag: 'q2', value: true }, { op: 'stop' }, { op: 'setFlag', flag: 'after_stop', value: true }], 'tr_y/onEnter');

    assert.equal(ticks(engine, WATCHDOG_MS / TICK - 1, false), 0, 'antes de 30 s no reinicia');
    assert.equal(ticks(engine, 1, false), 1, 'a los 30 s reinicia');
    assert.equal(engine.isRunning(), false);

    const { flags, inventory } = ctx.state;
    assert.equal(flags.inner, true, 'setFlag del resto de la rama');
    assert.equal(flags.has_code, true, 'rama evaluada con el estado ya aplicado');
    assert.equal(flags.wrong_branch, undefined);
    assert.equal(flags.q2, true, 'op de estado de un script en cola');
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
    assert.equal(ctx.state.flags.fresh, true);
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
  assert.equal(ctx.state.flags.nuevo_ok, true);
  assert.equal(engine.isRunning(), false);
});

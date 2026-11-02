// A2.6 / A2.6a (plan SCUMM): pruebas del motor de diálogo (hub, salida, opciones usadas, once, condiciones `when`,
// flag/gate antiguos, hideIfLocked, hub sin opciones). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/dialogue-system.test.mjs (va en `npm run test:engine`)
// DIALOGUE_SYSTEM_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DialogueSystem, conditionsMet, parseCondition, choiceKey } = await import(
  process.env.DIALOGUE_SYSTEM_PATH ?? '../src/systems/DialogueSystem.ts'
);

/**
 * Banco de pruebas: `picks` = textos (contenidos, sin mayúsculas) que el «jugador» elige en orden. Guarda lo dicho
 * (`said`) y cada panel de opciones (`panels`). Elegir algo que no está, o quedarse sin respuestas, falla la prueba.
 */
function rig({ flags = {}, items = [], gating = false, persist = true } = {}) {
  const state = { flags: { ...flags }, items: new Set(items), used: {} };
  const said = [];
  const panels = [];
  let picks = [];
  const cb = {
    say: async (text) => { said.push(text); },
    showChoices: async (choices) => {
      panels.push(choices.map((c) => ({ ...c })));
      const want = picks.shift();
      if (want === undefined) throw new Error(`sin respuesta para: ${choices.map((c) => c.text).join(' | ')}`);
      const i = choices.findIndex((c) => c.text.toLowerCase().includes(want.toLowerCase()));
      if (i < 0) throw new Error(`«${want}» no está entre: ${choices.map((c) => c.text).join(' | ')}`);
      return i;
    },
    checkGating: async () => gating,
    getFlag: (f) => state.flags[f] ?? false,
    setFlag: (f, v) => { state.flags[f] = v; },
    hasItem: (id) => state.items.has(id),
  };
  if (persist) {
    cb.isChoiceUsed = (treeId, key) => state.used[treeId]?.includes(key) ?? false;
    cb.markChoiceUsed = (treeId, key) => {
      const list = (state.used[treeId] ??= []);
      if (!list.includes(key)) list.push(key);
    };
  }
  const completed = [];
  cb.onDialogueComplete = (id) => completed.push(id);
  const ds = new DialogueSystem(cb);
  return {
    state, said, panels, completed, ds,
    async talk(tree, choose = [], startNode) {
      picks = [...choose];
      said.length = 0;
      panels.length = 0;
      await ds.run(tree, startNode);
      assert.deepEqual(picks, [], 'respuestas sin usar');
    },
    texts: (panel) => panel.map((c) => c.text),
  };
}

/** Árbol con saludo, hub sin texto, dos ramas que vuelven al hub y salida con despedida. */
const HUB_TREE = {
  id: 'npc_tree',
  start: 'greeting',
  nodes: {
    greeting: { speaker: 'N', text: 'Hello.', next: 'hub' },
    hub: {
      choices: [
        { text: 'Ask A', next: 'a' },
        { text: 'Ask B', next: 'b' },
        { text: 'One-shot', next: 'once_node', once: true },
        { text: "I'll come back later.", next: 'bye', exit: true },
      ],
    },
    a: { text: 'Answer A.', next: 'hub' },
    b: { text: 'Answer B.', choices: [{ text: 'Back', next: 'hub' }, { text: 'Bye from B', next: 'bye', exit: true }] },
    once_node: { text: 'Only once.', next: 'hub' },
    bye: { text: 'See you.', next: 'hub' },
  },
};

test('hub: las ramas vuelven al hub sin repetir el saludo y la salida explícita cierra tras su despedida', async () => {
  const r = rig();
  await r.talk(HUB_TREE, ['Ask A', 'Ask B', 'Back', 'come back later']);
  assert.deepEqual(r.said, ['Hello.', 'Answer A.', 'Answer B.', 'See you.'], 'el hub no dice nada; «bye» no vuelve al hub');
  assert.equal(r.panels.length, 4);
  assert.deepEqual(r.completed, ['npc_tree']);
});

test('salida sin next: cierra al momento', async () => {
  const tree = { id: 't', start: 'hub', nodes: { hub: { choices: [{ text: 'Talk', next: 'x' }, { text: 'Leave', exit: true }] }, x: { text: 'X', next: 'hub' } } };
  const r = rig();
  await r.talk(tree, ['Talk', 'Leave']);
  assert.deepEqual(r.said, ['X']);
});

test('opciones usadas: en gris pero elegibles, persistentes entre conversaciones; la salida nunca se marca', async () => {
  const r = rig();
  await r.talk(HUB_TREE, ['Ask A', 'Ask A', 'come back later']);
  const [first, second, third] = r.panels;
  assert.deepEqual(first.map((c) => c.used), [false, false, false, false]);
  assert.equal(second[0].used, true, 'Ask A en gris tras usarla');
  assert.equal(second[0].enabled, true, 'y se puede volver a elegir');
  assert.equal(third[0].used, true);
  assert.equal(third[3].used, false, 'la salida no se marca como usada');
  // otra conversación con el mismo estado (la partida): sigue en gris
  await r.talk(HUB_TREE, ['come back later']);
  assert.deepEqual(r.panels[0].map((c) => c.used), [true, false, false, false]);
  assert.deepEqual(r.state.used, { npc_tree: [choiceKey('hub', HUB_TREE.nodes.hub.choices[0])] });
  assert.equal(choiceKey('hub', { text: 'Ask A' }), 'hub:Ask A');
  assert.equal(choiceKey('hub', { id: 'ask_a', text: 'Ask A' }), 'ask_a');
});

test('opciones usadas sin callbacks de persistencia: se recuerdan en memoria (misma instancia)', async () => {
  const r = rig({ persist: false });
  await r.talk(HUB_TREE, ['Ask B', 'Back', 'come back later']);
  await r.talk(HUB_TREE, ['come back later']);
  assert.equal(r.panels[0][1].used, true);
});

test('once: se oculta tras usarla', async () => {
  const r = rig();
  await r.talk(HUB_TREE, ['One-shot', 'come back later']);
  assert.deepEqual(r.texts(r.panels[0]), ['Ask A', 'Ask B', 'One-shot', "I'll come back later."]);
  assert.deepEqual(r.texts(r.panels[1]), ['Ask A', 'Ask B', "I'll come back later."]);
  await r.talk(HUB_TREE, ['come back later']);
  assert.ok(!r.texts(r.panels[0]).includes('One-shot'), 'oculta también en la siguiente conversación');
});

/** Hub con condiciones `when` de los cuatro tipos y opciones con flag/gate antiguos. */
const COND_TREE = {
  id: 'cond',
  start: 'hub',
  nodes: {
    hub: {
      choices: [
        { text: '[The name on the vet bill]', next: 'ok', when: ['knows_gerald'] },
        { text: 'Rematch', next: 'ok', when: '!beat_chad' },
        { text: 'Show the Rare Pepe', next: 'ok', when: ['item:pepememe'] },
        { text: 'Ask for a keycard', next: 'ok', when: ['!item:keycard'] },
        { text: 'Old flag (locked)', next: 'ok', flag: 'old_flag' },
        { text: 'Old flag hidden', next: 'ok', flag: 'old_flag', hideIfLocked: true },
        { text: '[Requires AdrianZERO] VIP', next: 'ok', gate: { type: 'ERC721', contract: '0x0', minBalance: 1 } },
        { text: '[Requires AdrianZERO] VIP hidden', next: 'ok', gate: { type: 'ERC721', contract: '0x0', minBalance: 1 }, hideIfLocked: true },
        { text: 'Bye', exit: true },
      ],
    },
    ok: { text: 'OK.', end: true },
  },
};

test('when: flag, flag negada, objeto y objeto ausente — si no se cumplen, OCULTAS (sin su texto)', async () => {
  const none = rig();
  await none.talk(COND_TREE, ['Bye']);
  const shown = none.texts(none.panels[0]);
  assert.ok(!shown.some((t) => t.includes('vet bill')), 'flag sin poner → oculta');
  assert.ok(shown.includes('Rematch'), 'flag negada sin poner → visible');
  assert.ok(!shown.includes('Show the Rare Pepe'), 'objeto que no tengo → oculta');
  assert.ok(shown.includes('Ask for a keycard'), 'objeto ausente → visible');

  const all = rig({ flags: { knows_gerald: true, beat_chad: true }, items: ['pepememe', 'keycard'] });
  await all.talk(COND_TREE, ['Bye']);
  const shown2 = all.texts(all.panels[0]);
  assert.ok(shown2.includes('[The name on the vet bill]'));
  assert.ok(!shown2.includes('Rematch'), 'flag negada puesta → oculta');
  assert.ok(shown2.includes('Show the Rare Pepe'));
  assert.ok(!shown2.includes('Ask for a keycard'), 'objeto presente con !item → oculta');
  assert.ok(all.panels[0].every((c) => c.enabled || c.text.startsWith('[Requires') || c.text.startsWith('Old flag')));
});

test('flag y gate antiguos siguen enseñando la opción bloqueada con su texto; hideIfLocked la oculta', async () => {
  const r = rig();
  await r.talk(COND_TREE, ['Bye']);
  const byText = Object.fromEntries(r.panels[0].map((c) => [c.text, c]));
  assert.equal(byText['Old flag (locked)'].enabled, false);
  assert.equal(byText['[Requires AdrianZERO] VIP'].enabled, false);
  assert.equal(byText['Old flag hidden'], undefined);
  assert.equal(byText['[Requires AdrianZERO] VIP hidden'], undefined);

  const ok = rig({ flags: { old_flag: true }, gating: true });
  await ok.talk(COND_TREE, ['Bye']);
  const byText2 = Object.fromEntries(ok.panels[0].map((c) => [c.text, c]));
  for (const t of ['Old flag (locked)', 'Old flag hidden', '[Requires AdrianZERO] VIP', '[Requires AdrianZERO] VIP hidden']) {
    assert.equal(byText2[t]?.enabled, true, t);
  }
});

test('elegir una opción con setFlag la pone; una opción que oculta su propia condición desaparece del hub', async () => {
  const tree = {
    id: 't', start: 'hub',
    nodes: {
      hub: { choices: [{ text: 'Learn', next: 'learn', setFlag: 'learned', when: '!learned' }, { text: 'Use it', next: 'use', when: 'learned' }, { text: 'Bye', exit: true }] },
      learn: { text: 'Learned.', next: 'hub' },
      use: { text: 'Used.', next: 'hub' },
    },
  };
  const r = rig();
  await r.talk(tree, ['Learn', 'Use it', 'Bye']);
  assert.deepEqual(r.texts(r.panels[0]), ['Learn', 'Bye']);
  assert.deepEqual(r.texts(r.panels[1]), ['Use it', 'Bye']);
  assert.equal(r.state.flags.learned, true);
});

test('hub sin opciones visibles (o solo bloqueadas): termina sin pedir elección', async () => {
  const tree = {
    id: 't', start: 'greeting',
    nodes: {
      greeting: { text: 'Hi.', next: 'hub' },
      hub: { choices: [{ text: 'Secret', next: 'x', when: 'nope' }, { text: 'Gone', next: 'x', once: true }] },
      x: { text: 'X', next: 'hub' },
    },
  };
  const r = rig();
  await r.talk(tree, ['Gone']);
  assert.deepEqual(r.said, ['Hi.', 'X'], 'tras usar la única opción visible, el hub se queda vacío y termina');
  assert.equal(r.panels.length, 1);
  assert.deepEqual(r.completed, ['t']);

  const locked = { id: 'l', start: 'hub', nodes: { hub: { choices: [{ text: 'Locked', next: 'hub', flag: 'nope' }] } } };
  const r2 = rig();
  await r2.talk(locked, []);
  assert.equal(r2.panels.length, 0, 'solo bloqueadas: no se queda atascado en el panel');
});

test('hub vacío con next: sigue por next', async () => {
  const tree = { id: 't', start: 'hub', nodes: { hub: { choices: [{ text: 'S', next: 'hub', when: 'nope' }], next: 'out' }, out: { text: 'Out.', end: true } } };
  const r = rig();
  await r.talk(tree, []);
  assert.deepEqual(r.said, ['Out.']);
});

test('when en nodos: el nodo se salta (sin onEnter ni texto) y se sigue por su next', async () => {
  const ran = [];
  const tree = {
    id: 't', start: 'a',
    nodes: {
      a: { text: 'A', next: 'b' },
      b: { text: 'B (solo con flag)', when: ['has_b'], onEnter: [{ op: 'x' }], next: 'c' },
      c: { text: 'C', end: true },
    },
  };
  const r = rig();
  r.ds.callbacks.runScripts = async (_ops, where) => { ran.push(where); };
  await r.talk(tree, []);
  assert.deepEqual(r.said, ['A', 'C']);
  assert.deepEqual(ran, []);
  const r2 = rig({ flags: { has_b: true } });
  r2.ds.callbacks.runScripts = async (_ops, where) => { ran.push(where); };
  await r2.talk(tree, []);
  assert.deepEqual(r2.said, ['A', 'B (solo con flag)', 'C']);
  assert.deepEqual(ran, ['t.b']);
});

test('startNode: la conversación empieza en ese nodo (NPC que reacciona a un objeto)', async () => {
  const tree = { ...HUB_TREE, nodes: { ...HUB_TREE.nodes, show_bill: { text: 'Gerald!', next: 'hub' } } };
  const r = rig();
  await r.talk(tree, ['come back later'], 'show_bill');
  assert.deepEqual(r.said, ['Gerald!', 'See you.']);
});

test('un bucle de nodos saltados no cuelga el juego', async () => {
  const tree = { id: 'loop', start: 'a', nodes: { a: { when: 'nope', next: 'b' }, b: { choices: [{ text: 'x', next: 'a', when: 'nope' }], next: 'a' } } };
  const r = rig();
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    await r.talk(tree, []);
  } finally {
    console.warn = orig;
  }
  assert.ok(warns.some((w) => /demasiados saltos/.test(w)));
  assert.deepEqual(r.completed, ['loop']);
});

test('parseCondition / conditionsMet: sintaxis y condición mal escrita (no se cumple)', () => {
  assert.deepEqual(parseCondition('knows_gerald'), { kind: 'flag', name: 'knows_gerald', negated: false });
  assert.deepEqual(parseCondition('!beat_chad'), { kind: 'flag', name: 'beat_chad', negated: true });
  assert.deepEqual(parseCondition('item:pepememe'), { kind: 'item', name: 'pepememe', negated: false });
  assert.deepEqual(parseCondition('!item:keycard'), { kind: 'item', name: 'keycard', negated: true });
  assert.deepEqual(parseCondition('flag:x'), { kind: 'flag', name: 'x', negated: false });
  for (const bad of ['', '!!x', 'item:', 'obj:x', 'a b']) assert.equal(parseCondition(bad), null, bad);
  const ctx = { getFlag: (f) => f === 'on', hasItem: (i) => i === 'duck' };
  assert.equal(conditionsMet(undefined, ctx), true);
  assert.equal(conditionsMet([], ctx), true);
  assert.equal(conditionsMet(['on', '!off', 'item:duck', '!item:keycard'], ctx), true);
  assert.equal(conditionsMet(['on', 'off'], ctx), false, 'todas tienen que cumplirse');
  const orig = console.warn;
  console.warn = () => {};
  try {
    assert.equal(conditionsMet(['on', 'mal escrita'], ctx), false);
  } finally {
    console.warn = orig;
  }
  assert.equal(conditionsMet('item:duck', {}), false, 'sin hasItem no hay objetos');
});

test('árbol antiguo (sin hub, con end y flag): se comporta como antes', async () => {
  const tree = {
    id: 'old', start: 'greeting',
    nodes: {
      greeting: { text: 'Hi', choices: [{ text: 'Locked', next: 'x', flag: 'f' }, { text: 'Go', next: 'x' }] },
      x: { text: 'X', end: true },
    },
  };
  const r = rig();
  await r.talk(tree, ['Go']);
  assert.deepEqual(r.said, ['Hi', 'X']);
  assert.deepEqual(r.panels[0].map((c) => [c.text, c.enabled]), [['Locked', false], ['Go', true]]);
});

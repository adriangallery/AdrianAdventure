// A0.4 (plan SCUMM): pruebas del linter de escenas sobre escenas sintéticas en memoria (sin disco ni node_modules).
// node --test tests/lint-scenes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintProject, applyPolicy, parseStringArray, parseWhen } from '../scripts/lint-scenes.mjs';

/** Escena mínima válida: fondo, un área caminable de todo el suelo y el spawn dentro. */
function scene(id, extra = {}) {
  return {
    id,
    assets: { background: 'background.png', walkmask: null, atlas: null },
    player: { spawn: { x: 50, y: 95 } },
    regions: { hotspots: [], triggers: [] },
    items: { sceneItems: [] },
    combos: [],
    audio: { music: null, ambience: null, sfx: {} },
    transitions: { goto: [] },
    walkableAreas: [{ x: 0, y: 90, w: 100, h: 10 }],
    ...extra,
  };
}

const hs = (id, scripts = {}, extra = {}) => ({ id, name: id, bounds: { x: 0, y: 0, w: 1, h: 1 }, scripts, ...extra });

/** Proyecto en memoria: todo fondo existe; `files` añade más rutas existentes. */
function project(scenes, { files = [], src = [], qaUses = [], preload = {} } = {}) {
  const map = Object.fromEntries(scenes.map((s) => [s.id, s]));
  const existing = new Set([...scenes.map((s) => `assets/scenes/${s.id}/background.webp`), ...files]);
  return {
    scenes: map,
    srcFiles: src.map(([file, text]) => ({ file, text })),
    qaUses: new Set(qaUses),
    preload,
    exists: (rel) => existing.has(rel),
  };
}

const only = (findings, rule) => findings.filter((f) => f.rule === rule);

// ── (a) flags ──
test('(a) flag leída y nunca puesta, y puesta y nunca leída', () => {
  const s = scene('x', {
    regions: {
      hotspots: [hs('hs_a', { LOOK: [{ op: 'ifFlag', flag: 'never_set', then: [{ op: 'say', text: 'hi' }] }] }),
        hs('hs_b', { USE: [{ op: 'setFlag', flag: 'never_read', value: true }] }, { bounds: { x: 10, y: 10, w: 1, h: 1 } })],
      triggers: [],
    },
  });
  const f = only(lintProject(project([s])), 'a');
  assert.deepEqual(f.map((x) => x.id).sort(), ['never_read', 'never_set']);
  assert.ok(f.every((x) => x.severity === 'warning'));
});

test('(a) no salta con flags emparejadas, overlays, diálogos, cameraEffect, código o patrones del motor', () => {
  const s = scene('x', {
    regions: { hotspots: [hs('hs_a', { USE: [{ op: 'setFlag', flag: 'paired', value: true }, { op: 'setFlag', flag: 'overlay_flag', value: true },
      { op: 'setFlag', flag: 'cam_flag', value: true }, { op: 'setFlag', flag: 'code_flag', value: true }, { op: 'setFlag', flag: 'chapter_9_intro_shown', value: true },
      { op: 'ifFlag', flag: 'paired' }, { op: 'ifFlag', flag: 'dlg_flag' }] })], triggers: [] },
    conditionalOverlays: [{ id: 'o', sprite: 'o', flag: 'overlay_flag' }],
    cameraEffect: { type: 'anaglyph', disableFlag: 'cam_flag' },
    dialogues: { t: { id: 't', start: 'n', nodes: { n: { text: '…', choices: [{ text: 'a', next: 'n', setFlag: 'dlg_flag' }] } } } },
  });
  const p = project([s], { files: ['assets/scenes/x/o.png'], src: [['src/ui/BadgePanel.ts', "const f = ['code_flag'];"]] });
  assert.deepEqual(only(lintProject(p), 'a'), []);
});

test('(a) TrailerScene.ts no cuenta como uso en código', () => {
  const s = scene('x', { regions: { hotspots: [hs('hs_a', { USE: [{ op: 'setFlag', flag: 'trailer_only', value: true }] })], triggers: [] } });
  const p = project([s], { src: [['src/scenes/TrailerScene.ts', "flags['trailer_only'] = true"]] });
  assert.equal(only(lintProject(p), 'a').length, 1);
});

// ── (b) objetos ──
test('(b) objeto conseguido sin ningún uso', () => {
  const s = scene('x', { regions: { hotspots: [hs('hs_a', { PICK: [{ op: 'addItem', id: 'junk', name: 'Junk' }] })], triggers: [] } });
  const p = project([s], { files: ['assets/sprites/items/junk.png'], src: [['src/scenes/PreloadScene.ts', "const itemIds = ['junk'];"]] });
  const f = only(lintProject(p), 'b');
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'junk');
});

test('(b) no salta si el objeto se usa en combo, ifHasItem, removeItem, NPC, QA o código', () => {
  const add = (id) => ({ op: 'addItem', id, name: id });
  const s = scene('x', {
    regions: { hotspots: [hs('hs_a', { PICK: ['c', 'h', 'r', 'n', 'q', 's'].map(add).concat([{ op: 'ifHasItem', id: 'h' }, { op: 'removeItem', id: 'r' }]) })], triggers: [] },
    combos: [{ items: ['c', 'hs_a'], result: 'x', script: [] }],
    npcs: [{ id: 'npc_bob', name: 'Bob', position: { x: 1, y: 1 }, giveResponses: { n: 'gracias' } }],
  });
  const p = project([s], { qaUses: ['q'], src: [['src/ui/ScummUI.ts', "if (item.id === 's') {}"]] });
  assert.deepEqual(only(lintProject(p), 'b'), []);
});

// ── (c) salidas sin gate ──
test('(c) salida sin gate en trigger y hotspot, agrupada por verbos', () => {
  const go = { op: 'fadeToScene', sceneId: 'y' };
  const s = scene('x', { regions: { hotspots: [hs('hs_door', { USE: [go], OPEN: [go] })], triggers: [{ id: 'tr_exit', once: false, onEnter: [{ op: 'gotoScene', sceneId: 'y' }] }] } });
  const f = only(lintProject(project([s, scene('y')])), 'c');
  assert.deepEqual(f.map((x) => x.id).sort(), ['hs_door', 'tr_exit']);
  assert.match(f.find((x) => x.id === 'hs_door').message, /USE, OPEN/);
});

test('(c) no salta dentro de ifFlag/ifHasItem/web3Require, con gate o en combos', () => {
  const go = { op: 'fadeToScene', sceneId: 'y' };
  const s = scene('x', {
    regions: {
      hotspots: [hs('hs_a', { USE: [{ op: 'ifFlag', flag: 'f', then: [go] }], OPEN: [{ op: 'ifHasItem', id: 'k', else: [go] }], PUSH: [{ op: 'web3Require', rule: {}, then: [go] }] }),
        hs('hs_b', { USE: [go] }, { gate: { type: 'ERC721' } })],
      triggers: [{ id: 'tr', once: false, onEnter: [go], gate: { type: 'ERC721' } }],
    },
    combos: [{ items: ['k', 'hs_a'], result: 'r', script: [go] }],
  });
  assert.deepEqual(only(lintProject(project([s, scene('y')])), 'c'), []);
});

// ── (d) estado tras say ──
test('(d) op de estado después de un say en el mismo bloque y en una rama posterior (parpadeo)', () => {
  const s = scene('x', {
    regions: {
      hotspots: [hs('hs_a', {
        USE: [{ op: 'say', text: 'a' }, { op: 'ifFlag', flag: 'f', else: [{ op: 'setFlag', flag: 'b', value: true }, { op: 'setFlag', flag: 'b', value: false }] }, { op: 'addItem', id: 'i' }],
      })],
      triggers: [],
    },
  });
  const f = only(lintProject(project([s])), 'd');
  assert.equal(f.length, 2);
  const root = f.find((x) => x.id === 'hs_a.USE');
  assert.equal(root.where, 'x.hs_a.USE[2]');
  assert.match(f.find((x) => x.id === 'hs_a.USE[1].else').message, /parpadeo/);
});

test('(d) no salta si el estado va antes del say o el say está en otra rama', () => {
  const s = scene('x', {
    regions: {
      hotspots: [hs('hs_a', { USE: [{ op: 'setFlag', flag: 'f', value: true }, { op: 'say', text: 'a' }], OPEN: [{ op: 'ifFlag', flag: 'f', then: [{ op: 'say', text: 'b' }], else: [{ op: 'setFlag', flag: 'f', value: true }] }] })],
      triggers: [],
    },
  });
  assert.deepEqual(only(lintProject(project([s])), 'd'), []);
});

// ── (e) spawns ──
test('(e) spawn propio y spawn de una salida fuera de las walkableAreas del destino', () => {
  const a = scene('a', { player: { spawn: { x: 50, y: 10 } }, regions: { hotspots: [hs('hs', { USE: [{ op: 'ifFlag', flag: 'f', then: [{ op: 'fadeToScene', sceneId: 'b', spawn: { x: 5, y: 95 } }] }] })], triggers: [] } });
  const b = scene('b', { walkableAreas: [{ x: 10, y: 90, w: 80, h: 10 }] });
  const f = only(lintProject(project([a, b])), 'e');
  assert.equal(f.length, 2);
  assert.ok(f.some((x) => x.id === 'player.spawn'));
  assert.ok(f.some((x) => /→ b \(5, 95\)/.test(x.message)));
  // A1.8: un spawn fuera de zona deja al personaje donde no puede andar; es error, no aviso
  assert.ok(f.every((x) => x.severity === 'error'));
});

test('(e) no salta con spawns dentro (bordes incluidos) y avisa una vez si no hay walkableAreas', () => {
  const a = scene('a', { regions: { hotspots: [hs('hs', { USE: [{ op: 'gotoScene', sceneId: 'b', spawn: { x: 100, y: 100 } }, { op: 'gotoScene', sceneId: 'c', spawn: { x: 1, y: 1 } }] })], triggers: [] } });
  const b = scene('b');
  const c = scene('c', { walkableAreas: undefined });
  const f = only(lintProject(project([a, b, c])), 'e');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /sin walkableAreas/);
  assert.equal(f[0].severity, 'warning');
});

test('(e) A2.1: un spawn dentro de blockedAreas es error aunque caiga en walkableAreas', () => {
  const a = scene('a', { player: { spawn: { x: 50, y: 95 } }, blockedAreas: [{ x: 45, y: 90, w: 10, h: 6 }] });
  const b = scene('b', { player: { spawn: { x: 20, y: 95 } }, blockedAreas: [{ x: 45, y: 90, w: 10, h: 6 }] });
  const f = only(lintProject(project([a, b])), 'e');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'error');
  assert.match(f[0].message, /blockedAreas/);
});

// ── (f) assets ──
test('(f) error por fondo, overlay, web3Visual, música, sonido, icono, NPC, escena y diálogo inexistentes', () => {
  const s = scene('x', {
    assets: { background: 'background.png', walkmask: 'walkmask.png', atlas: null, foreground: 'foreground.png' },
    audio: { music: 'nope', ambience: null, sfx: {} },
    conditionalOverlays: [{ id: 'o', sprite: 'overlay_o', flag: 'f', format: 'webp' }],
    web3Visuals: [{ id: 'w', position: { x: 1, y: 1 }, defaultSprite: 'poster', variants: [{ gate: { type: 'ERC721' }, sprite: 'poster_vip' }] }],
    npcs: [{ id: 'npc_ghost', name: 'G', position: { x: 1, y: 1 }, dialogueTreeId: 'missing_tree' }],
    regions: { hotspots: [hs('hs', { USE: [{ op: 'playSound', key: 'boom' }, { op: 'addItem', id: 'thing' }, { op: 'fadeToScene', sceneId: 'nowhere' }, { op: 'dialogue', npcId: 'npc_ghost', treeId: 'nada' }, { op: 'flicker', overlay: 'lamp_nope', pattern: [100] }] })], triggers: [] },
  });
  const p = project([s]);
  p.exists = () => false; // ni siquiera el fondo
  const f = only(lintProject(p), 'f');
  const errors = f.filter((x) => x.severity === 'error').map((x) => x.id);
  for (const id of ['assets/scenes/x/background.webp', 'assets/scenes/x/foreground.webp', 'assets/scenes/x/overlay_o.webp', 'assets/scenes/x/poster.png',
    'assets/scenes/x/poster_vip.png', 'assets/audio/music/nope.mp3', 'assets/audio/sfx/boom.mp3', 'assets/sprites/items/thing.png',
    'assets/sprites/npcs/ghost.png', 'missing_tree', 'assets/scenes/nowhere/scene.json', 'nada', 'lamp_nope']) {
    assert.ok(errors.includes(id), `falta error de ${id}`);
  }
  // la walkmask no la carga nadie: solo aviso
  assert.equal(f.find((x) => x.id === 'assets/scenes/x/walkmask.png').severity, 'warning');
});

test('(f) no salta con todo en su sitio y avisa si existe pero no se precarga', () => {
  const s = scene('x', {
    assets: { background: 'background.png', walkmask: null, atlas: null, foreground: 'foreground.png' },
    audio: { music: 'song', ambience: null, sfx: {} },
    conditionalOverlays: [{ id: 'o', sprite: 'overlay_o', flag: 'f' }],
    npcs: [{ id: 'npc_bob', name: 'Bob', position: { x: 1, y: 1 } }],
    regions: { hotspots: [hs('hs', { USE: [{ op: 'playSound', key: 'ding' }, { op: 'addItem', id: 'thing' }, { op: 'ifFlag', flag: 'f' }, { op: 'say', text: 'a' }, { op: 'flicker', overlay: 'o', pattern: [100, 50] }] })], triggers: [] },
  });
  const files = ['assets/scenes/x/background.png', 'assets/scenes/x/foreground.webp', 'assets/scenes/x/overlay_o.png', 'assets/audio/music/song.mp3',
    'assets/audio/sfx/ding.mp3', 'assets/sprites/items/thing.png', 'assets/sprites/npcs/bob.png'];
  const ok = only(lintProject(project([s], { files, preload: { items: ['thing'], npcs: ['bob'], sfx: ['ding'] } })), 'f');
  assert.deepEqual(ok, []);
  const notPreloaded = only(lintProject(project([s], { files, preload: { items: [], npcs: ['bob'], sfx: ['ding'] } })), 'f');
  assert.equal(notPreloaded.length, 1);
  assert.equal(notPreloaded[0].severity, 'warning');
});

// ── (g) hotspots solapados ──
test('(g) solape parcial y uno que tapa entero al siguiente', () => {
  const s = scene('x', {
    regions: {
      hotspots: [hs('big', {}, { bounds: { x: 0, y: 0, w: 50, h: 50 } }), hs('small', {}, { bounds: { x: 10, y: 10, w: 5, h: 5 } }), hs('edge', {}, { bounds: { x: 45, y: 45, w: 10, h: 10 } })],
      triggers: [],
    },
  });
  const f = only(lintProject(project([s])), 'g');
  assert.equal(f.length, 2);
  const hidden = f.find((x) => x.id === 'big+small');
  assert.ok(hidden.strong);
  assert.match(hidden.message, /nunca llega a small/);
  assert.ok(f.some((x) => x.id === 'big+edge' && !x.strong));
});

test('(g) no salta si solo se tocan los bordes o las flags son complementarias', () => {
  const s = scene('x', {
    regions: {
      hotspots: [hs('a', {}, { bounds: { x: 0, y: 0, w: 10, h: 10 } }), hs('b', {}, { bounds: { x: 10, y: 0, w: 10, h: 10 } }),
        hs('closed', {}, { bounds: { x: 30, y: 0, w: 10, h: 10 }, hideWhenFlag: 'open' }), hs('opened', {}, { bounds: { x: 30, y: 0, w: 10, h: 10 }, showWhenFlag: 'open' }),
        hs('nobounds', {}, { bounds: undefined })],
      triggers: [],
    },
  });
  assert.deepEqual(only(lintProject(project([s])), 'g'), []);
});

// ── Política: excepciones, --scene, --strict ──
test('excepciones con motivo silencian; sin motivo se ignoran; las que sobran se avisan', () => {
  const raw = [
    { rule: 'c', ruleName: 'salidas sin gate', severity: 'warning', scene: 'x', id: 'tr_exit', where: 'x.tr_exit.onEnter[0]', message: '' },
    { rule: 'f', ruleName: 'assets inexistentes', severity: 'error', scene: 'y', id: 'assets/a.png', where: 'y.hs.USE[0]', message: '' },
  ];
  const allow = [
    { rule: 'c', scene: 'x', id: 'tr_*', reason: 'salida intencionada' },
    { rule: 'f', id: 'assets/a.png' },
    { rule: 'g', id: 'nada', reason: 'sobra' },
  ];
  const r = applyPolicy(raw, { allow });
  assert.equal(r.suppressed.length, 1);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'error');
  assert.equal(r.allowProblems.length, 2);
});

test('--strict convierte avisos en errores y --scene filtra', () => {
  const raw = [
    { rule: 'a', severity: 'warning', scene: 'x', scenes: ['x', 'z'], id: 'f', where: 'x.a' },
    { rule: 'g', severity: 'warning', scene: 'y', id: 'a+b', where: 'y.a+b' },
  ];
  const strict = applyPolicy(raw, { strict: true });
  assert.ok(strict.findings.every((f) => f.severity === 'error'));
  assert.deepEqual(applyPolicy(raw, { scene: 'z' }).findings.map((f) => f.id), ['f']);
});

test('tolera escenas con campos opcionales ausentes', () => {
  const bare = { id: 'bare' };
  assert.doesNotThrow(() => lintProject(project([bare, scene('x', { dialogues: {}, walkableAreas: undefined, regions: undefined })])));
});

test('parseStringArray lee las listas de precarga de PreloadScene', () => {
  assert.deepEqual(parseStringArray("const itemIds = [\n 'a', \"b\",\n];", 'itemIds'), ['a', 'b']);
  assert.equal(parseStringArray('nada', 'itemIds'), null);
});

test('(f) A1.4: flicker sin overlay, o con un overlay de otra escena, es error', () => {
  const a = scene('a', { conditionalOverlays: [{ id: 'o', sprite: 'o', flag: 'f' }], regions: { hotspots: [hs('hs', { USE: [{ op: 'flicker', pattern: [1] }] })], triggers: [] } });
  const b = scene('b', { regions: { hotspots: [hs('hs', { USE: [{ op: 'ifFlag', flag: 'f', then: [{ op: 'flicker', overlay: 'o', pattern: [1] }] }] })], triggers: [] } });
  const f = only(lintProject(project([a, b], { files: ['assets/scenes/a/o.png'] })), 'f');
  assert.deepEqual(f.filter((x) => x.where.includes('.hs.')).map((x) => [x.scene, x.severity, x.message.replace(/«.*»/, '«»')]).sort(), [
    ['a', 'error', 'flicker sin overlay'],
    ['b', 'error', 'flicker: el overlay «» no está en conditionalOverlays de b'],
  ]);
  // flicker es presentación: no cuenta como escritura de la flag del overlay ni como estado tras say (d)
  assert.deepEqual(only(lintProject(project([a, b], { files: ['assets/scenes/a/o.png'] })), 'd'), []);
});

// ── A2.6: árboles de diálogo ──
const NPC_FILES = ['assets/sprites/npcs/bob.png'];
const tree = (nodes, start = 'greeting') => ({ t: { id: 't', start, nodes } });

test('(f) A2.6: start, next de nodo y de elección que no existen; elección sin next solo si es salida', () => {
  const s = scene('x', {
    dialogues: {
      ...tree({
        greeting: { text: 'Hi', next: 'hub' },
        hub: { choices: [
          { text: 'A', next: 'a' },
          { text: 'Roto', next: 'nope' },
          { text: 'Sin next' },
          { text: 'Bye', exit: true },
        ] },
        a: { text: 'A!', next: 'missing_node' },
      }),
      t2: { id: 't2', start: 'ghost', nodes: { x: { text: 'x', end: true } } },
    },
  });
  const f = only(lintProject(project([s])), 'f').filter((x) => x.where.includes('dialogues'));
  assert.ok(f.every((x) => x.severity === 'error'));
  const msgs = f.map((x) => x.message).sort();
  assert.equal(msgs.length, 4, msgs.join('\n'));
  assert.ok(msgs.some((m) => /next «missing_node» no existe/.test(m)));
  assert.ok(msgs.some((m) => /«Roto» va a «nope», que no existe/.test(m)));
  assert.ok(msgs.some((m) => /«Sin next» no tiene next/.test(m)));
  assert.ok(msgs.some((m) => /t2: el nodo de inicio «ghost» no existe/.test(m)));
});

test('(f) A2.6a: sintaxis de `when` en nodos y elecciones', () => {
  assert.deepEqual(parseWhen(['knows_gerald', '!beat_chad', 'item:pepememe', '!item:keycard', 'flag:x']).ok, [
    { kind: 'flag', name: 'knows_gerald', negated: false },
    { kind: 'flag', name: 'beat_chad', negated: true },
    { kind: 'item', name: 'pepememe', negated: false },
    { kind: 'item', name: 'keycard', negated: true },
    { kind: 'flag', name: 'x', negated: false },
  ]);
  assert.deepEqual(parseWhen('solo_una').ok.map((c) => c.name), ['solo_una']);
  assert.deepEqual(parseWhen(['!!x', 'item:', 'obj:x', 'a b', 3]).bad, ['!!x', 'item:', 'obj:x', 'a b', 3]);
  const s = scene('x', {
    dialogues: tree({
      greeting: { text: 'Hi', when: ['ok_flag', 'mal escrita'], next: 'hub' },
      hub: { choices: [{ text: 'A', next: 'greeting', when: ['!ok_flag', 'item:'] }, { text: 'Bye', exit: true }] },
    }),
  });
  const f = only(lintProject(project([s])), 'f').filter((x) => x.where.includes('.when'));
  assert.deepEqual(f.map((x) => [x.severity, x.id]).sort(), [['error', 'item:'], ['error', 'mal escrita']]);
});

test('(a)/(b) A2.6a: `when` lee flags y usa objetos; itemDialogues usa su objeto y escribe su setFlag', () => {
  const s = scene('x', {
    regions: { hotspots: [hs('hs_a', { USE: [{ op: 'addItem', id: 'pepememe' }, { op: 'addItem', id: 'vet_bill' }, { op: 'setFlag', flag: 'knows_gerald', value: true }] })], triggers: [] },
    npcs: [{ id: 'npc_bob', name: 'Bob', position: { x: 1, y: 1 }, dialogueTreeId: 't', itemDialogues: { vet_bill: { node: 'hub', setFlag: 'showed_bill' } } }],
    dialogues: tree({
      greeting: { text: 'Hi', next: 'hub' },
      hub: { choices: [{ text: 'Gerald', next: 'greeting', when: ['knows_gerald', 'item:pepememe', '!showed_bill', '!never_set_flag'] }, { text: 'Bye', exit: true }] },
    }),
  });
  const findings = lintProject(project([s], { files: NPC_FILES }));
  assert.deepEqual(only(findings, 'b').map((x) => x.id), [], 'pepememe (when) y vet_bill (itemDialogues) se usan');
  assert.deepEqual(only(findings, 'a').map((x) => x.id), ['never_set_flag'], 'knows_gerald y showed_bill emparejadas');
});

test('(f) A2.6: itemDialogues con árbol o nodo inexistente, o en una NPC sin diálogo', () => {
  const s = scene('x', {
    npcs: [
      { id: 'npc_bob', name: 'Bob', position: { x: 1, y: 1 }, dialogueTreeId: 't', itemDialogues: {
        ok: { node: 'hub' }, ok2: { tree: 't' }, bad_node: { node: 'nope' }, bad_tree: { tree: 'otro' },
      } },
      { id: 'npc_bob2', name: 'Bob2', position: { x: 1, y: 1 }, itemDialogues: { sin_arbol: {}, con_arbol: { tree: 't' } } },
    ],
    dialogues: tree({ greeting: { text: 'Hi', next: 'hub' }, hub: { choices: [{ text: 'Bye', exit: true }] } }),
  });
  const f = only(lintProject(project([s], { files: [...NPC_FILES, 'assets/sprites/npcs/bob2.png'] })), 'f').filter((x) => x.where.includes('itemDialogues'));
  assert.deepEqual(f.map((x) => [x.severity, x.where.split('.').slice(-2).join('.')]).sort(), [
    ['error', 'itemDialogues.bad_node'],
    ['error', 'itemDialogues.bad_tree'],
    ['error', 'itemDialogues.sin_arbol'],
    ['warning', 'itemDialogues.con_arbol'],
  ]);
});

test('A2.6: los árboles reales del juego pasan las reglas nuevas', async () => {
  const fs = await import('node:fs');
  for (const id of ['lobby', 'clinic_interior', 'recovery_pool']) {
    const data = JSON.parse(fs.readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
    const f = only(lintProject(project([{ ...data, id }])), 'f').filter((x) => x.where.includes('dialogues') || x.where.includes('itemDialogues'));
    assert.deepEqual(f, [], id);
    for (const t of Object.values(data.dialogues)) {
      assert.ok(t.nodes.hub, `${id}: el árbol ${t.id} tiene hub`);
      assert.ok(t.nodes.hub.choices.some((c) => c.exit), `${id}: el hub de ${t.id} tiene salida explícita`);
    }
  }
});

// ── (h) diario (A2.9) ──
const jfile = (data, file = 'assets/journal/chapter-1.json') => ({ file, data });
const goodJournal = () => ({
  chapter: 1,
  goals: [{ id: 'g1', text: 'Goal.', doneWhen: 'set_flag' }],
  notes: [{ id: 'n1', text: 'Note.', shownWhen: ['set_flag', 'item:gem'] }, { id: 'n_op', text: 'By op.' }],
  puzzles: [{ id: 'p1', openWhen: 'set_flag', doneWhen: '!ghost_flag', hints: ['a', 'b', 'c'] }],
  anonIdle: ['Nothing.'],
});
const journalScene = () => scene('x', {
  regions: {
    hotspots: [hs('hs_a', {
      PICK: [{ op: 'setFlag', flag: 'set_flag', value: true }, { op: 'addItem', id: 'gem', name: 'Gem' }],
      LOOK: [{ op: 'journalNote', id: 'n_op' }],
    })],
    triggers: [],
  },
});

test('(h) diario válido: sin errores; avisa de la flag que nada pone; sus lecturas cuentan para (a)', () => {
  const p = { ...project([journalScene()]), journal: [jfile(goodJournal())] };
  const all = lintProject(p);
  const h = only(all, 'h');
  assert.deepEqual(h.filter((f) => f.severity === 'error'), []);
  assert.deepEqual(h.map((f) => f.id), ['ghost_flag']);
  assert.equal(h[0].severity, 'warning');
  // set_flag solo lo lee el diario: ya no es «se pone y nunca se lee»
  assert.deepEqual(only(all, 'a').map((f) => f.id), []);
  // Sin diario, sí lo sería
  assert.deepEqual(only(lintProject(project([journalScene()])), 'a').map((f) => f.id), ['set_flag']);
});

test('(h) errores: JSON inválido, capítulo repetido, ids repetidos, condición mal escrita, hints que no son 3, journalNote a una nota que no existe', () => {
  const dup = goodJournal();
  const bad = {
    chapter: 1,
    goals: [{ id: 'g1', text: 'Again.', doneWhen: 'set_flag' }, { id: 'g2', text: '', doneWhen: [] }],
    notes: [{ id: 'n2', text: 'x', shownWhen: 'mal escrita' }],
    puzzles: [{ id: 'p2', doneWhen: 'set_flag', hints: ['solo dos', 'pistas'] }],
    anonIdle: 'not a list',
  };
  const s = journalScene();
  s.regions.hotspots[0].scripts.USE = [{ op: 'journalNote', id: 'no_such_note' }];
  const p = { ...project([s]), journal: [jfile(dup), jfile(bad, 'assets/journal/chapter-1b.json'), { file: 'assets/journal/broken.json', data: null, error: 'no es JSON válido: x' }] };
  const errors = only(lintProject(p), 'h').filter((f) => f.severity === 'error').map((f) => f.message);
  const has = (re) => assert.ok(errors.some((m) => re.test(m)), `falta ${re}: ${errors.join(' | ')}`);
  has(/no es JSON válido/);
  has(/capítulo 1 ya está/);
  has(/id «g1» repetido/);
  has(/falta "text"/);
  has(/falta la condición/);
  has(/«mal escrita» no válida/);
  has(/exactamente 3 textos/);
  has(/anonIdle/);
  has(/journalNote: la nota «no_such_note»/);
});

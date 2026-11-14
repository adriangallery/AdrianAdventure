// A0.4 (plan SCUMM): pruebas del linter de escenas sobre escenas sintéticas en memoria (sin disco ni node_modules).
// node --test tests/lint-scenes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  lintProject, applyPolicy, glowRectDefects, GLOW_RECT_MAX_FRACTION, parseStringArray, parseWhen, depthScaleDefects, depthScaleWalkDefects, depthChangeDefects, MAX_DEPTH_CHANGE, FIXED_SCALE_SCENES, PIXEL_RANGES, FAIL_MIN, FAIL_VERBS, bagDefects, itemDescIds, loadProject,
  ambientDefects, overlayPropDefects, pickedDefects, unretiredItems, ITEM_CHAPTER_SCENES, LAST_CHAPTER, AMBIENT_KINDS, AMBIENT_MAX_COUNT, AMBIENT_MAX_PER_SCENE, AMBIENT_ACTIONS,
} from '../scripts/lint-scenes.mjs';

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
    // A3.6e: el árbol chad_fud da un objeto en su onEnter: los iconos reales de assets/sprites/items existen
    const icons = fs.readdirSync(new URL('../assets/sprites/items/', import.meta.url)).map((n) => `assets/sprites/items/${n}`);
    const f = only(lintProject(project([{ ...data, id }], { files: icons })), 'f').filter((x) => x.where.includes('dialogues') || x.where.includes('itemDialogues'));
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

// ── (i) densidad de píxel (A2.8) ──

test('i: scale a mano en NPC y playerScale antiguo avisan', () => {
  const npc = (extra) => ({ id: 'npc_x', name: 'X', position: { x: 50, y: 90 }, ...extra });
  const f = only(lintProject(project([
    scene('a', { npcs: [npc({ scale: 6.29 })], player: { spawn: { x: 50, y: 95 }, playerScale: 6 } }),
  ])), 'i');
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.severity === 'warning'));
  assert.ok(f.some((x) => x.where === 'a.npcs.npc_x.scale' && /a mano/.test(x.message)));
  assert.ok(f.some((x) => x.where === 'a.player.playerScale'));
  // Sin scale ni playerScale, con artScale válido: nada
  assert.deepEqual(only(lintProject(project([scene('b', { npcs: [npc({ artScale: 1 })] })])), 'i'), []);
});

test('i: pixelScale, depthScale y artScale fuera de rango avisan', () => {
  const npc = { id: 'npc_x', name: 'X', position: { x: 50, y: 90 }, artScale: 9 };
  const f = only(lintProject(project([
    scene('a', { pixelScale: 40, depthScale: { yTop: 90, yBottom: 80, scaleTop: 0.05, scaleBottom: 1 }, npcs: [npc] }),
    scene('b', { pixelScale: 5.5, depthScale: { yTop: 80, yBottom: 91, scaleTop: 0.45, scaleBottom: 1 } }),
    scene('c', { depthScale: 'mucho' }),
  ])), 'i');
  assert.ok(f.some((x) => x.where === 'a.pixelScale'));
  assert.ok(f.some((x) => x.where === 'a.depthScale' && /menor/.test(x.message)));
  assert.ok(f.some((x) => x.where === 'a.depthScale' && /scaleTop = 0.05/.test(x.message)));
  assert.ok(f.some((x) => x.where === 'a.npcs.npc_x.artScale'));
  assert.ok(f.some((x) => x.where === 'c.depthScale'));
  assert.ok(!f.some((x) => x.scene === 'b'), 'la escena válida no avisa');
  assert.deepEqual(depthScaleDefects({ yTop: 0, yBottom: 100, scaleTop: 0.2, scaleBottom: 2 }), []);
  assert.equal(depthScaleDefects({ yTop: 0, yBottom: 101, scaleTop: 1, scaleBottom: 1 }).length, 1);
});

test('i: los rangos del linter son los de src/systems/PixelScale.ts', () => {
  const ts = readFileSync(new URL('../src/systems/PixelScale.ts', import.meta.url), 'utf8');
  const num = (name) => Number(ts.match(new RegExp(`export const ${name} = ([0-9.]+);`))[1]);
  assert.deepEqual(PIXEL_RANGES.pixelScale, [num('PIXEL_SCALE_MIN'), num('PIXEL_SCALE_MAX')]);
  assert.deepEqual(PIXEL_RANGES.depthFactor, [num('DEPTH_FACTOR_MIN'), num('DEPTH_FACTOR_MAX')]);
  assert.deepEqual(PIXEL_RANGES.artScale, [num('ART_SCALE_MIN'), num('ART_SCALE_MAX')]);
});

// ── (k) animación ambiental (A4.3) ──

const AMB_OK = [{ id: 'moths', kind: 'moths', at: { x: 50, y: 50 }, when: '!lamp_off' }, { id: 'glow', kind: 'glow', area: { x: 1, y: 1, w: 10, h: 10 } }];

test('(k) ambient válido: sin hallazgos; sus when cuentan como lectura de flag (a) y uso de objeto (b)', () => {
  const s = scene('x', {
    ambient: [...AMB_OK, { id: 'sway', kind: 'sway', when: 'item:ledger' }],
    regions: { hotspots: [hs('hs_a', { USE: [{ op: 'setFlag', flag: 'lamp_off', value: true }, { op: 'addItem', id: 'ledger', name: 'Ledger' }, { op: 'ambient', id: 'moths', action: 'off' }] })], triggers: [] },
  });
  const p = project([s], { files: ['assets/sprites/items/ledger.png'], src: [['src/scenes/PreloadScene.ts', "const itemIds = ['ledger'];"]] });
  const f = lintProject(p);
  assert.deepEqual(only(f, 'k'), []);
  assert.deepEqual(only(f, 'a'), [], 'lamp_off la lee el ambiente');
  assert.deepEqual(only(f, 'b'), [], 'ledger lo mira el ambiente');
});

test('(k) elemento mal definido = error (y el resto sigue), escena con < 2 válidos = aviso, op ambient a un id ajeno = error', () => {
  const s = scene('x', {
    ambient: [AMB_OK[0], { id: 'bad', kind: 'laser' }, { id: 'glow', kind: 'glow' }],
    regions: { hotspots: [hs('hs_a', { USE: [{ op: 'ambient', id: 'nope', action: 'burst' }, { op: 'ambient', id: 'moths', action: 'explode' }] })], triggers: [] },
  });
  const f = only(lintProject(project([s])), 'k');
  assert.ok(f.some((x) => x.severity === 'error' && /kind «laser» desconocido/.test(x.message)));
  assert.ok(f.some((x) => x.severity === 'error' && /glow necesita area/.test(x.message)));
  assert.ok(f.some((x) => x.severity === 'warning' && /1 elemento\(s\) válido/.test(x.message)));
  assert.ok(f.some((x) => x.severity === 'error' && /«nope» no está en ambient/.test(x.message)));
  assert.ok(f.some((x) => x.severity === 'error' && /action «explode» no válida/.test(x.message)));
  const none = scene('y');
  assert.equal(only(lintProject(project([none])), 'k').filter((x) => x.severity === 'warning').length, 1, 'sin ambient: aviso');
  assert.equal(ambientDefects({ not: 'a list' }, 'z').problems.length, 1);
});

test('k: los tipos, topes y acciones del linter son los de src/systems/Ambient.ts y ScriptEngine.ts', () => {
  const ts = readFileSync(new URL('../src/systems/Ambient.ts', import.meta.url), 'utf8');
  const kinds = ts.match(/export const AMBIENT_KINDS = \[([^\]]*)\]/)[1].match(/'([a-z]+)'/g).map((k) => k.replace(/'/g, ''));
  assert.deepEqual(AMBIENT_KINDS, kinds);
  const num = (name) => Number(ts.match(new RegExp(`export const ${name} = ([0-9.]+);`))[1]);
  assert.equal(AMBIENT_MAX_COUNT, num('AMBIENT_MAX_COUNT'));
  assert.equal(AMBIENT_MAX_PER_SCENE, num('AMBIENT_MAX_PER_SCENE'));
  const engine = readFileSync(new URL('../src/systems/ScriptEngine.ts', import.meta.url), 'utf8');
  const actions = engine.match(/export const AMBIENT_ACTIONS = new Set\(\[([^\]]*)\]\)/)[1].match(/'([a-z]+)'/g).map((k) => k.replace(/'/g, ''));
  assert.deepEqual(AMBIENT_ACTIONS, actions);
  // La validación del linter y la del motor coinciden en los casos de error de parseAmbient (tests/ambient.test.mjs)
  const bad = [{ kind: 'moths', at: { x: 1, y: 1 } }, { id: 'a', kind: 'laser' }, { id: 'b', kind: 'moths' }, { id: 'c', kind: 'dust' }, { id: 'd', kind: 'drip', at: { x: 1, y: 50 } },
    { id: 'd2', kind: 'drip', at: { x: 1, y: 50 }, floorY: 40 }, { id: 'e', kind: 'leds' }, { id: 'f', kind: 'glow', area: { x: 1, y: 1, w: 1, h: 1 }, when: 'mal escrita!' },
    { id: 'g', kind: 'glow', area: { x: 1, y: 1, w: 1, h: 1 }, alpha: 2 }, { id: 'h', kind: 'glow', area: { x: 1, y: 1, w: 1, h: 1 }, alpha: 0.2, alphaMin: 0.5 },
    { id: 'i', kind: 'dust', area: { x: 0, y: 0, w: 0, h: 10 } }, { id: 'j', kind: 'dust', area: { x: 1, y: 1, w: 1, h: 1 }, count: AMBIENT_MAX_COUNT + 1 },
    { id: 'k', kind: 'leds', area: { x: 1, y: 1, w: 1, h: 1 }, colors: ['rojo'] }, { id: 'ok', kind: 'sway' }, { id: 'ok', kind: 'sway' }, 'texto'];
  const r = ambientDefects(bad, 'x');
  assert.deepEqual(r.ok.map((e) => e.id), ['ok']);
  assert.equal(r.problems.length, bad.length - 1);
});

// ── (j) respuestas de fallo (A2.5) ──

/** fail-responses.json mínimo válido (todas las bolsas con su mínimo) */
function failData(extra = {}) {
  const bag = (p, n) => Array.from({ length: n }, (_, i) => `${p} line ${i + 1}.`);
  return {
    verbDefaults: Object.fromEntries(FAIL_VERBS.map((v) => [v, bag(v, 3)])),
    itemVerbDefaults: Object.fromEntries(FAIL_VERBS.filter((v) => v !== 'USE').map((v) => [v, bag(`item ${v}`, 3)])),
    itemHotspot: bag('hotspot', 5),
    itemNpc: { USE: bag('npc use', 3), GIVE: bag('npc give', 3) },
    itemItem: { default: bag('pair', 5), pairs: [] },
    items: {},
    ...extra,
  };
}
const gives = (id, item) => scene(id, { regions: { hotspots: [hs('hs_get', { PICK: [{ op: 'addItem', id: item, name: item }] })], triggers: [] } });

test('j: useResponses con objeto inexistente, bolsa vacía o con marcador = error; combo = aviso', () => {
  const s = scene('x', {
    regions: {
      hotspots: [
        hs('hs_get', { PICK: [{ op: 'addItem', id: 'key', name: 'Key' }] }),
        hs('hs_door', {}, { bounds: { x: 10, y: 10, w: 1, h: 1 }, useResponses: { _default: ['Nope.', 'Still nope.'], key: ['Not that key.'], ghost: ['Who?'], empty: [], marker: ['Using {item} here.'] } }),
        hs('hs_box', {}, { bounds: { x: 20, y: 20, w: 1, h: 1 }, useResponses: { key: ['Never said.'] } }),
      ],
      triggers: [],
    },
    combos: [{ items: ['key', 'hs_box'], script: [{ op: 'say', text: 'Open.' }] }],
    npcs: [{ id: 'npc_a', name: 'A', position: { x: 1, y: 1 }, giveResponses: { _default: 'She declines {item}.', key: ['Thanks.', 'Bad ${x}.'] } }],
  });
  const f = only(lintProject({ ...project([s]), failResponses: { data: failData({ items: { key: ['a.', 'b.', 'c.'] } }) } }), 'j');
  const err = f.filter((x) => x.severity === 'error');
  assert.ok(err.some((x) => x.where === 'x.hs_door.useResponses.ghost' && /no existe/.test(x.message)));
  assert.ok(err.some((x) => x.where === 'x.hs_door.useResponses.empty' && /vacía/.test(x.message)));
  assert.ok(err.some((x) => x.where === 'x.hs_door.useResponses.marker' && /marcador/.test(x.message)));
  assert.ok(err.some((x) => x.where === 'x.npcs.npc_a.giveResponses._default' && /marcador/.test(x.message)));
  assert.ok(err.some((x) => x.where === 'x.npcs.npc_a.giveResponses.key' && /marcador/.test(x.message)));
  // ghost (no existe) también es error en la clave; empty no existe tampoco
  assert.ok(!err.some((x) => x.where === 'x.hs_door.useResponses.key'), 'la pareja válida no da error');
  assert.ok(!err.some((x) => x.where === 'x.hs_door.useResponses._default'), '_default no es un objeto');
  const warn = f.filter((x) => x.severity === 'warning');
  assert.ok(warn.some((x) => x.where === 'x.hs_box.useResponses.key' && /combo/.test(x.message)));
});

test('j: objeto del inventario con < 3 frases de mal uso = aviso; objetos de ITEM_DESCS y de addItem en src/ cuentan', () => {
  const src = [['src/ui/ScummUI.ts', `  private static readonly ITEM_DESCS: Record<string, string> = {\n    lamp: "A lamp.",\n    other_thing: 'Other.',\n  };\n  foo() { this.inventory.addItem('coded_item', 'X'); }`]];
  const f = only(lintProject({ ...project([gives('a', 'key')], { src }), failResponses: { data: failData({ items: { key: ['a.', 'b.'], lamp: ['a.', 'b.', 'c.'], other_thing: ['a.', 'b.', 'c.'] } }) } }), 'j');
  assert.ok(f.every((x) => x.severity === 'warning'), JSON.stringify(f));
  assert.deepEqual(f.map((x) => x.id).sort(), ['coded_item', 'key']);
  assert.ok(f.some((x) => x.id === 'key' && /2 frase/.test(x.message)));
  assert.deepEqual(itemDescIds(src[0][1]), ['lamp', 'other_thing']);
});

test('j: fail-responses.json inválido (JSON, verbos con < 3, objeto + objeto con < 5, parejas, marcadores, objeto inexistente) = error', () => {
  const lint = (failResponses) => only(lintProject({ ...project([gives('a', 'key')]), failResponses }), 'j').filter((x) => x.severity === 'error');
  assert.equal(lint({ data: failData({ items: { key: ['a.', 'b.', 'c.'] } }) }).length, 0, 'datos válidos: sin errores');
  assert.ok(lint({ data: null, error: 'no es JSON válido: x' }).some((x) => /JSON/.test(x.message)));
  const d = failData({ items: { key: ['a.', 'b.', 'c.'], ghost: ['x.'] } });
  d.verbDefaults.PUSH = ['Only one.'];
  delete d.verbDefaults.TALK;
  d.itemItem.default = ['a.', 'b.'];
  d.itemItem.pairs = [{ items: ['key'], lines: ['x.'] }, { items: ['key', 'ghost'], lines: ['Pair {item}.'] }];
  const e = lint({ data: d });
  const at = (where, re) => assert.ok(e.some((x) => x.where === where && re.test(x.message)), `${where} ${re}: ${JSON.stringify(e.map((x) => [x.where, x.message]))}`);
  at('verbDefaults.PUSH', /mínimo 3/);
  at('verbDefaults.TALK', /lista/);
  at('itemItem.default', /mínimo 5/);
  at('itemItem.pairs[0]', /dos ids/);
  at('itemItem.pairs[1]', /ghost/);
  at('itemItem.pairs[1].lines', /marcador/);
  at('items.ghost', /no existe/);
});

test('j: bagDefects y los mínimos del linter son los de src/systems/FailResponses.ts', () => {
  assert.deepEqual(bagDefects('One line.'), []);
  assert.deepEqual(bagDefects(['One.', 'Two.']), []);
  assert.equal(bagDefects('One line.', { listOnly: true }).length, 1);
  assert.equal(bagDefects([]).length, 1);
  assert.ok(/marcador/.test(bagDefects(['Hi ${name}.'])[0]));
  const ts = readFileSync(new URL('../src/systems/FailResponses.ts', import.meta.url), 'utf8');
  const num = (name) => Number(ts.match(new RegExp(`export const ${name} = ([0-9]+);`))[1]);
  assert.deepEqual(FAIL_MIN, { item: num('MIN_ITEM_LINES'), verb: num('MIN_VERB_LINES'), itemItem: num('MIN_ITEM_ITEM_LINES') });
  const verbs = ts.match(/export const FAIL_VERBS = \[([^\]]*)\]/)[1].match(/'([A-Z]+)'/g).map((v) => v.slice(1, -1));
  assert.deepEqual(FAIL_VERBS, verbs);
});

test('j: el proyecto real pasa la regla sin errores ni avisos y tiene las cifras de A2.5', () => {
  const root = new URL('..', import.meta.url).pathname;
  const p = loadProject(root);
  const f = only(lintProject(p), 'j');
  assert.deepEqual(f.map((x) => `${x.severity} ${x.where}: ${x.message}`), []);
  const d = p.failResponses.data;
  assert.ok(Object.keys(d.items).length >= 28, 'todos los objetos con bolsa');
  assert.ok(Object.values(d.items).every((b) => b.length >= 3));
  assert.ok(d.itemItem.pairs.length >= 8);
  let pairs = 0;
  for (const s of Object.values(p.scenes)) {
    for (const h of s.regions?.hotspots ?? []) pairs += Object.keys(h.useResponses ?? {}).filter((k) => k !== '_default').length;
  }
  assert.ok(pairs >= 25, `solo ${pairs} parejas objeto + hotspot`);
});

test('A2.11: depthScaleWalkDefects (depthScale coherente con la zona andable)', () => {
  const walk = [{ x: 0, y: 91, w: 100, h: 9 }, { x: 30, y: 82.5, w: 16, h: 14 }];
  assert.deepEqual(depthScaleWalkDefects({ yTop: 83, yBottom: 92, scaleTop: 0.53, scaleBottom: 1 }, walk), []);
  assert.match(depthScaleWalkDefects({ yTop: 40, yBottom: 60, scaleTop: 0.5, scaleBottom: 1 }, walk)[0], /no corta la zona andable/);
  assert.match(depthScaleWalkDefects({ yTop: 83, yBottom: 92, scaleTop: 1, scaleBottom: 0.5 }, walk)[0], /lo lejano/);
  assert.deepEqual(depthScaleWalkDefects({ yTop: 40, yBottom: 60, scaleTop: 0.5, scaleBottom: 1 }, undefined), []);
  assert.deepEqual(depthScaleWalkDefects(null, walk), [], 'la forma la avisa depthScaleDefects');
  // Las escenas del repo con depthScale son coherentes
  for (const id of ['mountain', 'clinic_exterior']) {
    const sc = JSON.parse(readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
    assert.deepEqual(depthScaleWalkDefects(sc.depthScale, sc.walkableAreas), [], id);
  }
});

// ── (l) cambio de escala (A2.13) ──

test('l: depthScale con un cambio de tamaño > 25 % o en una escena de escala fija = error', () => {
  const f = only(lintProject(project([
    scene('a', { depthScale: { yTop: 80, yBottom: 95, scaleTop: 0.35, scaleBottom: 1 } }),
    scene('b', { depthScale: { yTop: 80, yBottom: 95, scaleTop: 0.75, scaleBottom: 1 } }),
    scene('c', { depthScale: { yTop: 80, yBottom: 95, scaleTop: 1, scaleBottom: 0.7 } }),
    scene('outside', { depthScale: { yTop: 83, yBottom: 92, scaleTop: 0.9, scaleBottom: 1 } }),
    scene('d', {}),
  ])), 'l');
  assert.ok(f.every((x) => x.severity === 'error'));
  assert.ok(f.some((x) => x.where === 'a.depthScale' && /65 %/.test(x.message)));
  assert.ok(f.some((x) => x.where === 'c.depthScale' && /30 %/.test(x.message)), 'también si lo lejano es lo grande');
  assert.ok(f.some((x) => x.where === 'outside.depthScale' && /escala fija/.test(x.message)), 'outside: ni un 10 %');
  assert.ok(!f.some((x) => x.scene === 'b' || x.scene === 'd'), '0,75-1 y sin depthScale no fallan');
  assert.deepEqual(depthChangeDefects({ yTop: 83, yBottom: 92, scaleTop: 1, scaleBottom: 1 }, 'fija'), [], 'scaleTop = scaleBottom vale en una fija');
  assert.deepEqual(depthChangeDefects('mucho'), [], 'la forma la avisa la regla i');
});

test('l: el tope y las escenas fijas coinciden con scripts/lib/proportion.mjs y qa/proportion-refs.json', async () => {
  const prop = await import('../scripts/lib/proportion.mjs');
  assert.equal(MAX_DEPTH_CHANGE, prop.MAX_DEPTH_CHANGE);
  assert.equal(MAX_DEPTH_CHANGE, 0.25);
  const refs = prop.loadRefs();
  for (const id of Object.keys(FIXED_SCALE_SCENES)) assert.equal(refs.scenes.find((r) => r.scene === id)?.scale, 'fixed', id);
  assert.ok(FIXED_SCALE_SCENES.outside, 'outside es de escala fija (Adrián, 11-nov)');
  // Las escenas del repo pasan la regla
  const { scenes } = loadProject(new URL('..', import.meta.url).pathname);
  for (const [id, sc] of Object.entries(scenes)) {
    if (sc.depthScale !== undefined) assert.deepEqual(depthChangeDefects(sc.depthScale, FIXED_SCALE_SCENES[id] ?? false), [], id);
  }
  assert.equal(scenes.outside.depthScale, undefined, 'outside sin depthScale');
});

// A3.3f: (m) props de puzle dibujados
test('overlayPropDefects: flag que nadie pone, caja fuera de todo hotspot, y el caso bueno', () => {
  const hsList = [{ id: 'hs_chimney', bounds: { x: 43, y: 0, w: 7, h: 34 } }];
  const nest = { id: 'nest', flag: 'nest_down', invert: true, bounds: { x: 45, y: 0.5, w: 4.6, h: 9.7 } };
  assert.deepEqual(overlayPropDefects(nest, hsList, () => true), []);
  assert.match(overlayPropDefects(nest, hsList, () => false)[0], /no se quita nunca/);
  assert.match(overlayPropDefects({ ...nest, invert: false }, hsList, () => false)[0], /no sale nunca/);
  assert.match(overlayPropDefects({ ...nest, bounds: { x: 80, y: 50, w: 2, h: 2 } }, hsList)[0], /no toca ningún hotspot/);
  assert.deepEqual(overlayPropDefects({ id: 'full', flag: 'f' }, []), []); // sin bounds: ocupa el fondo entero
  assert.equal(overlayPropDefects({ id: 'x' }).length, 1);
});

test('regla (m) en lintProject: aviso por overlay sin hotspot debajo', () => {
  const s = scene('room', {
    regions: { hotspots: [hs('hs_a', { USE: [{ op: 'setFlag', flag: 'gone', value: true }] }, { bounds: { x: 0, y: 0, w: 10, h: 10 } })], triggers: [] },
    conditionalOverlays: [
      { id: 'ok', sprite: 'o', flag: 'gone', invert: true, bounds: { x: 2, y: 2, w: 3, h: 3 } },
      { id: 'lejos', sprite: 'o', flag: 'gone', bounds: { x: 60, y: 60, w: 3, h: 3 } },
    ],
  });
  const m = only(lintProject(project([s])), 'm');
  assert.deepEqual(m.map((f) => f.id), ['lejos']);
  assert.equal(m[0].severity, 'warning');
});

// ── A9.7: regla (o), objetos que nunca se retiran ──

test('regla (o): avisa del objeto que no se retira y deja de servir antes del último capítulo', () => {
  const give = (id) => ({ PICK: [{ op: 'addItem', id }] });
  // outside (cap. 1) da tres objetos; los tres se usan solo en lobby (cap. 2)
  const outside = scene('outside', { regions: { hotspots: [hs('hs_a', give('plank')), hs('hs_b', give('bill')), hs('hs_c', give('pen')), hs('hs_d', give('note'))], triggers: [] } });
  const lobby = scene('lobby', {
    regions: { hotspots: [hs('hs_door', { USE: [{ op: 'ifHasItem', id: 'bill', then: [{ op: 'setFlag', flag: 'chapter_2_complete', value: true }, { op: 'removeItem', id: 'bill' }] }] })], triggers: [] },
    combos: [{ items: ['plank', 'hs_door'], script: [] }],
    npcs: [{ id: 'npc_x', dialogueTreeId: 't', itemDialogues: { note: { node: 'a' } } }],
    dialogues: { t: { start: 'a', nodes: { a: { text: 'x', when: 'item:pen' } } } },
  });
  // pen también sirve en el último capítulo: no avisa
  const epi = scene('epilogue_outside', { combos: [{ items: ['pen', 'hs_sign'], script: [] }] });
  const o = only(lintProject(project([outside, lobby, epi])), 'o');
  assert.deepEqual(o.map((f) => f.id).sort(), ['note', 'plank']);
  assert.ok(o.every((f) => f.severity === 'warning'));
  assert.match(o.find((f) => f.id === 'plank').message, /cap\. 2.*chapter_2_complete/);
});

test('regla (o): las respuestas de fallo no cuentan como uso; una escena sin capítulo no avisa; global.json retira', () => {
  const outside = scene('outside', {
    regions: { hotspots: [hs('hs_a', { PICK: [{ op: 'addItem', id: 'duck' }, { op: 'addItem', id: 'map' }, { op: 'addItem', id: 'odd' }] })], triggers: [] },
    combos: [{ items: ['duck', 'hs_a'], script: [] }, { items: ['map', 'hs_a'], script: [] }],
    npcs: [{ id: 'npc_y', giveResponses: { duck: 'No, gracias.' } }],
  });
  const limbo = scene('limbo', { combos: [{ items: ['odd', 'hs_z'], script: [] }] });
  const proj = project([outside, limbo]);
  proj.globalScripts = [{ scene: 'global', label: 'itemCombos[0]', ops: [{ op: 'removeItem', id: 'map' }] }];
  assert.deepEqual(only(lintProject(proj), 'o').map((f) => f.id), ['duck']);
  // la función pura también vale suelta
  assert.deepEqual(unretiredItems({ outside }, [{ scene: 'outside', label: 'x', ops: [{ op: 'addItem', id: 'duck' }] }]).map((r) => [r.item, r.lastChapter]), [['duck', 1]]);
});

test('regla (o): ITEM_CHAPTER_SCENES coincide con CHAPTERS de src/systems/ChapterManager.ts', () => {
  const text = readFileSync(new URL('../src/systems/ChapterManager.ts', import.meta.url), 'utf8');
  const chapters = [...text.matchAll(/id:\s*(\d+),[\s\S]*?scenes:\s*\[([^\]]*)\]/g)].map((m) => [Number(m[1]), [...m[2].matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] ?? x[2])]);
  assert.equal(chapters.length, LAST_CHAPTER);
  for (const [id, scenes] of chapters) for (const sc of scenes) assert.ok(ITEM_CHAPTER_SCENES[id].includes(sc), `cap. ${id}: falta ${sc}`);
});

test('regla (o): el repo no tiene objetos sin retirar fuera de las excepciones', () => {
  const root = new URL('..', import.meta.url).pathname;
  const allow = JSON.parse(readFileSync(new URL('../qa/lint-scenes-allow.json', import.meta.url), 'utf8'));
  const { findings } = applyPolicy(lintProject(loadProject(root)), { allow });
  assert.deepEqual(findings.filter((f) => f.rule === 'o').map((f) => f.id), []);
});

test('A9.6 regla (n): aviso por glow rect mayor del 5 % del fondo; ellipse, otros tipos y rect pequeños no', () => {
  assert.equal(GLOW_RECT_MAX_FRACTION, 0.05);
  const glow = (id, area, shape = 'rect', kind = 'glow') => ({ id, kind, shape, area, color: '#40ff80', alpha: 0.2 });
  const amb = [
    glow('caja', { x: 10, y: 19, w: 27, h: 36 }), // el del lobby antes de A9.6: 9,7 %
    glow('pantalla', { x: 17, y: 20, w: 5.3, h: 12.8 }),
    glow('justo', { x: 0, y: 0, w: 10, h: 50 }), // 5 % exacto: no pasa del tope
    glow('halo', { x: 0, y: 0, w: 40, h: 40 }, 'ellipse'),
    glow('tubo', { x: 0, y: 0, w: 50, h: 20 }, 'rect', 'flicker'),
  ];
  const d = glowRectDefects(amb);
  assert.deepEqual(d.map((x) => x.id), ['caja']);
  assert.ok(Math.abs(d[0].fraction - 0.0972) < 1e-9);
  assert.match(d[0].message, /9,7|9\.7/);
  assert.deepEqual(glowRectDefects(undefined), []);
  assert.deepEqual(glowRectDefects([{ id: 'x', kind: 'glow', shape: 'rect' }]), []); // sin area: lo marca la regla k
  const s = scene('room', { ambient: [...amb, { id: 'motas', kind: 'dust', area: { x: 0, y: 0, w: 10, h: 10 } }] });
  const n = only(lintProject(project([s])), 'n');
  assert.deepEqual(n.map((f) => f.id), ['caja']);
  assert.equal(n[0].severity, 'warning');
});

test('A9.6: ninguna escena del juego tiene un glow rect mayor del 5 %', () => {
  const p = loadProject(new URL('..', import.meta.url).pathname);
  assert.deepEqual(only(lintProject(p), 'n').map((f) => f.message), []);
});

// ── (q) pantallas (A2.19) ──
test('A2.19 regla (q): say con screen a una pantalla que no existe = error; screens mal definidas = error', () => {
  const s = scene('room', {
    screens: {
      crt: { bounds: { x: 10, y: 10, w: 5, h: 5 }, color: 'green' },
      rota: { bounds: { x: 98, y: 10, w: 5, h: 5 }, color: 'pink' },
    },
    regions: {
      hotspots: [hs('hs_pc', {
        LOOK: [
          { op: 'say', text: "'OK'", screen: 'crt' },
          { op: 'say', text: "'NO'", screen: 'monitor' },
          { op: 'sayBrief', text: 'x', display: 'X' },
        ],
      })],
      triggers: [],
    },
  });
  const p = only(lintProject(project([s])), 'q');
  const errors = p.filter((f) => f.severity === 'error').map((f) => f.id).sort();
  assert.deepEqual(errors, ['monitor', 'rota', 'rota']);
  assert.equal(p.filter((f) => f.severity === 'warning').length, 1);
});

test('A2.19: SCREEN_COLORS del linter = los de ScreenText.ts; el juego no tiene errores de pantallas', async () => {
  const { SCREEN_COLORS } = await import('../scripts/lint-scenes.mjs');
  const src = readFileSync(new URL('../src/systems/ScreenText.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('SCREEN_PALETTES: Record'), src.indexOf('};', src.indexOf('SCREEN_PALETTES: Record')));
  const names = [...block.matchAll(/^\s+(\w+): \{ fg/gm)].map((m) => m[1]);
  assert.deepEqual(names, SCREEN_COLORS);
  const proj = loadProject(new URL('..', import.meta.url).pathname);
  assert.deepEqual(only(lintProject(proj), 'q').filter((f) => f.severity === 'error').map((f) => f.message), []);
});

// ── A3.11: lo que ya cogiste desaparece (regla p) ──
const pickHs = (extra = {}) => ({
  id: 'hs_mouse',
  name: 'Old Mouse',
  bounds: { x: 10, y: 10, w: 5, h: 5 },
  scripts: { PICK: [{ op: 'ifFlag', flag: 'found_mouse', then: [], else: [{ op: 'addItem', id: 'mouse' }, { op: 'setFlag', flag: 'found_mouse', value: true }] }] },
  ...extra,
});

test('A3.11 (p): un hotspot que da un objeto y no se oculta ni tiene excepción es error', () => {
  const d = pickedDefects(pickHs());
  assert.equal(d.length, 1);
  assert.match(d[0], /no se oculta al cogerlo/);
  assert.deepEqual(pickedDefects({ id: 'hs_x', scripts: { LOOK: [{ op: 'say', text: 'hi' }] } }), [], 'sin addItem no aplica');
});

test('A3.11 (p): oculto con su flag necesita overlay con esa flag o pickedNotDrawn', () => {
  assert.match(pickedDefects(pickHs({ hideWhenFlag: 'found_mouse' }))[0], /no hay overlay/);
  assert.deepEqual(pickedDefects(pickHs({ hideWhenFlag: 'found_mouse' }), [{ id: 'mouse_taken', flag: 'found_mouse' }]), []);
  assert.deepEqual(pickedDefects(pickHs({ hideWhenFlag: 'found_mouse', pickedNotDrawn: 'el ratón no está dibujado aparte' })), []);
  // la flag tiene que ponerla el propio hotspot
  assert.match(pickedDefects(pickHs({ hideWhenFlag: 'otra' }), [{ id: 'o', flag: 'otra' }])[0], /ningún script de este hotspot pone esa flag/);
  // hideWhen con la gramática when: vale la flag no negada
  assert.deepEqual(pickedDefects(pickHs({ hideWhen: ['found_mouse', 'item:mouse'] }), [{ id: 'o', flag: 'found_mouse', invert: true }]), []);
  assert.match(pickedDefects(pickHs({ hideWhen: 'found mouse' }))[0], /hideWhen mal escrito/);
});

test('A3.11 (p): keepAfterPick exige motivo', () => {
  assert.deepEqual(pickedDefects(pickHs({ keepAfterPick: 'el buzón se queda: la carta iba dentro' })), []);
  assert.match(pickedDefects(pickHs({ keepAfterPick: '' }))[0], /sin motivo/);
});

test('A3.11 (p): en las escenas reales todo hotspot con addItem se oculta o tiene excepción (salvo los pendientes de qa/lint-scenes-allow.json)', () => {
  const root = new URL('..', import.meta.url).pathname;
  const allow = JSON.parse(readFileSync(new URL('../qa/lint-scenes-allow.json', import.meta.url), 'utf8'));
  const { findings } = applyPolicy(lintProject(loadProject(root)), { allow });
  assert.deepEqual(findings.filter((f) => f.rule === 'p').map((f) => `${f.where}: ${f.message}`), []);
  // el caso de Adrián (14-nov): el ratón del sótano se oculta y tiene su parche
  const { scenes } = loadProject(root);
  const mouse = scenes.basement.regions.hotspots.find((h) => h.id === 'hs_dead_mouse');
  assert.equal(mouse.hideWhenFlag, 'found_broken_mouse');
  assert.ok(scenes.basement.conditionalOverlays.some((co) => co.flag === 'found_broken_mouse' && !co.invert));
});

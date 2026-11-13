// A2.5 (plan SCUMM): respuestas de fallo (src/systems/FailResponses.ts). Lógica pura, sin navegador: prioridad (pareja >
// _default del hotspot/NPC > bolsa del objeto > genérica), objeto + objeto sin orden, no repetir la última, ronda fija desde 0
// con ?qa=1 (deterministic), validación y los datos reales de assets/config/fail-responses.json y de las escenas.
// CI (Node 22): node --experimental-strip-types --test tests/fail-responses.test.mjs (va en `npm run test:engine`)
// FAIL_RESPONSES_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const F = await import(process.env.FAIL_RESPONSES_PATH ?? '../src/systems/FailResponses.ts');
const { FailResponses, validateFailData, hasMarker, toLines, LAST_RESORT, FAIL_VERBS } = F;

const DATA = JSON.parse(readFileSync(new URL('../assets/config/fail-responses.json', import.meta.url), 'utf8'));
const scenesDir = new URL('../assets/scenes/', import.meta.url);
const SCENES = readdirSync(scenesDir).filter((d) => existsSync(new URL(`${d}/scene.json`, scenesDir)));
const scene = (id) => JSON.parse(readFileSync(new URL(`${id}/scene.json`, scenesDir), 'utf8'));

const data = {
  verbDefaults: { PUSH: ['Push A.', 'Push B.', 'Push C.'] },
  itemVerbDefaults: { OPEN: ['Open A.', 'Open B.', 'Open C.'] },
  itemHotspot: ['Generic A.', 'Generic B.'],
  itemNpc: { USE: ['Npc use A.'], GIVE: ['Npc give A.'] },
  itemItem: { default: ['Pair default A.', 'Pair default B.'], pairs: [{ items: ['duck', 'water'], lines: ['Duck and water.'] }] },
  items: { duck: ['Duck A.', 'Duck B.', 'Duck C.'] },
};

test('prioridad objeto + hotspot: pareja > _default del hotspot > bolsa del objeto > genérica', () => {
  const fr = new FailResponses(data, { deterministic: true });
  const hs = { id: 'hs_door', useResponses: { duck: ['Duck on door.'], _default: ['Door default.'] } };
  let r = fr.itemOnHotspot('duck', hs, 'outside');
  assert.deepEqual(r, { kind: 'item-hotspot', item: 'duck', target: 'hs_door', verb: 'USE', text: 'Duck on door.', bag: 'hotspot:outside/hs_door:duck' });
  r = fr.itemOnHotspot('key', hs, 'outside');
  assert.equal(r.text, 'Door default.');
  assert.equal(r.bag, 'hotspot:outside/hs_door:_default');
  r = fr.itemOnHotspot('duck', { id: 'hs_wall' }, 'outside');
  assert.equal(r.text, 'Duck A.');
  assert.equal(r.bag, 'item:duck');
  r = fr.itemOnHotspot('key', { id: 'hs_wall' }, 'outside');
  assert.equal(r.text, 'Generic A.');
  assert.equal(r.bag, 'itemHotspot');
  assert.deepEqual(fr.last, r, 'last = la última respuesta (state().lastFailResponse)');
  // Una bolsa vacía o solo con marcadores no cuenta: pasa a la siguiente
  r = fr.itemOnHotspot('duck', { id: 'hs_x', useResponses: { duck: [], _default: ['Uses {item}.'] } }, 's');
  assert.equal(r.bag, 'item:duck');
});

test('prioridad objeto + NPC: pareja > _default > bolsa del objeto > genérica por verbo; frase suelta vale', () => {
  const fr = new FailResponses(data, { deterministic: true });
  const responses = { duck: 'She squeaks it.', _default: ['No thanks.', 'Still no.'] };
  assert.equal(fr.itemOnNpc('GIVE', 'duck', { id: 'npc_p', responses }, 'lobby').text, 'She squeaks it.');
  const r = fr.itemOnNpc('GIVE', 'key', { id: 'npc_p', responses }, 'lobby');
  assert.deepEqual([r.kind, r.verb, r.target, r.text, r.bag], ['item-npc', 'GIVE', 'npc_p', 'No thanks.', 'npc:lobby/npc_p:GIVE:_default']);
  assert.equal(fr.itemOnNpc('USE', 'duck', { id: 'npc_q' }, 'lobby').bag, 'item:duck');
  assert.equal(fr.itemOnNpc('USE', 'key', { id: 'npc_q' }, 'lobby').text, 'Npc use A.');
  assert.equal(fr.itemOnNpc('GIVE', 'key', { id: 'npc_q', responses: { _default: 'Old {item} template.' } }, 'lobby').text, 'Npc give A.');
});

test('objeto + objeto: pareja sin orden > bolsa general; verbos y verbos sobre objetos', () => {
  const fr = new FailResponses(data, { deterministic: true });
  assert.equal(fr.itemOnItem('water', 'duck').text, 'Duck and water.');
  assert.equal(fr.itemOnItem('duck', 'water').bag, 'itemItem:duck+water');
  const r = fr.itemOnItem('duck', 'key');
  assert.deepEqual([r.kind, r.item, r.target, r.text, r.bag], ['item-item', 'duck', 'key', 'Pair default A.', 'itemItem']);
  const v = fr.verb('PUSH', 'hs_poster');
  assert.deepEqual([v.kind, v.verb, v.target, v.item, v.text, v.bag], ['verb', 'PUSH', 'hs_poster', null, 'Push A.', 'verb:PUSH']);
  const iv = fr.itemVerb('OPEN', 'duck');
  assert.deepEqual([iv.kind, iv.verb, iv.item, iv.text, iv.bag], ['item-verb', 'OPEN', 'duck', 'Open A.', 'itemVerb:OPEN']);
  assert.equal(fr.verb('TALK').text, LAST_RESORT, 'sin bolsa: último recurso');
  assert.equal(fr.last.bag, 'last-resort');
});

test('determinista (?qa=1): cada bolsa en ronda desde 0, independiente de las demás', () => {
  const fr = new FailResponses(data, { deterministic: true });
  assert.deepEqual([1, 2, 3, 4].map(() => fr.verb('PUSH').text), ['Push A.', 'Push B.', 'Push C.', 'Push A.']);
  assert.equal(fr.itemOnHotspot('duck', { id: 'a' }, 's').text, 'Duck A.', 'otra bolsa empieza en 0');
  assert.equal(fr.itemOnHotspot('duck', { id: 'b' }, 's').text, 'Duck B.', 'la bolsa es del objeto, no del hotspot');
  // Dos instancias deterministas dan la misma secuencia
  const a = new FailResponses(data, { deterministic: true });
  const b = new FailResponses(data, { deterministic: true });
  const seq = (x) => [x.verb('PUSH').text, x.itemOnItem('a', 'b').text, x.verb('PUSH').text, x.itemOnItem('a', 'b').text];
  assert.deepEqual(seq(a), seq(b));
});

test('al azar: nunca repite la última de una bolsa, y acaba usando todas', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const fr = new FailResponses(data, { random });
  const seen = new Set();
  let prev = null;
  for (let i = 0; i < 200; i++) {
    const t = fr.verb('PUSH').text;
    assert.notEqual(t, prev, `repitió «${t}» en la tirada ${i}`);
    prev = t;
    seen.add(t);
  }
  assert.equal(seen.size, 3);
  // Peor caso del azar: siempre 0 o siempre casi 1
  for (const r of [() => 0, () => 0.9999999, () => 1]) {
    const x = new FailResponses(data, { random: r });
    const out = [1, 2, 3, 4, 5].map(() => x.verb('PUSH').text);
    for (let i = 1; i < out.length; i++) assert.notEqual(out[i], out[i - 1]);
  }
  // Una bolsa de una frase siempre la dice
  const one = new FailResponses(data, { random });
  assert.equal(one.itemOnNpc('USE', 'key', { id: 'n' }).text, one.itemOnNpc('USE', 'key', { id: 'n' }).text);
});

test('hasMarker, toLines y validateFailData', () => {
  for (const t of ['Use {item}.', 'x ${a}', '{name}']) assert.ok(hasMarker(t), t);
  for (const t of ['Plain line.', "It's {not closed", 'Braces } alone']) assert.ok(!hasMarker(t), t);
  assert.deepEqual(toLines('One.'), ['One.']);
  assert.deepEqual(toLines(['A.', '', 7, 'B {item}.', 'C.']), ['A.', 'C.']);
  assert.deepEqual(toLines(undefined), []);
  const bad = validateFailData({ ...data, items: { duck: ['ok.'], ghost: [] }, itemItem: { default: ['a.'], pairs: [{ items: ['duck'], lines: ['x.'] }, { items: ['duck', 'water'], lines: ['Water {item}.'] }] } }, ['duck', 'water']);
  for (const re of [/verbDefaults\.LOOK: tiene que ser una lista/, /itemItem\.default: 1 frase/, /itemItem\.pairs\[0\]\.items/, /itemItem\.pairs\[1\]\.lines\[0\]: lleva marcador/, /items\.ghost: el objeto no existe/, /items\.ghost: bolsa vacía/]) {
    assert.ok(bad.some((p) => re.test(p)), `falta ${re}: ${bad.join(' | ')}`);
  }
  assert.ok(!bad.some((p) => /verbDefaults\.PUSH/.test(p)), 'PUSH tiene 3 frases: válido');
});

// ── Datos reales ──

const knownItems = () => {
  const ids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (v.op === 'addItem' && typeof v.id === 'string') ids.add(v.id);
    for (const x of Object.values(v)) walk(x);
  };
  for (const id of SCENES) walk(scene(id));
  const ui = readFileSync(new URL('../src/ui/ScummUI.ts', import.meta.url), 'utf8');
  const at = ui.indexOf('ITEM_DESCS: Record<string, string> = {');
  for (const m of ui.slice(at, ui.indexOf('\n  };', at)).matchAll(/^\s+([a-z0-9_]+):\s*["'`]/gm)) ids.add(m[1]);
  for (const m of ui.matchAll(/addItem\(\s*'([a-z0-9_]+)'/g)) ids.add(m[1]);
  return ids;
};

test('fail-responses.json real: válido, sin marcadores, ≥ 3 frases por objeto y por verbo, ≥ 5 + ≥ 8 parejas de objeto + objeto', () => {
  const items = knownItems();
  assert.deepEqual(validateFailData(DATA, items), []);
  for (const id of items) assert.ok((DATA.items[id] ?? []).length >= 3, `${id}: menos de 3 frases de mal uso`);
  for (const v of FAIL_VERBS) assert.ok(DATA.verbDefaults[v].length >= 3, v);
  assert.ok(DATA.itemItem.default.length >= 5);
  assert.ok(DATA.itemItem.pairs.length >= 8);
  // Las parejas de objeto + objeto no tapan un combo real de global.json
  const global = JSON.parse(readFileSync(new URL('../assets/config/global.json', import.meta.url), 'utf8'));
  const combos = new Set((global.itemCombos ?? []).map((c) => [c.item1, c.item2].sort().join('+')));
  for (const p of DATA.itemItem.pairs) assert.ok(!combos.has([...p.items].sort().join('+')), `${p.items} es un combo de verdad`);
  // Todas las frases distintas (cada una su clip)
  const all = [...Object.values(DATA.verbDefaults), ...Object.values(DATA.itemVerbDefaults), DATA.itemHotspot, ...Object.values(DATA.itemNpc), DATA.itemItem.default, ...DATA.itemItem.pairs.map((p) => p.lines), ...Object.values(DATA.items)].flat();
  assert.equal(new Set(all).size, all.length, 'frases repetidas');
});

test('escenas reales: useResponses de hotspots y bolsas de NPC sin marcadores, objetos que existen, ≥ 25 parejas tentadoras', () => {
  const items = knownItems();
  let pairs = 0;
  let npcDefaults = 0;
  const fr = new FailResponses(DATA, { deterministic: true });
  for (const id of SCENES) {
    const s = scene(id);
    const combos = new Set((s.combos ?? []).map((c) => [...c.items].sort().join('+')));
    for (const hs of s.regions.hotspots) {
      for (const [k, v] of Object.entries(hs.useResponses ?? {})) {
        assert.ok(Array.isArray(v) && v.length, `${id}.${hs.id}.${k}: lista vacía`);
        for (const t of v) assert.ok(!hasMarker(t), `${id}.${hs.id}.${k}: marcador en «${t}»`);
        if (k === '_default') { assert.ok(v.length >= 3, `${id}.${hs.id}._default con menos de 3`); continue; }
        assert.ok(items.has(k), `${id}.${hs.id}: objeto «${k}» no existe`);
        assert.ok(!combos.has([k, hs.id].sort().join('+')), `${id}.${hs.id}+${k} es un combo: nunca se diría`);
        assert.equal(fr.itemOnHotspot(k, hs, id).text, v[0]);
        pairs++;
      }
    }
    for (const n of s.npcs ?? []) {
      for (const field of ['giveResponses', 'useResponses']) {
        const map = n[field] ?? {};
        for (const [k, v] of Object.entries(map)) {
          for (const t of [v].flat()) assert.ok(!hasMarker(t), `${id}.${n.id}.${field}.${k}: marcador en «${t}»`);
          if (k !== '_default') { assert.ok(items.has(k), `${id}.${n.id}.${field}: objeto «${k}» no existe`); continue; }
          assert.ok(Array.isArray(v) && v.length >= 3, `${id}.${n.id}.${field}._default: bolsa de menos de 3`);
          npcDefaults++;
        }
      }
    }
  }
  assert.ok(pairs >= 25, `solo ${pairs} parejas objeto + hotspot`);
  assert.equal(npcDefaults, 4, 'Penny y Dr. Satoshi, USE y GIVE');
});

// ── A2.18: dar a alguien / a algo ──

test('A2.18 GIVE a NPC: pareja de la NPC > negativa propia del objeto > _default > bolsas; isNpcBag', () => {
  const fr = new FailResponses(data, { deterministic: true });
  const responses = { duck: 'She squeaks it.', _default: ['No thanks.'] };
  const own = 'Not giving my duck away.';
  assert.equal(fr.itemOnNpc('GIVE', 'duck', { id: 'npc_p', responses }, 'lobby', own).text, 'She squeaks it.');
  const r = fr.itemOnNpc('GIVE', 'key', { id: 'npc_p', responses }, 'lobby', 'My key. Mine.');
  assert.deepEqual([r.text, r.bag], ['My key. Mine.', 'own:key:GIVE']);
  assert.equal(fr.itemOnNpc('GIVE', 'key', { id: 'npc_p', responses }, 'lobby', null).bag, 'npc:lobby/npc_p:GIVE:_default');
  assert.equal(fr.itemOnNpc('GIVE', 'key', { id: 'npc_q' }, 'lobby').bag, 'itemNpc:GIVE');
  assert.equal(F.isNpcBag('npc:lobby/npc_p:GIVE:_default'), true);
  for (const b of ['own:key:GIVE', 'item:duck', 'itemNpc:GIVE', 'verb:GIVE']) assert.equal(F.isNpcBag(b), false, b);
});

test('A2.18 GIVE a un hotspot u objeto: bolsa verbDefaults.GIVE con su tipo', () => {
  const fr = new FailResponses({ verbDefaults: { GIVE: ['Whom? A.', 'Whom? B.'] } }, { deterministic: true });
  assert.deepEqual(fr.itemGive('duck', 'hs_poster'), { kind: 'item-hotspot', item: 'duck', target: 'hs_poster', verb: 'GIVE', text: 'Whom? A.', bag: 'verb:GIVE' });
  assert.deepEqual(fr.itemGive('duck', 'water', 'item-item'), { kind: 'item-item', item: 'duck', target: 'water', verb: 'GIVE', text: 'Whom? B.', bag: 'verb:GIVE' });
});

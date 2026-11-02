// A0.3 (plan SCUMM): pruebas de la extracción de voces, las claves y la cobertura (en memoria; sin node_modules).
// node --test tests/voice-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, keyFor, speakerFor, extractScene, extractCode, extractJournal, extractFailResponses, extractProject, resolve, loadVoices, CODE_SOURCES, FAIL_RESPONSES_FILE } from '../scripts/voices/extract.mjs';
import { buildConfig } from '../scripts/voices/build-config.mjs';
import { checkCoverage, applyAllow } from '../scripts/voice-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voices = loadVoices(ROOT);

const scene = {
  id: 'synthetic',
  onEnter: [{ op: 'ifFlag', flag: 'x', then: [{ op: 'sayBrief', text: 'Brief line here.' }], else: [] }],
  regions: {
    hotspots: [{ id: 'hs', scripts: { LOOK: [{ op: 'say', text: 'A shiny synthetic thing.' }], USE: [{ op: 'say', text: '...' }] } }],
    triggers: [{ id: 't', onEnter: [{ op: 'say', text: 'Beep boop.', speaker: 'B.O.T.' }] }],
  },
  combos: [{ items: ['a', 'b'], script: [{ op: 'narrative', lines: ['Long ago...', 'In a block far away.'] }, { op: 'titleCard', chapter: '1', title: 'Title' }] }],
  dialogues: {
    tree: {
      nodes: {
        a: { speaker: 'Dr. Satoshi', text: 'I run this clinic.', choices: [{ text: 'Who are you?', next: 'b' }] },
        b: { speaker: 'Receptionist', text: 'Welcome to the lab!', onEnter: [{ op: 'say', text: 'Said inside a node.' }] },
        c: { speaker: 'Vitalik', text: 'Someone brand new.' },
      },
    },
  },
  npcs: [{ id: 'npc_x', name: 'X', giveResponses: { _default: 'Not {item}.', duck: "She squeaks it. 'Nice.'" }, useResponses: {} }],
};

test('claves: las de clips reales salen igual que hoy (esquema de generate_memelab_voices.py)', () => {
  const cases = [
    ['player', 'The CRT is dead. I need to power it up first.', 'player_the_crt_is_dead_i_need_6baa1ede'],
    ['player', 'The glass is already gone. The switch is right there.', 'player_the_glass_is_already_gone_the_1dfe11ec'],
  ];
  for (const [spk, text, key] of cases) {
    assert.equal(keyFor(spk, text), key);
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/audio/voice', `${key}.mp3`)), `${key}.mp3 existe`);
  }
  assert.equal(normalise("It's  A — Test!"), 'its a test');
});

test('hablante: B.O.T., Satoshi, recepcionista, sin speaker y desconocido', () => {
  assert.equal(speakerFor('B.O.T.', voices), 'bot');
  assert.equal(speakerFor('Dr. Satoshi', voices), 'satoshi');
  assert.equal(speakerFor('Receptionist', voices), 'recep');
  assert.equal(speakerFor(undefined, voices), 'player');
  assert.equal(speakerFor('Vitalik', voices), 'npc');
  for (const s of ['player', 'satoshi', 'recep', 'bot', 'nar', 'npc']) assert.ok(voices.speakers[s]?.voice, `voz para ${s}`);
  const ids = ['recep', 'nar', 'npc', 'player'].map((s) => voices.speakers[s].voice);
  assert.equal(new Set(ids).size, ids.length, 'recepcionista, narrador, npc y jugador con voces distintas');
});

test('hablante: reparto de A3.3b (Penny, Anon, DOORIS, PZ-BOT, Gwei, Chad)', () => {
  assert.equal(speakerFor('Penny', voices), 'recep', 'Penny es la recepcionista: misma clave de clip');
  assert.equal(speakerFor('Anon', voices), 'anon');
  assert.equal(speakerFor('Adrian', voices), 'anon', 'Anon es Adrian');
  assert.equal(speakerFor('DOORIS', voices), 'dooris');
  assert.equal(speakerFor('PZ-BOT', voices), 'pzbot', 'pz-bot va antes que b.o.t');
  assert.equal(speakerFor('PZBot', voices), 'pzbot');
  assert.equal(speakerFor('B.O.T.', voices), 'bot', 'B.O.T. sigue siendo bot');
  assert.equal(speakerFor('Nurse Gwei', voices), 'gwei');
  assert.equal(speakerFor('Chad', voices), 'chad');
  const want = { dooris: ['af_nicole', 'a', 1.0], anon: ['am_onyx', 'a', 0.9], gwei: ['bf_emma', 'b', 1.0], chad: ['am_puck', 'a', 1.0], pzbot: ['am_michael', 'a', 1.25] };
  for (const [id, [voice, lang, speed]] of Object.entries(want)) {
    assert.deepEqual([voices.speakers[id]?.voice, voices.speakers[id]?.lang, voices.speakers[id]?.speed], [voice, lang, speed], id);
    assert.ok(voices.speakers[id].why, `why para ${id}`);
  }
  assert.equal(voices.speakers.pzbot.voice, voices.speakers.player.voice, 'PZ-BOT = voz de Dex acelerada (pista del giro)');
});

test('extracción de una escena sintética: qué entra y qué no', () => {
  const out = extractScene('synthetic', scene, voices);
  const texts = out.map((e) => e.text);
  for (const t of ['Brief line here.', 'A shiny synthetic thing.', 'Beep boop.', 'I run this clinic.', 'Welcome to the lab!', 'Said inside a node.', 'Someone brand new.', "She squeaks it. 'Nice.'", 'Long ago...', 'In a block far away.']) {
    assert.ok(texts.includes(t), `falta «${t}»`);
  }
  for (const t of ['...', 'Who are you?', 'Not {item}.', 'Title']) assert.ok(!texts.includes(t), `sobra «${t}»`);
  const by = Object.fromEntries(out.map((e) => [e.text, e]));
  assert.equal(by['Beep boop.'].speaker, 'bot');
  assert.equal(by['I run this clinic.'].speaker, 'satoshi');
  assert.equal(by['Welcome to the lab!'].speaker, 'recep');
  assert.equal(by['Someone brand new.'].speaker, 'npc');
  assert.equal(by["She squeaks it. 'Nice.'"].speaker, 'player');
  assert.equal(by['Long ago...'].kind, 'narrative');
  assert.equal(out.length, 10);
});

test('extracción de código: tablas y say literales, sin claves de objeto ni plantillas', () => {
  const src = `
    private static readonly TABLE: Record<string, string> = {
      'quoted-key': "First value.",
      other: 'It\\'s the second — value.', // comentario "no cuenta"
    };
    foo() { this.events.emit('say', ok ? "Yes it is." : \`Template \${x}\`, speaker); this.events.emit('say', \`Only \${t}\`); }
  `;
  const out = extractCode('x.ts', src, { blocks: ['TABLE: Record<string, string> ='], emitSay: true });
  assert.deepEqual(out.map((e) => e.text), ['First value.', "It's the second — value.", 'Yes it is.']);
});

test('resolve: clip del mapa anterior, clip nuevo en disco y sin clip', () => {
  const fixed = { textMap: [{ text: 'A shiny synthetic thing!!', key: 'player_old_scheme_key' }], narratorSequences: { 'synthetic:narrative': ['nar_synthetic_0'] }, audioKeys: [] };
  const raw = extractScene('synthetic', scene, voices);
  const files = new Set(['player_old_scheme_key', 'nar_synthetic_0', keyFor('bot', 'Beep boop.')]);
  const r = resolve(raw, { fixed, files });
  const st = (k) => r.find((e) => e.key === k)?.status;
  assert.equal(st('player_old_scheme_key'), 'fixed');
  assert.equal(st('synthetic:narrative'), 'fixed');
  assert.equal(st(keyFor('bot', 'Beep boop.')), 'clip');
  assert.equal(st(keyFor('satoshi', 'I run this clinic.')), 'missing');
});

test('cobertura: falla con texto sin clip, excepciones con motivo y voice.config.ts al día', () => {
  const fixed = { textMap: [{ comment: 'viejo' }, { text: 'Old line.', key: 'player_old_line_aaaaaaaa' }], narratorSequences: {}, audioKeys: ['player_old_line_aaaaaaaa'] };
  const raw = [
    { kind: 'line', speaker: 'player', text: 'Old line.', where: 's: a' },
    { kind: 'line', speaker: 'player', text: 'New line with clip.', where: 's: b' },
    { kind: 'line', speaker: 'player', text: 'New line without clip.', where: 's: c' },
  ];
  const kNew = keyFor('player', 'New line with clip.');
  const kMissing = keyFor('player', 'New line without clip.');
  const files = new Set(['player_old_line_aaaaaaaa', kNew]);
  const configText = buildConfig({ fixed, files, resolved: resolve(raw, { fixed, files }) }).text;
  assert.match(configText, new RegExp(`\\{ text: 'New line with clip\\.', key: '${kNew}' \\}`));
  assert.ok(configText.indexOf("// viejo") < configText.indexOf('Old line.'), 'conserva el orden y los comentarios');

  let r = checkCoverage({ raw, fixed, files, configText });
  assert.deepEqual(r.errors.map((e) => [e.type, e.key]), [['sin-clip', kMissing]]);

  r = checkCoverage({ raw, fixed, files, configText, allow: [{ key: kMissing, reason: 'transición A0.3' }, { text: 'Nada', reason: 'sobra' }] });
  assert.equal(r.errors.length, 0);
  assert.equal(r.summary.allowed, 1);
  assert.ok(r.warnings.some((w) => w.type === 'excepción' && /no silencia nada/.test(w.text)));

  r = checkCoverage({ raw, fixed, files: new Set([...files, 'player_huerfano_bbbbbbbb']), configText, allow: [{ key: kMissing, reason: 'x' }] });
  assert.deepEqual(r.errors.map((e) => e.type), ['desactualizado'], 'un mp3 sin registrar es error');

  assert.equal(applyAllow([{ key: 'k', text: 't' }], [{ key: 'k' }]).missing.length, 1, 'sin motivo no vale');
});

test('el voice.config.ts del repo es exactamente lo que genera build-config.mjs', async () => {
  const { buildFromDisk } = await import('../scripts/voices/build-config.mjs');
  assert.equal(fs.readFileSync(path.join(ROOT, 'src/config/voice.config.ts'), 'utf8'), buildFromDisk(ROOT).text);
});

test('A2.9: Anon (am_onyx) — speaker «Anon» y «Adrian» → anon, voz propia distinta de Dex y Satoshi', () => {
  assert.equal(speakerFor('Anon', voices), 'anon');
  assert.equal(speakerFor('ADRIAN', voices), 'anon');
  assert.equal(voices.speakers.anon.voice, 'am_onyx');
  assert.equal(voices.speakers.anon.speed, 0.9);
  assert.notEqual(voices.speakers.anon.voice, voices.speakers.player.voice);
  assert.notEqual(voices.speakers.anon.voice, voices.speakers.satoshi.voice);
});

test('A2.9: diario — se extraen las pistas de Anon y su relleno (no objetivos ni notas, que solo se leen)', () => {
  const data = {
    chapter: 1,
    goals: [{ id: 'g', text: 'A goal nobody says.', doneWhen: 'x' }],
    notes: [{ id: 'n', text: 'A note nobody says.' }],
    puzzles: [{ id: 'p', doneWhen: 'x', hints: ['Hint one.', 'Hint two.', 'Hint three.'] }],
    anonIdle: ['Idle line.', ''],
  };
  const out = extractJournal('assets/journal/x.json', data, voices);
  assert.deepEqual(out.map((e) => e.text), ['Hint one.', 'Hint two.', 'Hint three.', 'Idle line.']);
  assert.ok(out.every((e) => e.speaker === 'anon'));
  assert.equal(keyFor('anon', 'Hint one.').startsWith('anon_hint_one_'), true);
  // El relleno de Journal.ts va con speaker anon
  const spec = CODE_SOURCES.find((c) => c.file === 'src/systems/Journal.ts');
  const code = extractCode(spec.file, "export const ANON_FALLBACK = 'Nothing to say. Keep walking.';", spec);
  assert.deepEqual(code.map((e) => [e.speaker, e.text]), [['anon', 'Nothing to say. Keep walking.']]);
});

test('A2.9: el proyecto real extrae todas las pistas de assets/journal con voz de Anon', () => {
  const raw = extractProject(ROOT, voices);
  const dir = path.join(ROOT, 'assets', 'journal');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of data.puzzles ?? []) {
      for (const h of p.hints) assert.ok(raw.some((e) => e.text === h && e.speaker === 'anon'), `sin extraer: ${h}`);
    }
    for (const g of data.goals ?? []) assert.ok(!raw.some((e) => e.text === g.text), `un objetivo no se dice: ${g.text}`);
  }
  assert.ok(raw.some((e) => e.speaker === 'anon' && /Nothing to say\. Keep walking\./.test(e.text)));
});

test('A2.5: respuestas de fallo — bolsas de NPC (_default incluido), useResponses de hotspots y fail-responses.json, sin marcadores', () => {
  const s = {
    regions: {
      hotspots: [{ id: 'hs_door', scripts: {}, useResponses: { _default: ['Door one.', 'Door two.'], key: ['The key is not it.'], bad: ['Uses {item} here.'] } }],
      triggers: [],
    },
    npcs: [{
      id: 'npc_y', name: 'Y',
      giveResponses: { _default: ['Gift one.', 'Gift {item} two.', 'Gift three.'], duck: 'Single duck line.' },
      useResponses: { _default: 'Old {item} template.', key: ['Key on Y.'] },
    }],
  };
  const out = extractScene('s', s, voices);
  assert.deepEqual(out.map((e) => e.text).sort(), ['Door one.', 'Door two.', 'Gift one.', 'Gift three.', 'Key on Y.', 'Single duck line.', 'The key is not it.'].sort());
  assert.ok(out.every((e) => e.speaker === 'player'));
  assert.ok(out.some((e) => e.where === 'regions.hotspots.hs_door.useResponses._default[1]'));
  assert.ok(out.some((e) => e.where === 'npcs.npc_y.giveResponses._default[2]'));

  const data = {
    verbDefaults: { PUSH: ['Push one.', 'Push two.'] },
    itemVerbDefaults: { OPEN: ['Open one.'] },
    itemHotspot: ['Generic hotspot.'],
    itemNpc: { USE: ['Generic npc use.'], GIVE: ['Generic npc give.'] },
    itemItem: { default: ['Generic pair.'], pairs: [{ items: ['a', 'b'], lines: ['A and B.', 'A with {item}.'] }] },
    items: { duck: ['Duck misuse.'] },
  };
  const g = extractFailResponses(FAIL_RESPONSES_FILE, data);
  assert.deepEqual(g.map((e) => e.text).sort(), ['A and B.', 'Duck misuse.', 'Generic hotspot.', 'Generic npc give.', 'Generic npc use.', 'Generic pair.', 'Open one.', 'Push one.', 'Push two.'].sort());
  assert.ok(g.every((e) => e.speaker === 'player' && e.where.startsWith(`${FAIL_RESPONSES_FILE}: `)));
});

test('A2.5: el proyecto real extrae todas las frases de fail-responses.json y de los useResponses de las escenas', () => {
  const raw = extractProject(ROOT, voices);
  const texts = new Set(raw.map((e) => e.text));
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, FAIL_RESPONSES_FILE), 'utf8'));
  const all = [
    ...Object.values(data.verbDefaults).flat(), ...Object.values(data.itemVerbDefaults).flat(), ...data.itemHotspot,
    ...Object.values(data.itemNpc).flat(), ...data.itemItem.default, ...data.itemItem.pairs.flatMap((p) => p.lines),
    ...Object.values(data.items).flat(),
  ];
  assert.ok(all.length >= 150, `solo ${all.length} frases globales`);
  for (const t of all) assert.ok(texts.has(t), `sin extraer: ${t}`);
  const scenesDir = path.join(ROOT, 'assets/scenes');
  let local = 0;
  for (const id of fs.readdirSync(scenesDir)) {
    const f = path.join(scenesDir, id, 'scene.json');
    if (!fs.existsSync(f)) continue;
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const hs of s.regions?.hotspots ?? []) {
      for (const v of Object.values(hs.useResponses ?? {})) for (const t of [v].flat()) { local++; assert.ok(texts.has(t), `${id}.${hs.id}: sin extraer: ${t}`); }
    }
    for (const n of s.npcs ?? []) {
      for (const field of ['giveResponses', 'useResponses']) {
        for (const t of [n[field]?._default ?? []].flat()) {
          assert.ok(!/\{[^{}]*\}/.test(t), `${id}.${n.id}.${field}._default lleva marcador: ${t}`);
          assert.ok(texts.has(t), `sin extraer: ${t}`);
        }
      }
    }
  }
  assert.ok(local >= 100, `solo ${local} frases en useResponses de hotspots`);
  // Las plantillas viejas ya no están en el código
  for (const file of ['src/scenes/GameScene.ts', 'src/scenes/UIScene.ts', 'src/ui/ScummUI.ts']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/I can't use \$\{|doesn't want \$\{|Nothing special about it\.`/.test(src), `${file} aún tiene una plantilla de fallo`);
  }
});

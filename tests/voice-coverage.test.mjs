// A0.3 (plan SCUMM): pruebas de la extracción de voces, las claves y la cobertura (en memoria; sin node_modules).
// node --test tests/voice-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, keyFor, speakerFor, extractScene, extractCode, resolve, loadVoices } from '../scripts/voices/extract.mjs';
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

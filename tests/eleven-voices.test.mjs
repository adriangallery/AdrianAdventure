// A6.1/A6.2 (plan SCUMM): guion congelado de las voces y lógica de caché de eleven-tts (sin red, sin node_modules).
// node --test tests/eleven-voices.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleFor, ttsText, lineHash, categoryFor } from '../scripts/voices/script-lock.mjs';
import { roleConfig, signature, pending, parseArgs } from '../scripts/voices/eleven-tts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cast = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/voices/elevenlabs-cast.json'), 'utf8'));

test('papel: npc se parte en monos de club, monos bro y máquinas', () => {
  assert.equal(roleFor({ speaker: 'npc', sources: ['recovery_pool: dialogues.apes_left.d1'] }), 'apes_club');
  assert.equal(roleFor({ speaker: 'npc', sources: ['recovery_pool: dialogues.apes_right.d3'] }), 'apes_bro');
  assert.equal(roleFor({ speaker: 'npc', sources: ['basement: dialogues.ledger_pin.ok'] }), 'device');
  assert.equal(roleFor({ speaker: 'anon', sources: ['x'] }), 'anon');
});

test('texto TTS: sin acotaciones entre asteriscos; si solo hay acotación, se queda su texto', () => {
  assert.equal(ttsText('*scans face* Identity: UNKNOWN.'), 'Identity: UNKNOWN.');
  assert.equal(ttsText('Patient Zero... *servos whir* My data'), 'Patient Zero... My data');
  assert.equal(ttsText('*bzzz*'), 'bzzz');
});

test('categoría y hash estable por texto + papel', () => {
  assert.equal(categoryFor({ sources: ['assets/config/fail-responses.json: verbDefaults.PUSH[0]'] }), 'fallo');
  assert.equal(categoryFor({ sources: ['lobby: dialogues.penny.hello'] }), 'dialogo');
  assert.equal(lineHash('Hi.', 'dooris'), lineHash('Hi.', 'dooris'));
  assert.notEqual(lineHash('Hi.', 'dooris'), lineHash('Hi.', 'recep'));
});

test('reparto: todos los papeles del lock tienen voz y PZ-BOT usa la de Dex', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/voices-script.lock.json'), 'utf8'));
  for (const role of new Set(lock.lines.map((l) => l.role))) assert.ok(roleConfig(cast, role), `sin voz: ${role}`);
  assert.equal(cast.roles.pzbot.voice_id, cast.roles.player.voice_id);
  const kokoroDex = { ...cast, roles: { ...cast.roles, player: { ...cast.roles.player, engine: 'kokoro' } } };
  assert.equal(roleConfig(kokoroDex, 'pzbot'), null, 'si Dex se queda en Kokoro, PZ-BOT también');
});

test('caché: misma firma no se regenera; cambiar la voz o el texto sí', () => {
  const line = { key: 'dooris_hi_x', role: 'dooris', speaker: 'dooris', tts: 'Hi.', chars: 3, hash: lineHash('Hi.', 'dooris') };
  const lock = { lines: [line] };
  const cfg = roleConfig(cast, 'dooris');
  const opts = parseArgs(['--dry-run']);
  assert.equal(pending(lock, cast, {}, opts).length, 1);
  assert.equal(pending(lock, cast, { dooris_hi_x: { sig: signature(line, cfg) } }, opts).length, 0);
  const other = { ...cast, roles: { ...cast.roles, dooris: { ...cast.roles.dooris, voice_id: 'otra' } } };
  assert.equal(pending(lock, other, { dooris_hi_x: { sig: signature(line, cfg) } }, opts).length, 1);
  const changed = { lines: [{ ...line, hash: lineHash('Hello.', 'dooris') }] };
  assert.equal(pending(changed, cast, { dooris_hi_x: { sig: signature(line, cfg) } }, opts).length, 1);
});

test('sin --dry-run hace falta --limite-creditos', () => {
  assert.throws(() => parseArgs(['--solo', 'player']), /limite-creditos/);
  assert.equal(parseArgs(['--limite-creditos', '500', '--solo', 'player,anon']).solo.size, 2);
});

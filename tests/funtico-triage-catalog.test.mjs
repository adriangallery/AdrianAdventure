// F1.1 (plan FUNTICO_ADVENTURE): el catálogo versionado de Triage (src/funtico/triage/catalog.json) coincide con lo que
// genera scripts/funtico/build-triage-catalog.mjs desde las escenas, y tiene lo que el generador necesita.
// Si falla «al día»: node scripts/funtico/build-triage-catalog.mjs y commit (y revisa el golden de funtico-triage).
// CI (Node 22): parte de `npm run test:funtico`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, serialize, catalogHash, CATALOG_FILE, DEFAULT_SCENES, initialLookLines, visibleAtStart } from '../scripts/funtico/build-triage-catalog.mjs';
import { BUCKETS, catalogId } from '../src/funtico/triage/triage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileText = fs.readFileSync(path.join(ROOT, CATALOG_FILE), 'utf8');
const catalog = JSON.parse(fileText);
const built = buildCatalog({ root: ROOT });

test('catálogo al día: el versionado es byte a byte lo que genera el script', () => {
  assert.equal(fileText, serialize(built.catalog), `${CATALOG_FILE} desactualizado: node scripts/funtico/build-triage-catalog.mjs`);
});

test('hash del catálogo = sha256 del JSON canónico sin el campo hash', () => {
  assert.match(catalog.hash, /^[0-9a-f]{64}$/);
  assert.equal(catalogHash(catalog), catalog.hash);
  assert.equal(catalogId(catalog), `1:${catalog.hash.slice(0, 12)}`);
  // cualquier cambio en un objetivo cambia el hash
  const tampered = structuredClone(catalog);
  tampered.targets[0].bounds.x += 1;
  assert.notEqual(catalogHash(tampered), catalog.hash);
});

test('cada escena del MVP tiene al menos 2 objetivos en cada cubo, ids únicos', () => {
  assert.deepEqual(Object.keys(catalog.scenes), DEFAULT_SCENES);
  for (const scene of DEFAULT_SCENES) {
    for (const bucket of BUCKETS) {
      const n = catalog.targets.filter((t) => t.scene === scene && t.bucket === bucket).length;
      assert.ok(n >= 2, `${scene}/${bucket}: ${n}`);
    }
  }
  const ids = catalog.targets.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('objetivos: bounds del scene.json, frase LOOK del estado inicial y voz que existe en disco', () => {
  const voices = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/voices/voices.json'), 'utf8'));
  for (const t of catalog.targets) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/scenes', t.scene, 'scene.json'), 'utf8'));
    const hs = scene.regions.hotspots.find((h) => h.id === t.hotspot);
    assert.ok(hs, t.id);
    assert.ok(visibleAtStart(hs), `${t.id} no es visible al empezar`);
    assert.deepEqual(t.bounds, { x: hs.bounds.x, y: hs.bounds.y, w: hs.bounds.w, h: hs.bounds.h });
    assert.deepEqual(t.look, initialLookLines(hs.scripts.LOOK, voices));
    assert.ok(t.look.includes(t.phrase), t.id);
    assert.ok(t.voice, `${t.id} sin voz`);
    assert.ok(fs.existsSync(path.join(ROOT, t.voice.file)), t.voice.file);
  }
  // el condicional se resuelve por la rama «else» (estado inicial): la veleta todavía está oxidada
  const vane = catalog.targets.find((t) => t.id === 'rooftop:hs_weather_vane');
  assert.equal(vane.phrase, 'Rusted solid. It needs grease. A lot of grease.');
  // el Lambo solo aparece al final del juego (showWhenFlag): fuera
  assert.ok(!catalog.targets.some((t) => t.id === 'outside:hs_lambo'));
  assert.ok(built.excluded.some((e) => e.id === 'outside:hs_lambo'));
});

test('RELAPSE: rondas de chad_fud con la réplica buena sacada del árbol', () => {
  const tree = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/scenes/recovery_pool/scene.json'), 'utf8')).dialogues.chad_fud;
  const rounds = catalog.relapse.rounds;
  assert.deepEqual(rounds.map((r) => r.id), ['i3', 'i1', 'i5']);
  for (const r of rounds) {
    const node = tree.nodes[r.id];
    assert.equal(r.fud, node.text);
    assert.equal(r.options.length, 4);
    const good = node.choices.find((c) => c.text === r.options[r.correct].text && /^fud_r\d$/.test(c.when));
    assert.ok(good && good.next !== 'lose', `${r.id}: la buena no avanza`);
    for (const [k, o] of r.options.entries()) {
      if (k === r.correct) continue;
      assert.equal(node.choices.find((c) => c.text === o.text).next, 'lose');
    }
    assert.ok(r.fudVoice && fs.existsSync(path.join(ROOT, r.fudVoice.file)));
  }
  // la buena de cada ronda (diseño, DESIGN_BIBLE §4.8)
  assert.equal(rounds[0].options[rounds[0].correct].text, 'And you sold the bottom so often, they gave you a loyalty card.');
});

test('el script admite más escenas (--scenes)', () => {
  const more = buildCatalog({ root: ROOT, scenes: ['outside', 'basement'] });
  assert.deepEqual(Object.keys(more.catalog.scenes), ['outside', 'basement']);
  assert.ok(more.catalog.targets.some((t) => t.scene === 'basement'));
});

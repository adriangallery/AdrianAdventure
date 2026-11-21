// F3.2a (plan FUNTICO_ADVENTURE): progreso de Campaign, guardado aparte por usuario, desbloqueos cosméticos, estado
// canónico de los capítulos y el gancho neutro de almacén de partidas.
// node --experimental-strip-types --test tests/funtico-campaign-progress.test.mjs (en `npm run test:funtico`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const P = await import('../src/funtico/campaign/progress.ts');
const SS = await import('../src/platform/SaveStorage.ts');
const { canonicalChapterState, statesFile } = await import('../src/funtico/campaign/canonical.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function memStore() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('claves por usuario con el prefijo de Campaign (nunca las del juego)', () => {
  assert.equal(P.campaignKey(42, 'progress'), 'adrian_adventure_funtico_campaign_42_progress');
  assert.equal(P.campaignKey('a b/c', 'x'), 'adrian_adventure_funtico_campaign_a_b_c_x');
  assert.equal(P.campaignKey(null, 'x'), 'adrian_adventure_funtico_campaign_anon_x');
});

test('guardar y leer el progreso; basura = vacío', () => {
  const s = memStore();
  assert.deepEqual(P.loadProgress(s, 7), P.emptyProgress());
  const p = P.recordResult(P.emptyProgress(), 1, 2, 512).progress;
  assert.ok(P.saveProgressTo(s, 7, p));
  assert.deepEqual(P.loadProgress(s, 7), p);
  assert.deepEqual(P.loadProgress(s, 8), P.emptyProgress(), 'otro usuario, otro progreso');
  s.setItem(P.campaignKey(9, 'progress'), '{no json');
  assert.deepEqual(P.loadProgress(s, 9), P.emptyProgress());
  s.setItem(P.campaignKey(9, 'progress'), JSON.stringify({ cases: { 1: { stars: 99, bestTimeS: -5 }, 77: { stars: 3 } }, active: { ape_costume: 'yes' } }));
  const q = P.loadProgress(s, 9);
  assert.equal(q.cases['1'].stars, 3);
  assert.equal(q.cases['1'].bestTimeS, 0);
  assert.equal(q.cases['77'], undefined);
  assert.deepEqual(q.active, {});
  const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.deepEqual(P.loadProgress(throwing, 1), P.emptyProgress());
  assert.equal(P.saveProgressTo(throwing, 1, p), false);
});

test('estados del mapa: 1 abierto, 2 tras ≥ 1 estrella en el 1, 3–5 COMING SOON', () => {
  let p = P.emptyProgress();
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => P.caseState(p, n)), ['open', 'locked', 'soon', 'soon', 'soon']);
  const r = P.recordResult(p, 1, 1, 900);
  assert.equal(r.unlockedCase, 2);
  p = r.progress;
  assert.equal(P.caseState(p, 2), 'open');
  assert.equal(P.recordResult(p, 1, 3, 100).unlockedCase, null, 'ya estaba abierto');
});

test('recordResult: mejores estrellas y mejor tiempo; sin terminar no cuenta; no muta', () => {
  const p0 = P.emptyProgress();
  const a = P.recordResult(p0, 1, 2, 500);
  assert.deepEqual(p0, P.emptyProgress());
  assert.deepEqual(a.progress.cases['1'], { stars: 2, bestTimeS: 500, completions: 1 });
  assert.ok(a.newBestStars && a.newBestTime);
  const b = P.recordResult(a.progress, 1, 1, 400);
  assert.deepEqual(b.progress.cases['1'], { stars: 2, bestTimeS: 400, completions: 2 });
  assert.ok(!b.newBestStars && b.newBestTime);
  const c = P.recordResult(b.progress, 1, 0, 10);
  assert.deepEqual(c.progress.cases['1'], b.progress.cases['1']);
});

test('desbloqueos: disfraz a 3 estrellas totales, tema del móvil a 5; activar solo si está desbloqueado', () => {
  let p = P.emptyProgress();
  assert.deepEqual(P.unlockedCosmetics(p), []);
  assert.equal(P.toggleCosmetic(p, 'ape_costume'), p, 'bloqueado: no cambia');
  let r = P.recordResult(p, 1, 2, 300);
  assert.deepEqual(r.newUnlocks, []);
  r = P.recordResult(r.progress, 2, 1, 900);
  assert.deepEqual(r.newUnlocks, ['ape_costume']);
  p = r.progress;
  assert.ok(P.isUnlocked(p, 'ape_costume') && !P.isActive(p, 'ape_costume'));
  p = P.toggleCosmetic(p, 'ape_costume');
  assert.ok(P.isActive(p, 'ape_costume'));
  assert.ok(!P.isUnlocked(p, 'phone_theme'));
  r = P.recordResult(p, 2, 3, 800);
  assert.equal(P.totalStars(r.progress), 5);
  assert.deepEqual(r.newUnlocks, ['phone_theme']);
  p = P.toggleCosmetic(P.toggleCosmetic(r.progress, 'phone_theme'), 'ape_costume');
  assert.ok(P.isActive(p, 'phone_theme') && !P.isActive(p, 'ape_costume'));
});

test('chapterSaveStore: adrian_adventure_save → …_<user>_ch<N>_save; el almacén real no ve la clave del juego', () => {
  const s = memStore();
  const ch = P.chapterSaveStore(s, 42, 2);
  ch.setItem('adrian_adventure_save', '{"0":1}');
  assert.equal(s.getItem('adrian_adventure_save'), null);
  assert.equal(s.getItem('adrian_adventure_funtico_campaign_42_ch2_save'), '{"0":1}');
  assert.equal(ch.getItem('adrian_adventure_save'), '{"0":1}');
  ch.removeItem('adrian_adventure_save');
  assert.equal(s.m.size, 0);
});

test('SaveStorage: por defecto localStorage; el gancho se cambia y vuelve; no nombra la plataforma', () => {
  const fake = memStore();
  globalThis.localStorage = fake;
  try {
    assert.equal(SS.saveStorage(), fake);
    const other = memStore();
    SS.setSaveStorage(other);
    assert.equal(SS.saveStorage(), other);
    SS.setSaveStorage(null);
    assert.equal(SS.saveStorage(), fake);
  } finally {
    delete globalThis.localStorage;
  }
  const src = fs.readFileSync(path.join(ROOT, 'src/platform/SaveStorage.ts'), 'utf-8');
  assert.doesNotMatch(src, /funtico/i);
  const sls = fs.readFileSync(path.join(ROOT, 'src/systems/SaveLoadSystem.ts'), 'utf-8');
  assert.doesNotMatch(sls, /funtico/i);
  assert.doesNotMatch(sls.replace(/^\s*(\/\/|\*).*$/gm, ''), /\blocalStorage\b/, 'SaveLoadSystem solo usa saveStorage()');
});

test('estado canónico: quita lo de la partida (reloj, runId) y ordena; el versionado tiene la forma esperada', () => {
  const st = {
    currentScene: 'lobby', flags: { b: true, a: true, off: false }, inventory: [{ id: 'x', name: 'X', icon: null, fromNFT: false }],
    visited: ['lobby', 'outside', 'lobby'], firedTriggers: [], dialogueProgress: {}, achievements: ['z', 'a'],
    runId: 'r1', savedAt: 5, saveVersion: 3, playTimeMs: 123456, chapterTimes: { marks: { 1: 1 } }, playerPosition: { pctX: 40.26, pctY: 80.4 },
  };
  const c = canonicalChapterState(st);
  assert.deepEqual(Object.keys(c.flags), ['a', 'b']);
  assert.deepEqual(c.visited, ['lobby', 'outside']);
  assert.deepEqual(c.achievements, ['a', 'z']);
  for (const k of ['runId', 'savedAt', 'saveVersion', 'playTimeMs', 'chapterTimes', 'playerPosition']) assert.equal(c[k], undefined, k);
  assert.deepEqual(c.spawn, { x: 40, y: 80 });
  assert.deepEqual(canonicalChapterState(st, { x: 10.4, y: 90.6 }).spawn, { x: 10, y: 91 });
  assert.equal(statesFile(c).chapters[1].fresh, true);
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/funtico/campaign/states.json'), 'utf-8'));
  assert.equal(file.chapters['1'].fresh, true);
  if (file.chapters['2']) {
    assert.equal(file.chapters['2'].flags.chapter_1_complete, true);
    assert.equal(file.chapters['2'].playTimeMs, undefined);
  }
});

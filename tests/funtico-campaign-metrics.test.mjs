// F3.1 (plan FUNTICO_ADVENTURE): ganchos de plataforma (src/platform/PlatformHooks.ts) y recolector de métricas de
// Campaign (src/funtico/CampaignMetrics.ts). Lógica pura, sin Phaser.
// CI (Node 22): node --experimental-strip-types --test tests/funtico-campaign-metrics.test.mjs (en `npm run test:funtico`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const H = await import('../src/platform/PlatformHooks.ts');
const { CampaignMetrics, MAX_TICK_MS } = await import('../src/funtico/CampaignMetrics.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ZERO = { completed: 0, time_s: 0, hints: 0, hint_max_level: 0, fails: 0, duel_losses: 0, optional: 0, actions: 0 };

test('ganchos: por defecto no-op, y emitPlatform no lanza aunque el gancho falle', () => {
  H.setPlatformHooks(null);
  assert.equal(H.getPlatformHooks(), H.NOOP_PLATFORM_HOOKS);
  for (const name of ['onAction', 'onHint', 'onFail', 'onChapterComplete', 'onOptional', 'onPlayTime']) {
    assert.equal(typeof H.NOOP_PLATFORM_HOOKS[name], 'function', name);
  }
  H.emitPlatform('onAction', { verb: 'USE', target: 'x' });
  const seen = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    H.setPlatformHooks({ onAction: () => { throw new Error('roto'); }, onHint: (l) => seen.push(l) });
    assert.doesNotThrow(() => H.emitPlatform('onAction', { verb: 'USE', target: 'x' }));
    H.emitPlatform('onHint', 2, { level: 2, puzzle: 'p', chapter: 1 });
    H.emitPlatform('onFail', { kind: 'verb' }); // no definido → no-op
    assert.deepEqual(seen, [2]);
  } finally {
    console.warn = warn;
    H.setPlatformHooks(null);
  }
});

test('ganchos: una instancia de clase sirve (métodos del prototipo, atados)', () => {
  const m = new CampaignMetrics();
  H.setPlatformHooks(m);
  try {
    H.emitPlatform('onAction', { verb: 'LOOK', target: 'hs' });
    H.emitPlatform('onPlayTime', 100);
    assert.equal(m.metrics().actions, 1);
    assert.equal(m.toJSON().chapters[1].timeMs, 100);
  } finally {
    H.setPlatformHooks(null);
  }
});

test('recolector: vacío = todo a 0', () => {
  assert.deepEqual(new CampaignMetrics().metrics(), ZERO);
  assert.deepEqual(new CampaignMetrics({ chapter: 3 }).metrics(2), ZERO);
});

test('recolector: un capítulo completo con todas las métricas', () => {
  const m = new CampaignMetrics({ chapter: 1 });
  for (let i = 0; i < 600; i++) m.onPlayTime(100); // 60 s
  m.onAction({ verb: 'LOOK', target: 'a' });
  m.onAction({ verb: 'USE', target: 'b' });
  m.onHint(0, { level: 0, puzzle: null, chapter: 1 }); // relleno: no es pista
  m.onHint(1, { level: 1, puzzle: 'p', chapter: 1 });
  m.onHint(2, { level: 2, puzzle: 'p', chapter: 1 });
  m.onFail({ kind: 'verb', verb: 'PUSH', target: 'x' });
  m.onFail({ kind: 'item-verb', verb: 'LOOK', target: null }); // mirar no es fallar
  m.onFail({ kind: 'item-hotspot', verb: 'USE', target: 'y' });
  m.onFail({ kind: 'duel', target: 'chad_fud' });
  m.onOptional('signal_boost');
  m.onOptional('signal_boost'); // repetido: una vez
  m.onOptional('diamond_hands');
  m.onChapterComplete(1);
  assert.deepEqual(m.metrics(1), {
    completed: 1, time_s: 60, hints: 2, hint_max_level: 2, fails: 2, duel_losses: 1, optional: 2, actions: 2,
  });
  // pasa al siguiente: lo que llega después no ensucia el 1 y su reloj se para
  assert.equal(m.chapter, 2);
  m.onPlayTime(200);
  m.onAction({ verb: 'TALK', target: 'npc' });
  assert.equal(m.metrics(1).time_s, 60);
  assert.equal(m.metrics(1).actions, 2);
  assert.deepEqual(m.metrics(2), { ...ZERO, actions: 1 });
  assert.equal(m.toJSON().chapters[2].timeMs, 200);
});

test('recolector: tiempo = solo tiempo de juego (tope por tic, pausa, valores raros)', () => {
  const m = new CampaignMetrics();
  m.onPlayTime(60_000); // un tic enorme (pestaña oculta) cuenta como el tope
  assert.equal(m.toJSON().chapters[1].timeMs, MAX_TICK_MS);
  m.pause();
  m.onPlayTime(100);
  assert.equal(m.toJSON().chapters[1].timeMs, MAX_TICK_MS);
  m.onAction({ verb: 'USE', target: 'x' }); // en pausa los eventos siguen contando
  m.resume();
  m.onPlayTime(-5); m.onPlayTime(NaN); m.onPlayTime(Infinity); m.onPlayTime(0);
  m.onPlayTime(50);
  assert.equal(m.toJSON().chapters[1].timeMs, MAX_TICK_MS + 50);
  assert.equal(m.metrics().actions, 1);
  // segundos enteros, hacia abajo
  const n = new CampaignMetrics();
  for (let i = 0; i < 9; i++) n.onPlayTime(110); // 990 ms
  assert.equal(n.metrics().time_s, 0);
  n.onPlayTime(10);
  assert.equal(n.metrics().time_s, 1);
});

test('recolector: hint_max_level con tope 3 y fin de capítulo fuera de orden', () => {
  const m = new CampaignMetrics({ chapter: 2 });
  m.onHint(3); m.onHint(7); m.onHint(1);
  assert.equal(m.metrics().hint_max_level, 3);
  assert.equal(m.metrics().hints, 3);
  m.onChapterComplete(1); // capítulo anterior (ya cerrado en el estado canónico): no mueve el en curso
  assert.equal(m.chapter, 2);
  m.onChapterComplete(9); // inválido
  assert.equal(m.chapter, 2);
  m.onChapterComplete(5);
  assert.equal(m.chapter, 5);
  assert.equal(m.metrics(5).completed, 1);
});

test('recolector: toJSON/restore ida y vuelta, y restore tolerante', () => {
  const m = new CampaignMetrics({ chapter: 1 });
  m.onPlayTime(200); m.onAction({ verb: 'USE', target: 'a' }); m.onHint(2); m.onFail({ kind: 'verb', verb: 'PULL' });
  m.onOptional('x'); m.onChapterComplete(1); m.onPlayTime(120); m.pause();
  const json = JSON.parse(JSON.stringify(m));
  const r = CampaignMetrics.restore(json);
  assert.deepEqual(r.toJSON(), m.toJSON());
  assert.deepEqual(r.metrics(1), m.metrics(1));
  assert.equal(r.chapter, 2);
  assert.equal(r.isPaused, true);
  // basura → recolector vacío, sin lanzar
  for (const bad of [null, undefined, 3, 'x', [], { v: 99, chapter: 2 }, { v: 1, chapter: 'a', chapters: { 0: {}, 7: {}, a: {} } }]) {
    assert.doesNotThrow(() => CampaignMetrics.restore(bad));
  }
  assert.equal(CampaignMetrics.restore({ v: 99, chapter: 2 }).chapter, 2);
  const dirty = CampaignMetrics.restore({ v: 1, chapter: 1, chapters: { 1: { timeMs: -4, hints: 'x', hintMax: 9, optional: ['a', 'a', 3, ''], actions: 2.7 } } });
  assert.deepEqual(dirty.metrics(1), { ...ZERO, hint_max_level: 3, optional: 1, actions: 2 });
});

test('resetChapter y startChapter', () => {
  const m = new CampaignMetrics();
  m.onAction({ verb: 'USE', target: 'a' });
  m.resetChapter(1);
  assert.deepEqual(m.metrics(1), ZERO);
  m.startChapter(4);
  m.onAction({ verb: 'USE', target: 'a' });
  assert.equal(m.metrics(4).actions, 1);
  m.startChapter(0); // inválido: no cambia
  assert.equal(m.chapter, 4);
});

// Criterio de duel_losses: GameScene.runDialogueScripts avisa de un duelo perdido al entrar en el nodo `lose` de un
// árbol, y solo pasa por ahí si el nodo tiene onEnter. Si alguien quita el onEnter, el duelo dejaría de contar.
test('escenas: todo nodo `lose` de un árbol de diálogo tiene onEnter (para que cuente como duelo perdido)', () => {
  const dir = path.join(ROOT, 'assets/scenes');
  let found = 0;
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(dir, id, 'scene.json');
    if (!fs.existsSync(f)) continue;
    const scene = JSON.parse(fs.readFileSync(f, 'utf-8'));
    for (const [tree, t] of Object.entries(scene.dialogues ?? {})) {
      const nodes = t?.nodes ?? t;
      const lose = nodes && typeof nodes === 'object' ? nodes.lose : undefined;
      if (!lose) continue;
      found++;
      assert.ok(Array.isArray(lose.onEnter) && lose.onEnter.length > 0, `${id}/${tree}.lose sin onEnter`);
    }
  }
  assert.ok(found >= 2, `se esperaban al menos los duelos de Chad y PZ-BOT (hay ${found})`);
});

// La condición dura: los ganchos viven fuera de src/funtico y sin la palabra (el bundle normal los lleva)
test('el módulo de ganchos no nombra la plataforma', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/platform/PlatformHooks.ts'), 'utf-8');
  assert.doesNotMatch(src, /funtico/i);
});

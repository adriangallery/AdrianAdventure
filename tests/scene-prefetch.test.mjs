// A2.7 (plan SCUMM): grafo de escenas vecinas, ficheros de cada escena y planificador de la precarga
// (src/systems/ScenePrefetch.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/scene-prefetch.test.mjs (va en `npm run test:engine`)
// SCENE_PREFETCH_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const P = await import(process.env.SCENE_PREFETCH_PATH ?? '../src/systems/ScenePrefetch.ts');
const { sceneExits, sceneImageAssets, planPrefetch, prefetchBudget, MAX_PREFETCH_SCENES, transitionMode, sceneJsonUrl, shortUrl, FADE_SHORT_MS } = P;

const root = new URL('../assets/scenes/', import.meta.url);
const ids = readdirSync(root).filter((id) => existsSync(new URL(`${id}/scene.json`, root))).sort();
const scene = (id) => JSON.parse(readFileSync(new URL(`${id}/scene.json`, root), 'utf8'));
const V = '?v=test';

test('sceneExits recorre hotspots, triggers, onEnter, objetos, combos, diálogos y ramas anidadas', () => {
  const s = {
    onEnter: [{ op: 'ifFlag', flag: 'x', then: [{ op: 'gotoScene', sceneId: 'a' }] }],
    regions: {
      hotspots: [{ scripts: { USE: [{ op: 'fadeToScene', sceneId: 'b' }], LOOK: [{ op: 'say', text: 'hi' }] }, gateFallback: [{ op: 'gotoScene', sceneId: 'c' }] }],
      triggers: [{ onEnter: [{ op: 'web3Require', onSuccess: [{ op: 'fadeToScene', sceneId: 'd' }], onFail: [{ op: 'fadeToScene', sceneId: 'b' }] }] }],
    },
    items: { sceneItems: [{ pickupScript: [{ op: 'gotoScene', sceneId: 'e' }] }] },
    combos: [{ script: [{ op: 'ifHasItem', id: 'k', else: [{ op: 'gotoScene', sceneId: 'f' }] }] }],
    dialogues: { t: { nodes: { n: { onEnter: [{ op: 'fadeToScene', sceneId: 'g' }] } } } },
    transitions: { goto: [{ targetScene: 'h' }, { targetScene: 'self' }] },
  };
  assert.deepEqual(sceneExits(s, 'self'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(sceneExits(null), []);
  assert.deepEqual(sceneExits({ regions: { hotspots: [{ scripts: { USE: [{ op: 'gotoScene' }] } }] } }), [], 'sin sceneId no cuenta');
});

test('grafo real: outside y lobby se conectan en los dos sentidos y todas las salidas existen', () => {
  const exits = Object.fromEntries(ids.map((id) => [id, sceneExits(scene(id), id)]));
  assert.ok(exits.outside.includes('lobby'), `outside → ${exits.outside}`);
  assert.ok(exits.lobby.includes('outside'), `lobby → ${exits.lobby}`);
  for (const [id, list] of Object.entries(exits)) {
    for (const to of list) assert.ok(ids.includes(to), `${id} sale a «${to}», que no es una escena`);
    assert.ok(!list.includes(id), `${id} no es vecina de sí misma`);
  }
});

test('sceneImageAssets da las claves de textura de PreloadScene/GameScene', () => {
  const s = {
    assets: { foreground: 'foreground.png' },
    conditionalOverlays: [{ id: 'm', sprite: 'overlay_m', format: 'webp' }, { id: 'n', sprite: 'overlay_n' }],
    web3Visuals: [{ defaultSprite: 'poster', variants: [{ sprite: 'poster_vip' }, { sprite: 'poster' }] }],
  };
  assert.deepEqual(sceneImageAssets('lobby', s, V), [
    { key: 'bg_lobby', url: 'assets/scenes/lobby/background.webp?v=test' },
    { key: 'fg_lobby', url: 'assets/scenes/lobby/foreground.webp?v=test' },
    { key: 'overlay_lobby_m', url: 'assets/scenes/lobby/overlay_m.webp?v=test' },
    { key: 'overlay_lobby_n', url: 'assets/scenes/lobby/overlay_n.png?v=test' },
    { key: 'poster', url: 'assets/scenes/lobby/poster.png?v=test' },
    { key: 'poster_vip', url: 'assets/scenes/lobby/poster_vip.png?v=test' },
  ]);
  assert.deepEqual(sceneImageAssets('x', undefined, ''), [{ key: 'bg_x', url: 'assets/scenes/x/background.webp' }], 'sin JSON, solo el fondo');
});

test('cada imagen de cada escena real existe en disco', () => {
  for (const id of ids) {
    for (const a of sceneImageAssets(id, scene(id), '')) {
      assert.ok(existsSync(new URL(`../${a.url}`, import.meta.url)), `${id}: falta ${a.url}`);
    }
  }
});

test('planPrefetch: primero los JSON que faltan, luego imágenes por vecina, música solo con sonido', () => {
  const lobby = { conditionalOverlays: [{ id: 'p', sprite: 'overlay_p', format: 'webp' }], audio: { music: 'retro' } };
  const base = { current: 'outside', neighbors: ['lobby', 'mountain'], scenes: { lobby }, v: V, done: new Set(), isLoaded: () => false, muted: true };
  const t1 = planPrefetch(base);
  assert.deepEqual(t1.map((t) => `${t.kind}:${shortUrl(t.url)}`), [
    'json:assets/scenes/mountain/scene.json',
    'image:assets/scenes/lobby/background.webp',
    'image:assets/scenes/lobby/overlay_p.webp',
  ]);
  const t2 = planPrefetch({ ...base, muted: false, scenes: { lobby, mountain: { audio: { music: 'vista' } } } });
  assert.deepEqual(t2.map((t) => `${t.kind}:${shortUrl(t.url)}`), [
    'image:assets/scenes/lobby/background.webp',
    'image:assets/scenes/lobby/overlay_p.webp',
    'image:assets/scenes/mountain/background.webp',
    'music:assets/audio/music/retro.mp3',
    'music:assets/audio/music/vista.mp3',
  ]);
  // Lo ya descargado o ya en Phaser no se pide
  const t3 = planPrefetch({ ...base, scenes: { lobby, mountain: {} }, done: new Set([sceneJsonUrl('mountain', V), 'assets/scenes/lobby/background.webp?v=test']), isLoaded: (k) => k === 'overlay_lobby_p' });
  assert.deepEqual(t3.map((t) => shortUrl(t.url)), ['assets/scenes/mountain/background.webp']);
  // La escena actual nunca, y como mucho maxScenes vecinas
  assert.deepEqual(planPrefetch({ ...base, neighbors: ['outside', 'a', 'b', 'c'], scenes: {}, maxScenes: 2 }).map((t) => t.scene), ['a', 'b']);
  // Nada que hacer
  assert.deepEqual(planPrefetch({ ...base, neighbors: [] }), []);
});

test('prefetchBudget: nada con saveData o 2G, una vecina en 3G, todas si no', () => {
  assert.deepEqual(prefetchBudget(undefined), { maxScenes: MAX_PREFETCH_SCENES, reason: null });
  assert.deepEqual(prefetchBudget({ effectiveType: '4g' }), { maxScenes: MAX_PREFETCH_SCENES, reason: null });
  assert.deepEqual(prefetchBudget({ saveData: true, effectiveType: '4g' }), { maxScenes: 0, reason: 'saveData' });
  assert.deepEqual(prefetchBudget({ effectiveType: '2g' }), { maxScenes: 0, reason: '2g' });
  assert.deepEqual(prefetchBudget({ effectiveType: 'slow-2g' }), { maxScenes: 0, reason: 'slow-2g' });
  assert.deepEqual(prefetchBudget({ effectiveType: '3g' }), { maxScenes: 1, reason: '3g' });
});

test('transitionMode: pantalla completa solo al arrancar', () => {
  assert.equal(transitionMode({ firstLoad: true, missing: 0 }), 'full');
  assert.equal(transitionMode({ firstLoad: false, missing: 0 }), 'instant');
  assert.equal(transitionMode({ firstLoad: false, missing: 2 }), 'indicator');
  assert.ok(FADE_SHORT_MS <= 300);
});

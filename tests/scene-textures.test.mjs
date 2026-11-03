// A5.1 (plan SCUMM): memoria de texturas (src/systems/SceneTextures.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/scene-textures.test.mjs (va en `npm run test:engine`)
// SCENE_TEXTURES_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import(process.env.SCENE_TEXTURES_PATH ?? '../src/systems/SceneTextures.ts');
const { textureBytes, textureReport, toMb, BIG_TEXTURE_BYTES } = T;

test('textureBytes: RGBA de 8 bits sin mipmaps (un fondo de 3712×1152 son 16,3 MiB)', () => {
  assert.equal(textureBytes(3712, 1152), 3712 * 1152 * 4);
  assert.equal(toMb(textureBytes(3712, 1152)), 16.3);
  assert.equal(textureBytes(0, 10), 0);
  assert.equal(textureBytes(-1, 10), 0);
  assert.equal(BIG_TEXTURE_BYTES, 1048576);
});

test('textureReport: clasifica por escena actual, otras escenas, personajes, iconos, insignias y lienzos; ignora las internas', () => {
  const entries = [
    { key: '__DEFAULT', width: 32, height: 32 },
    { key: '__MISSING', width: 32, height: 32 },
    { key: 'bg_lobby', width: 2048, height: 636 },
    { key: 'fg_lobby', width: 2048, height: 636 },
    { key: 'poster_generic', width: 30, height: 45 },
    { key: 'bg_outside', width: 2048, height: 636 },
    { key: 'overlay_outside_lamp_empty', width: 698, height: 386 },
    { key: 'bg_rooftop', width: 2048, height: 636 }, // escena que nadie recuerda: arte de otra escena por el prefijo
    { key: 'player_idle1', width: 25, height: 103 },
    { key: 'ape_idle1', width: 40, height: 103 },
    { key: 'npc_receptionist', width: 37, height: 37 },
    { key: 'item_ledger', width: 128, height: 128 },
    { key: 'badge_ch1_complete', width: 64, height: 64 },
    { key: 'a1b2-uuid', width: 400, height: 50, canvas: true },
    { key: 'retro_logo', width: 200, height: 100 },
  ];
  const sceneArt = {
    lobby: ['bg_lobby', 'fg_lobby', 'overlay_lobby_plant_revived', 'poster_generic'],
    outside: ['bg_outside', 'fg_outside', 'overlay_outside_lamp_empty'],
  };
  const r = textureReport(entries, { currentScene: 'lobby', sceneArt });
  assert.equal(r.count, 13);
  assert.equal(r.bytes, entries.filter((e) => !e.key.startsWith('__')).reduce((a, e) => a + e.width * e.height * 4, 0));
  assert.deepEqual(r.byKind.scene, { count: 3, bytes: (2048 * 636 * 2 + 30 * 45) * 4 });
  assert.deepEqual(r.byKind.otherScenes, { count: 3, bytes: (2048 * 636 * 2 + 698 * 386) * 4 });
  assert.equal(r.byKind.characters.count, 3);
  assert.equal(r.byKind.items.count, 1);
  assert.equal(r.byKind.badges.count, 1);
  assert.equal(r.byKind.canvas.count, 1);
  assert.equal(r.byKind.other.count, 1);
  assert.deepEqual(r.scenesLoaded, ['lobby', 'outside'], 'rooftop no está en el mapa: no se sabe de qué escena es');
  assert.deepEqual(r.big.map((b) => b.key), ['bg_lobby', 'bg_outside', 'bg_rooftop', 'fg_lobby', 'overlay_outside_lamp_empty']);
  assert.equal(r.big[0].bytes, 2048 * 636 * 4);
});

test('textureReport: sin escena actual todo el arte es de otras escenas; sin texturas, todo a cero', () => {
  const r = textureReport([{ key: 'bg_x', width: 10, height: 10 }], { currentScene: null, sceneArt: { x: ['bg_x'] } });
  assert.equal(r.byKind.scene.count, 0);
  assert.equal(r.byKind.otherScenes.count, 1);
  assert.deepEqual(r.scenesLoaded, ['x']);
  const empty = textureReport([], { currentScene: 'x', sceneArt: {} });
  assert.equal(empty.count, 0);
  assert.equal(empty.bytes, 0);
  assert.deepEqual(empty.big, []);
  assert.deepEqual(empty.scenesLoaded, []);
});

// A2.8 (plan SCUMM): densidad de píxel unificada (src/systems/PixelScale.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/pixel-scale.test.mjs (va en `npm run test:engine`)
// PIXEL_SCALE_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const P = await import(process.env.PIXEL_SCALE_PATH ?? '../src/systems/PixelScale.ts');
const {
  DEFAULT_PIXEL_SCALE, SNAP_TOLERANCE, resolvePixelScale, depthFactor, depthScaleDefects, snapScreenScale, spriteScale,
  artHeightPct, isIntegerScale, worldToArt, isValidPixelScale, isValidArtScale,
} = P;

const scenesDir = new URL('../assets/scenes/', import.meta.url);
const scene = (id) => JSON.parse(readFileSync(new URL(`${id}/scene.json`, scenesDir), 'utf8'));
const SCENES = readdirSync(scenesDir).filter((d) => !d.startsWith('.'));
const GLOBAL = JSON.parse(readFileSync(new URL('../assets/config/global.json', import.meta.url), 'utf8'));
/** Escala del fondo (pantalla / fondo) de un viewport con el panel SCUMM de GameScene.computePanelHeight */
const coordScale = (w, h, imgW = 3712, imgH = 1152) => {
  const mobile = h > w || Math.min(w, h) < 600;
  const panel = Math.max(mobile && w > h ? 100 : 140, Math.floor(h * (mobile ? (w > h ? 0.22 : 0.15) : 0.25)));
  const vh = h - panel;
  const pano = imgW / imgH > (w / vh) * 1.2;
  return h > w || pano ? vh / imgH : Math.min(w / imgW, vh / imgH);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('resolvePixelScale: escena, playerScale antiguo, global y por defecto', () => {
  assert.equal(resolvePixelScale({ pixelScale: 4 }, { pixelScale: 6 }), 4);
  assert.equal(resolvePixelScale({ player: { playerScale: 3.95 } }, { pixelScale: 6 }), 3.95);
  assert.equal(resolvePixelScale({}, { pixelScale: 6 }), 6);
  assert.equal(resolvePixelScale({}, { playerScale: 5 }), 5);
  assert.equal(resolvePixelScale(null, null), DEFAULT_PIXEL_SCALE);
  // Fuera de rango no vale: se pasa al siguiente
  assert.equal(resolvePixelScale({ pixelScale: 0.2 }, { pixelScale: 99 }), DEFAULT_PIXEL_SCALE);
  assert.equal(GLOBAL.pixelScale, DEFAULT_PIXEL_SCALE, 'global.json lleva la misma unidad por defecto');
});

test('snapScreenScale: entero si no cambia más de un 20 %; si no, exacta', () => {
  assert.deepEqual(snapScreenScale(2.58), { value: 3, snapped: true });
  assert.deepEqual(snapScreenScale(2.34), { value: 2, snapped: true });
  assert.deepEqual(snapScreenScale(2.5), { value: 3, snapped: true }, 'en el límite (20 %) redondea');
  assert.deepEqual(snapScreenScale(3.87), { value: 4, snapped: true });
  assert.deepEqual(snapScreenScale(1.1), { value: 1, snapped: true });
  assert.deepEqual(snapScreenScale(1.7), { value: 2, snapped: true });
  // 1,38 (móvil apaisado): 1 sería un 28 % menos y 2 un 45 % más
  assert.deepEqual(snapScreenScale(1.38), { value: 1.38, snapped: false });
  // Por debajo de 1 no hay entero
  assert.deepEqual(snapScreenScale(0.7), { value: 0.7, snapped: false });
  assert.equal(snapScreenScale(0).snapped, false);
  assert.equal(snapScreenScale(NaN).snapped, false);
  // Desde 2 siempre redondea
  for (let f = 2; f < 12; f += 0.01) assert.ok(snapScreenScale(f).snapped, `f = ${f}`);
  assert.equal(SNAP_TOLERANCE, 0.2);
});

test('depthFactor: lineal entre yTop y yBottom y fijo fuera; inválido = 1', () => {
  const d = { yTop: 80, yBottom: 90, scaleTop: 0.5, scaleBottom: 1 };
  assert.equal(depthFactor(d, 70), 0.5);
  assert.equal(depthFactor(d, 80), 0.5);
  assert.equal(depthFactor(d, 85), 0.75);
  assert.equal(depthFactor(d, 90), 1);
  assert.equal(depthFactor(d, 99), 1);
  assert.equal(depthFactor(null, 50), 1);
  assert.equal(depthFactor({ yTop: 90, yBottom: 80, scaleTop: 0.5, scaleBottom: 1 }, 85), 1);
  // Monótona: al acercarse (y mayor) nunca encoge
  let prev = 0;
  for (let y = 60; y <= 100; y += 0.5) { const f = depthFactor(d, y); assert.ok(f >= prev); prev = f; }
});

test('depthScaleDefects: forma y rangos', () => {
  assert.deepEqual(depthScaleDefects({ yTop: 80, yBottom: 90, scaleTop: 0.5, scaleBottom: 1 }), []);
  assert.equal(depthScaleDefects(null).length, 1);
  assert.match(depthScaleDefects({ yTop: 80, yBottom: 90, scaleTop: 'x', scaleBottom: 1 })[0], /scaleTop/);
  assert.match(depthScaleDefects({ yTop: 90, yBottom: 80, scaleTop: 0.5, scaleBottom: 1 })[0], /menor/);
  assert.match(depthScaleDefects({ yTop: 80, yBottom: 90, scaleTop: 0.1, scaleBottom: 1 })[0], /fuera de 0.2-2/);
  assert.match(depthScaleDefects({ yTop: -5, yBottom: 90, scaleTop: 0.5, scaleBottom: 1 })[0], /0-100/);
  assert.ok(isValidPixelScale(5.5) && !isValidPixelScale(0.5) && !isValidPixelScale(13));
  assert.ok(isValidArtScale(1) && !isValidArtScale(0.1) && !isValidArtScale(5));
});

test('spriteScale: base redondeada × profundidad; entera donde el factor es 1 y sin saltos al andar', () => {
  const s = coordScale(1280, 720);
  const flat = spriteScale({ pixelScale: 5.5, coordScale: s });
  assert.deepEqual(flat, { scale: 3, base: 3, snapped: true, depth: 1 });
  assert.ok(isIntegerScale(flat.scale));
  const d = { yTop: 82.5, yBottom: 91, scaleTop: 0.45, scaleBottom: 1 };
  assert.equal(spriteScale({ pixelScale: 5.5, coordScale: s, depth: d, yPct: 97.9 }).scale, 3);
  assert.ok(near(spriteScale({ pixelScale: 5.5, coordScale: s, depth: d, yPct: 82.5 }).scale, 1.35));
  // Continua: entre dos y muy cercanas la escala cambia poco
  let prev = null;
  for (let y = 80; y <= 100; y += 0.1) {
    const v = spriteScale({ pixelScale: 5.5, coordScale: s, depth: d, yPct: y }).scale;
    if (prev !== null) assert.ok(Math.abs(v - prev) < 0.03, `salto en y = ${y}`);
    prev = v;
  }
  // artScale: hoja a doble densidad → la mitad... y uno inválido cuenta como 1
  assert.equal(spriteScale({ pixelScale: 5.5, artScale: 0.5, coordScale: coordScale(1920, 1080) }).scale, 2);
  assert.equal(spriteScale({ pixelScale: 5.5, artScale: 99, coordScale: s }).scale, 3);
});

test('mismos viewports, mismas escalas: las escenas con la unidad por defecto miden lo mismo', () => {
  for (const [w, h] of [[1280, 720], [1920, 1080], [1440, 900], [390, 844], [844, 390]]) {
    const heights = new Set();
    for (const id of SCENES) {
      const sc = scene(id);
      // Fondos de 3712×1152 (todos menos epilogue_outside, que lleva su pixelScale; render.world no es fiable)
      if (sc.pixelScale !== undefined) continue;
      const r = spriteScale({ pixelScale: resolvePixelScale(sc, GLOBAL), coordScale: coordScale(w, h) });
      heights.add(Math.round(r.scale * 103 * 1000));
    }
    assert.equal(heights.size, 1, `${w}x${h}: un solo alto para todas las escenas por defecto`);
  }
  // Escritorio: siempre entera
  for (const [w, h] of [[1280, 720], [1920, 1080], [1440, 900], [1366, 768]]) {
    assert.ok(spriteScale({ pixelScale: DEFAULT_PIXEL_SCALE, coordScale: coordScale(w, h) }).snapped, `${w}x${h}`);
  }
});

test('artHeightPct: alto del mundo en % del fondo (lo que usa Facing)', () => {
  assert.ok(near(artHeightPct(103, 5.5, 1152), 49.175347222, 1e-6));
  assert.ok(near(artHeightPct(103, 5.5, 1152, 0.5), 24.587673611, 1e-6));
  assert.equal(artHeightPct(103, 5.5, 0), 0);
});

test('isIntegerScale', () => {
  assert.ok(isIntegerScale(3) && isIntegerScale(1) && isIntegerScale(2.0000000001));
  assert.ok(!isIntegerScale(2.5) && !isIntegerScale(0.7) && !isIntegerScale(0) && !isIntegerScale(NaN));
});

test('worldToArt: inversa de la escala para el hit-test (pies abajo en el centro)', () => {
  const foot = { x: 500, y: 400 };
  // Recepcionista 37×37 a escala 3: de x 444,5 a 555,5 y de y 289 a 400 (+10 px de arte por debajo)
  assert.deepEqual(worldToArt({ x: 500, y: 400 }, foot, 3, 37, 37), { x: 18.5, y: 37, inside: false });
  assert.equal(worldToArt({ x: 500, y: 399 }, foot, 3, 37, 37).inside, true);
  assert.equal(worldToArt({ x: 500, y: 420 }, foot, 3, 37, 37, 10).inside, true);
  assert.equal(worldToArt({ x: 500, y: 431 }, foot, 3, 37, 37, 10).inside, false);
  assert.equal(worldToArt({ x: 444, y: 350 }, foot, 3, 37, 37).inside, false);
  assert.equal(worldToArt({ x: 445, y: 350 }, foot, 3, 37, 37).inside, true);
  // Ida y vuelta con cualquier escala (también la fraccionaria de la profundidad)
  for (const scale of [1, 1.38, 2, 3, 0.7]) {
    const p = worldToArt({ x: foot.x + (10 - 18.5) * scale, y: foot.y + (5 - 37) * scale }, foot, scale, 37, 37);
    assert.ok(near(p.x, 10, 1e-9) && near(p.y, 5, 1e-9) && p.inside);
  }
});

test('escenas: sin playerScale ni scale de NPC a mano; pixelScale/depthScale/artScale en rango', () => {
  for (const id of SCENES) {
    const sc = scene(id);
    assert.equal(sc.player?.playerScale, undefined, `${id}: playerScale antiguo`);
    if (sc.pixelScale !== undefined) assert.ok(isValidPixelScale(sc.pixelScale), `${id}: pixelScale`);
    if (sc.depthScale !== undefined) assert.deepEqual(depthScaleDefects(sc.depthScale), [], `${id}: depthScale`);
    for (const n of sc.npcs ?? []) {
      assert.equal(n.scale, undefined, `${id}/${n.id}: scale a mano`);
      if (n.artScale !== undefined) assert.ok(isValidArtScale(n.artScale), `${id}/${n.id}: artScale`);
    }
  }
  // Los spawn de las escenas con profundidad están en la franja del factor 1 (alto de referencia)
  // (A2.13: outside es de escala fija, sin depthScale)
  assert.equal(scene('outside').depthScale, undefined, 'outside: escala fija (A2.13)');
  for (const id of ['mountain', 'clinic_exterior']) {
    const sc = scene(id);
    assert.ok(sc.depthScale, `${id} lleva depthScale`);
    assert.equal(depthFactor(sc.depthScale, sc.player.spawn.y), 1, `${id}: spawn sin profundidad`);
  }
});

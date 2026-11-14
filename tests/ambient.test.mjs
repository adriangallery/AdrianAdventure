// A4.3 (plan SCUMM): animación ambiental (src/systems/Ambient.ts). Lógica pura, sin navegador.
// CI (Node 22): node --experimental-strip-types --test tests/ambient.test.mjs (va en `npm run test:engine`)
// AMBIENT_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const A = await import(process.env.AMBIENT_PATH ?? '../src/systems/Ambient.ts');
const {
  AMBIENT_KINDS, AMBIENT_MAX_COUNT, AMBIENT_MAX_PER_SCENE, DEFAULT_DEPTH, KIND_DEFAULTS, parseAmbient, parseColor, parseConditions, conditionsHold,
  createAmbientSim, ambientSeed, frameCount, frameSignature, AmbientElementState, GLOW_RECT_SPREAD, softRectAlpha,
} = A;

const G = { w: 3712, h: 1152 };
const FRAME = 16;
const area = { x: 10, y: 10, w: 40, h: 30 };
/** Un elemento válido de cada tipo */
const SAMPLE = {
  moths: { id: 'm', kind: 'moths', at: { x: 50, y: 50 }, radius: 3, count: 4 },
  dust: { id: 'd', kind: 'dust', area, count: 12, burst: 5 },
  leds: { id: 'l', kind: 'leds', area, cols: 3, rows: 2 },
  fog: { id: 'f', kind: 'fog', area, count: 3 },
  clouds: { id: 'c', kind: 'clouds', area, count: 2, parallax: 0.5 },
  flicker: { id: 'fl', kind: 'flicker', area },
  glow: { id: 'g', kind: 'glow', area },
  scan: { id: 's', kind: 'scan', area },
  rise: { id: 'r', kind: 'rise', area, count: 6, burst: 4 },
  drip: { id: 'dr', kind: 'drip', at: { x: 50, y: 10 }, floorY: 80, period: 1000 },
  birds: { id: 'b', kind: 'birds', area, count: 3 },
  sway: { id: 'sw', kind: 'sway', amplitude: 4, period: 2000 },
};
const spec = (raw) => {
  const { specs, problems } = parseAmbient([raw], 'x');
  assert.deepEqual(problems, []);
  return specs[0];
};
const sim = (raw, seed = 1) => createAmbientSim(spec(raw), seed, G);
/** Corre `ms` a 60 fps y devuelve los frames */
const run = (s, ms, scroll = 0) => { const out = []; for (let t = 0; t < ms; t += FRAME) out.push(s.step({ dt: FRAME, scroll })); return out; };
const allPoints = (f) => [
  ...f.dots.map((d) => [d.x, d.y]), ...f.blobs.map((b) => [b.x, b.y]), ...f.shapes.map((s) => [s.x + s.w / 2, s.y + s.h / 2]),
  ...f.lines.flatMap((l) => [[l.x1, l.y1], [l.x2, l.y2]]),
];
const inRect = ([x, y], r, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const areaPx = { x: (area.x / 100) * G.w, y: (area.y / 100) * G.h, w: (area.w / 100) * G.w, h: (area.h / 100) * G.h };

test('parseAmbient: valores por defecto por tipo, campos comunes y condiciones', () => {
  const s = spec(SAMPLE.moths);
  assert.equal(s.depth, DEFAULT_DEPTH);
  assert.equal(s.blend, 'normal', 'polillas oscuras: siluetas, sin blend add');
  assert.equal(spec(SAMPLE.dust).blend, 'add');
  assert.equal(s.alpha, KIND_DEFAULTS.moths.alpha);
  assert.deepEqual(s.when, []);
  const g = spec({ ...SAMPLE.glow, when: ['!porch_light_off', 'item:ledger'], depth: 5, color: '#ff0000', alpha: 0.5 });
  assert.deepEqual(g.when, [{ kind: 'flag', name: 'porch_light_off', negated: true }, { kind: 'item', name: 'ledger', negated: false }]);
  assert.equal(g.depth, 5);
  assert.equal(g.color, 0xff0000);
  assert.equal(g.alphaMin, 0.15, 'alphaMin por defecto = 30 % de alpha');
  assert.equal(parseColor('0x00ff00'), 0x00ff00);
  assert.equal(parseColor(0x123456), 0x123456);
  assert.equal(parseColor('verde'), null);
  assert.deepEqual(parseAmbient(undefined), { specs: [], problems: [] });
  assert.equal(parseAmbient({}, 'x').problems.length, 1, 'no es una lista');
});

test('parseAmbient: un elemento mal definido se salta con su motivo y no tumba a los demás', () => {
  const bad = [
    { kind: 'moths', at: { x: 1, y: 1 } }, // sin id
    { id: 'a', kind: 'laser' }, // kind desconocido
    { id: 'b', kind: 'moths' }, // sin at
    { id: 'c', kind: 'dust' }, // sin area
    { id: 'd', kind: 'drip', at: { x: 1, y: 50 } }, // sin floorY
    { id: 'd2', kind: 'drip', at: { x: 1, y: 50 }, floorY: 40 }, // floorY por encima
    { id: 'e', kind: 'leds' }, // sin cells ni area
    { id: 'f', kind: 'glow', area, when: 'flag con espacios' },
    { id: 'g', kind: 'glow', area, alpha: 2 },
    { id: 'h', kind: 'glow', area, alpha: 0.2, alphaMin: 0.5 },
    { id: 'i', kind: 'dust', area: { x: 0, y: 0, w: 0, h: 10 } },
    { id: 'j', kind: 'dust', area, count: AMBIENT_MAX_COUNT + 1 },
    { id: 'k', kind: 'leds', area, colors: ['rojo'] },
    { id: 'ok', kind: 'sway' },
    { id: 'ok', kind: 'sway' }, // repetido
    'texto',
  ];
  const { specs, problems } = parseAmbient(bad, 'x');
  assert.deepEqual(specs.map((s) => s.id), ['ok']);
  assert.equal(problems.length, bad.length - 1);
  assert.match(problems[0], /sin id/);
  assert.match(problems[1], /desconocido/);
  assert.match(problems[2], /necesita at/);
  assert.match(problems[3], /necesita area/);
  assert.match(problems[4], /necesita floorY/);
  assert.match(problems[5], /por debajo/);
  assert.match(problems[6], /cells o area/);
  assert.match(problems[7], /when/);
  assert.match(problems[8], /alpha = 2/);
  assert.match(problems[9], /alphaMin/);
  assert.match(problems[10], /area/);
  assert.match(problems[11], /count/);
  assert.match(problems[12], /colors/);
  assert.match(problems[13], /repetido/);
  assert.match(problems[14], /no es un objeto/);
  // Tope por escena
  const many = Array.from({ length: AMBIENT_MAX_PER_SCENE + 2 }, (_, i) => ({ id: `s${i}`, kind: 'sway' }));
  const r = parseAmbient(many, 'y');
  assert.equal(r.specs.length, AMBIENT_MAX_PER_SCENE);
  assert.equal(r.problems.length, 1);
});

test('conditionsHold: gramática de A2.6a (flag, !flag, item:id, !item:id; lista = todas)', () => {
  const { ok, bad } = parseConditions(['a', '!b', 'item:x', '!item:y', 'flag:c']);
  assert.equal(bad.length, 0);
  const flags = { a: true, b: false, c: true };
  const items = new Set(['x']);
  assert.equal(conditionsHold(ok, (f) => !!flags[f], (i) => items.has(i)), true);
  assert.equal(conditionsHold(ok, (f) => !!flags[f] && f !== 'a', (i) => items.has(i)), false);
  assert.equal(conditionsHold(ok, (f) => !!flags[f], () => true), false, '!item:y con y en el inventario');
  assert.equal(conditionsHold([], () => false, () => false), true, 'sin condiciones = siempre');
  assert.equal(parseConditions('mal escrita!').bad.length, 1);
});

test('cada tipo dibuja algo desde el primer frame, dentro de su zona, y se mueve (la firma cambia)', () => {
  for (const kind of AMBIENT_KINDS) {
    const s = sim(SAMPLE[kind]);
    // flicker pasa hasta 2,6 s al máximo antes de la primera ráfaga de tics
    const frames = run(s, kind === 'flicker' ? 5000 : 1200);
    const counts = frames.map(frameCount);
    if (kind === 'sway') {
      assert.ok(frames.some((f) => Math.abs(f.fgOffset) > 1), 'sway: el primer plano se desplaza');
      assert.ok(frames.every((f) => Math.abs(f.fgOffset) <= 4.01), 'sway: dentro de la amplitud');
    } else if (kind === 'drip') {
      assert.ok(counts.some((c) => c > 0), 'drip: en 1,2 s con period 1000 se ve la gota');
    } else {
      assert.ok(counts.every((c) => c > 0), `${kind}: dibuja algo en todos los frames`);
    }
    const sigs = new Set(frames.map(frameSignature));
    // leds y flicker solo cambian al encender o apagar (una celda, un tic); lo demás, cada frame
    // glow respira despacio: con el redondeo de la firma varios frames seguidos salen iguales
    const minSigs = kind === 'leds' || kind === 'flicker' ? 2 : kind === 'glow' ? 10 : frames.length / 2;
    assert.ok(sigs.size >= minSigs, `${kind}: la firma cambia entre frames (${sigs.size}/${frames.length})`);
    // Dentro de su zona (con margen para el tamaño de las manchas y las órbitas)
    // rise serpentea 1,5 tamaños a cada lado; fog y clouds miden cientos de px; los pájaros baten las alas
    const pad = kind === 'fog' || kind === 'clouds' ? 700 : kind === 'birds' ? 20 : kind === 'rise' ? 10 : kind === 'glow' ? 1 : 2;
    for (const f of frames) {
      for (const p of allPoints(f)) {
        if (kind === 'moths') {
          const c = { x: G.w / 2, y: G.h / 2 };
          assert.ok(Math.hypot(p[0] - c.x, p[1] - c.y) <= (3 / 100) * G.h + 1, `moths fuera de la órbita: ${p}`);
        } else if (kind === 'drip') {
          assert.ok(Math.abs(p[0] - G.w / 2) <= 60 && p[1] >= (10 / 100) * G.h - 20 && p[1] <= (80 / 100) * G.h + 20, `drip fuera: ${p}`);
        } else if (kind !== 'sway') {
          assert.ok(inRect(p, areaPx, pad), `${kind} fuera del área: ${p}`);
        }
      }
    }
  }
});

test('determinismo: misma semilla → mismos frames; otra semilla → distintos', () => {
  for (const kind of ['moths', 'dust', 'leds', 'flicker', 'rise', 'birds', 'fog']) {
    const a = run(sim(SAMPLE[kind], 7), 500).map(frameSignature);
    const b = run(sim(SAMPLE[kind], 7), 500).map(frameSignature);
    const c = run(sim(SAMPLE[kind], 8), 500).map(frameSignature);
    assert.deepEqual(a, b, `${kind}: misma semilla`);
    assert.notDeepEqual(a, c, `${kind}: otra semilla`);
  }
  assert.equal(ambientSeed('x', true), ambientSeed('x', true, 0.5), 'con ?qa=1 la semilla no depende del azar');
  assert.notEqual(ambientSeed('x', true), ambientSeed('y', true));
  assert.notEqual(ambientSeed('x', false, 0.1), ambientSeed('x', false, 0.9));
});

test('dust con speed 0 no se mueve (solo centellea); con speed > 0 deriva y envuelve en el área', () => {
  const still = run(sim({ ...SAMPLE.dust, speed: 0 }), 600);
  const pos = (f) => f.dots.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`).join('|');
  assert.equal(pos(still[0]), pos(still[still.length - 1]), 'quietas');
  assert.ok(new Set(still.map((f) => f.dots[0].alpha.toFixed(3))).size > 1, 'centellean');
  const moving = run(sim({ ...SAMPLE.dust, speed: 3 }), 3000);
  assert.notEqual(pos(moving[0]), pos(moving[moving.length - 1]));
  for (const f of moving) for (const d of f.dots) assert.ok(inRect([d.x, d.y], areaPx, 0.01), 'envueltas dentro del área');
});

test('ráfagas (burst): dust y rise añaden partículas temporales que desaparecen; los demás tipos no tienen', () => {
  for (const kind of ['dust', 'rise']) {
    const s = sim(SAMPLE[kind]);
    const base = frameCount(s.step({ dt: FRAME, scroll: 0 }));
    assert.equal(s.burst(), true);
    const after = frameCount(s.step({ dt: FRAME, scroll: 0 }));
    assert.equal(after, base + SAMPLE[kind].burst, `${kind}: partículas extra`);
    run(s, 4000);
    assert.equal(frameCount(s.last()), base, `${kind}: la ráfaga se extingue`);
  }
  assert.equal(sim({ ...SAMPLE.dust, burst: 0 }).burst(), false, 'sin burst configurado no hay ráfaga');
  for (const kind of ['moths', 'leds', 'glow', 'sway']) assert.equal(sim(SAMPLE[kind]).burst(), false, kind);
});

test('leds: tantas celdas como cells o cols × rows, cada una con un color de la paleta y cambiando de estado', () => {
  const grid = sim(SAMPLE.leds);
  const f0 = grid.step({ dt: FRAME, scroll: 0 });
  assert.equal(f0.dots.length, 6);
  const explicit = sim({ id: 'l2', kind: 'leds', cells: [{ x: 1, y: 1 }, { x: 2, y: 2 }], colors: ['#ff0000'] });
  const f1 = explicit.step({ dt: FRAME, scroll: 0 });
  assert.equal(f1.dots.length, 2);
  assert.ok(f1.dots.every((d) => d.color === 0xff0000));
  const states = run(grid, 6000).map((f) => f.dots.map((d) => (d.alpha > 0.5 ? 1 : 0)).join(''));
  assert.ok(new Set(states).size > 2, 'las celdas cambian');
});

test('glow respira entre alphaMin y alpha con el periodo pedido; flicker baja a ráfagas y vuelve al máximo', () => {
  const g = sim({ ...SAMPLE.glow, shape: 'rect', alpha: 0.5, alphaMin: 0.1, period: 1000 });
  const alphas = run(g, 2000).map((f) => f.blobs[0].alpha);
  assert.ok(Math.min(...alphas) <= 0.12 && Math.max(...alphas) >= 0.48, `rango ${Math.min(...alphas)}-${Math.max(...alphas)}`);
  assert.ok(alphas.every((a) => a >= 0.1 - 1e-9 && a <= 0.5 + 1e-9));
  // Con shape ellipse (por defecto en glow) es una mancha radial suave centrada en el área, no un disco de borde duro
  const soft = sim({ ...SAMPLE.glow, alpha: 0.5 }).step({ dt: FRAME, scroll: 0 });
  assert.equal(soft.shapes.length, 0);
  assert.equal(soft.blobs.length, 1);
  assert.ok(Math.abs(soft.blobs[0].x - (areaPx.x + areaPx.w / 2)) < 1e-6 && Math.abs(soft.blobs[0].y - (areaPx.y + areaPx.h / 2)) < 1e-6);
  // A9.6: el glow rect tampoco es un rectángulo de borde duro: mancha rectangular difuminada, centrada y GLOW_RECT_SPREAD
  // veces el área; la flicker rect (tubos) sigue siendo un rectángulo
  const box = g.last();
  assert.equal(box.shapes.length, 0);
  assert.equal(box.blobs.length, 1);
  assert.equal(box.blobs[0].rect, true);
  assert.ok(Math.abs(box.blobs[0].w - areaPx.w * GLOW_RECT_SPREAD) < 1e-6 && Math.abs(box.blobs[0].h - areaPx.h * GLOW_RECT_SPREAD) < 1e-6);
  assert.ok(Math.abs(box.blobs[0].x - (areaPx.x + areaPx.w / 2)) < 1e-6);
  const fl = sim({ ...SAMPLE.flicker, alpha: 0.3, alphaMin: 0 });
  const fa = run(fl, 8000).map((f) => f.shapes[0].alpha);
  assert.ok(fa.some((a) => a < 0.15), 'alguna bajada');
  assert.ok(fa.filter((a) => a === 0.3).length > fa.length / 2, 'casi siempre al máximo');
});

test('A9.6: la textura rectangular difuminada cae a cero en los cuatro bordes, sin escalón, y es plena en el centro', () => {
  const N = 64;
  for (const t of [0.5 / N, 1 - 0.5 / N]) {
    for (let k = 0; k < N; k++) {
      const s = (k + 0.5) / N;
      assert.ok(softRectAlpha(t, s) < 0.01 && softRectAlpha(s, t) < 0.01, `borde en ${t},${s}`);
    }
  }
  assert.equal(softRectAlpha(0.5, 0.5), 1);
  // Paso máximo entre texeles vecinos (en 0-255): sin escalón
  let step = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = (x, y) => Math.round(255 * softRectAlpha((x + 0.5) / N, (y + 0.5) / N));
      step = Math.max(step, Math.abs(a(i + 1, j) - a(i, j)), Math.abs(a(j, i + 1) - a(j, i)));
    }
  }
  assert.ok(step <= 25, `paso máximo ${step}`);
  // Media intensidad cerca del borde del área: (1 - 1/SPREAD)/2 de la textura
  const edge = (1 - 1 / GLOW_RECT_SPREAD) / 2;
  const mid = softRectAlpha(edge, 0.5);
  assert.ok(mid > 0.35 && mid < 0.75, `en el borde del área ${mid}`);
});

test('scan recorre el área de arriba abajo en un periodo', () => {
  const s = sim({ ...SAMPLE.scan, period: 1000 });
  const ys = run(s, 1000).map((f) => f.lines[0].y1);
  assert.ok(Math.min(...ys) >= areaPx.y - 1e-6 && Math.max(...ys) <= areaPx.y + areaPx.h + 1e-6);
  assert.ok(Math.max(...ys) - Math.min(...ys) > areaPx.h * 0.9, 'recorre casi toda el área');
});

test('drip: espera, cae (acelerando) y salpica en floorY; luego vuelve a esperar', () => {
  const s = sim({ ...SAMPLE.drip, period: 600 });
  const frames = run(s, 4000);
  const falling = frames.filter((f) => f.lines.length);
  const splashes = frames.filter((f) => f.shapes.length);
  assert.ok(falling.length >= 5, 'se ve caer');
  assert.ok(splashes.length >= 3, 'se ve salpicar');
  const ys = falling.map((f) => f.lines[0].y2);
  for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1]) assert.ok(ys[i] - ys[i - 1] >= 0, 'nunca sube mientras cae');
  const floor = (80 / 100) * G.h;
  assert.ok(splashes.every((f) => Math.abs(f.shapes[0].y + f.shapes[0].h / 2 - floor) < 40), 'salpica en el suelo');
  assert.ok(splashes.every((f) => f.shapes[0].stroke > 0), 'la salpicadura es un anillo');
});

test('clouds con parallax: con la cámara desplazada se mueven menos que el fondo y siguen en la banda', () => {
  const still = sim(SAMPLE.clouds, 3);
  const moved = sim(SAMPLE.clouds, 3);
  still.step({ dt: FRAME, scroll: 0 });
  moved.step({ dt: FRAME, scroll: 1000 });
  const dx = moved.last().blobs[0].x - still.last().blobs[0].x;
  assert.ok(Math.abs(dx - 500) < 1 || Math.abs(Math.abs(dx) - (areaPx.w + 2 * still.last().blobs[0].w - 500)) < 1, `desplazamiento ${dx} (parallax 0,5 → +500 o envuelto)`);
  for (const f of run(moved, 3000, 1000)) for (const b of f.blobs) assert.ok(b.y >= areaPx.y - b.h && b.y <= areaPx.y + areaPx.h + b.h);
});

test('AmbientElementState: condición, forzado del op ambient y contadores de QA', () => {
  const st = new AmbientElementState(sim({ ...SAMPLE.moths, when: '!porch_light_off' }));
  const flags = {};
  const get = (f) => !!flags[f];
  assert.equal(st.refresh(get, () => false), true);
  flags.porch_light_off = true;
  assert.equal(st.refresh(get, () => false), false);
  st.forced = 'on';
  assert.equal(st.refresh(get, () => false), true, 'forzado on manda sobre la condición');
  st.forced = 'off';
  flags.porch_light_off = false;
  assert.equal(st.refresh(get, () => false), false, 'forzado off manda');
  st.forced = null;
  assert.equal(st.refresh(get, () => false), true);
  st.step({ dt: FRAME, scroll: 0 });
  const q = st.qa();
  assert.equal(q.id, 'm');
  assert.equal(q.kind, 'moths');
  assert.equal(q.frames, 1);
  assert.equal(q.count, 4);
  assert.equal(q.active, true);
  assert.equal(q.forced, null);
  assert.equal(st.burst(), false);
  assert.equal(q.bursts, 0);
});

test('frameSignature: igual para frames iguales, distinta si algo se mueve un píxel', () => {
  const f = () => ({ dots: [{ x: 1, y: 2, r: 3, alpha: 0.5, color: 1 }], blobs: [], shapes: [], lines: [], fgOffset: 0 });
  assert.equal(frameSignature(f()), frameSignature(f()));
  const g = f();
  g.dots[0].x += 1;
  assert.notEqual(frameSignature(f()), frameSignature(g));
});

test('escenas reales: todas tienen ≥ 2 elementos válidos, sin problemas, y cada op ambient nombra uno de su escena', () => {
  const root = new URL('../assets/scenes/', import.meta.url);
  const ids = readdirSync(root).filter((d) => existsSync(new URL(`${d}/scene.json`, root)));
  assert.ok(ids.length >= 13);
  for (const id of ids) {
    const s = JSON.parse(readFileSync(new URL(`${id}/scene.json`, root), 'utf8'));
    const { specs, problems } = parseAmbient(s.ambient, id);
    assert.deepEqual(problems, [], `${id}: ambient con problemas`);
    assert.ok(specs.length >= 2, `${id}: ${specs.length} elemento(s) de ambiente (A4.3 pide ≥ 2)`);
    const names = new Set(specs.map((x) => x.id));
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      if (v.op === 'ambient') {
        assert.ok(names.has(v.id), `${id}: op ambient «${v.id}» no está en ambient[]`);
        assert.ok(['on', 'off', 'auto', 'burst'].includes(v.action), `${id}: op ambient action «${v.action}»`);
        if (v.action === 'burst') assert.ok(specs.find((x) => x.id === v.id).burst > 0, `${id}: burst de «${v.id}» sin partículas`);
      }
      for (const k of Object.keys(v)) walk(v[k]);
    };
    walk(s.regions);
    walk(s.combos);
    walk(s.onEnter);
    walk(s.dialogues);
    // Cada elemento simula sin error con la geometría real del fondo
    for (const sp of specs) {
      const sm = createAmbientSim(sp, ambientSeed(sp.id, true), { w: s.render?.world?.width ?? 3712, h: s.render?.world?.height ?? 1152 });
      // Un elemento solo de ráfaga (count 0 + burst) no hace nada en reposo: se lanza la ráfaga
      if (sp.count === 0 && sp.burst > 0) assert.equal(sm.burst(), true, `${id}.${sp.id}: la ráfaga no arranca`);
      const frames = run(sm, 6000);
      assert.ok(frames.length && new Set(frames.map(frameSignature)).size > 1, `${id}.${sp.id}: no se mueve`);
      assert.ok(frames.some((f) => frameCount(f) > 0 || sp.kind === 'sway'), `${id}.${sp.id}: no dibuja nada`);
    }
  }
});

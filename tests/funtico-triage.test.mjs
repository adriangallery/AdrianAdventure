// F1.1 (plan FUNTICO_ADVENTURE): lógica pura de Triage (src/funtico/triage/). Semilla → carrera determinista (y un
// golden), dificultad comparable entre 200 semillas, puntuación con casos calculados a mano (las cuentas, en los
// comentarios) y validación de plausibilidad del registro de toques.
// CI (Node 22): parte de `npm run test:funtico`. Si cambia el catálogo a propósito, el golden se actualiza a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, hashSeed } from '../src/funtico/triage/rng.js';
import {
  RULES, RUN_VERSION, BUCKETS, DEFAULT_SCENES, generateRun, scoreRun, validateTaps, speedPoints, streakPermille,
  inBounds, catalogId, maxEvents,
} from '../src/funtico/triage/triage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/funtico/triage/catalog.json'), 'utf8'));

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
/** Toque que acierta la estación `st` en el instante t. */
const hitTap = (st, t) => (st.kind === 'relapse'
  ? { t, est: st.i, obj: st.obj, x: st.correct, y: 0 }
  : { t, est: st.i, obj: st.obj, ...center(st.bounds) });
/** Toque que falla: fuera de los bounds (esquina opuesta de la escena) o la réplica siguiente a la buena. */
const missTap = (st, t) => (st.kind === 'relapse'
  ? { t, est: st.i, obj: st.obj, x: (st.correct + 1) % st.options.length, y: 0 }
  : { t, est: st.i, obj: st.obj, x: st.bounds.x > 50 ? 1 : 99, y: st.bounds.y > 50 ? 1 : 99 });

// ── PRNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('PRNG: cyrb128 + sfc32 con valores fijos (portable, sin Math.random)', () => {
  assert.deepEqual(hashSeed('abc'), [1181011423, 830437656, 3964173471, 1611500297]);
  const g = createRng('abc');
  assert.deepEqual([g.nextU32(), g.nextU32(), g.nextU32()], [1153603285, 1274323780, 1698660185]);
  const a = createRng('x');
  const b = createRng('x');
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  const c = createRng('y');
  const s = c.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...s].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 1000; i++) { const v = c.int(7); assert.ok(Number.isInteger(v) && v >= 0 && v < 7); }
});

// ── generador ────────────────────────────────────────────────────────────────────────────────────────────────────

test('misma semilla → misma carrera (deep equal) y serializable en JSON', () => {
  const a = generateRun('seed-123', catalog);
  const b = generateRun('seed-123', catalog);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.notDeepEqual(generateRun('seed-124', catalog).stations, a.stations);
  assert.equal(a.v, RUN_VERSION);
  assert.equal(a.catalog, catalogId(catalog));
  assert.equal(a.durationMs, 180000);
  assert.equal(a.stations.length, 9);
  assert.deepEqual(a.stations.map((s) => s.i), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(Object.keys(a.scenes).sort(), [...DEFAULT_SCENES].sort());
});

test('golden: la semilla «golden-f1.1» da siempre esta carrera', () => {
  const run = generateRun('golden-f1.1', catalog);
  const sig = run.stations.map((s) => (s.kind === 'relapse' ? [s.kind, s.obj, s.correct, s.graceMs] : [s.kind, s.obj, s.bucket, s.graceMs, s.crop ?? null]));
  assert.deepEqual(sig, [
    ['symptom', 'lobby:hs_frontdoor', 'easy', 6000, null],
    ['sample', 'rooftop:hs_city_skyline', 'hard', 1500, { x: 11.35, y: 42, w: 4.34, h: 14 }],
    ['symptom', 'rooftop:hs_weather_vane', 'medium', 3900, null],
    ['sample', 'outside:hs_trees', 'easy', 1500, { x: 91.6, y: 26.07, w: 8.2, h: 26.42 }],
    ['sample', 'lobby:hs_coat', 'medium', 1500, { x: 53.3, y: 47.14, w: 4.8, h: 15.47 }],
    ['symptom', 'outside:hs_chimney', 'hard', 5700, null],
    ['relapse', 'chad_fud:i5', 0, 6600],
    ['relapse', 'chad_fud:i1', 0, 6300],
    ['relapse', 'chad_fud:i3', 3, 6900],
  ]);
  const vane = run.stations[2];
  assert.equal(vane.phrase, 'Rusted solid. It needs grease. A lot of grease.');
  assert.match(vane.voice, /^assets\/audio\/voice\/player_.*\.mp3$/);
});

test('200 semillas: misma distribución de cubos, tipos y escenas; sin repetidos; RELAPSE barajado distinto', () => {
  const relapseSigs = new Set();
  const used = new Set();
  const firstObj = new Set();
  const correctAt = new Set();
  for (let n = 0; n < 200; n++) {
    const run = generateRun(`seed-${n}`, catalog);
    const spots = run.stations.filter((s) => s.kind !== 'relapse');
    const relapse = run.stations.filter((s) => s.kind === 'relapse');
    assert.equal(spots.length, 6);
    assert.equal(relapse.length, 3);
    assert.deepEqual(run.stations.slice(6).map((s) => s.kind), ['relapse', 'relapse', 'relapse'], 'RELAPSE al final');
    // cubos: 2 de cada; y en cada cubo, un SAMPLE y un SYMPTOM
    for (const b of BUCKETS) {
      const inB = spots.filter((s) => s.bucket === b);
      assert.equal(inB.length, 2, `semilla ${n}, cubo ${b}`);
      assert.deepEqual(inB.map((s) => s.kind).sort(), ['sample', 'symptom']);
    }
    // escenas: 2 por escena, con cubos distintos y un objetivo de cada tipo
    for (const sc of DEFAULT_SCENES) {
      const inS = spots.filter((s) => s.scene === sc);
      assert.equal(inS.length, 2, `semilla ${n}, escena ${sc}`);
      assert.notEqual(inS[0].bucket, inS[1].bucket);
      assert.deepEqual(inS.map((s) => s.kind).sort(), ['sample', 'symptom']);
    }
    // sin objetivos repetidos
    assert.equal(new Set(run.stations.map((s) => s.obj)).size, 9);
    // RELAPSE: las 3 rondas distintas, 4 opciones, la buena en su sitio
    for (const st of relapse) {
      const round = catalog.relapse.rounds.find((r) => `chad_fud:${r.id}` === st.obj);
      assert.equal(st.options[st.correct].text, round.options[round.correct].text);
      assert.deepEqual(st.options.map((o) => o.text).sort(), round.options.map((o) => o.text).sort());
      correctAt.add(st.correct);
    }
    relapseSigs.add(relapse.map((s) => `${s.obj}/${s.options.map((o) => o.text.slice(0, 6)).join('|')}`).join(' '));
    // SAMPLE: recorte dentro de la escena y pegado al objetivo; SYMPTOM: frase y voz
    for (const st of spots) {
      if (st.kind === 'sample') {
        const c = st.crop;
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 100.01 && c.y + c.h <= 100.01, JSON.stringify(c));
        const ix = Math.min(c.x + c.w, st.bounds.x + st.bounds.w) - Math.max(c.x, st.bounds.x);
        const iy = Math.min(c.y + c.h, st.bounds.y + st.bounds.h) - Math.max(c.y, st.bounds.y);
        assert.ok(ix > 0 && iy > 0, `${st.obj}: el recorte no toca el objetivo`);
        assert.equal(st.graceMs, RULES.graceBaseMs);
      } else {
        assert.ok(st.phrase && st.voice);
        assert.ok(st.graceMs > RULES.graceBaseMs);
      }
    }
    spots.forEach((s) => used.add(s.obj));
    firstObj.add(run.stations[0].obj);
  }
  assert.ok(relapseSigs.size >= 100, `solo ${relapseSigs.size} RELAPSE distintos en 200 semillas`);
  assert.deepEqual([...correctAt].sort(), [0, 1, 2, 3], 'la buena cae en todas las posiciones');
  assert.equal(used.size, catalog.targets.length, 'en 200 carreras sale todo el catálogo');
  assert.ok(firstObj.size >= 20, 'la primera estación varía');
});

test('generador: errores claros (semilla vacía, escena sin catálogo, rondas insuficientes) y otras escenas', () => {
  assert.throws(() => generateRun('', catalog), /semilla/);
  assert.throws(() => generateRun('x', catalog, { scenes: ['outside', 'lobby', 'basement'] }), /basement/);
  assert.throws(() => generateRun('x', catalog, { relapseRounds: 4 }), /RELAPSE/);
  const two = generateRun('x', catalog, { relapseRounds: 2 });
  assert.equal(two.stations.length, 8);
});

// ── puntuación: casos calculados a mano ──────────────────────────────────────────────────────────────────────────

/** Carrera escrita a mano (independiente del catálogo): SAMPLE, SYMPTOM y una ronda de RELAPSE. */
const handRun = () => ({
  v: RUN_VERSION,
  seed: 'hand',
  catalog: 'hand',
  durationMs: 180000,
  rules: { ...RULES },
  scenes: {},
  stations: [
    { i: 0, kind: 'sample', obj: 'a:hs_a', scene: 'a', bounds: { x: 10, y: 10, w: 10, h: 10 }, graceMs: 1500, maxMisses: 3 },
    { i: 1, kind: 'symptom', obj: 'a:hs_b', scene: 'a', bounds: { x: 50, y: 50, w: 10, h: 20 }, graceMs: 3000, maxMisses: 3 },
    { i: 2, kind: 'relapse', obj: 'chad_fud:i3', scene: 'p', options: [{}, {}, {}, {}], correct: 2, graceMs: 5000, maxMisses: 1 },
  ],
});
const A = (t, x = 15, y = 15) => ({ t, est: 0, obj: 'a:hs_a', x, y });
const B = (t, x = 55, y = 60) => ({ t, est: 1, obj: 'a:hs_b', x, y });
const R = (t, x = 2) => ({ t, est: 2, obj: 'chad_fud:i3', x, y: 0 });

test('rapidez y racha: piezas', () => {
  assert.equal(speedPoints(0, 1500), 1000);
  assert.equal(speedPoints(1500, 1500), 1000);
  assert.equal(speedPoints(6500, 1500), 500); // 5000 ms pasado el margen: la mitad
  assert.equal(speedPoints(11499, 1500), 0); // 9999 ms: floor(1000 × 1 / 10000) = 0
  assert.equal(speedPoints(11500, 1500), 0);
  assert.equal(speedPoints(99999, 1500), 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map((k) => streakPermille(k)), [1000, 1100, 1210, 1331, 1464, 1611, 1772, 1949, 2000, 2000, 2000]);
  assert.ok(inBounds(10, 10, { x: 10, y: 10, w: 1, h: 1 }) && inBounds(11, 11, { x: 10, y: 10, w: 1, h: 1 }), 'bordes incluidos');
  assert.ok(!inBounds(11.01, 10, { x: 10, y: 10, w: 1, h: 1 }));
  assert.ok(!inBounds(NaN, 10, { x: 0, y: 0, w: 100, h: 100 }));
});

test('todo perfecto y rápido', () => {
  // 0: 1000 ms ≤ 1500 → (1000+1000)×1,000 = 2000 · 1: 1500 ms ≤ 3000 → 2000×1,1 = 2200 · 2: 1500 ≤ 5000 → 2000×1,21 = 2420
  // fin a 4000 ms → 176 s sobrantes × 50 × 3/3 aciertos = 8800 · total 6620 + 8800 = 15420
  const s = scoreRun(handRun(), [A(1000), B(2500), R(4000)]);
  assert.equal(s.score, 15420);
  assert.deepEqual([s.hits, s.misses, s.completed, s.endMs, s.leftoverSeconds, s.leftoverBonus], [3, 0, true, 4000, 176, 8800]);
  assert.deepEqual(s.stations.map((x) => x.points), [2000, 2200, 2420]);
  assert.deepEqual(s.stations.map((x) => x.multiplier), [1000, 1100, 1210]);
});

test('todo lento', () => {
  // 0: 11500 ms → 10000 pasado el margen → rapidez 0 → 1000 · 1: abre a 11500, toque a 19500 → 8000 ms, 5000 pasado
  // → rapidez 500 → 1500×1,1 = 1650 · 2: abre a 19500, toque a 34500 → 15000 ms, 10000 pasado → 0 → 1000×1,21 = 1210
  // fin a 34500 → 145 s × 50 = 7250 · total 3860 + 7250 = 11110
  const s = scoreRun(handRun(), [A(11500), B(19500), R(34500)]);
  assert.deepEqual(s.stations.map((x) => x.points), [1000, 1650, 1210]);
  assert.equal(s.leftoverBonus, 7250);
  assert.equal(s.score, 11110);
});

test('un fallo corta la racha', () => {
  // 0: 2000 · 1: fallo a 2000 (−250, racha a 0), acierto a 3000 → 2000 ms desde que abrió (1000) ≤ 3000 → 2000×1,0
  // 2: a 4000 → 1000 ms → 2000×1,1 = 2200 · 2000 − 250 + 2000 + 2200 = 5950 + 176 s × 50 = 8800 → 14750
  const s = scoreRun(handRun(), [A(1000), B(2000, 0, 0), B(3000), R(4000)]);
  assert.deepEqual(s.stations.map((x) => [x.points, x.multiplier, x.misses]), [[2000, 1000, 0], [1750, 1000, 1], [2200, 1100, 0]]);
  assert.equal(s.misses, 1);
  assert.equal(s.score, 14750);
});

test('tope de racha ×2', () => {
  // 10 rondas acertadas a 1000 ms: 2000 × (1 + 1,1 + 1,21 + 1,331 + 1,464 + 1,611 + 1,772 + 1,949 + 2 + 2)
  // = 2000+2200+2420+2662+2928+3222+3544+3898+4000+4000 = 30874 · fin a 10000 → 170 s × 50 = 8500 → 39374
  const stations = Array.from({ length: 10 }, (_, i) => ({ i, kind: 'relapse', obj: `r${i}`, scene: 'p', options: [{}, {}], correct: 0, graceMs: 5000, maxMisses: 1 }));
  const run = { ...handRun(), stations };
  const taps = stations.map((st) => ({ t: (st.i + 1) * 1000, est: st.i, obj: st.obj, x: 0, y: 0 }));
  const s = scoreRun(run, taps);
  assert.deepEqual(s.stations.map((x) => x.points), [2000, 2200, 2420, 2662, 2928, 3222, 3544, 3898, 4000, 4000]);
  assert.equal(s.score, 39374);
});

test('sobrante de tiempo: solo si se terminan todas, y en proporción a los aciertos', () => {
  // 0: 2000 · 1: tres fallos (2000, 3000, 4000) la cierran fallida · 2: fallo a 5000 · 2000 − 4×250 = 1000
  // fin a 5000 → 175 s × 50 × 1/3 = floor(8750/3) = 2916 → 3916
  const s = scoreRun(handRun(), [A(1000), B(2000, 0, 0), B(3000, 0, 0), B(4000, 0, 0), R(5000, 0)]);
  assert.deepEqual([s.hits, s.misses, s.completed, s.leftoverBonus, s.score], [1, 4, true, 2916, 3916]);
  // sin terminar (se acaba el tiempo en la estación 2) no hay sobrante: 2000 + 2200
  const t = scoreRun(handRun(), [A(1000), B(2500)]);
  assert.deepEqual([t.completed, t.endMs, t.leftoverBonus, t.score], [false, null, 0, 4200]);
  // un toque después de los 180 s no cuenta
  const u = scoreRun(handRun(), [A(1000), B(2500), R(180001)]);
  assert.deepEqual([u.completed, u.score], [false, 4200]);
});

test('nunca negativo; enteros', () => {
  const taps = [A(1000, 0, 0), A(2000, 0, 0), A(3000, 0, 0), B(4000, 0, 0), B(5000, 0, 0), B(6000, 0, 0), R(7000, 0)];
  const s = scoreRun(handRun(), taps);
  assert.equal(s.raw, -1750); // 7 fallos × −250, y 0 aciertos → sobrante 0
  assert.equal(s.score, 0);
  for (const n of [scoreRun(handRun(), [A(1234), B(5678), R(9999)]).score, s.score]) assert.ok(Number.isInteger(n));
});

test('toque fuera de bounds = fallo aunque el cliente diga ok; el acierto se recalcula', () => {
  // 0: fallo a 1000 (x=25 fuera de 10–20, aunque diga ok:true) −250; acierto a 2000 → 2000 ms, 500 pasado → 950
  // → 1950×1,0 · 1: 1000 ms → 2000×1,1 = 2200 · 2: 1000 ms → 2000×1,21 = 2420 · 6320 + 176 s × 50 = 8800 → 15120
  const s = scoreRun(handRun(), [{ ...A(1000, 25, 15), ok: true }, { ...A(2000), ok: false }, B(3000), R(4000)]);
  assert.deepEqual(s.stations.map((x) => x.points), [1700, 2200, 2420]);
  assert.equal(s.score, 15120);
  // y una réplica que no es la buena falla aunque diga ok
  const r = scoreRun(handRun(), [A(1000), B(2500), { ...R(4000, 1), ok: true }]);
  assert.deepEqual([r.stations[2].hit, r.score], [false, 2000 + 2200 - 250 + Math.floor((176 * 50 * 2) / 3)]);
});

test('carrera real del generador: perfecta → 9 aciertos; los toques de otra estación se ignoran', () => {
  const run = generateRun('golden-f1.1', catalog);
  const taps = run.stations.map((st) => hitTap(st, (st.i + 1) * 1000));
  const s = scoreRun(run, taps);
  assert.deepEqual([s.hits, s.misses, s.completed, s.endMs], [9, 0, true, 9000]);
  // todas con rapidez completa (1000 ms ≤ margen) → 2000 × tabla de racha; sobrante 171 s × 50
  const expected = [1000, 1100, 1210, 1331, 1464, 1611, 1772, 1949, 2000].reduce((n, m) => n + 2 * m, 0) + 171 * 50;
  assert.equal(s.score, expected);
  // un toque con est equivocado no cuenta (ni para bien ni para mal)
  const noisy = [taps[0], { ...hitTap(run.stations[5], 1500), est: 5 }, ...taps.slice(1)];
  assert.equal(scoreRun(run, noisy).score, expected);
  assert.equal(validateTaps(run, taps).ok, true);
  assert.equal(validateTaps(run, noisy).reason, 'wrong_station');
});

// ── validación ───────────────────────────────────────────────────────────────────────────────────────────────────

test('validateTaps: registro humano aceptado; tiempos decrecientes, toques a 10 ms y fuera de 180 s rechazados', () => {
  const run = handRun();
  assert.deepEqual(validateTaps(run, [A(1000), B(2000, 0, 0), B(3000), R(4000)]), { ok: true, reason: null });
  assert.deepEqual(validateTaps(run, []), { ok: true, reason: null });
  assert.equal(validateTaps(run, [A(1000), B(900)]).reason, 'time_not_increasing');
  assert.equal(validateTaps(run, [A(1000), B(1000)]).reason, 'time_not_increasing');
  assert.deepEqual(validateTaps(run, [A(1000), B(1500, 0, 0), B(1510)]), { ok: false, reason: 'too_fast', at: 2 });
  assert.equal(validateTaps(run, [A(1000), B(2000), R(180001)]).reason, 'time_out_of_range');
  assert.equal(validateTaps(run, [A(-5)]).reason, 'time_out_of_range');
  assert.equal(validateTaps(run, [A(10)]).reason, 'reaction_too_fast');
  assert.equal(validateTaps(run, [A(1000), B(1200)]).reason, 'reaction_too_fast');
});

test('validateTaps: orden de estaciones, objetivo, opciones, forma y cantidad', () => {
  const run = handRun();
  assert.equal(validateTaps(run, [B(1000)]).reason, 'wrong_station');
  assert.equal(validateTaps(run, [{ ...A(1000), obj: 'a:hs_b' }]).reason, 'wrong_objective');
  assert.equal(validateTaps(run, [A(1000), B(2000), R(3000, 4)]).reason, 'bad_option');
  assert.equal(validateTaps(run, [A(1000), B(2000), R(3000, 1.5)]).reason, 'bad_option');
  assert.equal(validateTaps(run, [A(1000), B(2000), R(3000), R(4000)]).reason, 'after_finish');
  assert.equal(validateTaps(run, [A(1000, 150, 15)]).reason, 'out_of_scene');
  assert.equal(validateTaps(run, [{ t: 1000.5, est: 0, obj: 'a:hs_a', x: 1, y: 1 }]).reason, 'bad_event');
  assert.equal(validateTaps(run, [{ t: 1000, est: 0, obj: 'a:hs_a', x: 'a', y: 1 }]).reason, 'bad_event');
  assert.equal(validateTaps(run, 'nope').reason, 'not_array');
  assert.equal(validateTaps({ ...run, v: 99 }, []).reason, 'bad_run');
  assert.equal(maxEvents(run), 7); // 3 + 3 + 1
  const many = Array.from({ length: 8 }, (_, k) => A(1000 + k * 1000, 0, 0));
  assert.equal(validateTaps(run, many).reason, 'too_many_events');
  // tres fallos cierran la estación: el cuarto toque ya es de la siguiente
  assert.equal(validateTaps(run, [A(1000, 0, 0), A(2000, 0, 0), A(3000, 0, 0), A(4000)]).reason, 'wrong_station');
  assert.equal(validateTaps(run, [A(1000, 0, 0), A(2000, 0, 0), A(3000, 0, 0), B(4000)]).ok, true);
});

test('validateTaps sobre carreras generadas: fallos y aciertos con ritmo humano pasan', () => {
  for (let n = 0; n < 50; n++) {
    const run = generateRun(`v-${n}`, catalog);
    const taps = [];
    let t = 0;
    for (const st of run.stations) {
      if (st.kind !== 'relapse' && n % 2) { t += 700; taps.push(missTap(st, t)); }
      t += 900;
      taps.push(hitTap(st, t));
    }
    assert.deepEqual(validateTaps(run, taps), { ok: true, reason: null }, `semilla v-${n}`);
    const s = scoreRun(run, taps);
    assert.equal(s.hits, 9);
    assert.equal(s.misses, n % 2 ? 6 : 0);
  }
});

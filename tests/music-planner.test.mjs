// A8.1 (plan SCUMM): planificador de la música adaptativa (src/systems/MusicPlanner.ts) sobre las rejillas medidas de
// assets/config/music-map.json. Que toda salida caiga en compás, que nunca espere más de lo pactado, que el puente vaya en la
// tonalidad de destino y que la tabla de estados resuelva por prioridad.
// CI (Node 22): node --experimental-strip-types --test tests/music-planner.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const P = await import(process.env.MUSIC_PLANNER_PATH ?? '../src/systems/MusicPlanner.ts');
const { transposeSemitones: stingerTranspose, STINGER_MS } = await import('../src/systems/Stingers.ts');
const { MUSIC_KEYS } = await import('../src/config/music.config.ts');
const MAP = JSON.parse(readFileSync(new URL('../assets/config/music-map.json', import.meta.url), 'utf8'));
const OPTS = { ...P.DEFAULT_PLANNER, ...MAP.planner };
const TRACKS = Object.entries(MAP.tracks);

const onBar = (grid, posSec) => {
  const b = P.barAt(grid, posSec);
  return Math.abs(b - Math.round(b)) < 1e-4; // < 0,2 ms
};

test('music-map: las 6 pistas medidas, con rejilla coherente y la tonalidad de music.config.ts', () => {
  assert.deepEqual(Object.keys(MAP.tracks).sort(), Object.keys(MUSIC_KEYS).sort());
  for (const [name, g] of TRACKS) {
    assert.ok(g.bpm >= 60 && g.bpm <= 180, `${name}: bpm ${g.bpm}`);
    assert.ok(Math.abs(g.barSec - (60 / g.bpm) * g.beatsPerBar) < 1e-3, `${name}: barSec`);
    assert.ok(g.firstDownbeatSec >= 0 && g.firstDownbeatSec < g.barSec, `${name}: primer tiempo dentro del primer compás`);
    assert.ok(g.loopEndSec <= g.durationSec + 1e-6, `${name}: el bucle acaba antes del final`);
    assert.ok(onBar(g, g.loopEndSec), `${name}: el bucle cierra en compás`);
    assert.equal(g.sections[0].startBar, 0, `${name}: la primera sección empieza en 0`);
    for (const s of g.sections) assert.equal(s.startBar % 4, 0, `${name}: secciones en múltiplos de 4 compases`);
    assert.deepEqual(g.key, MUSIC_KEYS[name], `${name}: misma tonalidad que A4.5`);
  }
});

test('nextExit: siempre en compás y nunca más tarde de maxWaitBars (barrido de posiciones en todas las pistas)', () => {
  for (const [name, g] of TRACKS) {
    for (let pos = 0; pos < g.loopEndSec; pos += 0.37) {
      const ex = P.nextExit(g, pos, OPTS);
      const at = pos + ex.waitSec;
      assert.ok(onBar(g, at), `${name}@${pos.toFixed(2)}: salida fuera de compás`);
      assert.ok(ex.waitSec >= OPTS.minLeadSec - 1e-9, `${name}@${pos.toFixed(2)}: sin margen para programar`);
      assert.ok(ex.waitSec <= (OPTS.maxWaitBars + 1) * g.barSec + 1e-9, `${name}@${pos.toFixed(2)}: espera ${ex.waitSec.toFixed(2)} s`);
      assert.ok(ex.bar >= 0 && ex.bar < g.bars);
      if (ex.kind === 'section') assert.ok(g.sections.some((s) => s.startBar === ex.bar && s.id === ex.section));
      if (ex.kind === 'phrase') assert.equal(ex.bar % OPTS.phraseBars, 0);
    }
  }
});

test('nextExit: prefiere inicio de sección > final de frase > compás', () => {
  const OPTS = { maxWaitBars: 4, phraseBars: 4, minLeadSec: 0.12 };
  const g = { bpm: 120, beatsPerBar: 4, firstDownbeatSec: 0, barSec: 2, bars: 32, durationSec: 64, loopStartSec: 0, loopEndSec: 64, key: { tonic: 0, mode: 'major' }, sections: [{ id: 'A1', startBar: 0, bars: 10, energyDb: -20 }, { id: 'B1', startBar: 10, bars: 22, energyDb: -12 }] };
  // en el compás 6,5: frase en 8, sección en 10 (dentro de 4 compases) → sección
  assert.deepEqual([P.nextExit(g, 13, OPTS).kind, P.nextExit(g, 13, OPTS).bar], ['section', 10]);
  // en el compás 1,5: sección lejos, frase en 4 → frase
  assert.deepEqual([P.nextExit(g, 3, OPTS).kind, P.nextExit(g, 3, OPTS).bar], ['phrase', 4]);
  // con espera máxima de 0 compases → la siguiente línea de compás
  const e = P.nextExit(g, 3, { ...OPTS, maxWaitBars: 0 });
  assert.deepEqual([e.kind, e.bar], ['bar', 2]);
  // justo antes de una línea (menos que el margen) → la siguiente
  assert.equal(P.nextExit(g, 7.95, { ...OPTS, maxWaitBars: 0 }).bar, 5);
  // al final del bucle vuelve al compás 0 (que es inicio de sección)
  const w = P.nextExit(g, 63, OPTS);
  assert.deepEqual([w.kind, w.bar, w.absBar], ['section', 0, 32]);
  // anacrusa: antes del primer tiempo fuerte sale en el 0
  assert.equal(P.nextExit({ ...g, firstDownbeatSec: 0.5 }, 0, OPTS).bar, 0);
});

test('trackPosition: el bucle vuelve a loopStart y conserva la rejilla', () => {
  const [, g] = TRACKS[0];
  const len = g.loopEndSec - g.loopStartSec;
  const p = P.trackPosition(g, g.loopStartSec, len + 1.5);
  assert.ok(Math.abs(p - (g.loopStartSec + 1.5)) < 1e-6);
  assert.ok(Math.abs(P.barAt(g, P.trackPosition(g, 0, g.loopEndSec + g.barSec)) - 1) < 1e-6, 'tras el bucle, compás 1');
});

test('chooseBridge: en la tonalidad de DESTINO, igual que los stingers de A4.5', () => {
  for (const [, from] of TRACKS) {
    for (const [, to] of TRACKS) {
      const b = P.chooseBridge(from.key, to.key, 'scene');
      assert.deepEqual(b.key, to.key);
      if (P.sameKeySet(from.key, to.key)) assert.equal(b.type, 'none');
      else {
        assert.equal(b.type, 'stinger');
        assert.ok(b.clip in STINGER_MS, `clip ${b.clip} existe`);
        assert.equal(b.detune, stingerTranspose(to.key.tonic) * 100, 'transporte a la tónica de destino');
      }
    }
  }
  assert.equal(P.chooseBridge(null, MUSIC_KEYS.vista).type, 'none');
  assert.equal(P.chooseBridge(MUSIC_KEYS.vista, MUSIC_KEYS.vista, 'chapter').clip, 'stinger_chapter_minor');
  assert.ok(P.sameKeySet({ tonic: 0, mode: 'major' }, { tonic: 9, mode: 'minor' }), 'Do mayor / La menor relativas');
  assert.ok(!P.sameKeySet({ tonic: 2, mode: 'major' }, { tonic: 7, mode: 'minor' }));
});

test('resolveState: prioridades de la tabla de music-map.json', () => {
  const ctx = (o) => ({ scene: 'outside', dialogue: false, flags: {}, inventory: [], goalsLeft: null, transient: null, ...o });
  assert.equal(P.resolveState(MAP.rules, ctx({})).state, 'explore');
  assert.equal(P.resolveState(MAP.rules, ctx({ dialogue: true })).state, 'dialogue');
  assert.equal(P.resolveState(MAP.rules, ctx({ scene: 'basement' })).state, 'tension');
  assert.equal(P.resolveState(MAP.rules, ctx({ scene: 'basement', dialogue: true })).state, 'dialogue', 'la conversación manda sobre la tensión');
  assert.equal(P.resolveState(MAP.rules, ctx({ scene: 'server_room' })).state, 'danger');
  assert.equal(P.resolveState(MAP.rules, ctx({ scene: 'server_room', flags: { pzbot_off: true } })).state, 'explore');
  assert.equal(P.resolveState(MAP.rules, ctx({ scene: 'clinic_interior', inventory: ['keycard'] })).state, 'tension');
  assert.equal(P.resolveState(MAP.rules, ctx({ goalsLeft: 1 })).state, 'chapterEnd');
  assert.equal(P.resolveState(MAP.rules, ctx({ goalsLeft: 3 })).state, 'explore');
  assert.equal(P.resolveState(MAP.rules, ctx({ goalsLeft: 0 })).state, 'explore', 'capítulo sin objetivos pendientes: no es «cerca del final»');
  assert.equal(P.resolveState(MAP.rules, ctx({ transient: 'solved', dialogue: true })).state, 'solved');
  for (const r of MAP.rules) assert.ok(r.state in MAP.states, `estado ${r.state} definido`);
});

test('sectionFor / needsSectionJump: calm = menos energía, intense = más; no salta si ya está en esa letra', () => {
  for (const [name, g] of TRACKS) {
    const calm = P.sectionFor(g, 'calm');
    const hot = P.sectionFor(g, 'intense');
    const top = Math.max(...g.sections.map((s) => s.energyDb));
    assert.equal(hot.energyDb, top, `${name}: intense = la más fuerte`);
    assert.ok(calm.energyDb >= top - P.CALM_FLOOR_DB, `${name}: calm no es un final casi en silencio`);
    assert.ok(g.sections.filter((s) => s.energyDb >= top - P.CALM_FLOOR_DB).every((s) => calm.energyDb <= s.energyDb), name);
    assert.equal(P.sectionFor(g, 'any'), null);
    assert.equal(P.needsSectionJump(g, hot.startBar, 'intense'), null, `${name}: ya está en la intensa`);
  }
});

test('capas: todas las notas en la tonalidad y en la rejilla de pulsos; el motivo cambia por lugar', () => {
  for (const [name, g] of TRACKS) {
    for (const layer of Object.keys(P.LAYER_GAIN)) {
      for (const place of [MAP.defaultPlace, ...Object.values(MAP.places).map((p) => ({ ...MAP.defaultPlace, ...p }))]) {
        for (const n of P.layerNotes(layer, g.key, place, g.beatsPerBar, 0, true)) {
          assert.ok(n.beat >= 0 && n.beat < g.beatsPerBar, `${name}/${layer}: dentro del compás`);
          assert.equal((n.beat * 2) % 1, 0, `${name}/${layer}: en pulso o contratiempo`);
          if (n.wave !== 'noise') assert.ok(P.inKey(n.midi, g.key), `${name}/${layer}: nota ${n.midi} fuera de ${g.key.tonic} ${g.key.mode}`);
        }
      }
    }
  }
  const key = MUSIC_KEYS['retro-adventure'];
  const porch = P.layerNotes('motif', key, P.placeFor(MAP, 'outside'), 4, 0);
  const cellar = P.layerNotes('motif', key, P.placeFor(MAP, 'basement'), 4, 0);
  assert.notEqual(porch.length, cellar.length, 'densidad distinta');
  assert.ok(porch[0].midi - cellar[0].midi === 24, 'dos octavas entre porche y sótano');
  assert.equal(porch[0].midi % 12, cellar[0].midi % 12, 'mismo motivo (misma nota de partida)');
});

test('nextBeatSec: la siguiente línea de pulso', () => {
  const [, g] = TRACKS[0];
  const beat = g.barSec / g.beatsPerBar;
  const d = P.nextBeatSec(g, g.firstDownbeatSec + 0.25 * beat);
  assert.ok(Math.abs(d - 0.75 * beat) < 1e-9);
});

// ─── A8.3: niveles de intensidad (temas de ElevenLabs) ─────────────────────────────

const THEMES = Object.entries(MAP.themes ?? {});

test('A8.3 music-map: cada tema con sus niveles medidos, misma tonalidad y tempo compatible, escenas que existen', () => {
  const scenes = new Set();
  for (const [id, t] of THEMES) {
    assert.ok(t.levels.length === 4, `${id}: 4 niveles (calma, activo, tensión, triunfo)`);
    const present = t.levels.filter((k) => k != null);
    assert.ok(present.length >= 1, `${id}: al menos un nivel`);
    for (const k of present) assert.ok(MAP.tracks[k], `${id}: ${k} está en tracks (no apunta a un mp3 que no existe)`);
    const g0 = MAP.tracks[present[0]];
    for (const k of present) {
      const g = MAP.tracks[k];
      assert.ok(P.sameKeySet(g.key, g0.key), `${id}: ${k} en la misma tonalidad`);
      assert.ok(P.tempoCompatible(g.bpm, g0.bpm), `${id}: ${k} a ${g.bpm} BPM, compatible con ${g0.bpm}`);
      assert.equal(g.firstDownbeatSec, 0, `${k}: cortado en compás`);
      assert.ok(g.confidence.declared, `${k}: rejilla declarada en art/music`);
      assert.ok(P.tempoCompatible(g.confidence.measuredBpm, g.bpm, 0.03), `${k}: BPM medido ${g.confidence.measuredBpm} ≈ pedido ${g.bpm} (o doble/mitad)`);
      // el triunfo (4-6 compases) acaba a menudo en la dominante: la tonalidad se comprueba en los niveles con bucle
      if (t.levels.indexOf(k) < P.TRIUMPH_LEVEL) assert.ok(P.sameKeySet(g.confidence.measuredKey, g.key), `${k}: la tonalidad medida (${JSON.stringify(g.confidence.measuredKey)}) es la declarada`);
    }
    for (const s of t.scenes) {
      assert.ok(!scenes.has(s), `${s} solo en un tema`);
      scenes.add(s);
      assert.ok(readFileSync(new URL(`../assets/scenes/${s}/scene.json`, import.meta.url)), `${s} existe`);
    }
  }
  for (const st of Object.values(MAP.states)) assert.ok(P.intensityOf(st) >= 0 && P.intensityOf(st) <= 3);
});

test('A8.3 levelTrack: el nivel pedido o el más cercano por debajo; themeForScene / levelOfTrack', () => {
  const t = { levels: ['x-n0', 'x-n1', null, 'x-n3'], scenes: ['outside'] };
  assert.deepEqual(P.levelTrack(t, 1), { track: 'x-n1', level: 1 });
  assert.deepEqual(P.levelTrack(t, 2), { track: 'x-n1', level: 1 }, 'falta el 2: el 1');
  assert.deepEqual(P.levelTrack(t, 3, (k) => k !== 'x-n3'), { track: 'x-n1', level: 1 }, 'triunfo sin descargar en tracks: el de debajo');
  assert.deepEqual(P.levelTrack({ levels: [null, 'y-n1'], scenes: [] }, 0), { track: 'y-n1', level: 1 }, 'sin nada por debajo: el primero por encima');
  assert.equal(P.levelTrack({ levels: [null, null], scenes: [] }, 0), null);
  const themes = { x: t };
  assert.equal(P.themeForScene(themes, 'outside'), 'x');
  assert.equal(P.themeForScene(themes, 'lobby'), null);
  assert.equal(P.themeForScene(undefined, 'outside'), null);
  assert.deepEqual(P.levelOfTrack(themes, 'x-n3'), { theme: 'x', level: 3 });
  assert.equal(P.levelOfTrack(themes, 'retro-adventure'), null);
  assert.equal(P.intensityOf(undefined), 0);
  assert.equal(P.intensityOf({ intensity: 7 }), 3);
});

test('A8.3 cambio de nivel: sale en compás (≤ maxWaitBars), entra en compás entero conservando la frase, sin puente', () => {
  for (const [id, t] of THEMES) {
    const present = t.levels.map((k, i) => (k ? { k, i } : null)).filter(Boolean);
    for (const a of present) {
      const ga = MAP.tracks[a.k];
      for (const b of present) {
        if (a === b) continue;
        const gb = MAP.tracks[b.k];
        for (let pos = ga.loopStartSec; pos < ga.loopEndSec; pos += ga.barSec / 7.3) {
          const ex = P.nextExit(ga, pos, OPTS);
          assert.ok(onBar(ga, pos + ex.waitSec), `${id} ${a.k}→${b.k}: salida en compás`);
          assert.ok(ex.waitSec <= OPTS.maxWaitBars * ga.barSec + OPTS.minLeadSec + 1e-6, `${id}: espera ≤ ${OPTS.maxWaitBars} compases`);
          const entry = P.levelEntryBar(ex.absBar, gb.bars, b.i, 4);
          assert.ok(Number.isInteger(entry) && entry >= 0 && entry < gb.bars, `${id}: entra en un compás entero de ${b.k}`);
          if (b.i === P.TRIUMPH_LEVEL) assert.equal(entry, 0, 'el triunfo entra por el principio');
          else if (4 <= gb.bars) assert.equal(entry, ((ex.absBar % 4) + 4) % 4, 'misma posición en la frase de 4');
          assert.ok(onBar(gb, P.barStartSec(gb, entry)));
        }
        const br = P.chooseBridge(gb.key, gb.key, 'state');
        assert.equal(br.type, 'none', `${id}: mismo tema = sin puente`);
      }
    }
  }
});

test('A8.3 estados → intensidad: duelo y peligro suben, conversación y explorar bajan, puzle = triunfo', () => {
  const ctx = (o) => ({ scene: 'outside', dialogue: false, dialogueTree: null, flags: {}, inventory: [], goalsLeft: null, transient: null, ...o });
  const lv = (o) => P.intensityOf(MAP.states[P.resolveState(MAP.rules, ctx(o)).state]);
  assert.equal(lv({}), 0, 'explorar = calma');
  assert.equal(lv({ dialogue: true, dialogueTree: 'bartender_intro' }), 0, 'conversación normal = calma');
  assert.equal(lv({ scene: 'recovery_pool', dialogue: true, dialogueTree: 'chad_fud' }), 2, 'duelo de FUD con Chad = tensión');
  assert.equal(lv({ scene: 'treatment_room', dialogue: true, dialogueTree: 'pzbot_final' }), 2, 'PZ-BOT = tensión');
  assert.equal(lv({ scene: 'server_room' }), 2, 'peligro: el bot activo');
  assert.equal(lv({ scene: 'basement' }), 1, 'sótano = activo');
  assert.equal(lv({ goalsLeft: 1 }), 1, 'último paso del capítulo = activo');
  assert.equal(lv({ goalsLeft: 1, dialogue: true }), 0, 'leer/hablar baja');
  assert.equal(lv({ transient: 'solved', scene: 'server_room' }), 3, 'puzle resuelto = triunfo');
  assert.equal(P.ruleMatches({ dialogueTree: 'chad_fud' }, ctx({ dialogue: false, dialogueTree: 'chad_fud' })), false, 'solo con el diálogo abierto');
});

test('A8.3 tempoCompatible', () => {
  assert.ok(P.tempoCompatible(90, 90.5));
  assert.ok(P.tempoCompatible(132, 66));
  assert.ok(!P.tempoCompatible(90, 100));
});

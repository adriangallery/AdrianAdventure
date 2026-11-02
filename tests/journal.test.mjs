// A2.9 + A2.9a (plan SCUMM): lógica pura del diario (src/systems/Journal.ts): condiciones, objetivos con tic, notas,
// lo nuevo sin ver, la escalera de pistas de Anon (puzle abierto más avanzado, niveles 1 → 2 → 3, sin pistas de un puzle
// resuelto, relleno sin puzle abierto) y el saneado del progreso. Además, los ficheros reales de assets/journal.
// CI (Node 22): node --experimental-strip-types --test tests/journal.test.mjs (va en `npm run test:engine`)
// JOURNAL_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const J = await import(process.env.JOURNAL_PATH ?? '../src/systems/Journal.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const world = (flags = {}, items = []) => ({ flags, items });

const CH = J.parseChapters([
  {
    chapter: 2,
    goals: [{ id: 'g2_a', text: 'Second chapter goal.', doneWhen: 'two' }],
    notes: [{ id: 'n2_a', text: 'Later note.', shownWhen: 'two' }],
    puzzles: [{ id: 'p2_a', doneWhen: 'two', hints: ['a', 'b', 'c'] }],
    anonIdle: [],
  },
  {
    chapter: 1,
    goals: [
      { id: 'g1_code', text: 'Find the code.', doneWhen: 'found_code' },
      { id: 'g1_in', text: 'Get in.', doneWhen: ['door_open', 'item:key'] },
    ],
    notes: [
      { id: 'n1_code', text: 'The code is 7314.', shownWhen: 'found_code' },
      { id: 'n1_secret', text: 'Only by journalNote.' },
      { id: 'n1_nokey', text: 'No key yet.', shownWhen: ['found_code', '!item:key'] },
    ],
    puzzles: [
      { id: 'p1_code', doneWhen: 'found_code', hints: ['dir code', 'obj code', 'sol code'] },
      { id: 'p1_door', openWhen: 'found_code', doneWhen: 'door_open', hints: ['dir door', 'obj door', 'sol door'] },
    ],
    anonIdle: ['idle one', 'idle two'],
  },
]);

test('parseChapters ordena por capítulo y descarta lo mal formado con aviso', () => {
  assert.deepEqual(CH.map((c) => c.chapter), [1, 2]);
  const warns = [];
  const [ch] = J.parseChapters([{
    chapter: 3,
    goals: [{ id: 'ok', text: 'ok', doneWhen: 'x' }, { id: 'sin_cond', text: 'x' }, { text: 'sin id', doneWhen: 'x' }],
    notes: [{ id: 'n', text: 't' }, { id: 'mala', text: 't', shownWhen: 3 }],
    puzzles: [{ id: 'dos', doneWhen: 'x', hints: ['a', 'b'] }, { id: 'tres', doneWhen: 'x', hints: ['a', 'b', 'c'] }],
    anonIdle: ['hola', '', 7],
  }, { goals: [] }], (m) => warns.push(m));
  assert.deepEqual(ch.goals.map((g) => g.id), ['ok']);
  assert.deepEqual(ch.notes.map((n) => n.id), ['n']);
  assert.deepEqual(ch.puzzles.map((p) => p.id), ['tres']);
  assert.deepEqual(ch.anonIdle, ['hola']);
  assert.equal(warns.length, 5, warns.join('\n'));
});

test('condiciones: la gramática de when de A2.6a (flag, !flag, item:, !item:, flag:, listas = todas)', () => {
  const w = world({ a: true, b: false }, ['key']);
  assert.equal(J.conditionsMet(undefined, w), true);
  assert.equal(J.conditionsMet([], w), true);
  assert.equal(J.conditionsMet('a', w), true);
  assert.equal(J.conditionsMet('flag:a', w), true);
  assert.equal(J.conditionsMet('b', w), false);
  assert.equal(J.conditionsMet('!b', w), true);
  assert.equal(J.conditionsMet('nadie', w), false);
  assert.equal(J.conditionsMet('item:key', w), true);
  assert.equal(J.conditionsMet('!item:key', w), false);
  assert.equal(J.conditionsMet(['a', 'item:key'], w), true);
  assert.equal(J.conditionsMet(['a', '!item:key'], w), false);
  assert.equal(J.conditionsMet('mal escrita', w), false, 'una condición inválida no se cumple');
  assert.equal(J.conditionsMet([3], w), false);
});

test('objetivos: tic cuando se cumple doneWhen', () => {
  const ch = J.chapterData(CH, 1);
  assert.deepEqual(J.goalsView(ch, world()).map((g) => g.done), [false, false]);
  assert.deepEqual(J.goalsView(ch, world({ found_code: true })).map((g) => g.done), [true, false]);
  assert.deepEqual(J.goalsView(ch, world({ found_code: true, door_open: true })).map((g) => g.done), [true, false], 'falta el objeto');
  assert.deepEqual(J.goalsView(ch, world({ found_code: true, door_open: true }, ['key'])).map((g) => g.done), [true, true]);
  assert.deepEqual(J.goalsView(null, world()), []);
});

test('notas: se apuntan solas al cumplirse shownWhen (no las de capítulos posteriores) y se quedan aunque deje de cumplirse', () => {
  let p = J.emptyProgress();
  assert.deepEqual(J.pendingNotes(CH, 1, world(), p), []);
  const w = world({ found_code: true, two: true });
  assert.deepEqual(J.pendingNotes(CH, 1, w, p), ['n1_code', 'n1_nokey'], 'la del capítulo 2 no, aunque su flag esté');
  p = J.syncNotes(CH, 1, w, p);
  assert.deepEqual(p.notes, ['n1_code', 'n1_nokey']);
  assert.equal(J.syncNotes(CH, 1, w, p), p, 'sin nada nuevo devuelve el mismo objeto');
  // Con la llave, n1_nokey ya no se cumple, pero se queda apuntada
  const later = J.syncNotes(CH, 2, world({ found_code: true, two: true }, ['key']), p);
  assert.deepEqual(later.notes, ['n1_code', 'n1_nokey', 'n2_a']);
});

test('journalNote: solo notas que existen, sin repetir', () => {
  const p0 = J.emptyProgress();
  const a = J.addNote(CH, p0, 'n1_secret');
  assert.equal(a.added, true);
  assert.deepEqual(a.progress.notes, ['n1_secret']);
  assert.deepEqual(p0.notes, [], 'no muta el progreso de entrada');
  assert.equal(J.addNote(CH, a.progress, 'n1_secret').added, false);
  assert.equal(J.addNote(CH, p0, 'no_existe').added, false);
  assert.equal(J.findNote(CH, 'n2_a').chapter, 2);
});

test('lo nuevo sin ver: objetivos cumplidos y notas; al abrir el diario pasa a visto', () => {
  const w = world({ found_code: true });
  let p = J.syncNotes(CH, 1, w, J.emptyProgress());
  assert.deepEqual(J.unseenIds(CH, 1, w, p), ['g1_code', 'n1_code', 'n1_nokey']);
  p = J.markSeen(CH, 1, w, p);
  assert.deepEqual(J.unseenIds(CH, 1, w, p), []);
  assert.equal(J.markSeen(CH, 1, w, p), p);
  const w2 = world({ found_code: true, door_open: true }, ['key']);
  assert.deepEqual(J.unseenIds(CH, 1, w2, p), ['g1_in']);
});

test('Anon: puzle abierto más avanzado (el último de la lista abierto y sin resolver)', () => {
  const ch = J.chapterData(CH, 1);
  assert.equal(J.openPuzzle(ch, world()).id, 'p1_code');
  assert.equal(J.openPuzzle(ch, world({ found_code: true })).id, 'p1_door', 'p1_code resuelto, p1_door abierto');
  assert.equal(J.openPuzzle(ch, world({ found_code: true, door_open: true })), null);
  assert.equal(J.openPuzzle(null, world()), null);
});

test('Anon: escalera 1 → 2 → 3 (y se queda en 3) por puzle; un puzle resuelto no vuelve a dar pistas', () => {
  let p = J.emptyProgress();
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const r = J.callAnon(CH, 1, world(), p);
    p = r.progress;
    steps.push([r.call.puzzle, r.call.level, r.call.text]);
  }
  assert.deepEqual(steps, [
    ['p1_code', 1, 'dir code'], ['p1_code', 2, 'obj code'], ['p1_code', 3, 'sol code'], ['p1_code', 3, 'sol code'],
  ]);
  assert.equal(p.calls, 4);
  assert.deepEqual(p.hints, { p1_code: 3 });
  const r = J.callAnon(CH, 1, world({ found_code: true }), p);
  assert.deepEqual([r.call.puzzle, r.call.level, r.call.text], ['p1_door', 1, 'dir door']);
  assert.deepEqual(r.progress.hints, { p1_code: 3, p1_door: 1 });
  assert.deepEqual(J.openPuzzleLevel(CH, 1, world({ found_code: true }), r.progress), { puzzle: 'p1_door', level: 1 });
});

test('Anon: sin puzle abierto, frases de relleno que rotan; sin anonIdle, ANON_FALLBACK', () => {
  const w = world({ found_code: true, door_open: true });
  let p = J.emptyProgress();
  const said = [];
  for (let i = 0; i < 3; i++) {
    const r = J.callAnon(CH, 1, w, p);
    assert.equal(r.call.puzzle, null);
    assert.equal(r.call.level, 0);
    said.push(r.call.text);
    p = r.progress;
  }
  assert.deepEqual(said, ['idle one', 'idle two', 'idle one']);
  assert.deepEqual(p.hints, {});
  assert.equal(J.callAnon(CH, 2, world({ two: true }), J.emptyProgress()).call.text, J.ANON_FALLBACK);
  assert.equal(J.callAnon(CH, 9, world(), J.emptyProgress()).call.text, J.ANON_FALLBACK, 'capítulo sin datos');
});

test('progressFrom: sanea lo que llegue de una partida', () => {
  assert.deepEqual(J.progressFrom(undefined), J.emptyProgress());
  assert.deepEqual(J.progressFrom([1, 2]), J.emptyProgress());
  assert.deepEqual(
    J.progressFrom({ notes: ['a', 3, 'a', 'b'], seen: 'x', hints: { p: 2, q: 9, r: 0, s: 'x', t: 1.7 }, calls: -1 }),
    { notes: ['a', 'b'], seen: [], hints: { p: 2, q: 3, t: 1 }, calls: 0 },
  );
});

test('ficheros reales de assets/journal: cada capítulo de ChapterManager, 3-4 objetivos, 3 pistas por puzle, ids únicos', () => {
  const dir = path.join(ROOT, 'assets', 'journal');
  const raws = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const warns = [];
  const chapters = J.parseChapters(raws, (m) => warns.push(m));
  assert.deepEqual(warns, []);
  assert.deepEqual(chapters.map((c) => c.chapter), [1, 2, 3, 4, 5]);
  const ids = { goals: new Set(), notes: new Set(), puzzles: new Set() };
  for (const ch of chapters) {
    assert.ok(ch.goals.length >= 3 && ch.goals.length <= 4, `capítulo ${ch.chapter}: ${ch.goals.length} objetivos`);
    assert.ok(ch.puzzles.length >= 2, `capítulo ${ch.chapter}: al menos dos puzles con escalera`);
    for (const kind of Object.keys(ids)) {
      for (const e of ch[kind]) {
        assert.ok(!ids[kind].has(e.id), `id repetido ${e.id}`);
        ids[kind].add(e.id);
      }
    }
    for (const p of ch.puzzles) {
      assert.equal(p.hints.length, 3);
      for (const h of p.hints) assert.ok(h.split(/\s+/).length <= 20, `${p.id}: pista de más de 20 palabras («${h}»)`);
    }
    // Al empezar el capítulo hay algún puzle abierto (el primero no tiene openWhen)
    assert.equal(J.conditionList(ch.puzzles[0].openWhen).length, 0, `capítulo ${ch.chapter}: el primer puzle abre solo`);
  }
});

test('ruta crítica de hoy: Anon guía el capítulo 1 como comprueba qa/walkthrough.json', () => {
  const dir = path.join(ROOT, 'assets', 'journal');
  const chapters = J.parseChapters(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
  let p = J.emptyProgress();
  let r = J.callAnon(chapters, 1, world(), p);
  assert.deepEqual([r.call.puzzle, r.call.level], ['p1_code', 1]);
  r = J.callAnon(chapters, 1, world(), r.progress);
  assert.deepEqual([r.call.puzzle, r.call.level], ['p1_code', 2]);
  assert.match(r.call.text, /porch light/i);
  const afterNote = world({ found_code_note: true, has_code: true }, ['code_note']);
  assert.ok(J.goalsView(J.chapterData(chapters, 1), afterNote).find((g) => g.id === 'g1_code').done);
  assert.deepEqual(J.pendingNotes(chapters, 1, afterNote, J.emptyProgress()), ['n1_code']);
  r = J.callAnon(chapters, 1, afterNote, r.progress);
  assert.deepEqual([r.call.puzzle, r.call.level], ['p1_door', 1]);
  // Capítulo 3 empieza en la azotea (chapter_2_complete): la primera pista es la escotilla
  p = J.emptyProgress();
  assert.equal(J.callAnon(chapters, 3, world({ chapter_2_complete: true, vane_turned: true }), p).call.puzzle, 'p3_hatch');
  // Fin del juego: relleno
  const end = world({ chapter_4_complete: true, chapter_5_intro_shown: true, monitor_revealed: true, patient_zero_revealed: true, game_complete: true });
  assert.equal(J.callAnon(chapters, 5, end, p).call.puzzle, null);
});

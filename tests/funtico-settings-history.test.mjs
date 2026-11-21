// F1.5 (plan FUNTICO_ADVENTURE): ajustes (volúmenes, idioma, evento de cambio) e historial local de carreras de Triage.
// node --experimental-strip-types --test tests/funtico-settings-history.test.mjs (en `npm run test:funtico`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../src/funtico/settings.ts');
const H = await import('../src/funtico/history.ts');

function memStore() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test('settings: valores por defecto y saneado', () => {
  assert.deepEqual(S.parseSettings(null), S.DEFAULTS);
  assert.deepEqual(S.parseSettings('{basura'), S.DEFAULTS);
  const s = S.parseSettings(JSON.stringify({ sfx: 7, music: -1, lang: 'ja' }));
  assert.equal(s.sfx, 1);
  assert.equal(s.music, 0);
  assert.equal(s.lang, 'en', 'ES/JA aún no están activos');
});

test('settings: set persiste con prefijo, avisa a los oyentes y se relee', () => {
  const st = memStore();
  S.useSettingsStore(st);
  const seen = [];
  const off = S.onSettingsChange((x) => seen.push(x));
  S.setSfxVolume(0.35);
  S.setMusicVolume(0.2);
  off();
  S.setMusicVolume(0.9);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].music, 0.2);
  assert.ok(S.SETTINGS_KEY.startsWith('adrian_adventure_funtico_'));
  const raw = JSON.parse(st.m.get(S.SETTINGS_KEY));
  assert.equal(raw.sfx, 0.35);
  assert.equal(raw.music, 0.9);
  S.useSettingsStore(st);
  assert.equal(S.getSfxVolume(), 0.35);
  assert.equal(S.getMusicVolume(), 0.9);
  S.useSettingsStore(null);
});

test('historial: guarda la más reciente primero, por usuario, con tope', () => {
  const st = memStore();
  H.addTriageRun(st, 7, { score: 100, at: 1000, completed: true, hits: 5, misses: 0 });
  H.addTriageRun(st, 7, { score: 300, at: 3000, completed: false, hits: 3, misses: 2 });
  H.addTriageRun(st, 8, { score: 999, at: 2000, completed: true, hits: 8, misses: 0 });
  const l = H.loadTriageHistory(st, 7);
  assert.deepEqual(l.map((r) => r.score), [300, 100]);
  assert.equal(H.bestScore(l), 300);
  assert.equal(H.bestScore([]), null);
  assert.ok(H.historyKey(7).startsWith('adrian_adventure_funtico_'));
  for (let i = 0; i < H.MAX_RUNS + 10; i++) H.addTriageRun(st, 9, { score: i, at: 10_000 + i, completed: true, hits: 1, misses: 0 });
  const many = H.loadTriageHistory(st, 9);
  assert.equal(many.length, H.MAX_RUNS);
  assert.equal(many[0].score, H.MAX_RUNS + 9);
});

test('historial: datos rotos no rompen', () => {
  const st = memStore();
  st.setItem(H.historyKey('x'), '{no es json');
  assert.deepEqual(H.loadTriageHistory(st, 'x'), []);
  st.setItem(H.historyKey('x'), JSON.stringify([{ score: 'a' }, null, { score: 5, at: 1 }]));
  assert.deepEqual(H.loadTriageHistory(st, 'x').map((r) => r.score), [5]);
  assert.match(H.shortDate(Date.UTC(2026, 10, 21, 12, 0)), /^\d\d\/\d\d\/26 \d\d:\d\d$/);
});

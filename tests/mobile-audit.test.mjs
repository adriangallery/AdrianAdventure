// A5.2: lógica pura de la QA móvil (umbrales de fuente y de zona táctil, excepciones, capítulo 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THRESHOLDS, VIEWPORTS, auditSnapshot, chapterSteps, findException, isWordText, offscreen, summarizeRow,
} from '../scripts/lib/mobile-audit.mjs';

test('umbrales del plan: fuente ≥ 11 px, zona táctil ≥ 40 px (objetivo 44)', () => {
  assert.equal(THRESHOLDS.minFontPx, 11);
  assert.equal(THRESHOLDS.minTouchPx, 40);
  assert.equal(THRESHOLDS.goalTouchPx, 44);
  assert.deepEqual([VIEWPORTS.portrait.width, VIEWPORTS.portrait.height], [390, 844]);
  assert.deepEqual([VIEWPORTS.landscape.width, VIEWPORTS.landscape.height], [844, 390]);
  assert.equal(VIEWPORTS.portrait.deviceScaleFactor, 3);
  assert.ok(VIEWPORTS.landscape.hasTouch && VIEWPORTS.landscape.isMobile);
});

test('los iconos (flechas, emojis, ×) no cuentan como texto', () => {
  assert.equal(isWordText('▲'), false);
  assert.equal(isWordText('🎒'), false);
  assert.equal(isWordText('×'), false);
  assert.equal(isWordText('Look at'), true);
  assert.equal(isWordText('12'), true);
});

test('auditSnapshot separa fallos de fuente, de zona táctil y por debajo del objetivo', () => {
  const a = auditSnapshot({
    texts: [{ id: 'ui:verb', text: 'Open', px: 10 }, { id: 'ui:line', text: 'Walk to', px: 12 }, { id: 'ui:arrow', text: '▲', px: 6 }],
    targets: [{ id: 'ui:a', w: 30, h: 50 }, { id: 'ui:b', w: 42, h: 60 }, { id: 'ui:c', w: 44, h: 44 }],
  }, { orientation: 'portrait' });
  assert.deepEqual(a.fontFails.map((f) => f.id), ['ui:verb']);
  assert.deepEqual(a.touchFails.map((f) => f.id), ['ui:a']);
  assert.deepEqual(a.touchBelowGoal.map((f) => f.id), ['ui:b']);
  assert.equal(a.minFont, 10);
  assert.equal(a.minTouch, 30);
  assert.deepEqual(a.counts, { texts: 2, targets: 3 });
});

test('las excepciones necesitan motivo y respetan orientación y mínimo', () => {
  const ex = [
    { kind: 'touch', match: /verb/, orientation: 'landscape', min: 26, reason: 'rejilla SCUMM' },
    { kind: 'touch', match: /sin-motivo/ },
  ];
  assert.ok(findException('touch', { id: 'ui:verb:Open', w: 90, h: 28 }, 'landscape', ex));
  assert.equal(findException('touch', { id: 'ui:verb:Open', w: 90, h: 28 }, 'portrait', ex), null);
  assert.equal(findException('touch', { id: 'ui:verb:Open', w: 90, h: 20 }, 'landscape', ex), null);
  assert.equal(findException('touch', { id: 'ui:sin-motivo', w: 10, h: 10 }, 'landscape', ex), null);
  const a = auditSnapshot({ targets: [{ id: 'ui:verb:Open', w: 90, h: 28 }] }, { orientation: 'landscape', exceptions: ex });
  assert.equal(a.touchFails.length, 0);
  assert.equal(a.excepted.length, 1);
  assert.equal(a.excepted[0].reason, 'rejilla SCUMM');
});

test('offscreen detecta lo que se sale del viewport', () => {
  const vp = { width: 844, height: 390 };
  const out = offscreen([{ id: 'ok', x: 0, y: 0, w: 844, h: 390 }, { id: 'abajo', x: 10, y: 380, w: 20, h: 30 }], vp);
  assert.deepEqual(out.map((b) => b.id), ['abajo']);
});

test('summarizeRow marca la fila en rojo si hay fallos o cosas cortadas', () => {
  const clean = auditSnapshot({ texts: [{ id: 't', text: 'Hola', px: 12 }] });
  assert.equal(summarizeRow('outside', 'portrait', clean).ok, true);
  assert.equal(summarizeRow('outside', 'portrait', clean, { offscreen: [{ id: 'x' }] }).ok, false);
});

test('chapterSteps corta la ruta crítica al entrar en el lobby y quita las esperas largas', () => {
  const route = JSON.parse(readFileSync(new URL('../qa/walkthrough.json', import.meta.url), 'utf8')).routes
    .find((r) => r.id === 'ruta-critica');
  const steps = chapterSteps(route, 'lobby');
  assert.equal(steps[0].do, 'newGame');
  assert.equal(steps.at(-1).expect.scene, 'lobby');
  assert.ok(steps.every((s) => s.holdTextMs === undefined));
  assert.throws(() => chapterSteps({ id: 'x', steps: [{ do: 'newGame' }] }, 'lobby'));
});

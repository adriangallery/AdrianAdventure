// A9.3 (plan SCUMM): la franja de logro espera a que no haya frase ni diálogo y sale sobre el panel de verbos, sin
// pisar los botones de arriba ni el panel; el título de escena no se corta (src/ui/achievementLayout.ts). Lógica pura.
// CI (Node 22): node --experimental-strip-types --test tests/achievement-layout.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const A = await import(process.env.ACHIEVEMENT_LAYOUT_PATH ?? '../src/ui/achievementLayout.ts');
const { achievementDecision, achievementRect, achievementStripHeight, rectsOverlap, sceneTitlePlacement, isScreenBusy, ACH_TOP_INSET, MAX_WAIT_MS } = A;

const VIEWS = [
  { id: '844x390', width: 844, height: 390, panelH: 120 },
  { id: '390x844', width: 390, height: 844, panelH: 152 },
  { id: '1280x720', width: 1280, height: 720, panelH: 180 },
  { id: '844x390 plegado', width: 844, height: 390, panelH: 40 },
];

test('espera mientras haya frase, diálogo, elección, cinemática o cambio de escena', () => {
  for (const k of ['speech', 'dialogue', 'choices', 'cinematic', 'transition']) {
    assert.equal(isScreenBusy({ [k]: true }), true, k);
    assert.equal(achievementDecision({ [k]: true }, 0), 'wait', k);
  }
  assert.equal(achievementDecision({}, 0), 'show');
  assert.equal(achievementDecision({ speech: false, dialogue: false }, 0), 'show');
});

test('si la pantalla no se libera, sale igual al agotar la espera', () => {
  assert.equal(achievementDecision({ speech: true }, MAX_WAIT_MS - 1), 'wait');
  assert.equal(achievementDecision({ speech: true }, MAX_WAIT_MS), 'show');
  assert.equal(achievementDecision({ speech: true }, 50, 40), 'show');
});

test('la franja no pisa los botones de arriba ni el panel de verbos, en los tres tamaños', () => {
  for (const v of VIEWS) {
    const stripH = achievementStripHeight(11);
    const r = achievementRect(v.width, v.height, v.panelH, stripH);
    const topBar = { x: 0, y: 0, w: v.width, h: ACH_TOP_INSET };
    const panel = { x: 0, y: v.height - v.panelH, w: v.width, h: v.panelH };
    assert.equal(rectsOverlap(r, topBar), false, `${v.id}: pisa los botones de arriba`);
    assert.equal(rectsOverlap(r, panel), false, `${v.id}: pisa el panel de verbos`);
    assert.equal(r.w, v.width);
    assert.equal(r.h, stripH);
    assert.ok(r.y + r.h <= v.height - v.panelH, `${v.id}: apoyada sobre el panel`);
  }
});

test('escena muy baja: se pega bajo los botones de arriba, nunca encima', () => {
  const r = achievementRect(800, 120, 40, 50);
  assert.ok(r.y >= ACH_TOP_INSET);
});

test('título de escena: centrado en la pantalla, bajo los botones y envuelto al ancho', () => {
  const p = sceneTitlePlacement(390, 4);
  assert.equal(p.x, 195);
  assert.ok(p.y >= ACH_TOP_INSET);
  assert.ok(p.wrapW <= 390 - 2 * 8);
  assert.equal(sceneTitlePlacement(1280, 100).y, 100);
});

// A9.9 y A9.11 (plan SCUMM): comprobaciones sobre los scene.json (puras, sin navegador ni .ts).
//  - A9.9: USE en el sillón de treatment_room quita el disfraz de mono (`ape_costume_worn` a false) ANTES de sentar a
//    Dex (`patient_seated`): la imagen sentada (dex2d_sit_0) no tiene versión de mono y Dex no puede desaparecer.
//  - A9.11: la cinemática de entrada de mountain lleva a Dex, antes de que hable, a un punto andable desde el que su
//    caja (≈ 3 % a cada lado y 31 % de alto) no toca ninguna franja de `foregroundLayers` que se pinte delante de él
//    (regla de franjas de A2.17: la franja k empieza en bounds.y + k·bandStep y su base es baseY + k·bandStep).
// node --test tests/a9-visual.test.mjs (va en `npm run test:engine`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scene = (id) => JSON.parse(readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
const DEX_HALF_W = 3; // % del ancho del fondo (mitad de la caja de Dex, con margen)
const DEX_H = 31; // % del alto del fondo (103 px × pixelScale 3,4 sobre 1152, con margen)

test('A9.9: el sillón quita el disfraz de mono antes de sentar a Dex', () => {
  const chair = scene('treatment_room').regions.hotspots.find((h) => h.id === 'hs_chair');
  const gate = chair.scripts.USE.find((op) => op.op === 'ifFlag' && op.flag === 'patient_seated');
  assert.ok(gate, 'USE de hs_chair empieza con ifFlag patient_seated');
  const ops = gate.else;
  const off = ops.findIndex((op) => op.op === 'setFlag' && op.flag === 'ape_costume_worn' && op.value === false);
  const sit = ops.findIndex((op) => op.op === 'setFlag' && op.flag === 'patient_seated' && op.value === true);
  assert.ok(sit >= 0, 'se sienta');
  assert.ok(off >= 0 && off < sit, 'quita el disfraz antes de sentarse');
  const seat = scene('treatment_room').player.seated;
  assert.equal(seat.flag, 'patient_seated');
});

function introThen(sc) {
  const gate = sc.onEnter.find((op) => op.op === 'ifFlag' && op.flag === 'chapter_4_intro_shown');
  return gate.else.find((op) => op.op === 'ifFlag' && op.flag === 'chapter_3_complete').then;
}

function frontBands(layer, feetY) {
  const out = [];
  const b = layer.bounds;
  const step = layer.bandStep > 0 ? layer.bandStep : b.h;
  for (let k = 0, top = b.y; top < b.y + b.h - 1e-6; k++, top += step) {
    const base = layer.bandStep > 0 ? layer.baseY + k * layer.bandStep : layer.baseY;
    if (base > feetY) out.push({ x0: b.x, x1: b.x + b.w, y0: top, y1: Math.min(top + step, b.y + b.h), id: `${layer.id}#${k}` });
  }
  return out;
}

const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

test('A9.11: en la entrada de mountain Dex habla fuera de la maleza de primer plano', () => {
  const sc = scene('mountain');
  const ops = introThen(sc);
  const firstDex = ops.findIndex((op) => op.op === 'say' && !op.speaker);
  assert.ok(firstDex > 0, 'Dex habla en la cinemática');
  // el último actorMove del jugador antes de que hable, y que espera (sin wait: false)
  const moves = ops.slice(0, firstDex).map((op, i) => ({ op, i })).filter(({ op }) => op.op === 'actorMove' && op.actor === 'player');
  assert.ok(moves.length, 'la cinemática mueve a Dex antes de que hable');
  const last = moves[moves.length - 1].op;
  assert.notEqual(last.wait, false, 'el último actorMove antes de hablar espera a que llegue');
  const p = { x: last.x, y: last.y };
  assert.ok(sc.walkableAreas.some((r) => inside(p, r)), `${p.x},${p.y} es andable`);
  assert.ok(!(sc.blockedAreas ?? []).some((r) => inside(p, r)), `${p.x},${p.y} no está bloqueado`);
  const box = { x0: p.x - DEX_HALF_W, x1: p.x + DEX_HALF_W, y0: p.y - DEX_H, y1: p.y };
  for (const l of sc.foregroundLayers) {
    for (const r of frontBands(l, p.y)) {
      const hit = Math.min(box.x1, r.x1) > Math.max(box.x0, r.x0) && Math.min(box.y1, r.y1) > Math.max(box.y0, r.y0);
      assert.ok(!hit, `la franja ${r.id} tapa a Dex en ${p.x},${p.y}`);
    }
  }
  // y la cámara vuelve a Dex después de moverlo
  const pan = ops.findIndex((op, i) => i > moves[moves.length - 1].i && op.op === 'cameraPan' && op.actor === 'player');
  assert.ok(pan > 0 && pan < firstDex, 'la cámara vuelve a Dex antes de que hable');
});

test('A9.11: el punto de partida de outside (96,8/91,5) sí cae en la maleza (por eso hace falta moverlo)', () => {
  const sc = scene('mountain');
  const p = { x: 96.8, y: 91.5 };
  const box = { x0: p.x - DEX_HALF_W, x1: p.x + DEX_HALF_W, y0: p.y - DEX_H, y1: p.y };
  const hits = sc.foregroundLayers.flatMap((l) => frontBands(l, p.y)).filter((r) => Math.min(box.x1, r.x1) > Math.max(box.x0, r.x0) && Math.min(box.y1, r.y1) > Math.max(box.y0, r.y0));
  assert.ok(hits.length > 0);
});

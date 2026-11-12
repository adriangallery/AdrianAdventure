// Demo de A1.14 (plan SCUMM): «se queda enganchado y cuesta que camine». Con toques REALES (touchscreen de Chrome,
// no la API de QA que llama directo a walk) y el verbo Walk, en 844x390 (móvil apaisado, GIF) y 390x844 (vertical,
// capturas fijas):
//   outside: de junto al pilar del porche (la captura del 12-nov) al carport, a la acera (hs_path), al buzón, a los
//            arbustos y de vuelta a la puerta; lobby: suelo (hs_floor_tiles) y Penny.
// Cada toque tiene que hacer ANDAR a Dex (walkTarget con verbo WALK, sin frase) y llegar cerca del destino antes de
// TIMEOUT_MS; Penny, acercarse y abrir su charla. En vertical la cámara sigue a Dex: si el destino queda fuera de
// pantalla se toca primero el suelo en el borde, como haría el jugador.
// «problemas: ninguno» si todos llegan. Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a1-14-walk
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const LANDSCAPE = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const PORTRAIT = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const TIMEOUT_MS = 20000;

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: LANDSCAPE });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

/** Toques de outside: punto tocado (en % del fondo) y x a la que tiene que llegar Dex (±tol) */
const OUTSIDE = [
  { label: 'carport', tap: { x: 77, y: 72 }, x: 77, tol: 3 },
  { label: 'acera (hs_path)', tap: { x: 48, y: 92 }, x: 48, tol: 2 },
  { label: 'buzón (walkTo 57,92)', tap: { x: 60.5, y: 72 }, x: 57, tol: 2 },
  { label: 'arbustos', tap: { x: 18, y: 85 }, x: 18, tol: 3 },
  { label: 'puerta', tap: { x: 34, y: 70 }, x: 34, tol: 3 },
];

const st = () => page.evaluate(() => {
  const s = window.__qa.state();
  return { player: s.player, walkTarget: s.walkTarget, speech: s.speech?.text ?? null, verb: s.verb, scene: s.scene };
});

/** Punto de pantalla (CSS) de un punto del fondo en % y si cae dentro de la ventana */
const screenOf = (pt) => page.evaluate((pt) => {
  const gs = window.__game.scene.getScene('GameScene');
  const s = gs.coordSystem.pctToScreen(pt.x, pt.y);
  const cam = gs.cameras.main;
  const r = window.__game.canvas.getBoundingClientRect();
  const k = r.width / gs.scale.width;
  const x = r.left + (s.x - cam.scrollX) * k;
  const y = r.top + (s.y - cam.scrollY) * k;
  return { x, y, inside: x >= 12 && x <= innerWidth - 12 && y >= 40 && y <= innerHeight - 12 };
}, pt);

async function waitStill(film) {
  const t0 = Date.now();
  await demo.sleep(250);
  while (Date.now() - t0 < TIMEOUT_MS) {
    if (film) await demo.shot(); else await demo.sleep(200);
    const moving = await page.evaluate(() => window.__game.scene.getScene('GameScene').player.isMoving());
    if (!moving) return Date.now() - t0;
  }
  return null;
}

/** Toque real en un punto del fondo; si cae fuera de pantalla (vertical), antes anda tocando el suelo del borde */
async function tapPct(pt, film) {
  for (let i = 0; i < 10; i++) {
    const s = await screenOf(pt);
    if (s.inside) {
      await page.touchscreen.tap(Math.round(s.x), Math.round(s.y));
      return true;
    }
    const vw = await page.evaluate(() => innerWidth);
    const floor = await screenOf({ x: pt.x, y: 95 });
    await page.touchscreen.tap(s.x < 0 ? 24 : vw - 24, Math.round(floor.y));
    await waitStill(film);
  }
  return false;
}

async function freeScene(id, vp) {
  await demo.openScene(id);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  await page.evaluate(() => window.__qa.dismissAll());
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 60] }))) problems.push(`${id}: la escena no quedó libre`);
  // Sin triggers: la demo solo anda (en outside tr_mountain está en el borde izquierdo)
  await page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); gs.player.onStep = null; gs.checkWalkTriggers = () => false; });
}

for (const [tag, vp] of [['844x390', LANDSCAPE], ['390x844', PORTRAIT]]) {
  const film = vp === LANDSCAPE;
  await page.setViewport(vp);
  // outside
  await freeScene('outside', vp);
  await page.evaluate(() => window.__qa.walk(46.5, 90));
  await waitStill(film);
  const pillar = await st();
  console.log(`${tag} outside: junto al pilar en (${pillar.player.x.toFixed(1)}, ${pillar.player.y.toFixed(1)})`);
  await demo.still(`${tag}-outside-pilar`);
  let k = 0;
  for (const t of OUTSIDE) {
    const label = `${tag} outside → ${t.label}`;
    if (!(await tapPct(t.tap, film))) {
      // En vertical la cámara no siempre alcanza a enseñar el punto: se anota y se sigue (el apaisado sí lo exige)
      const where = JSON.stringify(await screenOf(t.tap));
      if (film) problems.push(`${label}: no se pudo tocar (fuera de pantalla: ${where})`);
      else console.log(`${label}: OMITIDO, el punto no entra en pantalla en vertical (${where})`);
      continue;
    }
    await demo.sleep(150);
    const early = await st();
    if (early.speech) problems.push(`${label}: dijo una frase en vez de andar: «${early.speech}»`);
    const ms = await waitStill(film);
    const s = await st();
    const row = { vp: tag, scene: 'outside', target: t.label, ms, player: s.player, walkTarget: s.walkTarget };
    report.push(row);
    if (ms === null) problems.push(`${label}: no llega en ${TIMEOUT_MS} ms`);
    else if (s.walkTarget?.verb !== 'WALK') problems.push(`${label}: walkTarget ${JSON.stringify(s.walkTarget)} (no anda con Walk)`);
    else if (Math.abs(s.player.x - t.x) > t.tol) problems.push(`${label}: acaba en x ${s.player.x.toFixed(1)}, se esperaba ${t.x} ±${t.tol}`);
    console.log(`${label}: ${ms ?? 'atascado'} ms, Dex en (${s.player.x.toFixed(1)}, ${s.player.y.toFixed(1)})`);
    await demo.still(`${tag}-outside-${++k}`);
  }
  // lobby
  await freeScene('lobby', vp);
  {
    const label = `${tag} lobby → suelo`;
    await tapPct({ x: 50, y: 90 }, film);
    await demo.sleep(150);
    const early = await st();
    if (early.speech) problems.push(`${label}: dijo una frase en vez de andar: «${early.speech}»`);
    const ms = await waitStill(film);
    const s = await st();
    report.push({ vp: tag, scene: 'lobby', target: 'suelo', ms, player: s.player });
    if (ms === null || Math.abs(s.player.x - 50) > 3 || Math.abs(s.player.y - 90) > 3) problems.push(`${label}: Dex en ${JSON.stringify(s.player)} tras ${ms} ms`);
    console.log(`${label}: ${ms ?? 'atascado'} ms, Dex en (${s.player.x.toFixed(1)}, ${s.player.y.toFixed(1)})`);
    await demo.still(`${tag}-lobby-suelo`);
  }
  {
    const label = `${tag} lobby → Penny`;
    const p = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      const n = gs.npcs.find((x) => x.npcId === 'npc_receptionist');
      return n ? { x: n.pctPosition.x, y: n.pctPosition.y - 8 } : null;
    });
    if (!p) problems.push(`${label}: no está`);
    else if (!(await tapPct(p, film)) && !film) {
      console.log(`${label}: OMITIDO, Penny no entra en pantalla en vertical`);
    } else {
      const ok = await page.waitForFunction(() => {
        const s = window.__qa.state();
        return s.walkTarget?.target === 'npc_receptionist' && (!!s.speech || !!s.choices || window.__game.registry.get('dialogueActive'));
      }, { timeout: TIMEOUT_MS, polling: 200 }).then(() => true, () => false);
      if (film) for (let i = 0; i < 6; i++) await demo.shot();
      const s = await st();
      report.push({ vp: tag, scene: 'lobby', target: 'Penny', ok, player: s.player, walkTarget: s.walkTarget });
      if (!ok) problems.push(`${label}: no se acercó ni abrió la charla: ${JSON.stringify(s)}`);
      console.log(`${label}: ${ok ? 'charla abierta' : 'NO'}, Dex en (${s.player.x.toFixed(1)}, ${s.player.y.toFixed(1)})`);
      await demo.still(`${tag}-lobby-penny`);
    }
  }
}

await demo.end();
writeFileSync(join(demo.dir, 'walk.json'), JSON.stringify(report, null, 2));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`problemas: ${problems.length ? problems.join('\n') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

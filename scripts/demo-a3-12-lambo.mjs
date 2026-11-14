// Demo de A3.12 (el «lambo» de outside), en escritorio 1280×720 y móvil apaisado 844×390:
//  1) sin pzbot_crashed: ni coche, ni hs_lambo, y la huella del coche se pisa;
//  2) con pzbot_crashed (puesto en el lobby) Dex sale a outside: cinemática de llegada (motor de ElevenLabs, el coche
//     aparece, sacudida, faros que parpadean, «...wen lambo? Apparently: now.») y queda lambo_seen;
//  3) LOOK (nota de entrega, 0xDE…) y USE (sin llave);
//  4) Dex delante del coche (la huella no se pisa: pasa por delante) y detrás del poste del carport (walk-behind:
//     entre el coche y la base del poste, el poste le tapa).
// Capturas en demo-out/a3-12-lambo/. Falla si el coche no sale/no se esconde según la flag, si la huella se pisa,
// si la cinemática no pone lambo_seen o no pide el motor, o si el poste no tapa a Dex.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-12-lambo
import { startDemo, sleep } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'desk', viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } },
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

const demo = await startDemo(import.meta.url, { fps: 6, width: 640, viewport: VIEWPORTS[0].viewport });
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

const qaState = () => page.evaluate(() => window.__qa.state());
const overlayVisible = (id) => page.evaluate((oid) => {
  const gs = window.__game.scene.getScene('GameScene');
  const co = (gs.conditionalOverlays ?? []).find((o) => o.id === oid);
  return co ? co.sprite.visible : null;
}, id);
const walkable = (x, y) => page.evaluate(([px, py]) => window.__qa.isWalkable(px, py), [x, y]);
/** Profundidad de Dex frente al trozo de primer plano del poste (true = el poste le tapa) */
const postCovers = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const post = (gs.fgLayers ?? []).find((l) => l.id === 'carport_post');
  return post ? post.img.depth > gs.player.depth : null;
});
const NOT_STARTED = { premise_shown: true, chapter_1_intro_shown: true };

for (const [i, { tag, viewport }] of VIEWPORTS.entries()) {
  if (i > 0) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.setViewport(viewport);
  }
  const tap = [Math.round(viewport.width / 2), 40];

  // 1) sin flag
  await demo.openScene('lobby');
  await demo.settle({ tap });
  await page.evaluate((flags) => window.__qa.runScript(Object.entries(flags).map(([flag, value]) => ({ op: 'setFlag', flag, value }))), NOT_STARTED);
  await page.evaluate(() => window.__qa.goto('outside', { x: 80, y: 97 }));
  await demo.settle({ tap });
  await demo.film(800);
  let st = await qaState();
  check(!st.hotspots.includes('hs_lambo'), `${tag} sin pzbot_crashed: no hay hs_lambo`);
  check(await overlayVisible('lambo') === false, `${tag} sin pzbot_crashed: el coche no se ve`);
  check(await walkable(79, 92) === true, `${tag} sin pzbot_crashed: el suelo del carport se pisa`);
  await demo.still(`${tag}-sin-coche`);

  // 2) con flag: cinemática de llegada (sin esperar a que acabe, para grabarla)
  await page.evaluate(() => window.__qa.goto('lobby'));
  await demo.settle({ tap });
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'pzbot_crashed', value: true }]));
  await page.evaluate(() => { window.__qa.goto('outside', { x: 72, y: 97.9 }).catch(() => {}); });
  await demo.film(6500);
  await demo.settle({ tap });
  st = await qaState();
  check(st.flags.lambo_seen === true, `${tag} la cinemática pone lambo_seen`);
  check((st.audio?.sfx?.counts?.lambo_arrive ?? 0) >= 1, `${tag} la cinemática pide el motor (lambo_arrive)`);
  check(await overlayVisible('lambo') === true, `${tag} con pzbot_crashed el coche se ve`);
  check(await overlayVisible('lambo_lights') === false, `${tag} tras el parpadeo los faros quedan apagados`);
  check(st.hotspots.includes('hs_lambo'), `${tag} con pzbot_crashed existe hs_lambo`);
  await demo.still(`${tag}-llegada`);

  // 3) LOOK y USE
  await page.evaluate(() => window.__qa.act('LOOK', 'hs_lambo'));
  await demo.film(1500);
  await page.evaluate(() => window.__qa.dismissAll());
  st = await qaState();
  check(st.flags.read_lambo_note === true, `${tag} LOOK lee la nota de entrega`);
  await page.evaluate(() => window.__qa.act('USE', 'hs_lambo'));
  await demo.film(1500);
  await page.evaluate(() => window.__qa.dismissAll());

  // 4) delante del coche y detrás del poste
  check(await walkable(79, 92) === false, `${tag} la huella del coche no se pisa`);
  check(await walkable(79, 96) === true, `${tag} por delante del coche se pasa`);
  await page.evaluate(() => window.__qa.walk(66, 97));
  await page.evaluate(() => window.__qa.walk(92, 97));
  await demo.film(600);
  check(await postCovers() === false, `${tag} delante del poste (pies en y 97): Dex por encima del poste`);
  await demo.still(`${tag}-delante`);
  await page.evaluate(() => window.__qa.walk(85.6, 94.5));
  await demo.film(800);
  check(await postCovers() === true, `${tag} entre el coche y la base del poste (y 94,5): el poste tapa a Dex`);
  await demo.still(`${tag}-detras-poste`);

  // la segunda vez ya no hay cinemática
  await page.evaluate(() => window.__qa.goto('lobby'));
  await page.evaluate(() => window.__qa.goto('outside', { x: 72, y: 97.9 }));
  await sleep(300);
  st = await qaState();
  check(!(st.cinematic?.active), `${tag} al volver no se repite la llegada`);
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

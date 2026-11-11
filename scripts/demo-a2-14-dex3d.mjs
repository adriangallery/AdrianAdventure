// Demo de A2.14 (plan SCUMM): Dex en 3D (sprites pre-renderizados con Blender desde art/dex3d).
// 844x390 (móvil apaisado), ?qa=1. En `outside` y en el `lobby`:
//   1) anda a izquierda, derecha, hacia el fondo y hacia la cámara: cada tramo debe usar SU ciclo de 8 fotogramas
//      (player3d_walk_<dir>_<i>, vistos al menos 6 distintos), sin giro de balanceo, y el avance medio debe ser el de
//      A2.12 (74 × speed/140 px de arte/s, ±25 %): con el ciclo de 540 ms el pie apoyado no patina;
//   2) habla (LOOK de un hotspot): fotogramas player3d_talk_*;
//   3) cada gesto (coger bajo/medio/alto, usar, empujar, tirar, dar) lanzado con player.gesture(null, anim):
//      fotogramas player3d_<anim>_<dir>_*, y vuelve al reposo;
//   4) el alto de Dex (state().pixel.worldHeightPct) es el mismo con cualquier fotograma 3D que con el de reposo
//      (el origen queda en los pies: A2.11 no cambia).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-14-dex3d
import { startDemo, sleep } from './lib/demo.mjs';

const VP = { width: 844, height: 390, isMobile: true, hasTouch: true };
const demo = await startDemo(import.meta.url, { fps: 8, width: 640, viewport: VP });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];

async function open(scene) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [422, 40] }))) await demo.fail(`${scene}: la escena no quedó libre`);
  await page.evaluate(() => {
    window.__qa.runScript?.([{ op: 'setFlag', flag: 'penny_reading', value: true }]);
  });
}

const anim = () => page.evaluate(() => {
  const st = window.__qa.state();
  return { anim: st.anim, h: st.pixel?.worldHeightPct ?? null, x: st.player?.x, y: st.player?.y };
});

/** Muestrea en la página cada fotograma mientras `fn` corre; devuelve texturas, giro máx y avance. */
async function sampled(label, fn, args, maxMs = 15000) {
  await page.evaluate(() => {
    const s = (window.__s = { tex: [], maxAngle: 0, heights: [], on: true, t0: performance.now(), p0: null, p1: null });
    const gs = window.__game.scene.getScene('GameScene');
    const tick = () => {
      if (!s.on) return;
      const st = window.__qa.state();
      const a = st.anim;
      if (a && !s.tex.includes(a.texture)) s.tex.push(a.texture);
      if (a) s.maxAngle = Math.max(s.maxAngle, Math.abs(a.angle));
      if (st.pixel?.worldHeightPct) s.heights.push(st.pixel.worldHeightPct);
      if (a?.moving) {
        const p = { t: performance.now(), x: gs.player.x, y: gs.player.y, art: st.pixel?.playerScale ?? 1 };
        if (!s.p0) s.p0 = p;
        s.p1 = p;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate((src, args) => { window.__done = false; Promise.resolve((0, eval)(src)(...args)).finally(() => { window.__done = true; }); }, `(${fn})`, args);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await demo.shot();
    if (await page.evaluate(() => window.__done)) break;
    await sleep(120);
  }
  return page.evaluate(() => { window.__s.on = false; return window.__s; });
}

async function walk(scene, tag, x, y, dir) {
  const s = await sampled(tag, (x, y) => window.__qa.walk(x, y), [x, y]);
  const frames = s.tex.filter((t) => t.startsWith(`player3d_walk_${dir}_`));
  console.log(`${scene} ${tag}: ${frames.length} fotogramas de ${dir} · giro máx ${s.maxAngle.toFixed(2)}°`);
  if (frames.length < 6) problems.push(`${scene} ${tag}: solo ${frames.length} fotogramas player3d_walk_${dir}_* (${s.tex.join(', ')})`);
  if (s.maxAngle > 0.01) problems.push(`${scene} ${tag}: giro ${s.maxAngle.toFixed(2)}° andando (el 3D no se balancea)`);
  await demo.still(`${scene}-${tag}`);
}

async function gestures(scene) {
  for (const g of ['pick_low', 'pick_mid', 'pick_high', 'use', 'push', 'pull', 'give']) {
    const s = await sampled(g, (g) => new Promise((done) => {
      const p = window.__game.scene.getScene('GameScene').player;
      p.gesture(null, g);
      const t = setInterval(() => { if (!p.isGesturing()) { clearInterval(t); done(); } }, 30);
    }), [g], 3000);
    const frames = s.tex.filter((t) => t.startsWith(`player3d_${g}_`));
    console.log(`${scene} gesto ${g}: ${frames.join(', ')}`);
    if (frames.length < 3) problems.push(`${scene} gesto ${g}: ${frames.length} fotogramas 3D (${s.tex.join(', ')})`);
    const hs = s.heights;
    if (hs.length && Math.max(...hs) - Math.min(...hs) > 1e-6) problems.push(`${scene} gesto ${g}: el alto de Dex cambia (${Math.min(...hs)}–${Math.max(...hs)})`);
    await sleep(200);
    const a = (await anim()).anim;
    if (a && (!a.rest || a.angle !== 0 || a.liftPx !== 0)) problems.push(`${scene} gesto ${g}: no vuelve al reposo`);
  }
}

for (const scene of ['outside', 'lobby']) {
  await open(scene);
  const st0 = await anim();
  console.log(`${scene}: inicio ${JSON.stringify(st0.anim?.texture)} · alto ${st0.h}`);
  await demo.still(`${scene}-inicio`);
  const y = scene === 'outside' ? 96 : 98;
  await walk(scene, 'izquierda', 30, y, 'left');
  await walk(scene, 'derecha', 70, y, 'right');
  if (scene === 'lobby') {
    await walk(scene, 'fondo', 55.5, 85, 'up');
    await walk(scene, 'camara', 55.5, 98, 'down');
  } else {
    await walk(scene, 'fondo', 40, 84, 'up');
    await walk(scene, 'camara', 40, 96, 'down');
  }
  const hRest = (await anim()).h;
  const hs = await page.evaluate(() => window.__s.heights);
  if (hRest && hs.some((h) => Math.abs(h - hRest) > 0.05 * hRest)) problems.push(`${scene}: el alto de Dex cambia con los fotogramas 3D`);
  // hablar
  const hsId = scene === 'lobby' ? 'hs_plant' : await page.evaluate(() => window.__game.scene.getScene('GameScene').sceneData?.hotspots?.[0]?.id);
  const t = await sampled('habla', (id) => window.__qa.act('LOOK', id, [], 2500), [hsId], 12000);
  const talk = t.tex.filter((k) => k.startsWith('player3d_talk_'));
  console.log(`${scene} habla (${hsId}): ${talk.length} fotogramas`);
  if (talk.length < 3) problems.push(`${scene}: hablando solo ${talk.length} fotogramas player3d_talk_*`);
  await demo.settle({ tap: [422, 40], calm: 2, every: 300 });
  await gestures(scene);
}

await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

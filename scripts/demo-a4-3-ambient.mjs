// Demo de A4.3 (regla visual del plan SCUMM): animación ambiental por código (`ambient[]` de cada scene.json).
// En 844x390 (móvil apaisado, ?qa=1: semillas fijas) recorre las 13 escenas con la cámara sobre la zona con más vida
// (polillas de la lámpara, LEDs del rig, estrellas y luces de la ciudad, goteras del sótano, racks de la sala de
// servidores, niebla y nubes con parallax de la montaña, burbujas de la piscina y del tubo del MemeLAB, monitor del
// treatment room, pájaros del epílogo…) y graba ~1,6 s de cada una con una línea de estado arriba; en outside además
// apaga la lámpara (las polillas se van a la ventana lateral) y arranca el tablón de la valla (ráfaga de polvo por el op
// `ambient`). Captura fija de outside en 390x844.
// Comprueba por la API de QA (`state().ambient`):
//   - cada escena tiene ≥ 2 elementos activos; cada elemento activo dibuja algo (salvo sway, que mueve el primer plano);
//   - entre dos muestras separadas ~1,6 s todos los elementos activos han simulado frames y, salvo leds y flicker (que solo
//     cambian al encender o apagar), su firma de frame ha cambiado (se mueven);
//   - en outside, con la lámpara encendida están las polillas de la lámpara y no las de la ventana, y al apagarla al revés;
//   - PULL de la valla lanza la ráfaga de fence_dust (bursts ≥ 1);
//   - ningún error de página.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-3-ambient
import { startDemo, sleep } from './lib/demo.mjs';

/** Escenas en orden de juego y punto (x %, y %) sobre el que se centra la cámara para el GIF */
const SCENES = [
  ['outside', 34, 50], ['lobby', 22, 40], ['upstairs', 18, 45], ['rooftop', 50, 40], ['basement', 56, 32], ['server_room', 36, 45],
  ['mountain', 50, 40], ['clinic_exterior', 58, 48], ['clinic_interior', 44, 30], ['recovery_pool', 50, 55], ['memelab', 48, 45],
  ['treatment_room', 58, 40], ['epilogue_outside', 32, 32],
];
const FILM_MS = 1600;
/** Tipos cuya firma solo cambia al encender o apagar algo (en 1,6 s pueden no hacerlo) */
const SLOW = new Set(['leds', 'flicker']);

const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const summary = [];

const state = () => page.evaluate(() => window.__qa.state());
const ambient = async () => (await state()).ambient;

/** Cámara quieta centrada en (x %, y %) para que el GIF enseñe la zona con vida (el personaje se queda donde está) */
const frame = (x, y) => page.evaluate(({ x, y }) => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  cam.stopFollow();
  const c = gs.coordSystem.pctToScreen(x, y);
  const maxX = Math.max(0, gs.coordSystem.bgW + gs.coordSystem.bgX * 2 - cam.width);
  cam.scrollX = Math.min(maxX, Math.max(0, c.x - cam.width / 2));
}, { x, y });

/** Línea de estado sobre el lienzo (DOM): escena y elementos activos */
const caption = (text) => page.evaluate((text) => {
  let cap = document.getElementById('demo-cap');
  if (!cap) {
    cap = document.createElement('div');
    cap.id = 'demo-cap';
    cap.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;pointer-events:none;font:13px monospace;color:#fff;background:rgba(10,10,20,.72);padding:3px 6px;white-space:pre;max-width:95vw';
    document.body.appendChild(cap);
  }
  cap.textContent = text;
}, text);

const fmt = (a) => `${a.id}${a.active ? '' : ' (off)'}`;

async function open(scene) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle())) await demo.fail(`La escena ${scene} no quedó libre`);
}

/** Graba FILM_MS muestreando el ambiente en cada fotograma y comprueba que lo activo dibuja y se mueve. Devuelve la muestra final. */
async function filmAndCheck(scene, label) {
  const before = await ambient();
  if (!before) await demo.fail('state().ambient no existe (API de QA anterior a A4.3)');
  const active = before.filter((a) => a.active);
  await caption(`${label}\n${before.map(fmt).join(' · ')}`);
  const t0 = Date.now();
  const fps = [];
  const seen = new Map(active.map((a) => [a.id, { maxCount: 0, sigs: new Set() }]));
  let after = before;
  while (Date.now() - t0 < FILM_MS) {
    await demo.shot();
    fps.push(await page.evaluate(() => Math.round(window.__game.loop.actualFps)));
    after = await ambient();
    for (const a of after) {
      const s = seen.get(a.id);
      if (!s) continue;
      s.maxCount = Math.max(s.maxCount, a.count);
      s.sigs.add(a.sig);
    }
  }
  summary.push(`${scene}: ${before.length} elementos (${active.length} activos: ${active.map((a) => `${a.id}/${a.kind}`).join(', ')}) · ${Math.round(fps.reduce((s, v) => s + v, 0) / fps.length)} fps en headless`);
  if (active.length < 2) problems.push(`${scene}: solo ${active.length} elemento(s) activo(s)`);
  for (const a of active) {
    const b = after.find((x) => x.id === a.id);
    const s = seen.get(a.id);
    if (!b) { problems.push(`${scene}.${a.id}: desapareció`); continue; }
    if (!(b.frames > a.frames)) problems.push(`${scene}.${a.id}: no simuló frames (${a.frames} → ${b.frames})`);
    // Un elemento solo de ráfaga (fence_dust) no dibuja nada en reposo; sway mueve el primer plano, no dibuja
    if (a.burstOnly || a.kind === 'sway') continue;
    if (s.maxCount === 0) problems.push(`${scene}.${a.id} (${a.kind}): no dibujó nada en ${FILM_MS} ms`);
    if (!SLOW.has(a.kind) && s.sigs.size < 2) problems.push(`${scene}.${a.id} (${a.kind}): la firma no cambió en ${FILM_MS} ms`);
  }
  return after;
}

for (const [scene, x, y] of SCENES) {
  await open(scene);
  // Outside: Dex aparece delante de la lámpara (tapa las polillas): se aparta hacia el buzón antes de grabar
  if (scene === 'outside') await page.evaluate(() => window.__qa.walk(60, 95));
  await frame(x, y);
  await sleep(150);
  const after = await filmAndCheck(scene, `${scene}: ambiente`);
  await demo.still(scene);
  if (scene !== 'outside') continue;

  // Outside: lámpara encendida → polillas en la lámpara; apagarla → se van a la ventana lateral
  const lamp = after.find((a) => a.id === 'lamp_moths');
  const win = after.find((a) => a.id === 'window_moths');
  if (!lamp?.active || win?.active) problems.push(`outside: con la lámpara encendida lamp_moths=${lamp?.active} window_moths=${win?.active}`);
  await page.evaluate(() => window.__qa.act('USE', 'hs_porch_light'));
  await frame(26, 50);
  const dark = await filmAndCheck('outside (lámpara apagada)', 'outside: lámpara apagada, las polillas se van a la ventana');
  const lamp2 = dark.find((a) => a.id === 'lamp_moths');
  const win2 = dark.find((a) => a.id === 'window_moths');
  const glow2 = dark.find((a) => a.id === 'lamp_glow');
  if (lamp2?.active || lamp2?.conditionMet || !win2?.active || glow2?.active) problems.push(`outside apagada: lamp_moths=${lamp2?.active} window_moths=${win2?.active} lamp_glow=${glow2?.active}`);
  await demo.still('outside-apagada');

  // PULL de la valla: el op ambient lanza la ráfaga de polvo
  await frame(8, 60);
  await page.evaluate(() => { window.__demoDone = false; window.__qa.act('PULL', 'hs_fence').finally(() => { window.__demoDone = true; }); });
  await caption('outside: PULL de la valla, ráfaga de polvo (op ambient burst)');
  let seenDust = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    await demo.shot();
    const d = (await ambient()).find((a) => a.id === 'fence_dust');
    if (d?.count) seenDust = Math.max(seenDust, d.count);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  const dust = (await ambient()).find((a) => a.id === 'fence_dust');
  if (!dust || dust.bursts < 1) problems.push(`outside: fence_dust sin ráfaga (${JSON.stringify(dust)})`);
  summary.push(`outside: ráfaga de polvo con hasta ${seenDust} motas (bursts ${dust?.bursts})`);
}

// 390x844: outside con las polillas en la lámpara (captura fija)
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open('outside');
await page.evaluate(() => document.getElementById('demo-cap')?.remove());
await frame(36, 50);
await sleep(400);
const portrait = (await ambient()).filter((a) => a.active);
if (portrait.length < 2) problems.push(`390x844: solo ${portrait.length} activos`);
await demo.still('full');
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
for (const s of summary) console.log(s);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

// Demo de A2.20 (plan SCUMM): en outside Dex no sube al porche ni sale partido entre los arbustos.
// Adrián (15-nov): Dex subía al porche y quedaba pegado a la pared, a la altura de la puerta, como si flotara; y en el
// borde izquierdo, entre los arbustos, salía PARTIDO (cabeza arriba, piernas tapadas por el arbusto y las zapatillas
// asomando por debajo). Ahora la zona andable es solo el camino/acera/hierba delante del porche (y ≥ 91) y, junto a
// los arbustos, solo por DELANTE de su línea base (bush_left: y ≥ 93,2; bush_right: y ≥ 97,4).
// Con ?qa=1, en 1280x720, 844x390 y 390x844: abre outside, y con el verbo Walk (clic de QA, como el jugador) lleva a
// Dex a puerta, teclado DOORIS, felpudo, lámpara, ventana, chimenea/nido, arbustos y valla (tablón), y vuelve a la
// puerta. Muestrea los pies durante cada paseo y FALLA si en algún momento quedan con y < 90 % o fuera de la zona
// andable (qa.isWalkable), si un trozo de primer plano con walk-behind (foregroundLayers) le tapa estando sus pies por
// encima de la base del trozo (= detrás del arbusto), o si no llega a menos de 1,5 % del walkTo de scene.json.
// Captura cada parada: `<vp>-<n>-<hotspot>.png`. Tabla en porche.json.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-20-porche
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const SCENE = JSON.parse(readFileSync(new URL('../assets/scenes/outside/scene.json', import.meta.url), 'utf8'));
const VIEWPORTS = [
  { label: '1280x720', width: 1280, height: 720, isMobile: false, hasTouch: true, deviceScaleFactor: 1 },
  { label: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { label: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];
const STOPS = ['hs_front_door', 'hs_keypad', 'hs_doormat', 'hs_porch_light', 'hs_main_window', 'hs_chimney', 'hs_bushes', 'hs_left_window', 'hs_fence', 'hs_front_door'];
const MIN_FEET_Y = 90;
const ARRIVE_TOL = 1.5;
const TIMEOUT_MS = 25000;
const HS = Object.fromEntries(SCENE.regions.hotspots.map((h) => [h.id, h]));
const LAYERS = (SCENE.foregroundLayers ?? []).filter((l) => l.id.startsWith('bush_')); // el poste del carport tapa entero, no parte

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[1] });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = [];

/** Pies de Dex (en %), su caja (en %) y si el punto es andable */
const sample = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const p = gs.player;
  const b = p.getBounds();
  const tl = gs.coordSystem.screenToPct ? gs.coordSystem.screenToPct(b.x, b.y) : null;
  const br = gs.coordSystem.screenToPct ? gs.coordSystem.screenToPct(b.right, b.bottom) : null;
  return {
    x: p.pctX, y: p.pctY, walkable: window.__qa.isWalkable(p.pctX, p.pctY), moving: p.isMoving(),
    box: tl && br ? { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y } : null,
  };
});

/** ¿Algún trozo de primer plano con walk-behind tapa a Dex estando él detrás (pies por encima de su base)? */
function behindLayer(s) {
  const half = s.box ? s.box.w / 2 : 1.2;
  return LAYERS.filter((l) => s.y < l.baseY && s.x + half > l.bounds.x && s.x - half < l.bounds.x + l.bounds.w && s.y > l.bounds.y).map((l) => l.id);
}

function check(tag, s, where) {
  if (s.y < MIN_FEET_Y) problems.push(`${tag} ${where}: pies en y ${s.y.toFixed(2)} (< ${MIN_FEET_Y}): subió al porche`);
  if (!s.walkable) problems.push(`${tag} ${where}: pies en (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) fuera de la zona andable`);
  const behind = behindLayer(s);
  if (behind.length) problems.push(`${tag} ${where}: Dex detrás de ${behind.join(', ')} en (${s.x.toFixed(2)}, ${s.y.toFixed(2)}): el arbusto le parte`);
}

async function freeScene(vp) {
  await demo.openScene('outside');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  await page.evaluate(() => window.__qa.dismissAll());
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 60] }))) problems.push(`${vp.label}: la escena no quedó libre`);
  // Sin triggers: la demo solo anda (tr_mountain está en el borde izquierdo; aquí solo se comprueba que se pisa)
  await page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); gs.checkWalkTriggers = () => false; });
}

for (const vp of VIEWPORTS) {
  const tag = vp.label;
  const { label, ...viewport } = vp;
  await page.setViewport(viewport);
  await freeScene(vp);
  const film = tag === '844x390';
  const start = await sample();
  check(tag, start, 'al entrar');
  if (!(await page.evaluate(() => window.__qa.isWalkable(1.5, 95)))) problems.push(`${tag}: tr_mountain (x 0–3) no se pisa`);
  let k = 0;
  for (const id of STOPS) {
    const h = HS[id];
    const where = `→ ${id}`;
    await page.evaluate((id) => { window.__demoDone = false; window.__demoErr = null; window.__qa.click(id).then(() => { window.__demoDone = true; }, (e) => { window.__demoErr = String(e?.message || e); window.__demoDone = true; }); }, id);
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < TIMEOUT_MS) {
      const s = await sample();
      check(tag, s, where);
      n++;
      if (film) await demo.shot(); else await demo.sleep(120);
      if ((await page.evaluate(() => window.__demoDone)) && !s.moving) break;
    }
    await page.evaluate(() => window.__qa.dismissAll());
    const err = await page.evaluate(() => window.__demoErr);
    if (err) problems.push(`${tag} ${where}: ${err}`);
    const s = await sample();
    check(tag, s, `${where} (parada)`);
    const st = await page.evaluate(() => { const q = window.__qa.state(); return { facing: q.facing, walkTarget: q.walkTarget }; });
    const d = h.walkTo ? Math.hypot(s.x - h.walkTo.x, s.y - h.walkTo.y) : null;
    if (d !== null && d > ARRIVE_TOL) problems.push(`${tag} ${where}: acaba en (${s.x.toFixed(2)}, ${s.y.toFixed(2)}), lejos del walkTo (${h.walkTo.x}, ${h.walkTo.y})`);
    report.push({ vp: tag, target: id, feet: { x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100 }, walkTo: h.walkTo ?? null, face: h.face ?? null, facing: st.facing, samples: n });
    console.log(`${tag} ${where}: Dex en (${s.x.toFixed(1)}, ${s.y.toFixed(1)}), mira ${st.facing}, ${n} muestras`);
    await demo.still(`${tag}-${String(++k).padStart(2, '0')}-${id}`);
  }
}

await demo.end();
writeFileSync(join(demo.dir, 'porche.json'), JSON.stringify({ problems, pageErrors, report }, null, 2));
console.log(problems.length ? `problemas:\n- ${problems.join('\n- ')}` : 'problemas: ninguno');
if (pageErrors.length) console.log(`errores de página: ${pageErrors.join(' | ')}`);
if (problems.length || pageErrors.length) process.exit(1);

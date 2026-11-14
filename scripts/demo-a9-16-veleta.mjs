// Demo de A9.16 (la veleta volteada de rooftop se veía cortada), en 1280x720 (escritorio), 844x390 (móvil apaisado)
// y 390x844 (vertical). Para cada tamaño, partida nueva en rooftop y la veleta sin voltear y con `vane_pushed`, con
// Dex en tres sitios: lejos (a la izquierda, la veleta despejada), debajo de la veleta (al fondo, x 72) y delante
// (cerca de la cámara, x 72). Capturas `<vp>-<estado>-<sitio>.png` (pantalla) y `<vp>-<estado>-zoom.png` (solo la
// veleta, ampliada en la página con un clip). Comprueba:
//   - el overlay vane_flipped está visible solo con vane_pushed y su textura = bounds × fondo maestro (±1 px);
//   - acaba encima de la rosa de los vientos (que es la misma en los dos estados: no gira);
//   - con Dex lejos, la zona de la rosa (brazos y letras N/S/E/W) es IDÉNTICA píxel a píxel antes y después de voltear,
//     y el cielo de alrededor de la veleta (fuera de la caja del overlay) también.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-16-veleta
import { startDemo } from './lib/demo.mjs';
import { join } from 'node:path';

const VIEWPORTS = [
  { id: '1280x720', width: 1280, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  { id: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];
const BG_MASTER = { w: 3712, h: 1152 };
// Rosa de los vientos (make-rooftop-bg.py ROSE, franja 1376x490 del JPEG): x 936..1050, y 155..201
const ROSE = { x: (936 / 1376) * 100, y: (155 / 490) * 100, w: (114 / 1376) * 100, h: (46 / 490) * 100 };
// Caja de la veleta entera (cabeza + rosa) para el zoom y para comparar el cielo de alrededor
const VANE = { x: 64, y: 4, w: 16, h: 40 };
const SPOTS = [
  { id: 'lejos', x: 30, y: 90 },
  { id: 'debajo', x: 72, y: 79 },
  { id: 'delante', x: 72, y: 97 },
];

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0] });
const { page } = demo;
const sharp = (await import('sharp').catch(() => null))?.default ?? null;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

async function free() {
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__qa.dismissAll());
    const st = await demo.state();
    if (!st.script && !st.dialogue) return true;
    await demo.sleep(400);
  }
  return false;
}

async function fresh(vp) {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* nada */ } });
  await demo.openScene('rooftop');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (vp.hasTouch) await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  if (!(await free())) await demo.fail(`${vp.id}: rooftop no quedó libre al entrar`);
  // estrellas y nubes (ambient[]) pasan por delante de la veleta: fuera, para poder comparar las capturas píxel a píxel
  await page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); gs.ambient?.destroy(); gs.ambient = undefined; });
}

/** Rectángulo de página (px) de una caja en % del fondo, recortado a la ventana */
const pageRect = (box) => page.evaluate((b) => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  const bg = gs.bg.getBounds();
  const canvas = window.__game.canvas.getBoundingClientRect();
  const k = canvas.width / window.__game.scale.width;
  const wv = cam.worldView;
  const toPage = (px, py) => {
    const wx = bg.x + (px / 100) * bg.width, wy = bg.y + (py / 100) * bg.height;
    return [canvas.left + (cam.x + ((wx - wv.x) / wv.width) * cam.width) * k, canvas.top + (cam.y + ((wy - wv.y) / wv.height) * cam.height) * k];
  };
  const [x0, y0] = toPage(b.x, b.y);
  const [x1, y1] = toPage(b.x + b.w, b.y + b.h);
  const cx0 = Math.max(0, Math.round(x0)), cy0 = Math.max(0, Math.round(y0));
  const cx1 = Math.min(window.innerWidth, Math.round(x1)), cy1 = Math.min(window.innerHeight, Math.round(y1));
  return { x: cx0, y: cy0, width: Math.max(0, cx1 - cx0), height: Math.max(0, cy1 - cy0), full: cx0 === Math.round(x0) && cx1 === Math.round(x1) };
}, box);

async function place(spot) {
  await page.evaluate(([x, y]) => window.__game.scene.getScene('GameScene').player.teleportPct(x, y), [spot.x, spot.y]);
  // la cámara sigue a Dex: que la veleta quede a la vista
  await page.evaluate((b) => {
    const gs = window.__game.scene.getScene('GameScene');
    const bg = gs.bg.getBounds();
    gs.cameras.main.stopFollow?.();
    gs.cameras.main.centerOn(bg.x + ((b.x + b.w / 2) / 100) * bg.width, gs.cameras.main.midPoint.y);
  }, VANE);
  await demo.film(500);
}

const overlayInfo = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const co = gs.conditionalOverlays.find((o) => o.id === 'vane_flipped');
  if (!co) return null;
  const src = co.sprite.texture.getSourceImage();
  return { visible: co.sprite.visible, w: src.width, h: src.height, bounds: co.bounds };
});

async function raw(file, rect) {
  const { data, info } = await sharp(file).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}
function diffCount(a, b, skip) {
  let n = 0;
  for (let y = 0; y < a.info.height; y++) {
    for (let x = 0; x < a.info.width; x++) {
      if (skip && skip(x, y)) continue;
      const i = (y * a.info.width + x) * 3;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
    }
  }
  return n;
}

for (const vp of VIEWPORTS) {
  const tag = vp.id;
  await page.setViewport(vp);
  await fresh(vp);
  const files = {};
  for (const state of ['antes', 'volteada']) {
    if (state === 'volteada') {
      await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'vane_pushed', value: true }]));
      await free();
    }
    for (const spot of SPOTS) {
      await place(spot);
      await demo.still(`${tag}-${state}-${spot.id}`);
      if (spot.id === 'lejos') {
        const zoom = await pageRect(VANE);
        files[state] = join(demo.dir, `${tag}-${state}-lejos.png`);
        files[`${state}Rect`] = zoom;
        if (zoom.width > 0 && zoom.height > 0) await demo.still(`${tag}-${state}-zoom`, { clip: zoom });
      }
    }
    const ov = await overlayInfo();
    if (state === 'antes') check(!ov || !ov.visible, `${tag}: sin vane_pushed, vane_flipped oculto`);
    else {
      check(!!ov && ov.visible, `${tag}: con vane_pushed, vane_flipped visible`);
      if (ov) {
        const ew = (ov.bounds.w / 100) * BG_MASTER.w, eh = (ov.bounds.h / 100) * BG_MASTER.h;
        check(Math.abs(ov.w - ew) <= 1 && Math.abs(ov.h - eh) <= 1, `${tag}: textura ${ov.w}×${ov.h} = bounds × fondo (${ew.toFixed(1)}×${eh.toFixed(1)})`);
        check(ov.bounds.y + ov.bounds.h <= ROSE.y + 0.01, `${tag}: el overlay acaba en y ${(ov.bounds.y + ov.bounds.h).toFixed(2)} %, encima de la rosa (${ROSE.y.toFixed(2)} %)`);
      }
    }
  }
  // Con Dex lejos y la misma cámara: la rosa idéntica y el cielo de alrededor de la veleta idéntico fuera del overlay
  if (sharp && files.antes && files.volteada) {
    const r1 = files.antesRect, r2 = files.volteadaRect;
    check(JSON.stringify(r1) === JSON.stringify(r2), `${tag}: misma cámara en los dos estados (${JSON.stringify(r1)})`);
    const rose = await pageRect(ROSE);
    if (rose.width > 0 && rose.height > 0) {
      const d = diffCount(await raw(files.antes, rose), await raw(files.volteada, rose));
      check(d === 0, `${tag}: la rosa de los vientos (${rose.width}×${rose.height} px) es idéntica antes y después de voltear (${d} px distintos)`);
    } else check(false, `${tag}: la rosa no está en pantalla`);
    const ovr = await pageRect((await overlayInfo()).bounds);
    if (r1.width > 0 && r1.height > 0) {
      const inside = (x, y) => x + r1.x >= ovr.x - 1 && x + r1.x < ovr.x + ovr.width + 1 && y + r1.y >= ovr.y - 1 && y + r1.y < ovr.y + ovr.height + 1;
      const d = diffCount(await raw(files.antes, r1), await raw(files.volteada, r1), inside);
      check(d === 0, `${tag}: alrededor de la veleta, fuera de la caja del overlay, nada cambia (${d} px distintos)`);
    }
  } else if (!sharp) console.log('  (sin sharp: no se comparan las capturas)');
}

await demo.end();
check(pageErrors.length === 0, `sin errores de página (${pageErrors.slice(0, 3).join(' | ')})`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) process.exit(1);

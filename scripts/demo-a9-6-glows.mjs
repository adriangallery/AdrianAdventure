// Demo de A9.6 (plan SCUMM): brillos ambientales sin cajas. Los `glow` con `shape: rect` (monitores, ventanas) se veían
// como rectángulos translúcidos de borde duro; ahora son una mancha rectangular difuminada (textura `ambient_softrect`
// de AmbientLayer) ajustada a la pantalla o ventana que emite.
// Por cada una de las 8 escenas con glow rect y en 1280x720 y 844x390 (?qa=1: semillas fijas):
//   - congela los glow rect de la escena en su máximo (alphaMin = alpha), apaga el resto del ambiente (para que la
//     resta sea solo el brillo), esconde a Dex, centra la cámara en los brillos y pausa GameScene (sigue pintando);
//   - captura con el brillo (`<escena>-<vp>.png`), sin él, y con el pintado de antes de A9.6 (`<escena>-<vp>-antes.png`:
//     un fillRect con el `area` y el alfa que había en main, dibujado por la demo; el juego ya no lo sabe pintar);
//   - comprueba que no hay borde recto: resta (con brillo − sin brillo) y, en cada lado de la caja de cada brillo, el
//     perfil perpendicular (mediana de muchas posiciones a lo largo del lado, así un objeto delante no cuenta) tiene que
//     salir de ~0 por fuera y subir sin un escalón mayor que max(4, 50 % del pico) entre dos píxeles vecinos. La misma
//     medida sobre el pintado de antes sale en el log (allí el escalón es el pico entero: era la caja).
// Al final, `hoja-antes-despues.png`: por escena, el recorte de antes y el de después en 1280x720, lado a lado.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-6-glows
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo, sleep } from './lib/demo.mjs';

/** Como GLOW_RECT_SPREAD de src/systems/Ambient.ts: la mancha ocupa 1,4 veces el área */
const SPREAD = 1.4;
/** `area` y alfa de cada glow rect en main antes de A9.6 (para pintar el «antes») */
const OLD = {
  lobby: { area: { x: 10, y: 19, w: 27, h: 36 }, alpha: 0.1 },
  upstairs: { area: { x: 42, y: 42, w: 20, h: 15 }, alpha: 0.1 },
  basement: { area: { x: 51.5, y: 29, w: 10.5, h: 19 }, alpha: 0.22 },
  server_room: { area: { x: 49.5, y: 42.5, w: 8.5, h: 14 }, alpha: 0.2 },
  clinic_interior: { area: { x: 82, y: 54, w: 8, h: 11 }, alpha: 0.2 },
  recovery_pool: { area: { x: 73, y: 21, w: 8, h: 18 }, alpha: 0.2 },
  mountain: { area: { x: 74, y: 26, w: 7, h: 6 }, alpha: 0.18 },
  treatment_room: { area: { x: 63.5, y: 26.5, w: 10, h: 22 }, alpha: 0.22 },
};
const VIEWPORTS = [[1280, 720], [844, 390]];

const demo = await startDemo(import.meta.url, { fps: 4, width: 640 });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const summary = [];
const sheet = [];

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
const noCaption = () => page.evaluate(() => document.getElementById('demo-cap')?.remove());

/**
 * Prepara la escena: glow rect al máximo, resto del ambiente apagado, Dex escondido y la cámara centrada en los brillos.
 * Devuelve las cajas (px de pantalla) de cada brillo dibujado y la del de antes.
 */
const prepare = (old) => page.evaluate(({ old, SPREAD }) => {
  const gs = window.__game.scene.getScene('GameScene');
  const layer = gs.ambient;
  const glows = layer.els.filter((e) => e.state.spec.kind === 'glow' && e.state.spec.shape === 'rect');
  for (const e of layer.els) if (!glows.includes(e)) layer.setOverride(e.state.spec.id, 'off');
  for (const e of glows) { e.state.sim.spec.alphaMin = e.state.sim.spec.alpha; layer.setOverride(e.state.spec.id, 'on'); }
  gs.player?.setVisible(false);
  const cam = gs.cameras.main;
  cam.stopFollow();
  const xs = glows.map((e) => e.state.spec.area.x + e.state.spec.area.w / 2);
  const c = gs.coordSystem.pctToScreen((Math.min(...xs) + Math.max(...xs)) / 2, 50);
  const maxX = Math.max(0, gs.coordSystem.bgW + gs.coordSystem.bgX * 2 - cam.width);
  cam.scrollX = Math.min(maxX, Math.max(0, c.x - cam.width / 2));
  const box = (a, k) => {
    const p = gs.coordSystem.pctToScreen(a.x + a.w / 2, a.y + a.h / 2);
    const w = (a.w / 100) * gs.coordSystem.bgW * k;
    const h = (a.h / 100) * gs.coordSystem.bgH * k;
    return { x: (p.x - cam.scrollX) * cam.zoom - (w * cam.zoom) / 2, y: (p.y - cam.scrollY) * cam.zoom - (h * cam.zoom) / 2, w: w * cam.zoom, h: h * cam.zoom };
  };
  return {
    ids: glows.map((e) => e.state.spec.id),
    boxes: glows.map((e) => ({ id: e.state.spec.id, box: box(e.state.spec.area, SPREAD), area: box(e.state.spec.area, 1) })),
    old: { box: box(old.area, 1) },
  };
}, { old, SPREAD });

/** Pausa GameScene (sigue pintando) y enseña: 'new' los brillos nuevos, 'none' nada, 'old' el fillRect de antes */
const show = (mode, old) => page.evaluate(({ mode, old }) => {
  const game = window.__game;
  const gs = game.scene.getScene('GameScene');
  if (!game.scene.isPaused('GameScene')) game.scene.pause('GameScene');
  const glows = gs.ambient.els.filter((e) => e.state.spec.kind === 'glow' && e.state.spec.shape === 'rect');
  for (const e of glows) { e.g.setVisible(mode === 'new'); for (const im of e.images) im.setVisible(mode === 'new'); }
  window.__oldGlow?.destroy();
  window.__oldGlow = null;
  if (mode === 'old') {
    const s = glows[0].state.spec;
    const t = gs.coordSystem.getBgTransform();
    const W = gs.coordSystem.imgW;
    const H = gs.coordSystem.imgH;
    const g = gs.add.graphics().setDepth(s.depth).setBlendMode(window.Phaser?.BlendModes?.ADD ?? 1);
    g.fillStyle(s.color, old.alpha);
    g.fillRect(t.x + (old.area.x / 100) * W * t.scaleX, t.y + (old.area.y / 100) * H * t.scaleY, (old.area.w / 100) * W * t.scaleX, (old.area.h / 100) * H * t.scaleY);
    window.__oldGlow = g;
  }
}, { mode, old });

/**
 * Perfiles de borde de la resta `a − b` (data URLs de captura) en cada lado de `box`: mediana entre posiciones del 20 al
 * 80 % del lado; de 4 px por fuera hasta la mitad de la caja. Devuelve { peak, step, outside } del peor lado.
 */
const edgeCheck = (a, b, boxes) => page.evaluate(async ({ a, b, boxes }) => {
  const load = async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const cx = cv.getContext('2d');
    cx.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, d: cx.getImageData(0, 0, im.width, im.height).data };
  };
  const A = await load(a);
  const B = await load(b);
  const diff = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= A.w || y >= A.h) return null;
    const o = (y * A.w + x) * 4;
    return Math.max(Math.abs(A.d[o] - B.d[o]), Math.abs(A.d[o + 1] - B.d[o + 1]), Math.abs(A.d[o + 2] - B.d[o + 2]));
  };
  const median = (v) => { const s = v.filter((x) => x !== null).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return boxes.map(({ id, box }) => {
    const sides = [];
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    // [nombre, punto del borde en t ∈ [0,1], dirección hacia dentro, longitud hasta el centro]
    const defs = [
      ['izq', (t) => [box.x, box.y + t * box.h], [1, 0], box.w / 2],
      ['der', (t) => [box.x + box.w, box.y + t * box.h], [-1, 0], box.w / 2],
      ['arr', (t) => [box.x + t * box.w, box.y], [0, 1], box.h / 2],
      ['aba', (t) => [box.x + t * box.w, box.y + box.h], [0, -1], box.h / 2],
    ];
    for (const [name, at, dir, len] of defs) {
      const offs = [];
      for (let k = -4; k <= Math.floor(len); k++) offs.push(k);
      const prof = offs.map((k) => {
        const vals = [];
        for (let i = 0; i <= 24; i++) {
          const [x, y] = at(0.2 + (0.6 * i) / 24);
          vals.push(diff(x + dir[0] * k, y + dir[1] * k));
        }
        return median(vals);
      }).filter((v) => v !== null);
      if (prof.length < 3) continue;
      let step = 0;
      for (let i = 1; i < prof.length; i++) step = Math.max(step, Math.abs(prof[i] - prof[i - 1]));
      sides.push({ name, peak: Math.max(...prof), step, outside: prof[0] });
    }
    const worst = sides.reduce((w, s) => (!w || s.step / Math.max(1, s.peak) > w.step / Math.max(1, w.peak) ? s : w), null);
    return { id, sides, worst, cx, cy };
  });
}, { a, b, boxes });

const dataUrl = (buf) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
const okSide = (s) => s.outside <= 2 && s.step <= Math.max(4, 0.5 * s.peak);
const fmtSide = (s) => (s ? `${s.name} pico ${s.peak} escalón ${s.step} fuera ${s.outside}` : 'sin lados medibles');

for (const [vw, vh] of VIEWPORTS) {
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1, isMobile: vw < 1000, hasTouch: true });
  for (const scene of Object.keys(OLD)) {
    const tag = `${scene}-${vw}x${vh}`;
    await demo.openScene(scene);
    await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
    if (!(await demo.settle())) await demo.fail(`La escena ${scene} no quedó libre`);
    const info = await prepare(OLD[scene]);
    if (!info.ids.length) { problems.push(`${tag}: sin glow rect`); continue; }
    await sleep(300);
    // GIF (solo en 844x390): unos fotogramas con el brillo ya congelado al máximo
    if (vw === 844) { await caption(`${scene}: ${info.ids.join(', ')} (al máximo)`); for (let i = 0; i < 3; i++) { await demo.shot(); await sleep(120); } await noCaption(); }
    await show('new', OLD[scene]);
    await sleep(150);
    const withGlow = await page.screenshot();
    writeFileSync(join(demo.dir, `${tag}.png`), withGlow);
    await show('none', OLD[scene]);
    await sleep(150);
    const without = await page.screenshot();
    await show('old', OLD[scene]);
    await sleep(150);
    const before = await page.screenshot();
    writeFileSync(join(demo.dir, `${tag}-antes.png`), before);
    if (vw === 844) { await caption(`${scene}: ANTES (caja de main)`); await demo.shot(); await noCaption(); await show('new', OLD[scene]); await caption(`${scene}: DESPUÉS`); await demo.shot(); await noCaption(); }

    const now = await edgeCheck(dataUrl(withGlow), dataUrl(without), info.boxes);
    const was = await edgeCheck(dataUrl(before), dataUrl(without), [{ id: 'antes', box: info.old.box }]);
    for (const r of now) {
      const bad = r.sides.filter((s) => !okSide(s));
      if (!r.sides.length) problems.push(`${tag}.${r.id}: no se pudo medir (fuera de pantalla)`);
      else if (bad.length) problems.push(`${tag}.${r.id}: borde con escalón: ${bad.map(fmtSide).join('; ')}`);
      summary.push(`${tag}.${r.id}: ${bad.length ? 'BORDE' : 'ok'} · peor lado ${fmtSide(r.worst)}`);
    }
    summary.push(`${tag} ANTES: ${was[0].sides.every(okSide) ? 'sin escalón (?)' : 'caja'} · peor lado ${fmtSide(was[0].worst)}`);

    if (vw === 1280) {
      // Recorte para la hoja: la caja de antes unida a las nuevas, con margen
      const all = [info.old.box, ...info.boxes.map((b) => b.box)];
      const x0 = Math.max(0, Math.min(...all.map((b) => b.x)) - 30);
      const y0 = Math.max(0, Math.min(...all.map((b) => b.y)) - 30);
      const x1 = Math.min(vw, Math.max(...all.map((b) => b.x + b.w)) + 30);
      const y1 = Math.min(vh, Math.max(...all.map((b) => b.y + b.h)) + 30);
      sheet.push({ scene, before: dataUrl(before), after: dataUrl(withGlow), crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    }
    await page.evaluate(() => window.__game.scene.resume('GameScene'));
  }
}

// Hoja comparativa: una fila por escena, antes | después, a 300 px de alto por recorte
await page.goto('about:blank');
const png = await page.evaluate(async (rows) => {
  const H = 260;
  const load = async (src) => { const im = new Image(); im.src = src; await im.decode(); return im; };
  const items = [];
  let width = 0;
  for (const r of rows) {
    const k = H / r.crop.h;
    const w = Math.round(r.crop.w * k);
    items.push({ ...r, k, w, b: await load(r.before), a: await load(r.after) });
    width = Math.max(width, w * 2 + 30);
  }
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = rows.length * (H + 28) + 10;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#16141c'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.imageSmoothingEnabled = false;
  cx.font = '15px monospace'; cx.fillStyle = '#fff';
  items.forEach((it, i) => {
    const y = 10 + i * (H + 28);
    cx.fillText(`${it.scene} · antes`, 10, y + 14);
    cx.fillText('después (A9.6)', 20 + it.w, y + 14);
    cx.drawImage(it.b, it.crop.x, it.crop.y, it.crop.w, it.crop.h, 10, y + 20, it.w, H);
    cx.drawImage(it.a, it.crop.x, it.crop.y, it.crop.w, it.crop.h, 20 + it.w, y + 20, it.w, H);
  });
  return cv.toDataURL('image/png');
}, sheet);
writeFileSync(join(demo.dir, 'hoja-antes-despues.png'), Buffer.from(png.split(',')[1], 'base64'));
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
for (const s of summary) console.log(s);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

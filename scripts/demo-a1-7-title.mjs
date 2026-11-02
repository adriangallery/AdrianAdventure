// Demo de A1.7 (regla visual del plan SCUMM): el subtítulo de la portada ya no pisa el arte del título.
// Antes, «A Point & Click Web3 Adventure on Base» se dibujaba sobre el borde inferior de `intro.png`, justo
// encima de los personajes. Ahora va debajo del arte y los botones se reparten en el hueco que queda.
// Graba el menú en tres viewports reales (390x844 vertical, 844x390 horizontal, 1280x720 escritorio), con y sin
// partida guardada (tres botones, el caso más apretado), y comprueba la geometría: subtítulo por debajo del arte,
// por encima del primer botón y dentro de la pantalla.
// Capturas fijas: `<viewport>.png` y `<viewport>-save.png`. El GIF compone cada viewport sobre un lienzo fijo
// (ffmpeg no admite fotogramas de distinto tamaño en un mismo GIF).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a1-7-title
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { label: 'portrait-390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { label: 'landscape-844x390', width: 844, height: 390, isMobile: true, hasTouch: true },
  { label: 'desktop-1280x720', width: 1280, height: 720, isMobile: false, hasTouch: false },
];
const STAGE = { width: 1320, height: 900 };

const demo = await startDemo(import.meta.url, { fps: 2, width: 660 });
const { page, browser } = demo;

// Lienzo fijo para los fotogramas del GIF
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
let frame = 0;
async function stageFrame(png, caption) {
  const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;font:16px monospace;color:#c8c0e8">
    <div style="margin-bottom:12px">${caption}</div>
    <img src="${src}" style="max-width:${STAGE.width - 40}px;max-height:${STAGE.height - 60}px;outline:1px solid #504878"></body></html>`);
  await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
}

/** Geometría del menú en pantalla (coordenadas del juego = CSS px con Scale.RESIZE). */
const layout = () => page.evaluate(() => {
  const ms = window.__game.scene.getScene('MenuScene');
  const kids = ms.children.list;
  const img = kids.find((c) => c.type === 'Image' && c.texture?.key === 'intro');
  const sub = kids.find((c) => c.name === 'menu-subtitle');
  const btns = kids.filter((c) => c.type === 'Text' && /^\[ /.test(c.text)).map((b) => b.getBounds());
  const r = (b) => b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
  return {
    w: ms.scale.width, h: ms.scale.height,
    img: r(img?.getBounds()), sub: r(sub?.getBounds()),
    subLines: sub ? sub.getWrappedText().length : 0,
    btns: btns.map(r),
  };
});

const waitMenu = () => page.waitForFunction(() => {
  const g = window.__game;
  const ms = g?.scene?.getScene('MenuScene');
  return g?.scene?.isActive('MenuScene') && ms.children.list.some((c) => c.name === 'menu-subtitle')
    && ms.children.list.some((c) => c.type === 'Image' && c.texture?.key === 'intro');
}, { timeout: 90000, polling: 250 });

const problems = [];
const results = [];
for (const withSave of [false, true]) {
  for (const vp of VIEWPORTS) {
    const { label, ...viewport } = vp;
    await page.setViewport({ deviceScaleFactor: 1, ...viewport });
    await page.goto(`${demo.base}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((save) => {
      localStorage.removeItem('adrian_adventure_save');
      if (save) {
        localStorage.setItem('adrian_adventure_save', JSON.stringify({
          0: { id: 0, state: { currentScene: 'lobby' }, timestamp: Date.now() - 3600e3, sceneName: 'Lobby' },
        }));
      }
    }, withSave);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitMenu();
    await page.evaluate(() => document.fonts?.ready);
    await demo.sleep(1200); // fuente cargada y posibles resize iniciales
    // Reconstruir el menú con la fuente ya cargada (lo mismo que hace un resize)
    await page.evaluate(() => window.__game.scale.refresh());
    await demo.sleep(300);

    const tag = `${label}${withSave ? '-save' : ''}`;
    await demo.still(tag);
    const png = await page.screenshot();
    const caption = `${label.replace(/-/, ' ')} · ${withSave ? 'con partida guardada (3 botones)' : 'sin partida (2 botones)'}`;
    for (let i = 0; i < 3; i++) await stageFrame(png, caption);

    const L = await layout();
    results.push({ tag, ...L });
    const bad = (m) => problems.push(`${tag}: ${m}`);
    if (!L.img || !L.sub) { bad('falta el arte o el subtítulo'); continue; }
    if (L.sub.y < L.img.bottom) bad(`el subtítulo (y=${L.sub.y}) pisa el arte (borde inferior ${L.img.bottom})`);
    if (L.sub.bottom > L.h) bad(`el subtítulo se sale por abajo (${L.sub.bottom} > ${L.h})`);
    if (L.sub.x < 0 || L.sub.x + L.sub.w > L.w) bad('el subtítulo se sale por los lados');
    const first = L.btns.reduce((a, b) => (a && a.y < b.y ? a : b), null);
    if (first && L.sub.bottom > first.y + 6) bad(`el subtítulo (fondo ${L.sub.bottom}) se mete en el primer botón (y=${first.y})`);
    const last = L.btns.reduce((a, b) => (a && a.bottom > b.bottom ? a : b), null);
    if (last && last.bottom > L.h + 2) bad(`el último botón se sale por abajo (${last.bottom} > ${L.h})`);
    if (L.btns.length !== (withSave ? 3 : 2)) bad(`esperaba ${withSave ? 3 : 2} botones y hay ${L.btns.length}`);
  }
}

await stage.close().catch(() => {});
await demo.end();
for (const r of results) console.log(JSON.stringify(r));
console.log(`${frame} frames · problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

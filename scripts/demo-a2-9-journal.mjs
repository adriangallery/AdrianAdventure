// Demo de A2.9 + A2.9a (regla visual del plan SCUMM): el diario es el móvil de Dex.
// En `outside` (?qa=1), en 390x844 (móvil vertical) y 844x390 (móvil horizontal), con el dedo (pantalla táctil):
//   1) coge la nota de la lámpara del porche (API de QA): el objetivo «Find the code…» se cumple y se apunta una nota;
//      el botón del móvil enseña el punto amarillo de «nuevo»;
//   2) toca el botón del móvil (barra de arriba, junto a Save y los trofeos): se abre el panel en la pestaña Goals con el
//      tic en g1_code;
//   3) toca Notes: sale la nota n1_code;
//   4) toca Call Anon y el botón de llamar: tono y la pista de Anon en pantalla (el puzle abierto ya es p1_door, no
//      p1_code, que está resuelto);
//   5) toca fuera del móvil: se cierra.
// Comprueba por `state().journal` y el DOM (el panel cabe en la pantalla, la pestaña activa, el tic, la nota, la burbuja
// de Anon con su texto) y falla con demo.fail si algo no está. El GIF compone los dos viewports sobre un lienzo fijo.
// Capturas: `<viewport>-goals.png`, `<viewport>-notes.png`, `<viewport>-anon.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-9-journal
import { join } from 'node:path';
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { label: 'portrait-390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { label: 'landscape-844x390', width: 844, height: 390, isMobile: true, hasTouch: true },
];
const STAGE = { width: 900, height: 900 };

const demo = await startDemo(import.meta.url, { fps: 4, width: 600 });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];

const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption, n = 1) {
  for (let i = 0; i < n; i++) {
    const png = await page.screenshot();
    const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;font:15px monospace;color:#c8c0e8">
      <div style="margin-bottom:10px">${caption}</div>
      <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878"></body></html>`);
    await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
    await page.bringToFront();
  }
}

const journal = () => page.evaluate(() => window.__qa.state().journal);
/** Centro (px de página) de un elemento del DOM, o null. */
const center = (sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);
const tapSel = async (sel, what) => {
  const c = await center(sel);
  if (!c) { problems.push(`no está ${what} (${sel})`); return false; }
  await page.touchscreen.tap(c.x, c.y);
  return true;
};
const waitFor = async (fn, ms, caption) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await stageFrame(caption);
  }
  return false;
};

for (const vp of VIEWPORTS) {
  const { label, ...viewport } = vp;
  const cap = (what) => `${label} · ${what}`;
  const bad = (m) => problems.push(`${label}: ${m}`);
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  await demo.openScene('outside');
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  await page.evaluate(() => document.fonts?.ready);
  if (!(await demo.settle({ tap: [Math.round(viewport.width / 2), 40] }))) await demo.fail(`${label}: la escena no quedó libre`);
  await stageFrame(cap('outside'), 2);

  // 1) La nota de la lámpara: objetivo cumplido y nota nueva → punto en el botón. En vertical la cámara enseña una franja
  // estrecha del fondo y la lámpara (x 34-37 %) queda lejos del spawn (72 %): se anda hacia ella a tramos visibles
  for (let i = 0; i < 12; i++) {
    const px = (await page.evaluate(() => window.__qa.state().player))?.x ?? 36;
    if (px <= 40) break;
    const err = await page.evaluate((x) => window.__qa.walk(x, 95).then(() => null, (e) => String(e?.message || e)), Math.max(38, px - 7));
    if (err) { bad(`no pudo andar hacia la lámpara: ${err}`); break; }
    await stageFrame(cap('andando hacia la lámpara del porche'));
  }
  const picked = await page.evaluate(() => window.__qa.act('PICK', 'hs_porch_light').then(() => null, (e) => String(e?.message || e)));
  if (picked) bad(`PICK hs_porch_light falló: ${picked}`);
  await demo.sleep(900); // el refresco del diario va cada 400 ms
  let j = await journal();
  if (!j) await demo.fail(`${label}: state().journal es null`);
  if (!j.goals.find((g) => g.id === 'g1_code')?.done) bad(`g1_code sin tic tras coger la nota: ${JSON.stringify(j.goals)}`);
  if (!j.notes.includes('n1_code')) bad(`la nota n1_code no se apuntó: ${JSON.stringify(j.notes)}`);
  const dot = await page.evaluate(() => window.__game.scene.getScene('UIScene').getJournal().qaState().unseen);
  if (!(dot > 0) && label.startsWith('portrait')) bad('no hay nada marcado como nuevo (punto del botón) tras el hito');
  await stageFrame(cap('nota cogida: punto amarillo en el botón del móvil'), 3);

  // 2) Botón del móvil con el dedo
  const btn = await page.evaluate(() => {
    const c = window.__game.scene.getScene('UIScene').getJournal().buttonCenter();
    const r = window.__game.canvas.getBoundingClientRect();
    return { x: r.left + c.x, y: r.top + c.y };
  });
  await page.touchscreen.tap(btn.x, btn.y);
  if (!(await waitFor(() => !!document.getElementById('journal-overlay'), 4000, cap('abriendo el móvil')))) await demo.fail(`${label}: tocar el botón del móvil no abrió el diario`);
  await demo.sleep(500);
  j = await journal();
  if (!j.open || j.tab !== 'goals') bad(`el diario no está abierto en Goals: ${JSON.stringify({ open: j.open, tab: j.tab })}`);
  const fit = await page.evaluate(() => {
    const r = document.getElementById('journal-phone').getBoundingClientRect();
    return { ok: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(`${label}: móvil ${fit.w}x${fit.h} en ${viewport.width}x${viewport.height}`);
  if (!fit.ok) bad('el móvil no cabe en la pantalla');
  const tick = await page.evaluate(() => document.querySelector('#journal-phone .jr-goal[data-goal="g1_code"]')?.dataset.done);
  if (tick !== 'true') bad(`el objetivo g1_code no sale con tic en el panel (${tick})`);
  await demo.still(`${label}-goals`);
  await stageFrame(cap('GOALS: el objetivo cumplido con tic'), 5);

  // 3) Notes
  await tapSel('#journal-phone .jr-tab[data-tab="notes"]', 'la pestaña Notes');
  await demo.sleep(300);
  j = await journal();
  if (j.tab !== 'notes') bad(`tocar Notes dejó la pestaña ${j.tab}`);
  const note = await page.evaluate(() => document.querySelector('#journal-phone .jr-note[data-note="n1_code"]')?.textContent ?? null);
  if (!note || !/7314/.test(note)) bad(`la nota n1_code no sale en Notes (${note})`);
  await demo.still(`${label}-notes`);
  await stageFrame(cap('NOTES: lo que Dex apunta al leer'), 5);

  // 4) Call Anon
  await tapSel('#journal-phone .jr-tab[data-tab="anon"]', 'la pestaña Call Anon');
  await demo.sleep(300);
  await stageFrame(cap('CALL ANON'), 2);
  await tapSel('#journal-call', 'el botón de llamar');
  await stageFrame(cap('Ringing...'), 2);
  if (!(await waitFor(() => !window.__qa.state().journal.calling && !!document.querySelector('#journal-transcript .jr-bubble'), 6000, cap('Ringing...')))) {
    bad('Anon no contestó (sin burbuja en pantalla)');
  }
  j = await journal();
  const bubble = await page.evaluate(() => document.querySelector('#journal-transcript .jr-bubble')?.textContent ?? null);
  console.log(`${label}: Anon → ${JSON.stringify(j.anon)}`);
  if (j.anon?.puzzle !== 'p1_door' || !(j.anon.level >= 1)) bad(`Anon no dio pista del puzle abierto p1_door: ${JSON.stringify(j.anon)}`);
  if (!bubble || bubble !== j.anon?.text) bad(`el texto de Anon no está en pantalla (${bubble})`);
  await demo.still(`${label}-anon`);
  await stageFrame(cap(`CALL ANON: pista ${j.anon?.level}/3 de ${j.anon?.puzzle}, *click*`), 6);

  // 5) Fuera del móvil: se cierra
  const outside = await page.evaluate(() => {
    const r = document.getElementById('journal-phone').getBoundingClientRect();
    return { x: Math.round(innerWidth / 2), y: Math.max(3, Math.floor(r.top / 2)) };
  });
  await page.touchscreen.tap(outside.x, outside.y);
  if (!(await waitFor(() => !document.getElementById('journal-overlay'), 3000, cap('cerrando')))) bad('tocar fuera del móvil no lo cerró');
  j = await journal();
  if (j.open) bad('state().journal.open sigue a true tras cerrarlo');
  await stageFrame(cap('cerrado: la escena vuelve'), 2);
}

await stage.close().catch(() => {});
await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`${frame} fotogramas · problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

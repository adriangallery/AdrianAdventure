// Demo de A9.4 (regla visual del plan SCUMM): el final que cierra, en 844x390 (móvil apaisado) y 390x844 (móvil
// vertical), ambos táctiles. Para cada viewport:
//   1) partida limpia en `epilogue_outside` (?qa=1&scene=…), la entrada del epílogo dejada correr y, como si el
//      jugador hubiera firmado el NOW HIRING: game_complete, unos logros, 7 llamadas a Anon y 47 min jugados.
//   2) los créditos con el mismo `credits` del motor (el del camino de bajada). A 1 s, un toque REAL y Esc: no los
//      saltan (state().ending.credits: tapsIgnored ≥ 1, escIgnored ≥ 1, skipped false). Pasados 3 s, en 844x390 Esc y en
//      390x844 mantener pulsado (touchStart … touchEnd): los saltan.
//   3) «THE END» y el resumen: tiempo jugado («47m 12s»), llamadas a Anon («7 times»), logros con su nombre legible.
//      Comprueba que toda la letra es ≥ 11 px, que ningún texto se sale de la pantalla ni pisa a otro, y que un toque
//      antes de 2 s no lo cierra. Captura `<vp>-the-end.png`.
//   4) un toque lo cierra y vuelve a la portada (MenuScene); «Continue» dice «THE END · 47m …» (la partida guardada
//      está terminada). Captura `<vp>-menu.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-4-final
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const STAGE = { width: 880, height: 900 };
const VIEWPORTS = [
  { id: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1, skipWith: 'esc' },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1, skipWith: 'hold' },
];
const SCENE = 'epilogue_outside';
const ACHIEVEMENTS = ['ch1_complete', 'ch2_complete', 'ch3_complete', 'ch4_complete', 'patient_zero', 'alpha_leak', 'diamond_hands', 'game_complete'];
const PLAY_MS = 47 * 60_000 + 12_000;

const demo = await startDemo(import.meta.url, { fps: 4, width: 600, viewport: VIEWPORTS[0] });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = { passes: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lienzo fijo para el GIF: los dos viewports en el mismo tamaño de fotograma
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption) {
  const png = await page.screenshot();
  const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;font:16px monospace;color:#c8c0e8">
    <div style="margin-bottom:10px">${caption}</div>
    <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878;image-rendering:pixelated"></body></html>`);
  await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
  await page.bringToFront();
}
async function filmFor(ms, caption) {
  const end = Date.now() + ms;
  while (Date.now() < end) await stageFrame(caption);
}

const ending = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.registry.get('endingQa') ?? null)));
async function waitEnding(cond, ms, what, caption) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = await ending();
    if (cond(e)) return e;
    if (caption) await stageFrame(caption); else await sleep(100);
  }
  problems.push(`${what}: no llegó en ${ms} ms`);
  return ending();
}

/** Cajas que se pisan (con 1 px de margen) */
function overlaps(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) out.push(`${a.name}/${b.name}`);
    }
  }
  return out;
}

for (const vp of VIEWPORTS) {
  const tag = vp.id;
  const pass = { viewport: tag };
  await page.setViewport(vp);
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await demo.openScene(SCENE);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 40] }))) await demo.fail(`${tag}: ${SCENE} no quedó libre al entrar`);
  await sleep(800);

  // 1) como tras firmar: game_complete, logros, llamadas a Anon y tiempo jugado
  await page.evaluate((ach, playMs) => {
    const gs = window.__game.scene.getScene('GameScene');
    const st = gs.gameState;
    st.flags.signed_up = true;
    st.flags.game_complete = true;
    st.achievements = [...ach];
    st.journal = { notes: [], seen: [], hints: {}, calls: 7 };
    st.playTimeMs = playMs;
    window.__game.registry.set('gameState', st);
  }, ACHIEVEMENTS, PLAY_MS);
  await stageFrame(`${tag} · epílogo (firmado)`);

  // 2) créditos con el op del motor (no se espera: la demo toca como el jugador)
  await page.evaluate(() => { void window.__game.scene.getScene('GameScene').qaRunScript([{ op: 'credits' }]); });
  const started = await waitEnding((e) => !!e?.credits, 10000, `${tag}: créditos`);
  const tStart = Date.now();
  await filmFor(1000 - (Date.now() - tStart), `${tag} · créditos`);
  await page.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await stageFrame(`${tag} · créditos: toque a 1 s (no salta)`);
  await sleep(200);
  await page.keyboard.press('Escape');
  await filmFor(800, `${tag} · créditos: Esc a 1 s (no salta)`);
  let e = await ending();
  pass.creditsAt1s = e?.credits;
  if (!e?.credits || e.credits.skipped || e.credits.done) problems.push(`${tag}: el toque o el Esc a 1 s saltaron los créditos: ${JSON.stringify(e?.credits)}`);
  if (!(e?.credits?.tapsIgnored >= 1)) problems.push(`${tag}: el toque a 1 s no se registró como ignorado: ${JSON.stringify(e?.credits)}`);
  if (!(e?.credits?.escIgnored >= 1)) problems.push(`${tag}: el Esc a 1 s no se registró como ignorado: ${JSON.stringify(e?.credits)}`);
  if (!(started?.credits?.smallestFontPx >= 11)) problems.push(`${tag}: letra de los créditos < 11 px (${started?.credits?.smallestFontPx})`);
  await filmFor(Math.max(0, 3600 - (Date.now() - tStart)), `${tag} · créditos (pasados 3 s: «hold to skip»)`);
  await demo.still(`${tag}-credits`);
  if (vp.skipWith === 'esc') {
    await page.keyboard.press('Escape');
  } else {
    await page.touchscreen.touchStart(Math.round(vp.width / 2), Math.round(vp.height / 2));
    await filmFor(1000, `${tag} · créditos: mantener pulsado`);
    await page.touchscreen.touchEnd();
  }
  e = await waitEnding((x) => x?.credits?.skipped || x?.credits?.done, 5000, `${tag}: salto de los créditos con ${vp.skipWith}`, `${tag} · créditos: ${vp.skipWith}`);
  pass.creditsSkip = e?.credits;
  if (!e?.credits?.skipped || e.credits.skipInput !== vp.skipWith) problems.push(`${tag}: ${vp.skipWith} pasados 3 s no saltó los créditos: ${JSON.stringify(e?.credits)}`);

  // 3) THE END y el resumen
  e = await waitEnding((x) => x?.ending?.theEnd && x?.layout, 8000, `${tag}: THE END`, `${tag} · THE END`);
  await sleep(500);
  await page.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await filmFor(1700, `${tag} · THE END (un toque antes de 2 s no lo cierra)`);
  await demo.still(`${tag}-the-end`);
  e = await ending();
  pass.summary = e?.summary;
  pass.layout = e?.layout;
  if (!(e?.ending?.tapsIgnored >= 1) || e?.ending?.done) problems.push(`${tag}: un toque antes de 2 s cerró el resumen: ${JSON.stringify(e?.ending)}`);
  const lines = e?.summary ?? [];
  const want = [/^Time played: 47m 12s$/, /^Called Anon: 7 times$/, new RegExp(`^Achievements: ${ACHIEVEMENTS.length} of \\d+$`), /★ Game Complete$/, /★ Patient Zero$/, /★ Breaking & Entering$/];
  for (const re of want) if (!lines.some((l) => re.test(l))) problems.push(`${tag}: el resumen no tiene ${re}: ${lines.join(' | ')}`);
  if (lines.some((l) => /_/.test(l))) problems.push(`${tag}: hay ids crudos en el resumen: ${lines.join(' | ')}`);
  const texts = e?.layout?.texts ?? [];
  if (!texts.length) problems.push(`${tag}: sin cajas del resumen`);
  for (const t of texts) {
    if (t.fontPx < 11) problems.push(`${tag}: «${t.name}» con letra de ${t.fontPx} px (< 11)`);
    if (t.x < 0 || t.y < 0 || t.x + t.w > vp.width + 1 || t.y + t.h > vp.height + 1) problems.push(`${tag}: «${t.name}» se sale de la pantalla ${JSON.stringify(t)}`);
  }
  const ov = overlaps(texts);
  if (ov.length) problems.push(`${tag}: textos del resumen que se pisan: ${ov.join(', ')}`);
  if (e?.ending && e.ending.achievementsShown < ACHIEVEMENTS.length) console.log(`    (nota) ${tag}: caben ${e.ending.achievementsShown} de ${ACHIEVEMENTS.length} logros (+N more)`);
  await filmFor(1200, `${tag} · THE END`);

  // 4) un toque → portada
  await page.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await waitEnding((x) => x?.returnedToMenu, 6000, `${tag}: vuelta a la portada`, `${tag} · vuelta a la portada`);
  try {
    await page.waitForFunction(() => window.__game.scene.isActive('MenuScene') && !window.__game.scene.isActive('GameScene'), { timeout: 15000, polling: 200 });
  } catch { problems.push(`${tag}: no volvió a la portada (MenuScene) en 15 s`); }
  await filmFor(1500, `${tag} · portada`);
  const menu = await page.evaluate(() => {
    const m = window.__game.scene.getScene('MenuScene');
    const detail = m.children.list.find((o) => o.name === 'continue-detail');
    const buttons = m.children.list.map((o) => o.text).filter((t) => typeof t === 'string' && t.startsWith('['));
    return { detail: detail?.text ?? null, buttons, pick: window.__continuePick ?? null };
  });
  pass.menu = menu;
  await demo.still(`${tag}-menu`);
  if (!menu.buttons.some((b) => /New Game/.test(b))) problems.push(`${tag}: la portada no ofrece New Game: ${menu.buttons.join(', ')}`);
  if (!menu.buttons.some((b) => /Continue/.test(b))) problems.push(`${tag}: la portada no ofrece Continue: ${menu.buttons.join(', ')}`);
  if (!/^THE END · 47m/.test(menu.detail ?? '')) problems.push(`${tag}: «Continue» no dice que la partida está terminada: «${menu.detail}»`);
  console.log(`${tag}: créditos a 1 s ${JSON.stringify(pass.creditsAt1s)} · salto ${JSON.stringify(pass.creditsSkip)}`);
  console.log(`${tag}: resumen ${lines.join(' | ')}`);
  console.log(`${tag}: portada ${JSON.stringify(menu)}`);
  report.passes.push(pass);
}

await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
report.problems = problems;
writeFileSync(join(demo.dir, 'final.json'), JSON.stringify(report, null, 2));
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

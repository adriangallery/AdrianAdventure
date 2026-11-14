// Demo de A9.9, A9.11 y A9.12 (regla visual del plan SCUMM), en 844x390 (móvil apaisado) y 390x844 (vertical):
//   1) treatment_room (A9.9): con el disfraz de mono puesto (`ape_costume_worn`), USE en el sillón con el respaldo
//      cargado. El sillón quita el disfraz y Dex sentado (`seatedDex`, dex2d_sit_0) se ve; si se vuelve a poner el
//      disfraz sentado, Dex sentado se sigue viendo (no hay pose sentada del mono y no puede desaparecer).
//      Capturas `<vp>-sillon-disfraz.png` (antes) y `<vp>-sillon-sentado.png`.
//   2) mountain (A9.11): partida limpia con el cap. 3 hecho, entrada por el gotoScene de outside (spawn 96,8/91,5, en
//      la maleza). Mientras Dex habla en la cinemática de entrada, su caja no se cruza con ninguna franja de
//      `foregroundLayers` que se pinte delante de él (misma regla de franjas que A2.17: base baseY + k·bandStep).
//      Captura `<vp>-mountain-dex.png`.
//   3) rooftop (A9.12): la veleta antes y después de `vane_pushed`; el overlay `vane_flipped` está visible, encaja en sus
//      bounds (tamaño de la textura = bounds × fondo maestro 3712×1152, ±1 px) y su parte de abajo (la rosa de los
//      vientos, que no gira) es transparente. Capturas `<vp>-veleta-antes.png` y `<vp>-veleta-despues.png`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-visual
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { id: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];
const MOUNTAIN_ENTRY = { x: 96.8, y: 91.5 }; // el spawn de outside.tr_mountain
const BG_MASTER = { w: 3712, h: 1152 }; // rooftop/background.png
const ROSE_FROM = 0.72; // de este alto (fracción del overlay) hacia abajo, la rosa de los vientos: transparente

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0] });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

async function fresh(scene, vp, flags = []) {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* nada */ } });
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 40] }))) await demo.fail(`${scene} no quedó libre al entrar`);
  if (flags.length) await page.evaluate((fl) => window.__qa.runScript(fl.map((flag) => ({ op: 'setFlag', flag, value: true }))), flags);
}

const seated = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const st = window.__qa.state();
  return {
    seated: gs.seatedDex?.img.visible ?? null, key: gs.seatedDex?.img.texture.key ?? null, standing: gs.player.visible,
    costume: !!st.flags.ape_costume_worn, sat: !!st.flags.patient_seated,
  };
});

// --- 1) A9.9: el sillón con el disfraz puesto ---
async function chair(vp) {
  const tag = vp.id;
  await fresh('treatment_room', vp, ['chapter_4_complete', 'chapter_5_intro_shown', 'backup_loaded']);
  await page.evaluate(() => window.__qa.runScript([{ op: 'addItem', id: 'ape_costume' }, { op: 'setFlag', flag: 'ape_costume_worn', value: true }]));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(600);
  const before = await seated();
  check(before.costume && !before.sat && before.seated === false, `${tag} sillón: antes, disfrazado y sin sentar (${JSON.stringify(before)})`);
  await demo.still(`${tag}-sillon-disfraz`);
  await page.evaluate(() => window.__qa.act('USE', 'hs_chair', ['Not now']).catch((e) => console.warn(String(e))));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(1200);
  const after = await seated();
  check(after.sat && !after.costume, `${tag} sillón: sentado y sin disfraz (${JSON.stringify(after)})`);
  check(after.seated === true && /^dex2d_sit/.test(after.key ?? ''), `${tag} sillón: Dex sentado se ve (${after.key})`);
  check(!after.standing, `${tag} sillón: el Dex de pie sigue oculto (hidePlayer)`);
  await demo.still(`${tag}-sillon-sentado`);
  // se vuelve a poner el disfraz sentado: Dex sentado no puede desaparecer
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'ape_costume_worn', value: true }]));
  await demo.film(600);
  const again = await seated();
  check(again.seated === true, `${tag} sillón: con el disfraz otra vez, Dex sentado sigue a la vista (${JSON.stringify(again)})`);
}

// --- 2) A9.11: la entrada de mountain ---
async function mountain(vp) {
  const tag = vp.id;
  await fresh('clinic_exterior', vp, ['chapter_1_complete', 'chapter_2_complete', 'chapter_3_complete', 'chapter_3_intro_shown']);
  await page.evaluate(() => {
    const P = { samples: 0, covered: [], maxCover: 0 };
    window.__a9 = P;
    if (window.__a9Timer) clearInterval(window.__a9Timer);
    window.__a9Timer = setInterval(() => {
      const g = window.__game;
      if (!g?.scene.isActive('GameScene') || g.registry.get('currentSceneId') !== 'mountain') return;
      let st;
      try { st = window.__qa.state(); } catch { return; }
      if (!st.cinematic?.active || !st.speech || st.speech.speaker) return; // solo mientras habla Dex
      const gs = g.scene.getScene('GameScene');
      const json = gs.cache.json.get('scene_mountain');
      const bg = gs.bg.getBounds();
      const pb = gs.player.getBounds();
      const pr = { x0: ((pb.x - bg.x) / bg.width) * 100, x1: ((pb.right - bg.x) / bg.width) * 100, y0: ((pb.y - bg.y) / bg.height) * 100, y1: ((pb.bottom - bg.y) / bg.height) * 100 };
      const feet = st.player.y;
      let cover = 0;
      const hits = [];
      for (const l of json.foregroundLayers ?? []) {
        const b = l.bounds;
        const step = l.bandStep > 0 ? l.bandStep : b.h;
        for (let k = 0, top = b.y; top < b.y + b.h - 1e-6; k++, top += step) {
          const base = l.bandStep > 0 ? l.baseY + k * l.bandStep : l.baseY;
          if (base <= feet) continue; // esta franja va detrás de Dex
          const ix = Math.max(0, Math.min(pr.x1, b.x + b.w) - Math.max(pr.x0, b.x));
          const iy = Math.max(0, Math.min(pr.y1, Math.min(top + step, b.y + b.h)) - Math.max(pr.y0, top));
          if (ix * iy > 0) { cover += ix * iy; hits.push(`${l.id}#${k}`); }
        }
      }
      const frac = cover / Math.max(1e-6, (pr.x1 - pr.x0) * (pr.y1 - pr.y0));
      P.samples++;
      P.maxCover = Math.max(P.maxCover, frac);
      P.player = { x: st.player.x, y: st.player.y };
      if (hits.length && P.covered.length < 5) P.covered.push({ at: st.player, frac: Math.round(frac * 1000) / 1000, hits });
    }, 50);
  });
  // el gotoScene del juego, con el spawn de outside.tr_mountain (sin esperar: la cinemática se graba aquí)
  await page.evaluate((p) => window.__game.scene.getScene('GameScene').qaGoto('mountain', p), MOUNTAIN_ENTRY);
  let still = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const r = await page.evaluate(() => { const st = window.__qa.state(); return { active: st.cinematic?.active, ended: st.cinematic?.ended ?? 0, dex: !!st.speech && !st.speech.speaker, scene: st.scene }; });
    if (!still && r.active && r.dex) { await demo.sleep(900); await demo.still(`${tag}-mountain-dex`); still = true; }
    await demo.shot();
    if (r.scene === 'mountain' && !r.active && r.ended >= 1) break;
    await demo.sleep(150);
  }
  const P = await page.evaluate(() => JSON.parse(JSON.stringify(window.__a9)));
  check(still, `${tag} mountain: captura con Dex hablando en la cinemática`);
  check(P.samples > 0, `${tag} mountain: ${P.samples} muestras con Dex hablando (en ${P.player ? `${P.player.x.toFixed(1)},${P.player.y.toFixed(1)}` : '?'})`);
  check(P.maxCover === 0, `${tag} mountain: ninguna franja de primer plano tapa a Dex mientras habla (máx ${Math.round(P.maxCover * 100)} % ${JSON.stringify(P.covered)})`);
}

// --- 3) A9.12: la veleta volteada ---
async function vane(vp) {
  const tag = vp.id;
  await fresh('rooftop', vp);
  const walkTo = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return gs.cache.json.get('scene_rooftop').regions.hotspots.find((h) => h.id === 'hs_weather_vane').walkTo;
  });
  try { await page.evaluate(([x, y]) => window.__qa.walk(x, y), [walkTo.x, walkTo.y]); } catch {
    await page.evaluate(([x, y]) => window.__game.scene.getScene('GameScene').player.teleportPct(x, y), [walkTo.x, walkTo.y]);
  }
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(800);
  await demo.still(`${tag}-veleta-antes`);
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'vane_pushed', value: true }]));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(800);
  await demo.still(`${tag}-veleta-despues`);
  const ov = await page.evaluate((roseFrom) => {
    const gs = window.__game.scene.getScene('GameScene');
    const co = gs.conditionalOverlays.find((o) => o.id === 'vane_flipped');
    if (!co) return null;
    const src = co.sprite.texture.getSourceImage();
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaqueRose = 0, opaqueTop = 0;
    const from = Math.floor(c.height * roseFrom);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 0) { if (y >= from) opaqueRose++; else opaqueTop++; }
    }
    const v = gs.cameras.main.worldView;
    const b = co.sprite.getBounds();
    const ix = Math.max(0, Math.min(b.right, v.right) - Math.max(b.x, v.x));
    const iy = Math.max(0, Math.min(b.bottom, v.bottom) - Math.max(b.y, v.y));
    return { visible: co.sprite.visible, w: c.width, h: c.height, bounds: co.bounds, opaqueRose, opaqueTop, inView: (ix * iy) / (b.width * b.height) };
  }, ROSE_FROM);
  check(!!ov && ov.visible, `${tag} veleta: vane_flipped visible con vane_pushed`);
  if (!ov) return;
  const ew = (ov.bounds.w / 100) * BG_MASTER.w, eh = (ov.bounds.h / 100) * BG_MASTER.h;
  check(Math.abs(ov.w - ew) <= 1 && Math.abs(ov.h - eh) <= 1, `${tag} veleta: textura ${ov.w}×${ov.h} = bounds × fondo (${ew.toFixed(1)}×${eh.toFixed(1)})`);
  check(ov.opaqueRose === 0, `${tag} veleta: la rosa de los vientos no se toca (${ov.opaqueRose} px opacos abajo)`);
  check(ov.opaqueTop > 1000, `${tag} veleta: la B y la flecha sí (${ov.opaqueTop} px opacos arriba)`);
  console.log(`  ${tag} veleta: ${Math.round(ov.inView * 100)} % dentro de la cámara`);
}

for (const vp of VIEWPORTS) {
  await page.setViewport(vp);
  await chair(vp);
  await mountain(vp);
  await vane(vp);
}

await demo.end();
check(pageErrors.length === 0, `sin errores de página (${pageErrors.slice(0, 3).join(' | ')})`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) process.exit(1);

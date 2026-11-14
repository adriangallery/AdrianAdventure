// Demo de F1 (fondo nuevo de la azotea, hecho por Adrián con su Gem y llevado a 3712×1152 por
// scripts/make-rooftop-bg.py). En móvil apaisado 844×390 y vertical 390×844, partida nueva en rooftop:
//   - Dex anda (clic de WALK; si cae bajo el panel de verbos, se le coloca con teleportPct) a la llegada (`walkTo`) de la
//     puerta, las dos trampillas y la veleta, y se comprueba que llega (≤ 2 % de error) y que el hotspot cae en la
//     cámara (≥ 50 % de su caja en apaisado; en vertical la cámara es estrecha: aviso);
//   - Dex mide lo mismo en las cuatro llegadas (escala fija, A2.13) y Dex/puerta queda en 0,85–1,0 (puerta 39,5–92 %);
//   - con `vane_pushed`, el overlay `vane_flipped` (veleta en espejo) está cargado, visible y dentro de la cámara.
// Deja una captura por punto y tamaño (`<tag>-<hotspot>.png`).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run f1-rooftop
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  { tag: 'port', viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];
const TARGETS = ['hs_roof_door', 'hs_lobbyhatch', 'hs_roof_access_panel', 'hs_weather_vane'];
const DOOR = { top: 39.5, bottom: 92 };

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0].viewport });
const { page } = demo;
const problems = [];
const warn = (cond, msg) => console.log(`${cond ? '✔' : '⚠'} ${msg}${cond ? '' : ' (aviso, no falla)'}`);
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

/** Hotspot: walkTo, qué parte de su caja cae en la cámara; Dex: pies y alto en % del fondo */
const probe = (hsId) => page.evaluate((hid) => {
  const gs = window.__game.scene.getScene('GameScene');
  const v = gs.cameras.main.worldView;
  const json = gs.cache.json.get(`scene_${window.__qa.state().scene}`);
  const hs = json.regions.hotspots.find((h) => h.id === hid);
  const b = gs.bg.getBounds();
  const r = { left: b.x + (hs.bounds.x / 100) * b.width, top: b.y + (hs.bounds.y / 100) * b.height, width: (hs.bounds.w / 100) * b.width, height: (hs.bounds.h / 100) * b.height };
  const ix = Math.max(0, Math.min(r.left + r.width, v.right) - Math.max(r.left, v.left));
  const iy = Math.max(0, Math.min(r.top + r.height, v.bottom) - Math.max(r.top, v.top));
  const st = window.__qa.state();
  return { walkTo: hs.walkTo, inView: (ix * iy) / (r.width * r.height), player: st.player, heightPct: st.pixel?.worldHeightPct ?? null };
}, hsId);

const goTo = async (tag, p) => {
  try {
    await page.evaluate(([x, y]) => window.__qa.walk(x, y), [p.x, p.y]);
  } catch (e) {
    console.log(`  (${tag}: el clic a ${p.x},${p.y} no vale: ${String(e.message).split('\n')[0]}; se coloca a Dex)`);
    await page.evaluate(([x, y]) => window.__game.scene.getScene('GameScene').player.teleportPct(x, y), [p.x, p.y]);
  }
  await page.evaluate(() => window.__qa.dismissAll());
};

for (const [i, { tag, viewport }] of VIEWPORTS.entries()) {
  if (i > 0) await page.setViewport(viewport);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
  await demo.openScene('rooftop');
  await demo.settle({ tap: [Math.round(viewport.width / 2), 40] });
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.still(`${tag}-entrada`);
  const heights = [];
  for (const id of TARGETS) {
    const before = await probe(id);
    await goTo(`${tag} ${id}`, before.walkTo);
    await demo.film(1500);
    const p = await probe(id);
    const err = p.player ? Math.hypot(p.player.x - p.walkTo.x, p.player.y - p.walkTo.y) : 99;
    check(err <= 2, `${tag} ${id}: Dex llega a ${p.walkTo.x},${p.walkTo.y} (está en ${p.player?.x?.toFixed?.(1)},${p.player?.y?.toFixed?.(1)})`);
    (tag === 'land' ? check : warn)(p.inView >= 0.5, `${tag} ${id}: dentro de la cámara (${Math.round(p.inView * 100)} %)`);
    if (p.heightPct) heights.push(p.heightPct);
    await demo.still(`${tag}-${id}`);
  }
  if (heights.length) {
    const lo = Math.min(...heights), hi = Math.max(...heights);
    check(hi - lo < 0.5, `${tag}: escala fija, Dex mide ${lo.toFixed(2)}–${hi.toFixed(2)} % en las ${heights.length} llegadas`);
    const ratio = hi / (DOOR.bottom - DOOR.top);
    check(ratio >= 0.85 && ratio <= 1.0, `${tag}: Dex/puerta ${ratio.toFixed(2)} (0,85–1,0)`);
  }
  // veleta girada
  await goTo(`${tag} veleta`, (await probe('hs_weather_vane')).walkTo);
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'vane_pushed', value: true }]));
  await page.evaluate(() => window.__qa.dismissAll());
  await demo.film(800);
  const ov = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const co = (gs.conditionalOverlays ?? []).find((o) => o.id === 'vane_flipped');
    if (!co) return null;
    const b = co.sprite.getBounds();
    const v = gs.cameras.main.worldView;
    const ix = Math.max(0, Math.min(b.right, v.right) - Math.max(b.left, v.left));
    const iy = Math.max(0, Math.min(b.bottom, v.bottom) - Math.max(b.top, v.top));
    return { visible: co.sprite.visible && co.sprite.alpha > 0.5, inView: (ix * iy) / (b.width * b.height) };
  });
  check(!!ov, `${tag}: overlay vane_flipped cargado`);
  check(ov?.visible, `${tag}: con vane_pushed, vane_flipped visible`);
  (tag === 'land' ? check : warn)((ov?.inView ?? 0) >= 0.75, `${tag}: vane_flipped dentro de la cámara (${Math.round((ov?.inView ?? 0) * 100)} %)`);
  await demo.still(`${tag}-vane_flipped`);
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

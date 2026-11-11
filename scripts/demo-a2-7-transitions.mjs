// Demo de A2.7 (plan SCUMM): transiciones sin pantalla de carga y overlays recortados.
// 1. outside (primera carga, con su pantalla de carga) → espera a que la precarga baje el lobby → graba el cambio
//    outside → lobby (fundido corto, sin pantalla de carga) y la vuelta lobby → outside (ya en Phaser).
// 2. Capturas fijas de cada overlay forzado a la vista (`ov-<escena>-<id>.png`) con la cámara en un punto fijo y el
//    personaje oculto, para compararlas con las de main (misma demo con BASE_URL=https://adventure.adrianzero.com:
//    allí fallan las comprobaciones de transición, pero las capturas salen igual). Más el póster del lobby (web3).
// Comprueba: `lastTransition.loadingScreen === false`, modo `instant` y < 1 s en las dos transiciones, y que cada
// overlay con `bounds` mide y cae exactamente donde dice su caja (±0,5 px).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-7-transitions
import { startDemo } from './lib/demo.mjs';

/** Centro (en % del fondo) de lo que pinta cada overlay; el mismo encuadre antes y después del recorte */
const FOCUS = {
  outside: { mailbox_empty: [60.25, 76.7], lamp_empty: [32.07, 43.72] },
  lobby: { plant_revived: [42.2, 63.8] },
  server_room: { glass_broken: [84.53, 66.0], tiles_open: [48.29, 89.97], lights_out: [50, 50] },
  rooftop: { vane_flipped: [72.83, 54.56] },
  clinic_interior: { no_photo: [48.68, 76.48] },
  upstairs: { no_energy_drink: [45.5, 89.06] },
};

const demo = await startDemo(import.meta.url, { fps: 8 });
const { page } = demo;
const problems = [];
const st = () => page.evaluate(() => window.__qa.state());
const dismiss = () => page.evaluate(() => window.__qa.dismissAll()).catch((e) => problems.push(`dismissAll: ${e.message}`));

/** Cámara quieta centrada en (x %, y %) y sin personaje */
const frame = (x, y) => page.evaluate(({ x, y }) => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  cam.stopFollow();
  gs.player?.setVisible(false);
  const c = gs.coordSystem.pctToScreen(x, y);
  const maxX = Math.max(0, gs.coordSystem.bgW + gs.coordSystem.bgX * 2 - cam.width);
  cam.scrollX = Math.min(maxX, Math.max(0, c.x - cam.width / 2));
}, { x, y });

/** Fuerza un overlay a la vista (el mapa del op flicker) y mide dónde quedó */
const showOverlay = (id, visible) => page.evaluate(({ id, visible }) => {
  const gs = window.__game.scene.getScene('GameScene');
  if (visible === null) gs.overlayOverrides.delete(id); else gs.overlayOverrides.set(id, visible);
  const co = gs.conditionalOverlays.find((o) => o.id === id);
  if (!co) return null;
  const b = co.sprite.getBounds();
  const src = co.sprite.texture.getSourceImage();
  const conf = gs.registry.get('sceneData').conditionalOverlays.find((o) => o.id === id);
  let expected = null;
  if (conf.bounds) {
    const a = gs.coordSystem.pctToScreen(conf.bounds.x, conf.bounds.y);
    const z = gs.coordSystem.pctToScreen(conf.bounds.x + conf.bounds.w, conf.bounds.y + conf.bounds.h);
    expected = { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
  }
  return { tex: { w: src.width, h: src.height }, bounds: conf.bounds ?? null, got: { x: b.x, y: b.y, w: b.width, h: b.height }, expected };
}, { id, visible });

async function shootOverlays(scene) {
  for (const [id, [x, y]] of Object.entries(FOCUS[scene] ?? {})) {
    await frame(x, y);
    const m = await showOverlay(id, true);
    await demo.sleep(250);
    await demo.still(`ov-${scene}-${id}`);
    for (let i = 0; i < 3; i++) await demo.shot();
    await showOverlay(id, null);
    if (!m) { problems.push(`${scene}: no hay overlay ${id}`); continue; }
    console.log(`overlay ${scene}.${id}: textura ${m.tex.w}x${m.tex.h} · bounds ${JSON.stringify(m.bounds)} · en pantalla ${JSON.stringify(m.got)}`);
    if (m.expected) {
      const off = Math.max(...['x', 'y', 'w', 'h'].map((k) => Math.abs(m.got[k] - m.expected[k])));
      if (off > 0.5) problems.push(`${scene}.${id} cae a ${off.toFixed(2)} px de su caja`);
    }
  }
}

// 1. Primera carga y precarga
await demo.openScene('outside');
await dismiss();
const first = (await st()).lastTransition;
console.log(`primera carga: ${JSON.stringify(first)}`);
await shootOverlays('outside');
await frame(50, 70);
await page.evaluate(() => window.__game.scene.getScene('GameScene').player?.setVisible(true));
await page.waitForFunction(() => {
  const pf = window.__qa.state().prefetch;
  return !!pf && pf.scene === 'outside' && !pf.inFlight && pf.pending.length === 0 && pf.done.some((u) => u.startsWith('assets/scenes/lobby/background@'));
}, { timeout: 60000, polling: 250 }).catch(() => problems.push('la precarga no bajó el lobby en 60 s'));
console.log(`precarga: ${JSON.stringify((await st()).prefetch)}`);

// 2. outside → lobby grabado
for (let i = 0; i < 4; i++) await demo.shot();
await page.evaluate(() => { window.__qa.goto('lobby').catch(() => {}); });
await demo.film(1600);
await page.waitForFunction(() => window.__qa.state().lastTransition?.to === 'lobby', { timeout: 30000, polling: 100 }).catch(() => {});
const toLobby = (await st()).lastTransition;
console.log(`outside → lobby: ${JSON.stringify(toLobby)}`);
await dismiss();

// Póster web3 y planta del lobby
const poster = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const hs = gs.registry.get('sceneData').regions.hotspots.find((h) => h.id === 'hs_poster');
  return { x: hs.bounds.x + hs.bounds.w / 2, y: hs.bounds.y + hs.bounds.h / 2 };
});
await frame(poster.x, poster.y);
await demo.sleep(250);
await demo.still('ov-lobby-poster');
await shootOverlays('lobby');
await page.evaluate(() => window.__game.scene.getScene('GameScene').player?.setVisible(true));

// 3. lobby → outside (segunda vez) grabado
await demo.sleep(1500);
for (let i = 0; i < 4; i++) await demo.shot();
await page.evaluate(() => { window.__qa.goto('outside').catch(() => {}); });
await demo.film(1600);
await page.waitForFunction(() => window.__qa.state().lastTransition?.to === 'outside' && window.__qa.state().lastTransition?.from === 'lobby', { timeout: 30000, polling: 100 }).catch(() => {});
const back = (await st()).lastTransition;
console.log(`lobby → outside: ${JSON.stringify(back)}`);
await dismiss();
await demo.still('vuelta-outside');

// 4. El resto de escenas con overlays
for (const scene of ['server_room', 'rooftop', 'clinic_interior', 'upstairs']) {
  await demo.openScene(scene);
  await dismiss();
  await shootOverlays(scene);
}

await demo.end();
console.log(`${demo.frames} frames`);
for (const [name, t] of [['outside → lobby', toLobby], ['lobby → outside', back]]) {
  if (!t) problems.push(`${name}: sin lastTransition (¿build sin A2.7?)`);
  else {
    if (t.loadingScreen !== false) problems.push(`${name} pasó por la pantalla de carga`);
    if (t.mode !== 'instant') problems.push(`${name}: modo ${t.mode}, se esperaba instant`);
    if (!(t.ms < 1000)) problems.push(`${name} tardó ${t.ms} ms (máx. 1000)`);
  }
}
if (problems.length) await demo.fail(problems.join(' | '));

// Demo de A3.3g («los 8 hotspots de puzle dudosos de A3.3f, reconocibles a tamaño móvil»), en móvil apaisado 844×390 y
// vertical 390×844. En cada una de las 8 escenas, Dex anda hasta el punto andable más cercano al hotspot y se comprueba:
//   - que el hotspot cae dentro de la cámara (≥ 50 % de su caja; en vertical la cámara es estrecha) y mide algo en pantalla;
//   - que el overlay nuevo de make-hotspot-props.mjs (si lo hay) está cargado, visible y dentro de la cámara (≥ 75 %);
//   - que al cambiar la flag (coger el Ledger, levantar las baldosas, coger la nota, abrir la puerta) el overlay cambia
//     de estado como mailbox_empty/nest_down: se va, o deja sitio a su variante.
// Deja una captura recortada del hotspot por escena y tamaño (`<tag>-<escena>.png`) para la hoja antes/después.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-3g-hotspots
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { tag: 'land', viewport: { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  { tag: 'port', viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

// escena, hotspot, overlay que se ve al entrar, flag que lo cambia y overlay que sale después (null = ninguno)
const CASES = [
  { scene: 'outside', hs: 'hs_doormat', overlay: 'doormat_lump', flag: 'found_ledger', after: 'doormat_peeled' },
  { scene: 'server_room', hs: 'hs_raised_floor', overlay: 'tile_lifted', flag: 'tiles_opened', after: 'tiles_open' },
  { scene: 'rooftop', hs: 'hs_roof_access_panel' },
  { scene: 'upstairs', hs: 'hs_roof_hatch' },
  { scene: 'treatment_room', hs: 'hs_adrian_note', overlay: 'note_folded', flag: 'found_adrian_note', after: null },
  { scene: 'epilogue_outside', hs: 'hs_path_forward' },
  { scene: 'basement', hs: 'hs_stairs' },
  // En vertical la cámara no llega a la puerta (x 0–4,6 %): la zona andable empieza en x 11,9 y la cámara sigue a Dex.
  // Conocido y apuntado en docs/progreso/A3.3g.md (arreglarlo es tocar cámara o zona andable, fuera de A3.3g): aviso.
  { scene: 'recovery_pool', hs: 'hs_dark_door', overlay: 'door_closed', flag: 'dark_door_opened', after: 'door_open', knownOff: ['port'] },
];

const demo = await startDemo(import.meta.url, { fps: 4, width: 640, viewport: VIEWPORTS[0].viewport });
const { page } = demo;
const problems = [];
const warn = (cond, msg) => console.log(`${cond ? '✔' : '⚠'} ${msg}${cond ? '' : ' (conocido, no falla)'}`);
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

/** Caja del hotspot en pantalla (px CSS), qué parte cae en la cámara y el estado de un overlay */
const probe = (hsId, ovId) => page.evaluate(([hid, oid]) => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  const v = cam.worldView;
  const bg = gs.bg; // el fondo de la escena (no el relleno oscuro del letterbox, que también va en depth -1)
  const sceneId = window.__qa.state().scene;
  const json = gs.cache.json.get(`scene_${sceneId}`);
  const hs = json?.regions?.hotspots?.find((h) => h.id === hid);
  const out = { hs: null, ov: null };
  const toScreen = (r) => ({ x: (r.left - v.x) * cam.zoom + cam.x, y: (r.top - v.y) * cam.zoom + cam.y, w: r.width * cam.zoom, h: r.height * cam.zoom });
  const inView = (r) => {
    const ix = Math.max(0, Math.min(r.right, v.right) - Math.max(r.left, v.left));
    const iy = Math.max(0, Math.min(r.bottom, v.bottom) - Math.max(r.top, v.top));
    return r.width * r.height > 0 ? (ix * iy) / (r.width * r.height) : 0;
  };
  if (hs && bg) {
    const b = bg.getBounds();
    const r = { left: b.x + (hs.bounds.x / 100) * b.width, top: b.y + (hs.bounds.y / 100) * b.height, width: (hs.bounds.w / 100) * b.width, height: (hs.bounds.h / 100) * b.height };
    r.right = r.left + r.width; r.bottom = r.top + r.height;
    out.hs = { inView: inView(r), screen: toScreen(r) };
  }
  if (oid) {
    const co = (gs.conditionalOverlays ?? []).find((o) => o.id === oid);
    if (co) {
      const b = co.sprite.getBounds();
      out.ov = { visible: co.sprite.visible && co.sprite.alpha > 0.5, inView: inView(b), screen: toScreen(b), depth: co.sprite.depth };
    } else out.ov = { missing: true };
  }
  return out;
}, [hsId, ovId ?? null]);

/** Punto andable más cercano a la derecha del hotspot (busca en una rejilla de 1 %) */
const nearestWalkable = (hsId) => page.evaluate((hid) => {
  const gs = window.__game.scene.getScene('GameScene');
  const json = gs.cache.json.get(`scene_${window.__qa.state().scene}`);
  const b = json.regions.hotspots.find((h) => h.id === hid).bounds;
  // A la derecha del hotspot (no encima): en los objetos del suelo Dex los taparía en la captura
  const cx = Math.min(97, b.x + b.w + 5), cy = b.y + b.h / 2;
  let best = null, bd = Infinity;
  for (let x = 0.5; x < 100; x += 1) for (let y = 40.5; y < 100; y += 1) {
    if (!window.__qa.isWalkable(x, y)) continue;
    const d = (x - cx) ** 2 + 0.3 * (y - cy) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}, hsId);

for (const [i, { tag, viewport }] of VIEWPORTS.entries()) {
  if (i > 0) await page.setViewport(viewport);
  for (const c of CASES) {
    // Partida nueva en cada escena (la primera vez la página aún está en about:blank y no hay almacenamiento)
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
    await demo.openScene(c.scene);
    await demo.settle({ tap: [Math.round(viewport.width / 2), 40] });
    await page.evaluate(() => window.__qa.dismissAll());
    const spot = await nearestWalkable(c.hs);
    check(!!spot, `${tag} ${c.scene}: punto andable junto a ${c.hs} ${JSON.stringify(spot)}`);
    // El clic para andar puede caer bajo el panel de verbos (vertical): entonces Dex se queda donde aparece
    if (spot) await page.evaluate(([x, y]) => window.__qa.walk(x, y), spot).catch((e) => console.log(`  (${tag} ${c.scene}: no anda a ${spot}: ${String(e.message).split('\n')[0]})`));
    await page.evaluate(() => window.__qa.dismissAll());
    await demo.film(1200);
    const p = await probe(c.hs, c.overlay);
    const known = c.knownOff?.includes(tag);
    (known ? warn : check)(p.hs && p.hs.inView >= 0.5, `${tag} ${c.scene}: ${c.hs} dentro de la cámara (${Math.round((p.hs?.inView ?? 0) * 100)} %)`);
    if (p.hs) {
      const s = p.hs.screen;
      console.log(`  ${tag} ${c.scene}: ${c.hs} mide ${Math.round(s.w)}×${Math.round(s.h)} px en pantalla`);
      const pad = 30;
      const clip = { x: Math.max(0, s.x - pad), y: Math.max(0, s.y - pad) };
      clip.width = Math.max(10, Math.min(viewport.width, s.x + s.w + pad) - clip.x);
      clip.height = Math.max(10, Math.min(viewport.height, s.y + s.h + pad) - clip.y);
      await demo.still(`${tag}-${c.scene}`, { clip });
    }
    await demo.still(`${tag}-${c.scene}-full`);
    if (c.overlay) {
      check(p.ov && !p.ov.missing, `${tag} ${c.scene}: overlay ${c.overlay} cargado`);
      check(p.ov?.visible, `${tag} ${c.scene}: ${c.overlay} visible`);
      (known ? warn : check)((p.ov?.inView ?? 0) >= 0.75, `${tag} ${c.scene}: ${c.overlay} dentro de la cámara (${Math.round((p.ov?.inView ?? 0) * 100)} %)`);
      check(Math.min(p.ov?.screen?.w ?? 0, p.ov?.screen?.h ?? 0) >= 8, `${tag} ${c.scene}: ${c.overlay} mide ${Math.round(p.ov?.screen?.w ?? 0)}×${Math.round(p.ov?.screen?.h ?? 0)} px en pantalla`);
      // Lo que está en el suelo va por debajo de Dex (sus depth empiezan en 9)
      check((p.ov?.depth ?? 99) < 9, `${tag} ${c.scene}: ${c.overlay} por debajo de Dex (depth ${p.ov?.depth})`);
      await page.evaluate((flag) => window.__qa.runScript([{ op: 'setFlag', flag, value: true }]), c.flag);
      await page.evaluate(() => window.__qa.dismissAll());
      await demo.film(600);
      const q = await probe(c.hs, c.overlay);
      check(q.ov && !q.ov.visible, `${tag} ${c.scene}: con ${c.flag}, ${c.overlay} se va`);
      if (c.after) {
        const a = await probe(c.hs, c.after);
        check(a.ov?.visible, `${tag} ${c.scene}: con ${c.flag}, sale ${c.after}`);
      }
      await demo.still(`${tag}-${c.scene}-despues`);
    }
  }
}
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

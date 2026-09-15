// Demo de A1.3 (regla visual del plan SCUMM): el póster del lobby a la izquierda de COATS.
// Antes, quien no es holder veía un rectángulo lila vacío (`poster_generic.png` era un placeholder
// liso de 32x48). Ahora ve un póster arrancado con pixel art; los holders siguen viendo el suyo.
// Comprueba además que el overlay de la planta del lobby se carga en la primera visita (mismo fallo
// de carga en PreloadScene).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a1-3-poster-lobby
import { startDemo } from './lib/demo.mjs';

const SCENE = 'lobby';
const demo = await startDemo(import.meta.url, { fps: 4 });
const { page } = demo;
const warnings = [];
page.on('console', (m) => { if (/Web3VisualSystem|not found/i.test(m.text())) warnings.push(m.text()); });

await demo.openScene(SCENE);
// Cerrar textos de entrada hasta que la escena quede libre
await demo.settle();

// Centrar la cámara en el póster
const info = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  const cam = gs.cameras.main;
  cam.stopFollow();
  const sprite = gs.web3VisualSystem?.sprites?.get('vip_poster');
  const hs = gs.registry.get('sceneData').regions.hotspots.find((h) => h.id === 'hs_poster');
  const a = gs.coordSystem.pctToScreen(hs.bounds.x, hs.bounds.y);
  const b = gs.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w, hs.bounds.y + hs.bounds.h);
  cam.scrollX = Math.max(0, (a.x + b.x) / 2 - cam.width / 2);
  const src = sprite ? sprite.texture.getSourceImage() : null;
  const bounds = sprite ? sprite.getBounds() : null;
  return {
    hasSprite: !!sprite,
    key: sprite?.texture.key,
    visible: sprite?.visible,
    alpha: sprite?.alpha,
    tex: src ? { w: src.width, h: src.height } : null,
    // el sprite debe caer dentro del hotspot del póster (tolerancia 3 px)
    inHotspot: bounds
      ? bounds.x >= a.x - 3 && bounds.y >= a.y - 3 && bounds.right <= b.x + 3 && bounds.bottom <= b.y + 3
      : false,
    plantOverlay: gs.textures.exists('overlay_lobby_plant_revived'),
    variants: ['poster_adrianpunks', 'poster_adrianzero'].filter((k) => gs.textures.exists(k)),
  };
});
await demo.sleep(500);
for (let i = 0; i < 8; i++) await demo.shot();
await demo.still('full');

// Para comparar en el GIF: lo que ven los holders (cambio de textura simulado, sin wallet)
for (const key of ['poster_adrianpunks', 'poster_adrianzero', 'poster_generic']) {
  await page.evaluate((k) => {
    const gs = window.__game.scene.getScene('GameScene');
    const sprite = gs.web3VisualSystem.sprites.get('vip_poster');
    const v = gs.registry.get('sceneData').web3Visuals.find((w) => w.id === 'vip_poster');
    sprite.setTexture(k);
    gs.web3VisualSystem.resizeSprite(v, sprite);
  }, key);
  await demo.sleep(300);
  for (let i = 0; i < 6; i++) await demo.shot();
}

await demo.end();
console.log(`póster ${JSON.stringify(info)} · avisos ${JSON.stringify(warnings)} · ${demo.frames} frames`);

if (!info.hasSprite) await demo.fail('No hay sprite vip_poster en el lobby');
if (info.key !== 'poster_generic' || !info.visible || info.alpha < 0.99) await demo.fail('El póster por defecto no se ve');
if (!info.tex || (info.tex.w === 32 && info.tex.h === 48)) await demo.fail('Sigue el placeholder lila de 32x48');
if (!info.inHotspot) await demo.fail('El póster no cae dentro de hs_poster');
if (info.variants.length !== 2) await demo.fail(`Faltan variantes de holder: ${info.variants}`);
if (!info.plantOverlay) await demo.fail('overlay_lobby_plant_revived no se cargó en la primera visita');
if (warnings.length) await demo.fail(`Avisos de sprites que faltan: ${warnings.join(' | ')}`);

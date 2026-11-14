// Demo de A2.19 (lo que sale en una pantalla, que salga en la pantalla), en 1280x720 (escritorio), 844x390 (móvil
// apaisado) y 390x844 (vertical). Para cada tamaño:
//   1. basement: el combo de la caja de disquetes con el CRT (el caso de Adrián) tal cual está en scene.json. Cuando sale
//      «ADRIANLAB FLOPPY COLLECTION DETECTED…» se graba el tecleo y se captura la pantalla entera y el CRT ampliado
//      (`<vp>-crt.png`, `<vp>-crt-zoom.png`); si en ese viewport el CRT no se lee, tiene que haber salido el primer
//      plano (`<vp>-crt-closeup.png`). Comprueba que la línea salió en la pantalla `crt` (o en su primer plano por
//      «small») y que el texto hablado (subtítulo) es el mismo de siempre, en modo discreto.
//   2. upstairs: el cajón de los Términos (árbol tos_drawer): primer plano a pantalla completa (`<vp>-terms-closeup.png`)
//      que se cierra con Esc.
//   3. server_room: el log de PZ-BOT con `closeup: true` (primer plano forzado) y una línea corta en el terminal.
//   4. A2.19b: barrido de TODAS las pantallas de las 7 escenas con Dex debajo: falla si una pantalla con texto queda
//      cortada por la cámara (o a < 11 px efectivos) sin primer plano (`<vp>-sweep-<escena>-<pantalla>.png`).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-19-screens
import { startDemo } from './lib/demo.mjs';

const VIEWPORTS = [
  { id: '1280x720', width: 1280, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  { id: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];

/** A2.19b: escenas con pantallas dibujadas (auditoría de A2.19) */
const SWEEP_SCENES = ['basement', 'server_room', 'upstairs', 'lobby', 'clinic_interior', 'memelab', 'treatment_room'];

const demo = await startDemo(import.meta.url, { fps: 6, width: 640, viewport: VIEWPORTS[0] });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

const screenQa = () => page.evaluate(() => window.__game.scene.getScene('GameScene').getScreenQa());
const speech = () => page.evaluate(() => window.__game.scene.getScene('UIScene').getSpeech());
const tap = () => page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());

async function free() {
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__qa.dismissAll());
    const st = await demo.state();
    if (!st.script && !st.dialogue) return true;
    await demo.sleep(400);
  }
  return false;
}

async function open(scene, vp) {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* nada */ } });
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (vp.hasTouch) await demo.settle({ tap: [Math.round(vp.width / 2), 40] });
  if (!(await free())) await demo.fail(`${vp.id}: ${scene} no quedó libre al entrar`);
}

/** Rectángulo de página (px) de una caja en % del fondo */
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
  const pad = 12;
  const [x0, y0] = toPage(b.x, b.y);
  const [x1, y1] = toPage(b.x + b.w, b.y + b.h);
  const cx0 = Math.max(0, Math.round(x0) - pad), cy0 = Math.max(0, Math.round(y0) - pad);
  const cx1 = Math.min(window.innerWidth, Math.round(x1) + pad), cy1 = Math.min(window.innerHeight, Math.round(y1) + pad);
  return { x: cx0, y: cy0, width: Math.max(0, cx1 - cx0), height: Math.max(0, cy1 - cy0) };
}, box);

/** Lanza un script (sin esperar) y avanza sus textos con toques hasta que `until` (en el navegador) se cumple */
async function runUntil(ops, until, label, maxTaps = 25) {
  await page.evaluate((o) => { window.__demoRun = window.__game.scene.getScene('GameScene').qaRunScript(o); }, ops);
  for (let i = 0; i < maxTaps; i++) {
    await demo.film(900);
    if (await page.evaluate(until)) return true;
    if (await page.evaluate(() => !!window.__game.registry.get('screenCloseupOpen'))) return false;
    await tap();
  }
  console.error(`(no llegó a ${label})`);
  return false;
}

for (const vp of VIEWPORTS) {
  const tag = vp.id;
  await page.setViewport(vp);

  // ── 1. basement: el CRT de Adrián ──
  await open('basement', vp);
  const crt = await page.evaluate(() => window.__game.scene.getScene('GameScene').sceneDataLoader.getSceneData().screens?.crt ?? null);
  check(!!crt, `${tag}: basement declara la pantalla crt`);
  // Cámara sobre el CRT (Dex junto a la mesa)
  await page.evaluate(() => window.__game.scene.getScene('GameScene').player.teleportPct(50, 88));
  await demo.film(600);
  const combo = await page.evaluate(() => window.__game.scene.getScene('GameScene').sceneDataLoader.getSceneData().combos.find((c) => c.items.includes('floppy_box') && c.items.includes('hs_main_computer'))?.script ?? null);
  check(!!combo, `${tag}: combo caja de disquetes + CRT`);
  const reached = await runUntil(combo, () => {
    const q = window.__game.scene.getScene('GameScene').getScreenQa();
    return !!q.last && q.last.display.startsWith('ADRIANLAB FLOPPY');
  }, 'ADRIANLAB FLOPPY');
  let q = await screenQa();
  if (reached || q.closeup.open) {
    check(q.last?.id === 'crt', `${tag}: «ADRIANLAB FLOPPY COLLECTION DETECTED» va a la pantalla crt (${q.last?.mode}${q.last?.reason ? `, ${q.last.reason}` : ''})`);
    await demo.film(2600); // tecleo
    q = await screenQa();
    const sp = await speech();
    if (q.last?.mode === 'screen') {
      check((q.inScene?.shown ?? '').replace(/\s+/g, ' ').includes('HOLDER OVERRIDE'), `${tag}: el CRT enseña el texto dentro (${q.inScene?.fontPx} px de mundo, ${q.inScene?.rows} filas${q.inScene?.overflow ? ', con scroll' : ''})`);
      check(!!sp && sp.discreet === true, `${tag}: el subtítulo sigue (accesibilidad y voz), en modo discreto`);
      check(!!sp && String(sp.text ?? '').startsWith("'ADRIANLAB FLOPPY"), `${tag}: el texto hablado no cambia`);
      await demo.still(`${tag}-crt`);
      const r = await pageRect(crt.bounds);
      if (r.width > 0 && r.height > 0) await demo.still(`${tag}-crt-zoom`, { clip: r });
    } else {
      check(q.closeup.open, `${tag}: el CRT no se lee aquí y sale el primer plano (${q.last?.reason})`);
      await demo.still(`${tag}-crt-closeup`);
    }
  } else check(false, `${tag}: no salió la línea del CRT`);
  // El resto del combo: el mensaje de Adrián y la última línea (el CRT acumula como una terminal)
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => !!window.__game.registry.get('screenCloseupOpen'))) {
      await demo.film(1200);
      await page.keyboard.press('Escape');
    } else await tap();
    await demo.film(900);
    if (!(await demo.state()).script) break;
  }
  q = await screenQa();
  check(q.log.some((e) => e.display.startsWith('COMPRESSION RATIO')), `${tag}: la última línea («COMPRESSION RATIO…») también salió en el CRT`);
  if (q.inScene) await demo.still(`${tag}-crt-final`);
  check(!q.closeup.open, `${tag}: el primer plano está cerrado al acabar`);
  await free();

  // ── 2. upstairs: los Términos del cajón, en primer plano ──
  await open('upstairs', vp);
  await page.evaluate(() => { window.__demoRun = window.__game.scene.getScene('GameScene').qaRunScript([{ op: 'dialogue', treeId: 'tos_drawer' }]); });
  let opened = false;
  for (let i = 0; i < 20 && !opened; i++) {
    await demo.film(400);
    opened = await page.evaluate(() => !!window.__game.registry.get('screenCloseupOpen'));
  }
  check(opened, `${tag}: los Términos del cajón abren el primer plano`);
  if (!opened) {
    const dbg = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      const ui = window.__game.scene.getScene('UIScene');
      return { screen: gs.getScreenQa(), speech: ui.getSpeech(), dialogueActive: window.__game.registry.get('dialogueActive'), screens: Object.keys(gs.sceneDataLoader.getSceneData().screens ?? {}), node: gs.sceneDataLoader.getSceneData().dialogues?.tos_drawer?.nodes?.screen };
    });
    console.log(`  depuración: ${JSON.stringify(dbg).slice(0, 900)}`);
  }
  if (opened) {
    await demo.film(1800);
    q = await screenQa();
    check(q.closeup.screen === 'drawer_lock' && /TERMS AND CONDITIONS/.test(q.closeup.text ?? ''), `${tag}: primer plano drawer_lock con «TERMS AND CONDITIONS» (${q.closeup.reason})`);
    const fits = await page.evaluate(() => { const b = document.getElementById('scrclose-bezel')?.getBoundingClientRect(); return b ? b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight : false; });
    check(fits, `${tag}: el primer plano cabe en el viewport`);
    const font = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('scrclose-text')).fontSize));
    check(font >= 11, `${tag}: letra del primer plano ≥ 11 px (${font})`);
    await demo.still(`${tag}-terms-closeup`);
    await page.keyboard.press('Escape');
    await demo.film(600);
    check(!(await page.evaluate(() => !!window.__game.registry.get('screenCloseupOpen'))), `${tag}: Esc cierra el primer plano`);
  }
  // El árbol sigue con sus opciones: «Never mind» (la despedida de Dex se cierra con un toque)
  for (let i = 0; i < 20; i++) {
    const picked = await page.evaluate(() => {
      const panel = window.__game.scene.getScene('UIScene').getChoicePanel();
      if (!panel.isAwaitingChoice()) return false;
      const idx = panel.getOptions().findIndex((o) => /never mind/i.test(o.text));
      return idx >= 0 ? panel.choose(idx) : false;
    });
    if (picked) break;
    if (await page.evaluate(() => !!window.__game.registry.get('screenCloseupOpen'))) await page.keyboard.press('Escape');
    else await tap();
    await demo.sleep(400);
  }
  await free();

  // ── 3. server_room: log de PZ-BOT (primer plano forzado) y una línea corta en el terminal ──
  await open('server_room', vp);
  await page.evaluate(() => window.__game.scene.getScene('GameScene').player.teleportPct(48, 88));
  await demo.film(500);
  await runUntil([{ op: 'say', speaker: 'PZ-BOT', text: 'GERALD. GERALD. ALL IN.', screen: 'terminal' }], () => {
    const q = window.__game.scene.getScene('GameScene').getScreenQa();
    return !!q.last && q.last.display.includes('GERALD');
  }, 'GERALD');
  await demo.film(1500);
  q = await screenQa();
  check(q.last?.id === 'terminal', `${tag}: PZ-BOT escribe en el terminal (${q.last?.mode}${q.last?.reason ? `, ${q.last.reason}` : ''})`);
  await demo.still(`${tag}-terminal`);
  if (q.closeup.open) await page.keyboard.press('Escape');
  await free();

  // ── 4. A2.19b: TODAS las pantallas de la auditoría. Ninguna se teclea en la escena cortada por la cámara ni a menos de
  //       11 px efectivos: o cabe entera y se lee, o sale el primer plano. Dex se pone debajo de cada pantalla. ──
  for (const sceneId of SWEEP_SCENES) {
    await open(sceneId, vp);
    const screens = await page.evaluate(() => window.__game.scene.getScene('GameScene').sceneDataLoader.getSceneData().screens ?? {});
    for (const [id, def] of Object.entries(screens)) {
      if (def.closeupOnly) continue;
      const cx = Math.min(95, Math.max(5, def.bounds.x + def.bounds.w / 2));
      await page.evaluate((x) => window.__game.scene.getScene('GameScene').player.teleportPct(x, 88), cx);
      await demo.sleep(1500); // la cámara llega
      await page.evaluate((sid) => { window.__demoRun = window.__game.scene.getScene('GameScene').qaRunScript([{ op: 'say', text: "'SCREEN CHECK 0123'", screen: sid }]); }, id);
      await demo.sleep(1400);
      const sq = await screenQa();
      const last = sq.last;
      const eff = sq.inScene ? Math.round(sq.inScene.fontPx * (last?.vp?.zoom ?? 1) * 10) / 10 : null;
      const sp = await speech();
      const label = `${tag} ${sceneId}.${id}`;
      if (last?.id !== id) check(false, `${label}: no salió la línea de prueba`);
      else if (last.mode === 'closeup') check(sq.closeup.open, `${label}: primer plano (${last.reason}; caja ${JSON.stringify(last.vp?.screen)} en vista ${JSON.stringify(last.vp?.view)})`);
      else {
        check(last.vp?.fits === true, `${label}: la pantalla cabe entera en la cámara (caja ${JSON.stringify(last.vp?.screen)}, vista ${JSON.stringify(last.vp?.view)})`);
        check(eff !== null && eff >= 10.5, `${label}: letra en la escena ≥ 11 px efectivos (${eff})`);
        check(!!sp && sp.discreet === true && sp.mode === 'caption', `${label}: subtítulo discreto en modo caption (${sp?.mode})`);
      }
      if (tag !== '1280x720' || id === 'crt') await demo.still(`${tag}-sweep-${sceneId}-${id}`);
      if (sq.closeup.open) await page.keyboard.press('Escape');
      await free();
    }
  }
}

await demo.end();
check(pageErrors.length === 0, `sin errores de página (${pageErrors.slice(0, 3).join(' | ')})`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) process.exit(1);

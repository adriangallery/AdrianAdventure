// A2.17 (fase 1): revisor de proporción y profundidad. Para cada escena con assets/scenes/<escena>/scale-refs.json:
//   - pone a Dex (?qa=1, player.teleportPct) en una rejilla de la zona andable, en la llegada de cada hotspot/NPC y
//     junto a cada referencia (scripts/lib/proportion-sweep.mjs: sweepPoints);
//   - mide en el juego: pies reales, caja de Dex en % del fondo, alto en pantalla (state().pixel), qa.isWalkable en los
//     pies, walkmask (si la hay) y cuánto de Dex tapa foreground.png (alfa del primer plano sobre su caja, por referencia);
//   - evalúa (evaluatePosition): escala frente a la referencia de la misma línea de suelo (> 15 % = fallo; informativo en
//     scalePolicy fixed), pies en suelo, tapado de primer plano (occlusion) y primer plano que tapa estando delante (overdraw).
// Salida: qa/proporcion/<escena>.json (determinista: sin horas) y, en OUT (por defecto demo-out/proporcion), una captura
// recortada por posición con fallo y la hoja de contactos <escena>.png con las 12 peores + resumen.png (5 peores por escena).
// Modo informe por defecto (exit 0). --strict: exit 1 si hay fallos que no estén en qa/proporcion-baseline.json.
// --write-baseline: reescribe la base con los fallos de ahora. --scenes a,b: solo esas escenas.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/proportion-sweep.mjs [--strict] [--scenes outside,lobby] [--out DIR]
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadScaleRefs, loadSceneJson, sweepPoints, evaluatePosition, summarize, newFailures, failureKey } from './lib/proportion-sweep.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const OUT = resolve(opt('--out', process.env.PROPORCION_OUT || join(ROOT, 'demo-out/proporcion')));
const JSON_DIR = join(ROOT, 'qa/proporcion');
const BASELINE = join(ROOT, 'qa/proporcion-baseline.json');
const VP = { width: 844, height: 390 };
const only = opt('--scenes', '')?.split(',').filter(Boolean);
const scenes = readdirSync(join(ROOT, 'assets/scenes'))
  .filter((s) => existsSync(join(ROOT, 'assets/scenes', s, 'scale-refs.json')))
  .filter((s) => !only?.length || only.includes(s))
  .sort();

mkdirSync(OUT, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --reeval: no abre el navegador; vuelve a evaluar las medidas guardadas en qa/proporcion/<escena>.json con la lógica
// actual (para ajustar umbrales o referencias sin repetir el barrido) y rehace hojas y base
const REEVAL = flag('--reeval');
const { default: puppeteer } = REEVAL ? { default: null } : await import('puppeteer');
const browser = REEVAL ? null : await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = REEVAL ? null : await browser.newPage();
const pageErrors = [];
if (page) {
  await page.setViewport({ ...VP, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
}

/** Medidas guardadas → posiciones evaluadas de nuevo (las NPC se rehacen con el alto que se midió entonces) */
function reevaluate(scene, refsDoc) {
  const old = JSON.parse(readFileSync(join(JSON_DIR, `${scene}.json`), 'utf8'));
  return old.positions.map((p) => {
    const m = { x: p.x, y: p.y, feetX: p.feet.x, feetY: p.feet.y, box: p.dexBox, heightPct: p.heightPct, walkable: p.walkable, maskOk: p.maskOk, cover: p.cover || {} };
    const npcRefs = (refsDoc.refs || []).filter((r) => r.npc && p.scale?.ref === r.id).map((r) => ({ ...r, heightPct: (p.scale.expected * r.realHeightM) / (refsDoc.dexHeightM || 1.75) }));
    const ev = evaluatePosition(m, refsDoc, npcRefs);
    return { ...p, scale: ev.scale, failures: ev.failures, info: ev.info, score: ev.score };
  });
}

async function openScene(scene) {
  await page.goto(`${BASE_URL}/?qa=1&scene=${scene}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id && !!window.__qa,
    { timeout: 90000, polling: 500 }, scene);
  // Deja la escena libre (cinemática o diálogo de entrada) tocando arriba, como demo.settle
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 4; i++) {
    const busy = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      return !!gs.scriptEngine?.isRunning?.() || !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive');
    });
    if (busy) { quiet = 0; await page.touchscreen.tap(Math.round(VP.width / 2), 40); } else quiet++;
    await sleep(500);
  }
  // Máscaras (primer plano y walkmask) en canvas de la página, para medir alfa y color sin dependencias
  await page.evaluate(async (id) => {
    const load = (f) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        res({ w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data });
      };
      img.onerror = () => res(null);
      img.src = `/assets/scenes/${id}/${f}`;
    });
    const sd = window.__game.registry.get('sceneData');
    window.__sweepMasks = {
      fg: sd?.assets?.foreground ? await load(sd.assets.foreground) : null,
      walk: sd?.assets?.walkmask ? await load(sd.assets.walkmask) : null,
      layers: sd?.foregroundLayers ?? [],
    };
  }, scene);
}

/** Coloca a Dex y lo mide todo en la página */
async function measureAt(x, y, refs) {
  await page.evaluate((x, y) => {
    const gs = window.__game.scene.getScene('GameScene');
    gs.player.teleportPct(x, y);
    gs.player.setVisible(true);
  }, x, y);
  await sleep(700);
  return page.evaluate((refs) => {
    const gs = window.__game.scene.getScene('GameScene');
    const cs = gs.coordSystem;
    const p = gs.player;
    const b = p.getBounds();
    const tl = cs.screenToPct(b.x, b.y);
    const br = cs.screenToPct(b.right, b.bottom);
    const box = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    const cam = gs.cameras.main;
    const toScreen = (wx, wy) => ({ x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom });
    const s0 = toScreen(b.x, b.y);
    const s1 = toScreen(b.right, b.bottom);
    const pix = window.__qa.state().pixel;
    const M = window.__sweepMasks || {};
    // A2.17 fase 2: trozos del primer plano con walk-behind (foregroundLayers) que quedan DETRÁS de Dex (sus pies por
    // debajo de la base del trozo, como ordena GameScene por actorDepth): esos píxeles no le tapan
    const behindDex = (M.layers || []).filter((l) => p.pctY >= l.baseY).map((l) => l.bounds);
    const inBehind = (px, py) => behindDex.some((b) => px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h);
    // Fracción de un rectángulo (en %) donde el primer plano es opaco (y se dibuja por encima de Dex)
    const alphaFrac = (r) => {
      const fg = M.fg;
      if (!fg || r.w <= 0 || r.h <= 0) return 0;
      const x0 = Math.max(0, Math.floor((r.x / 100) * fg.w)); const x1 = Math.min(fg.w, Math.ceil(((r.x + r.w) / 100) * fg.w));
      const y0 = Math.max(0, Math.floor((r.y / 100) * fg.h)); const y1 = Math.min(fg.h, Math.ceil(((r.y + r.h) / 100) * fg.h));
      const sx = Math.max(1, Math.floor((x1 - x0) / 40)); const sy = Math.max(1, Math.floor((y1 - y0) / 60));
      let n = 0; let on = 0;
      for (let yy = y0; yy < y1; yy += sy) for (let xx = x0; xx < x1; xx += sx) { n++; if (fg.data[(yy * fg.w + xx) * 4 + 3] > 128 && !inBehind((xx / fg.w) * 100, (yy / fg.h) * 100)) on++; }
      return n ? on / n : 0;
    };
    const cover = {};
    for (const r of refs) {
      if (!r.box) continue;
      const ix = Math.max(box.x, r.box.x); const iy = Math.max(box.y, r.box.y);
      const iw = Math.min(box.x + box.w, r.box.x + r.box.w) - ix; const ih = Math.min(box.y + box.h, r.box.y + r.box.h) - iy;
      if (iw > 0 && ih > 0) cover[r.id] = Math.round(alphaFrac({ x: ix, y: iy, w: iw, h: ih }) * 100) / 100;
    }
    let maskOk = null;
    if (M.walk) {
      const wx = Math.min(M.walk.w - 1, Math.max(0, Math.round((p.pctX / 100) * M.walk.w)));
      const wy = Math.min(M.walk.h - 1, Math.max(0, Math.round((p.pctY / 100) * M.walk.h) - 1));
      const i = (wy * M.walk.w + wx) * 4;
      const [r, g, bb] = [M.walk.data[i], M.walk.data[i + 1], M.walk.data[i + 2]];
      maskOk = bb > 150 && r < 110 && g < 110;
    }
    const bgH = cs.bgH;
    const npcs = gs.npcs.map((n) => {
      const nb = n.getBounds(); const a = cs.screenToPct(nb.x, nb.y); const c = cs.screenToPct(nb.right, nb.bottom);
      return { id: n.npcId, box: { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y }, heightPct: (n.displayHeight / bgH) * 100 };
    });
    return {
      feetX: p.pctX, feetY: p.pctY, box, heightPct: pix?.worldHeightPct ?? (p.displayHeight / bgH) * 100,
      screenHeightPct: pix?.playerHeightPct, walkable: window.__qa.isWalkable(p.pctX, p.pctY), maskOk, cover,
      screen: { x: s0.x, y: s0.y, w: s1.x - s0.x, h: s1.y - s0.y }, npcs,
      toScreenRef: Object.fromEntries(refs.filter((r) => r.box).map((r) => {
        const a = cs.pctToScreen(r.box.x, r.box.y); const c = cs.pctToScreen(r.box.x + r.box.w, r.box.y + r.box.h);
        const sa = toScreen(a.x, a.y); const sc = toScreen(c.x, c.y);
        return [r.id, { x: sa.x, y: sa.y, w: sc.x - sa.x, h: sc.y - sa.y }];
      })),
    };
  }, refs);
}

const r2 = (v) => Math.round(v * 100) / 100;
const clampClip = (c) => {
  const x = Math.max(0, Math.floor(c.x)); const y = Math.max(0, Math.floor(c.y));
  return { x, y, width: Math.max(10, Math.min(VP.width - x, Math.ceil(c.w))), height: Math.max(10, Math.min(VP.height - y, Math.ceil(c.h))) };
};

const results = [];
const sheets = [];
for (const scene of scenes) {
  const t0 = Date.now();
  const refsDoc = loadScaleRefs(ROOT, scene);
  const sceneJson = loadSceneJson(ROOT, scene);
  const points = sweepPoints(sceneJson, refsDoc);
  const shotDir = join(OUT, 'capturas', scene);
  let positions = [];
  if (REEVAL) {
    positions = reevaluate(scene, refsDoc);
  } else {
  rmSync(shotDir, { recursive: true, force: true });
  mkdirSync(shotDir, { recursive: true });
  try {
    await openScene(scene);
  } catch (e) {
    console.log(`${scene}: no abre (${e?.message || e})`);
    results.push({ scene, error: String(e?.message || e), positions: [] });
    continue;
  }
  for (const [i, pt] of points.entries()) {
    const m = await measureAt(pt.x, pt.y, refsDoc.refs);
    // NPC: referencia viva (1,7 m) con la caja y el alto que da el juego
    const npcRefs = (refsDoc.refs || []).filter((r) => r.npc).map((r) => {
      const q = m.npcs.find((n) => n.id === r.id);
      return q ? { ...r, box: q.box, heightPct: q.heightPct } : null;
    }).filter(Boolean);
    const ev = evaluatePosition({ ...pt, ...m }, refsDoc, npcRefs);
    const pos = {
      id: pt.id, kind: pt.kind, x: pt.x, y: pt.y, feet: { x: r2(m.feetX), y: r2(m.feetY) },
      dexBox: { x: r2(m.box.x), y: r2(m.box.y), w: r2(m.box.w), h: r2(m.box.h) }, heightPct: r2(m.heightPct),
      walkable: m.walkable, maskOk: m.maskOk, cover: m.cover, scale: ev.scale, failures: ev.failures, info: ev.info, score: ev.score,
    };
    if (ev.failures.length || ev.info.some((x) => x.type === 'scale')) {
      const refId = ev.failures.find((f) => f.ref)?.ref || ev.scale?.ref;
      const rs = refId && m.toScreenRef[refId];
      const s = m.screen;
      let x0 = s.x - s.w; let y0 = s.y - s.h * 0.3; let x1 = s.x + s.w * 2; let y1 = s.y + s.h * 1.15;
      if (rs) { x0 = Math.min(x0, rs.x - 10); y0 = Math.min(y0, rs.y - 10); x1 = Math.max(x1, rs.x + rs.w + 10); y1 = Math.max(y1, rs.y + rs.h + 10); }
      pos.shot = `capturas/${scene}/${String(i).padStart(3, '0')}.png`;
      await page.screenshot({ path: join(OUT, pos.shot), clip: clampClip({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) });
    }
    positions.push(pos);
  }
  }
  const sum = summarize(scene, positions, 12);
  results.push({ scene, scalePolicy: refsDoc.scalePolicy, ...sum, positionsDetail: positions });
  writeFileSync(join(JSON_DIR, `${scene}.json`), `${JSON.stringify({ scene, scalePolicy: refsDoc.scalePolicy, summary: { positions: sum.positions, failing: sum.failing, byType: sum.byType }, positions }, null, 1)}\n`);
  // Hoja de contactos: las 12 peores con su etiqueta (tipo de fallo y desviación)
  const worst = positions.filter((p) => p.shot && p.failures.length).sort((a, b) => b.score - a.score).slice(0, 12);
  if (worst.length) {
    const tiles = [];
    for (const p of worst) {
      const label = `${p.kind}:${p.id} (${p.x},${p.y})\n${p.failures.map((x) => `${x.type}${x.dev != null ? ` ${x.type === 'scale' ? `${x.dev > 0 ? '+' : ''}${Math.round(x.dev * 100)}%` : x.dev}` : ''}${x.ref ? ` ${x.ref}` : ''}`).join(' · ')}`;
      tiles.push('-label', label.slice(0, 160), join(OUT, p.shot));
    }
    const sheet = join(OUT, `${scene}.png`);
    try {
      execFileSync('montage', [...tiles, '-tile', '4x', '-geometry', '300x220+6+6', '-pointsize', '11', '-background', '#222', '-fill', 'white', '-title', `${scene}: ${sum.failing}/${sum.positions} posiciones con fallo ${JSON.stringify(sum.byType)}`, sheet]);
      sheets.push({ scene, sheet, worst5: worst.slice(0, 5) });
    } catch (e) { console.log(`${scene}: sin hoja (${e.message})`); }
  }
  console.log(`${scene}: ${sum.positions} posiciones, ${sum.failing} con fallo ${JSON.stringify(sum.byType)} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
if (browser) await browser.close();

// resumen.png: las 5 peores de cada escena, una fila por escena
if (sheets.length) {
  const rows = [];
  for (const s of sheets) {
    const row = join(OUT, `.fila-${s.scene}.png`);
    const tiles = [];
    for (const p of s.worst5) tiles.push('-label', `${s.scene} ${p.failures.map((f) => f.type).join(',')}`, join(OUT, p.shot));
    try {
      execFileSync('montage', [...tiles, '-tile', '5x1', '-geometry', '220x160+4+4', '-pointsize', '10', '-background', '#222', '-fill', 'white', row]);
      rows.push(row);
    } catch { /* fila sin hoja */ }
  }
  if (rows.length) execFileSync('magick', [...rows, '-background', '#222', '-append', join(OUT, 'resumen.png')]);
  for (const r of rows) rmSync(r, { force: true });
}

const fresh = results.filter((r) => !r.error).map((r) => ({ scene: r.scene, positions: r.positionsDetail }));
if (flag('--write-baseline')) {
  const known = [];
  for (const r of fresh) for (const p of r.positions) for (const f of p.failures) known.push(failureKey(r.scene, p, f));
  writeFileSync(BASELINE, `${JSON.stringify({ _doc: 'A2.17: fallos conocidos del revisor de proporción (escena|tipo|ref|punto). Con --strict el barrido falla si aparece uno que no esté aquí. Regenerar: node scripts/proportion-sweep.mjs --write-baseline (solo para todas las escenas).', known: [...new Set(known)].sort() }, null, 1)}\n`);
  console.log(`base reescrita: ${known.length} fallos`);
}
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { known: [] };
const nuevos = newFailures(fresh, baseline);
writeFileSync(join(OUT, 'resumen.json'), JSON.stringify({ scenes: results.map(({ positionsDetail, ...r }) => r), nuevos, pageErrors: pageErrors.slice(0, 20) }, null, 1));
console.log(`fallos nuevos frente a la base: ${nuevos.length}${nuevos.length ? `\n  ${nuevos.slice(0, 30).join('\n  ')}` : ''}`);
const broken = results.filter((r) => r.error);
if (flag('--strict') && (nuevos.length || broken.length)) process.exit(1);

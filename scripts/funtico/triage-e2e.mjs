// F1.2 (plan FUNTICO_ADVENTURE): e2e de Triage en el build Funtico (dist-funtico/), en Chrome headless (puppeteer,
// como smoke y walkthrough) con toques reales sobre el canvas (touchscreen) y arrastre para desplazar en vertical.
//  - Juega carreras completas con ?mock=1&seed=e2e-f1.2 en 390x844 (girando a mitad: 390x844 → 844x390 → 390x844),
//    844x390, 1280x720 y 1920x1080; comprueba que el giro no pierde estación, toques, puntuación ni reloj.
//  - Al final: puntuación en pantalla = scoreRun(run, taps) y el Hall of Fame simulado la contiene.
//  - En cada pantalla (menú, SAMPLE, SYMPTOM, RELAPSE, resultado): uiBounds() dentro del viewport; en los dos tamaños
//    móviles, interactivos ≥ 44 px CSS y textos ≥ 14 px CSS. Sin errores de consola y sin peticiones a dominios de Funtico.
//  - Píxeles: en SAMPLE y SYMPTOM, el panel de escena NO es negro/uniforme (desviación de luminancia y nº de colores) y
//    el recorte de SAMPLE tiene detalle (además, tasa de cambio entre píxeles vecinos: los bloques borrosos no pasan).
//  - fps medianos con CPU ×4 (CDP) en 390x844 (rAF en la página y la mediana del juego). Capturas en $SHOTS (por
//    defecto /var/tmp/funtico/f1-2/shots/<renderer>).
// Uso: npm run build:funtico && node scripts/funtico/triage-e2e.mjs   (o BASE_URL=http://… para no servir dist-funtico)
// Variables: SHOTS, SEED, ONLY=390x844,844x390 (tamaños a jugar), RENDERER=canvas|webgl (canvas: sin WebGL en Chrome;
// webgl: WebGL por software con ANGLE + SwiftShader; falla si Phaser no arranca con el renderer pedido),
// GIF_DIR (o --gif: /var/tmp/funtico/f1-2/gif/frames): una captura cada ~250 ms de la carrera vertical y de la
// horizontal, sin giro, en GIF_DIR/<tamaño>/f0001.png… (las monta scripts/funtico/triage-gif.sh).
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { scoreRun, validateTaps } from '../../src/funtico/triage/triage.js';

const ROOT = path.resolve('dist-funtico');
const RENDERER = (process.env.RENDERER || 'canvas').toLowerCase();
if (!['canvas', 'webgl'].includes(RENDERER)) { console.error(`RENDERER=${RENDERER}: usa canvas o webgl`); process.exit(2); }
const SHOTS = process.env.SHOTS || `/var/tmp/funtico/f1-2/shots/${RENDERER}`;
const SEED = process.env.SEED || 'e2e-f1.2';
const GIF_DIR = process.env.GIF_DIR || (process.argv.includes('--gif') ? '/var/tmp/funtico/f1-2/gif/frames' : '');
const GIF_EVERY_MS = 250;
const MOBILE = new Set(['390x844', '844x390']);
const SIZES = (process.env.ONLY || (GIF_DIR ? '390x844,844x390' : '390x844,844x390,1280x720,1920x1080')).split(',');
/** Umbrales de píxeles (medidos por px CSS). Panel negro: desv. 0 y 1 color; recorte borroso de antes: ~0,02 de cambio. */
const PIX = { sceneStd: 10, sceneColors: 64, cropStd: 8, cropColors: 48, cropChange: 0.08 };
const SHOT_SIZES = new Set(['390x844', '844x390', '1920x1080']);
const IGNORE = [/AudioContext/i, /autoplay/i, /favicon/i, /play\(\) request/i];

const failures = [];
const notes = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Servidor estático de dist-funtico (sin proxys: nada sale a la red) ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.map': 'application/json' };
let server = null;
let BASE = process.env.BASE_URL;
if (!BASE) {
  if (!existsSync(path.join(ROOT, 'index.html'))) { console.error('falta dist-funtico/index.html: npm run build:funtico'); process.exit(2); }
  server = http.createServer(async (req, res) => {
    const u = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT)) { res.statusCode = 403; res.end(); return; }
    try {
      // Sin `cp -r assets dist-funtico/` (vite build --mode funtico a secas), los assets del juego salen del repo
      const body = await readFile(f).catch((e) => (u.startsWith('/assets/') ? readFile(path.join(path.resolve('.'), u)) : Promise.reject(e)));
      res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
}
await mkdir(SHOTS, { recursive: true });
console.log(`Triage e2e contra ${BASE} (semilla ${SEED}, renderer ${RENDERER}); capturas en ${SHOTS}`);

// canvas: Chrome sin APIs 3D (Phaser.AUTO cae a CANVAS, como en un móvil sin WebGL); webgl: WebGL por software
const GL_ARGS = RENDERER === 'webgl'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  : ['--disable-3d-apis', '--disable-webgl'];
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', ...GL_ARGS, '--autoplay-policy=no-user-gesture-required'],
});

const parse = (s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; };
const vp = (s, mobile) => ({ ...parse(s), deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });

async function newPage(size) {
  const mobile = MOBILE.has(size);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const label = { v: size };
  page.on('pageerror', (e) => fail(`[${label.v}] error de página: ${(e.stack || e.message).slice(0, 900)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORE.some((re) => re.test(t))) return;
    fail(`[${label.v}] console.error: ${t.slice(0, 200)}`);
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/funtico/i.test(u.hostname)) fail(`[${label.v}] petición a dominio de Funtico: ${r.url()}`);
    else if (!r.url().startsWith(BASE) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) notes.push(`[${label.v}] petición externa: ${r.url()}`);
  });
  page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) fail(`[${label.v}] ${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.setViewport(vp(size, mobile));
  return { page, ctx, mobile, label };
}

const hook = (page, expr) => page.evaluate(expr);
const state = (page) => page.evaluate(() => window.__funtico?.triage?.state() ?? null);

/** Pulsa (toque si es móvil, clic si no) en coordenadas CSS de la página. */
async function press(p, x, y) {
  if (p.mobile) await p.page.touchscreen.tap(x, y);
  else await p.page.mouse.click(x, y);
}

/** Arrastre horizontal (toque o ratón) de x0 a x1 a la altura y. */
async function dragX(p, x0, x1, y) {
  const steps = 8;
  if (p.mobile) {
    await p.page.touchscreen.touchStart(x0, y);
    for (let i = 1; i <= steps; i++) { await p.page.touchscreen.touchMove(x0 + ((x1 - x0) * i) / steps, y); await sleep(16); }
    await p.page.touchscreen.touchEnd();
  } else {
    await p.page.mouse.move(x0, y);
    await p.page.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.page.mouse.move(x0 + ((x1 - x0) * i) / steps, y); await sleep(16); }
    await p.page.mouse.up();
  }
}

/** Comprueba uiBounds() de una pantalla: dentro del viewport y, en móvil, ≥ 44 px y ≥ 14 px. */
async function checkBounds(p, where, getter) {
  const size = p.label.v;
  const { width, height } = parse(size);
  const list = await p.page.evaluate(getter);
  if (!Array.isArray(list) || !list.length) { fail(`[${size}] ${where}: uiBounds vacío`); return null; }
  let minTouch = Infinity;
  let minFont = Infinity;
  for (const b of list) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > width + 1 || b.y + b.h > height + 1) fail(`[${size}] ${where}: «${b.id}» fuera del viewport (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)})`);
    if (b.kind === 'button') minTouch = Math.min(minTouch, b.w, b.h);
    if (b.fontPx) minFont = Math.min(minFont, b.fontPx);
    if (MOBILE.has(size)) {
      if (b.kind === 'button' && (b.w < 44 || b.h < 44)) fail(`[${size}] ${where}: botón «${b.id}» de ${b.w}x${b.h} (< 44 px)`);
      if (b.fontPx && b.fontPx < 14) fail(`[${size}] ${where}: «${b.id}» con texto de ${b.fontPx} px (< 14)`);
    }
  }
  return { minTouch, minFont, n: list.length };
}

const minima = {};
function noteMin(size, r) {
  if (!r) return;
  const m = (minima[size] ??= { minTouch: Infinity, minFont: Infinity });
  m.minTouch = Math.min(m.minTouch, r.minTouch);
  m.minFont = Math.min(m.minFont, r.minFont);
}

/**
 * Estadísticas de píxeles de una región (px CSS) de la pantalla, muestreando 1 px por px CSS: desviación típica de la
 * luminancia, nº de colores distintos y fracción de vecinos horizontales que cambian (detalle frente a bloques).
 */
async function regionStats(p, r, inset = 6) {
  const { width, height } = parse(p.label.v);
  const x = Math.max(0, Math.round(r.x + inset));
  const y = Math.max(0, Math.round(r.y + inset));
  const clip = { x, y, width: Math.max(8, Math.min(width - x, Math.round(r.w - inset * 2))), height: Math.max(8, Math.min(height - y, Math.round(r.h - inset * 2))) };
  const b64 = await p.page.screenshot({ clip, encoding: 'base64' });
  const dpr = p.mobile ? 2 : 1;
  return p.page.evaluate(async (data, step) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sum = 0, sum2 = 0, pairs = 0, changes = 0;
    const colors = new Set();
    for (let yy = 0; yy < c.height; yy += step) {
      let prev = -1;
      for (let xx = 0; xx < c.width; xx += step) {
        const i = (yy * c.width + xx) * 4;
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++; sum += L; sum2 += L * L;
        colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        if (prev >= 0) { pairs++; if (Math.abs(L - prev) > 4) changes++; }
        prev = L;
      }
    }
    const mean = sum / n;
    return { std: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) * 10) / 10, colors: colors.size, change: Math.round((changes / Math.max(1, pairs)) * 1000) / 1000, w: c.width, h: c.height };
  }, b64, dpr);
}

const pixels = [];
/** El panel de escena no es negro/uniforme y, en SAMPLE, el recorte tiene detalle. */
async function checkPixels(p, where) {
  const size = p.label.v;
  const list = await p.page.evaluate(() => window.__funtico.triage.uiBounds());
  const scene = list.find((b) => b.id === 'scene');
  const crop = list.find((b) => b.id === 'crop');
  if (scene) {
    const s = await regionStats(p, scene);
    pixels.push({ size, where, region: 'scene', ...s });
    (s.std >= PIX.sceneStd && s.colors >= PIX.sceneColors ? ok : fail)(`[${size}] ${where}: panel de escena con imagen (desv. ${s.std} ≥ ${PIX.sceneStd}, ${s.colors} colores ≥ ${PIX.sceneColors})`);
  } else fail(`[${size}] ${where}: sin «scene» en uiBounds`);
  if (where.startsWith('sample')) {
    if (!crop) { fail(`[${size}] ${where}: sin «crop» en uiBounds`); return; }
    const c = await regionStats(p, crop, 4);
    pixels.push({ size, where, region: 'crop', ...c });
    (c.std >= PIX.cropStd && c.colors >= PIX.cropColors && c.change >= PIX.cropChange ? ok : fail)(`[${size}] ${where}: recorte con detalle (desv. ${c.std} ≥ ${PIX.cropStd}, ${c.colors} colores ≥ ${PIX.cropColors}, cambio ${c.change} ≥ ${PIX.cropChange})`);
  }
}

/** Mediana de fps por requestAnimationFrame durante `ms` (en la página). */
const rafMedian = (page, ms) => page.evaluate((dur) => new Promise((res) => {
  const t = [];
  let last = performance.now();
  const end = last + dur;
  const f = (now) => {
    t.push(now - last);
    last = now;
    if (now < end) requestAnimationFrame(f);
    else { t.sort((a, b) => a - b); res({ median: Math.round((10000 / t[Math.floor(t.length / 2)])) / 10, frames: t.length }); }
  };
  requestAnimationFrame(f);
}), ms);

/** Capturas cada GIF_EVERY_MS para el GIF (modo --gif). */
function startFrames(page, dir) {
  let on = true;
  let n = 0;
  const done = (async () => {
    await mkdir(dir, { recursive: true });
    while (on) {
      const t0 = Date.now();
      n++;
      await page.screenshot({ path: path.join(dir, `f${String(n).padStart(4, '0')}.png`) }).catch(() => { n--; });
      await sleep(Math.max(0, GIF_EVERY_MS - (Date.now() - t0)));
    }
  })();
  return async () => { on = false; await done; return n; };
}

async function shot(p, name) {
  if (!SHOT_SIZES.has(p.label.v)) return;
  await p.page.screenshot({ path: path.join(SHOTS, `${p.label.v}-${name}.png`) });
}

/** Espera a que la vista enseñe la estación `idx` lista para tocar (o a que acabe). */
async function waitStation(page, idx) {
  await page.waitForFunction((i) => {
    const s = window.__funtico?.triage?.state();
    return !s || s.finished || (s.ready && s.index === i);
  }, { timeout: 15000, polling: 50 }, idx);
  return state(page);
}

/** Lleva el objetivo (en % del mundo) a la vista arrastrando, y devuelve su posición en pantalla. */
async function bringIntoView(p, xPct, yPct) {
  for (let k = 0; k < 8; k++) {
    const s = await p.page.evaluate((x, y) => window.__funtico.triage.worldToScreen(x, y), xPct, yPct);
    const st = await state(p.page);
    const v = st.view;
    const margin = 24;
    if (s.visible && s.x > v.x + margin && s.x < v.x + v.w - margin) return s;
    const cx = v.x + v.w / 2;
    const want = Math.max(-v.w * 0.8, Math.min(v.w * 0.8, cx - s.x));
    const y = v.y + v.h * 0.5;
    const x0 = want < 0 ? v.x + v.w * 0.9 : v.x + v.w * 0.1;
    await dragX(p, x0, x0 + want, y);
    await sleep(450);
  }
  return p.page.evaluate((x, y) => window.__funtico.triage.worldToScreen(x, y), xPct, yPct);
}

async function playRun(size, { rotate = false, missOnce = false, fps = false, frames = '' } = {}) {
  console.log(`\n== Carrera en ${size}${rotate ? ' (con giro)' : ''} ==`);
  const p = await newPage(size);
  const { page } = p;
  const stopFrames = frames ? startFrames(page, frames) : null;
  await page.goto(`${BASE}/?mock=1&seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__funtico?.menu, { timeout: 30000 });
  await page.waitForFunction(() => window.__funtico.menu.uiBounds().some((b) => b.id === 'hof' && !/loading/.test(b.text)), { timeout: 10000 });
  noteMin(size, await checkBounds(p, 'menú', () => window.__funtico.menu.uiBounds()));
  await shot(p, '1-menu');
  const tri = (await page.evaluate(() => window.__funtico.menu.uiBounds())).find((b) => b.id === 'triage');
  await press(p, tri.x + tri.w / 2, tri.y + tri.h / 2);
  await page.waitForFunction(() => window.__funtico?.triage?.state()?.ready, { timeout: 60000, polling: 100 })
    .catch(async (e) => { notes.push(`renderer ${await page.evaluate(() => window.__funtico.game.renderer.type)}`); throw e; });
  const run = await page.evaluate(() => window.__funtico.triage.run);
  const got = await page.evaluate(() => (window.__funtico.game.renderer.type === 2 ? 'WEBGL' : 'CANVAS'));
  notes.push(`[${size}] renderer ${got}`);
  (got === RENDERER.toUpperCase() ? ok : fail)(`[${size}] renderer ${got} (pedido ${RENDERER})`);
  if (run.seed !== SEED) fail(`[${size}] semilla ${run.seed} ≠ ${SEED}`);
  const shotted = new Set();
  let rotated = false;

  for (let i = 0; i < run.stations.length; i++) {
    let s = await waitStation(page, i);
    if (!s || s.finished) break;
    await sleep(380); // > minReactionMs desde que abrió
    const st = run.stations[i];
    if (!shotted.has(st.kind)) {
      shotted.add(st.kind);
      noteMin(size, await checkBounds(p, st.kind, () => window.__funtico.triage.uiBounds()));
      await shot(p, `${{ sample: 2, symptom: 3, relapse: 4 }[st.kind]}-${st.kind}`);
    }
    if (st.kind !== 'relapse' && !shotted.has(`px-${st.kind}`)) {
      shotted.add(`px-${st.kind}`);
      await checkPixels(p, st.kind);
    }
    if (fps && i === 1) {
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const v = s.view;
      const rafP = rafMedian(page, 4500);
      if (s.scrollable) { await dragX(p, v.x + v.w * 0.8, v.x + v.w * 0.3, v.y + v.h / 2); await sleep(300); await dragX(p, v.x + v.w * 0.3, v.x + v.w * 0.8, v.y + v.h / 2); }
      const raf = await rafP;
      const f = await page.evaluate(() => window.__funtico.triage.fps());
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      minima.fps = { renderer: RENDERER, size, cpuThrottle: 4, medianRaf: raf.median, rafFrames: raf.frames, medianGame: f, gate: 50 };
      (raf.median >= 50 ? ok : (m) => { notes.push(m); console.log(`  NOTE ${m}`); })(`fps medianos con CPU x4 en ${size} (${RENDERER}): rAF ${raf.median} (${raf.frames} fotogramas en 4,5 s), juego ${f}; puerta ≥ 50`);
      // La vista vuelve a la estación con la escena centrada para tocar
      s = await state(page);
    }
    if (rotate && !rotated && i === 3) {
      rotated = true;
      const a = await state(page);
      const tA = Date.now();
      await page.setViewport(vp('844x390', true));
      p.label.v = '844x390';
      await sleep(600);
      const b = await state(page);
      const wall = Date.now() - tA;
      const same = a.index === b.index && a.taps === b.taps && a.score === b.score;
      (same ? ok : fail)(`giro a 844x390: estación ${a.index}→${b.index}, toques ${a.taps}→${b.taps}, puntos ${a.score}→${b.score}`);
      const dClock = a.remainingMs - b.remainingMs;
      (b.orientation === 'landscape' ? ok : fail)(`orientación tras girar: ${b.orientation}`);
      (dClock >= 0 && dClock <= wall + 400 ? ok : fail)(`reloj sigue tras el giro: −${dClock} ms en ${wall} ms de reloj de pared`);
      noteMin('844x390', await checkBounds(p, `${st.kind} (girado)`, () => window.__funtico.triage.uiBounds()));
      await shot(p, `rot-${st.kind}`);
      if (st.kind !== 'relapse') await checkPixels(p, `${st.kind} (girado)`);
      // Se juega esta estación en horizontal y se vuelve a vertical en la siguiente
      s = b;
    }
    if (rotate && rotated && i === 4 && p.label.v === '844x390') {
      const a = await state(page);
      await page.setViewport(vp('390x844', true));
      p.label.v = '390x844';
      await sleep(600);
      const b = await state(page);
      const same = a.index === b.index && a.taps === b.taps && a.score === b.score && b.remainingMs <= a.remainingMs && b.orientation === 'portrait';
      (same ? ok : fail)(`vuelta a 390x844: estación ${a.index}→${b.index}, toques ${a.taps}→${b.taps}, puntos ${a.score}→${b.score}, reloj ${a.remainingMs}→${b.remainingMs}`);
      s = b;
    }

    if (st.kind === 'relapse') {
      const btn = (await page.evaluate(() => window.__funtico.triage.uiBounds())).find((b) => b.id === `option-${st.correct}`);
      await press(p, btn.x + btn.w / 2, btn.y + btn.h / 2);
    } else {
      const cx = st.bounds.x + st.bounds.w / 2;
      const cy = st.bounds.y + st.bounds.h / 2;
      if (missOnce && i === 0) {
        // Un fallo a propósito: a la izquierda o derecha del objetivo, fuera de sus bounds
        const mx = cx > 50 ? Math.max(0.5, st.bounds.x - 6) : Math.min(99.5, st.bounds.x + st.bounds.w + 6);
        const m = await bringIntoView(p, mx, cy);
        const before = (await state(page)).taps;
        await press(p, m.x, m.y);
        await page.waitForFunction((n) => window.__funtico.triage.state().taps > n, { timeout: 3000 }, before).catch(() => fail(`[${size}] el fallo a propósito no se registró`));
        await sleep(400);
      }
      const t = await bringIntoView(p, cx, cy);
      if (!t.visible) fail(`[${p.label.v}] estación ${i}: el objetivo no entra en la vista`);
      await press(p, t.x, t.y);
    }
    await page.waitForFunction((n) => { const x = window.__funtico?.triage?.state(); return !x || x.finished || x.index > n; }, { timeout: 5000, polling: 50 }, i)
      .catch(async () => fail(`[${p.label.v}] estación ${i} (${st.kind}) no se cerró con el toque: ${JSON.stringify(await state(page))}`));
  }

  await page.waitForFunction(() => window.__funtico?.result?.submitted, { timeout: 15000 });
  const res = await page.evaluate(() => {
    const r = window.__funtico.result;
    return { score: r.score, shown: r.shownScore, taps: r.taps, run: r.run, submitted: r.submitted };
  });
  const expected = scoreRun(res.run, res.taps);
  (res.shown === expected.score && res.score === expected.score ? ok : fail)(`[${size}] puntuación en pantalla ${res.shown} = scoreRun ${expected.score} (aciertos ${expected.hits}, fallos ${expected.misses}, sobrante +${expected.leftoverBonus})`);
  const v = validateTaps(res.run, res.taps);
  (v.ok ? ok : fail)(`[${size}] validateTaps: ${v.ok ? 'ok' : `${v.reason} en ${v.at}`}`);
  const mine = res.submitted.hof.find((e) => e.me);
  (mine && mine.points === expected.score ? ok : fail)(`[${size}] Hall of Fame simulado con la marca: ${mine ? `#${mine.rank} ${mine.points}` : 'no está'}`);
  noteMin(p.label.v, await checkBounds(p, 'resultado', () => window.__funtico.result.uiBounds()));
  await shot(p, '5-result');
  if (stopFrames) notes.push(`[${size}] GIF: ${await stopFrames()} fotogramas en ${frames}`);
  await p.ctx.close();
  return expected;
}

try {
  for (const size of SIZES) {
    const portrait = size === '390x844';
    await playRun(size, {
      rotate: portrait && !GIF_DIR,
      missOnce: true,
      fps: portrait && !GIF_DIR,
      frames: GIF_DIR && MOBILE.has(size) ? path.join(GIF_DIR, size) : '',
    });
  }
} catch (e) {
  fail(`excepción: ${e.stack || e.message}`);
} finally {
  await browser.close();
  server?.close();
}

const summary = { renderer: RENDERER, failures, notes: [...new Set(notes)], minima, fps: minima.fps ?? null, pixels, thresholds: PIX, sizes: SIZES, seed: SEED };
await writeFile(path.join(SHOTS, 'triage-e2e.json'), JSON.stringify(summary, null, 2));
console.log('\nMínimos medidos (px CSS):', JSON.stringify(minima));
if (summary.notes.length) console.log('Notas:\n  ' + summary.notes.join('\n  '));
console.log(failures.length ? `\n${failures.length} fallo(s)` : '\nTriage e2e: todo en verde');
process.exit(failures.length ? 1 : 0);

// F1.2 (plan FUNTICO_ADVENTURE): e2e de Triage en el build Funtico (dist-funtico/), en Chrome headless (puppeteer,
// como smoke y walkthrough) con toques reales sobre el canvas (touchscreen) y arrastre para desplazar en vertical.
//  - Juega carreras completas con ?mock=1&seed=e2e-f1.2 en 390x844 (girando a mitad: 390x844 → 844x390 → 390x844),
//    844x390, 1280x720 y 1920x1080; comprueba que el giro no pierde estación, toques, puntuación ni reloj.
//  - Al final: puntuación en pantalla = scoreRun(run, taps) y el Hall of Fame simulado la contiene.
//  - En cada pantalla (menú, SAMPLE, SYMPTOM, RELAPSE, resultado): uiBounds() dentro del viewport; en los dos tamaños
//    móviles, interactivos ≥ 44 px CSS y textos ≥ 14 px CSS. Sin errores de consola y sin peticiones a dominios de Funtico.
//  - fps medianos con CPU ×4 (CDP) en 390x844. Capturas en $SHOTS (por defecto /var/tmp/funtico/f1-2/shots).
// Uso: npm run build:funtico && node scripts/funtico/triage-e2e.mjs   (o BASE_URL=http://… para no servir dist-funtico)
// Variables: SHOTS, SEED, ONLY=390x844,844x390 (tamaños a jugar), VIDEO_DIR (graba la carrera vertical y la horizontal
// con page.screencast, para el GIF; necesita ffmpeg).
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { scoreRun, validateTaps } from '../../src/funtico/triage/triage.js';

const ROOT = path.resolve('dist-funtico');
const SHOTS = process.env.SHOTS || '/var/tmp/funtico/f1-2/shots';
const SEED = process.env.SEED || 'e2e-f1.2';
const VIDEO_DIR = process.env.VIDEO_DIR || '';
const MOBILE = new Set(['390x844', '844x390']);
const SIZES = (process.env.ONLY || '390x844,844x390,1280x720,1920x1080').split(',');
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
console.log(`Triage e2e contra ${BASE} (semilla ${SEED}); capturas en ${SHOTS}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const parse = (s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; };
const vp = (s, mobile) => ({ ...parse(s), deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });

async function newPage(size) {
  const mobile = MOBILE.has(size);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const label = { v: size };
  page.on('pageerror', (e) => fail(`[${label.v}] error de página: ${e.message}`));
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

async function playRun(size, { rotate = false, missOnce = false, fps = false, video = '' } = {}) {
  console.log(`\n== Carrera en ${size}${rotate ? ' (con giro)' : ''} ==`);
  const p = await newPage(size);
  const { page } = p;
  let rec = null;
  if (video) {
    try { rec = await page.screencast({ path: video }); } catch (e) { notes.push(`sin vídeo (${e.message})`); }
  }
  await page.goto(`${BASE}/?mock=1&seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__funtico?.menu, { timeout: 30000 });
  await page.waitForFunction(() => window.__funtico.menu.uiBounds().some((b) => b.id === 'hof' && !/loading/.test(b.text)), { timeout: 10000 });
  noteMin(size, await checkBounds(p, 'menú', () => window.__funtico.menu.uiBounds()));
  await shot(p, '1-menu');
  const tri = (await page.evaluate(() => window.__funtico.menu.uiBounds())).find((b) => b.id === 'triage');
  await press(p, tri.x + tri.w / 2, tri.y + tri.h / 2);
  await page.waitForFunction(() => window.__funtico?.triage?.state()?.ready, { timeout: 60000, polling: 100 });
  const run = await page.evaluate(() => window.__funtico.triage.run);
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
    if (fps && i === 1) {
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const v = s.view;
      if (s.scrollable) { await dragX(p, v.x + v.w * 0.8, v.x + v.w * 0.3, v.y + v.h / 2); await sleep(300); await dragX(p, v.x + v.w * 0.3, v.x + v.w * 0.8, v.y + v.h / 2); }
      await sleep(4000);
      const f = await page.evaluate(() => window.__funtico.triage.fps());
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      minima.fps = f;
      (f >= 50 ? ok : (m) => { notes.push(m); console.log(`  NOTE ${m}`); })(`fps medianos con CPU x4 en ${size}: ${f}`);
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
  if (rec) await rec.stop();
  await p.ctx.close();
  return expected;
}

try {
  for (const size of SIZES) {
    const portrait = size === '390x844';
    await playRun(size, {
      rotate: portrait,
      missOnce: true,
      fps: portrait,
      video: VIDEO_DIR && (size === '390x844' || size === '844x390') ? path.join(VIDEO_DIR, `triage-${size}.webm`) : '',
    });
  }
} catch (e) {
  fail(`excepción: ${e.stack || e.message}`);
} finally {
  await browser.close();
  server?.close();
}

const summary = { failures, notes: [...new Set(notes)], minima, sizes: SIZES, seed: SEED };
await writeFile(path.join(SHOTS, 'triage-e2e.json'), JSON.stringify(summary, null, 2));
console.log('\nMínimos medidos (px CSS):', JSON.stringify(minima));
if (summary.notes.length) console.log('Notas:\n  ' + summary.notes.join('\n  '));
console.log(failures.length ? `\n${failures.length} fallo(s)` : '\nTriage e2e: todo en verde');
process.exit(failures.length ? 1 : 0);

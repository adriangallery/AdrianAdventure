// F1.5 (plan FUNTICO_ADVENTURE): e2e del lobby del build Funtico (dist-funtico/) en Chrome headless (puppeteer).
// En 390x844, 844x390, 1280x720 y 1920x1080 (contexto limpio en cada tamaño):
//   How to play automático la primera vez (3 pasos, DONE) → lobby → Hall of Fame (GLOBAL/MONTHLY) → Mis resultados
//   (TRIAGE/CAMPAIGN) → Ajustes (cambia el volumen de sonido y persiste tras recargar) → tarjeta TRIAGE + PLAY llega a
//   Triage (TriageStartScene en live, TriageScene en simulado). En 390x844, además, un giro en caliente (→ 844x390 →
//   390x844) en el Hall of Fame sin perder la pantalla. En cada pantalla: uiBounds() dentro del viewport; en los dos
//   tamaños móviles, interactivos ≥ 44 px CSS y textos ≥ 14 px CSS. Capturas en $SHOTS (artefacto funtico-lobby-shots).
// Uso: npm run build:funtico && node scripts/funtico/lobby-e2e.mjs   (o BASE_URL=http://…). Variables: SHOTS, ONLY.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve('dist-funtico');
const SHOTS = process.env.SHOTS || '/var/tmp/funtico/f1-5/shots';
const MOBILE = new Set(['390x844', '844x390']);
const SIZES = (process.env.ONLY || '390x844,844x390,1280x720,1920x1080').split(',');
const IGNORE = [/AudioContext/i, /autoplay/i, /favicon/i, /play\(\) request/i];
const SETTINGS_KEY = 'adrian_adventure_funtico_settings';

const failures = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const body = await readFile(f).catch((e) => (u.startsWith('/assets/') ? readFile(path.join(path.resolve('.'), u)) : Promise.reject(e)));
      res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
}
await mkdir(SHOTS, { recursive: true });
console.log(`Lobby e2e contra ${BASE}; capturas en ${SHOTS}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-3d-apis', '--disable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const parse = (s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; };
const vp = (s, mobile) => ({ ...parse(s), deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });

const screenB = () => window.__funtico?.screen?.uiBounds() ?? [];
const menuB = () => window.__funtico?.menu?.uiBounds() ?? [];

/** Comprueba uiBounds(): dentro del viewport y, en móvil, ≥ 44 px y ≥ 14 px. */
async function check(p, where, getter) {
  const { width, height } = parse(p.size);
  const list = await p.page.evaluate(getter);
  if (!Array.isArray(list) || !list.length) { fail(`[${p.size}] ${where}: uiBounds vacío`); return; }
  let bad = 0;
  for (const b of list) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > width + 1 || b.y + b.h > height + 1) { bad++; fail(`[${p.size}] ${where}: «${b.id}» fuera del viewport (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)})`); }
    if (MOBILE.has(p.size)) {
      if (b.kind === 'button' && (b.w < 44 || b.h < 44)) { bad++; fail(`[${p.size}] ${where}: botón «${b.id}» de ${Math.round(b.w)}x${Math.round(b.h)} (< 44 px)`); }
      if (b.fontPx && b.fontPx < 14) { bad++; fail(`[${p.size}] ${where}: «${b.id}» con texto de ${b.fontPx} px (< 14)`); }
    }
  }
  if (!bad) ok(`[${p.size}] ${where}: ${list.length} elementos dentro, ≥44/≥14`);
}

async function tap(p, getter, id) {
  const b = (await p.page.evaluate(getter)).find((x) => x.id === id);
  if (!b) throw new Error(`[${p.size}] no encuentro «${id}»`);
  const x = b.x + b.w / 2;
  const y = b.y + b.h / 2;
  if (p.mobile) await p.page.touchscreen.tap(x, y);
  else await p.page.mouse.click(x, y);
  await sleep(150);
}

const onScreen = (p, name) => p.page.waitForFunction((n) => window.__funtico?.screen?.name === n && window.__funtico.screen.scene.sys.isActive(), { timeout: 15000, polling: 100 }, name);
const onLobby = (p) => p.page.waitForFunction(() => window.__funtico?.menu?.scene?.sys.isActive() && !window.__funtico?.screen, { timeout: 15000, polling: 100 });
const shot = (p, name) => p.page.screenshot({ path: path.join(SHOTS, `${p.size}-${name}.png`) });

async function run(size) {
  console.log(`\n== Lobby en ${size} ==`);
  const mobile = MOBILE.has(size);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const p = { page, size, mobile };
  page.on('pageerror', (e) => fail(`[${size}] error de página: ${(e.stack || e.message).slice(0, 600)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) fail(`[${size}] console.error: ${m.text().slice(0, 200)}`); });
  page.on('request', (r) => { if (/funtico\.com/i.test(r.url())) fail(`[${size}] petición a Funtico en simulado: ${r.url()}`); });
  await page.setViewport(vp(size, mobile));
  await page.goto(`${BASE}/?mock=1`, { waitUntil: 'load' });

  // 1. How to play automático (primera vez): 3 pasos y DONE
  await onScreen(p, 'howto');
  ok(`[${size}] how to play se abre solo la primera vez`);
  await check(p, 'how to play 1', screenB);
  await shot(p, '1-howto');
  await tap(p, screenB, 'next');
  await tap(p, screenB, 'next');
  const step = await page.evaluate(() => window.__funtico.screen.step());
  (step === 2 ? ok : fail)(`[${size}] how to play en el paso ${step + 1} de 3`);
  await check(p, 'how to play 3', screenB);
  await tap(p, screenB, 'done');
  await onLobby(p);

  // 2. Lobby
  await page.waitForFunction(() => window.__funtico.menu.uiBounds().some((b) => b.id === 'bar-user'), { timeout: 10000 });
  await sleep(300);
  await check(p, 'lobby', menuB);
  await shot(p, '2-lobby');
  const ids = (await page.evaluate(menuB)).map((b) => b.id);
  for (const id of ['bar-hof', 'bar-results', 'bar-settings', 'howto', 'card-triage', 'card-campaign', 'play']) if (!ids.includes(id)) fail(`[${size}] lobby sin «${id}»`);
  await tap(p, menuB, 'card-campaign');
  await sleep(300);
  (await page.evaluate(() => window.__funtico.menu.selected()) === 'campaign' ? ok : fail)(`[${size}] tocar CAMPAIGN la elige`);
  await check(p, 'lobby (campaign)', menuB);
  await tap(p, menuB, 'card-triage');
  await sleep(300);

  // 3. Hall of Fame (GLOBAL / MONTHLY) + giro en caliente en vertical
  await tap(p, menuB, 'bar-hof');
  await onScreen(p, 'hof');
  await page.waitForFunction(() => window.__funtico.screen.loaded(), { timeout: 10000 });
  await check(p, 'hall of fame global', screenB);
  await shot(p, '3-hof');
  await tap(p, screenB, 'tab-monthly');
  await page.waitForFunction(() => window.__funtico.screen.loaded() && window.__funtico.screen.period() === 'monthly', { timeout: 10000 });
  const rows = await page.evaluate(() => window.__funtico.screen.rows());
  (rows > 0 ? ok : fail)(`[${size}] hall of fame mensual con ${rows} filas`);
  await check(p, 'hall of fame mensual', screenB);
  if (size === '390x844') {
    for (const s of ['844x390', '390x844']) {
      await page.setViewport(vp(s, true));
      await sleep(500);
      const still = await page.evaluate(() => window.__funtico.screen?.name);
      (still === 'hof' ? ok : fail)(`[${size}] giro a ${s}: sigue en el Hall of Fame (${still})`);
      await check({ ...p, size: s }, `hall of fame (girado a ${s})`, screenB);
      if (s === '844x390') await page.screenshot({ path: path.join(SHOTS, `${size}-3b-hof-girado.png`) });
    }
  }
  await tap(p, screenB, 'bar-back');
  await onLobby(p);

  // 4. Mis resultados
  await tap(p, menuB, 'bar-results');
  await onScreen(p, 'results');
  await sleep(300);
  await check(p, 'mis resultados triage', screenB);
  await tap(p, screenB, 'tab-campaign');
  await sleep(200);
  (await page.evaluate(() => window.__funtico.screen.tab()) === 'campaign' ? ok : fail)(`[${size}] mis resultados: pestaña CAMPAIGN`);
  await check(p, 'mis resultados campaign', screenB);
  await shot(p, '4-results');
  await tap(p, screenB, 'bar-back');
  await onLobby(p);

  // 5. Ajustes: el volumen cambia y persiste
  await tap(p, menuB, 'bar-settings');
  await onScreen(p, 'settings');
  await check(p, 'ajustes', screenB);
  const sl = (await page.evaluate(screenB)).find((b) => b.id === 'sound');
  const tx = sl.x + 12 + (sl.w - 24) * 0.25;
  if (mobile) await page.touchscreen.tap(tx, sl.y + sl.h / 2); else await page.mouse.click(tx, sl.y + sl.h / 2);
  await sleep(200);
  const v1 = await page.evaluate(() => window.__funtico.screen.values().sfx);
  (Math.abs(v1 - 0.25) <= 0.06 ? ok : fail)(`[${size}] volumen de sonido tras tocar al 25 %: ${v1}`);
  const vol = await page.evaluate(() => window.__funtico.game.sound.volume);
  (Math.abs(vol - v1) < 0.001 ? ok : fail)(`[${size}] this.sound.volume = ${vol}`);
  await shot(p, '5-settings');
  await page.reload({ waitUntil: 'load' });
  await onLobby(p);
  const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').sfx, SETTINGS_KEY);
  (kept === v1 ? ok : fail)(`[${size}] el volumen persiste tras recargar (${kept}); sin how to play la segunda vez`);
  await tap(p, menuB, 'bar-settings');
  await onScreen(p, 'settings');
  (await page.evaluate(() => window.__funtico.screen.values().sfx) === v1 ? ok : fail)(`[${size}] ajustes releídos`);
  await tap(p, screenB, 'close');
  await onLobby(p);

  // 6. Tarjeta TRIAGE + PLAY
  await tap(p, menuB, 'card-triage');
  await sleep(300);
  await tap(p, menuB, 'play');
  await page.waitForFunction(() => {
    const m = window.__funtico.game.scene;
    return m.isActive('TriageStartScene') || m.isActive('TriageScene');
  }, { timeout: 20000, polling: 100 }).then(() => ok(`[${size}] PLAY con TRIAGE arranca Triage`), () => fail(`[${size}] PLAY no arranca Triage`));
  await ctx.close();
}

try {
  for (const s of SIZES) {
    try { await run(s); } catch (e) { fail(`[${s}] excepción: ${(e.stack || e.message).slice(0, 600)}`); }
  }
} finally {
  await browser.close();
  server?.close();
}
console.log(failures.length ? `\nLobby e2e: ${failures.length} fallos` : '\nLobby e2e: todo bien');
process.exit(failures.length ? 1 : 0);

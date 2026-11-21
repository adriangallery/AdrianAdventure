// F3.1 (plan FUNTICO_ADVENTURE): juega el capítulo 1 con la ruta crítica del walkthrough (qa/walkthrough.json,
// `ruta-critica` cortada con `--until chapter:1`, como el job de WebKit) en el BUILD FUNTICO, con el recolector de
// métricas instalado (funtico/campaign.html), y comprueba las métricas de Campaign contra lo que dice el propio juego:
//   completed      = 1 y el recolector pasa al capítulo 2
//   time_s         = tiempo jugado en la marca del capítulo 1 (chapterTimes.marks[1], A9.14) ± 1 s
//   actions        = acciones de QA (qaActions, el mismo punto del código) del cap. 1 + las del 2 (las de después del cierre)
//   hints          = llamadas a Anon de la ruta que dieron pista (nivel ≥ 1, `journalLastCall` tras cada callAnon)
//   hint_max_level = el nivel más alto de esas llamadas
//   fails          = respuestas de fallo nuevas (lastFailResponse de QA cambia) que no son de LOOK
//   duel_losses    = 0 y optional = 0 (el capítulo 1 no tiene duelos ni logros opcionales)
// Los pasos del walkthrough se juegan con la API de QA igual que scripts/walkthrough.mjs; sus `expect` de escena,
// inventario y flags son obligatorios (el resto de comprobaciones, de audio, píxeles, etc., las hace ya el walkthrough
// normal y aquí solo se avisan).
//
// F3.2a: la página es la de un expediente (campaign.html?chapter=1, parte del build desplegado; ver
// scripts/funtico/lib/campaign-route.mjs) y ya no hace falta FUNTICO_CAMPAIGN_HARNESS.
// Uso (por turno-pesado):
//   npx vite build --mode funtico && cp -r assets dist-funtico/
//   npx vite preview --mode funtico --outDir dist-funtico --host 127.0.0.1 --port 4175 --strictPort &
//   BASE_URL=http://127.0.0.1:4175 node scripts/funtico/campaign-metrics-e2e.mjs
// Sale con 0 si todo cuadra; deja un informe en campaign-metrics-e2e/report.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';
import { chapter1Route, playChapter1, IGNORE, FUNTICO_HOST } from './lib/campaign-route.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const OUT = process.env.CAMPAIGN_E2E_OUT || 'campaign-metrics-e2e';
mkdirSync(OUT, { recursive: true });

const route = chapter1Route();

const metricsOf = (page) => page.evaluate(() => {
  const m = window.__funtico?.metrics;
  return m ? { chapter: m.chapter, ch1: m.metrics(1), ch2: m.metrics(2), json: m.toJSON() } : null;
});
const gameState = (page) => page.evaluate(() => {
  const st = window.__game.registry.get('gameState');
  return st ? { playTimeMs: st.playTimeMs ?? 0, chapterTimes: st.chapterTimes ?? null, flags: st.flags ?? {} } : null;
});

const browser = await launchBrowser({
  engine: 'chromium',
  puppeteerOpts: {
    headless: true,
    protocolTimeout: 600_000,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  },
});
const problems = [];
const warnings = [];
const report = { base: BASE, steps: [], expected: {}, metrics: null, problems, warnings, ok: false };
let exitCode = 1;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (err) => problems.push(`error de página: ${err.message.split('\n')[0]}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !IGNORE.some((re) => re.test(text))) problems.push(`console.error: ${text.slice(0, 200)}`);
    if (msg.type() === 'warn' && /\[platform\]/.test(text)) problems.push(`gancho roto: ${text.slice(0, 200)}`);
  });
  // Nada sale hacia Funtico (el banco de pruebas no usa el SDK)
  page.on('request', (req) => { if (FUNTICO_HOST.test(req.url())) problems.push(`petición a Funtico: ${req.url()}`); });

  // F3.2a: la página de un expediente (entra directa al capítulo; `newGame` de la ruta = esperar la primera escena)
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await page.goto(`${BASE}/campaign.html?chapter=1&qa=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const { hints, hintMax, fails } = await playChapter1(page, route, problems, warnings, (s) => report.steps.push(s));

  const gs = await gameState(page);
  const m = await metricsOf(page);
  const qaActions = (await page.evaluate(() => window.__qa.state())).actions;
  report.metrics = m;
  const mark1 = gs?.chapterTimes?.marks?.[1];
  report.expected = { completed: 1, mark1Ms: mark1, qaActions, hints, hint_max_level: hintMax, fails, duel_losses: 0, optional: 0 };
  await page.screenshot({ path: `${OUT}/final.png` });

  if (!problems.length) {
    const want = (cond, msg) => { if (!cond) problems.push(msg); };
    want(!!gs?.flags?.chapter_1_complete, 'la ruta no cerró el capítulo 1 (chapter_1_complete)');
    want(m !== null, 'no hay window.__funtico.metrics');
    if (m) {
      const c = m.ch1;
      want(c.completed === 1, `completed = ${c.completed}, se esperaba 1`);
      want(m.chapter === 2, `capítulo en curso = ${m.chapter}, se esperaba 2`);
      want(typeof mark1 === 'number' && mark1 > 0, `sin marca de tiempo del capítulo 1 (${mark1})`);
      if (typeof mark1 === 'number') want(Math.abs(c.time_s - Math.floor(mark1 / 1000)) <= 1, `time_s = ${c.time_s}, tiempo jugado en la marca = ${Math.floor(mark1 / 1000)} s`);
      want(c.time_s > 0, 'time_s = 0');
      want(c.actions + m.ch2.actions === qaActions, `actions = ${c.actions} (+${m.ch2.actions} del cap. 2), qaActions = ${qaActions}`);
      want(c.actions > 0, 'actions = 0');
      want(c.hints === hints, `hints = ${c.hints}, se esperaban ${hints}`);
      want(c.hint_max_level === hintMax, `hint_max_level = ${c.hint_max_level}, se esperaba ${hintMax}`);
      want(c.fails === fails, `fails = ${c.fails}, se esperaban ${fails} (respuestas de fallo vistas por QA)`);
      want(c.duel_losses === 0, `duel_losses = ${c.duel_losses}`);
      want(c.optional === 0, `optional = ${c.optional}`);
    }
  }
  report.ok = problems.length === 0;
  exitCode = report.ok ? 0 : 1;
} catch (err) {
  problems.push(`fallo del runner: ${err.message ?? err}`);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(`Campaign F3.1: ${route.steps.length} pasos del cap. 1 contra ${BASE}/campaign.html`);
if (report.metrics) console.log(`métricas cap. 1: ${JSON.stringify(report.metrics.ch1)}`);
console.log(`esperado: ${JSON.stringify(report.expected)}`);
for (const w of warnings) console.log(`aviso: ${w}`);
for (const p of problems) console.log(`FALLO: ${p}`);
console.log(exitCode === 0 ? 'OK' : 'FALLO');
process.exit(exitCode);

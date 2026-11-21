// F3.2a (plan FUNTICO_ADVENTURE): Campaign de punta a punta en el build funtico, en modo simulado:
//   menú Funtico → CAMPAIGN → mapa (caso 2 bloqueado) → expediente 1 → ruta crítica del capítulo 1 (qa/walkthrough.json,
//   como campaign-metrics-e2e.mjs) → resultado con estrellas → MAP → mapa con el caso 2 abierto → expediente 2 arranca
//   en su estado canónico (lobby, capítulo 1 cerrado).
// Además: src/funtico/campaign/states.json al día (el estado al cerrar el capítulo 1 = el canónico del 2), guardado en
// claves propias (`adrian_adventure_funtico_campaign_<userId>_…`, nunca `adrian_adventure_save`), capturas del mapa y
// del resultado en 390×844, 844×390, 1280×720 y 1920×1080 con comprobación de bounds (todo dentro del viewport,
// botones ≥ 44 px, texto ≥ 14 px) y ninguna petición a dominios de Funtico.
//
// Uso (por turno-pesado):
//   npx vite build --mode funtico && cp -r assets dist-funtico/
//   npx vite preview --mode funtico --outDir dist-funtico --host 127.0.0.1 --port 4175 --strictPort &
//   BASE_URL=http://127.0.0.1:4175 node scripts/funtico/campaign-e2e.mjs
// Informe y capturas en campaign-e2e/ (CAMPAIGN_E2E_OUT).
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';
import { chapter1Route, playChapter1, snapshotForStates, IGNORE, FUNTICO_HOST } from './lib/campaign-route.mjs';
import { diffStates, serialize, statesFromSnapshot } from './lib/campaign-states.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const OUT = process.env.CAMPAIGN_E2E_OUT || 'campaign-e2e';
const VIEWPORTS = [[390, 844], [844, 390], [1280, 720], [1920, 1080]];
mkdirSync(OUT, { recursive: true });

const problems = [];
const lateProblems = [];
const warnings = [];
const report = { base: BASE, steps: [], bounds: {}, result: null, map: null, ok: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Todo dentro del viewport, botones ≥ 44×44, texto ≥ 14 px. */
function checkBounds(tag, list, w, h) {
  const bad = [];
  for (const b of list) {
    const eps = 0.5;
    if (b.x < -eps || b.y < -eps || b.x + b.w > w + eps || b.y + b.h > h + eps) bad.push(`${b.id} fuera (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`);
    if (b.kind === 'button' && (b.h < 44 || b.w < 44)) bad.push(`${b.id} botón de ${Math.round(b.w)}×${Math.round(b.h)}`);
    if (typeof b.fontPx === 'number' && b.fontPx < 14) bad.push(`${b.id} texto de ${b.fontPx}px`);
  }
  report.bounds[tag] = { count: list.length, bad };
  for (const x of bad) problems.push(`${tag}: ${x}`);
}

async function shoot(page, tag, getBounds) {
  for (const [w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await sleep(600);
    const list = await page.evaluate(getBounds);
    if (!Array.isArray(list) || !list.length) problems.push(`${tag} ${w}x${h}: sin uiBounds`);
    else checkBounds(`${tag} ${w}x${h}`, list, w, h);
    await page.screenshot({ path: `${OUT}/${tag}-${w}x${h}.png` });
  }
  await page.setViewport({ width: 1280, height: 720 });
  await sleep(300);
}

/** Toca el centro de un elemento de uiBounds. */
async function tap(page, getBounds, id) {
  const list = await page.evaluate(getBounds);
  const b = list.find((x) => x.id === id);
  if (!b) throw new Error(`no encuentro «${id}» en pantalla`);
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
}

const mapBounds = () => window.__funtico?.campaign?.map?.uiBounds() ?? [];
const resultBounds = () => window.__funtico?.campaign?.result?.uiBounds() ?? [];
const menuBounds = () => window.__funtico?.menu?.uiBounds() ?? [];

const browser = await launchBrowser({
  engine: 'chromium',
  puppeteerOpts: { headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] },
});
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
  page.on('request', (req) => { if (FUNTICO_HOST.test(req.url())) problems.push(`petición a Funtico: ${req.url()}`); });

  // 1. Menú (almacenamiento limpio) → CAMPAIGN → mapa
  await page.goto(`${BASE}/index.html?mock=1&qa=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html?mock=1&qa=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => !!window.__funtico?.menu, { timeout: 60_000, polling: 200 });
  await sleep(500);
  await tap(page, menuBounds, 'campaign');
  await page.waitForFunction(() => window.__funtico?.campaign?.map?.ready() === true, { timeout: 30_000, polling: 200 });
  const before = await page.evaluate(() => window.__funtico.campaign.map.cases());
  report.steps.push({ step: 'mapa inicial', cases: before });
  const st = Object.fromEntries(before.map((c) => [c.chapter, c.state]));
  if (st[1] !== 'open' || st[2] !== 'locked' || st[3] !== 'soon' || st[4] !== 'soon' || st[5] !== 'soon') problems.push(`mapa inicial: estados ${JSON.stringify(st)} (se esperaba 1 open, 2 locked, 3-5 soon)`);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/map-initial-390x844.png` });
  await page.setViewport({ width: 1280, height: 720 });
  await sleep(400);

  // 2. Expediente 1 → ruta crítica del capítulo 1
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }), tap(page, mapBounds, 'case-1')]);
  if (!/campaign\.html\?.*chapter=1/.test(page.url())) problems.push(`el expediente 1 abrió ${page.url()}`);
  if (!problems.length) {
    const route = chapter1Route();
    await playChapter1(page, route, problems, warnings, (s) => report.steps.push(s));
  }

  // 3. Resultado
  if (!problems.length) {
    await page.waitForFunction(() => window.__funtico?.campaign?.state === 'result' && !!window.__funtico.campaign.result, { timeout: 60_000, polling: 250 });
    const snap = await snapshotForStates(page);
    const gen = statesFromSnapshot(snap);
    // Copia de lo generado (artefacto del CI): si states.json está desfasado, se puede versionar desde aquí
    writeFileSync(`${OUT}/states.generated.json`, serialize(gen));
    const d = diffStates(gen);
    // no corta el recorrido: se apunta al final (así salen igual las capturas del mapa)
    if (d) lateProblems.push(`${d}. Regenera con scripts/funtico/build-campaign-states.mjs (o copia campaign-e2e/states.generated.json)`);
    await sleep(800); // el puente (mock) contesta
    const r = await page.evaluate(() => {
      const c = window.__funtico.campaign;
      const keys = Object.keys(localStorage);
      return { stars: c.result.stars, metrics: c.result.metrics, outcome: c.result.outcome, bridge: c.result.bridge, keys, userId: c.userId };
    });
    report.result = r;
    if (!(r.stars >= 1)) problems.push(`resultado con ${r.stars} estrellas`);
    if (r.metrics?.completed !== 1) problems.push(`completed = ${r.metrics?.completed}`);
    if (r.outcome?.unlockedCase !== 2) problems.push(`el resultado no abre el caso 2 (${JSON.stringify(r.outcome?.unlockedCase)})`);
    if (!r.bridge?.ok) problems.push(`puente: completeCampaignLevel ${JSON.stringify(r.bridge)}`);
    if (r.keys.includes('adrian_adventure_save')) problems.push('la campaña escribió adrian_adventure_save');
    const pref = `adrian_adventure_funtico_campaign_${r.userId}_`;
    if (!r.keys.includes(`${pref}progress`)) problems.push(`no está ${pref}progress (claves: ${r.keys.join(', ')})`);
    if (r.keys.some((k) => k.startsWith(`${pref}ch1_`))) warnings.push('quedan claves de la partida en curso del cap. 1 tras el resultado');
    await shoot(page, 'result', resultBounds);
  }

  // 4. MAP → mapa con el caso 2 abierto
  if (!problems.length) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }), tap(page, resultBounds, 'map')]);
    await page.waitForFunction(() => window.__funtico?.campaign?.map?.ready() === true, { timeout: 30_000, polling: 200 });
    const after = await page.evaluate(() => window.__funtico.campaign.map.cases());
    report.map = after;
    const c1 = after.find((c) => c.chapter === 1);
    const c2 = after.find((c) => c.chapter === 2);
    if (c2?.state !== 'open') problems.push(`tras el cap. 1 el caso 2 está «${c2?.state}»`);
    if (!(c1?.stars >= 1) || !(c1?.bestTimeS >= 0)) problems.push(`el caso 1 no pinta estrellas/tiempo: ${JSON.stringify(c1)}`);
    await shoot(page, 'map', mapBounds);
  }

  // 5. Expediente 2: arranca en su estado canónico
  if (!problems.length) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }), tap(page, mapBounds, 'case-2')]);
    await page.waitForFunction(() => window.__game?.scene.isActive('GameScene') && window.__game.scene.isActive('UIScene'), { timeout: 90_000, polling: 250 });
    await sleep(1500);
    const s2 = await page.evaluate(() => {
      const st = window.__game.registry.get('gameState');
      return { scene: st?.currentScene, ch1: !!st?.flags?.chapter_1_complete, metricsChapter: window.__funtico?.metrics?.chapter, menu: window.__game.scene.getScene('MenuScene')?.constructor?.name };
    });
    report.chapter2 = s2;
    if (s2.scene !== 'lobby' || !s2.ch1) problems.push(`el expediente 2 no arranca en su estado canónico: ${JSON.stringify(s2)}`);
    if (s2.metricsChapter !== 2) problems.push(`el recolector mide el capítulo ${s2.metricsChapter}`);
    await page.screenshot({ path: `${OUT}/chapter2-start.png` });
  }
  problems.push(...lateProblems);
  report.ok = problems.length === 0;
  exitCode = report.ok ? 0 : 1;
} catch (err) {
  problems.push(`fallo del runner: ${err.message ?? err}`);
} finally {
  report.problems = problems;
  report.warnings = warnings;
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
for (const w of warnings.slice(0, 40)) console.log(`aviso: ${w}`);
for (const p of problems) console.log(`FALLO: ${p}`);
if (report.result) console.log(`resultado cap. 1: ${report.result.stars} estrellas, ${JSON.stringify(report.result.metrics)}`);
console.log(exitCode === 0 ? 'OK' : 'FALLO');
process.exit(exitCode);

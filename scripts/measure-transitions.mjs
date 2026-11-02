// A2.7 (plan SCUMM): MB por la red y tiempo hasta jugable en tres momentos, con la red limitada (por defecto
// 20 Mbit/s, 40 ms) para comparar un build con otro aunque uno esté en local y otro en producción:
//   1. primera carga de outside (?qa=1&scene=outside, perfil limpio)
//   2. outside → lobby, primera vez (tras esperar PREFETCH_WAIT_MS en outside, lo que tarde la precarga)
//   3. lobby → outside, segunda vez
// Solo usa window.__game y __qa.goto (existen antes de A2.7), así vale para main y para esta rama.
// Uso: BASE_URL=https://adventure.adrianzero.com node scripts/measure-transitions.mjs [--json]
import puppeteer from 'puppeteer';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const DOWN = Number(process.env.MEASURE_DOWN_MBPS || 20);
const RTT = Number(process.env.MEASURE_RTT_MS || 40);
const PREFETCH_WAIT_MS = Number(process.env.PREFETCH_WAIT_MS || 20000);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1280, height: 720 });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: RTT, downloadThroughput: (DOWN * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 });

let phase = 'arranque';
const reqs = new Map();
const rows = [];
cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { phase, url: e.request.url, type: e.type, bytes: 0, cache: false }));
cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.cache = true; });
cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache)) r.cache = true; });
cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });

const inScene = (id) => page.waitForFunction((sid) => {
  const g = window.__game;
  if (!g) return false;
  const pre = g.scene.getScene('PreloadScene');
  // pantalla de carga completa = PreloadScene activa con su barra, porcentaje y frase
  if (g.scene.isActive('PreloadScene') && (pre.children?.list?.length ?? 0) >= 4) window.__sawLoadingScreen = true;
  return g.scene.isActive('GameScene') && !g.scene.isActive('PreloadScene') && g.registry.get('currentSceneId') === sid && !!g.registry.get('sceneData');
}, { timeout: 120000, polling: 'raf' }, id);

function close(name, ms, screen) {
  const list = [...reqs.values()].filter((r) => r.phase === name && !r.cache && r.url.startsWith(BASE));
  const scenes = list.filter((r) => /\/assets\/scenes\//.test(r.url));
  rows.push({ phase: name, mb: list.reduce((a, r) => a + r.bytes, 0) / 1048576, sceneFiles: scenes.length, ms, loadingScreen: screen });
}

phase = 'primera carga outside';
await page.goto(`${BASE}/?qa=1&scene=outside`, { waitUntil: 'domcontentloaded' });
await inScene('outside');
close(phase, await page.evaluate(() => Math.round(performance.now())), true);
phase = 'en outside (precarga)';
await page.evaluate(() => window.__qa?.dismissAll()).catch(() => {});
await new Promise((r) => setTimeout(r, PREFETCH_WAIT_MS));
close(phase, PREFETCH_WAIT_MS, false);

for (const [name, to] of [['outside → lobby (1.ª vez)', 'lobby'], ['lobby → outside (2.ª vez)', 'outside']]) {
  phase = name;
  await page.evaluate((id) => { window.__sawLoadingScreen = false; window.__t0 = performance.now(); window.__qa.goto(id).catch(() => {}); }, to);
  await inScene(to);
  const r = await page.evaluate(() => ({ ms: Math.round(performance.now() - window.__t0), screen: !!window.__sawLoadingScreen }));
  close(name, r.ms, r.screen);
  phase = `en ${to}`;
  await page.evaluate(() => window.__qa.dismissAll()).catch(() => {});
  if (to === 'lobby') await new Promise((r) => setTimeout(r, PREFETCH_WAIT_MS / 2));
}

await browser.close();
if (process.argv.includes('--json')) console.log(JSON.stringify({ base: BASE, down: DOWN, rtt: RTT, rows }, null, 2));
else {
  console.log(`${BASE} · red ${DOWN} Mbit/s, ${RTT} ms`);
  for (const r of rows) console.log(`  ${r.phase.padEnd(28)} ${r.mb.toFixed(2).padStart(7)} MB · ${String(r.sceneFiles).padStart(3)} ficheros de escena · ${String(r.ms).padStart(6)} ms${r.phase.includes('→') ? ` · pantalla de carga: ${r.loadingScreen ? 'sí' : 'no'}` : ''}`);
}

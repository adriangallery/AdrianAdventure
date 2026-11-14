// Demo de A9.17 (estadísticas anónimas + página /stats con acceso por firma):
//  1) levanta un save-server de /stats LOCAL (mismas rutas que producción: save-server/stats-routes.js, en node:http,
//     almacén en un directorio temporal) con una wallet de PRUEBA generada aquí en STATS_ADMINS;
//  2) mete eventos de prueba de 10 días (partidas nuevas/continuadas, capítulos, abandonos, móvil/escritorio…);
//  3) abre /stats/?api=… en 390×844 con un proveedor EIP-1193 mínimo inyectado (firma con la clave de prueba en Node,
//     personal_sign: nunca una transacción), pulsa «Connect wallet» y espera el panel → stats-390.png;
//  4) lo mismo en 1280×800 → stats-1280.png; y comprueba que una wallet que no está en la lista se queda fuera (401).
// Capturas en demo-out/a9-17-stats/ y copia en $SHOTS_DIR (por defecto /var/tmp/adv-a9-17 si existe).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-17-stats
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { startDemo } from './lib/demo.mjs';
import { createStatsStore, parseEvent } from '../save-server/stats.js';
import { createStatsAuth } from '../save-server/stats-auth.js';
import { createStatsRoutes } from '../save-server/stats-routes.js';

const admin = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const dir = mkdtempSync(join(tmpdir(), 'adv-a9-17-stats-'));
let clock = Date.now();
const store = createStatsStore({ dir, now: () => clock });
const auth = createStatsAuth({ admins: [admin.address], secret: 'demo-secret-'.repeat(4), verify: verifyMessage });
const routes = createStatsRoutes({ store, auth });

// ── Eventos de prueba (10 días; deterministas) ──
const SCENES = ['outside', 'lobby', 'upstairs', 'basement', 'clinic', 'trading_floor'];
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const today = Date.now();
for (let d = 9; d >= 0; d--) {
  clock = today - d * 86400000;
  const players = 6 + Math.floor(rnd() * 10);
  for (let p = 0; p < players; p++) {
    const sid = `demo${d}x${p}`.padEnd(12, '0');
    const base = { sid, m: rnd() < 0.62, br: ['chrome', 'safari', 'firefox', 'edge'][Math.floor(rnd() * 4)], w: rnd() < 0.3 };
    const put = (ev) => store.record(parseEvent({ ...base, ...ev }));
    put({ t: 'session_start' });
    put({ t: rnd() < 0.7 ? 'new_game' : 'continue' });
    let ch = 1;
    put({ t: 'chapter_start', ch });
    while (ch <= 5 && rnd() < 0.72) {
      put({ t: 'chapter_complete', ch, s: Math.round(900 + rnd() * 1800) });
      if (ch < 5) put({ t: 'chapter_start', ch: ch + 1 });
      ch++;
    }
    if (ch > 5) put({ t: 'game_complete' });
    put({ t: 'quit_scene', scene: SCENES[Math.min(SCENES.length - 1, Math.floor(rnd() * SCENES.length))] });
  }
}
clock = today;

// ── Servidor http mínimo con CORS para la página ──
const server = createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let bodyText = '';
  for await (const chunk of req) bodyText += chunk;
  const r = await routes({ method: req.method, path: new URL(req.url, 'http://x').pathname, headers: req.headers, bodyText, ip: '127.0.0.1' });
  res.writeHead(r?.status ?? 404, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r?.body ?? { error: 'Not found' }));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const API = `http://127.0.0.1:${server.address().port}`;
console.log(`save-server de /stats local en ${API} (admin de prueba ${admin.address})`);

const demo = await startDemo(import.meta.url, { fps: 3, width: 390, viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } });
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

let signer = admin;
await page.exposeFunction('__demoSign', async (message) => signer.signMessage({ message }));
await page.exposeFunction('__demoAddress', async () => signer.address);
// Proveedor EIP-1193 mínimo: cuentas, cadena Base y personal_sign. Cualquier otra cosa (p. ej. una transacción) falla.
await page.evaluateOnNewDocument(() => {
  const hexToText = (hex) => new TextDecoder().decode(new Uint8Array(hex.slice(2).match(/../g).map((b) => parseInt(b, 16))));
  window.__demoRequests = [];
  window.ethereum = {
    isDemo: true,
    on() {}, removeListener() {},
    async request({ method, params }) {
      window.__demoRequests.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [await window.__demoAddress()];
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'personal_sign') {
        const raw = params[0];
        return window.__demoSign(/^0x[0-9a-f]*$/i.test(raw) ? hexToText(raw) : raw);
      }
      throw Object.assign(new Error(`demo provider: ${method} not supported`), { code: 4200 });
    },
  };
});

const SHOTS = process.env.SHOTS_DIR || (existsSync('/var/tmp/adv-a9-17') ? '/var/tmp/adv-a9-17' : null);
async function signInAndShoot(label) {
  await page.goto(`${demo.base}/stats/?api=${encodeURIComponent(API)}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const robots = await page.$eval('meta[name=robots]', (m) => m.content).catch(() => null);
  check(robots === 'noindex,nofollow', `${label}: meta robots noindex,nofollow`);
  await demo.shot();
  await page.click('#connect');
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error === '1', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await demo.sleep(500);
  const info = await page.evaluate(() => ({
    ready: document.body.dataset.ready === '1',
    status: document.getElementById('status').textContent,
    cards: document.querySelectorAll('#dash .card').length,
    kpis: [...document.querySelectorAll('.kpi b')].map((b) => b.textContent),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    methods: window.__demoRequests,
    font: getComputedStyle(document.body).fontFamily,
  }));
  check(info.ready, `${label}: panel cargado tras firmar (${info.status})`);
  check(info.cards >= 8, `${label}: ${info.cards} bloques de gráficas`);
  check(info.kpis.length === 3 && info.kpis[0] !== '0', `${label}: KPIs ${info.kpis.join(' / ')}`);
  check(!info.overflow, `${label}: sin scroll horizontal`);
  check(!info.methods.some((m) => /send|Transaction/i.test(m)), `${label}: solo firma (${[...new Set(info.methods)].join(', ')})`);
  for (let i = 0; i < 4; i++) await demo.shot();
  await demo.still(label, { fullPage: true });
  if (SHOTS) copyFileSync(join(demo.dir, `${label}.png`), join(SHOTS, `${label}.png`));
}

try {
  await signInAndShoot('stats-390');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await signInAndShoot('stats-1280');

  // Wallet que no está en la lista: firma válida pero 401 y la página lo dice
  signer = stranger;
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('#connect');
  await page.waitForFunction(() => document.body.dataset.error === '1' || document.body.dataset.ready === '1', { timeout: 30000 });
  const denied = await page.evaluate(() => ({ err: document.body.dataset.error === '1', dash: !document.getElementById('dash').hidden, text: document.getElementById('status').textContent }));
  check(denied.err && !denied.dash, `wallet fuera de la lista: rechazada («${denied.text}»)`);
  await demo.still('stats-denied');
  // Sin token → 401 directo al servidor
  const r = await fetch(`${API}/stats/summary`);
  check(r.status === 401, `GET /stats/summary sin token → ${r.status}`);
} catch (e) {
  problems.push(String(e?.stack || e));
  console.error(e);
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

await demo.end();
if (problems.length) await demo.fail(`A9.17: ${problems.length} problema(s):\n- ${problems.join('\n- ')}`);
console.log('A9.17 OK');

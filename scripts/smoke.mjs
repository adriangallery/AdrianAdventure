// Tests de humo de AdrianAdventure (plan AdrianZERO V8). Corre en GitHub Actions contra `vite preview`
// del build real (con assets): arranque, cada escena, cambio de escena en caliente y guardar/cargar.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/smoke.mjs
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SHOTS = 'smoke-shots';
const SCENE_TIMEOUT = Number(process.env.SMOKE_SCENE_TIMEOUT_MS || 90000);
const scenes = readdirSync('assets/scenes', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
if (!existsSync(SHOTS)) mkdirSync(SHOTS);

// Ruido conocido que no rompe el juego (audio sin gesto del usuario, wallet sin extensión).
const IGNORE = [/AudioContext/i, /autoplay/i, /WalletConnect/i, /ethereum/i, /favicon/i];
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✖ ${msg}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
let context = 'arranque';
page.on('pageerror', (err) => fail(`[${context}] error de página: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/Failed to load resource/.test(text) || IGNORE.some((re) => re.test(text))) return;
  fail(`[${context}] console.error: ${text.slice(0, 200)}`);
});
page.on('response', (res) => {
  const url = res.url();
  if (url.startsWith(BASE) && res.status() >= 400 && !/favicon/.test(url)) fail(`[${context}] ${res.status()} ${url.replace(BASE, '')}`);
});

const waitGame = (fn, arg, timeout = SCENE_TIMEOUT) => page.waitForFunction(fn, { timeout, polling: 500 }, arg);

async function step(name, fn) {
  context = name;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    fail(`[${name}] ${err.message.split('\n')[0]}`);
  }
}

console.log(`Smoke de AdrianAdventure contra ${BASE} · ${scenes.length} escenas`);

await step('menú', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await waitGame(() => window.__game?.scene?.isActive('MenuScene'));
  await page.screenshot({ path: `${SHOTS}/00-menu.png` });
});

for (const [i, id] of scenes.entries()) {
  await step(`escena ${id}`, async () => {
    await page.goto(`${BASE}/?scene=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' });
    await waitGame(
      (sceneId) => {
        const g = window.__game;
        return !!g && g.scene.isActive('GameScene') && g.registry.get('currentSceneId') === sceneId && !!g.registry.get('sceneData');
      },
      id,
    );
    await page.screenshot({ path: `${SHOTS}/${String(i + 1).padStart(2, '0')}-${id}.png` });
  });
}

const [first, second] = scenes;
await step(`cambio de escena en caliente ${first} → ${second}`, async () => {
  await page.goto(`${BASE}/?scene=${encodeURIComponent(first)}`, { waitUntil: 'domcontentloaded' });
  await waitGame((sceneId) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === sceneId, first);
  await page.evaluate((next) => {
    const g = window.__game;
    g.registry.set('currentSceneId', next);
    g.scene.stop('GameScene');
    g.scene.start('PreloadScene');
  }, second);
  await waitGame((sceneId) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === sceneId, second);
});

await step('guardar y cargar', async () => {
  const ok = await page.evaluate((sceneId) => {
    const save = window.__game.registry.get('saveSystem');
    if (!save) return 'sin saveSystem en el registry';
    const state = { currentScene: sceneId, flags: { smoke: true }, inventory: [], visited: [sceneId], firedTriggers: [], dialogueProgress: {}, achievements: [], savedAt: Date.now() };
    save.saveToSlot(1, state, sceneId);
    const back = save.loadFromSlot(1);
    save.deleteSlot(1);
    if (!back) return 'loadFromSlot devolvió null';
    if (back.sceneName !== sceneId || back.state?.flags?.smoke !== true) return `slot distinto: ${JSON.stringify(back).slice(0, 120)}`;
    return 'ok';
  }, second);
  if (ok !== 'ok') throw new Error(ok);
});

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} fallo(s).`);
  process.exit(1);
}
console.log('\nSmoke OK');

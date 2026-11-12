// Tests de humo de AdrianAdventure (plan AdrianZERO V8). Corre en GitHub Actions contra `vite preview`
// del build real (con assets): arranque, cada escena, cambio de escena en caliente y guardar/cargar.
// A1.5 (plan SCUMM): con el sonido apagado no se piden música ni voces; al activarlo en ajustes, sí.
// A1.8: las escenas se abren con ?qa=1&scene=<id>; sin ?qa=1 el build de producción ignora ?scene.
// A2.4: controles de escritorio con teclado y ratón reales (Esc, Tab, doble clic en una salida, clic derecho).
// A2.7: cambio de escena con la precarga hecha y vuelta: sin pantalla de carga y sin volver a descargar; MB y tiempos.
// A2.9: el diario (móvil de Dex) se abre y se cierra con toques reales en 390x844, y con J/Esc.
// A2.5: un PUSH sin script dice la frase 0 de la bolsa verbDefaults.PUSH (ronda fija con ?qa=1) y luego la 1.
// A5.1: memoria de texturas (GPU) y peso por escena en escritorio y móvil; tabla en el resumen y smoke-shots/texture-memory.json.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/smoke.mjs
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import * as SP from './lib/save-panel.mjs';

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

// A1.8: en el build de producción ?scene/?skip/?dev solo valen con ?qa=1; sin él se queda en el menú.
await step('sin ?qa=1 no se salta a una escena', async () => {
  await page.goto(`${BASE}/?scene=treatment_room&skip&dev`, { waitUntil: 'domcontentloaded' });
  await waitGame(() => window.__game?.scene?.isActive('MenuScene'));
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate(() => ({
    game: window.__game.scene.isActive('GameScene') || window.__game.scene.isActive('PreloadScene'),
    menu: window.__game.scene.isActive('MenuScene'),
    selector: !!document.querySelector('button[title="Scene Selector"]'),
  }));
  if (s.game || !s.menu) throw new Error(`?scene sin ?qa=1 sacó al jugador del menú (${JSON.stringify(s)})`);
  if (s.selector) throw new Error('?dev sin ?qa=1 mostró el selector de escenas');
});

for (const [i, id] of scenes.entries()) {
  await step(`escena ${id}`, async () => {
    await page.goto(`${BASE}/?qa=1&scene=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' });
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
  await page.goto(`${BASE}/?qa=1&scene=${encodeURIComponent(first)}`, { waitUntil: 'domcontentloaded' });
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

// A2.7: transiciones con precarga. Perfil limpio: primera carga de `outside` (pantalla completa), espera a que la
// precarga baje el lobby, `outside → lobby` (primera vez, sin pantalla de carga: todo sale de la caché HTTP) y
// `lobby → outside` (segunda vez: ni una petición a assets/scenes/outside/, todo está ya en Phaser). Deja en el log
// los MB bajados por la red y el tiempo de cada fase (la tabla de la PR de A2.7 sale de aquí).
const TRANSITION_MAX_MS = Number(process.env.SMOKE_TRANSITION_MAX_MS || 1500);
await step('transiciones: precarga de vecinas, sin pantalla de carga y sin volver a descargar', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', (err) => fail(`[transiciones] error de página: ${err.message}`));
  let phase = 'primera carga outside';
  const reqs = [];
  const phaseOf = new WeakMap();
  // Las descargas de la precarga (fetch) van aparte; las del juego son XHR del loader de Phaser
  p.on('request', (req) => phaseOf.set(req, req.resourceType() === 'fetch' ? `precarga (${phase})` : phase));
  p.on('requestfinished', async (req) => {
    const res = req.response();
    if (!res || !req.url().startsWith(BASE)) return;
    let len = 0;
    if (!res.fromCache()) {
      len = Number(res.headers()['content-length'] || 0);
      if (!len) { try { len = (await res.buffer()).length; } catch { len = 0; } }
    }
    reqs.push({ phase: phaseOf.get(req) ?? phase, url: req.url().replace(BASE, '').replace(/^\//, '').split('?')[0], cache: res.fromCache(), len });
  });
  const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 200 }, arg);
  const st = () => p.evaluate(() => window.__qa.state());
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  const prefetched = async (scene, file) => {
    await new Promise((r) => setTimeout(r, 1000));
    await wait(({ s, f }) => {
      const pf = window.__qa?.state().prefetch;
      return !!pf && pf.scene === s && !pf.inFlight && pf.pending.length === 0 && (!f || pf.done.includes(f));
    }, { s: scene, f: file }, 60000);
  };
  const summary = (name) => {
    const list = reqs.filter((r) => r.phase === name);
    const net = list.filter((r) => !r.cache);
    return { list, net, bytes: net.reduce((a, r) => a + r.len, 0) };
  };
  const rows = [];
  try {
    await p.goto(`${BASE}/?qa=1&scene=outside`, { waitUntil: 'domcontentloaded' });
    await wait(() => window.__qa?.state().lastTransition?.to === 'outside');
    const first = (await st()).lastTransition;
    if (!first.loadingScreen) throw new Error(`la primera carga del juego no enseñó la pantalla de carga (${JSON.stringify(first)})`);
    await p.evaluate(() => window.__qa.dismissAll());
    await prefetched('outside', 'assets/scenes/lobby/background@2048.webp');
    const pf = (await st()).prefetch;
    console.log(`    precarga desde outside: vecinas ${pf.neighbors.join(', ')} · ${pf.done.length} ficheros`);

    phase = 'outside → lobby (1.ª vez)';
    await p.evaluate(() => window.__qa.goto('lobby'));
    const toLobby = (await st()).lastTransition;
    await p.screenshot({ path: `${SHOTS}/zz-transicion-lobby.png` });
    await prefetched('lobby', null);

    phase = 'lobby → outside (2.ª vez)';
    await p.evaluate(() => window.__qa.goto('outside'));
    const back = (await st()).lastTransition;
    await p.screenshot({ path: `${SHOTS}/zz-transicion-vuelta.png` });

    const a = summary('primera carga outside');
    const b = summary('outside → lobby (1.ª vez)');
    const c = summary('lobby → outside (2.ª vez)');
    rows.push(['primera carga outside', a.bytes, `${first.at} ms hasta jugable`, first.mode]);
    const pre = reqs.filter((r) => r.phase.startsWith('precarga') && !r.cache);
    rows.push(['precarga (segundo plano)', pre.reduce((n, r) => n + r.len, 0), `${pre.length} ficheros`, '-']);
    rows.push(['outside → lobby (1.ª vez)', b.bytes, `${toLobby.ms} ms (carga ${toLobby.loadMs} ms)`, toLobby.mode]);
    rows.push(['lobby → outside (2.ª vez)', c.bytes, `${back.ms} ms (carga ${back.loadMs} ms)`, back.mode]);
    for (const [name, bytes, time, mode] of rows) console.log(`    ${name.padEnd(28)} ${mb(bytes).padStart(9)} por red · ${time} · ${mode}`);

    const lobbyNet = b.net.filter((r) => r.url.startsWith('assets/scenes/lobby/'));
    if (toLobby.to !== 'lobby' || toLobby.loadingScreen) throw new Error(`outside → lobby con la precarga hecha pasó por la pantalla de carga (${JSON.stringify(toLobby)})`);
    if (toLobby.mode !== 'instant') throw new Error(`outside → lobby: modo ${toLobby.mode}, se esperaba instant`);
    if (lobbyNet.length) throw new Error(`outside → lobby volvió a bajar por la red lo precargado: ${lobbyNet.map((r) => r.url).join(', ')}`);
    const outsideReqs = c.list.filter((r) => r.url.startsWith('assets/scenes/outside/'));
    if (back.to !== 'outside' || back.loadingScreen || back.mode !== 'instant') throw new Error(`lobby → outside (segunda vez) no fue instantánea (${JSON.stringify(back)})`);
    if (outsideReqs.length) throw new Error(`lobby → outside (segunda vez) pidió ${outsideReqs.map((r) => `${r.url}${r.cache ? ' (caché)' : ''}`).join(', ')}`);
    for (const t of [toLobby, back]) if (t.ms > TRANSITION_MAX_MS) throw new Error(`${t.from} → ${t.to} tardó ${t.ms} ms (máx. ${TRANSITION_MAX_MS})`);
  } finally {
    await ctx.close();
  }
});

// A5.1: memoria de texturas y peso por escena. Perfil limpio en cada viewport: entra en `outside` y encadena varias
// escenas (`__qa.goto`); tras cada una apunta `state().textures` (bytes estimados en la GPU: ancho × alto × 4 por fuente,
// por categoría; escenas cuyo arte sigue en Phaser; variante de fondo elegida) y los bytes bajados por la red de
// `assets/scenes/<id>/`. Tabla en el log y en el resumen del job; todo en smoke-shots/texture-memory.json. Es la medida
// «antes/después» del checkpoint: con SMOKE_TEXTURE_MAX_MB (tope del arte de escena cargado, en MB) falla si se pasa;
// vacío o 0 = solo medir.
const TEXTURE_MAX_MB = Number(process.env.SMOKE_TEXTURE_MAX_MB || 0);
const TEXTURE_ROUTE = ['outside', 'lobby', 'upstairs', 'rooftop', 'basement', 'server_room'];
const TEXTURE_VIEWPORTS = [
  { label: 'escritorio 1280x720 (DPR 1)', width: 1280, height: 720, dpr: 1, mobile: false, route: TEXTURE_ROUTE },
  { label: 'móvil apaisado 844x390 (DPR 1)', width: 844, height: 390, dpr: 1, mobile: true, route: TEXTURE_ROUTE.slice(0, 3) },
  { label: 'móvil apaisado 844x390 (DPR 3)', width: 844, height: 390, dpr: 3, mobile: true, route: TEXTURE_ROUTE.slice(0, 2) },
];
const textureReport = { viewports: [] };
await step('texturas: memoria estimada en la GPU y peso por escena (A5.1)', async () => {
  const mb = (n) => (n / 1048576).toFixed(1);
  const lines = ['### Memoria de texturas (A5.1)', ''];
  const problems = [];
  for (const vp of TEXTURE_VIEWPORTS) {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: vp.mobile, hasTouch: vp.mobile });
    p.on('pageerror', (err) => fail(`[texturas] error de página: ${err.message}`));
    const net = [];
    p.on('requestfinished', async (req) => {
      const res = req.response();
      if (!res || !req.url().startsWith(BASE) || res.fromCache()) return;
      let len = Number(res.headers()['content-length'] || 0);
      if (!len) { try { len = (await res.buffer()).length; } catch { len = 0; } }
      net.push({ url: req.url().replace(BASE, '').replace(/^\//, '').split('?')[0], len });
    });
    const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 200 }, arg);
    const rows = [];
    try {
      const [first, ...rest] = vp.route;
      await p.goto(`${BASE}/?qa=1&scene=${first}`, { waitUntil: 'domcontentloaded' });
      await wait((s) => window.__qa?.state().lastTransition?.to === s, first);
      await p.evaluate(() => window.__qa.dismissAll()).catch(() => {});
      const snap = async (scene) => {
        const t = await p.evaluate(() => window.__qa.state().textures);
        if (!t) throw new Error('state().textures no existe (API de QA anterior a A5.1)');
        const netBytes = net.filter((r) => r.url.startsWith(`assets/scenes/${scene}/`)).reduce((a, r) => a + r.len, 0);
        rows.push({ scene, netBytes, ...t });
      };
      await snap(first);
      for (const id of rest) {
        await p.evaluate((s) => window.__qa.goto(s), id);
        await p.evaluate(() => window.__qa.dismissAll()).catch(() => {});
        await snap(id);
      }
    } finally {
      await ctx.close();
    }
    const last = rows.at(-1);
    textureReport.viewports.push({ ...vp, variant: last.variant, bgTexture: last.bgTexture, world: last.world, rows });
    console.log(`    ${vp.label}: fondo ${last.bgTexture ? `${last.bgTexture.w}x${last.bgTexture.h}` : '?'}${last.variant ? ` (variante ${last.variant.width}: ${last.variant.reason})` : ' (tamaño completo)'}`);
    console.log(`    ${'escena'.padEnd(14)} ${'texturas'.padStart(10)} ${'arte escena'.padStart(12)} ${'otras esc.'.padStart(11)} ${'escenas'.padStart(8)} ${'red escena'.padStart(11)}`);
    lines.push(`**${vp.label}** · fondo ${last.bgTexture ? `${last.bgTexture.w}x${last.bgTexture.h}` : '?'}${last.variant ? ` (variante ${last.variant.width}: ${last.variant.reason})` : ''}`, '',
      '| escena | texturas (total) | arte de la escena | arte de otras escenas | escenas cargadas | red de la escena |', '|---|---|---|---|---|---|');
    for (const r of rows) {
      const art = r.byKind.scene.bytes;
      const others = r.byKind.otherScenes.bytes;
      console.log(`    ${r.scene.padEnd(14)} ${`${mb(r.bytes)} MB`.padStart(10)} ${`${mb(art)} MB`.padStart(12)} ${`${mb(others)} MB`.padStart(11)} ${String(r.scenesLoaded.length).padStart(8)} ${`${mb(r.netBytes)} MB`.padStart(11)}`);
      lines.push(`| ${r.scene} | ${mb(r.bytes)} MB (${r.count}) | ${mb(art)} MB | ${mb(others)} MB | ${r.scenesLoaded.length} | ${mb(r.netBytes)} MB |`);
      const loaded = art + others;
      if (TEXTURE_MAX_MB && loaded > TEXTURE_MAX_MB * 1048576) problems.push(`${vp.label}, ${r.scene}: ${mb(loaded)} MB de arte de escena en la GPU (máx. ${TEXTURE_MAX_MB})`);
      // A5.1: solo la escena actual y la anterior siguen en Phaser; el resto se libera al cambiar de escena
      if (r.scenesLoaded.length > 2) problems.push(`${vp.label}, ${r.scene}: arte de ${r.scenesLoaded.length} escenas en Phaser (${r.scenesLoaded.join(', ')}; máx. 2: la actual y la anterior)`);
    }
    // A5.1: variante de fondo por viewport (escritorio 2048, móvil apaisado 1280 a cualquier DPR)
    const wantVariant = vp.width === 1280 ? 2048 : 1280;
    if (last.variant?.width !== wantVariant) problems.push(`${vp.label}: variante de fondo ${last.variant?.width ?? 'ninguna'}, se esperaba ${wantVariant}`);
    else if (last.bgTexture?.w !== wantVariant) problems.push(`${vp.label}: la textura del fondo mide ${last.bgTexture?.w} de ancho, se esperaba ${wantVariant}`);
    lines.push('', `Texturas de ≥ 1 MB al final: ${last.big.map((b) => `${b.key} ${b.w}x${b.h} (${mb(b.bytes)} MB)`).join(', ') || 'ninguna'}`, '');
    console.log(`    ≥ 1 MB al final: ${last.big.map((b) => `${b.key} ${b.w}x${b.h}`).join(', ') || 'ninguna'}`);
  }
  writeFileSync(`${SHOTS}/texture-memory.json`, JSON.stringify(textureReport, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (problems.length) throw new Error(problems.join(' | '));
});

// A1.5: arranque con «No thanks, silence is golden» en un perfil limpio. Se registran todas las peticiones y
// falla si se pide algún mp3 de música o de voz (ni en la precarga, ni al cambiar de escena, ni al hablar).
// Después se activa el sonido desde los ajustes del juego (botón «Music» del menú del disquete, con clics reales)
// y la música de la escena actual (otra que la precargada) y la voz tienen que pedirse sin recargar la página.
// A4.4: tampoco los bucles de ambiente
const AUDIO_RE = /\/assets\/audio\/(music|voice|ambience)\/[^/?]+\.mp3/;
const SILENT_SCENE = 'mountain';
const voiceKey = readFileSync('src/config/voice.config.ts', 'utf8').match(/VOICE_TEXT_MAP[\s\S]*?key: '([^']+)'/)?.[1];
await step('silencio: sin música ni voces; al activar el sonido en ajustes, sí', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', (err) => fail(`[silencio] error de página: ${err.message}`));
  let phase = 'silencio';
  const audioReqs = [];
  const phaseOf = new WeakMap();
  const bytes = { silencio: 0, sonido: 0 };
  const audioBytes = { silencio: 0, sonido: 0 };
  p.on('request', (req) => {
    phaseOf.set(req, phase);
    const m = req.url().match(AUDIO_RE);
    if (m) audioReqs.push({ phase, kind: m[1], url: req.url().replace(BASE, '') });
  });
  p.on('response', async (res) => {
    if (!res.url().startsWith(BASE)) return;
    const ph = phaseOf.get(res.request()) ?? phase;
    let len = Number(res.headers()['content-length'] || 0);
    if (!len) { try { len = (await res.buffer()).length; } catch { len = 0; } }
    bytes[ph] += len;
    if (AUDIO_RE.test(res.url())) audioBytes[ph] += len;
  });
  const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 250 }, arg);
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  try {
    await p.goto(`${BASE}/?qa=1`, { waitUntil: 'domcontentloaded' });
    await wait(() => !!window.__qa);
    await p.evaluate(() => window.__qa.newGame());
    // Una frase con voz y un cambio de escena, todo en silencio
    await p.evaluate((key) => window.__game.registry.get('voiceSystem')?.play('smoke voice line', key), voiceKey);
    await p.evaluate((id) => window.__qa.goto(id), SILENT_SCENE);
    await p.evaluate((key) => window.__game.registry.get('voiceSystem')?.play('smoke voice line', key), voiceKey);
    await new Promise((r) => setTimeout(r, 3000));
    const silent = audioReqs.filter((r) => r.phase === 'silencio');
    console.log(`    silencio: ${silent.length} peticiones de audio (${mb(audioBytes.silencio)}) · ${mb(bytes.silencio)} en total`);
    for (const r of silent) console.log(`      ${r.kind}: ${r.url}`);
    await p.screenshot({ path: `${SHOTS}/zz-silencio.png` });
    if (silent.length) throw new Error(`con el sonido apagado se pidieron ${silent.length} mp3 de música/voz: ${silent.map((r) => r.url.split('?')[0]).join(', ')}`);

    // Activar el sonido como el jugador: toque en el disquete (arriba a la izquierda, escala RESIZE = px CSS) y
    // clic real en «Music» de los ajustes. El toque en el lienzo desbloquea el audio de Phaser: las transiciones
    // aplazadas se ejecutan ahí, aún en silencio, y tampoco pueden descargar nada.
    await p.mouse.click(22, 20);
    const MUSIC_BTN = '#save-load-overlay button[data-setting="music"]';
    await p.waitForSelector(MUSIC_BTN, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const late = audioReqs.filter((r) => r.phase === 'silencio');
    if (late.length) throw new Error(`en silencio, al abrir los ajustes se pidieron: ${late.map((r) => r.url.split('?')[0]).join(', ')}`);
    phase = 'sonido';
    await p.click(MUSIC_BTN);
    const label = await p.$eval(MUSIC_BTN, (b) => b.textContent);
    await p.evaluate(() => document.getElementById('save-load-overlay')?.remove());
    if (!/On/.test(label)) throw new Error(`el botón de ajustes no activó el sonido: «${label}»`);
    const music = await p.evaluate(() => window.__game.registry.get('sceneData')?.audio?.music);
    await wait((key) => {
      const mm = window.__game.registry.get('musicManager');
      return !mm.isMuted() && mm.currentKey === key;
    }, music, 60000);
    await p.evaluate((key) => window.__game.registry.get('voiceSystem')?.play('smoke voice line', key), voiceKey);
    await new Promise((r) => setTimeout(r, 3000));
    const loud = audioReqs.filter((r) => r.phase === 'sonido');
    console.log(`    sonido activado en ajustes: ${loud.map((r) => r.url.split('?')[0]).join(', ') || 'nada'} (${mb(audioBytes.sonido)})`);
    if (!loud.some((r) => r.kind === 'music' && r.url.includes(`/${music}.mp3`))) throw new Error(`al activar el sonido no se pidió la música de la escena (${music})`);
    if (voiceKey && !loud.some((r) => r.kind === 'voice')) throw new Error('al activar el sonido la voz no se pidió');
    // A4.4: y el bucle de ambiente de la escena (si lo tiene), que llega a sonar
    const ambience = await p.evaluate(() => window.__game.registry.get('sceneData')?.audio?.ambience ?? null);
    if (ambience) {
      if (!loud.some((r) => r.kind === 'ambience' && r.url.includes(`/${ambience}.mp3`))) throw new Error(`al activar el sonido no se pidió el ambiente de la escena (${ambience})`);
      await wait((key) => window.__qa.state().audio?.ambience?.key === key, ambience, 30000);
      const a = await p.evaluate(() => window.__qa.state().audio.ambience);
      console.log(`    ambiente ${a.key} sonando: gain ${a.gain} · bucle ${a.loop.start}-${a.loop.end} s`);
    }
  } finally {
    await ctx.close();
  }
});

// A2.4: controles de escritorio con teclado y ratón reales de Chrome (no eventos sintéticos de la API de QA). En el lobby
// recién abierto (?qa=1&scene=lobby) el onEnter abre la apertura del capítulo 2 (A3.2: cinemática del motor con franjas,
// pan a Penny, subtítulos y tarjeta): una pulsación de Esc tiene que saltarla entera sin tocar nada más. Luego mantener Tab resalta los hotspots, el menú contextual del lienzo
// está cancelado, el doble clic en la puerta sale al momento (el personaje no anda) y en `outside` el clic derecho en
// la lámpara del porche es PICK (su verbo por defecto; A3.3c: encendida quema y no da la mitad A).
await step('escritorio: Esc, Tab, doble clic en una salida y clic derecho (teclado y ratón reales)', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', (err) => fail(`[escritorio] error de página: ${err.message}`));
  const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 100 }, arg);
  const reg = (key) => p.evaluate((k) => window.__game.registry.get(k), key);
  /** Centro en píxeles de página de un hotspot (bounds en % → mundo → pantalla, más la posición del lienzo) */
  const hotspotXY = (id) => p.evaluate((hid) => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const h = g.registry.get('sceneData').regions.hotspots.find((x) => x.id === hid);
    const c = gs.coordSystem.pctToScreen(h.bounds.x + h.bounds.w / 2, h.bounds.y + h.bounds.h / 2);
    const r = g.canvas.getBoundingClientRect();
    const cam = gs.cameras.main;
    return { x: r.left + c.x - cam.scrollX, y: r.top + c.y - cam.scrollY };
  }, id);
  const isCalm = () => p.evaluate(() => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    return g.scene.isActive('GameScene') && !gs.qaBusy().script && !g.registry.get('dialogueShowing')
      && !(g.registry.get('cinematicActive') > 0) && !g.registry.get('sceneTransition');
  });
  /** Esc (real) cada segundo mientras haya algo en pantalla: textos de triggers de entrada incluidos */
  const escUntilCalm = async (what) => {
    const t0 = Date.now();
    let quiet = 0;
    while (quiet < 3) {
      if (Date.now() - t0 > 30000) throw new Error(`Esc no dejó ${what} libre en 30 s`);
      if (await isCalm()) { quiet++; await new Promise((r) => setTimeout(r, 300)); continue; }
      quiet = 0;
      await p.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  try {
    await p.goto(`${BASE}/?qa=1&scene=lobby`, { waitUntil: 'domcontentloaded' });
    await wait(() => !!window.__qa && window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'lobby');
    const cine = () => p.evaluate(() => window.__qa.state().cinematic);
    await wait(() => window.__qa.state().cinematic?.active === true, undefined, 20000)
      .catch(() => { throw new Error('la apertura del lobby (cinemática) no empezó en 20 s'); });
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await cine())?.active) throw new Error('la apertura del lobby se cerró sola antes de pulsar Esc (debe durar más de 1,5 s)');
    // Una sola pulsación salta la cinemática entera, tarjeta incluida (el mismo avance rápido que mantener pulsado)
    await p.keyboard.press('Escape');
    await wait(() => {
      const g = window.__game;
      const c = window.__qa.state().cinematic;
      return g.registry.get('gameState')?.flags?.chapter_2_intro_shown && c && !c.active && c.ended >= 1 && c.skipped
        && !(g.registry.get('cinematicActive') > 0);
    }, undefined, 20000)
      .catch(() => { throw new Error('una pulsación de Esc no saltó la apertura del lobby (cinemática y tarjeta del capítulo) en 20 s'); });
    console.log(`    Esc saltó la apertura del lobby: ${JSON.stringify(await cine())}`);
    await escUntilCalm('el lobby');

    await p.keyboard.down('Tab');
    await new Promise((r) => setTimeout(r, 200));
    const lit = await p.evaluate(() => window.__qa.state().highlightedHotspots);
    await p.keyboard.up('Tab');
    const unlit = await p.evaluate(() => window.__qa.state().highlightedHotspots);
    console.log(`    Tab: ${lit.length} resaltados (${lit.join(', ')})`);
    if (!lit.includes('hs_frontdoor') || !lit.includes('npc_receptionist')) throw new Error(`Tab no resaltó la puerta y la recepcionista: ${lit.join(', ')}`);
    if (unlit.length) throw new Error(`al soltar Tab siguen resaltados: ${unlit.join(', ')}`);
    const focusOk = await p.evaluate(() => document.activeElement === document.body || document.activeElement === window.__game.canvas);
    if (!focusOk) throw new Error('Tab movió el foco fuera del juego');

    // Menú contextual del navegador cancelado sobre el lienzo
    const door = await hotspotXY('hs_frontdoor');
    const prevented = await p.evaluate(({ x, y }) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
      window.__game.canvas.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, door);
    if (!prevented) throw new Error('el menú contextual del navegador no está cancelado sobre el lienzo');

    const p0 = await p.evaluate(() => window.__qa.state().player);
    await p.mouse.click(door.x, door.y);
    await p.mouse.click(door.x, door.y);
    const t0 = Date.now();
    let moved = 0;
    while (!(await reg('sceneTransition'))) {
      const pl = await p.evaluate(() => window.__qa.state().player);
      moved = Math.max(moved, Math.hypot(pl.x - p0.x, pl.y - p0.y));
      if (Date.now() - t0 > 4000) throw new Error(`el doble clic en la puerta no cambió de escena en 4 s (el personaje se movió ${moved.toFixed(1)} %)`);
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(`    doble clic en hs_frontdoor: cambio de escena a los ${Date.now() - t0} ms, personaje movido ${moved.toFixed(2)} %`);
    if (moved > 1) throw new Error(`con el doble clic el personaje anduvo ${moved.toFixed(1)} % antes de salir`);
    await wait(() => window.__game.scene.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'outside' && !window.__game.registry.get('sceneTransition'), undefined, 30000);

    // outside abre con la premisa y el capítulo 1 (A3.2: cinemática): también con Esc
    await new Promise((r) => setTimeout(r, 800));
    await escUntilCalm('outside');
    const lamp = await hotspotXY('hs_porch_light');
    await p.mouse.click(lamp.x, lamp.y, { button: 'right' });
    await wait(() => window.__qa.state().walkTarget?.target === 'hs_porch_light', undefined, 5000)
      .catch(() => { throw new Error('el clic derecho en la lámpara no hizo nada'); });
    const wt = await p.evaluate(() => window.__qa.state().walkTarget);
    if (wt.verb !== 'PICK') throw new Error(`clic derecho en la lámpara: verbo ${wt.verb}, se esperaba PICK`);
    await p.evaluate(() => window.__qa.dismissAll());
    const inv = await p.evaluate(() => window.__qa.state().inventory);
    // A3.3c: el clic derecho sigue siendo PICK (la lámpara da la mitad A), pero con la luz encendida quema: no se coge nada
    if (inv.includes('note_half_a')) throw new Error(`con la lámpara encendida, el clic derecho no debería dar la mitad A: ${inv.join(', ')}`);
    await p.screenshot({ path: `${SHOTS}/zz-escritorio.png` });
  } finally {
    await ctx.close();
  }
});

// A2.9: el diario (móvil de Dex) con el dedo real de Chrome en móvil vertical 390x844: tocar el botón del móvil lo abre (panel
// HTML encima del lienzo, `journalOpen`), tocar fuera del móvil lo cierra (y el toque que lo abrió no lo cierra al
// momento); con teclado, J lo abre y Esc lo cierra. Al cambiar de escena no queda ningún panel colgado en el DOM.
await step('diario: abrir y cerrar el móvil con toques reales en 390x844 (y J/Esc)', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  p.on('pageerror', (err) => fail(`[diario] error de página: ${err.message}`));
  const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 100 }, arg);
  const journal = () => p.evaluate(() => window.__qa.state().journal);
  try {
    await p.goto(`${BASE}/?qa=1&scene=upstairs`, { waitUntil: 'domcontentloaded' });
    await wait(() => !!window.__qa && window.__game?.scene?.isActive('UIScene') && window.__game.registry.get('currentSceneId') === 'upstairs');
    await wait(() => window.__qa.state().ready, undefined, 30000);
    const btn = await p.evaluate(() => {
      const c = window.__game.scene.getScene('UIScene').getJournal().buttonCenter();
      const r = window.__game.canvas.getBoundingClientRect();
      return { x: r.left + c.x, y: r.top + c.y };
    });
    await p.touchscreen.tap(btn.x, btn.y);
    await wait(() => !!document.getElementById('journal-overlay'), undefined, 5000)
      .catch(() => { throw new Error(`tocar el botón del móvil (${btn.x},${btn.y}) no abrió el diario`); });
    await new Promise((r) => setTimeout(r, 600));
    let j = await journal();
    if (!j?.open) throw new Error(`el diario se cerró solo tras abrirlo con el dedo: ${JSON.stringify(j)}`);
    const box = await p.evaluate(() => {
      const r = document.getElementById('journal-phone').getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    console.log(`    móvil en pantalla: ${JSON.stringify(box)}`);
    if (box.left < 0 || box.top < 0 || box.right > box.w || box.bottom > box.h) throw new Error(`el móvil se sale de la pantalla: ${JSON.stringify(box)}`);
    if (await p.evaluate(() => window.__game.scene.getScene('GameScene').qaIsInputBlocked()) !== true) throw new Error('con el diario abierto la escena sigue aceptando toques');
    // Pestañas con el dedo
    for (const tab of ['notes', 'anon', 'goals']) {
      const t = await p.evaluate((id) => {
        const r = document.querySelector(`#journal-phone .jr-tab[data-tab="${id}"]`).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, tab);
      await p.touchscreen.tap(t.x, t.y);
      await new Promise((r) => setTimeout(r, 200));
      j = await journal();
      if (j.tab !== tab) throw new Error(`tocar la pestaña ${tab} dejó ${j.tab}`);
    }
    await p.screenshot({ path: `${SHOTS}/zz-diario-390x844.png` });
    // Fuera del móvil (arriba, en el margen del fondo oscuro)
    await p.touchscreen.tap(Math.round(box.w / 2), Math.max(4, Math.floor(box.top / 2)));
    await wait(() => !document.getElementById('journal-overlay'), undefined, 5000)
      .catch(() => { throw new Error('tocar fuera del móvil no cerró el diario'); });
    j = await journal();
    if (j.open || (await p.evaluate(() => window.__game.registry.get('journalOpen')))) throw new Error(`el diario sigue abierto para el juego: ${JSON.stringify(j)}`);
    // Teclado: J abre, Esc cierra
    await p.keyboard.press('j');
    await wait(() => !!document.getElementById('journal-overlay'), undefined, 3000).catch(() => { throw new Error('J no abrió el diario'); });
    await p.keyboard.press('Escape');
    await wait(() => !document.getElementById('journal-overlay'), undefined, 3000).catch(() => { throw new Error('Esc no cerró el diario'); });
    // Abierto y cambio de escena: el SHUTDOWN de UIScene lo quita del DOM
    await p.keyboard.press('j');
    await wait(() => !!document.getElementById('journal-overlay'), undefined, 3000);
    await p.evaluate(() => {
      const g = window.__game;
      g.registry.set('currentSceneId', 'lobby');
      g.scene.stop('UIScene');
      g.scene.stop('GameScene');
      g.scene.start('PreloadScene');
    });
    await wait(() => window.__game.scene.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'lobby', undefined, 30000);
    const left = await p.evaluate(() => ({ dom: !!document.getElementById('journal-overlay'), open: window.__game.registry.get('journalOpen') }));
    if (left.dom || left.open) throw new Error(`tras cambiar de escena con el diario abierto queda ${JSON.stringify(left)}`);
  } finally {
    await ctx.close();
  }
});

// A1.14: «se queda enganchado y cuesta que camine». Con el dedo REAL de Chrome (no la API que llama a walk) en móvil
// apaisado 844x390: en outside, de junto al pilar del porche, tocar el carport (suelo cubierto por hs_carport) hace
// ANDAR a Dex hasta allí sin frase (antes: LOOK sin andar); un toque justo al salir una frase la cierra Y anda; tras
// una acción con verbo el panel vuelve a WALK; en el lobby, tocar el suelo (hs_floor_tiles) anda y tocar a Penny la
// acerca y abre su charla.
await step('andar A1.14: toques reales en outside y lobby (carport desde el pilar, frase saltada, verbo a WALK)', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  p.on('pageerror', (err) => fail(`[andar A1.14] error de página: ${err.message}`));
  const wait = (fn, arg, timeout = SCENE_TIMEOUT) => p.waitForFunction(fn, { timeout, polling: 100 }, arg);
  const st = () => p.evaluate(() => {
    const s = window.__qa.state();
    return { player: s.player, walkTarget: s.walkTarget, verb: s.verb, speech: s.speech?.text ?? null, ready: s.ready, scene: s.scene };
  });
  /** Punto de pantalla (CSS) de un punto del fondo en % */
  const screenOf = (x, y) => p.evaluate((pt) => {
    const gs = window.__game.scene.getScene('GameScene');
    const s = gs.coordSystem.pctToScreen(pt.x, pt.y);
    const cam = gs.cameras.main;
    const r = window.__game.canvas.getBoundingClientRect();
    const k = r.width / gs.scale.width;
    return { x: r.left + (s.x - cam.scrollX) * k, y: r.top + (s.y - cam.scrollY) * k };
  }, { x, y });
  const tap = async (x, y) => { const s = await screenOf(x, y); await p.touchscreen.tap(s.x, s.y); };
  const settle = () => wait(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return !gs.player.isMoving() && window.__qa.state().ready;
  }, undefined, 20000);
  const open = async (scene) => {
    await p.goto(`${BASE}/?qa=1&scene=${scene}`, { waitUntil: 'domcontentloaded' });
    await wait((id) => !!window.__qa && window.__game?.scene?.isActive('UIScene') && window.__game.registry.get('currentSceneId') === id, scene);
    await p.evaluate(() => window.__qa.dismissAll());
    await wait(() => window.__qa.state().ready, undefined, 30000);
  };
  try {
    await open('outside');
    // Junto al pilar del porche (borde derecho del porche), como en la captura del 12-nov
    await p.evaluate(() => window.__qa.walk(46.5, 90));
    await settle();
    let s = await st();
    console.log(`    junto al pilar: ${JSON.stringify(s.player)}`);
    // 1) WALK + toque en el carport (hotspot que cubre el suelo) → anda hasta allí, sin frase
    await tap(77, 72);
    await new Promise((r) => setTimeout(r, 300));
    s = await st();
    if (s.speech) throw new Error(`tocar el carport con Walk dijo una frase: «${s.speech}»`);
    if (s.walkTarget?.verb !== 'WALK' || !s.walkTarget?.walkTo) throw new Error(`tocar el carport no anda: walkTarget ${JSON.stringify(s.walkTarget)}`);
    await settle();
    s = await st();
    if (Math.abs(s.player.x - 77) > 3) throw new Error(`no llegó al carport: Dex en ${JSON.stringify(s.player)}`);
    await p.screenshot({ path: `${SHOTS}/zz-andar-carport-844x390.png` });
    // 2) Toque justo al salir una frase: la salta Y anda (antes el toque se gastaba en cerrarla)
    await p.evaluate(() => window.__game.scene.getScene('UIScene').events.emit('say', 'Test line from A1.14.'));
    await new Promise((r) => setTimeout(r, 200));
    await tap(20, 95);
    await new Promise((r) => setTimeout(r, 400));
    s = await st();
    if (s.speech) throw new Error(`el toque no cerró la frase: «${s.speech}»`);
    await settle();
    s = await st();
    if (Math.abs(s.player.x - 20) > 3) throw new Error(`el toque que saltó la frase no anduvo: Dex en ${JSON.stringify(s.player)}`);
    // 3) Verbo del panel → acción → vuelve a WALK
    await p.evaluate(() => window.__game.scene.getScene('UIScene').scummUI.selectVerb('LOOK'));
    await tap(60.5, 72);
    await wait(() => !!window.__qa.state().speech, undefined, 10000).catch(() => { throw new Error('LOOK en el buzón no dijo nada'); });
    s = await st();
    if (s.verb !== 'WALK') throw new Error(`tras LOOK en el buzón el verbo es ${s.verb}, no WALK`);
    // Y el toque siguiente en el suelo cierra la frase y anda (no «Look at»)
    await tap(50, 95);
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    s = await st();
    if (Math.abs(s.player.x - 50) > 3 || s.speech) throw new Error(`tras la frase el toque en el suelo no anduvo: ${JSON.stringify(s)}`);

    // 4) Lobby: suelo (hs_floor_tiles) y Penny
    await open('lobby');
    await tap(50, 90);
    await new Promise((r) => setTimeout(r, 300));
    s = await st();
    if (s.speech) throw new Error(`tocar el suelo del lobby dijo una frase: «${s.speech}»`);
    await settle();
    s = await st();
    if (Math.abs(s.player.x - 50) > 3 || Math.abs(s.player.y - 90) > 3) throw new Error(`tocar el suelo del lobby no anduvo: Dex en ${JSON.stringify(s.player)}`);
    const penny = await p.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      const n = gs.npcs.find((x) => x.npcId === 'npc_receptionist');
      const m = n.getWorldTransformMatrix();
      const cam = gs.cameras.main;
      const r = window.__game.canvas.getBoundingClientRect();
      const k = r.width / gs.scale.width;
      return { x: r.left + (m.tx - cam.scrollX) * k, y: r.top + (m.ty - n.height * n.scale * 0.5 - cam.scrollY) * k };
    });
    await p.touchscreen.tap(penny.x, penny.y);
    await wait(() => {
      const s = window.__qa.state();
      return s.walkTarget?.target === 'npc_receptionist' && (!!s.speech || !!s.choices || window.__game.registry.get('dialogueActive'));
    }, undefined, 15000).catch(async () => { throw new Error(`tocar a Penny no la abordó: ${JSON.stringify(await st())}`); });
    await p.screenshot({ path: `${SHOTS}/zz-andar-penny-844x390.png` });
  } finally {
    await ctx.close();
  }
});

await step('respuestas de fallo: un verbo sin script dice la frase 0 de su bolsa y luego otra (A2.5)', async () => {
  const failData = JSON.parse(readFileSync('assets/config/fail-responses.json', 'utf8'));
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('pageerror', (err) => fail(`[fallo] error de página: ${err.message}`));
  try {
    // recovery_pool no tiene onEnter (lobby abre con una narrativa) y hs_tv no tiene script de PUSH
    await p.goto(`${BASE}/?qa=1&scene=recovery_pool`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!window.__qa && window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'recovery_pool', { timeout: SCENE_TIMEOUT, polling: 250 });
    const t0 = Date.now();
    while (!(await p.evaluate(() => window.__qa.state().ready))) {
      if (Date.now() - t0 > 30000) throw new Error(`recovery_pool no queda libre en 30 s: ${JSON.stringify(await p.evaluate(() => window.__qa.state().busy))}`);
      await p.evaluate(() => window.__qa.dismissAll()).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    const first = await p.evaluate(() => window.__qa.act('PUSH', 'hs_tv').then((s) => s.lastFailResponse));
    const second = await p.evaluate(() => window.__qa.act('PUSH', 'hs_tv').then((s) => s.lastFailResponse));
    console.log(`    ${JSON.stringify(first)}`);
    if (!first || first.kind !== 'verb' || first.bag !== 'verb:PUSH') throw new Error(`PUSH sin script no dio la bolsa del verbo: ${JSON.stringify(first)}`);
    if (first.text !== failData.verbDefaults.PUSH[0]) throw new Error(`con ?qa=1 la primera frase tiene que ser la 0: «${first.text}»`);
    if (second?.text !== failData.verbDefaults.PUSH[1]) throw new Error(`la segunda vez tiene que ser la frase 1 (sin repetir): «${second?.text}»`);
  } finally {
    await ctx.close();
  }
});

// A1.12: el caso de Adrián (3-nov). En móvil (390×844): guardar en un slot vacío, SOBRESCRIBIR con confirmación,
// recargar la página, tocar el slot en LOAD (no carga sin confirmar), cargar → mismo estado, y la partida anterior
// queda en «Before load». Con wallet simulada y la nube en memoria (nunca la real): guardado verificado, fallo 500 →
// error visible (no «saved»), sin firma → aviso y botón para firmar. El autoguardado no pisa los manuales.
const a12Fail = (cond, msg) => { if (!cond) throw new Error(msg); };
async function a12Page(ctx, viewport) {
  const p = await ctx.newPage();
  await p.setViewport(viewport);
  p.on('pageerror', (err) => fail(`[${context}] error de página: ${err.message}`));
  await SP.installCloudMock(p);
  return p;
}
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

await step('guardado A1.12: sobrescribir → recargar → cargar, sin cargas de un clic, copia «Before load» (móvil, sin wallet)', async () => {
  const ctx = await browser.createBrowserContext();
  try {
    const p = await a12Page(ctx, MOBILE);
    await SP.openGame(p, BASE);
    await SP.mark(p, 'a12_first');
    await SP.openPanel(p);
    a12Fail(await SP.activeTab(p) === 'save', 'el panel no abre en la pestaña SAVE');
    const lay = await SP.panelLayout(p);
    console.log(`    panel 390×844: ${JSON.stringify({ ...lay, small: lay.small.length })}`);
    a12Fail(lay.left >= 0 && lay.right <= lay.vw && lay.top >= 0 && lay.bottom <= lay.vh, `el panel no cabe en 390×844: ${JSON.stringify(lay)}`);
    a12Fail(!lay.small.length, `botones de menos de 44 px: ${JSON.stringify(lay.small)}`);
    await SP.tapSlot(p, 1);
    let st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok' && /Slot 1 saved/.test(st.text), `guardar en slot vacío: ${JSON.stringify(st)}`);
    // Sobrescribir: primero pide confirmación y no guarda hasta decir que sí
    await SP.mark(p, 'a12_second', 'a12_item');
    const before = await SP.localSlot(p, 1);
    await SP.tapSlot(p, 1);
    a12Fail(/Overwrite Slot 1\?/.test(await SP.confirmText(p) ?? ''), 'sobrescribir no pidió confirmación');
    a12Fail((await SP.localSlot(p, 1)).timestamp === before.timestamp, 'el slot cambió antes de confirmar');
    await SP.confirm(p, true);
    st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok', `sobrescribir: ${JSON.stringify(st)}`);
    const saved = await SP.gameSnap(p);
    await p.screenshot({ path: `${SHOTS}/a12-1-guardado.png` });

    // Recargar la página: partida nueva (el autoguardado del slot 0 no toca el 1)
    await SP.openGame(p, BASE);
    const fresh = await SP.gameSnap(p);
    a12Fail(!fresh.flags.includes('a12_second'), 'la partida nueva ya traía la flag');
    a12Fail((await SP.localSlot(p, 1))?.state?.flags?.a12_second === true, 'tras recargar el slot 1 no tiene lo sobrescrito');
    await SP.openPanel(p);
    await SP.tab(p, 'load');
    a12Fail(await SP.activeTab(p) === 'load', 'la pestaña LOAD no quedó activa');
    // Clic «accidental» en un slot: solo confirma, no carga
    await SP.tapSlot(p, 1);
    await new Promise((r) => setTimeout(r, 800));
    a12Fail(/Load Slot 1\?/.test(await SP.confirmText(p) ?? ''), 'tocar un slot en LOAD no pidió confirmación');
    // (se mira la flag del guardado: la cinemática de entrada puede ir poniendo otras mientras tanto)
    a12Fail(!(await SP.gameSnap(p)).flags.includes('a12_second'), 'tocar el slot cargó sin confirmar');
    await SP.confirm(p, false);
    await new Promise((r) => setTimeout(r, 500));
    a12Fail(!(await SP.gameSnap(p)).flags.includes('a12_second'), 'cancelar cargó igualmente');
    await p.screenshot({ path: `${SHOTS}/a12-2-load-tab.png` });
    await SP.tapSlot(p, 1);
    await SP.confirm(p, true);
    await p.waitForFunction(() => window.__game.registry.get('gameState')?.flags?.a12_second === true, { timeout: 60000, polling: 300 });
    await new Promise((r) => setTimeout(r, 1500));
    await SP.waitInGame(p, saved.scene);
    const loaded = await SP.gameSnap(p);
    a12Fail(loaded.flags.includes('a12_second') && loaded.inv.includes('a12_item'), `lo cargado no es lo guardado: ${JSON.stringify(loaded)}`);
    // Guardado de seguridad recuperable desde el panel
    const backup = await SP.localSlot(p, 3);
    a12Fail(backup && !backup.state.flags.a12_second, 'no hay copia «Before load» de la partida anterior');
    await SP.openPanel(p);
    await SP.tab(p, 'load');
    a12Fail(/Before load:/.test(await SP.slotText(p, 3) ?? '') && !/Empty/.test(await SP.slotText(p, 3)), '«Before load» no aparece en LOAD');
    console.log(`    guardado ${JSON.stringify(saved)} · cargado ${JSON.stringify(loaded)} · copia ${backup.sceneName}`);
  } finally {
    await ctx.close();
  }
});

// A7.2 (J-7, buzón del jugador): en móvil apaisado, guardar en el slot 1, andar a otro sitio y cargar el slot 1
// tocando «Load» (el botón DOM queda encima del asa del panel de verbos). Dex tiene que aparecer donde se guardó (no donde
// estaba ni en el spawn) y el panel de verbos, desplegado (antes el «soltar» del toque plegaba el panel).
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
await step('guardado A7.2: cargar en la misma escena → Dex en la posición guardada y panel de verbos desplegado (844×390)', async () => {
  const ctx = await browser.createBrowserContext();
  try {
    const p = await a12Page(ctx, LANDSCAPE);
    await SP.openGame(p, BASE);
    await p.evaluate(() => window.__qa.dismissAll());
    const pos = () => p.evaluate(() => {
      const g = window.__game.scene.getScene('GameScene');
      const ui = window.__game.scene.getScene('UIScene');
      return { x: g.player.pctX, y: g.player.pctY, expanded: ui.getScummUI().isExpanded() };
    });
    // Un punto lejos del sitio donde se va a guardar, para que «aparece donde estaba antes de cargar» se note
    const start = await pos();
    const target = await p.evaluate((sx) => {
      for (const x of [75, 70, 65, 80, 25, 30, 20]) for (const y of [92, 90, 88, 94]) {
        if (Math.abs(x - sx) > 20 && window.__qa.isWalkable(x, y)) return { x, y };
      }
      return null;
    }, start.x);
    a12Fail(target, `no hay un punto andable lejos de ${JSON.stringify(start)}`);
    await SP.openPanel(p);
    await SP.tapSlot(p, 1);
    const st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok', `guardar: ${JSON.stringify(st)}`);
    const saved = (await SP.localSlot(p, 1)).state.playerPosition;
    a12Fail(saved && Math.abs(saved.pctX - start.x) < 1 && Math.abs(saved.pctY - start.y) < 1, `el slot no guarda la posición: ${JSON.stringify({ saved, start })}`);
    await SP.closePanel(p);
    await p.evaluate((t) => window.__qa.walk(t.x, t.y), target);
    const moved = await pos();
    a12Fail(Math.abs(moved.x - start.x) > 10, `Dex no anduvo: ${JSON.stringify({ start, moved })}`);
    await SP.openPanel(p);
    await SP.tab(p, 'load');
    await SP.tapSlot(p, 1);
    await SP.confirm(p, true);
    await p.waitForFunction(() => !document.getElementById('save-load-overlay'), { timeout: 20000, polling: 200 });
    await new Promise((r) => setTimeout(r, 1500));
    await SP.waitInGame(p, 'outside');
    await new Promise((r) => setTimeout(r, 1500));
    const after = await pos();
    await p.screenshot({ path: `${SHOTS}/a72-cargado.png` });
    console.log(`    guardado en ${JSON.stringify(start)} · anduvo a ${JSON.stringify(moved)} · cargado ${JSON.stringify(after)}`);
    a12Fail(Math.abs(after.x - start.x) < 2 && Math.abs(after.y - start.y) < 2, `Dex no está donde se guardó: ${JSON.stringify({ start, after })}`);
    a12Fail(after.expanded, 'tras cargar, el panel de verbos está plegado');
  } finally {
    await ctx.close();
  }
});

await step('guardado A1.12 con wallet: nube verificada, 500 → error visible, sin firma → pedir firma (nube simulada)', async () => {
  const ctx = await browser.createBrowserContext();
  try {
    const p = await a12Page(ctx, MOBILE);
    await SP.openGame(p, BASE);
    await p.evaluate((a) => window.__qa.fakeWallet(a, true), SP.QA_ADDR);
    await SP.mark(p, 'a12_cloud');
    await SP.openPanel(p);
    await SP.tapSlot(p, 2);
    let st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok' && /device \+ cloud/.test(st.text), `guardado en la nube: ${JSON.stringify(st)}`);
    const db = await SP.cloudDb(p);
    a12Fail(db[`${SP.QA_ADDR}:2`]?.state?.flags?.a12_cloud === true, 'la nube simulada no tiene el slot 2');
    // Fallo 500 al sobrescribir: error visible, nunca «saved (device + cloud)»; la partida en memoria intacta
    await SP.mark(p, 'a12_after500');
    const mem = await SP.gameSnap(p);
    await SP.failNextCloudSave(p, 2, 500);
    await SP.tapSlot(p, 2);
    await SP.confirm(p, true);
    st = await SP.waitStatus(p);
    a12Fail(st.kind === 'error' && /500/.test(st.text) && !/device \+ cloud/.test(st.text), `500 no dio error visible: ${JSON.stringify(st)}`);
    const after = await SP.gameSnap(p);
    a12Fail(after.flags.includes('a12_after500') && after.flags.includes('a12_cloud') && after.scene === mem.scene, 'la partida en memoria cambió tras el fallo');
    a12Fail(!(await SP.cloudDb(p))[`${SP.QA_ADDR}:2`].state.flags.a12_after500, 'la nube cambió pese al 500');
    await p.screenshot({ path: `${SHOTS}/a12-3-error-500.png` });
    // Reintento: ahora sí
    await SP.panelAction(p, 'retry');
    st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok', `reintento: ${JSON.stringify(st)}`);
    // Sin firma de sesión: el guardado local vale, la nube pide firmar y al firmar se sube
    await p.evaluate((a) => window.__qa.fakeWallet(a, false), SP.QA_ADDR);
    await SP.closePanel(p);
    await SP.openPanel(p);
    await SP.tapSlot(p, 1);
    st = await SP.waitStatus(p);
    a12Fail(st.kind === 'warn' && /signature/i.test(st.text), `sin firma: ${JSON.stringify(st)}`);
    a12Fail(!(await SP.cloudDb(p))[`${SP.QA_ADDR}:1`], 'sin firma se subió a la nube');
    await SP.panelAction(p, 'sign');
    st = await SP.waitStatus(p);
    a12Fail(st.kind === 'ok' && /device \+ cloud/.test(st.text), `tras firmar: ${JSON.stringify(st)}`);
    // Apaisado 844×390: el panel cabe a lo ancho y los botones siguen siendo tocables (se desplaza en vertical)
    await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 500));
    const lay = await SP.panelLayout(p);
    a12Fail(lay.left >= 0 && lay.right <= lay.vw && lay.top >= 0 && lay.bottom <= lay.vh + 1, `el panel no cabe en 844×390: ${JSON.stringify(lay)}`);
    a12Fail(!lay.small.length, `apaisado: botones de menos de 44 px: ${JSON.stringify(lay.small)}`);
    console.log(`    nube: ${Object.keys(await SP.cloudDb(p)).join(', ')}`);
  } finally {
    await ctx.close();
  }
});

// A1.13: el caso de Adrián (11-nov). Con SUS partidas en localStorage (slot 2 @19:01:42 con 2 flags, slot 1 @19:02:04
// con 5 flags y 2 objetos, slot 0 = autoguardado VACÍO @19:02:45 y una partida de cartera más vieja), «Continue» del
// menú (toque real) carga el slot 1: inventario con los 2 objetos y las 5 flags. Al entrar en la escena los slots 1 y 2
// siguen intactos y el 0 ya no queda vacío. Sin partidas con progreso no hay «Continue».
await step('Continue A1.13: con el autoguardado vacío más nuevo, carga la partida con progreso (caso de Adrián, móvil)', async () => {
  const ctx = await browser.createBrowserContext();
  try {
    const p = await a12Page(ctx, MOBILE);
    const A = SP.ADRIAN_A113;
    // Solo el autoguardado vacío → no hay Continue
    await SP.openMenuWith(p, BASE, { adrian_adventure_save: { 0: A.slots[0] } });
    a12Fail(await SP.menuText(p, 'menu-btn-continue') === null, 'con solo un autoguardado vacío sale «Continue»');
    // Las partidas de Adrián
    await SP.openMenuWith(p, BASE, { adrian_adventure_save: A.slots, [A.walletKey]: A.wallet });
    a12Fail(await SP.menuText(p, 'menu-btn-continue') !== null, 'no sale «Continue» con partidas guardadas');
    const pick = await p.evaluate(() => window.__continuePick);
    const detail = await SP.menuText(p, 'continue-detail');
    console.log(`    elegida ${JSON.stringify(pick)} · detalle «${detail}»`);
    a12Fail(pick?.source === 'slot' && pick.slotId === 1, `Continue no elige el slot 1: ${JSON.stringify(pick)}`);
    a12Fail(/^Outside · /.test(detail ?? ''), `detalle bajo Continue: «${detail}»`);
    await p.screenshot({ path: `${SHOTS}/a13-1-menu.png` });
    await SP.tapMenuButton(p, 'Continue');
    await SP.waitInGame(p, 'outside');
    await p.waitForFunction(() => window.__qa.state().inventory.length > 0, { timeout: 30000, polling: 300 }).catch(() => {});
    const qs = await p.evaluate(() => window.__qa.state());
    const on = Object.keys(qs.flags).filter((k) => qs.flags[k]);
    console.log(`    tras Continue: inventario ${JSON.stringify(qs.inventory)} · flags ${JSON.stringify(on)}`);
    for (const it of A.slot1Items) a12Fail(qs.inventory.includes(it), `falta ${it} en el inventario: ${JSON.stringify(qs.inventory)}`);
    for (const f of A.slot1Flags) a12Fail(qs.flags[f] === true, `falta la flag ${f}: ${JSON.stringify(on)}`);
    await new Promise((r) => setTimeout(r, 2500));
    const s1 = await SP.localSlot(p, 1);
    const s2 = await SP.localSlot(p, 2);
    const s0 = await SP.localSlot(p, 0);
    a12Fail(JSON.stringify(s1) === JSON.stringify(A.slots[1]), 'el slot 1 cambió al continuar');
    a12Fail(JSON.stringify(s2) === JSON.stringify(A.slots[2]), 'el slot 2 cambió al continuar');
    const s0flags = Object.values(s0?.state?.flags ?? {}).filter(Boolean).length;
    a12Fail(s0 && s0flags >= 5 && (s0.state.inventory ?? []).length >= 2, `el slot 0 quedó vacío tras continuar: ${JSON.stringify(s0?.state?.flags)}`);
    const w = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), A.walletKey);
    a12Fail(JSON.stringify(w) === JSON.stringify(A.wallet), 'la partida de cartera cambió al continuar sin wallet');
    await p.screenshot({ path: `${SHOTS}/a13-2-continued.png` });
  } finally {
    await ctx.close();
  }
});

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} fallo(s).`);
  process.exit(1);
}
console.log('\nSmoke OK');

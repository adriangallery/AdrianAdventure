// Tests de humo de AdrianAdventure (plan AdrianZERO V8). Corre en GitHub Actions contra `vite preview`
// del build real (con assets): arranque, cada escena, cambio de escena en caliente y guardar/cargar.
// A1.5 (plan SCUMM): con el sonido apagado no se piden música ni voces; al activarlo en ajustes, sí.
// A1.8: las escenas se abren con ?qa=1&scene=<id>; sin ?qa=1 el build de producción ignora ?scene.
// A2.4: controles de escritorio con teclado y ratón reales (Esc, Tab, doble clic en una salida, clic derecho).
// A2.7: cambio de escena con la precarga hecha y vuelta: sin pantalla de carga y sin volver a descargar; MB y tiempos.
// A2.9: el diario (móvil de Dex) se abre y se cierra con toques reales en 390x844, y con J/Esc.
// A2.5: un PUSH sin script dice la frase 0 de la bolsa verbDefaults.PUSH (ronda fija con ?qa=1) y luego la 1.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/smoke.mjs
import { readdirSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
    await prefetched('outside', 'assets/scenes/lobby/background.webp');
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

// A1.5: arranque con «No thanks, silence is golden» en un perfil limpio. Se registran todas las peticiones y
// falla si se pide algún mp3 de música o de voz (ni en la precarga, ni al cambiar de escena, ni al hablar).
// Después se activa el sonido desde los ajustes del juego (botón «Music» del menú del disquete, con clics reales)
// y la música de la escena actual (otra que la precargada) y la voz tienen que pedirse sin recargar la página.
const AUDIO_RE = /\/assets\/audio\/(music|voice)\/[^/?]+\.mp3/;
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
  } finally {
    await ctx.close();
  }
});

// A2.4: controles de escritorio con teclado y ratón reales de Chrome (no eventos sintéticos de la API de QA). En el lobby
// recién abierto (?qa=1&scene=lobby) el onEnter enseña una narrativa y un título de capítulo que esperan un clic:
// Esc tiene que saltarlos sin tocar nada más. Luego mantener Tab resalta los hotspots, el menú contextual del lienzo
// está cancelado, el doble clic en la puerta sale al momento (el personaje no anda) y en `outside` el clic derecho en
// la lámpara del porche la coge (su verbo por defecto es PICK).
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
    await wait(() => window.__game.registry.get('cinematicActive') > 0, undefined, 20000);
    await new Promise((r) => setTimeout(r, 1500));
    if (!((await reg('cinematicActive')) > 0)) throw new Error('la narrativa del lobby se cerró sola antes de pulsar Esc');
    // Una sola pulsación salta la narrativa y el título (el mismo avance rápido que mantener pulsado)
    await p.keyboard.press('Escape');
    await wait(() => window.__game.registry.get('gameState')?.flags?.chapter_2_intro_shown && !(window.__game.registry.get('cinematicActive') > 0), undefined, 20000)
      .catch(() => { throw new Error('una pulsación de Esc no saltó la narrativa y el título del capítulo del lobby en 20 s'); });
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

    // outside abre con la premisa y el capítulo 1: también con Esc
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
    if (!inv.includes('code_note')) throw new Error(`tras el clic derecho en la lámpara no está la nota en el inventario: ${inv.join(', ')}`);
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

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} fallo(s).`);
  process.exit(1);
}
console.log('\nSmoke OK');

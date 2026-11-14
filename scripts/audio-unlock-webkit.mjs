// A4.9 (plan SCUMM): prueba de regresión del sonido en iPhone. Playwright WebKit con emulación de iPhone y TOQUES REALES
// (`page.touchscreen.tap`): New Game → «Enable Sound». Falla si, tras el toque:
//   - el AudioContext no está `running`,
//   - hay más de un AudioContext de salida (todo el audio tiene que ir por el contexto desbloqueado en el gesto),
//   - la música no llega a la salida (limitador maestro) con señal, o la cadena de Phaser (voces, efectos, stingers) tiene
//     alguna ganancia a 0 o no lleva señal a la salida,
//   - el juego lanzó `<audio>.play()` fuera de un gesto (en iOS se rechaza).
// WebKit de Linux NO reproduce toda la política de autoplay de iOS (ver docs/progreso/A4.9.md): esto vigila la cadena.
//
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/audio-unlock-webkit.mjs [--viewport 390x844]
import { engineFromArgs } from './lib/browser.mjs';

const { viewport } = engineFromArgs([...process.argv.slice(2), '--browser', 'webkit']);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const failures = [];
const fail = (m) => { failures.push(m); console.log(`  ✖ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

let pw;
try { pw = await import('playwright'); } catch {
  console.error('falta playwright: npm i --no-save playwright && npx playwright install --with-deps webkit');
  process.exit(2);
}
const browser = await pw.webkit.launch({ headless: true });
const iphone = pw.devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, viewport, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  (pageerror) ${e.message}`));

// Instrumentación: cuántos AudioContext se crean y cuándo (antes o después del primer gesto), y cada <audio>.play()
await page.addInitScript(() => {
  const log = { contexts: [], plays: [], gesture: false };
  window.__audioLog = log;
  for (const ev of ['touchend', 'click']) {
    window.addEventListener(ev, () => {
      log.gesture = true;
      log.inGesture = true;
      setTimeout(() => { log.inGesture = false; }, 0);
    }, { capture: true });
  }
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (!Orig || Orig.__wrapped) continue;
    const Wrapped = function (...args) {
      const c = new Orig(...args);
      log.contexts.push({ t: Math.round(performance.now()), afterGesture: log.gesture });
      (window.__audioContexts ||= []).push(c);
      return c;
    };
    Wrapped.prototype = Orig.prototype;
    Wrapped.__wrapped = true;
    Object.setPrototypeOf(Wrapped, Orig);
    window[name] = Wrapped;
  }
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    log.plays.push({ t: Math.round(performance.now()), gesture: navigator.userActivation ? navigator.userActivation.isActive : !!log.inGesture, src: String(this.currentSrc || this.src).slice(0, 30) });
    return origPlay.apply(this, a);
  };
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__game.scene.getScene('MenuScene').children?.getByName?.('menu-btn-new-game'), null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(500);

  // New Game en el lienzo: posición del texto en pantalla → toque real
  const ng = await page.evaluate(() => {
    const g = window.__game;
    const t = g.scene.getScene('MenuScene').children.getByName('menu-btn-new-game');
    const r = g.canvas.getBoundingClientRect();
    const sx = r.width / g.scale.width;
    const sy = r.height / g.scale.height;
    const b = t.getBounds();
    return { x: r.left + b.centerX * sx, y: r.top + b.centerY * sy };
  });
  await page.touchscreen.tap(ng.x, ng.y);

  const yes = page.locator('button', { hasText: 'Enable Sound' });
  await yes.waitFor({ state: 'visible', timeout: 15000 });
  const box = await yes.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

  const after = await page.evaluate(async () => {
    const g = window.__game;
    const c = g.sound.context;
    const s0 = c.state;
    await new Promise((r) => setTimeout(r, 300));
    return { stateNow: s0, state300: c.state, contexts: window.__audioLog.contexts, locked: g.sound.locked };
  });
  const outputContexts = after.contexts.length;
  if (after.state300 === 'running') ok(`AudioContext running tras el toque (en el mismo tic: ${after.stateNow})`);
  else fail(`AudioContext «${after.state300}» tras el toque en «Enable Sound»`);
  if (outputContexts === 1) ok('un solo AudioContext de salida');
  else fail(`${outputContexts} AudioContext creados (se esperaba 1): ${JSON.stringify(after.contexts)}`);

  // La partida arranca y suena la música de la escena
  await page.waitForFunction(() => {
    const mm = window.__game?.registry?.get('musicManager');
    const q = mm?.qaState?.();
    return q && !q.muted && q.music.key && q.music.gain > 0;
  }, null, { timeout: 120000, polling: 500 });
  const chain = await page.evaluate(async () => {
    const g = window.__game;
    const sm = g.sound;
    const c = sm.context;
    const mm = g.registry.get('musicManager');
    const out = mm.outputNode();
    const rms = async (node, ms) => {
      const an = c.createAnalyser();
      an.fftSize = 2048;
      node.connect(an);
      const buf = new Float32Array(an.fftSize);
      let best = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        best = Math.max(best, Math.sqrt(s / buf.length));
        await new Promise((r) => setTimeout(r, 50));
      }
      try { node.disconnect(an); } catch { /* */ }
      return best;
    };
    const q = mm.qaState();
    const musicRms = await rms(out, 2000);
    // Cadena de Phaser (voces, efectos, stingers): un sonido cualquiera de la caché por el gestor global
    const phaserGains = {
      mute: sm.masterMuteNode?.gain?.value ?? null,
      volume: sm.masterVolumeNode?.gain?.value ?? null,
      soundMute: sm.mute,
    };
    let phaserRms = null;
    const key = q.music.key;
    if (key && g.cache.audio.exists(key) && sm.masterVolumeNode) {
      const snd = sm.add(key, { volume: 1 });
      snd.play();
      phaserRms = await rms(sm.masterVolumeNode, 1500);
      snd.stop();
      snd.destroy();
    }
    return { state: c.state, q: { music: q.music, duckGain: q.duckGain, muted: q.muted }, musicRms, phaserGains, phaserRms, plays: window.__audioLog.plays, contexts: window.__audioLog.contexts.length };
  });
  if (chain.state === 'running') ok('el contexto sigue running con la partida en marcha');
  else fail(`contexto «${chain.state}» con la partida en marcha`);
  if (chain.musicRms > 1e-4) ok(`la música llega a la salida (RMS ${chain.musicRms.toFixed(4)}, pista ${chain.q.music.key}, ganancia ${chain.q.music.gain}, ducking ${chain.q.duckGain})`);
  else fail(`la música no llega a la salida: RMS ${chain.musicRms} ${JSON.stringify(chain.q)}`);
  const pg = chain.phaserGains;
  if (pg.mute > 0 && pg.volume > 0 && !pg.soundMute) ok(`cadena de Phaser (voces/efectos) abierta: mute ${pg.mute}, volumen ${pg.volume}`);
  else fail(`cadena de Phaser con ganancia 0 o en silencio: ${JSON.stringify(pg)}`);
  if (chain.phaserRms !== null && chain.phaserRms > 1e-4) ok(`un sonido de Phaser (vía de voces y efectos) llega a la salida (RMS ${chain.phaserRms.toFixed(4)})`);
  else fail(`un sonido de Phaser no llega a la salida (RMS ${chain.phaserRms})`);
  if (chain.contexts !== 1) fail(`${chain.contexts} AudioContext al final de la prueba`);
  const outside = chain.plays.filter((p) => !p.gesture);
  if (outside.length) fail(`<audio>.play() fuera de gesto: ${JSON.stringify(outside)}`);
  else ok(`<audio>.play() solo dentro de gestos (${chain.plays.length} llamadas)`);
} catch (e) {
  fail(`la prueba no terminó: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\nA4.9 audio WebKit: ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log('\nA4.9 audio WebKit: OK');

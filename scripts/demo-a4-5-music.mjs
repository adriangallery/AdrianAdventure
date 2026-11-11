// Demo de A4.5 (regla visual del plan SCUMM): música: stingers, ducking bajo la voz y fundido cruzado entre salas.
// El GIF no suena: encima del juego va un HUD (DOM) con la pista que suena y su ganancia, la que se va en el fundido,
// la tonalidad estimada, las fuentes de ducking y la ganancia del ducking, el último stinger (clip, desafino) y un
// medidor de nivel de música + ambiente. Con el sonido activado (localStorage adrian_adventure_muted = false), ?qa=1,
// 1280x720:
//   1) outside (retro-adventure, Re mayor): USE y PICK de la lámpara del porche: objeto encontrado → stinger_item
//      transportado +200 cents (a Re), con la música bajando mientras suena (fuente `stinger`);
//   2) outside: PULL valla, tablón en la chimenea, combinar las mitades: objetivo «Find Adrian's door code» cumplido →
//      stinger_puzzle_major en Re;
//   3) outside: USE de la puerta (cerrada): Dex habla con voz → la música baja a DUCK_LEVEL (fuente `voice`) y vuelve;
//   4) lobby (misma pista, variación con filtro) → USE escaleras → upstairs → USE escotilla → rooftop (vista, Sol menor):
//      fundido cruzado de 4 s: las dos ganancias se cruzan en el HUD; al entrar en el lobby, capítulo 1 cerrado →
//      stinger_chapter_major;
//   5) 390x844 (captura fija): rooftop con el HUD.
// Comprueba por la API de QA (`state().audio`) cada stinger (clip, desafino según la tonalidad), el ducking bajo la voz
// (duck incluye `voice` mientras suena el clip y vuelve a 1 después), y que durante el fundido hubo fotogramas con las dos
// pistas sonando a la vez (fading con ganancia > 0 y la nueva subiendo).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-5-music
import { startDemo, sleep } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 6, width: 800, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adrian_adventure_muted', 'false'); } catch { /* sin storage */ } });
const problems = [];
const notes = [];
let filming = true;
const CLIP = { x: 0, y: 0, width: 1280, height: 560 };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

async function open(scene, width = 1280) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(width / 2), 40] }))) await demo.fail(`La escena ${scene} no quedó libre`);
  for (let i = 0; i < 10 && (await page.evaluate(() => window.__game.sound.locked)); i++) {
    await page.mouse.click(Math.round(width / 2), 30);
    await sleep(300);
  }
  if (await page.evaluate(() => window.__game.sound.locked)) problems.push(`${scene}: el audio de Phaser sigue bloqueado tras 10 clics`);
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
    if (!window.__demoMeter) {
      const mm = window.__game.registry.get('musicManager');
      const an = mm.context.createAnalyser();
      an.fftSize = 256;
      mm.duckGain.connect(an);
      window.__demoMeter = { an, buf: new Float32Array(256) };
    }
  });
}

async function capture(label, { shot = filming } = {}) {
  const r = await page.evaluate((label, NOTE) => {
    const st = window.__qa.state();
    const a = st.audio;
    const m = window.__demoMeter;
    m.an.getFloatTimeDomainData(m.buf);
    let s = 0;
    for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];
    const level = Math.sqrt(s / m.buf.length);
    let hud = document.getElementById('demo-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'demo-hud';
      hud.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;pointer-events:none;font:14px/18px monospace;color:#fff;background:rgba(10,10,20,.75);padding:6px 10px;white-space:pre;border-radius:4px';
      document.body.appendChild(hud);
    }
    const bar = (v, n = 24) => { const k = Math.max(0, Math.min(n, Math.round(v * n))); return '█'.repeat(k) + '░'.repeat(n - k); };
    const mk = a?.music.musicKey ? `${NOTE[a.music.musicKey.tonic]} ${a.music.musicKey.mode}` : '—';
    const stg = a?.stingers.at(-1);
    hud.textContent = `${label}\n`
      + `música   ${a?.music.key ?? '—'} ${bar(a?.music.gain ?? 0)} ${a?.music.gain ?? '—'} · tonalidad ${mk}${a?.music.fading ? `\nse va     ${a.music.fading.key} ${bar(a.music.fading.gain)} ${a.music.fading.gain}` : ''}\n`
      + `ducking  ${bar(a?.duckGain ?? 1)} ${a?.duckGain ?? '—'}  fuentes: ${a?.duck.join(', ') || 'ninguna'}\n`
      + `stinger  ${stg ? `${stg.kind} → ${stg.key} ${stg.detune >= 0 ? '+' : ''}${stg.detune} cents (sobre ${stg.music ?? 'sin música'})` : '—'}\n`
      + `nivel    ${bar(Math.min(1, level * 6))} música+ambiente · habla: ${st.speech ? `${st.speech.speaker ?? 'Dex'}: «${st.speech.text.slice(0, 40)}…»` : '—'}`;
    return { st, a, level };
  }, label, NOTE);
  if (shot) await demo.shot({ clip: CLIP });
  return r;
}

async function during(label, start, args = [], maxMs = 60000, onFrame = null) {
  await page.evaluate(start, ...args);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await capture(label);
    if (onFrame) await onFrame(r);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  return page.evaluate(() => window.__demoErr);
}

const lastStinger = (a) => a?.stingers.at(-1) ?? null;
const stingersSince = (before, after) => (after?.stingers ?? []).filter((s) => !(before?.stingers ?? []).some((b) => b.at === s.at));

async function waitMusic(key, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { a } = await capture(`esperando la música ${key}`, { shot: false });
    if (a?.music.key === key && (a.music.gain ?? 0) > 0.05) return a;
    await sleep(200);
  }
  return null;
}

// ── 1) y 2) outside: stingers de objeto y de puzle en Re mayor ────────────────────────────────────────────────
await open('outside');
{
  const a0 = await waitMusic('retro-adventure');
  if (!a0) problems.push('outside: retro-adventure no llegó a sonar');
  else notes.push(`outside: ${a0.music.key} en ${NOTE[a0.music.musicKey?.tonic]} ${a0.music.musicKey?.mode}`);
  await demo.film(800, { clip: CLIP });
  let before = (await capture('1) outside', { shot: false })).a;
  let err = await during('1) USE lámpara: la apaga', () => window.__demoRun(window.__qa.act('USE', 'hs_porch_light')));
  if (err) problems.push(`USE hs_porch_light: ${err}`);
  let minDuck = 1;
  err = await during('1) PICK lámpara: objeto encontrado → stinger_item transportado a Re (+200 cents)', () => window.__demoRun(window.__qa.act('PICK', 'hs_porch_light')), [], 60000, ({ a }) => { if (a?.duck.includes('stinger')) minDuck = Math.min(minDuck, a.duckGain); });
  if (err) problems.push(`PICK hs_porch_light: ${err}`);
  let after = (await capture('1) nota A cogida', { shot: false })).a;
  const items = stingersSince(before, after).filter((s) => s.kind === 'item');
  console.log(`objeto: stingers ${JSON.stringify(stingersSince(before, after))} · ducking mínimo con stinger ${minDuck}`);
  if (!items.length) problems.push('al coger la mitad A no sonó stinger_item');
  else if (items[0].detune !== 200 || items[0].key !== 'stinger_item') problems.push(`stinger de objeto ${items[0].key} ${items[0].detune} cents, se esperaba stinger_item +200 (Re mayor)`);
  if (minDuck > 0.9) notes.push('aviso: no se vio la música bajar durante el stinger (el clip dura < 1 s: puede caer entre fotogramas)');
  await demo.still('1-stinger-item', { clip: CLIP });

  // 2) tablón, nido, combinar
  for (const [label, fn] of [
    ['2) PULL valla: el tablón', () => window.__demoRun(window.__qa.act('PULL', 'hs_fence'))],
    ['2) tablón en la chimenea: cae el nido con la mitad B', () => window.__demoRun(window.__qa.use('fence_plank', 'hs_chimney'))],
  ]) {
    err = await during(label, fn);
    if (err) problems.push(`${label}: ${err}`);
  }
  before = (await capture('2) antes de combinar', { shot: false })).a;
  err = await during('2) combinar las mitades: objetivo cumplido → stinger_puzzle_major en Re', () => window.__demoRun(window.__qa.combine('note_half_a', 'note_half_b')));
  if (err) problems.push(`combine: ${err}`);
  await demo.film(1200, { clip: CLIP });
  after = (await capture('2) código entero', { shot: false })).a;
  const puzzles = stingersSince(before, after).filter((s) => s.kind === 'puzzle');
  console.log(`puzle: stingers ${JSON.stringify(stingersSince(before, after))}`);
  if (!puzzles.length) problems.push('al juntar la nota no sonó el stinger de puzle (objetivo g1_code)');
  else if (puzzles[0].key !== 'stinger_puzzle_major' || puzzles[0].detune !== 200) problems.push(`stinger de puzle ${puzzles[0].key} ${puzzles[0].detune}, se esperaba stinger_puzzle_major +200`);
  await demo.still('2-stinger-puzzle', { clip: CLIP });

  // 3) ducking bajo la voz
  const seen = { voiceFrames: 0, minGain: 1, afterGain: null };
  err = await during('3) LOOK puerta: Dex habla → la música baja bajo la voz', () => window.__demoRun(window.__qa.act('LOOK', 'hs_front_door')), [], 60000, ({ a }) => {
    if (a?.duck.includes('voice')) { seen.voiceFrames++; seen.minGain = Math.min(seen.minGain, a.duckGain); }
  });
  if (err) problems.push(`LOOK hs_front_door: ${err}`);
  await sleep(600);
  after = (await capture('3) la música vuelve', { shot: false })).a;
  seen.afterGain = after?.duckGain;
  console.log(`voz: ${seen.voiceFrames} fotogramas con ducking por voz · ganancia mínima ${seen.minGain} · después ${seen.afterGain} (fuentes ${after?.duck.join(',') || 'ninguna'})`);
  if (!seen.voiceFrames) problems.push('la música no bajó bajo la voz (ninguna fuente voice)');
  if (seen.minGain > 0.5) problems.push(`con la voz la ganancia del ducking solo bajó a ${seen.minGain}`);
  if (after && after.duck.length === 0 && after.duckGain < 0.9) problems.push(`tras la voz la música no volvió (${after.duckGain})`);
}

// ── 4) lobby → upstairs → rooftop: capítulo cerrado y fundido cruzado ────────────────────────────────────────
await open('lobby');
{
  const a0 = await waitMusic('retro-adventure');
  if (!a0) problems.push('lobby: retro-adventure no llegó a sonar');
  await demo.film(600, { clip: CLIP });
  let err = await during('4) USE escaleras → upstairs (misma pista)', () => window.__demoRun(window.__qa.act('USE', 'hs_stairs_up')));
  if (err) problems.push(`USE hs_stairs_up: ${err}`);
  await page.waitForFunction(() => window.__qa.state().scene === 'upstairs' && window.__qa.state().ready, { timeout: 30000, polling: 250 }).catch(() => problems.push('no llegó a upstairs'));
  const up = (await capture('4) upstairs', { shot: false })).a;
  if (up?.music.key !== 'retro-adventure') problems.push(`upstairs: música ${up?.music.key}, se esperaba retro-adventure (sin corte)`);
  const cross = { frames: 0, maxFadingGain: 0, minNewGain: 1 };
  err = await during('4) USE escotilla → rooftop: fundido cruzado retro-adventure → vista (Sol menor)', () => window.__demoRun(window.__qa.act('USE', 'hs_roof_hatch')));
  if (err) problems.push(`USE hs_roof_hatch: ${err}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const { a } = await capture('4) rooftop: las dos pistas se cruzan durante 4 s');
    if (a?.music.fading && a.music.fading.gain > 0.002 && a.music.key === 'vista') {
      cross.frames++;
      cross.maxFadingGain = Math.max(cross.maxFadingGain, a.music.fading.gain);
      cross.minNewGain = Math.min(cross.minNewGain, a.music.gain ?? 1);
    }
  }
  const roof = (await capture('4) rooftop', { shot: false })).a;
  console.log(`fundido: ${cross.frames} fotogramas con las dos pistas · la vieja hasta ${cross.maxFadingGain} · la nueva desde ${cross.minNewGain} · ahora ${JSON.stringify(roof?.music)}`);
  if (!cross.frames) problems.push('no se vio el fundido cruzado (ningún fotograma con fading y vista a la vez)');
  if (roof?.music.key !== 'vista') problems.push(`rooftop: música ${roof?.music.key}, se esperaba vista`);
  if (roof?.music.musicKey?.mode !== 'minor') problems.push(`vista debería ser menor (${JSON.stringify(roof?.music.musicKey)})`);
  await demo.still('4-crossfade', { clip: CLIP });
}

// ── 5) 390x844 ────────────────────────────────────────────────────────────────────────────────────────────────
filming = false;
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open('rooftop', 390);
{
  const a = await waitMusic('vista');
  if (!a) problems.push('rooftop 390x844: vista no llegó a sonar');
  await capture('5) rooftop 390x844: vista (Sol menor) + viento', { shot: false });
  await demo.still('390x844');
}
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

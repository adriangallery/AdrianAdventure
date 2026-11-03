// Demo de A4.4 (regla visual del plan SCUMM): efectos de sonido y ambientes sintetizados.
// El GIF no suena, así que encima del juego va un HUD de audio (DOM): ambiente que pide la escena y el que suena
// con su ganancia, música, los últimos efectos pedidos (clave y desafino), los pasos dados y la superficie bajo los
// pies, y dos medidores de nivel (música + ambiente por el grafo de MusicManager; efectos por el nodo maestro de
// Phaser) que se mueven cuando algo suena de verdad. Con el sonido activado (localStorage adrian_adventure_muted =
// false) y ?qa=1, en 1280x720:
//   1) outside: el bucle de grillos se descarga y suena (ganancia > 0, el medidor se mueve); Dex anda por el porche
//      (pasos de madera) y baja al camino (pasos de grava): dos superficies en la misma escena, alternando el pie;
//   2) outside: PULL de la valla: el crujido del tablón;
//   3) lobby: el ambiente cruza a office_hum (fundido) y la música sigue siendo la misma pista (sin corte); los pasos
//      son de baldosa; USE de la puerta → outside: crujido de puerta y vuelta a los grillos;
//   4) recovery_pool: TALK con Gerald: chirrido de goma; ambiente de agua;
//   5) 390x844 (captura fija): server_room con zumbido de servidores y pasos metálicos.
// Comprueba por la API de QA (`state().audio`) que cada ambiente se pide y llega a sonar, que los pasos cambian de
// superficie y alternan step_x_1/step_x_2, que cada efecto esperado se pide y que ningún efecto pedido falta en caché.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-4-sfx-ambience
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

async function open(scene, width = 1280) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail(`La escena ${scene} no quedó libre`);
  // El audio de Phaser se desbloquea con un gesto real: si la apertura ya se había cerrado sola y settle no tocó nada,
  // un clic en el cielo (Dex no puede andar hasta allí) lo desbloquea; MusicManager aplaza la música y el ambiente a UNLOCKED
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
    // Medidores: música + ambiente (duckGain de MusicManager → destino) y efectos (nodo maestro de Phaser)
    if (!window.__demoMeters) {
      const mm = window.__game.registry.get('musicManager');
      const ctx = mm.context;
      const mk = (node) => { const an = ctx.createAnalyser(); an.fftSize = 256; node.connect(an); return an; };
      const sm = window.__game.sound;
      window.__demoMeters = { music: mk(mm.duckGain), sfx: sm.masterVolumeNode ? mk(sm.masterVolumeNode) : null, buf: new Float32Array(256) };
    }
  });
}

/** Lee el HUD: estado de audio + niveles RMS de los dos medidores; pinta el HUD y, si se graba, un fotograma. */
async function capture(label, { shot = filming } = {}) {
  const r = await page.evaluate((label) => {
    const st = window.__qa.state();
    const a = st.audio;
    const m = window.__demoMeters;
    const rms = (an) => {
      if (!an) return 0;
      an.getFloatTimeDomainData(m.buf);
      let s = 0;
      for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];
      return Math.sqrt(s / m.buf.length);
    };
    const levels = { music: rms(m.music), sfx: rms(m.sfx) };
    let hud = document.getElementById('demo-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'demo-hud';
      hud.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;pointer-events:none;font:14px/18px monospace;color:#fff;background:rgba(10,10,20,.75);padding:6px 10px;white-space:pre;border-radius:4px';
      document.body.appendChild(hud);
    }
    const bar = (v) => { const n = Math.min(24, Math.round(v * 120)); return '█'.repeat(n) + '░'.repeat(24 - n); };
    const last = a ? a.sfx.last.slice(-5).map((e) => `${e.key}${e.detune ? ` (${e.detune > 0 ? '+' : ''}${e.detune}c)` : ''}${e.ok ? '' : ' ✗'}`).join('  ·  ') : '';
    const fs = a?.footsteps;
    hud.textContent = `${label}\nmúsica   ${a?.music.key ?? '—'}${a?.music.pending ? ` (bajando ${a.music.pending})` : ''}   ${bar(levels.music)} música+ambiente\n`
      + `ambiente ${a?.ambience.key ?? '—'}${a?.ambience.pending ? ` (bajando ${a.ambience.pending})` : ''} · pide ${a?.ambience.requested ?? '—'} · gain ${a?.ambience.gain ?? '—'}   ${bar(levels.sfx)} efectos\n`
      + `pasos ${fs?.count ?? 0} · superficie ${fs?.surface ?? '—'} · último ${fs?.last?.key ?? '—'}\n`
      + `efectos (${a?.sfx.total ?? 0}): ${last || '—'}`;
    return { st, a, levels };
  }, label);
  if (shot) await demo.shot({ clip: CLIP });
  return r;
}

async function waitAmbience(key, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { a } = await capture(`esperando el ambiente ${key}`, { shot: false });
    if (a?.ambience.key === key && (a.ambience.gain ?? 0) > 0.01) return a;
    await sleep(200);
  }
  return null;
}

/** Lanza una acción de __qa y graba hasta que termine; devuelve el error o null */
async function during(label, start, args = [], maxMs = 45000) {
  await page.evaluate(start, ...args);
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < maxMs) {
    const r = await capture(label);
    samples.push(r);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  const err = await page.evaluate(() => window.__demoErr);
  return { err, samples };
}

const counts = (a) => a?.sfx.counts ?? {};
const playedBetween = (before, after, key) => (counts(after)[key] ?? 0) - (counts(before)[key] ?? 0);

// ── 1) outside: grillos, pasos de madera y de grava ────────────────────────────────────────────────────────────
await open('outside');
{
  const amb = await waitAmbience('crickets');
  if (!amb) problems.push('outside: el ambiente crickets no llegó a sonar en 25 s');
  else notes.push(`outside: crickets suena con ganancia ${amb.ambience.gain} · bucle ${JSON.stringify(amb.ambience.loop)}`);
  // 2 s de grillos: el medidor de música+ambiente se mueve
  let maxLevel = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) { const { levels } = await capture('1) outside: grillos al atardecer (bucle sintetizado sin costura)'); maxLevel = Math.max(maxLevel, levels.music); }
  console.log(`outside: nivel máximo música+ambiente ${maxLevel.toFixed(3)}`);
  if (maxLevel < 0.002) notes.push('aviso: el medidor no detectó señal (contexto de audio sin salida en este navegador)');
  await demo.still('1-grillos', { clip: CLIP });

  // Al porche (madera) y luego al camino (grava)
  const before = (await capture('1) Dex sube al porche', { shot: false })).a;
  let r = await during('1) pasos de MADERA en el porche', () => window.__demoRun(window.__qa.walk(42, 86)));
  if (r.err) problems.push(`walk porche: ${r.err}`);
  const onPorch = (await capture('porche', { shot: false })).a;
  r = await during('1) pasos de GRAVA en el camino', () => window.__demoRun(window.__qa.walk(70, 96)));
  if (r.err) problems.push(`walk camino: ${r.err}`);
  const onPath = (await capture('camino', { shot: false })).a;
  const wood = playedBetween(before, onPorch, 'step_wood_1') + playedBetween(before, onPorch, 'step_wood_2');
  const gravel1 = playedBetween(onPorch, onPath, 'step_gravel_1');
  const gravel2 = playedBetween(onPorch, onPath, 'step_gravel_2');
  console.log(`pasos: madera ${wood} (porche) · grava ${gravel1}+${gravel2} (camino) · total ${onPath?.footsteps.count} · superficie ahora ${onPath?.footsteps.surface}`);
  if (wood < 1) problems.push(`no sonaron pasos de madera en el porche (${JSON.stringify(counts(onPorch))})`);
  if (gravel1 < 1 || gravel2 < 1) problems.push(`los pasos de grava no alternaron el pie (${gravel1}/${gravel2})`);
  if (onPath?.footsteps.surface !== 'gravel') problems.push(`la superficie al acabar es ${onPath?.footsteps.surface}, se esperaba gravel`);
  const detunes = new Set((onPath?.sfx.last ?? []).filter((e) => e.key.startsWith('step_')).map((e) => e.detune));
  if (detunes.size < 2) problems.push('todos los pasos tienen el mismo desafino');
  await demo.still('1-pasos', { clip: CLIP });

  // 2) PULL de la valla
  const b2 = onPath;
  r = await during('2) PULL valla: crujido del tablón (plank_pull)', () => window.__demoRun(window.__qa.act('PULL', 'hs_fence')));
  if (r.err) problems.push(`PULL hs_fence: ${r.err}`);
  const a2 = (await capture('valla', { shot: false })).a;
  if (playedBetween(b2, a2, 'plank_pull') < 1) problems.push('PULL hs_fence no pidió plank_pull');
  if (a2?.sfx.missing.length) problems.push(`efectos pedidos que faltan en caché: ${a2.sfx.missing.join(', ')}`);
}

// ── 3) lobby: fundido de ambiente, misma música, puerta ───────────────────────────────────────────────────────
await open('lobby');
{
  const amb = await waitAmbience('office_hum');
  if (!amb) problems.push('lobby: el ambiente office_hum no llegó a sonar');
  const a = (await capture('3) lobby: office_hum (fluorescente + reloj) · la música sigue', { shot: false })).a;
  if (a?.music.key !== 'retro-adventure') problems.push(`lobby: música ${a?.music.key}, se esperaba retro-adventure (la misma que fuera)`);
  await demo.film(1200, { clip: CLIP });
  const before = a;
  const r = await during('3) pasos de BALDOSA y la puerta cruje al salir', () => window.__demoRun(window.__qa.act('USE', 'hs_frontdoor')), [], 60000);
  if (r.err) problems.push(`USE hs_frontdoor: ${r.err}`);
  await page.waitForFunction(() => window.__qa.state().scene === 'outside' && window.__qa.state().ready, { timeout: 30000, polling: 250 }).catch(() => problems.push('no volvió a outside'));
  const after = (await capture('3) de vuelta en outside', { shot: false })).a;
  if (playedBetween(before, after, 'door_creak') < 1) problems.push('la puerta del lobby no pidió door_creak');
  if (playedBetween(before, after, 'step_tile_1') + playedBetween(before, after, 'step_tile_2') < 1) problems.push('no sonaron pasos de baldosa en el lobby');
  const back = await waitAmbience('crickets');
  if (!back) problems.push('al volver a outside no volvieron los grillos');
  if (after?.music.key !== 'retro-adventure') problems.push(`al volver, música ${after?.music.key}`);
  for (let i = 0; i < 5; i++) await capture('3) de vuelta en outside: los grillos vuelven, la música no se corta');
  await demo.still('3-vuelta', { clip: CLIP });
}

// ── 4) recovery_pool: Gerald ──────────────────────────────────────────────────────────────────────────────────
await open('recovery_pool');
{
  const amb = await waitAmbience('pool_water');
  if (!amb) problems.push('recovery_pool: el ambiente pool_water no llegó a sonar');
  const before = (await capture('4) piscina', { shot: false })).a;
  const r = await during('4) TALK con Gerald: chirrido de goma (duck_squeak)', () => window.__demoRun(window.__qa.act('TALK', 'hs_rubber_duck')));
  if (r.err) problems.push(`TALK hs_rubber_duck: ${r.err}`);
  const after = (await capture('4) Gerald', { shot: false })).a;
  if (playedBetween(before, after, 'duck_squeak') < 1) problems.push('Gerald no chirrió (duck_squeak)');
  await demo.still('4-gerald', { clip: CLIP });
}

// ── 5) 390x844: server_room ───────────────────────────────────────────────────────────────────────────────────
filming = false;
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open('server_room', 390);
{
  const amb = await waitAmbience('server_hum');
  if (!amb) problems.push('server_room: el ambiente server_hum no llegó a sonar');
  const before = (await capture('5)', { shot: false })).a;
  const r = await during('5) server_room 390x844: zumbido de servidores, pasos metálicos', () => window.__demoRun(window.__qa.walk(60, 96)));
  if (r.err) problems.push(`walk server_room: ${r.err}`);
  const after = (await capture('5) server_room 390x844: zumbido de servidores, pasos metálicos', { shot: false })).a;
  if (playedBetween(before, after, 'step_metal_1') + playedBetween(before, after, 'step_metal_2') < 1) problems.push('no sonaron pasos metálicos en server_room');
  if (after?.sfx.missing.length) problems.push(`efectos pedidos que faltan en caché: ${after.sfx.missing.join(', ')}`);
  await demo.still('390x844');
  console.log(`server_room: ${JSON.stringify(after?.ambience)} · pasos ${after?.footsteps.count}`);
}
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

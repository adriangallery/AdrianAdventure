// Demo de A2.15 (regla visual del plan SCUMM): rig 2D del sprite actual de Dex, pre-renderizado (art/dex2d/build.py).
// Con ?qa=1, 1280x720 (GIF: recorte de 800x540 centrado en Dex, con una línea de estado):
//   1) outside: de la acera (55, 93) al porche y a la puerta (34,5, 83,5) — andar de perfil con el rig (dex2d_walk_*),
//      y de vuelta; comprueba que la escala no cambia (A2.13), que es entera (A2.8) y que el fotograma mide 103 de alto;
//   2) lobby: anda de perfil, hacia el fondo (dex2d_walk_up_*) y hacia la cámara (dex2d_walk_down_*);
//   3) habla (LOOK a la planta): `anim.talking` con texturas dex2d_talk_*;
//   4) coge (PICK del abrigo de perfil o de espaldas): `anim.gesture`;
//   5) un fallo (verbo sin respuesta → FailResponses) → encogerse de hombros (`anim.shrug`, dex2d_shrug_*);
//   6) reposo: espera una manía del rig (scratch | glasses | sway | yawn) con la semilla de QA.
// Termina en «problemas: ninguno». Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-15-rig2d
import { startDemo, sleep } from './lib/demo.mjs';

const CLIP = { width: 800, height: 540 };
const demo = await startDemo(import.meta.url, { fps: 8, width: 640, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const seenTex = new Set();

async function open(scene) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail(`${scene}: la escena no quedó libre`);
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
    // muestreo en cada fotograma (las capturas van más despacio que la animación)
    const s = (window.__rig = { tex: [], scales: [], heights: [], shrug: false, talking: false, gesture: false, tics: [] });
    const tick = () => {
      const st = window.__qa.state();
      const a = st.anim;
      const gs = window.__game.scene.getScene('GameScene');
      if (a) {
        if (!s.tex.includes(a.texture)) s.tex.push(a.texture);
        if (!s.scales.includes(a.scale)) s.scales.push(a.scale);
        const h = gs?.player?.frame?.realHeight;
        if (h && !s.heights.includes(h)) s.heights.push(h);
        s.shrug ||= a.shrug;
        s.talking ||= a.talking;
        s.gesture ||= a.gesture;
        if (a.idleTick && !s.tics.includes(a.idleTick)) s.tics.push(a.idleTick);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function capture(label) {
  const r = await page.evaluate((label, cw, ch) => {
    const st = window.__qa.state();
    const gs = window.__game.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const px = (gs.player.x - cam.scrollX) * cam.zoom;
    const vw = window.innerWidth;
    const w = Math.min(cw, vw);
    const h = Math.min(ch, window.innerHeight);
    const x = Math.max(0, Math.min(vw - w, Math.round(px - w / 2)));
    let cap = document.getElementById('demo-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'demo-cap';
      cap.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:15px monospace;color:#fff;background:rgba(10,10,20,.72);padding:4px 8px;white-space:pre';
      document.body.appendChild(cap);
    }
    const a = st.anim;
    cap.style.left = `${x + 6}px`;
    cap.style.top = '6px';
    cap.textContent = `${label}\n${a ? `${a.texture} · ×${a.scale}${a.talking ? ' · TALK' : ''}${a.gesture ? ' · PICK' : ''}${a.shrug ? ' · SHRUG' : ''}${a.idleTick ? ` · ${a.idleTick}` : ''}` : ''}`;
    return { st, clip: { x, y: 0, width: w, height: h } };
  }, label, CLIP.width, CLIP.height);
  await demo.shot({ clip: r.clip });
  return r;
}

async function during(label, start, args = [], maxMs = 40000) {
  await page.evaluate(start, ...args);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await capture(label);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  if (!(await page.evaluate(() => window.__demoDone))) return `no terminó en ${maxMs} ms`;
  return page.evaluate(() => window.__demoErr);
}

async function rig(reset = false) {
  return page.evaluate((reset) => {
    const s = window.__rig;
    const out = JSON.parse(JSON.stringify(s));
    if (reset) Object.assign(s, { tex: [], scales: [], heights: [], shrug: false, talking: false, gesture: false, tics: [] });
    return out;
  }, reset);
}

async function walk(tag, x, y, want, min = 4) {
  await rig(true);
  const err = await during(tag, (x, y) => window.__demoRun(window.__qa.walk(x, y)), [x, y]);
  if (err) problems.push(`${tag}: walk falló: ${err}`);
  const s = await rig();
  s.tex.forEach((t) => seenTex.add(t));
  const hits = s.tex.filter((t) => want.test(t));
  console.log(`${tag}: ${hits.length} fotogramas ${want} · escalas ${s.scales.join('/')} · altos ${s.heights.join('/')}`);
  if (hits.length < min) problems.push(`${tag}: solo ${hits.length} fotogramas ${want} (${s.tex.join(', ')})`);
  if (s.heights.some((h) => h !== 103)) problems.push(`${tag}: fotogramas de alto ${s.heights.join('/')} (A2.11: 103)`);
  return s;
}

// ── 1) outside: acera → porche → puerta y vuelta ──────────────────────────────────────────────────────────────────
await open('outside');
{
  const st0 = (await capture('outside: rig 2D')).st;
  if (!st0.anim) await demo.fail('state().anim no existe');
  await page.evaluate(() => window.__demoRun(window.__qa.walk(55, 93)));
  await page.waitForFunction(() => window.__demoDone, { timeout: 40000 }).catch(() => {});
  const a = await walk('outside acera→puerta', 34.5, 83.5, /^dex2d_walk_(l|r)_\d$/);
  const b = await walk('outside puerta→acera', 55, 93, /^dex2d_walk_(l|r)_\d$/);
  const scales = new Set([...a.scales, ...b.scales]);
  if (scales.size !== 1) problems.push(`outside: la escala cambió al andar (${[...scales].join('/')}) — A2.13`);
  const st = (await capture('outside: en la acera')).st;
  if (st.pixel && !st.pixel.integer) problems.push(`outside: escala ${st.pixel.playerScale} no entera (A2.8)`);
  if (!st.anim?.rig) problems.push('outside: anim.rig es false (no cargó el rig)');
  await demo.still('outside', { clip: (await capture('outside')).clip });
}

// ── 2-6) lobby ────────────────────────────────────────────────────────────────────────────────────────────────────
await open('lobby');
await walk('lobby perfil', 55.5, 98, /^dex2d_walk_(l|r)_\d$/);
// los tramos verticales del lobby duran ~1 s: basta con ver el ciclo moverse (≥ 2 fotogramas)
await walk('lobby al fondo', 55.5, 85, /^dex2d_walk_up_\d$/, 2);
await walk('lobby a la cámara', 55.5, 98, /^dex2d_walk_down_\d$/, 2);
await demo.still('lobby-frente', { clip: (await capture('lobby: de frente')).clip });

// 3) hablar
{
  await rig(true);
  const err = await during('habla (LOOK planta)', () => window.__demoRun(window.__qa.act('LOOK', 'hs_plant', [], 2500)));
  if (err) problems.push(`LOOK planta: ${err}`);
  const s = await rig();
  const talk = s.tex.filter((t) => /^dex2d_talk_/.test(t));
  console.log(`habla: talking ${s.talking} · ${talk.join(', ')}`);
  if (!s.talking) problems.push('habla: anim.talking nunca fue true');
  if (talk.length < 2) problems.push(`habla: ${talk.length} fotogramas dex2d_talk_* (${s.tex.join(', ')})`);
  await demo.settle({ tap: [640, 40], calm: 2, every: 300 });
}

// 4) coger (el abrigo; con Penny distraída como en demo-a4-1)
{
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'penny_reading', value: true }]));
  await rig(true);
  const err = await during('coge (PICK abrigo)', () => window.__demoRun(window.__qa.act('PICK', 'hs_coat')));
  if (err) problems.push(`PICK hs_coat: ${err}`);
  const s = await rig();
  console.log(`coge: gesto ${s.gesture} · ${s.tex.filter((t) => /pick|back/.test(t)).join(', ')}`);
  if (!s.gesture) problems.push('coge: no se vio el gesto');
  await demo.settle({ tap: [640, 40], calm: 2, every: 300 });
}

// 5) fallo → encogerse de hombros. Busca un verbo sin respuesta propia (sale de FailResponses)
{
  await page.evaluate(() => window.__demoRun(window.__qa.walk(55.5, 98)));
  await page.waitForFunction(() => window.__demoDone, { timeout: 40000 }).catch(() => {});
  let shrugged = false;
  // hs_poster no tiene PUSH/PULL (bolsa del verbo); si no, la keycard sobre la planta (objeto sobre hotspot)
  for (const [verb, hs, items] of [['PUSH', 'hs_poster', []], ['PULL', 'hs_poster', []], ['USE', 'hs_plant', ['keycard']], ['GIVE', 'hs_plant', ['keycard']]]) {
    await demo.settle({ tap: [640, 40], calm: 2, every: 300 });
    const before = await page.evaluate(() => JSON.stringify(window.__qa.state().lastFailResponse));
    await rig(true);
    const err = await during(`fallo: ${verb} ${hs}`, (v, h, it) => window.__demoRun(it.length ? window.__qa.use(it[0], h) : window.__qa.act(v, h)), [verb, hs, items]);
    for (let i = 0; i < 4; i++) await capture(`fallo: ${verb} ${hs}`);
    const after = await page.evaluate(() => JSON.stringify(window.__qa.state().lastFailResponse));
    const s = await rig();
    s.tex.forEach((t) => seenTex.add(t));
    console.log(`fallo ${verb} ${hs}: ${err ?? 'ok'} · respuesta de fallo ${after !== before} · shrug ${s.shrug} · ${s.tex.filter((t) => /shrug/.test(t)).join(', ')}`);
    if (after !== before) {
      shrugged = s.shrug && s.tex.some((t) => /^dex2d_shrug_\d$/.test(t));
      if (!shrugged) problems.push(`fallo ${verb} ${hs}: hubo respuesta de fallo y no se encogió de hombros`);
      break;
    }
  }
  if (!shrugged && !problems.some((p) => p.startsWith('fallo'))) problems.push('fallo: ningún verbo de prueba dio respuesta de fallo');
  await demo.settle({ tap: [640, 40], calm: 2, every: 300 });
}

// 6) reposo: una manía del rig (de frente; semilla de QA)
{
  await page.evaluate(() => window.__qa.runScript([{ op: 'actorFace', actor: 'player', dir: 'front' }]));
  await rig(true);
  const t0 = Date.now();
  let got = null;
  while (Date.now() - t0 < 40000) {
    const { st, clip } = await capture('reposo: manías');
    const tic = st.anim?.idleTick;
    if (tic && ['scratch', 'glasses', 'sway', 'yawn'].includes(tic)) {
      if (!got) await demo.still(`mania-${tic}`, { clip });
      got = tic;
    }
    if (got && !tic) break;
    await sleep(120);
  }
  const s = await rig();
  console.log(`reposo: tics ${s.tics.join(', ')} · ${s.tex.filter((t) => /tic|idle/.test(t)).join(', ')}`);
  if (!got) problems.push(`reposo: ninguna manía del rig en 40 s (tics ${s.tics.join(', ') || 'ninguno'})`);
}

await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`texturas del rig vistas: ${[...seenTex].filter((t) => t.startsWith('dex2d_')).length}`);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

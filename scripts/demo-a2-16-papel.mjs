// Demo de A2.16 (regla visual del plan SCUMM): PRUEBA de estilo «Dex de papel» (?dex=papel&papel=suave|media|tope).
// Con ?qa=1, 1280x720; recorte de 440x420 centrado en Dex con una línea de estado. Por variante (actual = el Dex de
// A2.15 sin parámetro, suave, media, tope):
//   1) outside: de la acera a la puerta (andar de perfil: dexpapel_walk_* a saltos; actual: dex2d_walk_*), escala fija
//      (A2.13), entera (A2.8) y alto 103 (A2.11);
//   2) lobby: andar de perfil y hacia la cámara; hablar con Penny (TALK) y UNA frase larga del jugador (~7 s, sayBrief
//      emitido directamente a UIScene: runScript la saltaría con su toque sintético) para ver
//      si la mezcla mandíbula + brazos tiene gracia o cansa (sin voz en headless: la mandíbula va a cadencia libre);
//   3) coger el abrigo (PICK; con papel, 3 poses).
// Comprueba que sin ?dex=papel no se carga NINGÚN dexpapel_* y que con papel la mandíbula se ve al hablar.
// GIF: uno por variante, demo-out/a2-16-papel/a2-16-papel-<variante>.gif, y el del runner (todas seguidas, 1 de cada 3
// fotogramas: va a ×3, solo de resumen).
// Una sola variante: PAPEL=tope node scripts/lib/demo.mjs run a2-16-papel. Termina en «problemas: ninguno».
import { spawnSync } from 'node:child_process';
import { readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo, sleep } from './lib/demo.mjs';

const CLIP = { width: 340, height: 360 };
const ALL = ['actual', 'suave', 'media', 'tope'];
const VARIANTS = process.env.PAPEL ? process.env.PAPEL.split(',').filter((v) => ALL.includes(v)) : ALL;
const FPS = 8;
const demo = await startDemo(import.meta.url, { fps: FPS, width: CLIP.width, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const LONG = 'Mira, Penny, esto no es un abrigo cualquiera: es una oportunidad única, de las que pasan una vez y no vuelven, y yo, que soy un hombre generoso, te la traigo hoy, aquí, a este mostrador.';

const query = (v) => (v === 'actual' ? '' : `&dex=papel&papel=${v}`);

async function open(scene, v) {
  await demo.openScene(scene, query(v));
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail(`${v} ${scene}: la escena no quedó libre`);
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
    const s = (window.__pp = { tex: [], scales: [], heights: [], jaw: 0, jawMax: 0, jawSide: 0, poses: [], talking: false, gesture: false });
    const tick = () => {
      const a = window.__qa.state().anim;
      const gs = window.__game.scene.getScene('GameScene');
      if (a) {
        if (!s.tex.includes(a.texture)) s.tex.push(a.texture);
        if (!s.scales.includes(a.scale)) s.scales.push(a.scale);
        const h = gs?.player?.frame?.realHeight;
        if (h && !s.heights.includes(h)) s.heights.push(h);
        s.talking ||= a.talking;
        s.gesture ||= a.gesture;
        if (a.paper?.jawVisible) {
          s.jaw++;
          s.jawMax = Math.max(s.jawMax, a.paper.jaw.dy);
          if (a.paper.jaw.dx) s.jawSide++;
        }
        if (a.paper?.armPose !== null && a.paper?.armPose !== undefined && s.poses[s.poses.length - 1] !== a.paper.armPose) s.poses.push(a.paper.armPose);
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
    const py = (gs.player.y - cam.scrollY) * cam.zoom;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(cw, vw);
    const h = Math.min(ch, vh);
    const x = Math.max(0, Math.min(vw - w, Math.round(px - w / 2)));
    const y = Math.max(0, Math.min(vh - h, Math.round(py - h * 0.75)));
    let cap = document.getElementById('demo-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'demo-cap';
      cap.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:13px monospace;color:#fff;background:rgba(10,10,20,.72);padding:3px 6px;white-space:pre';
      document.body.appendChild(cap);
    }
    const a = st.anim;
    const p = a?.paper;
    cap.style.left = `${x + 4}px`;
    cap.style.top = `${y + 4}px`;
    cap.textContent = `${label}\n${a ? `${a.texture.replace(/^dex(papel|2d)_/, '')}${p ? ` · mandíbula ${p.jawVisible ? `${p.jaw.dy}/${p.jaw.dx}` : '-'}` : ''}` : ''}`;
    return { st, clip: { x, y, width: w, height: h } };
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
    await sleep(40);
  }
  if (!(await page.evaluate(() => window.__demoDone))) return `no terminó en ${maxMs} ms`;
  return page.evaluate(() => window.__demoErr);
}

async function stats(reset = false) {
  return page.evaluate((reset) => {
    const out = JSON.parse(JSON.stringify(window.__pp));
    if (reset) Object.assign(window.__pp, { tex: [], scales: [], heights: [], jaw: 0, jawMax: 0, jawSide: 0, poses: [], talking: false, gesture: false });
    return out;
  }, reset);
}

const ranges = [];
for (const v of VARIANTS) {
  const first = demo.frames;
  const paper = v !== 'actual';
  const walkRe = paper ? new RegExp(`^dexpapel_walk_(l|r)_${v}_\\d$`) : /^dex2d_walk_(l|r)_\d$/;

  // ── 1) outside ──
  await open('outside', v);
  await page.evaluate(() => window.__demoRun(window.__qa.walk(55, 93)));
  await page.waitForFunction(() => window.__demoDone, { timeout: 40000 }).catch(() => {});
  await stats(true);
  let err = await during(`${v} · outside`, () => window.__demoRun(window.__qa.walk(34.5, 83.5)));
  if (err) problems.push(`${v} outside: ${err}`);
  let s = await stats(true);
  const hits = s.tex.filter((t) => walkRe.test(t));
  console.log(`${v} outside: ${hits.length} poses ${walkRe} · escalas ${s.scales.join('/')} · altos ${s.heights.join('/')}`);
  if (hits.length < (paper ? 4 : 6)) problems.push(`${v} outside: solo ${hits.length} poses ${walkRe}`);
  if (s.scales.length !== 1) problems.push(`${v} outside: la escala cambió al andar (${s.scales.join('/')}) — A2.13`);
  if (s.heights.some((h) => h !== 103)) problems.push(`${v} outside: alto ${s.heights.join('/')} (A2.11: 103)`);
  const loaded = await page.evaluate(() => window.__game.textures.getTextureKeys().filter((k) => k.startsWith('dexpapel_')).length);
  if (!paper && loaded) problems.push(`actual: se cargaron ${loaded} texturas dexpapel_* sin ?dex=papel`);
  if (paper && !loaded) problems.push(`${v}: no se cargó ninguna textura dexpapel_*`);
  await demo.still(`${v}-outside`, { clip: (await capture(`${v} · outside`)).clip });

  // ── 2) lobby: andar, hablar con Penny, frase larga ──
  await open('lobby', v);
  await during(`${v} · lobby`, () => window.__demoRun(window.__qa.walk(40, 92)));
  await during(`${v} · lobby`, () => window.__demoRun(window.__qa.walk(55.5, 98)));
  await stats(true);
  err = await during(`${v} · habla con Penny`, () => window.__demoRun(window.__qa.act('TALK', 'npc_receptionist', ['Whose coat', 'come back later'])), [], 60000);
  if (err) problems.push(`${v} TALK Penny: ${err}`);
  await demo.settle({ tap: [640, 40], calm: 2, every: 300 });
  await page.evaluate(() => window.__qa.runScript([{ op: 'actorFace', actor: 'player', dir: 'front' }]))
    .catch((e) => problems.push(`${v} actorFace tras hablar con Penny: ${String(e?.message || e).split('\n')[0]}`));
  err = await during(`${v} · frase larga (~7 s)`, (t) => window.__demoRun(new Promise((res) => window.__game.scene.getScene('UIScene').events.emit('sayBrief', t, 7000, undefined, res))), [LONG], 20000);
  if (err) problems.push(`${v} frase larga: ${err}`);
  s = await stats(true);
  console.log(`${v} habla: talking ${s.talking} · mandíbula visible en ${s.jaw} frames (máx ${s.jawMax} px, de lado ${s.jawSide}) · poses ${s.poses.join('')}`);
  if (!s.talking) problems.push(`${v} habla: anim.talking nunca fue true`);
  if (paper && s.jaw === 0) problems.push(`${v} habla: la mandíbula no se vio`);
  if (paper && new Set(s.poses).size < 2) problems.push(`${v} habla: los brazos no cambiaron de pose (${s.poses.join('')})`);
  if (!paper && s.jaw) problems.push('actual: apareció la mandíbula de papel');
  await demo.settle({ tap: [640, 40], calm: 2, every: 300 });

  // ── 3) coger el abrigo ──
  await page.evaluate(() => window.__qa.runScript([{ op: 'setFlag', flag: 'penny_reading', value: true }]));
  err = await during(`${v} · coge el abrigo`, () => window.__demoRun(window.__qa.act('PICK', 'hs_coat')));
  if (err) problems.push(`${v} PICK hs_coat: ${err}`);
  for (let i = 0; i < 3; i++) await capture(`${v} · coge el abrigo`);
  s = await stats(true);
  if (!s.gesture) problems.push(`${v} coge: no se vio el gesto`);
  ranges.push({ v, first, count: demo.frames - first });
  await sleep(50);
}

await demo.end();
// Un GIF por variante (los mismos fotogramas que el del runner)
for (const r of ranges) {
  if (!r.count) continue;
  const gif = join(demo.dir, `${demo.name}-${r.v}.gif`);
  const out = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-framerate', String(FPS), '-start_number', String(r.first), '-i', join(demo.dir, 'frames', '%03d.png'),
    '-frames:v', String(r.count), '-vf', `fps=${FPS},split[a][b];[a]palettegen[p];[b][p]paletteuse`, gif,
  ], { stdio: 'inherit' });
  console.log(`${r.v}: ${r.count} fotogramas → ${out.status === 0 ? gif : `ffmpeg falló (${out.status ?? out.error?.message})`}`);
}
// El GIF del runner (todas las variantes seguidas) a 1 de cada 3 fotogramas, para no pasar de ~10 MB
const fdir = join(demo.dir, 'frames');
const all = readdirSync(fdir).filter((f) => f.endsWith('.png')).sort();
let k = 0;
for (let i = 0; i < all.length; i++) {
  if (i % 3) rmSync(join(fdir, all[i]));
  else renameSync(join(fdir, all[i]), join(fdir, `k${String(k++).padStart(4, '0')}.png`));
}
for (let i = 0; i < k; i++) renameSync(join(fdir, `k${String(i).padStart(4, '0')}.png`), join(fdir, `${String(i).padStart(3, '0')}.png`));
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

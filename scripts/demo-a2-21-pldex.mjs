// Demo de A2.21 (regla visual del plan SCUMM): PRUEBA del andar «Dex PixelLab» (?dex=pl) frente al Dex actual
// (rig dex2d de A2.15), LADO A LADO en el mismo GIF: mitad izquierda = actual, mitad derecha = ?dex=pl.
// Con ?qa=1, 1280x720. Las dos variantes hacen la MISMA ruta, una detrás de otra:
//   1) outside: por la acera, de (60, 94) a (30, 94) = hacia la izquierda, y de vuelta = hacia la derecha (A2.20: el
//      porche ya no se pisa; la zona andable de outside es y ≥ 91);
//   2) lobby: de perfil (40, 92) y (55,5, 98), hacia el fondo (55,5, 85) y hacia la cámara (55,5, 98).
// Cada captura (recorte de 400x440 centrado en Dex, con el rótulo «actual» / «PixelLab») lleva la hora del reloj de
// juego (suma de los delta de GameScene); al montar el GIF se emparejan por tramo y por ese reloj (un fotograma cada 125 ms de juego), así que las
// dos mitades van a los mismos tiempos aunque las capturas de cada pasada caigan a ritmos distintos.
// Además, en las dos variantes:
//   - zancada: muestreador rAF que mide el avance horizontal de Dex (px de arte) frente a su reloj de andar →
//     px por fotograma del ciclo (PixelLab: 130 ms por fotograma; actual: 100 ms) — ver docs/progreso/A2.21.md;
//   - nearest: con el juego parado, compara cada píxel de pantalla del sprite con el texel de su PNG (solo texels
//     interiores, sin borde con el fondo): con nearest y escala entera son idénticos; en lineal se mezclarían;
//   - sin ?dex=pl no se carga ninguna textura dexpl_*; con ?dex=pl se cargan las 32 y se usan al andar.
// GIF: demo-out/a2-21-pldex/a2-21-pldex.gif (el del runner, 804 px de ancho) y lado-a-lado.png. Termina en «problemas: ninguno».
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a2-21-pldex
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo, sleep } from './lib/demo.mjs';

const HALF = { width: 400, height: 440 };
const TICK_MS = 125; // un fotograma del GIF cada 125 ms de reloj de juego (GIF a 8 fps ≈ tiempo de juego)
const demo = await startDemo(import.meta.url, { fps: 8, width: HALF.width * 2 + 4, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];

const VARIANTS = [
  { id: 'actual', label: 'actual', query: '', side: /^dex2d_walk_(l|r)_\d$/, up: /^dex2d_walk_up_\d$/, down: /^dex2d_walk_down_\d$/, frameMs: 100 },
  { id: 'pl', label: 'PixelLab', query: '&dex=pl', side: /^dexpl_walk_(left|right)_\d$/, up: /^dexpl_walk_up_\d$/, down: /^dexpl_walk_down_\d$/, frameMs: 130 },
];
// Tramos: [escena, etiqueta, x, y, qué texturas se esperan]
const ROUTE = [
  ['outside', 'outside · a la izquierda', 30, 94, 'side'],
  ['outside', 'outside · a la derecha', 60, 94, 'side'],
  ['lobby', 'lobby · de perfil', 40, 92, 'side'],
  ['lobby', 'lobby · de perfil', 55.5, 98, 'side'],
  ['lobby', 'lobby · al fondo', 55.5, 85, 'up'],
  ['lobby', 'lobby · a la cámara', 55.5, 98, 'down'],
];

const raw = join(demo.dir, 'raw');
rmSync(raw, { recursive: true, force: true });

async function open(scene, v) {
  await demo.openScene(scene, v.query);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail(`${v.id} ${scene}: la escena no quedó libre`);
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
    // reloj de juego: la suma de los delta que recibe GameScene (los mismos que mueven y animan a Dex)
    window.__gt = 0;
    window.__game.scene.getScene('GameScene').events.on('update', (_t, d) => { window.__gt += d; });
    // Muestreo en cada fotograma de render: texturas vistas, escalas y zancada (avance en px de arte —total y solo
    // horizontal— frente al reloj de andar del Player, solo andando de perfil)
    const s = (window.__pl = { tex: [], scales: [], heights: [], dArt: 0, dxArt: 0, dClock: 0, last: null });
    const tick = () => {
      const gs = window.__game.scene.getScene('GameScene');
      const p = gs?.player;
      const a = window.__qa.state().anim;
      if (a && p) {
        if (!s.tex.includes(a.texture)) s.tex.push(a.texture);
        if (!s.scales.includes(a.scale)) s.scales.push(a.scale);
        const h = p.frame?.realHeight;
        if (h && !s.heights.includes(h)) s.heights.push(h);
        const side = a.moving && (a.dir === 'left' || a.dir === 'right');
        const cur = { x: p.x / Math.abs(p.scaleX || 1), y: p.y / Math.abs(p.scaleY || 1), clock: p.walkClock, dir: a.dir };
        if (side && s.last && s.last.dir === cur.dir && cur.clock > s.last.clock) {
          s.dArt += Math.hypot(cur.x - s.last.x, cur.y - s.last.y);
          s.dxArt += Math.abs(cur.x - s.last.x);
          s.dClock += cur.clock - s.last.clock;
        }
        s.last = side ? cur : null;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stats(reset = false) {
  return page.evaluate((reset) => {
    const out = JSON.parse(JSON.stringify(window.__pl));
    if (reset) Object.assign(window.__pl, { tex: [], scales: [], heights: [] });
    return out;
  }, reset);
}

/** Una captura del recorte centrado en Dex, con rótulo; devuelve la hora del reloj de GameScene */
async function capture(v, label, path) {
  const r = await page.evaluate((title, label, cw, ch) => {
    const gs = window.__game.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const px = (gs.player.x - cam.scrollX) * cam.zoom;
    const py = (gs.player.y - cam.scrollY) * cam.zoom;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(cw, vw);
    const h = Math.min(ch, vh);
    const x = Math.max(0, Math.min(vw - w, Math.round(px - w / 2)));
    const y = Math.max(0, Math.min(vh - h, Math.round(py - h * 0.72)));
    let cap = document.getElementById('demo-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'demo-cap';
      cap.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:13px monospace;color:#fff;background:rgba(10,10,20,.72);padding:4px 7px;white-space:pre';
      document.body.appendChild(cap);
    }
    const a = window.__qa.state().anim;
    cap.style.display = '';
    cap.style.left = `${x + 6}px`;
    cap.style.top = `${y + 6}px`;
    cap.innerHTML = '';
    const big = document.createElement('div');
    big.style.cssText = 'font:bold 22px sans-serif;color:#ffd84a';
    big.textContent = title;
    cap.appendChild(big);
    cap.appendChild(document.createTextNode(`${label}\n${a ? a.texture : ''}`));
    return { clip: { x, y, width: w, height: h }, t: window.__gt };
  }, v.label, label, HALF.width, HALF.height);
  await page.screenshot({ clip: r.clip, path });
  return r;
}

/** Nearest: con el juego parado, cada píxel de pantalla de los texels interiores del sprite = el color del texel */
async function nearestCheck(v) {
  const info = await page.evaluate(() => {
    const game = window.__game;
    game.loop.sleep();
    const cap = document.getElementById('demo-cap');
    if (cap) cap.style.display = 'none';
    const gs = game.scene.getScene('GameScene');
    const p = gs.player;
    const cam = gs.cameras.main;
    const canvas = game.canvas;
    const rect = canvas.getBoundingClientRect();
    const k = rect.width / canvas.width;
    const fr = p.frame;
    const img = fr.source.image;
    const c = document.createElement('canvas');
    c.width = fr.cutWidth;
    c.height = fr.cutHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, fr.cutWidth, fr.cutHeight);
    const data = Array.from(ctx.getImageData(0, 0, fr.cutWidth, fr.cutHeight).data);
    const b = p.getBounds();
    return {
      key: p.texture.key,
      w: fr.cutWidth,
      h: fr.cutHeight,
      data,
      flipX: p.flipX,
      tinted: p.isTinted,
      left: rect.left + (b.x - cam.scrollX) * cam.zoom * k,
      top: rect.top + (b.y - cam.scrollY) * cam.zoom * k,
      scale: (b.width / fr.cutWidth) * cam.zoom * k,
      postFx: (cam.postPipelines?.length ?? 0),
    };
  });
  let res = null;
  try {
    const s = info.scale;
    const pad = 4;
    const clip = { x: Math.max(0, Math.round(info.left) - pad), y: Math.max(0, Math.round(info.top) - pad), width: Math.round(info.w * s) + pad * 2, height: Math.round(info.h * s) + pad * 2 };
    const buf = await page.screenshot({ clip });
    const { default: sharp } = await import('sharp');
    const { data: px, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => { const i = (y * im.width + x) * 3; return [px[i], px[i + 1], px[i + 2]]; };
    const tex = (tx, ty) => { const i = (ty * info.w + tx) * 4; return info.data.slice(i, i + 4); };
    const si = Math.round(s);
    // texels interiores (opacos y con sus 8 vecinos opacos): ahí la pantalla no puede mezclar con el fondo
    const interior = [];
    for (let ty = 1; ty < info.h - 1; ty++) {
      for (let tx = 1; tx < info.w - 1; tx++) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) if (tex(tx + dx, ty + dy)[3] < 255) ok = false;
        if (ok) interior.push([tx, ty]);
      }
    }
    // alineación: el mejor desplazamiento de ±3 px (redondeos del recorte)
    let best = null;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        let bad = 0;
        let n = 0;
        for (const [tx, ty] of interior) {
          const c = tex(tx, ty);
          const sx = info.flipX ? info.w - 1 - tx : tx;
          for (let yy = 0; yy < si; yy++) {
            for (let xx = 0; xx < si; xx++) {
              const X = pad + ox + sx * si + xx;
              const Y = pad + oy + ty * si + yy;
              if (X < 0 || Y < 0 || X >= im.width || Y >= im.height) continue;
              const q = at(X, Y);
              n++;
              if (Math.abs(q[0] - c[0]) > 2 || Math.abs(q[1] - c[1]) > 2 || Math.abs(q[2] - c[2]) > 2) bad++;
            }
          }
        }
        if (n && (!best || bad / n < best.bad / best.n)) best = { bad, n, ox, oy };
      }
    }
    res = { key: info.key, scale: Math.round(s * 1000) / 1000, integer: Math.abs(s - si) < 0.01, texels: interior.length, ...best, tinted: info.tinted, postFx: info.postFx };
  } catch (e) {
    res = { key: info.key, error: String(e?.message || e) };
  } finally {
    await page.evaluate(() => window.__game.loop.wake());
  }
  return res;
}

// ── Grabación: las dos variantes, la misma ruta ──────────────────────────────────────────────────────────────
const takes = {}; // takes[variante][tramo] = [{ path, t }]
const report = {};
for (const v of VARIANTS) {
  takes[v.id] = [];
  report[v.id] = { stride: null, nearest: [] };
  const dir = join(raw, v.id);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  let scene = null;
  for (let si = 0; si < ROUTE.length; si++) {
    const [sc, label, x, y, want] = ROUTE[si];
    if (sc !== scene) {
      scene = sc;
      await open(sc, v);
      if (sc === 'outside') {
        // a la acera sin grabar (punto de partida común)
        await page.evaluate(() => window.__demoRun(window.__qa.walk(60, 94)));
        await page.waitForFunction(() => window.__demoDone, { timeout: 40000 }).catch(() => {});
      }
      const loaded = await page.evaluate(() => window.__game.textures.getTextureKeys().filter((k) => k.startsWith('dexpl_')).length);
      if (v.id === 'actual' && loaded) problems.push(`actual ${sc}: se cargaron ${loaded} texturas dexpl_* sin ?dex=pl`);
      if (v.id === 'pl' && loaded !== 32) problems.push(`pl ${sc}: ${loaded} texturas dexpl_* cargadas (esperaba 32)`);
    }
    await stats(true);
    const shots = [];
    const t0 = (await capture(v, label, join(dir, `${String(n).padStart(4, '0')}.png`))).t;
    shots.push({ path: join(dir, `${String(n++).padStart(4, '0')}.png`), t: 0 });
    await page.evaluate((x, y) => window.__demoRun(window.__qa.walk(x, y)), x, y);
    const w0 = Date.now();
    let walked = false;
    while (Date.now() - w0 < 40000) {
      const path = join(dir, `${String(n++).padStart(4, '0')}.png`);
      const r = await capture(v, label, path);
      shots.push({ path, t: r.t - t0 });
      if (!walked && !report[v.id].nearest.length && v.id === 'pl' && want === 'side' && (si === 2 || si === 3)) {
        // nearest: a mitad de un tramo de perfil del lobby, con el sprite de andar puesto
        const tex = await page.evaluate(() => window.__qa.state().anim?.texture);
        if (tex && v.side.test(tex)) { walked = true; report[v.id].nearest.push(await nearestCheck(v)); }
      }
      if (await page.evaluate(() => window.__demoDone)) break;
    }
    // medio segundo quieto al final del tramo
    const tEnd = shots[shots.length - 1].t;
    for (let i = 0; i < 3; i++) {
      const path = join(dir, `${String(n++).padStart(4, '0')}.png`);
      const r = await capture(v, label, path);
      shots.push({ path, t: Math.max(r.t - t0, tEnd + (i + 1) * 170) });
      await sleep(120);
    }
    takes[v.id].push(shots);
    const err = await page.evaluate(() => window.__demoErr);
    if (err) problems.push(`${v.id} ${label}: walk falló: ${err}`);
    if (!(await page.evaluate(() => window.__demoDone))) problems.push(`${v.id} ${label}: no terminó en 40 s`);
    const s = await stats(true);
    const re = v[want];
    const hits = s.tex.filter((t) => re.test(t));
    console.log(`${v.id} · ${label}: ${hits.length} fotogramas ${re} · escalas ${s.scales.join('/')} · altos ${s.heights.join('/')} · ${shots.length} capturas, ${Math.round(tEnd)} ms de juego`);
    if (hits.length < (want === 'side' ? 4 : 2)) problems.push(`${v.id} ${label}: solo ${hits.length} fotogramas ${re} (${s.tex.join(', ')})`);
    if (v.id === 'pl' && s.tex.some((t) => /^dex2d_walk_/.test(t))) problems.push(`pl ${label}: se vio el andar dex2d con ?dex=pl`);
    if (s.scales.length !== 1) problems.push(`${v.id} ${label}: la escala cambió al andar (${s.scales.join('/')}) — A2.13`);
  }
  // nearest también en el actual (referencia), quieto en el lobby
  if (v.id === 'actual') report[v.id].nearest.push(await nearestCheck(v));
  const s = await stats();
  const perMs = s.dClock ? s.dArt / s.dClock : 0;
  const perMsX = s.dClock ? s.dxArt / s.dClock : 0;
  const r2 = (n) => Math.round(n * 100) / 100;
  report[v.id].stride = { pxArtPerFrame: r2(perMs * v.frameMs), pxArtPerFrameX: r2(perMsX * v.frameMs), pxArtPerSecondOfClock: r2(perMs * 1000), frameMs: v.frameMs, clockMs: Math.round(s.dClock) };
  console.log(`${v.id} zancada: ${report[v.id].stride.pxArtPerFrame} px de arte por fotograma del ciclo (${v.frameMs} ms; solo horizontal ${report[v.id].stride.pxArtPerFrameX}; ${report[v.id].stride.pxArtPerSecondOfClock} px/s de reloj de andar, ${report[v.id].stride.clockMs} ms medidos)`);
  for (const r of report[v.id].nearest) console.log(`${v.id} nearest: ${JSON.stringify(r)}`);
}
await demo.end();

// Comprobaciones de zancada y nearest
const st = report.pl.stride;
if (!st.clockMs) problems.push('pl: no se pudo medir la zancada (sin tramos de perfil)');
// el arte avanza 9,25–9,5 px por fotograma con el pie apoyado (docs/progreso/A2.21.md): fuera de 8–11 patinaría
else if (st.pxArtPerFrame < 8 || st.pxArtPerFrame > 11) problems.push(`pl: ${st.pxArtPerFrame} px de arte por fotograma (el pie apoyado avanza 9,25–9,5): patina`);
for (const [id, list] of Object.entries(report)) {
  if (!list.nearest.length) problems.push(`${id}: no se hizo la comprobación de nearest`);
  for (const r of list.nearest) {
    if (r.error) problems.push(`${id} nearest: ${r.error}`);
    else {
      if (!r.integer) problems.push(`${id} nearest: escala ${r.scale} no entera (A2.8)`);
      // con lineal falla la mayoría de los píxeles de borde de bloque; se deja margen para algo delante de Dex
      if (r.n && r.bad / r.n > 0.1) problems.push(`${id} nearest: ${r.bad} de ${r.n} píxeles (${Math.round((r.bad / r.n) * 100)} %) con color fuera de lo dibujado en ${r.key}`);
    }
  }
}

// ── Montaje lado a lado: por tramo, emparejado por el reloj de juego ────────────────────────────────────────
const pa = join(demo.dir, 'pair', 'a');
const pb = join(demo.dir, 'pair', 'b');
rmSync(join(demo.dir, 'pair'), { recursive: true, force: true });
mkdirSync(pa, { recursive: true });
mkdirSync(pb, { recursive: true });
const pick = (shots, t) => {
  let best = shots[0];
  for (const s of shots) if (s.t <= t) best = s;
  return best.path;
};
let k = 0;
for (let si = 0; si < ROUTE.length; si++) {
  const A = takes.actual[si] ?? [];
  const B = takes.pl[si] ?? [];
  if (!A.length || !B.length) continue;
  const end = Math.max(A[A.length - 1].t, B[B.length - 1].t);
  for (let t = 0; t <= end + 1; t += TICK_MS) {
    const name = `${String(k++).padStart(4, '0')}.png`;
    copyFileSync(pick(A, t), join(pa, name));
    copyFileSync(pick(B, t), join(pb, name));
  }
}
const frames = join(demo.dir, 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
if (k) {
  const out = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', join(pa, '%04d.png'), '-i', join(pb, '%04d.png'),
    '-filter_complex', `[0:v]scale=${HALF.width}:${HALF.height}:flags=neighbor,pad=${HALF.width + 4}:${HALF.height}:0:0:color=white[l];[1:v]scale=${HALF.width}:${HALF.height}:flags=neighbor[r];[l][r]hstack=inputs=2`,
    '-start_number', '0', join(frames, '%03d.png'),
  ], { stdio: 'inherit' });
  if (out.status !== 0) problems.push(`ffmpeg (lado a lado) falló: ${out.status ?? out.error?.message}`);
  // fotograma fijo del montaje para el artefacto (a mitad del primer tramo del lobby)
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(frames, `${String(Math.floor(k / 2)).padStart(3, '0')}.png`), join(demo.dir, 'lado-a-lado.png')], { stdio: 'inherit' });
} else problems.push('no hay fotogramas para montar el lado a lado');
rmSync(join(demo.dir, 'pair'), { recursive: true, force: true });
rmSync(raw, { recursive: true, force: true });

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas lado a lado: ${k} (${TICK_MS} ms de juego cada uno)`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

// A12 (tráiler): graba planos del juego fotograma a fotograma con el reloj controlado (scripts/trailer/clock.js).
//
//   node scripts/trailer/record.mjs list                    planos de scripts/trailer/shots.mjs
//   node scripts/trailer/record.mjs <plano…> [opciones]     graba esos planos (o «all», o «v» para todos los verticales)
//     --base URL      build servido (por defecto http://127.0.0.1:4173, el de `npm run preview`)
//     --fps N         60 (por defecto) o 30
//     --out DIR       /var/tmp/adv-trailer (clips en DIR/clips, fotogramas temporales en DIR/frames)
//     --keep-frames   no borra los PNG al terminar
//     --still         solo un fotograma a la mitad del plano (para probar el encuadre deprisa)
//
// Cada plano: carga el build con ?qa=1 (el modo QA no pinta nada en pantalla), lo prepara en tiempo real (flags,
// inventario, posición) con la API de QA, oculta lo que no debe salir, pasa el reloj a modo captura y graba
// 1 s de margen + duración del plano + 1 s de margen. En cada paso: acciones de la línea de tiempo que tocan → un
// fotograma de juego (1000/fps ms virtuales) → captura PNG del viewport (1920×1080, deviceScaleFactor 1: el canvas de
// Phaser tiene ese tamaño real y el pixel art se dibuja en NEAREST, sin escalado del navegador). Después ffmpeg a H.264
// (crf 12, yuv420p) en DIR/clips/<plano>.mp4 y la lista de sonidos que pidió el juego en DIR/clips/<plano>.audio.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOCK_SRC } from './clock.js';
import { SHOTS } from './shots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const BASE = opt('base', process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const FPS = Number(opt('fps', '60'));
const OUT = resolve(opt('out', '/var/tmp/adv-trailer'));
const KEEP = flag('keep-frames');
const STILL = flag('still');
const MARGIN = 1000;


if (!args.length || args[0] === 'list') {
  for (const s of SHOTS) console.log(`${s.name.padEnd(26)} ${s.vertical ? 'V' : 'H'} ${String(s.dur).padStart(5)} ms  ${s.scene ?? 'menú'}  ${s.note ?? ''}`);
  process.exit(0);
}
const wanted = args[0] === 'all' ? SHOTS.filter((s) => !s.vertical) : args[0] === 'v' ? SHOTS.filter((s) => s.vertical) : args.map((n) => {
  const s = SHOTS.find((x) => x.name === n || x.name.replace(/^\d+-/, '') === n);
  if (!s) throw new Error(`No existe el plano «${n}» (node scripts/trailer/record.mjs list)`);
  return s;
});

const { default: puppeteer } = await import('puppeteer');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars', '--mute-audio'],
});

/** Funciones de ayuda dentro de la página (window.__tr) */
const HELPERS = () => {
  const g = () => window.__game;
  const gs = () => g().scene.getScene('GameScene');
  const ui = () => g().scene.getScene('UIScene');
  window.__tr = {
    gs, ui,
    run: (ops) => { void gs().qaRunScript(ops).catch((e) => console.error('[tr] script', e)); },
    tap: () => gs().qaSyntheticTap(),
    walk: (x, y) => gs().qaWalk(x, y),
    teleport: (x, y) => gs().player.teleportPct(x, y),
    goto: (id, spawn) => gs().qaGoto(id, spawn),
    /** Oculta el panel SCUMM y botones (lo mismo que hace una cinemática) */
    chrome: (hidden) => ui().setCinematicChrome?.(hidden),
  };
};

async function setupPage(shot) {
  const vp = shot.vertical
    ? { width: 390, height: 844, deviceScaleFactor: 1080 / 390, isMobile: true, hasTouch: true }
    : { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`  [página] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.error(`  [consola] ${m.text().slice(0, 200)}`); });
  await page.setViewport(vp);
  await page.evaluateOnNewDocument(CLOCK_SRC);
  // Sin cursor ni nada de selección; la API de QA no pinta nada
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '*{cursor:none!important} ::selection{background:transparent}';
      document.head.appendChild(st);
    });
  });
  const url = shot.scene ? `${BASE}/?qa=1&scene=${shot.scene}${shot.query ?? ''}` : `${BASE}/?qa=1${shot.query ?? ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (shot.scene) {
    await page.waitForFunction((id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
      { timeout: 120000, polling: 250 }, shot.scene);
    await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  } else {
    await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene'), { timeout: 120000, polling: 250 });
  }
  await page.evaluate(HELPERS);
  return { page, ctx, vp };
}

function encode(framesDir, mp4) {
  const r = spawnSync('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(framesDir, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falló (${r.status}) con ${mp4}`);
}

/** clave de sonido → fichero del repo (assets/audio/**\/<clave>.(mp3|ogg|wav)) */
let audioIndex = null;
function audioFile(key) {
  if (!audioIndex) {
    audioIndex = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mp3|ogg|wav|m4a)$/.test(e.name)) {
          const k = e.name.replace(/\.[^.]+$/, '');
          if (!audioIndex.has(k) || e.name.endsWith('.mp3')) audioIndex.set(k, p.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, 'assets', 'audio'));
  }
  return audioIndex.get(key) ?? audioIndex.get(key.replace(/^(sfx|amb|music|voice)_/, '')) ?? null;
}

async function recordShot(shot) {
  const t0 = Date.now();
  console.log(`▶ ${shot.name} (${shot.scene ?? 'menú'}, ${shot.dur} ms${shot.vertical ? ', vertical' : ''})`);
  const { page, ctx } = await setupPage(shot);
  try {
    if (shot.setup) await shot.setup(page);
    await page.evaluate(() => window.__clock.realSleep(300));
    const total = shot.dur + 2 * MARGIN;
    const frames = Math.round((total / 1000) * FPS);
    const dir = join(OUT, 'frames', shot.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const timeline = [...(shot.timeline ?? [])].sort((a, b) => a[0] - b[0]);
    let ti = 0;
    await page.evaluate((fps) => window.__clock.capture(fps), FPS);
    const stillAt = STILL ? Math.round(frames / 2) : -1;
    for (let i = 0; i < frames; i++) {
      const tBody = (i * 1000) / FPS - MARGIN; // ms respecto al comienzo del plano (sin margen)
      while (ti < timeline.length && timeline[ti][0] <= tBody) {
        const [, fn, arg] = timeline[ti++];
        await page.evaluate(fn, arg).catch((e) => console.error(`  acción a ${tBody} ms: ${e.message}`));
      }
      await page.evaluate(() => window.__clock.step());
      if (STILL && i !== stillAt) continue;
      await page.screenshot({ path: join(dir, `${String(STILL ? 0 : i).padStart(5, '0')}.png`), type: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
      if (STILL) break;
      if ((i + 1) % (FPS * 2) === 0) process.stdout.write(`  ${i + 1}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
    }
    const audio = await page.evaluate(() => window.__clock.audio());
    if (STILL) {
      console.log(`  fotograma de prueba: ${join(dir, '00000.png')}`);
      return { name: shot.name, still: join(dir, '00000.png') };
    }
    mkdirSync(join(OUT, 'clips'), { recursive: true });
    const mp4 = join(OUT, 'clips', `${shot.name}.mp4`);
    encode(dir, mp4);
    const clips = audio.map((a) => ({ ...a, t: Math.round(a.t), file: audioFile(a.key) }));
    writeFileSync(join(OUT, 'clips', `${shot.name}.audio.json`), JSON.stringify({
      shot: shot.name, fps: FPS, marginMs: MARGIN, durMs: shot.dur,
      note: 't = ms desde el primer fotograma del mp4 (el plano útil empieza en marginMs). file = ruta en el repo.',
      clips,
    }, null, 2));
    if (!KEEP) rmSync(dir, { recursive: true, force: true });
    console.log(`  ✔ ${mp4} · ${frames} fotogramas · ${clips.length} sonidos · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return { name: shot.name, mp4, frames };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const results = [];
for (const shot of wanted) {
  try {
    results.push(await recordShot(shot));
  } catch (e) {
    console.error(`  ✖ ${shot.name}: ${e.message}`);
    results.push({ name: shot.name, error: e.message });
  }
}
await browser.close();
const bad = results.filter((r) => r.error);
console.log(`\n${results.length - bad.length}/${results.length} planos${bad.length ? ` · fallos: ${bad.map((b) => b.name).join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);

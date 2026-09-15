// A0.2 (plan SCUMM): grabación común de las demos visuales (`scripts/demo-*.mjs`) y su ejecución en CI.
//
// Cada demo deja su carpeta en `demo-out/<nombre>/`:
//   frames/000.png…   fotogramas que se convierten en GIF
//   <etiqueta>.png    capturas fijas (p. ej. `full.png`)
//   meta.json         fps y ancho del GIF que pidió la demo
//   <nombre>.gif      lo crea `framesToGif` con ffmpeg (el runner lo hace aunque la demo falle)
//   log.txt           salida de la demo (solo con el runner)
// El nombre sale del fichero: `scripts/demo-a1-3-poster-lobby.mjs` → `a1-3-poster-lobby`.
//
// En una demo:
//   import { startDemo } from './lib/demo.mjs';
//   const demo = await startDemo(import.meta.url, { fps: 8 });
//   await demo.openScene('outside');          // ?scene=outside y espera a GameScene
//   if (!(await demo.settle())) demo.fail('La escena no quedó libre');
//   await demo.film(1500);                    // o demo.shot() fotograma a fotograma
//   await demo.still('full');
//   await demo.end();                         // cierra el navegador
//   if (!ok) demo.fail('motivo');             // sale con código 1 (el GIF se genera igual)
//
// CLI (sin puppeteer, vale en local):
//   node scripts/lib/demo.mjs list [--changed <ref>]   demos que tocaría ejecutar
//   node scripts/lib/demo.mjs run [nombre|ruta…]       ejecuta demos (todas si no se pasan) y genera los GIF
//   node scripts/lib/demo.mjs gif <nombre>             convierte demo-out/<nombre>/frames en GIF
// Variables: BASE_URL (build servido), DEMO_OUT (carpeta raíz, por defecto demo-out).
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '..');
const ROOT = resolve(SCRIPTS, '..');
export const OUT_ROOT = resolve(ROOT, process.env.DEMO_OUT || 'demo-out');
export const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const LIB_PATH = 'scripts/lib/demo.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `file:///…/scripts/demo-hold.mjs`, `scripts/demo-hold.mjs` o `hold` → `hold`. */
export function demoName(ref) {
  const file = String(ref).startsWith('file:') ? fileURLToPath(ref) : String(ref);
  return basename(file).replace(/\.mjs$/, '').replace(/^demo-/, '');
}

export const demoDir = (name) => join(OUT_ROOT, name);

/**
 * Abre Chrome headless con el viewport móvil de las demos y prepara `demo-out/<nombre>/`.
 * Opciones: fps (8), width (ancho del GIF, 640), viewport (844x390 táctil, deviceScaleFactor 1).
 */
export async function startDemo(ref, { fps = 8, width = 640, viewport = {} } = {}) {
  const { default: puppeteer } = await import('puppeteer');
  const name = demoName(ref);
  const dir = demoDir(name);
  const frames = join(dir, 'frames');
  // Solo se limpia lo que genera la demo: el log del runner ya está abierto en esta carpeta
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ name, fps, width }, null, 2));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, ...viewport });

  let n = 0;
  let closed = false;
  const demo = {
    name,
    dir,
    browser,
    page,
    base: BASE_URL,
    sleep,
    get frames() { return n; },

    /** Un fotograma del GIF. `opts` va a page.screenshot (p. ej. `clip`). */
    shot: (opts = {}) => page.screenshot({ ...opts, path: join(frames, `${String(n++).padStart(3, '0')}.png`) }),

    /** Fotogramas seguidos durante `ms` milisegundos. */
    async film(ms, opts = {}) {
      const end = Date.now() + ms;
      while (Date.now() < end) await demo.shot(opts);
    },

    /** Captura fija `demo-out/<nombre>/<etiqueta>.png`. */
    still: (label = 'full', opts = {}) => page.screenshot({ ...opts, path: join(dir, `${label}.png`) }),

    /** Carga `?scene=<id>` (más `query`, p. ej. `&hintAfter=6`) y espera a que GameScene esté en esa escena. */
    async openScene(scene, query = '') {
      await page.goto(`${BASE_URL}/?scene=${scene}${query}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        (id) => window.__game?.scene?.isActive('GameScene') && window.__game.registry.get('currentSceneId') === id,
        { timeout: 90000, polling: 500 }, scene,
      );
    },

    /** Estado de GameScene: script de escena, diálogo y cooldown de input. */
    state: () => page.evaluate(() => {
      const gs = window.__game.scene.getScene('GameScene');
      return {
        script: !!gs.scriptEngine?.isRunning?.(),
        dialogue: !!gs.registry.get('dialogueShowing') || !!gs.registry.get('dialogueActive'),
        cooldown: gs.inputCooldownFrames ?? 0,
      };
    }),

    /**
     * Deja la escena libre tocando `tap` mientras haya cinemática o diálogo, como el jugador. La cinemática de
     * entrada arranca con retraso: solo cuenta como libre tras `calm` comprobaciones seguidas.
     * Con `cooldown: true` también espera a que acabe el cooldown de input. Devuelve si quedó libre.
     */
    async settle({ tap = [422, 40], calm = 4, tries = 90, every = 700, cooldown = false } = {}) {
      let quiet = 0;
      for (let i = 0; i < tries && quiet < calm; i++) {
        const st = await demo.state();
        if (st.script || st.dialogue) { quiet = 0; await page.touchscreen.tap(tap[0], tap[1]); }
        else if (cooldown && st.cooldown > 0) quiet = 0;
        else quiet++;
        await sleep(every);
      }
      return quiet >= calm;
    },

    /** Cierra el navegador (se puede llamar varias veces). */
    async end() {
      if (closed) return;
      closed = true;
      await browser.close().catch(() => {});
    },

    /** Mensaje de error y salida con código 1 (el runner genera el GIF con lo grabado). */
    async fail(msg) {
      console.error(msg);
      await demo.end();
      process.exit(1);
    },
  };
  return demo;
}

/** Convierte `demo-out/<nombre>/frames/*.png` en `<nombre>.gif` con ffmpeg. Devuelve la ruta o null. */
export function framesToGif(name) {
  const dir = demoDir(name);
  const frames = join(dir, 'frames');
  if (!existsSync(frames) || !readdirSync(frames).some((f) => f.endsWith('.png'))) return null;
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')); } catch { /* valores por defecto */ }
  const fps = Number(meta.fps) || 8;
  const width = Number(meta.width) || 640;
  const gif = join(dir, `${name}.gif`);
  // Paleta propia por GIF y escalado sin suavizar para no emborronar el pixel art
  const r = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', join(frames, '%03d.png'),
    '-vf', `fps=${fps},scale=${width}:-1:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
    gif,
  ], { stdio: 'inherit' });
  if (r.error) throw new Error(`ffmpeg no disponible: ${r.error.message}`);
  if (r.status !== 0 || !existsSync(gif)) throw new Error(`ffmpeg falló con código ${r.status} en ${name}`);
  return gif;
}

// ── Selección y ejecución ────────────────────────────────────────────────────────────────────────────

/** Todas las demos: `scripts/demo-*.mjs`, en orden alfabético. */
export function allDemos() {
  return readdirSync(SCRIPTS).filter((f) => /^demo-.+\.mjs$/.test(f)).sort().map((f) => `scripts/${f}`);
}

/**
 * Demos que toca grabar según los ficheros cambiados: las `scripts/demo-*.mjs` añadidas o modificadas; todas si
 * cambia esta librería. Los ficheros borrados se ignoran.
 */
export function selectDemos(changedFiles) {
  const changed = changedFiles.map((f) => f.trim()).filter(Boolean);
  if (changed.includes(LIB_PATH)) return allDemos();
  const all = new Set(allDemos());
  return [...new Set(changed.filter((f) => all.has(f)))].sort();
}

/** Resuelve `hold`, `demo-hold`, `demo-hold.mjs` o `scripts/demo-hold.mjs` a la ruta de la demo. */
function resolveDemo(arg) {
  const path = `scripts/demo-${demoName(arg)}.mjs`;
  if (!existsSync(join(ROOT, path))) throw new Error(`No existe la demo ${arg} (${path})`);
  return path;
}

function runOne(path) {
  const name = demoName(path);
  const dir = demoDir(name);
  // Carpeta limpia: una demo que falla antes de grabar no debe heredar fotogramas de otra ejecución
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const log = createWriteStream(join(dir, 'log.txt'));
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [path], { cwd: ROOT, env: { ...process.env, BASE_URL }, stdio: ['ignore', 'pipe', 'pipe'] });
    const tee = (stream, out) => stream.on('data', (chunk) => { out.write(chunk); log.write(chunk); });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', (code, signal) => log.end(() => done({ name, path, code: code ?? 1, signal, secs: (Date.now() - started) / 1000 })));
  });
}

async function runDemos(paths) {
  mkdirSync(OUT_ROOT, { recursive: true });
  const results = [];
  for (const path of paths) {
    console.log(`\n::group::demo ${demoName(path)} (${path})`);
    const res = await runOne(path);
    try {
      const gif = framesToGif(res.name);
      res.gif = gif ? relative(ROOT, gif) : null;
      res.gifKb = gif ? Math.round(statSync(gif).size / 1024) : 0;
    } catch (e) {
      res.gifError = e.message;
      console.error(e.message);
    }
    res.ok = res.code === 0 && !!res.gif;
    console.log(`::endgroup::\n${res.ok ? 'OK ' : 'FALLO'} ${res.name} · código ${res.code} · ${res.secs.toFixed(1)} s · ${res.gif ? `${res.gif} (${res.gifKb} KB)` : `sin GIF${res.gifError ? `: ${res.gifError}` : ''}`}`);
    results.push(res);
  }
  writeFileSync(join(OUT_ROOT, 'report.json'), JSON.stringify(results, null, 2));

  const lines = [
    '### Demos visuales',
    '',
    results.length ? '| Demo | Resultado | GIF | Tiempo |' : 'No hay demos que grabar en este cambio.',
    ...(results.length ? ['|---|---|---|---|'] : []),
    ...results.map((r) => `| \`${r.name}\` | ${r.ok ? 'OK' : `FALLO (código ${r.code}${r.gif ? '' : ', sin GIF'})`} | ${r.gif ? `${basename(r.gif)} · ${r.gifKb} KB` : '—'} | ${r.secs.toFixed(0)} s |`),
    '',
    results.length ? 'Los GIF están en el artefacto `demo-gifs` de esta ejecución (fotogramas en `demo-frames`).' : '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  else console.log(`\n${lines.join('\n')}`);
  return results.every((r) => r.ok);
}

function changedSince(ref) {
  const r = spawnSync('git', ['diff', '--name-only', ref, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git diff ${ref} HEAD falló: ${r.stderr}`);
  return r.stdout.split('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'list') {
      const i = args.indexOf('--changed');
      const paths = i >= 0 ? selectDemos(changedSince(args[i + 1] || 'HEAD^1')) : allDemos();
      console.log(paths.join(' '));
    } else if (cmd === 'run') {
      const paths = args.length ? args.map(resolveDemo) : allDemos();
      process.exit((await runDemos(paths)) ? 0 : 1);
    } else if (cmd === 'gif') {
      if (!args[0]) throw new Error('Falta el nombre de la demo');
      const gif = framesToGif(demoName(args[0]));
      console.log(gif ? relative(ROOT, gif) : `No hay fotogramas en ${relative(ROOT, demoDir(demoName(args[0])))}/frames`);
      if (!gif) process.exit(1);
    } else {
      console.error('Uso: node scripts/lib/demo.mjs list [--changed <ref>] | run [demo…] | gif <demo>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

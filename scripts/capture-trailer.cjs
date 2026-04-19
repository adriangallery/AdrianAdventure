/**
 * Deterministic trailer capture — controls the game clock frame-by-frame
 * so every frame of the 30s trailer is captured perfectly.
 *
 * Usage:  npm run trailer:capture
 * Output: trailer/zeroadventure-ii-trailer.mp4
 */

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Config ─────────────────────────────────────────────────

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const TRAILER_SECONDS = 34;
const TOTAL_FRAMES = TRAILER_SECONDS * FPS;
const OUTPUT_DIR = path.join(__dirname, '..', 'trailer');
const FRAMES_DIR = path.join(OUTPUT_DIR, 'frames');
const OUTPUT_MP4 = path.join(OUTPUT_DIR, 'zeroadventure-ii-trailer.mp4');

// ─── Helpers ────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
}

async function findDevServer() {
  for (const port of [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009]) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return port;
    } catch {}
  }
  return null;
}

// ─── Main ───────────────────────────────────────────────────

(async () => {
  console.log('[capture] Looking for dev server...');
  const port = await findDevServer();
  if (!port) {
    console.error('[capture] No dev server found. Run "npm run dev" first.');
    process.exit(1);
  }
  console.log('[capture] Found dev server on port %d', port);

  ensureDir(FRAMES_DIR);
  cleanDir(FRAMES_DIR);

  console.log('[capture] Launching Chrome (%dx%d)...', WIDTH, HEIGHT);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // ── Inject deterministic clock BEFORE page loads ──
  // Overrides requestAnimationFrame and performance.now so the game
  // advances exactly 33.33ms per manual step, regardless of wall clock.
  await page.evaluateOnNewDocument(`
    (function() {
      var captureMode = false;
      var virtualTime = 0;
      var FRAME_MS = ${FRAME_MS};
      var origRAF = window.requestAnimationFrame;
      var origCAF = window.cancelAnimationFrame;
      var origPerfNow = performance.now.bind(performance);
      var rafId = 0;
      var pending = new Map();

      window.requestAnimationFrame = function(cb) {
        if (!captureMode) return origRAF(cb);
        var id = ++rafId;
        pending.set(id, cb);
        return id;
      };
      window.cancelAnimationFrame = function(id) {
        if (!captureMode) return origCAF(id);
        pending.delete(id);
      };
      performance.now = function() {
        return captureMode ? virtualTime : origPerfNow();
      };

      // Switch to deterministic mode
      window.__enableCapture = function() {
        captureMode = true;
        virtualTime = origPerfNow();
      };

      // Advance the game exactly one frame (33.33ms)
      window.__step = function() {
        virtualTime += FRAME_MS;
        var cbs = Array.from(pending.entries());
        pending.clear();
        for (var i = 0; i < cbs.length; i++) {
          try { cbs[i][1](virtualTime); } catch(e) { console.error(e); }
        }
      };
    })();
  `);

  // ── Load the trailer ──
  console.log('[capture] Loading trailer page...');
  await page.goto(`http://localhost:${port}/?trailer`, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  // Wait for Phaser to boot
  await page.waitForFunction('!!window.__game', { timeout: 15000 });
  console.log('[capture] Phaser booted. Waiting for assets to load...');

  // Let the game boot normally (BootScene → TrailerScene preload → TrailerScene create)
  // TrailerScene preloads ALL assets, so we need to wait for that
  await new Promise(r => setTimeout(r, 5000));

  // ── Switch to deterministic frame stepping ──
  await page.evaluate('window.__enableCapture()');
  console.log('[capture] Deterministic mode enabled. Capturing %d frames...', TOTAL_FRAMES);

  const startWall = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    // Advance game one frame
    await page.evaluate('window.__step()');

    // Yield to browser event loop so network requests (scene JSONs) can complete
    await page.evaluate('new Promise(function(r){setTimeout(r,0)})');

    // Capture the frame
    const p = path.join(FRAMES_DIR, `frame_${String(i).padStart(5, '0')}.png`);
    await page.screenshot({ path: p, type: 'png', omitBackground: false });

    // Progress
    if ((i + 1) % (FPS * 5) === 0) {
      const pct = Math.round(((i + 1) / TOTAL_FRAMES) * 100);
      const elapsed = ((Date.now() - startWall) / 1000).toFixed(0);
      console.log('[capture] %d%% — frame %d/%d (%ss elapsed)', pct, i + 1, TOTAL_FRAMES, elapsed);
    }
  }

  const totalSec = ((Date.now() - startWall) / 1000).toFixed(0);
  console.log('[capture] All frames captured in %ss', totalSec);
  await browser.close();

  // ── Encode MP4 with FFmpeg ──
  console.log('[capture] Encoding MP4...');
  try {
    execSync([
      'ffmpeg', '-y',
      '-framerate', String(FPS),
      '-i', `"${path.join(FRAMES_DIR, 'frame_%05d.png')}"`,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      `"${OUTPUT_MP4}"`,
    ].join(' '), { stdio: 'inherit' });
  } catch (err) {
    console.error('[capture] FFmpeg failed');
    process.exit(1);
  }

  // Cleanup frames
  cleanDir(FRAMES_DIR);
  fs.rmdirSync(FRAMES_DIR);

  const sizeMB = (fs.statSync(OUTPUT_MP4).size / 1e6).toFixed(1);
  console.log('\n[capture] Done! %s (%s MB)', OUTPUT_MP4, sizeMB);
})();

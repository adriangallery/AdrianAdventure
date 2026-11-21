// F3.2a (plan FUNTICO_ADVENTURE): genera src/funtico/campaign/states.json, los estados iniciales canónicos de los
// expedientes: el 1 empieza de cero; el 2, con el estado que deja la ruta crítica (qa/walkthrough.json, `ruta-critica`
// hasta `chapter:1`) al cerrar el capítulo 1 (flags, inventario, escena, posición…; sin reloj ni marcas de esta
// partida: ver src/funtico/campaign/canonical.js). Juega la ruta en el build funtico con la API de QA.
//
// Uso (por turno-pesado):
//   npx vite build --mode funtico && cp -r assets dist-funtico/
//   npx vite preview --mode funtico --outDir dist-funtico --host 127.0.0.1 --port 4175 --strictPort &
//   BASE_URL=http://127.0.0.1:4175 node scripts/funtico/build-campaign-states.mjs [--check]
// Sin --check escribe el JSON; con --check sale con 1 si el versionado no cuadra con lo generado (el e2e
// scripts/funtico/campaign-e2e.mjs hace la misma comprobación en el CI, job funtico-campaign).
import { launchBrowser } from '../lib/browser.mjs';
import { chapter1Route, playChapter1, snapshotForStates } from './lib/campaign-route.mjs';
import { diffStates, statesFromSnapshot, writeStates, STATES_PATH } from './lib/campaign-states.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const CHECK = process.argv.includes('--check');

const browser = await launchBrowser({
  engine: 'chromium',
  puppeteerOpts: { headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] },
});
let rc = 1;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await page.goto(`${BASE}/campaign.html?chapter=1&qa=1&mock=1`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const problems = [];
  await playChapter1(page, chapter1Route(), problems, []);
  if (problems.length) throw new Error(problems.join('\n'));
  await page.waitForFunction(() => window.__funtico?.campaign?.state === 'result', { timeout: 60_000, polling: 250 });
  const generated = statesFromSnapshot(await snapshotForStates(page));
  if (CHECK) {
    const d = diffStates(generated);
    if (d) console.error(`FALLO: ${d}. Regenera con: node scripts/funtico/build-campaign-states.mjs`);
    else console.log(`OK: ${STATES_PATH} al día`);
    rc = d ? 1 : 0;
  } else {
    writeStates(generated);
    console.log(`escrito ${STATES_PATH} (capítulo 2 en «${generated.chapters[2].currentScene}»)`);
    rc = 0;
  }
} catch (err) {
  console.error(`FALLO: ${err.message ?? err}`);
} finally {
  await browser.close();
}
process.exit(rc);

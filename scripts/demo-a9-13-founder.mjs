// Demo de A9.13 (Founder Mode con datos REALES del Diamond): el Golden ZERO Token en el Mining Rig de upstairs.
//  1) vertical 390×844, red REAL (sin cartera, sin mock): sale el panel FOUNDER MODE con totalSupply/maxSupply/
//     totalBurned/totalStaked del $ZERO Diamond y totalSupply de AdrianZERO, leídos de Base en vivo (GIF);
//  2) apaisado 844×390 (captura): cabe, fuentes ≥ 11 px;
//  3) red caída (`__qa.mockWeb3({ fail: true })`): todas las cifras «—» y el aviso BASE UNREACHABLE; nunca un número
//     inventado. El juego sigue al cerrar.
// Falla si el panel no sale, si sale alguna cifra vieja (847 / 12,459 / 403) o si con red caída enseña un número.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-13-founder
import { startDemo } from './lib/demo.mjs';

const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

const demo = await startDemo(import.meta.url, { fps: 4, width: 390, viewport: PORTRAIT });
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

/** Lanza una acción de QA sin esperarla; devuelve una función que filma (si `film`) hasta que termine. */
async function launch(expr) {
  await page.evaluate(`(() => {
    window.__demoDone = false; window.__demoErr = null;
    Promise.resolve(${expr}).catch((e) => { window.__demoErr = String(e && e.message || e); })
      .finally(() => { window.__demoDone = true; });
  })()`);
}
async function waitDone(label, { film = true, max = 60000 } = {}) {
  const end = Date.now() + max;
  while (Date.now() < end && !(await page.evaluate(() => window.__demoDone))) {
    if (film) await demo.shot(); else await demo.sleep(200);
  }
  const err = await page.evaluate(() => window.__demoErr);
  check(!err, `${label}${err ? `: ${err}` : ''}`);
}

/** Espera al panel cargado (o null si no sale en `ms`) y mide lo que se ve. */
const panelInfo = (ms, film) => (async () => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const info = await page.evaluate(() => {
      const ov = document.getElementById('rigdash-overlay');
      if (!ov) return null;
      const qa = window.__qa.state().dashboard;
      if (qa.phase === 'loading') return { loading: true };
      const term = document.getElementById('rigdash-term').getBoundingClientRect();
      const close = document.getElementById('rigdash-close').getBoundingClientRect();
      const link = document.getElementById('rigdash-link');
      const lr = link.getBoundingClientRect();
      let minFont = 99;
      for (const el of ov.querySelectorAll('*')) {
        if (!el.textContent?.trim() || el.children.length) continue;
        minFont = Math.min(minFont, parseFloat(getComputedStyle(el).fontSize));
      }
      return {
        text: ov.textContent, rows: qa.rows, tip: qa.tip, minFont,
        fits: term.left >= 0 && term.top >= 0 && term.right <= innerWidth && term.bottom <= innerHeight,
        close: { w: close.width, h: close.height }, link: { h: lr.height, rel: link.rel, target: link.target, href: link.href },
      };
    });
    if (info && !info.loading) return info;
    if (film) await demo.shot(); else await demo.sleep(150);
  }
  return null;
})();


const OLD = /847|12,459|403 days/;

// ─── 1) Vertical, red real ──────────────────────────────────────────────────────────────────────────────────────────
await demo.openScene('upstairs');
await demo.settle({ tap: [195, 60] });
await demo.film(1000);
await page.evaluate(() => { window.__qa.mockWeb3('off'); window.__qa.holdDashboard(4500); });
await page.evaluate(() => window.__qa.runScript([{ op: 'addItem', id: 'golden_token', name: 'Golden ZERO Token' }]));
await launch(`window.__qa.use('golden_token', 'hs_computer')`);
const v = await panelInfo(40000, true);
if (!v) await demo.fail('✖ el panel de Founder Mode no apareció');
await demo.still('01-founder-vertical');
await demo.film(1500);
console.log(`founder vertical: ${JSON.stringify(v)}`);
check(/FOUNDER MODE/.test(v.text), 'el panel es el de Founder Mode');
check(!OLD.test(v.text), 'sin las cifras inventadas de antes');
check(v.rows.some((r) => /^\$ZERO supply: [\d,]+$/.test(r)), 'totalSupply de $ZERO real de Base');
check(v.rows.some((r) => /^AdrianZERO minted: [\d,]+$/.test(r)), 'totalSupply de AdrianZERO real de Base');
check(!/simulated/.test(v.text), 'no son cifras simuladas');
check(v.fits, 'vertical: la terminal cabe en pantalla');
check(v.minFont >= 11, `vertical: fuentes ≥ 11 px (mínima ${v.minFont})`);
await waitDone('Golden Token en el rig (la API cierra el panel con su X)');
await demo.film(1500);
let st = await page.evaluate(() => window.__qa.state());
check(st.flags.founder_mode === true && !st.dashboard.open, 'founder_mode puesto, panel cerrado y el juego sigue');

// ─── 2) Apaisado (captura) ──────────────────────────────────────────────────────────────────────────────────────────
await page.setViewport(LANDSCAPE);
await demo.sleep(1500);
await launch(`window.__qa.runScript([{ op: 'showDashboard', mode: 'founder' }])`);
const h = await panelInfo(40000, false);
if (!h) await demo.fail('✖ el panel no apareció en apaisado');
await demo.still('02-founder-apaisado');
check(h.fits, 'apaisado: la terminal cabe en pantalla');
check(h.minFont >= 11, `apaisado: fuentes ≥ 11 px (mínima ${h.minFont})`);
await waitDone('Founder Mode en apaisado', { film: false });

// ─── 3) Red caída ───────────────────────────────────────────────────────────────────────────────────────────────────
await page.setViewport(PORTRAIT);
await demo.sleep(1500);
await page.evaluate(() => window.__qa.mockWeb3({ fail: true }));
await launch(`window.__qa.runScript([{ op: 'showDashboard', mode: 'founder' }])`);
const f = await panelInfo(40000, true);
if (!f) await demo.fail('✖ el panel no apareció con la red caída');
await demo.still('03-founder-sin-red');
console.log(`founder sin red: ${JSON.stringify(f.rows)}`);
check(f.rows.filter((r) => !r.startsWith('SOURCE')).every((r) => / —$/.test(r)), 'sin red: todas las cifras son «—»');
check(/BASE UNREACHABLE/.test(f.text), 'sin red: lo dice');
await waitDone('Founder Mode sin red');
await page.evaluate(() => window.__qa.mockWeb3('off'));
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

// Demo de A3.10 (las recompensas web3 hacen algo): el Mining Rig de upstairs con web3 SIMULADO (__qa.mockWeb3, solo
// ?qa=1, sin red):
//  1) holder (5000 $ZERO, dos AdrianZERO, un trait) en vertical 390×844: USE rig → sale el dashboard con el saldo, los
//     tokens y la nota del sysadmin (PIN del Ledger); al cerrarlo, logro TraitLab Insider y rig_dashboard_seen;
//  2) el mismo panel en apaisado 844×390 (captura fija): cabe en pantalla, fuentes ≥ 11 px, X ≥ 40 px;
//  3) sin cartera (mockWeb3(null)) en vertical: USE rig → la frase del else, sin panel, y el juego sigue.
// Falla si el panel no aparece, no lleva el saldo simulado o sale sin cartera.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-10-web3
import { startDemo } from './lib/demo.mjs';

const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const HOLDER = { zero: '5000', adrianZero: [7, { id: 12, name: 'ZERO Twelve' }], lab: [{ id: 1001, name: 'Lab Coat' }] };

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

// ─── 1) Holder en vertical ──────────────────────────────────────────────────────────────────────────────────────────
await demo.openScene('upstairs');
await demo.settle({ tap: [195, 60] });
await demo.film(1000);
await page.evaluate((h) => { window.__qa.mockWeb3(h); window.__qa.holdDashboard(3500); }, HOLDER);
await launch(`window.__qa.act('USE', 'hs_computer')`);
const v = await panelInfo(40000, true);
if (!v) await demo.fail('✖ el dashboard no apareció con el holder simulado');
await demo.still('01-panel-vertical');
await demo.film(1500);
console.log(`panel vertical: ${JSON.stringify(v)}`);
check(/5,000/.test(v.text), 'el panel enseña el saldo simulado (5,000 $ZERO)');
check(v.rows.some((r) => r === 'AdrianZERO: 2') && /ZERO Twelve/.test(v.text) && /Lab Coat/.test(v.text), 'el panel enseña los AdrianZERO y el trait');
check(/0301/.test(v.tip ?? ''), 'el panel lleva la nota del sysadmin (PIN del Ledger)');
check(v.fits, 'vertical: la terminal cabe en pantalla');
check(v.minFont >= 11, `vertical: fuentes ≥ 11 px (mínima ${v.minFont})`);
check(v.close.w >= 40 && v.close.h >= 40 && v.link.h >= 40, `vertical: X ${v.close.w}×${v.close.h} y enlace ${v.link.h} px de alto (≥ 40)`);
check(v.link.target === '_blank' && /noopener/.test(v.link.rel) && v.link.href.startsWith('https://adrianzero.com'), 'enlace a TraitLab en pestaña nueva con noopener');
await waitDone('USE rig con holder (la API cierra el panel con su X)');
await demo.film(1500);
let st = await page.evaluate(() => window.__qa.state());
check(st.flags.rig_dashboard_seen === true && st.achievements.includes('holder_rig'), 'al cerrarlo: rig_dashboard_seen y logro TraitLab Insider');
check(!st.dashboard.open, 'el panel se cerró y el juego sigue');

// ─── 2) Apaisado: el mismo panel (captura fija; el GIF sigue en vertical) ────────────────────────────────────────────
await page.setViewport(LANDSCAPE);
await demo.sleep(1500);
await launch(`window.__qa.act('USE', 'hs_computer')`);
const h = await panelInfo(40000, false);
if (!h) await demo.fail('✖ el dashboard no apareció en apaisado');
await demo.still('02-panel-apaisado');
console.log(`panel apaisado: ${JSON.stringify(h)}`);
check(/5,000/.test(h.text), 'apaisado: el panel enseña el saldo');
check(h.fits, 'apaisado: la terminal cabe en pantalla');
check(h.minFont >= 11, `apaisado: fuentes ≥ 11 px (mínima ${h.minFont})`);
check(h.close.w >= 40 && h.close.h >= 40, 'apaisado: X ≥ 40 px');
await waitDone('USE rig otra vez (apaisado)', { film: false });

// ─── 3) Sin cartera en vertical ─────────────────────────────────────────────────────────────────────────────────────
await page.setViewport(PORTRAIT);
await demo.sleep(1500);
await page.evaluate(() => {
  window.__qa.mockWeb3(null);
  window.__sawPanel = false;
  window.__obs = new MutationObserver(() => { if (document.getElementById('rigdash-overlay')) window.__sawPanel = true; });
  window.__obs.observe(document.body, { childList: true });
});
const before = await page.evaluate(() => window.__qa.state().logTotal);
await launch(`window.__qa.act('USE', 'hs_computer', [], 2500)`);
await waitDone('USE rig sin cartera');
await demo.still('03-sin-cartera');
const after = await page.evaluate(() => ({ saw: window.__sawPanel, st: window.__qa.state() }));
const newLines = after.st.log.slice(-Math.min(after.st.log.length, after.st.logTotal - before));
check(!after.saw, 'sin cartera no sale el panel');
check(newLines.some((l) => /Needs 1000 \$ZERO/.test(l)), 'sin cartera: la frase del else');
await demo.film(1000);
await page.evaluate(() => window.__qa.mockWeb3('off'));
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

// Demo de A1.12 (regla visual): el panel de guardar/cargar en móvil 390×844. Guardar en un slot vacío, sobrescribir
// con confirmación, pestaña LOAD con confirmación (tocar no carga), guardado de seguridad «Before load» y error de la
// nube (500) visible. Nube simulada en memoria y wallet de QA: nunca toca el save-server real.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a1-12-save
import { startDemo } from './lib/demo.mjs';
import * as SP from './lib/save-panel.mjs';

const demo = await startDemo(import.meta.url, {
  fps: 4, width: 390, viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
});
const { page } = demo;
const hold = async (n = 6) => { for (let i = 0; i < n; i++) { await demo.shot(); await demo.sleep(120); } };
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } };

await SP.installCloudMock(page);
await SP.openGame(page, demo.base);
await demo.settle({ tap: [195, 60], tries: 25 });

// 1) Guardar en slot vacío
await SP.mark(page, 'demo_first');
await SP.openPanel(page);
await hold(6);
await demo.still('01-save-tab');
await SP.tapSlot(page, 1);
let st = await SP.waitStatus(page);
check(st.kind === 'ok', `guardar en vacío: ${JSON.stringify(st)}`);
await hold(8);
await demo.still('02-saved');

// 2) Sobrescribir con confirmación
await SP.mark(page, 'demo_second', 'demo_item');
await SP.tapSlot(page, 1);
await hold(8);
await demo.still('03-overwrite-confirm');
check(/Overwrite Slot 1\?/.test(await SP.confirmText(page) ?? ''), 'no pidió confirmar la sobrescritura');
await SP.confirm(page, true);
st = await SP.waitStatus(page);
check(st.kind === 'ok', `sobrescribir: ${JSON.stringify(st)}`);
await hold(6);

// 3) Recargar, pestaña LOAD: tocar el slot solo pide confirmación con escena y fecha
await SP.openGame(page, demo.base);
await demo.settle({ tap: [195, 60], tries: 25 });
await SP.openPanel(page);
await SP.tab(page, 'load');
await hold(6);
await demo.still('04-load-tab');
const fresh = await SP.gameSnap(page);
await SP.tapSlot(page, 1);
await hold(10);
await demo.still('05-load-confirm');
check(JSON.stringify(await SP.gameSnap(page)) === JSON.stringify(fresh), 'tocar el slot cargó sin confirmar');
await SP.confirm(page, true);
await page.waitForFunction(() => window.__game.registry.get('gameState')?.flags?.demo_second === true, { timeout: 60000, polling: 300 });
await demo.sleep(1500);
await SP.waitInGame(page, 'outside');
await demo.settle({ tap: [195, 60], tries: 25 });

// 4) El guardado de seguridad «Before load» aparece en LOAD
await SP.openPanel(page);
await SP.tab(page, 'load');
await hold(10);
await demo.still('06-before-load');
check(!/Empty/.test(await SP.slotText(page, 3) ?? 'Empty'), 'no aparece «Before load»');

// 5) Con wallet: la nube falla con 500 → error visible y botón de reintento
await SP.closePanel(page);
await page.evaluate((a) => window.__qa.fakeWallet(a, true), SP.QA_ADDR);
await SP.openPanel(page);
await SP.failNextCloudSave(page, 2, 500);
await SP.tapSlot(page, 2);
st = await SP.waitStatus(page);
check(st.kind === 'error' && /500/.test(st.text), `500 sin error visible: ${JSON.stringify(st)}`);
await hold(12);
await demo.still('07-cloud-error');
await SP.panelAction(page, 'retry');
st = await SP.waitStatus(page);
check(st.kind === 'ok', `reintento: ${JSON.stringify(st)}`);
await hold(10);
await demo.still('08-cloud-ok');
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

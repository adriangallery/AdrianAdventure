// Demo de A1.13 (regla visual): «Continue» carga la partida más reciente CON PROGRESO, en móvil 390×844. Con las
// partidas de Adrián (11-nov) en localStorage —slot 2 con 2 flags, slot 1 con 5 flags y 2 objetos, y un autoguardado
// VACÍO más nuevo— el menú enseña el detalle de la partida que de verdad se carga, el toque en «Continue» lleva a ella
// y el inventario tiene los 2 objetos. Sin wallet ni red.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a1-13-continue
import { startDemo } from './lib/demo.mjs';
import * as SP from './lib/save-panel.mjs';

const demo = await startDemo(import.meta.url, {
  fps: 4, width: 390, viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
});
const { page } = demo;
const hold = async (n = 6) => { for (let i = 0; i < n; i++) { await demo.shot(); await demo.sleep(120); } };
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } };
const A = SP.ADRIAN_A113;

// 1) Menú con las partidas de Adrián: «Continue» y debajo la partida que se va a cargar (la del slot 1)
await SP.openMenuWith(page, demo.base, { adrian_adventure_save: A.slots, [A.walletKey]: A.wallet });
await demo.sleep(800);
await hold(10);
await demo.still('01-menu-continue');
const pick = await page.evaluate(() => window.__continuePick);
check(pick?.source === 'slot' && pick.slotId === 1, `Continue no elige el slot 1: ${JSON.stringify(pick)}`);
check(/^Outside · /.test(await SP.menuText(page, 'continue-detail') ?? ''), 'sin detalle bajo «Continue»');

// 2) Toque en «Continue» → la escena con la partida del slot 1
await SP.tapMenuButton(page, 'Continue');
await hold(6);
await SP.waitInGame(page, 'outside');
await demo.settle({ tap: [195, 60], tries: 25 });
await hold(8);
const qs = await page.evaluate(() => window.__qa.state());
for (const it of A.slot1Items) check(qs.inventory.includes(it), `falta ${it}: ${JSON.stringify(qs.inventory)}`);
for (const f of A.slot1Flags) check(qs.flags[f] === true, `falta la flag ${f}`);

// 3) Inventario abierto con los 2 objetos
await page.evaluate(() => window.__game.scene.getScene('UIScene')?.events.emit('inventory:open')).catch(() => {});
await hold(10);
await demo.still('02-inventory');
const s0 = await SP.localSlot(page, 0);
check(Object.values(s0?.state?.flags ?? {}).filter(Boolean).length >= 5, 'el autoguardado sigue vacío tras continuar');
await demo.end();

console.log(`${demo.frames} frames · ${problems.length ? problems.join(' | ') : 'todo OK'}`);
if (problems.length) process.exit(1);

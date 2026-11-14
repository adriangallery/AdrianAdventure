// Demo del arte pendiente N1/N2/P1 (regla visual): capturas fijas en 844x390 (móvil apaisado) de
//   1) lobby: Penny de cuerpo entero detrás del mostrador (el primer plano le tapa de las caderas abajo);
//   2) recovery_pool: Chad con su sprite propio en el flotador, encima del mono pintado;
//   3) treatment_room: Dex sentado en el sillón con la flag patient_seated (y la escena sigue con hidePlayer).
// Comprueba que Penny usa la hoja de 26×103, que npc_chad existe con su hoja de 48×44 y que Dex sentado se ve solo
// con la flag puesta (la flag se pone a mano en gameState para la captura: el puzle no cambia).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run arte-npc
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 4 });
const { page } = demo;
const problems = [];

const npcInfo = (id) => page.evaluate((id) => {
  const gs = window.__game.scene.getScene('GameScene');
  const n = (gs.npcs ?? []).find((x) => x.npcId === id);
  if (!n) return null;
  return { w: n.npcBody?.width ?? 0, h: n.npcBody?.height ?? 0, visible: n.visible, y: n.pctPosition?.y };
}, id);

// 1) lobby
await demo.openScene('lobby');
if (!(await demo.settle())) await demo.fail('El lobby no quedó libre');
await demo.still('penny-lobby');
await demo.shot();
const penny = await npcInfo('npc_receptionist');
if (!penny || penny.w !== 26 || penny.h !== 103) problems.push(`Penny: hoja ${penny?.w}×${penny?.h} (se esperaba 26×103)`);

// 2) recovery_pool
await demo.openScene('recovery_pool');
if (!(await demo.settle())) await demo.fail('recovery_pool no quedó libre');
await demo.still('chad-pool');
await demo.shot();
const chad = await npcInfo('npc_chad');
if (!chad || chad.w !== 48 || chad.h !== 44 || !chad.visible) problems.push(`Chad: ${JSON.stringify(chad)} (se esperaba hoja 48×44 visible)`);

// 3) treatment_room
await demo.openScene('treatment_room');
if (!(await demo.settle())) await demo.fail('treatment_room no quedó libre');
const before = await page.evaluate(() => window.__game.scene.getScene('GameScene').seatedDex?.img.visible ?? null);
await demo.still('dex-sin-sentar');
await page.evaluate(() => { window.__game.scene.getScene('GameScene').gameState.flags.patient_seated = true; });
await demo.sleep(400);
const after = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene');
  return { seated: gs.seatedDex?.img.visible ?? null, key: gs.seatedDex?.img.texture.key ?? null, player: gs.player.visible };
});
await demo.still('dex-sentado');
await demo.shot();
if (before !== false) problems.push(`Dex sentado visible sin la flag (${before})`);
if (!after.seated || after.key !== 'dex2d_sit_0') problems.push(`Dex sentado no se ve con patient_seated: ${JSON.stringify(after)}`);
if (after.player) problems.push('el jugador de pie se ve en treatment_room (hidePlayer)');

await demo.end();
console.log(`penny ${JSON.stringify(penny)} · chad ${JSON.stringify(chad)} · sentado ${JSON.stringify(after)} · problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) process.exit(1);

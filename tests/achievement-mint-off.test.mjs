// A9.24 (plan SCUMM): el mint on-chain de logros está APAGADO hasta que Adrián confirme faceta e ids (20001…).
// Con el interruptor en false nadie debe pedir firma: ni el botón del panel de logros (sale «SOON») ni el opcode
// `mintAchievement` de las escenas. contracts.ts y BadgePanel.ts importan viem/Phaser, así que la prueba lee el
// código fuente (sin node_modules). node --test tests/achievement-mint-off.test.mjs (en `npm run test:lint`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const CONTRACTS = read('src/web3/contracts.ts');
const PANEL = read('src/ui/BadgePanel.ts');

/** Cuerpo de la función `name` (desde su firma hasta la siguiente declaración de primer nivel). */
function body(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `no encuentro «${signature}»`);
  const rest = src.slice(start + signature.length);
  const next = rest.search(/\n(?:export |\/\/ ───|\/\*\*|  private |  [a-z]\w*\(\)[^\n]*\{\n)/);
  return next < 0 ? rest : rest.slice(0, next);
}

test('el interruptor ACHIEVEMENT_MINT_ENABLED existe en contracts.ts y está en false', () => {
  const m = CONTRACTS.match(/export const ACHIEVEMENT_MINT_ENABLED(?:: boolean)? = (\w+);/);
  assert.ok(m, 'falta `export const ACHIEVEMENT_MINT_ENABLED = …` en src/web3/contracts.ts');
  assert.equal(m[1], 'false', 'el mint de logros solo se enciende cuando Adrián confirme faceta e ids (docs/progreso/A9.24.md); actualiza también este test');
});

test('mintAchievement() sale antes de tocar la cartera o purchaseItems si el interruptor está apagado', () => {
  const fn = body(CONTRACTS, 'export async function mintAchievement(');
  const guard = fn.search(/if \(!ACHIEVEMENT_MINT_ENABLED\) \{\s*return \{ status: 'not-configured'/);
  assert.ok(guard >= 0, 'mintAchievement() debe empezar devolviendo not-configured si !ACHIEVEMENT_MINT_ENABLED');
  for (const sink of ['getWalletState', 'writeContract', 'purchaseItems', 'waitForTransactionReceipt']) {
    const at = fn.indexOf(sink);
    assert.ok(at < 0 || at > guard, `${sink} aparece antes de la guarda del interruptor`);
  }
  // Es lo primero que hace la función: nada antes de la guarda salvo la llave de apertura.
  assert.match(fn.slice(0, guard), /^[^;]*\{\s*$/, 'hay código antes de la guarda del interruptor');
});

test('el panel de logros consulta el interruptor: «SOON» sin llamar a mintBadge ni a la cartera', () => {
  assert.match(PANEL, /import \{[^}]*\bACHIEVEMENT_MINT_ENABLED\b[^}]*\} from '@\/web3\/contracts'/);
  // La rama apagada pinta «SOON» y su pointerdown no llama a mintBadge / mintAchievement / getWalletState.
  const off = PANEL.indexOf('if (isEarned && !ACHIEVEMENT_MINT_ENABLED) {');
  const on = PANEL.indexOf('} else if (isEarned) {', off);
  assert.ok(off >= 0 && on > off, 'falta la rama «SOON» (isEarned && !ACHIEVEMENT_MINT_ENABLED) antes de la del MINT');
  const soonBranch = PANEL.slice(off, on);
  assert.match(soonBranch, /'SOON'/);
  for (const sink of ['mintBadge', 'mintAchievement', 'getWalletState', 'hasLabToken', 'window.open']) {
    assert.ok(!soonBranch.includes(sink), `la rama «SOON» no debe llamar a ${sink}`);
  }
  // Y mintBadge tiene su propia guarda por si alguien la llama desde otro sitio.
  const mb = body(PANEL, 'private async mintBadge(');
  const guard = mb.indexOf('if (!ACHIEVEMENT_MINT_ENABLED)');
  assert.ok(guard >= 0, 'mintBadge() debe consultar ACHIEVEMENT_MINT_ENABLED');
  for (const sink of ['getWalletState', 'hasLabToken', 'mintAchievement(']) {
    assert.ok(mb.indexOf(sink) > guard, `${sink} aparece antes de la guarda en mintBadge()`);
  }
});

test('el aviso que ve el jugador es corto y en inglés', () => {
  const m = CONTRACTS.match(/export const ACHIEVEMENT_MINT_SOON_TEXT = '([^']+)';/);
  assert.ok(m, 'falta ACHIEVEMENT_MINT_SOON_TEXT');
  assert.ok(m[1].length <= 60, `aviso demasiado largo (${m[1].length})`);
  assert.match(m[1], /coming soon/i);
});

// A9.17b: selección de demos por nombre (DEMOS del workflow) y distinción local/producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isLocalBaseUrl, pickDemos, demoKey } from '../scripts/lib/demo-pick.mjs';

test('isLocalBaseUrl: localhost y 127.0.0.1 son locales; lo desplegado no', () => {
  assert.equal(isLocalBaseUrl('http://127.0.0.1:4173'), true);
  assert.equal(isLocalBaseUrl('http://localhost:3000/'), true);
  assert.equal(isLocalBaseUrl('http://[::1]:4173'), true);
  assert.equal(isLocalBaseUrl('https://adventure.adrianzero.com'), false);
  assert.equal(isLocalBaseUrl('https://adventure.adrianzero.com/'), false);
  assert.equal(isLocalBaseUrl('https://127.0.0.1.evil.com'), false);
  assert.equal(isLocalBaseUrl('basura'), false);
});

test('demoKey acepta nombre, demo-nombre, .mjs y ruta', () => {
  for (const r of ['hold', 'demo-hold', 'demo-hold.mjs', 'scripts/demo-hold.mjs']) assert.equal(demoKey(r), 'hold');
});

test('pickDemos separa existentes y desconocidas sin repetir', () => {
  const existing = ['demo-hold.mjs', 'demo-a9-17-stats.mjs', 'scripts/demo-a4-8-volumen.mjs'];
  assert.deepEqual(pickDemos(['a9-17-stats', 'nope', 'hold', 'demo-hold', 'nope', ''], existing), {
    found: ['scripts/demo-a9-17-stats.mjs', 'scripts/demo-hold.mjs'],
    missing: ['nope'],
  });
  assert.deepEqual(pickDemos([], existing), { found: [], missing: [] });
  assert.deepEqual(pickDemos(['x', 'y'], existing), { found: [], missing: ['x', 'y'] });
});

test('CLI: avisa de las que no existen, sigue con las demás y solo falla si no queda ninguna', () => {
  const cli = (args) => spawnSync(process.execPath, ['scripts/lib/demo-pick.mjs', ...args], { encoding: 'utf8' });
  const some = cli(['a9-17-stats no-existe-xyz']);
  assert.equal(some.status, 0);
  assert.equal(some.stdout.trim(), 'scripts/demo-a9-17-stats.mjs');
  assert.match(some.stderr, /::warning::.*no-existe-xyz/);
  const none = cli(['no-existe-xyz', 'tampoco-xyz']);
  assert.equal(none.status, 1);
  assert.equal(none.stdout.trim(), '');
  assert.match(none.stderr, /::error::/);
});

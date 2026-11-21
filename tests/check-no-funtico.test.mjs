// F0.1 (plan FUNTICO_ADVENTURE): prueba del propio scripts/check-no-funtico.mjs con directorios temporales (caso
// limpio y caso sucio). node --test tests/check-no-funtico.test.mjs (en `npm run test:lint`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-no-funtico.mjs');
const run = (dir) => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-no-ft-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('directorio limpio: rc 0 (los .map y los binarios no cuentan)', (t) => {
  const dir = fixture({
    'index.html': '<!doctype html><title>ZEROadventure</title>',
    'assets/main-abc.js': 'const a=!1;console.log(a)',
    'assets/main-abc.js.map': '{"sourcesContent":["export const IS_FUNTICO = false"]}',
    'assets/sprite.png': 'Funtico (binario, no se mira)',
    'version.txt': 'm1abc\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /limpio \(3 archivos/);
});

test('directorio sucio: rc 1 con archivo, línea y contexto, sin distinguir mayúsculas', (t) => {
  const dir = fixture({
    'index.html': '<!doctype html>\n<title>ZEROadventure</title>',
    'assets/main-abc.js': 'var x=1;\nconst t="ZEROadventure · FUNTICO";',
    'stats/data.json': '{"a":"funtico"}',
    'assets/style.css': '.ok{color:red}',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /2 coincidencia/);
  assert.match(r.stderr, /assets[\\/]main-abc\.js:2: .*ZEROadventure · FUNTICO/);
  assert.match(r.stderr, /stats[\\/]data\.json:1: .*"funtico"/);
  assert.doesNotMatch(r.stderr, /index\.html|style\.css/);
});

test('directorio que no existe o vacío: rc 2', (t) => {
  const dir = fixture({ 'img.png': 'x' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(path.join(dir, 'no-existe')).status, 2);
  assert.equal(run(dir).status, 2);
});

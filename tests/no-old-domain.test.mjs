// A9.18 (plan SCUMM): el juego no nombra zerothetoken.com en src/ (ni código ni comentarios). Movistar bloquea ese
// dominio los días de LaLiga: el cliente habla con el save-server por el proxy de mismo origen /save-api
// (src/config/saveApi.ts). node --test tests/no-old-domain.test.mjs (en `npm run test:lint`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OLD = ['zero', 'the', 'token'].join(''); // troceado: este archivo no está en src/, pero así no se busca a sí mismo

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

test(`ningún archivo de src/ contiene «${OLD}» (sin distinguir mayúsculas)`, () => {
  const hits = [];
  let files = 0;
  for (const file of walk(path.join(ROOT, 'src'))) {
    files++;
    const lines = readFileSync(file, 'latin1').split('\n');
    lines.forEach((line, i) => { if (line.toLowerCase().includes(OLD)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`); });
  }
  assert.ok(files > 50, `src/ casi vacío (${files} archivos): ¿ruta mal?`);
  assert.deepEqual(hits, [], `usa SAVE_API (src/config/saveApi.ts), no el dominio viejo:\n${hits.join('\n')}`);
});

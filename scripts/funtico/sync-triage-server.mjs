#!/usr/bin/env node
// F2.2 (plan FUNTICO_ADVENTURE): copia byte a byte la lógica pura de Triage al save-server. El save-server se despliega
// con build dir `save-server` (herokuish): en su imagen no entra `src/`, así que lleva su propia copia.
//
//   node scripts/funtico/sync-triage-server.mjs          copia src/funtico/triage/{rng.js,triage.js,catalog.json}
//                                                        → save-server/funtico-triage/
//   node scripts/funtico/sync-triage-server.mjs --check  no escribe; rc 1 si alguna copia falta o difiere
//
// La fuente de verdad es src/funtico/triage/. Tras tocarla (o regenerar el catálogo) hay que correr esto y commitear:
// si no, falla tests/funtico-triage-server.test.mjs («copia del save-server idéntica»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_DIR = 'src/funtico/triage';
export const SERVER_DIR = 'save-server/funtico-triage';
export const FILES = Object.freeze(['rng.js', 'triage.js', 'catalog.json']);

/** → [{ file, ok, reason? }] comparando bytes. */
export function compareCopies(root = ROOT) {
  return FILES.map((file) => {
    const src = path.join(root, SOURCE_DIR, file);
    const dst = path.join(root, SERVER_DIR, file);
    if (!fs.existsSync(dst)) return { file, ok: false, reason: 'falta la copia' };
    return fs.readFileSync(src).equals(fs.readFileSync(dst)) ? { file, ok: true } : { file, ok: false, reason: 'difiere' };
  });
}

export function syncCopies(root = ROOT) {
  fs.mkdirSync(path.join(root, SERVER_DIR), { recursive: true });
  for (const file of FILES) fs.copyFileSync(path.join(root, SOURCE_DIR, file), path.join(root, SERVER_DIR, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = compareCopies().filter((r) => !r.ok);
    for (const r of bad) console.error(`${SERVER_DIR}/${r.file}: ${r.reason} (corre node scripts/funtico/sync-triage-server.mjs)`);
    if (bad.length) process.exit(1);
    console.log(`${SERVER_DIR}: al día (${FILES.length} archivos)`);
  } else {
    syncCopies();
    console.log(`${SERVER_DIR}: copiados ${FILES.join(', ')}`);
  }
}

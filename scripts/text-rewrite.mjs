#!/usr/bin/env node
// A3.8 (plan SCUMM): aplica reescrituras de frases a un scene.json (o a fail-responses.json) sin reformatear el fichero.
//
//   node scripts/text-rewrite.mjs <escena|fail-responses> <mapa.json>
//
// <mapa.json> = [{ "old": "frase exacta", "new": "frase nueva" }, …]. Cambia TODAS las apariciones de la cadena JSON
// exacta "old" (p. ej. la misma frase en then/else). Avisa de las que no encuentra y comprueba que el JSON sigue siendo
// válido; si no lo es, no escribe nada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [target, mapFile] = process.argv.slice(2);
if (!target || !mapFile) { console.error('uso: text-rewrite.mjs <escena|fail-responses> <mapa.json>'); process.exit(2); }
const rel = target === 'fail-responses' ? 'assets/config/fail-responses.json' : `assets/scenes/${target}/scene.json`;
const file = path.join(ROOT, rel);
let body = fs.readFileSync(file, 'utf8');
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
let done = 0; const missing = [];
for (const { old, new: neu } of map) {
  if (typeof old !== 'string' || typeof neu !== 'string' || !neu.trim()) { missing.push(String(old)); continue; }
  const a = JSON.stringify(old); const b = JSON.stringify(neu);
  if (!body.includes(a)) { missing.push(old); continue; }
  body = body.split(a).join(b); done++;
}
JSON.parse(body);
fs.writeFileSync(file, body);
console.log(`${rel}: ${done} reescritas${missing.length ? `; NO encontradas (${missing.length}):` : ''}`);
for (const m of missing) console.log(`  - ${m}`);

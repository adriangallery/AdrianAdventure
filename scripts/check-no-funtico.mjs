#!/usr/bin/env node
// F0.1 (plan FUNTICO_ADVENTURE), condición dura: el build normal no lleva la cadena «funtico» (sin distinguir
// mayúsculas) en ningún archivo servido. Recorre el directorio (por defecto dist/) y mira .js, .html, .css, .json,
// .txt y .webmanifest; se saltan los *.map (llevan el código fuente de src/config/platform.ts) y los binarios.
// Uso: node scripts/check-no-funtico.mjs [dir]   (npm run check:no-funtico). rc 0 = limpio, 1 = hay coincidencias,
// 2 = el directorio no existe o no tiene ningún archivo que mirar.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const NEEDLE = 'funtico';
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.txt', '.webmanifest']);
const CONTEXT = 60;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const dir = path.resolve(process.argv[2] ?? 'dist');
let isDir = false;
try { isDir = statSync(dir).isDirectory(); } catch { /* no existe */ }
if (!isDir) {
  console.error(`check-no-funtico: no existe el directorio ${dir}`);
  process.exit(2);
}

let scanned = 0;
const hits = [];
for (const file of walk(dir)) {
  if (file.endsWith('.map') || !EXTS.has(path.extname(file).toLowerCase())) continue;
  scanned++;
  const text = readFileSync(file, 'utf8');
  const lower = text.toLowerCase();
  let at = lower.indexOf(NEEDLE);
  while (at >= 0) {
    const ctx = text.slice(Math.max(0, at - CONTEXT), at + NEEDLE.length + CONTEXT).replace(/\s+/g, ' ');
    const line = text.slice(0, at).split('\n').length;
    hits.push(`${path.relative(dir, file)}:${line}: …${ctx}…`);
    at = lower.indexOf(NEEDLE, at + NEEDLE.length);
  }
}

if (scanned === 0) {
  console.error(`check-no-funtico: ${dir} no tiene archivos servidos que mirar (¿falta el build?)`);
  process.exit(2);
}
if (hits.length) {
  console.error(`check-no-funtico: ${hits.length} coincidencia(s) de «${NEEDLE}» en ${dir}:`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check-no-funtico: limpio (${scanned} archivos mirados en ${dir})`);

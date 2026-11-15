// A9.17b (plan SCUMM): utilidades puras de las demos, separadas de scripts/lib/demo.mjs a propósito (si se toca
// demo.mjs, el job `demo` de una PR graba TODAS las demos).
//
//   isLocalBaseUrl(url)            ¿la demo corre contra un build local (localhost/127.0.0.1) o contra producción?
//   pickDemos(pedidas, existentes) separa los nombres de DEMOS (workflow_dispatch) en existentes y desconocidos.
//
// CLI (lo usa el paso «Elegir demos» de .github/workflows/build.yml):
//   node scripts/lib/demo-pick.mjs <nombre…>
//   → stdout: rutas de las demos que existen, separadas por espacios
//   → stderr: un aviso `::warning::` por cada nombre que no existe (el resto se graba igual)
//   → código 1 solo si se pidieron nombres y NINGUNO existe (no hay nada que grabar y era un error de tecleo).
import { readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** true si la URL apunta a esta máquina (build servido con `vite preview`); false si es una URL desplegada. */
export function isLocalBaseUrl(url) {
  let host;
  try { host = new URL(String(url)).hostname; } catch { return false; }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** `hold`, `demo-hold`, `demo-hold.mjs` o `scripts/demo-hold.mjs` → `hold` (igual que demoName de demo.mjs). */
export function demoKey(ref) {
  return basename(String(ref).trim()).replace(/\.mjs$/, '').replace(/^demo-/, '');
}

/**
 * Reparte los nombres pedidos entre los que existen (`found`, como `scripts/demo-<nombre>.mjs`, sin repetir y en el
 * orden pedido) y los que no (`missing`, tal cual se escribieron). `existing` son nombres o rutas de demos.
 */
export function pickDemos(requested, existing) {
  const known = new Set([...existing].map(demoKey));
  const found = [];
  const missing = [];
  for (const raw of requested) {
    const ref = String(raw).trim();
    if (!ref) continue;
    const key = demoKey(ref);
    if (!known.has(key)) { if (!missing.includes(ref)) missing.push(ref); continue; }
    const path = `scripts/demo-${key}.mjs`;
    if (!found.includes(path)) found.push(path);
  }
  return { found, missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const existing = readdirSync(scripts).filter((f) => /^demo-.+\.mjs$/.test(f));
  const requested = process.argv.slice(2).flatMap((a) => a.split(/\s+/)).filter(Boolean);
  const { found, missing } = pickDemos(requested, existing);
  for (const m of missing) console.error(`::warning::DEMOS: no existe la demo «${m}» (scripts/demo-${demoKey(m)}.mjs); se graban las demás`);
  console.log(found.join(' '));
  if (requested.length && !found.length) {
    console.error(`::error::DEMOS: ninguna de las demos pedidas existe (${missing.join(', ')})`);
    process.exit(1);
  }
}

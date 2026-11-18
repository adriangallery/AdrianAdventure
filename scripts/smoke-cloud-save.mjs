#!/usr/bin/env node
// A9.19: guardado FIRMADO de verdad en la nube de producción (el smoke normal usa una nube simulada).
// Con una cartera desechable (clave en el secreto SMOKE_WALLET_KEY, solo firma mensajes, nunca transacciones):
//   1. firma la sesión igual que el juego (`ZEROadventure-auth:<address en minúsculas>:<timestamp>`, ver
//      src/web3/wallet.ts y save-server/validate.js `sessionMessage`),
//   2. POST {BASE_URL}/save-api/save en un slot fijo, GET /save-api/save/<addr>/<slot> y compara,
//   3. DELETE /save-api/save/<addr>/<slot> (cabeceras X-Auth-*) y comprueba que el GET da 404,
//   4. comprueba que esa dirección no sale en /save-api/leaderboard (va truncada: 0x1234…abcd).
// La partida va marcada `state.smoke: true` (el save-server la excluye del leaderboard, A9.19) y no tiene progreso.
// Cualquier paso ≠ 2xx (o datos distintos) => sale con 1 diciendo ruta y código. Nunca imprime la clave ni la firma.
// Sin BASE_URL o sin SMOKE_WALLET_KEY => aviso ::warning:: y sale con 0 (en PR no corre contra producción).
// Uso: BASE_URL=https://adventure.adrianzero.com SMOKE_WALLET_KEY=… node scripts/smoke-cloud-save.mjs

import { privateKeyToAccount } from 'viem/accounts';

const SLOT = 2;
const TIMEOUT_MS = 20_000;

const warn = (msg) => console.log(`::warning::${msg}`);
const fail = (msg) => { console.log(`::error::A9.19 nube: ${msg}`); process.exitCode = 1; };

const baseUrl = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
const rawKey = (process.env.SMOKE_WALLET_KEY || '').trim();

if (!baseUrl) {
  warn('A9.19: sin BASE_URL no se prueba la nube real (solo corre contra un despliegue).');
  process.exit(0);
}
if (!rawKey) {
  warn('A9.19: falta el secreto SMOKE_WALLET_KEY; no se prueba el guardado firmado en la nube real.');
  process.exit(0);
}
const key = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  fail('SMOKE_WALLET_KEY no tiene forma de clave privada (32 bytes en hex).');
  process.exit(1);
}

const account = privateKeyToAccount(key);
const address = account.address.toLowerCase();
const api = `${baseUrl}/save-api`;
console.log(`A9.19: cartera de prueba ${address}, slot ${SLOT}, contra ${api}`);

/** fetch con tope de tiempo; devuelve { status, json } o { status: 0, error } si no hubo respuesta. */
async function call(method, path, { body, headers } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${api}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* no es JSON */ }
    // El error del servidor ({ error }) es texto suyo, sin secretos; se enseña para saber qué pasó
    return { status: resp.status, json, errText: json?.error ?? text.slice(0, 120) };
  } catch (err) {
    return { status: 0, errText: err?.name === 'AbortError' ? `sin respuesta en ${TIMEOUT_MS / 1000} s` : String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

const ok2xx = (r) => r.status >= 200 && r.status < 300;
const describe = (method, path, r) => `${method} /save-api${path} -> HTTP ${r.status || 'sin respuesta'}${r.errText ? ` (${r.errText})` : ''}`;

/** Comparación estable (orden de claves indiferente). */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  // 1. Sesión firmada como el juego (un timestamp por run; el servidor la acepta 24 h)
  const authTimestamp = Date.now();
  const authSignature = await account.signMessage({ message: `ZEROadventure-auth:${address}:${authTimestamp}` });

  // Partida de prueba sin progreso y marcada: nunca puntúa ni sale en el leaderboard
  const now = Date.now();
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const state = {
    smoke: true,
    smokeRun: runId,
    currentScene: 'smoke_cloud_save',
    flags: { smoke_cloud_save: true },
    inventory: [],
    visited: [],
  };
  const sceneName = `smoke-a9.19-${runId}`;
  const savePath = `/save/${address}/${SLOT}`;
  let saved = false;

  try {
    // 2. Guardar
    const post = await call('POST', '/save', {
      body: { state, address, timestamp: now, sceneName, slot: SLOT, authSignature, authTimestamp },
    });
    if (!ok2xx(post)) return fail(`guardar: ${describe('POST', '/save', post)}`);
    saved = true;
    console.log(`  POST /save-api/save -> ${post.status}`);

    // 3. Leer y comparar
    const get = await call('GET', savePath);
    if (!ok2xx(get)) return fail(`leer: ${describe('GET', savePath, get)}`);
    const back = get.json;
    const diffs = [];
    if (!back || typeof back !== 'object') diffs.push('respuesta no es JSON');
    else {
      if (!same(back.state, state)) diffs.push('state');
      if (back.timestamp !== now) diffs.push('timestamp');
      if (back.sceneName !== sceneName) diffs.push('sceneName');
      if (back.slot !== SLOT) diffs.push('slot');
      if (typeof back.address !== 'string' || back.address.toLowerCase() !== address) diffs.push('address');
    }
    if (diffs.length) return fail(`leer: GET /save-api${savePath} -> ${get.status} pero no es lo guardado (${diffs.join(', ')})`);
    console.log(`  GET  /save-api${savePath} -> ${get.status}, igual a lo guardado`);

    // 4. No sale en el leaderboard (truncada como la publica el servidor)
    const lb = await call('GET', '/leaderboard');
    if (!ok2xx(lb)) return fail(`leaderboard: ${describe('GET', '/leaderboard', lb)}`);
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const rows = Array.isArray(lb.json?.players) ? lb.json.players : [];
    if (rows.some((p) => p?.address === short || p?.sceneName === sceneName)) {
      // Sin el cambio de A9.19 desplegado la partida de prueba (0 puntos) puede asomar mientras existe; se borra abajo
      warn(`A9.19: la partida de prueba sale en /leaderboard mientras existe (¿save-server sin el filtro state.smoke de A9.19?)`);
    } else {
      console.log(`  GET  /save-api/leaderboard -> ${lb.status}, la cartera de prueba no sale`);
    }
  } finally {
    // 5. Borrar siempre que se haya escrito (aunque haya fallado la lectura)
    if (saved) {
      const del = await call('DELETE', savePath, {
        headers: { 'X-Auth-Signature': authSignature, 'X-Auth-Timestamp': String(authTimestamp) },
      });
      if (!ok2xx(del)) {
        fail(`borrar: ${describe('DELETE', savePath, del)}; queda la partida de prueba de ${address} en el slot ${SLOT}`);
      } else {
        console.log(`  DELETE /save-api${savePath} -> ${del.status}`);
        const gone = await call('GET', savePath);
        if (gone.status !== 404) fail(`borrar: tras DELETE, GET /save-api${savePath} -> HTTP ${gone.status || 'sin respuesta'} (se esperaba 404)`);
        else console.log(`  GET  /save-api${savePath} -> 404, borrada`);
      }
    }
  }
}

await main().catch((err) => fail(`error inesperado: ${err?.message || err}`));
if (!process.exitCode) console.log('A9.19: guardado firmado en la nube real OK (guardar, leer, comparar y borrar).');

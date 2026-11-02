// A1.6: privacidad del leaderboard. Módulo puro (sin dependencias) para poder probarlo con `node --test`.
// /leaderboard nunca devuelve la dirección completa: solo `0x13fc…7f23` y, si lo hay, el nombre ENS.

const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRUNCATED_ADDRESS = /^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/;

/** `0x13fcbbbd…7f23` (42) → `0x13fc…7f23`. Ya truncada → tal cual. Cualquier otra cosa → '' (no se filtra nada). */
export function truncateAddress(addr) {
  if (typeof addr !== 'string') return '';
  if (TRUNCATED_ADDRESS.test(addr)) return addr;
  if (!FULL_ADDRESS.test(addr)) return '';
  const a = addr.toLowerCase();
  return a.slice(0, 6) + '…' + a.slice(-4);
}

export function isFullAddress(addr) {
  return typeof addr === 'string' && FULL_ADDRESS.test(addr);
}

/**
 * Fila pública del leaderboard a partir de la fila interna (que lleva `address` completa).
 * Lista blanca de campos: nada que no esté aquí sale del servidor. `ensLookup(addr)` → string | null | undefined.
 * Devuelve null si la dirección no es válida (la fila no se publica).
 */
export function publicPlayer(player, ensLookup = () => null) {
  if (!player || !isFullAddress(player.address)) return null;
  const ens = ensLookup(player.address.toLowerCase());
  return {
    address: truncateAddress(player.address),
    ens: typeof ens === 'string' && ens ? ens : null,
    sceneName: player.sceneName,
    score: player.score,
    chapters: player.chapters,
    scenesVisited: player.scenesVisited,
    items: player.items,
    puzzles: player.puzzles,
    gameComplete: player.gameComplete,
    patientZero: player.patientZero,
    holderBadges: player.holderBadges,
    holderPts: player.holderPts,
    hiddenPts: player.hiddenPts,
    achievements: player.achievements,
    lastSaved: player.lastSaved,
  };
}

/**
 * Caché de ENS en memoria con resolución en segundo plano.
 * - `get(addr)`: síncrono. string | null si está en caché y vigente; undefined si no (o caducado).
 * - `prefetch(addrs)`: lanza la resolución de las que faltan sin bloquear; devuelve la promesa (para tests).
 *   Concurrencia acotada, timeout por dirección, el null también se cachea, los errores no se propagan.
 * `resolve(addr)` es la llamada real al RPC (inyectada: en el servidor es viem getEnsName).
 */
export function createEnsCache({
  resolve,
  ttlMs = 24 * 60 * 60 * 1000,
  timeoutMs = 3000,
  concurrency = 4,
  now = () => Date.now(),
  log = (msg) => console.warn(msg),
} = {}) {
  const cache = new Map(); // addr → { name, ts }
  const inFlight = new Set();

  function get(addr) {
    const e = cache.get(addr);
    if (!e) return undefined;
    if (now() - e.ts > ttlMs) return undefined;
    return e.name;
  }

  function withTimeout(p) {
    let t;
    const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), timeoutMs); });
    return Promise.race([p, timer]).finally(() => clearTimeout(t));
  }

  async function resolveOne(addr) {
    try {
      const name = await withTimeout(Promise.resolve().then(() => resolve(addr)));
      cache.set(addr, { name: typeof name === 'string' && name ? name : null, ts: now() });
    } catch (err) {
      cache.set(addr, { name: null, ts: now() });
      // Solo el mensaje corto: nada de stack ni URLs del RPC
      const msg = String(err && err.message ? err.message : err).split('\n')[0].slice(0, 80);
      log(`ENS: sin nombre para ${truncateAddress(addr)} (${msg})`);
    }
  }

  function prefetch(addrs) {
    const pending = [...new Set(addrs.map((a) => String(a).toLowerCase()))]
      .filter((a) => isFullAddress(a) && get(a) === undefined && !inFlight.has(a));
    if (pending.length === 0) return Promise.resolve();
    pending.forEach((a) => inFlight.add(a));
    let i = 0;
    const worker = async () => {
      while (i < pending.length) {
        const a = pending[i++];
        try { await resolveOne(a); } finally { inFlight.delete(a); }
      }
    };
    const n = Math.max(1, Math.min(concurrency, pending.length));
    return Promise.allSettled(Array.from({ length: n }, worker)).then(() => undefined);
  }

  return { get, prefetch, size: () => cache.size };
}

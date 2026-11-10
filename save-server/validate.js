// A1.12: validación del save-server (dirección, slot y firma de sesión). Node puro, sin dependencias: la verificación
// de la firma se inyecta (en el servidor, `verifyMessage` de viem). Tests: tests/save-server-validate.test.mjs.

export const SLOT_WHITELIST = [0, 1, 2];
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Margen para relojes adelantados del cliente. */
export const SESSION_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_SAVE_BYTES = 512 * 1024;

/** Dirección 0x + 40 hex, en minúsculas; null si no lo es. */
export function normalizeAddress(value) {
  if (typeof value !== 'string') return null;
  const a = value.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}

/** Slot de la lista blanca (número o texto de un dígito); null si no lo es. */
export function parseSlot(value) {
  let n = value;
  if (typeof value === 'string') {
    if (!/^\d$/.test(value)) return null;
    n = Number(value);
  }
  return Number.isInteger(n) && SLOT_WHITELIST.includes(n) ? n : null;
}

export function sessionMessage(address, timestamp) {
  return `ZEROadventure-auth:${address}:${timestamp}`;
}

/**
 * Comprueba la firma de sesión (`authSignature` sobre `ZEROadventure-auth:<address>:<authTimestamp>`).
 * Devuelve { ok: true } o { ok: false, status, error } (401 = falta, caducada o no válida).
 */
export async function checkSessionAuth({ address, authSignature, authTimestamp, now = Date.now(), verify }) {
  if (!authSignature || authTimestamp === undefined || authTimestamp === null || authTimestamp === '') {
    return { ok: false, status: 401, error: 'Wallet signature required' };
  }
  const ts = Number(authTimestamp);
  if (!Number.isFinite(ts) || typeof authSignature !== 'string' || !/^0x[0-9a-fA-F]{2,}$/.test(authSignature)) {
    return { ok: false, status: 401, error: 'Invalid wallet signature' };
  }
  if (now - ts > SESSION_MAX_AGE_MS || ts - now > SESSION_FUTURE_SKEW_MS) {
    return { ok: false, status: 401, error: 'Session expired, sign again' };
  }
  let valid = false;
  try {
    valid = await verify({ address, message: sessionMessage(address, ts), signature: authSignature });
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, status: 401, error: 'Invalid wallet signature' };
}

/** Valida el cuerpo de POST /save. Devuelve { ok: true, address, slot, ... } o { ok: false, status, error }. */
export function validateSaveBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Invalid body' };
  const { state, sceneName, timestamp } = body;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { ok: false, status: 400, error: 'Missing required fields' };
  const address = normalizeAddress(body.address);
  if (!address) return { ok: false, status: 400, error: 'Invalid address' };
  const slot = parseSlot(body.slot ?? 1);
  if (slot === null) return { ok: false, status: 400, error: 'Invalid slot (0 = autosave, 1 or 2)' };
  if (sceneName !== undefined && (typeof sceneName !== 'string' || sceneName.length > 200)) {
    return { ok: false, status: 400, error: 'Invalid sceneName' };
  }
  if (timestamp !== undefined && !Number.isFinite(timestamp)) return { ok: false, status: 400, error: 'Invalid timestamp' };
  return { ok: true, address, slot, state, sceneName: sceneName ?? 'Unknown', timestamp: timestamp ?? Date.now() };
}

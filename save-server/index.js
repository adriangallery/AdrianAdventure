import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyMessage, createPublicClient, http } from 'viem';
import { mainnet, base } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { appendFileSync } from 'fs';
import { bodyLimit } from 'hono/body-limit';
import { publicPlayer, createEnsCache } from './privacy.js';
import { parseSample, sampleLine, createRateLimiter, summarize, MAX_BODY_BYTES as TELEMETRY_MAX_BYTES } from './telemetry.js';
import { normalizeAddress, parseSlot, checkSessionAuth, validateSaveBody, MAX_SAVE_BYTES } from './validate.js';

/**
 * A1.12: comprobación de la firma de sesión (inyectada en validate.js). Primero EOA en local (sin red); si no cuadra,
 * en Base con ERC-1271/6492 para las smart wallets (Coinbase Smart Wallet), RPC público y sin claves.
 */
const baseClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org', { retryCount: 1, timeout: 5000 }) });
const verifySession = async (args) => {
  try { if (await verifyMessage(args)) return true; } catch { /* sigue con la verificación on-chain */ }
  return baseClient.verifyMessage(args);
};

const app = new Hono();

const DATA_DIR = process.env.SAVE_DIR || '/data/saves';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

app.use('*', cors({
  origin: ['https://adventure.zerothetoken.com', 'https://adventure.adrianzero.com', 'https://zeroadventure.vercel.app', 'https://adrianzero.com', 'http://localhost:3000', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Auth-Signature', 'X-Auth-Timestamp'],
}));

// A1.6: el ENS se resuelve aquí (el cliente ya no recibe la dirección completa). RPC público y gratuito, sin claves.
// Nunca bloquea /leaderboard: caché en memoria 24 h (también el null) y resolución en segundo plano.
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com', { retryCount: 0, timeout: 3000 }),
});
const ensCache = createEnsCache({
  resolve: (address) => ensClient.getEnsName({ address }),
  timeoutMs: 3000,
  concurrency: 4,
});

app.get('/', (c) => c.json({ status: 'ok', service: 'zeroadventure-save' }));

// ─── Save file naming: {address}_slot{N}.json ───

function saveFile(address, slot) {
  return join(DATA_DIR, `${address.toLowerCase()}_slot${slot}.json`);
}

/**
 * GET /save/:address — Load all slots for a wallet
 */
app.get('/save/:address', (c) => {
  const address = normalizeAddress(c.req.param('address'));
  if (!address) return c.json({ error: 'Invalid address' }, 400);

  const slots = {};
  // Slot 0 = autoguardado en la nube (V7); 1 y 2 = guardados manuales
  for (const slot of [0, 1, 2]) {
    const fp = saveFile(address, slot);
    if (existsSync(fp)) {
      try { slots[slot] = JSON.parse(readFileSync(fp, 'utf-8')); } catch {}
    }
  }

  // Backward compat: migrate old single-file save to slot 1
  const oldFile = join(DATA_DIR, `${address}.json`);
  if (existsSync(oldFile) && !slots[1]) {
    try {
      const old = JSON.parse(readFileSync(oldFile, 'utf-8'));
      slots[1] = old;
      writeFileSync(saveFile(address, 1), JSON.stringify(old, null, 2));
      unlinkSync(oldFile);
    } catch {}
  }

  return c.json({ address, slots });
});

/**
 * GET /save/:address/:slot — Load specific slot
 */
app.get('/save/:address/:slot', (c) => {
  const address = normalizeAddress(c.req.param('address'));
  const slot = parseSlot(c.req.param('slot'));
  if (!address || slot === null) {
    return c.json({ error: 'Invalid params' }, 400);
  }

  const fp = saveFile(address, slot);
  if (!existsSync(fp)) return c.json({ error: 'No save found' }, 404);

  try {
    return c.json(JSON.parse(readFileSync(fp, 'utf-8')));
  } catch {
    return c.json({ error: 'Corrupt save' }, 500);
  }
});

/**
 * POST /save — guarda en un slot. A1.12: exige la firma de sesión de la wallet (authSignature/authTimestamp).
 * Body: { state, address, timestamp, sceneName, slot, authSignature, authTimestamp }
 */
app.post('/save', bodyLimit({ maxSize: MAX_SAVE_BYTES, onError: (c) => c.json({ error: 'Save too large' }, 413) }), async (c) => {
  try {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const v = validateSaveBody(body);
    if (!v.ok) return c.json({ error: v.error }, v.status);

    const auth = await checkSessionAuth({
      address: v.address, authSignature: body.authSignature, authTimestamp: body.authTimestamp, verify: verifySession,
    });
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const fp = saveFile(v.address, v.slot);
    const saveData = { state: v.state, address: v.address, timestamp: v.timestamp, signature: null, sceneName: v.sceneName, slot: v.slot, savedAt: Date.now() };
    writeFileSync(fp, JSON.stringify(saveData, null, 2));

    console.log(`Slot ${v.slot} saved for ${v.address} (${v.sceneName})`);
    return c.json({ ok: true, address: v.address, slot: v.slot, sceneName: v.sceneName, timestamp: v.timestamp });
  } catch (err) {
    console.error('Save error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /leaderboard — Top players by score
 */
app.get('/leaderboard', (c) => {
  try {
    const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const playerMap = new Map();

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'));
        const state = data.state;
        if (!state) continue;

        const addr = typeof data.address === 'string' ? data.address.toLowerCase() : '';
        const flags = state.flags ?? {};

        // Chapters
        let chapters = 0;
        for (const ch of ['chapter_1_complete','chapter_2_complete','chapter_3_complete','chapter_4_complete','chapter_5_complete']) {
          if (flags[ch]) chapters++;
        }
        const chapterPts = chapters * 200;

        // Milestones
        let milestonePts = 0;
        if (flags.patient_zero_revealed) milestonePts += 1000;
        if (flags.patient_zero_found) milestonePts += 500;
        if (flags.game_complete) milestonePts += 500;
        if (flags.founder_mode) milestonePts += 300;
        if (flags.basement_unlocked) milestonePts += 100;
        if (flags.server_room_open) milestonePts += 100;
        if (flags.treatment_room_unlocked) milestonePts += 100;
        if (flags.clinic_unlocked) milestonePts += 50;
        if (flags.door_unlocked) milestonePts += 50;

        // Exploration
        const scenesVisited = state.visited?.length ?? 0;
        const explorePts = scenesVisited * 10;

        // Items discovered
        const discoveryFlags = [
          'found_code_note','found_envelope','found_keycard','found_terminal_key',
          'found_floppy','found_rubber_duck','found_sign_in_sheet','found_clinic_note',
          'found_clinic_photo','found_server_log','found_burned_chip','found_dr_badge',
          'found_adrian_note','found_receipt','found_broken_mouse','found_pz_note',
          'monkey_sticker_found','has_antenna','has_water','has_printout',
        ];
        // A1.4: found_hw_wallet pasó a llamarse found_terminal_key; las partidas viejas (clientes sin actualizar) siguen contando
        const legacyFlags = { found_terminal_key: 'found_hw_wallet' };
        const itemsDiscovered = discoveryFlags.filter(f => flags[f] || (legacyFlags[f] && flags[legacyFlags[f]])).length;
        const discoveryPts = itemsDiscovered * 15;

        // Puzzles
        let puzzlePts = 0;
        for (const pf of ['plant_watered','computer_unlocked','floppy_inserted','emergency_switch_flipped','duck_reunion']) {
          if (flags[pf]) puzzlePts += 50;
        }

        // Hidden
        let hiddenPts = 0;
        for (const hf of ['debug_look_1','debug_look_2','debug_look_3','debug_look_4','debug_look_5']) {
          if (flags[hf]) hiddenPts += 25;
        }
        if (flags.receptionist_mentioned_pz) hiddenPts += 50;
        if (flags.vip_rug_hint) hiddenPts += 50;
        if (flags.satoshi_pool_hint) hiddenPts += 50;

        // Holder exclusive
        let holderPts = 0;
        const holderBadges = [];
        const holderMap = {
          floppy_lobby_revealed: [100, 'ARCHIVIST'],
          floppy_basement_unlocked: [150, 'SECTOR ZERO'],
          floppy_trading_revealed: [100, 'ALPHA LEAK'],
          floppy_mining_revealed: [100, 'GENESIS MINER'],
          floppy_clinic_revealed: [100, 'MEDICAL RECORDS'],
          floppy_endgame_complete: [200, 'PRESERVED'],
          has_vip_floppy: [100, 'VIP ACCESS'],
        };
        for (const [flag, [pts, badge]] of Object.entries(holderMap)) {
          if (flags[flag]) { holderPts += pts; holderBadges.push(badge); }
        }
        if (flags.floppy_lore_discovered) holderPts += 100;
        if (flags.adrian_message_found) holderPts += 150;
        if (flags.patient_records_unlocked) holderPts += 100;

        const score = chapterPts + milestonePts + explorePts + discoveryPts + puzzlePts + hiddenPts + holderPts;

        // Achievements earned (from gameState)
        const achievements = state.achievements ?? [];

        // Keep best score per address
        const existing = playerMap.get(addr);
        if (!existing || score > existing.score) {
          playerMap.set(addr, {
            address: addr, sceneName: data.sceneName, score, chapters,
            scenesVisited, items: itemsDiscovered, puzzles: Math.floor(puzzlePts / 50),
            gameComplete: !!flags.patient_zero_revealed, patientZero: !!flags.patient_zero_found,
            holderBadges, holderPts, hiddenPts, achievements,
            lastSaved: data.savedAt || data.timestamp,
          });
        }
      } catch {}
    }

    const players = [...playerMap.values()].sort((a, b) => b.score - a.score);
    // A1.6: solo se publican filas con dirección truncada (publicPlayer: lista blanca de campos) y solo se
    // resuelve el ENS del top 50 devuelto, en segundo plano (no se espera; la siguiente petición ya lo trae).
    const topInternal = players.filter((p) => publicPlayer(p) !== null).slice(0, 50);
    ensCache.prefetch(topInternal.map((p) => p.address)).catch(() => {});
    const top = topInternal.map((p) => publicPlayer(p, ensCache.get));

    return c.json({ total: players.length, players: top });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /save/:address/:slot — A1.12: dirección y slot validados y firma de sesión de esa wallet
 * (cabeceras X-Auth-Signature / X-Auth-Timestamp).
 */
app.delete('/save/:address/:slot', async (c) => {
  const address = normalizeAddress(c.req.param('address'));
  const slot = parseSlot(c.req.param('slot'));
  if (!address || slot === null) return c.json({ error: 'Invalid params' }, 400);
  const auth = await checkSessionAuth({
    address, authSignature: c.req.header('x-auth-signature'), authTimestamp: c.req.header('x-auth-timestamp'), verify: verifySession,
  });
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const fp = saveFile(address, slot);
  if (existsSync(fp)) unlinkSync(fp);
  return c.json({ ok: true });
});

// ─── A9.14: telemetría anónima de duración por capítulo ───
// Fichero aparte (no acaba en .json: /leaderboard no lo lee). Solo { capítulo, segundos, día }.
const TELEMETRY_DIR = process.env.TELEMETRY_DIR || join(DATA_DIR, 'telemetry');
if (!existsSync(TELEMETRY_DIR)) mkdirSync(TELEMETRY_DIR, { recursive: true });
const TELEMETRY_FILE = join(TELEMETRY_DIR, 'chapters.jsonl');
const telemetryLimit = createRateLimiter();

app.post('/telemetry/chapter', bodyLimit({ maxSize: TELEMETRY_MAX_BYTES, onError: (c) => c.json({ error: 'Too large' }, 413) }), async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const sample = parseSample(body);
  if (!sample) return c.json({ error: 'Invalid sample' }, 400);
  // La IP solo sirve para el límite en memoria; no se guarda
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '?';
  if (!telemetryLimit(ip)) return c.json({ error: 'Too many' }, 429);
  try {
    appendFileSync(TELEMETRY_FILE, sampleLine(sample));
  } catch (err) {
    console.error('Telemetry error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
  return c.json({ ok: true });
});

app.get('/telemetry/chapters', (c) => {
  try {
    const text = existsSync(TELEMETRY_FILE) ? readFileSync(TELEMETRY_FILE, 'utf-8') : '';
    return c.json(summarize(text));
  } catch (err) {
    console.error('Telemetry summary error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

const port = parseInt(process.env.PORT || '3001');
console.log(`Save server listening on port ${port}`);
serve({ fetch: app.fetch, port });

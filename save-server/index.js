import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyMessage } from 'viem';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const app = new Hono();

const DATA_DIR = process.env.SAVE_DIR || '/data/saves';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

app.use('*', cors({
  origin: ['https://zeroadventure.vercel.app', 'http://localhost:3000', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

app.get('/', (c) => c.json({ status: 'ok', service: 'zeroadventure-save' }));

// ─── Save file naming: {address}_slot{N}.json ───

function saveFile(address, slot) {
  return join(DATA_DIR, `${address.toLowerCase()}_slot${slot}.json`);
}

/**
 * GET /save/:address — Load all slots for a wallet
 */
app.get('/save/:address', (c) => {
  const address = c.req.param('address').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ error: 'Invalid address' }, 400);

  const slots = {};
  for (const slot of [1, 2]) {
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
  const address = c.req.param('address').toLowerCase();
  const slot = parseInt(c.req.param('slot'));
  if (!/^0x[a-f0-9]{40}$/.test(address) || ![1, 2].includes(slot)) {
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
 * POST /save — Store a signed save to a specific slot
 * Body: { state, address, timestamp, signature, sceneName, slot }
 */
app.post('/save', async (c) => {
  try {
    const body = await c.req.json();
    const { state, address, timestamp, signature, sceneName, slot, authSignature, authTimestamp } = body;
    const slotId = slot ?? 1;

    if (!state || !address) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    if (![1, 2].includes(slotId)) {
      return c.json({ error: 'Invalid slot (1 or 2)' }, 400);
    }

    const addr = address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return c.json({ error: 'Invalid address' }, 400);

    let valid = false;

    if (authSignature && authTimestamp) {
      // Session auth mode — signature proves wallet ownership (signed once on connect)
      const maxAge = 24 * 60 * 60 * 1000; // 24h
      if (Date.now() - authTimestamp > maxAge) {
        return c.json({ error: 'Session expired, reconnect wallet' }, 401);
      }
      const authMessage = `ZEROadventure-auth:${addr}:${authTimestamp}`;
      try {
        valid = await verifyMessage({ address: addr, message: authMessage, signature: authSignature });
      } catch (err) {
        console.error('Session auth verify failed:', err);
        return c.json({ error: 'Invalid session auth' }, 401);
      }
    } else if (signature && timestamp) {
      // Legacy per-save signature mode
      const message = JSON.stringify({ state, address: addr, timestamp });
      try {
        valid = await verifyMessage({ address: addr, message, signature });
      } catch (err) {
        console.error('Sig verify failed:', err);
        return c.json({ error: 'Invalid signature' }, 401);
      }
    } else {
      return c.json({ error: 'Missing signature or authSignature' }, 400);
    }

    if (!valid) return c.json({ error: 'Signature mismatch' }, 401);

    const fp = saveFile(addr, slotId);
    const saveData = { state, address: addr, timestamp: timestamp || Date.now(), signature: signature || null, sceneName, slot: slotId, savedAt: Date.now() };
    writeFileSync(fp, JSON.stringify(saveData, null, 2));

    console.log(`Slot ${slotId} saved for ${addr} (${sceneName})`);
    return c.json({ ok: true, address: addr, slot: slotId, sceneName });
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

        const addr = data.address;
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
          'found_code_note','found_envelope','found_keycard','found_hw_wallet',
          'found_floppy','found_rubber_duck','found_sign_in_sheet','found_clinic_note',
          'found_clinic_photo','found_server_log','found_burned_chip','found_dr_badge',
          'found_adrian_note','found_receipt','found_broken_mouse','found_pz_note',
          'monkey_sticker_found','has_antenna','has_water','has_printout',
        ];
        const itemsDiscovered = discoveryFlags.filter(f => flags[f]).length;
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

        // Keep best score per address
        const existing = playerMap.get(addr);
        if (!existing || score > existing.score) {
          playerMap.set(addr, {
            address: addr, sceneName: data.sceneName, score, chapters,
            scenesVisited, items: itemsDiscovered, puzzles: Math.floor(puzzlePts / 50),
            gameComplete: !!flags.patient_zero_revealed, patientZero: !!flags.patient_zero_found,
            holderBadges, holderPts, hiddenPts,
            lastSaved: data.savedAt || data.timestamp,
          });
        }
      } catch {}
    }

    const players = [...playerMap.values()].sort((a, b) => b.score - a.score);

    return c.json({ total: players.length, players: players.slice(0, 50) });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /save/:address/:slot
 */
app.delete('/save/:address/:slot', (c) => {
  const address = c.req.param('address').toLowerCase();
  const slot = parseInt(c.req.param('slot'));
  const fp = saveFile(address, slot);
  if (existsSync(fp)) unlinkSync(fp);
  return c.json({ ok: true });
});

const port = parseInt(process.env.PORT || '3001');
console.log(`Save server listening on port ${port}`);
serve({ fetch: app.fetch, port });

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyMessage } from 'viem';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const app = new Hono();

// Volume mount path (Railway volume)
const DATA_DIR = process.env.SAVE_DIR || '/data/saves';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// CORS — allow game origin
app.use('*', cors({
  origin: ['https://zeroadventure.vercel.app', 'http://localhost:3000', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'zeroadventure-save' }));

/**
 * GET /save/:address — Load save for a wallet address
 */
app.get('/save/:address', (c) => {
  const address = c.req.param('address').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ error: 'Invalid address' }, 400);
  }

  const filePath = join(DATA_DIR, `${address}.json`);
  if (!existsSync(filePath)) {
    return c.json({ error: 'No save found' }, 404);
  }

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return c.json(data);
  } catch {
    return c.json({ error: 'Corrupt save file' }, 500);
  }
});

/**
 * POST /save — Store a signed save
 * Body: { state, address, timestamp, signature, sceneName }
 * Verifies the signature matches the address before storing.
 */
app.post('/save', async (c) => {
  try {
    const body = await c.req.json();
    const { state, address, timestamp, signature, sceneName } = body;

    if (!state || !address || !timestamp || !signature) {
      return c.json({ error: 'Missing required fields: state, address, timestamp, signature' }, 400);
    }

    const addr = address.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) {
      return c.json({ error: 'Invalid address' }, 400);
    }

    // Verify signature — the message format must match what the client signs
    const message = JSON.stringify({ state, address: addr, timestamp });
    let valid = false;
    try {
      valid = await verifyMessage({
        address: addr,
        message,
        signature,
      });
    } catch (err) {
      console.error('Signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    if (!valid) {
      return c.json({ error: 'Signature does not match address' }, 401);
    }

    // Store the save
    const filePath = join(DATA_DIR, `${addr}.json`);
    const saveData = { state, address: addr, timestamp, signature, sceneName, savedAt: Date.now() };
    writeFileSync(filePath, JSON.stringify(saveData, null, 2));

    console.log(`Save stored for ${addr} (${sceneName}) at ${new Date().toISOString()}`);
    return c.json({ ok: true, address: addr, sceneName });
  } catch (err) {
    console.error('Save error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /leaderboard — Top players ranked by game progress
 */
app.get('/leaderboard', (c) => {
  try {
    // readdirSync imported at top
    const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

    const players = [];
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'));
        const state = data.state;
        if (!state) continue;

        const flags = state.flags ?? {};
        const scenesVisited = state.visited?.length ?? 0;
        const itemCount = state.inventory?.length ?? 0;

        // ─── Chapters (200 pts each, 1000 max) ───
        let chapters = 0;
        if (flags.chapter_1_complete) chapters++;
        if (flags.chapter_2_complete) chapters++;
        if (flags.chapter_3_complete) chapters++;
        if (flags.chapter_4_complete) chapters++;
        if (flags.chapter_5_complete) chapters++;
        const chapterPts = chapters * 200;

        // ─── Major milestones (unique points) ───
        let milestonePts = 0;
        if (flags.patient_zero_revealed) milestonePts += 1000;  // Game complete
        if (flags.patient_zero_found) milestonePts += 500;      // Found PZ
        if (flags.game_complete) milestonePts += 500;            // Endgame
        if (flags.founder_mode) milestonePts += 300;             // Golden token + computer
        if (flags.basement_unlocked) milestonePts += 100;
        if (flags.server_room_open) milestonePts += 100;
        if (flags.treatment_room_unlocked) milestonePts += 100;
        if (flags.clinic_unlocked) milestonePts += 50;
        if (flags.door_unlocked) milestonePts += 50;

        // ─── Exploration (10 pts per scene, 110 max) ───
        const explorePts = scenesVisited * 10;

        // ─── Items discovered (15 pts each) ───
        const discoveryFlags = [
          'found_code_note', 'found_envelope', 'found_keycard', 'found_hw_wallet',
          'found_floppy', 'found_rubber_duck', 'found_sign_in_sheet', 'found_clinic_note',
          'found_clinic_photo', 'found_server_log', 'found_burned_chip', 'found_dr_badge',
          'found_adrian_note', 'found_receipt', 'found_broken_mouse', 'found_pz_note',
          'monkey_sticker_found', 'has_antenna', 'has_water', 'has_printout',
        ];
        const itemsDiscovered = discoveryFlags.filter(f => flags[f]).length;
        const discoveryPts = itemsDiscovered * 15;

        // ─── Puzzles solved (50 pts each) ───
        let puzzlePts = 0;
        if (flags.plant_watered) puzzlePts += 50;           // Water + plant = golden token
        if (flags.computer_unlocked) puzzlePts += 50;       // Ledger + computer
        if (flags.floppy_inserted) puzzlePts += 50;         // Floppy in drive
        if (flags.emergency_switch_flipped) puzzlePts += 50; // Emergency switch
        if (flags.duck_reunion) puzzlePts += 50;             // Easter egg

        // ─── Hidden / Easter eggs (75 pts each) ───
        let hiddenPts = 0;
        const hiddenFlags = ['debug_look_1','debug_look_2','debug_look_3','debug_look_4','debug_look_5'];
        hiddenPts += hiddenFlags.filter(f => flags[f]).length * 25;
        if (flags.receptionist_mentioned_pz) hiddenPts += 50;
        if (flags.vip_rug_hint) hiddenPts += 50;
        if (flags.satoshi_pool_hint) hiddenPts += 50;

        // ─── TOKEN GATED / Holder exclusive (100+ pts each) ───
        let holderPts = 0;
        const holderBadges = [];
        if (flags.floppy_lobby_revealed)  { holderPts += 100; holderBadges.push('ARCHIVIST'); }
        if (flags.floppy_basement_unlocked) { holderPts += 150; holderBadges.push('SECTOR ZERO'); }
        if (flags.floppy_trading_revealed) { holderPts += 100; holderBadges.push('ALPHA LEAK'); }
        if (flags.floppy_mining_revealed) { holderPts += 100; holderBadges.push('GENESIS MINER'); }
        if (flags.floppy_clinic_revealed) { holderPts += 100; holderBadges.push('MEDICAL RECORDS'); }
        if (flags.floppy_endgame_complete) { holderPts += 200; holderBadges.push('PRESERVED'); }
        if (flags.floppy_lore_discovered) holderPts += 100;
        if (flags.adrian_message_found) holderPts += 150;
        if (flags.patient_records_unlocked) holderPts += 100;
        if (flags.has_vip_floppy) { holderPts += 100; holderBadges.push('VIP ACCESS'); }

        const score = chapterPts + milestonePts + explorePts + discoveryPts + puzzlePts + hiddenPts + holderPts;

        players.push({
          address: data.address,
          sceneName: data.sceneName,
          score,
          chapters,
          scenesVisited,
          items: itemsDiscovered,
          puzzles: Math.floor(puzzlePts / 50),
          gameComplete: !!flags.patient_zero_revealed,
          patientZero: !!flags.patient_zero_found,
          holderBadges,
          holderPts,
          hiddenPts,
          lastSaved: data.savedAt || data.timestamp,
        });
      } catch { /* skip corrupt files */ }
    }

    // Sort by score descending
    players.sort((a, b) => b.score - a.score);

    return c.json({
      total: players.length,
      players: players.slice(0, 50),
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * DELETE /save/:address — Delete save (requires signature)
 */
app.delete('/save/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const filePath = join(DATA_DIR, `${address}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
  return c.json({ ok: true });
});

const port = parseInt(process.env.PORT || '3001');
console.log(`Save server listening on port ${port}`);
serve({ fetch: app.fetch, port });

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

        // Calculate progress score
        const scenesVisited = state.visited?.length ?? 0;
        const flagCount = Object.keys(state.flags ?? {}).length;
        const itemCount = state.inventory?.length ?? 0;
        const triggersCount = state.firedTriggers?.length ?? 0;

        // Key milestones
        const flags = state.flags ?? {};
        const chapter1 = !!flags.chapter_1_complete;
        const chapter2 = !!flags.chapter_2_intro_shown;
        const chapter5 = !!flags.chapter_5_complete;
        const patientZero = !!flags.patient_zero_found;
        const gameComplete = !!flags.patient_zero_revealed;

        // Chapters completed (0-5)
        let chapters = 0;
        if (chapter1) chapters++;
        if (chapter2) chapters++;
        if (flags.chapter_3_intro_shown) chapters++;
        if (flags.chapter_4_intro_shown) chapters++;
        if (chapter5) chapters++;

        // Score: weighted sum
        const score = (chapters * 100) + (scenesVisited * 10) + (itemCount * 5) + (flagCount * 2) + triggersCount;

        players.push({
          address: data.address,
          sceneName: data.sceneName,
          score,
          chapters,
          scenesVisited,
          items: itemCount,
          gameComplete,
          patientZero,
          lastSaved: data.savedAt || data.timestamp,
        });
      } catch { /* skip corrupt files */ }
    }

    // Sort by score descending
    players.sort((a, b) => b.score - a.score);

    return c.json({
      total: players.length,
      players: players.slice(0, 50), // Top 50
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

// Demo de A3.2 (regla visual del plan SCUMM): la apertura como cinemática del motor (A2.10), en outside y en el lobby.
//   1) 1280x720: New Game (clic en el menú, sin sonido, sin tocar nada después) → apertura de outside entera: franjas,
//      interfaz fuera, Dex entra andando desde el coche mientras la cámara enseña la casa, el narrador en la franja, Dex
//      lee el mensaje de Adrian sobre su cabeza, tarjeta del capítulo 1 y Dex libre junto a la puerta.
//   2) 1280x720: otra partida nueva, saltada con Esc (tecla real) a ~1,5 s: mismo estado final que la entera (flags,
//      posición y orientación de Dex, cámara).
//   3) 390x844 (móvil vertical, táctil): la misma apertura entera; los subtítulos caben en pantalla.
//   4) 1280x720: lobby (?scene=lobby) entero y saltado: pan a Penny, su frase sobre su cabeza, tarjeta del capítulo 2.
// Mide con una sonda en la página (cada 50 ms) la duración de cada apertura desde que se abre la cinemática hasta que se
// cierra, y cuánto dura cada texto. Sin sonido los textos duran lo que tardan en escribirse y leerse; con los MP3 de
// voz ya generados (etiqueta `voices`) calcula también la duración con voz: lo medido, cambiando el tiempo de cada
// texto por el de su clip + 300 ms (A2.10: en cinemática cada texto dura lo que su clip). Límites de la biblia (§ 4):
// outside ≤ 20 s, lobby ≤ 12 s.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a3-2-opening
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const STAGE = { width: 1320, height: 900 };
const DESKTOP = { width: 1280, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const PORTRAIT = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const LIMITS = { outside: 20000, lobby: 12000 };
const VOICE_TAIL_MS = 300; // el de src/systems/Cinematics.ts
const DEX_END = { x: 39, y: 93 };

const demo = await startDemo(import.meta.url, { fps: 6, width: 660, viewport: DESKTOP });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = { passes: [] };
const fmt = (p) => (p ? `${p.x.toFixed(2)},${p.y.toFixed(2)}` : '?');
const secs = (ms) => (ms == null ? '?' : `${(ms / 1000).toFixed(1)} s`);

// Lienzo fijo para el GIF: 1280x720 y 390x844 en el mismo tamaño de fotograma
const stage = await browser.newPage();
await stage.setViewport({ ...STAGE, deviceScaleFactor: 1 });
await page.bringToFront();
let frame = 0;
async function stageFrame(caption) {
  const png = await page.screenshot();
  const src = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  await stage.setContent(`<html><body style="margin:0;background:#15151f;width:${STAGE.width}px;height:${STAGE.height}px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;font:16px monospace;color:#c8c0e8">
    <div style="margin-bottom:10px">${caption}</div>
    <img src="${src}" style="max-width:${STAGE.width - 20}px;max-height:${STAGE.height - 50}px;outline:1px solid #504878;image-rendering:pixelated"></body></html>`);
  await stage.screenshot({ path: join(demo.dir, 'frames', `${String(frame++).padStart(3, '0')}.png`) });
  await page.bringToFront();
}

/**
 * Sonda en la página: cada 50 ms apunta el estado de la cinemática, el texto en pantalla y si el jugador y quien habla
 * se ven. Sobrevive a los cambios de escena (lee window.__game en cada vuelta). Se reinicia con cada pasada.
 */
async function installProbe() {
  await page.evaluate(() => {
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    const P = { start: null, end: null, endedAt: null, lines: [], card: null, seen: { letterbox: false, chromeHidden: false, band: false, head: false, playerOnScreen: 0, samples: 0, camXMin: Infinity, camXMax: -Infinity, speechOut: [] } };
    window.__probe = P;
    let cur = null;
    window.__probeTimer = setInterval(() => {
      const g = window.__game;
      if (!g || !window.__qa || !g.scene.isActive('GameScene')) return;
      let st;
      try { st = window.__qa.state(); } catch { return; }
      const now = performance.now();
      const c = st.cinematic;
      if (c?.active && P.start === null) P.start = now;
      if (P.start !== null && P.end === null && c && !c.active && c.ended >= 1) { P.end = now; P.endedAt = { ...c }; }
      if (c?.active) {
        P.seen.samples++;
        if (c.letterbox) P.seen.letterbox = true;
        if (c.chromeHidden) P.seen.chromeHidden = true;
        P.seen.camXMin = Math.min(P.seen.camXMin, c.camera.x);
        P.seen.camXMax = Math.max(P.seen.camXMax, c.camera.x);
        const gs = g.scene.getScene('GameScene');
        const v = gs.cameras.main.worldView;
        const p = gs.player;
        if (p && p.visible && p.x >= v.x && p.x <= v.right && p.y - p.displayHeight / 2 >= v.y && p.y - p.displayHeight / 2 <= v.bottom) P.seen.playerOnScreen++;
        const cardOn = (g.registry.get('cinematicActive') ?? 0) > 0;
        if (cardOn && !P.card) P.card = { at: now, until: null };
        if (!cardOn && P.card && P.card.until === null) P.card.until = now;
      }
      const sp = st.speech;
      const text = sp?.text ?? null;
      if (text !== (cur?.text ?? null)) {
        if (cur) cur.until = now;
        cur = text ? { text, speaker: sp.speaker, mode: sp.mode, at: now, until: null, box: { x: sp.x, y: sp.y, w: sp.w, h: sp.h }, vw: g.scale.width, vh: g.scale.height } : null;
        if (cur) P.lines.push(cur);
      }
      if (sp && c?.active) {
        if (sp.mode === 'band' || sp.mode === 'top') P.seen.band = true;
        if (sp.mode === 'head') P.seen.head = true;
        const left = sp.x - sp.w / 2;
        const right = sp.x + sp.w / 2;
        if (left < -1 || right > g.scale.width + 1 || sp.y < -1 || sp.y + sp.h > g.scale.height + 1) {
          if (P.seen.speechOut.length < 5) P.seen.speechOut.push({ text: sp.text.slice(0, 40), x: sp.x, y: sp.y, w: sp.w, h: sp.h });
        }
      }
    }, 50);
  });
}

const probe = () => page.evaluate(() => {
  const P = window.__probe;
  return P ? JSON.parse(JSON.stringify({ ...P, seen: { ...P.seen, camXMin: Number.isFinite(P.seen.camXMin) ? P.seen.camXMin : null, camXMax: Number.isFinite(P.seen.camXMax) ? P.seen.camXMax : null } })) : null;
});

/** Duración (ms) del clip de voz de cada texto, si ya existe su MP3 (null si no). */
const clipDurations = (texts) => page.evaluate(async (list) => {
  const vs = window.__game.registry.get('voiceSystem');
  const out = {};
  for (const text of list) {
    out[text] = null;
    try {
      const key = vs?.textMap?.get(vs.normalise(text));
      if (!key) continue;
      const res = await fetch(`assets/audio/voice/${key}.mp3`);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const audio = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(buf);
      out[text] = Math.round(audio.duration * 1000);
    } catch { /* sin clip */ }
  }
  return out;
}, texts);

/** Partida nueva limpia: menú, «New Game», «No thanks» (sin sonido) y espera a GameScene en outside. Sin toques. */
async function freshNewGame() {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__qa && window.__game?.scene?.isActive('MenuScene'), { timeout: 90000, polling: 250 });
  await installProbe();
  const clickedAt = await page.evaluate(() => {
    const menu = window.__game.scene.getScene('MenuScene');
    const button = menu.children.list.find((o) => o.text === '[ New Game ]');
    if (!button) return null;
    button.emit('pointerdown');
    return performance.now();
  });
  if (clickedAt === null) await demo.fail('no encuentro «New Game» en el menú');
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /No thanks/i.test(x.textContent ?? ''));
    if (b) { b.click(); return true; }
    return window.__game.scene.isActive('GameScene');
  }, { timeout: 10000, polling: 100 }).catch(() => {});
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'outside', { timeout: 90000, polling: 100 });
  return clickedAt;
}

/** Espera a que la cinemática se abra y graba hasta que se cierra y el juego queda libre (sin tocar nada). */
async function filmOpening(label, { escAfterMs = null, stills = {} } = {}) {
  await page.waitForFunction(() => window.__probe?.start !== null, { timeout: 30000, polling: 50 })
    .catch(() => problems.push(`${label}: la cinemática de apertura no empezó en 30 s`));
  const t0 = Date.now();
  let escSent = false;
  const taken = new Set();
  while (Date.now() - t0 < 60000) {
    const r = await page.evaluate(() => {
      const st = window.__qa.state();
      return { ready: st.ready, active: st.cinematic?.active, speech: st.speech, card: (window.__game.registry.get('cinematicActive') ?? 0) > 0, ended: window.__probe.end !== null };
    });
    if (escAfterMs !== null && !escSent && Date.now() - t0 >= escAfterMs) {
      escSent = true;
      await page.keyboard.press('Escape');
    }
    for (const [name, when] of Object.entries(stills)) {
      if (!taken.has(name) && when(r)) { taken.add(name); await demo.still(name); }
    }
    await stageFrame(label);
    if (r.ended && r.ready) break;
  }
  // El juego libre: unos fotogramas de Dex junto a la puerta
  for (let i = 0; i < 3; i++) await stageFrame(`${label} · libre`);
  for (const name of Object.keys(stills)) if (!taken.has(name)) problems.push(`${label}: no se pudo sacar la captura «${name}»`);
}

/** Estado final comparable (con la cámara ya asentada tras volver al jugador). */
async function finalState() {
  await page.waitForFunction(() => window.__qa.state().ready, { timeout: 20000, polling: 100 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => {
    const st = window.__qa.state();
    return { scene: st.scene, flags: st.flags, player: st.player, facing: st.facing, cinematic: st.cinematic, busy: st.busy };
  });
}

/** Resumen de una pasada: duración, textos y estimación con voz. */
async function summarize(label, scene, P) {
  const total = P && P.start !== null && P.end !== null ? Math.round(P.end - P.start) : null;
  const inCine = (P?.lines ?? []).filter((l) => P.start !== null && l.at >= P.start - 10 && (P.end === null || l.at <= P.end));
  const lines = inCine.map((l) => ({ text: l.text, speaker: l.speaker, mode: l.mode, ms: l.until !== null ? Math.round(l.until - l.at) : null, box: l.box, vw: l.vw, vh: l.vh }));
  const clips = await clipDurations(lines.map((l) => l.text));
  for (const l of lines) l.clipMs = clips[l.text];
  const allClips = lines.length > 0 && lines.every((l) => typeof l.clipMs === 'number');
  const voiced = total !== null && allClips
    ? Math.round(total - lines.reduce((a, l) => a + (l.ms ?? 0), 0) + lines.reduce((a, l) => a + l.clipMs + VOICE_TAIL_MS, 0))
    : null;
  const card = P?.card ? Math.round((P.card.until ?? P.end ?? P.card.at) - P.card.at) : null;
  const out = { label, scene, totalMs: total, voicedMs: voiced, cardMs: card, lines, seen: P?.seen ?? null };
  report.passes.push(out);
  console.log(`${label}: apertura ${secs(total)} sin voz${voiced !== null ? ` · ${secs(voiced)} con voz (clips)` : ' · con voz: aún sin clips'} · tarjeta ${secs(card)}`);
  for (const l of lines) console.log(`    [${l.speaker ?? 'player'} · ${l.mode}] ${secs(l.ms)}${l.clipMs ? ` (clip ${secs(l.clipMs)})` : ''} «${l.text}»`);
  return out;
}

function checkSeen(label, s, { wantPlayer = true } = {}) {
  if (!s) { problems.push(`${label}: sin datos de la sonda`); return; }
  if (!s.letterbox) problems.push(`${label}: no se vieron las franjas`);
  if (!s.chromeHidden) problems.push(`${label}: la interfaz no se ocultó`);
  if (!s.band) problems.push(`${label}: el narrador no habló en la franja`);
  if (!s.head) problems.push(`${label}: nadie habló sobre su cabeza`);
  if (s.camXMax - s.camXMin < 20) problems.push(`${label}: la cámara no se movió (scroll x ${s.camXMin}..${s.camXMax})`);
  if (wantPlayer && s.playerOnScreen < s.samples * 0.3) problems.push(`${label}: Dex casi no se ve (${s.playerOnScreen}/${s.samples} muestras en pantalla)`);
  if (s.speechOut.length) problems.push(`${label}: subtítulos fuera de pantalla: ${JSON.stringify(s.speechOut)}`);
}

function checkFinalOutside(label, st) {
  if (st.scene !== 'outside') problems.push(`${label}: escena ${st.scene}`);
  if (!st.flags.premise_shown || !st.flags.chapter_1_intro_shown) problems.push(`${label}: faltan premise_shown/chapter_1_intro_shown`);
  const c = st.cinematic;
  if (!c || c.active || c.letterbox || c.chromeHidden || !c.camera.following || Math.abs(c.camera.zoom - 1) > 0.01 || c.ducked) {
    problems.push(`${label}: la cinemática no dejó todo como estaba: ${JSON.stringify(c)}`);
  }
  if (!st.player || Math.hypot(st.player.x - DEX_END.x, st.player.y - DEX_END.y) > 1.5) problems.push(`${label}: Dex acabó en ${fmt(st.player)}, no junto a la puerta (${DEX_END.x},${DEX_END.y})`);
  if (st.facing !== 'left') problems.push(`${label}: Dex mira «${st.facing}», se esperaba «left»`);
  if (st.busy?.length) problems.push(`${label}: el juego no quedó libre (${st.busy.join(', ')})`);
}

function sameEnd(label, a, b, flagNames) {
  for (const f of flagNames) if (Boolean(a.flags[f]) !== Boolean(b.flags[f])) problems.push(`${label}: flag ${f} distinta (${a.flags[f]} / ${b.flags[f]})`);
  if (a.facing !== b.facing) problems.push(`${label}: mira «${b.facing}», en la entera «${a.facing}»`);
  if (!a.player || !b.player || Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y) > 0.5) problems.push(`${label}: Dex en ${fmt(b.player)}, en la entera ${fmt(a.player)}`);
  const ca = a.cinematic?.camera;
  const cb = b.cinematic?.camera;
  if (!ca || !cb || Math.abs(ca.x - cb.x) > 3 || Math.abs(ca.y - cb.y) > 3 || Math.abs(ca.zoom - cb.zoom) > 0.01 || ca.following !== cb.following) {
    problems.push(`${label}: cámara ${JSON.stringify(cb)}, en la entera ${JSON.stringify(ca)}`);
  }
  if (!b.cinematic?.skipped) problems.push(`${label}: state().cinematic.skipped no es true`);
  if (a.cinematic?.skipped) problems.push(`${label}: la entera sale como saltada`);
}

// ── 1) outside entera en 1280x720 ────────────────────────────────────────────────────────────────────────────
const clicked = await freshNewGame();
await filmOpening('1280x720 · apertura de outside (entera)', {
  stills: {
    '1280-narrador': (r) => r.active && r.speech?.mode !== 'head' && !!r.speech,
    '1280-dex-lee': (r) => r.active && r.speech?.mode === 'head',
    '1280-tarjeta': (r) => r.active && r.card,
  },
});
const fullP = await probe();
const full = await finalState();
await demo.still('1280-final');
const freeAt = await page.evaluate(() => performance.now());
const fullSum = await summarize('1280x720 entera', 'outside', fullP);
checkSeen('1280x720 entera', fullP?.seen);
checkFinalOutside('1280x720 entera', full);
const toPlayMs = Math.round(freeAt - clicked);
console.log(`    desde New Game hasta poder tocar: ${secs(toPlayMs)} (biblia: ≤ 30 s)`);
report.newGameToPlayableMs = toPlayMs;
if (toPlayMs > 30000) problems.push(`desde New Game hasta poder tocar ${secs(toPlayMs)} (> 30 s)`);
const narratorLines = fullSum.lines.filter((l) => /narrator/i.test(l.speaker ?? '')).length;
if (narratorLines > 3) problems.push(`outside: ${narratorLines} líneas de narrador (máx. 3)`);
if (fullSum.lines.some((l) => /patient zero (is|was)\b/i.test(l.text) || /\banon\b/i.test(l.text))) problems.push('outside: la apertura dice quién es Patient Zero o Anon');

// ── 2) outside saltada con Esc a ~1,5 s ──────────────────────────────────────────────────────────────────────
await freshNewGame();
await filmOpening('1280x720 · apertura de outside (Esc a 1,5 s)', { escAfterMs: 1500 });
const skipP = await probe();
const skip = await finalState();
await demo.still('1280-saltada');
const skipMs = skipP?.start != null && skipP?.end != null ? Math.round(skipP.end - skipP.start) : null;
console.log(`1280x720 saltada: cinemática abierta ${secs(skipMs)} · final jugador ${fmt(skip.player)} mira ${skip.facing} · cámara ${JSON.stringify(skip.cinematic?.camera)} (entera: ${fmt(full.player)} ${full.facing} ${JSON.stringify(full.cinematic?.camera)})`);
report.outsideSkip = { openMs: skipMs, final: skip, fullFinal: full };
checkFinalOutside('1280x720 saltada', skip);
sameEnd('outside saltada', full, skip, ['premise_shown', 'chapter_1_intro_shown']);
if (skipMs === null || skipMs > 4000) problems.push(`outside saltada: la cinemática duró ${secs(skipMs)} (el salto no fue de golpe)`);

// ── 3) outside entera en 390x844 ─────────────────────────────────────────────────────────────────────────────
await page.setViewport(PORTRAIT);
await freshNewGame();
await filmOpening('390x844 · apertura de outside (entera)', {
  stills: {
    '390-narrador': (r) => r.active && r.speech?.mode !== 'head' && !!r.speech,
    '390-dex-lee': (r) => r.active && r.speech?.mode === 'head',
    '390-tarjeta': (r) => r.active && r.card,
  },
});
const portP = await probe();
const port = await finalState();
await demo.still('390-final');
await summarize('390x844 entera', 'outside', portP);
checkSeen('390x844 entera', portP?.seen);
checkFinalOutside('390x844 entera', port);

// ── 4) lobby entero y saltado en 1280x720 ────────────────────────────────────────────────────────────────────
await page.setViewport(DESKTOP);
async function openLobby() {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await page.goto(`${demo.base}/?qa=1&scene=lobby`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__qa && !!window.__game, { timeout: 90000, polling: 100 });
  await installProbe();
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__game.registry.get('currentSceneId') === 'lobby', { timeout: 90000, polling: 100 });
}
await openLobby();
await filmOpening('1280x720 · apertura del lobby (entera)', {
  stills: {
    '1280-lobby-penny': (r) => r.active && r.speech?.mode === 'head' && /penny/i.test(r.speech?.speaker ?? ''),
    '1280-lobby-tarjeta': (r) => r.active && r.card,
  },
});
const lobbyP = await probe();
const lobby = await finalState();
const lobbySum = await summarize('1280x720 lobby entero', 'lobby', lobbyP);
checkSeen('1280x720 lobby entero', lobbyP?.seen, { wantPlayer: false });
if (!lobbySum.lines.some((l) => /penny/i.test(l.speaker ?? '') && l.mode === 'head')) problems.push('lobby: Penny no habló sobre su cabeza (¿fuera de cámara?)');
if (lobbySum.lines.filter((l) => /narrator/i.test(l.speaker ?? '')).length > 3) problems.push('lobby: más de 3 líneas de narrador');
if (!lobby.flags.chapter_2_intro_shown) problems.push('lobby entero: falta chapter_2_intro_shown');

await openLobby();
await filmOpening('1280x720 · apertura del lobby (Esc a 1,5 s)', { escAfterMs: 1500 });
const lobbySkipP = await probe();
const lobbySkip = await finalState();
await demo.still('1280-lobby-saltada');
const lobbySkipMs = lobbySkipP?.start != null && lobbySkipP?.end != null ? Math.round(lobbySkipP.end - lobbySkipP.start) : null;
console.log(`1280x720 lobby saltado: cinemática abierta ${secs(lobbySkipMs)} · final jugador ${fmt(lobbySkip.player)} mira ${lobbySkip.facing}`);
sameEnd('lobby saltado', lobby, lobbySkip, ['chapter_2_intro_shown']);
if (lobbySkipMs === null || lobbySkipMs > 4000) problems.push(`lobby saltado: la cinemática duró ${secs(lobbySkipMs)}`);

// ── Duraciones ───────────────────────────────────────────────────────────────────────────────────────────────
for (const [sum, scene] of [[fullSum, 'outside'], [lobbySum, 'lobby']]) {
  const limit = LIMITS[scene];
  if (sum.totalMs === null) problems.push(`${scene}: no se pudo medir la apertura`);
  else if (sum.voicedMs !== null && sum.voicedMs > limit) problems.push(`${scene}: con voz dura ${secs(sum.voicedMs)} (> ${secs(limit)})`);
  else if (sum.voicedMs === null && sum.totalMs > limit + 3000) problems.push(`${scene}: sin voz dura ${secs(sum.totalMs)} (muy por encima de ${secs(limit)})`);
}
report.durations = {
  outside: { silentMs: fullSum.totalMs, voicedMs: fullSum.voicedMs, limitMs: LIMITS.outside },
  lobby: { silentMs: lobbySum.totalMs, voicedMs: lobbySum.voicedMs, limitMs: LIMITS.lobby },
};
console.log(`duración: outside ${secs(fullSum.totalMs)} sin voz / ${secs(fullSum.voicedMs)} con voz (≤ 20 s) · lobby ${secs(lobbySum.totalMs)} sin voz / ${secs(lobbySum.voicedMs)} con voz (≤ 12 s)`);

await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
report.problems = problems;
writeFileSync(join(demo.dir, 'opening.json'), JSON.stringify(report, null, 2));
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

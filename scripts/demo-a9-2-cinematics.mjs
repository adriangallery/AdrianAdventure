// Demo de A9.2 (regla visual del plan SCUMM): las entradas de los capítulos 3, 4 y 5 como cinemática A2.10, en
// `basement`, `mountain` y `treatment_room`, en 844x390 (móvil apaisado) y 390x844 (móvil vertical), ambos táctiles.
// Para cada escena y viewport:
//   1) partida limpia (localStorage vacío) en `clinic_exterior`, lo previo puesto por __qa.runScript (cap. 1–3 hechos;
//      para el treatment_room también el 4) y SIN la flag de la entrada; se entra con el mismo `gotoScene` del juego y
//      se deja correr la cinemática entera sin tocar nada. Se mide con reloj real (sonda en la página cada 50 ms) desde
//      que se abre hasta que se cierra; con los MP3 de voz ya generados se calcula además la duración con voz (lo
//      medido, cambiando el tiempo de cada texto por su clip + 300 ms, como A3.2). Falla si alguna pasa de 20 s.
//      Capturas `<vp>-<escena>-1.png` (narrador), `-2.png` (Dex) y `-3.png` (tarjeta del capítulo).
//      Al acabar: `state().cinematic` inactiva, sin franjas, interfaz de vuelta, cámara siguiendo con zoom 1, la flag
//      del capítulo puesta y Dex donde entró (o, si la escena lo declara con `endAt`, donde lo deja la cinemática:
//      A9.11, en mountain Dex sale de la maleza de primer plano hasta 70/93 para hablar con el cuerpo entero a la vista).
//   2) la misma entrada saltada con Esc (tecla real) en cuanto se abre: mismas flags y misma posición que la entera.
//   Durante la cinemática: ningún subtítulo se sale de la pantalla ni se ve con la tarjeta del capítulo (que es de
//   pantalla completa) y, cuando Dex habla sobre su cabeza, Dex está dentro del encuadre.
// Duraciones en `log.txt` y en `cinematics.json`.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a9-2-cinematics
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDemo } from './lib/demo.mjs';

const STAGE = { width: 880, height: 900 };
const VIEWPORTS = [
  { id: '844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];
const SCENES = [
  { id: 'basement', flag: 'chapter_3_intro_shown', before: ['chapter_1_complete', 'chapter_2_complete', 'chapter_2_intro_shown'] },
  { id: 'mountain', flag: 'chapter_4_intro_shown', before: ['chapter_1_complete', 'chapter_2_complete', 'chapter_3_complete', 'chapter_3_intro_shown'], endAt: { x: 70, y: 93 } },
  { id: 'treatment_room', flag: 'chapter_5_intro_shown', before: ['chapter_1_complete', 'chapter_2_complete', 'chapter_3_complete', 'chapter_4_complete', 'treatment_room_unlocked', 'chapter_4_intro_shown'], hiddenPlayer: true },
];
const LIMIT_MS = 20000;
const VOICE_TAIL_MS = 300; // el de src/systems/Cinematics.ts
const START_SCENE = 'clinic_exterior';

const demo = await startDemo(import.meta.url, { fps: 5, width: 600, viewport: VIEWPORTS[0] });
const { page, browser } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
const problems = [];
const report = { passes: [] };
const fmt = (p) => (p ? `${p.x.toFixed(2)},${p.y.toFixed(2)}` : '?');
const secs = (ms) => (ms == null ? '?' : `${(ms / 1000).toFixed(1)} s`);

// Lienzo fijo para el GIF: los dos viewports en el mismo tamaño de fotograma
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
 * Sonda en la página (cada 50 ms, solo en la escena `sceneId`): apertura y cierre de la cinemática, posición de Dex al
 * abrirse, textos en pantalla, tarjeta del capítulo, subtítulos fuera de pantalla o sobre la tarjeta y si Dex está en
 * el encuadre cuando habla sobre su cabeza.
 */
async function installProbe(sceneId) {
  await page.evaluate((sceneId) => {
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    const P = { start: null, end: null, startPlayer: null, lines: [], card: null, seen: { letterbox: false, chromeHidden: false, samples: 0, speechOut: [], speechOnCard: [], dexHeadOff: [], dexHeadSamples: 0 } };
    window.__probe = P;
    let cur = null;
    window.__probeTimer = setInterval(() => {
      const g = window.__game;
      if (!g || !window.__qa || !g.scene.isActive('GameScene') || g.registry.get('currentSceneId') !== sceneId) return;
      let st;
      try { st = window.__qa.state(); } catch { return; }
      const now = performance.now();
      const c = st.cinematic;
      if (c?.active && P.start === null) { P.start = now; P.startPlayer = st.player ? { ...st.player } : null; }
      if (P.start !== null && P.end === null && c && !c.active && c.ended >= 1) P.end = now;
      const sp = st.speech;
      const text = sp?.text ?? null;
      if (text !== (cur?.text ?? null)) {
        if (cur) cur.until = now;
        cur = text ? { text, speaker: sp.speaker, mode: sp.mode, at: now, until: null } : null;
        if (cur) P.lines.push(cur);
      }
      if (!c?.active) return;
      P.seen.samples++;
      if (c.letterbox) P.seen.letterbox = true;
      if (c.chromeHidden) P.seen.chromeHidden = true;
      const cardOn = (g.registry.get('cinematicActive') ?? 0) > 0;
      if (cardOn && !P.card) P.card = { at: now, until: null };
      if (!cardOn && P.card && P.card.until === null) P.card.until = now;
      if (!sp) return;
      if (cardOn && P.seen.speechOnCard.length < 5) P.seen.speechOnCard.push(sp.text.slice(0, 40));
      const vw = g.scale.width;
      const vh = g.scale.height;
      if ((sp.x - sp.w / 2 < -1 || sp.x + sp.w / 2 > vw + 1 || sp.y < -1 || sp.y + sp.h > vh + 1) && P.seen.speechOut.length < 5) {
        P.seen.speechOut.push({ text: sp.text.slice(0, 40), mode: sp.mode, x: Math.round(sp.x), y: Math.round(sp.y), w: Math.round(sp.w), h: Math.round(sp.h), vw, vh });
      }
      if (sp.mode === 'head' && !sp.speaker) {
        const gs = g.scene.getScene('GameScene');
        const v = gs.cameras.main.worldView;
        const p = gs.player;
        if (p && p.visible) {
          P.seen.dexHeadSamples++;
          const headY = p.y - p.displayHeight * 0.8;
          if (!(p.x >= v.x && p.x <= v.right && headY >= v.y && p.y <= v.bottom + 2) && P.seen.dexHeadOff.length < 5) {
            P.seen.dexHeadOff.push({ px: Math.round(p.x), py: Math.round(p.y), view: [Math.round(v.x), Math.round(v.y), Math.round(v.width), Math.round(v.height)] });
          }
        }
      }
    }, 50);
  }, sceneId);
}

const probe = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__probe ?? null)));

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

/** Partida limpia en clinic_exterior, lo previo puesto, y entrada en la escena con el gotoScene del juego. */
async function enter(scene) {
  await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* nada */ } });
  await demo.openScene(START_SCENE);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  const vp = page.viewport();
  if (!(await demo.settle({ tap: [Math.round(vp.width / 2), 40] }))) await demo.fail(`${START_SCENE} no quedó libre al entrar`);
  await page.evaluate((flags) => window.__qa.runScript(flags.map((flag) => ({ op: 'setFlag', flag, value: true }))), scene.before);
  const pre = await page.evaluate((f) => window.__qa.state().flags[f], scene.flag);
  if (pre) problems.push(`${scene.id}: la flag ${scene.flag} ya estaba puesta antes de entrar`);
  await installProbe(scene.id);
  await page.evaluate((id) => window.__game.scene.getScene('GameScene').qaGoto(id), scene.id);
  await page.waitForFunction(() => window.__probe?.start !== null, { timeout: 30000, polling: 50 })
    .catch(() => problems.push(`${scene.id}: la cinemática de entrada no empezó en 30 s`));
}

/** Graba hasta que la cinemática se cierra y el juego queda libre (sin tocar nada, o con Esc al primer instante). */
async function film(label, { esc = false, stills = {} } = {}) {
  const t0 = Date.now();
  let escSent = false;
  const taken = new Set();
  // Las capturas, con el texto ya escrito: cada texto (y la tarjeta) lleva `held` ms en pantalla
  let lastKey = null;
  let since = Date.now();
  while (Date.now() - t0 < 60000) {
    if (esc && !escSent) { escSent = true; await page.keyboard.press('Escape'); }
    const r = await page.evaluate(() => {
      const st = window.__qa.state();
      return { ready: st.ready, active: st.cinematic?.active, speech: st.speech, card: (window.__game.registry.get('cinematicActive') ?? 0) > 0, ended: window.__probe.end !== null };
    });
    const key = r.card ? '#card' : (r.speech?.text ?? null);
    if (key !== lastKey) { lastKey = key; since = Date.now(); }
    r.held = Date.now() - since;
    for (const [name, when] of Object.entries(stills)) {
      if (!taken.has(name) && when(r)) { taken.add(name); await demo.still(name); }
    }
    await stageFrame(label);
    if (r.ended && r.ready) break;
  }
  for (let i = 0; i < 2; i++) await stageFrame(`${label} · libre`);
  for (const name of Object.keys(stills)) if (!taken.has(name)) problems.push(`${label}: no se pudo sacar la captura «${name}»`);
}

async function finalState() {
  await page.waitForFunction(() => window.__qa.state().ready, { timeout: 20000, polling: 100 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  // Tras la cinemática puede quedar una frase suelta de Dex (A9.10: «I leave behind…» al cerrar capítulo): se espera a que acabe
  // (los textos fuera de cinemática esperan al jugador: se pasan con Esc, que no hace andar a Dex como un toque)
  for (let i = 0; i < 12; i++) {
    const busy = await page.evaluate(() => window.__qa.state().busy?.length ?? 0);
    if (!busy) break;
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 600));
  }
  return page.evaluate(() => {
    const st = window.__qa.state();
    return { scene: st.scene, flags: st.flags, player: st.player, facing: st.facing, cinematic: st.cinematic, busy: st.busy };
  });
}

function checkFinal(label, scene, st, P) {
  if (st.scene !== scene.id) problems.push(`${label}: escena ${st.scene}`);
  if (!st.flags[scene.flag]) problems.push(`${label}: falta ${scene.flag}`);
  const c = st.cinematic;
  if (!c || c.active || c.letterbox || c.chromeHidden || !c.camera.following || Math.abs(c.camera.zoom - 1) > 0.01 || c.ducked) {
    problems.push(`${label}: la cinemática no dejó todo como estaba (interfaz/cámara): ${JSON.stringify(c)}`);
  }
  if (st.busy?.length) problems.push(`${label}: el juego no quedó libre (${st.busy.join(', ')})`);
  const a = scene.endAt ?? P?.startPlayer;
  if (!a || !st.player || Math.hypot(a.x - st.player.x, a.y - st.player.y) > 0.5) problems.push(`${label}: Dex ${scene.endAt ? 'debía acabar' : 'entró'} en ${fmt(a)} y acabó en ${fmt(st.player)}`);
}

function sameEnd(label, a, b) {
  const keys = new Set([...Object.keys(a.flags), ...Object.keys(b.flags)]);
  for (const f of keys) if (JSON.stringify(a.flags[f] ?? null) !== JSON.stringify(b.flags[f] ?? null)) problems.push(`${label}: flag ${f} distinta (entera ${a.flags[f]} / saltada ${b.flags[f]})`);
  if (!a.player || !b.player || Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y) > 0.5) problems.push(`${label}: Dex en ${fmt(b.player)}, en la entera ${fmt(a.player)}`);
  if (a.facing !== b.facing) console.log(`    (nota) ${label}: mira «${b.facing}», en la entera «${a.facing}» (la entera lo gira con actorFace)`);
  if (!b.cinematic?.skipped) problems.push(`${label}: state().cinematic.skipped no es true`);
  if (a.cinematic?.skipped) problems.push(`${label}: la entera sale como saltada`);
}

async function summarize(label, scene, P) {
  const total = P && P.start !== null && P.end !== null ? Math.round(P.end - P.start) : null;
  const inCine = (P?.lines ?? []).filter((l) => P.start !== null && l.at >= P.start - 10 && (P.end === null || l.at <= P.end));
  const lines = inCine.map((l) => ({ text: l.text, speaker: l.speaker, mode: l.mode, ms: l.until !== null ? Math.round(l.until - l.at) : null }));
  const clips = await clipDurations(lines.map((l) => l.text));
  for (const l of lines) l.clipMs = clips[l.text];
  const allClips = lines.length > 0 && lines.every((l) => typeof l.clipMs === 'number');
  const voiced = total !== null && allClips
    ? Math.round(total - lines.reduce((a, l) => a + (l.ms ?? 0), 0) + lines.reduce((a, l) => a + l.clipMs + VOICE_TAIL_MS, 0))
    : null;
  const card = P?.card ? Math.round((P.card.until ?? P.end ?? P.card.at) - P.card.at) : null;
  const out = { label, scene: scene.id, totalMs: total, voicedMs: voiced, cardMs: card, lines, seen: P?.seen ?? null };
  report.passes.push(out);
  console.log(`${label}: ${secs(total)} reloj real${voiced !== null ? ` · ${secs(voiced)} con voz (clips)` : ' · con voz: sin clips'} · tarjeta ${secs(card)}`);
  for (const l of lines) console.log(`    [${l.speaker ?? 'Dex'} · ${l.mode}] ${secs(l.ms)}${l.clipMs ? ` (clip ${secs(l.clipMs)})` : ''} «${l.text}»`);
  if (total === null) problems.push(`${label}: no se pudo medir la duración`);
  else if (Math.max(total, voiced ?? 0) > LIMIT_MS) problems.push(`${label}: dura ${secs(Math.max(total, voiced ?? 0))} (> 20 s)`);
  const s = P?.seen;
  if (!s) problems.push(`${label}: sin datos de la sonda`);
  else {
    if (!s.letterbox) problems.push(`${label}: no se vieron las franjas`);
    if (!s.chromeHidden) problems.push(`${label}: la interfaz no se ocultó`);
    if (s.speechOut.length) problems.push(`${label}: subtítulos fuera de pantalla: ${JSON.stringify(s.speechOut)}`);
    if (s.speechOnCard.length) problems.push(`${label}: subtítulos sobre la tarjeta del capítulo: ${JSON.stringify(s.speechOnCard)}`);
    if (s.dexHeadOff.length) problems.push(`${label}: Dex habla fuera del encuadre: ${JSON.stringify(s.dexHeadOff)}`);
    if (!scene.hiddenPlayer && s.dexHeadSamples === 0) problems.push(`${label}: Dex no habló sobre su cabeza`);
  }
  if (!lines.some((l) => /narrator/i.test(l.speaker ?? ''))) problems.push(`${label}: no habló el narrador`);
  if (!lines.some((l) => !l.speaker)) problems.push(`${label}: no habló Dex`);
  if (!P?.card) problems.push(`${label}: no se vio la tarjeta del capítulo`);
  return out;
}

const durations = {};
for (const vp of VIEWPORTS) {
  await page.setViewport(vp);
  for (const scene of SCENES) {
    const tag = `${vp.id} · ${scene.id}`;
    // 1) entera
    await enter(scene);
    await film(`${tag} (entera)`, {
      stills: {
        [`${vp.id}-${scene.id}-1`]: (r) => r.active && !!r.speech && /narrator/i.test(r.speech.speaker ?? '') && !r.card && r.held >= 2000,
        [`${vp.id}-${scene.id}-2`]: (r) => r.active && !!r.speech && !r.speech.speaker && !r.card && r.held >= 2000,
        [`${vp.id}-${scene.id}-3`]: (r) => r.active && r.card && r.held >= 1200,
      },
    });
    const fullP = await probe();
    const full = await finalState();
    const sum = await summarize(`${tag} entera`, scene, fullP);
    checkFinal(`${tag} entera`, scene, full, fullP);
    durations[`${vp.id} ${scene.id}`] = { realMs: sum.totalMs, voicedMs: sum.voicedMs };
    // 2) saltada con Esc al primer instante
    await enter(scene);
    await film(`${tag} (Esc)`, { esc: true });
    const skipP = await probe();
    const skip = await finalState();
    const skipMs = skipP?.start != null && skipP?.end != null ? Math.round(skipP.end - skipP.start) : null;
    console.log(`${tag} saltada: abierta ${secs(skipMs)} · Dex ${fmt(skip.player)} (entera ${fmt(full.player)}) · mira ${skip.facing} (entera ${full.facing})`);
    checkFinal(`${tag} saltada`, scene, skip, skipP);
    sameEnd(`${tag} saltada`, full, skip);
    if (skipMs === null || skipMs > 4000) problems.push(`${tag} saltada: la cinemática duró ${secs(skipMs)} (el salto no fue de golpe)`);
  }
}

console.log('duraciones (reloj real / con voz estimada por clips; límite 20 s):');
for (const [k, d] of Object.entries(durations)) console.log(`    ${k}: ${secs(d.realMs)} / ${secs(d.voicedMs)}`);
report.durations = durations;

await demo.end();
if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
report.problems = problems;
writeFileSync(join(demo.dir, 'cinematics.json'), JSON.stringify(report, null, 2));
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

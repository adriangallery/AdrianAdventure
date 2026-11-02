// Demo de A4.2 (regla visual del plan SCUMM): vida en las NPC.
// Con el sonido activado (localStorage adrian_adventure_muted = false: las frases con voz descargan su clip), ?qa=1
// (parpadeos y cadencia de la boca con semilla fija) y 1280x720 (el GIF: un recorte de 960x540 centrado entre Dex y la
// NPC, con una línea de estado arriba); luego 390x844 (capturas fijas):
//   1) lobby: Dex habla con Penny (clic derecho = hablar): ella le mira, la boca alterna `_talk` al ritmo del clip de voz
//      (o, sin clip, lo que se tardaría en decirlo) y se cierra en las pausas y al acabar el clip; el texto rosa va sobre
//      su cabeza y no salta con la respiración;
//   2) lobby: 9 s de reposo: respira (1 píxel de arte, ciclo de 3,6 s) y parpadea (aplastado de 1 píxel de arte);
//   3) clinic_interior: Dex llega por la izquierda y por la derecha del Dr. Satoshi y él se gira cada vez (en el lobby
//      Penny está detrás del mostrador, a la izquierda de toda la zona que se pisa: Dex no puede ponerse a su izquierda);
//   4) 390x844: lobby, Penny hablando (captura fija).
// Comprueba por la API de QA (`state().npcLife`, `state().speech`, `state().pixel`) que:
//   - mientras Penny tiene su texto en pantalla `talking` es true, la boca se abre y se cierra (≥ 4 aperturas) y mira a
//     Dex; con el clip ya terminado y el texto aún abierto, la boca está cerrada; al acabar vuelve al reposo;
//   - la cabeza del texto (speech.head.headY) no se mueve dentro de una frase (la respiración no la arrastra);
//   - en reposo la respiración toma 0 y 1 píxel y hay al menos un parpadeo en 9 s, con la boca cerrada;
//   - el Dr. Satoshi mira a la izquierda (espejado) con Dex a su izquierda y a la derecha con Dex a su derecha, y vuelve
//     a su orientación por defecto (derecha) al acabar;
//   - la escala de las NPC sigue entera (A2.8) en 1280x720.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-2-npc-life
import { startDemo, sleep } from './lib/demo.mjs';

const CLIP = { width: 960, height: 540 };
const PREFER = ['the tour', 'come back later', 'goodbye', 'interesting. thanks', 'forget i asked'];

const demo = await startDemo(import.meta.url, { fps: 6, width: 640, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
// Sonido activado (primera visita = silencio, A1.5): así las frases de Penny descargan y suenan con su clip
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adrian_adventure_muted', 'false'); } catch { /* sin storage */ } });
const problems = [];
const notes = [];
let filming = true;

const fmtN = (n) => (n ? `${n.id}: mira ${n.facing}${n.mirrored ? ' (espejo)' : ''} · ${n.talking ? 'HABLA' : 'calla'} · boca ${n.mouthOpen ? 'ABIERTA' : 'cerrada'} · resp ${n.breathPx}px · parpadeos ${n.blinkCount}${n.blinking ? ' (parpadea)' : ''} · giros ${n.turns}${n.engaged ? ' · conversación' : ''}` : '?');

async function open(scene, width) {
  await demo.openScene(scene);
  await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
  if (!(await demo.settle({ tap: [Math.round(width / 2), 40] }))) await demo.fail(`La escena ${scene} no quedó libre`);
  await page.evaluate(() => {
    window.__demoRun = (p) => {
      window.__demoDone = false;
      window.__demoErr = null;
      p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
    };
  });
}

/** Estado + clip de voz + línea de estado (DOM sobre el lienzo) + recorte entre Dex y la NPC; un fotograma si se graba. */
async function capture(label, npcId, { shot = filming } = {}) {
  const r = await page.evaluate((label, npcId, cw, ch) => {
    const st = window.__qa.state();
    const gs = window.__game.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const npc = gs.npcs.find((n) => n.npcId === npcId);
    const sx = (wx) => (wx - cam.scrollX) * cam.zoom;
    const px = sx(gs.player.x);
    const nx = npc ? sx(npc.x) : px;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(cw, vw);
    const h = Math.min(ch, vh);
    const mid = (px + nx) / 2;
    const x = Math.max(0, Math.min(vw - w, Math.round(mid - w / 2)));
    const y = Math.max(0, Math.min(vh - h, Math.round(vh * 0.62 - h / 2)));
    const voice = window.__game.registry.get('voiceSystem');
    const clip = voice?.clipInfo?.() ?? null;
    let cap = document.getElementById('demo-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.id = 'demo-cap';
      cap.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:15px monospace;color:#fff;background:rgba(10,10,20,.72);padding:4px 8px;white-space:pre';
      document.body.appendChild(cap);
    }
    const n = (st.npcLife ?? []).find((x) => x.id === npcId);
    const voz = clip && st.speech && clip.text === st.speech.text
      ? (clip.playing ? 'voz: SUENA' : clip.loading ? 'voz: cargando' : clip.durationMs ? 'voz: terminó' : 'sin voz')
      : st.speech ? 'sin voz' : '';
    cap.style.left = `${x + 6}px`;
    cap.style.top = `${y + 6}px`;
    cap.textContent = `${label}\n${n ? `${n.id.replace('npc_', '')}: mira ${n.facing} · ${n.talking ? 'HABLA' : 'calla'} · boca ${n.mouthOpen ? 'ABIERTA' : 'cerrada'} · resp ${n.breathPx}px · parpadeos ${n.blinkCount}${n.blinking ? ' *' : ''}` : ''}${voz ? ` · ${voz}` : ''}`;
    return { st, clip, npcOnScreen: nx >= 0 && nx <= vw, region: { x, y, width: w, height: h } };
  }, label, npcId, CLIP.width, CLIP.height);
  if (shot) await demo.shot({ clip: r.region });
  return r;
}

const npcOf = (st, id) => (st.npcLife ?? []).find((n) => n.id === id) ?? null;

/** Lanza una acción de __qa (sin esperarla) y graba hasta que termine */
async function during(label, npcId, start, args = [], maxMs = 45000) {
  await page.evaluate(start, ...args);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await capture(label, npcId);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  return page.evaluate(() => window.__demoErr);
}

/**
 * Conversación con una NPC como un jugador que escucha: clic derecho (hablar), deja cada frase hasta que acaba su clip
 * (+700 ms con el texto aún abierto: ahí la boca tiene que estar cerrada) o, sin clip, lo que se tardaría en decirla, y
 * elige las respuestas de PREFER. Muestrea la vida de la NPC en cada fotograma.
 */
async function converse(tag, label, npcId, { maxMs = 90000 } = {}) {
  const why = await page.evaluate((id) => window.__game.scene.getScene('GameScene').qaTapNpc(id, { button: 'right' }), npcId);
  if (why) { problems.push(`${tag}: no se pudo hablar con ${npcId}: ${why}`); return null; }
  const seen = {
    talkingFrames: 0, openFrames: 0, closedFrames: 0, faced: new Set(), mirrored: new Set(), lines: new Map(),
    closedAfterClip: 0, openAfterClip: 0, still: false, colors: new Set(), modes: new Set(), start: null, voiced: 0, unvoiced: 0,
  };
  let line = null;
  let lineAt = 0;
  let clipEndAt = 0;
  let idle = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { st, clip, region } = await capture(label, npcId);
    const n = npcOf(st, npcId);
    seen.start ??= n;
    const sp = st.speech;
    const mine = sp && sp.kind === 'npc' && n?.talking;
    if (n?.engaged || n?.talking) { seen.faced.add(n.facing); seen.mirrored.add(n.mirrored); }
    if (mine) {
      seen.talkingFrames++;
      if (n.mouthOpen) seen.openFrames++; else seen.closedFrames++;
      seen.colors.add(sp.color);
      seen.modes.add(sp.mode);
      const heads = seen.lines.get(sp.text) ?? [];
      if (sp.head) heads.push(sp.head.headY);
      seen.lines.set(sp.text, heads);
      if (!seen.still && n.mouthOpen) { seen.still = true; await demo.still(tag, { clip: region }); }
    }
    if (st.choices?.length) {
      idle = 0;
      line = null;
      const opts = st.choices;
      let idx = -1;
      for (const want of PREFER) {
        idx = opts.findIndex((o) => o.text.toLowerCase().includes(want) && !o.locked);
        if (idx >= 0) break;
      }
      if (idx < 0) idx = opts.length - 1;
      await page.evaluate((i) => window.__game.scene.getScene('UIScene').getChoicePanel().choose(i), idx);
      await sleep(250);
      continue;
    }
    if (sp) {
      idle = 0;
      if (sp.text !== line) { line = sp.text; lineAt = Date.now(); clipEndAt = 0; }
      const ownClip = clip && clip.text === sp.text;
      if (ownClip && clip.durationMs && !clip.playing && !clip.loading) clipEndAt ||= Date.now();
      if (mine && clipEndAt && Date.now() - clipEndAt > 250) {
        if (n.mouthOpen) seen.openAfterClip++; else seen.closedAfterClip++;
      }
      const budget = Math.max(900, Math.min(6000, sp.text.length * 55));
      const done = sp.kind !== 'npc'
        ? Date.now() - lineAt > 900
        : ownClip && (clip.playing || clip.loading)
          ? false
          : clipEndAt ? Date.now() - clipEndAt > 700 : Date.now() - lineAt > budget + 700;
      if (done || Date.now() - lineAt > 15000) {
        if (sp.kind === 'npc') { if (clipEndAt) seen.voiced++; else seen.unvoiced++; }
        await page.evaluate(() => window.__game.scene.getScene('GameScene').qaSyntheticTap());
        await sleep(120);
      }
      continue;
    }
    const busy = await page.evaluate(() => window.__qa.state().busy);
    if (!busy.length && !n?.talking) { if (++idle >= 3) break; } else idle = 0;
  }
  // Al soltar la conversación (RELEASE_MS = 500 ms) vuelve al reposo
  await sleep(700);
  const { st } = await capture(`${label}: fin`, npcId);
  const end = npcOf(st, npcId);
  const lt = end?.lastTalk;
  const headSpread = Math.max(0, ...[...seen.lines.values()].filter((h) => h.length > 1).map((h) => Math.max(...h) - Math.min(...h)));
  console.log(`${tag}: líneas ${seen.lines.size} (con clip ${seen.voiced}, sin voz ${seen.unvoiced}) · fotogramas hablando ${seen.talkingFrames} (boca abierta ${seen.openFrames}, cerrada ${seen.closedFrames}) · tras el clip: cerrada ${seen.closedAfterClip}, abierta ${seen.openAfterClip} · miraba ${[...seen.faced].join('/')} · color ${[...seen.colors].join('/')} · modo ${[...seen.modes].join('/')} · cabeza del texto: oscilación máx ${headSpread.toFixed(2)} px`);
  console.log(`${tag}: lastTalk ${JSON.stringify(lt)} → ${fmtN(end)}`);
  if (!seen.talkingFrames) problems.push(`${tag}: la NPC nunca tuvo talking = true con su texto en pantalla`);
  if (!lt) problems.push(`${tag}: sin lastTalk`);
  else {
    if (lt.mouthMoves < 4) problems.push(`${tag}: la boca solo se abrió ${lt.mouthMoves} veces`);
    if (!lt.facedPlayer) problems.push(`${tag}: no miraba a Dex al hablar (miraba ${lt.faced})`);
  }
  if (!seen.openFrames || !seen.closedFrames) problems.push(`${tag}: la boca no alternó (abierta ${seen.openFrames}, cerrada ${seen.closedFrames} fotogramas)`);
  if (seen.openAfterClip > 1) problems.push(`${tag}: boca abierta en ${seen.openAfterClip} fotogramas con el clip ya terminado`);
  if (headSpread > 1) problems.push(`${tag}: la cabeza del texto se movió ${headSpread.toFixed(2)} px dentro de una frase`);
  if (!seen.modes.has('head')) problems.push(`${tag}: el texto no fue sobre su cabeza (modos ${[...seen.modes].join('/')})`);
  if (!end?.rest || end.talking || end.mouthOpen) problems.push(`${tag}: no volvió al reposo (${fmtN(end)})`);
  if (end && end.facing !== end.defaultFacing) problems.push(`${tag}: al acabar mira ${end.facing}, su orientación por defecto es ${end.defaultFacing}`);
  return { seen, lt, end };
}

/** Reposo grabado: respiración y parpadeos */
async function rest(tag, label, npcId, ms) {
  const before = npcOf((await capture(label, npcId)).st, npcId);
  const breath = new Set();
  let blinkStill = false;
  let mouth = false;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { st, region } = await capture(label, npcId);
    const n = npcOf(st, npcId);
    if (!n) continue;
    breath.add(n.breathPx);
    if (n.mouthOpen || n.talking) mouth = true;
    if (n.blinking && !blinkStill) { blinkStill = true; await demo.still(`${tag}-parpadeo`, { clip: region }); }
  }
  const { st } = await capture(label, npcId);
  const after = npcOf(st, npcId);
  const blinks = (after?.blinkCount ?? 0) - (before?.blinkCount ?? 0);
  console.log(`${tag}: respiración ${[...breath].sort().join('/')} px · parpadeos ${blinks} en ${ms / 1000} s · pixel NPC ${JSON.stringify(st.pixel?.npcs)} → ${fmtN(after)}`);
  if (!(breath.has(0) && breath.has(1))) problems.push(`${tag}: la respiración no pasó por 0 y 1 px (${[...breath].join('/')})`);
  if (blinks < 1) problems.push(`${tag}: ningún parpadeo en ${ms / 1000} s`);
  if (mouth) problems.push(`${tag}: la boca se movió en reposo`);
  if (st.pixel?.npcs?.some((n) => !n.integer)) problems.push(`${tag}: escala de NPC no entera (${JSON.stringify(st.pixel.npcs)})`);
}

// ── 1) y 2) lobby, 1280x720 ─────────────────────────────────────────────────────────────────────────────────────
await open('lobby', 1280);
{
  const { st } = await capture('lobby 1280x720', 'npc_receptionist');
  console.log(`inicio: ${fmtN(npcOf(st, 'npc_receptionist'))} · jugador ${st.player?.x?.toFixed(1)},${st.player?.y?.toFixed(1)}`);
  if (!st.npcLife) await demo.fail('state().npcLife no existe (API de QA anterior a A4.2)');
}
let err = await during('1) Dex se acerca al mostrador', 'npc_receptionist', () => window.__demoRun(window.__qa.walk(44, 92)));
if (err) problems.push(`walk lobby: ${err}`);
const penny = await converse('penny', '1) habla con Penny: boca con la voz, texto rosa sobre su cabeza', 'npc_receptionist');
if (penny?.lt) {
  notes.push(`Penny: boca ${penny.lt.voice === 'clip' ? 'con el clip de voz' : 'sin voz (sin clip)'}${penny.lt.level ? ' y el nivel del analizador' : ''}`);
  if (penny.lt.voice !== 'clip') notes.push('aviso: ninguna frase de Penny sonó con su clip (audio no disponible en el navegador headless): la boca siguió el texto');
}
await rest('reposo', '2) reposo: respira (1 px) y parpadea', 'npc_receptionist', 9000);
{
  const { region } = await capture('lobby', 'npc_receptionist', { shot: false });
  await demo.still('full', { clip: region });
}

// ── 3) clinic_interior: Dex por la izquierda y por la derecha del Dr. Satoshi ───────────────────────────────────
await open('clinic_interior', 1280);
const SAT = 'npc_dr_satoshi';
for (const [tag, x, side] of [['satoshi-izquierda', 62, 'left'], ['satoshi-derecha', 90, 'right']]) {
  err = await during(`3) Dex a la ${side === 'left' ? 'izquierda' : 'derecha'} del doctor`, SAT, (x) => window.__demoRun(window.__qa.walk(x, 98)), [x]);
  if (err) problems.push(`${tag}: walk falló: ${err}`);
  const before = npcOf((await capture('3)', SAT)).st, SAT);
  const r = await converse(tag, `3) Dex habla desde la ${side === 'left' ? 'izquierda' : 'derecha'}: se gira hacia él`, SAT);
  if (r) {
    if (!r.seen.faced.has(side) || r.seen.faced.size !== 1) problems.push(`${tag}: en la conversación miró ${[...r.seen.faced].join('/')}, se esperaba solo ${side}`);
    if (r.lt?.faced !== side) problems.push(`${tag}: lastTalk.faced ${r.lt?.faced}, se esperaba ${side}`);
    if (side === 'left' && !r.seen.mirrored.has(true)) problems.push(`${tag}: no se espejó para mirar a la izquierda`);
    if (side === 'left' && !(r.end.turns > (before?.turns ?? 0))) problems.push(`${tag}: turns no subió (${before?.turns} → ${r.end.turns})`);
  }
}
await rest('reposo-clinica', '3) reposo', SAT, 3000);

// ── 4) 390x844 (captura fija con Penny hablando) ────────────────────────────────────────────────────────────────
filming = false;
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open('lobby', 390);
{
  const why = await page.evaluate(() => window.__game.scene.getScene('GameScene').qaTapNpc('npc_receptionist', { button: 'right' }));
  if (why) problems.push(`390x844: no se pudo hablar con Penny: ${why}`);
  let shot = false;
  for (let i = 0; i < 80 && !shot; i++) {
    const { st, npcOnScreen } = await capture('390x844', 'npc_receptionist', { shot: false });
    const n = npcOf(st, 'npc_receptionist');
    if (n?.talking && n.mouthOpen) {
      await demo.still('390x844');
      shot = true;
      console.log(`390x844: Penny ${npcOnScreen ? 'en pantalla' : 'FUERA de pantalla'} · texto «${st.speech?.text?.slice(0, 40)}…» modo ${st.speech?.mode} · ${fmtN(n)}`);
    }
    await sleep(100);
  }
  if (!shot) { await demo.still('390x844'); problems.push('390x844: Penny no llegó a hablar con la boca abierta'); }
  if (!(await demo.settle({ tap: [195, 40] }))) problems.push('390x844: la escena no quedó libre');
}
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

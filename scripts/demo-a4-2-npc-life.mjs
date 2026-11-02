// Demo de A4.2 (regla visual del plan SCUMM): vida en las NPC.
// Con el sonido activado (localStorage adrian_adventure_muted = false: las frases con voz descargan su clip), ?qa=1
// (parpadeos y cadencia de la boca con semilla fija) y 1280x720 (el GIF: un recorte de 960x540 centrado entre Dex y la
// NPC, con una línea de estado arriba); luego 390x844 (capturas fijas):
//   1) lobby: Dex habla con Penny (clic derecho = hablar): ella le mira, la boca alterna `_talk` al ritmo del clip de voz
//      (o, sin clip, lo que se tardaría en decirlo) y se cierra en las pausas y al acabar el clip; el texto rosa va sobre
//      su cabeza y no salta con la respiración;
//   2) lobby: 9 s de reposo: respira (1 píxel de arte, ciclo de 3,6 s) y parpadea (aplastado de 1 píxel de arte);
//   3) clinic_interior: el Dr. Satoshi dice su saludo con Dex a su derecha y luego a su izquierda y se gira cada vez; y
//      una conversación de verdad empezando desde su derecha (Dex acaba a su izquierda: le sigue con la mirada). En el
//      lobby no se puede: Penny está detrás del mostrador, a la izquierda de toda la zona que se pisa;
//   4) 390x844: lobby, Penny dice su saludo en una cinemática con la cámara sobre ella (captura fija).
// Comprueba por la API de QA (`state().npcLife`, `state().speech`, `state().pixel`) que:
//   - mientras Penny tiene su texto en pantalla `talking` es true, la boca se abre y se cierra (≥ 4 aperturas) y mira a
//     Dex; con el clip ya terminado y el texto aún abierto, la boca está cerrada; al acabar vuelve al reposo;
//   - la cabeza del texto (speech.head, pasada al mundo) no se mueve en una frase mientras respira (no la arrastra);
//   - en reposo la respiración toma 0 y 1 píxel y hay al menos un parpadeo en 9 s, con la boca cerrada;
//   - el Dr. Satoshi mira a la derecha con Dex a su derecha y a la izquierda (espejado) con Dex a su izquierda, y vuelve
//     a su orientación por defecto (derecha) al acabar cada vez;
//   - la escala de las NPC sigue entera (A2.8) en 1280x720.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-2-npc-life
import { readFileSync } from 'node:fs';
import { startDemo, sleep } from './lib/demo.mjs';

const CLIP = { width: 1280, height: 540 }; // la escena entera (el panel de verbos, debajo, fuera)
/** Respuestas de reserva si no queda ninguna de las pedidas (salidas de los árboles) */
const EXITS = ['come back later', 'goodbye', 'interesting. thanks', 'forget i asked'];
const scene = (id) => JSON.parse(readFileSync(new URL(`../assets/scenes/${id}/scene.json`, import.meta.url), 'utf8'));
// Frases que ya existen (con su clip de voz): el saludo del Dr. Satoshi
const SATOSHI_LINE = scene('clinic_interior').dialogues.dr_satoshi_intro.nodes.greeting.text;
const PENNY_LINE = scene('lobby').dialogues.receptionist_intro.nodes.greeting.text;

const demo = await startDemo(import.meta.url, { fps: 6, width: 800, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
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
    const y = 0; // la escena va arriba (el panel de verbos, abajo): el recorte deja ver el texto sobre las cabezas
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
    cap.style.top = `${y + h - 52}px`;
    cap.textContent = `${label}\n${n ? `${n.id.replace('npc_', '')}: mira ${n.facing} · ${n.talking ? 'HABLA' : 'calla'} · boca ${n.mouthOpen ? 'ABIERTA' : 'cerrada'} · resp ${n.breathPx}px · parpadeos ${n.blinkCount}${n.blinking ? ' *' : ''}` : ''}${voz ? ` · ${voz}` : ''}`;
    // Cabeza del texto en coordenadas del mundo (sin el movimiento de la cámara): no puede moverse con la respiración
    // El ancla de la cabeza que usa el texto (speakerHead: Container, en el mundo) y el borde de arriba del cuerpo dibujado
    const body = npc?.list?.[0];
    const anchor = npc ? { head: npc.y - npc.height * npc.scaleY, top: npc.y + (body.y - body.displayHeight) * npc.scaleY } : null;
    return { st, clip, anchor, playerX: st.player?.x ?? null, npcOnScreen: nx >= 0 && nx <= vw, region: { x, y, width: w, height: h } };
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
async function converse(tag, label, npcId, { choices = [], say = null, maxMs = 90000, onTalk = null, wantHead = true } = {}) {
  const queue = [...choices];
  if (say) {
    // Una frase suya sin que Dex le hable (como un script): se gira hacia él igual
    await page.evaluate((text, speaker) => window.__game.scene.getScene('UIScene').events.emit('say', text, speaker), say.text, say.speaker);
  } else {
    const why = await page.evaluate((id) => window.__game.scene.getScene('GameScene').qaTapNpc(id, { button: 'right' }), npcId);
    if (why) { problems.push(`${tag}: no se pudo hablar con ${npcId}: ${why}`); return null; }
  }
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
    const { st, clip, region, anchor, playerX } = await capture(label, npcId);
    const n = npcOf(st, npcId);
    seen.start ??= n;
    const sp = st.speech;
    const mine = sp && sp.kind === 'npc' && n?.talking;
    if (mine) {
      seen.faced.add(n.facing);
      seen.mirrored.add(n.mirrored);
      seen.playerX = playerX;
      if (onTalk) await onTalk(st, n, region);
      seen.talkingFrames++;
      if (n.mouthOpen) seen.openFrames++; else seen.closedFrames++;
      seen.colors.add(sp.color);
      seen.modes.add(sp.mode);
      const heads = seen.lines.get(sp.text) ?? [];
      if (anchor) heads.push({ y: anchor.head, top: anchor.top, breath: n.breathPx });
      seen.lines.set(sp.text, heads);
      if (!seen.still && n.mouthOpen) { seen.still = true; await demo.still(tag, { clip: region }); }
    }
    if (st.choices?.length) {
      idle = 0;
      line = null;
      const opts = st.choices;
      const pick = (want) => opts.findIndex((o) => o.text.toLowerCase().includes(want) && !o.locked);
      let idx = queue.length ? pick(queue[0]) : -1;
      if (idx >= 0) queue.shift();
      for (const want of EXITS) if (idx < 0) idx = pick(want);
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
  // Solo cuenta en las frases en las que la respiración cambió (si no, no prueba nada)
  const breathing = [...seen.lines.values()].filter((h) => new Set(h.map((p) => p.breath)).size > 1);
  const spread = (h, k) => Math.max(...h.map((p) => p[k])) - Math.min(...h.map((p) => p[k]));
  const headSpread = Math.max(0, ...breathing.map((h) => spread(h, 'y')));
  const bodySpread = Math.max(0, ...breathing.map((h) => spread(h, 'top')));
  console.log(`${tag}: líneas ${seen.lines.size} (con clip ${seen.voiced}, sin voz ${seen.unvoiced}) · fotogramas hablando ${seen.talkingFrames} (boca abierta ${seen.openFrames}, cerrada ${seen.closedFrames}) · tras el clip: cerrada ${seen.closedAfterClip}, abierta ${seen.openAfterClip} · miraba ${[...seen.faced].join('/')} · color ${[...seen.colors].join('/')} · modo ${[...seen.modes].join('/')} · en ${breathing.length} frase(s) con respiración: el cuerpo sube y baja ${bodySpread.toFixed(1)} px y la cabeza del texto ${headSpread.toFixed(2)} px · Dex en x ${seen.playerX?.toFixed?.(1)}`);
  console.log(`${tag}: lastTalk ${JSON.stringify(lt)} → ${fmtN(end)}`);
  if (!seen.talkingFrames) problems.push(`${tag}: la NPC nunca tuvo talking = true con su texto en pantalla`);
  if (!lt) problems.push(`${tag}: sin lastTalk`);
  else {
    if (lt.mouthMoves < 4) problems.push(`${tag}: la boca solo se abrió ${lt.mouthMoves} veces`);
    if (!lt.facedPlayer) problems.push(`${tag}: no miraba a Dex al hablar (miraba ${lt.faced})`);
  }
  if (!seen.openFrames || !seen.closedFrames) problems.push(`${tag}: la boca no alternó (abierta ${seen.openFrames}, cerrada ${seen.closedFrames} fotogramas)`);
  if (seen.openAfterClip > 1) problems.push(`${tag}: boca abierta en ${seen.openAfterClip} fotogramas con el clip ya terminado`);
  if (headSpread > 0.01) problems.push(`${tag}: la cabeza del texto se movió ${headSpread.toFixed(2)} px con la respiración dentro de una frase`);
  if (breathing.length && bodySpread < 1) problems.push(`${tag}: el cuerpo no subió con la respiración mientras hablaba (${bodySpread} px)`);
  if (wantHead && !seen.modes.has('head')) problems.push(`${tag}: el texto no fue sobre su cabeza (modos ${[...seen.modes].join('/')})`);
  if (!end?.rest || end.talking || end.mouthOpen) problems.push(`${tag}: no volvió al reposo (${fmtN(end)})`);
  if (end && end.facing !== end.defaultFacing) problems.push(`${tag}: al acabar mira ${end.facing}, su orientación por defecto es ${end.defaultFacing}`);
  return { seen, lt, end };
}

/** Reposo grabado: respiración y parpadeos */
async function rest(tag, label, npcId, ms, { minBlinks = 1 } = {}) {
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
  if (blinks < minBlinks) problems.push(`${tag}: ${blinks} parpadeo(s) en ${ms / 1000} s, se esperaban ${minBlinks}`);
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
const penny = await converse('penny', '1) habla con Penny: boca con la voz, texto rosa sobre su cabeza', 'npc_receptionist', { choices: ['the tour', 'come back later'] });
if (penny?.lt) {
  notes.push(`Penny: boca ${penny.lt.voice === 'clip' ? 'con el clip de voz' : 'sin voz (sin clip)'}${penny.lt.level ? ' y el nivel del analizador' : ''}`);
  if (penny.lt.voice !== 'clip') notes.push('aviso: ninguna frase de Penny sonó con su clip (audio no disponible en el navegador headless): la boca siguió el texto');
}
await rest('reposo', '2) reposo: respira (1 px) y parpadea', 'npc_receptionist', 9000);
{
  const { region } = await capture('lobby', 'npc_receptionist', { shot: false });
  await demo.still('full', { clip: region });
}

// ── 3) clinic_interior: el Dr. Satoshi se gira hacia Dex a un lado y al otro ────────────────────────────────────
// Al hablarle, Dex siempre acaba a su izquierda (a la derecha del mostrador no se llega tan cerca): para verle mirar a
// los dos lados, dice su saludo (una frase suya, como en un script) con Dex a su derecha y luego a su izquierda; después
// la conversación de verdad: Dex sale de su derecha y el doctor le sigue con la mirada mientras pasa a su izquierda.
await open('clinic_interior', 1280);
const SAT = 'npc_dr_satoshi';
const say = { text: SATOSHI_LINE, speaker: 'Dr. Satoshi' };
for (const [tag, x, side] of [['satoshi-derecha', 90, 'right'], ['satoshi-izquierda', 62, 'left']]) {
  err = await during(`3) Dex a la ${side === 'left' ? 'izquierda' : 'derecha'} del doctor`, SAT, (x) => window.__demoRun(window.__qa.walk(x, 98)), [x]);
  if (err) problems.push(`${tag}: walk falló: ${err}`);
  const before = npcOf((await capture('3)', SAT)).st, SAT);
  const r = await converse(tag, `3) el doctor habla con Dex a su ${side === 'left' ? 'izquierda' : 'derecha'}: le mira`, SAT, { say });
  if (r) {
    if (!r.seen.faced.has(side) || r.seen.faced.size !== 1) problems.push(`${tag}: hablando miró ${[...r.seen.faced].join('/')}, se esperaba solo ${side}`);
    if (r.lt?.faced !== side) problems.push(`${tag}: lastTalk.faced ${r.lt?.faced}, se esperaba ${side}`);
    if (side === 'left' && !r.seen.mirrored.has(true)) problems.push(`${tag}: no se espejó para mirar a la izquierda`);
    if (side === 'left' && !(r.end.turns > (before?.turns ?? 0))) problems.push(`${tag}: turns no subió (${before?.turns} → ${r.end.turns})`);
  }
}
{
  err = await during('3) Dex vuelve a la derecha del doctor', SAT, () => window.__demoRun(window.__qa.walk(90, 98)));
  if (err) problems.push(`satoshi-charla: walk falló: ${err}`);
  const r = await converse('satoshi-charla', '3) Dex le habla desde la derecha: le sigue con la mirada', SAT, { choices: ['goodbye'] });
  if (r) {
    if (r.lt?.faced !== 'left' || !r.lt?.facedPlayer) problems.push(`satoshi-charla: hablando miraba ${r.lt?.faced} (a Dex: ${r.lt?.facedPlayer}), Dex acaba a su izquierda`);
    if (!r.seen.mirrored.has(true)) problems.push('satoshi-charla: no se espejó hacia Dex');
  }
}
await rest('reposo-clinica', '3) reposo', SAT, 3000, { minBlinks: 0 }); // 3 s: puede no tocar parpadeo (cada 3-7 s)

// ── 4) 390x844 (captura fija con Penny hablando) ────────────────────────────────────────────────────────────────
filming = false;
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await open('lobby', 390);
{
  // En vertical la cámara sigue a Dex y Penny queda fuera; como en la apertura del lobby (A3.2), una cinemática lleva la
  // cámara hasta ella y dice su saludo: así se ve con la boca abierta y el texto rosa encima
  let shot = false;
  const ops = [
    { op: 'cinematicStart' },
    { op: 'cameraPan', actor: 'npc_receptionist', ms: 600 },
    { op: 'say', speaker: 'Penny', text: PENNY_LINE },
    { op: 'cinematicEnd' },
  ];
  err = await (async () => {
    await page.evaluate((ops) => window.__demoRun(window.__qa.runScript(ops)), ops);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const { st } = await capture('390x844', 'npc_receptionist', { shot: false });
      const n = npcOf(st, 'npc_receptionist');
      if (!shot && n?.talking && n.mouthOpen && st.speech?.mode === 'head') {
        shot = true;
        await page.evaluate(() => document.getElementById('demo-cap')?.remove());
        await demo.still('390x844');
        console.log(`390x844: Penny habla en pantalla · texto «${st.speech.text.slice(0, 40)}…» color ${st.speech.color} modo ${st.speech.mode} · ${fmtN(n)}`);
      }
      if (await page.evaluate(() => window.__demoDone)) break;
      await sleep(60);
    }
    return page.evaluate(() => window.__demoErr);
  })();
  if (err) problems.push(`390x844: la cinemática falló: ${err}`);
  if (!shot) { await demo.still('390x844'); problems.push('390x844: no se vio a Penny hablando con la boca abierta y el texto sobre su cabeza'); }
}
await demo.end();

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

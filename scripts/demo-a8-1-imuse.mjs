// Demo de A8.1 (regla visual del plan SCUMM): música adaptativa a lo iMUSE. Con el sonido activado
// (localStorage adrian_adventure_muted = false), ?qa=1, 1280x720, una sola carga de página y cambios de escena reales
// (`__qa.goto`, el mismo gotoScene de los scripts):
//   1) outside (retro-adventure, Re mayor): explorar; el motivo sintetizado con el arreglo del porche (agudo, denso, eco);
//   2) → lobby: misma pista, no hay transición: cambia el arreglo del motivo (registro medio, cuadrada, seco);
//   3) conversación con la recepcionista: estado `dialogue` (capa pad; salta a la sección tranquila en un punto de salida);
//   4) → basement (tension, Mi menor): el cambio espera al siguiente punto de salida y entra por el puente en Mi
//      (stinger_item +400 cents); estado `tension` (pulso + contratiempos, sección intensa); arreglo del sótano (grave, filtrado);
//   5) → lobby (retro-adventure, Re mayor: puente +200) → rooftop (vista, Sol menor: puente -500);
//   6) → outside y enseguida → lobby: el segundo cambio llega antes de la salida y la anula (misma pista: no hay corte).
// En cada fotograma, un HUD (DOM) con `__qa.music()`: estado, pista, BPM, tonalidad, compás:pulso, sección, próxima salida,
// cambio programado y capas. Cada transición se apunta en log.txt y en transitions.json (hora pedida, hora de salida, espera en
// compases, compás de salida, tipo de salida, sección de entrada, puente, desafino, tonalidad) y la demo FALLA si alguna no
// sale en compás (error > 0,01 compases), espera más de maxWaitBars + 1, o su puente no va en la tonalidad de destino.
// Audio: graba la salida de la música (y de los efectos de Phaser) con MediaRecorder dentro de la página → audio.webm, y si hay
// ffmpeg monta a8-1-imuse.mp4 (fotogramas estirados a la duración del audio: la sincronía es aproximada, ±1 fotograma).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a8-1-imuse
import { startDemo, sleep } from './lib/demo.mjs';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAP = JSON.parse(readFileSync(new URL('../assets/config/music-map.json', import.meta.url), 'utf8'));
const MAX_WAIT = (MAP.planner?.maxWaitBars ?? 4) + 1;
const demo = await startDemo(import.meta.url, { fps: 6, width: 800, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adrian_adventure_muted', 'false'); } catch { /* sin storage */ } });
const problems = [];
const notes = [];
const CLIP = { x: 0, y: 0, width: 1280, height: 560 };
const seenStates = new Set();
const layerPeaks = {};

await demo.openScene('outside');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail('La escena outside no quedó libre');
for (let i = 0; i < 10 && (await page.evaluate(() => window.__game.sound.locked)); i++) {
  await page.mouse.click(640, 30);
  await sleep(300);
}
if (await page.evaluate(() => window.__game.sound.locked)) problems.push('el audio de Phaser sigue bloqueado tras 10 clics');

// grabación del audio (música + capas + puentes por masterGain/duckGain; efectos y voces por el nodo maestro de Phaser)
const recording = await page.evaluate(() => {
  window.__demoRun = (p) => {
    window.__demoDone = false;
    window.__demoErr = null;
    p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
  };
  try {
    const mm = window.__game.registry.get('musicManager');
    const ctx = mm.context;
    const dest = ctx.createMediaStreamDestination();
    mm.duckGain.connect(dest);
    const phaserOut = window.__game.sound.masterVolumeNode;
    if (phaserOut) phaserOut.connect(dest);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    if (!mime) return 'MediaRecorder sin formato de audio';
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 96000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(1000);
    window.__demoRec = { rec, chunks, t0: performance.now(), mime };
    return null;
  } catch (e) {
    return String(e?.message || e);
  }
});
if (recording) notes.push(`audio sin grabar: ${recording}`);

async function capture(label) {
  const m = await page.evaluate((label) => {
    const q = window.__qa.music();
    let hud = document.getElementById('demo-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'demo-hud';
      hud.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;pointer-events:none;font:14px/18px monospace;color:#fff;background:rgba(10,10,20,.78);padding:6px 10px;white-space:pre;border-radius:4px';
      document.body.appendChild(hud);
    }
    const bar = (v, n = 12) => { const k = Math.max(0, Math.min(n, Math.round(v * n))); return '█'.repeat(k) + '░'.repeat(n - k); };
    const t = q?.transitions.at(-1);
    const sc = q?.scheduled;
    hud.textContent = `${label}\n`
      + `estado   ${q?.state ?? '—'}${q?.transient ? ` (${q.transient})` : ''} · lugar ${q?.place ?? '—'} (${q?.arrangement ? `oct ${q.arrangement.octave}, ${q.arrangement.wave}, ${q.arrangement.density}/compás, eco ${q.arrangement.echo}` : '—'})\n`
      + `pista    ${q?.track ?? '—'} · ${q?.bpm ?? '—'} BPM · ${q?.key ?? '—'} · compás ${q?.bar ?? '—'}:${q?.beat ?? '—'} · sección ${q?.section ?? '—'}\n`
      + `salida   ${q?.nextExit ? `compás ${q.nextExit.bar} (${q.nextExit.kind}) en ${q.nextExit.inSec.toFixed(2)} s` : '—'}${sc ? ` · PROGRAMADO → ${sc.to} en ${sc.inSec.toFixed(2)} s, puente ${sc.bridge ?? 'ninguno'}, entra en ${sc.toSection}` : ''}\n`
      + `capas    ${Object.entries(q?.layers ?? {}).map(([k, v]) => `${k} ${bar(Math.min(1, v / 0.07), 6)}`).join('  ')}\n`
      + `última   ${t ? `${t.from ?? '∅'} → ${t.to} · pedida ${t.requestedAt}s sale ${t.exitAt}s (${t.waitBars} compases, ${t.exitKind}, error ${t.barError}) · puente ${t.bridgeClip ?? 'no'} ${t.detune} c · ${t.key}${t.cancelled ? ' · ANULADA' : ''}` : '—'}`;
    return q;
  }, label);
  if (m) {
    seenStates.add(`${m.place}:${m.state}`);
    for (const [k, v] of Object.entries(m.layers)) layerPeaks[`${m.place}:${k}`] = Math.max(layerPeaks[`${m.place}:${k}`] ?? 0, v);
  }
  await demo.shot({ clip: CLIP });
  return m;
}

async function filmFor(label, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) last = await capture(label);
  return last;
}

async function during(label, start, maxMs = 60000) {
  await page.evaluate(start);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await capture(label);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  return page.evaluate(() => window.__demoErr);
}

async function waitTrack(key, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await capture(`esperando ${key}`);
    if (m?.track === key && !m.scheduled) return m;
  }
  problems.push(`la pista ${key} no llegó a sonar en ${ms / 1000} s`);
  return null;
}

async function go(scene, label) {
  const err = await during(label, `window.__demoRun(window.__qa.goto(${JSON.stringify(scene)}))`);
  if (err) problems.push(`goto ${scene}: ${err}`);
}

// 1) outside
await waitTrack('retro-adventure');
await filmFor('1) outside: explorar · motivo con el arreglo del porche', 4000);
// 2) lobby (misma pista)
await go('lobby', '2) → lobby: misma pista, sin transición; cambia el arreglo del motivo');
await filmFor('2) lobby: el mismo motivo, otro arreglo', 3500);
// 3) conversación
{
  let sawDialogue = false;
  await page.evaluate(() => window.__demoRun(window.__qa.talk('npc_receptionist')));
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const m = await capture('3) conversación: estado dialogue (pad, sección tranquila)');
    if (m?.state === 'dialogue') sawDialogue = true;
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  const err = await page.evaluate(() => window.__demoErr);
  if (err) notes.push(`talk npc_receptionist: ${err}`);
  await page.evaluate(() => window.__demoRun(window.__qa.dismissAll())).catch(() => {});
  await filmFor('3) fin de la conversación', 1500);
  if (!sawDialogue) problems.push('durante la conversación el estado musical no pasó a dialogue');
}
// 4) basement
await go('basement', '4) → basement: espera al punto de salida y entra por el puente en Mi menor');
await waitTrack('tension');
await filmFor('4) basement: tension, estado tensión (pulso + contratiempos), arreglo del sótano', 6000);
// 5) lobby → rooftop
await go('lobby', '5) → lobby: vuelta a retro-adventure (Re mayor)');
await waitTrack('retro-adventure');
await filmFor('5) lobby', 2000);
await go('rooftop', '5) → rooftop: vista (Sol menor)');
await waitTrack('vista');
await filmFor('5) rooftop: vista, arreglo abierto', 4000);
// 6) cambio anulado
await go('outside', '6) → outside…');
await go('rooftop', '6) …y de vuelta antes de la salida: se anula, sin corte');
await filmFor('6) rooftop: sigue vista', 3000);

const final = await page.evaluate(() => window.__qa.music());
// audio
let audioFile = null;
let audioSec = 0;
if (!recording) {
  const r = await page.evaluate(async () => {
    const d = window.__demoRec;
    await new Promise((res) => { d.rec.onstop = res; d.rec.stop(); });
    const blob = new Blob(d.chunks, { type: d.mime });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), sec: (performance.now() - d.t0) / 1000, mime: d.mime };
  });
  audioSec = r.sec;
  audioFile = join(demo.dir, r.mime.includes('ogg') ? 'audio.ogg' : 'audio.webm');
  writeFileSync(audioFile, Buffer.from(r.b64, 'base64'));
  notes.push(`audio grabado: ${audioFile.split('/').pop()} (${(Buffer.byteLength(r.b64, 'base64') / 1024).toFixed(0)} KB, ${r.sec.toFixed(1)} s)`);
}
await demo.end();

// ── comprobaciones de las transiciones ──────────────────────────────────────────────────────────────────────
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const semis = (t) => { const x = ((t % 12) + 12) % 12; return x <= 5 ? x : x - 12; };
const sameSet = (a, b) => (a.mode === 'major' ? a.tonic : (a.tonic + 3) % 12) === (b.mode === 'major' ? b.tonic : (b.tonic + 3) % 12);
const trs = final?.transitions ?? [];
writeFileSync(join(demo.dir, 'transitions.json'), JSON.stringify(trs, null, 2));
console.log('transiciones (horas en s de AudioContext.currentTime):');
for (const t of trs) {
  console.log(`  ${t.cause.padEnd(6)} ${(t.from ?? '∅').padEnd(16)} → ${t.to.padEnd(16)} pedida ${t.requestedAt.toFixed(3)} · sale ${t.exitAt.toFixed(3)} (espera ${t.waitSec.toFixed(2)} s = ${t.waitBars} compases) · compás ${t.fromBar} ${t.exitKind} (error ${t.barError}) → ${t.toSection}@${t.toBar} · puente ${t.bridgeClip ?? 'ninguno'} ${t.detune} c · ${t.key}${t.cancelled ? ' · ANULADA' : ''}`);
  if (t.exitKind === 'start') continue;
  if (t.barError > 0.01) problems.push(`${t.from} → ${t.to}: sale fuera de compás (error ${t.barError} compases)`);
  if (t.waitBars > MAX_WAIT) problems.push(`${t.from} → ${t.to}: esperó ${t.waitBars} compases (máximo ${MAX_WAIT})`);
  const fk = MAP.tracks[t.from]?.key;
  const tk = MAP.tracks[t.to]?.key;
  if (fk && tk && t.from !== t.to) {
    if (sameSet(fk, tk) ? t.bridge !== 'none' : t.detune !== semis(tk.tonic) * 100) problems.push(`${t.from} → ${t.to}: puente ${t.bridgeClip} ${t.detune} c, se esperaba ${sameSet(fk, tk) ? 'ninguno' : `${semis(tk.tonic) * 100} c (${NOTE[tk.tonic]} ${tk.mode})`}`);
  }
}
const done = trs.filter((t) => !t.cancelled && t.exitKind !== 'start');
for (const [from, to] of [['retro-adventure', 'tension'], ['tension', 'retro-adventure'], ['retro-adventure', 'vista']]) {
  if (!done.some((t) => t.from === from && t.to === to)) problems.push(`no hubo transición ${from} → ${to}`);
}
if (!trs.some((t) => t.cancelled)) notes.push('aviso: el cambio rápido de 6) no llegó a anularse (pudo caer justo en la salida)');
if (!seenStates.has('basement:tension')) problems.push('en el sótano el estado musical no fue tension');
if ((layerPeaks['basement:pulse'] ?? 0) < 0.01) problems.push('en el sótano no entró la capa pulse');
if ((layerPeaks['outside:motif'] ?? 0) < 0.01) problems.push('fuera no sonó la capa motif');
console.log(`estados vistos: ${[...seenStates].join(', ')}`);
console.log(`capas (pico por lugar): ${JSON.stringify(layerPeaks)}`);

// vídeo con sonido: fotogramas estirados a la duración del audio
if (audioFile && audioSec > 1) {
  const frames = readdirSync(join(demo.dir, 'frames')).filter((f) => f.endsWith('.png')).length;
  const fps = Math.max(1, frames / audioSec).toFixed(3);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', join(demo.dir, 'frames', '%03d.png'), '-i', audioFile,
    '-vf', 'scale=800:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', join(demo.dir, 'a8-1-imuse.mp4')]);
  if (r.status === 0) notes.push(`vídeo con sonido: a8-1-imuse.mp4 (${frames} fotogramas a ${fps} fps sobre ${audioSec.toFixed(1)} s)`);
  else notes.push(`sin mp4 (ffmpeg: ${String(r.stderr || r.error).slice(0, 200)})`);
}

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

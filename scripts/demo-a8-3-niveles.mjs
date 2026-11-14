// Demo de A8.3 (regla visual del plan SCUMM): música iMUSE de ElevenLabs con NIVELES DE INTENSIDAD. Con sonido
// (localStorage adrian_adventure_muted = false), ?qa=1, 1280x720, en outside (tema de Dex, 90 BPM, Re mayor):
//   1) explorar → nivel 0 (calma, dex-n0);
//   2) queda 1 objetivo del capítulo (`musicGoalsLeft` = 1, lo que escribe el diario) → nivel 1 (activo, dex-n1);
//   3) se abre el duelo de FUD (`dialogueActive` + `dialogueTree` = chad_fud, lo que pone UIScene) → nivel 2 (tensión);
//   4) se cierra y se resuelve un puzle (`markSolved`, lo que hace el stinger de puzle) → nivel 3 (triunfo), y vuelve al 1;
//   5) objetivos al día → nivel 0.
// Cada cambio de nivel sale en compás (error ≤ 0,01 compases), espera ≤ maxWaitBars + 1, entra en compás entero y SIN
// puente (mismo tema = misma tonalidad y tempo). HUD con `__qa.music()` (nivel, pista, compás, próxima salida). Graba el
// audio con MediaRecorder (audio.webm) y monta a8-3-niveles.mp4.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a8-3-niveles
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
const allTr = new Map();
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
      + `nivel    ${q?.theme ?? '—'} · ${q?.level ?? '—'} (${q?.levelName ?? '—'}) · pide ${q?.wantLevel ?? '—'}\n`
      + `capas    ${Object.entries(q?.layers ?? {}).map(([k, v]) => `${k} ${bar(Math.min(1, v / 0.07), 6)}`).join('  ')}\n`
      + `última   ${t ? `${t.from ?? '∅'} → ${t.to} · pedida ${t.requestedAt}s sale ${t.exitAt}s (${t.waitBars} compases, ${t.exitKind}, error ${t.barError}) · puente ${t.bridgeClip ?? 'no'} ${t.detune} c · ${t.key}${t.cancelled ? ' · ANULADA' : ''}` : '—'}`;
    return q;
  }, label);
  if (m) {
    // el registro de transiciones del motor es un anillo de 30: se acumula aquí para no perder las primeras
    for (const t of m.transitions) allTr.set(`${t.requestedAt}|${t.to}`, t);
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

async function waitTrack(key, ms = 30000, label = `esperando ${key}`) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await capture(label);
    if (m?.track === key && !m.scheduled) return m;
  }
  problems.push(`la pista ${key} no llegó a sonar en ${ms / 1000} s`);
  return null;
}

async function go(scene, label) {
  const err = await during(label, `window.__demoRun(window.__qa.goto(${JSON.stringify(scene)}))`);
  if (err) problems.push(`goto ${scene}: ${err}`);
}

const LEVELS = MAP.themes?.dex?.levels ?? [];
// el diario reescribe `musicGoalsLeft` al refrescarse: lo forzado se reafirma cada 100 ms dentro de la página
await page.evaluate(() => {
  window.__demoForce = {};
  setInterval(() => { for (const [k, v] of Object.entries(window.__demoForce)) window.__game.registry.set(k, v); }, 100);
});
const setReg = (k, v) => page.evaluate(([k, v]) => { window.__demoForce[k] = v; window.__game.registry.set(k, v); }, [k, v]);
async function waitLevel(n, label, ms = 30000) {
  const key = LEVELS[n];
  if (!key) { problems.push(`dex no tiene nivel ${n}`); return null; }
  return waitTrack(key, ms, label);
}
// 1) calma
await waitLevel(0, '1) outside: explorar = nivel 0 (calma)');
await filmFor('1) nivel 0: calma', 5000);
// 2) activo
await setReg('musicGoalsLeft', 1);
await waitLevel(1, '2) queda 1 objetivo → nivel 1 (activo)');
await filmFor('2) nivel 1: activo (batería y bajo)', 7000);
// 3) tensión
await setReg('dialogueTree', 'chad_fud');
await setReg('dialogueActive', true);
await waitLevel(2, '3) duelo de FUD con Chad → nivel 2 (tensión)');
await filmFor('3) nivel 2: tensión (doble tiempo, percusión fuerte)', 7000);
// 4) triunfo
await setReg('dialogueActive', false);
await setReg('dialogueTree', null);
await page.evaluate(() => window.__game.registry.get('musicManager').markSolved());
await waitLevel(3, '4) puzle resuelto → nivel 3 (triunfo)');
await filmFor('4) nivel 3: triunfo', 4000);
await waitLevel(1, '4) …y vuelve al nivel 1', 40000);
await filmFor('4) de vuelta al nivel 1', 3000);
// 5) calma
await setReg('musicGoalsLeft', 3);
await waitLevel(0, '5) objetivos al día → nivel 0');
await filmFor('5) nivel 0', 3000);

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
for (const t of final?.transitions ?? []) allTr.set(`${t.requestedAt}|${t.to}`, t);
const trs = [...allTr.values()].sort((a, b) => a.requestedAt - b.requestedAt);
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
for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 1], [1, 0]]) {
  if (!done.some((t) => t.from === LEVELS[a] && t.to === LEVELS[b])) problems.push(`no hubo cambio de nivel ${a} → ${b} (${LEVELS[a]} → ${LEVELS[b]})`);
}
for (const t of done) if (LEVELS.includes(t.from) && LEVELS.includes(t.to) && t.bridge !== 'none') problems.push(`${t.from} → ${t.to}: puente ${t.bridgeClip} (mismo tema: sin puente)`);
console.log(`estados vistos: ${[...seenStates].join(', ')}`);

// vídeo con sonido: fotogramas estirados a la duración del audio
if (audioFile && audioSec > 1) {
  const frames = readdirSync(join(demo.dir, 'frames')).filter((f) => f.endsWith('.png')).length;
  const fps = Math.max(1, frames / audioSec).toFixed(3);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', join(demo.dir, 'frames', '%03d.png'), '-i', audioFile,
    '-vf', 'scale=800:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', join(demo.dir, 'a8-3-niveles.mp4')]);
  if (r.status === 0) notes.push(`vídeo con sonido: a8-3-niveles.mp4 (${frames} fotogramas a ${fps} fps sobre ${audioSec.toFixed(1)} s)`);
  else notes.push(`sin mp4 (ffmpeg: ${String(r.stderr || r.error).slice(0, 200)})`);
}

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

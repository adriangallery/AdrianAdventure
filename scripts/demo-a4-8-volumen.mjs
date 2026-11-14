// Demo de A4.8 (plan SCUMM): volumen por defecto alto y voces a tope, CON SONIDO. Sin nada guardado en localStorage
// (solo adrian_adventure_muted = false para que suene), ?qa=1, 1280x720, en outside:
//   0) comprueba por la API de QA (`state().audio.mix`) que el nivel de la música es High (0,9), el de las voces High
//      (ganancia 1,0), que el maestro de Phaser va a SFX_GAIN y que la migración dejó su marca;
//   1) USE y PICK de la lámpara del porche: efectos y stinger de objeto sobre la música;
//   2) LOOK de la puerta: Dex habla con voz → la música baja (ducking) y el clip suena con el volumen de las voces
//      (VOICE_BOOST × 1,0 / SFX_GAIN), sin depender de la música.
// Graba la salida real (el limitador maestro, por donde pasa todo) con MediaRecorder dentro de la página → audio.webm, y
// si hay ffmpeg monta a4-8-volumen.mp4 (fotogramas estirados a la duración del audio) y mide el audio grabado (ebur128).
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a4-8-volumen
import { startDemo, sleep } from './lib/demo.mjs';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const demo = await startDemo(import.meta.url, { fps: 6, width: 800, viewport: { width: 1280, height: 720, isMobile: false, hasTouch: true } });
const { page } = demo;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
// sin volumen guardado: solo el sonido encendido
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adrian_adventure_muted', 'false'); } catch { /* sin storage */ } });
const problems = [];
const notes = [];
const CLIP = { x: 0, y: 0, width: 1280, height: 560 };

await demo.openScene('outside');
await page.waitForFunction(() => !!window.__qa, { timeout: 30000, polling: 250 });
if (!(await demo.settle({ tap: [640, 40] }))) await demo.fail('La escena outside no quedó libre');
for (let i = 0; i < 10 && (await page.evaluate(() => window.__game.sound.locked)); i++) {
  await page.mouse.click(640, 30);
  await sleep(300);
}
if (await page.evaluate(() => window.__game.sound.locked)) problems.push('el audio de Phaser sigue bloqueado tras 10 clics');

// 0) niveles sin nada guardado
const mix0 = await page.evaluate(() => ({ mix: window.__qa.state().audio?.mix ?? null, marker: localStorage.getItem('adrian_adventure_music_volume_v2'), stored: localStorage.getItem('adrian_adventure_music_volume') }));
console.log(`mezcla al arrancar: ${JSON.stringify(mix0)}`);
const m0 = mix0.mix;
if (!m0) problems.push('state().audio.mix no existe');
else {
  if (m0.musicLevel !== 'high' || m0.musicVolume !== 0.9) problems.push(`música ${m0.musicLevel} ${m0.musicVolume}, se esperaba high 0,9`);
  if (m0.voiceLevel !== 'high' || m0.voiceGain !== 1) problems.push(`voces ${m0.voiceLevel} ${m0.voiceGain}, se esperaba high 1`);
  if (m0.phaserVolume !== m0.sfxGain) problems.push(`maestro de Phaser ${m0.phaserVolume}, se esperaba ${m0.sfxGain}`);
}
if (mix0.marker === null || mix0.stored !== 'high') problems.push(`migración: marca ${mix0.marker}, guardado ${mix0.stored}`);

// grabación de la salida (limitador maestro) + medidor
const recording = await page.evaluate(() => {
  window.__demoRun = (p) => {
    window.__demoDone = false;
    window.__demoErr = null;
    p.then(() => {}, (e) => { window.__demoErr = String(e?.message || e); }).finally(() => { window.__demoDone = true; });
  };
  try {
    const mm = window.__game.registry.get('musicManager');
    const ctx = mm.context;
    const out = mm.outputNode();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    out.connect(an);
    window.__demoMeter = { an, buf: new Float32Array(1024), peak: 0 };
    const dest = ctx.createMediaStreamDestination();
    out.connect(dest);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    if (!mime) return 'MediaRecorder sin formato de audio';
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
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
  const r = await page.evaluate((label) => {
    const st = window.__qa.state();
    const a = st.audio;
    const m = window.__demoMeter;
    let rms = 0;
    let peak = 0;
    if (m) {
      m.an.getFloatTimeDomainData(m.buf);
      let s = 0;
      for (let i = 0; i < m.buf.length; i++) { s += m.buf[i] * m.buf[i]; peak = Math.max(peak, Math.abs(m.buf[i])); }
      rms = Math.sqrt(s / m.buf.length);
      m.peak = Math.max(m.peak, peak);
    }
    let hud = document.getElementById('demo-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'demo-hud';
      hud.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;pointer-events:none;font:14px/18px monospace;color:#fff;background:rgba(10,10,20,.75);padding:6px 10px;white-space:pre;border-radius:4px';
      document.body.appendChild(hud);
    }
    const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
    const bar = (v, n = 24) => { const k = Math.max(0, Math.min(n, Math.round(v * n))); return '█'.repeat(k) + '░'.repeat(n - k); };
    const mix = a?.mix;
    hud.textContent = `${label}\n`
      + `ajustes  música ${mix?.musicLevel} (${mix?.musicVolume}) · voces ${mix?.voiceLevel} (${mix?.voiceGain}) · efectos ×${mix?.sfxGain}\n`
      + `ducking  ${bar(a?.duckGain ?? 1)} ${a?.duckGain ?? '—'}  fuentes: ${a?.duck.join(', ') || 'ninguna'}\n`
      + `salida   ${bar(Math.min(1, rms * 4))} RMS ${db(rms)} dBFS · pico ${db(peak)} dBFS\n`
      + `voz      ${st.speech ? `«${st.speech.text.slice(0, 44)}…» · clip ${mix?.lastVoiceClipVolume ?? '—'}` : '—'}`;
    return { a, rms, peak, speech: !!st.speech };
  }, label);
  await demo.shot({ clip: CLIP });
  return r;
}

async function during(label, start, maxMs = 60000, onFrame = null) {
  await page.evaluate(start);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await capture(label);
    if (onFrame) onFrame(r);
    if (await page.evaluate(() => window.__demoDone)) break;
  }
  return page.evaluate(() => window.__demoErr);
}

// espera a la música
{
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 25000 && !ok) {
    const { a } = await capture('0) sin nada guardado: música High, voces High');
    ok = !!a?.music.key && (a.music.gain ?? 0) > 0.05;
  }
  if (!ok) problems.push('la música de outside no llegó a sonar');
}
for (let i = 0; i < 12; i++) await capture('0) música sola (High)');

// 1) efectos
const sfxBefore = (await capture('1) efectos')).a?.sfx.total ?? 0;
let err = await during('1) USE lámpara del porche', () => window.__demoRun(window.__qa.act('USE', 'hs_porch_light')));
if (err) problems.push(`USE hs_porch_light: ${err}`);
err = await during('1) PICK lámpara: efecto + stinger de objeto', () => window.__demoRun(window.__qa.act('PICK', 'hs_porch_light')));
if (err) problems.push(`PICK hs_porch_light: ${err}`);
const sfxAfter = (await capture('1) efectos')).a?.sfx.total ?? 0;
if (sfxAfter <= sfxBefore) notes.push('aviso: no se apuntó ningún efecto en USE/PICK de la lámpara');

// 2) voz con música
const seen = { voiceFrames: 0, minDuck: 1, clip: null, rmsVoice: [], rmsMusic: [] };
err = await during('2) LOOK puerta: Dex habla, la música baja', () => window.__demoRun(window.__qa.act('LOOK', 'hs_front_door')), 60000, ({ a, rms }) => {
  if (a?.duck.includes('voice')) { seen.voiceFrames++; seen.minDuck = Math.min(seen.minDuck, a.duckGain); seen.rmsVoice.push(rms); }
  if (a?.mix?.lastVoiceClipVolume != null) seen.clip = a.mix.lastVoiceClipVolume;
});
if (err) problems.push(`LOOK hs_front_door: ${err}`);
for (let i = 0; i < 12; i++) seen.rmsMusic.push((await capture('2) la música vuelve')).rms);
const fin = (await capture('fin')).a;
console.log(`voz: ${seen.voiceFrames} fotogramas con ducking · ganancia mínima ${seen.minDuck} · volumen del clip ${seen.clip} (esperado ${fin?.mix?.voiceClipVolume})`);
if (!seen.voiceFrames) problems.push('no se vio la música bajar bajo la voz');
if (seen.clip == null) problems.push('no sonó ningún clip de voz');
else if (seen.clip !== fin?.mix?.voiceClipVolume) problems.push(`clip de voz a ${seen.clip}, se esperaba ${fin?.mix?.voiceClipVolume}`);
const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const dbf = (v) => (v > 0 ? Math.round(20 * Math.log10(v) * 10) / 10 : -Infinity);
notes.push(`RMS de la salida (mediana): con voz ${dbf(med(seen.rmsVoice))} dBFS · música sola ${dbf(med(seen.rmsMusic))} dBFS`);
const peak = await page.evaluate(() => window.__demoMeter?.peak ?? 0);
notes.push(`pico visto en la salida: ${dbf(peak)} dBFS`);
if (peak > 1.0) problems.push(`la salida pasó de 0 dBFS (pico ${peak})`);

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

if (audioFile && audioSec > 1) {
  const lufs = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audioFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const sum = String(lufs.stderr).split('Summary:').pop() ?? '';
  const I = sum.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
  const P = sum.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
  notes.push(`audio grabado medido (ebur128): integrado ${I ?? '?'} LUFS · pico real ${P ?? '?'} dBFS`);
  const frames = readdirSync(join(demo.dir, 'frames')).filter((f) => f.endsWith('.png')).length;
  const fps = Math.max(1, frames / audioSec).toFixed(3);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', join(demo.dir, 'frames', '%03d.png'), '-i', audioFile,
    '-vf', 'scale=800:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', join(demo.dir, 'a4-8-volumen.mp4')]);
  if (r.status === 0) notes.push(`vídeo con sonido: a4-8-volumen.mp4 (${frames} fotogramas a ${fps} fps sobre ${audioSec.toFixed(1)} s)`);
  else notes.push(`sin mp4 (ffmpeg: ${String(r.stderr || r.error).slice(0, 200)})`);
}

if (pageErrors.length) problems.push(`errores en la página: ${pageErrors.slice(0, 5).join(' | ')}`);
console.log(`fotogramas: ${demo.frames}`);
for (const n of notes) console.log(`nota: ${n}`);
console.log(`problemas: ${problems.length ? problems.join(' | ') : 'ninguno'}`);
if (problems.length) await demo.fail(problems.join('\n'));

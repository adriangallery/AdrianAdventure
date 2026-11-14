// A8.4 (plan SCUMM): monta una prueba de efectos en un solo mp3 para escucharla por DROP (sin navegador).
//
//   node scripts/audio/sfx-montage.mjs ruta /var/tmp/adv-sfx/ruta.mp3          ~30 s: pasos en 3 superficies, puerta,
//                                                                             cajón, coger, teclado, logro
//   node scripts/audio/sfx-montage.mjs pasos /var/tmp/adv-sfx/pasos.mp3 [ref]  10 s: pasos de ffed2ef (A4.4) y luego
//                                                                             los de ahora (madera, baldosa, gravilla)
// Cada efecto entra a su hora con el volumen y el desafino al azar que le daría el juego (pasos: STEP_VOLUME 0,21).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [modo = 'ruta', out = '/var/tmp/adv-sfx/ruta.mp3', ref = 'ffed2ef'] = process.argv.slice(2);
const STEP_VOL = 0.21;
const tmp = mkdtempSync('/var/tmp/adv-sfx-montaje-');
const file = (key, viejo = false) => {
  if (!viejo) return join(ROOT, 'assets', 'audio', 'sfx', `${key}.mp3`);
  const p = join(tmp, `old_${key}.mp3`);
  if (!existsSync(p)) {
    const r = spawnSync('git', ['-C', ROOT, 'show', `${ref}:assets/audio/sfx/${key}.mp3`], { maxBuffer: 1 << 26 });
    if (r.status !== 0) return null;
    writeFileSync(p, r.stdout);
  }
  return p;
};
const variants = (s) => [1, 2, 3, 4].map((n) => `step_${s}_${n}`).filter((k) => existsSync(file(k)));
/** n pasos alternando pie y pareja, cada 0,4 s (2,5 pasos/s como el juego) */
function walk(ev, t0, surface, n, viejo = false) {
  const vs = viejo ? [`step_${surface}_1`, `step_${surface}_2`] : variants(surface);
  for (let i = 0; i < n; i++) {
    const foot = i % 2;
    const pairs = Math.max(1, Math.floor(vs.length / 2));
    const k = vs[Math.min(vs.length - 1, foot + 2 * Math.floor(Math.random() * pairs))];
    ev.push({ t: t0 + i * 0.4, f: file(k, viejo), vol: STEP_VOL, det: Math.round((Math.random() * 2 - 1) * 120) });
  }
  return t0 + n * 0.4;
}
const ev = [];
const fx = (t, key, vol = 0.7) => { const f = file(key); if (f && existsSync(f)) ev.push({ t, f, vol, det: 0 }); return t; };
if (modo === 'pasos') {
  let t = 0.2;
  for (const s of ['wood', 'tile', 'gravel']) t = walk(ev, t, s, 4, true) + 0.15;
  t += 0.6;
  for (const s of ['wood', 'tile', 'gravel']) t = walk(ev, t, s, 4, false) + 0.15;
} else {
  let t = walk(ev, 0.3, 'gravel', 8);           // camino de outside
  t = walk(ev, t, 'wood', 4);                    // porche
  fx(t + 0.2, 'keypad_beep'); fx(t + 0.6, 'keypad_beep'); fx(t + 1.0, 'keypad_beep'); fx(t + 1.6, 'keypad_success');
  fx(t + 2.8, 'door_open'); t = walk(ev, t + 3.6, 'tile', 6);  // lobby
  fx(t + 0.3, 'door_creak'); t = walk(ev, t + 1.4, 'carpet', 5); // upstairs
  const dr = existsSync(file('drawer_open')) ? 'drawer_open' : 'hatch_metal';
  fx(t + 0.3, dr); fx(t + 1.5, 'item_pickup'); fx(t + 2.0, 'inv_open'); fx(t + 2.8, 'inv_close');
  fx(t + 3.4, 'drawer_close'); fx(t + 4.2, 'achievement');
  t = walk(ev, t + 5.6, 'concrete', 6);
  fx(t + 0.2, 'hatch_metal'); fx(t + 1.6, 'crt_on'); fx(t + 3.2, 'floppy_insert'); fx(t + 4.6, 'save_game');
}
const usable = ev.filter((e) => e.f && existsSync(e.f));
const inputs = usable.flatMap((e) => ['-i', e.f]);
const chains = usable.map((e, i) => {
  const rate = 2 ** (e.det / 1200);
  return `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,asetrate=${Math.round(44100 * rate)},aresample=44100,volume=${e.vol},adelay=${Math.round(e.t * 1000)}[a${i}]`;
});
const mix = `${usable.map((_, i) => `[a${i}]`).join('')}amix=inputs=${usable.length}:normalize=0:duration=longest[m]`;
const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${chains.join(';')};${mix}`, '-map', '[m]', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) process.exit(1);
console.log(`${out}: ${usable.length} efectos`);

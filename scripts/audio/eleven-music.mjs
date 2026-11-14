// A8.2 (plan SCUMM): genera la música de un tema con ElevenLabs Music a partir de `art/music/<tema>/plan.json`.
//
//   node scripts/audio/eleven-music.mjs art/music/dex/plan.json [--parte muestra|minimo] [--out DIR] [--dry]
//
// - Clave: ~/.secrets/elevenlabs.key (o ELEVENLABS_KEY_FILE). No se imprime nunca: ni en logs ni en errores.
// - Cuerpo: `composition_plan` del plan (bloques A/B) con las duraciones de la parte pedida (`partes.<parte>.duraciones_ms`),
//   `model_id` = plan.modelo, `seed` = plan.semilla. La API no admite `force_instrumental` con composition_plan: lo
//   instrumental va por estilos negativos (vocals, singing…).
// - Caché: el mp3 se guarda como `<tema>.<parte>.<hash12>.mp3` (hash del cuerpo enviado). Si existe, no se vuelve a pedir.
//   Se copia además a `<tema>.mp3` (muestra) o `<tema>.<parte>.mp3`.
// - Gasto: lee el saldo (GET /v1/user/subscription) antes y después y añade una línea a
//   ~/srv/orquestador/planes/ADVENTURE_SCUMM/elevenlabs-gasto.tsv con los créditos REALES (diferencia de character_count).
//   La columna usd es el equivalente a la tarifa de recarga (0,0002 $/crédito), no un cargo aparte.
// - Si la API devuelve error, sale con código 2 y el error literal (status + cuerpo). No reintenta.
// Sin dependencias: fetch de Node ≥ 18.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const API = 'https://api.elevenlabs.io';
const KEY_FILE = process.env.ELEVENLABS_KEY_FILE || join(homedir(), '.secrets', 'elevenlabs.key');
const GASTO = process.env.ELEVENLABS_GASTO_TSV || join(homedir(), 'srv', 'orquestador', 'planes', 'ADVENTURE_SCUMM', 'elevenlabs-gasto.tsv');
const USD_POR_CREDITO = 0.0002;

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const planPath = args.find((a) => a.endsWith('.json'));
if (!planPath) {
  console.error('uso: eleven-music.mjs <plan.json> [--parte muestra|minimo] [--out DIR] [--dry]');
  process.exit(1);
}
const parte = opt('--parte', 'muestra');
const outDir = resolve(opt('--out', parte === 'muestra' ? '/var/tmp/adv-musica/muestras' : '/var/tmp/adv-musica/' + parte));
const dry = args.includes('--dry');

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const durs = plan.partes?.[parte]?.duraciones_ms;
if (!durs || durs.length !== plan.composition_plan.chunks.length) throw new Error(`el plan no tiene partes.${parte}.duraciones_ms para cada bloque`);

export function buildBody(p, duraciones) {
  return {
    model_id: p.modelo,
    seed: p.semilla,
    composition_plan: { chunks: p.composition_plan.chunks.map((c, i) => ({ ...c, duration_ms: duraciones[i] })) },
  };
}
const body = buildBody(plan, durs);
const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
mkdirSync(outDir, { recursive: true });
const cached = join(outDir, `${plan.tema}.${parte}.${hash}.mp3`);
const final = join(outDir, parte === 'muestra' ? `${plan.tema}.mp3` : `${plan.tema}.${parte}.mp3`);
const totalSec = durs.reduce((a, b) => a + b, 0) / 1000;

if (existsSync(cached)) {
  copyFileSync(cached, final);
  console.log(JSON.stringify({ tema: plan.tema, parte, hash, cache: true, archivo: final }));
  process.exit(0);
}
if (dry) {
  console.log(JSON.stringify({ tema: plan.tema, parte, hash, segundos: totalSec, body }, null, 2));
  process.exit(0);
}

const key = readFileSync(KEY_FILE, 'utf8').trim();
const scrub = (s) => String(s).split(key).join('***');

async function saldo() {
  const r = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key } });
  if (!r.ok) throw new Error(`subscription ${r.status}: ${scrub(await r.text())}`);
  const j = await r.json();
  return { usados: j.character_count, limite: j.character_limit, libres: j.character_limit - j.character_count };
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function apunta(para, creditos) {
  const fecha = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T').slice(0, 16);
  const usd = (creditos * USD_POR_CREDITO).toFixed(4);
  appendFileSync(GASTO, `${fecha}\t${para}\t${creditos}\t${usd}\n`);
}

const antes = await saldo();
const t0 = Date.now();
let res;
try {
  res = await fetch(`${API}/v1/music?output_format=${plan.output_format || 'mp3_44100_128'}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
} catch (e) {
  console.error(`fallo de red: ${scrub(e.message)}`);
  process.exit(2);
}
const segs = ((Date.now() - t0) / 1000).toFixed(1);
let audio = null;
let error = null;
if (res.ok) audio = Buffer.from(await res.arrayBuffer());
else error = `HTTP ${res.status} ${res.statusText}: ${scrub(await res.text())}`;

// El saldo tarda en reflejar el cargo (medido el 14-nov: >17 s y <70 s): relee cada 10 s hasta 3 min.
// Ojo: GET /v1/usage/character-stats (breakdown product_type) lo ve antes, en la serie "Music".
let despues = await saldo();
for (let i = 0; i < 18 && despues.usados === antes.usados; i++) {
  await pausa(10000);
  despues = await saldo();
}
const creditos = despues.usados - antes.usados;
const songId = res.headers.get('song-id') || null;
apunta(`A8.2 ${parte} ${plan.tema} (music ${plan.modelo}, ${totalSec.toFixed(1)} s${error ? ', ERROR ' + res.status : ''})`, creditos);

const info = {
  tema: plan.tema, parte, hash, segundosPedidos: totalSec, segundosLlamada: Number(segs), songId,
  saldoAntes: antes, saldoDespues: despues, creditos, creditosPorMinuto: Math.round(creditos / (totalSec / 60)),
};
if (error) {
  console.error(JSON.stringify({ ...info, error }, null, 2));
  process.exit(2);
}
writeFileSync(cached, audio);
copyFileSync(cached, final);
writeFileSync(cached.replace(/\.mp3$/, '.json'), JSON.stringify({ ...info, archivo: final, bytes: audio.length }, null, 2) + '\n');
console.log(JSON.stringify({ ...info, archivo: final, bytes: audio.length }, null, 2));

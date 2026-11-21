#!/usr/bin/env node
// F1.1 (plan FUNTICO_ADVENTURE): catálogo de objetivos de Triage, generado desde las escenas del juego y VERSIONADO
// en src/funtico/triage/catalog.json (lo leen el cliente y, en F2.2, el save-server). Node puro, sin dependencias.
//
//   node scripts/funtico/build-triage-catalog.mjs            reescribe src/funtico/triage/catalog.json
//   node scripts/funtico/build-triage-catalog.mjs --check    no escribe; rc 1 si el versionado no está al día
//   node scripts/funtico/build-triage-catalog.mjs --report   tabla de objetivos y descartes (no escribe)
//   opciones: --root <dir>  --scenes outside,lobby,rooftop
//
// Qué sale (detalle y criterio en docs/progreso/F1.1.md):
// - scenes.<id>: mundo en píxeles (render.world) y fondo; los `bounds` y los toques van en % del mundo (0–100 en x
//   sobre el ancho y en y sobre el alto), las mismas unidades que `regions.hotspots[].bounds` del scene.json.
// - targets[]: hotspots útiles con su frase LOOK en el estado inicial de la partida (sin flags, sin inventario, sin
//   cartera), la voz de esa frase (clave y mp3) y su cubo de dificultad (tamaño + parecido con sus vecinos).
// - relapse: rondas del duelo `chad_fud` (recovery_pool) con la réplica buena sacada del propio árbol.
// - hash: sha256 del JSON canónico del resto del catálogo (el servidor lo registra con cada carrera).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalise, loadVoices, speakerFor } from '../voices/extract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const CATALOG_FILE = 'src/funtico/triage/catalog.json';
export const CATALOG_SCHEMA = 1;
export const DEFAULT_SCENES = ['outside', 'lobby', 'rooftop'];
const VOICE_CONFIG = 'src/config/voice.config.ts';
const VOICE_DIR = 'assets/audio/voice';

/** Lado mínimo de un objetivo, en píxeles del mundo (por debajo no se puede tocar con el pulgar en vertical). */
export const MIN_SIDE_PX = 48;
/** Solape máximo con otro hotspot visible (fracción del área del menor): por encima, el objetivo es ambiguo. */
export const MAX_OVERLAP = 0.5;
/**
 * Cubos: «tamaño» = raíz del área en píxeles del mundo dividida por el alto del mundo (1 = un cuadrado del alto de la
 * escena); con un vecino parecido se multiplica por SIMILAR_PENALTY («tamaño efectivo»). Difícil si el efectivo es
 * < HARD_SIZE, fácil si es ≥ EASY_SIZE, medio entre los dos. Umbrales elegidos para que cada escena del MVP tenga al
 * menos 2 objetivos en cada cubo (tabla en docs/progreso/F1.1.md).
 */
export const HARD_SIZE = 0.17;
export const EASY_SIZE = 0.3;
/**
 * Vecino parecido: comparte una palabra significativa del nombre («Main Window» / «Side Window»), o tiene área Y
 * proporción parecidas (dentro de ×SIMILAR_RATIO) con el centro a menos de NEAR_FACTOR veces el lado mayor.
 */
export const NEAR_FACTOR = 2;
export const SIMILAR_RATIO = 1.5;
/** Un vecino parecido cuenta como encoger el objetivo a este factor de su tamaño (más difícil de distinguir). */
export const SIMILAR_PENALTY = 0.6;

const STOP = new Set(['the', 'and', 'of', 'to', 'a', 'an', 'in', 'on', 'below', 'upper', 'floor', 'main', 'side', 'lobby', 'roof']);

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

// ── voces: el mismo mapa texto→clave que registra UIScene (VOICE_TEXT_MAP de voice.config.ts) ─────────────────────

function decodeQuoted(raw) {
  return raw.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

/** normalise(texto) → clave de voz, igual que VoiceSystem.registerAll (la última gana, como Map.set). */
export function loadVoiceMap(root = DEFAULT_ROOT) {
  const src = fs.readFileSync(path.join(root, VOICE_CONFIG), 'utf8');
  const start = src.indexOf('export const VOICE_TEXT_MAP');
  if (start < 0) throw new Error(`${VOICE_CONFIG}: no está VOICE_TEXT_MAP`);
  const end = src.indexOf('\n];', start);
  const body = src.slice(start, end);
  const re = /\{ text: '((?:[^'\\]|\\.)*)', key: '((?:[^'\\]|\\.)*)' \}/g;
  const map = new Map();
  for (const m of body.matchAll(re)) map.set(normalise(decodeQuoted(m[1])), decodeQuoted(m[2]));
  return map;
}

function voiceOf(text, voiceMap, root) {
  const key = voiceMap.get(normalise(text));
  if (!key) return null;
  const file = `${VOICE_DIR}/${key}.mp3`;
  return fs.existsSync(path.join(root, file)) ? { key, file } : null;
}

// ── LOOK en el estado inicial ────────────────────────────────────────────────────────────────────────────────────

const CONDITIONALS = new Set(['ifFlag', 'ifHasItem', 'ifVisited', 'ifWalletConnected', 'web3Require']);

/**
 * Frases que dice Dex al mirar, en el estado inicial (flags a false, sin inventario, sin cartera: el build Funtico no
 * tiene web3). Recorre el script como ScriptEngine: en cada condicional toma `else`. Solo cuenta `say`/`sayBrief` de
 * Dex (sin speaker y sin pantalla).
 */
export function initialLookLines(ops, voices) {
  const lines = [];
  const walk = (list) => {
    for (const op of list ?? []) {
      if (!op || typeof op !== 'object') continue;
      if (op.op === 'say' || op.op === 'sayBrief') {
        if (typeof op.text === 'string' && normalise(op.text) && !op.screen && speakerFor(op.speaker, voices) === 'player') lines.push(op.text);
      } else if (CONDITIONALS.has(op.op)) {
        walk(op.else);
      }
    }
  };
  walk(ops);
  return lines;
}

/** Visible al empezar la partida (HotspotVisibility con todo a false). */
export function visibleAtStart(hs) {
  if (hs.showWhenFlag) return false;
  const conds = hs.hideWhen === undefined ? [] : Array.isArray(hs.hideWhen) ? hs.hideWhen : [hs.hideWhen];
  // `!x` se cumple con todo a false; `x` no. Oculto si TODAS se cumplen.
  if (conds.length && conds.every((c) => String(c).trim().startsWith('!'))) return false;
  return true;
}

const nameWords = (name) => String(name).toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/)
  .filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/s$/, ''));

/** Frase de SYMPTOM: la primera que no dice el nombre del objetivo; si todas lo dicen, la primera. */
function pickPhrase(lines, name) {
  const words = nameWords(name);
  const leaks = (t) => { const n = ` ${normalise(t)} `; return words.some((w) => n.includes(` ${w} `) || n.includes(` ${w}s `)); };
  const clean = lines.findIndex((t) => !leaks(t));
  const i = clean >= 0 ? clean : 0;
  return { index: i, nameLeak: leaks(lines[i]) };
}

function overlapFrac(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

function pxBox(b, world) {
  return { x: (b.x / 100) * world.width, y: (b.y / 100) * world.height, w: (b.w / 100) * world.width, h: (b.h / 100) * world.height };
}

function similar(a, b, world) {
  const wa = nameWords(a.name);
  if (nameWords(b.name).some((w) => wa.includes(w))) return true;
  const pa = pxBox(a.bounds, world);
  const pb = pxBox(b.bounds, world);
  const within = (r) => r >= 1 / SIMILAR_RATIO && r <= SIMILAR_RATIO;
  if (!within((pa.w * pa.h) / (pb.w * pb.h)) || !within((pa.w / pa.h) / (pb.w / pb.h))) return false;
  const dx = Math.abs(pa.x + pa.w / 2 - (pb.x + pb.w / 2));
  const dy = Math.abs(pa.y + pa.h / 2 - (pb.y + pb.h / 2));
  const side = Math.max(pa.w, pa.h, pb.w, pb.h);
  return Math.hypot(dx, dy) < NEAR_FACTOR * side;
}

// ── chad_fud ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LEARNED = /^fud_r\d+$/;

/**
 * Rondas del duelo: nodos con elecciones cuya condición es una réplica aprendida (`fud_rN`). Buena = la que no lleva
 * al nodo `lose`. Se descartan la salida de «no la sé» (`!fud_rN`) y las que piden otra cosa (el Rare Pepe de i7):
 * una ronda solo entra si queda exactamente una buena entre sus réplicas.
 */
export function relapseRounds(tree, voiceMap, root) {
  const rounds = [];
  const order = [];
  // orden del árbol: desde start, siguiendo la réplica buena
  const seen = new Set();
  const visit = (id) => {
    if (!id || seen.has(id) || !tree.nodes[id]) return;
    seen.add(id);
    order.push(id);
    const node = tree.nodes[id];
    if (node.next) visit(node.next);
    for (const c of node.choices ?? []) visit(c.next);
  };
  visit(tree.start);
  for (const id of order) {
    const node = tree.nodes[id];
    const opts = (node.choices ?? []).filter((c) => typeof c.when === 'string' && LEARNED.test(c.when));
    if (opts.length < 2) continue;
    const good = opts.filter((c) => c.next !== 'lose');
    if (good.length !== 1) continue;
    rounds.push({
      id,
      fud: node.text,
      fudVoice: voiceOf(node.text, voiceMap, root),
      options: opts.map((c) => ({ text: c.text, learn: c.when, voice: voiceOf(c.text, voiceMap, root) })),
      correct: opts.indexOf(good[0]),
    });
  }
  return rounds;
}

// ── catálogo ─────────────────────────────────────────────────────────────────────────────────────────────────────

function readScene(root, id) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes', id, 'scene.json'), 'utf8'));
}

/** Construye el catálogo (objeto JSON) y la lista de descartes con su motivo. */
export function buildCatalog({ root = DEFAULT_ROOT, scenes = DEFAULT_SCENES } = {}) {
  const voices = loadVoices(root);
  const voiceMap = loadVoiceMap(root);
  const out = { schema: CATALOG_SCHEMA, units: 'percent-of-world', scenes: {}, targets: [], relapse: null };
  const excluded = [];
  for (const sceneId of scenes) {
    const data = readScene(root, sceneId);
    const world = data.render?.world;
    if (!world?.width || !world?.height) throw new Error(`${sceneId}: falta render.world`);
    out.scenes[sceneId] = { world: { width: world.width, height: world.height }, background: `assets/scenes/${sceneId}/${data.assets?.background ?? 'background.png'}` };
    const all = (data.regions?.hotspots ?? []).filter((h) => h && h.bounds);
    const visible = all.filter(visibleAtStart);
    const cands = [];
    for (const hs of all) {
      const why = (reason) => excluded.push({ id: `${sceneId}:${hs.id}`, reason });
      if (!visibleAtStart(hs)) { why('no visible al empezar (showWhenFlag/hideWhen)'); continue; }
      const lines = initialLookLines(hs.scripts?.LOOK, voices);
      if (!lines.length) { why('sin frase LOOK de Dex en el estado inicial'); continue; }
      const px = pxBox(hs.bounds, world);
      if (Math.min(px.w, px.h) < MIN_SIDE_PX) { why(`lado menor ${Math.round(Math.min(px.w, px.h))} px < ${MIN_SIDE_PX}`); continue; }
      const clash = visible.find((o) => o !== hs && overlapFrac(hs.bounds, o.bounds) > MAX_OVERLAP);
      if (clash) { why(`solapa > ${MAX_OVERLAP * 100} % con ${clash.id}`); continue; }
      cands.push({ hs, lines, px });
    }
    // frases repetidas dentro del catálogo: SYMPTOM sería ambiguo → fuera las dos
    const firstNorm = (c) => normalise(c.lines[pickPhrase(c.lines, c.hs.name).index]);
    const dup = new Set();
    const seen = new Map();
    for (const c of cands) { const n = firstNorm(c); if (seen.has(n)) { dup.add(n); } else seen.set(n, c); }
    for (const c of cands) {
      const id = `${sceneId}:${c.hs.id}`;
      if (dup.has(firstNorm(c))) { excluded.push({ id, reason: 'frase LOOK repetida en otro objetivo' }); continue; }
      const size = Math.sqrt(c.px.w * c.px.h) / world.height;
      const neighbours = cands.filter((o) => o !== c && similar(c.hs, o.hs, world)).map((o) => `${sceneId}:${o.hs.id}`);
      const effective = neighbours.length ? size * SIMILAR_PENALTY : size;
      const bucket = effective < HARD_SIZE ? 'hard' : effective >= EASY_SIZE ? 'easy' : 'medium';
      const pick = pickPhrase(c.lines, c.hs.name);
      const phrase = c.lines[pick.index];
      out.targets.push({
        id,
        scene: sceneId,
        hotspot: c.hs.id,
        name: c.hs.name,
        bounds: { x: c.hs.bounds.x, y: c.hs.bounds.y, w: c.hs.bounds.w, h: c.hs.bounds.h },
        look: c.lines,
        phrase,
        voice: voiceOf(phrase, voiceMap, root),
        nameLeak: pick.nameLeak,
        size: r4(size),
        effective: r4(effective),
        similar: neighbours,
        bucket,
      });
    }
  }
  const pool = readScene(root, 'recovery_pool');
  const tree = pool.dialogues?.chad_fud;
  if (!tree) throw new Error('recovery_pool: no está el árbol chad_fud');
  out.relapse = { scene: 'recovery_pool', tree: 'chad_fud', rounds: relapseRounds(tree, voiceMap, root) };
  out.hash = catalogHash(out);
  return { catalog: out, excluded };
}

/** JSON con claves ordenadas: lo que se hashea. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** sha256 (hex) del catálogo sin su campo hash. */
export function catalogHash(catalog) {
  const { hash: _hash, ...rest } = catalog;
  return crypto.createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

export function serialize(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function report({ catalog, excluded }) {
  const rows = [];
  for (const t of catalog.targets) rows.push(`${t.bucket.padEnd(6)} ${t.size.toFixed(3)} ${t.effective.toFixed(3)} ${t.id.padEnd(34)} ${t.voice ? 'voz' : '---'} ${t.nameLeak ? 'NOMBRE' : '      '} ${t.similar.join(',')}`);
  rows.push('', 'Descartes:', ...excluded.map((e) => `  ${e.id}: ${e.reason}`), '', 'RELAPSE:');
  for (const r of catalog.relapse.rounds) rows.push(`  ${r.id}: ${r.options.length} opciones, buena ${r.correct}, voz FUD ${r.fudVoice ? 'sí' : 'no'}`);
  const count = {};
  for (const t of catalog.targets) count[`${t.scene}/${t.bucket}`] = (count[`${t.scene}/${t.bucket}`] ?? 0) + 1;
  rows.push('', JSON.stringify(count), `hash ${catalog.hash}`);
  return rows.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const root = path.resolve(opt('--root') ?? DEFAULT_ROOT);
  const scenes = opt('--scenes')?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_SCENES;
  const built = buildCatalog({ root, scenes });
  const text = serialize(built.catalog);
  const file = path.join(root, CATALOG_FILE);
  if (args.includes('--report')) {
    console.log(report(built));
  } else if (args.includes('--check')) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur !== text) {
      console.error(`build-triage-catalog: ${CATALOG_FILE} no está al día (node scripts/funtico/build-triage-catalog.mjs y commit)`);
      process.exit(1);
    }
    console.log(`build-triage-catalog: al día (${built.catalog.targets.length} objetivos, hash ${built.catalog.hash.slice(0, 12)})`);
  } else {
    fs.writeFileSync(file, text);
    console.log(`build-triage-catalog: ${CATALOG_FILE} (${built.catalog.targets.length} objetivos, ${built.excluded.length} descartes, hash ${built.catalog.hash.slice(0, 12)})`);
  }
}

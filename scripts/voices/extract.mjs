#!/usr/bin/env node
// A0.3 (plan SCUMM): extractor de texto hablado. Node puro (20/22), ESM, sin dependencias.
//
//   node scripts/voices/extract.mjs [--missing] [--root <dir>]
//
// Escribe en stdout un JSON [{ speaker, text, key, kind, status, sources }] con TODO texto que el juego pasa a
// VoiceSystem (una entrada por clave). --missing deja solo los que no tienen mp3 (lo que lee generate.py).
//
// Qué cuenta como «hablado» (cómo suena hoy; si cambia el código, cambia aquí):
//   - UIScene pone voz a: el evento `say` (ScriptEngine say y sayBrief sin callback, GameScene, ScummUI) y al
//     `say` de DialogueSystem (texto de cada nodo). Lo busca por texto: VoiceSystem.normalise (100 primeros
//     caracteres, minúsculas, solo [a-z0-9 ]) contra VOICE_TEXT_MAP. Las cinemáticas `narrative` suenan por
//     escena con NARRATOR_SEQUENCES['<escena>:narrative'].
//   - Escenas (assets/scenes/*/scene.json) y assets/config/global.json: toda op say/sayBrief en cualquier
//     sitio (hotspots, triggers, combos, onEnter, then/else, onSuccess/onFail, onEnter de nodos…), el texto
//     de cada nodo de diálogo, npcs[].giveResponses/useResponses (A2.5: cada valor, frase o lista, `_default`
//     incluido; una cadena con marcador como {item} se salta), regions.hotspots[].useResponses (A2.5: listas, con
//     `_default`) y las líneas de cada op narrative.
//     sayBrief se incluye aunque hoy UIScene no le pone voz (plan A0.3: así el clip ya existe si se activa).
//   - A2.5, assets/config/fail-responses.json (respuestas de fallo, src/systems/FailResponses.ts): todas las bolsas
//     (verbDefaults, itemVerbDefaults, itemHotspot, itemNpc, itemItem.default y .pairs[].lines, items.<id>).
//   - Código (CODE_SOURCES, abajo): tablas de frases de ScummUI y los literales que se emiten como `say`. Solo
//     literales: una plantilla con ${…} queda fuera (desde A2.5 ninguna respuesta de fallo es plantilla).
//   - Diario (A2.9, assets/journal/*.json): lo que dice Anon por teléfono (puzzles[].hints y anonIdle), con speaker
//     «Anon» → hablante anon. Los objetivos y las notas solo se leen en pantalla: sin voz. La frase de relleno de
//     src/systems/Journal.ts (ANON_FALLBACK) va en CODE_SOURCES con `speaker: 'anon'`.
//   - Fuera: choices[].text (ChoicePanel no las lee), titleCard (UIScene tiene la voz desactivada),
//     achievement, textos de interfaz y TrailerScene.
//
// Hablante (voices.json → match): speaker del op o del nodo en minúsculas; sin speaker = player. Las
// respuestas de NPC a objetos las dice el narrador-protagonista (son acotaciones con citas): player. Las respuestas
// de fallo (A2.5: useResponses de hotspots y fail-responses.json) también: player.
// Clave: <speaker>_<6 primeras palabras normalizadas>_<md5(texto completo) 8>, igual que
// generate_memelab_voices.py. Si el texto ya tiene clip en el mapa anterior a A0.3 (fixed-keys.json, mismas
// reglas de búsqueda que VoiceSystem) se usa esa clave, aunque siga un esquema viejo.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const VOICE_DIR = 'assets/audio/voice';

/** Fuentes de código: `blocks` = marcadores tras los que se leen literales hasta el `;` que cierra la sentencia. */
export const CODE_SOURCES = [
  {
    file: 'src/ui/ScummUI.ts',
    blocks: ['ITEM_DESCS: Record<string, string> =', 'ITEM_VERB_RESPONSES: Record<string, Partial<Record<Verb, string>>> ='],
    emitSay: true,
  },
  { file: 'src/scenes/GameScene.ts', blocks: [], emitSay: true },
  // A2.5: frase de último recurso si una respuesta de fallo no encuentra bolsa
  { file: 'src/systems/FailResponses.ts', blocks: ['LAST_RESORT ='] },
  { file: 'src/scenes/UIScene.ts', blocks: [], emitSay: true },
  { file: 'src/systems/ScriptEngine.ts', blocks: [], ctxSay: true },
  // A2.9: frase de relleno de Anon si un capítulo del diario no trae anonIdle
  { file: 'src/systems/Journal.ts', blocks: ['ANON_FALLBACK ='], speaker: 'anon' },
];

/** A2.5: respuestas de fallo globales (src/systems/FailResponses.ts). */
export const FAIL_RESPONSES_FILE = 'assets/config/fail-responses.json';

/** A2.9: carpeta del diario (un JSON por capítulo) y quién habla en él. */
export const JOURNAL_DIR = 'assets/journal';
export const JOURNAL_SPEAKER = 'Anon';

// ── claves (idénticas a VoiceSystem.normalise y a generate_memelab_voices.py) ─────────────────────────────

/** VoiceSystem.normalise: lo que se compara al buscar el clip de un texto. */
export function normalise(text) {
  return String(text).slice(0, 100).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** generate_memelab_voices.py norm(): 6 primeras palabras unidas por _. */
export function slug(text) {
  return normalise(text).split(' ').filter(Boolean).slice(0, 6).join('_');
}

export function md5_8(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex').slice(0, 8);
}

export function keyFor(speaker, text) {
  return `${speaker}_${slug(text)}_${md5_8(text)}`;
}

export function loadVoices(root = DEFAULT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'scripts/voices/voices.json'), 'utf8'));
}

/** Campo speaker de una op o nodo → id de hablante de voices.json. */
export function speakerFor(raw, voices) {
  if (!raw || !String(raw).trim()) return 'player';
  const s = String(raw).toLowerCase();
  for (const m of voices.match ?? []) if (s.includes(m.contains)) return m.speaker;
  return voices.speakers?.[s] ? s : 'npc';
}

const hasWords = (t) => typeof t === 'string' && normalise(t) !== '';
/** A2.5: marcador o interpolación ({item}, ${…}): ese texto depende del objeto y no puede tener clip */
export const hasMarker = (t) => /\$\{|\{[^{}]*\}/.test(t);
/** A2.5: frase o lista de frases (useResponses/giveResponses) → [[texto, sufijo de ruta]] con voz posible */
const responseLines = (v) => (Array.isArray(v) ? v.map((t, i) => [t, `[${i}]`]) : [[v, '']]).filter(([t]) => hasWords(t) && !hasMarker(t));

// ── escenas ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Texto hablado de una escena (o de global.json). Devuelve [{ kind: 'line'|'narrative', speaker, text, where }].
 * kind 'narrative' lleva además `scene` y `index` (posición de la op narrative dentro de la escena).
 */
export function extractScene(sceneId, data, voices) {
  const out = [];
  let narrIndex = 0;
  const walk = (v, where) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    if (v.op === 'say' || v.op === 'sayBrief') {
      if (hasWords(v.text)) out.push({ kind: 'line', speaker: speakerFor(v.speaker, voices), text: v.text, where: `${where} ${v.op}` });
    } else if (v.op === 'narrative' && Array.isArray(v.lines)) {
      const idx = narrIndex++;
      for (const line of v.lines) if (hasWords(line)) out.push({ kind: 'narrative', speaker: 'nar', text: line, where: `${where} narrative`, scene: sceneId, index: idx });
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'dialogues' || k === 'npcs') continue; // se tratan aparte (estructura propia)
      walk(x, where ? `${where}.${k}` : k);
    }
  };
  walk(data, '');
  for (const [treeId, tree] of Object.entries(data.dialogues ?? {})) {
    for (const [nodeId, node] of Object.entries(tree?.nodes ?? {})) {
      const where = `dialogues.${treeId}.${nodeId}`;
      if (hasWords(node?.text)) out.push({ kind: 'line', speaker: speakerFor(node.speaker, voices), text: node.text, where });
      walk(node?.onEnter ?? [], `${where}.onEnter`);
    }
  }
  for (const npc of data.npcs ?? []) {
    for (const field of ['giveResponses', 'useResponses']) {
      for (const [itemId, value] of Object.entries(npc?.[field] ?? {})) {
        for (const [text, i] of responseLines(value)) out.push({ kind: 'line', speaker: 'player', text, where: `npcs.${npc.id}.${field}.${itemId}${i}` });
      }
    }
    walk(npc?.scripts ?? [], `npcs.${npc?.id}.scripts`);
  }
  // A2.5: respuestas de fallo de cada hotspot (pareja específica o _default)
  for (const hs of data.regions?.hotspots ?? []) {
    for (const [itemId, value] of Object.entries(hs?.useResponses ?? {})) {
      for (const [text, i] of responseLines(value)) out.push({ kind: 'line', speaker: 'player', text, where: `regions.hotspots.${hs.id}.useResponses.${itemId}${i}` });
    }
  }
  return out;
}

/** A2.5: todas las frases de assets/config/fail-responses.json (las dice Dex: player). */
export function extractFailResponses(file, data) {
  const out = [];
  const push = (v, where) => { for (const [text, i] of responseLines(v)) out.push({ kind: 'line', speaker: 'player', text, where: `${file}: ${where}${i}` }); };
  for (const field of ['verbDefaults', 'itemVerbDefaults', 'itemNpc', 'items']) {
    for (const [k, v] of Object.entries(data?.[field] ?? {})) push(v, `${field}.${k}`);
  }
  push(data?.itemHotspot ?? [], 'itemHotspot');
  push(data?.itemItem?.default ?? [], 'itemItem.default');
  (data?.itemItem?.pairs ?? []).forEach((p, i) => push(p?.lines ?? [], `itemItem.pairs[${i}].lines`));
  return out;
}

// ── código ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lexer mínimo de TS: devuelve los literales de cadena ('…' y "…"; las plantillas `…` se saltan) desde `start`
 * hasta el `;` de profundidad 0 o hasta que se cierra el paréntesis/llave de partida. Los literales entre `{`/`,`
 * y `:` son claves de objeto y no cuentan (el `:` de un ternario sí).
 */
export function literalsFrom(src, start, { stopAtSemicolon = true } = {}) {
  const lits = [];
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let raw = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { raw += src[j] + src[j + 1]; j += 2; } else raw += src[j++]; }
      const after = src.slice(j + 1).match(/^\s*(.)/)?.[1];
      const before = src.slice(0, i).match(/(\S)\s*$/)?.[1];
      const isKey = after === ':' && (before === '{' || before === ',');
      if (c !== '`' && !isKey) lits.push(decodeLiteral(raw));
      i = j;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth < 0) break; }
    else if (c === ';' && depth <= 0 && stopAtSemicolon) break;
  }
  return lits;
}

/** Cuerpo de un literal JS ya sin comillas → texto. */
export function decodeLiteral(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[e] ?? e;
  });
}

/** Literales hablados de un fichero de código según su entrada de CODE_SOURCES. */
export function extractCode(file, src, spec) {
  const out = [];
  const speaker = spec.speaker ?? 'player';
  const push = (text, how) => { if (hasWords(text)) out.push({ kind: 'line', speaker, text, where: `${file} ${how}` }); };
  for (const marker of spec.blocks ?? []) {
    const at = src.indexOf(marker);
    if (at < 0) throw new Error(`${file}: no encuentro «${marker}» (¿ha cambiado el código? actualiza CODE_SOURCES en scripts/voices/extract.mjs)`);
    for (const t of literalsFrom(src, at + marker.length)) push(t, marker.split(':')[0].replace(/^const /, ''));
  }
  const calls = [];
  if (spec.emitSay) calls.push(/\.emit\(\s*'say'\s*,/g);
  if (spec.ctxSay) calls.push(/ctx\.say\(/g);
  for (const re of calls) {
    for (const m of src.matchAll(re)) {
      // solo el primer argumento (el texto): hasta la primera coma de profundidad 0
      const lits = firstArgLiterals(src, m.index + m[0].length);
      const line = src.slice(0, m.index).split('\n').length;
      for (const t of lits) push(t, `línea ${line}`);
    }
  }
  return out;
}

function firstArgLiterals(src, start) {
  // corta el primer argumento y lo pasa por literalsFrom
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1; i = j; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) { end = i; break; } depth--; }
    else if (c === ',' && depth === 0) { end = i; break; }
  }
  return literalsFrom(src.slice(start, end) + ';', 0);
}

// ── diario (A2.9) ─────────────────────────────────────────────────────────────────────────────────────────

/** Lo que Anon dice de un capítulo del diario: las tres pistas de cada puzle y las frases de relleno. */
export function extractJournal(file, data, voices) {
  const out = [];
  const speaker = speakerFor(JOURNAL_SPEAKER, voices);
  (data?.puzzles ?? []).forEach((p, i) => {
    (Array.isArray(p?.hints) ? p.hints : []).forEach((t, k) => {
      if (hasWords(t)) out.push({ kind: 'line', speaker, text: t, where: `${file}: puzzles.${p?.id ?? i}.hints[${k}]` });
    });
  });
  (Array.isArray(data?.anonIdle) ? data.anonIdle : []).forEach((t, k) => {
    if (hasWords(t)) out.push({ kind: 'line', speaker, text: t, where: `${file}: anonIdle[${k}]` });
  });
  return out;
}

// ── mapa anterior a A0.3 y resolución ─────────────────────────────────────────────────────────────────────

export function loadFixed(root = DEFAULT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'scripts/voices/fixed-keys.json'), 'utf8'));
}

/** Map normalise(texto) → clave del mapa anterior (el último gana, como VoiceSystem.registerAll). */
export function fixedLookup(fixed) {
  const m = new Map();
  for (const e of fixed.textMap) if (e.key) m.set(normalise(e.text), e.key);
  return m;
}

/**
 * Agrupa las entradas por clave y decide su estado:
 *   fixed   ya tenía clip en el mapa anterior (o su escena ya tiene NARRATOR_SEQUENCES)
 *   clip    clave nueva con mp3 en disco (build-config la registra)
 *   missing clave nueva sin mp3 (generate.py la crea)
 */
export function resolve(raw, { fixed, files }) {
  const lookup = fixedLookup(fixed);
  const seqs = fixed.narratorSequences ?? {};
  const byKey = new Map();
  for (const e of raw) {
    let key;
    let status;
    if (e.kind === 'narrative' && seqs[`${e.scene}:narrative`]) {
      key = `${e.scene}:narrative`; status = 'fixed';
    } else if (e.kind === 'line' && lookup.has(normalise(e.text))) {
      key = lookup.get(normalise(e.text)); status = 'fixed';
    } else {
      key = keyFor(e.speaker, e.text); status = files.has(key) ? 'clip' : 'missing';
    }
    const prev = byKey.get(key);
    if (prev) { prev.sources.push(e.where); continue; }
    const out = { speaker: e.speaker, text: e.kind === 'narrative' && status === 'fixed' ? `(${e.scene}: cinemática)` : e.text, key, kind: e.kind, status, sources: [e.where] };
    if (e.kind === 'narrative') { out.scene = e.scene; out.index = e.index; }
    byKey.set(key, out);
  }
  return [...byKey.values()];
}

// ── disco ─────────────────────────────────────────────────────────────────────────────────────────────────

export function listClips(root = DEFAULT_ROOT) {
  const dir = path.join(root, VOICE_DIR);
  return new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)) : []);
}

/** Todo el texto hablado del proyecto, sin resolver: [{ kind, speaker, text, where, scene? }]. */
export function extractProject(root = DEFAULT_ROOT, voices = loadVoices(root)) {
  const raw = [];
  const scenesDir = path.join(root, 'assets/scenes');
  for (const id of fs.readdirSync(scenesDir).sort()) {
    const f = path.join(scenesDir, id, 'scene.json');
    if (!fs.existsSync(f)) continue;
    for (const e of extractScene(id, JSON.parse(fs.readFileSync(f, 'utf8')), voices)) raw.push({ ...e, where: `${id}: ${e.where}` });
  }
  const global = path.join(root, 'assets/config/global.json');
  if (fs.existsSync(global)) {
    for (const e of extractScene('global', JSON.parse(fs.readFileSync(global, 'utf8')), voices)) raw.push({ ...e, where: `global.json: ${e.where}` });
  }
  const fail = path.join(root, FAIL_RESPONSES_FILE);
  if (fs.existsSync(fail)) raw.push(...extractFailResponses(FAIL_RESPONSES_FILE, JSON.parse(fs.readFileSync(fail, 'utf8'))));
  const journalDir = path.join(root, JOURNAL_DIR);
  if (fs.existsSync(journalDir)) {
    for (const name of fs.readdirSync(journalDir).filter((f) => f.endsWith('.json')).sort()) {
      raw.push(...extractJournal(`${JOURNAL_DIR}/${name}`, JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8')), voices));
    }
  }
  for (const spec of CODE_SOURCES) {
    const f = path.join(root, spec.file);
    if (!fs.existsSync(f)) throw new Error(`no existe ${spec.file} (actualiza CODE_SOURCES)`);
    raw.push(...extractCode(spec.file, fs.readFileSync(f, 'utf8'), spec));
  }
  return raw;
}

export function extractAll(root = DEFAULT_ROOT) {
  return resolve(extractProject(root), { fixed: loadFixed(root), files: listClips(root) });
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let missing = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--missing') missing = true;
    else if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  let list = extractAll(root);
  if (missing) list = list.filter((e) => e.status === 'missing');
  process.stdout.write(JSON.stringify(list, null, 2) + '\n');
  const by = (s) => list.filter((e) => e.status === s).length;
  process.stderr.write(`voces: ${list.length} textos hablados (${by('fixed')} con clip anterior, ${by('clip')} con clip nuevo, ${by('missing')} sin clip)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}

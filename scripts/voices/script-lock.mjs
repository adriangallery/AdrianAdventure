#!/usr/bin/env node
// A6.1 (plan SCUMM): «guion congelado» de las voces. Node puro (20/22), ESM, sin dependencias.
//
//   node scripts/voices/script-lock.mjs [--check] [--stats] [--root <dir>]
//
// Saca TODO el texto hablado con extract.mjs (el mismo que usan voices.yml y voice-coverage) y escribe
// qa/voices-script.lock.json: una entrada por clip (clave = nombre del mp3 en assets/audio/voice), ordenadas por
// clave, con el papel (rol de reparto de scripts/voices/elevenlabs-cast.json), el texto que se manda al TTS y un
// hash de texto + rol. A6.3 (scripts/voices/eleven-tts.mjs) lo usa como caché: una línea cuyo hash no cambia no se
// vuelve a generar. --check no escribe (sale con 1 si el lock no está al día); --stats imprime la tabla de A6.1.
//
// Fuera del lock: las cinemáticas `narrative` que ya tenían secuencia antigua (NARRATOR_SEQUENCES de fixed-keys.json)
// no traen su texto en extract.mjs; hoy no queda ninguna op narrative en las escenas (las aperturas son `say` del
// narrador), así que no falta nada.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT, extractProject, resolve, loadFixed, listClips } from './extract.mjs';

export const LOCK_FILE = 'qa/voices-script.lock.json';

/**
 * Papel de reparto. Es el hablante de voices.json salvo `npc`, que en el juego agrupa a tres voces distintas:
 * los monos de la izquierda (club inglés), los de la derecha (bros) y las máquinas sin personaje (Ledger, cajón ToS).
 */
export function roleFor(entry) {
  if (entry.speaker !== 'npc') return entry.speaker;
  const s = entry.sources.join(' ');
  if (/dialogues\.apes_left\./.test(s)) return 'apes_club';
  if (/dialogues\.apes_right\./.test(s)) return 'apes_bro';
  return 'device';
}

/** Texto que se manda al TTS: sin acotaciones *servos whir* (ElevenLabs las leería), espacios normales. */
export function ttsText(text) {
  const t = String(text).replace(/\*[^*\n]{1,60}\*/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  return t || String(text).replace(/\*/g, '').trim();
}

/** Tipo de línea para el presupuesto: diálogo/escena (historia) frente a respuestas genéricas de fallo y de objetos. */
export function categoryFor(entry) {
  const s = entry.sources.join(' ');
  if (/fail-responses|useResponses|giveResponses|LAST_RESORT/.test(s)) return 'fallo';
  if (/ITEM_DESCS|ITEM_VERB_RESPONSES/.test(s)) return 'objetos';
  if (/dialogues\./.test(s)) return 'dialogo';
  return 'escena';
}

export const lineHash = (text, role) => crypto.createHash('sha256').update(`${role}\n${text}`, 'utf8').digest('hex').slice(0, 16);

export function buildLock(root = DEFAULT_ROOT) {
  const resolved = resolve(extractProject(root), { fixed: loadFixed(root), files: listClips(root) });
  const lines = resolved
    .filter((e) => !(e.kind === 'narrative' && e.status === 'fixed'))
    .map((e) => {
      const role = roleFor(e);
      const tts = ttsText(e.text);
      return { key: e.key, speaker: e.speaker, role, category: categoryFor(e), text: e.text, tts, chars: tts.length, hash: lineHash(tts, role) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    _doc: 'A6.1: guion congelado de las voces (scripts/voices/script-lock.mjs). Una entrada por mp3 de assets/audio/voice; hash = sha256(rol + texto TTS). No editar a mano.',
    total: { lines: lines.length, chars: lines.reduce((n, l) => n + l.chars, 0) },
    lines,
  };
}

export function stats(lock) {
  const by = new Map();
  for (const l of lock.lines) {
    const k = `${l.role}`;
    const s = by.get(k) ?? { role: l.role, lines: 0, chars: 0, cats: {} };
    s.lines++; s.chars += l.chars;
    s.cats[l.category] = (s.cats[l.category] ?? 0) + l.chars;
    by.set(k, s);
  }
  return [...by.values()].sort((a, b) => b.chars - a.chars);
}

const serialise = (lock) => JSON.stringify(lock, null, 1) + '\n';

function main(argv) {
  let root = DEFAULT_ROOT;
  let check = false;
  let showStats = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--stats') showStats = true;
    else if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  const lock = buildLock(root);
  const file = path.join(root, LOCK_FILE);
  const text = serialise(lock);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (showStats) {
    console.log('rol\tlíneas\tcaracteres\t(dialogo/escena/fallo/objetos)');
    for (const s of stats(lock)) console.log(`${s.role}\t${s.lines}\t${s.chars}\t${['dialogo', 'escena', 'fallo', 'objetos'].map((c) => s.cats[c] ?? 0).join('/')}`);
    console.log(`TOTAL\t${lock.total.lines}\t${lock.total.chars}`);
  }
  if (check) {
    if (current === text) { console.log(`${LOCK_FILE} al día`); return 0; }
    console.log(`${LOCK_FILE} desactualizado: ejecuta node scripts/voices/script-lock.mjs`);
    return 1;
  }
  if (current !== text) fs.writeFileSync(file, text);
  if (!showStats) console.log(`${LOCK_FILE}: ${current === text ? 'sin cambios' : 'escrito'} (${lock.total.lines} líneas, ${lock.total.chars} caracteres)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}

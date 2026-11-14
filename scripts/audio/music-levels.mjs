// A8.3 (plan SCUMM): niveles de intensidad de los temas de ElevenLabs. Cada `art/music/<tema>/plan.json` con
// `partes.completo.niveles` declara, para `assets/audio/music/<tema>-n<nivel>.mp3`, el BPM, los compases y la tonalidad
// PEDIDOS (los bloques de la generación se piden en compases enteros y se cortan justo en sus límites). analyze-tempo.mjs
// y analyze-music.mjs usan esta rejilla declarada para esos ficheros (y miden aparte para comprobarla): a 132 BPM el peine
// da medio tiempo y un triunfo de 4 compases es demasiado corto para medir la tonalidad con fiabilidad.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = join(ROOT, 'art', 'music');
const NOTES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** "D major" → { tonic: 2, mode: 'major' } */
export function parseKey(s) {
  const m = /^([A-G][#b]?)\s+(major|minor)$/.exec(String(s).trim());
  if (!m) throw new Error(`tonalidad no reconocida: ${s}`);
  return { tonic: NOTES[m[1]], mode: m[2] };
}

/** Nombre de fichero (sin .mp3) → { tema, nivel, bpm, bars, key, loop } de todos los planes con niveles */
export function declaredLevels(artDir = ART) {
  const out = {};
  if (!existsSync(artDir)) return out;
  for (const tema of readdirSync(artDir).sort()) {
    const p = join(artDir, tema, 'plan.json');
    if (!existsSync(p)) continue;
    const plan = JSON.parse(readFileSync(p, 'utf8'));
    const part = plan.partes?.completo;
    const niveles = part?.niveles;
    if (!niveles) continue;
    // `partes.completo.key`: la tonalidad en la que salió de verdad la generación si no es la pedida (medida en los 4 niveles)
    const key = parseKey(part.key ?? plan.key);
    for (const n of niveles) {
      out[`${plan.tema}-n${n.nivel}`] = { tema: plan.tema, nivel: n.nivel, bpm: plan.bpm, bars: n.compases, key, loop: n.bucle !== false };
    }
  }
  return out;
}

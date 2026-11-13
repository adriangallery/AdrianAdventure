// A7.3 (plan SCUMM): ningún emoji ni símbolo fuera de la fuente del juego en el texto de la interfaz.
// node --test tests/no-emoji-ui.test.mjs
//
// En un Chrome de Linux sin fuente de emoji (o un Android viejo) '💾', '🏆', '🔊'… salen como cuadraditos vacíos.
// Los iconos van dibujados (src/ui/icons.ts). Esta prueba mira los literales de cadena de src/** (sin comentarios,
// con los escapes \u{…} y \uXXXX ya resueltos, y las entidades &#…; de HTML) y las cadenas de los JSON de assets/
// que se pintan en pantalla, y falla si un carácter no está en Press Start 2P (assets/fonts/PressStart2P-Regular.ttf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Caracteres de Press Start 2P (`fc-query --format='%{charset}' assets/fonts/PressStart2P-Regular.ttf`). Trae, entre
 * otros, ← ↑ → ↓ ▲ ▶ ▼ ◀ ★ ☆ ♪ ♠ ♣ ♥ ♦ — … • « » ×; no trae ✓ ✕ ⚙ ☁ ⭐ ni ningún emoji.
 */
const FONT_CHARSET = '20-7f a0-148 14a-161 164-17f 192 21a-21b 2bc 2c6-2c7 2c9-2cb 2d7-2dd 300-301 326 335 37a 37e 384-38a 38c 38e-3a1 3a3-3ce 400-45f 462-463 46a-46b 472-475 490-49d 4a0-4a5 4aa-4b1 4b6-4bb 4c0-4c2 4cb-4cc 4cf-4d9 4dc-4df 4e2-4e9 4ee-4f9 51a-51d 524-525 2013-2015 2018-201a 201c-201e 2020-2022 2026 2030 2039-203a 2044 2074 20ac 20ae-20af 20b4 20b8 20bd 2116 2122 2190-2193 2202 2206 220f 2211 2215 221a 221e 222b 2248 2260 2264-2265 25b2 25b6 25bc 25c0 25ca 2605-2606 2660 2663 2665-2666 266a f100-f101 f8ff fb01-fb02';
const RANGES = FONT_CHARSET.split(' ').map((r) => r.split('-').map((h) => parseInt(h, 16))).map(([a, b]) => [a, b ?? a]);
/** Blancos y controles que no se pintan como glifo */
const INVISIBLE = new Set([0x09, 0x0a, 0x0d, 0x200b, 0x2028, 0x2029]);

export function inFont(cp) {
  return INVISIBLE.has(cp) || RANGES.some(([a, b]) => cp >= a && cp <= b);
}

/**
 * Excepciones justificadas (ruta relativa → motivo). Hoy: solo herramientas que no son interfaz del jugador.
 * Texto hablado/narrativo con un emoji NO se arregla aquí (lo decide quien escribe la historia): se apunta.
 */
export const EXCEPTIONS = {
  'src/qa/': 'API de QA y depuración (notas de consola, no se pintan en el juego)',
};

/** Quita comentarios // y /* *\/ de un fuente TS/JS dejando cadenas y plantillas (aproximado, suficiente aquí). */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c && !(c !== '`' && src[j] === '\n')) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Resuelve \u{1F4BE}, \uD83D…, &#x1F4BE; y &#128190; (un `\\u` escapado se deja: es texto literal). */
export function decodeEscapes(s) {
  return s
    .replace(/(?<!\\)((?:\\\\)*)\\u\{([0-9a-fA-F]+)\}/g, (_, pre, h) => pre + String.fromCodePoint(parseInt(h, 16)))
    .replace(/(?<!\\)((?:\\\\)*)\\u([0-9a-fA-F]{4})/g, (_, pre, h) => pre + String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Caracteres fuera de la fuente en un texto: [{ line, ch, cp }] */
export function badChars(text) {
  const out = [];
  text.split('\n').forEach((l, k) => {
    for (const ch of l) {
      const cp = ch.codePointAt(0);
      if (!inFont(cp)) out.push({ line: k + 1, ch, cp: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') });
    }
  });
  return out;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const excepted = (r) => Object.keys(EXCEPTIONS).some((p) => r.startsWith(p));

/** Cadenas de un JSON (valores, no claves) */
function jsonStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => jsonStrings(x, out));
  return out;
}

test('el filtro distingue emoji de lo que trae Press Start 2P', () => {
  for (const ok of ['Save / Load', '★ STORY', '▲▼', '→', '— … • « » ×', 'ñ á ¿']) assert.deepEqual(badChars(ok), [], ok);
  for (const bad of ['💾', '🏆 x', '✓', '⚙ Text', '☁', '⭐', '✕', '🔊', '⚔️']) assert.ok(badChars(bad).length > 0, bad);
  assert.equal(decodeEscapes("'\\u{1F4BE} Save'"), "'💾 Save'");
  assert.equal(decodeEscapes("'a \\\\u2014 b'"), "'a \\\\u2014 b'");
  assert.equal(stripComments("const a = 1; // 💾\n/* 🏆 */ const b = '✓';").includes('💾'), false);
});

test('src/**: ningún emoji ni símbolo fuera de la fuente en el texto de la interfaz', () => {
  const found = [];
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')]
    .filter((f) => /\.(ts|tsx|js|mjs|css|html)$/.test(f));
  for (const f of files) {
    const r = rel(f);
    if (excepted(r)) continue;
    const raw = readFileSync(f, 'utf8');
    const code = /\.(html|css)$/.test(f) ? raw.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) : stripComments(raw);
    for (const b of badChars(decodeEscapes(code))) found.push(`${r}:${b.line} ${b.ch} (${b.cp})`);
  }
  assert.deepEqual(found, [], `Emoji o símbolo que la fuente no trae (sale como cuadradito): usa un icono de src/ui/icons.ts.\n${found.join('\n')}`);
});

test('assets/**.json: ningún emoji en los textos que se pintan', () => {
  const found = [];
  for (const f of walk(path.join(ROOT, 'assets')).filter((x) => x.endsWith('.json'))) {
    const r = rel(f);
    if (excepted(r)) continue;
    let data;
    try { data = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const s of jsonStrings(data)) for (const b of badChars(s)) found.push(`${r}: «${s.slice(0, 60)}» ${b.ch} (${b.cp})`);
  }
  assert.deepEqual(found, [], `Emoji o símbolo que la fuente no trae en los textos de assets/:\n${found.join('\n')}`);
});

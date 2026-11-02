#!/usr/bin/env node
// A0.3 (plan SCUMM): cobertura de voces. Node puro (20/22), ESM, sin dependencias.
//
//   node scripts/voice-coverage.mjs [--json] [--root <dir>] [--no-write]
//
// Errores (código de salida 1):
//   sin-clip       texto hablado (scripts/voices/extract.mjs) sin mp3 en assets/audio/voice
//   desactualizado src/config/voice.config.ts no es lo que genera scripts/voices/build-config.mjs (un mp3 sin
//                  registrar en VOICE_AUDIO_KEYS, un clip nuevo que no está en VOICE_TEXT_MAP, o una edición a mano)
//   roto           clave de VOICE_TEXT_MAP o NARRATOR_SEQUENCES sin mp3
// Avisos: textos nuevos que chocan en VoiceSystem.normalise (solo suena uno) y excepciones que sobran.
// Excepciones con motivo en qa/voice-coverage-allow.json: [{ "key": "…" | "text": "<principio del texto>", "reason": "…" }]
// (solo durante la transición; una excepción sin motivo no vale). Escribe voice-coverage-report.{json,md}.
// Arreglo normal de un sin-clip: etiqueta la PR con `voices` (o Actions → voices → Run workflow) y el CI genera
// el mp3 con Kokoro y regenera voice.config.ts en la rama.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT, extractProject, resolve, loadFixed, listClips, normalise } from './voices/extract.mjs';
import { buildConfig, CONFIG_FILE } from './voices/build-config.mjs';

export const ALLOW_FILE = 'qa/voice-coverage-allow.json';

/** Aplica las excepciones a los sin-clip. Devuelve { missing, suppressed, allowProblems }. */
export function applyAllow(missingList, allow = []) {
  const allowProblems = [];
  const valid = [];
  allow.forEach((e, i) => {
    const what = e?.key ?? e?.text;
    if (!what) allowProblems.push(`entrada ${i}: sin key ni text, se ignora`);
    else if (!e.reason || !String(e.reason).trim()) allowProblems.push(`entrada ${i} (${what}): sin motivo, se ignora`);
    else valid.push({ ...e, index: i, used: false });
  });
  const missing = [];
  const suppressed = [];
  for (const m of missingList) {
    const hit = valid.find((e) => (e.key && e.key === m.key) || (e.text && m.text.startsWith(e.text)));
    if (hit) { hit.used = true; suppressed.push({ ...m, reason: hit.reason }); } else missing.push(m);
  }
  for (const e of valid) if (!e.used) allowProblems.push(`entrada ${e.index} (${e.key ?? e.text}): no silencia nada, bórrala`);
  return { missing, suppressed, allowProblems };
}

/** Claves que referencia un voice.config.ts (texto): { mapKeys, seqKeys } (para «roto»). */
export function parseConfigKeys(src) {
  const sec = (a, b) => { const i = src.indexOf(a); const j = b ? src.indexOf(b, i) : src.length; return i < 0 ? '' : src.slice(i, j < 0 ? src.length : j); };
  const mapKeys = [...sec('VOICE_TEXT_MAP', 'NARRATOR_SEQUENCES').matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  const seqKeys = [...sec('NARRATOR_SEQUENCES').matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  return { mapKeys, seqKeys };
}

/** Comprueba todo. `project` = { raw, fixed, files, configText, allow } para poder probarlo en memoria. */
export function checkCoverage({ raw, fixed, files, configText, allow = [] }) {
  const resolved = resolve(raw, { fixed, files });
  const built = buildConfig({ fixed, files, resolved });
  const { missing, suppressed, allowProblems } = applyAllow(resolved.filter((e) => e.status === 'missing'), allow);
  const errors = [];
  for (const m of missing) errors.push({ type: 'sin-clip', key: m.key, speaker: m.speaker, text: m.text, where: m.sources.join('; ') });
  if (configText !== built.text) {
    const pending = [...built.added.map, ...built.added.audio].filter((k) => !configText.includes(`'${k}'`));
    errors.push({ type: 'desactualizado', key: CONFIG_FILE, text: pending.length ? `sin registrar: ${pending.slice(0, 20).join(', ')}${pending.length > 20 ? ` (+${pending.length - 20})` : ''}` : 'difiere de lo que genera build-config.mjs (¿editado a mano?)', where: 'node scripts/voices/build-config.mjs' });
  }
  const { mapKeys, seqKeys } = parseConfigKeys(configText);
  for (const k of new Set([...mapKeys, ...seqKeys])) if (!files.has(k)) errors.push({ type: 'roto', key: k, text: 'la clave está en voice.config.ts y no hay mp3', where: CONFIG_FILE });
  const warnings = [];
  const fresh = resolved.filter((e) => e.kind === 'line' && e.status !== 'fixed');
  const byNorm = new Map();
  for (const e of fresh) { const n = normalise(e.text); if (byNorm.has(n)) warnings.push({ type: 'choque', key: e.key, text: `mismo principio que ${byNorm.get(n)}: VoiceSystem solo encontrará uno`, where: e.sources[0] }); else byNorm.set(n, e.key); }
  for (const p of allowProblems) warnings.push({ type: 'excepción', key: ALLOW_FILE, text: p, where: ALLOW_FILE });
  const count = (s) => resolved.filter((e) => e.status === s).length;
  const referenced = new Set([...resolved.map((e) => e.key), ...Object.values(fixed.narratorSequences ?? {}).flat()]);
  return {
    errors, warnings, suppressed,
    summary: {
      spoken: resolved.length, fixed: count('fixed'), newClips: count('clip'), missing: count('missing'),
      allowed: suppressed.length, clips: files.size, unreferencedClips: [...files].filter((k) => !referenced.has(k)).length,
      errors: errors.length, warnings: warnings.length,
    },
  };
}

const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(r) {
  const s = r.summary;
  const out = ['### Cobertura de voces (A0.3)', '', `**${s.errors ? `❌ ${s.errors} errores` : '✅ sin errores'} · avisos: ${s.warnings} · en excepción: ${s.allowed}**`, ''];
  out.push(`Textos hablados: ${s.spoken} (con clip del mapa anterior: ${s.fixed} · con clip nuevo: ${s.newClips} · sin clip: ${s.missing}). Clips en disco: ${s.clips} (${s.unreferencedClips} sin texto actual que los use).`);
  if (r.errors.length) {
    out.push('', '| Tipo | Clave | Texto | Dónde |', '|---|---|---|---|');
    for (const e of r.errors) out.push(`| ${e.type} | \`${mdEsc(e.key)}\` | ${mdEsc(String(e.text).slice(0, 140))} | ${mdEsc(e.where)} |`);
    if (r.errors.some((e) => e.type === 'sin-clip')) out.push('', 'Para generarlos: etiqueta la PR con `voices` o lanza Actions → voices → Run workflow en la rama.');
  }
  if (r.warnings.length) {
    out.push('', `<details><summary>Avisos · ${r.warnings.length}</summary>`, '', '| Tipo | Clave | Detalle |', '|---|---|---|');
    for (const w of r.warnings) out.push(`| ${w.type} | \`${mdEsc(w.key)}\` | ${mdEsc(w.text)} |`);
    out.push('', '</details>');
  }
  if (r.suppressed.length) {
    out.push('', `<details><summary>En excepción (${ALLOW_FILE}) · ${r.suppressed.length}</summary>`, '', '| Clave | Texto | Motivo |', '|---|---|---|');
    for (const m of r.suppressed) out.push(`| \`${m.key}\` | ${mdEsc(m.text.slice(0, 100))} | ${mdEsc(m.reason)} |`);
    out.push('', '</details>');
  }
  return out.join('\n') + '\n';
}

export function run(argv = process.argv.slice(2)) {
  let root = DEFAULT_ROOT;
  let json = false;
  let write = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--no-write') write = false;
    else if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else throw new Error(`opción desconocida: ${argv[i]}`);
  }
  const allowPath = path.join(root, ALLOW_FILE);
  const allowRaw = fs.existsSync(allowPath) ? JSON.parse(fs.readFileSync(allowPath, 'utf8')) : [];
  const configPath = path.join(root, CONFIG_FILE);
  const r = checkCoverage({
    raw: extractProject(root),
    fixed: loadFixed(root),
    files: listClips(root),
    configText: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '',
    allow: Array.isArray(allowRaw) ? allowRaw : allowRaw.allow ?? [],
  });
  const md = renderMarkdown(r);
  if (write) {
    fs.writeFileSync(path.join(root, 'voice-coverage-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'voice-coverage-report.md'), md);
  }
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.summary;
    console.log(`voice-coverage: ${s.spoken} textos hablados · ${s.fixed} con clip anterior · ${s.newClips} con clip nuevo · ${s.missing} sin clip (${s.allowed} en excepción)`);
    for (const e of r.errors) console.log(`  ERROR ${e.type}  ${e.key}  ${String(e.text).slice(0, 100)}  [${e.where}]`);
    for (const w of r.warnings) console.log(`  aviso ${w.type}  ${w.key}  ${w.text}`);
    console.log(`errores: ${s.errors} · avisos: ${s.warnings}`);
  }
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(); } catch (e) { console.error(e.stack ?? e.message); process.exitCode = 2; }
}

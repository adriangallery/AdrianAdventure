#!/usr/bin/env node
// A3.8 (plan SCUMM): inventario de frases de hotspot × verbo y de las respuestas de fallo. Node puro, sin dependencias.
//
//   node scripts/text-audit.mjs                 → resumen por escena: frases, flojas y por qué
//   node scripts/text-audit.mjs --list [escena] → cada frase con su ruta y sus etiquetas de flojera
//   node scripts/text-audit.mjs --diff <ref>    → frases cambiadas frente a <ref> (tabla por escena, total y %)
//   node scripts/text-audit.mjs --cited <ref>   → frases que existían en <ref>, ya no existen y siguen citadas
//                                                 literalmente en qa/, scripts/, tests/ o src/ (sale 1 si hay alguna)
//
// «Frase» = texto de un op say/sayBrief dentro de hotspots[].scripts[VERBO] (a cualquier profundidad), cada valor de
// hotspots[].useResponses/giveResponses, y cada frase de assets/config/fail-responses.json. No entran diálogos,
// cinemáticas (narrative), triggers ni onEnter: la pasada A3.8 es de hotspot × verbo.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = ['outside', 'lobby', 'upstairs', 'rooftop', 'basement', 'server_room', 'mountain', 'clinic_exterior',
  'clinic_interior', 'recovery_pool', 'memelab', 'treatment_room', 'epilogue_outside'];
const FAIL = 'assets/config/fail-responses.json';

function readJson(rel, ref) {
  if (!ref) return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 26 }));
}

function opsTexts(node, out) {
  if (Array.isArray(node)) { for (const n of node) opsTexts(n, out); return; }
  if (!node || typeof node !== 'object') return;
  if ((node.op === 'say' || node.op === 'sayBrief') && typeof node.text === 'string') out.push(node.text);
  for (const [k, v] of Object.entries(node)) if (k !== 'text' && typeof v === 'object') opsTexts(v, out);
}

function flatStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flatStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => flatStrings(x, out));
}

/** [{ scene, hotspot, verb, text }] */
export function collect(ref) {
  const rows = [];
  for (const scene of SCENES) {
    const s = readJson(`assets/scenes/${scene}/scene.json`, ref);
    for (const hs of s.regions?.hotspots ?? []) {
      for (const [verb, ops] of Object.entries(hs.scripts ?? {})) {
        const t = []; opsTexts(ops, t);
        for (const text of t) rows.push({ scene, hotspot: hs.id, verb, text });
      }
      for (const key of ['useResponses', 'giveResponses']) {
        for (const [item, v] of Object.entries(hs[key] ?? {})) {
          const t = []; flatStrings(v, t);
          for (const text of t) rows.push({ scene, hotspot: hs.id, verb: `${key === 'useResponses' ? 'USE' : 'GIVE'}:${item}`, text });
        }
      }
    }
  }
  const f = readJson(FAIL, ref);
  for (const [bag, v] of Object.entries(f)) {
    if (bag.startsWith('_')) continue;
    const t = []; flatStrings(v, t);
    for (const text of t) if (!/^[a-z_]+$/.test(text)) rows.push({ scene: 'fail-responses', hotspot: bag, verb: '-', text });
  }
  return rows;
}

const BLACKLIST = [/like my portfolio/i, /gas fees?/i, /not an nft/i, /decentrali[sz]/i, /proof[- ]of[- ]/i, /the original \w+/i];
const CRYPTO = /\b(crypto|nft|token|blockchain|on-chain|wallet|hodl|gas|bull|bear|moon|pump|dump|rug|whale|degen|airdrop|mint|ledger|defi|liquidity|yield|stake|staking|smart contract|seed phrase|fomo|chart|portfolio|dip|slippage)\b/i;
const GENERIC = [/^It's an? [\w' -]+\.$/i, /^Nothing happens\.?$/i, /^I can'?t do that\.?$/i, /^(That|It) doesn'?t (work|open|move)\.?$/i,
  /^I don'?t (want|need) (it|that|to)\b.{0,20}$/i, /^Nothing (interesting|special)\b/i, /^(Hmm|Hm)\.{0,3}$/i];

export function tags(rows) {
  const count = new Map();
  for (const r of rows) count.set(r.text, (count.get(r.text) ?? 0) + 1);
  const cryptoPerScene = new Map();
  return rows.map((r) => {
    const t = [];
    if (BLACKLIST.some((re) => re.test(r.text))) t.push('blacklist');
    if (GENERIC.some((re) => re.test(r.text.trim()))) t.push('generic');
    const words = r.text.split(/\s+/).length;
    if (words > 28) t.push('long');
    if (count.get(r.text) > 1 && !r.verb.startsWith('USE:_') && r.scene !== 'fail-responses') t.push('repeated');
    if (CRYPTO.test(r.text)) {
      const k = r.scene; const n = (cryptoPerScene.get(k) ?? 0) + 1; cryptoPerScene.set(k, n);
      if (n > 2) t.push('crypto-again');
    }
    return { ...r, words, tags: t };
  });
}

function summary(rows) {
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.scene) ?? { n: 0, weak: 0, tags: {} }; s.n++;
    if (r.tags.length) s.weak++;
    for (const t of r.tags) s.tags[t] = (s.tags[t] ?? 0) + 1;
    by.set(r.scene, s);
  }
  return by;
}

const args = process.argv.slice(2);
if (args[0] === '--list') {
  for (const r of tags(collect())) if (!args[1] || r.scene === args[1]) {
    console.log(`${r.scene}\t${r.hotspot}\t${r.verb}\t${r.tags.join(',') || '-'}\t${r.words}\t${r.text}`);
  }
} else if (args[0] === '--diff') {
  const ref = args[1] ?? 'origin/main';
  const before = collect(ref); const after = collect();
  const key = (r) => `${r.scene}|${r.hotspot}|${r.verb}`;
  const afterBy = new Map(); for (const r of after) { const a = afterBy.get(key(r)) ?? []; a.push(r.text); afterBy.set(key(r), a); }
  const by = new Map(); let n = 0; let changed = 0;
  for (const r of before) {
    const s = by.get(r.scene) ?? { n: 0, changed: 0 }; s.n++; n++;
    if (!(afterBy.get(key(r)) ?? []).includes(r.text)) { s.changed++; changed++; }
    by.set(r.scene, s);
  }
  console.log('| Escena | Frases | Reescritas | % |\n|---|---:|---:|---:|');
  for (const [sc, s] of by) console.log(`| ${sc} | ${s.n} | ${s.changed} | ${(100 * s.changed / s.n).toFixed(0)} % |`);
  console.log(`| **Total** | **${n}** | **${changed}** | **${(100 * changed / n).toFixed(1)} %** |`);
} else if (args[0] === '--cited') {
  const ref = args[1] ?? 'origin/main';
  const now = new Set(collect().map((r) => r.text));
  const gone = [...new Set(collect(ref).map((r) => r.text))].filter((t) => !now.has(t));
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'qa', 'scripts', 'tests', 'src', 'assets/config', 'assets/scenes', 'assets/journal'], { encoding: 'utf8' })
    .split('\n').filter((f) => /\.(json|mjs|js|ts|cjs)$/.test(f) && f !== FAIL && !f.startsWith('src/config/voice.config'));
  const bodies = files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  let bad = 0;
  for (const t of gone) {
    // cita literal entera o un trozo característico (las rutas de QA suelen citar 3-6 palabras)
    const probes = [t, ...t.split(/(?<=[.!?])\s+/).filter((p) => p.split(/\s+/).length >= 3)];
    for (const [f, body] of bodies) {
      const hit = probes.find((p) => body.includes(p) || body.includes(JSON.stringify(p).slice(1, -1)));
      if (hit) { bad++; console.log(`${f}: «${hit}»  (de «${t}»)`); }
    }
  }
  console.log(`${gone.length} frases eliminadas; ${bad} citas vivas`);
  process.exit(bad ? 1 : 0);
} else {
  const rows = tags(collect());
  const by = summary(rows);
  let n = 0; let w = 0;
  console.log('| Escena | Frases | Flojas | Motivos |\n|---|---:|---:|---|');
  for (const [sc, s] of by) { n += s.n; w += s.weak; console.log(`| ${sc} | ${s.n} | ${s.weak} | ${Object.entries(s.tags).map(([k, v]) => `${k} ${v}`).join(', ')} |`); }
  console.log(`| **Total** | **${n}** | **${w}** | |`);
}

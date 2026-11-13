// A3.3f (plan SCUMM): auditoría «lo que hace falta para un puzle tiene que VERSE».
//
// Saca de qa/walkthrough.json (ruta crítica) los hotspots que se tocan con un verbo de acción (todo menos LOOK/TALK) o
// con un objeto, y por cada uno recorta el fondo de su escena alrededor del hotspot, con el rectángulo del hotspot
// pintado, a la escala de un móvil apaisado (844×390: con el panel de verbos el fondo se ve a 270 px de alto) ×2 para que se pueda juzgar.
// Encima del fondo van el primer plano y los overlays condicionales que se ven al empezar (`invert: true`).
// Escribe los recortes en docs/progreso/A3.3f/<escena>__<hotspot>.webp (≤ 40 KB) y una tabla en
// docs/progreso/A3.3f/hotspots.json (escena, hotspot, verbos, tamaño en pantalla). El veredicto (se ve / dudoso /
// invisible) lo pone una persona mirando los recortes: va en docs/progreso/A3.3f.md.
//
// Uso:  node scripts/audit-hotspot-art.mjs [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : join(ROOT, 'docs', 'progreso', 'A3.3f');
const LAND_H = 270; // alto del fondo en móvil apaisado 844×390 con el panel de verbos abierto (medido en la demo de A3.3f)
const ZOOM = 2; // los recortes van al doble de lo que se ve en el móvil
const MAX_BYTES = 40 * 1024;

const scenes = {};
const sceneOf = (id) => {
  if (!scenes[id]) scenes[id] = JSON.parse(readFileSync(join(ROOT, 'assets', 'scenes', id, 'scene.json'), 'utf8'));
  return scenes[id];
};
const hotspotsOf = (id) => sceneOf(id).regions?.hotspots ?? [];
const sceneIds = JSON.parse(readFileSync(join(ROOT, 'qa', 'walkthrough.json'), 'utf8'));
const route = sceneIds.routes.find((r) => r.id === 'ruta-critica');

// 1) Hotspots de la ruta crítica, siguiendo en qué escena está Dex
const allScenes = ['basement', 'clinic_exterior', 'clinic_interior', 'epilogue_outside', 'lobby', 'memelab', 'mountain', 'outside', 'recovery_pool', 'rooftop', 'server_room', 'treatment_room', 'upstairs'];
const found = new Map(); // "scene/hs" -> { scene, hs, verbs:Set }
let current = 'outside';
for (const step of route.steps) {
  const target = step.target;
  let verb = null;
  if (step.do === 'act' && step.verb !== 'LOOK' && step.verb !== 'TALK') verb = step.verb;
  if (step.do === 'use') verb = `USE ${step.item} →`;
  if (verb && target) {
    let scene = hotspotsOf(current).some((h) => h.id === target) ? current : null;
    if (!scene) scene = allScenes.find((s) => hotspotsOf(s).some((h) => h.id === target)) ?? null;
    if (scene) {
      const k = `${scene}/${target}`;
      if (!found.has(k)) found.set(k, { scene, hs: target, verbs: new Set() });
      found.get(k).verbs.add(verb);
    }
  }
  if (step.expect?.scene) current = step.expect.scene;
}

// 2) Recortes
mkdirSync(OUT, { recursive: true });
const rows = [];
const composites = {};
async function sceneImage(id) {
  if (composites[id]) return composites[id];
  const dir = join(ROOT, 'assets', 'scenes', id);
  const s = sceneOf(id);
  const W = s.render?.world?.width, H = s.render?.world?.height;
  const bgFile = ['background.webp', 'background.png'].map((f) => join(dir, f)).find(existsSync);
  const layers = [];
  const fg = ['foreground.webp', 'foreground.png'].map((f) => join(dir, f)).find(existsSync);
  if (fg) layers.push({ input: await sharp(fg).resize(W, H, { kernel: 'nearest' }).png().toBuffer(), left: 0, top: 0 });
  for (const co of s.conditionalOverlays ?? []) {
    if (!co.invert) continue;
    const f = join(dir, `${co.sprite}.${co.format === 'webp' ? 'webp' : 'png'}`);
    if (!existsSync(f)) continue;
    const left = co.bounds ? Math.round((co.bounds.x * W) / 100) : 0;
    const top = co.bounds ? Math.round((co.bounds.y * H) / 100) : 0;
    layers.push({ input: readFileSync(f), left, top });
  }
  const buf = await sharp(bgFile).resize(W, H, { kernel: 'nearest' }).composite(layers).png().toBuffer();
  composites[id] = { buf, W, H };
  return composites[id];
}

for (const { scene, hs, verbs } of [...found.values()].sort((a, b) => a.scene.localeCompare(b.scene) || a.hs.localeCompare(b.hs))) {
  const { buf, W, H } = await sceneImage(scene);
  const h = hotspotsOf(scene).find((x) => x.id === hs);
  const b = h.bounds;
  const bx = Math.round((b.x * W) / 100), by = Math.round((b.y * H) / 100);
  const bw = Math.max(1, Math.round((b.w * W) / 100)), bh = Math.max(1, Math.round((b.h * H) / 100));
  // Contexto: el hotspot más un margen de su tamaño (mín. 12 % del alto), recortado al fondo
  const m = Math.max(Math.round(H * 0.12), Math.round(Math.max(bw, bh) * 0.5));
  const left = Math.max(0, bx - m), top = Math.max(0, by - m);
  const right = Math.min(W, bx + bw + m), bottom = Math.min(H, by + bh + m);
  const scale = (LAND_H / H) * ZOOM;
  const ow = Math.max(1, Math.round((right - left) * scale)), oh = Math.max(1, Math.round((bottom - top) * scale));
  const rx = Math.round((bx - left) * scale), ry = Math.round((by - top) * scale);
  const rw = Math.max(2, Math.round(bw * scale)), rh = Math.max(2, Math.round(bh * scale));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}"><rect x="${rx + 1}" y="${ry + 1}" width="${rw - 2}" height="${rh - 2}" fill="none" stroke="#00ffff" stroke-width="2" stroke-dasharray="6 4"/></svg>`);
  const file = join(OUT, `${scene}__${hs}.webp`);
  let q = 72;
  for (;;) {
    await sharp(buf).extract({ left, top, width: right - left, height: bottom - top }).resize(ow, oh, { kernel: 'lanczos3' })
      .composite([{ input: svg, left: 0, top: 0 }]).webp({ quality: q }).toFile(file);
    if (statSync(file).size <= MAX_BYTES || q <= 30) break;
    q -= 10;
  }
  const screen = { w: Math.round((bw * LAND_H) / H), h: Math.round((bh * LAND_H) / H) };
  rows.push({ scene, hotspot: hs, name: h.name, verbs: [...verbs], screen844x390: screen, file: `A3.3f/${scene}__${hs}.webp`, kb: Math.round(statSync(file).size / 1024) });
  console.log(`  ${scene.padEnd(18)} ${hs.padEnd(26)} ${String(screen.w).padStart(4)}×${String(screen.h).padEnd(4)} px  ${[...verbs].join(', ')}`);
}
writeFileSync(join(OUT, 'hotspots.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(`\n${rows.length} hotspots de la ruta crítica → ${OUT}`);

#!/usr/bin/env node
// A5.1 (plan SCUMM): variantes del arte a tamaño de fondo (fondo, primer plano y overlays sin `bounds`) para no subir
// a la GPU texturas de 3712×1152 (16,3 MB cada una) ni bajar 4-5 MB de WebP sin pérdida por escena.
//
//   node scripts/make-bg-variants.mjs            genera las que faltan o están desactualizadas (necesita `npm ci`: sharp)
//   node scripts/make-bg-variants.mjs --force    regenera todas
//   node scripts/make-bg-variants.mjs --check    rc 1 si falta alguna variante o no mide lo que toca (solo cabeceras,
//                                                sin sharp; es lo que también comprueba la regla (k) del linter de escenas)
//
// Para cada assets/scenes/<id>/scene.json:
//   - maestro = `<nombre>.png` si existe, si no `<nombre>.webp` (el maestro no lo carga el juego: PreloadScene pide
//     siempre una variante, ver src/systems/ScenePrefetch.ts sceneImageAssets);
//   - por cada ancho de BG_VARIANT_WIDTHS (1280 y 2048) escribe `<nombre>@<ancho>.webp`: reducción con Lanczos3 y WebP
//     con pérdida a calidad 90 (PSNR ≈ 39 dB sobre el maestro reducido; 8-13 veces menos bytes que sin pérdida) y, si
//     la imagen tiene alfa (primer plano, overlays), el canal alfa sin pérdida (`alphaQuality: 100`);
//   - el alto es round(ancho × alto_maestro / ancho_maestro) (SceneTextures.variantHeight), así la variante tiene la misma
//     proporción que el mundo y la escala extra de GameScene es la misma en x e y;
//   - `render.world` del scene.json tiene que ser el tamaño del maestro del fondo: las coordenadas en % y la unidad de píxel
//     (A2.8) se refieren a él (si no coincide, se avisa y la regla (k) del linter lo marca como error).
// Idempotente: una variante que ya mide lo que toca y es más nueva que el maestro no se vuelve a escribir (--force sí).
// Sin arte de pago: solo sharp (D2).
import { existsSync, readFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = join(ROOT, 'assets', 'scenes');
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
/** Los mismos que src/systems/SceneTextures.ts (el linter corre en Node sin type stripping; tests/scene-textures.test.mjs los compara) */
export const BG_VARIANT_WIDTHS = [1280, 2048];
export const WEBP_QUALITY = 90;

const sharp = CHECK ? null : (await import('sharp').catch(() => null))?.default ?? null;
if (!sharp && !CHECK) {
  console.error('make-bg-variants: falta sharp (npm ci). Con --check solo se miran las cabeceras.');
  process.exit(2);
}

export const variantHeight = (width, world) => Math.max(1, Math.round((width * world.h) / world.w));

/** Overlay a tamaño de fondo: sin bounds o con bounds de 0,0,100,100 (la misma regla que isFullFrame de src/systems/ScenePrefetch.ts) */
export function isFullFrame(b) {
  if (!b || typeof b !== 'object') return true;
  return Number(b.x) <= 0 && Number(b.y) <= 0 && Number(b.w) >= 100 && Number(b.h) >= 100;
}

/** Imágenes a tamaño de fondo de una escena: [{ name, master }] (fondo, primer plano, overlays sin bounds) */
export function fullFrameImages(dir, scene) {
  const master = (name) => ['png', 'webp'].map((ext) => join(dir, `${name}.${ext}`)).find((f) => existsSync(f)) ?? null;
  const out = [{ name: 'background', master: master('background'), kind: 'fondo' }];
  if (scene.assets?.foreground) out.push({ name: 'foreground', master: master('foreground'), kind: 'primer plano' });
  for (const co of scene.conditionalOverlays ?? []) {
    if (isFullFrame(co.bounds) && co.sprite) out.push({ name: co.sprite, master: master(co.sprite), kind: `overlay ${co.id}` });
  }
  return out;
}

const problems = [];
const rows = [];
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

for (const id of readdirSync(SCENES).sort()) {
  const dir = join(SCENES, id);
  const sceneFile = join(dir, 'scene.json');
  if (!existsSync(sceneFile)) continue;
  const scene = JSON.parse(readFileSync(sceneFile, 'utf8'));
  const images = fullFrameImages(dir, scene);
  const bgMaster = images[0].master;
  const bgSize = bgMaster ? imageSize(readFileSync(bgMaster)) : null;
  if (!bgSize) {
    problems.push(`${id}: sin fondo maestro (background.png o background.webp)`);
    continue;
  }
  const world = { w: bgSize.width, h: bgSize.height };
  const declared = scene.render?.world;
  if (!declared || declared.width !== world.w || declared.height !== world.h) {
    problems.push(`${id}: render.world dice ${declared?.width}x${declared?.height} y el fondo maestro mide ${world.w}x${world.h} (las coordenadas en % se refieren al maestro)`);
  }
  for (const img of images) {
    if (!img.master) {
      problems.push(`${id}: ${img.kind} sin maestro (${img.name}.png o .webp)`);
      continue;
    }
    const size = imageSize(readFileSync(img.master));
    if (!size || size.width !== world.w || size.height !== world.h) {
      problems.push(`${id}: ${img.name} mide ${size?.width}x${size?.height} y el fondo ${world.w}x${world.h}: no es una imagen a tamaño de fondo`);
      continue;
    }
    for (const width of BG_VARIANT_WIDTHS) {
      const file = join(dir, `${img.name}@${width}.webp`);
      const want = { width, height: variantHeight(width, world) };
      const have = existsSync(file) ? imageSize(readFileSync(file)) : null;
      const upToDate = have && have.width === want.width && have.height === want.height && (!FORCE && statSync(file).mtimeMs >= statSync(img.master).mtimeMs);
      if (CHECK) {
        if (!have) problems.push(`${id}: falta ${img.name}@${width}.webp (node scripts/make-bg-variants.mjs)`);
        else if (have.width !== want.width || have.height !== want.height) problems.push(`${id}: ${img.name}@${width}.webp mide ${have.width}x${have.height}, tiene que medir ${want.width}x${want.height}`);
        else rows.push({ where: `${id}/${img.name}@${width}`, size: `${have.width}x${have.height}`, bytes: kb(statSync(file).size), note: 'ok' });
        continue;
      }
      if (upToDate) {
        rows.push({ where: `${id}/${img.name}@${width}`, size: `${have.width}x${have.height}`, bytes: kb(statSync(file).size), note: 'ya estaba' });
        continue;
      }
      const meta = await sharp(img.master).metadata();
      const alpha = !!meta.hasAlpha;
      const tmp = `${file}.tmp`;
      await sharp(img.master)
        .resize({ width: want.width, height: want.height, fit: 'fill', kernel: 'lanczos3' })
        .webp({ quality: WEBP_QUALITY, alphaQuality: 100, smartSubsample: true, effort: 6 })
        .toFile(tmp);
      renameSync(tmp, file);
      const out = imageSize(readFileSync(file));
      if (out.width !== want.width || out.height !== want.height) throw new Error(`${file}: sharp escribió ${out.width}x${out.height}`);
      rows.push({ where: `${id}/${img.name}@${width}`, size: `${out.width}x${out.height}${alpha ? ' +alfa' : ''}`, bytes: `${kb(statSync(img.master).size)} → ${kb(statSync(file).size)}`, note: 'escrita' });
    }
  }
}

for (const r of rows) console.log(`  ${r.where.padEnd(44)} ${r.size.padEnd(16)} ${r.bytes.padEnd(20)} ${r.note}`);
if (problems.length) {
  console.log(`\n${problems.length} problema(s) con las variantes de fondo:`);
  for (const p of problems) console.log(`  ✖ ${p}`);
  process.exit(1);
}
console.log(`\nVariantes de fondo OK (${rows.length})${CHECK ? ' · solo cabeceras' : ''}`);

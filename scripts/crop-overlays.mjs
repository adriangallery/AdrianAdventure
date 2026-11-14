// A2.7 (plan SCUMM): recorta los overlays de las escenas a su caja real y los pasa a WebP sin pérdida.
//
// Los `conditionalOverlays` se dibujaban del tamaño del fondo (3712x1152) aunque fueran un buzón: 3,3 MB de PNG
// casi transparente que además ocupa una textura entera en la GPU. Este script, para cada overlay de cada
// assets/scenes/<id>/scene.json:
//   1. busca la caja con contenido (alfa > 4; ver scripts/lib/overlay-crop.mjs) y le añade 2 px de margen;
//   2. escribe `<sprite>.webp` recortado y sin pérdida (con sharp);
//   3. pone en el scene.json `"format": "webp"` y `"bounds": { x, y, w, h }` (en % del fondo, como el resto de
//      coordenadas; GameScene coloca el sprite ahí, ver src/systems/OverlayPlacement.ts) sin reformatear el resto;
//   4. borra el PNG viejo (git guarda la historia).
// Es idempotente: un overlay ya recortado (caja = imagen entera) no se toca. Un overlay que de verdad ocupa todo
// el fondo (`server_room/overlay_lights_out`) se queda entero, solo pasa a WebP.
// Los sprites de `web3Visuals` ya van colocados con position/size: solo se comprueba que no sean del tamaño del fondo.
//
// A9.16: además, con sharp, cada overlay se compara píxel a píxel con el fondo de su escena (scripts/lib/
// overlay-pixels.mjs): falla si lleva una zona grande de píxeles opacos CASI iguales al fondo (0 < Δ ≤ 12 en más de
// 2500 px y más del 12,5 % de sus opacos): manchas de otro tono, como el cielo del espejo de la veleta de A9.12. Y
// (con o sin sharp) cada overlay tiene que estar en qa/overlays.lock.json con el sha256 del
// background.webp de su escena y el suyo propio: si cambia el fondo (o el overlay) sin revalidar, falla. Un overlay
// con el defecto de manchas que se acepta a sabiendas lleva `"aviso": "<motivo>"` en su entrada y sale como aviso.
//
// Uso:  node scripts/crop-overlays.mjs                recorta y actualiza (necesita `npm ci`: sharp)
//       node scripts/crop-overlays.mjs --check        rc 1 si algún overlay está sin recortar, en PNG, no cuadra con su
//                                                     `bounds`, tiene manchas casi iguales al fondo o no cuadra con
//                                                     overlays.lock.json (job `lint`). Sin sharp solo mira las
//                                                     cabeceras y los hashes.
//       node scripts/crop-overlays.mjs --update-lock  reescribe overlays.lock.json con los hashes de hoy (conserva los
//                                                     `aviso`). Solo DESPUÉS de mirar el overlay encima del fondo
//                                                     nuevo (o de regenerarlo con su script make-*).
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentBox, boxToPct, pctToBox, isFullBox, imageSize, replaceTopLevelKey } from './lib/overlay-crop.mjs';
import { overlayVsBackground, isNearPatchDefect, sha256, lockProblems, NEAR_DELTA } from './lib/overlay-pixels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = join(ROOT, 'assets', 'scenes');
const CHECK = process.argv.includes('--check');
const UPDATE_LOCK = process.argv.includes('--update-lock');
const LOCK_FILE = join(ROOT, 'qa', 'overlays.lock.json'); // fuera de assets/scenes: hay pruebas que leen cada entrada como carpeta de escena
const lock = existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : { overlays: {} };
const hashes = {};
const warnings = [];
const sharp = (await import('sharp').catch(() => null))?.default ?? null;
if (!sharp && !CHECK && !UPDATE_LOCK) {
  console.error('crop-overlays: falta sharp (npm ci). Con --check se pueden revisar solo las cabeceras.');
  process.exit(2);
}

const problems = [];
const rows = [];
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const sizeOf = (file) => imageSize(readFileSync(file));

async function decode(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

for (const id of readdirSync(SCENES).sort()) {
  const dir = join(SCENES, id);
  const sceneFile = join(dir, 'scene.json');
  if (!existsSync(sceneFile)) continue;
  const text = readFileSync(sceneFile, 'utf8');
  const scene = JSON.parse(text);
  const bgFile = join(dir, 'background.webp');
  const bg = existsSync(bgFile) ? sizeOf(bgFile) : null;
  if (!bg) {
    if ((scene.conditionalOverlays ?? []).length) problems.push(`${id}: sin background.webp legible, no se pueden medir sus overlays`);
    continue;
  }

  let changed = false;
  const next = [];
  let bgPixels = null; // fondo decodificado (con sharp), una vez por escena
  const bgHash = sha256(readFileSync(bgFile));
  for (const co of scene.conditionalOverlays ?? []) {
    const where = `${id}.conditionalOverlays.${co.id}`;
    const ext = co.format === 'webp' ? 'webp' : 'png';
    const file = join(dir, `${co.sprite}.${ext}`);
    if (!existsSync(file)) {
      problems.push(`${where}: no existe ${co.sprite}.${ext}`);
      next.push(co);
      continue;
    }
    hashes[`${id}/${co.id}`] = { background: bgHash, overlay: sha256(readFileSync(file)) };
    const size = sizeOf(file);
    // Marco de la imagen actual dentro del fondo
    let frame;
    if (co.bounds) {
      frame = pctToBox(co.bounds, bg.width, bg.height);
      if (frame.width !== size.width || frame.height !== size.height) {
        problems.push(`${where}: bounds dice ${frame.width}x${frame.height} px y ${co.sprite}.${ext} mide ${size.width}x${size.height}`);
        next.push(co);
        continue;
      }
    } else {
      if (size.width !== bg.width || size.height !== bg.height) {
        problems.push(`${where}: sin bounds y no mide lo que el fondo (${size.width}x${size.height} frente a ${bg.width}x${bg.height})`);
        next.push(co);
        continue;
      }
      frame = { left: 0, top: 0, width: size.width, height: size.height };
    }
    const before = statSync(file).size;

    if (!sharp) {
      // --check sin sharp: lo que se ve en la cabecera
      if (ext !== 'webp' || !co.bounds) problems.push(`${where}: sin recortar (${ext}${co.bounds ? '' : ', sin bounds'}): node scripts/crop-overlays.mjs`);
      rows.push({ where, size: `${size.width}x${size.height}`, bytes: kb(before), note: 'solo cabecera' });
      next.push(co);
      continue;
    }

    const img = await decode(file);
    const box = contentBox(img.data, img.width, img.height, img.channels);
    if (!box) {
      problems.push(`${where}: ${co.sprite}.${ext} es transparente entero`);
      next.push(co);
      continue;
    }
    const full = isFullBox(box, img.width, img.height);
    if (full && ext === 'webp' && co.bounds) {
      bgPixels ??= await decode(bgFile);
      const st = overlayVsBackground(img.data, img.width, img.height, bgPixels.data, bgPixels.width, bgPixels.channels, frame.left, frame.top);
      if (isNearPatchDefect(st)) {
        const msg = `${where}: ${st.near} px opacos casi iguales al fondo (0 < Δ ≤ ${NEAR_DELTA}; ${(100 * st.near / st.opaque).toFixed(1)} % de ${st.opaque}): manchas de otro tono; deja opaco solo lo que cambia`;
        const aviso = lock.overlays?.[`${id}/${co.id}`]?.aviso;
        if (aviso) warnings.push(`${msg} — aviso aceptado: ${aviso}`);
        else problems.push(msg);
      }
      rows.push({ where, size: `${size.width}x${size.height}`, bytes: kb(before), note: 'ya recortado' });
      next.push(co);
      continue;
    }
    if (CHECK) {
      problems.push(`${where}: ${full ? '' : `se puede recortar a ${box.width}x${box.height}; `}${ext !== 'webp' ? 'está en PNG; ' : ''}${co.bounds ? '' : 'sin bounds; '}arréglalo con node scripts/crop-overlays.mjs`);
      next.push(co);
      continue;
    }
    const outFile = join(dir, `${co.sprite}.webp`);
    const tmp = `${outFile}.tmp`;
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
      .extract(box)
      .webp({ lossless: true, effort: 6 })
      .toFile(tmp);
    renameSync(tmp, outFile);
    if (file !== outFile) unlinkSync(file);
    const bounds = boxToPct({ left: frame.left + box.left, top: frame.top + box.top, width: box.width, height: box.height }, bg.width, bg.height);
    const back = pctToBox(bounds, bg.width, bg.height);
    if (back.width !== box.width || back.height !== box.height) throw new Error(`${where}: bounds no vuelve a ${box.width}x${box.height}`);
    const { id: coId, sprite, format: _f, bounds: _b, ...rest } = co;
    next.push({ id: coId, sprite, format: 'webp', bounds, ...rest });
    changed = true;
    const after = statSync(outFile).size;
    rows.push({ where, size: `${size.width}x${size.height} ${ext} → ${box.width}x${box.height} webp`, bytes: `${kb(before)} → ${kb(after)}`, note: `en (${frame.left + box.left}, ${frame.top + box.top}) px` });
  }
  if (changed) {
    writeFileSync(sceneFile, replaceTopLevelKey(text, 'conditionalOverlays', next));
  }

  for (const w of scene.web3Visuals ?? []) {
    for (const sprite of [w.defaultSprite, ...(w.variants ?? []).map((x) => x.sprite)]) {
      const file = join(dir, `${sprite}.png`);
      if (!existsSync(file)) continue; // lo avisa el linter de escenas (regla f)
      const s = sizeOf(file);
      if (s && s.width === bg.width && s.height === bg.height) problems.push(`${id}.web3Visuals.${w.id}: ${sprite}.png mide lo que el fondo; recórtalo y ajusta position/size`);
    }
  }
}

if (UPDATE_LOCK) {
  const overlays = {};
  for (const key of Object.keys(hashes).sort()) {
    const aviso = lock.overlays?.[key]?.aviso;
    overlays[key] = { ...hashes[key], ...(aviso ? { aviso } : {}) };
  }
  const doc = lock._doc ?? 'A9.16: sha256 del background.webp de la escena y del overlay con los que se validó cada conditionalOverlay. Si cambia el fondo, crop-overlays --check falla hasta revisar el overlay encima del fondo nuevo (o regenerarlo) y ejecutar node scripts/crop-overlays.mjs --update-lock.';
  writeFileSync(LOCK_FILE, JSON.stringify({ _doc: doc, overlays }, null, 2) + '\n');
  console.log(`overlays.lock.json: ${Object.keys(overlays).length} overlays`);
} else {
  problems.push(...lockProblems(lock, hashes));
}

for (const r of rows) console.log(`  ${r.where.padEnd(42)} ${r.size.padEnd(36)} ${r.bytes.padEnd(18)} ${r.note}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (problems.length) {
  console.log(`\n${problems.length} problema(s) con los overlays:`);
  for (const p of problems) console.log(`  ✖ ${p}`);
  process.exit(1);
}
console.log(`\nOverlays OK (${rows.length})${CHECK && !sharp ? ' · sin sharp: solo cabeceras' : ''}`);

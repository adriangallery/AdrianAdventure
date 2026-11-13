// A3.3g (plan SCUMM): props de puzle que se veían mal a tamaño móvil, pintados por código (0 $, sin IA).
//
// La auditoría de A3.3f dejó 8 hotspots de puzle «dudosos». Cuatro se arreglan con `bounds` (el objeto ya estaba
// dibujado: escotilla de upstairs, trampilla de rooftop, escalera de basement, camino de epilogue_outside). Los otros
// cuatro necesitan algo pintado encima del fondo, y eso lo hace este script, determinista, con las reglas de A3.3h:
//   - SOLO colores del fondo de esa escena (cada color pedido se cambia por el más cercano que ya está en el fondo);
//   - contorno de 1 píxel de arte, del oscuro del propio fondo; luz coherente con la escena;
//   - sombra de contacto (el fondo oscurecido y cuantizado a su paleta), sin halo: orla de 3 px con el fondo tal cual,
//     para que el filtro lineal del juego mezcle el borde con lo mismo que hay detrás;
//   - tamaño contenido (cabe dentro del hotspot o casi).
// Overlays (por escena):
//   outside        doormat_lump    felpudo con ribete claro, bulto debajo y esquina levantada (sin `found_ledger`)
//                  doormat_peeled  felpudo con la esquina doblada hacia atrás (con `found_ledger`)
//   server_room    tile_lifted     baldosa levantada: rendija negra detrás, canto con luz y el cable naranja asomando
//                                  (sin `tiles_opened`; con ella ya sale `tiles_open`)
//   treatment_room note_folded     nota doblada de pie en la mesita (sin `found_adrian_note`)
//   recovery_pool  door_closed     hoja de puerta metálica con placa y tirador, rendija con luz roja (sin `dark_door_opened`)
//                  door_open       hoja casi abierta y el hueco teñido de rojo y azul (con `dark_door_opened`)
// Escribe los WebP sin pérdida recortados a su caja (misma cuenta que scripts/lib/overlay-crop.mjs) y actualiza
// `conditionalOverlays` de cada scene.json sin reformatear el resto (deja intactos los overlays que no son suyos).
//
// Uso:  node scripts/make-hotspot-props.mjs                  genera y actualiza
//       node scripts/make-hotspot-props.mjs --preview <dir>  además deja recortes ampliados sobre el fondo
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contentBox, boxToPct, replaceTopLevelKey } from './lib/overlay-crop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const previewIdx = process.argv.indexOf('--preview');
const PREVIEW = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

// ── Lienzo de una escena ─────────────────────────────────────────────────────────────────────────────────────────
async function loadScene(id) {
  const dir = join(ROOT, 'assets', 'scenes', id);
  const { data, info } = await sharp(join(dir, 'background.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Paleta = colores que ya están en el fondo (muestreo cada 2 px, sin repetir)
  const seen = new Set();
  const palette = [];
  for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) {
    const i = (y * info.width + x) * 3;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (!seen.has(k)) { seen.add(k); palette.push([data[i], data[i + 1], data[i + 2]]); }
  }
  return { id, dir, W: info.width, H: info.height, bg: data, palette };
}

function makeCanvas(scene, ps) {
  const { W, H, bg, palette } = scene;
  const buf = Buffer.alloc(W * H * 4);
  const cache = new Map();
  const snap = (rgb) => {
    const key = rgb.join(',');
    if (cache.has(key)) return cache.get(key);
    let best = palette[0], bd = Infinity;
    for (const p of palette) {
      const d = 2 * (p[0] - rgb[0]) ** 2 + 4 * (p[1] - rgb[1]) ** 2 + 3 * (p[2] - rgb[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    cache.set(key, best);
    return best;
  };
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
  };
  const cell = (ox, oy, ax, ay) => [Math.round(ox + ax * ps), Math.round(ox + (ax + 1) * ps), Math.round(oy + ay * ps), Math.round(oy + (ay + 1) * ps)];
  return {
    buf,
    snap,
    /** Pinta un píxel de arte (ax, ay) relativo a (ox, oy) con un color (que se cambia por el más cercano del fondo) */
    px(ox, oy, ax, ay, rgb) {
      const c = snap(rgb);
      const [x0, x1, y0, y1] = cell(ox, oy, ax, ay);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c);
    },
    /** Sombra (k < 1) o luz (k > 1): el fondo de ese píxel de arte × k, cuantizado a la paleta del fondo (no pisa lo ya pintado) */
    shade(ox, oy, ax, ay, k) {
      const [x0, x1, y0, y1] = cell(ox, oy, ax, ay);
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const i = (y * W + x) * 4;
        if (buf[i + 3]) continue;
        const j = (y * W + x) * 3;
        put(x, y, snap([0, 1, 2].map((c) => Math.min(255, Math.round((bg[j + c] * k) / 8) * 8))));
      }
    },
    /** Orla de 3 px con el fondo tal cual alrededor de todo lo pintado (sin halo con el filtro lineal) */
    feather(R = 3) {
      const add = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (buf[(y * W + x) * 4 + 3]) continue;
        let near = false;
        for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && buf[(yy * W + xx) * 4 + 3] === 255) { near = true; break; }
        }
        if (near) add.push(y * W + x);
      }
      for (const p of add) put(p % W, Math.floor(p / W), [bg[p * 3], bg[p * 3 + 1], bg[p * 3 + 2]]);
    },
  };
}

/** Dibuja filas de texto con una tabla de colores ('.' = nada; '~' = sombra floja; '#' = sombra fuerte) */
function sprite(cv, ox, oy, rows, colors, ax0 = 0, ay0 = 0) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    if (ch === '#') return cv.shade(ox, oy, ax0 + x, ay0 + y, 0.55);
    if (ch === '~') return cv.shade(ox, oy, ax0 + x, ay0 + y, 0.75);
    const rgb = colors[ch];
    if (!rgb) throw new Error(`color desconocido ${ch}`);
    cv.px(ox, oy, ax0 + x, ay0 + y, rgb);
  }));
}

// ── outside: felpudo «HODL» (pixelScale 4,5; luz cálida del farol, arriba a la izquierda) ──────────────────────
// El felpudo está pintado (x≈1190–1470, y≈950–1000) pero oscuro sobre el porche oscuro. Ribete de paja clara en el
// canto de arriba y a los lados, contorno negro del porche por fuera, y: antes de coger el Ledger, un bulto debajo
// («Something lumpy underneath») y la esquina de la derecha un poco levantada; después, la esquina doblada hacia atrás.
const MAT = { ox: 1196, oy: 958 };
const MAT_C = { K: [18, 2, 2], L: [176, 120, 72], H: [222, 170, 96], M: [110, 60, 45], D: [59, 26, 33] };
function matRim(cv) {
  // El felpudo pintado (elipse de ~62 × 11 px de arte) se aclara × 1,5 con colores del fondo: deja de fundirse con el
  // porche sin perder su dibujo. El canto de arriba (el que mira al farol) lleva una línea de paja con luz.
  const cx = 31, cy = 5.5, rx = 32, ry = 5;
  for (let ay = 0; ay <= 12; ay++) for (let ax = -1; ax <= 63; ax++) {
    const d = ((ax + 0.5 - cx) / rx) ** 2 + ((ay + 0.5 - cy) / ry) ** 2;
    if (d <= 1) cv.shade(MAT.ox, MAT.oy, ax, ay, 1.5);
  }
  for (let ax = 10; ax <= 50; ax++) {
    const ay = Math.round(cy - ry * Math.sqrt(Math.max(0, 1 - ((ax + 0.5 - cx) / rx) ** 2)));
    if (ax % 9 !== 4) cv.px(MAT.ox, MAT.oy, ax, ay, ax < 31 ? MAT_C.H : MAT_C.L); // con cortes, como el ribete gastado
  }
  // Sombra de contacto bajo el canto de abajo, sobre el porche
  for (let ax = 6; ax <= 56; ax++) cv.shade(MAT.ox, MAT.oy, ax, 11, ax % 2 ? 0.6 : 0.75);
}
function doormatLump(cv) {
  // Bulto: lomo claro arriba y sombra debajo (el Ledger escondido)
  sprite(cv, MAT.ox, MAT.oy, [
    '...KKKKKKKK...',
    '..KHHLLLLLMK..',
    '.KHLLLMMMMMDK.',
    '.KMMMMDDDDDDK.',
    '..##########..',
  ], MAT_C, 36, 2);
  // Esquina de la derecha un poco levantada (se ve el revés, más claro)
  sprite(cv, MAT.ox, MAT.oy, [
    '.....KK',
    '...KKHK',
    '.KKLLHK',
    'KLLLMMK',
    '~~~~~~~',
  ], MAT_C, 54, -1);
  matRim(cv);
}
function doormatPeeled(cv) {
  // Esquina doblada hacia atrás: el revés del felpudo (paja) en triángulo, y el porche al descubierto debajo
  sprite(cv, MAT.ox, MAT.oy, [
    '..........KK',
    '........KKHK',
    '......KKHHLK',
    '....KKHLLLLK',
    '..KKLLLLLMMK',
    'KKLLLLLMMMDK',
    'KMMMMMMMDDDK',
    '.##########.',
  ], MAT_C, 51, -1);
  matRim(cv);
}

// ── server_room: baldosa levantada (pixelScale 6,8; fluorescente de arriba, luz fría) ──────────────────────────
// La baldosa perforada de la izquierda (canto de atrás en y≈1017, x≈1165–1510) ya está algo levantada, pero gris sobre
// gris. Rendija negra detrás, el canto de atrás con luz, sombra a la derecha sobre la baldosa vecina y un lazo del
// cable naranja (el alargador que hay debajo) asomando.
const TILE = { ox: 1165, oy: 1017 };
const TILE_C = { K: [8, 10, 12], V: [20, 26, 30], E: [150, 200, 190], O: [214, 110, 40], o: [150, 70, 30] };
function tileLifted(cv) {
  const N = 51;
  for (let ax = 0; ax < N; ax++) {
    // Rendija: el fondo muy oscurecido (conserva su textura), negro solo en el fondo del hueco
    cv.shade(TILE.ox, TILE.oy, ax, -3, 0.55);
    cv.px(TILE.ox, TILE.oy, ax, -2, TILE_C.K);
    cv.shade(TILE.ox, TILE.oy, ax, -1, 0.3);
    cv.shade(TILE.ox, TILE.oy, ax, 0, 1.3); // canto de atrás con la luz del techo
  }
  // Cable naranja que asoma por la rendija (lazo)
  sprite(cv, TILE.ox, TILE.oy, [
    '...KKKK...',
    '..KOOOOK..',
    '.KOoKKoOK.',
    'KOoK..KoOK',
  ], TILE_C, 33, -6);
  // Sombra sobre la baldosa vecina de la derecha (la levantada tapa la luz del techo)
  for (let ay = 0; ay <= 16; ay++) { cv.shade(TILE.ox, TILE.oy, N, ay, 0.5); cv.shade(TILE.ox, TILE.oy, N + 1, ay, 0.75); }
}

// ── treatment_room: nota doblada (≈6 px de fondo por píxel de arte; luz fría de la sala desde arriba a la izquierda) ──
const NOTE = { ox: 2436, oy: 714 };
const NOTE_C = { K: [14, 16, 22], W: [240, 244, 246], L: [206, 214, 218], S: [150, 160, 168], D: [70, 76, 86] };
function noteFolded(cv) {
  sprite(cv, NOTE.ox, NOTE.oy, [
    '...KKKKKKKKKKKK...',
    '..KWWWWWWWWWWWLK..',
    '.KWLLLLLLLLLLLLSK.',
    '.KLDDLDDDLDDLLLSK.',
    '.KLLLLLLLLLLLLLSK.',
    'KLLDDDLDDLDDDLLSSK',
    'KLLLLLLLLLLLLLLSSK',
    'KLLDDLDDDLLLLLLSSK',
    'KLLLLLLLLLLLLLLSSK',
    'KKKKKKKKKKKKKKKKKK',
    '.~~##############~',
  ], NOTE_C);
}

// ── recovery_pool: puerta oscura (≈5 px de fondo por píxel de arte; luz cálida de la lámpara del centro) ─────────
// El hueco (x 0–123, y 273–833) era negro del todo. Hoja de puerta metálica (ciruela oscuro del marco), con placa
// «DEEP LIQUIDITY» (garabato ilegible a este tamaño), tirador y remaches; la rendija de la izquierda deja ver una luz
// roja tenue (lo que espera dentro). Abierta: la hoja se queda en el canto derecho y el hueco se tiñe de rojo y azul.
const DOOR = { ox: 0, oy: 275 };
const DOOR_C = {
  K: [10, 6, 10], A: [52, 34, 48], B: [72, 48, 62], C: [98, 70, 82], H: [140, 108, 112],
  P: [200, 180, 150], p: [120, 96, 92], R: [150, 40, 60], r: [90, 28, 44], U: [50, 60, 140], u: [34, 36, 80], G: [190, 190, 196],
};
const DOOR_ROWS = 111; // 555 px de alto
function doorClosed(cv) {
  // Rendija con luz roja (columnas 2–3) y la hoja de la columna 4 a la 23
  for (let ay = 0; ay < DOOR_ROWS; ay++) {
    const glow = ay > 8 && ay < DOOR_ROWS - 2;
    cv.px(DOOR.ox, DOOR.oy, 2, ay, glow && ay % 3 ? DOOR_C.r : DOOR_C.K);
    cv.px(DOOR.ox, DOOR.oy, 3, ay, glow ? DOOR_C.R : DOOR_C.r);
    cv.px(DOOR.ox, DOOR.oy, 4, ay, DOOR_C.K);
    for (let ax = 5; ax <= 22; ax++) {
      let c = ax === 5 ? DOOR_C.C : ax >= 21 ? DOOR_C.A : DOOR_C.B; // canto de la izquierda con la luz roja, derecha en sombra
      if (ay % 22 === 0 || ay === DOOR_ROWS - 1) c = DOOR_C.A; // juntas de los paneles
      if (ay % 22 === 1 && ax < 21) c = DOOR_C.C;
      cv.px(DOOR.ox, DOOR.oy, ax, ay, c);
    }
    cv.px(DOOR.ox, DOOR.oy, 23, ay, DOOR_C.K);
  }
  // Remaches
  for (const ay of [4, 26, 48, 70, 92]) for (const ax of [7, 20]) cv.px(DOOR.ox, DOOR.oy, ax, ay, DOOR_C.H);
  // Placa (2 filas de garabato) a la altura de los ojos
  sprite(cv, DOOR.ox, DOOR.oy, [
    'KKKKKKKKKKKKKK',
    'KPPPPPPPPPPPPK',
    'KPpPppPpPPpPpK',
    'KPPPPPPPPPPPPK',
    'KPppPpPpppPPPK',
    'KPPPPPPPPPPPPK',
    'KKKKKKKKKKKKKK',
  ], DOOR_C, 7, 30);
  // Tirador (del lado de la rendija)
  sprite(cv, DOOR.ox, DOOR.oy, ['KK.', 'GGK', 'GHK', 'KKK'], DOOR_C, 6, 60);
  // Luz roja en el suelo, saliendo por la rendija
  sprite(cv, DOOR.ox, DOOR.oy, ['rRRr', '.rr.'], DOOR_C, 1, DOOR_ROWS);
}
function doorOpen(cv) {
  for (let ay = 0; ay < DOOR_ROWS; ay++) {
    for (let ax = 0; ax <= 17; ax++) {
      // Hueco teñido: rojo arriba, azul abajo, tramado en damero en la transición (como el fondo)
      const t = ay / DOOR_ROWS;
      const blue = t > 0.55 || (t > 0.4 && (ax + ay) % 2 === 0);
      const strong = ax > 3 && ax < 15 && ay > 6;
      cv.px(DOOR.ox, DOOR.oy, ax, ay, blue ? (strong ? DOOR_C.U : DOOR_C.u) : strong ? DOOR_C.R : DOOR_C.r);
    }
    cv.px(DOOR.ox, DOOR.oy, 18, ay, DOOR_C.K);
    for (let ax = 19; ax <= 22; ax++) cv.px(DOOR.ox, DOOR.oy, ax, ay, ax === 19 ? DOOR_C.C : DOOR_C.A); // la hoja, de canto
    cv.px(DOOR.ox, DOOR.oy, 23, ay, DOOR_C.K);
  }
  sprite(cv, DOOR.ox, DOOR.oy, ['rRRRRRRRRr', '.rrRRRRrr.', '...rrrr...'], DOOR_C, 3, DOOR_ROWS);
}

// ── Escenas ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SCENES = [
  {
    id: 'outside', ps: 4.5,
    overlays: [
      { id: 'doormat_lump', sprite: 'overlay_doormat_lump', flag: 'found_ledger', invert: true, depth: 5, draw: doormatLump },
      { id: 'doormat_peeled', sprite: 'overlay_doormat_peeled', flag: 'found_ledger', depth: 5, draw: doormatPeeled },
    ],
  },
  {
    id: 'server_room', ps: 6.8,
    overlays: [{ id: 'tile_lifted', sprite: 'overlay_tile_lifted', flag: 'tiles_opened', invert: true, depth: 3, draw: tileLifted }],
  },
  {
    id: 'treatment_room', ps: 6,
    overlays: [{ id: 'note_folded', sprite: 'overlay_note_folded', flag: 'found_adrian_note', invert: true, depth: 5, draw: noteFolded }],
  },
  {
    id: 'recovery_pool', ps: 5,
    overlays: [
      { id: 'door_closed', sprite: 'overlay_door_closed', flag: 'dark_door_opened', invert: true, depth: 5, draw: doorClosed },
      { id: 'door_open', sprite: 'overlay_door_open', flag: 'dark_door_opened', depth: 5, draw: doorOpen },
    ],
  },
];

for (const def of SCENES) {
  const scene = await loadScene(def.id);
  const sceneFile = join(scene.dir, 'scene.json');
  const text = readFileSync(sceneFile, 'utf8');
  const json = JSON.parse(text);
  const list = (json.conditionalOverlays ?? []).filter((co) => !def.overlays.some((o) => o.id === co.id));
  const made = [];
  for (const o of def.overlays) {
    const cv = makeCanvas(scene, def.ps);
    o.draw(cv);
    cv.feather();
    const box = contentBox(cv.buf, scene.W, scene.H, 4);
    await sharp(cv.buf, { raw: { width: scene.W, height: scene.H, channels: 4 } })
      .extract(box).webp({ lossless: true, effort: 6 }).toFile(join(scene.dir, `${o.sprite}.webp`));
    const bounds = boxToPct(box, scene.W, scene.H);
    list.push({ id: o.id, sprite: o.sprite, format: 'webp', bounds, flag: o.flag, ...(o.invert ? { invert: true } : {}), depth: o.depth });
    made.push({ ...o, box, buf: cv.buf });
    console.log(`  ${def.id}/${o.sprite}.webp  ${box.width}x${box.height} en (${box.left}, ${box.top})  bounds ${JSON.stringify(bounds)}`);
  }
  // Escenas sin `conditionalOverlays` (recovery_pool): se añade la clave al final del objeto y luego se rellena
  const base = 'conditionalOverlays' in json ? text : text.replace(/\n\}\s*$/, ',\n  "conditionalOverlays": []\n}\n');
  writeFileSync(sceneFile, replaceTopLevelKey(base, 'conditionalOverlays', list));
  if (PREVIEW) {
    mkdirSync(PREVIEW, { recursive: true });
    for (const m of made) {
      const pad = 120;
      const l = Math.max(0, m.box.left - pad), t = Math.max(0, m.box.top - pad);
      const w = Math.min(scene.W - l, m.box.width + 2 * pad), h = Math.min(scene.H - t, m.box.height + 2 * pad);
      const img = await sharp(join(scene.dir, 'background.png')).composite([{ input: m.buf, raw: { width: scene.W, height: scene.H, channels: 4 } }]).png().toBuffer();
      await sharp(img).extract({ left: l, top: t, width: w, height: h }).resize(w * 2, h * 2, { kernel: 'nearest' }).png().toFile(join(PREVIEW, `${def.id}-${m.id}.png`));
    }
  }
}
if (PREVIEW) console.log(`  vistas previas en ${PREVIEW}`);

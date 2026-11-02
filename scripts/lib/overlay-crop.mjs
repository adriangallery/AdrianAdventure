// A2.7 (plan SCUMM): lógica pura del recorte de overlays (scripts/crop-overlays.mjs). Sin dependencias: se prueba
// con `node --test tests/overlay-crop.test.mjs` y el modo --check la usa sin sharp para las comprobaciones de
// cabecera. Coordenadas: caja en píxeles de la imagen original (left/top/width/height) y `bounds` en % del fondo
// ({x, y, w, h}, como hotspots y walkableAreas).

/** Alfa ≤ 4 (≤ 1,6 %) no cuenta como contenido: los PNG generados traen líneas diagonales blancas con alfa 3. */
export const ALPHA_THRESHOLD = 4;
/** Margen alrededor de la caja con contenido */
export const MARGIN_PX = 2;
/** Decimales de `bounds` (0,0001 % de 3712 px = 0,004 px; la vuelta a píxeles redondea al entero exacto) */
export const PCT_DECIMALS = 4;

/**
 * Caja con contenido (alfa > threshold) de un buffer crudo (`channels` por píxel, alfa en el último), ampliada en
 * `margin` px y recortada a la imagen. null si no hay ningún píxel con contenido.
 */
export function contentBox(data, width, height, channels = 4, { threshold = ALPHA_THRESHOLD, margin = MARGIN_PX } = {}) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const a = channels - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (data[row + x * channels + a] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const left = Math.max(0, minX - margin);
  const top = Math.max(0, minY - margin);
  const right = Math.min(width, maxX + 1 + margin);
  const bottom = Math.min(height, maxY + 1 + margin);
  return { left, top, width: right - left, height: bottom - top };
}

const round = (n) => Number(n.toFixed(PCT_DECIMALS));

/** Caja en píxeles del fondo → `bounds` en % del fondo */
export function boxToPct(box, bgW, bgH) {
  return { x: round((box.left / bgW) * 100), y: round((box.top / bgH) * 100), w: round((box.width / bgW) * 100), h: round((box.height / bgH) * 100) };
}

/** `bounds` en % → caja en píxeles enteros del fondo (la misma cuenta que src/systems/OverlayPlacement.ts) */
export function pctToBox(b, bgW, bgH) {
  return { left: Math.round((b.x * bgW) / 100), top: Math.round((b.y * bgH) / 100), width: Math.round((b.w * bgW) / 100), height: Math.round((b.h * bgH) / 100) };
}

/** ¿La caja ocupa la imagen entera? (nada que recortar) */
export const isFullBox = (box, w, h) => box.left === 0 && box.top === 0 && box.width === w && box.height === h;

/** Ancho y alto de un PNG o WebP leyendo solo la cabecera; null si no es ninguno de los dos. */
export function imageSize(buf) {
  if (!buf || buf.length < 30) return null;
  // PNG: firma + IHDR (ancho y alto big-endian en 16..23)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { format: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * Sustituye el valor de una clave de primer nivel de un scene.json sin reformatear el resto del fichero (los
 * scene.json no siguen todos JSON.stringify(…, 2)). El valor nuevo va con 2 espacios y la sangría de la clave.
 */
export function replaceTopLevelKey(text, key, value) {
  const re = new RegExp(`\\n([ \\t]*)"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*`, 'g');
  let m;
  let found = null;
  while ((m = re.exec(text))) {
    if (depthAt(text, m.index) === 1) { found = m; break; }
  }
  if (!found) throw new Error(`no encuentro la clave «${key}» en el primer nivel`);
  const start = found.index + found[0].length;
  const end = valueEnd(text, start);
  const indent = found[1];
  const json = JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
  return text.slice(0, start) + json + text.slice(end);
}

/** Profundidad de llaves/corchetes en `pos` (fuera de strings) */
function depthAt(text, pos) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < pos; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth;
}

/** Fin (exclusivo) del valor JSON que empieza en `start` */
function valueEnd(text, start) {
  const open = text[start];
  if (open !== '[' && open !== '{') {
    const m = /^("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/.exec(text.slice(start));
    return start + (m ? m[0].length : 0);
  }
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('JSON sin cerrar');
}

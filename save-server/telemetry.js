// A9.14: telemetría ANÓNIMA de duración por capítulo (decisión de Adrián, 14-nov). Módulo puro (se prueba con
// `node --test`). Se guarda una línea por muestra: { c: capítulo, s: segundos, d: día UTC }. Ni IP, ni cartera, ni
// id de partida, ni hora exacta. La IP solo se usa en memoria para el límite de envíos y no se escribe nunca.

export const CHAPTERS = 5;
export const MIN_SECONDS = 10;
export const MAX_SECONDS = 6 * 60 * 60;
export const MAX_BODY_BYTES = 256;

/** `{ chapter, seconds }` → muestra válida o null. Cualquier otro campo se ignora (no se guarda). */
export function parseSample(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { chapter, seconds } = body;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS) return null;
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return null;
  return { chapter, seconds };
}

/** Línea JSONL que se guarda (día UTC, sin hora). */
export function sampleLine(sample, now = Date.now()) {
  return JSON.stringify({ c: sample.chapter, s: sample.seconds, d: new Date(now).toISOString().slice(0, 10) }) + '\n';
}

/** Límite de envíos por clave (IP) en memoria: `max` por ventana de `windowMs`. No persiste nada. */
export function createRateLimiter({ max = 12, windowMs = 60 * 60 * 1000, now = () => Date.now(), maxKeys = 10000 } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const k = String(key || '?');
    const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { hits.set(k, arr); return false; }
    arr.push(t);
    hits.delete(k);
    hits.set(k, arr);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/** Resumen por capítulo a partir del texto JSONL: n, p25, mediana, p75, mín y máx en segundos. Líneas rotas = fuera. */
export function summarize(text) {
  const by = {};
  for (let c = 1; c <= CHAPTERS; c++) by[c] = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const s = parseSample({ chapter: r.c, seconds: r.s });
      if (s) by[s.chapter].push(s.seconds);
    } catch { /* línea rota */ }
  }
  const chapters = [];
  for (let c = 1; c <= CHAPTERS; c++) {
    const v = by[c].sort((a, b) => a - b);
    chapters.push({
      chapter: c, n: v.length,
      p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75),
      min: v.length ? v[0] : null, max: v.length ? v[v.length - 1] : null,
    });
  }
  return { unit: 'seconds', target: { minMinutes: 20, maxMinutes: 40 }, chapters };
}

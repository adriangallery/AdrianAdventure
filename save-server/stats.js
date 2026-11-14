// A9.17: estadísticas ANÓNIMAS de jugadores. Módulo sin dependencias (solo node:fs/crypto): se prueba con `node --test`
// (tests/stats-server.test.mjs) y lo usan index.js (Hono) y la demo (scripts/demo-a9-17-stats.mjs, servidor http mínimo).
//
// Qué se guarda: eventos crudos en `<dir>/events-YYYY-MM-DD.jsonl` (día UTC), como mucho RAW_DAYS días, y un agregado
// diario sin ids en `<dir>/daily/YYYY-MM-DD.json` (se queda). Cada evento crudo lleva: tipo, id de partida HASHEADO con
// una sal del servidor (no el id que manda el navegador), capítulo/segundos/escena si aplica, móvil o no, familia de
// navegador y si había cartera conectada (booleano). NUNCA: IP, dirección de cartera, user agent, hora exacta (solo el día).
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const EVENT_TYPES = ['session_start', 'new_game', 'continue', 'chapter_start', 'chapter_complete', 'game_complete', 'quit_scene'];
export const BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'other'];
export const CHAPTERS = 5;
export const MAX_SECONDS = 6 * 60 * 60;
export const MAX_BODY_BYTES = 512;
export const RAW_DAYS = 30;
const SID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SCENE_RE = /^[a-z0-9_]{1,40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/**
 * Cuerpo del navegador → evento válido o null. Solo se copian los campos conocidos (lo demás, p. ej. una dirección, se
 * descarta sin mirarlo). `t` tipo, `sid` id de partida aleatorio, `ch` capítulo, `s` segundos, `scene`, `m` móvil,
 * `br` navegador, `w` cartera conectada (booleano).
 */
export function parseEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { t, sid } = body;
  if (!EVENT_TYPES.includes(t) || typeof sid !== 'string' || !SID_RE.test(sid)) return null;
  const ev = { t, sid, m: body.m === true, br: BROWSERS.includes(body.br) ? body.br : 'other', w: body.w === true };
  if (t === 'chapter_start' || t === 'chapter_complete') {
    if (!Number.isInteger(body.ch) || body.ch < 1 || body.ch > CHAPTERS) return null;
    ev.ch = body.ch;
    if (t === 'chapter_complete' && Number.isInteger(body.s) && body.s >= 1 && body.s <= MAX_SECONDS) ev.s = body.s;
  }
  if (t === 'quit_scene') {
    if (typeof body.scene !== 'string' || !SCENE_RE.test(body.scene)) return null;
    ev.scene = body.scene;
  }
  return ev;
}

/** Hash corto (16 hex) del id de partida con la sal del servidor: cuenta únicos sin guardar el id que manda el navegador. */
export function hashSid(sid, salt) {
  return createHash('sha256').update(`${salt}:${sid}`).digest('hex').slice(0, 16);
}

function emptyDay(day) {
  const per = () => Object.fromEntries(Array.from({ length: CHAPTERS }, (_, i) => [i + 1, 0]));
  return {
    day, uniques: 0, newGames: 0, continues: 0,
    chapterStart: per(), chapterComplete: per(),
    chapterSeconds: Object.fromEntries(Array.from({ length: CHAPTERS }, (_, i) => [i + 1, []])),
    gameComplete: 0,
    platform: { mobile: 0, desktop: 0 },
    browser: Object.fromEntries(BROWSERS.map((b) => [b, 0])),
    wallet: { with: 0, without: 0 },
    quitScenes: {},
  };
}

/**
 * Agregado de UN día a partir de sus eventos crudos (ya parseados, con `h` = hash del id). Cuenta por partida (no por
 * evento): un id que manda dos `new_game` el mismo día cuenta una vez; la plataforma/cartera/navegador es la de su
 * primer evento del día; la escena de abandono es la de su ÚLTIMO `quit_scene` del día. Los segundos por capítulo se
 * guardan como lista (sin ids) para poder sacar percentiles de cualquier rango.
 */
export function aggregateDay(day, events) {
  const out = emptyDay(day);
  const seen = new Map();
  const once = (h, key) => { const s = seen.get(h); if (s.has(key)) return false; s.add(key); return true; };
  const lastQuit = new Map();
  for (const ev of events) {
    if (!ev || typeof ev.h !== 'string') continue;
    if (!seen.has(ev.h)) {
      seen.set(ev.h, new Set());
      out.uniques++;
      out.platform[ev.m ? 'mobile' : 'desktop']++;
      out.browser[BROWSERS.includes(ev.br) ? ev.br : 'other']++;
      out.wallet[ev.w ? 'with' : 'without']++;
    }
    switch (ev.t) {
      case 'new_game': if (once(ev.h, 'n')) out.newGames++; break;
      case 'continue': if (once(ev.h, 'c')) out.continues++; break;
      case 'chapter_start': if (ev.ch >= 1 && ev.ch <= CHAPTERS && once(ev.h, `s${ev.ch}`)) out.chapterStart[ev.ch]++; break;
      case 'chapter_complete':
        if (ev.ch >= 1 && ev.ch <= CHAPTERS && once(ev.h, `e${ev.ch}`)) {
          out.chapterComplete[ev.ch]++;
          if (Number.isInteger(ev.s)) out.chapterSeconds[ev.ch].push(ev.s);
        }
        break;
      case 'game_complete': if (once(ev.h, 'g')) out.gameComplete++; break;
      case 'quit_scene': if (typeof ev.scene === 'string') lastQuit.set(ev.h, ev.scene); break;
      default: break;
    }
  }
  for (const scene of lastQuit.values()) out.quitScenes[scene] = (out.quitScenes[scene] || 0) + 1;
  return out;
}

/** Cuantil con interpolación lineal sobre una lista ORDENADA (null si vacía), redondeado al segundo. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/**
 * Resumen para la página /stats a partir de agregados diarios (`days`, cualquier orden) y de los hashes únicos de
 * hoy y de los últimos 7 días (`uniqueToday`, `uniqueWeek`: números; vienen de los eventos crudos).
 */
export function summarizeDays(days, { today, uniqueToday = 0, uniqueWeek = 0 } = {}) {
  const sum = emptyDay(null);
  const secs = Object.fromEntries(Array.from({ length: CHAPTERS }, (_, i) => [i + 1, []]));
  const daily = [];
  for (const d of [...days].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    daily.push({ day: d.day, uniques: d.uniques, newGames: d.newGames, continues: d.continues });
    sum.uniques += d.uniques; sum.newGames += d.newGames; sum.continues += d.continues; sum.gameComplete += d.gameComplete;
    for (let c = 1; c <= CHAPTERS; c++) {
      sum.chapterStart[c] += d.chapterStart?.[c] || 0;
      sum.chapterComplete[c] += d.chapterComplete?.[c] || 0;
      for (const s of d.chapterSeconds?.[c] || []) secs[c].push(s);
    }
    for (const k of ['mobile', 'desktop']) sum.platform[k] += d.platform?.[k] || 0;
    for (const k of BROWSERS) sum.browser[k] += d.browser?.[k] || 0;
    for (const k of ['with', 'without']) sum.wallet[k] += d.wallet?.[k] || 0;
    for (const [scene, n] of Object.entries(d.quitScenes || {})) sum.quitScenes[scene] = (sum.quitScenes[scene] || 0) + n;
  }
  const funnel = [];
  const chapterTime = [];
  for (let c = 1; c <= CHAPTERS; c++) {
    funnel.push({ chapter: c, start: sum.chapterStart[c], complete: sum.chapterComplete[c] });
    const v = secs[c].sort((a, b) => a - b);
    chapterTime.push({ chapter: c, n: v.length, p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75) });
  }
  const started = sum.chapterStart[1];
  return {
    range: { from: daily[0]?.day ?? today ?? null, to: today ?? daily[daily.length - 1]?.day ?? null, days: daily.length },
    uniques: { today: uniqueToday, week: uniqueWeek, sumDaily: sum.uniques, daily },
    games: { new: sum.newGames, continue: sum.continues },
    funnel,
    chapterTime,
    finish: { started, completed: sum.gameComplete, rate: started > 0 ? Math.round((sum.gameComplete / started) * 1000) / 10 : null },
    platform: sum.platform,
    browser: sum.browser,
    wallet: sum.wallet,
    quitScenes: Object.entries(sum.quitScenes).map(([scene, n]) => ({ scene, n })).sort((a, b) => b.n - a.n || (a.scene < b.scene ? -1 : 1)).slice(0, 10),
  };
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* línea rota */ }
  }
  return out;
}

/**
 * Almacén en disco (directorio persistente). `now` inyectable para los tests. La sal del hash se genera la primera vez
 * y se guarda en `<dir>/salt` (no sale nunca del servidor).
 */
export function createStatsStore({ dir, now = () => Date.now(), rawDays = RAW_DAYS } = {}) {
  const dailyDir = join(dir, 'daily');
  mkdirSync(dailyDir, { recursive: true });
  const saltFile = join(dir, 'salt');
  let salt;
  if (existsSync(saltFile)) salt = readFileSync(saltFile, 'utf-8').trim();
  if (!salt) { salt = randomBytes(32).toString('hex'); writeFileSync(saltFile, salt, { mode: 0o600 }); }
  const rawFile = (day) => join(dir, `events-${day}.jsonl`);
  const dailyFile = (day) => join(dailyDir, `${day}.json`);

  /** Guarda un evento ya validado (parseEvent). */
  function record(ev) {
    const { sid, ...rest } = ev;
    appendFileSync(rawFile(dayOf(now())), JSON.stringify({ ...rest, h: hashSid(sid, salt) }) + '\n');
  }

  const rawDaysOnDisk = () => readdirSync(dir)
    .map((f) => /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1]).filter(Boolean).sort();

  /**
   * Cierra los días pasados (escribe su agregado si falta) y borra los crudos con más de `rawDays` días. Devuelve los
   * días borrados.
   */
  function maintain() {
    const today = dayOf(now());
    const oldest = addDays(today, -(rawDays - 1));
    const purged = [];
    for (const day of rawDaysOnDisk()) {
      if (day < today && !existsSync(dailyFile(day))) writeFileSync(dailyFile(day), JSON.stringify(aggregateDay(day, readJsonl(rawFile(day)))));
      if (day < oldest) { unlinkSync(rawFile(day)); purged.push(day); }
    }
    return purged;
  }

  /** Resumen de los últimos `days` días (hoy incluido, recalculado en vivo). */
  function summary({ days = 30 } = {}) {
    maintain();
    const today = dayOf(now());
    const from = addDays(today, -(Math.max(1, Math.min(365, days)) - 1));
    const aggs = [];
    for (const f of readdirSync(dailyDir)) {
      const day = f.replace(/\.json$/, '');
      if (!DAY_RE.test(day) || day < from || day >= today) continue;
      try { aggs.push(JSON.parse(readFileSync(join(dailyDir, f), 'utf-8'))); } catch { /* roto */ }
    }
    const todayEvents = readJsonl(rawFile(today));
    aggs.push(aggregateDay(today, todayEvents));
    const week = new Set();
    for (let i = 0; i < 7; i++) for (const ev of readJsonl(rawFile(addDays(today, -i)))) if (ev.h) week.add(ev.h);
    const todaySet = new Set(todayEvents.map((e) => e.h).filter(Boolean));
    return summarizeDays(aggs, { today, uniqueToday: todaySet.size, uniqueWeek: week.size });
  }

  return { record, maintain, summary, rawFile, dailyFile, get salt() { return salt; } };
}

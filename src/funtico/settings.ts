/**
 * F1.5 (plan FUNTICO_ADVENTURE): ajustes del build Funtico (volumen de sonido y de música, 0–1, e idioma). Lógica pura
 * con almacenamiento inyectable (localStorage por defecto) y aviso de cambio a los oyentes. Probado en Node
 * (tests/funtico-settings.test.mjs). La música iMUSE de Triage (rama funtico/f1-4) se engancha a `getMusicVolume` y a
 * `onSettingsChange` al juntar las ramas.
 */

export const SETTINGS_KEY = 'adrian_adventure_funtico_settings';
export type Lang = 'en' | 'es' | 'ja';
/** Idiomas con textos ya hechos (ES/JA llegan en otro checkpoint: se enseñan como «soon»). */
export const ACTIVE_LANGS: readonly Lang[] = ['en'];

export interface Settings { v: 1; sfx: number; music: number; lang: Lang }
export interface KVLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const DEFAULTS: Settings = { v: 1, sfx: 0.8, music: 0.6, lang: 'en' };

function clamp01(n: unknown, dflt: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : dflt;
  return Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
}

/** Lee y sanea un JSON de ajustes (cualquier basura vuelve a los valores por defecto). */
export function parseSettings(raw: string | null): Settings {
  let o: Partial<Settings> = {};
  try { o = raw ? (JSON.parse(raw) as Partial<Settings>) : {}; } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  const lang = ACTIVE_LANGS.includes(o.lang as Lang) ? (o.lang as Lang) : DEFAULTS.lang;
  return { v: 1, sfx: clamp01(o.sfx, DEFAULTS.sfx), music: clamp01(o.music, DEFAULTS.music), lang };
}

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();
let store: KVLike | null = null;
let cache: Settings | null = null;

function defaultStore(): KVLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Cambia el almacén (tests) y olvida la caché. */
export function useSettingsStore(s: KVLike | null): void {
  store = s;
  cache = null;
}

export function getSettings(): Settings {
  if (!cache) {
    const s = store ?? defaultStore();
    let raw: string | null = null;
    try { raw = s?.getItem(SETTINGS_KEY) ?? null; } catch { raw = null; }
    cache = parseSettings(raw);
  }
  return { ...cache };
}

function update(patch: Partial<Settings>): Settings {
  const next = parseSettings(JSON.stringify({ ...getSettings(), ...patch }));
  cache = next;
  try { (store ?? defaultStore())?.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* sin almacén: solo en memoria */ }
  for (const l of listeners) l({ ...next });
  return { ...next };
}

export const getSfxVolume = (): number => getSettings().sfx;
export const getMusicVolume = (): number => getSettings().music;
export const setSfxVolume = (v: number): Settings => update({ sfx: v });
export const setMusicVolume = (v: number): Settings => update({ music: v });
export const setLang = (l: Lang): Settings => update({ lang: l });

/** Se llama en cada cambio; devuelve la función para darse de baja. */
export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

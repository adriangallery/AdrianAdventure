/**
 * F3.2a (plan FUNTICO_ADVENTURE): navegación entre la página del menú (index.html: mapa de campaña) y la del capítulo
 * (campaign.html?chapter=N), y el gancho de pruebas `window.__funtico.campaign`.
 */

/** Parámetros que se conservan al navegar (token y modo del puente, QA del e2e). */
const KEEP = ['token', 'mock', 'qa'];

function carried(extra: Record<string, string>): string {
  const now = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const out = new URLSearchParams();
  for (const k of KEEP) {
    const v = now.get(k);
    if (v !== null) out.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) out.set(k, v);
  return out.toString();
}

/** El mapa de campaña (menú Funtico con `view=campaign`). */
export function mapUrl(): string {
  return `./index.html?${carried({ view: 'campaign' })}`;
}

/** La página del capítulo N. */
export function chapterUrl(chapter: number): string {
  return `./campaign.html?${carried({ chapter: String(chapter) })}`;
}

export function go(url: string): void {
  location.assign(url);
}

/** `window.__funtico.campaign` (solo existe en el build funtico). */
export function campaignHook(): Record<string, unknown> {
  const w = window as unknown as { __funtico?: Record<string, unknown> };
  w.__funtico = w.__funtico ?? {};
  const c = (w.__funtico.campaign ?? {}) as Record<string, unknown>;
  w.__funtico.campaign = c;
  return c;
}

/** El capítulo de `?chapter=N` (1 por defecto). */
export function chapterParam(): number {
  const ch = Number(new URLSearchParams(location.search).get('chapter') ?? '1');
  return Number.isInteger(ch) && ch >= 1 && ch <= 5 ? ch : 1;
}

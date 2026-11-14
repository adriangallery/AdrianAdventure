// A9.4 (plan SCUMM): nombre del juego y web, en UN solo sitio. Lo usan la portada (MenuScene), los créditos
// (CinematicOverlay), el resumen del final y `index.html` (título, pantalla de carga y metas: vite.config.ts cambia los
// marcadores `%GAME_NAME%`, `%GAME_WEB%`, `%GAME_URL%` y `%GAME_TAGLINE%` con `brandHtml`; tests/branding.test.mjs
// comprueba que index.html no lleva el nombre escrito a mano).
//
// PROVISIONAL: el nombre es el que hoy enseña el arte de la portada (assets/ui/intro.png: «ZERO ADVENTURES» + «PATIENT
// ZERO»); la web, la única que enseñaba el juego (la última línea de los créditos). Falta que Adrián elija: cambiar el
// nombre o la web es cambiar UNA línea aquí (y, si cambia el nombre, el arte de la portada, que es una imagen).
// Lógica pura, sin imports (se prueba con `node --experimental-strip-types`).

export const BRANDING = {
  /** Nombre del juego, tal cual en títulos y créditos */
  name: 'ZERO Adventures: Patient Zero',
  /** Web del juego, sin protocolo (lo que se lee en pantalla) */
  web: 'zeroadventures.com',
  /** Subtítulo de la portada y de los créditos */
  tagline: 'A Point & Click Web3 Adventure on Base',
} as const;

/** URL completa de la web. */
export function brandUrl(web: string = BRANDING.web): string {
  return `https://${web}`;
}

/** Escapa un texto para meterlo en HTML (contenido o atributo). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Marcadores de `index.html` → valor (ya escapado para HTML). */
export function brandPlaceholders(b: { name: string; web: string; tagline: string } = BRANDING): Record<string, string> {
  return {
    '%GAME_NAME%': escapeHtml(b.name),
    '%GAME_WEB%': escapeHtml(b.web),
    '%GAME_URL%': escapeHtml(brandUrl(b.web)),
    '%GAME_TAGLINE%': escapeHtml(b.tagline),
  };
}

/** Cambia en `html` todos los marcadores de marca (vite.config.ts lo usa en `transformIndexHtml`). */
export function brandHtml(html: string, b: { name: string; web: string; tagline: string } = BRANDING): string {
  let out = html;
  for (const [k, v] of Object.entries(brandPlaceholders(b))) out = out.split(k).join(v);
  return out;
}

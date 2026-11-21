/**
 * Perfil de maquetación (F3.2b). Decide cómo se reparte la ventana entre la escena y el panel de verbos.
 *
 * Por defecto (`CLASSIC_LAYOUT`) NO cambia nada: todo el código que lo consulta sigue por la rama de siempre y el juego
 * se comporta exactamente igual que antes de existir este archivo. Otro build lo cambia con `setLayoutProfile()` ANTES
 * de arrancar el juego (mismo patrón que `PlatformHooks.ts`).
 *
 * Lógica pura, sin imports: se prueba en Node con `--experimental-strip-types`.
 */

export interface LayoutProfile {
  /**
   * Vertical apilado: fracción del alto de la ventana para la escena (arriba, a todo el ancho; la cámara sigue a Dex
   * en horizontal). Debajo, el panel de verbos e inventario a tamaño de pulgar. `null` = layout clásico.
   */
  portraitSceneRatio: number | null;
  /** Vertical apilado: tamaño mínimo de letra de la interfaz (px CSS). */
  portraitMinFontPx: number;
  /** Vertical apilado: lado mínimo de una zona táctil (px CSS). */
  portraitMinTouchPx: number;
}

export const CLASSIC_LAYOUT: Readonly<LayoutProfile> = Object.freeze({
  portraitSceneRatio: null,
  portraitMinFontPx: 11,
  portraitMinTouchPx: 44,
});

/** Perfil para móviles que se juegan en vertical y en horizontal, con giro en caliente. */
export const STACKED_PORTRAIT_LAYOUT: Readonly<LayoutProfile> = Object.freeze({
  portraitSceneRatio: 0.5,
  portraitMinFontPx: 14,
  portraitMinTouchPx: 44,
});

let current: Readonly<LayoutProfile> = CLASSIC_LAYOUT;

/** Instala un perfil (los campos que falten, los del clásico). null = vuelve al clásico. */
export function setLayoutProfile(profile: Partial<LayoutProfile> | null | undefined): void {
  current = profile ? Object.freeze({ ...CLASSIC_LAYOUT, ...profile }) : CLASSIC_LAYOUT;
}

export function getLayoutProfile(): Readonly<LayoutProfile> {
  return current;
}

/** ¿Va el layout vertical apilado con esta ventana? Solo con un perfil que lo pida y la ventana más alta que ancha. */
export function isStackedPortrait(width: number, height: number, profile: Readonly<LayoutProfile> = current): boolean {
  return profile.portraitSceneRatio !== null && height > width;
}

/**
 * Alto del panel en vertical apilado (ventana − escena), o null si no aplica (y entonces manda el cálculo clásico).
 */
export function stackedPanelHeight(width: number, height: number, profile: Readonly<LayoutProfile> = current): number | null {
  if (!isStackedPortrait(width, height, profile)) return null;
  const sceneH = Math.floor(height * (profile.portraitSceneRatio as number));
  return Math.max(0, height - sceneH);
}

/**
 * Letra mínima de diálogos y opciones en un móvil (vertical, o lado menor < 600 px) con un perfil que lo pida; null con
 * el clásico (y entonces manda el tamaño de siempre).
 */
export function mobileMinFontPx(width: number, height: number, profile: Readonly<LayoutProfile> = current): number | null {
  if (profile.portraitSceneRatio === null) return null;
  return height > width || Math.min(width, height) < 600 ? profile.portraitMinFontPx : null;
}

// A1.8 (plan SCUMM): parámetros de depuración de la URL. Lógica pura, sin Phaser ni import.meta (se prueba en Node).
//
// `?scene=<id>` (saltar a cualquier escena sin gates), `?skip` (saltar el menú), `?dev` (selector flotante de escenas)
// y `?hintAfter=<s>` (acortar la espera de las pistas) son herramientas de desarrollo y QA. En el build de producción
// solo valen con `?qa=1` (smoke, demos y walkthrough del CI ya cargan con él); en `npm run dev` valen siempre.

/** Parámetros que solo se aceptan en desarrollo o con `?qa=1`. */
export const DEBUG_PARAMS = ['scene', 'skip', 'dev', 'hintAfter'] as const;

/** ¿Se aceptan los parámetros de depuración? En dev siempre; en producción solo con `qa=1`. */
export function debugParamsAllowed(search: string, isDev: boolean): boolean {
  return isDev || new URLSearchParams(search).get('qa') === '1';
}

/**
 * Parámetros de la URL que el juego debe atender: los de depuración se quitan si no están permitidos
 * (el resto, como `qa`, `trailer` o `record`, pasan tal cual).
 */
export function gameUrlParams(search: string, isDev: boolean): URLSearchParams {
  const params = new URLSearchParams(search);
  if (!debugParamsAllowed(search, isDev)) for (const k of DEBUG_PARAMS) params.delete(k);
  return params;
}

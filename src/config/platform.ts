/**
 * Platform detection and feature flags.
 *
 * Three build targets share one codebase:
 *  - Web (Vercel)        → full Web3
 *  - Android (Capacitor) → Web3 reads only, no minting (Google Play billing policy)
 *  - Steam (Electron)    → Web3 fully disabled (Steam NFT/crypto ban)
 *  - Funtico (F0.1)      → Web3 fully disabled, same path as Steam (`vite build --mode funtico`)
 */

import { Capacitor } from '@capacitor/core';

/** Running inside Electron (Steam build) */
export const IS_ELECTRON =
  typeof window !== 'undefined' &&
  window.navigator.userAgent.includes('Electron');

/** Running as a Capacitor native app (Android) */
export const IS_NATIVE = Capacitor.isNativePlatform();

/**
 * F0.1 (plan FUNTICO_ADVENTURE): build de Funtico. Constante de compilación de vite.config.ts (`define`): `true` solo
 * con `--mode funtico`; en el build normal se pliega a `false` y el minificador quita las ramas (el bundle normal no
 * lleva la cadena: lo vigila scripts/check-no-funtico.mjs). Sin `define` (tests de Node con --experimental-strip-types)
 * la guarda de `typeof` deja `false`.
 */
declare const __IS_FUNTICO__: boolean | undefined;
export const IS_FUNTICO: boolean = typeof __IS_FUNTICO__ !== 'undefined' && __IS_FUNTICO__ === true;

/** Steam build (Electron wrapper) */
export const IS_STEAM = IS_ELECTRON;

/** Regular web browser (Vercel deployment). The Funtico build is not «web» here: like Steam, nothing web3 starts. */
export const IS_WEB = !IS_NATIVE && !IS_ELECTRON && !IS_FUNTICO;

/** Web3 features available (wallet connect, NFT display, gating, saves) */
export const WEB3_ENABLED = !IS_FUNTICO && (IS_WEB || IS_NATIVE);

/** Web3 write operations (minting items/achievements on-chain) */
export const WEB3_WRITES_ENABLED = !IS_FUNTICO && IS_WEB;

/**
 * A2.4: hay un ratón o un trackpad (puntero fino que puede pasar por encima). Con él se pintan las teclas de los
 * verbos en el panel; en móvil y tableta (dedo) no, aunque la ventana sea ancha.
 */
export function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

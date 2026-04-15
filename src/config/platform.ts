/**
 * Platform detection and feature flags.
 *
 * Three build targets share one codebase:
 *  - Web (Vercel)        → full Web3
 *  - Android (Capacitor) → Web3 reads only, no minting (Google Play billing policy)
 *  - Steam (Electron)    → Web3 fully disabled (Steam NFT/crypto ban)
 */

import { Capacitor } from '@capacitor/core';

/** Running inside Electron (Steam build) */
export const IS_ELECTRON =
  typeof window !== 'undefined' &&
  window.navigator.userAgent.includes('Electron');

/** Running as a Capacitor native app (Android) */
export const IS_NATIVE = Capacitor.isNativePlatform();

/** Steam build (Electron wrapper) */
export const IS_STEAM = IS_ELECTRON;

/** Regular web browser (Vercel deployment) */
export const IS_WEB = !IS_NATIVE && !IS_ELECTRON;

/** Web3 features available (wallet connect, NFT display, gating, saves) */
export const WEB3_ENABLED = IS_WEB || IS_NATIVE;

/** Web3 write operations (minting items/achievements on-chain) */
export const WEB3_WRITES_ENABLED = IS_WEB;

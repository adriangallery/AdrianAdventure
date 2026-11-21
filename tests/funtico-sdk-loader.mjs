// F2.1: carga el SDK vendorizado de Funtico (src/funtico/sdk/FunticoPhaserSDK.ts) en Node SIN tocarlo.
// El SDK importa Phaser y hace `extends Phaser.Plugins.BasePlugin` al cargar (y Phaser necesita `window`), así que
// un gancho de resolución sustituye SOLO el especificador 'phaser' por un módulo mínimo. Requiere
// `node --experimental-transform-types` (el SDK usa `enum`). Lo usan tests/funtico-*.test.mjs y
// scripts/funtico-crypto-vectors.mjs.
import { register } from 'node:module';

const PHASER_STUB = 'export default { Plugins: { BasePlugin: class {} } }';
const HOOK = `export async function resolve(s, c, n) {
  if (s === 'phaser') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(PHASER_STUB)}), shortCircuit: true };
  return n(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(HOOK));

/** El módulo del SDK tal cual (exporta CryptoHelper, FunticoSDK…). */
export function loadFunticoSdk() {
  return import(new URL('../src/funtico/sdk/FunticoPhaserSDK.ts', import.meta.url).href);
}

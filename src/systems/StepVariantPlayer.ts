/**
 * A4.7 (plan SCUMM): la parte con Phaser de las propuestas de pasos (`?steps=a|b|c`, lógica en StepVariants.ts).
 * Sin el parámetro no hace nada y GameScene toca los pasos de siempre. Con él:
 *  - descarga SOLO los ficheros de la variante para las superficies de la escena, y solo con el sonido activado
 *    (A1.5: en silencio, cero peticiones de audio); si se activa el sonido más tarde, se piden en la siguiente pisada;
 *  - elige cada pisada con un StepPicker único para toda la partida (semilla fija con ?qa=1) y la toca con su
 *    volumen, velocidad y un pequeño retraso.
 */
import type Phaser from 'phaser';
import { sfxOf } from '@/systems/Sfx';
import type { MusicManager } from '@/systems/MusicManager';
import { ASSET_V } from '@/systems/ScenePrefetcher';
import { StepPicker, parseStepVariant, stepSeed, variantFiles, type StepVariant } from '@/systems/StepVariants';
import type { FootstepAudioConfig } from '@/systems/Footsteps';

const PICKER_KEY = 'stepVariantPicker';
const requested = new Set<string>();

/** La variante pedida en la URL (null = los pasos de siempre) */
export function currentStepVariant(): StepVariant | null {
  return typeof window === 'undefined' ? null : parseStepVariant(window.location.search);
}

function isMuted(scene: Phaser.Scene): boolean {
  const mm = scene.game.registry.get('musicManager') as MusicManager | undefined;
  return mm ? mm.isMuted() : scene.sound.mute;
}

/** Pide los ficheros de la variante que usa la escena (si hay variante y sonido). Seguro de llamar en cada pisada. */
export function ensureStepVariantLoaded(scene: Phaser.Scene, audio: FootstepAudioConfig | null | undefined): void {
  const variant = currentStepVariant();
  if (!variant || !audio || isMuted(scene) || !scene.load) return;
  const surfaces = [audio.footstep, ...(audio.surfaces ?? []).map((r) => r?.footstep)].filter((s): s is string => typeof s === 'string');
  let queued = 0;
  for (const f of variantFiles(variant, surfaces)) {
    if (requested.has(f.key) || scene.cache.audio.has(f.key)) continue;
    requested.add(f.key);
    scene.load.audio(f.key, `${f.url}${ASSET_V}`);
    queued++;
  }
  if (!queued) return;
  scene.load.once(`loaderror`, (file: Phaser.Loader.File) => requested.delete(file.key));
  scene.load.start();
}

/**
 * Toca la pisada de la variante en `surface`. Devuelve la clave elegida (null = la variante no suena en esa
 * superficie o aún no se ha descargado), o undefined si no hay variante (que GameScene toque los de siempre).
 */
export function playStepVariant(scene: Phaser.Scene, audio: FootstepAudioConfig | null | undefined, surface: string, depth: number): string | null | undefined {
  const variant = currentStepVariant();
  if (!variant) return undefined;
  let picker = scene.game.registry.get(PICKER_KEY) as StepPicker | undefined;
  if (!picker || picker.variant !== variant) {
    const qa = new URLSearchParams(window.location.search).get('qa') === '1';
    picker = new StepPicker(variant, stepSeed(qa, Math.random()));
    scene.game.registry.set(PICKER_KEY, picker);
  }
  const step = picker.next(surface, depth);
  if (!step) return null;
  if (!scene.cache.audio.has(step.key)) {
    ensureStepVariantLoaded(scene, audio);
    return null;
  }
  const play = () => sfxOf(scene)?.play(step.key, { volume: step.volume, rate: step.rate });
  if (step.delayMs > 0) scene.time.delayedCall(step.delayMs, play);
  else play();
  return step.key;
}

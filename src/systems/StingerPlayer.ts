/**
 * A4.5 (plan SCUMM): toca un stinger en la tonalidad de la música que suena y baja la música mientras dura. La lógica
 * (qué clip, cuánto desafino, cuánto dura) está en src/systems/Stingers.ts; aquí solo se junta con MusicManager y SfxPlayer.
 */
import type Phaser from 'phaser';
import type { MusicManager } from '@/systems/MusicManager';
import { sfxOf } from '@/systems/Sfx';
import { STINGER_VOLUME, stingerFor, type StingerKind } from '@/systems/Stingers';

export interface StingerEvent {
  kind: StingerKind;
  key: string;
  detune: number;
  music: string | null;
  at: number;
}

const KEEP = 20;
/** Últimos stingers tocados (QA), en el registry del juego */
const LOG_KEY = 'stingerLog';

export function playStinger(scene: Phaser.Scene, kind: StingerKind): StingerEvent | null {
  const sfx = sfxOf(scene);
  if (!sfx) return null;
  const mm = scene.game.registry.get('musicManager') as MusicManager | undefined;
  const musicKey = mm?.currentMusicKey() ?? null;
  const { key, detune, ms } = stingerFor(kind, musicKey);
  const ok = sfx.play(key, { volume: STINGER_VOLUME, detune });
  // A8.1: puzle resuelto → la música adaptativa pasa unos compases al estado `solved`
  if (kind === 'puzzle') mm?.markSolved();
  if (ok && mm) {
    mm.setDuck('stinger', true);
    setTimeout(() => mm.setDuck('stinger', false), ms + 150);
  }
  const ev: StingerEvent = { kind, key, detune, music: mm?.qaState().music.key ?? null, at: Math.round(performance.now()) };
  const log = (scene.game.registry.get(LOG_KEY) as StingerEvent[] | undefined) ?? [];
  log.push(ev);
  if (log.length > KEEP) log.shift();
  scene.game.registry.set(LOG_KEY, log);
  return ev;
}

/** A4.5 (QA): últimos stingers tocados en esta página */
export function stingerLog(game: Phaser.Game): StingerEvent[] {
  return [...((game.registry.get(LOG_KEY) as StingerEvent[] | undefined) ?? [])];
}

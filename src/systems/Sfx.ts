/**
 * A4.4 (plan SCUMM): un solo sitio por el que pasan los efectos de sonido (pasos, puertas, interfaz, `playSound`).
 * Antes cada escena hacía `this.sound.play(key)` por su cuenta; ahora `SfxPlayer` (en el registry del juego,
 * `sfx`) comprueba que el clip está en caché, lo toca con el volumen y el desafino pedidos y apunta cada petición
 * para la API de QA (`state().audio.sfx`): clave, momento, parámetros y si llegó a sonar. En silencio Phaser está
 * en mute y no se oye nada, pero la petición se apunta igual: las rutas de QA (sin sonido) pueden comprobar que
 * una puerta pidió su crujido.
 */
import type Phaser from 'phaser';

export interface SfxOptions {
  volume?: number;
  /** Cents (±1200 = una octava) */
  detune?: number;
  rate?: number;
}

export interface SfxEvent {
  key: string;
  /** performance.now() */
  at: number;
  volume: number;
  detune: number;
  /** false si el clip no estaba en caché (no suena; el linter avisa si falta en sfxKeys de PreloadScene) */
  ok: boolean;
}

export interface SfxQaState {
  /** Últimas peticiones (las 40 más recientes) */
  last: SfxEvent[];
  /** Peticiones desde que arrancó la página */
  total: number;
  /** Peticiones por clave */
  counts: Record<string, number>;
  /** Claves pedidas que no estaban en caché */
  missing: string[];
}

const KEEP = 40;

export class SfxPlayer {
  private game: Phaser.Game;
  private log: SfxEvent[] = [];
  private total = 0;
  private counts: Record<string, number> = {};
  private missing = new Set<string>();

  constructor(game: Phaser.Game) {
    this.game = game;
  }

  /** Toca un efecto si está en caché. Devuelve si sonó (o sonaría: en silencio Phaser está en mute). */
  play(key: string, opts: SfxOptions = {}): boolean {
    const volume = opts.volume ?? 0.7;
    const detune = opts.detune ?? 0;
    const ok = this.game.cache.audio.has(key);
    if (ok) {
      try {
        this.game.sound.play(key, { volume, detune, rate: opts.rate ?? 1 });
      } catch {
        // Sin contexto de audio (navegador sin Web Audio): se apunta y se sigue
      }
    } else {
      this.missing.add(key);
    }
    this.total++;
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    this.log.push({ key, at: Math.round(performance.now()), volume, detune, ok });
    if (this.log.length > KEEP) this.log.shift();
    return ok;
  }

  qaState(): SfxQaState {
    return { last: [...this.log], total: this.total, counts: { ...this.counts }, missing: [...this.missing] };
  }
}

/** El reproductor del juego (lo crea BootScene) o null fuera de él */
export function sfxOf(scene: Phaser.Scene): SfxPlayer | null {
  return (scene.game.registry.get('sfx') as SfxPlayer | undefined) ?? null;
}

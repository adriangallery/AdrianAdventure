import Phaser from 'phaser';
import type { MusicManager } from '@/systems/MusicManager';
import { voicePath } from '@/config/voice.config';

/** Only duck music for lines longer than this (short quips play over the music). */
const DUCK_THRESHOLD = 60;

/**
 * VoiceSystem — plays character voice clips alongside dialogue text.
 *
 * Uses lazy loading: audio files are fetched on-demand the first time
 * a line is spoken, then cached by Phaser for subsequent plays.
 * This avoids loading 1600+ files upfront which overwhelms the browser.
 *
 * Automatically ducks background music while voice is playing.
 */
export class VoiceSystem {
  private scene: Phaser.Scene;
  private currentSound: Phaser.Sound.BaseSound | null = null;
  private enabled = true;
  private ducked = false;
  private loading = new Set<string>();

  /** Text→voiceKey lookup. Key = normalised first 100 chars of dialogue text. */
  private textMap = new Map<string, string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Register a mapping from dialogue text to a voice audio key. */
  register(text: string, voiceKey: string): void {
    this.textMap.set(this.normalise(text), voiceKey);
  }

  /** Register many mappings at once. */
  registerAll(entries: Array<{ text: string; key: string }>): void {
    for (const e of entries) this.register(e.text, e.key);
  }

  /**
   * Play voice for a dialogue line. Lazy-loads the audio if needed.
   * Only ducks music for lines longer than DUCK_THRESHOLD characters.
   */
  play(text: string, explicitKey?: string): void {
    if (!this.enabled) return;
    this.stop();

    const norm = this.normalise(text);
    const key = explicitKey ?? this.textMap.get(norm);
    if (!key) {
      if (import.meta.env.DEV) console.warn(`[Voice] No match for: "${norm}"`);
      return;
    }

    // Already cached — play immediately
    if (this.scene.cache.audio.has(key)) {
      this.playKey(key, text.length);
      return;
    }

    // Lazy load then play
    if (this.loading.has(key)) return; // already loading
    this.loading.add(key);
    this.scene.load.audio(key, voicePath(key));
    this.scene.load.once('complete', () => {
      this.loading.delete(key);
      if (this.scene.cache.audio.has(key)) {
        this.playKey(key, text.length);
      }
    });
    this.scene.load.start();
  }

  /** Stop currently playing voice clip. */
  stop(): void {
    if (this.currentSound) {
      this.currentSound.stop();
      this.currentSound.destroy();
      this.currentSound = null;
    }
    this.unduckMusic();
  }

  /** Play a sequence of voice keys one after another. Returns a Promise that resolves when all are done. */
  async playSequence(keys: string[], gapMs = 300): Promise<void> {
    this.duckMusic();
    for (const key of keys) {
      // Lazy load if needed
      if (!this.scene.cache.audio.has(key)) {
        await this.lazyLoad(key);
      }
      if (!this.scene.cache.audio.has(key)) continue;

      await new Promise<void>((resolve) => {
        if (this.currentSound) {
          this.currentSound.stop();
          this.currentSound.destroy();
          this.currentSound = null;
        }
        try {
          this.currentSound = this.scene.sound.add(key, { volume: 1.0 });
          this.currentSound.once('complete', () => {
            this.currentSound?.destroy();
            this.currentSound = null;
            setTimeout(resolve, gapMs);
          });
          this.currentSound.play();
        } catch {
          resolve();
        }
      });
    }
    this.unduckMusic();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.stop();
    this.textMap.clear();
    this.loading.clear();
  }

  private playKey(key: string, textLength: number): void {
    const shouldDuck = textLength >= DUCK_THRESHOLD;
    if (shouldDuck) this.duckMusic();

    try {
      this.currentSound = this.scene.sound.add(key, { volume: 1.0 });
      this.currentSound.once('complete', () => {
        this.currentSound?.destroy();
        this.currentSound = null;
        if (shouldDuck) this.unduckMusic();
      });
      this.currentSound.play();
    } catch {
      this.currentSound = null;
      if (shouldDuck) this.unduckMusic();
    }
  }

  private lazyLoad(key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.scene.cache.audio.has(key)) { resolve(); return; }
      this.scene.load.audio(key, voicePath(key));
      this.scene.load.once('complete', () => resolve());
      this.scene.load.start();
    });
  }

  private duckMusic(): void {
    if (this.ducked) return;
    this.ducked = true;
    this.getMusicManager()?.duck();
  }

  private unduckMusic(): void {
    if (!this.ducked) return;
    this.ducked = false;
    this.getMusicManager()?.unduck();
  }

  private getMusicManager(): MusicManager | null {
    return this.scene.registry.get('musicManager') as MusicManager | null;
  }

  private normalise(text: string): string {
    return text.slice(0, 100).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
}

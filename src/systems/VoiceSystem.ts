import type { MusicManager } from '@/systems/MusicManager';

/** Only duck music for lines longer than this (short quips play over the music). */
const DUCK_THRESHOLD = 60;

/**
 * VoiceSystem — plays character voice clips alongside dialogue text.
 *
 * Maps dialogue text (or explicit voice keys) to preloaded audio files.
 * Voice plays in parallel with the typewriter effect and stops when
 * the player dismisses the dialogue.
 *
 * Automatically ducks background music while voice is playing.
 */
export class VoiceSystem {
  private scene: Phaser.Scene;
  private currentSound: Phaser.Sound.BaseSound | null = null;
  private enabled = true;
  private ducked = false;

  /** Text→voiceKey lookup. Key = normalised first 60 chars of dialogue text. */
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
   * Play voice for a dialogue line. Returns immediately (fire-and-forget).
   * Only ducks music for lines longer than DUCK_THRESHOLD characters
   * — short quips aren't worth the fade in/out.
   */
  play(text: string, explicitKey?: string): void {
    if (!this.enabled) return;
    this.stop(); // stop any currently playing voice

    const norm = this.normalise(text);
    const key = explicitKey ?? this.textMap.get(norm);
    if (!key) {
      if (import.meta.env.DEV) console.warn(`[Voice] No match for: "${norm}"`);
      return;
    }

    // Check the audio cache — if not loaded, skip silently
    if (!this.scene.cache.audio.has(key)) {
      if (import.meta.env.DEV) console.warn(`[Voice] Audio not loaded: "${key}"`);
      return;
    }

    const shouldDuck = text.length >= DUCK_THRESHOLD;
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
      // Audio not available — degrade gracefully
      this.currentSound = null;
      if (shouldDuck) this.unduckMusic();
    }
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
      if (!this.scene.cache.audio.has(key)) continue;
      await new Promise<void>((resolve) => {
        // Stop previous sound but don't unduck — we're in a sequence
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

import Phaser from 'phaser';
import type { MusicVariation } from '@/types/scene.types';

interface ManagedTrack {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  buffer: AudioBuffer;
  key: string;
}

interface SceneAudioConfig {
  music: string | null;
  variation?: MusicVariation;
  crossfadeDuration?: number;
}

const DEFAULT_CROSSFADE = 2000;
const DEFAULT_VOLUME = 0.4;
const BYPASS_FREQUENCY = 20000;

export class MusicManager {
  private game: Phaser.Game;
  private context: AudioContext;
  private masterGain: GainNode;
  private currentTrack: ManagedTrack | null = null;
  private fadingTrack: ManagedTrack | null = null;
  private currentKey: string | null = null;
  private musicVolume = DEFAULT_VOLUME;
  private muted = false;

  constructor(game: Phaser.Game) {
    this.game = game;
    const sm = game.sound as Phaser.Sound.WebAudioSoundManager;
    this.context = sm.context;

    // Master gain → destination
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.masterGain.gain.value = this.musicVolume;

    // Restore mute state
    this.muted = localStorage.getItem('adrian_adventure_muted') === 'true';
    if (this.muted) {
      this.masterGain.gain.value = 0;
      game.sound.mute = true;
    }
  }

  /** Main entry point — called on every scene transition */
  transitionToScene(audio: SceneAudioConfig): void {
    // Ensure context is running (autoplay policy)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    const duration = (audio.crossfadeDuration ?? DEFAULT_CROSSFADE) / 1000;
    const newKey = audio.music;
    const variation = audio.variation;

    if (newKey === null) {
      this.fadeToSilence(duration);
      return;
    }

    if (newKey === this.currentKey && this.currentTrack) {
      this.applyVariation(this.currentTrack, variation, duration);
      return;
    }

    // Different track — crossfade
    const buffer = this.getDecodedBuffer(newKey);
    if (!buffer) {
      console.warn(`[MusicManager] buffer for "${newKey}" not found`);
      this.fadeToSilence(duration);
      return;
    }

    const newTrack = this.createTrack(newKey, buffer, variation);
    this.crossfadeTo(newTrack, variation, duration);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('adrian_adventure_muted', String(this.muted));

    const now = this.context.currentTime;
    if (this.muted) {
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0, now + 0.1);
      this.game.sound.mute = true;
    } else {
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.linearRampToValueAtTime(this.musicVolume, now + 0.1);
      this.game.sound.mute = false;
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = vol;
    if (!this.muted) {
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.context.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(vol, this.context.currentTime + 0.05);
    }
  }

  destroy(): void {
    this.stopTrack(this.currentTrack);
    this.stopTrack(this.fadingTrack);
    this.currentTrack = null;
    this.fadingTrack = null;
    this.currentKey = null;
    this.masterGain.disconnect();
  }

  // ─── Private ──────────────────────────────

  private createTrack(key: string, buffer: AudioBuffer, variation?: MusicVariation): ManagedTrack {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = this.context.createGain();
    gainNode.gain.value = 0; // Start silent for crossfade

    const filterNode = this.context.createBiquadFilter();
    this.configureFilter(filterNode, variation);

    // Chain: source → gain → filter → master
    source.connect(gainNode);
    gainNode.connect(filterNode);
    filterNode.connect(this.masterGain);

    source.start(0);

    return { source, gainNode, filterNode, buffer, key };
  }

  private crossfadeTo(newTrack: ManagedTrack, variation: MusicVariation | undefined, duration: number): void {
    const now = this.context.currentTime;

    // Stop any previously fading track
    this.stopTrack(this.fadingTrack);

    // Fade out current
    if (this.currentTrack) {
      const old = this.currentTrack;
      old.gainNode.gain.setValueAtTime(old.gainNode.gain.value, now);
      old.gainNode.gain.linearRampToValueAtTime(0, now + duration);
      this.fadingTrack = old;

      // Clean up after fade
      setTimeout(() => {
        if (this.fadingTrack === old) {
          this.stopTrack(old);
          this.fadingTrack = null;
        }
      }, duration * 1000 + 100);
    }

    // Fade in new track to its variation volume
    const targetVol = variation?.volume ?? 1.0;
    newTrack.gainNode.gain.setValueAtTime(0, now);
    newTrack.gainNode.gain.linearRampToValueAtTime(targetVol, now + duration);

    this.currentTrack = newTrack;
    this.currentKey = newTrack.key;
  }

  private applyVariation(track: ManagedTrack, variation: MusicVariation | undefined, duration: number): void {
    const now = this.context.currentTime;

    // Ramp filter
    const freq = variation?.filterFrequency ?? BYPASS_FREQUENCY;
    const q = variation?.filterQ ?? 1.0;
    const filterType = variation?.filterType ?? 'lowpass';

    track.filterNode.type = filterType;
    track.filterNode.frequency.setValueAtTime(track.filterNode.frequency.value, now);
    // exponentialRamp needs value > 0
    track.filterNode.frequency.exponentialRampToValueAtTime(Math.max(freq, 20), now + duration);
    track.filterNode.Q.setValueAtTime(track.filterNode.Q.value, now);
    track.filterNode.Q.linearRampToValueAtTime(q, now + duration);

    // Ramp volume (variation volume is a multiplier on the track gain)
    const vol = variation?.volume ?? 1.0;
    track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
    track.gainNode.gain.linearRampToValueAtTime(vol, now + duration);
  }

  private fadeToSilence(duration: number): void {
    if (!this.currentTrack) return;
    const now = this.context.currentTime;
    const track = this.currentTrack;

    track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
    track.gainNode.gain.linearRampToValueAtTime(0, now + duration);

    // Move to fading slot so crossfadeTo can clean it if needed
    this.stopTrack(this.fadingTrack);
    this.fadingTrack = track;
    this.currentTrack = null;
    this.currentKey = null;

    // Clean up after fade completes
    setTimeout(() => {
      if (this.fadingTrack === track) {
        this.stopTrack(track);
        this.fadingTrack = null;
      }
    }, duration * 1000 + 100);
  }

  private stopTrack(track: ManagedTrack | null): void {
    if (!track) return;
    try {
      track.source.stop();
    } catch {
      // Already stopped
    }
    track.source.disconnect();
    track.gainNode.disconnect();
    track.filterNode.disconnect();
  }

  private configureFilter(filter: BiquadFilterNode, variation?: MusicVariation): void {
    filter.type = variation?.filterType ?? 'lowpass';
    filter.frequency.value = variation?.filterFrequency ?? BYPASS_FREQUENCY;
    filter.Q.value = variation?.filterQ ?? 1.0;
  }

  private getDecodedBuffer(key: string): AudioBuffer | null {
    // Phaser 3.80 WebAudio: cache.audio stores decoded AudioBuffers
    const cached = this.game.cache.audio.get(key);
    if (cached instanceof AudioBuffer) return cached;

    // Fallback: Phaser WebAudioSound exposes audioBuffer as a getter from cache
    try {
      const tempSound = this.game.sound.add(key) as Phaser.Sound.WebAudioSound;
      const buffer = (tempSound as any).audioBuffer;
      tempSound.destroy();
      if (buffer instanceof AudioBuffer) return buffer;
    } catch {
      // silent
    }

    return null;
  }
}

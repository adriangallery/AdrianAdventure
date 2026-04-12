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

const DEFAULT_CROSSFADE = 4000;
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

    // Restore mute state — default to muted (OFF) on first visit so user must
    // explicitly tap the Sound toggle, which provides the native gesture needed
    // to unlock AudioContext on mobile browsers.
    const stored = localStorage.getItem('adrian_adventure_muted');
    this.muted = stored === null ? true : stored === 'true';
    if (this.muted) {
      this.masterGain.gain.value = 0;
      game.sound.mute = true;
    }

    this.debugLog(`constructor | ctx.state=${this.context.state} | muted=${this.muted} | stored="${stored}" | sound.locked=${game.sound.locked}`);
  }

  /**
   * Unlock AudioContext from a native DOM gesture (touchend / click).
   *
   * iOS Safari requirements (from Apple docs + community research):
   *  - Must be called from touchend (NOT touchstart — iOS 9+) or click
   *  - Do NOT call e.preventDefault() — it voids the gesture
   *  - Must resume() AND play a silent buffer to fully prime the pipeline
   *  - context.resume() alone is not enough on all iOS versions
   */
  unlockFromGesture(): void {
    this.debugLog(`unlockFromGesture called | ctx.state=${this.context.state} | sound.locked=${this.game.sound.locked}`);

    // Always attempt — don't gate on state, some iOS versions report
    // incorrect state until audio actually flows.
    this.context.resume().then(() => {
      this.debugLog(`resume() resolved | ctx.state=${this.context.state}`);
    }).catch((e) => {
      this.debugLog(`resume() REJECTED: ${e}`);
    });

    // Play a tiny silent buffer — "warm up" the audio pipeline.
    // iOS requires a buffer source to start() within the user gesture
    // call-stack before it considers Web Audio unlocked.
    try {
      const buf = this.context.createBuffer(1, 1, 22050);
      const src = this.context.createBufferSource();
      src.buffer = buf;
      src.connect(this.context.destination);
      src.start(0);
      this.debugLog('silent buffer played OK');
    } catch (e) {
      this.debugLog(`silent buffer FAILED: ${e}`);
    }

    // Also unlock Phaser's sound system (it may be locked independently).
    // Phaser's WebAudioSoundManager shares our context but tracks its own
    // locked state — calling a no-op decode nudges it to re-check.
    if (this.game.sound.locked) {
      this.debugLog('Phaser sound.locked=true, calling unlock()');
      (this.game.sound as Phaser.Sound.WebAudioSoundManager).unlock();
    }
  }

  /** Main entry point — called on every scene transition */
  transitionToScene(audio: SceneAudioConfig): void {
    this.debugLog(`transitionToScene("${audio.music}") | ctx.state=${this.context.state} | locked=${this.game.sound.locked} | muted=${this.muted}`);

    // If Phaser's sound system is still locked (no user gesture yet),
    // defer playback until the UNLOCKED event fires.
    if (this.game.sound.locked) {
      this.debugLog('sound.locked — deferring to UNLOCKED event');
      this.game.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.debugLog('UNLOCKED event fired — retrying transitionToScene');
        this.transitionToScene(audio);
      });
      return;
    }

    // Ensure context is running
    if (this.context.state === 'suspended') {
      this.debugLog('context suspended — calling resume()');
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

  /** Duck music volume for voice playback (fade to ~10% over 0.5s) */
  duck(): void {
    if (this.muted) return;
    const now = this.context.currentTime;
    const current = Math.max(this.masterGain.gain.value, 0.001);
    this.masterGain.gain.setValueAtTime(current, now);
    this.masterGain.gain.exponentialRampToValueAtTime(this.musicVolume * 0.1, now + 0.5);
  }

  /** Restore music volume after voice finishes (fade back over 1.2s) */
  unduck(): void {
    if (this.muted) return;
    const now = this.context.currentTime;
    const current = Math.max(this.masterGain.gain.value, 0.001);
    this.masterGain.gain.setValueAtTime(current, now);
    this.masterGain.gain.exponentialRampToValueAtTime(this.musicVolume, now + 1.2);
  }

  destroy(): void {
    this.stopTrack(this.currentTrack);
    this.stopTrack(this.fadingTrack);
    this.currentTrack = null;
    this.fadingTrack = null;
    this.currentKey = null;
    this.masterGain.disconnect();
  }

  // ─── Debug (TEMPORARY — remove after fixing mobile audio) ────

  private debugLog(msg: string): void {
    console.log(`[MusicManager] ${msg}`);
    let el = document.getElementById('audio-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'audio-debug';
      el.style.cssText = `
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
        background: rgba(0,0,0,0.85); color: #0f0; font: 10px monospace;
        padding: 6px; max-height: 35vh; overflow-y: auto;
        pointer-events: none;
      `;
      document.body.appendChild(el);
    }
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
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

    // Fade out current — exponential curve for natural decay
    if (this.currentTrack) {
      const old = this.currentTrack;
      const oldVol = Math.max(old.gainNode.gain.value, 0.001);
      old.gainNode.gain.setValueAtTime(oldVol, now);
      // Slow fade out: start losing volume gradually, then accelerate at the end
      old.gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration * 1.2);
      this.fadingTrack = old;

      // Clean up after fade (extra 20% time for the longer fade-out)
      setTimeout(() => {
        if (this.fadingTrack === old) {
          this.stopTrack(old);
          this.fadingTrack = null;
        }
      }, duration * 1200 + 200);
    }

    // Fade in new track — exponential curve, slightly delayed start for overlap blend
    const targetVol = variation?.volume ?? 1.0;
    const safeTarget = Math.max(targetVol, 0.001);
    newTrack.gainNode.gain.setValueAtTime(0.001, now);
    newTrack.gainNode.gain.exponentialRampToValueAtTime(safeTarget, now + duration);

    this.currentTrack = newTrack;
    this.currentKey = newTrack.key;
  }

  private applyVariation(track: ManagedTrack, variation: MusicVariation | undefined, duration: number): void {
    const now = this.context.currentTime;
    // Use longer duration for same-track variations (room-to-room with same music)
    const rampTime = duration * 1.5;

    // Ramp filter
    const freq = variation?.filterFrequency ?? BYPASS_FREQUENCY;
    const q = variation?.filterQ ?? 1.0;
    const filterType = variation?.filterType ?? 'lowpass';

    track.filterNode.type = filterType;
    track.filterNode.frequency.setValueAtTime(track.filterNode.frequency.value, now);
    // exponentialRamp needs value > 0
    track.filterNode.frequency.exponentialRampToValueAtTime(Math.max(freq, 20), now + rampTime);
    track.filterNode.Q.setValueAtTime(track.filterNode.Q.value, now);
    track.filterNode.Q.linearRampToValueAtTime(q, now + rampTime);

    // Ramp volume — exponential for natural feel
    const vol = variation?.volume ?? 1.0;
    const currentVol = Math.max(track.gainNode.gain.value, 0.001);
    const safeVol = Math.max(vol, 0.001);
    track.gainNode.gain.setValueAtTime(currentVol, now);
    track.gainNode.gain.exponentialRampToValueAtTime(safeVol, now + rampTime);
  }

  private fadeToSilence(duration: number): void {
    if (!this.currentTrack) return;
    const now = this.context.currentTime;
    const track = this.currentTrack;

    const currentVol = Math.max(track.gainNode.gain.value, 0.001);
    track.gainNode.gain.setValueAtTime(currentVol, now);
    track.gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

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

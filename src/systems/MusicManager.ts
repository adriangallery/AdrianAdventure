import Phaser from 'phaser';
import { getMusicLevel, musicVolumeFor } from '@/systems/Settings';
import { MUTED_STORAGE_KEY, mutedFromStored, shouldFetchAudio } from '@/systems/AudioPolicy';
import { DUCK_FADE_MS, duckGainFor } from '@/systems/Cinematics';
import {
  AMBIENCE_CROSSFADE_MS, ambienceCacheKey, ambienceLoopPoints, ambienceTransition, ambienceUrl, resolveAmbience,
  type AmbienceAudioConfig, type AmbienceRequest,
} from '@/systems/Ambience';
import { AMBIENCE_LOOPS, AMBIENCE_PAD_SEC } from '@/config/ambience.config';
import { MUSIC_KEYS, type MusicKey } from '@/config/music.config';

// Inyectado por vite.config.ts (define); mismo patrón que PreloadScene.
declare const __BUILD_HASH__: string;
import type { MusicVariation } from '@/types/scene.types';

interface ManagedTrack {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  buffer: AudioBuffer;
  key: string;
}

/** A4.4: bucle de ambiente sonando (source en bucle con loopStart/loopEnd → gain → ambienceGain) */
interface AmbienceTrack {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  key: string;
  gain: number;
  loop: { start: number; end: number };
}

interface SceneAudioConfig extends AmbienceAudioConfig {
  music: string | null;
  variation?: MusicVariation;
  crossfadeDuration?: number;
}

/** A4.4 (QA): qué suena ahora (música y ambiente), qué se está pidiendo y quién baja la música */
export interface MusicQaState {
  muted: boolean;
  /** A4.5: `fading` = la pista que se va durante el fundido cruzado; `musicKey` = tonalidad de la que suena (music.config.ts) */
  music: { key: string | null; pending: string | null; gain: number | null; fading: { key: string; gain: number } | null; musicKey: MusicKey | null };
  ambience: { key: string | null; requested: string | null; pending: string | null; gain: number | null; loop: { start: number; end: number } | null };
  duck: string[];
  duckGain: number;
}

const DEFAULT_CROSSFADE = 4000;
const DEFAULT_VOLUME = 0.25;
const BYPASS_FREQUENCY = 20000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class MusicManager {
  private game: Phaser.Game;
  private context: AudioContext;
  private masterGain: GainNode;
  /**
   * A2.10: ducking aparte del volumen (masterGain → duckGain → salida): bajo la voz y en cinemática la música baja a
   * DUCK_LEVEL con un fundido de DUCK_FADE_MS. El silencio y el volumen de los ajustes siguen en masterGain, así que
   * el ducking nunca los pisa (en silencio sigue sin sonar nada).
   */
  private duckGain: GainNode;
  private duckSources = new Set<string>();
  private currentTrack: ManagedTrack | null = null;
  private fadingTrack: ManagedTrack | null = null;
  private currentKey: string | null = null;
  private musicVolume = musicVolumeFor(getMusicLevel(), DEFAULT_VOLUME);
  private muted = false;
  private unlockedThisSession = false;

  constructor(game: Phaser.Game) {
    this.game = game;
    const sm = game.sound as Phaser.Sound.WebAudioSoundManager;
    this.context = sm.context;

    // Master gain → duck gain (A2.10) → destination
    this.duckGain = this.context.createGain();
    this.duckGain.connect(this.context.destination);
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.duckGain);
    this.masterGain.gain.value = this.musicVolume;
    // A4.4: el ambiente cuelga del mismo volumen (ajustes y silencio) y del mismo ducking que la música
    this.ambienceGain = this.context.createGain();
    this.ambienceGain.connect(this.masterGain);

    // Restore mute state — default to muted (OFF) on first visit so user must
    // explicitly tap the Sound toggle, which provides the native gesture needed
    // to unlock AudioContext on mobile browsers.
    let stored: string | null = null;
    try { stored = localStorage.getItem(MUTED_STORAGE_KEY); } catch { /* sin almacenamiento: silencio */ }
    this.muted = mutedFromStored(stored);
    if (this.muted) {
      this.masterGain.gain.value = 0;
      game.sound.mute = true;
    }
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
    this.unlockedThisSession = true;

    // Always attempt — don't gate on state, some iOS versions report
    // incorrect state until audio actually flows.
    this.context.resume();

    // Play a tiny silent buffer — "warm up" the audio pipeline.
    // iOS requires a buffer source to start() within the user gesture
    // call-stack before it considers Web Audio unlocked.
    try {
      const buf = this.context.createBuffer(1, 1, 22050);
      const src = this.context.createBufferSource();
      src.buffer = buf;
      src.connect(this.context.destination);
      src.start(0);
    } catch { /* silent */ }

    // Also unlock Phaser's sound system (it may be locked independently).
    if (this.game.sound.locked) {
      (this.game.sound as Phaser.Sound.WebAudioSoundManager).unlock();
    }
  }

  /**
   * A1.5: audio de la última escena pedida. En silencio no se descarga su pista; al activar el sonido
   * (toggleMute) se vuelve a pedir la transición con esta configuración.
   */
  private lastAudio: SceneAudioConfig | null = null;

  /** Pista pedida que aún se está descargando (la última escena manda). */
  private pendingKey: string | null = null;
  private readonly loadingTracks = new Set<string>();

  // A4.4: ambiente
  private ambienceGain: GainNode;
  private currentAmbience: AmbienceTrack | null = null;
  private fadingAmbience: AmbienceTrack | null = null;
  private pendingAmbience: string | null = null;
  /** Último ambiente pedido por la escena (aunque no haya sonado: silencio, descargando) */
  private requestedAmbience: string | null = null;

  /** Descarga una pista con el loader de la escena activa; `onReady` cuando está decodificada. */
  private loadTrack(key: string, onReady: () => void): void {
    const v = typeof __BUILD_HASH__ !== 'undefined' ? `?v=${__BUILD_HASH__}` : '';
    this.loadAudio(key, `assets/audio/music/${key}.mp3${v}`, onReady);
  }

  /** Descarga un fichero de audio (música o ambiente) con el loader de la escena activa, con una sola petición por clave. */
  private loadAudio(key: string, url: string, onReady: () => void, attempt = 0): void {
    if (this.loadingTracks.has(key)) return;
    // A4.4: al pedirlo desde GameScene.create la escena aún no cuenta como activa (está en CREATING): vale cualquier
    // escena con loader que esté arrancando o en marcha (su loader procesa la cola en su siguiente update); si no hay
    // ninguna (cambio de escena a medias), se reintenta un poco después
    const running = (sc: Phaser.Scene) => sc.sys.settings.status >= Phaser.Scenes.INIT && sc.sys.settings.status <= Phaser.Scenes.RUNNING;
    const scene = this.game.scene.getScenes(true).find((sc) => !!sc.load) ?? this.game.scene.getScenes(false).find((sc) => !!sc.load && running(sc));
    if (!scene) {
      if (attempt < 10) {
        setTimeout(() => this.loadAudio(key, url, onReady, attempt + 1), 200);
        return;
      }
      console.warn(`[MusicManager] no active scene to load "${key}"`);
      return;
    }
    this.loadingTracks.add(key);
    scene.load.audio(key, url);
    scene.load.once(`filecomplete-audio-${key}`, () => {
      this.loadingTracks.delete(key);
      onReady();
    });
    scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key !== key) return;
      this.loadingTracks.delete(key);
      console.warn(`[MusicManager] failed to load "${key}"`);
    });
    scene.load.start();
  }

  /** Main entry point — called on every scene transition */
  transitionToScene(audio: SceneAudioConfig): void {
    this.lastAudio = audio;
    this.requestedAmbience = audio.ambience ?? null;

    // If Phaser's sound system is still locked (no user gesture yet),
    // defer playback until the UNLOCKED event fires.
    if (this.game.sound.locked) {
      this.game.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.transitionToScene(audio);
      });
      return;
    }

    // Re-sync Phaser mute with our state — Phaser's auto-unlock (triggered
    // by any user gesture) can reset game.sound.mute to false.
    this.game.sound.mute = this.muted;

    // Ensure context is running
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    this.transitionMusic(audio);
    this.transitionAmbience(resolveAmbience(audio, AMBIENCE_LOOPS));
  }

  /**
   * A4.4: el ambiente de la escena: sigue si es el mismo (solo ajusta el volumen), funde a otro o se apaga. Como la
   * música (A1.5), en silencio no se descarga nada; al activar el sonido `toggleMute` vuelve a pedir la escena.
   */
  private transitionAmbience(next: AmbienceRequest | null): void {
    const current = this.currentAmbience;
    const fade = AMBIENCE_CROSSFADE_MS / 1000;
    switch (ambienceTransition(current?.key ?? null, next)) {
      case 'none':
        this.pendingAmbience = null;
        return;
      case 'silence':
        this.pendingAmbience = null;
        this.fadeAmbienceOut(fade);
        return;
      case 'keep': {
        this.pendingAmbience = null;
        if (!current || !next) return;
        current.gain = next.gain;
        this.rampGain(current.gainNode.gain, next.gain, fade);
        return;
      }
      case 'crossfade':
        break;
    }
    if (!next) return;
    const cacheKey = ambienceCacheKey(next.key);
    const buffer = this.getDecodedBuffer(cacheKey);
    if (!buffer) {
      if (!shouldFetchAudio(this.muted)) {
        this.pendingAmbience = null;
        this.fadeAmbienceOut(0.1);
        return;
      }
      this.pendingAmbience = next.key;
      const v = typeof __BUILD_HASH__ !== 'undefined' ? `?v=${__BUILD_HASH__}` : '';
      this.loadAudio(cacheKey, ambienceUrl(next.key, v), () => {
        if (this.pendingAmbience === next.key) this.transitionAmbience(next);
      });
      return;
    }
    this.pendingAmbience = null;
    const loop = ambienceLoopPoints(next.loopSec, buffer.duration, AMBIENCE_PAD_SEC);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = loop.start;
    source.loopEnd = loop.end;
    const gainNode = this.context.createGain();
    gainNode.gain.value = 0.001;
    source.connect(gainNode);
    gainNode.connect(this.ambienceGain);
    source.start(0, loop.start);
    this.stopAmbience(this.fadingAmbience);
    this.fadingAmbience = null;
    if (current) {
      this.rampGain(current.gainNode.gain, 0.001, fade);
      this.fadingAmbience = current;
      setTimeout(() => {
        if (this.fadingAmbience === current) {
          this.stopAmbience(current);
          this.fadingAmbience = null;
        }
      }, AMBIENCE_CROSSFADE_MS + 200);
    }
    this.currentAmbience = { source, gainNode, key: next.key, gain: next.gain, loop };
    this.rampGain(gainNode.gain, next.gain, current ? fade : 0.6);
  }

  private fadeAmbienceOut(fade: number): void {
    const track = this.currentAmbience;
    if (!track) return;
    this.rampGain(track.gainNode.gain, 0.001, fade);
    this.stopAmbience(this.fadingAmbience);
    this.fadingAmbience = track;
    this.currentAmbience = null;
    setTimeout(() => {
      if (this.fadingAmbience === track) {
        this.stopAmbience(track);
        this.fadingAmbience = null;
      }
    }, fade * 1000 + 100);
  }

  private stopAmbience(track: AmbienceTrack | null): void {
    if (!track) return;
    try { track.source.stop(); } catch { /* ya parado */ }
    track.source.disconnect();
    track.gainNode.disconnect();
  }

  /** Rampa exponencial (nunca a 0: el mínimo es 0.001) con un punto de partida fijado; sin automatización si falla */
  private rampGain(param: AudioParam, target: number, secs: number): void {
    const safe = Math.max(target, 0.001);
    try {
      const now = this.context.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(param.value, 0.001), now);
      param.exponentialRampToValueAtTime(safe, now + Math.max(0.01, secs));
    } catch {
      param.value = safe;
    }
  }

  /** A4.5: tonalidad estimada de la pista que suena (null sin música o sin estimación) */
  currentMusicKey(): MusicKey | null {
    return this.currentKey ? (MUSIC_KEYS[this.currentKey] ?? null) : null;
  }

  /** A4.4 (QA): música y ambiente que suenan, lo que se está pidiendo y el ducking */
  qaState(): MusicQaState {
    const amb = this.currentAmbience;
    return {
      muted: this.muted,
      music: {
        key: this.currentKey,
        pending: this.pendingKey,
        gain: this.currentTrack ? round3(this.currentTrack.gainNode.gain.value) : null,
        fading: this.fadingTrack ? { key: this.fadingTrack.key, gain: round3(this.fadingTrack.gainNode.gain.value) } : null,
        musicKey: this.currentMusicKey(),
      },
      ambience: {
        key: amb?.key ?? null,
        requested: this.requestedAmbience,
        pending: this.pendingAmbience,
        gain: amb ? round3(amb.gainNode.gain.value) : null,
        loop: amb ? { start: round3(amb.loop.start), end: round3(amb.loop.end) } : null,
      },
      duck: [...this.duckSources],
      duckGain: round3(this.duckGain.gain.value),
    };
  }

  private transitionMusic(audio: SceneAudioConfig): void {
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
      // A1.5: en silencio no se descarga nada. La pista anterior (sonando a volumen 0) se apaga para que,
      // al activar el sonido, no se oiga la de otra escena mientras llega la buena.
      if (!shouldFetchAudio(this.muted)) {
        this.pendingKey = null;
        this.fadeToSilence(0.1);
        return;
      }
      // V5: la pista aún no está descargada (solo se precarga la de la escena inicial).
      // Se pide ahora y, si seguimos en esa escena cuando llegue, se reintenta la transición.
      this.pendingKey = newKey;
      this.loadTrack(newKey, () => {
        if (this.pendingKey === newKey) this.transitionToScene(audio);
      });
      return;
    }
    this.pendingKey = null;

    const newTrack = this.createTrack(newKey, buffer, variation);
    this.crossfadeTo(newTrack, variation, duration);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTED_STORAGE_KEY, String(this.muted)); } catch { /* el ajuste dura la sesión */ }

    // Use direct value assignment instead of linearRamp — iOS Safari
    // often fails to execute Web Audio automation ramps when the
    // AudioContext has just resumed (currentTime may be inconsistent).
    this.masterGain.gain.cancelScheduledValues(0);
    if (this.muted) {
      this.masterGain.gain.value = 0;
      this.game.sound.mute = true;
    } else {
      this.masterGain.gain.value = this.musicVolume;
      this.game.sound.mute = false;
      // A1.5: la música de la escena actual no se descargó en silencio: se pide ahora y suena al llegar.
      if (this.lastAudio) this.transitionToScene(this.lastAudio);
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Whether unlockFromGesture() has been called in this page load. */
  isUnlockedThisSession(): boolean {
    return this.unlockedThisSession;
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = vol;
    if (!this.muted) {
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.context.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(vol, this.context.currentTime + 0.05);
    }
  }

  /** Duck music under a voice clip. A2.10: ~35 % with a 200 ms fade (same as during a cinematic) */
  duck(): void {
    this.setDuck('voice', true);
  }

  /** Restore music after the voice clip (200 ms fade), unless a cinematic still ducks it */
  unduck(): void {
    this.setDuck('voice', false);
  }

  /**
   * A2.10: ducking por fuentes (`voice`, `cinematic`): mientras alguna lo pida, la música a DUCK_LEVEL; al soltarlo la
   * última, vuelve. Rampa lineal de DUCK_FADE_MS sobre duckGain (independiente del silencio y del volumen).
   */
  setDuck(source: string, on: boolean): void {
    const before = duckGainFor(this.duckSources);
    if (on) this.duckSources.add(source);
    else this.duckSources.delete(source);
    const target = duckGainFor(this.duckSources);
    if (target === before) return;
    try {
      const now = this.context.currentTime;
      const g = this.duckGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + DUCK_FADE_MS / 1000);
    } catch {
      this.duckGain.gain.value = target;
    }
  }

  /** A2.10 (QA): fuentes que bajan la música ahora mismo */
  getDuckSources(): string[] {
    return [...this.duckSources];
  }

  destroy(): void {
    this.stopTrack(this.currentTrack);
    this.stopTrack(this.fadingTrack);
    this.stopAmbience(this.currentAmbience);
    this.stopAmbience(this.fadingAmbience);
    this.currentAmbience = null;
    this.fadingAmbience = null;
    this.currentTrack = null;
    this.fadingTrack = null;
    this.currentKey = null;
    this.ambienceGain.disconnect();
    this.masterGain.disconnect();
    this.duckGain.disconnect();
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
    const targetVol = variation?.volume ?? 1.0;
    const safeTarget = Math.max(targetVol, 0.001);

    // Stop any previously fading track
    this.stopTrack(this.fadingTrack);

    if (this.currentTrack) {
      // ── Crossfade: fade out old, fade in new (ramps are fine here,
      //    context has been running long enough for stable automation) ──
      const old = this.currentTrack;
      const oldVol = Math.max(old.gainNode.gain.value, 0.001);
      old.gainNode.gain.setValueAtTime(oldVol, now);
      old.gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration * 1.2);
      this.fadingTrack = old;

      setTimeout(() => {
        if (this.fadingTrack === old) {
          this.stopTrack(old);
          this.fadingTrack = null;
        }
      }, duration * 1200 + 200);

      newTrack.gainNode.gain.setValueAtTime(0.001, now);
      newTrack.gainNode.gain.exponentialRampToValueAtTime(safeTarget, now + duration);
    } else {
      // ── First play: set gain directly — iOS Safari often fails to
      //    execute Web Audio automation ramps shortly after resume() ──
      newTrack.gainNode.gain.cancelScheduledValues(0);
      newTrack.gainNode.gain.value = safeTarget;
    }

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
      const buffer = (tempSound as unknown as { audioBuffer?: AudioBuffer }).audioBuffer;
      tempSound.destroy();
      if (buffer instanceof AudioBuffer) return buffer;
    } catch {
      // silent
    }

    return null;
  }
}

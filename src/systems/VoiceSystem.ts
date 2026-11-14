import Phaser from 'phaser';
import type { MusicManager } from '@/systems/MusicManager';
import { voicePath } from '@/config/voice.config';
import { shouldFetchAudio } from '@/systems/AudioPolicy';
import { getVoiceLevel, voiceGainFor } from '@/systems/Settings';
import { voiceClipVolume } from '@/systems/AudioMix';

/**
 * A4.5: la música (y el ambiente, A4.4) bajan con cualquier clip de voz, por corto que sea (antes solo con frases de 60
 * caracteres o más: los remates cortos se perdían bajo la música). El fundido es de DUCK_FADE_MS (200 ms).
 */
const DUCK_THRESHOLD = 0;

/**
 * VoiceSystem — plays character voice clips alongside dialogue text.
 *
 * Uses lazy loading: audio files are fetched on-demand the first time
 * a line is spoken, then cached by Phaser for subsequent plays.
 *
 * Automatically ducks background music while voice is playing.
 *
 * A1.5: con el sonido apagado no se pide ni se reproduce ningún clip (ni al hablar ni en secuencias); al
 * activarlo, la siguiente frase ya se descarga bajo demanda.
 */
export class VoiceSystem {
  private scene: Phaser.Scene;
  private currentSound: Phaser.Sound.BaseSound | null = null;
  private enabled = true;
  private ducked = false;
  private loading = new Set<string>();
  /** Incremented on stop() to cancel any running playSequence loop. */
  private sequenceGen = 0;

  /**
   * A2.10: clip de la última frase pedida con `play` (subtítulos sincronizados en cinemática): duración en ms cuando
   * ya está cargado, y si se está descargando o sonando.
   */
  private clip: { key: string | null; durationMs: number | null; loading: boolean } = { key: null, durationMs: null, loading: false };
  /** A4.2: texto de la última frase pedida con `play` (la boca de la NPC solo sigue al clip si es el de su frase) */
  private clipText: string | null = null;
  /**
   * A4.2: analizador de nivel sobre el clip que suena (Web Audio), para abrir la boca de la NPC solo con señal. null si
   * el juego va con audio HTML5 o sin contexto; `levelBuf` se reutiliza (sin basura por frame).
   */
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private analysed: Phaser.Sound.BaseSound | null = null;

  /** A4.8: volumen del último clip (QA): VOICE_BOOST × nivel de voces / SFX_GAIN; nunca depende de la música */
  private lastClipVolume: number | null = null;

  /** Text→voiceKey lookup. */
  private textMap = new Map<string, string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  register(text: string, voiceKey: string): void {
    this.textMap.set(this.normalise(text), voiceKey);
  }

  registerAll(entries: Array<{ text: string; key: string }>): void {
    for (const e of entries) this.register(e.text, e.key);
  }

  /**
   * Play voice for a dialogue line. Lazy-loads the audio if needed.
   * Only ducks music for lines longer than DUCK_THRESHOLD characters.
   */
  play(text: string, explicitKey?: string): void {
    this.clip = { key: null, durationMs: null, loading: false };
    this.clipText = text;
    if (!this.enabled) return;
    this.stop();
    if (this.soundOff()) return;

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
    this.clip = { key, durationMs: null, loading: true };
    if (this.loading.has(key)) return;
    this.loading.add(key);
    this.scene.load.audio(key, voicePath(key));
    this.scene.load.once('complete', () => {
      this.loading.delete(key);
      if (this.clip.key === key) this.clip.loading = false;
      if (this.scene.cache.audio.has(key)) {
        this.playKey(key, text.length);
      }
    });
    this.scene.load.start();
  }

  /** Stop currently playing voice clip AND cancel any running sequence. */
  stop(): void {
    this.sequenceGen++; // cancel any playSequence loop
    if (this.currentSound) {
      this.currentSound.stop();
      this.currentSound.destroy();
      this.currentSound = null;
    }
    this.unduckMusic();
  }

  /** Play a sequence of voice keys one after another. Cancellable via stop(). */
  async playSequence(keys: string[], gapMs = 300): Promise<void> {
    this.stop(); // cancel any previous sequence
    const gen = this.sequenceGen; // snapshot — if stop() is called, gen changes
    if (this.soundOff()) return;

    this.duckMusic();
    for (const key of keys) {
      if (this.sequenceGen !== gen) return; // cancelled
      if (this.soundOff()) break; // sonido apagado a mitad de secuencia: no se piden más clips

      // Lazy load if needed
      if (!this.scene.cache.audio.has(key)) {
        await this.lazyLoad(key);
      }
      if (this.sequenceGen !== gen) return; // cancelled during load
      if (!this.scene.cache.audio.has(key)) continue;

      await new Promise<void>((resolve) => {
        if (this.sequenceGen !== gen) { resolve(); return; }
        try {
          this.currentSound = this.scene.sound.add(key, { volume: this.clipVolume() });
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
    if (this.sequenceGen === gen) this.unduckMusic();
  }

  /** A4.8: volumen de cada clip de voz según el ajuste «Voices» (High = ganancia 1,0 × VOICE_BOOST) */
  private clipVolume(): number {
    this.lastClipVolume = voiceClipVolume(voiceGainFor(getVoiceLevel()));
    return this.lastClipVolume;
  }

  /** A4.8: aplica el ajuste «Voices» al clip que suena (el siguiente ya lo coge solo) */
  applyVoiceLevel(): void {
    const vol = this.clipVolume();
    try { (this.currentSound as unknown as { setVolume?: (v: number) => void } | null)?.setVolume?.(vol); } catch { /* sin clip */ }
  }

  /** A4.8 (QA): volumen del último clip de voz (null si aún no ha sonado ninguno) */
  qaClipVolume(): number | null {
    return this.lastClipVolume;
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
    this.analysed = null;
    try { this.analyser?.disconnect(); } catch { /* ya desconectado */ }
    this.analyser = null;
    this.textMap.clear();
    this.loading.clear();
  }

  /**
   * A2.10: clip de la última frase de `play`: `durationMs` (null si no tiene voz o aún no ha cargado), `loading` (se
   * está descargando) y `playing` (sonando ahora).
   */
  clipInfo(): { durationMs: number | null; loading: boolean; playing: boolean; text: string | null } {
    return {
      durationMs: this.clip.durationMs,
      loading: this.clip.loading,
      playing: !!this.currentSound && this.currentSound.isPlaying,
      text: this.clipText,
    };
  }

  /**
   * A4.2: nivel RMS (0-1) del clip que suena ahora, o null si no se puede medir (nada sonando, audio HTML5, contexto
   * suspendido). El analizador cuelga del nodo de volumen del sonido de Phaser (una rama más: lo que se oye no cambia)
   * y Phaser lo desconecta al destruir el sonido.
   */
  level(): number | null {
    const sound = this.currentSound;
    if (!sound || !sound.isPlaying) return null;
    const an = this.analyserFor(sound);
    if (!an || !this.levelBuf) return null;
    an.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i];
    // A4.8: el analizador va tras el volumen del clip (VOICE_BOOST): se divide para que la boca siga igual que antes
    const vol = this.lastClipVolume && this.lastClipVolume > 0 ? this.lastClipVolume : 1;
    return Math.sqrt(sum / this.levelBuf.length) / vol;
  }

  private analyserFor(sound: Phaser.Sound.BaseSound): AnalyserNode | null {
    try {
      const ctx = (this.scene.sound as unknown as { context?: AudioContext }).context;
      const node = (sound as unknown as { volumeNode?: AudioNode }).volumeNode;
      if (!ctx || !node || ctx.state !== 'running') return null;
      if (!this.analyser) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.levelBuf = new Float32Array(this.analyser.fftSize);
      }
      if (this.analysed !== sound) {
        node.connect(this.analyser);
        this.analysed = sound;
      }
      return this.analyser;
    } catch {
      return null;
    }
  }

  private playKey(key: string, textLength: number): void {
    const shouldDuck = textLength >= DUCK_THRESHOLD;
    if (shouldDuck) this.duckMusic();

    try {
      this.currentSound = this.scene.sound.add(key, { volume: this.clipVolume() });
      const secs = this.currentSound.duration;
      if (this.clip.key === key || this.clip.key === null) {
        this.clip = { key, durationMs: Number.isFinite(secs) && secs > 0 ? secs * 1000 : null, loading: false };
      }
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
      if (this.scene.cache.audio.has(key) || this.soundOff()) { resolve(); return; }
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

  /** Sonido apagado: manda MusicManager (adrian_adventure_muted); sin él, el mute de Phaser. */
  private soundOff(): boolean {
    const music = this.getMusicManager();
    return !shouldFetchAudio(music ? music.isMuted() : this.scene.sound.mute);
  }

  private getMusicManager(): MusicManager | null {
    return this.scene.registry.get('musicManager') as MusicManager | null;
  }

  private normalise(text: string): string {
    return text.slice(0, 100).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
}

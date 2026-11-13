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
import { STINGER_VOLUME } from '@/systems/Stingers';
import {
  DEFAULT_PLANNER, LAYER_GAIN, barAt, barStartSec, chooseBridge, layerNotes, needsSectionJump, nextBeatSec, nextExit,
  placeFor, resolveState, sectionAtBar, sectionFor, trackPosition,
  type BridgePlan, type ExitKind, type MusicContext, type MusicMap, type PlaceArrangement, type PlannerOptions, type StateMusic, type TrackGrid,
} from '@/systems/MusicPlanner';
import musicMapJson from '../../assets/config/music-map.json';

// Inyectado por vite.config.ts (define); mismo patrón que PreloadScene.
declare const __BUILD_HASH__: string;
import type { MusicVariation } from '@/types/scene.types';

interface ManagedTrack {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  buffer: AudioBuffer;
  key: string;
  /** A8.1: rejilla medida (music-map.json); null = pista sin medir (fundido cruzado de siempre) */
  grid: TrackGrid | null;
  /** A8.1: AudioContext.currentTime en el que suena `startOffset` del buffer */
  startCtx: number;
  startOffset: number;
  /** A8.1: volumen de la variación de la escena (el estado lo multiplica) */
  baseVol: number;
}

// ─── A8.1: música adaptativa (iMUSE) ─────────────────────────────
const MUSIC_MAP = musicMapJson as unknown as MusicMap & { planner?: Partial<PlannerOptions> & { solvedBars?: number } };
const PLANNER: PlannerOptions = { ...DEFAULT_PLANNER, ...(MUSIC_MAP.planner ?? {}) };
const SOLVED_BARS = MUSIC_MAP.planner?.solvedBars ?? 4;
/** Cuánto por delante (s) se programan las notas de las capas en el reloj de audio */
const LOOKAHEAD_SEC = 0.35;
const TICK_MS = 50;
const KEEP_TRANSITIONS = 30;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = (k: MusicKey | null | undefined) => (k ? `${NOTE_NAMES[((k.tonic % 12) + 12) % 12]} ${k.mode}` : null);

/** A8.1 (QA): una transición planificada (horas en segundos de AudioContext.currentTime) */
export interface MusicTransitionLog {
  cause: 'scene' | 'state' | 'chapter';
  from: string | null;
  to: string;
  requestedAt: number;
  exitAt: number;
  waitSec: number;
  waitBars: number;
  /** Compás de la pista que se va en el que sale (entero) */
  fromBar: number | null;
  /** Error (en compases) de la salida respecto a la línea de compás: 0 = en compás */
  barError: number;
  exitKind: ExitKind | 'start';
  toSection: string | null;
  toBar: number;
  bridge: BridgePlan['type'];
  bridgeClip: string | null;
  detune: number;
  key: string | null;
  cancelled?: boolean;
}

/** A8.1 (QA): `__qa.music()` */
export interface AdaptiveQaState {
  now: number;
  state: string;
  rule: number;
  transient: string | null;
  place: string | null;
  arrangement: PlaceArrangement | null;
  track: string | null;
  bpm: number | null;
  key: string | null;
  bar: number | null;
  beat: number | null;
  section: string | null;
  nextExit: { bar: number; kind: ExitKind; inSec: number; section: string | null } | null;
  scheduled: { to: string; at: number; inSec: number; bridge: string | null; toSection: string | null } | null;
  layers: Record<string, number>;
  transitions: MusicTransitionLog[];
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
  /** A8.1: por qué cambia (capítulo = fanfarria como puente) */
  cause?: 'scene' | 'chapter';
  variation?: MusicVariation;
  crossfadeDuration?: number;
}

/** A4.4 (QA): qué suena ahora (música y ambiente), qué se está pidiendo y quién baja la música */
export interface MusicQaState {
  muted: boolean;
  /** A4.5: `fading` = la pista que se va durante el fundido cruzado; `musicKey` = tonalidad de la que suena (music.config.ts) */
  music: { key: string | null; pending: string | null; gain: number | null; fading: { key: string; gain: number } | null; musicKey: MusicKey | null };
  /** A8.1: música adaptativa (estado, sección, próxima salida, capas, transiciones) */
  adaptive: AdaptiveQaState;
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
    // A8.1: planificador de estado y capas (las notas van al reloj de audio con margen; el timer solo despierta)
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
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
      adaptive: this.adaptiveQa(),
    };
  }

  private transitionMusic(audio: SceneAudioConfig): void {
    const duration = (audio.crossfadeDuration ?? DEFAULT_CROSSFADE) / 1000;
    const newKey = audio.music;
    const variation = audio.variation;

    if (newKey === null) {
      this.cancelScheduled();
      this.fadeToSilence(duration);
      return;
    }

    // A8.1: ya hay un cambio a esta pista esperando su punto de salida: se deja
    if (this.scheduled && this.scheduled.track.key === newKey) return;
    if (newKey === this.currentKey && this.currentTrack) {
      // vuelta a la pista que suena antes de la salida: se anula el cambio
      this.cancelScheduled();
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

    // A8.1: con las dos pistas medidas, el cambio espera al siguiente punto de salida y entra en compás
    const toGrid = MUSIC_MAP.tracks[newKey] ?? null;
    const cur = this.currentTrack;
    if (toGrid && (!cur || cur.grid)) {
      this.planSwitch(newKey, buffer, variation, audio.cause ?? 'scene', null);
      return;
    }
    this.cancelScheduled();
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
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.cancelScheduled();
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

  // ─── A8.1: música adaptativa (iMUSE) ─────────────────────────────

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Cambio de pista (o de sección) programado en el reloj de audio, esperando su punto de salida */
  private scheduled: { track: ManagedTrack; old: ManagedTrack; at: number; timer: ReturnType<typeof setTimeout>; log: MusicTransitionLog; bridgeSrc: AudioBufferSourceNode | null } | null = null;
  private transitions: MusicTransitionLog[] = [];
  private musicState = 'explore';
  private musicRule = -1;
  private transient: { name: string; until: number } | null = null;
  private place: string | null = null;
  private arrangement: PlaceArrangement | null = null;
  // capas sintetizadas: nota → envolvente → gain de la capa → filtro del lugar → layerBus → masterGain (y eco a compás)
  private layerBus: GainNode | null = null;
  private layerFilter: BiquadFilterNode | null = null;
  private echo: DelayNode | null = null;
  private echoOut: GainNode | null = null;
  private layerGains = new Map<string, GainNode>();
  private layerTargets: Record<string, number> = {};
  private noise: AudioBuffer | null = null;
  private lastScheduledBarAt = -Infinity;
  private layersTrack: ManagedTrack | null = null;

  /** Posición (s) dentro del buffer de una pista en un instante del reloj de audio */
  private posOf(track: ManagedTrack, at = this.context.currentTime): number {
    const el = at - track.startCtx;
    if (!track.grid) return track.startOffset + Math.max(0, el);
    return trackPosition(track.grid, track.startOffset, Math.max(0, el));
  }

  private stateMusic(): StateMusic {
    return MUSIC_MAP.states[this.musicState] ?? { layers: [], section: 'any', gain: 1 };
  }

  /** Lo que el juego sabe ahora para la tabla estados → música */
  private musicContext(): MusicContext {
    const r = this.game.registry;
    const gs = r.get('gameState') as { flags?: Record<string, boolean>; inventory?: Array<{ id: string }> } | undefined;
    const goals = r.get('musicGoalsLeft');
    const now = this.context.currentTime;
    if (this.transient && now >= this.transient.until) this.transient = null;
    return {
      scene: (r.get('currentSceneId') as string | undefined) ?? null,
      dialogue: !!r.get('dialogueActive'),
      flags: gs?.flags ?? {},
      inventory: (gs?.inventory ?? []).map((i) => i.id),
      goalsLeft: typeof goals === 'number' ? goals : null,
      transient: this.transient?.name ?? null,
    };
  }

  /** A8.1: puzle resuelto → estado `solved` unos compases (lo llama StingerPlayer) */
  markSolved(): void {
    const grid = this.currentTrack?.grid;
    const bar = grid?.barSec ?? 2.5;
    this.transient = { name: 'solved', until: this.context.currentTime + SOLVED_BARS * bar };
  }

  /**
   * Cambio planificado: la pista que suena sale en su siguiente punto de salida (en compás, como mucho maxWaitBars) y la
   * nueva entra en ese mismo instante del reloj de audio, al principio de la sección que pide el estado, con un puente en
   * su tonalidad si hace falta. `forceSection` = salto de sección dentro de la misma pista (re-secuenciado por estado).
   */
  private planSwitch(newKey: string, buffer: AudioBuffer, variation: MusicVariation | undefined, cause: 'scene' | 'state' | 'chapter', forceSection: string | null): void {
    const now = this.context.currentTime;
    this.cancelScheduled();
    const toGrid = MUSIC_MAP.tracks[newKey];
    const sm = this.stateMusic();
    const sec = (forceSection ? toGrid.sections.find((s) => s.id === forceSection) : null) ?? sectionFor(toGrid, sm.section) ?? toGrid.sections[0] ?? null;
    const toBar = sec?.startBar ?? 0;
    const offset = barStartSec(toGrid, toBar);
    const old = this.currentTrack;
    const target = Math.max((variation?.volume ?? 1) * sm.gain, 0.001);
    const beatTo = toGrid.barSec / toGrid.beatsPerBar;

    if (!old || !old.grid) {
      // primera pista: entra ya, al principio de la sección
      const track = this.createTrack(newKey, buffer, variation, { when: now + 0.05, offset });
      track.gainNode.gain.cancelScheduledValues(0);
      track.gainNode.gain.value = target;
      this.stopTrack(this.fadingTrack);
      this.fadingTrack = null;
      if (old) this.fadeOutTrack(old, now, 0.5);
      this.currentTrack = track;
      this.currentKey = newKey;
      this.pushTransition({ cause, from: old?.key ?? null, to: newKey, requestedAt: round3(now), exitAt: round3(now + 0.05), waitSec: 0.05, waitBars: 0, fromBar: null, barError: 0, exitKind: 'start', toSection: sec?.id ?? null, toBar, bridge: 'none', bridgeClip: null, detune: 0, key: keyName(toGrid.key) });
      return;
    }

    const fromGrid = old.grid;
    const pos = this.posOf(old, now);
    const exit = nextExit(fromGrid, pos, PLANNER);
    const at = now + exit.waitSec;
    const bridge = newKey === old.key ? chooseBridge(fromGrid.key, toGrid.key, 'state') : chooseBridge(fromGrid.key, toGrid.key, cause);
    const track = this.createTrack(newKey, buffer, variation, { when: at, offset });
    if (newKey === old.key) {
      // salto de sección: mismo filtro de la escena
      track.filterNode.type = old.filterNode.type;
      track.filterNode.frequency.value = old.filterNode.frequency.value;
      track.filterNode.Q.value = old.filterNode.Q.value;
    }
    const g = track.gainNode.gain;
    g.cancelScheduledValues(0);
    g.setValueAtTime(0.0001, now);
    if (bridge.type === 'stinger') {
      // bajo el puente entra flojo y sube en un compás
      g.setValueAtTime(target * 0.3, at);
      g.linearRampToValueAtTime(target, at + toGrid.barSec);
    } else {
      g.setValueAtTime(0.0001, at);
      g.linearRampToValueAtTime(target, at + beatTo * 0.5);
    }
    const beatFrom = fromGrid.barSec / fromGrid.beatsPerBar;
    const og = old.gainNode.gain;
    const oldVol = Math.max(og.value, 0.001);
    og.cancelScheduledValues(now);
    og.setValueAtTime(oldVol, now);
    og.setValueAtTime(oldVol, Math.max(now, at - beatFrom * 0.5));
    og.linearRampToValueAtTime(0.0001, at + beatFrom * 0.25);
    const bridgeSrc = bridge.clip ? this.playBridge(bridge, at) : null;
    const posAtExit = trackPosition(fromGrid, old.startOffset, at - old.startCtx);
    const fb = barAt(fromGrid, posAtExit);
    const log: MusicTransitionLog = {
      cause: newKey === old.key ? 'state' : cause, from: old.key, to: newKey, requestedAt: round3(now), exitAt: round3(at), waitSec: round3(exit.waitSec),
      waitBars: round3(exit.waitSec / fromGrid.barSec), fromBar: exit.bar, barError: round3(Math.abs(fb - Math.round(fb))), exitKind: exit.kind,
      toSection: sec?.id ?? null, toBar, bridge: bridge.type, bridgeClip: bridge.clip, detune: bridge.detune, key: keyName(toGrid.key),
    };
    this.pushTransition(log);
    const timer = setTimeout(() => this.promoteScheduled(), Math.max(0, (at - now) * 1000));
    this.scheduled = { track, old, at, timer, log, bridgeSrc };
  }

  /** La salida ya ha sonado: la pista nueva pasa a ser la actual y la vieja se recoge */
  private promoteScheduled(): void {
    const sc = this.scheduled;
    if (!sc) return;
    clearTimeout(sc.timer);
    this.scheduled = null;
    this.stopTrack(this.fadingTrack);
    this.fadingTrack = null;
    if (sc.old === this.currentTrack) {
      this.fadingTrack = sc.old;
      const old = sc.old;
      setTimeout(() => {
        if (this.fadingTrack === old) {
          this.stopTrack(old);
          this.fadingTrack = null;
        }
      }, 1500);
    }
    this.currentTrack = sc.track;
    this.currentKey = sc.track.key;
    this.updateEcho();
  }

  /** Anula un cambio que aún no ha llegado a su salida (otra escena lo ha pedido antes); si ya ha llegado, lo da por hecho */
  private cancelScheduled(): void {
    const sc = this.scheduled;
    if (!sc) return;
    const now = this.context.currentTime;
    if (now >= sc.at - 0.02) {
      this.promoteScheduled();
      return;
    }
    clearTimeout(sc.timer);
    this.scheduled = null;
    sc.log.cancelled = true;
    this.stopTrack(sc.track);
    if (sc.bridgeSrc) {
      try { sc.bridgeSrc.stop(); } catch { /* ya parado */ }
      sc.bridgeSrc.disconnect();
    }
    const og = sc.old.gainNode.gain;
    og.cancelScheduledValues(now);
    og.setValueAtTime(Math.max(sc.old.baseVol * this.stateMusic().gain, 0.001), now);
  }

  private fadeOutTrack(track: ManagedTrack, now: number, secs: number): void {
    const g = track.gainNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.001), now);
    g.linearRampToValueAtTime(0.0001, now + secs);
    setTimeout(() => this.stopTrack(track), secs * 1000 + 200);
  }

  /** Puente: el stinger (ya en caché, nunca se descarga aquí) en el reloj de audio, transportado a la tonalidad de destino */
  private playBridge(bridge: BridgePlan, at: number): AudioBufferSourceNode | null {
    if (!bridge.clip) return null;
    const buf = this.game.cache.audio.get(bridge.clip);
    if (!(buf instanceof AudioBuffer)) return null;
    const src = this.context.createBufferSource();
    src.buffer = buf;
    src.detune.value = bridge.detune;
    const g = this.context.createGain();
    // va por masterGain (volumen de la música, silencio y ducking): se compensa para que suene como un stinger de A4.5
    g.gain.value = Math.min(4, STINGER_VOLUME / Math.max(this.musicVolume, 0.05));
    src.connect(g);
    g.connect(this.masterGain);
    src.start(at);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    return src;
  }

  private pushTransition(t: MusicTransitionLog): void {
    this.transitions.push(t);
    if (this.transitions.length > KEEP_TRANSITIONS) this.transitions.shift();
  }

  /** Cada TICK_MS: estado del juego → estado musical (capas, volumen, sección) y notas de las capas del siguiente compás */
  private tick(): void {
    const track = this.currentTrack;
    if (this.muted || !track || !track.grid || this.context.state !== 'running') return;
    const ctx = this.musicContext();
    const { state, rule } = resolveState(MUSIC_MAP.rules, ctx);
    if (ctx.scene !== this.place) {
      this.place = ctx.scene;
      this.arrangement = placeFor(MUSIC_MAP, ctx.scene);
      this.updateEcho();
    }
    if (state !== this.musicState || this.layersTrack !== track) {
      const changed = state !== this.musicState;
      this.musicState = state;
      this.musicRule = rule;
      this.layersTrack = track;
      this.applyState(track, changed);
    }
    this.scheduleLayers(track);
  }

  /** Capas que entran y salen en el siguiente pulso (fundido de un pulso), volumen del estado y salto de sección si lo pide */
  private applyState(track: ManagedTrack, changed: boolean): void {
    const grid = track.grid;
    if (!grid) return;
    this.ensureLayers();
    const sm = this.stateMusic();
    const now = this.context.currentTime;
    const beat = grid.barSec / grid.beatsPerBar;
    const start = now + nextBeatSec(grid, this.posOf(track, now));
    for (const name of Object.keys(LAYER_GAIN)) {
      const target = sm.layers.includes(name) ? LAYER_GAIN[name] : 0.0001;
      this.layerTargets[name] = target;
      const g = this.layerGains.get(name)?.gain;
      if (!g) continue;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, 0.0001), now);
      g.setValueAtTime(Math.max(g.value, 0.0001), start);
      g.linearRampToValueAtTime(target, start + beat);
    }
    if (!this.scheduled && changed) {
      const tg = track.gainNode.gain;
      tg.cancelScheduledValues(now);
      tg.setValueAtTime(Math.max(tg.value, 0.001), now);
      tg.setValueAtTime(Math.max(tg.value, 0.001), start);
      tg.linearRampToValueAtTime(Math.max(track.baseVol * sm.gain, 0.001), start + beat);
      const jump = needsSectionJump(grid, barAt(grid, this.posOf(track, now)), sm.section);
      if (jump) this.planSwitch(track.key, track.buffer, { volume: track.baseVol }, 'state', jump.id);
    }
  }

  private ensureLayers(): void {
    if (this.layerBus) return;
    const c = this.context;
    this.layerBus = c.createGain();
    this.layerBus.connect(this.masterGain);
    this.layerFilter = c.createBiquadFilter();
    this.layerFilter.type = 'lowpass';
    this.layerFilter.frequency.value = 3500;
    this.layerFilter.connect(this.layerBus);
    // eco a compás (corchea con puntillo): delay → realimentación → delay; salida aparte por masterGain
    this.echo = c.createDelay(2);
    const fbk = c.createGain();
    fbk.gain.value = 0.3;
    this.echoOut = c.createGain();
    this.echoOut.gain.value = 0.2;
    this.layerFilter.connect(this.echo);
    this.echo.connect(fbk);
    fbk.connect(this.echo);
    this.echo.connect(this.echoOut);
    this.echoOut.connect(this.masterGain);
    for (const name of Object.keys(LAYER_GAIN)) {
      const g = c.createGain();
      g.gain.value = 0.0001;
      g.connect(this.layerFilter);
      this.layerGains.set(name, g);
    }
    const len = Math.floor(c.sampleRate * 0.5);
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.updateEcho();
  }

  /** Arreglo del lugar: corte del filtro de las capas y eco a compás de la pista que suena */
  private updateEcho(): void {
    const grid = this.currentTrack?.grid;
    if (!this.layerFilter || !this.echo || !this.echoOut) return;
    const a = this.arrangement ?? MUSIC_MAP.defaultPlace;
    const now = this.context.currentTime;
    this.layerFilter.frequency.setTargetAtTime(a.cutoff, now, 0.3);
    this.echoOut.gain.setTargetAtTime(a.echo, now, 0.3);
    if (grid) this.echo.delayTime.setValueAtTime(Math.min(1.9, (grid.barSec / grid.beatsPerBar) * 0.75), now);
  }

  /** Programa en el reloj de audio las notas de las capas activas de cada compás que empiece dentro del margen */
  private scheduleLayers(track: ManagedTrack): void {
    const grid = track.grid;
    if (!grid) return;
    const now = this.context.currentTime;
    if (now < track.startCtx) return;
    const pos = this.posOf(track, now);
    const b = barAt(grid, pos);
    const sm = this.stateMusic();
    const place = this.arrangement ?? MUSIC_MAP.defaultPlace;
    const beat = grid.barSec / grid.beatsPerBar;
    for (let nb = Math.ceil(b - 1e-6); ; nb++) {
      const t = now + (nb - b) * grid.barSec;
      if (t > now + LOOKAHEAD_SEC) break;
      if (t <= this.lastScheduledBarAt + grid.barSec * 0.5) continue;
      // lo que suene desde la salida programada es de la pista nueva (otra tonalidad): no se le ponen notas de esta
      if (this.scheduled && t >= this.scheduled.at - 0.01) break;
      this.lastScheduledBarAt = t;
      const barIdx = ((nb % grid.bars) + grid.bars) % grid.bars;
      for (const layer of sm.layers) {
        const out = this.layerGains.get(layer);
        if (!out) continue;
        for (const n of layerNotes(layer, grid.key, place, grid.beatsPerBar, barIdx, this.musicState === 'danger')) {
          this.playNote(out, t + n.beat * beat, n.dur * beat, n.midi, n.vel, n.wave, layer === 'pad');
        }
      }
    }
  }

  private playNote(out: GainNode, at: number, dur: number, midi: number, vel: number, wave: 'triangle' | 'sine' | 'square' | 'noise', slow: boolean): void {
    const c = this.context;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    const attack = slow ? Math.min(0.4, dur * 0.3) : 0.008;
    env.gain.linearRampToValueAtTime(vel, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    env.connect(out);
    let src: AudioScheduledSourceNode;
    if (wave === 'noise') {
      const ns = c.createBufferSource();
      ns.buffer = this.noise;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      ns.connect(hp);
      hp.connect(env);
      src = ns;
    } else {
      const osc = c.createOscillator();
      osc.type = wave;
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      osc.connect(env);
      src = osc;
    }
    src.start(at);
    src.stop(at + dur + 0.05);
    src.onended = () => { src.disconnect(); env.disconnect(); };
  }

  /** A8.1 (QA): `__qa.music()` — estado, sección, próxima salida, capas y últimas transiciones */
  adaptiveQa(): AdaptiveQaState {
    const now = this.context.currentTime;
    const tr = this.currentTrack;
    const grid = tr?.grid ?? null;
    let bar: number | null = null;
    let beat: number | null = null;
    let section: string | null = null;
    let exit: AdaptiveQaState['nextExit'] = null;
    if (tr && grid) {
      const pos = this.posOf(tr, now);
      const b = barAt(grid, pos);
      bar = Math.floor(b);
      beat = Math.floor((b - bar) * grid.beatsPerBar) + 1;
      section = sectionAtBar(grid, b)?.id ?? null;
      const ex = nextExit(grid, pos, PLANNER);
      exit = { bar: ex.bar, kind: ex.kind, inSec: round3(ex.waitSec), section: ex.section };
    }
    const sc = this.scheduled;
    const layers: Record<string, number> = {};
    for (const [k, g] of this.layerGains) layers[k] = round3(g.gain.value);
    return {
      now: round3(now),
      state: this.musicState,
      rule: this.musicRule,
      transient: this.transient && now < this.transient.until ? this.transient.name : null,
      place: this.place,
      arrangement: this.arrangement,
      track: tr?.key ?? null,
      bpm: grid?.bpm ?? null,
      key: grid ? keyName(grid.key) : null,
      bar,
      beat,
      section,
      nextExit: exit,
      scheduled: sc ? { to: sc.track.key, at: round3(sc.at), inSec: round3(sc.at - now), bridge: sc.log.bridgeClip, toSection: sc.log.toSection } : null,
      layers,
      transitions: this.transitions.map((t) => ({ ...t })),
    };
  }

  // ─── Private ──────────────────────────────

  private createTrack(key: string, buffer: AudioBuffer, variation?: MusicVariation, at?: { when: number; offset: number }): ManagedTrack {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // A8.1: bucle cerrado en compás (de la primera línea de compás a la última entera) para no perder la rejilla al dar la vuelta
    const grid = MUSIC_MAP.tracks[key] ?? null;
    if (grid && grid.loopEndSec <= buffer.duration + 0.01) {
      source.loopStart = grid.loopStartSec;
      source.loopEnd = Math.min(grid.loopEndSec, buffer.duration);
    }

    const gainNode = this.context.createGain();
    gainNode.gain.value = 0; // Start silent for crossfade

    const filterNode = this.context.createBiquadFilter();
    this.configureFilter(filterNode, variation);

    // Chain: source → gain → filter → master
    source.connect(gainNode);
    gainNode.connect(filterNode);
    filterNode.connect(this.masterGain);

    const when = at?.when ?? this.context.currentTime;
    const offset = at?.offset ?? 0;
    source.start(when, offset);

    return { source, gainNode, filterNode, buffer, key, grid, startCtx: when, startOffset: offset, baseVol: variation?.volume ?? 1 };
  }

  private crossfadeTo(newTrack: ManagedTrack, variation: MusicVariation | undefined, duration: number): void {
    const now = this.context.currentTime;
    const targetVol = (variation?.volume ?? 1.0) * this.stateMusic().gain;
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

    // Ramp volume — exponential for natural feel (A8.1: por el volumen del estado musical)
    track.baseVol = variation?.volume ?? 1.0;
    const vol = track.baseVol * this.stateMusic().gain;
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

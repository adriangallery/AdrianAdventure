/**
 * F1.4 (plan FUNTICO_ADVENTURE): audio de Triage con el iMUSE del juego (src/systems/MusicManager.ts).
 *
 * Una sola instancia por juego (en el registry, como en el juego): MusicManager con su cadena (ducking, limitador,
 * cambios planificados en compás). Qué tema y qué nivel suenan lo decide la pieza pura `triageMusic.js`; aquí solo se
 * pasa a MusicManager con `setLevelOverride` (gancho neutro que el juego no usa). El silencio es el de Triage
 * (`adrian_adventure_funtico_muted`): `setMuted` no toca el ajuste guardado del juego.
 *
 * Nada suena antes del primer gesto: la instancia se crea en TriageScene (después del toque en TRIAGE) y, si Phaser
 * sigue bloqueado, MusicManager espera a UNLOCKED.
 */
import type Phaser from 'phaser';
import { MusicManager } from '@/systems/MusicManager';
import { SFX_GAIN } from '@/systems/AudioMix';
import { STINGER_VOLUME, stingerFor, type StingerKind } from '@/systems/Stingers';
import musicMapJson from '../../../assets/config/music-map.json';
import { RACE_THEME, RELAPSE_THEME, levelName, pushHistory, tracksToPrefetch, type MusicHistoryEntry, type ThemeLevel } from './triageMusic.js';

declare const __BUILD_HASH__: string;

export const MUTE_KEY = 'adrian_adventure_funtico_muted';
const REG_KEY = 'triageAudio';
/** Clips de stinger del juego (assets/audio/sfx): también sirven de puente entre temas a MusicManager. */
export const STINGER_CLIPS = ['stinger_item', 'stinger_fail', 'stinger_puzzle_major', 'stinger_puzzle_minor'];
/** Voces ya dobladas (assets/audio/voice) para el arranque y el resultado; RELAPSE ya abre con la frase de Chad. */
export const VOICE_START = 'recep_take_your_time_im_logging_all_302d331b';
export const VOICE_GOOD = 'player_maybe_thats_the_real_cure_a409a2af';
export const VOICE_BAD = 'chad_ha_weak_bro_chad_wins_chad_dd2af2b0';

const THEMES = (musicMapJson as unknown as { themes: Record<string, { levels: string[] }> }).themes;

export function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function voiceUrl(key: string): string {
  return `assets/audio/voice/${key}.mp3`;
}

export function trackUrl(key: string): string {
  const v = typeof __BUILD_HASH__ !== 'undefined' ? `?v=${__BUILD_HASH__}` : '';
  return `assets/audio/music/${key}.mp3${v}`;
}

export interface TriageAudioState {
  theme: string | null;
  level: number | null;
  levelName: string | null;
  /** Pista que suena de verdad en MusicManager (puede ir un compás por detrás del pedido) */
  playing: string | null;
  scheduled: string | null;
  duck: boolean;
  duckCount: number;
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  history: MusicHistoryEntry[];
  stingers: Array<{ t: number; key: string; detune: number }>;
  voices: Array<{ t: number; key: string }>;
}

export class TriageAudio {
  readonly mm: MusicManager;
  private readonly game: Phaser.Game;
  private current: ThemeLevel | null = null;
  private readonly t0 = performance.now();
  private history: MusicHistoryEntry[] = [];
  private stingers: TriageAudioState['stingers'] = [];
  private voices: TriageAudioState['voices'] = [];
  private duckCount = 0;
  private sfxVolume = 1;
  private analyser: AnalyserNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;

  /** La de este juego (la crea la primera vez). */
  static for(game: Phaser.Game): TriageAudio {
    let a = game.registry.get(REG_KEY) as TriageAudio | undefined;
    if (!a) {
      a = new TriageAudio(game);
      game.registry.set(REG_KEY, a);
    }
    return a;
  }

  /** La de este juego si ya existe (no crea nada: el menú no tiene que montar el audio). */
  static peek(game: Phaser.Game): TriageAudio | null {
    return (game.registry.get(REG_KEY) as TriageAudio | undefined) ?? null;
  }

  private constructor(game: Phaser.Game) {
    this.game = game;
    this.mm = new MusicManager(game);
    game.registry.set('musicManager', this.mm);
    this.mm.setMuted(readMuted());
  }

  private now(): number {
    return performance.now() - this.t0;
  }

  /** Tema y nivel que tocan (null = silencio). Solo hace algo si cambia; el cambio entra en compás. */
  setMusic(m: ThemeLevel | null): void {
    const cur = this.current;
    if (cur === m || (cur && m && cur.theme === m.theme && cur.level === m.level)) return;
    this.current = m ? { ...m } : null;
    pushHistory(this.history, this.now(), m);
    if (!m) {
      this.mm.setLevelOverride(null);
      this.mm.transitionToScene({ music: null, crossfadeDuration: 1200 });
      return;
    }
    this.mm.setLevelOverride(m);
    const track = THEMES[m.theme]?.levels[m.level] ?? null;
    this.mm.transitionToScene({ music: track });
  }

  /** Descarga en segundo plano (con el loader de `scene`) las pistas que puede usar la carrera; nunca en silencio. */
  prefetch(scene: Phaser.Scene, hasRelapse: boolean): void {
    if (this.mm.isMuted()) return;
    const list = tracksToPrefetch(THEMES[RACE_THEME], THEMES[RELAPSE_THEME], hasRelapse);
    let queued = 0;
    for (const k of list) {
      if (scene.cache.audio.exists(k)) continue;
      scene.load.audio(k, trackUrl(k));
      queued++;
    }
    if (queued) scene.load.start();
  }

  isMuted(): boolean {
    return this.mm.isMuted();
  }

  setMuted(m: boolean): void {
    this.mm.setMuted(m);
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* sin storage */ }
  }

  /** F1.5: volumen de la música (0–1, sin guardar). */
  setMusicVolume(v: number): void {
    this.mm.setMusicVolume(Math.max(0, Math.min(1, v)));
  }

  /** F1.5: volumen de efectos y voces (0–1, sin guardar), sobre la ganancia de efectos del juego. */
  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    this.game.sound.volume = SFX_GAIN * this.sfxVolume;
  }

  /** Una voz baja la música mientras suena (ducking del juego). */
  voiceStarted(key: string): void {
    this.voices.push({ t: Math.round(this.now()), key });
    if (this.voices.length > 40) this.voices.shift();
    this.duckCount++;
    this.mm.setDuck('voice', true);
  }

  voiceEnded(): void {
    this.mm.setDuck('voice', false);
  }

  /** Stinger del juego en la tonalidad de lo que suena (Stingers.stingerFor); los largos bajan la música mientras duran. */
  stinger(scene: Phaser.Scene, kind: StingerKind): void {
    const { key, detune, ms } = stingerFor(kind, this.mm.currentMusicKey());
    if (!scene.cache.audio.exists(key)) return;
    try { scene.sound.play(key, { volume: STINGER_VOLUME, detune }); } catch { return; }
    this.stingers.push({ t: Math.round(this.now()), key, detune });
    if (this.stingers.length > 40) this.stingers.shift();
    if (kind !== 'item') {
      this.mm.setDuck('stinger', true);
      setTimeout(() => this.mm.setDuck('stinger', false), ms + 150);
    }
  }

  state(): TriageAudioState {
    const q = this.mm.qaState();
    return {
      theme: this.current?.theme ?? null,
      level: this.current?.level ?? null,
      levelName: this.current ? levelName(this.current.level) : null,
      playing: q.adaptive.track,
      scheduled: q.adaptive.scheduled?.to ?? null,
      duck: q.duck.length > 0,
      duckCount: this.duckCount,
      muted: q.muted,
      musicVolume: this.mm.getMusicVolume(),
      sfxVolume: this.sfxVolume,
      history: this.history.map((h) => ({ ...h })),
      stingers: [...this.stingers],
      voices: [...this.voices],
    };
  }

  /** QA: nivel RMS de la salida de TODO el audio (final de la cadena maestra) ahora mismo. */
  rms(): number {
    const ctx = (this.game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.mm.outputNode().connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const x of buf) s += x * x;
    return Math.sqrt(s / buf.length);
  }

  /** Vídeo con sonido (scripts/funtico/triage-video.sh): pista de audio con la salida de la cadena maestra. */
  audioStream(): MediaStream {
    const ctx = (this.game.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!this.recordDest) {
      this.recordDest = ctx.createMediaStreamDestination();
      this.mm.outputNode().connect(this.recordDest);
    }
    return this.recordDest.stream;
  }
}

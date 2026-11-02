// A4.2 (plan SCUMM): vida en las NPC (respirar, parpadear, girarse hacia el jugador, boca al ritmo de la voz).
// Lógica pura, sin Phaser ni imports (se prueba en Node: tests/npc-life.test.mjs, en `npm run test:engine`).
//
// NPC.ts solo aplica lo que decide este módulo cada frame (GameScene.update → NPC.updateLife):
//   - `breathPx`: elevación del cuerpo en píxeles de ARTE (0 o 1). El cuerpo es hijo del Container, que lleva la escala
//     entera de A2.8, así que 1 píxel de arte = un número entero de píxeles de pantalla. El Container no se mueve: la
//     cabeza para el texto (GameScene.speakerHead) sale del Container y no salta con la respiración.
//   - `blink`: parpadeo. Con textura `<id>_blink` se pone esa; si no, el cuerpo se aplasta exactamente 1 píxel de arte
//     en vertical (escala Y = (alto − 1) / alto, pies fijos) durante BLINK_MS: una microbajada de la cabeza que se lee
//     como parpadeo y deja el alto en píxeles de pantalla enteros. La escala del Container (la de A2.8) no se toca.
//   - `mouthOpen`: `<id>_talk` (boca abierta) o `<id>` (cerrada).
//   - `facing`: `left` (sprite espejado) o `right` (tal cual); null = no tocar (cinemática que fijó la cara con actorFace).
//
// Boca y voz (`Mouth`): mientras la NPC tiene su texto en pantalla:
//   - clip sonando: patrón pseudoaleatorio de sílabas (abierta/cerrada de VOICE_SEG_MIN_MS a VOICE_SEG_MAX_MS) con
//     pausas cerradas de vez en cuando; si además hay nivel de señal (AnalyserNode sobre el clip, VoiceSystem.level),
//     solo abre con señal (cierra en los silencios del clip). Si el analizador no oye nada en LEVEL_DEAD_MS (contexto
//     suspendido, audio HTML5), se ignora y queda el patrón;
//   - clip descargándose: cerrada (hasta LOADING_GRACE_MS; después, como sin voz);
//   - clip terminado con el texto aún abierto: cerrada;
//   - sin clip (frase sin voz o sonido apagado, AudioPolicy): alterna cada TEXT_SEG_MIN_MS-TEXT_SEG_MAX_MS lo que se
//     tardaría en decir el texto (textBudgetMs) y luego cerrada.
//
// Girarse (`NpcLife.update`): la NPC mira hacia el jugador mientras está «enganchada»: el jugador va a hablarle o a
// darle/usar algo con ella (GameScene.dispatchNpcTap → engage), mientras dura esa conversación o respuesta, y siempre
// que ella tiene texto en pantalla. Se suelta RELEASE_MS después de que la escena quede libre y vuelve a su orientación
// por defecto (`npcs[].facing` de scene.json; por defecto `right`, como están dibujados los sprites).

export type NpcSide = 'left' | 'right';
export type VoiceState = 'none' | 'loading' | 'playing' | 'done';

/** Respiración: un ciclo lento, arriba 1 píxel de arte durante BREATH_UP del ciclo */
export const BREATH_MS = 3600;
export const BREATH_UP = 0.45;
/** Parpadeo: cada BLINK_GAP_MIN_MS-BLINK_GAP_MAX_MS, BLINK_MS de duración; el primero tras BLINK_FIRST_MIN/MAX_MS */
export const BLINK_MS = 110;
export const BLINK_GAP_MIN_MS = 3000;
export const BLINK_GAP_MAX_MS = 7000;
export const BLINK_FIRST_MIN_MS = 1500;
export const BLINK_FIRST_MAX_MS = 4000;
/** Semilla base con ?qa=1 (se mezcla con el id: dos NPC no parpadean a la vez) */
export const QA_LIFE_SEED = 0x4a42;

/** Boca con voz: sílabas de 80-220 ms; pausa cerrada (220-380 ms) con probabilidad VOICE_PAUSE_P tras cada sílaba */
export const VOICE_SEG_MIN_MS = 80;
export const VOICE_SEG_MAX_MS = 220;
export const VOICE_PAUSE_P = 0.15;
export const VOICE_PAUSE_MIN_MS = 220;
export const VOICE_PAUSE_MAX_MS = 380;
/** Boca sin voz: 120-200 ms por estado, durante lo que se tardaría en decirlo */
export const TEXT_SEG_MIN_MS = 120;
export const TEXT_SEG_MAX_MS = 200;
export const TEXT_MS_PER_CHAR = 55;
export const TEXT_MIN_MS = 900;
export const TEXT_MAX_MS = 6000;
/** Clip que tarda en llegar: tras este tiempo se mueve la boca como si no tuviera voz */
export const LOADING_GRACE_MS = 600;
/** Nivel RMS (0-1) que abre la boca y el que la cierra (histéresis); sin oír nada en LEVEL_DEAD_MS se ignora el nivel */
export const LEVEL_OPEN = 0.02;
export const LEVEL_CLOSE = 0.01;
export const LEVEL_DEAD_MS = 350;

/** Girarse: suelta la conversación RELEASE_MS después de quedar libre; zona muerta en x (unidades del mundo) */
export const RELEASE_MS = 500;
export const SIDE_DEADZONE = 4;

/** PRNG pequeño y determinista (mulberry32, el mismo que PlayerAnim) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits de un texto (semilla por id de NPC) */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Semilla de una NPC: fija con ?qa=1 (QA_LIFE_SEED mezclada con el id); si no, `random` (0-1) mezclado con el id */
export function lifeSeed(id: string, qa: boolean, random = 0): number {
  const base = qa ? QA_LIFE_SEED : Math.floor(random * 0x7fffffff);
  return (hashId(id) ^ base) >>> 0;
}

/** Desfase de la respiración por id (0..BREATH_MS): dos NPC no respiran a la vez */
export function breathPhase(id: string): number {
  return Math.floor(mulberry32(hashId(id))() * BREATH_MS);
}

/** Elevación de la respiración en píxeles de arte (0 o 1, a saltos enteros) */
export function breathPx(tMs: number, phaseMs: number): 0 | 1 {
  const p = (((tMs + phaseMs) % BREATH_MS) + BREATH_MS) % BREATH_MS;
  return p < BREATH_MS * BREATH_UP ? 1 : 0;
}

/** Escala Y del aplastado del parpadeo (sin textura _blink): exactamente 1 píxel de arte menos de alto */
export function blinkSquash(artHeight: number): number {
  return artHeight > 1 ? (artHeight - 1) / artHeight : 1;
}

/** Orientación por defecto: la de scene.json (`npcs[].facing`) o `right` (como están dibujados) */
export function defaultFacing(v: unknown): NpcSide {
  return v === 'left' ? 'left' : 'right';
}

/** Lado del jugador respecto a la NPC (x del mundo); dentro de la zona muerta, el de antes */
export function sideOf(playerX: number, npcX: number, prev: NpcSide, deadzone = SIDE_DEADZONE): NpcSide {
  const dx = playerX - npcX;
  if (Math.abs(dx) <= deadzone) return prev;
  return dx < 0 ? 'left' : 'right';
}

/** Lo que se tardaría en decir un texto sin voz */
export function textBudgetMs(len: number): number {
  return Math.max(TEXT_MIN_MS, Math.min(TEXT_MAX_MS, Math.max(0, len) * TEXT_MS_PER_CHAR));
}

/** Calendario de parpadeos */
export class BlinkClock {
  private rng: () => number;
  private untilNext: number;
  private left = 0;
  /** Parpadeos empezados (QA) */
  count = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.untilNext = BLINK_FIRST_MIN_MS + this.rng() * (BLINK_FIRST_MAX_MS - BLINK_FIRST_MIN_MS);
  }

  /** true mientras dura un parpadeo */
  update(dtMs: number): boolean {
    if (this.left > 0) {
      this.left -= dtMs;
      if (this.left > 0) return true;
      this.left = 0;
      this.untilNext = BLINK_GAP_MIN_MS + this.rng() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
      return false;
    }
    this.untilNext -= dtMs;
    if (this.untilNext > 0) return false;
    this.left = BLINK_MS;
    this.count++;
    return true;
  }
}

export interface MouthInput {
  /** La NPC tiene su texto en pantalla (o una cinemática le pidió actorAnim talk) */
  talking: boolean;
  /** Frase en curso (cambia = línea nueva: reinicia el patrón) */
  line: string;
  /** Clip de esa frase: none (sin voz o silencio), loading, playing, done (ya sonó) */
  voice: VoiceState;
  /** Nivel RMS 0-1 del clip, o null si no hay analizador */
  level: number | null;
}

/** Boca: abierta o cerrada según la voz (ver cabecera) */
export class Mouth {
  private rng: () => number;
  /** Lo que se ve */
  private open = false;
  /** Patrón de sílabas (por debajo del nivel de señal) */
  private pat = false;
  private segLeft = 0;
  private t = 0;
  private line: string | null = null;
  private heard = false;
  private levelOpen = false;
  /** Veces que se ha abierto (QA) */
  moves = 0;
  /** Cómo se movió en la línea en curso: clip (con voz), text (sin voz) o null (aún no se ha movido) */
  lastMode: 'clip' | 'text' | null = null;
  /** La línea en curso usó el nivel de señal del analizador */
  lastLevel = false;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  private between(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  private show(v: boolean): boolean {
    if (v && !this.open) this.moves++;
    this.open = v;
    return v;
  }

  /** Patrón de sílabas: abre/cierra con segmentos al azar; tras una sílaba, a veces una pausa cerrada más larga */
  private step(dtMs: number, voice: boolean): boolean {
    this.segLeft -= dtMs;
    if (this.segLeft > 0) return this.pat;
    const [lo, hi] = voice ? [VOICE_SEG_MIN_MS, VOICE_SEG_MAX_MS] : [TEXT_SEG_MIN_MS, TEXT_SEG_MAX_MS];
    if (this.pat) {
      this.pat = false;
      this.segLeft = voice && this.rng() < VOICE_PAUSE_P ? this.between(VOICE_PAUSE_MIN_MS, VOICE_PAUSE_MAX_MS) : this.between(lo, hi);
    } else {
      this.pat = true;
      this.segLeft = this.between(lo, hi);
    }
    return this.pat;
  }

  update(dtMs: number, i: MouthInput): boolean {
    if (!i.talking) {
      this.line = null;
      return this.show(false);
    }
    if (i.line !== this.line) {
      // Línea nueva: el patrón empieza abriendo (el primer frame con voz o texto ya se ve hablar)
      this.line = i.line;
      this.t = 0;
      this.heard = false;
      this.levelOpen = false;
      this.segLeft = 0;
      this.pat = false;
      this.lastMode = null;
      this.lastLevel = false;
    }
    this.t += dtMs;
    let voice = i.voice;
    if (voice === 'loading' && this.t > LOADING_GRACE_MS) voice = 'none';
    if (voice === 'loading' || voice === 'done') {
      this.segLeft = 0;
      this.pat = false;
      return this.show(false);
    }
    if (voice === 'none') {
      if (this.t > textBudgetMs(i.line.length)) return this.show(false);
      this.lastMode ??= 'text';
      return this.show(this.step(dtMs, false));
    }
    // Sonando: patrón de sílabas, recortado por el nivel si el analizador oye algo
    this.lastMode = 'clip';
    const pattern = this.step(dtMs, true);
    if (i.level === null) return this.show(pattern);
    if (i.level >= LEVEL_OPEN) this.levelOpen = true;
    else if (i.level < LEVEL_CLOSE) this.levelOpen = false;
    if (this.levelOpen) this.heard = true;
    // Aún no ha oído nada: el patrón (y si en LEVEL_DEAD_MS no oye, el analizador está sordo y se queda así)
    if (!this.heard) return this.show(pattern);
    this.lastLevel = true;
    return this.show(pattern && this.levelOpen);
  }

  /** ¿Se ignora el nivel? (analizador sordo: contexto suspendido, audio HTML5) */
  levelDead(): boolean {
    return !this.heard && this.t > LEVEL_DEAD_MS;
  }

  isOpen(): boolean {
    return this.open;
  }
}

export interface LifeInput {
  /** x del jugador y de la NPC (mismo sistema: mundo) */
  playerX: number | null;
  npcX: number;
  /** La NPC tiene su texto en pantalla (o actorAnim talk) */
  talking: boolean;
  line: string;
  voice: VoiceState;
  level: number | null;
  /** Conversación o respuesta suya en marcha (llegar hasta ella, diálogo, script, texto en pantalla) */
  busy: boolean;
  /** Una cinemática le fijó la cara (actorFace): no se gira hasta que acabe */
  faceLocked: boolean;
}

export interface LifePose {
  breathPx: 0 | 1;
  blink: boolean;
  mouthOpen: boolean;
  /** null = no tocar la orientación */
  facing: NpcSide | null;
}

export interface LastTalk {
  /** Hacia dónde miraba al hablar y si era hacia el jugador */
  faced: NpcSide;
  facedPlayer: boolean;
  /** Líneas suyas, ms con texto en pantalla y aperturas de boca en esta conversación */
  lines: number;
  ms: number;
  mouthMoves: number;
  /** clip = alguna línea movió la boca con el clip de voz; text = solo sin voz */
  voice: 'clip' | 'text' | null;
  /** Alguna línea usó el nivel del analizador */
  level: boolean;
}

/** Estado de vida de una NPC (respiración, parpadeo, boca y giro) */
export class NpcLife {
  readonly defaultFacing: NpcSide;
  private phase: number;
  private blinker: BlinkClock;
  readonly mouth: Mouth;
  private t = 0;
  private engaged = false;
  private freeMs = 0;
  private side: NpcSide;
  private facing: NpcSide;
  private lineSeen: string | null = null;
  private pose: LifePose = { breathPx: 0, blink: false, mouthOpen: false, facing: null };
  /** Veces que se ha girado hacia el jugador (QA) */
  turns = 0;
  talkMs = 0;
  lastTalk: LastTalk | null = null;

  constructor(id: string, seed: number, facing: NpcSide = 'right') {
    this.defaultFacing = facing;
    this.facing = facing;
    this.side = facing;
    this.phase = breathPhase(id);
    this.blinker = new BlinkClock(seed);
    this.mouth = new Mouth((seed ^ 0x9e3779b9) >>> 0);
  }

  /** El jugador va a hablarle o a darle/usar algo con ella: se gira hacia él y empieza una conversación nueva */
  engage(): void {
    if (!this.engaged) this.lastTalk = null;
    this.engaged = true;
    this.freeMs = 0;
  }

  isEngaged(): boolean {
    return this.engaged;
  }

  blinkCount(): number {
    return this.blinker.count;
  }

  current(): LifePose {
    return { ...this.pose };
  }

  /** Orientación decidida (la última que no fue null) */
  currentFacing(): NpcSide {
    return this.facing;
  }

  /** Una cinemática la orientó a mano: se adopta como la actual (al acabar vuelve a la lógica normal) */
  noteFacing(side: NpcSide): void {
    this.facing = side;
  }

  update(dtMs: number, i: LifeInput): LifePose {
    const dt = Math.max(0, dtMs);
    this.t += dt;
    if (i.talking && !this.engaged) this.engage();
    if (this.engaged) {
      if (i.busy || i.talking) this.freeMs = 0;
      else if ((this.freeMs += dt) >= RELEASE_MS) this.engaged = false;
    }
    if (i.playerX !== null) this.side = sideOf(i.playerX, i.npcX, this.side);

    let facing: NpcSide | null = null;
    if (!i.faceLocked) {
      const want = this.engaged && i.playerX !== null ? this.side : this.defaultFacing;
      if (want !== this.facing && this.engaged && want === this.side) this.turns++;
      this.facing = want;
      facing = want;
    }

    const mouthOpen = this.mouth.update(dt, { talking: i.talking, line: i.line, voice: i.voice, level: i.level });
    if (i.talking) {
      this.talkMs += dt;
      const lt: LastTalk = this.lastTalk ?? { faced: this.facing, facedPlayer: false, lines: 0, ms: 0, mouthMoves: 0, voice: null, level: false };
      if (this.lineSeen !== i.line) {
        lt.lines++;
        this.lineSeen = i.line;
      }
      lt.faced = this.facing;
      lt.facedPlayer = i.playerX === null || this.facing === this.side;
      lt.ms += dt;
      if (mouthOpen && !this.pose.mouthOpen) lt.mouthMoves++;
      if (this.mouth.lastMode === 'clip') lt.voice = 'clip';
      else if (this.mouth.lastMode === 'text' && lt.voice === null) lt.voice = 'text';
      if (this.mouth.lastLevel) lt.level = true;
      this.lastTalk = lt;
    } else {
      this.lineSeen = null;
    }

    this.pose = { breathPx: breathPx(this.t, this.phase), blink: this.blinker.update(dt), mouthOpen, facing };
    return this.current();
  }

  /** En reposo: sin conversación, sin hablar, boca cerrada y con su orientación por defecto */
  atRest(): boolean {
    return !this.engaged && !this.pose.mouthOpen && this.facing === this.defaultFacing;
  }
}

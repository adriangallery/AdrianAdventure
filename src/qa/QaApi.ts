/**
 * A0.1 (plan SCUMM): API de QA para el recorrido automático y las pruebas de atajos. Solo se instala con
 * `?qa=1` (ver main.ts) y vive en un chunk aparte.
 *
 * Cada acción pasa por los mismos caminos que un jugador: el verbo se elige en el panel SCUMM, el objeto se
 * pulsa en el inventario, el toque entra por `GameScene.dispatchTap`/`dispatchNpcTap` (andar hasta el
 * hotspot, combos, gates y diálogos incluidos) y los textos se cierran con el toque sintético del avance
 * rápido. No hay atajos que pongan flags ni den objetos: si el juego no deja, la API tampoco.
 *
 * Errores (el mensaje empieza así para que el runner los clasifique):
 *  - `[qa:blocked] …` el juego no deja hacerlo (hotspot oculto, objeto que no tienes, opción bloqueada);
 *  - `[qa:error] …`   fallo de la prueba o del juego (id inexistente, tiempo agotado, escena que no carga).
 */
import type Phaser from 'phaser';
import type { GameScene } from '@/scenes/GameScene';
import type { UIScene } from '@/scenes/UIScene';
import type { SpeechState } from '@/ui/DialogueBox';
import type { HotspotData, SceneData, ScriptOp } from '@/types/scene.types';
import type { CinematicQaState } from '@/systems/CinematicDirector';
import type { JournalQaState } from '@/ui/JournalPanel';
import { Verb, type GameState } from '@/types/game.types';
import type { LastTransition } from '@/scenes/PreloadScene';
import type { ScenePrefetcher } from '@/systems/ScenePrefetcher';
import type { PlayerAnimQa } from '@/objects/Player';
import type { NpcLifeQa } from '@/objects/NPC';
import type { FailResponse } from '@/systems/FailResponses';
import { failResponses } from '@/systems/FailResponsesData';
import type { MusicManager, MusicQaState } from '@/systems/MusicManager';
import type { SfxPlayer, SfxQaState } from '@/systems/Sfx';

type Point = { x: number; y: number };
/** A2.6: `used` = ya elegida antes en ese árbol (gris). Las ocultas (`when`, `once`) no salen. */
interface Choice { text: string; enabled: boolean; used?: boolean }

export interface QaState {
  /** Escena cargada (null en el menú o cargando) */
  scene: string | null;
  /** true si no hay nada en marcha (script, texto, diálogo, andar, carga) */
  ready: boolean;
  busy: string[];
  inventory: string[];
  flags: Record<string, boolean>;
  visited: string[];
  firedTriggers: string[];
  achievements: string[];
  dialogueProgress: Record<string, string[]>;
  player: Point | null;
  /** A2.1: última ruta calculada al andar (origen, puntos de paso y destino, en %); null si aún no ha andado */
  path: Point[] | null;
  /** A2.2: hacia dónde mira el personaje (left | right | front | back); null fuera de la partida */
  facing: 'left' | 'right' | 'front' | 'back' | null;
  /**
   * A2.2: último acercamiento a un hotspot/NPC: objetivo, verbo, punto al que fue (null = no anduvo: LOOK, ya estaba
   * allí o no se puede llegar) y orientación decidida. null tras andar libremente o al entrar en la escena.
   */
  walkTarget: { target: string; verb: string; walkTo: Point | null; face: string | null } | null;
  /** Hotspots visibles ahora mismo */
  hotspots: string[];
  /** NPCs con diálogo (clicables) */
  npcs: string[];
  /** Triggers de la escena con bounds (en % del fondo) */
  triggers: { id: string; bounds: { x: number; y: number; w: number; h: number } }[];
  /** Opciones en pantalla si el diálogo espera una elección */
  choices: Choice[] | null;
  /**
   * A2.6: opciones de la ÚLTIMA elección que salió durante el último paso (act/use/talk), antes de responderla;
   * null si el paso no pidió elegir. Para comprobar opciones usadas en gris u ocultas.
   */
  lastChoices: Choice[] | null;
  /** Últimas acciones y textos mostrados, para diagnosticar */
  log: string[];
  /** A0.5: líneas que se han apuntado en `log` desde que arrancó la página (el log solo guarda las 60 últimas) */
  logTotal: number;
  /** A0.5: verbos que han llegado a ejecutarse sobre un hotspot o NPC (player:arrived o al momento) */
  actions: number;
  /**
   * A1.10: listeners de `resize` del ScaleManager (es del juego: sobrevive a los cambios de escena). Si alguna
   * escena o componente no los quita en shutdown, crece con cada cambio de escena.
   */
  resizeListeners: number;
  /**
   * A2.3: texto hablado en pantalla ahora mismo (null si no hay): texto, speaker, color, modo (`head` = sobre la
   * cabeza de quien habla, `top` = arriba-centro: narrador o quien no se ve), centro x y borde superior y del
   * bloque en pantalla, su tamaño (w, h) y la cabeza de quien habla en pantalla (solo en modo head).
   */
  speech: SpeechState | null;
  /** A2.4: verbo elegido en el panel (WALK si ninguno) */
  verb: string | null;
  /** A2.4: hotspots y NPC resaltados mientras se mantiene Tab (vacío si no) */
  highlightedHotspots: string[];
  /** A2.4: verbos con su tecla pintada en el panel (solo escritorio: panel ancho y ratón) */
  verbKeyHints: string[];
  /**
   * A2.4: listeners de teclado y del lienzo de GameScene (4 con la escena en marcha). Como `resizeListeners`, no
   * puede crecer con los cambios de escena (`expect.noListenerGrowth`).
   */
  inputListeners: number;
  /**
   * A2.10: cinemáticas: `active` (modo cinemática), `letterbox` (franjas), `chromeHidden` (interfaz oculta), `camera`
   * (`x`/`y` scroll, `zoom`, `following`: fuera de cinemática true = la cámara de siempre), `transition`
   * (none|iris|wipe) y `covered` (pantalla tapada), `skipped` (la última se saltó), `ended` (terminadas en esta
   * escena), `animating` y `ducked` (música bajada por la cinemática). null fuera de la partida.
   */
  cinematic: CinematicQaState | null;
  /**
   * A2.7: precarga de las escenas vecinas (src/systems/ScenePrefetcher.ts): rutas sin `?v=` ya en la caché HTTP
   * (`done`), en cola (`pending`), bajando (`inFlight`), fallidas, y `disabled` (saveData, 2g) si no precarga.
   */
  prefetch: ReturnType<ScenePrefetcher['qaState']> | null;
  /** A2.7: último cambio de escena: ms desde que se pidió hasta GameScene creada, modo y si hubo pantalla de carga */
  lastTransition: LastTransition | null;
  /**
   * A2.9: diario (móvil de Dex): `open`, `tab`, `chapter` (capítulo actual), `goals` ([{ id, done }] del capítulo),
   * `notes` (ids apuntados, en orden), `anon` (última llamada: `{ puzzle, level, text }`, puzzle null = frase de relleno),
   * `openPuzzle` (puzle abierto y nivel ya dado), `unseen` (cosas nuevas sin ver: el punto del botón) y `calling`. null
   * fuera de la partida.
   */
  journal: JournalQaState | null;
  /**
   * A2.8: densidad de píxel: `pixelScale` (unidad de la escena: píxeles de fondo por píxel de arte), `playerScale`
   * (píxeles de pantalla por píxel de arte del jugador), `playerBase` (la misma sin profundidad), `snapped` (la base se
   * redondeó a un entero), `integer` (la escala aplicada es entera), `depth` (factor de depthScale en sus pies),
   * `playerHeightPct` (alto en pantalla en % del fondo), `worldHeightPct` (el del mundo, sin redondeo), `coordScale` y
   * `npcs` ({ id, scale, integer, heightPct }). null fuera de la partida.
   */
  pixel: PixelQaState | null;
  /**
   * A4.1: animación del jugador: `texture` (la que se ve), `moving`, `dir` (último tramo: left | right | up | down),
   * `vertical`, `talking` (cabecea con su texto en pantalla), `gesture` (coger/usar), `idleTick` (tic de reposo en
   * curso) e `idleTicks` (cuántos en la escena), `costume` (player | ape) y `preview` (el de previewCostume), `angle` y
   * `liftPx` del tween, `scale`, `baseScale` y `rest` (sin tween y con la escala base de A2.8). null fuera de la partida.
   */
  anim: PlayerAnimQa | null;
  /**
   * A2.5: última respuesta de fallo (src/systems/FailResponses.ts): `kind` (item-hotspot | item-npc | item-item | verb |
   * item-verb), `item`, `target` (hotspot, NPC u otro objeto), `verb`, `text` (lo que se dijo) y `bag` (bolsa de la que
   * salió: `hotspot:<escena>/<id>:<objeto|_default>`, `npc:…`, `item:<id>`, `itemHotspot`, `itemNpc:<verbo>`,
   * `itemItem:<a>+<b>`, `itemItem`, `verb:<verbo>`, `itemVerb:<verbo>`). Con ?qa=1 cada bolsa va en ronda desde 0. null si
   * aún no ha habido ninguna.
   */
  lastFailResponse: FailResponse | null;
  /**
   * A4.2: vida de cada NPC de la escena (src/systems/NpcLife.ts): `{ id, mirrored, facing, defaultFacing, engaged,
   * talking, mouthOpen, breathPx, blinking, blinkCount, turns, mouthMoves, talkMs, lastTalk, rest, faceLocked }`;
   * `lastTalk` = última conversación `{ faced, facedPlayer, lines, ms, mouthMoves, voice, level }`. Ver § Vida en las NPC.
   */
  npcLife: NpcLifeQa[];
  /**
   * A4.4: audio: `muted`, `music` ({ key, pending, gain }), `ambience` ({ key: el bucle que suena, requested: el que pide
   * la escena, pending: descargándose, gain, loop: { start, end } }), `duck` (fuentes que bajan la música) y `duckGain`;
   * `sfx` ({ last: últimas 40 peticiones { key, at, volume, detune, ok }, total, counts, missing }) y `footsteps`
   * ({ count: pasos en la escena, surface: superficie bajo los pies, last: { surface, key, at } }). null fuera del juego.
   */
  audio: AudioQaState | null;
}

/** A4.4: ver QaState.audio */
export interface AudioQaState extends MusicQaState {
  sfx: SfxQaState;
  footsteps: ReturnType<GameScene['qaFootsteps']> | null;
}

/** A2.8: ver QaState.pixel */
export type PixelQaState = ReturnType<GameScene['qaPixel']>;

export interface QaApi {
  /** `holdTextMs` (A1.1): deja el primer texto del script en pantalla ese tiempo sin cerrarlo antes de seguir. */
  act(verb: string, targetId: string, choiceTexts?: string[], holdTextMs?: number): Promise<QaState>;
  use(itemId: string, targetId: string, choiceTexts?: string[]): Promise<QaState>;
  combine(itemA: string, itemB: string): Promise<QaState>;
  talk(npcId: string, choiceTexts?: string[]): Promise<QaState>;
  dismissAll(): Promise<QaState>;
  state(): QaState;
  goto(sceneId: string, spawn?: Point): Promise<QaState>;
  walk(pctX: number, pctY: number): Promise<QaState>;
  /** A2.1: ¿se puede pisar el punto (en %) en la escena actual? walkableAreas menos blockedAreas */
  isWalkable(pctX: number, pctY: number): boolean;
  /**
   * A2.4: tecla real (KeyboardEvent en `window`, como el teclado): `press` = pulsar y soltar, `down`/`up` = solo
   * pulsar o soltar (Tab se mantiene con `down` y se suelta con `up`). `key` como `KeyboardEvent.key` («l», «Tab», «Escape»).
   */
  press(key: string, phase?: 'press' | 'down' | 'up'): Promise<QaState>;
  /** A2.4: clic izquierdo de ratón con el verbo que ya tenga el panel (no lo cambia: p. ej. tras `press('l')`) */
  click(targetId: string, choiceTexts?: string[]): Promise<QaState>;
  /** A2.4: clic derecho de ratón: verbo por defecto del hotspot o TALK en una NPC */
  rightClick(targetId: string, choiceTexts?: string[]): Promise<QaState>;
  /**
   * A2.4: doble clic de ratón en una salida (con Walk en el panel). Falla si el personaje anda o el cambio de escena no
   * empieza enseguida: tiene que cruzarla al momento.
   */
  doubleClick(targetId: string): Promise<QaState>;
  newGame(): Promise<QaState>;
  /**
   * A2.10: ejecuta `ops` por el ScriptEngine principal (como un script de hotspot) y espera a que termine. Los textos
   * de una cinemática avanzan solos; fuera de ella se cierran con el toque sintético. Con `skipAfterMs` pulsa Esc
   * (tecla real) ese tiempo después de empezar: salta la cinemática. Solo QA: el runner limita qué ops valen.
   */
  runScript(ops: ScriptOp[], opts?: { skipAfterMs?: number }): Promise<QaState>;
  /** A2.9: pulsa el botón del móvil (el mismo manejador que el dedo). `[qa:blocked]` si el juego no deja abrirlo ahora. */
  openJournal(tab?: 'goals' | 'notes' | 'anon'): Promise<QaState>;
  /** A2.9: cierra el diario con su botón X (si está abierto). */
  closeJournal(): Promise<QaState>;
  /**
   * A2.9: llama a Anon como el jugador: abre el diario si hace falta, pestaña «Call Anon», botón de llamar, espera a que
   * conteste y, si lo abrió ella, lo vuelve a cerrar. La llamada queda en `state().journal.anon`.
   */
  callAnon(): Promise<QaState>;
  /**
   * A4.1: enseña el juego de sprites del disfraz de mono (`'ape'`) o el normal (`'player'`) en la escena actual, para
   * ver sus animaciones; `null` vuelve al de la partida (flag `ape_costume_worn`). Solo los sprites: no da el disfraz, ni
   * toca inventario ni flags, y se pierde al cambiar de escena.
   */
  previewCostume(costume: 'ape' | 'player' | null): Promise<QaState>;
}

const SETTLE_TIMEOUT_MS = 120_000;
/** A2.4: el cambio de escena de un doble clic en una salida tiene que empezar antes de esto (sayBrief de 1 s + margen) */
const DOUBLE_CLICK_EXIT_MS = 4000;
/** Sondeos seguidos sin nada en marcha para dar la escena por quieta */
const CALM_POLLS = 4;
/** Margen tras crear la escena: onEnter arranca a los 100 ms y los triggers de spawn a los 300 ms */
const ENTER_GRACE_MS = 800;

class QaError extends Error {
  constructor(kind: 'blocked' | 'error', message: string) {
    super(`[qa:${kind}] ${message}`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fmtChoices = (options: Choice[]) =>
  options.map((o) => (!o.enabled ? `${o.text} (bloqueada)` : o.used ? `${o.text} (usada)` : o.text)).join(' | ');

type Target = { kind: 'hotspot'; hotspot: HotspotData } | { kind: 'npc'; id: string };

export function installQa(game: Phaser.Game): void {
  const registry = game.registry;
  const log: string[] = [];
  let logTotal = 0;
  /** A2.6: ver QaState.lastChoices */
  let lastChoices: Choice[] | null = null;
  const note = (line: string) => {
    logTotal++;
    log.push(line);
    if (log.length > 60) log.shift();
  };
  const onSay = (text: unknown) => note(`«${String(text).slice(0, 160)}»`);

  const active = (key: string) => game.scene.isActive(key);
  const gs = () => game.scene.getScene('GameScene') as unknown as GameScene;
  const ui = () => game.scene.getScene('UIScene') as unknown as UIScene;
  const inGame = () => active('GameScene') && active('UIScene') && !active('PreloadScene');
  const sceneData = () => registry.get('sceneData') as SceneData | undefined;
  const gameState = () => registry.get('gameState') as GameState | undefined;
  const hasItem = (id: string) => (gameState()?.inventory ?? []).some((i) => i.id === id);
  const panel = () => ui().getScummUI();

  /** Apunta en el log los textos de los scripts (UIScene se recrea en cada escena). */
  const hookLog = () => {
    if (!active('UIScene')) return;
    const events = ui().events;
    if (!events.listeners('say').includes(onSay)) {
      events.on('say', onSay);
      events.on('sayBrief', onSay);
    }
  };

  const busyReasons = (): string[] => {
    if (!inGame()) return ['loading'];
    const out: string[] = [];
    if (registry.get('sceneTransition')) out.push('transition');
    const createdAt = registry.get('sceneCreatedAt') as number | undefined;
    if (createdAt === undefined || Date.now() - createdAt < ENTER_GRACE_MS) out.push('entering');
    const b = gs().qaBusy();
    if (b.script) out.push('script');
    if (b.walking) out.push('walking');
    if (b.fading) out.push('fading');
    // A4.1: gesto de coger/usar del jugador (≤ 400 ms)
    if (b.gesture) out.push('gesture');
    // A2.10: franjas, cámara o transición aún animándose (p. ej. la vuelta de la cámara al acabar una cinemática)
    if (gs().qaCinematic()?.animating) out.push('cinematic');
    if (registry.get('dialogueActive')) out.push('dialogue');
    if (registry.get('dialogueShowing')) out.push('text');
    if (ui().getChoicePanel().isAwaitingChoice()) out.push('choice');
    // A2.9: el móvil está dando tono (Anon aún no ha contestado)
    if (ui().getJournal?.()?.isCalling()) out.push('call');
    return out;
  };

  const waitFor = async (cond: () => boolean, timeoutMs: number, what: string) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > timeoutMs) throw new QaError('error', `tiempo agotado (${timeoutMs} ms) esperando ${what}`);
      await sleep(100);
    }
  };

  /**
   * Espera a que el juego quede quieto: cierra textos y cinemáticas con toques sintéticos y responde las
   * elecciones de diálogo en orden con `choices` (coincidencia por texto contenido, sin mayúsculas).
   */
  const settle = async (choices: string[] = [], timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> => {
    const queue = [...choices];
    lastChoices = null;
    const t0 = Date.now();
    let calm = 0;
    while (calm < CALM_POLLS) {
      hookLog();
      const reasons = busyReasons();
      if (Date.now() - t0 > timeoutMs) {
        throw new QaError('error', `tiempo agotado (${timeoutMs} ms) esperando a que el juego quede libre; ocupado: ${reasons.join(', ')}`);
      }
      if (reasons.includes('choice')) {
        calm = 0;
        const choicePanel = ui().getChoicePanel();
        const options = choicePanel.getOptions();
        lastChoices = options.map((o) => ({ ...o }));
        const want = queue.shift();
        if (want === undefined) throw new QaError('error', `el diálogo pide elegir y el paso no trae más respuestas: ${fmtChoices(options)}`);
        const idx = options.findIndex((o) => o.text.toLowerCase().includes(want.toLowerCase()));
        if (idx < 0) throw new QaError('blocked', `la opción «${want}» no está entre: ${fmtChoices(options)}`);
        if (!choicePanel.choose(idx)) throw new QaError('blocked', `la opción «${options[idx].text}» está bloqueada`);
        note(`> ${options[idx].text}`);
        await sleep(300);
        continue;
      }
      if (reasons.length) {
        calm = 0;
        if (inGame() && reasons.some((r) => r === 'script' || r === 'text' || r === 'dialogue')) gs().qaSyntheticTap();
        await sleep(200);
        continue;
      }
      calm++;
      await sleep(150);
    }
    if (queue.length) throw new QaError('error', `respuestas de diálogo sin usar: ${queue.join(' | ')}`);
  };

  /**
   * A1.1: como un jugador que se distrae, deja el primer texto del script en pantalla `ms` sin tocar nada. Falla
   * si el texto no es de un script en marcha (la espera no probaría nada), si se cierra antes de tiempo o si el
   * script deja de estar en marcha durante la espera (el watchdog antiguo lo cortaba a los 30 s).
   */
  const holdText = async (ms: number) => {
    await waitFor(() => !!registry.get('dialogueShowing'), 30_000, 'el texto que había que dejar en pantalla');
    if (!gs().qaBusy().script) {
      throw new QaError('error', 'el texto en pantalla no es de un script en marcha: la espera no prueba el watchdog');
    }
    note(`(texto en pantalla ${Math.round(ms / 1000)} s sin cerrar)`);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(500);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!registry.get('dialogueShowing')) throw new QaError('error', `el texto se cerró solo a los ${secs} s de ${ms / 1000} s`);
      if (!gs().qaBusy().script) throw new QaError('error', `el script dejó de estar en marcha a los ${secs} s con el texto en pantalla (watchdog)`);
    }
  };

  const ensureGame = async () => {
    if (active('MenuScene') && !active('GameScene') && !active('PreloadScene')) {
      throw new QaError('error', 'no hay partida: estás en el menú (usa newGame())');
    }
    await settle();
  };

  /** Mismo bloqueo que handlePointerDown (cooldown de entrada, texto recién cerrado…). */
  const waitInputFree = async () => {
    for (let i = 0; i < 60; i++) {
      if (inGame() && !gs().qaIsInputBlocked()) return;
      await sleep(50);
    }
    throw new QaError('error', `la escena no acepta toques (ocupado: ${busyReasons().join(', ') || 'enfriamiento de entrada'})`);
  };

  const parseVerb = (name: string): Verb => {
    const key = String(name).toUpperCase();
    if (!(Object.values(Verb) as string[]).includes(key)) throw new QaError('error', `verbo desconocido «${name}»`);
    return key as Verb;
  };

  /** Deja el panel como si el jugador hubiera pulsado ese verbo (sin objeto elegido). */
  const chooseVerb = (verb: Verb) => {
    const p = panel();
    p.clearSelectedItem();
    if (p.getSelectedVerb() !== verb) p.selectVerb(verb);
  };

  const resolveTarget = (id: string): Target => {
    const data = sceneData();
    const scene = registry.get('currentSceneId') as string;
    const hotspot = data?.regions.hotspots.find((h) => h.id === id);
    if (hotspot) {
      if (!gs().qaIsHotspotVisible(hotspot)) throw new QaError('blocked', `el hotspot «${id}» está oculto ahora mismo en ${scene}`);
      return { kind: 'hotspot', hotspot };
    }
    if (data?.npcs?.some((n) => n.id === id)) {
      if (!gs().qaNpcIds().includes(id)) throw new QaError('blocked', `el NPC «${id}» no tiene diálogo: no se puede pulsar`);
      return { kind: 'npc', id };
    }
    throw new QaError('error', `no existe el hotspot ni el NPC «${id}» en la escena ${scene}`);
  };

  /**
   * Clic de ratón resuelto con el mismo hit-test que `handlePointerDown` (panel, fondo, NPC antes que
   * hotspots, hotspot oculto que tapa). Si el ratón no alcanza el objetivo, la prueba falla: es un error del
   * juego o de la ruta, nunca un «el juego no deja».
   */
  const tap = (target: Target, opts: { button?: 'left' | 'right'; mouse?: boolean } = {}) => {
    const id = target.kind === 'npc' ? target.id : target.hotspot.id;
    const why = target.kind === 'npc' ? gs().qaTapNpc(target.id, opts) : gs().qaTapHotspot(target.hotspot, opts);
    if (why) throw new QaError('error', `el ratón no puede pulsar «${id}» en ${String(registry.get('currentSceneId'))}: ${why}`);
  };

  const snapshot = (): QaState => {
    hookLog();
    const st = gameState();
    const playing = inGame();
    const data = sceneData();
    const scene = playing ? gs() : null;
    const reasons = busyReasons();
    const choicePanel = playing ? ui().getChoicePanel() : null;
    return {
      scene: playing ? ((registry.get('currentSceneId') as string | undefined) ?? null) : null,
      ready: reasons.length === 0,
      busy: reasons,
      inventory: (st?.inventory ?? []).map((i) => i.id),
      flags: { ...(st?.flags ?? {}) },
      visited: [...(st?.visited ?? [])],
      firedTriggers: [...(st?.firedTriggers ?? [])],
      achievements: [...(st?.achievements ?? [])],
      dialogueProgress: JSON.parse(JSON.stringify(st?.dialogueProgress ?? {})) as Record<string, string[]>,
      player: scene ? scene.qaPlayer() : null,
      path: scene ? scene.qaPath() : null,
      facing: scene ? scene.qaFacing() : null,
      walkTarget: scene ? scene.qaWalkTarget() : null,
      hotspots: scene && data ? data.regions.hotspots.filter((h) => scene.qaIsHotspotVisible(h)).map((h) => h.id) : [],
      npcs: scene ? scene.qaNpcIds() : [],
      triggers: scene ? scene.qaTriggers() : [],
      choices: choicePanel?.isAwaitingChoice() ? choicePanel.getOptions() : null,
      lastChoices: lastChoices ? lastChoices.map((o) => ({ ...o })) : null,
      log: [...log],
      logTotal,
      actions: (registry.get('qaActions') as number | undefined) ?? 0,
      resizeListeners: game.scale.listenerCount('resize'),
      speech: playing ? ui().getSpeech() : null,
      verb: playing ? panel().getSelectedVerb() : null,
      highlightedHotspots: scene ? scene.qaHighlighted() : [],
      verbKeyHints: playing ? panel().getKeyHints() : [],
      inputListeners: (registry.get('qaInputListeners') as number | undefined) ?? 0,
      cinematic: scene ? scene.qaCinematic() : null,
      prefetch: (registry.get('scenePrefetcher') as ScenePrefetcher | undefined)?.qaState() ?? null,
      lastTransition: (registry.get('lastTransition') as LastTransition | undefined) ?? null,
      journal: playing ? ui().getJournal?.()?.qaState() ?? null : null,
      pixel: scene ? scene.qaPixel() : null,
      anim: scene ? scene.qaAnim() : null,
      lastFailResponse: failResponses.last ? { ...failResponses.last } : null,
      npcLife: scene ? scene.qaNpcLife() : [],
      audio: qaAudio(scene),
    };
  };

  /** A4.4: música y ambiente (MusicManager), efectos pedidos (SfxPlayer) y pasos de la escena */
  const qaAudio = (scene: GameScene | null): AudioQaState | null => {
    const mm = registry.get('musicManager') as MusicManager | undefined;
    const sfx = registry.get('sfx') as SfxPlayer | undefined;
    if (!mm || !sfx) return null;
    return { ...mm.qaState(), sfx: sfx.qaState(), footsteps: scene ? scene.qaFootsteps() : null };
  };

  /** A2.9: el diario de la UIScene viva (error si no hay partida). */
  const journal = () => {
    const j = inGame() ? ui().getJournal?.() : undefined;
    if (!j) throw new QaError('error', 'no hay diario: no hay escena de juego cargada');
    return j;
  };
  /** A2.9: pulsa el botón del móvil por su manejador real (`pointerdown` del botón → toggle) */
  const openJournalNow = (tab: 'goals' | 'notes' | 'anon' = 'goals') => {
    const j = journal();
    if (!j.isOpen()) {
      if (!j.toggle()) throw new QaError('blocked', 'el diario no se abre ahora (cinemática, diálogo, texto o script en marcha)');
    }
    j.showTab(tab);
  };
  const domClick = (id: string) => {
    const node = document.getElementById(id) as HTMLButtonElement | null;
    if (!node) throw new QaError('error', `no está el botón #${id} del diario`);
    if (node.disabled) throw new QaError('blocked', `el botón #${id} del diario está desactivado`);
    node.click();
  };

  const key = (type: 'keydown' | 'keyup', k: string) => {
    window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
  };

  const api: QaApi = {
    async act(verbName, targetId, choiceTexts = [], holdTextMs = 0) {
      const verb = parseVerb(verbName);
      await ensureGame();
      const target = resolveTarget(targetId);
      chooseVerb(verb);
      await waitInputFree();
      note(`${verb} ${targetId}`);
      tap(target);
      if (holdTextMs > 0) await holdText(holdTextMs);
      await settle(choiceTexts);
      return snapshot();
    },

    async use(itemId, targetId, choiceTexts = []) {
      await ensureGame();
      if (!hasItem(itemId)) throw new QaError('blocked', `no tengo «${itemId}» en el inventario`);
      if (hasItem(targetId)) return api.combine(itemId, targetId);
      const target = resolveTarget(targetId);
      chooseVerb(Verb.USE);
      if (!panel().clickInventoryItem(itemId) || panel().getSelectedItem()?.id !== itemId) {
        throw new QaError('error', `no se pudo elegir «${itemId}» en el inventario`);
      }
      await waitInputFree();
      note(`USE ${itemId} → ${targetId}`);
      tap(target);
      await settle(choiceTexts);
      return snapshot();
    },

    async combine(itemA, itemB) {
      await ensureGame();
      for (const id of [itemA, itemB]) {
        if (!hasItem(id)) throw new QaError('blocked', `no tengo «${id}» en el inventario`);
      }
      chooseVerb(Verb.USE);
      note(`USE ${itemA} + ${itemB}`);
      if (!panel().clickInventoryItem(itemA) || !panel().clickInventoryItem(itemB)) {
        throw new QaError('error', `no se pudieron pulsar «${itemA}» y «${itemB}» en el inventario`);
      }
      await settle();
      return snapshot();
    },

    async talk(npcId, choiceTexts = []) {
      await ensureGame();
      const target = resolveTarget(npcId);
      chooseVerb(Verb.TALK);
      await waitInputFree();
      note(`TALK ${npcId}`);
      tap(target);
      await settle(choiceTexts);
      return snapshot();
    },

    async dismissAll() {
      await settle();
      return snapshot();
    },

    state: snapshot,

    async goto(sceneId, spawn) {
      await ensureGame();
      note(`GOTO ${sceneId}`);
      gs().qaGoto(sceneId, spawn);
      await settle();
      if (registry.get('currentSceneId') !== sceneId) throw new QaError('error', `goto no llegó a «${sceneId}»`);
      return snapshot();
    },

    async walk(pctX, pctY) {
      await ensureGame();
      chooseVerb(Verb.WALK);
      await waitInputFree();
      note(`WALK ${pctX},${pctY}`);
      const why = gs().qaWalk(pctX, pctY);
      if (why) throw new QaError('error', `no se puede hacer clic para andar a ${pctX},${pctY}: ${why}`);
      await settle();
      return snapshot();
    },

    isWalkable(pctX, pctY) {
      if (!inGame()) throw new QaError('error', 'no hay escena de juego cargada');
      return gs().qaIsWalkable(pctX, pctY);
    },

    async press(k, phase = 'press') {
      await ensureGame();
      note(`KEY ${k}${phase === 'press' ? '' : ` (${phase})`}`);
      if (phase !== 'up') key('keydown', k);
      if (phase === 'press') {
        await sleep(50);
        key('keyup', k);
      }
      if (phase === 'up') key('keyup', k);
      await settle();
      return snapshot();
    },

    async click(targetId, choiceTexts = []) {
      await ensureGame();
      const target = resolveTarget(targetId);
      await waitInputFree();
      note(`CLICK ${targetId} (${panel().getSelectedVerb()})`);
      tap(target, { mouse: true });
      await settle(choiceTexts);
      return snapshot();
    },

    async rightClick(targetId, choiceTexts = []) {
      await ensureGame();
      const target = resolveTarget(targetId);
      await waitInputFree();
      note(`RIGHTCLICK ${targetId}`);
      tap(target, { button: 'right', mouse: true });
      await settle(choiceTexts);
      return snapshot();
    },

    async doubleClick(targetId) {
      await ensureGame();
      const target = resolveTarget(targetId);
      if (target.kind !== 'hotspot') throw new QaError('error', `el doble clic es para salidas (hotspots); «${targetId}» es un NPC`);
      chooseVerb(Verb.WALK);
      await waitInputFree();
      const from = registry.get('currentSceneId') as string;
      const p0 = gs().qaPlayer();
      note(`DOUBLECLICK ${targetId}`);
      tap(target, { mouse: true });
      tap(target, { mouse: true });
      // Al momento: el personaje no se mueve y el cambio de escena empieza enseguida (tras el sayBrief de la salida)
      const t0 = Date.now();
      while (!registry.get('sceneTransition')) {
        if (registry.get('currentSceneId') !== from) break;
        const p = gs().qaPlayer();
        if (Math.hypot(p.x - p0.x, p.y - p0.y) > 0.05) {
          throw new QaError('error', `con el doble clic en «${targetId}» el personaje anduvo (de ${p0.x.toFixed(1)},${p0.y.toFixed(1)} a ${p.x.toFixed(1)},${p.y.toFixed(1)}): no cruzó la salida al momento`);
        }
        if (Date.now() - t0 > DOUBLE_CLICK_EXIT_MS) {
          throw new QaError('blocked', `el doble clic en «${targetId}» no cambió de escena en ${DOUBLE_CLICK_EXIT_MS} ms (¿salida cerrada o no es una salida?)`);
        }
        await sleep(50);
      }
      await settle();
      return snapshot();
    },

    async runScript(ops, opts = {}) {
      if (!Array.isArray(ops) || !ops.every((o) => o && typeof o.op === 'string')) {
        throw new QaError('error', 'runScript necesita una lista de ops ({ op: "..." })');
      }
      await ensureGame();
      await waitInputFree();
      note(`RUNSCRIPT ${ops.length} op(s)${opts.skipAfterMs !== undefined ? ` (Esc a los ${opts.skipAfterMs} ms)` : ''}`);
      const run: { finished: boolean; failure: unknown } = { finished: false, failure: null };
      gs().qaRunScript(ops).then(() => { run.finished = true; }, (err: unknown) => { run.finished = true; run.failure = err; });
      const t0 = Date.now();
      let skipSent = false;
      while (!run.finished) {
        hookLog();
        const elapsed = Date.now() - t0;
        if (elapsed > SETTLE_TIMEOUT_MS) throw new QaError('error', `runScript: el script no terminó en ${SETTLE_TIMEOUT_MS} ms (ocupado: ${busyReasons().join(', ')})`);
        if (!skipSent && opts.skipAfterMs !== undefined && elapsed >= opts.skipAfterMs) {
          skipSent = true;
          note('KEY Escape (saltar)');
          key('keydown', 'Escape');
          await sleep(50);
          key('keyup', 'Escape');
          continue;
        }
        if (ui().getChoicePanel().isAwaitingChoice()) throw new QaError('error', 'runScript: el script pide elegir en un diálogo (no hay respuestas en este paso)');
        // Fuera de cinemática los textos esperan un toque, como siempre
        if (registry.get('dialogueShowing') && !registry.get('cinematicMode')) gs().qaSyntheticTap();
        await sleep(100);
      }
      if (run.failure) throw new QaError('error', `runScript: ${run.failure instanceof Error ? run.failure.message : String(run.failure)}`);
      await settle();
      return snapshot();
    },

    async openJournal(tab = 'goals') {
      await ensureGame();
      note(`JOURNAL open (${tab})`);
      openJournalNow(tab);
      return snapshot();
    },

    async closeJournal() {
      await ensureGame();
      if (journal().isOpen()) {
        note('JOURNAL close');
        domClick('journal-close');
      }
      return snapshot();
    },

    async callAnon() {
      await ensureGame();
      const wasOpen = journal().isOpen();
      openJournalNow('anon');
      const before = (registry.get('journalLastCall') as unknown) ?? null;
      note('CALL ANON');
      domClick('journal-call');
      await waitFor(() => !journal().isCalling(), 10_000, 'a que Anon conteste');
      const after = (registry.get('journalLastCall') as unknown) ?? null;
      if (after === before) throw new QaError('error', 'la llamada a Anon no dejó respuesta (¿se cerró el diario a mitad?)');
      const call = after as { text?: string };
      note(`«Anon: ${String(call.text ?? '').slice(0, 140)}»`);
      const st = snapshot();
      if (!wasOpen) domClick('journal-close');
      await settle();
      return wasOpen ? st : snapshot();
    },

    async previewCostume(costume) {
      if (costume !== null && costume !== 'ape' && costume !== 'player') {
        throw new QaError('error', `previewCostume: «${String(costume)}» no es un disfraz (ape | player | null)`);
      }
      await ensureGame();
      note(`PREVIEW COSTUME ${costume ?? '(el de la partida)'}`);
      gs().qaPreviewCostume(costume);
      await sleep(100);
      return snapshot();
    },

    async newGame() {
      await waitFor(() => active('MenuScene'), 90_000, 'el menú');
      const menu = game.scene.getScene('MenuScene');
      const button = menu.children.list.find((o) => (o as unknown as { text?: string }).text === '[ New Game ]');
      if (!button) throw new QaError('error', 'no encuentro el botón «New Game» en el menú');
      note('NEW GAME');
      button.emit('pointerdown');
      // Aviso de sonido (DOM): se entra sin sonido, pulsando «No thanks» como haría el jugador
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !active('PreloadScene') && !active('GameScene')) {
        const noThanks = [...document.querySelectorAll('button')].find((b) => /No thanks/i.test(b.textContent ?? ''));
        if (noThanks) {
          noThanks.click();
          break;
        }
        await sleep(100);
      }
      await waitFor(inGame, 90_000, 'la primera escena');
      await settle();
      return snapshot();
    },
  };

  (window as unknown as { __qa?: QaApi }).__qa = api;
  console.info('[qa] API de QA activa: window.__qa');
}

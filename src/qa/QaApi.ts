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
import type { HotspotData, SceneData } from '@/types/scene.types';
import { Verb, type GameState } from '@/types/game.types';

type Point = { x: number; y: number };
interface Choice { text: string; enabled: boolean }

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
  /** Hotspots visibles ahora mismo */
  hotspots: string[];
  /** NPCs con diálogo (clicables) */
  npcs: string[];
  /** Opciones en pantalla si el diálogo espera una elección */
  choices: Choice[] | null;
  /** Avisos acumulados (p. ej. hotspots tapados por otros que el ratón no puede pulsar) */
  warnings: string[];
  /** Últimas acciones y textos mostrados, para diagnosticar */
  log: string[];
}

export interface QaApi {
  act(verb: string, targetId: string, choiceTexts?: string[]): Promise<QaState>;
  use(itemId: string, targetId: string, choiceTexts?: string[]): Promise<QaState>;
  combine(itemA: string, itemB: string): Promise<QaState>;
  talk(npcId: string, choiceTexts?: string[]): Promise<QaState>;
  dismissAll(): Promise<QaState>;
  state(): QaState;
  goto(sceneId: string, spawn?: Point): Promise<QaState>;
  walk(pctX: number, pctY: number): Promise<QaState>;
  newGame(): Promise<QaState>;
}

const SETTLE_TIMEOUT_MS = 120_000;
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
const fmtChoices = (options: Choice[]) => options.map((o) => (o.enabled ? o.text : `${o.text} (bloqueada)`)).join(' | ');

type Target = { kind: 'hotspot'; hotspot: HotspotData } | { kind: 'npc'; id: string };

export function installQa(game: Phaser.Game): void {
  const registry = game.registry;
  const log: string[] = [];
  const warnings = new Set<string>();
  const note = (line: string) => {
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
    if (registry.get('dialogueActive')) out.push('dialogue');
    if (registry.get('dialogueShowing')) out.push('text');
    if (ui().getChoicePanel().isAwaitingChoice()) out.push('choice');
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

  /** Aviso si ningún punto del hotspot cae en él con el ratón (otro hotspot anterior en la lista lo tapa). */
  const checkClickable = (hotspot: HotspotData, data: SceneData) => {
    const b = hotspot.bounds;
    if (!b) return;
    const cover = new Set<string>();
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const px = b.x + (b.w * (i + 0.5)) / 7;
        const py = b.y + (b.h * (j + 0.5)) / 7;
        const top = data.regions.hotspots.find((h) => h.bounds
          && px >= h.bounds.x && px <= h.bounds.x + h.bounds.w && py >= h.bounds.y && py <= h.bounds.y + h.bounds.h);
        if (top === hotspot) return;
        if (top) cover.add(top.id);
      }
    }
    warnings.add(`${data.id}.${hotspot.id}: tapado por ${[...cover].join(', ')}; con el ratón no se llega a pulsar`);
  };

  const resolveTarget = (id: string): Target => {
    const data = sceneData();
    const scene = registry.get('currentSceneId') as string;
    const hotspot = data?.regions.hotspots.find((h) => h.id === id);
    if (hotspot) {
      if (!gs().qaIsHotspotVisible(hotspot)) throw new QaError('blocked', `el hotspot «${id}» está oculto ahora mismo en ${scene}`);
      checkClickable(hotspot, data!);
      return { kind: 'hotspot', hotspot };
    }
    if (data?.npcs?.some((n) => n.id === id)) {
      if (!gs().qaNpcIds().includes(id)) throw new QaError('blocked', `el NPC «${id}» no tiene diálogo: no se puede pulsar`);
      return { kind: 'npc', id };
    }
    throw new QaError('error', `no existe el hotspot ni el NPC «${id}» en la escena ${scene}`);
  };

  const tap = (target: Target) => {
    if (target.kind === 'npc') gs().qaTapNpc(target.id);
    else gs().qaTapHotspot(target.hotspot);
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
      hotspots: scene && data ? data.regions.hotspots.filter((h) => scene.qaIsHotspotVisible(h)).map((h) => h.id) : [],
      npcs: scene ? scene.qaNpcIds() : [],
      choices: choicePanel?.isAwaitingChoice() ? choicePanel.getOptions() : null,
      warnings: [...warnings],
      log: [...log],
    };
  };

  const api: QaApi = {
    async act(verbName, targetId, choiceTexts = []) {
      const verb = parseVerb(verbName);
      await ensureGame();
      const target = resolveTarget(targetId);
      chooseVerb(verb);
      await waitInputFree();
      note(`${verb} ${targetId}`);
      tap(target);
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
      gs().qaWalk(pctX, pctY);
      await settle();
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

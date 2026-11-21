/**
 * F3.2a (plan FUNTICO_ADVENTURE): entrada de la página de un expediente (`funtico/campaign.html?chapter=N`, en la raíz de
 * dist-funtico; F3.1 era un banco de pruebas, ahora es parte del build desplegado). El juego entero con:
 *   - el usuario del puente (mock: el usuario de prueba) y su progreso; un expediente cerrado vuelve al mapa;
 *   - las partidas guardadas en claves propias (`adrian_adventure_funtico_campaign_<userId>_ch<N>_…`, gancho neutro
 *     `setSaveStorage`); nunca `adrian_adventure_save`;
 *   - el recolector de métricas (F3.1) y su copia periódica en `…_ch<N>_metrics` (para F3.3);
 *   - CampaignEntryScene en lugar de MenuScene (se entra directo al capítulo) y, al cerrar el capítulo, el juego en
 *     pausa y CampaignResultScene encima;
 *   - F3.2b: el perfil de layout apilado (`STACKED_PORTRAIT_LAYOUT`): en vertical escena arriba y panel apilado debajo,
 *     en horizontal el layout SCUMM de siempre, con giro en caliente. El juego normal (src/main.ts) sigue con
 *     `CLASSIC_LAYOUT` porque nunca llama a `setLayoutProfile`.
 * Con `?qa=1` monta la API de QA del walkthrough (como src/main.ts).
 */
import Phaser from 'phaser';
import { GAME_CONFIG } from '@/config/game.config';
import { BootScene } from '@/scenes/BootScene';
import { PreloadScene } from '@/scenes/PreloadScene';
import { GameScene } from '@/scenes/GameScene';
import { UIScene } from '@/scenes/UIScene';
import { setSaveStorage } from '@/platform/SaveStorage';
import { setPlatformHooks, type PlatformHooks } from '@/platform/PlatformHooks';
import { setLayoutProfile, STACKED_PORTRAIT_LAYOUT } from '@/platform/LayoutProfile';
import { createBridge } from './FunticoBridge';
import { installCampaignMetrics } from './installCampaignMetrics';
import type { CampaignMetrics } from './CampaignMetrics';
import { REG } from './ui';
import { CampaignEntryScene, CAMPAIGN_CTX, type CampaignCtx } from './campaign/CampaignEntryScene';
import { CampaignResultScene, type ResultData } from './campaign/CampaignResultScene';
import { campaignKey, caseState, chapterSaveStore, isActive, loadProgress } from './campaign/progress';
import { campaignHook, chapterParam, go, mapUrl } from './campaign/context';

/** Cada cuánto se copia el recolector a su clave (F3.3 lo leerá al reanudar). */
const METRICS_SAVE_MS = 5000;
/** El resultado sale cuando el juego lleva este tiempo quieto tras cerrar el capítulo (acaba la cinemática). */
const IDLE_BEFORE_RESULT_MS = 1200;
const MAX_WAIT_RESULT_MS = 30_000;

async function start(): Promise<void> {
  const chapter = chapterParam();
  const bridge = createBridge();
  await bridge.init();
  const u = await bridge.getUser();
  const userId = u.ok ? u.value.UserId : null;
  const progress = loadProgress(localStorage, userId);
  if (caseState(progress, chapter) !== 'open') {
    go(mapUrl());
    return;
  }
  // Abrir un expediente = empezar desde su estado canónico: la partida en curso anterior se descarta (F3.3 la reanudará)
  const saveStore = chapterSaveStore(localStorage, userId, chapter);
  saveStore.removeItem('adrian_adventure_save');
  setSaveStorage(saveStore);
  const metricsKey = campaignKey(userId, `ch${chapter}_metrics`);
  localStorage.removeItem(metricsKey);
  setLayoutProfile(STACKED_PORTRAIT_LAYOUT); // F3.2b: vertical apilado y giro en caliente (antes de crear el juego)
  const metrics = installCampaignMetrics({ chapter });
  // Intento en el puente (mock: sin red). Si falla, se juega igual.
  void bridge.startCampaignLevel(`chapter_${chapter}`);

  const ctx: CampaignCtx = { chapter, userId, costume: isActive(progress, 'ape_costume'), phoneTheme: isActive(progress, 'phone_theme') };
  const game = new Phaser.Game({
    ...GAME_CONFIG,
    scene: [BootScene, CampaignEntryScene, PreloadScene, GameScene, UIScene, CampaignResultScene],
  });
  game.registry.set(REG.bridge, bridge);
  game.registry.set(CAMPAIGN_CTX, ctx);
  (window as unknown as { __game?: Phaser.Game }).__game = game;
  game.events.once('ready', () => game.scale.refresh());
  if (new URLSearchParams(location.search).get('qa') === '1') {
    void import('@/qa/QaApi').then(({ installQa }) => installQa(game));
  }

  let done = false;
  const saveMetrics = () => {
    if (done) return;
    try { localStorage.setItem(metricsKey, JSON.stringify(metrics)); } catch { /* sin almacenamiento */ }
  };
  const timer = window.setInterval(saveMetrics, METRICS_SAVE_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveMetrics(); });

  const hook = campaignHook();
  Object.assign(hook, { chapter, userId, ctx, saveKey: campaignKey(userId, `ch${chapter}_save`), metricsKey, state: 'playing' });

  // Los ganchos: el recolector y, además, el cierre del capítulo que se juega
  const showResult = () => waitIdle(game).then(() => {
    if (done) return;
    done = true;
    window.clearInterval(timer);
    metrics.pause();
    hook.state = 'result';
    for (const k of ['GameScene', 'UIScene']) if (game.scene.isActive(k)) game.scene.pause(k);
    const data: ResultData = {
      chapter,
      metrics: metrics.metrics(chapter),
      userId,
      onRecorded: () => {
        saveStore.removeItem('adrian_adventure_save');
        localStorage.removeItem(metricsKey);
      },
    };
    game.scene.start('CampaignResultScene', data);
    game.scene.bringToTop('CampaignResultScene');
  });
  setPlatformHooks(withChapterEnd(metrics, chapter, showResult));
}

/** Los ganchos del recolector, con un aviso extra al cerrarse `chapter`. */
function withChapterEnd(metrics: CampaignMetrics, chapter: number, onEnd: () => void): Partial<PlatformHooks> {
  return {
    onAction: (a) => metrics.onAction(a),
    onHint: (level, info) => metrics.onHint(level, info),
    onFail: (f) => metrics.onFail(f),
    onOptional: (id) => metrics.onOptional(id),
    onPlayTime: (ms) => metrics.onPlayTime(ms),
    onChapterComplete: (n) => {
      metrics.onChapterComplete(n);
      if (n === chapter) onEnd();
    },
  };
}

/** Espera a que la escena esté quieta (sin script, cinemática, diálogo, fundido ni cambio de escena) un rato. */
function waitIdle(game: Phaser.Game): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let calmSince = 0;
    const tick = () => {
      const gs = game.scene.getScene('GameScene') as unknown as {
        qaIsInputBlocked?: () => boolean;
        qaBusy?: () => { script: boolean; walking: boolean; fading: boolean };
        qaCinematic?: () => { animating?: boolean } | null;
      } | null;
      const reg = game.registry;
      const busy = !game.scene.isActive('GameScene') || game.scene.isActive('PreloadScene') || !!reg.get('sceneTransition')
        || !gs || gs.qaIsInputBlocked?.() === true || Object.values(gs.qaBusy?.() ?? {}).some(Boolean)
        || !!gs.qaCinematic?.()?.animating;
      const now = Date.now();
      if (busy) calmSince = 0;
      else if (!calmSince) calmSince = now;
      if ((calmSince && now - calmSince >= IDLE_BEFORE_RESULT_MS) || now - t0 > MAX_WAIT_RESULT_MS) resolve();
      else window.setTimeout(tick, 150);
    };
    tick();
  });
}

void start();

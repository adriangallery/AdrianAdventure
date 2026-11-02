import type Phaser from 'phaser';
import type { MusicManager } from '@/systems/MusicManager';
import {
  planPrefetch, prefetchBudget, sceneExits, sceneImageAssets, shortUrl,
  type ConnectionLike, type PrefetchScene, type PrefetchTask, type SceneAsset,
} from '@/systems/ScenePrefetch';

declare const __BUILD_HASH__: string;
/** Mismo `?v=` que PreloadScene y MusicManager */
export const ASSET_V = typeof __BUILD_HASH__ !== 'undefined' ? `?v=${__BUILD_HASH__}` : '';

/**
 * A2.7 (plan SCUMM): precarga en segundo plano de las escenas vecinas (src/systems/ScenePrefetch.ts dice cuáles y
 * en qué orden).
 *
 * Decisión: se precarga a la CACHÉ HTTP del navegador (`fetch` con `priority: 'low'`, leyendo el cuerpo y
 * tirándolo), no a texturas de Phaser. Una textura decodificada de 3712x1152 son ~17 MB de VRAM y A5.1 ya cuenta
 * ~85 MB por escena en móvil; en la caché HTTP solo ocupa lo que pesa el fichero, en disco. nginx sirve
 * `/assets/` con `Cache-Control: public, max-age=31536000, immutable` y las URLs llevan `?v=<build>`, así que al
 * entrar el loader de Phaser la saca de la caché sin red (solo decodifica). Los scene.json de las vecinas sí se
 * guardan aquí ya parseados (son texto, unos KB): PreloadScene los usa sin volver a pedirlos (una copia nueva
 * por visita, porque GameScene puede tocar el objeto).
 *
 * Reglas: empieza tras el primer frame jugable (lo llama PreloadScene cuando GameScene ya está creada), de un
 * fichero en uno, espera mientras cualquier loader de Phaser esté cargando (la escena, la música de MusicManager o
 * las voces de VoiceSystem, que van bajo demanda y nunca se precargan aquí) o la pestaña esté oculta, se cancela
 * al cambiar de escena, no precarga música con el sonido apagado (A1.5) y no hace nada con
 * `navigator.connection.saveData` o en 2G (en 3G, solo la primera vecina).
 */
export class ScenePrefetcher {
  /** scene.json tal como llegaron (nunca se entregan sin copiar) */
  private readonly scenes: Record<string, PrefetchScene> = {};
  private readonly done = new Set<string>();
  private readonly failed = new Set<string>();
  private queue: PrefetchTask[] = [];
  private inFlight: { task: PrefetchTask; ctrl: AbortController } | null = null;
  private current: string | null = null;
  private run = 0;
  private disabled: string | null = null;
  private maxScenes = 0;

  constructor(private readonly game: Phaser.Game) {}

  static of(game: Phaser.Game): ScenePrefetcher {
    let p = game.registry.get('scenePrefetcher') as ScenePrefetcher | undefined;
    if (!p) {
      p = new ScenePrefetcher(game);
      game.registry.set('scenePrefetcher', p);
    }
    return p;
  }

  /** Guarda el scene.json de una escena (lo llama también PreloadScene con los que carga ella). */
  rememberScene(id: string, data: unknown): void {
    if (!this.scenes[id] && data && typeof data === 'object') this.scenes[id] = structuredClone(data) as PrefetchScene;
  }

  /** Copia del scene.json si ya se tiene, para meterla en la caché JSON de Phaser sin pedirlo. */
  sceneData<T>(id: string): T | undefined {
    const s = this.scenes[id];
    return s ? (structuredClone(s) as T) : undefined;
  }

  /** Imágenes de la escena que no están ni en Phaser ni ya descargadas en la caché HTTP (lo en curso falta). */
  missingImages(id: string, data: PrefetchScene): SceneAsset[] {
    return sceneImageAssets(id, data, ASSET_V).filter((a) => !this.game.textures.exists(a.key) && !this.done.has(a.url));
  }

  /** Empieza a precargar las vecinas de `sceneId` (cancela lo de la escena anterior). */
  start(sceneId: string): void {
    this.cancel();
    this.current = sceneId;
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: ConnectionLike }) : null;
    const budget = prefetchBudget(nav?.connection);
    this.disabled = budget.reason;
    this.maxScenes = budget.maxScenes;
    if (budget.maxScenes === 0) return;
    const run = this.run;
    void this.loop(run);
  }

  /**
   * Para la precarga. Lo que está bajando se aborta salvo que `keep(url)` diga que lo va a necesitar la escena que
   * entra (Chrome hace esperar a la segunda petición de la misma URL en vez de bajarla dos veces).
   */
  cancel(keep?: (url: string) => boolean): void {
    this.run++;
    this.queue = [];
    if (this.inFlight && !keep?.(this.inFlight.task.url)) this.inFlight.ctrl.abort();
  }

  /** A2.7 (QA): estado para `__qa.state().prefetch` */
  qaState(): { scene: string | null; neighbors: string[]; done: string[]; pending: string[]; inFlight: string | null; failed: string[]; disabled: string | null; maxScenes: number } {
    return {
      scene: this.current,
      neighbors: this.current ? sceneExits(this.scenes[this.current], this.current) : [],
      done: [...this.done].map(shortUrl),
      pending: this.queue.map((t) => shortUrl(t.url)),
      inFlight: this.inFlight ? shortUrl(this.inFlight.task.url) : null,
      failed: [...this.failed].map(shortUrl),
      disabled: this.disabled,
      maxScenes: this.maxScenes,
    };
  }

  private plan(): PrefetchTask[] {
    const current = this.current;
    if (!current) return [];
    const mm = this.game.registry.get('musicManager') as MusicManager | undefined;
    const muted = mm ? mm.isMuted() : true; // sin MusicManager, como en silencio: nada de música
    return planPrefetch({
      current,
      neighbors: sceneExits(this.scenes[current], current),
      scenes: this.scenes,
      v: ASSET_V,
      done: new Set([...this.done, ...this.failed]),
      isLoaded: (key) => this.game.textures.exists(key) || this.game.cache.audio.has(key),
      muted,
      maxScenes: this.maxScenes,
    });
  }

  /** Algún loader de Phaser trabajando (escena, música o voces) o la pestaña oculta */
  private busy(): boolean {
    if (typeof document !== 'undefined' && document.hidden) return true;
    return this.game.scene.getScenes(true).some((s) => s.load?.isLoading());
  }

  private async loop(run: number): Promise<void> {
    while (run === this.run) {
      while (this.busy()) {
        await new Promise((r) => setTimeout(r, 300));
        if (run !== this.run) return;
      }
      this.queue = this.plan();
      const task = this.queue[0];
      if (!task) return;
      this.queue.shift();
      await this.fetchOne(task);
    }
  }

  private async fetchOne(task: PrefetchTask): Promise<void> {
    const ctrl = new AbortController();
    this.inFlight = { task, ctrl };
    try {
      // `priority` (Fetch Priority) aún no está en todos los lib.dom de TypeScript
      const init: RequestInit & { priority?: 'low' | 'high' | 'auto' } = { signal: ctrl.signal, credentials: 'same-origin', priority: 'low' };
      const res = await fetch(task.url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (task.kind === 'json') this.rememberScene(task.scene, await res.json());
      else await res.arrayBuffer(); // leerlo entero es lo que lo deja en la caché HTTP
      this.done.add(task.url);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        this.failed.add(task.url);
        console.warn(`[ScenePrefetcher] ${shortUrl(task.url)}: ${(err as Error).message}`);
      }
    } finally {
      if (this.inFlight?.ctrl === ctrl) this.inFlight = null;
    }
  }
}

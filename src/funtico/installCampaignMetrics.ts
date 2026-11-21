import { setPlatformHooks } from '@/platform/PlatformHooks';
import { CampaignMetrics, type CampaignMetricsJSON } from './CampaignMetrics';

/**
 * F3.1: instala el recolector de métricas de Campaign como ganchos de plataforma del juego. Lo llamará F3.2 al abrir un
 * expediente (capítulo `chapter`) y antes de arrancar GameScene; con `restore` (F3.3) sigue lo medido. Devuelve el
 * recolector, que también queda en `window.__funtico.metrics` (gancho de pruebas: solo existe en el build funtico,
 * porque este módulo solo lo importa código de `src/funtico/`).
 *
 * `uninstallCampaignMetrics()` deja los ganchos en el no-op.
 */
export function installCampaignMetrics(opts: { chapter?: number; restore?: CampaignMetricsJSON | null } = {}): CampaignMetrics {
  const metrics = opts.restore ? CampaignMetrics.restore(opts.restore) : new CampaignMetrics({ chapter: opts.chapter });
  if (opts.restore && opts.chapter !== undefined) metrics.startChapter(opts.chapter);
  setPlatformHooks(metrics);
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __funtico?: Record<string, unknown> };
    w.__funtico = { ...(w.__funtico ?? {}), metrics };
  }
  return metrics;
}

export function uninstallCampaignMetrics(): void {
  setPlatformHooks(null);
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __funtico?: Record<string, unknown> };
    if (w.__funtico) delete w.__funtico.metrics;
  }
}

/**
 * F3.1 (plan FUNTICO_ADVENTURE): banco de pruebas de Campaign (`funtico/campaign.html`, solo con
 * FUNTICO_CAMPAIGN_HARNESS=1). Instala el recolector de métricas ANTES de arrancar el juego y luego carga la entrada
 * normal (`src/main.ts`, que con `?qa=1` monta la API de QA del walkthrough). `?chapter=N` elige el capítulo que se mide
 * (por defecto el 1).
 *
 * Cómo lo conectará F3.2: el menú de Funtico (src/funtico/main.ts) hará lo mismo al abrir un expediente —
 * `installCampaignMetrics({ chapter })` y arrancar GameScene con el estado canónico del capítulo— en vez de esta página.
 */
import { installCampaignMetrics } from './installCampaignMetrics';

const ch = Number(new URLSearchParams(window.location.search).get('chapter') ?? '1');
installCampaignMetrics({ chapter: Number.isInteger(ch) && ch >= 1 && ch <= 5 ? ch : 1 });

void import('../main');

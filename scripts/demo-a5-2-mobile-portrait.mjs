// A5.2 (plan SCUMM): QA móvil en vertical (iPhone 390×844, DPR 3, táctil). Capítulo 1 con toques reales y
// auditoría de fuentes y zonas táctiles de la interfaz en cada escena. Lógica en scripts/lib/mobile-qa.mjs.
import { runMobileQa } from './lib/mobile-qa.mjs';

await runMobileQa(import.meta.url, 'portrait');

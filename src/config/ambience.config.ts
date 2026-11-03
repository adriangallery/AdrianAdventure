// Generado por scripts/audio/make-ambience.mjs (A4.4). No editar a mano: `node scripts/audio/make-ambience.mjs`.
// Cada bucle de assets/audio/ambience/<clave>.mp3 dura loopSec segundos y lleva AMBIENCE_PAD_SEC más del principio
// repetido al final (ver src/systems/Ambience.ts). `gain`: volumen relativo con el que suena.
export const AMBIENCE_PAD_SEC = 0.25;

export interface AmbienceLoopInfo {
  loopSec: number;
  gain: number;
}

export const AMBIENCE_LOOPS: Record<string, AmbienceLoopInfo> = {
  crickets: { loopSec: 16, gain: 0.55 },
  wind: { loopSec: 16, gain: 0.5 },
  server_hum: { loopSec: 16, gain: 0.45 },
  basement_drip: { loopSec: 16, gain: 0.45 },
  clinic_vent: { loopSec: 16, gain: 0.4 },
  office_hum: { loopSec: 16, gain: 0.35 },
  pool_water: { loopSec: 16, gain: 0.5 },
  lab_bubbles: { loopSec: 16, gain: 0.45 },
  dawn_birds: { loopSec: 16, gain: 0.5 },
};

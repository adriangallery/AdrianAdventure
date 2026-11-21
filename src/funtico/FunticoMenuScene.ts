/**
 * F1.2 (plan FUNTICO_ADVENTURE): arranque de Triage desde el menú y líneas de Hall of Fame. F1.5: la escena del menú
 * pasa a ser el lobby (lobby/LobbyScene.ts, misma clave 'FunticoMenuScene'); aquí quedan las funciones compartidas.
 */
import Phaser from 'phaser';
import type { FunticoBridge } from './FunticoBridge';
import { generateRun } from './triage/triage.js';
import type { TriageCatalog } from './triage/triage';
import catalog from './triage/catalog.json';
import { REG } from './ui';
import { fitName } from './fitName';

export function newSeed(): string {
  const fixed = new URLSearchParams(location.search).get('seed');
  if (fixed) return fixed;
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `local-${a[0].toString(36)}${a[1].toString(36)}`;
}

/**
 * Arranca una carrera de Triage (desde el menú o PLAY AGAIN). Simulado: semilla local (`?seed=` o aleatoria), sin
 * red. Live (F2.2): TriageStartScene pide la carrera al servidor (`run/start`) antes de jugar.
 */
export function startTriage(scene: Phaser.Scene): void {
  const bridge = scene.registry.get(REG.bridge) as FunticoBridge | undefined;
  if (bridge?.mode === 'live') {
    scene.scene.start('TriageStartScene');
    return;
  }
  const run = generateRun(newSeed(), catalog as unknown as TriageCatalog);
  scene.scene.start('TriageScene', { run, runId: null });
}

/** Líneas del Hall of Fame (posición, nombre recortado, puntos); el jugador marcado con «>». */
export function hofLines(list: Array<{ rank: number; displayName: string; totalPoints: number; userId: number }>, me: number, nameChars = 12): string {
  return list.map((e) => {
    const name = fitName(e.displayName, nameChars);
    return `${e.userId === me ? '>' : ' '}${String(e.rank).padStart(2)} ${name.padEnd(nameChars)} ${String(e.totalPoints).padStart(6)}`;
  }).join('\n');
}


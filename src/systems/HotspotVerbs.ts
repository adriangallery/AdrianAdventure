import type { HotspotData } from '@/types/scene.types';
import { Verb } from '@/types/game.types';

/** Operaciones que solo «hablan» o esperan: no cambian nada del juego. */
const FLAVOR_OPS = new Set(['say', 'sayBrief', 'ifFlag', 'wait', 'playSound']);

function opsOf(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const out: string[] = [];
  for (const o of steps as Array<Record<string, unknown>>) {
    if (!o || typeof o.op !== 'string') continue;
    out.push(o.op);
    for (const k of ['then', 'else', 'steps', 'script']) out.push(...opsOf(o[k]));
  }
  return out;
}

/** Verbos con respuesta escrita para este hotspot (aunque solo sea texto). */
export function scriptedVerbs(hotspot: HotspotData): Set<Verb> {
  return new Set(Object.keys(hotspot.scripts ?? {}).filter((v) => (hotspot.scripts[v] ?? []).length) as Verb[]);
}

/** Verbos cuyo script hace algo más que hablar (coger, abrir, cambiar de escena, flags…). */
export function realActionVerbs(hotspot: HotspotData): Set<Verb> {
  const out = new Set<Verb>();
  for (const [v, steps] of Object.entries(hotspot.scripts ?? {})) {
    if (opsOf(steps).some((op) => !FLAVOR_OPS.has(op))) out.add(v as Verb);
  }
  return out;
}

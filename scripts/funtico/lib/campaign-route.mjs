// F3.2a (plan FUNTICO_ADVENTURE): juega la ruta crítica del capítulo 1 (qa/walkthrough.json, `ruta-critica` cortada con
// `chapter:1`) en la página de un expediente (campaign.html?chapter=1&qa=1) con la API de QA, como scripts/walkthrough.mjs.
// Lo comparten campaign-metrics-e2e.mjs (F3.1), campaign-e2e.mjs y build-campaign-states.mjs (F3.2a).
//
// La página de Campaign entra directa al capítulo (sin MenuScene): el paso `newGame` de la ruta se sustituye por
// «esperar a la primera escena y dejar correr la apertura» (`dismissAll`, el mismo settle que hace newGame).
import { readFileSync } from 'node:fs';
import { check, cutRoute, parseUntil } from '../../lib/walkthrough-core.mjs';

export function chapter1Route() {
  const file = JSON.parse(readFileSync('qa/walkthrough.json', 'utf-8'));
  const route = cutRoute((file.routes ?? file).find((r) => r.id === 'ruta-critica'), parseUntil('chapter:1'));
  if (!route?.steps?.length) throw new Error('no hay ruta-critica en qa/walkthrough.json');
  return route;
}

export const callQa = (page, s) => page.evaluate(async (s) => {
  const q = window.__qa;
  switch (s.do) {
    case 'newGame': {
      // Campaign: el capítulo ya arranca solo; se espera a la escena y se deja correr la apertura
      const t0 = Date.now();
      while (!(window.__game?.scene.isActive('GameScene') && window.__game.scene.isActive('UIScene') && !window.__game.scene.isActive('PreloadScene'))) {
        if (Date.now() - t0 > 90_000) throw new Error('[qa:error] la primera escena no llega');
        await new Promise((r) => setTimeout(r, 200));
      }
      return q.dismissAll();
    }
    case 'act': return q.act(s.verb, s.target, s.choices ?? [], s.holdTextMs ?? 0);
    case 'use': return q.use(s.item, s.target, s.choices ?? []);
    case 'give': return q.give(s.item, s.target, s.choices ?? []);
    case 'pick': return q.pick(s.verb, s.item);
    case 'combine': return q.combine(s.items[0], s.items[1]);
    case 'talk': return q.talk(s.npc, s.choices ?? []);
    case 'walk': return q.walk(s.x, s.y);
    case 'dismissAll': return q.dismissAll();
    case 'state': return q.state();
    case 'key': return q.press(s.key, s.phase ?? 'press');
    case 'click': return q.click(s.target, s.choices ?? []);
    case 'rightclick': return q.rightClick(s.target, s.choices ?? []);
    case 'doubleclick': return q.doubleClick(s.target);
    case 'runScript': return q.runScript(s.ops, s.skipAfterMs !== undefined ? { skipAfterMs: s.skipAfterMs } : {});
    case 'journal': return s.action === 'close' ? q.closeJournal() : q.openJournal(s.tab ?? 'goals');
    case 'callAnon': return q.callAnon();
    case 'mockWeb3': return q.mockWeb3(s.web3 === undefined ? null : s.web3);
    default: throw new Error(`[qa:error] paso desconocido «${s.do}»`);
  }
}, s);

const lastCall = (page) => page.evaluate(() => window.__game.registry.get('journalLastCall') ?? null);

/**
 * Juega la ruta en `page` (ya en campaign.html?chapter=1&qa=1). `expect` de escena, inventario y flags: obligatorio
 * (a `problems`); el resto, aviso. Devuelve lo que vio QA (pistas, fallos) para comprobar las métricas.
 */
export async function playChapter1(page, route, problems, warnings, onStep = () => {}) {
  await page.waitForFunction(() => !!window.__qa && !!window.__funtico?.metrics, { timeout: 90_000, polling: 250 });
  let hints = 0;
  let hintMax = 0;
  let fails = 0;
  let prevFail = null;
  for (const [i, step] of route.steps.entries()) {
    const label = `${i + 1}/${route.steps.length} ${step.do} ${step.verb ?? ''} ${step.target ?? step.item ?? step.npc ?? ''}`.trim();
    let st;
    try {
      st = await callQa(page, step);
    } catch (err) {
      problems.push(`paso ${label}: ${String(err.message ?? err).split('\n')[0]}`);
      break;
    }
    if (step.do === 'callAnon') {
      const call = await lastCall(page);
      if (call && call.level >= 1) { hints++; hintMax = Math.max(hintMax, call.level); }
    }
    const fr = st?.lastFailResponse ?? null;
    const frKey = fr ? JSON.stringify(fr) : null;
    if (frKey && frKey !== prevFail && fr.verb !== 'LOOK') fails++;
    prevFail = frKey ?? prevFail;
    const e = step.expect ?? null;
    if (e) {
      const hard = check({ scene: e.scene, has: e.has, lacks: e.lacks, flags: e.flags, unsetFlags: e.unsetFlags }, st);
      let soft = [];
      try { soft = check(e, st, { pixelRefs: {} }).filter((x) => !hard.includes(x)); } catch (err) { soft = [`comprobación no aplicable aquí (${err.message})`]; }
      for (const x of hard) problems.push(`paso ${label}: ${x}`);
      for (const x of soft) warnings.push(`paso ${label}: ${x}`);
    }
    onStep({ step: label, scene: st?.scene, actions: st?.actions });
    if (problems.length) break;
  }
  return { hints, hintMax, fails };
}

/** Estado del juego y posición del jugador (en %) para el estado canónico del capítulo siguiente. */
export const snapshotForStates = (page) => page.evaluate(() => {
  const g = window.__game;
  const st = g.registry.get('gameState');
  const gs = g.scene.getScene('GameScene');
  const p = gs?.player;
  return { state: st ? JSON.parse(JSON.stringify(st)) : null, pos: p && Number.isFinite(p.pctX) ? { x: p.pctX, y: p.pctY } : null };
});

/** Errores de consola que no cuentan (audio, web3 apagado, favicon). */
export const IGNORE = [/AudioContext/i, /autoplay/i, /WalletConnect/i, /ethereum/i, /favicon/i, /Failed to load resource/i];

/** Hosts de Funtico: ninguna petición debe ir ahí en modo simulado. */
export const FUNTICO_HOST = /funtico\.(com|io|gg)/i;

// Demo de A7.3 (J-8 del buzón del jugador): iconos dibujados en vez de emojis. En este Chrome headless no hay fuente
// de emoji, así que se ve justo lo que vio el jugador: antes, cuadraditos vacíos; ahora, disquete, copa, altavoz…
// Captura en 390×844 y 844×390: la barra de arriba (guardar, copa, móvil), el aviso de sonido y el panel Save/Load.
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/lib/demo.mjs run a7-3-iconos
// Con DEMO_STRICT=0 no falla (sirve para capturar el «antes» sobre origin/main).
import { startDemo } from './lib/demo.mjs';
import * as SP from './lib/save-panel.mjs';

const VIEWPORTS = [
  { tag: 'vertical', width: 390, height: 844 },
  { tag: 'apaisado', width: 844, height: 390 },
];
const strict = process.env.DEMO_STRICT !== '0';
const demo = await startDemo(import.meta.url, {
  fps: 2, width: 640, viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const { page } = demo;
const problems = [];
const check = (cond, msg) => { if (!cond) { problems.push(msg); console.error(`✖ ${msg}`); } else console.log(`✔ ${msg}`); };

/** Caracteres pictográficos (emoji) en el texto visible de un selector: no debería haber ninguno. */
const emojiIn = (sel) => page.evaluate((s) => {
  const t = document.querySelector(s)?.textContent ?? '';
  return [...t.matchAll(/[\p{Extended_Pictographic}✓✕⚙☁✍↻]/gu)].map((m) => m[0]);
}, sel);

for (const vp of VIEWPORTS) {
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await SP.openGame(page, demo.base, 'outside');
  await demo.settle?.();
  await demo.sleep(1500);

  // 1) Barra de arriba: guardar (8..38) y copa (55..85), y el móvil del diario
  await demo.still(`${vp.tag}-barra`, { clip: { x: 0, y: 0, width: Math.min(vp.width, 200), height: 48 } });
  await demo.shot();
  const bar = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UIScene');
    const save = ui.saveButton?.bg?.getBounds?.();
    const trophy = ui.badgePanel?.trophyBtn?.list?.[0]?.getBounds?.();
    const tex = Object.keys(window.__game.textures.list).filter((k) => k.startsWith('ui-icon-'));
    return { save: save && { l: save.left, r: save.right }, trophy: trophy && { l: trophy.left, r: trophy.right }, tex };
  });
  check(bar.tex.includes('ui-icon-floppy@2') && bar.tex.includes('ui-icon-trophy@2'),
    `${vp.tag}: disquete y copa son texturas dibujadas (${bar.tex.join(', ') || 'ninguna'})`);
  if (bar.save && bar.trophy) check(bar.save.r <= bar.trophy.l, `${vp.tag}: guardar (${bar.save.l}-${bar.save.r}) y copa (${bar.trophy.l}-${bar.trophy.r}) no se solapan`);

  // 2) Aviso de sonido (el mismo modal que sale al pulsar Start/Continue en el menú)
  await page.evaluate(() => window.__game.scene.getScene('MenuScene').showAudioPrompt(null, () => {}));
  await page.evaluate(() => { const o = [...document.body.children].find((e) => /Enable Sound/.test(e.textContent ?? '')); if (o) o.id = 'demo-audio-prompt'; });
  await demo.sleep(300);
  await demo.still(`${vp.tag}-sonido`);
  await demo.shot();
  check((await emojiIn('#demo-audio-prompt')).length === 0, `${vp.tag}: aviso de sonido sin emojis`);
  check(await page.evaluate(() => document.querySelectorAll('#demo-audio-prompt svg.px-icon').length >= 3), `${vp.tag}: aviso de sonido con altavoz y botones dibujados`);
  await page.evaluate(() => document.getElementById('demo-audio-prompt')?.remove());

  // 3) Panel Save/Load (pestaña SAVE) y la de LOAD
  await SP.openPanel(page);
  await demo.sleep(300);
  await demo.still(`${vp.tag}-save`);
  await demo.shot();
  check((await emojiIn('#save-load-panel')).length === 0, `${vp.tag}: panel Save/Load sin emojis`);
  check(await page.evaluate(() => document.querySelectorAll('#save-load-panel svg.px-icon').length >= 6), `${vp.tag}: panel Save/Load con iconos dibujados`);
  await SP.tab(page, 'load');
  await demo.sleep(300);
  await demo.still(`${vp.tag}-load`);
  await demo.shot();
  await SP.closePanel(page);
}

await demo.end();
if (problems.length && strict) demo.fail(`${problems.length} comprobaciones fallidas`);

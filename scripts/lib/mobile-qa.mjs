// A5.2 (plan SCUMM): QA móvil en CI. Recorrido del capítulo 1 con viewport de iPhone (vertical u horizontal, táctil,
// DPR 3, UA de iPhone) y auditoría de legibilidad y zonas táctiles de la interfaz en cada escena.
//
// Lo usan `scripts/demo-a5-2-mobile-portrait.mjs` y `scripts/demo-a5-2-mobile-landscape.mjs` (job `demo`, artefacto
// `demo-gifs`): cada una deja su GIF, capturas `<escena>.png`, y `audit.json` con lo medido. La demo falla (y con ella
// el job) si algo de la interfaz baja de los umbrales de scripts/lib/mobile-audit.mjs sin excepción documentada, si
// algo se sale de la pantalla o si un toque real no hace lo que haría el dedo del jugador.
//
// Toques reales (`page.touchscreen.tap`): New Game no (lo pulsa __qa.newGame, igual que el walkthrough), pero sí el
// verbo del panel y el hotspot (LOOK), el botón del diario y el asa del panel (plegar y desplegar). El resto de la
// ruta va por la API de QA (`window.__qa`), con los mismos pasos que `qa/walkthrough.json` hasta entrar en el lobby.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDemo, sleep } from './demo.mjs';
import { IPHONE_UA, THRESHOLDS, VIEWPORTS, auditSnapshot, chapterSteps, offscreen, summarizeRow } from './mobile-audit.mjs';

export const SCENES = [
  'outside', 'lobby', 'upstairs', 'rooftop', 'basement', 'server_room', 'mountain', 'clinic_exterior',
  'clinic_interior', 'treatment_room', 'recovery_pool', 'memelab', 'epilogue_outside',
];

/** Mide en la página los textos e interactivos de la interfaz (UIScene, MenuScene, textos de GameScene y HTML). */
export function collect(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const rect = g.canvas.getBoundingClientRect();
    const k = rect.width / g.scale.width; // px CSS por px del juego
    const vw = innerWidth;
    const vh = innerHeight;
    const texts = [];
    const targets = [];
    const boxes = [];
    const onScreen = (b) => b.w > 0 && b.h > 0 && b.x + b.w > 0 && b.y + b.h > 0 && b.x < vw && b.y < vh;
    const labelOf = (o) => {
      if (o.type === 'Text') return o.text;
      if (o.name) return o.name;
      const sib = o.parentContainer?.list?.find((c) => c.type === 'Text' && c.text && c.visible);
      return sib ? sib.text : '';
    };
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    for (const key of ['MenuScene', 'UIScene', 'GameScene']) {
      const sc = g.scene.getScene(key);
      if (!sc || !sc.sys.isActive() || !sc.sys.isVisible()) continue;
      const cam = sc.cameras.main;
      const toScreen = (o, b) => {
        const sf = o.scrollFactorX ?? 1;
        const x = (b.x - cam.scrollX * sf - cam.worldView.x + cam.scrollX) * cam.zoom + cam.x;
        const y = (b.y - cam.scrollY * (o.scrollFactorY ?? 1) - cam.worldView.y + cam.scrollY) * cam.zoom + cam.y;
        return { x: rect.left + x * k, y: rect.top + y * k, w: b.width * cam.zoom * k, h: b.height * cam.zoom * k };
      };
      const walk = (list, scale, alpha) => {
        for (const o of list) {
          if (!o.visible || !o.active) continue;
          const a = alpha * (o.alpha ?? 1);
          if (a < 0.05) continue;
          const s = scale * Math.abs(o.scaleY ?? 1);
          if (o.type === 'Container') { walk(o.list, s, a); continue; }
          // En GameScene solo los textos (bocadillos, letreros de interfaz): los hotspots se miden aparte
          const isText = o.type === 'Text' && clean(o.text);
          const interactive = key !== 'GameScene' && o.input && o.input.enabled;
          if (!isText && !interactive) continue;
          let b;
          try { b = o.getBounds(); } catch { continue; }
          const box = toScreen(o, b);
          if (!onScreen(box)) continue;
          const id = `${key}:${o.type}:${clean(labelOf(o))}`;
          if (isText) {
            const fs = parseFloat(o.style?.fontSize) || 0;
            texts.push({ id, text: clean(o.text), px: fs * s * cam.zoom * k });
            boxes.push({ id, ...box });
          }
          if (interactive) {
            const ha = o.input.hitArea;
            let w = box.w;
            let h = box.h;
            if (ha && typeof ha.width === 'number' && typeof ha.height === 'number' && ha.width > 0) {
              const sx = scale * Math.abs(o.scaleX ?? 1);
              w = Math.max(w, ha.width * sx * cam.zoom * k);
              h = Math.max(h, ha.height * s * cam.zoom * k);
            } else if (ha && typeof ha.radius === 'number') {
              w = h = Math.max(w, ha.radius * 2 * s * cam.zoom * k);
            }
            targets.push({ id, label: clean(labelOf(o)), w, h });
            if (key === 'UIScene') boxes.push({ id: `${id}#hit`, ...box });
          }
        }
      };
      walk(sc.children.list, 1, 1);
    }
    // Paneles HTML (diario, menús, avisos)
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
      const r = el.getBoundingClientRect();
      const b = { x: r.left, y: r.top, w: r.width, h: r.height };
      return onScreen(b) ? b : null;
    };
    const domId = (el) => `DOM:${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      const clickable = el.matches('button, a[href], input, select, textarea, [role="button"], [onclick]')
        || getComputedStyle(el).cursor === 'pointer';
      if (!clean(own) && !clickable) continue;
      const b = visible(el);
      if (!b) continue;
      const id = `${domId(el)}:${clean(el.textContent)}`;
      if (clean(own)) texts.push({ id, text: clean(own), px: parseFloat(getComputedStyle(el).fontSize) || 0 });
      if (clickable) {
        // Un hijo pulsable dentro de otro pulsable: cuenta el de fuera (es la zona que recibe el dedo)
        const parentClickable = el.parentElement?.closest('button, a[href], [role="button"]');
        if (!parentClickable) targets.push({ id, label: clean(el.textContent), w: b.w, h: b.h });
      }
      boxes.push({ id, ...b });
    }
    return { k, viewport: { width: vw, height: vh }, texts, targets, boxes };
  });
}

/** Punto de pantalla (px CSS) del centro de un hotspot, o null si queda fuera de la vista o bajo el panel. */
export function hotspotPoint(page, id) {
  return page.evaluate((hid) => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const hs = gs.registry.get('sceneData')?.regions?.hotspots?.find((h) => h.id === hid);
    if (!hs) return null;
    const cam = gs.cameras.main;
    const c = gs.coordSystem.pctToScreen(hs.bounds.x + hs.bounds.w / 2, hs.bounds.y + hs.bounds.h / 2);
    const rect = g.canvas.getBoundingClientRect();
    const k = rect.width / g.scale.width;
    const x = (c.x - cam.worldView.x) * cam.zoom + cam.x;
    const y = (c.y - cam.worldView.y) * cam.zoom + cam.y;
    const panelTop = g.scale.height - (g.registry.get('scummPanelHeight') ?? 0);
    if (x < 4 || x > g.scale.width - 4 || y < 4 || y > panelTop - 4) return null;
    return { x: rect.left + x * k, y: rect.top + y * k };
  }, id);
}

/** Centro (px CSS) de un texto interactivo de UIScene cuyo texto cumple `re`. */
export function uiTextPoint(page, source) {
  return page.evaluate((src) => {
    const g = window.__game;
    const ui = g.scene.getScene('UIScene');
    const re = new RegExp(src, 'i');
    const rect = g.canvas.getBoundingClientRect();
    const k = rect.width / g.scale.width;
    const find = (list) => {
      for (const o of list) {
        if (!o.visible) continue;
        if (o.type === 'Container') { const r = find(o.list); if (r) return r; continue; }
        if (o.type === 'Text' && o.input?.enabled && re.test(o.text)) return o;
      }
      return null;
    };
    const o = find(ui.children.list);
    if (!o) return null;
    const b = o.getBounds();
    return { x: rect.left + b.centerX * k, y: rect.top + b.centerY * k };
  }, source);
}

const callQa = (page, s) => page.evaluate(async (step) => {
  const q = window.__qa;
  switch (step.do) {
    case 'newGame': return q.newGame();
    case 'act': return q.act(step.verb, step.target, step.choices ?? []);
    case 'use': return q.use(step.item, step.target, step.choices ?? []);
    case 'combine': return q.combine(step.items[0], step.items[1]);
    case 'talk': return q.talk(step.npc, step.choices ?? []);
    case 'walk': return q.walk(step.x, step.y);
    case 'dismissAll': return q.dismissAll();
    case 'journal': return step.action === 'close' ? q.closeJournal() : q.openJournal(step.tab ?? 'goals');
    case 'callAnon': return q.callAnon();
    case 'wait': await new Promise((r) => setTimeout(r, step.ms ?? 500)); return q.state();
    default: throw new Error(`[qa:error] paso no soportado en la QA móvil: ${step.do}`);
  }
}, s);

const waitReady = (page, timeout = 30000) => page.waitForFunction(() => window.__qa?.state?.().ready, { timeout, polling: 250 });

/**
 * Ejecuta la QA móvil en una orientación. `ref`: import.meta.url de la demo. Devuelve sin salir; la demo falla con
 * `demo.fail` si hay incumplimientos.
 */
export async function runMobileQa(ref, orientation) {
  const vp = VIEWPORTS[orientation];
  const viewport = { ...vp };
  delete viewport.isLandscape;
  const demo = await startDemo(ref, { fps: 2, width: orientation === 'portrait' ? 300 : 560, viewport });
  const { page } = demo;
  await page.setUserAgent(IPHONE_UA);
  const problems = [];
  const rows = [];
  const details = {};
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (n = 1) => { for (let i = 0; i < n; i++) await demo.shot(); };
  const settleTap = [Math.round(vp.width / 2), 60];

  const audit = async (label) => {
    await sleep(350);
    const snap = await collect(page);
    const a = auditSnapshot(snap, { orientation });
    const off = offscreen(snap.boxes, snap.viewport);
    const row = summarizeRow(label, orientation, a, { offscreen: off });
    rows.push(row);
    details[label] = { ...a, offscreen: off, canvasScale: snap.k };
    await demo.still(label);
    console.log(`[${orientation}] ${label}: fuente mín ${a.minFont ?? '-'} px · zona táctil mín ${a.minTouch ?? '-'} px · `
      + `${a.fontFails.length} fuentes < ${THRESHOLDS.minFontPx} · ${a.touchFails.length} zonas < ${THRESHOLDS.minTouchPx} · `
      + `${a.excepted.length} excepciones · ${off.length} fuera de pantalla`);
    for (const f of a.fontFails) console.log(`    FUENTE ${f.px}px  ${f.id}`);
    for (const f of a.touchFails) console.log(`    TÁCTIL ${f.w}×${f.h}  ${f.id}`);
    for (const f of off) console.log(`    FUERA ${JSON.stringify(f)}`);
    if (!row.ok) problems.push(`${label}: ${a.fontFails.length} fuentes, ${a.touchFails.length} zonas táctiles, ${off.length} fuera`);
    return a;
  };

  try {
    // ── 1. Menú
    await page.goto(`${demo.base}/?qa=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__qa && window.__game?.scene?.isActive('MenuScene'), { timeout: 90000, polling: 500 });
    await sleep(1500);
    await shot(2);
    await audit('menu');

    // ── 2. Capítulo 1 por la ruta crítica, con toques reales donde el jugador usaría el dedo
    const route = JSON.parse(readFileSync(new URL('../../qa/walkthrough.json', import.meta.url), 'utf8')).routes
      .find((r) => r.id === 'ruta-critica');
    const steps = chapterSteps(route, 'lobby');
    const touch = { verbTap: null, hotspotTap: null, journalTap: null, panelToggle: null };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (i === 1) {
        // Interfaz recién empezada la partida
        await audit('outside-inicio');
        // Toque real: asa del panel (plegar y desplegar)
        const handle = await page.evaluate(() => {
          const g = window.__game;
          const h0 = g.registry.get('scummPanelHeight');
          return { y: g.scale.height - h0 + 10, h0 };
        });
        await page.touchscreen.tap(Math.round(vp.width / 2), handle.y);
        await sleep(700);
        const h1 = await page.evaluate(() => window.__game.registry.get('scummPanelHeight'));
        await shot();
        await audit('outside-panel-plegado');
        await page.touchscreen.tap(Math.round(vp.width / 2), vp.height - Math.max(4, Math.round(h1 / 2)));
        await sleep(700);
        const h2 = await page.evaluate(() => window.__game.registry.get('scummPanelHeight'));
        touch.panelToggle = { before: handle.h0, folded: h1, after: h2, ok: h1 < handle.h0 && h2 === handle.h0 };
        console.log(`[${orientation}] asa del panel: ${JSON.stringify(touch.panelToggle)}`);
        if (!touch.panelToggle.ok) problems.push(`el asa del panel no pliega/despliega con el dedo: ${JSON.stringify(touch.panelToggle)}`);
        await shot();
        // Toque real: botón del diario → panel HTML → auditoría → cerrar
        const btn = await page.evaluate(() => {
          const g = window.__game;
          const c = g.scene.getScene('UIScene').getJournal().buttonCenter();
          const r = g.canvas.getBoundingClientRect();
          const k = r.width / g.scale.width;
          return { x: r.left + c.x * k, y: r.top + c.y * k };
        });
        await page.touchscreen.tap(btn.x, btn.y);
        const opened = await page.waitForFunction(() => !!document.getElementById('journal-overlay'), { timeout: 5000 }).then(() => true, () => false);
        touch.journalTap = { ...btn, ok: opened };
        if (opened) {
          await sleep(500);
          await shot(2);
          await audit('diario');
          await page.evaluate(() => window.__qa.closeJournal());
        } else problems.push('tocar el botón del diario no lo abrió');
        await shot();
      }
      if (s.do === 'act' && s.verb === 'LOOK' && s.target === 'hs_porch_light') {
        // Toque real: verbo del panel y después el hotspot
        await waitReady(page).catch(() => {});
        const vpt = await uiTextPoint(page, '^look');
        const hpt = await hotspotPoint(page, s.target);
        if (vpt && hpt) {
          await page.touchscreen.tap(vpt.x, vpt.y);
          await sleep(300);
          const verb = await page.evaluate(() => window.__qa.state().verb);
          const actionsBefore = await page.evaluate(() => window.__qa.state().actions);
          await page.touchscreen.tap(hpt.x, hpt.y);
          await sleep(1200);
          await shot(2);
          await audit('outside-texto');
          const st = await page.evaluate(() => window.__qa.dismissAll());
          // `actions`: verbos que llegaron a ejecutarse (contador de la API de QA)
          const did = (st.actions ?? 0) > actionsBefore;
          touch.verbTap = { ...vpt, verb, ok: /look/i.test(String(verb)) };
          touch.hotspotTap = { ...hpt, ok: did };
          console.log(`[${orientation}] toques reales: verbo ${JSON.stringify(touch.verbTap)} · hotspot ${JSON.stringify(touch.hotspotTap)}`);
          if (!touch.verbTap.ok) problems.push(`tocar el verbo Look dejó «${verb}»`);
          if (!did) problems.push(`tocar ${s.target} con LOOK no ejecutó la acción`);
          if (did) continue;
        } else {
          touch.verbTap = { ok: false, reason: vpt ? 'hotspot fuera de la vista' : 'verbo Look no encontrado' };
          problems.push(`no se pudo tocar con el dedo: ${touch.verbTap.reason}`);
        }
      }
      let st;
      try {
        st = await callQa(page, s);
      } catch (e) {
        problems.push(`paso ${i} (${s.do} ${s.verb ?? ''} ${s.target ?? s.npc ?? s.item ?? ''}): ${e.message.split('\n')[0]}`);
        break;
      }
      if (s.expect?.scene && st?.scene !== s.expect.scene) {
        problems.push(`paso ${i}: se esperaba la escena ${s.expect.scene} y está en ${st?.scene}`);
        break;
      }
      await shot();
    }
    const last = await page.evaluate(() => window.__qa.state().scene);
    console.log(`[${orientation}] capítulo 1 terminado en «${last}»`);
    if (last === 'lobby') { await shot(2); await audit('lobby-capitulo1'); }

    // ── 3. Cada escena con la interfaz desplegada (carga directa ?qa=1&scene=)
    for (const id of SCENES) {
      try {
        await demo.openScene(id);
        await demo.settle({ tap: settleTap, calm: 3, tries: 60, every: 600 });
        await waitReady(page, 20000).catch(() => {});
        await shot();
        await audit(id);
      } catch (e) {
        problems.push(`${id}: ${e.message.split('\n')[0]}`);
      }
    }
    // Diálogo con elecciones abierto en el lobby (Penny), sin responder
    try {
      await demo.openScene('lobby');
      await demo.settle({ tap: settleTap, calm: 3, tries: 60, every: 600 });
      await waitReady(page, 20000).catch(() => {});
      page.evaluate(() => window.__qa.talk('npc_receptionist', []).catch(() => {})).catch(() => {});
      await sleep(3500);
      await shot(2);
      await audit('lobby-dialogo');
    } catch (e) {
      problems.push(`lobby-dialogo: ${e.message.split('\n')[0]}`);
    }
    if (errors.length) problems.push(...errors.map((m) => `error de página: ${m}`));
    writeFileSync(join(demo.dir, 'audit.json'), JSON.stringify({ orientation, viewport: vp, thresholds: THRESHOLDS, touch, rows, details, problems }, null, 2));
    console.log('\n| escena | orientación | ok | fuente mín | táctil mín | fallos fuente | fallos táctil | excepciones | fuera |');
    for (const r of rows) console.log(`| ${r.scene} | ${r.orientation} | ${r.ok ? 'sí' : 'NO'} | ${r.minFont} | ${r.minTouch} | ${r.fontFails} | ${r.touchFails} | ${r.excepted} | ${r.offscreen} |`);
    console.log(`${demo.frames} fotogramas`);
  } catch (e) {
    problems.push(`excepción: ${e.stack ?? e.message}`);
  }
  await demo.end();
  if (problems.length) await demo.fail(`QA móvil ${orientation}: ${problems.length} problemas\n- ${problems.join('\n- ')}`);
}

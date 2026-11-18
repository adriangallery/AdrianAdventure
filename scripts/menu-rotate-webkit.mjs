// A9.20 (plan SCUMM): la portada (MenuScene) se recoloca al girar el iPhone. Playwright WebKit con emulación de iPhone:
// abre la portada en el viewport del job, la gira al contrario (390x844 ↔ 844x390) y la devuelve. Tras cada giro:
//   - el lienzo mide lo mismo que la ventana,
//   - el título, el subtítulo y todos los botones quedan enteros dentro del viewport,
//   - los botones no se solapan entre sí ni con el subtítulo,
//   - cada botón se puede tocar: en su centro el elemento de arriba es el lienzo y el input de Phaser da ese botón.
// Además simula lo que hace iOS al girar (el ScaleManager se queda con la medida vieja): fuerza el tamaño de la
// orientación anterior, lanza `orientationchange` y exige que la portada vuelva a medir la ventana sola.
// Al final, un toque real en «Leaderboard» tiene que abrir el panel.
//
// Uso: BASE_URL=http://127.0.0.1:4173 node scripts/menu-rotate-webkit.mjs [--viewport 390x844]
import { engineFromArgs } from './lib/browser.mjs';

const { viewport } = engineFromArgs([...process.argv.slice(2), '--browser', 'webkit']);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const failures = [];
const fail = (m) => { failures.push(m); console.log(`  ✖ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

let pw;
try { pw = await import('playwright'); } catch {
  console.error('falta playwright: npm i --no-save playwright && npx playwright install --with-deps webkit');
  process.exit(2);
}
const browser = await pw.webkit.launch({ headless: true });
const iphone = pw.devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, viewport, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  (pageerror) ${e.message}`));

const swapped = { width: viewport.height, height: viewport.width };
const label = (v) => `${v.width}x${v.height}`;

/** Cajas (en px CSS de la página) de lo que hay en la portada, y lo que dice el input de Phaser en el centro de cada botón. */
const measure = () => page.evaluate(() => {
  const g = window.__game;
  const scene = g.scene.getScene('MenuScene');
  const r = g.canvas.getBoundingClientRect();
  const sx = r.width / g.scale.width;
  const sy = r.height / g.scale.height;
  const box = (o) => {
    const b = o.getBounds();
    return { name: o.name, x: r.left + b.x * sx, y: r.top + b.y * sy, w: b.width * sx, h: b.height * sy };
  };
  const list = scene.children.list;
  const buttons = list.filter((o) => o.name?.startsWith('menu-btn-') && o.visible);
  const cam = scene.cameras.main;
  const interactive = list.filter((o) => o.input?.enabled);
  const btns = buttons.map((o) => {
    const b = box(o);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const top = document.elementFromPoint(cx, cy);
    let hit = null;
    try {
      const hits = g.input.hitTest({ x: (cx - r.left) / sx, y: (cy - r.top) / sy }, interactive, cam, []);
      hit = hits.map((h) => h.name);
    } catch (e) { hit = `error: ${e.message}`; }
    return { ...b, topIsCanvas: top === g.canvas, topTag: top ? `${top.tagName}#${top.id}` : null, hit };
  });
  const title = list.find((o) => o.name === 'menu-title');
  const subtitle = list.find((o) => o.name === 'menu-subtitle');
  return {
    win: { w: window.innerWidth, h: window.innerHeight },
    scale: { w: g.scale.width, h: g.scale.height },
    buttons: btns,
    title: title ? box(title) : null,
    subtitle: subtitle ? box(subtitle) : null,
  };
});

const overlaps = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const inside = (b, W, H) => b.x >= -1 && b.y >= -1 && b.x + b.w <= W + 1 && b.y + b.h <= H + 1;
const fmt = (b) => `${b.name} (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)})`;

function check(m, tag) {
  const before = failures.length;
  const { w: W, h: H } = m.win;
  if (Math.abs(m.scale.w - W) <= 1 && Math.abs(m.scale.h - H) <= 1) ok(`${tag}: lienzo ${m.scale.w}x${m.scale.h} = ventana`);
  else fail(`${tag}: lienzo ${m.scale.w}x${m.scale.h} ≠ ventana ${W}x${H} (la portada no volvió a medir)`);
  if (m.buttons.length < 2) fail(`${tag}: solo ${m.buttons.length} botón(es) en la portada`);
  for (const b of [m.title, m.subtitle, ...m.buttons].filter(Boolean)) {
    if (!inside(b, W, H)) fail(`${tag}: ${fmt(b)} se sale del viewport ${W}x${H}`);
  }
  if (!m.title) fail(`${tag}: no está el título (menu-title)`);
  for (let i = 0; i < m.buttons.length; i++) {
    for (let j = i + 1; j < m.buttons.length; j++) {
      if (overlaps(m.buttons[i], m.buttons[j])) fail(`${tag}: se solapan ${fmt(m.buttons[i])} y ${fmt(m.buttons[j])}`);
    }
    if (m.subtitle && overlaps(m.buttons[i], m.subtitle)) fail(`${tag}: ${fmt(m.buttons[i])} pisa el subtítulo ${fmt(m.subtitle)}`);
  }
  for (const b of m.buttons) {
    if (!b.topIsCanvas) fail(`${tag}: en el centro de ${b.name} manda ${b.topTag}, no el lienzo`);
    else if (!Array.isArray(b.hit) || !b.hit.includes(b.name)) fail(`${tag}: el input de Phaser no da ${b.name} en su centro (${JSON.stringify(b.hit)})`);
  }
  if (failures.length === before) ok(`${tag}: título y ${m.buttons.length} botones dentro, sin solaparse y pulsables (${m.buttons.map((b) => b.name.replace('menu-btn-', '')).join(', ')})`);
}

const settle = () => page.waitForTimeout(900);

async function rotateTo(v) {
  await page.setViewportSize(v);
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await settle();
}

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__game?.scene?.isActive('MenuScene') && window.__game.scene.getScene('MenuScene').children?.getByName?.('menu-btn-new-game'), null, { timeout: 120000, polling: 500 });
  await settle();

  check(await measure(), `inicio ${label(viewport)}`);
  await rotateTo(swapped);
  check(await measure(), `giro a ${label(swapped)}`);
  await rotateTo(viewport);
  check(await measure(), `vuelta a ${label(viewport)}`);

  // Como iOS: el giro llega con la medida vieja al ScaleManager. La portada tiene que volver a medir la ventana sola.
  await page.setViewportSize(swapped);
  await settle();
  await page.evaluate(({ w, h }) => {
    window.__game.scale.resize(w, h);
    window.dispatchEvent(new Event('orientationchange'));
  }, { w: viewport.width, h: viewport.height });
  await settle();
  check(await measure(), `giro a ${label(swapped)} con medida vieja (iOS)`);

  // Toque real en Leaderboard tras los giros: abre el panel
  const lb = (await measure()).buttons.find((b) => b.name === 'menu-btn-leaderboard');
  if (!lb) fail('no está el botón Leaderboard');
  else {
    await page.touchscreen.tap(lb.x + lb.w / 2, lb.y + lb.h / 2);
    try {
      await page.locator('#leaderboard-overlay').waitFor({ state: 'visible', timeout: 5000 });
      ok('un toque real en «Leaderboard» tras girar abre el panel');
    } catch {
      fail('un toque real en «Leaderboard» tras girar no abre el panel');
    }
  }
} catch (e) {
  fail(`la prueba no terminó: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\nA9.20 giro de la portada en WebKit: ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log('\nA9.20 giro de la portada en WebKit: OK');

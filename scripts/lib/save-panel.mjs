// A1.12 (plan SCUMM): ayudas de Chrome (puppeteer) para probar el panel de guardar/cargar en el smoke y en la demo.
// La nube NUNCA es la real: `installCloudMock` sustituye `fetch` hacia save.zerothetoken.com por un servidor en memoria
// (persistido en localStorage para sobrevivir a la recarga) y la wallet se simula con `__qa.fakeWallet` (?qa=1).

export const QA_ADDR = '0x00000000000000000000000000000000000a1120';
const PANEL = '#save-load-panel';

/** Antes de cargar la página: `fetch` a save.zerothetoken.com → servidor en memoria (exige firma como el real). */
export async function installCloudMock(page) {
  await page.evaluateOnNewDocument(() => {
    const realFetch = window.fetch.bind(window);
    const HOST = 'https://save.zerothetoken.com';
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith(HOST)) return realFetch(input, init);
      const db = JSON.parse(localStorage.getItem('__qa_cloud') || '{}');
      const log = JSON.parse(localStorage.getItem('__qa_cloud_log') || '[]');
      const method = (init.method || 'GET').toUpperCase();
      const path = new URL(url).pathname;
      log.push(`${method} ${path}`);
      localStorage.setItem('__qa_cloud_log', JSON.stringify(log));
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      await new Promise((r) => setTimeout(r, 250));
      if (method === 'POST' && path === '/save') {
        const b = JSON.parse(init.body);
        const fail = JSON.parse(localStorage.getItem('__qa_cloud_fail') || 'null');
        if (fail && fail.slot === b.slot) {
          localStorage.removeItem('__qa_cloud_fail');
          return json(fail.status, { error: 'mock failure' });
        }
        if (!b.authSignature || !b.authTimestamp) return json(401, { error: 'Wallet signature required' });
        if (![0, 1, 2].includes(b.slot) || !/^0x[0-9a-f]{40}$/.test(b.address)) return json(400, { error: 'Invalid params' });
        const { authSignature, authTimestamp, ...rest } = b;
        void authSignature; void authTimestamp;
        db[`${b.address}:${b.slot}`] = { ...rest, signature: null, savedAt: Date.now() };
        localStorage.setItem('__qa_cloud', JSON.stringify(db));
        return json(200, { ok: true, address: b.address, slot: b.slot });
      }
      const m = path.match(/^\/save\/(0x[0-9a-f]{40})(?:\/(\d))?$/);
      if (method === 'GET' && m) {
        if (m[2] !== undefined) {
          const hit = db[`${m[1]}:${m[2]}`];
          return hit ? json(200, hit) : json(404, { error: 'No save found' });
        }
        const slots = {};
        for (const s of [0, 1, 2]) if (db[`${m[1]}:${s}`]) slots[s] = db[`${m[1]}:${s}`];
        return json(200, { address: m[1], slots });
      }
      if (path === '/leaderboard') return json(200, { total: 0, players: [] });
      return json(404, { error: 'mock: not found' });
    };
  });
}

/** La próxima subida al slot `slot` de la nube falla con `status`. */
export const failNextCloudSave = (page, slot, status = 500) =>
  page.evaluate((v) => localStorage.setItem('__qa_cloud_fail', JSON.stringify(v)), { slot, status });
export const cloudDb = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('__qa_cloud') || '{}'));

/** Escena abierta con ?qa=1 y GameScene activa. */
export async function openGame(page, base, scene = 'outside') {
  await page.goto(`${base}/?qa=1&scene=${scene}`, { waitUntil: 'domcontentloaded' });
  await waitInGame(page, scene);
}

export async function waitInGame(page, scene, timeout = 90000) {
  await page.waitForFunction(
    (id) => !!window.__qa && window.__game?.scene?.isActive('GameScene') && window.__game?.scene?.isActive('UIScene')
      && (!id || window.__game.registry.get('currentSceneId') === id),
    { timeout, polling: 300 }, scene ?? null,
  );
}

/** Cambia la partida en memoria (flags e inventario) para distinguir guardados. */
export const mark = (page, flag, item) => page.evaluate((f, it) => {
  const gs = window.__game.registry.get('gameState');
  gs.flags[f] = true;
  if (it && !gs.inventory.some((i) => i.id === it)) gs.inventory.push({ id: it, name: it, icon: null, fromNFT: false });
}, flag, item ?? null);

/** Lo esencial de la partida en memoria. */
export const gameSnap = (page) => page.evaluate(() => {
  const gs = window.__game.registry.get('gameState');
  return { scene: gs?.currentScene, flags: Object.keys(gs?.flags ?? {}).filter((k) => gs.flags[k]).sort(), inv: (gs?.inventory ?? []).map((i) => i.id).sort() };
});

export const localSlot = (page, id) => page.evaluate((n) => JSON.parse(localStorage.getItem('adrian_adventure_save') || '{}')[n] ?? null, id);

/** Abre el panel como el disquete (sin depender de dónde cae el botón en el lienzo). */
export async function openPanel(page) {
  await page.evaluate(() => window.__game.scene.getScene('UIScene').saveButton.showMenu());
  await page.waitForSelector(`${PANEL} [data-tab]`, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#save-status[data-kind="busy"]'), { timeout: 20000, polling: 200 });
}
export const closePanel = (page) => page.evaluate(() => document.getElementById('save-load-overlay')?.remove());

const press = async (page, sel) => {
  await page.waitForSelector(sel, { timeout: 15000 });
  const touch = await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (touch) await page.tap(sel); else await page.click(sel);
};
export const tab = (page, mode) => press(page, `${PANEL} button[data-tab="${mode}"]`);
export const tapSlot = (page, id) => press(page, `${PANEL} button[data-slot="${id}"]`);
export const confirm = (page, yes = true) => press(page, `${PANEL} .save-confirm button[data-confirm="${yes ? 'yes' : 'no'}"]`);
export const panelAction = (page, id) => press(page, `${PANEL} button[data-action="${id}"]`);
export const confirmText = (page) => page.evaluate(() => document.querySelector('#save-load-panel .save-confirm')?.textContent ?? null);
export const slotText = (page, id) => page.evaluate((n) => document.querySelector(`#save-load-panel button[data-slot="${n}"]`)?.textContent ?? null, id);
export const activeTab = (page) => page.evaluate(() => document.querySelector('#save-load-panel button[data-tab][aria-selected="true"]')?.dataset.tab ?? null);

/** Espera a que el estado del panel deje de ser «busy» y lo devuelve ({ kind, text }). */
export async function waitStatus(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const s = document.querySelector('#save-status');
    return s && s.dataset.kind !== 'busy';
  }, { timeout, polling: 150 });
  return page.evaluate(() => {
    const s = document.querySelector('#save-status');
    return { kind: s.dataset.kind, text: s.textContent };
  });
}

/** Medidas del panel: que quepa en la ventana y que los botones se puedan tocar (≥ 44 px de alto). */
export const panelLayout = (page) => page.evaluate(() => {
  const p = document.querySelector('#save-load-panel').getBoundingClientRect();
  const small = [...document.querySelectorAll('#save-load-panel button')]
    .map((b) => ({ t: b.textContent.slice(0, 24), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }))
    .filter((b) => b.h < 44 || b.w < 44);
  return { vw: innerWidth, vh: innerHeight, left: p.left, right: p.right, top: p.top, bottom: p.bottom, small };
});

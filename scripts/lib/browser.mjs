// A9.5 (plan SCUMM): elegir motor para el smoke y el walkthrough. Por defecto Chromium con puppeteer, EXACTAMENTE como
// antes (se devuelve el navegador de puppeteer sin envolver). Con `--browser webkit` o `BROWSER=webkit`, Playwright
// WebKit con emulación táctil de iPhone, envuelto para que hable el subconjunto de la API de puppeteer que usan los
// scripts (createBrowserContext, setViewport, waitForFunction con varios argumentos, evaluateOnNewDocument,
// touchscreen, mouse, keyboard, eventos de consola/red).
//
// Playwright NO es dependencia del proyecto: el job `webkit` del CI lo instala sin tocar el lockfile
// (`npm i --no-save playwright` + `npx playwright install --with-deps webkit`).
//
// Lo que WebKit no tiene en Playwright (CDP: `res.fromCache()`, métricas de GPU) no se emula: los pasos que lo necesitan
// se marcan como solo-Chromium en el script que los usa.

/** Valor de `--<name> x` o `--<name>=x` en argv (y lo quita de la lista), o undefined. */
export function takeFlag(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const m = new RegExp(`^--${name}(?:=(.*))?$`).exec(argv[i]);
    if (!m) continue;
    const v = m[1] ?? argv[i + 1];
    argv.splice(i, m[1] !== undefined ? 1 : 2);
    return v;
  }
  return undefined;
}

/** `"390x844"` → `{ width: 390, height: 844 }`; lanza si no vale. */
export function parseViewport(s) {
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/.exec(String(s ?? ''));
  if (!m) throw new Error(`viewport «${s}» no vale: tiene que ser ANCHOxALTO (p. ej. 390x844)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Motor y viewport pedidos: `--browser`/`BROWSER` (chromium | webkit) y `--viewport`/`BROWSER_VIEWPORT` (solo cuenta en
 * WebKit: el viewport de iPhone con el que se abren todos los contextos; por defecto 390x844). Quita los flags de argv.
 */
export function engineFromArgs(argv, env = process.env) {
  const engine = String(takeFlag(argv, 'browser') ?? env.BROWSER ?? 'chromium').toLowerCase();
  if (!['chromium', 'webkit'].includes(engine)) throw new Error(`--browser «${engine}» no vale: chromium o webkit`);
  const viewport = parseViewport(takeFlag(argv, 'viewport') ?? env.BROWSER_VIEWPORT ?? '390x844');
  return { engine, viewport };
}

// WebKit avisa con un error de página («… due to access control checks.») de cada fetch que corta una navegación: la
// precarga de escenas (ScenePrefetcher, mismo origen, ya captura el aborto) bajando cuando el script hace page.goto.
// Es de la herramienta (un jugador no navega a media precarga) y no se cuenta como fallo; se dice en el log.
export const WEBKIT_NAV_ABORT = /due to access control checks\.?$/;
let navAborts = 0;
export const webkitNavAborts = () => navAborts;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Varios argumentos (puppeteer) → uno solo (Playwright): se pasa el código de la función y se reconstruye en la página
const multi = ([src, args]) => (0, eval)(`(${src})`)(...args);

function wrapResponse(res) {
  if (!res) return res;
  return new Proxy(res, {
    get(t, k) {
      if (k === 'fromCache') return () => false; // sin CDP: no se sabe (los pasos que lo miran son solo-Chromium)
      if (k === 'buffer') return () => t.body();
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
function wrapRequest(req) {
  return new Proxy(req, {
    get(t, k) {
      if (k === 'response') return async () => wrapResponse(await t.response());
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

function wrapPage(page) {
  const handlers = new Map();
  const over = {
    async setViewport(vp) { await page.setViewportSize({ width: vp.width, height: vp.height }); },
    evaluate(fn, ...args) {
      if (typeof fn !== 'function' || args.length <= 1) return page.evaluate(fn, args[0]);
      return page.evaluate(multi, [fn.toString(), args]);
    },
    waitForFunction(fn, opts = {}, ...args) {
      const o = { timeout: opts.timeout ?? 30000, polling: opts.polling ?? 'raf' };
      if (typeof fn !== 'function' || args.length <= 1) return page.waitForFunction(fn, args[0], o);
      return page.waitForFunction(multi, [fn.toString(), args], o);
    },
    evaluateOnNewDocument(fn, arg) { return page.addInitScript(fn, arg); },
    on(event, handler) {
      let h = handler;
      if (event === 'pageerror') {
        h = (err) => {
          if (WEBKIT_NAV_ABORT.test(String(err?.message ?? ''))) {
            if (navAborts++ === 0) console.log(`    (WebKit: fetch cortado por la navegación, no cuenta: ${String(err.message).slice(0, 120)})`);
            return;
          }
          handler(err);
        };
      } else if (event === 'console') h = (msg) => handler(new Proxy(msg, { get: (t, k) => (k === 'type' ? () => (t.type() === 'warning' ? 'warn' : t.type()) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) }));
      else if (event === 'response') h = (res) => handler(wrapResponse(res));
      else if (event === 'request' || event === 'requestfinished') h = (req) => handler(wrapRequest(req));
      handlers.set(handler, h);
      page.on(event, h);
      return proxy;
    },
    off(event, handler) { page.off(event, handlers.get(handler) ?? handler); return proxy; },
    async waitForSelector(sel, opts = {}) { return page.waitForSelector(sel, { state: 'attached', ...opts }); },
    async waitForTimeout(ms) { await sleep(ms); },
  };
  const proxy = new Proxy(page, {
    get(t, k) {
      if (k in over) return over[k];
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return proxy;
}

/**
 * Lanza el navegador. `puppeteerOpts` son las de siempre de cada script (solo se usan con Chromium). En WebKit, cada
 * contexto es un iPhone: UA de Safari de iOS, `isMobile`, `hasTouch`, DPR 3 y el viewport pedido.
 */
export async function launchBrowser({ engine = 'chromium', viewport = { width: 390, height: 844 }, puppeteerOpts = {} } = {}) {
  if (engine === 'chromium') {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch(puppeteerOpts);
  }
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('falta playwright: npm i --no-save playwright && npx playwright install --with-deps webkit');
  }
  const browser = await pw.webkit.launch({ headless: true });
  const iphone = pw.devices['iPhone 13'];
  const ctxOpts = {
    ...iphone,
    viewport,
    screen: { width: Math.min(viewport.width, viewport.height), height: Math.max(viewport.width, viewport.height) },
    deviceScaleFactor: Number(process.env.WEBKIT_DPR || iphone.deviceScaleFactor || 3),
    isMobile: true,
    hasTouch: true,
  };
  const wrapContext = (ctx) => ({
    raw: ctx,
    async newPage() { return wrapPage(await ctx.newPage()); },
    close: () => ctx.close(),
  });
  return {
    engine: 'webkit',
    viewport,
    async createBrowserContext() { return wrapContext(await browser.newContext(ctxOpts)); },
    async newPage() { return wrapPage(await (await browser.newContext(ctxOpts)).newPage()); },
    close: () => browser.close(),
    version: () => browser.version(),
  };
}

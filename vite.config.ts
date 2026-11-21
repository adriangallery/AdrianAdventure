import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';
import { brandHtml } from './src/config/branding';

/** Dev-only plugin: saves scene JSON and global config from the hotspot editor */
function editorSavePlugin(): Plugin {
  return {
    name: 'editor-save',
    configureServer(server) {
      // Save scene.json
      server.middlewares.use('/__editor_save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const sceneId = url.searchParams.get('scene');
        if (!sceneId || !/^[a-z_]+$/.test(sceneId)) { res.statusCode = 400; res.end('Bad scene id'); return; }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            JSON.parse(body); // validate
            const filePath = path.resolve(__dirname, 'assets', 'scenes', sceneId, 'scene.json');
            fs.writeFileSync(filePath, body + '\n', 'utf-8');
            res.statusCode = 200;
            res.end('OK');
          } catch (e) {
            res.statusCode = 400;
            res.end('Invalid JSON');
          }
        });
      });

      // Save global config
      server.middlewares.use('/__editor_save_global', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            JSON.parse(body); // validate
            const filePath = path.resolve(__dirname, 'assets', 'config', 'global.json');
            fs.writeFileSync(filePath, body + '\n', 'utf-8');
            res.statusCode = 200;
            res.end('OK');
          } catch (e) {
            res.statusCode = 400;
            res.end('Invalid JSON');
          }
        });
      });
    },
  };
}

/**
 * A2.7: `vite preview` (smoke, walkthrough y demos del CI) con las mismas cabeceras de caché que nginx.conf en
 * producción: /assets/ un año e immutable (las URLs llevan ?v=<build>), index.html y version.txt sin caché. Sin
 * esto preview manda `no-cache` y cada imagen precargada se revalida al entrar en la escena.
 */
function previewCacheHeadersPlugin(): Plugin {
  return {
    name: 'preview-cache-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (url === '/' || url === '/index.html' || url === '/version.txt') res.setHeader('Cache-Control', 'no-store, max-age=0');
        next();
      });
    },
  };
}

/** A9.4: nombre y web del juego en index.html, desde src/config/branding.ts (un solo sitio) */
function brandingPlugin(): Plugin {
  return {
    name: 'branding',
    transformIndexHtml: { order: 'pre', handler: (html) => brandHtml(html) },
  };
}

/**
 * A9.18: el juego llama al save-server por `/save-api/<ruta>` (mismo origen; en producción lo sirve el proxy del mini).
 * En `vite dev` y `vite preview` (smoke, walkthrough y demos del CI) esa ruta no existe y el fallback SPA devolvería
 * index.html con 200: se reenvía al proxy de producción conservando la ruta, como antes se llamaba al save-server real.
 */
const SAVE_API_PROXY = {
  '/save-api': { target: 'https://adventure.adrianzero.com', changeOrigin: true, secure: true },
};

const BUILD_HASH = Date.now().toString(36);

/** Replace __BUILD__ in index.html, expose as define constant, and write version.txt */
function buildHashPlugin(): Plugin {
  // F0.1: version.txt va al outDir de la build (dist/ en la normal, dist-funtico/ con --mode funtico)
  let outDir = path.resolve(__dirname, 'dist');
  return {
    name: 'build-hash',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return html.replace('__BUILD__', BUILD_HASH);
    },
    writeBundle() {
      // Write version.txt to the outDir so the cache buster can fetch it
      const distPath = path.join(outDir, 'version.txt');
      fs.writeFileSync(distPath, BUILD_HASH + '\n', 'utf-8');
    },
  };
}

/**
 * F0.1 (plan FUNTICO_ADVENTURE): build aparte para Funtico, `vite build --mode funtico` → dist-funtico/. Su entrada es
 * funtico/index.html (index.html y src/main.ts no cambian); nginx la sirve en `/`, así que el HTML sale en la raíz
 * del outDir (`dist-funtico/index.html`, no `dist-funtico/funtico/index.html`).
 */
const FUNTICO_MODE = 'funtico';
const FUNTICO_HTML = 'funtico/index.html';
/**
 * F3.1/F3.2a: página de un expediente de Campaign (`campaign.html?chapter=N`: el juego entero con el recolector de
 * métricas y las claves de guardado de Campaign). F3.2a: entra siempre en el build funtico (se abre desde el mapa del
 * menú); antes solo con FUNTICO_CAMPAIGN_HARNESS=1.
 */
const FUNTICO_CAMPAIGN_HTML = 'funtico/campaign.html';

/**
 * Sube funtico/index.html a la raíz del outDir. Vite escribe las rutas del HTML relativas a su carpeta
 * (`../assets/…` con base './'); al subirlo un nivel pasan a `./assets/…`. En `vite --mode funtico` sirve
 * esa entrada en `/` (el juego pide sus assets relativos a la página).
 */
function funticoRootHtmlPlugin(): Plugin {
  return {
    name: 'funtico-root-html',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [p, q] = (req.url ?? '').split('?');
        if (p === '/' || p === '/index.html') req.url = '/' + FUNTICO_HTML + (q !== undefined ? '?' + q : '');
        next();
      });
    },
    generateBundle(_options, bundle) {
      const hoist = (from: string, to: string) => {
        const html = bundle[from];
        if (!html || html.type !== 'asset') this.error(`no se ha generado ${from}`);
        if (bundle[to]) this.error(`ya hay un ${to} en la raíz del build`);
        const src = typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString('utf-8');
        html.source = src.replace(/(\s(?:src|href)=["'])\.\.\//g, '$1./');
        html.fileName = to;
        delete bundle[from];
        bundle[to] = html;
      };
      hoist(FUNTICO_HTML, 'index.html');
      // F3.1/F3.2a: la página de Campaign, también en la raíz (el juego pide sus assets relativos a la página)
      hoist(FUNTICO_CAMPAIGN_HTML, 'campaign.html');
    },
  };
}

export default defineConfig(({ mode }) => {
  const funtico = mode === FUNTICO_MODE;
  return {
    plugins: [
      brandingPlugin(), editorSavePlugin(), buildHashPlugin(), previewCacheHeadersPlugin(),
      ...(funtico ? [funticoRootHtmlPlugin()] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      open: true,
      host: true, // Expose on LAN (0.0.0.0)
      proxy: SAVE_API_PROXY,
    },
    preview: {
      proxy: SAVE_API_PROXY,
    },
    define: {
      __BUILD_HASH__: JSON.stringify(BUILD_HASH),
      // F0.1: IS_FUNTICO de src/config/platform.ts. En el build normal se sustituye por `false` y las ramas se van.
      __IS_FUNTICO__: JSON.stringify(funtico),
    },
    base: './',
    build: {
      outDir: funtico ? 'dist-funtico' : 'dist',
      sourcemap: true,
      // A9.17: /stats es una entrada aparte (su JS no entra en el bundle del juego)
      // F0.1: el build funtico solo tiene su propia entrada (sin el juego normal ni /stats)
      rollupOptions: {
        input: funtico
          ? {
            funtico: path.resolve(__dirname, FUNTICO_HTML),
            campaign: path.resolve(__dirname, FUNTICO_CAMPAIGN_HTML),
          }
          : {
            main: path.resolve(__dirname, 'index.html'),
            stats: path.resolve(__dirname, 'stats/index.html'),
          },
      },
    },
  };
});

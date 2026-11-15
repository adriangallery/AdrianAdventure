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

const BUILD_HASH = Date.now().toString(36);

/** Replace __BUILD__ in index.html, expose as define constant, and write version.txt */
function buildHashPlugin(): Plugin {
  return {
    name: 'build-hash',
    transformIndexHtml(html) {
      return html.replace('__BUILD__', BUILD_HASH);
    },
    writeBundle() {
      // Write version.txt to dist so the cache buster can fetch it
      const distPath = path.resolve(__dirname, 'dist', 'version.txt');
      fs.writeFileSync(distPath, BUILD_HASH + '\n', 'utf-8');
    },
  };
}

export default defineConfig({
  plugins: [brandingPlugin(), editorSavePlugin(), buildHashPlugin(), previewCacheHeadersPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    host: true, // Expose on LAN (0.0.0.0)
  },
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
  },
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // A9.17: /stats es una entrada aparte (su JS no entra en el bundle del juego)
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        stats: path.resolve(__dirname, 'stats/index.html'),
      },
    },
  },
});

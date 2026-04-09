import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

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

const BUILD_HASH = Date.now().toString(36);

/** Replace __BUILD__ in index.html and expose as define constant */
function buildHashPlugin(): Plugin {
  return {
    name: 'build-hash',
    transformIndexHtml(html) {
      return html.replace('__BUILD__', BUILD_HASH);
    },
  };
}

export default defineConfig({
  plugins: [editorSavePlugin(), buildHashPlugin()],
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
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

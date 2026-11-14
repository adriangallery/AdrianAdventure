// A9.4 (plan SCUMM): un solo nombre del juego y una sola web, en src/config/branding.ts. index.html no puede importar
// TypeScript: lleva marcadores (%GAME_NAME%…) que vite.config.ts cambia con `brandHtml`; aquí se comprueba que no queda
// ningún nombre escrito a mano en index.html, la portada ni los créditos, y que el cambio de marcadores es completo.
// CI (Node 22): node --experimental-strip-types --test tests/branding.test.mjs (va en `npm run test:engine`)
// BRANDING_PATH permite apuntar a una copia ya transpilada a JS (Node sin type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { BRANDING, brandHtml, brandUrl, brandPlaceholders } = await import(process.env.BRANDING_PATH ?? '../src/config/branding.ts');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Nombres y webs que el juego ha usado (A9.4: lista para que Adrián elija); ninguno escrito a mano en estos ficheros */
const OLD_NAMES = [/ZEROadventure/i, /Z E R O a d v e n t u r e/i, /zeroadventures\.com/i];

test('la marca tiene nombre, web sin protocolo y subtítulo', () => {
  assert.ok(BRANDING.name.trim().length > 0);
  assert.match(BRANDING.web, /^[a-z0-9.-]+\.[a-z]{2,}$/i);
  assert.equal(brandUrl(), `https://${BRANDING.web}`);
  assert.ok(BRANDING.tagline.length > 0);
});

test('index.html: título, carga y metas salen de branding.ts (marcadores), sin nombre escrito a mano', () => {
  const html = read('index.html');
  for (const re of OLD_NAMES) assert.doesNotMatch(html, re);
  assert.match(html, /<title>%GAME_NAME%<\/title>/);
  assert.match(html, /<h1>%GAME_NAME%<\/h1>/);
  assert.match(html, /content="%GAME_URL%"/);
  const out = brandHtml(html);
  assert.doesNotMatch(out, /%GAME_[A-Z]+%/, 'queda algún marcador sin cambiar');
  const esc = (s) => s.replace(/&/g, '&#38;');
  assert.ok(out.includes(`<title>${esc(BRANDING.name)}</title>`));
  assert.ok(out.includes(`<h1>${esc(BRANDING.name)}</h1>`));
  assert.ok(out.includes(`content="https://${BRANDING.web}"`));
});

test('vite.config.ts aplica brandHtml a index.html', () => {
  const cfg = read('vite.config.ts');
  assert.match(cfg, /import \{ brandHtml \} from '\.\/src\/config\/branding'/);
  assert.match(cfg, /brandingPlugin\(\)/);
  assert.match(cfg, /brandHtml\(html\)/);
});

test('brandHtml escapa el nombre (un «&» o unas comillas no rompen el HTML)', () => {
  const out = brandHtml('<title>%GAME_NAME%</title><meta content="%GAME_NAME%">', { name: 'Tom & "Jerry"', web: 'a.com', tagline: 't' });
  assert.equal(out, '<title>Tom &#38; &#34;Jerry&#34;</title><meta content="Tom &#38; &#34;Jerry&#34;">');
  assert.deepEqual(Object.keys(brandPlaceholders()).sort(), ['%GAME_NAME%', '%GAME_TAGLINE%', '%GAME_URL%', '%GAME_WEB%']);
});

test('portada y créditos usan BRANDING, sin nombre ni web escritos a mano', () => {
  const credits = read('src/ui/CinematicOverlay.ts');
  const menu = read('src/scenes/MenuScene.ts');
  for (const src of [credits, menu]) {
    assert.match(src, /import \{ BRANDING \} from '@\/config\/branding'/);
    for (const re of OLD_NAMES) assert.doesNotMatch(src, re);
  }
  assert.match(credits, /BRANDING\.name/);
  assert.match(credits, /BRANDING\.web/);
  assert.match(menu, /BRANDING\.tagline/);
});

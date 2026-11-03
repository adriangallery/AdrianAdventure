#!/usr/bin/env node
// A0.4 (plan SCUMM): linter de contenido de escenas. Node puro (20/22), ESM, sin dependencias.
//
//   node scripts/lint-scenes.mjs [--strict] [--json] [--scene <id>] [--root <dir>] [--no-write]
//
// Recorre assets/scenes/<id>/scene.json y aplica diez reglas:
//   a  flags que se leen y nunca se ponen, o que se ponen y nunca se leen
//   b  objetos que se consiguen (addItem) y no sirven para nada
//   c  salidas (fadeToScene/gotoScene) en hotspots y triggers sin gate, para revisar a mano
//   d  operaciones de estado después de un say/sayBrief en el mismo bloque
//   e  spawns fuera de walkableAreas o dentro de blockedAreas (A2.1) (en la escena destino; ERROR desde A1.8, el aviso
//      sin walkableAreas sigue siendo aviso)
//   f  sprites, fondos, audio, escenas y diálogos referenciados que no existen (ERROR por defecto)
//   g  hotspots solapados (aviso fuerte si uno que va antes en la lista tapa entero a otro)
//   h  diario (A2.9, assets/journal/chapter-<n>.json): fichero inválido o mal formado y `journalNote` a una nota que no
//      existe = ERROR; flags que el diario lee y nada pone, u objetos que lee y nada da = aviso
//   i  densidad de píxel (A2.8, aviso): `scale` a mano en npcs[] o `player.playerScale` (lo sustituye la unidad de
//      píxel de la escena), y `pixelScale`, `depthScale` o `npcs[].artScale` fuera de rango. Rangos: los de
//      src/systems/PixelScale.ts (pixelScale 1-12, factores de depthScale 0,2-2 con yTop < yBottom en 0-100,
//      artScale 0,25-4); se repiten aquí porque el linter corre en Node sin type stripping
//   j  respuestas de fallo (A2.5, src/systems/FailResponses.ts): `useResponses` de un hotspot o `useResponses`/
//      `giveResponses` de una NPC con un objeto que no existe, bolsa vacía o con una frase con marcador ({item}, ${…}:
//      sin voz), y assets/config/fail-responses.json inválido (bolsas de verbo con < 3 frases, objeto + objeto con < 5,
//      parejas mal formadas o con objetos que no existen) = ERROR; objeto del inventario con < 3 frases de mal uso
//      (`items.<id>`) y pareja de un hotspot que es un combo (nunca se dice) = aviso. «Objeto que existe» = lo da un
//      addItem de una escena, sale en ScummUI.ITEM_DESCS o en un addItem('…') de src/
//   k  animación ambiental (A4.3, src/systems/Ambient.ts): `ambient[]` de la escena con un elemento mal definido (sin id,
//      id repetido, kind desconocido, `when` mal escrito, sin `area`/`at`/`floorY` cuando su tipo lo pide, valores fuera
//      de rango, más de AMBIENT_MAX_PER_SCENE) y op `ambient` que nombra un elemento que no está en esa escena = ERROR;
//      escena con menos de 2 elementos válidos = aviso (A4.3 pide al menos 2 por escena). Las `when` del ambiente cuentan
//      como lecturas de flags (a) y usos de objetos (b). Los tipos y topes se repiten aquí (el linter corre sin type
//      stripping) y tests/lint-scenes.test.mjs comprueba que coinciden con Ambient.ts
//
// Por defecto (f), los spawns fuera de zona de (e), el diario mal formado de (h) y los errores de (j) y (k) son error; el resto, aviso. --strict lo convierte todo en error. Código de salida 1
// solo si hay errores. Escribe lint-scenes-report.json y lint-scenes-report.md en la raíz del repo.
// Excepciones con motivo en qa/lint-scenes-allow.json: [{ "rule": "c", "scene": "x", "id": "y", "reason": "…" }]
// (`id` compara con el id del hallazgo o con su ruta; admite `*` al final como prefijo).
//
// Fuentes de verdad (cómo resuelve el motor cada cosa; si cambia el código, cambia aquí):
//   - Opcodes y campos: src/systems/ScriptEngine.ts. setFlag{flag,value}, addItem{id}, removeItem{id},
//     ifHasItem{id}, ifFlag{flag}, gotoScene/fadeToScene{sceneId,spawn}, playSound{key}, dialogue{treeId},
//     flicker{overlay} (A1.4: parpadeo de un conditionalOverlays[].id de la MISMA escena, sin tocar flags).
//     journalNote{id} (A2.9: nota del diario, assets/journal; ver regla h) y callAnon (sin campos).
//     ambient{id, action} (A4.3: fuerza o lanza una ráfaga de un ambient[].id de la MISMA escena, sin tocar flags).
//     Bloques anidados: then/else (if*, web3Require), onSuccess/onFail (mintNFT, mintAchievement).
//   - Flags: escriben setFlag y dialogues…choices[].setFlag (DialogueSystem). Leen ifFlag, hideWhenFlag,
//     showWhenFlag, conditionalOverlays[].flag, choices[].flag y cameraEffect.disableFlag (GameScene). Las
//     conditionalOverlays NO escriben. Una flag nombrada en src/ (entre comillas o como flags.x) cuenta como
//     «usada en código» en los dos sentidos (ChapterManager, BadgePanel, ScummUI, GameScene…), salvo
//     TrailerScene.ts, que es un tráiler falso. Patrones dinámicos del motor: chapter_<n>_intro_shown y
//     chapter_<n>_complete (ChapterManager). `visited` no es una flag (ifVisited lee GameState.visited).
//   - Objetos: se usan en combos[].items, ifHasItem, removeItem, npcs[].giveResponses/useResponses,
//     qa/walkthrough.json y qa/sequence-breaks.json (pasos use/combine) y en src/ (p. ej. ScummUI abre el
//     sobre y se pone el disfraz), salvo PreloadScene.ts y TrailerScene.ts, que solo listan iconos.
//   - Rutas (PreloadScene.ts, MusicManager.ts, NPC.ts, ScummUI.ts):
//       fondo        assets/scenes/<id>/background.webp (el motor ignora el nombre de assets.background)
//       primer plano assets/scenes/<id>/foreground.webp si assets.foreground está declarado
//       walkmask     ningún sistema la carga (MaskSystem no se usa): si falta es solo aviso
//       web3Visuals  assets/scenes/<id>/<sprite>.png (defaultSprite y variants[].sprite)
//       overlays     assets/scenes/<id>/<sprite>.<format|png>
//       música       assets/audio/music/<music>.mp3
//       playSound    assets/audio/sfx/<key>.mp3 y la clave en la lista sfxKeys de PreloadScene (si no, no suena)
//       icono objeto assets/sprites/items/<id>.png y el id en itemIds de PreloadScene (si no, emoji/letra)
//       NPC          textura = id del NPC; PreloadScene carga npc_<x> de assets/sprites/npcs/<x>.png
//       escena       assets/scenes/<sceneId>/scene.json
//       diálogo      dialogues[treeId] de la MISMA escena (UIScene.startDialogueFromScene)
//   - Diálogos (A2.6, src/systems/DialogueSystem.ts), como errores de (f): `start`, `next` de nodos y elecciones que
//     apunten a nodos que existen; elecciones sin `next` solo si son salidas (`exit: true`); `when` (nodos y
//     elecciones) con la sintaxis de CONDITION_RE (`flag`, `!flag`, `flag:x`, `item:id`, `!item:id`);
//     npcs[].itemDialogues con árbol de la misma escena (`tree` o el dialogueTreeId de la NPC) y `node` dentro de
//     él. Para (a) y (b): `when` lee flags y usa objetos; itemDialogues usa su objeto y escribe su `setFlag`.
//   - Diario (A2.9, src/systems/Journal.ts): un JSON por capítulo con chapter (entero, sin repetir), goals[{id, text,
//     doneWhen}], notes[{id, text, shownWhen?}], puzzles[{id, openWhen?, doneWhen, hints: 3 textos}], anonIdle[textos].
//     Ids sin repetir (por tipo) en todos los ficheros; condiciones con la sintaxis de CONDITION_RE. Las flags que lee el
//     diario cuentan como leídas para (a) (una flag que solo mira el diario ya no es «se pone y nunca se lee"); el op
//     journalNote{id} tiene que nombrar una nota del diario.
//   - Caminable: Player.isWalkablePct → isWalkableIn de src/systems/Pathfinding.ts (rectángulos de walkableAreas,
//     bordes incluidos, menos los de blockedAreas, bordes incluidos también; sin walkableAreas se anda por todas partes). Hotspots: GameScene.hitTestAt manda el PRIMER hotspot de la lista que contiene el punto.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = {
  a: 'flags',
  b: 'objetos sin uso',
  c: 'salidas sin gate',
  d: 'estado tras say',
  e: 'spawns fuera de zona',
  f: 'assets inexistentes',
  g: 'hotspots solapados',
  h: 'diario',
  i: 'densidad de píxel',
  j: 'respuestas de fallo',
  k: 'ambiente',
};

// A2.5: mismos mínimos que src/systems/FailResponses.ts (tests/lint-scenes.test.mjs comprueba que coinciden)
export const FAIL_MIN = { item: 3, verb: 3, itemItem: 5 };
export const FAIL_VERBS = ['LOOK', 'USE', 'TALK', 'PICK', 'OPEN', 'CLOSE', 'PUSH', 'PULL', 'GIVE'];
export const FAIL_FILE = 'assets/config/fail-responses.json';
/** ¿Lleva marcador o interpolación? (igual que FailResponses.hasMarker) */
export const hasMarker = (t) => /\$\{|\{[^{}]*\}/.test(t);

/** A2.5: defectos de una bolsa (frase suelta o lista) de useResponses/giveResponses o de fail-responses.json. */
export function bagDefects(bag, { listOnly = false, min = 1 } = {}) {
  if (typeof bag === 'string' && !listOnly) bag = [bag];
  if (!Array.isArray(bag)) return [listOnly ? 'tiene que ser una lista de frases' : 'tiene que ser una frase o una lista de frases'];
  const out = [];
  if (!bag.length) out.push('bolsa vacía');
  bag.forEach((t, i) => {
    if (typeof t !== 'string' || !/[A-Za-z0-9]/.test(t)) out.push(`[${i}] no es una frase`);
    else if (hasMarker(t)) out.push(`[${i}] lleva marcador o interpolación («${t.slice(0, 40)}»): no tendría voz`);
  });
  if (bag.length && bag.length < min) out.push(`${bag.length} frase(s), mínimo ${min}`);
  return out;
}

/** A2.5: ids de ScummUI.ITEM_DESCS (objetos con descripción) en el texto del fichero. */
export function itemDescIds(text) {
  const at = (text ?? '').indexOf('ITEM_DESCS: Record<string, string> = {');
  if (at < 0) return [];
  const end = text.indexOf('\n  };', at);
  return [...text.slice(at, end < 0 ? undefined : end).matchAll(/^\s+([a-z0-9_]+):\s*["'`]/gm)].map((m) => m[1]);
}

// A2.8: mismos rangos que src/systems/PixelScale.ts (tests/lint-scenes.test.mjs comprueba que coinciden)
export const PIXEL_RANGES = { pixelScale: [1, 12], depthFactor: [0.2, 2], artScale: [0.25, 4] };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;

/** A2.8: defectos de un depthScale ({yTop, yBottom, scaleTop, scaleBottom}); vacío = válido */
export function depthScaleDefects(d) {
  if (!d || typeof d !== 'object') return ['tiene que ser un objeto {yTop, yBottom, scaleTop, scaleBottom}'];
  const missing = ['yTop', 'yBottom', 'scaleTop', 'scaleBottom'].filter((k) => !isNum(d[k]));
  if (missing.length) return missing.map((k) => `${k} no es un número`);
  const out = [];
  if (d.yTop < 0 || d.yBottom > 100) out.push('yTop/yBottom fuera de 0-100');
  if (!(d.yTop < d.yBottom)) out.push('yTop tiene que ser menor que yBottom');
  for (const k of ['scaleTop', 'scaleBottom']) {
    if (!inRange(d[k], PIXEL_RANGES.depthFactor)) out.push(`${k} = ${d[k]} fuera de ${PIXEL_RANGES.depthFactor.join('-')}`);
  }
  return out;
}

// A4.3: mismos tipos y topes que src/systems/Ambient.ts (tests/lint-scenes.test.mjs comprueba que coinciden)
export const AMBIENT_KINDS = ['moths', 'dust', 'leds', 'fog', 'clouds', 'flicker', 'glow', 'scan', 'rise', 'drip', 'birds', 'sway'];
export const AMBIENT_MAX_COUNT = 200;
export const AMBIENT_MAX_PER_SCENE = 24;
export const AMBIENT_ACTIONS = ['on', 'off', 'auto', 'burst'];
const AMBIENT_NEEDS_AREA = new Set(['dust', 'fog', 'clouds', 'flicker', 'glow', 'scan', 'rise', 'birds']);
const AMBIENT_NEEDS_AT = new Set(['moths', 'drip']);
const AMBIENT_BLENDS = ['normal', 'add', 'screen', 'multiply'];
const AMBIENT_NUM_RANGES = {
  depth: [-10, 100], alpha: [0, 1], alphaMin: [0, 1], count: [0, AMBIENT_MAX_COUNT], size: [0.5, 2000], speed: [0, 20], period: [16, 600000],
  radius: [0.1, 50], parallax: [0, 1], burst: [0, AMBIENT_MAX_COUNT], cols: [1, 64], rows: [1, 64], amplitude: [0, 200],
};
const ambientRect = (v) => !!v && typeof v === 'object' && ['x', 'y', 'w', 'h'].every((k) => isNum(v[k])) && v.w > 0 && v.h > 0 && v.x >= -10 && v.y >= -10 && v.x + v.w <= 110 && v.y + v.h <= 110;
const ambientPoint = (v) => !!v && typeof v === 'object' && isNum(v.x) && isNum(v.y) && v.x >= -10 && v.x <= 110 && v.y >= -10 && v.y <= 110;
const ambientColor = (v) => (isNum(v) && Number.isInteger(v) && v >= 0 && v <= 0xffffff) || (typeof v === 'string' && /^(?:#|0x)?[0-9a-fA-F]{6}$/.test(v.trim()));

/**
 * A4.3: validación de `ambient[]` de una escena, la misma que hace parseAmbient de src/systems/Ambient.ts (un elemento con
 * defectos se salta en el juego). Devuelve { ok: [{ id, kind, when: {ok, bad} }], problems: [texto] }.
 */
export function ambientDefects(raw, sceneId = 'scene') {
  const ok = [];
  const problems = [];
  if (raw === undefined || raw === null) return { ok, problems };
  if (!Array.isArray(raw)) return { ok, problems: [`${sceneId}.ambient tiene que ser una lista`] };
  const ids = new Set();
  raw.forEach((o, i) => {
    const where = `${sceneId}.ambient[${i}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) { problems.push(`${where}: no es un objeto`); return; }
    const id = typeof o.id === 'string' && /^[a-z0-9_]+$/i.test(o.id) ? o.id : null;
    if (!id) { problems.push(`${where}: sin id (letras, números y _)`); return; }
    if (ids.has(id)) { problems.push(`${where}: id «${id}» repetido`); return; }
    if (!AMBIENT_KINDS.includes(o.kind)) { problems.push(`${where} (${id}): kind «${String(o.kind)}» desconocido (${AMBIENT_KINDS.join(', ')})`); return; }
    const bad = [];
    const when = parseWhen(o.when);
    if (when.bad.length) bad.push(`when «${when.bad.join('», «')}» no válido (flag, !flag, item:id, !item:id)`);
    for (const [k, [lo, hi]] of Object.entries(AMBIENT_NUM_RANGES)) {
      if (o[k] !== undefined && !(isNum(o[k]) && o[k] >= lo && o[k] <= hi)) bad.push(`${k} = ${JSON.stringify(o[k])} fuera de ${lo}-${hi}`);
    }
    if (o.floorY !== undefined && !(isNum(o.floorY) && o.floorY >= 0 && o.floorY <= 110)) bad.push('floorY fuera de 0-110');
    if (o.color !== undefined && !ambientColor(o.color)) bad.push(`color ${JSON.stringify(o.color)} no válido (#rrggbb)`);
    if (o.colors !== undefined && !(Array.isArray(o.colors) && o.colors.length && o.colors.every(ambientColor))) bad.push('colors tiene que ser una lista de #rrggbb');
    if (o.blend !== undefined && !AMBIENT_BLENDS.includes(o.blend)) bad.push(`blend «${String(o.blend)}» no válido (${AMBIENT_BLENDS.join(', ')})`);
    if (o.shape !== undefined && o.shape !== 'rect' && o.shape !== 'ellipse') bad.push('shape tiene que ser rect o ellipse');
    if (o.soft !== undefined && typeof o.soft !== 'boolean') bad.push('soft tiene que ser true o false');
    if (o.area !== undefined && !ambientRect(o.area)) bad.push('area tiene que ser {x, y, w, h} en % (w, h > 0)');
    if (o.at !== undefined && !ambientPoint(o.at)) bad.push('at tiene que ser {x, y} en %');
    if (o.cells !== undefined && !(Array.isArray(o.cells) && o.cells.length && o.cells.length <= AMBIENT_MAX_COUNT && o.cells.every(ambientPoint))) bad.push(`cells tiene que ser una lista de {x, y} (máx. ${AMBIENT_MAX_COUNT})`);
    const hasArea = o.area !== undefined && ambientRect(o.area);
    const hasAt = o.at !== undefined && ambientPoint(o.at);
    if (AMBIENT_NEEDS_AREA.has(o.kind) && !hasArea) bad.push(`${o.kind} necesita area`);
    if (AMBIENT_NEEDS_AT.has(o.kind) && !hasAt) bad.push(`${o.kind} necesita at`);
    if (o.kind === 'drip' && o.floorY === undefined) bad.push('drip necesita floorY');
    if (o.kind === 'drip' && hasAt && isNum(o.floorY) && o.floorY <= o.at.y) bad.push('drip: floorY tiene que estar por debajo de at.y');
    if (o.kind === 'leds' && o.cells === undefined && !hasArea) bad.push('leds necesita cells o area (con cols y rows)');
    if (o.kind === 'leds' && hasArea && o.cells === undefined && (o.cols ?? 1) * (o.rows ?? 1) > AMBIENT_MAX_COUNT) bad.push(`leds: cols × rows > ${AMBIENT_MAX_COUNT}`);
    if (isNum(o.alphaMin) && isNum(o.alpha) && o.alphaMin > o.alpha) bad.push('alphaMin tiene que ser ≤ alpha');
    if (bad.length) { problems.push(`${where} (${id}): ${bad.join('; ')}`); return; }
    ids.add(id);
    ok.push({ id, kind: o.kind, when });
  });
  if (ok.length > AMBIENT_MAX_PER_SCENE) problems.push(`${sceneId}.ambient: ${ok.length} elementos, máximo ${AMBIENT_MAX_PER_SCENE} (se usan los primeros)`);
  return { ok: ok.slice(0, AMBIENT_MAX_PER_SCENE), problems };
}

const NESTED_KEYS = ['then', 'else', 'onSuccess', 'onFail'];
const CONDITIONAL_OPS = new Set(['ifFlag', 'ifHasItem', 'ifVisited', 'ifWalletConnected', 'web3Require', 'mintNFT']);
const GOTO_OPS = new Set(['gotoScene', 'fadeToScene']);
const SAY_OPS = new Set(['say', 'sayBrief']);
const STATE_OPS = new Set(['setFlag', 'addItem', 'removeItem', 'gotoScene', 'fadeToScene', 'achievement', 'mintAchievement', 'setCostume']);
const DYNAMIC_FLAGS = [/^chapter_\d+_intro_shown$/, /^chapter_\d+_complete$/];
const SRC_SKIP_FLAGS = new Set(['TrailerScene.ts']);
const SRC_SKIP_ITEMS = new Set(['TrailerScene.ts', 'PreloadScene.ts']);

// ─── Carga desde disco ─────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Saca los strings de `const <name> = [ ... ];` de un fichero TS (listas de precarga de PreloadScene). */
export function parseStringArray(text, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(text ?? '');
  if (!m) return null;
  return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
}

/** Pasos use/combine de las rutas de QA: objetos que la partida usa de verdad. */
function qaItemUses(routesFile) {
  const uses = new Set();
  if (!fs.existsSync(routesFile)) return uses;
  const data = readJson(routesFile);
  for (const r of data.routes ?? []) {
    for (const s of r.steps ?? []) {
      if (s.do === 'use' && s.item) uses.add(s.item);
      if (s.do === 'combine') for (const it of s.items ?? []) uses.add(it);
    }
  }
  return uses;
}

/** Proyecto real: escenas, ficheros de src/, rutas de QA y un `exists` sobre el disco del repo. */
export function loadProject(root) {
  const scenesDir = path.join(root, 'assets', 'scenes');
  const scenes = {};
  const loadErrors = [];
  for (const id of fs.existsSync(scenesDir) ? fs.readdirSync(scenesDir).sort() : []) {
    const f = path.join(scenesDir, id, 'scene.json');
    if (!fs.existsSync(f)) continue;
    try {
      scenes[id] = readJson(f);
    } catch (err) {
      loadErrors.push({ scene: id, message: `scene.json no es JSON válido: ${err.message}` });
    }
  }
  const srcFiles = listTs(path.join(root, 'src')).map((f) => ({
    file: path.relative(root, f).split(path.sep).join('/'),
    text: fs.readFileSync(f, 'utf8'),
  }));
  const preloadText = srcFiles.find((f) => f.file.endsWith('scenes/PreloadScene.ts'))?.text;
  // A2.9: diario, un JSON por capítulo
  const journalDir = path.join(root, 'assets', 'journal');
  const journal = [];
  for (const name of fs.existsSync(journalDir) ? fs.readdirSync(journalDir).filter((f) => f.endsWith('.json')).sort() : []) {
    const file = `assets/journal/${name}`;
    try {
      journal.push({ file, data: readJson(path.join(journalDir, name)) });
    } catch (err) {
      journal.push({ file, data: null, error: `no es JSON válido: ${err.message}` });
    }
  }
  // A2.5: respuestas de fallo globales
  const failFile = path.join(root, FAIL_FILE);
  let failResponses = null;
  if (fs.existsSync(failFile)) {
    try {
      failResponses = { data: readJson(failFile) };
    } catch (err) {
      failResponses = { data: null, error: `no es JSON válido: ${err.message}` };
    }
  }
  const qaUses = new Set([
    ...qaItemUses(path.join(root, 'qa', 'walkthrough.json')),
    ...qaItemUses(path.join(root, 'qa', 'sequence-breaks.json')),
  ]);
  return {
    scenes,
    loadErrors,
    srcFiles,
    journal,
    failResponses,
    qaUses,
    preload: {
      items: parseStringArray(preloadText, 'itemIds'),
      npcs: parseStringArray(preloadText, 'npcIds'),
      sfx: parseStringArray(preloadText, 'sfxKeys'),
    },
    exists: (rel) => fs.existsSync(path.join(root, rel)),
  };
}

// ─── Recorrido de scripts ──────────────────────────────────────

/**
 * Todos los bloques de script de una escena con su dueño. `gated` = el dueño solo se activa tras un gate
 * (gate web3 o showWhenFlag). `kind` distingue hotspot/trigger (los que cuentan para la regla c).
 */
function scriptContainers(sceneId, s) {
  const out = [];
  const add = (kind, owner, label, ops, gated = false) => {
    if (Array.isArray(ops)) out.push({ scene: sceneId, kind, owner, label, ops, gated });
  };
  add('onEnter', 'onEnter', 'onEnter', s.onEnter);
  for (const hs of s.regions?.hotspots ?? []) {
    const gated = !!hs.gate || !!hs.showWhenFlag;
    for (const [verb, ops] of Object.entries(hs.scripts ?? {})) add('hotspot', hs.id, `${hs.id}.${verb}`, ops, gated);
    add('gateFallback', hs.id, `${hs.id}.gateFallback`, hs.gateFallback);
  }
  for (const tr of s.regions?.triggers ?? []) add('trigger', tr.id, `${tr.id}.onEnter`, tr.onEnter, !!tr.gate);
  for (const it of s.items?.sceneItems ?? []) add('item', it.id, `${it.id}.pickupScript`, it.pickupScript, !!it.gate);
  for (const c of s.combos ?? []) {
    const key = (c.items ?? []).join('+');
    add('combo', key, `combo(${key})`, c.script, true);
  }
  for (const [treeId, tree] of Object.entries(s.dialogues ?? {})) {
    for (const [nodeId, node] of Object.entries(tree?.nodes ?? {})) {
      add('dialogue', treeId, `dialogues.${treeId}.${nodeId}.onEnter`, node?.onEnter);
    }
  }
  return out;
}

/** Visita cada op (ramas incluidas). fn(op, path, condDepth, block, index). */
function walkOps(ops, base, fn, condDepth = 0) {
  if (!Array.isArray(ops)) return;
  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') return;
    const p = `${base}[${i}]`;
    fn(op, p, condDepth, ops, i);
    const inner = condDepth + (CONDITIONAL_OPS.has(op.op) ? 1 : 0);
    for (const k of NESTED_KEYS) if (Array.isArray(op[k])) walkOps(op[k], `${p}.${k}`, fn, inner);
  });
}

/**
 * Visita cada bloque lineal (el raíz y cada then/else/onSuccess/onFail). fn(block, path, sayBefore):
 * `sayBefore` = en el orden de ejecución ya hubo un say/sayBrief antes de entrar en este bloque (en un bloque
 * padre, antes del op que abre la rama).
 */
function walkBlocks(ops, base, fn, sayBefore = false) {
  if (!Array.isArray(ops)) return;
  fn(ops, base, sayBefore);
  let said = sayBefore;
  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') return;
    for (const k of NESTED_KEYS) if (Array.isArray(op[k])) walkBlocks(op[k], `${base}[${i}].${k}`, fn, said);
    if (SAY_OPS.has(op.op)) said = true;
  });
}

/** A2.6a: misma sintaxis que CONDITION_RE de src/systems/DialogueSystem.ts */
export const CONDITION_RE = /^(!?)(?:(flag|item):)?([A-Za-z0-9_.-]+)$/;
const conditionList = (when) => (when === undefined || when === null ? [] : Array.isArray(when) ? when : [when]);
/** Condiciones válidas de un `when`: [{ kind: 'flag'|'item', name, negated }]; las mal escritas van en `bad`. */
export function parseWhen(when) {
  const ok = [];
  const bad = [];
  for (const raw of conditionList(when)) {
    const m = typeof raw === 'string' ? CONDITION_RE.exec(raw.trim()) : null;
    if (m) ok.push({ kind: m[2] === 'item' ? 'item' : 'flag', name: m[3], negated: m[1] === '!' });
    else bad.push(raw);
  }
  return { ok, bad };
}

/** Nodos de diálogo de una escena: { treeId, tree, nodeId, node, where }. */
function dialogueNodes(s) {
  const out = [];
  for (const [treeId, tree] of Object.entries(s.dialogues ?? {})) {
    for (const [nodeId, node] of Object.entries(tree?.nodes ?? {})) out.push({ treeId, tree, nodeId, node, where: `dialogues.${treeId}.${nodeId}` });
  }
  return out;
}

function dialogueChoices(s) {
  const out = [];
  for (const [treeId, tree] of Object.entries(s.dialogues ?? {})) {
    for (const [nodeId, node] of Object.entries(tree?.nodes ?? {})) {
      (node?.choices ?? []).forEach((c, i) => out.push({ c, where: `dialogues.${treeId}.${nodeId}.choices[${i}]` }));
    }
  }
  return out;
}

const inRect = (p, a) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h;
const validRect = (b) => b && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n));
const validPoint = (p) => p && typeof p.x === 'number' && typeof p.y === 'number';

function mentionedIn(files, name, skip) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(['"\`])${esc}\\1|flags\\.${esc}\\b`);
  for (const f of files) {
    if (skip.has(path.posix.basename(f.file))) continue;
    if (re.test(f.text)) return f.file;
  }
  return null;
}

// ─── Diario (A2.9) ─────────────────────────────────────────────

/**
 * Estructura de los ficheros del diario. Devuelve { problems: [{ file, where, message }], flagReads: Map(flag → [where]),
 * itemReads: Map(item → [where]), noteIds: Set }.
 */
export function analyzeJournal(files = []) {
  const problems = [];
  const flagReads = new Map();
  const itemReads = new Map();
  const noteIds = new Set();
  const seen = { goals: new Map(), notes: new Map(), puzzles: new Map(), chapter: new Map() };
  const bad = (file, where, message) => problems.push({ file, where: `${file}${where ? `.${where}` : ''}`, message });
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const cond = (file, where, v, required) => {
    const list = conditionList(v);
    if (v !== undefined && typeof v !== 'string' && !Array.isArray(v)) return bad(file, where, 'condición: texto o lista de textos');
    if (required && !list.length) return bad(file, where, 'falta la condición');
    const { ok, bad: wrong } = parseWhen(v);
    for (const w of wrong) bad(file, where, `condición «${w}» no válida (flag, !flag, item:id, !item:id)`);
    for (const c of ok) {
      const map = c.kind === 'item' ? itemReads : flagReads;
      if (!map.has(c.name)) map.set(c.name, []);
      map.get(c.name).push(`${file}.${where}`);
    }
  };
  for (const { file, data, error } of files) {
    if (error) { bad(file, '', error); continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { bad(file, '', 'el fichero tiene que ser un objeto'); continue; }
    if (!Number.isInteger(data.chapter) || data.chapter < 1) bad(file, 'chapter', '"chapter" tiene que ser un entero ≥ 1');
    else if (seen.chapter.has(data.chapter)) bad(file, 'chapter', `el capítulo ${data.chapter} ya está en ${seen.chapter.get(data.chapter)}`);
    else seen.chapter.set(data.chapter, file);
    for (const kind of ['goals', 'notes', 'puzzles']) {
      if (data[kind] === undefined) continue;
      if (!Array.isArray(data[kind])) { bad(file, kind, `"${kind}" tiene que ser una lista`); continue; }
      data[kind].forEach((e, i) => {
        const where = `${kind}[${i}]`;
        if (!e || typeof e !== 'object') return bad(file, where, 'cada entrada es un objeto');
        if (!text(e.id)) bad(file, where, 'falta "id"');
        else if (seen[kind].has(e.id)) bad(file, where, `id «${e.id}» repetido (ya en ${seen[kind].get(e.id)})`);
        else seen[kind].set(e.id, file);
        const w = text(e.id) ? `${kind}.${e.id}` : where;
        if (kind === 'notes' && text(e.id)) noteIds.add(e.id);
        if (kind !== 'puzzles' && !text(e.text)) bad(file, w, 'falta "text"');
        if (kind === 'goals') cond(file, `${w}.doneWhen`, e.doneWhen, true);
        if (kind === 'notes') cond(file, `${w}.shownWhen`, e.shownWhen, false);
        if (kind === 'puzzles') {
          cond(file, `${w}.openWhen`, e.openWhen, false);
          cond(file, `${w}.doneWhen`, e.doneWhen, true);
          if (!Array.isArray(e.hints) || e.hints.length !== 3 || !e.hints.every(text)) bad(file, `${w}.hints`, '"hints" son exactamente 3 textos: dirección, objeto, solución');
        }
      });
    }
    if (data.anonIdle !== undefined && (!Array.isArray(data.anonIdle) || !data.anonIdle.every(text))) bad(file, 'anonIdle', '"anonIdle" es una lista de textos');
  }
  return { problems, flagReads, itemReads, noteIds };
}

// ─── Reglas ────────────────────────────────────────────────────

/**
 * Aplica las reglas a un proyecto ({ scenes, srcFiles, qaUses, preload, exists }). Devuelve los hallazgos sin
 * filtrar: { rule, severity, scene, id, where, message, strong? }.
 */
export function lintProject(project) {
  const scenes = project.scenes ?? {};
  const srcFiles = project.srcFiles ?? [];
  const qaUses = project.qaUses ?? new Set();
  const preload = project.preload ?? {};
  const exists = project.exists ?? (() => true);
  const findings = [];
  const push = (rule, severity, scene, id, where, message, extra = {}) =>
    findings.push({ rule, ruleName: RULES[rule], severity, scene, id, where, message, ...extra });

  for (const e of project.loadErrors ?? []) push('f', 'error', e.scene, 'scene.json', `${e.scene}.scene.json`, e.message);

  const containers = Object.entries(scenes).flatMap(([id, s]) => scriptContainers(id, s));

  // ── (a) flags ──
  const writes = new Map(); // flag -> [where]
  const reads = new Map();
  const note = (map, flag, where) => {
    if (typeof flag !== 'string' || !flag) return;
    if (!map.has(flag)) map.set(flag, []);
    map.get(flag).push(where);
  };
  for (const c of containers) {
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (op.op === 'setFlag') note(writes, op.flag, p);
      if (op.op === 'ifFlag') note(reads, op.flag, p);
    });
  }
  for (const [id, s] of Object.entries(scenes)) {
    for (const hs of s.regions?.hotspots ?? []) {
      note(reads, hs.hideWhenFlag, `${id}.${hs.id}.hideWhenFlag`);
      note(reads, hs.showWhenFlag, `${id}.${hs.id}.showWhenFlag`);
    }
    for (const co of s.conditionalOverlays ?? []) note(reads, co.flag, `${id}.conditionalOverlays.${co.id}`);
    note(reads, s.cameraEffect?.disableFlag, `${id}.cameraEffect.disableFlag`);
    // A4.3: las condiciones `when` de la animación ambiental leen flags
    for (const el of ambientDefects(s.ambient, id).ok) for (const cond of el.when.ok) if (cond.kind === 'flag') note(reads, cond.name, `${id}.ambient.${el.id}.when`);
    for (const { c, where } of dialogueChoices(s)) {
      note(reads, c.flag, `${id}.${where}.flag`);
      note(writes, c.setFlag, `${id}.${where}.setFlag`);
      for (const cond of parseWhen(c.when).ok) if (cond.kind === 'flag') note(reads, cond.name, `${id}.${where}.when`);
    }
    for (const { node, where } of dialogueNodes(s)) {
      for (const cond of parseWhen(node?.when).ok) if (cond.kind === 'flag') note(reads, cond.name, `${id}.${where}.when`);
    }
    for (const n of s.npcs ?? []) {
      for (const [item, d] of Object.entries(n.itemDialogues ?? {})) note(writes, d?.setFlag, `${id}.npcs.${n.id}.itemDialogues.${item}.setFlag`);
    }
  }
  // A2.9: el diario lee flags (cuentan como lectura para «se pone y nunca se lee»)
  const journal = analyzeJournal(project.journal ?? []);
  const sceneOf = (where) => where.split('.')[0];
  const inCode = (flag) => DYNAMIC_FLAGS.some((re) => re.test(flag)) || mentionedIn(srcFiles, flag, SRC_SKIP_FLAGS);
  for (const [flag, where] of reads) {
    if (writes.has(flag) || inCode(flag)) continue;
    push('a', 'warning', sceneOf(where[0]), flag, where[0], `flag «${flag}» se lee y nunca se pone (${where.join(', ')})`, { scenes: [...new Set(where.map(sceneOf))] });
  }
  for (const [flag, where] of writes) {
    if (reads.has(flag) || journal.flagReads.has(flag) || inCode(flag)) continue;
    push('a', 'warning', sceneOf(where[0]), flag, where[0], `flag «${flag}» se pone y nunca se lee (${where.join(', ')})`, { scenes: [...new Set(where.map(sceneOf))] });
  }

  // ── (b) objetos ──
  const acquired = new Map();
  const itemUses = new Set(qaUses);
  for (const c of containers) {
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (op.op === 'addItem' && typeof op.id === 'string') {
        if (!acquired.has(op.id)) acquired.set(op.id, []);
        acquired.get(op.id).push(p);
      }
      if ((op.op === 'ifHasItem' || op.op === 'removeItem') && typeof op.id === 'string') itemUses.add(op.id);
    });
  }
  for (const s of Object.values(scenes)) {
    for (const c of s.combos ?? []) for (const it of c.items ?? []) itemUses.add(it);
    for (const n of s.npcs ?? []) {
      for (const k of Object.keys(n.giveResponses ?? {})) itemUses.add(k);
      for (const k of Object.keys(n.useResponses ?? {})) itemUses.add(k);
      for (const k of Object.keys(n.itemDialogues ?? {})) itemUses.add(k);
    }
    for (const { c } of dialogueChoices(s)) for (const cond of parseWhen(c.when).ok) if (cond.kind === 'item') itemUses.add(cond.name);
    for (const { node } of dialogueNodes(s)) for (const cond of parseWhen(node?.when).ok) if (cond.kind === 'item') itemUses.add(cond.name);
    for (const el of ambientDefects(s.ambient, s.id).ok) for (const cond of el.when.ok) if (cond.kind === 'item') itemUses.add(cond.name);
  }
  for (const [item, where] of acquired) {
    if (itemUses.has(item) || mentionedIn(srcFiles, item, SRC_SKIP_ITEMS)) continue;
    push('b', 'warning', sceneOf(where[0]), item, where[0], `objeto «${item}» se consigue (${where.join(', ')}) y no sirve para nada: sin combo, ifHasItem, removeItem, respuestas de NPC, ruta de QA ni código`);
  }

  // ── (c) salidas sin gate ──
  const exits = new Map(); // escena|dueño|destino -> { …, verbs, wheres }
  for (const c of containers) {
    if (c.kind !== 'hotspot' && c.kind !== 'trigger') continue;
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p, condDepth) => {
      if (!GOTO_OPS.has(op.op) || condDepth > 0 || c.gated) return;
      const key = `${c.scene}|${c.owner}|${op.sceneId}`;
      if (!exits.has(key)) exits.set(key, { c, target: op.sceneId, verbs: [], wheres: [] });
      const e = exits.get(key);
      e.verbs.push(c.label.slice(c.owner.length + 1));
      e.wheres.push(p);
    });
  }
  for (const { c, target, verbs, wheres } of exits.values()) {
    push('c', 'warning', c.scene, c.owner, wheres[0], `${c.kind} ${c.owner} (${verbs.join(', ')}) → ${target ?? '?'} sin gate: ni ifFlag/ifHasItem/web3Require alrededor ni gate en el ${c.kind}`, { target, wheres });
  }

  // ── (d) estado tras say ──
  for (const c of containers) {
    walkBlocks(c.ops, `${c.scene}.${c.label}`, (block, base, sayBefore) => {
      let saw = sayBefore;
      const bad = [];
      block.forEach((op, i) => {
        if (!op || typeof op !== 'object') return;
        if (SAY_OPS.has(op.op)) saw = true;
        else if (saw && STATE_OPS.has(op.op)) {
          const arg = op.op === 'setFlag' ? ` ${op.flag}=${op.value}` : op.op === 'addItem' || op.op === 'removeItem' ? ` ${op.id}` : GOTO_OPS.has(op.op) ? ` ${op.sceneId}` : '';
          bad.push({ i, label: `[${i}] ${op.op}${arg}` });
        }
      });
      if (bad.length) {
        const counts = {};
        for (const op of block) if (op?.op === 'setFlag') counts[op.flag] = (counts[op.flag] ?? 0) + 1;
        const blink = Object.entries(counts).filter(([, n]) => n > 1).map(([f, n]) => `«${f}» se pone ${n} veces en el bloque (parpadeo)`);
        const origin = sayBefore && !block.some((op) => SAY_OPS.has(op?.op)) ? ' (el say va antes de la rama)' : '';
        push('d', 'warning', c.scene, base.slice(c.scene.length + 1), `${base}[${bad[0].i}]`, `${base}: ${bad.length} op(s) de estado después de un say${origin}: ${bad.map((b) => b.label).join(', ')}${blink.length ? `; ${blink.join(', ')}` : ''}`);
      }
    });
  }

  // ── (e) spawns ──
  const noAreas = new Set();
  const outside = new Map();
  const checkSpawn = (target, spawn, srcScene, where, label) => {
    const ts = scenes[target];
    if (!ts || !validPoint(spawn)) return;
    const areas = (ts.walkableAreas ?? []).filter(validRect);
    if (!areas.length) {
      if (!noAreas.has(target)) {
        noAreas.add(target);
        push('e', 'warning', target, `${target}.walkableAreas`, `${target}.walkableAreas`, `${target} sin walkableAreas: el motor deja andar por todas partes; spawns no comprobados`);
      }
      return;
    }
    const blocked = (ts.blockedAreas ?? []).filter(validRect).find((b) => inRect(spawn, b));
    if (!areas.some((a) => inRect(spawn, a)) || blocked) {
      const key = `${srcScene}|${label}|${spawn.x},${spawn.y}`;
      if (outside.has(key)) return void outside.get(key).wheres.push(where);
      const f = { wheres: [where] };
      outside.set(key, f);
      const why = blocked
        ? `cae dentro de un obstáculo (blockedAreas ${blocked.x},${blocked.y} ${blocked.w}×${blocked.h}) de ${target}`
        : `cae fuera de las walkableAreas de ${target}`;
      push('e', 'error', srcScene, where.slice(srcScene.length + 1), where, `${label} (${spawn.x}, ${spawn.y}) ${why}`, f);
    }
  };
  for (const [id, s] of Object.entries(scenes)) {
    checkSpawn(id, s.player?.spawn, id, `${id}.player.spawn`, 'player.spawn');
    for (const g of s.transitions?.goto ?? []) checkSpawn(g.targetScene, g.spawn, id, `${id}.transitions.goto.${g.id}`, `transitions.goto ${g.id} → ${g.targetScene}`);
  }
  for (const c of containers) {
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (GOTO_OPS.has(op.op) && op.spawn) checkSpawn(op.sceneId, op.spawn, c.scene, p, `${op.op} → ${op.sceneId}`);
    });
  }

  // ── (f) assets ──
  const missing = (scene, rel, where, what, severity = 'error') => {
    if (!exists(rel)) push('f', severity, scene, rel, where, `${what}: no existe ${rel}`);
  };
  const seenItemIcon = new Set();
  // sceneItems: el motor actual no los pinta ni ejecuta su pickupScript (ningún sistema lee items.sceneItems)
  const liveItems = new Set();
  for (const c of containers) {
    if (c.kind === 'item') continue;
    walkOps(c.ops, '', (op) => { if (op.op === 'addItem') liveItems.add(op.id); });
  }
  const seenSfx = new Set();
  for (const [id, s] of Object.entries(scenes)) {
    const base = `assets/scenes/${id}`;
    missing(id, `${base}/background.webp`, `${id}.assets.background`, 'fondo (PreloadScene carga background.webp)');
    const declaredBg = s.assets?.background;
    if (declaredBg && declaredBg !== 'background.webp') missing(id, `${base}/${declaredBg}`, `${id}.assets.background`, 'fondo declarado en assets.background (el motor no lo usa)', 'warning');
    if (s.assets?.foreground) missing(id, `${base}/foreground.webp`, `${id}.assets.foreground`, 'primer plano (PreloadScene carga foreground.webp)');
    if (s.assets?.walkmask) missing(id, `${base}/${s.assets.walkmask}`, `${id}.assets.walkmask`, 'walkmask declarada (ningún sistema la carga; se camina por walkableAreas)', 'warning');
    for (const v of s.web3Visuals ?? []) {
      if (v.defaultSprite) missing(id, `${base}/${v.defaultSprite}.png`, `${id}.web3Visuals.${v.id}.defaultSprite`, `web3Visual ${v.id}`);
      for (const vr of v.variants ?? []) if (vr?.sprite) missing(id, `${base}/${vr.sprite}.png`, `${id}.web3Visuals.${v.id}.variants`, `variante de web3Visual ${v.id}`);
    }
    for (const co of s.conditionalOverlays ?? []) {
      const ext = co.format === 'webp' ? 'webp' : 'png';
      if (co.sprite) missing(id, `${base}/${co.sprite}.${ext}`, `${id}.conditionalOverlays.${co.id}`, `overlay ${co.id}`);
      else push('f', 'error', id, `${id}.conditionalOverlays.${co.id}`, `${id}.conditionalOverlays.${co.id}`, `overlay ${co.id} sin sprite`);
    }
    if (s.audio?.music) missing(id, `assets/audio/music/${s.audio.music}.mp3`, `${id}.audio.music`, 'música (MusicManager)');
    const audioRefs = [];
    if (s.audio?.ambience) audioRefs.push(['ambience', s.audio.ambience]);
    for (const [k, v] of Object.entries(s.audio?.sfx ?? {})) audioRefs.push([`sfx.${k}`, v]);
    for (const [k, v] of audioRefs) {
      if (typeof v !== 'string') continue;
      const cands = [v, `assets/audio/${v}`, `assets/audio/sfx/${v}.mp3`, `assets/audio/music/${v}.mp3`];
      if (!cands.some((c) => exists(c))) push('f', 'error', id, v, `${id}.audio.${k}`, `audio.${k} «${v}»: no existe en assets/audio`);
    }
    for (const n of s.npcs ?? []) {
      if (typeof n.id !== 'string') continue;
      if (n.id.startsWith('npc_')) {
        const name = n.id.slice(4);
        missing(id, `assets/sprites/npcs/${name}.png`, `${id}.npcs.${n.id}`, `sprite del NPC ${n.id}`);
        if (preload.npcs && !preload.npcs.includes(name) && exists(`assets/sprites/npcs/${name}.png`)) {
          push('f', 'warning', id, n.id, `${id}.npcs.${n.id}`, `sprite del NPC ${n.id} existe pero no está en npcIds de PreloadScene: se pinta un rectángulo`);
        }
      } else {
        push('f', 'warning', id, n.id, `${id}.npcs.${n.id}`, `NPC ${n.id} sin sprite (el id no empieza por npc_): se pinta un rectángulo`);
      }
      if (n.dialogueTreeId && !s.dialogues?.[n.dialogueTreeId]) {
        push('f', 'error', id, n.dialogueTreeId, `${id}.npcs.${n.id}.dialogueTreeId`, `NPC ${n.id}: el diálogo «${n.dialogueTreeId}» no está en dialogues de ${id}`);
      }
      // A2.6: NPC que reaccionan a objetos (GameScene.dispatchNpcTap)
      for (const [item, d] of Object.entries(n.itemDialogues ?? {})) {
        const where = `${id}.npcs.${n.id}.itemDialogues.${item}`;
        const treeId = d?.tree ?? n.dialogueTreeId;
        if (!treeId) {
          push('f', 'error', id, item, where, `NPC ${n.id}: itemDialogues.${item} sin "tree" y la NPC no tiene dialogueTreeId`);
          continue;
        }
        const tree = s.dialogues?.[treeId];
        if (!tree) push('f', 'error', id, treeId, where, `NPC ${n.id}: itemDialogues.${item}: el árbol «${treeId}» no está en dialogues de ${id}`);
        else if (d?.node && !tree.nodes?.[d.node]) push('f', 'error', id, d.node, where, `NPC ${n.id}: itemDialogues.${item}: el nodo «${d.node}» no está en el árbol «${treeId}»`);
        if (!n.dialogueTreeId) push('f', 'warning', id, item, where, `NPC ${n.id} sin dialogueTreeId: no se puede pulsar (GameScene.hitTestAt), así que itemDialogues.${item} nunca salta`);
      }
    }
    // A2.6: estructura de los árboles de diálogo (DialogueSystem.run)
    for (const [treeId, tree] of Object.entries(s.dialogues ?? {})) {
      if (!tree?.nodes?.[tree?.start]) push('f', 'error', id, treeId, `${id}.dialogues.${treeId}.start`, `diálogo ${treeId}: el nodo de inicio «${tree?.start}» no existe`);
    }
    for (const { treeId, tree, nodeId, node, where } of dialogueNodes(s)) {
      const nodes = tree.nodes;
      if (node?.next !== undefined && !nodes[node.next]) push('f', 'error', id, node.next, `${id}.${where}.next`, `diálogo ${treeId}.${nodeId}: next «${node.next}» no existe`);
      for (const bad of parseWhen(node?.when).bad) push('f', 'error', id, String(bad), `${id}.${where}.when`, `diálogo ${treeId}.${nodeId}: condición «${bad}» no válida (flag, !flag, item:id, !item:id)`);
      (node?.choices ?? []).forEach((c, i) => {
        const cw = `${id}.${where}.choices[${i}]`;
        if (c?.next === undefined) {
          if (!c?.exit) push('f', 'error', id, `${treeId}.${nodeId}`, cw, `diálogo ${treeId}.${nodeId}: la opción «${c?.text}» no tiene next (solo una salida, exit: true, puede ir sin next)`);
        } else if (!nodes[c.next]) {
          push('f', 'error', id, c.next, `${cw}.next`, `diálogo ${treeId}.${nodeId}: la opción «${c?.text}» va a «${c.next}», que no existe`);
        }
        for (const bad of parseWhen(c?.when).bad) push('f', 'error', id, String(bad), `${cw}.when`, `diálogo ${treeId}.${nodeId}: condición «${bad}» no válida en «${c?.text}» (flag, !flag, item:id, !item:id)`);
      });
    }
    for (const it of s.items?.sceneItems ?? []) {
      if (it.sprite && !exists(`assets/sprites/items/${it.sprite}.png`) && !exists(`${base}/${it.sprite}.png`) && !exists(it.sprite)) {
        push('f', 'warning', id, it.sprite, `${id}.items.${it.id}.sprite`, `sprite del objeto de escena ${it.id} «${it.sprite}» no existe (sceneItems no se pintan en el motor actual)`);
      }
    }
    for (const g of s.transitions?.goto ?? []) {
      if (g.targetScene && !scenes[g.targetScene]) missing(id, `assets/scenes/${g.targetScene}/scene.json`, `${id}.transitions.goto.${g.id}`, `escena destino ${g.targetScene}`);
    }
  }
  for (const c of containers) {
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (GOTO_OPS.has(op.op)) {
        if (typeof op.sceneId !== 'string') push('f', 'error', c.scene, p, p, `${op.op} sin sceneId`);
        else if (!scenes[op.sceneId]) missing(c.scene, `assets/scenes/${op.sceneId}/scene.json`, p, `escena destino de ${op.op}`);
      }
      if (op.op === 'dialogue' && op.treeId && !scenes[c.scene]?.dialogues?.[op.treeId]) {
        push('f', 'error', c.scene, String(op.treeId), p, `dialogue: el árbol «${op.treeId}» no está en dialogues de ${c.scene}`);
      }
      // A1.4: flicker parpadea un overlay condicional de la escena donde corre el script (GameScene); si no
      // existe, el motor solo espera y no se ve nada
      if (op.op === 'flicker') {
        const overlays = scenes[c.scene]?.conditionalOverlays ?? [];
        if (typeof op.overlay !== 'string') push('f', 'error', c.scene, p, p, 'flicker sin overlay');
        else if (!overlays.some((co) => co.id === op.overlay)) {
          push('f', 'error', c.scene, String(op.overlay), p, `flicker: el overlay «${op.overlay}» no está en conditionalOverlays de ${c.scene}`);
        }
      }
      if (op.op === 'playSound' && typeof op.key === 'string') {
        const rel = `assets/audio/sfx/${op.key}.mp3`;
        if (!exists(rel)) push('f', 'error', c.scene, rel, p, `playSound «${op.key}»: no existe ${rel}`);
        else if (preload.sfx && !preload.sfx.includes(op.key) && !seenSfx.has(op.key)) {
          seenSfx.add(op.key);
          push('f', 'warning', c.scene, op.key, p, `playSound «${op.key}»: el mp3 existe pero no está en sfxKeys de PreloadScene, no suena`);
        }
      }
      if (op.op === 'addItem' && typeof op.id === 'string' && !seenItemIcon.has(op.id)) {
        seenItemIcon.add(op.id);
        const rel = `assets/sprites/items/${op.id}.png`;
        if (!exists(rel)) {
          if (liveItems.has(op.id)) push('f', 'error', c.scene, rel, p, `icono del objeto «${op.id}»: no existe ${rel}`);
          else push('f', 'warning', c.scene, rel, p, `icono del objeto «${op.id}»: no existe ${rel} (solo se consigue en sceneItems, que el motor no pinta)`);
        }
        else if (preload.items && !preload.items.includes(op.id)) {
          push('f', 'warning', c.scene, op.id, p, `icono del objeto «${op.id}» existe pero no está en itemIds de PreloadScene: el inventario enseña emoji/letra`);
        }
      }
    });
  }

  // ── (g) hotspots solapados ──
  for (const [id, s] of Object.entries(scenes)) {
    const hs = (s.regions?.hotspots ?? []).filter((h) => validRect(h.bounds));
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const A = hs[i], B = hs[j], a = A.bounds, b = B.bounds;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w <= 0 || h <= 0) continue;
        const complementary = (A.hideWhenFlag && A.hideWhenFlag === B.showWhenFlag) || (A.showWhenFlag && A.showWhenFlag === B.hideWhenFlag);
        if (complementary) continue;
        const area = w * h;
        const ratio = (area / Math.max(Math.min(a.w * a.h, b.w * b.h), 1e-9)) * 100;
        const pct = ratio < 1 ? '<1' : String(Math.round(ratio));
        const aContainsB = b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
        const bContainsA = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
        const pair = `${A.id}+${B.id}`;
        if (aContainsB) {
          push('g', 'warning', id, pair, `${id}.${pair}`, `${A.id} contiene entero a ${B.id} y va antes en la lista: el clic nunca llega a ${B.id}`, { strong: true });
        } else if (bContainsA) {
          push('g', 'warning', id, pair, `${id}.${pair}`, `${B.id} contiene a ${A.id} (${A.id} va antes, así que se puede pulsar; revisa que sea intencionado)`, { strong: true });
        } else {
          push('g', 'warning', id, pair, `${id}.${pair}`, `${A.id} y ${B.id} se solapan (${pct}% del menor; manda ${A.id} en la zona común)`);
        }
      }
    }
  }

  // ── (h) diario (A2.9) ──
  const jScene = (file) => `journal/${path.posix.basename(file, '.json')}`;
  for (const pr of journal.problems) push('h', 'error', jScene(pr.file), pr.where, pr.where, `diario: ${pr.message}`);
  for (const [flag, where] of journal.flagReads) {
    if (writes.has(flag) || inCode(flag)) continue;
    push('h', 'warning', sceneOf(where[0]), flag, where[0], `el diario lee la flag «${flag}» y ninguna escena ni el código la pone (${where.join(', ')})`);
  }
  for (const [item, where] of journal.itemReads) {
    if (acquired.has(item) || mentionedIn(srcFiles, item, SRC_SKIP_ITEMS)) continue;
    push('h', 'warning', sceneOf(where[0]), item, where[0], `el diario mira el objeto «${item}» y nada lo da (${where.join(', ')})`);
  }
  for (const c of containers) {
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (op.op !== 'journalNote') return;
      if (typeof op.id !== 'string' || !journal.noteIds.has(op.id)) {
        push('h', 'error', c.scene, String(op.id), p, `journalNote: la nota «${op.id}» no está en assets/journal (notes[].id)`);
      }
    });
  }

  // ── (i) densidad de píxel (A2.8) ──
  for (const [id, s] of Object.entries(scenes)) {
    if (s.pixelScale !== undefined && !inRange(s.pixelScale, PIXEL_RANGES.pixelScale)) {
      push('i', 'warning', id, 'pixelScale', `${id}.pixelScale`, `pixelScale = ${JSON.stringify(s.pixelScale)} fuera de ${PIXEL_RANGES.pixelScale.join('-')}: se usa el de por defecto`);
    }
    if (s.depthScale !== undefined) {
      for (const d of depthScaleDefects(s.depthScale)) push('i', 'warning', id, 'depthScale', `${id}.depthScale`, `depthScale: ${d}; se ignora (sin escala por profundidad)`);
    }
    if (s.player?.playerScale !== undefined) {
      push('i', 'warning', id, 'player.playerScale', `${id}.player.playerScale`, 'player.playerScale es anterior a A2.8: usa pixelScale (unidad de píxel de la escena para jugador y NPC)');
    }
    for (const n of s.npcs ?? []) {
      if (n.scale !== undefined) {
        push('i', 'warning', id, n.id, `${id}.npcs.${n.id}.scale`, `${n.id}: «scale» a mano (${n.scale}) fuera del sistema de densidad de píxel; se ignora. Si la hoja está dibujada a otra densidad, usa artScale`);
      }
      if (n.artScale !== undefined && !inRange(n.artScale, PIXEL_RANGES.artScale)) {
        push('i', 'warning', id, n.id, `${id}.npcs.${n.id}.artScale`, `${n.id}: artScale = ${JSON.stringify(n.artScale)} fuera de ${PIXEL_RANGES.artScale.join('-')}; se usa 1`);
      }
    }
  }

  // ── (j) respuestas de fallo (A2.5) ──
  const known = new Set([...acquired.keys()]);
  for (const f of srcFiles) {
    if (f.file.endsWith('ui/ScummUI.ts')) for (const id of itemDescIds(f.text)) known.add(id);
    for (const m of f.text.matchAll(/\baddItem\(\s*['"]([a-z0-9_]+)['"]/g)) known.add(m[1]);
  }
  const J = 'config/fail-responses';
  for (const [id, s] of Object.entries(scenes)) {
    const combos = new Set((s.combos ?? []).map((c) => [...(c.items ?? [])].sort().join('+')));
    const checkMap = (map, base, hsId) => {
      if (!map || typeof map !== 'object' || Array.isArray(map)) { push('j', 'error', id, base, base, 'tiene que ser un objeto { _default, <idDeObjeto>: frase o lista }'); return; }
      for (const [key, bag] of Object.entries(map)) {
        const where = `${base}.${key}`;
        if (key !== '_default' && !known.has(key)) push('j', 'error', id, key, where, `el objeto «${key}» no existe (ningún addItem ni ScummUI.ITEM_DESCS)`);
        for (const d of bagDefects(bag)) push('j', 'error', id, key, where, d);
        if (hsId && key !== '_default' && combos.has([key, hsId].sort().join('+'))) push('j', 'warning', id, key, where, `${key} + ${hsId} es un combo: esta respuesta de fallo nunca se dice`);
      }
    };
    for (const hs of s.regions?.hotspots ?? []) if (hs.useResponses !== undefined) checkMap(hs.useResponses, `${id}.${hs.id}.useResponses`, hs.id);
    for (const n of s.npcs ?? []) {
      for (const field of ['giveResponses', 'useResponses']) if (n[field] !== undefined) checkMap(n[field], `${id}.npcs.${n.id}.${field}`, null);
    }
  }
  const fr = project.failResponses;
  if (fr?.error) push('j', 'error', J, FAIL_FILE, FAIL_FILE, fr.error);
  else if (fr?.data) {
    const d = fr.data;
    const bad = (where, defects) => { for (const x of defects) push('j', 'error', J, where, where, x); };
    for (const v of FAIL_VERBS) bad(`verbDefaults.${v}`, bagDefects(d.verbDefaults?.[v], { listOnly: true, min: FAIL_MIN.verb }));
    for (const v of FAIL_VERBS) if (v !== 'USE') bad(`itemVerbDefaults.${v}`, bagDefects(d.itemVerbDefaults?.[v], { listOnly: true, min: FAIL_MIN.verb }));
    bad('itemHotspot', bagDefects(d.itemHotspot, { listOnly: true, min: FAIL_MIN.itemItem }));
    for (const v of ['USE', 'GIVE']) bad(`itemNpc.${v}`, bagDefects(d.itemNpc?.[v], { listOnly: true, min: FAIL_MIN.verb }));
    bad('itemItem.default', bagDefects(d.itemItem?.default, { listOnly: true, min: FAIL_MIN.itemItem }));
    const seenPairs = new Set();
    (Array.isArray(d.itemItem?.pairs) ? d.itemItem.pairs : []).forEach((p, i) => {
      const where = `itemItem.pairs[${i}]`;
      if (!Array.isArray(p?.items) || p.items.length !== 2 || p.items.some((x) => typeof x !== 'string') || p.items[0] === p.items[1]) {
        bad(where, ['items tienen que ser dos ids de objeto distintos']);
        return;
      }
      const k = [...p.items].sort().join('+');
      if (seenPairs.has(k)) bad(where, [`pareja repetida (${k})`]);
      seenPairs.add(k);
      for (const it of p.items) if (!known.has(it)) bad(where, [`el objeto «${it}» no existe`]);
      bad(`${where}.lines`, bagDefects(p.lines, { listOnly: true }));
    });
    const items = d.items && typeof d.items === 'object' ? d.items : {};
    for (const [it, bag] of Object.entries(items)) {
      if (!known.has(it)) bad(`items.${it}`, [`el objeto «${it}» no existe`]);
      bad(`items.${it}`, bagDefects(bag, { listOnly: true }));
    }
    for (const it of [...known].sort()) {
      const n = Array.isArray(items[it]) ? items[it].length : 0;
      if (n < FAIL_MIN.item) push('j', 'warning', J, it, `items.${it}`, `objeto «${it}» con ${n} frase(s) de mal uso (mínimo ${FAIL_MIN.item}): cae en la bolsa genérica`);
    }
  }

  // ── (k) animación ambiental (A4.3) ──
  for (const [id, s] of Object.entries(scenes)) {
    const { ok, problems } = ambientDefects(s.ambient, id);
    for (const p of problems) push('k', 'error', id, p.split(' ')[0], p.split(':')[0], `ambiente: ${p}`);
    if (ok.length < 2) push('k', 'warning', id, 'ambient', `${id}.ambient`, `ambiente: ${ok.length} elemento(s) válido(s); A4.3 pide al menos 2 por escena`);
  }
  for (const c of containers) {
    const ids = new Set(ambientDefects(scenes[c.scene]?.ambient, c.scene).ok.map((e) => e.id));
    walkOps(c.ops, `${c.scene}.${c.label}`, (op, p) => {
      if (op.op !== 'ambient') return;
      if (!AMBIENT_ACTIONS.includes(op.action)) push('k', 'error', c.scene, String(op.id), p, `ambient: action «${String(op.action)}» no válida (${AMBIENT_ACTIONS.join(', ')})`);
      if (typeof op.id !== 'string' || !ids.has(op.id)) push('k', 'error', c.scene, String(op.id), p, `ambient: el elemento «${op.id}» no está en ambient[] de ${c.scene}`);
    });
  }

  return findings;
}

// ─── Excepciones, severidad e informes ─────────────────────────

const ruleKey = (r) => {
  if (typeof r !== 'string') return null;
  if (RULES[r]) return r;
  return Object.keys(RULES).find((k) => RULES[k] === r) ?? null;
};

function idMatches(pattern, f) {
  const test = (v) => typeof v === 'string' && (pattern.endsWith('*') ? v.startsWith(pattern.slice(0, -1)) : v === pattern);
  return test(f.id) || test(f.where);
}

/** Aplica excepciones, filtro de escena y --strict. Devuelve { findings, suppressed, allowProblems }. */
export function applyPolicy(raw, { allow = [], scene = null, strict = false } = {}) {
  const allowProblems = [];
  const entries = [];
  allow.forEach((e, i) => {
    const rule = ruleKey(e?.rule);
    if (!rule) allowProblems.push(`entrada ${i}: regla «${e?.rule}» desconocida`);
    else if (!e.reason || !String(e.reason).trim()) allowProblems.push(`entrada ${i} (${e.rule} ${e.scene ?? ''} ${e.id ?? ''}): sin motivo, se ignora`);
    else entries.push({ ...e, rule, used: 0, index: i });
  });
  const inScene = (f) => !scene || f.scene === scene || (f.scenes ?? []).includes(scene);
  const findings = [];
  const suppressed = [];
  for (const f of raw) {
    if (!inScene(f)) continue;
    const hit = entries.find((e) => e.rule === f.rule && (!e.scene || e.scene === f.scene) && (!e.id || idMatches(e.id, f)));
    if (hit) {
      hit.used++;
      suppressed.push({ ...f, reason: hit.reason });
      continue;
    }
    findings.push(strict ? { ...f, severity: 'error' } : f);
  }
  if (!scene) {
    for (const e of entries) if (!e.used) allowProblems.push(`entrada ${e.index} (${e.rule} ${e.scene ?? ''} ${e.id ?? ''}): no silencia nada, bórrala`);
  }
  return { findings, suppressed, allowProblems };
}

export function summarize(findings, suppressed) {
  const byRule = {};
  for (const k of Object.keys(RULES)) byRule[k] = { name: RULES[k], errors: 0, warnings: 0, suppressed: 0 };
  for (const f of findings) byRule[f.rule][f.severity === 'error' ? 'errors' : 'warnings']++;
  for (const f of suppressed) byRule[f.rule].suppressed++;
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity !== 'error').length,
    suppressed: suppressed.length,
    byRule,
  };
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function renderText(result) {
  const { findings, suppressed, allowProblems, summary } = result;
  const lines = [];
  for (const [rule, list] of groupBy(findings, (f) => f.rule)) {
    lines.push('', `── (${rule}) ${RULES[rule]} · ${list.length}`);
    for (const [scene, items] of groupBy(list, (f) => f.scene)) {
      lines.push(`  ${scene}`);
      for (const f of items) lines.push(`    ${f.severity === 'error' ? 'ERROR' : f.strong ? 'AVISO!' : 'aviso'}  ${f.message}`);
    }
  }
  if (suppressed.length) lines.push('', `── silenciados por qa/lint-scenes-allow.json · ${suppressed.length}`, ...suppressed.map((f) => `    (${f.rule}) ${f.where}: ${f.reason}`));
  if (allowProblems.length) lines.push('', '── qa/lint-scenes-allow.json', ...allowProblems.map((p) => `    ${p}`));
  lines.push('', 'por regla: ' + Object.entries(summary.byRule).map(([k, v]) => `${k} ${v.errors}E/${v.warnings}A${v.suppressed ? `/${v.suppressed}S` : ''}`).join(' · '));
  lines.push(`errores: ${summary.errors} · avisos: ${summary.warnings} · silenciados: ${summary.suppressed}`);
  return lines.join('\n');
}

const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(result) {
  const { findings, suppressed, allowProblems, summary, options } = result;
  const out = ['### Linter de escenas (A0.4)', ''];
  out.push(`**errores: ${summary.errors} · avisos: ${summary.warnings} · silenciados: ${summary.suppressed}**${options?.strict ? ' (modo --strict)' : ''}${options?.scene ? ` · solo ${options.scene}` : ''}`, '');
  out.push('| Regla | Errores | Avisos | Silenciados |', '|---|---:|---:|---:|');
  for (const [k, v] of Object.entries(summary.byRule)) out.push(`| (${k}) ${v.name} | ${v.errors} | ${v.warnings} | ${v.suppressed} |`);
  for (const [rule, list] of groupBy(findings, (f) => f.rule)) {
    out.push('', `<details${rule === 'f' && list.some((f) => f.severity === 'error') ? ' open' : ''}><summary>(${rule}) ${RULES[rule]} · ${list.length}</summary>`, '');
    out.push('| | Escena | Dónde | Detalle |', '|---|---|---|---|');
    for (const f of list) out.push(`| ${f.severity === 'error' ? '❌' : f.strong ? '⚠️' : '·'} | ${mdEsc(f.scene)} | \`${mdEsc(f.where)}\` | ${mdEsc(f.message)} |`);
    out.push('', '</details>');
  }
  if (suppressed.length) {
    out.push('', `<details><summary>Silenciados · ${suppressed.length}</summary>`, '', '| Regla | Dónde | Motivo |', '|---|---|---|');
    for (const f of suppressed) out.push(`| (${f.rule}) | \`${mdEsc(f.where)}\` | ${mdEsc(f.reason)} |`);
    out.push('', '</details>');
  }
  if (allowProblems.length) out.push('', '**qa/lint-scenes-allow.json:**', ...allowProblems.map((p) => `- ${p}`));
  return out.join('\n') + '\n';
}

// ─── CLI ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { strict: false, json: false, scene: null, root: null, write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') o.strict = true;
    else if (a === '--json') o.json = true;
    else if (a === '--no-write') o.write = false;
    else if (a === '--scene') o.scene = argv[++i];
    else if (a.startsWith('--scene=')) o.scene = a.slice(8);
    else if (a === '--root') o.root = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`opción desconocida: ${a}`);
  }
  return o;
}

export function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log('uso: node scripts/lint-scenes.mjs [--strict] [--json] [--scene <id>] [--root <dir>] [--no-write]');
    return 0;
  }
  const root = path.resolve(opts.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const project = loadProject(root);
  if (opts.scene && !project.scenes[opts.scene]) {
    console.error(`escena desconocida: ${opts.scene} (hay: ${Object.keys(project.scenes).join(', ')})`);
    return 2;
  }
  const allowFile = path.join(root, 'qa', 'lint-scenes-allow.json');
  const allowRaw = fs.existsSync(allowFile) ? readJson(allowFile) : [];
  const allow = Array.isArray(allowRaw) ? allowRaw : allowRaw.allow ?? [];
  const raw = lintProject(project);
  const policy = applyPolicy(raw, { allow, scene: opts.scene, strict: opts.strict });
  const result = {
    generatedAt: new Date().toISOString(),
    options: { strict: opts.strict, scene: opts.scene },
    scenes: Object.keys(project.scenes),
    ...policy,
    summary: summarize(policy.findings, policy.suppressed),
  };
  const md = renderMarkdown(result);
  if (opts.write) {
    fs.writeFileSync(path.join(root, 'lint-scenes-report.json'), JSON.stringify(result, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'lint-scenes-report.md'), md);
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`lint-scenes: ${result.scenes.length} escenas${opts.scene ? ` (solo ${opts.scene})` : ''}\n${renderText(result)}`);
  return result.summary.errors > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run();
  } catch (err) {
    console.error(`lint-scenes: ${err.message}`);
    process.exitCode = 2;
  }
}

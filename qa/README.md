# QA automática (A0.1, A0.5)

El CI (job `walkthrough` de `.github/workflows/build.yml`) juega la partida con Chrome headless contra el
build real y comprueba el estado paso a paso. Capturas e informe en el artefacto `walkthrough-shots`.

## API de QA (`?qa=1`)

`src/qa/QaApi.ts` expone `window.__qa` solo con `?qa=1`. Cada acción usa los mismos caminos que un jugador:
elige el verbo en el panel, pulsa el objeto en el inventario y entra por `GameScene.dispatchTap` (andar
hasta el hotspot, combos, gates y diálogos). Nunca pone flags ni da objetos.

| Función | Qué hace |
|---|---|
| `newGame()` | Pulsa New Game en el menú y entra sin sonido |
| `act(verb, id, choices?)` | Verbo sobre un hotspot o NPC (`LOOK`, `PICK`, `USE`, `OPEN`, `PUSH`…) |
| `use(itemId, targetId, choices?)` | Usar un objeto con un hotspot, un NPC u otro objeto |
| `combine(itemA, itemB)` | Combinar dos objetos del inventario |
| `talk(npcId, choices[])` | Hablar y responder las elecciones en orden (texto contenido, sin mayúsculas) |
| `walk(x, y)` | Andar a un punto (en % del fondo); así se prueban las salidas por trigger |
| `goto(sceneId, spawn?)` | Cambiar de escena como `gotoScene` (solo en rutas del selftest con `allowGoto`, ver abajo) |
| `dismissAll()` | Cerrar textos y cinemáticas hasta que el juego quede quieto |
| `press(key, phase?)` | A2.4: tecla real (`KeyboardEvent` en `window`): `press` (pulsar y soltar, por defecto), `down` o `up` (Tab se mantiene con `down`) |
| `click(id, choices?)` | A2.4: clic izquierdo de ratón con el verbo que ya tenga el panel (no lo elige: p. ej. tras `press('l')`) |
| `rightClick(id, choices?)` | A2.4: clic derecho: verbo por defecto del hotspot (ver `src/systems/DesktopControls.ts`) o TALK en una NPC |
| `doubleClick(id)` | A2.4: doble clic en una salida con Walk en el panel; `[qa:error]` si el personaje anda, `[qa:blocked]` si no cambia de escena en 4 s |
| `runScript(ops, { skipAfterMs? })` | A2.10: ejecuta `ops` por el ScriptEngine principal (como un script de hotspot) y espera a que termine; los textos de una cinemática avanzan solos y los de fuera se cierran con el toque sintético. `skipAfterMs`: pulsa Esc (tecla real) a ese tiempo, para saltar la cinemática. Ver § Cinemáticas |
| `openJournal(tab?)` / `closeJournal()` | A2.9: abre el diario (móvil de Dex) pulsando su botón con el mismo manejador que el dedo (`[qa:blocked]` si ahora no se puede: cinemática, diálogo, texto o script) y lo cierra con su X. `tab`: `goals` (por defecto), `notes`, `anon`. Ver § Diario |
| `callAnon()` | A2.9: llama a Anon como el jugador (abre el diario si hace falta, pestaña Call Anon, botón de llamar, espera a que conteste y lo vuelve a cerrar si lo abrió ella); la llamada queda en `state().journal.anon` |
| `previewCostume(costume)` | A4.1: enseña el juego de sprites del disfraz de mono (`'ape'`) o el normal (`'player'`) en la escena actual, para ver sus animaciones; `null` vuelve al de la partida. Solo los sprites: no da el disfraz ni toca inventario ni flags, y se pierde al cambiar de escena. Ver § Animación del protagonista |
| `isWalkable(x, y)` | A2.1: si el punto (en %) se pisa en la escena actual (`walkableAreas` menos `blockedAreas`); síncrona |
| `state()` | Escena, inventario, flags, visitadas, hotspots visibles, elecciones, avisos, log (`logTotal`: líneas apuntadas desde que cargó) `actions` (verbos que llegaron a ejecutarse) y `resizeListeners` (A1.10: listeners de `resize` del ScaleManager) y `path` (A2.1: última ruta calculada al andar: origen, puntos de paso y destino), `facing` (A2.2: `left`/`right`/`front`/`back`) y `walkTarget` (A2.2: último acercamiento a un hotspot/NPC: `target`, `verb`, `walkTo` —null si no anduvo— y `face`), y (A2.4) `verb` (verbo del panel), `highlightedHotspots` (resaltados con Tab), `verbKeyHints` (verbos con su tecla pintada en el panel) e `inputListeners` (listeners de teclado y del lienzo), (A2.10) `cinematic` (ver § Cinemáticas) y (A2.7) `prefetch` (precarga de las escenas vecinas: `scene`, `neighbors`, `done`, `pending`, `inFlight`, `failed`, `disabled`) y `lastTransition` (último cambio de escena: `from`, `to`, `ms`, `loadMs`, `at`, `mode` `full`/`indicator`/`instant`, `loadingScreen`, `fadeMs`) y (A2.9) `journal` (ver § Diario) y (A2.8) `pixel` (ver § Densidad de píxel) y (A4.1) `anim` (ver § Animación del protagonista) y (A2.5) `lastFailResponse` (última respuesta de fallo: `{ kind, item, target, verb, text, bag }`, ver § Respuestas de fallo) |

Todas (salvo `state()` e `isWalkable()`) esperan a que el juego quede quieto y devuelven `state()`. Los errores empiezan por `[qa:blocked]`
(el juego no deja hacerlo) o `[qa:error]` (id inexistente, tiempo agotado).

Los clics se resuelven con el mismo hit-test que el ratón (`GameScene.hitTestAt`): zona del panel, botones
de `UIScene` (Save y Wallet se quedan el clic antes que la escena, A0.5), fuera del fondo, NPC con diálogo
antes que hotspots y hotspot oculto que tapa a otro. La API busca un punto del
hotspot (o del sprite del NPC) donde el clic caiga en ese mismo objetivo; si no lo hay, lanza `[qa:error]`
y la ruta falla. Un hotspot que el ratón no alcanza es un fallo, nunca un «el juego no deja».

## Rutas

- `walkthrough.json`: ruta crítica desde New Game hasta los créditos, sin wallet.
- `sequence-breaks.json`: intentos de llegar antes de tiempo. Si llegan es un **FALLO**, salvo que la ruta
  lleve `knownBreak`: entonces es **XFAIL**, un atajo conocido que cerrará ese checkpoint. Si una ruta con
  `knownBreak` ya no llega, sale **XPASS** y también falla, para quitar la marca en la misma PR.

`act` admite `holdTextMs` (A1.1): deja el primer texto del script en pantalla ese tiempo sin cerrarlo, como un
jugador que se distrae, y falla si el script deja de estar en marcha durante la espera. La ruta crítica lo usa
en `PICK hs_mailbox` (35 s, más que los 30 s del watchdog, con `addItem` y `setFlag` pendientes tras el texto).

Pasos: `newGame`, `act`, `use`, `combine`, `talk`, `walk`, `goto`, `dismissAll`, `wait` (`ms`), `resize`
(`width`, `height`) y, desde A2.4, `key` (`key`, `phase` press|down|up), `click`, `rightclick` (`target`, `choices`) y
`doubleclick` (`target`). A2.4 añade a `expect` `verb` (verbo elegido en el panel), `walkTarget` (`{ target, verb }` del
último acercamiento) y `highlighted` (`{ min, max, includes, excludes }` sobre `state().highlightedHotspots`, lo resaltado
con Tab); `noListenerGrowth` también exige que `state().inputListeners` (teclado y lienzo de GameScene) no crezca. La
ruta `controles-escritorio` de `walkthrough.json` los usa en el lobby, y el smoke repite Esc, Tab, el doble clic y el
clic derecho con el teclado y el ratón reales de Chrome. A2.10 añade el paso `runScript` (`ops`, `skipAfterMs`) y
`expect.cinematic` (`active`, `letterbox`, `chromeHidden`, `following`, `zoom`, `transition`, `skipped`, `covered`, `ducked`,
`endedMin`) y `expect.playerNear` (`{ x, y, tol }`, en %); un `runScript` de una ruta no puede llevar ops que cambien la
partida (objetos, escena, disfraz, logros, mints, diálogos) y solo pone flags `qa_*`. La ruta `cinematica` ve una
cinemática entera y luego la misma saltada con Esc y exige el mismo estado final. A2.9 añade los pasos `journal`
(`action` open|close, `tab`) y `callAnon`, y `expect.journal` (`open`, `chapter`, `done`/`pending`: objetivos con y sin tic,
`notes`/`noNotes`: notas apuntadas o no, `anon`: `{ puzzle, level, notPuzzle, text }` de la última llamada); `runScript` no
admite `journalNote` ni `callAnon` (cambian la partida). La ruta crítica llama dos veces a Anon con la puerta cerrada
(nivel 1 y 2 de `p1_code`), comprueba el tic de `g1_code` y la nota `n1_code` tras coger la nota, y que la siguiente
llamada ya es de `p1_door` y no de `p1_code`. A2.8 añade `expect.pixel`
(`integer`, `pixelScale`, `heightPct` `{ min, max }`, `sameHeightAs` + `tol`, ver § Densidad de píxel); la ruta crítica
lo usa en outside, lobby y clinic_interior. A4.1 añade `expect.anim` (`dir` left|right|up|down del último tramo, `talking`,
`moving`, `gesture`, `texture` como expresión regular sin mayúsculas, `costume` y `rest`: sin tween y con la escala base de
A2.8); la ruta crítica anda en vertical en el lobby tras coger el abrigo (abajo: `dir` `down`, de frente; arriba: `up`, de
espaldas). Cada paso admite `expect` con `scene`, `has`, `lacks`, `flags`, `unsetFlags`, `visited`,
`achievements`, `lastChoices`, `facing` (A2.2: hacia dónde mira el personaje al acabar el paso) y `noListenerGrowth`, y `rejects`: expresión regular (sin distinguir mayúsculas) que tiene que salir en los textos
mostrados durante ese paso, p. ej. la frase con la que el juego rechaza la acción. Las rutas llevan un `goal` con
el mismo formato que `expect`.

`flags` trata una flag que no está en la partida como `false`; `unsetFlags` (A1.4) exige que ni siquiera esté
escrita (ni a `false`). La ruta crítica lo usa en `USE hs_front_door` antes de coger la nota: la lámpara parpadea
con el op `flicker` y `found_code_note` no puede aparecer en la partida; y en `OPEN hs_desk`, para que nadie vuelva
a escribir el nombre viejo `found_hw_wallet`.

`choices` de `talk`/`act`/`use` elige por texto contenido (sin mayúsculas), en orden. Desde A2.6 los árboles vuelven
a un hub tras cada rama, así que cada charla acaba con su salida explícita («I'll come back later.», «Goodbye,
doctor.», «Thanks, B.O.T.»); si falta, el paso falla con «el diálogo pide elegir y el paso no trae más respuestas».
`expect.lastChoices` (A2.6) mira la última elección que salió en el paso, antes de responderla
(`state().lastChoices`): `used` (está en gris, ya elegida), `fresh` (está sin usar), `locked` (con candado) y
`absent` (no está: oculta por `when`, `once` o `hideIfLocked`), también por texto contenido.

`resize` (A1.10) cambia el viewport con `page.setViewport` (salta el `resize` del ScaleManager, de `window` y de
`visualViewport`) y espera `settleMs` (1200 ms por defecto: el rebuild con debounce del panel y los reintentos de
`GameScene.scheduleResize`). Un `console.error` o `pageerror` de un listener que quedó vivo de una escena anterior
hace fallar la ruta como cualquier error del juego. `expect.noListenerGrowth: true` exige que
`state().resizeListeners` no supere el valor tras el primer paso de la ruta (New Game, con GameScene y UIScene ya
creadas una vez): si una escena o un componente no quita su listener en `shutdown()`, crece con cada cambio de
escena. La ruta crítica lo comprueba en `rooftop` (3 cambios de escena, móvil apaisado 844x390) y en
`clinic_interior` (11 cambios, móvil vertical 390x844), y vuelve a 1280x720 en ambos casos. El log del job
`walkthrough` muestra el recuento en esos pasos («listeners de resize N (tras el primer paso M)»).

`goto` se salta puertas y gates, así que ninguna ruta de `walkthrough.json` ni de `sequence-breaks.json` puede
usarlo (sale ERROR, «mal definida»): la preparación de un atajo se hace jugando. Solo lo admiten las rutas del
selftest que lleven `"allowGoto": true`, y solo con `--selftest`.

`walk` con `untilScene` repite el clic si un trigger intermedio paró al personaje. Si no llega a esa
escena lanza `[qa:error]`. Con `trigger` (id de un trigger cuyo rectángulo contiene `x,y`) distingue dos
casos:
- el personaje pisó el trigger (o se disparó) y no cambió de escena: es un gate cerrado, `[qa:blocked]`;
- no llegó a pisarlo: `[qa:error]`, por coordenadas o pathfinding rotos.

Reglas de las rutas `sequence-break`, para no dar por cerrada una ruta sin haber probado el atajo:
- el paso que intenta el atajo lleva `"attempt": true` (si ninguno lo lleva, es el último);
- todos los pasos anteriores al intento llevan `expect`; si falta, la ruta sale ERROR («mal definida»);
- el intento lleva `expect` o `rejects` (A0.5), para que el rechazo sea observable; solo se libra un `walk`
  con `trigger` y `untilScene`, que ya exige pisar el trigger. Además, si el intento es un clic en la escena
  (`act`, `talk`, `use` sobre un hotspot), la acción tiene que haberse ejecutado (`state().actions` sube al
  saltar `player:arrived`, o al momento si no hace falta andar): si el personaje se quedó por el camino, o
  si falla el `expect`/`rejects` del intento, la ruta sale ERROR y no «cerrada»;
- si se cumple el `goal` manda el atajo abierto (FALLO o XFAIL), aunque falle el `expect` de ese paso;
- la ruta solo sale cerrada si la para el intento o un paso con `"gate": true` (un gate que el checkpoint
  que cierra el atajo puede poner antes, como las salidas de la montaña);
- un `[qa:blocked]` o un `expect` fallido en cualquier otro paso es ERROR, igual que un `[qa:error]` en
  cualquier paso.

### Atajos conocidos (expected-fail)

Ninguno abierto. Cerrados:

| Ruta | Atajo | Cerrado en |
|---|---|---|
| `clinica-sin-printout` | `outside.tr_mountain` → `mountain.tr_to_clinic` sin gate: clínica desde el minuto 1 | A1.2 |
| `recepcion-clinica-sin-capitulo-3` | Mismo atajo + la hoja de `hs_visitor_box` abre la puerta: recepción sin sótano | A1.2 |

Desde A1.2 las dos salidas a la montaña piden lo mismo que `hs_winding_path`: el `printout` o `chapter_3_complete`
(si no, el protagonista dice por qué no sigue y el trigger se puede volver a pisar). `montana-con-keycard-sin-capitulo-3`
y `montana-con-capitulo-3-a-medias` comprueban que ni la keycard ni haber bajado al sótano abren la montaña.
`sotano-sin-keycard` es de control: debe quedarse fuera. Las demás salidas sin gate son vueltas a escenas del
mismo capítulo o anteriores y están silenciadas en `qa/lint-scenes-allow.json` con su motivo.

### Parámetros de depuración de la URL (A1.8)

`?scene=<id>`, `?skip`, `?dev` y `?hintAfter=<s>` solo valen en `npm run dev` o con `?qa=1`
(`src/config/debugParams.ts`); en el build de producción sin `?qa=1` se ignoran. Smoke y demos cargan
`?qa=1&scene=<id>`, y el smoke comprueba que `?scene` sin `?qa=1` se queda en el menú. Revisión de la QA
antigua punto por punto: `qa/OLD_QA_RECHECK.md`.

## Lanzarlo

- En cada PR y en `main`: automático (build → walkthrough).
- Contra producción: Actions → build → Run workflow → `BASE_URL=https://adventure.zerothetoken.com`. Lanza
  smoke y walkthrough sin compilar. La API solo existe si ese despliegue ya incluye A0.1.
- Una sola ruta: `WALKTHROUGH_ONLY=<id>`.

## Selftest del runner (A0.5)

`qa/selftest.json` tiene una ruta por cada rama de clasificación de `scripts/walkthrough.mjs`, contra el juego
real y sin tocar escenas. Cada ruta dice qué resultado espera (`expectStatus`: `pass`/`fail`/`xfail`/`xpass`/
`error`) y opcionalmente `expectDetail` (expresión regular del detalle). `npm run test:walkthrough:selftest`
(`--selftest`) falla si alguna clasificación no coincide; en CI va en el job `walkthrough` justo después de las
rutas reales (aunque fallen), con el mismo `BASE_URL`, y deja capturas en el artefacto
`walkthrough-selftest-shots`.

| Ruta | Espera | Rama |
|---|---|---|
| `st-pass-walkthrough` | PASS | walkthrough que sale bien |
| `st-fail-expect` | FAIL | `expect` imposible en un walkthrough |
| `st-fail-sin-objetivo` | FAIL | pasos bien, `goal` sin cumplir |
| `st-fail-atajo-abierto` | FAIL | se cumple el `goal` en el intento (aunque falle su `expect`) |
| `st-xfail-atajo-conocido` | XFAIL | el mismo atajo con `knownBreak` |
| `st-pass-trigger-pisado` | PASS | `[qa:blocked]` en el intento: pisa `outside.tr_game_opening`, que no cambia de escena |
| `st-xpass-ya-cerrado` | XPASS | lo mismo con `knownBreak` |
| `st-pass-rechazo-visible` | PASS | intento con `rejects` («INVALID CODE» de `hs_keypad`) y acción ejecutada |
| `st-error-sin-rechazo` | ERROR | el intento no muestra el `rejects` pedido |
| `st-error-preparacion-expect` | ERROR | `expect` imposible en un paso de preparación |
| `st-error-preparacion-bloqueada` | ERROR | `[qa:blocked]` por trigger pisado en un paso de preparación sin `gate` |
| `st-error-trigger-fuera` | ERROR | `walk` con `trigger` cuyas coordenadas caen fuera de sus bounds |
| `st-error-hotspot-tapado` | ERROR | `[qa:error]`: el ratón no alcanza `clinic_interior.hs_dr_coat`, tapado por la hitbox de `npc_dr_satoshi` (usa `goto` con `allowGoto`) |
| `st-fail-boton-wallet` | FAIL | `[qa:error]`: el clic de `walk 97,3.5` en `outside` cae bajo el botón Wallet |
| `st-def-goto` | ERROR | mal definida: `goto` sin `allowGoto` |
| `st-def-preparacion-sin-expect` | ERROR | mal definida: paso anterior al intento sin `expect` |
| `st-def-intento-sin-evidencia` | ERROR | mal definida: intento sin `expect` ni `rejects` |

Notas: `upstairs.hs_paper_tray` (tapado al 87 % por `hs_desk`, aviso del linter A0.4) no sirve para la rama de
hotspot inalcanzable: la fila de abajo de su rejilla de 7×7 queda fuera de `hs_desk` y el clic llega. Ningún
hotspot cae entero bajo el panel ni bajo Save/Wallet (los fondos ocupan justo la zona de juego), así que esa
rama se prueba con un `walk` a un punto bajo el botón Wallet (mismo `hitTestAt`). El caso «el personaje no llegó
al hotspot del intento» no tiene ruta real: lo cubren las pruebas unitarias.

La lógica pura (definición de rutas, comprobaciones, clasificación y veredicto del selftest) vive en
`scripts/lib/walkthrough-core.mjs` y se prueba sin navegador con `npm run test:walkthrough:unit`
(`tests/walkthrough-core.test.mjs`, job `lint`), que también comprueba que `qa/selftest.json` cubre las cinco
clasificaciones y que las rutas reales siguen bien definidas.

# Demos visuales (A0.2)

Los checkpoints `visual` dejan una demo `scripts/demo-<id>.mjs` que graba lo que cambió y comprueba que se
ve. El job `demo` de `.github/workflows/build.yml` las graba en Chrome headless contra el build y sube:

- `demo-gifs`: `demo-out/<nombre>/<nombre>.gif`, capturas fijas (`full.png`…), `log.txt` y `report.json`.
- `demo-frames`: los fotogramas PNG (7 días).

Cuándo corre: en PRs de ramas `scumm/*` y `feat/*` graba las demos que la PR añade o cambia, y todas si
cambia `scripts/lib/demo.mjs`. Sin demos que grabar, el job termina en verde sin compilar. A mano:
Actions → build → Run workflow con `DEMOS` (nombres separados por espacios, vacío = todas) y, si se
quiere, `BASE_URL` para grabar contra un despliegue. Una demo que falla deja su GIF igualmente y pone el
job en rojo.

Plantilla (la grabación, el viewport móvil 844x390 y el GIF están en `scripts/lib/demo.mjs`):

```js
import { startDemo } from './lib/demo.mjs';

const demo = await startDemo(import.meta.url, { fps: 8 });   // width del GIF: 640 por defecto
await demo.openScene('lobby');                              // ?scene=lobby y espera a GameScene
if (!(await demo.settle())) await demo.fail('La escena no quedó libre');
await demo.film(1500);                                      // o demo.shot() fotograma a fotograma
await demo.still('full');
await demo.end();
if (!ok) await demo.fail('Qué no se ve');                   // siempre con await
```

En local (con `npm ci` hecho, nunca en el portátil de 8 GB): `BASE_URL=… node scripts/lib/demo.mjs run <nombre>`.
Sin puppeteer: `node scripts/lib/demo.mjs list [--changed <ref>]` y `node scripts/lib/demo.mjs gif <nombre>`.

# Transiciones y precarga (A2.7)

Cambiar de escena ya no pasa siempre por la pantalla de carga. `PreloadScene` decide el modo
(`transitionMode` de `src/systems/ScenePrefetch.ts`):

- `full`: barra, porcentaje y frases. Solo en la primera carga del juego.
- `instant`: todo lo que necesita la escena (scene.json, fondo, primer plano, overlays y sprites web3) está ya en
  Phaser o descargado en la caché HTTP. Fundido de 250 ms (`FADE_SHORT_MS`) sin nada encima.
- `indicator`: falta algo por bajar. Una barrita discreta abajo que sale a los 150 ms.

Al entrar en una escena, tras el primer frame jugable, `src/systems/ScenePrefetcher.ts` precarga las escenas
vecinas (salidas `gotoScene`/`fadeToScene` de cualquier script del scene.json y `transitions.goto`): primero sus
scene.json, luego sus imágenes y, solo con el sonido activado, su música. Las voces nunca (van bajo demanda en
`VoiceSystem`). Baja un fichero cada vez con `fetch(…, { priority: 'low' })` a la caché HTTP (no decodifica
texturas: la VRAM en móvil no da para tener las vecinas decodificadas), espera mientras haya un loader de Phaser
trabajando o la pestaña esté oculta, se cancela al cambiar de escena y no hace nada con
`navigator.connection.saveData` ni en 2G (en 3G, solo la primera salida). nginx sirve `/assets/` con `max-age=31536000, immutable` y las URLs
llevan `?v=<build>`; `vite preview` imita esas cabeceras (`vite.config.ts`) para que el CI mida lo mismo.

El smoke (paso «transiciones») abre `outside` en un perfil limpio, espera la precarga del lobby, va al lobby y
vuelve: falla si alguna de las dos pasa por la pantalla de carga o tarda más de 1,5 s, si el lobby vuelve a bajar
por la red lo precargado o si la vuelta pide algo de `assets/scenes/outside/`. Deja en el log los MB por la red y
el tiempo de cada fase. La demo `scripts/demo-a2-7-transitions.mjs` graba las dos transiciones.

## Overlays recortados

Un `conditionalOverlays[]` puede llevar `bounds` (en % del fondo, como los hotspots): la imagen es solo esa caja
y `GameScene` la coloca ahí (`src/systems/OverlayPlacement.ts`). Sin `bounds`, la imagen mide lo que el fondo:

```json
{ "id": "mailbox_empty", "sprite": "overlay_mailbox_empty", "format": "webp",
  "bounds": { "x": 57.1121, "y": 62.3264, "w": 6.2769, "h": 28.7326 }, "flag": "found_envelope", "depth": 5 }
```

`node scripts/crop-overlays.mjs` (`npm run crop:overlays`, con `npm ci` hecho: usa sharp) recorta cada overlay a su
caja con contenido (alfa > 4, más 2 px de margen), lo escribe en WebP sin pérdida, pone `format` y `bounds` en el
scene.json sin reformatear el resto y borra el PNG viejo. Es idempotente. Para un overlay nuevo: exporta el PNG del
tamaño del fondo, añádelo a `conditionalOverlays` sin `bounds` y pasa el script. Con `--check`
(`npm run lint:overlays`, en el job `lint`) falla si un overlay se puede recortar, sigue en PNG o su `bounds` no
cuadra con la imagen. Los sprites de `web3Visuals` ya van con `position`/`size`; solo se comprueba que no midan
lo que el fondo. Pruebas: `npm run test:overlays` y, en `test:engine`, `tests/overlay-placement.test.mjs` y
`tests/scene-prefetch.test.mjs`.

# Efectos sin estado y migración de partidas (A1.4)

Un efecto visual nunca se hace encendiendo y apagando una flag con `wait`: cada `setFlag` queda en la partida
guardada (y en la nube) aunque acabe como empezó. Para parpadear un overlay condicional está el op `flicker`
(`src/systems/ScriptEngine.ts`):

```json
{ "op": "flicker", "overlay": "lamp_empty", "pattern": [80, 120, 50, 200], "startVisible": true }
{ "op": "flicker", "overlay": "lamp_empty", "times": 3, "onMs": 100, "offMs": 80 }
```

- `overlay` es el `id` de un `conditionalOverlays[]` de la MISMA escena (si no, error (f) del linter).
- `pattern`: duraciones en ms; el primer tramo enseña el overlay (`startVisible: false` lo oculta) y cada tramo
  siguiente lo invierte. `times`/`onMs`/`offMs` es la forma corta (por defecto 100 ms).
- Al terminar, el overlay vuelve a lo que diga su flag. No toca el estado ni dispara el autoguardado. Bloquea el
  script la suma del patrón (menos con el avance rápido); el watchdog no lo cuenta como cuelgue, y `forceReset`,
  el SHUTDOWN de la escena (`ScriptEngine.cancelEffects`) o un cambio de escena lo cortan y quitan el forzado.

Otros ops sin parpadeo de flags (A2.9, ver § Diario): `{ "op": "journalNote", "id": "<nota>" }` apunta una nota en el
diario (estado de la partida, sin flag) y `{ "op": "callAnon" }` hace que Anon llame con la pista del puzle abierto.

Renombrar una flag que ya está en partidas guardadas exige migración: `src/systems/SaveMigration.ts`
(`SAVE_VERSION`, `RENAMED_FLAGS`) migra al cargar los slots locales, la partida de la wallet, la de la nube y la
importada, y `GameScene.create` lo repite como red de seguridad. Pruebas en `tests/save-migration.test.mjs`
(`npm run test:engine`, Node 22). Renombradas: `found_hw_wallet` → `found_terminal_key` (A1.4).

# Cinemáticas (A2.10)

Ops de `src/systems/ScriptEngine.ts`; la cámara, las franjas y los actores los hace `src/systems/CinematicDirector.ts`
(uno por escena, en GameScene) y la lógica pura (geometría, cámara, salto) está en `src/systems/Cinematics.ts`
(`tests/cinematics.test.mjs`, en `npm run test:engine`). Coordenadas en % del fondo, como el resto de las escenas.

```jsonc
{ "op": "cinematicStart" }                       // o { "op": "cinematic", "on": true }
{ "op": "cameraPan", "actor": "npc_receptionist", "ms": 900, "ease": "sine" }   // o "x": 24, "y": 60
{ "op": "cameraZoom", "zoom": 2, "ms": 700 }     // opcional "actor" o "x"/"y": acerca hacia ese punto a la vez
{ "op": "cameraShake", "intensity": 0.01, "ms": 350 }
{ "op": "cameraFollow", "ms": 600 }              // vuelve al jugador y lo sigue (opcional "zoom")
{ "op": "actorMove", "actor": "player", "x": 52, "y": 92 }   // NPC: se desliza a velocidad andante ("ms" la fija)
{ "op": "actorFace", "actor": "player", "dir": "left" }      // left | right | front | back
{ "op": "actorAnim", "actor": "npc_receptionist", "anim": "talk" }   // idle | walk | talk | <clave de textura>
{ "op": "actorShow", "actor": "npc_x", "ms": 400 }  /  { "op": "actorHide", "actor": "npc_x" }
{ "op": "actorTeleport", "actor": "player", "x": 80, "y": 95, "dir": "right" }
{ "op": "iris", "mode": "out", "actor": "player", "ms": 700 }  // out = se cierra; in = se abre; o "x"/"y"
{ "op": "wipe", "mode": "out", "dir": "left", "ms": 500 }      // left | right | up | down
{ "op": "fadeToScene", "sceneId": "upstairs", "transition": "iris" }  // o { "type": "wipe", "dir": "up", "ms": 400 }
{ "op": "cinematicEnd" }                         // o { "op": "cinematic", "on": false }
```

- **Modo cinemática** (`cinematicStart` … `cinematicEnd`): franjas negras con tween (la de abajo tapa el panel y es la
  banda de subtítulos), interfaz de UIScene oculta (sin entrada: panel, Save, Wallet, trofeos; teclado salvo Esc),
  música al 35 % y la cámara pasa al director. Al salir todo vuelve como estaba: franjas fuera, interfaz, música y la
  cámara de siempre con zoom 1 (con una vuelta animada al jugador). Idempotente. Si el script acaba sin
  `cinematicEnd`, se cierra solo; también en `forceReset` del watchdog y en el SHUTDOWN de la escena: un
  `fadeToScene` dentro de una cinemática deja la escena nueva limpia (si debe seguir, su `onEnter` abre otra).
- **Cámara**: `cameraPan`/`cameraZoom`/`cameraFollow` solo dentro de una cinemática (fuera se omiten con aviso);
  respetan los límites del fondo (no enseñan nada fuera de él). `cameraShake` vale en cualquier script.
- **Actores**: `player` (o sin `actor`) es el jugador; si no, id o nombre de una NPC de `npcs[]`. `actorMove` del
  jugador usa el pathfinding (A2.1) y espera a que llegue; las NPC no tienen sprites de andar y se deslizan. Valen
  también fuera de cinemática. NPC: `actorFace` `left` = sprite espejado.
- **Transiciones**: iris y cortinilla con Graphics (sin máscaras ni assets). Una iris `out` deja la pantalla en negro
  hasta un `in`, un `fadeToScene` o el fin de la cinemática (que la abre). `fadeToScene` con `transition` sale con
  ella y la escena nueva entra con la misma abriéndose.
- **Subtítulos**: en cinemática `say` avanza solo cuando acaba su clip de voz (`VoiceSystem.clipInfo`) o, sin voz,
  al tiempo de escribirlo y leerlo; un toque lo adelanta. Sobre la cabeza de quien habla si se ve (con el zoom); si
  no (narrador, fuera de pantalla), en la franja inferior (`speech.mode = band`).
- **Salto**: mantener pulsado (600 ms) o Esc. Lo que está en curso termina en su estado final, el texto se cierra, y hasta el
  fin de la cinemática los ops se resuelven al momento (`skipActionFor`): los de estado (`setFlag`, `addItem`,
  `removeItem`, cambios de escena, logros, disfraz) se aplican; condicionales se evalúan; cámara, actores y
  transiciones saltan a su estado final (el jugador aparece donde iba); `dialogue`/web3 se ejecutan normal; textos,
  esperas, sonidos, sacudidas, `titleCard`/`narrative`/`monitorReveal`/`credits` se omiten. Lo de después del fin
  sigue normal. Un toque corto en cinemática enseña «HOLD TO SKIP» (con ratón, «ESC / HOLD TO SKIP»).
- **Watchdog**: los ops de cámara, actores y transiciones terminan solos (tween o tope de tiempo), así que no
  cuentan como cuelgue; un op ajeno colgado dentro de una cinemática sí se rescata, y el rescate cierra la cinemática.
- **QA**: `__qa.runScript(ops, { skipAfterMs })` y `state().cinematic` = `{ active, letterbox, chromeHidden,
  camera: { x, y, zoom, following }, transition, covered, skipped, ended, animating, ducked }`. Demo:
  `scripts/demo-a2-10-cinematics.mjs`; ruta `cinematica` de `walkthrough.json`.

# Diario = móvil de Dex (A2.9 + A2.9a)

Botón pequeño con un móvil dibujado (Graphics, sin assets) en la barra de arriba, a la derecha de Save y los trofeos
(`src/ui/JournalPanel.ts`, en UIScene). Con un objetivo recién cumplido o una nota sin ver enseña un punto amarillo (con un
latido al aparecer). Al tocarlo (o con **J** en escritorio) abre un panel HTML casi a pantalla completa, legible en 390×844 y
844×390, con tres pestañas:

- **Goals**: objetivos del capítulo actual (`ChapterManager.getCurrentChapter`, por las flags `chapter_N_complete`) con tic al
  cumplirse, y debajo los capítulos ya cerrados. Lo nuevo lleva la etiqueta NEW mientras está abierto.
- **Notes**: lo que Dex ha apuntado, de lo más nuevo a lo más viejo, con su capítulo.
- **Call Anon**: el botón de llamar. Da tono (`RING_MS`, 900 ms), Anon contesta con la pista del puzle ABIERTO más avanzado del
  capítulo y su voz (`anon`, `am_onyx` 0.9), y cuelga (*click*). Cada llamada sube un nivel de la escalera de ESE puzle
  (1 dirección → 2 objeto → 3 solución casi literal; luego repite la 3). Sin puzle abierto, una frase seca de relleno
  (`anonIdle`, rota con cada llamada). El panel enseña cuántos niveles lleva el puzle abierto.

No se abre con cinemática, diálogo, elección, texto en pantalla, script en marcha o cambio de escena. Se cierra con la X,
tocando fuera del móvil (con `pointerdown` y tras 350 ms, para que el clic emulado del toque que lo abrió no lo cierre), con
Esc o J, si llega un texto hablado o una cinemática, y en el SHUTDOWN de UIScene (quita el DOM y el estilo). Mientras está
abierto (`registry.journalOpen`) la escena no acepta toques ni teclas de juego y la pista por inactividad no cuenta. Todo el
texto entra con `textContent`. La pista por inactividad de V6 (`GameScene.checkIdleHint`) sigue igual: es la red de
seguridad; Anon es la ayuda que se pide.

**Datos** (`assets/journal/chapter-<n>.json`, uno por capítulo; Vite los mete en el bundle con `import.meta.glob`, así que un
capítulo nuevo es un fichero más). Lógica pura en `src/systems/Journal.ts` (`tests/journal.test.mjs`, en `test:engine`):

```jsonc
{
  "chapter": 1,
  "goals":   [{ "id": "g1_code", "text": "Find the code for Adrian's front door.", "doneWhen": "found_code_note" }],
  "notes":   [{ "id": "n1_code", "text": "Behind the porch light: …", "shownWhen": "found_code_note" },
              { "id": "n1_x", "text": "Solo con el op journalNote (sin shownWhen)." }],
  "puzzles": [{ "id": "p1_door", "openWhen": "found_code_note", "doneWhen": "door_unlocked",
                "hints": ["You have numbers. Doors like numbers.", "The keypad. The note. Introduce them.", "Use the code note on the keypad."] }],
  "anonIdle": ["Nothing to add. Keep moving."]
}
```

- Condiciones: la gramática de `when` de A2.6a (`flag`, `!flag`, `item:id`, `!item:id`; texto o lista = todas). Una mal
  escrita no se cumple (y el linter la marca).
- Puzles en el orden de la ruta: «el más avanzado» es el último de la lista cuyo `openWhen` se cumple y cuyo `doneWhen` no.
  Encadenar `openWhen` con el `doneWhen` del anterior hace que Anon siga la ruta; el primero de cada capítulo va sin
  `openWhen` (abierto al empezar). Un puzle resuelto nunca vuelve a dar pistas.
- Notas: se apuntan solas (cada 400 ms y al abrir) en cuanto se cumple `shownWhen`, y se quedan aunque deje de cumplirse
  (p. ej. un objeto que se gasta). Ids sin repetir (por tipo) en todos los ficheros. Objetivos 3-4 por capítulo (hitos de
  la biblia). El contenido de hoy sigue la ruta crítica actual de los 5 capítulos; A3.3-A3.7 reescriben estos ficheros.
- Voz: las pistas y `anonIdle` se dicen (`scripts/voices/extract.mjs` las saca con speaker «Anon» → `anon`, más la frase de
  reserva `ANON_FALLBACK` de Journal.ts); objetivos y notas solo se leen, sin voz. Texto nuevo de Anon → etiqueta `voices`.
- Progreso en la partida (`GameState.journal`, aditivo y opcional; `SaveMigration.ts` lo sanea): `notes` (apuntadas),
  `seen` (vistas con el diario abierto: el punto), `hints` (puzle → nivel dado) y `calls`. El save-server lo guarda tal cual.

**Opcodes** (`src/systems/ScriptEngine.ts`; también en los onEnter de diálogo, que comparten contexto). Junto a `flicker`
(§ Efectos sin estado):

```json
{ "op": "journalNote", "id": "n2_receptionist" }
{ "op": "callAnon" }
```

- `journalNote`: apunta una nota (la que no tiene `shownWhen` solo se apunta así). Es estado: se aplica al saltar una
  cinemática y en el rescate del watchdog. Una nota que no existe es error (h) del linter y aviso en consola.
- `callAnon`: Anon llama desde el script (la misma escalera que el botón; sube el nivel) y su frase sale como `say` con
  speaker «Anon». Presentación: se omite al saltar una cinemática.

**QA**: `state().journal` = `{ open, tab, chapter, goals: [{ id, done }], notes: [ids], anon: { puzzle, level, text } | null,
openPuzzle: { puzzle, level } | null, unseen, calling }` (`anon` es la última llamada y sobrevive al cambio de escena;
`puzzle: null` = relleno). `__qa.openJournal()/closeJournal()/callAnon()`; pasos `journal` y `callAnon`. El smoke abre y
cierra el diario con toques reales en 390×844 (y con J/Esc) y comprueba que el SHUTDOWN no deja el panel colgado. Demo:
`scripts/demo-a2-9-journal.mjs`.
# Densidad de píxel (A2.8)

Lógica pura en `src/systems/PixelScale.ts` (`tests/pixel-scale.test.mjs`, en `npm run test:engine`); la aplican
`Player` (jugador y disfraz de mono) y `GameScene` (NPC). Un **píxel de arte** es un píxel de la hoja del sprite (el
jugador mide 103, la recepcionista y el Dr. Satoshi 37: los tres dibujados a la misma densidad).

Campos opcionales de `scene.json` (junto a `walkableAreas`/`blockedAreas` y los `walkTo`/`face` de A2.2):

```jsonc
"pixelScale": 5.5,       // píxeles de fondo por píxel de arte de personaje: la unidad de píxel del mundo (1-12)
"depthScale": { "yTop": 82.5, "yBottom": 91, "scaleTop": 0.45, "scaleBottom": 1 },  // factor 0,2-2, lineal en y (%)
"npcs": [{ "id": "npc_x", "artScale": 1 }]   // hoja dibujada a otra densidad que la del jugador (0,25-4; 1 por defecto)
```

- **Unidad**: `pixelScale` de la escena; si no hay, `assets/config/global.json` → `pixelScale` (5,5, la media de los
  `playerScale` que se habían ajustado a mano en los interiores; el jugador mide el 49 % del alto del fondo). El
  `player.playerScale` y el `npcs[].scale` de antes ya no se usan (el linter avisa, regla i). Jugador, mono y NPC
  comparten la unidad: no hay mezcla de resoluciones en una escena.
- **Pantalla**: base = `pixelScale × artScale × coordSystem.scale`, redondeada al entero más cercano si eso no cambia
  el tamaño más de un 20 % (`SNAP_TOLERANCE`): desde ×2 siempre (1280x720 → ×3, 1920x1080 → ×4), así a DPR 1 cada
  píxel de arte mide lo mismo. En móvil apaisado (844x390 → 1,38) un entero cambiaría el tamaño un 28-45 % y se deja
  exacta (ahí el lienzo va a DPR ≥ 2). Por debajo de ×1 (plano general de `epilogue_outside`) no hay entero posible.
  Con la misma ventana todas las escenas con la unidad por defecto dan la misma escala, y el mismo alto.
- **Profundidad**: `depthScale` multiplica la base ya redondeada por el factor de la y de los pies (constante fuera de
  `yTop`-`yBottom`): en la franja del factor 1 la escala sigue entera y al andar crece o encoge sin saltos, como en
  Monkey Island. Solo en caminos que se alejan: `outside` (porche), `mountain` (sendero) y `clinic_exterior`
  (camino del monte). Los spawns están en la franja del factor 1. Pathfinding, triggers y `walkTo` van por los pies
  (en %), que no se mueven; el hit-test de las NPC es la inversa de la escala (`worldToArt`), y Facing (A2.2) usa el
  alto «del mundo» (sin el redondeo de pantalla), así girarse no depende del tamaño de la ventana.
- **Filtros**: personajes en NEAREST (`pixelArt: true`, `roundPixels: true`); el arte de la escena (fondo, primer
  plano, overlays, sprites web3) en LINEAR (`GameScene.applySceneArtFilter`): son pinturas de 3712 px a ≈ 5 px por
  píxel de arte reducidas a ×0,25-0,7, y en nearest los cables y bordes finos salen a trozos y los tramados hacen
  moiré al mover la cámara.
- **QA**: `state().pixel` = `{ pixelScale, playerScale, playerBase, snapped, integer, depth, playerHeightPct,
  worldHeightPct, coordScale, npcs: [{ id, scale, integer, heightPct }] }`. `expect.pixel`: `integer` (jugador y NPC
  a escala entera), `pixelScale`, `heightPct` `{ min, max }` (alto del jugador en pantalla, % del fondo) y
  `sameHeightAs` (escena o lista ya vista en la ruta, con el jugador en la franja sin profundidad) con `tol` relativa
  (0,1). Demo: `scripts/demo-a2-8-pixel-density.mjs`.

# Animación del protagonista (A4.1)

Lógica pura en `src/systems/PlayerAnim.ts` (`tests/player-anim.test.mjs`, en `npm run test:engine`); `Player.ts` solo
aplica lo que decide (textura, giro sobre los pies y elevación) y `GameScene` le dice si el jugador tiene texto en pantalla
y si la escena está libre. Sin arte nuevo: los PNG de `assets/sprites/player`.

- **Andar arriba y abajo**: la dirección de cada tramo se mide en píxeles de mundo; pasa a vertical si |dy| > 1,5·|dx| y
  vuelve a perfil solo si |dy| < |dx| (histéresis: una diagonal no parpadea). Bajando, `Front-Left`/`Front-Right`
  alternando cada 220 ms como paso; subiendo, `Back-Left`/`Back-Right`; con balanceo de ±2,5° sobre los pies. Al llegar
  se queda de frente (bajaba) o de espaldas (subía): `facing` `front`/`back`. De perfil, los 3 fotogramas de siempre.
- **Hablar**: mientras el jugador tiene texto en pantalla (`UIScene.getSpeech().kind === 'player'`, con o sin voz) y está
  quieto, cabeceo de 1,5° a 7 Hz; de frente además alterna `Idle-1`/`Front-Left`/`Idle-1`/`Front-Right` (manos) a 3,5 Hz.
  Para al cerrarse el texto. El texto sobre la cabeza no se mueve con el tween (`GameScene.speakerHead` usa los pies sin
  la elevación).
- **Coger o usar**: PICK, USE, OPEN, CLOSE, PUSH, PULL y GIVE sobre algo con posición, al llegar (o al momento si no
  anda): gesto de 320 ms a la vez que el primer op (no lo retrasa). De perfil, el fotograma de andar con el brazo
  adelantado (`Walk-*-1`) inclinado 6° hacia el objetivo; de espaldas, su `Back-*` de puntillas (2 píxeles de arte); de
  frente, `Front-*` hacia el lado del objetivo. `state().busy` incluye `gesture` mientras dura.
- **Reposo**: tras 6 s quieto con la escena libre (sin script, texto, diálogo, cinemática ni diario), un tic cada 3-6 s:
  mirar a un lado (perfil), mirar a cámara (`Idle-1`) o mover el pie (`Idle-1`/`Idle-2`). Solo cambia la textura: la
  orientación (`facing`) no. Con `?qa=1` la semilla es fija y salen siempre en el mismo orden.
- **Escala**: nada de esto toca la escala (un squash la haría fraccionaria y A2.8 la quiere entera): son giros y una
  elevación en píxeles de pantalla enteros, y al parar todo vuelve a giro 0, elevación 0 y la escala base.
- **Disfraz de mono**: mismo sistema con lo que hay (`Ape-Idle-1..4`, `Ape-Walk-Left/Right-0..2`): en vertical anda con
  los fotogramas de perfil del último lado y el balanceo; hablar alterna `Ape-Idle-1`/`Ape-Idle-3`. Arte pendiente:
  `Ape-Front-Left/Right` y `Ape-Back-Left/Right` (y `Ape-Left`/`Ape-Right` de perfil quieto).
- **Cinemáticas (A2.10)**: `actorMove` del jugador anda con las mismas animaciones (también en vertical) y, saltado, acaba
  mirando como si hubiera llegado andando; `actorAnim` con una textura fija hace que hablar solo cabecee y quita los tics.
- **QA**: `state().anim` = `{ texture, moving, dir, vertical, talking, gesture, idleTick, idleTicks, costume, preview,
  angle, liftPx, scale, baseScale, rest }`; `expect.anim` (ver § Rutas); `__qa.previewCostume('ape' | 'player' | null)`.
  Demo: `scripts/demo-a4-1-player-anim.mjs`.

# Respuestas de fallo (A2.5)

Cuando algo no funciona, Dex lo dice con una frase con personalidad y con voz, nunca con una plantilla. Motor puro
`src/systems/FailResponses.ts` (sin Phaser; tests en `tests/fail-responses.test.mjs`, `npm run test:engine`), una sola
instancia para la partida en `src/systems/FailResponsesData.ts`. Datos:

| Dónde | Campo | Cuándo |
|---|---|---|
| `assets/config/fail-responses.json` | `verbDefaults.<VERBO>` (≥ 3 frases) | verbo sin script en un hotspot (antes `GameScene.VERB_DEFAULTS`) |
| | `itemVerbDefaults.<VERBO>` (≥ 3) | verbo sobre un objeto del inventario sin respuesta propia en `ScummUI.ITEM_VERB_RESPONSES` (LOOK si no hay `ITEM_DESCS`) |
| | `items.<idObjeto>` (≥ 3) | bolsa de «mal uso» del objeto: usarlo en algo que no toca |
| | `itemHotspot` (≥ 5), `itemNpc.USE` / `itemNpc.GIVE` (≥ 3) | último recurso si el objeto no tiene bolsa |
| | `itemItem.default` (≥ 5) y `itemItem.pairs[{ items: [a, b], lines }]` | objeto + objeto sin combo de `global.json` (la pareja, sin orden, manda) |
| `scene.json` | `regions.hotspots[].useResponses` = `{ _default: [...], <idObjeto>: [...] }` | objeto sobre ese hotspot sin combo: `<idObjeto>` = el intento tentador que no es la solución; `_default` = cualquier otro objeto (puertas, pantallas, agua) |
| | `npcs[].useResponses` / `giveResponses` (frase o lista) | USE/GIVE de un objeto a la NPC sin `itemDialogues`; `_default` es una bolsa |

Prioridad (objeto sobre hotspot o NPC): pareja específica > `_default` del hotspot/NPC > `items.<id>` > bolsa genérica.
Cada bolsa no repite su última frase (al azar entre las demás); **con `?qa=1` va en ronda desde 0** (frase 0, 1, 2…),
así que el primer intento de una ruta dice la frase 0 de su bolsa y el walkthrough puede comprobarlo con `rejects`. Las
bolsas de un hotspot se identifican por escena + id (los ids se repiten entre escenas). Ningún texto lleva marcadores
(`{item}`, `${…}`): todo es literal, para que tenga clip (`scripts/voices/extract.mjs` lo extrae con hablante `player`).
Voz: Dex Malone (biblia § 2 y § 5): mantiene la intención del verbo, remate al final, chiste cripto como mucho uno de
cada cuatro y siempre de Dex; callbacks a Fernando (la planta), Gerald, Penny, las gafas «prescription».

QA: `state().lastFailResponse` = `{ kind, item, target, verb, text, bag }` (`kind`: `item-hotspot`, `item-npc`,
`item-item`, `verb`, `item-verb`; `bag`: `hotspot:<escena>/<id>:<objeto|_default>`, `npc:<escena>/<id>:<USE|GIVE>:<objeto|_default>`,
`item:<id>`, `itemHotspot`, `itemNpc:<VERBO>`, `itemItem:<a>+<b>`, `itemItem`, `verb:<VERBO>`, `itemVerb:<VERBO>`;
`last-resort` si no hay ninguna bolsa). `expect.failResponse` de las rutas compara `kind`, `item`, `target`, `verb`, `bag`
(iguales) y `text` (expresión regular). La ruta crítica lo usa en el lobby: PUSH/PULL/GIVE sin script sobre `hs_poster`
(frase 0 de `verbDefaults`), la keycard en el abrigo (pareja específica) y el sobre en el póster (bolsa del objeto),
sin cambiar la partida. El smoke comprueba que dos PUSH seguidos dicen las frases 0 y 1. Linter: regla (j).

# Linter de escenas (A0.4)

`scripts/lint-scenes.mjs` revisa el contenido de `assets/scenes/<id>/scene.json` sin compilar ni abrir el
juego (Node puro, sin dependencias, segundos). Corre en el job `lint` de `.github/workflows/lint.yml`:
deja la tabla en el resumen del job y sube `lint-scenes-report.json` y `.md` como artefacto
`lint-scenes-report`.

| Regla | Qué detecta | Por defecto |
|---|---|---|
| (a) | flags que se leen y nunca se ponen, o que se ponen y nunca se leen | aviso |
| (b) | objetos que se consiguen (`addItem`) y no sirven para nada | aviso |
| (c) | salidas (`fadeToScene`/`gotoScene`) en hotspots y triggers sin gate, para revisar a mano | aviso |
| (d) | operaciones de estado (`setFlag`, `addItem`, `removeItem`, cambio de escena, logros) después de un `say` en el mismo bloque, o en una rama que se abre después del `say`; marca los parpadeos (la misma flag puesta varias veces) | aviso |
| (e) | `player.spawn`, `transitions.goto[].spawn` y `spawn` de las salidas fuera de las `walkableAreas` de la escena destino (A1.8: **error**; una escena destino sin `walkableAreas` sigue siendo aviso) | **error** |
| (f) | fondos, primeros planos, overlays, `web3Visuals`, música, `playSound`, iconos de objetos, sprites de NPC, escenas destino y árboles de diálogo que no existen | **error** |
| (g) | hotspots solapados; aviso fuerte si uno contiene a otro (si el que contiene va antes en la lista, el clic nunca llega al de dentro) | aviso |
| (h) | A2.9, diario (`assets/journal/*.json`): fichero inválido, capítulo o id repetidos, campos que faltan, condición mal escrita, `hints` que no son 3 y `journalNote` a una nota que no existe (**error**); flags que el diario lee y nada pone, objetos que mira y nada da (aviso). Las flags que lee el diario cuentan como leídas para (a) | **error** / aviso |
| (i) | A2.8: `scale` a mano en `npcs[]` o `player.playerScale` (fuera del sistema de densidad de píxel) y `pixelScale`, `depthScale` o `npcs[].artScale` fuera de rango | aviso |
| (j) | A2.5, respuestas de fallo: `useResponses` de un hotspot o `useResponses`/`giveResponses` de una NPC con un objeto que no existe, bolsa vacía o con una frase con marcador (`{item}`, `${…}`: no tendría voz), y `assets/config/fail-responses.json` inválido (bolsas de verbo con < 3 frases, objeto + objeto con < 5, parejas mal formadas o con objetos que no existen) (**error**); objeto del inventario con < 3 frases de mal uso y pareja de un hotspot que es un combo (nunca se dice) (aviso) | **error** / aviso |

Las rutas que comprueba (f) son las que resuelve el código, no el nombre del JSON: el fondo es siempre
`background.webp`, el primer plano `foreground.webp`, los iconos `assets/sprites/items/<id>.png` y además
tienen que estar en las listas de precarga de `PreloadScene.ts` (si no, aviso: el asset existe pero no se
carga). La `walkmask` no la carga ningún sistema, así que si falta es solo aviso. La cabecera del script
documenta todas las fuentes de verdad (qué cuenta como lectura o escritura de una flag, qué cuenta como
uso de un objeto, de qué ficheros de `src/` se fía).

## Lanzarlo

- `npm run lint:scenes` (o `node scripts/lint-scenes.mjs`): consola agrupada por regla y escena, resumen
  `errores: N · avisos: M` y los dos informes en la raíz (ignorados en git). Sale con 1 solo si hay errores.
- `--scene <id>`: solo los hallazgos de esa escena (el análisis de flags y objetos sigue siendo global).
- `--strict`: todo es error (útil antes de cerrar un checkpoint de contenido).
- `--json`: el informe JSON por la salida estándar. `--no-write`: no escribe los informes.
- Pruebas: `npm run test:lint` (`node --test tests/lint-scenes.test.mjs`, escenas sintéticas en memoria).

## Silenciar un falso positivo

`qa/lint-scenes-allow.json` es una lista de `{ "rule", "scene"?, "id"?, "reason" }`. `rule` es la letra
(`"c"`) o el nombre de la regla; `id` se compara con el id del hallazgo (flag, objeto, hotspot, ruta del
asset, par `hsA+hsB`) o con su ruta completa (`escena.hotspot.VERB[3]`) y admite `*` al final. Sin
`reason` la entrada se ignora, y una entrada que ya no silencia nada sale en el informe para borrarla.
Úsalo poco: para un hallazgo real que no se arregla en la misma PR, motivo «hallazgo A0.4, pendiente» (o
el checkpoint que lo cierra); para un falso positivo, explica por qué el linter no lo ve.

# Voces (A0.3)

Todo texto que el juego dice en voz alta tiene que tener su MP3 en `assets/audio/voice/` y su entrada en
`src/config/voice.config.ts`. Los clips se generan con Kokoro (gratis, Apache-2.0) **solo en GitHub
Actions** (`.github/workflows/voices.yml`); nunca en local.

## Cómo se extrae

`node scripts/voices/extract.mjs` (Node puro) saca la lista `[{ speaker, text, key, status, sources }]`;
`--missing` deja solo lo que no tiene MP3. Cuenta como hablado lo que UIScene pasa a `VoiceSystem`:

- Escenas y `assets/config/global.json`: toda op `say`/`sayBrief` (en cualquier bloque anidado), el texto
  de cada nodo de diálogo, `npcs[].giveResponses`/`useResponses` (A2.5: frase o lista, `_default` incluido; una
  cadena con marcador se salta), `regions.hotspots[].useResponses` (A2.5) y las líneas de las ops `narrative`
  (suenan por escena con `NARRATOR_SEQUENCES['<escena>:narrative']`).
- A2.5, `assets/config/fail-responses.json`: todas las bolsas de respuestas de fallo, con hablante `player`.
- Código (`CODE_SOURCES` en `extract.mjs`): las tablas de frases de `ScummUI` (`ITEM_DESCS`,
  `ITEM_VERB_RESPONSES`), `LAST_RESORT` de `src/systems/FailResponses.ts` y los literales que se emiten como
  `say` (`ScummUI`, `GameScene`, `UIScene`, `ScriptEngine`).
- Diario (A2.9, `assets/journal/*.json`): las pistas de Anon (`puzzles[].hints`) y sus frases de relleno (`anonIdle`), con
  hablante `anon`; y la frase de reserva `ANON_FALLBACK` de `src/systems/Journal.ts` (`CODE_SOURCES` con `speaker`).
  Objetivos y notas no (solo se leen).
- Fuera, a propósito: las plantillas con `${…}` (desde A2.5 ya no queda ninguna respuesta de fallo con
  plantilla: «I can't use X with Y», «It's X. Nothing special…» y «X doesn't want Y» son bolsas literales), `choices[].text` (no se leen en voz alta), `titleCard`
  (UIScene tiene esa voz desactivada), logros y textos de interfaz. `sayBrief` sí se extrae aunque hoy
  UIScene no le pone voz, para que el clip ya exista si se activa.

Clave: `<speaker>_<6 primeras palabras normalizadas>_<md5 del texto, 8>` (como
`generate_memelab_voices.py`). El mapa anterior a A0.3 (2.617 clips con varios esquemas de clave) está
congelado en `scripts/voices/fixed-keys.json`: si un texto ya tenía clip según la búsqueda de `VoiceSystem`
(100 primeros caracteres normalizados) se usa esa clave y no se regenera nada.
`node scripts/voices/build-config.mjs` reescribe `voice.config.ts` entero y determinista: lo congelado en
su orden y detrás lo nuevo (`--check` solo compara).

## Mapa de voces (`scripts/voices/voices.json`)

| Hablante | Quién | Voz Kokoro | Velocidad |
|---|---|---|---|
| `player` | el protagonista (y las acotaciones de las respuestas de NPC) | `am_michael` | 0.95 |
| `satoshi` | Dr. Satoshi | `am_adam` | 0.85 |
| `recep` | la recepcionista del lobby | `af_heart` | 1.0 |
| `bot` | B.O.T. (recovery_pool) | `am_adam` | 0.9 |
| `nar` | narrador de las cinemáticas | `bm_george` (británico) | 0.9 |
| `npc` | personajes nuevos sin voz propia | `bm_lewis` (británico) | 1.0 |
| `anon` | Anon, la voz del teléfono (A2.9; adelanta la parte de Anon de A3.3b) | `am_onyx` | 0.9 |

B.O.T. conserva la voz de sus 26 clips existentes (comparte timbre con Satoshi, pero nunca coinciden en
escena). El hablante sale del campo `speaker` del op o del nodo (reglas `match`: contiene «b.o.t»,
«satoshi», «recep», «anon», «adrian»); sin speaker es `player`, y un speaker desconocido es `npc`. Para dar voz propia a un
personaje nuevo, añade un hablante y su regla `match` en `voices.json`.

## Lanzar la generación

- En una PR: ponle la etiqueta **`voices`** (cada vez que se etiqueta corre una vez; para repetir, quítala y
  vuelve a ponerla).
- A mano: Actions → **voices** → Run workflow, eligiendo la rama (o el input `ref`).

El workflow instala Kokoro (torch CPU), espeak-ng y ffmpeg, genera los MP3 (mono, 24 kHz, `-q:a 2`, como
los existentes), regenera `voice.config.ts`, comprueba la cobertura y hace commit `chore(voices): N clips
nuevos generados por el CI` en la rama, con los MP3 y la lista como artefactos. Sin faltantes acaba en verde
sin commit. Como un push con `GITHUB_TOKEN` no dispara workflows, lanza él mismo `lint` y `build` sobre la
rama para que el commit nuevo tenga sus checks.

## Cobertura

`npm run lint:voices` (`node scripts/voice-coverage.mjs`, paso «Cobertura de voces (A0.3)» del job de
lint) sale con 1 si hay texto hablado sin MP3 (`sin-clip`), si `voice.config.ts` no es lo que genera
`build-config.mjs` (`desactualizado`: un MP3 sin registrar, un clip nuevo sin entrada, una edición a mano)
o si una clave del config no tiene MP3 (`roto`). Escribe `voice-coverage-report.{md,json}` en la raíz
(ignorados en git). Pruebas: `npm run test:voices`.

## Añadir una excepción

Solo durante la transición: `qa/voice-coverage-allow.json` es una lista de
`{ "key": "<clave>" | "text": "<principio del texto>", "reason": "…" }`. Sin `reason` no vale, y una entrada
que ya no silencia nada sale como aviso para borrarla. Lo normal es no necesitarla: etiqueta la PR con
`voices`.

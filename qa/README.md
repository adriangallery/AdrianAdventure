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
| `isWalkable(x, y)` | A2.1: si el punto (en %) se pisa en la escena actual (`walkableAreas` menos `blockedAreas`); síncrona |
| `state()` | Escena, inventario, flags, visitadas, hotspots visibles, elecciones, avisos, log (`logTotal`: líneas apuntadas desde que cargó) `actions` (verbos que llegaron a ejecutarse) y `resizeListeners` (A1.10: listeners de `resize` del ScaleManager) y `path` (A2.1: última ruta calculada al andar: origen, puntos de paso y destino) |

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
(`width`, `height`). Cada paso admite `expect` con `scene`, `has`, `lacks`, `flags`, `unsetFlags`, `visited`,
`achievements`, `lastChoices` y `noListenerGrowth`, y `rejects`: expresión regular (sin distinguir mayúsculas) que tiene que salir en los textos
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

Renombrar una flag que ya está en partidas guardadas exige migración: `src/systems/SaveMigration.ts`
(`SAVE_VERSION`, `RENAMED_FLAGS`) migra al cargar los slots locales, la partida de la wallet, la de la nube y la
importada, y `GameScene.create` lo repite como red de seguridad. Pruebas en `tests/save-migration.test.mjs`
(`npm run test:engine`, Node 22). Renombradas: `found_hw_wallet` → `found_terminal_key` (A1.4).

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
  de cada nodo de diálogo, `npcs[].giveResponses`/`useResponses` (salvo `_default`, que lleva `{item}`) y
  las líneas de las ops `narrative` (suenan por escena con `NARRATOR_SEQUENCES['<escena>:narrative']`).
- Código (`CODE_SOURCES` en `extract.mjs`): las tablas de frases de `ScummUI` (`ITEM_DESCS`,
  `ITEM_VERB_RESPONSES`, `DEFAULT_ITEM_VERB_RESPONSES`), `GameScene.VERB_DEFAULTS` y los literales que se
  emiten como `say` (`ScummUI`, `GameScene`, `UIScene`, `ScriptEngine`).
- Fuera, a propósito: las plantillas con `${…}` («I can't use X with Y», «It's X. Nothing special…», «X
  doesn't want Y»: dependen de pares de objetos), `choices[].text` (no se leen en voz alta), `titleCard`
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

B.O.T. conserva la voz de sus 26 clips existentes (comparte timbre con Satoshi, pero nunca coinciden en
escena). El hablante sale del campo `speaker` del op o del nodo (reglas `match`: contiene «b.o.t»,
«satoshi», «recep»); sin speaker es `player`, y un speaker desconocido es `npc`. Para dar voz propia a un
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

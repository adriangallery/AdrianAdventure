# QA automática (A0.1)

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
| `goto(sceneId, spawn?)` | Cambiar de escena como `gotoScene` (solo para preparar pruebas, no en rutas) |
| `dismissAll()` | Cerrar textos y cinemáticas hasta que el juego quede quieto |
| `state()` | Escena, inventario, flags, visitadas, hotspots visibles, elecciones, avisos y log |

Todas esperan a que el juego quede quieto y devuelven `state()`. Los errores empiezan por `[qa:blocked]`
(el juego no deja hacerlo) o `[qa:error]` (id inexistente, tiempo agotado).

Los clics se resuelven con el mismo hit-test que el ratón (`GameScene.hitTestAt`): zona del panel, fuera
del fondo, NPC con diálogo antes que hotspots y hotspot oculto que tapa a otro. La API busca un punto del
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

Pasos: `newGame`, `act`, `use`, `combine`, `talk`, `walk`, `goto`, `dismissAll`, `wait` (`ms`). Cada paso
admite `expect` con `scene`, `has`, `lacks`, `flags`, `visited` y `achievements`. Las rutas llevan un
`goal` con el mismo formato.

`walk` con `untilScene` repite el clic si un trigger intermedio paró al personaje. Si no llega a esa
escena lanza `[qa:error]`. Con `trigger` (id de un trigger cuyo rectángulo contiene `x,y`) distingue dos
casos:
- el personaje pisó el trigger (o se disparó) y no cambió de escena: es un gate cerrado, `[qa:blocked]`;
- no llegó a pisarlo: `[qa:error]`, por coordenadas o pathfinding rotos.

Reglas de las rutas `sequence-break`, para no dar por cerrada una ruta sin haber probado el atajo:
- el paso que intenta el atajo lleva `"attempt": true` (si ninguno lo lleva, es el último);
- todos los pasos anteriores al intento llevan `expect`; si falta, la ruta sale ERROR («mal definida»);
- la ruta solo sale cerrada si la para el intento o un paso con `"gate": true` (un gate que el checkpoint
  que cierra el atajo puede poner antes, como las salidas de la montaña);
- un `[qa:blocked]` o un `expect` fallido en cualquier otro paso es ERROR, igual que un `[qa:error]` en
  cualquier paso.

### Atajos conocidos (expected-fail)

| Ruta | Atajo | Lo cierra |
|---|---|---|
| `clinica-sin-printout` | `outside.tr_mountain` → `mountain.tr_to_clinic` sin gate: clínica desde el minuto 1 | A1.2 |
| `recepcion-clinica-sin-capitulo-3` | Mismo atajo + la hoja de `hs_visitor_box` abre la puerta: recepción sin sótano | A1.2 |

`sotano-sin-keycard` es de control: debe quedarse fuera.

## Lanzarlo

- En cada PR y en `main`: automático (build → walkthrough).
- Contra producción: Actions → build → Run workflow → `BASE_URL=https://adventure.zerothetoken.com`. Lanza
  smoke y walkthrough sin compilar. La API solo existe si ese despliegue ya incluye A0.1.
- Una sola ruta: `WALKTHROUGH_ONLY=<id>`.

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
| (e) | `player.spawn`, `transitions.goto[].spawn` y `spawn` de las salidas fuera de las `walkableAreas` de la escena destino | aviso |
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

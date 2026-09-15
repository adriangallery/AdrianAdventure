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

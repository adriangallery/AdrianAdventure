# A1.8 · Re-verificación de la QA antigua

Lista de la QA antigua (memoria `project_adrianadventure.md`) comprobada contra `main` = `8ce93ce`. Arreglos en el
commit `70a23ef` (rama `scumm/a1-8-old-qa`). Los números de paso son de `qa/walkthrough.json` (ruta `ruta-critica`,
desde 0) tras esta PR.

| # | Punto | Estado en `main` | Evidencia | Arreglo | Prueba |
|---|---|---|---|---|---|
| 1 | Sin camino al sótano | **Ya resuelto** | `rooftop.hs_roof_access_panel` (USE/OPEN y combo con `keycard`) → `fadeToScene basement` con `vane_turned` + `has_keycard`; `basement.hs_stairs` vuelve al lobby. La ruta crítica entra jugando (paso 20, `expect.scene: basement`, `basement_unlocked`) y sale a pie (paso 27 por `server_room.tr_to_basement`, paso 31 escaleras). Atajo VIP: `outside.hs_doormat` solo con `vip_rug_hint` (la elección de holder de la recepcionista, con gate ERC721) | — | Walkthrough pasos 20, 27 y 31; `sequence-breaks.json` → `sotano-sin-keycard` (de control: sin keycard no se entra) |
| 2 | Floppy y hardware wallet sin uso | **Ya resuelto** (con un resto inalcanzable) | La «hardware wallet» es el `ledger` del felpudo (`outside/scene.json:844`, paso 3): se usa en `basement` combo `ledger+hs_main_computer` (`basement/scene.json:1255`, paso 29, `computer_unlocked`). `floppy_disk` se usa en el ordenador del sótano (paso 30, da el `printout`). `floppy_box` (holders, `src/ui/WalletButton.ts:107`) tiene 6 combos en 5 escenas. Resto: `vip_floppy` solo está en `lobby.items.sceneItems`, que ningún sistema del motor carga (`grep sceneItems src` = solo el tipo): el jugador no puede conseguirlo | Excepción del linter con motivo para (b) y (f) de `lobby.vip_floppy` | `qa/lint-scenes-allow.json`; walkthrough pasos 3, 29 y 30 |
| 3 | Triggers al hacer clic en vez de al pasar | **Ya resuelto** | `GameScene.update` (`src/scenes/GameScene.ts:422`) dispara los triggers solo mientras `player.isMoving()` y el personaje pisa el rectángulo; `checkSpawnTriggers` (`:1246`) solo al aparecer encima. El clic (`hitTestAt` `:518`, `dispatchTap` `:596`) no mira triggers: solo NPC y hotspots | — | Walkthrough pasos 27 y 33 (`walk` con `trigger` y `untilScene`: el runner exige pisar el trigger); selftest `st-pass-trigger-pisado` y `st-error-trigger-fuera` |
| 4 | Recepcionista no clicable | **Ya resuelto**, sin prueba hasta ahora | `hitTestAt` comprueba los NPC con diálogo antes que los hotspots (`GameScene.ts:529`), así que `npc_receptionist` (`lobby/scene.json:813`) gana a `hs_monitor_desk`, que la rodea | Paso nuevo en la ruta crítica | Walkthrough paso 7: `talk npc_receptionist` («Patient Zero» → «nervous»), `expect.flags.receptionist_mentioned_pz`. La API de QA lanza `[qa:error]` si el ratón no alcanza el sprite |
| 5 | PUSH/PULL/GIVE sin scripts | **Resuelto** (respuesta por defecto) | 114/136 hotspots con PUSH, 112 con PULL y 111 con GIVE escritos; el resto (memelab, recovery_pool, `lobby.hs_poster`…) cae en `GameScene.VERB_DEFAULTS` (`:1004`, `executeHotspotVerb` `:1084`): «I can't push that.», «I can't pull that.», «I have nobody to give that to.». Ningún script vacío. Objetos del inventario: respuestas por verbo en `ScummUI.ts` (~`:463`); NPC con GIVE+objeto: `giveResponses` o texto genérico. Nunca silencio ni error. El humor de esos textos es A2.5/A3.8 | — (no hace falta código) | Walkthrough pasos 8-10: PUSH, PULL y GIVE sobre `lobby.hs_poster` con `rejects` del texto por defecto |
| 6 | Spawns fuera de zona caminable | **Vigente (1)** → arreglado | Linter A0.4 regla (e): `memelab` → `recovery_pool` a (7, 98) en `hs_exit_door.USE/OPEN` y `tr_exit_left`; la `walkableArea` de la piscina empieza en x = 11.9. Era el único | Spawn a (12.5, 98), delante de la puerta oscura (`memelab/scene.json:515,530,595`). La regla (e) «spawn fuera de las walkableAreas» pasa de aviso a **error** (el aviso «escena sin walkableAreas» sigue siendo aviso) | `node scripts/lint-scenes.mjs` → `e 0E/0A` (job `lint` falla si vuelve); `tests/lint-scenes.test.mjs` comprueba la severidad |
| 7 | Modo debug en producción | **Vigente (parcial)** → arreglado | El overlay de bounds ya era solo dev (`GameScene.DEBUG = import.meta.env.DEV`, `:65`, `:1203`) y no hay atajos de teclado. Pero `?scene=<id>` (`src/main.ts`, `src/scenes/BootScene.ts`: cualquier escena sin gates ni capítulos), `?skip` y `?dev` (selector flotante de escenas) valían en el build de producción | `src/config/debugParams.ts`: `?scene`, `?skip`, `?dev` y `?hintAfter` solo en `npm run dev` o con `?qa=1`. Smoke y demos (`scripts/lib/demo.mjs`) cargan con `?qa=1&scene=…` | `tests/debug-params.test.mjs` (`npm run test:engine`); smoke: paso «sin ?qa=1 no se salta a una escena» contra el build real |

## Decisiones

- **Debug por URL**: se deja detrás de `?qa=1` y no se quita, porque smoke, demos y walkthrough del CI (y el smoke contra
  producción por `workflow_dispatch`) lo necesitan. `?qa=1` ya era la puerta de la API de QA. Quien conozca `?qa=1` puede
  seguir saltando de escena: es una herramienta de QA, no una protección (el juego es cliente puro).
- Se dejan como están: `?trailer`/`?record` (tráiler, no da ventaja), `window.__game` (lo usan smoke y demos; no abre
  ninguna UI) y los `console.log` de `wallet-save.ts:88` y `contracts.ts:208` (uno por conexión de wallet, no ruidosos).

## Hallazgos (fuera de A1.8, sin tocar)

- `luxury_watch` (`upstairs` combo `antenna+hs_armchair`) se consigue y no sirve para nada: coleccionable con logro;
  decidir en el diseño de puzzles (A3).
- `vip_floppy` y el logro `holder_vip_floppy` son inalcanzables mientras `items.sceneItems` no lo cargue el motor.
- Las flags `debug_look_1..5` no son un modo debug: `basement.hs_armchair.TALK` lee 1-4 (huevo de pascua de la pegatina
  del mono); solo el nombre engaña, y `debug_look_5` se pone y nunca se lee.
- Siguen del linter A0.4: `playSound glass_break` sin mp3 (silenciado con motivo), 5 `walkmask` declaradas que no existen
  (aviso: ningún sistema las carga), 13 flags puestas y nunca leídas, 102 avisos de estado tras `say`.
- `dispatchTap` con un objeto elegido y GIVE sobre un hotspot responde «I can't use X with Y» (dice *use* aunque el verbo
  sea GIVE). No es silencio ni error; el texto es de A2.5.

## No verificado en local

Build, `tsc`, smoke, walkthrough y demos no se lanzaron en el iMac (semáforo de trabajo pesado ocupado): los verifica el
CI de la PR. En local: `node scripts/lint-scenes.mjs` (0 errores), `node --test tests/lint-scenes.test.mjs`,
`node --test tests/walkthrough-core.test.mjs` y `tests/debug-params.test.mjs` sobre una copia sin tipos (Node 20).

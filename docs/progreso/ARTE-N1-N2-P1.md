# Arte pendiente N1, N2 y P1: Penny de cuerpo entero, Chad en el flotador y Dex sentado

Fichas de «## Arte pendiente» del plan. Las tres van integradas en el juego. Gemini: **2 llamadas, 0,078 $** (tope de esta
tarea 1,50 $; registro en `gemini-gasto.tsv` del orquestador). Los fotogramas derivados (hablar, parpadear, respirar,
sentado hablando) salen por código del fotograma base, sin más llamadas.

## Fichas

- ~~**P1 · Dex sentado en el sillón**~~ (treatment_room, `patient_seated`). **Hecho por código, 0 $.** Es una pose nueva
  del rig 2D (`profile_sit` en `art/dex2d/build.py`): de perfil mirando al monitor, muslo sobre el asiento, pierna hacia
  el reposapiés, mano en el reposabrazos. `sit_talk` abre la boca y levanta la mano. Salida
  `assets/sprites/player/dex2d/sit_0.png` y `sit_talk_0.png`. El lienzo es de 48×103, con el zapato en la última fila,
  como el resto del rig (lo exige `tests/player-anim.test.mjs`). La figura ocupa 36×83, no 32×60 como estimaba la ficha:
  sentado a la escala de Dex no cabe en 60 de alto. 0 colores fuera de la paleta de Dex. Integración: `player.seated`
  en `scene.json` (`{ flag, x, y }`). GameScene pinta `dex2d_sit_0` a la escala del jugador cuando la flag está a true
  y, mientras habla Dex, alterna con `sit_talk_0` cada 140 ms. No se toca `hidePlayer`. Con el disfraz de mono no se
  pinta (no hay pose sentada del mono). La posición (44,32 %, 81,47 %) se ajustó sobre el fondo para que la cadera
  apoye en el cojín.
- ~~**N1 · Penny de cuerpo entero**~~ (lobby, `npc_receptionist`). **Gemini, 1 llamada** (`art/npc/originales/penny_a.png`)
  y posproceso. Mide 26×103, el mismo alto que Dex, con la misma escala y sin `depthScale` en el lobby. Lleva `_talk` (boca
  abierta: fila central de los labios oscura y labio de abajo 1 px más abajo) y `_blink` (el párpado tapa la fila de
  arriba de las gafas; con gafas de sol se nota poco). Sustituye a `assets/sprites/npcs/receptionist{,_talk}.png` y
  añade `receptionist_blink.png`, que se carga en `npcIds`. Los pies están detrás del mostrador (y 65,3 → 86,8 %): el
  `foreground.png` del lobby, que ya tenía un hueco entre los monitores, le tapa de las caderas abajo. `scale-refs.json`
  del lobby (baseY de la NPC) se ha actualizado.
- ~~**N2 · Chad**~~ (recovery_pool). **Gemini, 1 llamada** (`art/npc/originales/chad_a.png`) y posproceso a 48×44 con la
  paleta del mono (`Ape-Idle-1.png`) y la del mono pintado en el fondo. Fotogramas derivados: `chad_talk` (boca abierta
  dos filas) y, solo como candidatos, `chad_talk1` (medio abierta) y `chad_breathe` (pecho 1 px arriba), que están en
  `art/npc/candidatos/`. Hoy el motor solo usa la textura base y `_talk` (NpcLife respira y parpadea con 1 px de
  aplastado). `npc_chad` en `(65,87 %, 87,67 %)`, encima del mono pintado, al que tapa por completo
  (`/var/tmp/adv-gifs/arte-npc/chad-en-escena.png`, antes y después). **No tiene `dialogueTreeId` a propósito**: GameScene
  no detecta toques en una NPC sin árbol, así que todo sigue pasando por `hs_chad` (LOOK, el duelo de FUD de A3.6e…). La
  NPC solo da vida: respira, parpadea, se gira hacia Dex y mueve la boca cuando el `speaker` es «Chad». No es caminable
  (está en el agua), así que no se añade a los obstáculos de la rejilla.

## Cómo se regenera

```
python3 art/dex2d/build.py                  # P1 (y el resto del rig; los demás fotogramas salen idénticos)
python3 art/npc/post.py penny chad          # N1 → assets/sprites/npcs/receptionist*; N2 → art/npc/candidatos/chad*
cp art/npc/candidatos/chad.png art/npc/candidatos/chad_talk.png assets/sprites/npcs/
python3 -I art/npc/gemini_gen.py <salida> <prompt.txt> <refs…>   # solo si hay que pedir otro original (de pago)
```

`gemini_gen.py` lee la clave de `~/.secrets/gemini.key`, fuera del repo, y nunca la imprime. Antes de llamar apunta la
línea en el tsv de gasto y no llama si con ella se pasa del tope (`--tope`, 1,50 por defecto). Los prompts y las
referencias están en `art/npc/prompts.md`.

`post.py` hace esto: quita el magenta (el color de las esquinas y lo muy magenta) y se queda con el trozo opaco más
grande. Recorta y reduce por la **moda** de cada celda, no por la media, para que no salgan colores intermedios. Cuantiza
al color más cercano de la paleta de referencia y pone un contorno de 1 px por fuera con el color más oscuro de esa
paleta. El alfa queda en 0 o 255. En Penny, además, quita las manchas cálidas sueltas de las medias. Las vistas ×8 junto
a Dex quedan en `/var/tmp/adv-gifs/arte-npc/<id>-junto-a-dex.png`.

## Demo

`scripts/demo-arte-npc.mjs` (844×390) hace capturas de Penny en el lobby, Chad en la piscina y treatment_room sin
sentar y sentado. Comprueba las hojas (26×103 y 48×44) y que Dex sentado solo aparece con la flag puesta y sin que se
vea el jugador de pie. **No se ha ejecutado en local**: el carril de trabajo pesado del iMac estaba ocupado. La
comprueba el CI.

## Límites y qué queda

- Penny: la cabeza es algo más grande que la de Dex (≈ 1/4,5 del alto frente a 1/5) y el `_blink` apenas se ve con las
  gafas de sol. Su caja de toque es la hoja entera, así que tocar el frente del mostrador debajo de ella (y 62–87 %)
  también es hablar con Penny; antes allí no había hotspot. En el epílogo habla sin aparecer en pantalla, como antes.
- Chad: el flotador queda entero encima del agua (el pintado estaba medio hundido). La bocanada de respirar y la boca a
  medias no se usan hasta que el motor admita más fotogramas por NPC (A4.2a). Al girarse hacia Dex se espeja, y el
  sprite es casi simétrico.
- Dex sentado: es una imagen aparte del jugador. Si un script moviera a Dex en treatment_room, no se levantaría (hoy no
  pasa: la escena es `hidePlayer`). La pose es erguida aunque el respaldo está reclinado. Las correas (O1) siguen sin
  dibujarse.
- Sin verificar en local: `tsc`, build, los tests con TypeScript (`node --experimental-strip-types`, en el iMac hay
  Node 20), la demo y el barrido de proporción. Lo hace el CI de la PR.

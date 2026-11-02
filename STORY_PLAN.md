# ZEROadventure II — Story Plan & Release Roadmap

> Alineado con `docs/DESIGN_BIBLE.md` (A3.1, plan ADVENTURE_SCUMM). La biblia es la fuente de verdad de
> historia, personajes, puzles, humor y Web3; este documento resume capítulos, releases y la capa on-chain.
> Si discrepan, manda la biblia.

## Filosofia de Diseno

El publico Web3 tiene un attention span limitado. Cada sesion de juego debe dar **sensacion clara de
progreso** y cierre, con recompensas tangibles opcionales (logros on-chain, coleccionables). La historia y
los puzles van primero; lo on-chain es un bonus que nunca bloquea.

### Principios
1. **Cada capitulo es autoconclusivo** — su propio arco con inicio, climax y resolucion
2. **Ritmo** — algo que tocar en 30 s, primer objeto en 2 min, 3–4 hitos por capitulo (sonido, logro visual, tic en el diario)
3. **Duracion** — 20–40 minutos por capitulo (cap. 1: 15–20; cap. 5 + epilogo: 20)
4. **Puzles estilo Monkey Island** — 2–4 hilos en paralelo, combinaciones objeto+objeto, cadenas de intercambio, un duelo de FUD, pistas justas (escalera de pistas de Anon), sin callejones sin salida
5. **Cada capitulo desbloquea el siguiente con flags locales** (`chapter_N_complete`). El logro NFT del capitulo es un recuerdo opcional, **no** la llave del siguiente
6. **Collectibles opcionales** — objetos y logros ocultos que premian la exploracion
7. **Web3 nunca bloquea la ruta principal** — wallet, NFT y tokens dan extras y como maximo un atajo de un paso por capitulo (ver biblia §7)

---

## Arco Narrativo General

**Premisa**: Adrian, creador del ecosistema ZERO, lleva tres semanas desaparecido. Dex Malone, «detective
on-chain» con cero casos resueltos, recibe en su wallet un mensaje programado desde la wallet de Adrian:
"Find Patient Zero. Bring them home. Everything in the lab is yours if you do." En los foros, «Patient Zero»
es un saboteador que opera a las 3 AM con dinero del ecosistema. La intro **no** dice quien es Patient Zero.

**Twist central**: Patient Zero es Dex (y, con wallet conectada, el propio jugador). Fue el primer paciente de
la clinica del Dr. Satoshi; la terapia «Cold Storage» paso sus recuerdos de degen a un disquete de respaldo y
el se escapo a mitad de tratamiento sin memoria. El «saboteador» es PZ-BOT, su viejo bot de trading, que
sigue corriendo en el laboratorio. Adrian no desaparecio: monto el rastro de puzles para que Dex se
encontrara a si mismo, y es la voz anonima («Anon») que le llama por telefono. Adrian **no** es Patient Zero.

**Tono**: comedia de aventura + satira cripto de dentro + nostalgia pixel art + misterio. Monkey Island meets
Black Mirror meets DeFi. Los chistes cripto son el sintoma del protagonista, no una formula (biblia §5).

**Reparto**: Dex (protagonista), Penny (recepcionista), Dr. Satoshi, B.O.T., Gerald (pato de goma, gag
recurrente) y, nuevos, DOORIS (cerradura inteligente), Anon/Adrian (telefono), PZ-BOT (terminal, con la voz de
Dex), Nurse Gwei (interfono), Chad (rival del duelo de FUD) y el coro de monos de la piscina (biblia §3).

---

## Estructura de Releases

### RELEASE 1 — "The Lab" (Capitulos 1-2)
*Primera release. Debe enganchar inmediatamente.*

### RELEASE 2 — "The Underground" (Capitulos 3-4)
*Profundiza el misterio. PZ-BOT, la clinica, el duelo de FUD.*

### RELEASE 3 — "The Revelation" (Capitulo 5 + Epilogo)
*Gran final. El monitor con tu propia wallet.*

---

## CAPITULO 1: "Breaking & Entering"
**Escenas**: outside (termina al cruzar la puerta al lobby; no hay escena `frontdoor`)
**Duracion**: ~15-20 minutos · **Release**: 1

### Sinopsis
Atardecer en casa de Adrian. DOORIS, la cerradura inteligente, exige autenticacion de tres factores: PIN
(partido en dos mitades: tras la lampara del porche y en un nido de urraca que se alcanza con un tablon de la
valla), pregunta de seguridad (el mejor amigo de Adrian: Gerald, un pato de goma, segun una factura del
veterinario en el buzon) y llave de hardware (el Ledger de Adrian, bajo un felpudo «HODL» pegado al suelo).
Anon llama por primera vez. Puzles detallados: biblia §4, capitulo 1.

### Items
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| note_half_a / note_half_b → code_note | Lampara del porche / nido de urraca (combo) | Si | No |
| fence_plank | Valla | Si | No |
| vet_bill | Buzon | Si | No |
| ledger | Bajo el felpudo (con el tablon) | Si (cap. 1 y 3) | No |
| mystery_envelope | Buzon (mismo OPEN que la factura) | Si (cap. 2) | Si — Collectible #1 |

### Gating
- **Entrada**: ninguno (capitulo gratuito)
- **Bonus**: holders de AdrianZERO ven el graffiti «ZERO WAS HERE» tras los arbustos

---

## CAPITULO 2: "The Receptionist"
**Escenas**: lobby, upstairs, rooftop · **Duracion**: ~30-35 minutos · **Release**: 1

### Sinopsis
Penny, la recepcionista (sola y sin cobrar desde hace tres semanas, cotilla incurable), vigila el abrigo de
Adrian. Dejar el sobre CONFIDENCIAL en su escritorio la distrae y da la keycard y un boli de Mt. Gox que aun
gotea. La escotilla de servicio de la azotea, que baja al sotano donde parpadea una luz, tiene tres cierres:
lector (keycard), pestillo (la veleta Bitcoin, oxidada: se engrasa con pizza fosilizada) y cerradura
(terminal_key, en un cajon con cerradura de «Terms & Conditions» que hay que leer de verdad). Opcional: revivir
a Fernando, la planta del lobby, con agua de lluvia de la antena parabolica (Penny prohibe la cafeina) y
activar Founder Mode con el Golden Token.

### Items
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| keycard + leaky_pen | Abrigo de Adrian (con Penny distraida) | Si | No |
| pizza_slice | Caja de pizza (upstairs) | Si | No |
| terminal_key | Cajon de Terms & Conditions (upstairs) | Si (cap. 2 y 5) | No |
| antenna | Antena suelta (rooftop) | No (alternativa en el cap. 3) | No |
| ape_costume | Alpha Pack (upstairs) | No (alternativa en el cap. 4) | No |
| receipt | Bandeja de papel (upstairs) | No (alternativa en el cap. 3) | No |
| energy_drink → empty_can → rainwater_can | Upstairs / mining rig / parabolica | No | No |
| golden_token | Fernando regado | No | Si — Collectible #2 |
| luxury_watch | Sillon (con la antena) | No | Logro DIAMOND HANDS |
| monkey_sticker | Easter egg (4 flags ocultas + sillon del sotano) | No | Si — Collectible #3 (raro) |

### Elementos On-Chain
| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 2 Complete"** | ERC1155 mint opcional | AdrianLAB | Bajar por la escotilla |
| **Golden ZERO Token** (Collectible #2) | ERC1155 mint opcional | AdrianLAB | Fernando regado |
| **Three-Headed Monkey Sticker** (Collectible #3) | ERC1155 mint opcional | AdrianLAB | Easter egg |
| **Founder Mode Dashboard** | Read-only | Diamond | Golden Token en el mining rig (stats de ejemplo sin wallet) |

### Gating
- **Entrada**: `chapter_1_complete` (flag local)
- **VIP** (AdrianZERO): Penny revela la trampilla del felpudo; pide keycard y terminal_key y ahorra solo la veleta
- **Mining rig**: 1000+ $ZERO ven el panel TraitLab

---

## CAPITULO 3: "Below the Surface"
**Escenas**: basement, server_room · **Duracion**: ~30-35 minutos · **Release**: 2

### Sinopsis
En el sotano, un CRT sin corriente y el disquete «BACKUP — DO NOT LOSE». Tras el rack, la sala de servidores y
PZ-BOT: el «saboteador», un bot que solo obedece a su dueño, habla con la voz de Dex y tiene bloqueado el
interruptor de emergencia. El CRT se enciende con un alargador del suelo tecnico (donde tambien hay unas gafas
3D al reves); el Ledger pide como PIN el cumpleaños de Gerald (0301, el genesis block); el disquete imprime el
listado de pacientes («PATIENT ZERO — STATUS: ESCAPED») y un mapa sin marca. Una alfa falsa escrita con el
boli («BUY $GERALD») cuelga a PZ-BOT, que suelta su log (dueño `0xDE…`) y libera el interruptor. Roto el
cristal (antena o el raton roto como mayal), el interruptor muestra las coordenadas y Dex marca el mapa.

### Items
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| extension_cord + glasses_3d | Suelo tecnico (server_room) | Si (gafas: cap. 4) | No |
| floppy_disk + scrap_paper | Mesa del sotano | Si (disquete: cap. 3 y 5) | No |
| printout → marked_map | CRT / combo con el boli | Si | No |
| fake_alpha | Combo papel + boli | Si | No |
| server_log | PZ-BOT colgado | Si (lore) | Si — Collectible #4 |
| broken_mouse | Mesa del sotano | Alternativa a la antena | No |
| burned_chip | Rack quemado de AdrianAuctions | No | Si — Collectible #5 |

### Elementos On-Chain
| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 3 Complete"** | ERC1155 mint opcional | AdrianLAB | Mapa marcado |
| **Server Log Extract** (Collectible #4) | ERC1155 mint opcional | AdrianLAB | PZ-BOT colgado |
| **Burned AdrianAuctions Chip** (Collectible #5) | ERC1155 mint opcional | AdrianLAB | Rack quemado |
| **FloorEngine Stats / $ZERO Burn Counter** | Read-only | Diamond | Pantallas de la sala de servidores (bonus) |

### Gating
- **Entrada**: `chapter_2_complete` (o el atajo VIP)
- **Salida a la montaña**: `marked_map` o `chapter_3_complete`
- **Bonus**: holders de $ZERO (1000+) ven stats adicionales; holders de floppies, el mensaje de Sector Zero

---

## CAPITULO 4: "The Mountain Path"
**Escenas**: mountain, clinic_exterior, clinic_interior, recovery_pool, memelab · **Duracion**: ~35-40 minutos · **Release**: 2

### Sinopsis
La clinica solo admite pacientes. Nurse Gwei, por el interfono, rechaza la keycard de Adrian («revoked since
the incident») y pide pruebas de sintomas en el buzon de visitas (una lata vacia: insomnio; la nota de la
papelera: perdida) y un cuestionario donde gana quien lo niega todo. Dentro, el Dr. Satoshi solo autoriza el
treatment room a quien se gradue en la terapia de grupo de la piscina de liquidez (`recovery_pool`, tras el
archivador). Los monos ignoran a los normies: disfraz de mono o un pato de goma junto a Gerald. Las replicas
del **duelo de FUD** se aprenden de los monos y de B.O.T.; la ultima se gana con el Rare Pepe del MemeLAB
(gafas 3D: dos pares al reves se anulan), firmado «Specimen #001 — by P.Z.». Chad, vencido, entrega una ficha
de sobriedad; Satoshi autoriza. Pistas del giro: la letra de la hoja de visitas, la foto de inauguracion con
una cara rayada y gafas 3D, el «The usual?» de B.O.T.

### Items
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| clinic_note + lata vacia | Papelera de la clinica | Si | No |
| patient_wristband | Admision de Nurse Gwei | Si | No |
| rubber_duck | Basura de la piscina | Alternativa al disfraz | No |
| pepememe | MemeLAB | Si | Logro MEME ACHIEVEMENT (B.O.T.) |
| sobriety_chip | Chad vencido | Si | No |
| sign_in_sheet, clinic_sign_in_sheet | Buzon de visitas / recepcion | No (lore) | No |
| dr_satoshi_badge | Easter egg en la bata | No | Si — Collectible #6 |
| clinic_photo | Pared de recepcion | No | Si — Collectible #7 |

### Elementos On-Chain
| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 4 Complete"** | ERC1155 mint opcional | AdrianLAB | Autorizacion de Satoshi |
| **Dr. Satoshi Badge** (Collectible #6) | ERC1155 mint opcional | AdrianLAB | Easter egg |
| **Clinic Photograph** (Collectible #7) | ERC1155 mint opcional | AdrianLAB | Foto de la pared |
| **Meme Achievement** | ERC1155 mint opcional (id 20022) | AdrianLAB | Pepe + B.O.T. |

### Gating
- **Entrada**: `chapter_3_complete` (flag local)
- **VIP con Dr. Satoshi** (AdrianZERO): «Chad te respeta» — el duelo empieza en la ultima ronda. Ya no autoriza el treatment room directamente
- **Aviso de wallet** (no bloqueante): Satoshi y Anon avisan antes del cap. 5 de que el monitor lee la wallet que lleves

---

## CAPITULO 5: "Patient Zero"
**Escenas**: treatment_room, epilogue_outside · **Duracion**: ~20 minutos (con epilogo) · **Release**: 3

### Sinopsis
El monitor pide el respaldo (el disquete) y al paciente sentado. Al restaurar, muestra el expediente: el
historial real de la wallet conectada o, sin wallet, el expediente ficticio de Dex (`02:14 BUY $GERALD`).
«Patient Zero... is ME?» PZ-BOT, desde el monitor, intenta que Dex vuelva a operar: duelo final con su propia
voz (las tres replicas que Chad no uso + «I'm not you anymore»). Dex apaga el bot. Suena un telefono tras el
cristal de observacion: Anon es Adrian. Nota de Adrian («You were never a saboteur. You were a patient who
walked out too early.»). Epilogo al amanecer: Dex firma el «NOW HIRING» con el boli de Mt. Gox. Creditos.

### Items
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| floppy_disk (del cap. 3) | Monitor | Si | No |
| adrian_note | Mesa del treatment room | Si (narrativo) | Si — Collectible #8 |
| patient_zero_badge | Auto al completar la revelacion | Auto | Logro especial |

### Elementos On-Chain
| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"PATIENT ZERO" Achievement** | ERC1155 mint opcional (LEGENDARY) | AdrianLAB | Revelacion |
| **Adrian's Note** (Collectible #8) | ERC1155 mint opcional | AdrianLAB | Leer la nota |
| **"Game Complete" Achievement** | ERC1155 mint opcional (LEGENDARY) | AdrianLAB | Firmar el NOW HIRING |
| **Transaction History Display** | Read-only | Alchemy / Blockscout | Monitor (solo con wallet) |
| **Founder's Plaque** | `web3Visuals` | Diamond | Placa con tu wallet si tienes $ZERO |

### Gating
- **Entrada**: `chapter_4_complete` (flag local). **La wallet NO es obligatoria**: sin ella el giro funciona con el expediente de Dex
- **Posdata de la nota de Adrian** segun tu perfil on-chain (bonus):
  - Holder AdrianZERO: "You're OG. You believed before anyone else."
  - Holder $ZERO: "You voted with your wallet. Literally."
  - Holder de ambos: "Full degen. Full builder. Welcome home."
  - Sin holdings: "You don't need tokens to be part of this. You just need curiosity."

---

## Resumen de Collectibles & Achievements On-Chain

Todos opcionales: se muestran siempre como logro visual y, con wallet, se ofrecen como mint en segundo plano.

### Achievements de capitulo
| # | Nombre | Capitulo | Tipo |
|---|--------|----------|------|
| A1 | Chapter 1 Complete | 1 | Common |
| A2 | Chapter 2 Complete | 2 | Common |
| A3 | Chapter 3 Complete | 3 | Common |
| A4 | Chapter 4 Complete | 4 | Common |
| A5 | PATIENT ZERO | 5 | Legendary |
| A6 | Game Complete | 5 | Legendary |

### Collectibles (para completionists)
| # | Nombre | Capitulo | Como |
|---|--------|----------|------|
| C1 | Mystery Envelope | 1 | Buzon (parte de la ruta) |
| C2 | Golden ZERO Token | 2 | Cadena opcional de Fernando |
| C3 | Three-Headed Monkey Sticker | 2–4 | 4 flags ocultas (dificil) |
| C4 | Server Log Extract | 3 | PZ-BOT colgado (parte de la ruta) |
| C5 | Burned AdrianAuctions Chip | 3 | Rack quemado |
| C6 | Dr. Satoshi Badge | 4 | Easter egg en la bata |
| C7 | Clinic Photograph | 4 | Foto de inauguracion |
| C8 | Adrian's Note | 5 | Parte de la historia |

Logros de holder ya definidos en `src/config/achievements.config.ts` (VIP Floppy, VIP Access, Archivist, Alpha
Leak, Genesis Miner, Sector Zero, Medical Records, Preserved) se mantienen como bonus.

### $ZERO Token Rewards (propuesta, no implementada)
| Trigger | Cantidad | Veces |
|---------|----------|-------|
| Completar Cap 3 | 50 $ZERO | 1x por wallet |
| Completar Cap 4 | 50 $ZERO | 1x por wallet |
| Completar Cap 5 (Game Complete) | 200 $ZERO | 1x por wallet |
| Completionist (8/8 collectibles) | 500 $ZERO bonus | 1x por wallet |
| **Total maximo** | **800 $ZERO** | |

Los claims nunca condicionan la ruta. Quedan fuera del plan ADVENTURE_SCUMM (necesitan contrato y backend).

---

## Implementacion Tecnica On-Chain

### Opcion A: AdventureFacet (nuevo facet del Diamond)
```
Funciones:
- claimChapterReward(chapterId) — mintea achievement ERC1155 + $ZERO reward
- claimCollectible(collectibleId, proof) — mintea collectible con server-signed proof
- getPlayerProgress(address) — returns bitmask de achievements
- getCollectibles(address) — returns bitmask de collectibles
```

**Proof system**: firma del servidor que prueba que el jugador completo el puzzle. Evita exploits de mint
directo.

### Opcion B: Off-chain signature + AdrianLAB mint
Usar `AdrianLabAdmin.mintBatch()` con firmas EIP-712 generadas por un backend. Mas simple, usa contratos
existentes.

### Recomendacion
**Opcion B para Release 1** (rapido, usa infraestructura existente). **Opcion A para Release 2+**. En ambos
casos el progreso del juego vive en la partida (flags), no en la cadena.

---

## Escenas por Release

Las 13 escenas existen (fondos en `assets/scenes/<id>/`). No hay escenas nuevas obligatorias.

| Release | Escenas | Cambios principales (biblia §4) |
|---|---|---|
| R1 | outside, lobby, upstairs, rooftop | DOORIS y PIN partido; Penny y el abrigo; escotilla de tres cierres |
| R2 | basement, server_room, mountain, clinic_exterior, clinic_interior, recovery_pool, memelab | CRT con alargador, PZ-BOT, mapa marcado; Nurse Gwei; duelo de FUD con Chad; MemeLAB en la ruta |
| R3 | treatment_room, epilogue_outside | Monitor con respaldo y sillon; duelo final con PZ-BOT; Adrian; NOW HIRING |

Opcionales con fondos existentes: `lobby_epilogue` (post-creditos), `outside_night` y `mountain_dawn` (necesitan
tinte por escena en el motor). Ver biblia §6.

---

## Timeline

La implementacion va por los checkpoints A3.2–A3.9 del plan ADVENTURE_SCUMM (lista de subtareas en
«Checkpoints derivados» de la biblia).

| Release | Contenido |
|---------|-----------|
| **R1: "The Lab"** | Cap 1-2, apertura, voces nuevas, wallet connect opcional |
| **R2: "The Underground"** | Cap 3-4, PZ-BOT, clinica, duelo de FUD |
| **R3: "The Revelation"** | Cap 5 + epilogo, monitor con historial real, creditos |

---

## Notas de Diseno

### Para mantener engagement Web3
- **Cada capitulo cerrado = un badge** (visual siempre; on-chain si quieres)
- **Progress board**: pagina web que muestra tu % de completion (lee on-chain)
- **Leaderboard**: primeros 100 en completar cada capitulo obtienen un trait exclusivo
- **Social proof**: "X wallets have completed Chapter N" en la pantalla de inicio

### Easter eggs cross-ecosistema
- Holders de AdrianPunks ven el poster «BE REAL. BE ADRIAN.» en el lobby
- Holders de Floppy Discs desbloquean secretos en los CRT (lobby, upstairs, basement, clinica, treatment room)
- Stakers de $ZERO ven sus stats en el Founder Mode dashboard
- Compradores via FloorEngine ven sweep history en el server room

### Rejugabilidad
- Ramas VIP (gate por NFT) con dialogo exclusivo y un atajo de un paso
- Collectibles ocultos
- Posdata distinta de Adrian segun tu perfil on-chain
- Dos soluciones en algunos puzles (disfraz o pato; antena o raton)
- Speedrun mode: timer on-chain, leaderboard para completar todo el juego

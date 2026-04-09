# ZEROadventure II — Story Plan & Release Roadmap

## Filosofia de Diseno

El publico Web3 tiene un attention span limitado. Cada sesion de juego debe dar **recompensas tangibles** (on-chain collectibles, achievements, tokens) y una **sensacion clara de progreso** y cierre. No basta con "buena historia" — necesitan dopamina frecuente.

### Principios
1. **Cada capitulo es autoconclusivo** — tiene su propio arco narrativo con inicio, climax y resolucion
2. **Recompensa al completar** — cada capitulo mintea un Achievement NFT (ERC1155) al terminar
3. **Collectibles opcionales** — items ocultos que rewarden la exploracion
4. **Progresion visible** — achievement wall on-chain que muestra tu progreso
5. **Capitulos cortos** — 15-20 minutos maximo por capitulo
6. **Cada capitulo desbloquea el siguiente** — el Achievement NFT del Cap N es el gate del Cap N+1

---

## Arco Narrativo General

**Premisa**: Adrian, creador del ecosistema ZERO, ha desaparecido. Su laboratorio esta abandonado. Los rumores dicen que un "Paciente Cero" escapo de una clinica de rehabilitacion crypto y esta saboteando el ecosistema desde dentro. Tu mision: encontrar a Patient Zero y salvar el ecosistema.

**Twist central**: Patient Zero eres TU. Tu wallet, tu historial de transacciones, tu adiccion al blockchain — todo apunta a ti. Pero eso no se revela hasta el final.

**Tono**: humor negro + satira crypto + nostalgia pixel art + mystery. Monkey Island meets Black Mirror meets DeFi.

---

## Estructura de Releases

### RELEASE 1 — "The Lab" (Capitulos 1-2)
*Primera release. Debe enganchar inmediatamente.*

### RELEASE 2 — "The Underground" (Capitulos 3-4)
*Deepens the mystery. Introduces on-chain economy.*

### RELEASE 3 — "The Revelation" (Capitulo 5 + Epilogo)
*Grand finale. Maximum on-chain rewards.*

---

## CAPITULO 1: "Breaking & Entering"
**Escenas**: outside, frontdoor
**Duracion**: ~12-15 minutos
**Release**: 1

### Sinopsis
Llegas a la casa de Adrian despues de recibir un mensaje anonimo: "El ecosistema esta en peligro. Ve al laboratorio. La puerta no esta tan cerrada como parece." Debes entrar al laboratorio encontrando pistas para el codigo de acceso.

### Beats narrativos
1. **Apertura**: Exterior de la casa. Ambiente nocturno, pixelado, misterioso. Un cartel dice "AdrianLAB — Authorized Personnel Only"
2. **Exploracion**: Examinar el buzon (facturas de electricidad astronomicas), el coche abandonado (motor aun caliente), la lampara del porche (pista del codigo)
3. **Puzzle central**: Encontrar el codigo 7-3-1-4 combinando pistas del exterior
4. **Mini-twist**: Debajo del felpudo encuentras el Ledger de Adrian — "Quien deja su hardware wallet bajo el felpudo?"
5. **Cierre**: La puerta se abre. Interior oscuro. Fin del capitulo.

### Items descubribles
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| code_note | Detras de lampara | Si | No |
| ledger | Bajo felpudo | Si | No |
| mystery_envelope | Buzon (oculto, requiere LOOK x2) | No | Si — Collectible #1 |

### Elementos On-Chain

| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 1 Complete" Achievement** | ERC1155 mint | AdrianLAB | Auto al entrar a frontdoor con exito |
| **Mystery Envelope** (Collectible #1) | ERC1155 mint | AdrianLAB | Opcional: examinar buzon 2 veces |
| **Wallet Connect prompt** | UI | — | Al iniciar el juego, opcional |

### Gating
- **Entrada**: Ninguno (capitulo gratuito, accesible para todos)
- **Bonus dialogue**: Holders de AdrianZERO ven graffiti extra en la pared: "ZERO WAS HERE"

---

## CAPITULO 2: "The Receptionist"
**Escenas**: lobby, upstairs, rooftop
**Duracion**: ~15-20 minutos
**Release**: 1

### Sinopsis
Dentro del laboratorio, la recepcionista (unica persona presente) te recibe con sospecha. Debes ganarte su confianza para obtener acceso a las zonas restringidas. Arriba, descubres la sala de trading de Adrian y su obsesion con los mercados.

### Beats narrativos
1. **Lobby**: Recepcionista pregunta quien eres. Tres rutas de dialogo:
   - **Tour**: Te muestra el lobby, menciona que Adrian no ha venido en dias
   - **Directa**: "Busco a Patient Zero" — ella se pone nerviosa, cambia de tema
   - **VIP** (gate AdrianZERO): "Ah, un holder. Adrian dejo instrucciones para ustedes..."
2. **Puzzle del abrigo**: Encontrar la keycard en el bolsillo del abrigo de Adrian
3. **Upstairs**: Trading floor. Tres monitores mostrando charts, mining rig activo, cajas etiquetadas ironicamente ("Moon Mission", "Diamond Hands", "Lambo Dreams")
4. **Combo puzzle**: Regar la planta moribunda (water_bottle + planta) = brota un golden_token. Usarlo en el mining rig = activar Founder Mode (admin dashboard que muestra stats reales del ecosistema ZERO)
5. **Rooftop**: Antena satelital corriendo un nodo de Base. Momento contemplativo. "847 dias de uptime. Adrian nunca apago esto."
6. **Cierre**: Desde el rooftop ves una luz parpadeando en el sotano. Algo sigue encendido ahi abajo.

### Items descubribles
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| keycard | Bolsillo del abrigo (lobby) | Si | No |
| water_bottle | Dispensador (lobby) | No* | No |
| golden_token | Combo: water + plant | No* | Si — Collectible #2 |
| terminal_key | Cajon del escritorio (upstairs) | Si | No |
| antenna | Equipo suelto (rooftop) | No | No |
| monkey_sticker | Easter egg (4 flags ocultos) | No | Si — Collectible #3 (raro) |

*No requerido para completar el capitulo, pero si para bonus content

### Elementos On-Chain

| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 2 Complete" Achievement** | ERC1155 mint | AdrianLAB | Ver la luz del sotano desde rooftop |
| **Golden ZERO Token** (Collectible #2) | ERC1155 mint | AdrianLAB | Combo water_bottle + plant + mining_rig |
| **Three-Headed Monkey Sticker** (Collectible #3) | ERC1155 mint | AdrianLAB | Easter egg: encontrar 4 debug flags |
| **Founder Mode Dashboard** | Read-only | Diamond | Muestra stats reales de $ZERO on-chain |

### Gating
- **Entrada**: Achievement "Chapter 1 Complete"
- **VIP dialogue**: Holders AdrianZERO (ruta de dialogo exclusiva con recepcionista)
- **Founder Mode**: Requiere golden_token (in-game) — muestra datos reales del Diamond

---

## CAPITULO 3: "Below the Surface"
**Escenas**: basement, server_room
**Duracion**: ~15-20 minutos
**Release**: 2

### Sinopsis
Desciendes al sotano y descubres el archivo de Adrian: un viejo CRT con registros encriptados, y detras de un rack de servidores, la sala secreta donde corre toda la infraestructura del ecosistema ZERO. Aqui encuentras la primera mencion directa de "Patient Zero" y su escape.

### Beats narrativos
1. **Descenso**: Bajas por la trampilla. Humedad. Olor a circuitos viejos. Un CRT parpadea con cursor verde.
2. **Puzzle del CRT**: Insertar el Ledger de Adrian → se desbloquea el sistema. Base de datos de pacientes de una clinica de "rehabilitacion crypto"
3. **Floppy disk**: Encontrar el backup escondido. Insertarlo → impresora escupe un roster:
   - "Chronic Airdrop Dependency"
   - "Acute Rug Pull Trauma"
   - "Terminal FOMO"
   - **"PATIENT ZERO — STATUS: ESCAPED"** (en rojo)
4. **Server Room**: Mover el rack de equipos revela una puerta oculta. Dentro: servidores activos — FloorEngine, TraitLab, SweepBot corriendo 24/7. Uno quemado: "AdrianAuctions — OFFLINE (bidding war casualty)"
5. **Emergency switch**: Detras de un vidrio de emergencia. Al activarlo, una pantalla oculta muestra coordenadas: "47.6062N, 122.3321W" y un mensaje: "La clinica existe. El paciente volvera."
6. **Cierre**: El printout incluye un mapa con la ubicacion de la clinica. Esta en la montana, a poca distancia.

### Items descubribles
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| floppy_disk | Debajo de papeles (basement) | Si | No |
| printout | Impresora (tras insertar floppy) | Si | No |
| server_log | Terminal en server_room | No | Si — Collectible #4 |
| burned_chip | Server quemado de AdrianAuctions | No | Si — Collectible #5 |

### Elementos On-Chain

| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 3 Complete" Achievement** | ERC1155 mint | AdrianLAB | Obtener el printout con el mapa |
| **Server Log Extract** (Collectible #4) | ERC1155 mint | AdrianLAB | Examinar terminal del server room |
| **Burned AdrianAuctions Chip** (Collectible #5) | ERC1155 mint | AdrianLAB | Examinar servidor quemado |
| **FloorEngine Stats** | Read-only | Diamond | Server room muestra sweep stats reales |
| **$ZERO Burn Counter** | Read-only | Diamond | Pantalla en server room con total burned |

### Gating
- **Entrada**: Achievement "Chapter 2 Complete"
- **Server room detail**: Holders de $ZERO (1000+) ven stats adicionales del Diamond
- **Emergency switch**: Requiere antenna del rooftop (Cap 2) como palanca improvisada

### Nuevo para Release 2: $ZERO Rewards
- Completar Cap 3 otorga **50 $ZERO** (claim via Diamond, una vez por wallet)
- Tener los 3 achievements (Cap 1-3) otorga bonus de **100 $ZERO** extra

---

## CAPITULO 4: "The Mountain Path"
**Escenas**: mountain, clinic_exterior (nueva), clinic_interior
**Duracion**: ~15-20 minutos
**Release**: 2

### Sinopsis
Sigues el mapa hacia la montana. El camino esta lleno de senales de advertencia y restos de otros "pacientes" que intentaron llegar a la clinica. Dentro, Dr. Satoshi dirige una operacion de rehabilitacion crypto con metodos... cuestionables.

### Beats narrativos
1. **Montana**: Sendero empinado. Carteles de advertencia: "TURN BACK — PORTFOLIO AHEAD", "LAST CHANCE TO TAKE PROFIT". Naturaleza pixelada hermosa pero ominosa.
2. **Clinic exterior** (escena nueva): Edificio brutalista. Cartel: "Patient Zero Rehabilitation Clinic — Est. Block 0". Puerta principal con scanner biometrico.
3. **Puzzle de entrada**: El scanner pide "Proof of Stake" — debes usar la keycard + el sign_in_sheet que encuentras en un buzzon exterior
4. **Clinic interior**: Dr. Satoshi te recibe. Dialogo extenso:
   - Historia de Patient Zero: "adicto a mintear. Cada bloque, otra transaccion."
   - "Cold wallet detox fallo. Hardware wallet rehab fallo."
   - "Escapo con un exploit en nuestro propio smart contract de admision. Ironico."
   - Posters en la pared: "ONE DAY AT A BLOCK", "SERENITY PRAYER" version crypto
5. **Puzzle del archivo**: Dr. Satoshi no te deja entrar al treatment room directamente. Debes encontrar el expediente de Patient Zero en el archivo — pero esta codificado en Base64
6. **Cierre**: Descifras el expediente. La foto del paciente esta corrupta — solo se ve un fragmento de una wallet address. Los primeros 4 caracteres coinciden con... tu wallet?

### Items descubribles
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| sign_in_sheet | Buzon exterior de clinica | Si | No |
| patient_file | Archivo de la clinica | Si | No |
| dr_satoshi_badge | Easter egg: examinar bata 3 veces | No | Si — Collectible #6 |
| clinic_photo | Pared del pasillo | No | Si — Collectible #7 |

### Elementos On-Chain

| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"Chapter 4 Complete" Achievement** | ERC1155 mint | AdrianLAB | Descifrar el expediente de Patient Zero |
| **Dr. Satoshi Badge** (Collectible #6) | ERC1155 mint | AdrianLAB | Easter egg en la bata |
| **Clinic Photograph** (Collectible #7) | ERC1155 mint | AdrianLAB | Examinar foto en el pasillo |
| **Wallet Fragment Display** | Read-only | Wallet | Muestra los primeros chars de TU address |
| **$ZERO Reward: 50 tokens** | Claim | Diamond | Al completar capitulo |

### Gating
- **Entrada**: Achievement "Chapter 3 Complete"
- **VIP dialogue con Dr. Satoshi**: Holders AdrianZERO desbloquean rama "What really happened"
- **Treatment room tease**: Dr. Satoshi dice "Not without proper authorization" — setup para Cap 5

---

## CAPITULO 5: "Patient Zero"
**Escenas**: treatment_room, epilogue_outside (nueva)
**Duracion**: ~10-15 minutos
**Release**: 3

### Sinopsis
El capitulo final. Entras al treatment room. Un sillon frente a un monitor. El monitor se enciende y muestra... tu historial de transacciones. Cada chart en la pared es tu portfolio. Patient Zero siempre fuiste tu.

### Beats narrativos
1. **Entrada al treatment room**: Puerta pesada. Interior minimalista. Un sillon. Un monitor apagado. Silencio.
2. **El monitor se enciende**: Secuencia cinematica. Letras verdes tipo Matrix. Luego: tu wallet address. Tu historial de transacciones REAL (leido de la blockchain via Alchemy).
3. **Las paredes**: Charts y graficos — tu portfolio historico con anotaciones manuscritas:
   - "First mint — the beginning of the end"
   - "Panic sold here — classic"
   - "Aped in without reading the contract — typical"
4. **Revelacion progresiva** (secuencia de dialogos):
   - "Those are MY transactions."
   - "The charts on the wall... that's MY portfolio."
   - "Patient Zero... is ME?"
   - "Congratulations. You found yourself. The first step to recovery is admitting you have a problem."
   - "The second step? ...There is no second step in crypto."
5. **Post-revelation**: Examinar la mesa junto al sillon. Una nota de Adrian:
   - "Si estas leyendo esto, el juego funciono. No eres un paciente. Eres un builder. Los pacientes nunca llegan hasta aqui — se quedan en el lobby refreshing charts. Tu exploraste. Tu resolviste puzzles. Tu llegaste al final. Eso te hace diferente. Bienvenido al equipo."
6. **Epilogo**: Sales de la clinica. Amanecer. El mundo pixelado se ve diferente ahora. Un nuevo cartel en la puerta: "PATIENT ZERO REHABILITATION CLINIC — NOW HIRING". Fundido a negro.

### Items descubribles
| Item | Donde | Requerido | On-chain |
|------|-------|-----------|----------|
| adrian_note | Mesa del treatment room | Si (narrativo) | Si — Collectible #8 |
| patient_zero_badge | Auto al completar revelacion | Auto | Si — Achievement especial |

### Elementos On-Chain

| Elemento | Tipo | Contrato | Trigger |
|----------|------|----------|---------|
| **"PATIENT ZERO" Achievement** | ERC1155 mint (LEGENDARY) | AdrianLAB | Completar la revelacion |
| **Adrian's Note** (Collectible #8) | ERC1155 mint | AdrianLAB | Leer la nota en la mesa |
| **"Game Complete" Achievement** | ERC1155 mint (LEGENDARY) | AdrianLAB | Salir de la clinica |
| **Transaction History Display** | Read-only | Alchemy API | Muestra TUS txs reales |
| **Portfolio Chart** | Read-only | Alchemy API | Muestra tu balance historico |
| **$ZERO Reward: 200 tokens** | Claim | Diamond | Al completar el juego |
| **Completionist Bonus: 500 $ZERO** | Claim | Diamond | Tener TODOS los 8 collectibles |

### Gating
- **Entrada**: Achievement "Chapter 4 Complete"
- **Treatment room**: Requiere wallet conectada (obligatorio para la revelacion)
- **Adrian's note content**: Cambia segun tu perfil on-chain:
  - Holder AdrianZERO: "You're OG. You believed before anyone else."
  - Holder $ZERO: "You voted with your wallet. Literally."
  - Holder de ambos: "Full degen. Full builder. Welcome home."
  - Sin holdings: "You don't need tokens to be part of this. You just need curiosity."

---

## Resumen de Collectibles & Achievements On-Chain

### Achievements (requeridos para progresion)
| # | Nombre | Capitulo | Tipo |
|---|--------|----------|------|
| A1 | Chapter 1 Complete | 1 | Common |
| A2 | Chapter 2 Complete | 2 | Common |
| A3 | Chapter 3 Complete | 3 | Common |
| A4 | Chapter 4 Complete | 4 | Common |
| A5 | PATIENT ZERO | 5 | Legendary |
| A6 | Game Complete | 5 | Legendary |

### Collectibles (opcionales, para completionists)
| # | Nombre | Capitulo | Dificultad |
|---|--------|----------|------------|
| C1 | Mystery Envelope | 1 | Facil (examinar x2) |
| C2 | Golden ZERO Token | 2 | Media (combo puzzle) |
| C3 | Three-Headed Monkey Sticker | 2 | Dificil (4 flags ocultos) |
| C4 | Server Log Extract | 3 | Facil (examinar terminal) |
| C5 | Burned AdrianAuctions Chip | 3 | Facil (examinar servidor) |
| C6 | Dr. Satoshi Badge | 4 | Media (examinar x3) |
| C7 | Clinic Photograph | 4 | Facil (examinar foto) |
| C8 | Adrian's Note | 5 | Auto (parte de la historia) |

### $ZERO Token Rewards
| Trigger | Cantidad | Veces |
|---------|----------|-------|
| Completar Cap 3 | 50 $ZERO | 1x por wallet |
| Completar Cap 4 | 50 $ZERO | 1x por wallet |
| Completar Cap 5 (Game Complete) | 200 $ZERO | 1x por wallet |
| Completionist (8/8 collectibles) | 500 $ZERO bonus | 1x por wallet |
| **Total maximo** | **800 $ZERO** | |

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

**Proof system**: El juego genera una firma del servidor (o del frontend con una seed determinista) que prueba que el jugador realmente completo el puzzle. Evita exploits de mint directo.

### Opcion B: Off-chain signature + AdrianLAB mint
Usar `AdrianLabAdmin.mintBatch()` con firmas EIP-712 generadas por un backend. Mas simple, usa contratos existentes.

### Recomendacion
**Opcion B para Release 1** (rapido, usa infraestructura existente). **Opcion A para Release 2+** (mas robusto, integrado en el Diamond).

---

## Escenas Necesarias por Release

### Release 1 (ya existen, necesitan ajuste)
- `outside` — existe, agregar mystery_envelope
- `frontdoor` — existe, ajustar como final de Cap 1
- `lobby` — existe, sin cambios mayores
- `upstairs` — existe, sin cambios mayores
- `rooftop` — existe, agregar trigger de cierre Cap 2

### Release 2 (parcialmente existentes)
- `basement` — existe, ajustar como apertura Cap 3
- `server_room` — existe, agregar collectibles y stats reales
- `mountain` — existe, expandir con clinic_exterior
- `clinic_exterior` — **NUEVA** (scanner biometrico, exterior brutalista)
- `clinic_interior` — existe, expandir archivo y puzzle Base64

### Release 3
- `treatment_room` — existe, expandir con secuencia cinematica y Alchemy integration
- `epilogue_outside` — **NUEVA** (exterior clinica, amanecer, cierre narrativo)

**Total nuevas escenas a crear: 2** (clinic_exterior, epilogue_outside)

---

## Timeline Sugerido

| Release | Contenido | Estimado |
|---------|-----------|----------|
| **R1: "The Lab"** | Cap 1-2, wallet connect, 3 collectibles, 2 achievements | Prioridad alta |
| **R2: "The Underground"** | Cap 3-4, $ZERO rewards, 4 collectibles, 2 achievements, 1 escena nueva | Despues de R1 feedback |
| **R3: "The Revelation"** | Cap 5 + epilogo, Alchemy integration, 1 collectible, 2 legendary achievements | Gran finale |

---

## Notas de Diseno

### Para mantener engagement Web3
- **Cada sesion de 15 min = algo nuevo en tu wallet**
- **Progress board**: pagina web que muestra tu % de completion (lee on-chain)
- **Leaderboard**: primeros 100 en completar cada capitulo obtienen un trait exclusivo
- **Social proof**: "X wallets have completed Chapter N" counter en la pantalla de inicio

### Easter eggs cross-ecosistema
- Holders de AdrianPunks ven sus Punks como retratos en la pared del lobby
- Holders de Floppy Discs pueden usar los floppies en el CRT del basement
- Stakers de $ZERO ven su staking stats en el Founder Mode dashboard
- Compradores via FloorEngine ven sweep history en el server room

### Rejugabilidad
- Cada capitulo tiene rutas VIP (gate por NFT) con dialogo exclusivo
- Collectibles ocultos incentivan replay
- Diferentes mensajes de Adrian en Cap 5 segun tu perfil on-chain
- Speedrun mode: timer on-chain, leaderboard para completar todo el juego

# A10.1 · Informe: vender «ZEROadventure II» en Steam

**Fecha:** 14-nov-2026. **Base:** `main` = `ffed2ef`. **Coste de este informe:** 0 $ (no se ha creado ninguna cuenta ni
se ha pagado nada).

**Cómo leerlo.** Cada dato lleva su etiqueta:

- **[V]** verificado en la fuente oficial enlazada, consultada el 14-nov-2026 (la cita es literal);
- **[S]** sale de prensa o de documentación de terceros, no de Valve ni del proveedor;
- **[I]** inferencia o recomendación mía, sin fuente que la respalde.

Las rutas de código son relativas a la raíz del repo y llevan `archivo:línea` en `ffed2ef`.

---

## Resumen en 12 líneas

1. **Bloqueante (cripto/NFT):** la regla de Valve sigue vigente y prohíbe *«Applications built on blockchain technology
   that issue or allow exchange of cryptocurrencies or NFTs»* [V]. El juego web actual no se puede subir tal cual: tiene
   cartera, lecturas en cadena, mint de logros en el Diamond, firma de partidas y enlaces a OpenSea (§ 1.2).
2. **Una build `STEAM=1` sin nada web3 sí cumple la letra de la regla** [I]: no usa blockchain ni emite ni intercambia
   nada. Hoy el repo ya *oculta* parte de lo web3 en Electron (`src/config/platform.ts`), pero no lo *quita*: viem,
   WalletConnect, las direcciones de los contratos y las llamadas a `save.zerothetoken.com` siguen en el bundle y hay
   botones que se ven igual (Leaderboard, guardado en la nube, insignias) (§ 1.3).
3. **El tema cripto como humor** no está prohibido en ninguna regla publicada [V: no aparece en la lista], pero **hay
   duda razonable** con las menciones a activos **reales** que se pueden comprar ($ZERO, AdrianZERO, AdrianLAB,
   adrianzero.com): un revisor podría leerlas como promoción de un token. Propongo neutralizarlas en la build de Steam y
   preguntar a Valve con el texto de § 1.6 antes de pagar nada más que la cuota.
4. **Cuenta y dinero:** 100 $ por juego, no reembolsables, recuperables cuando el juego pase de 1.000 $ brutos ajustados
   [V]. Verificación de identidad, banco e impuestos: 15-30 días [V]. 21 días de espera desde el pago hasta poder lanzar
   [V]. Página «Próximamente» al menos 2 semanas [V]. Revisión de la página y de la build: pedirla con 7 días hábiles de
   margen [V].
5. **Empaquetado:** Electron (ya está en el repo: `electron/main.cjs`, `build:steam`) + steamworks.js (logros, Steam
   Cloud, Rich Presence, overlay) [V para la API]. Tauri y NW.js no compensan (§ 3).
6. **Lo que falta para Steam:** quitar web3, guardar en archivos con Steam Cloud, pantalla completa, **mando** (hoy no
   hay ni una línea de gamepad), ajustes, y medir la duración real (A9.14).
7. **IA:** hay que rellenar la sección de IA de la encuesta de contenido (contenido pre-generado) [V]. La música de
   ElevenLabs en plan Creator **se puede** usar en un juego indie (menos de 500.000 $ de ingresos) [V], pero el plan es
   «For Individual Use Only» [V]. Si vende la SL hay que aclararlo. Faltan la licencia OFL de la fuente y un archivo de
   créditos. Hay activos de origen sin documentar (§ 5).
8. **Precio:** horquilla de 4,99-9,99 $ si dura 2-4 h, y hasta 14,99 $ si pasa de 5 h [I]. Ojo: Steam devuelve el dinero
   con menos de 2 h jugadas y dentro de 14 días [V]. Un juego de menos de 2 h se puede acabar y devolver.
9. **Recomendación:** **sí se puede**, con una **versión «Steam Edition» sin web3, solo Windows** (que corre en Steam
   Deck por Proton). Antes tiene que cerrarse el contenido (voces A6.3, A2.19, A3.11, A9.14). Calendario: unas 6-8
   semanas desde el «adelante» si Adrián paga la cuota al principio; lanzamiento realista en **enero-febrero de 2027**
   [I].

---

## 1. BLOQUEANTE: blockchain, cripto y NFT

### 1.1 Qué dice Valve hoy

- **Regla vigente [V].** La lista «What you shouldn't publish on Steam» de la página de *onboarding* de Steamworks
  incluye, en el punto 13: *«Applications built on blockchain technology that issue or allow exchange of
  cryptocurrencies or NFTs.»* También incluye, en el punto 14: *«Applications with advertising-based business models.»*
  Fuente: <https://partner.steamgames.com/doc/gettingstarted/onboarding> (consultada el 14-nov-2026).
- **Origen [S].** La prensa sitúa la regla en octubre de 2021. No he encontrado ninguna aclaración ni ningún cambio de
  Valve en 2025-2026. Valve tampoco ha publicado nunca una explicación oficial. Fuentes:
  [PC Gamer](https://pcgamer.com/steam-bans-nfts-cryptocurrencies-blockchain) y
  [Engadget](https://www.engadget.com/steam-ban-cryptocurrency-nft-trading-blockchain-valve-165038811.html).
- **Precedente [S].** Varios juegos con parte web3 han sacado en Steam una versión sin ella: Gala, con un «non-NFT
  SKU» de *Superior*; *Angelic*, con una versión «totally crypto-free»; *Champions Ascension*, que desactiva el
  intercambio en Steam. Fuente: [Decrypt, 21-ago-2023](https://decrypt.co/153196/crypto-nft-games-still-launching-steam-despite-ongoing-ban).
  Valve no comentó nada a ese medio. No es una norma, pero confirma que **el camino habitual es una versión
  distinta sin cripto**.
- **Más reglas de la revisión [V].** El juego tiene que arrancar en todos los sistemas que se anuncian. Todo lo que diga
  la página tiene que estar en la build. Las compras dentro del juego van por el monedero de Steam, «not links to stores
  that don't offer it». La descripción de la tienda no puede llevar enlaces a otras webs. Fuente:
  <https://partner.steamgames.com/doc/store/review_process>.
- **No encontrado.** No hay ninguna regla publicada que hable del **tema** cripto (sátira, humor o ambientación) si no
  hay tecnología blockchain detrás. Tampoco he podido confirmar un ejemplo vivo de juego satírico sobre cripto en Steam:
  *Crypto Is Dead* (app 1633820) aparece como retirado y no sé por qué.

### 1.2 Inventario de TODO lo web3 del repo

| Pieza | Dónde | Qué hace | En Steam |
|---|---|---|---|
| Dependencias | `package.json`: `viem ^2.21.0`, `@walletconnect/ethereum-provider ^2.23.9`, overrides `@reown/appkit*` | Cliente EVM y WalletConnect | Fuera del bundle |
| Configuración de cadena | `src/config/blockchain.config.ts:3-30` | Base 8453; RPC de Alchemy con `VITE_ALCHEMY_API_KEY` o `mainnet.base.org` (:7-18); contratos AdrianZERO, AdrianLAB y Diamond $ZERO (:22-30); ABI de mint (:56) | Fuera |
| Cartera | `src/web3/wallet.ts` | Conexión inyectada o WalletConnect; firma de sesión `ZEROadventure-auth:<addr>:<ts>` (:29); WalletConnect por `import()` (:87) | Fuera |
| WalletConnect | `src/web3/walletconnect-provider.ts:11,38,48`, `src/ui/WalletConnectModal.ts`, `src/ui/WalletButton.ts` | Proveedor, modal y QR, botón de la cartera | Fuera |
| Mint en cadena | `src/web3/contracts.ts:42,88` | Mint de objetos y logros en el Diamond (solo web) | Fuera: **esto es literalmente «issue NFTs»** |
| Reglas de acceso | `src/web3/gating.ts:9,95` | ERC721/1155/20 y `ZERO_BALANCE` | Fuera |
| Opcode `web3Require` | `src/systems/ScriptEngine.ts:616-631` | Ejecuta `then` o `else` según la regla | Se queda el opcode; en Steam **siempre va por `else`** o por una rama nueva (§ 1.4) |
| `showDashboard` | `ScriptEngine.ts:633`, `src/web3/dashboard.ts`, `dashboardData.ts:22` (`TRAITLAB_URL='https://adrianzero.com'`), `src/ui/DashboardPanel.ts` | Panel del Mining Rig con saldos reales de $ZERO, AdrianZERO y Punks | Panel ficticio sin cadena |
| NFT y Alchemy | `src/web3/nft-loader.ts:49,81`, `src/systems/Web3VisualSystem.ts` | Imágenes de NFT reales en pósteres y placa | Arte fijo |
| ENS | `src/web3/ens.ts:33-35` | Alchemy o `eth.llamarpc.com` | Fuera |
| Historial de transacciones | `src/web3/tx-history.ts:28` (Blockscout), `UIScene.ts:304`; op `monitorReveal` en `treatment_room/scene.json:141,341,1790` | Enseña las transacciones reales del jugador en el monitor | Historial **ficticio** de Dex (es mejor para la historia) |
| Partida firmada | `src/web3/save-chain.ts:10`, `src/web3/wallet-save.ts:9,75,87,158` | Firma con la cartera; nube en `https://save.zerothetoken.com` | Steam Cloud (§ 3.3) |
| Servidor de partidas | `save-server/` (Hono + viem): `verifyMessage` y verificación en cadena (`index.js:18-19`), `GET/POST /save`, `GET /leaderboard` (:134) | Partidas y ranking por dirección con ENS | No se usa |
| Leaderboard | `src/scenes/MenuScene.ts:199` (botón siempre visible), :360 (fetch) | Ranking por dirección | Fuera, o tablas de Steam (opcional) |
| Insignias | `src/ui/BadgePanel.ts:7-11` (`mintAchievement`, `hasLabToken`, enlace a OpenSea), `UIScene.ts:174` (siempre se crea) | Logros acuñables | Logros de Steam |
| Diario | `src/systems/JournalData.ts:4,20-24` (`gateAddress`, nota «Badge available» si `wallet_connected`) | Pistas de cartera | Sin esas notas |
| Mock de QA | `src/web3/web3Mock.ts`, `src/qa/QaApi.ts:32-34` (cargado con `import()` desde `main.ts:66`) | Solo con `?qa=1` | Fuera |
| Contenido con acceso de holder | 6 `web3Require` en 3 escenas + 3 `gate`/objetos + 2 `web3Visuals` (tabla § 1.4) | Ramas de holder | Sustituidas |
| «Founder Mode» | `assets/scenes/upstairs/scene.json:1283-1306` (combo con el Golden ZERO Token), placa `treatment_room/scene.json:972` | **No depende de la cadena**: es un objeto del juego | Se queda (y se renombra si el token se llama igual que el real, § 1.5) |

**Lo que ya existe [V en el código].** `src/config/platform.ts` ya prevé tres destinos (web, Android y Steam) y define
`IS_STEAM = IS_ELECTRON` y `WEB3_ENABLED = IS_WEB || IS_NATIVE`. Fallos:

- **Se detecta en tiempo de ejecución** (por el `userAgent` «Electron»), así que **no quita nada del bundle**.
- `platform.ts` importa `@capacitor/core` también en la build de escritorio.
- Los imports de web3 son **estáticos** en `UIScene.ts:23-25`, `GameScene.ts:21-26`, `MenuScene.ts:4-10`,
  `SaveLoadSystem.ts:3`, `SaveButton.ts:7-8`, `BadgePanel.ts:7-8`, `Web3VisualSystem.ts:4-5`, `JournalData.ts:4` y
  `DashboardPanel.ts:2`: viem entra siempre en el bundle principal.
- Con `WEB3_ENABLED=false` **siguen visibles** el botón Leaderboard (`MenuScene.ts:199`), el guardado en la nube
  (`UIScene.ts:101`) y las insignias (`UIScene.ts:174`).
- El único `define` de `vite.config.ts` es `__BUILD_HASH__` (:115-117).

### 1.3 Propuesta: build `STEAM=1` que QUITA (no oculta) lo web3

[I] Diseño para A10.2:

1. **Destino en compilación.** `STEAM=1 npm run build:steam` mete en `vite.config.ts` un
   `define: { __STEAM__: true }` y un `resolve.alias` que cambia `@/web3/*` por `src/web3-off/*`. Son módulos de igual
   firma que no hacen nada (`checkGating → false`, `getWallet → null`, sin viem). Así ni los imports estáticos arrastran
   viem. `platform.ts` pasa a leer `__STEAM__` y deja de mirar el `userAgent`. `@capacitor/core` también se sustituye
   por alias en Steam.
2. **Interfaz.** Con `__STEAM__` no se crean WalletButton, WalletConnectModal, DashboardPanel real, Leaderboard, nube
   de `wallet-save` ni el mint de BadgePanel. Rollup elimina las ramas `if (__STEAM__)` muertas.
3. **Contenido.** Un paso de build (`scripts/steam/strip-scenes.mjs`) reescribe en `dist/` los `scene.json`: cada
   `web3Require` se cambia por su rama `steam` (nueva, § 1.4) o por `else`, y se quitan `web3Visuals`, `gate` de cartera y
   las líneas «[Requires AdrianZERO]». El linter (`scripts/lint-scenes.mjs`) obliga a que toda rama de holder tenga su
   alternativa `steam`.
4. **Textos con activos reales** (§ 1.5): una tabla de sustitución que solo se aplica en Steam.
5. **Comprobación en CI (lo que convence a un revisor).** Un job `steam-bundle-clean` busca en `dist/` y en el
   `app.asar` empaquetado y **falla** si encuentra cualquiera de estas cadenas: `viem`, `walletconnect`, `reown`,
   `alchemy`, `blockscout`, `zerothetoken`, `opensea`, `adrianzero.com`, `0x6e369bf0`, `0x90546848`, `0x542b2B96`,
   `eth_requestAccounts`, `signMessage`. La app de Electron no lleva viem ni WalletConnect en `node_modules`: el bloque
   `build.files` de hoy ya copia solo `dist/**/*` y `electron/**/*.cjs`, con `!node_modules/**/*` [V `package.json`].
   Cuando entre steamworks.js (A10.7), se añade **solo ese** módulo.
6. **Sin red.** En Electron, `session.webRequest` bloquea cualquier petición que no sea `file://`. Así queda demostrado
   que la build no habla con ninguna cadena ni con ningún servidor propio.

### 1.4 Qué sustituye a las ramas de holder (el juego sigue completo)

[V en el código] Hay 6 `web3Require` en 3 escenas y 5 puntos más con acceso o aspecto de holder. [I] Alternativa
dentro del juego para cada uno. Todas se consiguen jugando y ninguna es imprescindible para acabar, igual que hoy:

| Rama de holder hoy | Dónde | Qué da | Sustituto en Steam [I] |
|---|---|---|---|
| Póster real si tienes AdrianPunks o AdrianZERO | `lobby/scene.json` `hs_poster` :1011, :1040, :1090, :1119 | Póster entero, flag `holder_wall`, logro «HOLDER: Wall Reader» | Minipuzle: los trozos del póster roto (o la cinta del cajón) lo recomponen → mismo flag; logro «Wall Reader» |
| Dashboard del Rig con `ZERO_BALANCE` ≥ 1000 | `upstairs/scene.json:289` (nota con el PIN 0301 en :323; sin saldo, «Needs 1000 $ZERO» en :331) | `showDashboard`, `rig_dashboard_seen`, «TraitLab Insider» | El Rig se abre con la contraseña de la nota adhesiva (ya existe la frase en :308) o con el Golden Token → panel **ficticio** con números de broma. El PIN 0301 ya tiene otra vía para quien no es holder (`basement/scene.json:1347,1383`), así que no hay bloqueo |
| Grafiti de los arbustos | `outside/scene.json:1189` `hs_bushes` | «ZERO WAS HERE» + `holder_wall` | Aparece al MIRAR dos veces o con la linterna |
| Diálogo VIP de Satoshi «[Requires AdrianZERO]» | `clinic_interior/scene.json:1204` (flag `satoshi_vip` en :1312, ruta VIP con Chad en `recovery_pool:1310`) | Ruta VIP | Se desbloquea enseñando la `vip_floppy` o la pulsera de paciente VIP que da Penny tras su chiste. Encaja con la biblia (A9.8 «VIP de Satoshi») |
| Diálogo VIP del lobby | `lobby/scene.json:1379` (rama `vip` en :1472) | Pista de la trampilla (`vip_rug_hint`) | Misma pista con el diálogo normal tras dos intentos (pista justa) |
| Objeto `vip_floppy` | `lobby/scene.json:1539` | Solo visible para holders | Escondido en el lobby (MIRAR la maceta o el sofá) |
| Pósteres y placa web3 | `lobby:1886,1895`; `treatment_room:1917` (`plaque_founder` con `ZERO_BALANCE`) | Arte de los NFT del jugador | Arte fijo pintado (Arte pendiente, vía código) |
| Monitor con tus transacciones | `treatment_room/scene.json:141,341,1790` + `tx-history.ts` | Transacciones reales | «Historial de Dex» inventado (gag: compras en máximos, ventas en mínimos). Refuerza el arco de la terapia |
| 10 logros de holder | `src/config/achievements.config.ts:66-134` (`holder_vip_floppy`, `vip_access`, `holder_rig`, `holder_wall`, `archivist`, `alpha_leak`, `genesis_miner`, `sector_zero`, `medical_records`, `preserved`) | Insignias acuñables | Logros de Steam con los sustitutos de arriba; los ids `holder_*` se renombran (`collector_*`) |

### 1.5 ¿Es aceptable el TEMA cripto sin tecnología?

- **[V] No hay regla en contra.** Las listas de onboarding y de revisión no dicen nada del tema. Solo regulan la
  tecnología que «issue or allow exchange», la publicidad como modelo de negocio, los enlaces fuera y el contenido sin
  derechos.
- **[I] El humor genérico es seguro.** HODL, rug, wen lambo, gwei, «Ser Liquidated III» o la «Chronic Airdrop
  Dependency» son sátira de una cultura. La biblia ya lo plantea así: *«Los chistes cripto son su síntoma, no la voz del
  guion»* (`docs/DESIGN_BIBLE.md:97`) y la trama es literalmente una terapia de desintoxicación de degen. En las escenas
  hay unas 120 líneas con términos cripto (outside 27, lobby 19, basement 17…) y unas 43 en `ScummUI.ts`. Ejemplos:
  `outside/scene.json:1312`, `clinic_interior/scene.json:69,1482`.
- **[I] El riesgo está en los activos REALES con nombre propio:**
  - **$ZERO** existe y cotiza (el título del juego y «Needs 1000 $ZERO» en `upstairs:331`);
  - las colecciones **AdrianZERO**, **AdrianLAB** y **AdrianPunks**;
  - las webs `adrianzero.com` y `zerothetoken.com`;
  - en `treatment_room:984`, «Below it, my wallet address».

  Si la ficha de Steam o el juego remiten a un token que se puede comprar, un revisor puede leerlo como **publicidad de
  un activo cripto**. Eso choca con el punto 14 (advertising-based business models) y con el espíritu del 13. También
  hay marcas de terceros: **«Ledger»** es una marca real de carteras.
- **[I] Mitigación propuesta para Steam.** El título se queda: «ZEROadventure II: Patient Zero» se lee como «paciente
  cero». En la build de Steam, «$ZERO» pasa a ser «ZERO coins» o «$GERALD» (un token inventado del juego). El dashboard
  muestra cifras inventadas. «AdrianZERO holder» pasa a «VIP patient». «Ledger» pasa a «Hard Wallet» o «Cold Box». Se
  quitan las direcciones de contratos, las URLs y OpenSea. La ficha de la tienda no menciona $ZERO, NFT ni la web3 del
  juego de navegador. **Las voces ya grabadas que digan «$ZERO» o «Ledger»** tendrían que regenerarse: pocas líneas,
  hay que contarlas en A10.2.

### 1.6 Duda razonable y pregunta para Valve

Duda: si un juego **sin ninguna tecnología blockchain** puede llamarse igual que un token real y tener la misma marca
que una colección NFT del mismo autor. [I] Lo más probable es que sí, si no hay ni enlaces ni promoción, pero no hay
regla escrita. Antes de invertir en el empaquetado, conviene preguntarlo. Esto solo lo puede hacer Adrián, desde
Steamworks, una vez creada la cuenta: Soporte → «Contact Steamworks support» [I: el canal exacto no está verificado
sin cuenta]. Texto propuesto:

> Hello. We are preparing a single-player point-and-click adventure for Steam. Its story is a comedy about a man in
> rehab for his crypto-trading addiction (jokes about "HODL", "rug pulls", etc.). The Steam build contains **no
> blockchain technology at all**: no wallet connection, no on-chain reads or writes, no cryptocurrency or NFT issuance
> or exchange, no external links, and it makes no network requests (all assets bundled, achievements and saves via
> Steamworks). A separate web version of the game exists outside Steam with optional wallet features. The author also
> runs an unrelated token project whose name ("ZERO") appears in the game's title as a pun on "Patient Zero".
> Questions: (1) Is a crypto-themed satire without any blockchain functionality acceptable under the onboarding rules?
> (2) May the title keep the word "ZERO", provided neither the game nor the store page mentions or links to the token,
> NFTs or the web version? Thank you.

Plan B si Valve dice que no al nombre: otro título solo para Steam («Patient Zero: A Degen Rehab Adventure» o similar).
El resto del plan no cambia.

---

## 2. Cuenta, costes y plazos

| Concepto | Dato | Fuente |
|---|---|---|
| Cuota Steam Direct | **100 $ por juego**, *«not refundable, but will be recoupable in the payment made after your product»* tenga ≥ **1.000 $** de *Adjusted Gross Revenue* | [V] <https://partner.steamgames.com/steamdirect> |
| Alta | Banco, impuestos e identidad: *«This process takes between 15-30 days to complete.»* | [V] misma página |
| Espera tras pagar | *«A 21-day waiting period between when you paid the app fee and when you can release your game.»* | [V] misma página |
| Página «Próximamente» | *«you must have a Coming Soon page up for at least two weeks before releasing»*; pedir la revisión *«at least 7 business days before you want your page live»* | [V] <https://partner.steamgames.com/doc/store/coming_soon> |
| Revisión de página y build | Suele durar 3-5 días hábiles; planificar ≥ 7 días hábiles. La build tiene que arrancar en cada SO anunciado y tener todo lo que dice la página | [V] <https://partner.steamgames.com/doc/store/review_process> |
| Persona o empresa | *«It's OK to onboard as an individual»*: como autónomo, «Sole Proprietorship» con nombre y apellidos. *«The account holder name on your bank account must match the name you provide when onboarding.»* Se firman el NDA y el *Steam Distribution Agreement* | [V] <https://partner.steamgames.com/doc/gettingstarted/onboarding> |
| Impuestos EE. UU. | Cuestionario fiscal; los países con convenio dan datos *«similar to that found on form W-8BEN»* | [V] misma página. [I] España tiene convenio con EE. UU.; la retención exacta la confirma la gestoría |
| Reparto | 30 % para Valve (25 % por encima de 10 M$ y 20 % por encima de 50 M$) | [S] [Game Developer](https://gamedeveloper.com/business/valve-creates-new-rev-share-tiers-to-give-big-sellers-a-break). **No verificado en Valve**: el reparto está en el *Distribution Agreement*, que solo se ve con cuenta |
| Precio mínimo y descuentos | Mínimo equivalente a 0,99 $; no hay descuentos en los 30 días siguientes al lanzamiento salvo el de lanzamiento | [V] <https://partner.steamgames.com/doc/store/pricing> |
| Devoluciones | *«within two weeks of purchase and with less than two hours of playtime»* | [V] <https://store.steampowered.com/steam_refunds/> |
| Apple (solo si hay macOS) | 99 $/año; como persona no hace falta D-U-N-S y vende con su nombre; como organización sí hace falta D-U-N-S (gratis) | [V] <https://developer.apple.com/support/enrollment/> |

**¿A nombre de Adrián o de la SL de AdrianBeauty?** [I] Lo decide Adrián con su gestoría. Elementos para decidirlo:

- **Persona (empresario individual).** Alta más rápida y sin cambiar nada de la SL. Encaja con el plan Creator de
  ElevenLabs, que es «For Individual Use Only» (§ 5) y lo tiene Adrián, y con una cuenta de Apple individual. En
  contra: los ingresos van al IRPF y seguramente hace falta darse de alta como actividad económica (epígrafe, y quizá
  RETA si es habitual; lo dice la gestoría). La cuenta bancaria tiene que estar a su nombre.
- **SL.** Separa el riesgo y tributa en el Impuesto de Sociedades. En contra: el objeto social (estética) quizá haya
  que ampliarlo. Las licencias de IA tienen que estar a nombre de quien explota el juego: la música Creator es
  individual. Mezcla el salón con un juego de humor cripto (imagen de marca). Apple pediría D-U-N-S.
- **IVA [I, no verificado].** Steam vende al consumidor final y liquida el IVA de la venta; al desarrollador le paga
  regalías. Cómo se facturan esas regalías lo confirma la gestoría.

**Coste mínimo:** 100 $ (recuperables). Opcionales: 99 $/año de Apple si hay macOS, y créditos de ElevenLabs para
regenerar las líneas de § 1.5 (son pocas y entran en el plan actual).

---

## 3. Empaquetado de escritorio y Steamworks

### 3.1 Electron, Tauri o NW.js

| | Electron | Tauri | NW.js |
|---|---|---|---|
| En el repo | **Ya está**: `electron/main.cjs` (ventana de 1280×720, `contextIsolation`, carga `dist/index.html`), `electron ^41.2.0`, `electron-builder ^26.8.1`, scripts `build:steam` y `dev:steam`, `build.files` | Nada | Nada |
| Peso | Chromium incluido: decenas de MB más el juego. Los assets pesan 447 MB, que es lo que domina [V `du`; I sobre Chromium] | Mínimo (usa el webview del sistema) | Parecido a Electron |
| Rendimiento con Phaser/WebGL | El mismo Chromium en todas partes: lo que se prueba es lo que corre [I] | WebView2, WKWebView o WebKitGTK: tres motores distintos [S] | Chromium |
| Overlay de Steam | Soportado con `electronEnableSteamOverlay()` de steamworks.js [V en el README]; hay incidencias abiertas, sobre todo fuera de Windows [S] | Con WebView2 el overlay «appears to be impossible» [S, blog de Construct] | Sin ventaja |
| Steam Deck / Proton | Se ejecuta la build de Windows por Proton; hay incidencias de Electron en *Game Mode* [S, foro de Steam] | Un desarrollador da su juego Tauri por «unplayable even on proton» [S] | Sin datos |
| macOS | electron-builder firma y notariza; hace falta la cuenta de Apple de 99 $/año | Igual | Igual |
| SDK de Steam desde JS | **steamworks.js** (MIT): `achievement`, `cloud.readFile/writeFile`, `localplayer.setRichPresence`, `overlay`, `input`, `utils.isSteamRunningOnSteamDeck`, `utils.showGamepadTextInput` [V `client.d.ts`]. Alternativa: steamworks-ffi-node [S] | Desde Rust (crates de terceros) | greenworks (antiguo) [I] |

**Recomendación [I]: Electron + steamworks.js**, porque ya está hecho a medias y es el camino con más soporte. Notas:

- steamworks.js es un módulo nativo: su README pide `nodeIntegration: true` y `contextIsolation: false` para usarlo en
  el renderer [V]. Es más limpio y seguro **llamarlo desde el proceso principal** y exponer 5 funciones con un `preload`
  y `contextBridge` [I].
- Hay que copiar `sdk/redistributable_bin/<SO>` junto al ejecutable [V README].
- **Plataformas:** primero solo Windows. Linux y Steam Deck van con esa misma build por Proton y se prueban en el
  Deck. macOS después, si hay demanda, porque cuesta 99 $/año y hay que notarizar.

### 3.2 Logros de Steam (los actuales)

[V] `src/config/achievements.config.ts` tiene logros de capítulo (`ch1..ch4_complete`, `patient_zero`,
`game_complete`), 10 de holder (:66-134), de explorador y secretos (`signal_boost`, `diamond_hands`,
`meme_achievement`). El mapeo texto→id está en :169-172.

[I] En Steam se mapean 1:1 con `achievement.activate(id)`:

- los de capítulo y los secretos, tal cual;
- los de holder, renombrados y con las vías de § 1.4.

Hacen falta iconos de 256×256 en color y en gris por logro: B1 de Arte pendiente ya pide 6 insignias. `BadgePanel`
queda como vista local sin mint.

### 3.3 Partidas: Steam Cloud en vez del save-server

[V] Hoy:

- `SaveLoadSystem` guarda en `localStorage` (:18), con claves `adrian_adventure_save` y
  `adrian_adventure_wallet_<addr>` (`SaveProgress.ts:17-18`);
- hay huecos de autoguardado 0, manuales 1-2, copia 3 y anterior 4 (`SaveSlots.ts:19-25`);
- la nube exige firma de cartera (`SaveSlots.ts:182,219-223`);
- los ajustes van en `localStorage` (`Settings.ts:18-21`).

Steam Auto-Cloud *«allows apps to use Steam Cloud without writing code»* sincronizando las rutas que se configuran,
con cuota por usuario [V <https://partner.steamgames.com/doc/features/cloud>].

[I] Propuesta:

- En Electron, los huecos se escriben como **archivos JSON** en `app.getPath('userData')/saves/slot-N.json`, a través
  del `preload`, y Auto-Cloud se configura sobre esa carpeta.
- No conviene sincronizar el LevelDB de `localStorage` de Chromium: se corrompe si se copia a medias.
- Sin servidor propio y sin firma. La migración (`SaveMigration.ts`, `SAVE_VERSION = 2`) sigue valiendo.

### 3.4 Overlay y Rich Presence

[V API] `localplayer.setRichPresence(key, value)`. [I] Se puede usar `steam_display` = «Chapter 3 · Basement» con los
datos de `ChapterManager`. El overlay (Mayús+Tab) necesita `electronEnableSteamOverlay()` y probarlo en Windows y en el
Deck. Si falla, el juego no se rompe: el overlay no es obligatorio para publicar [I].

---

## 4. Requisitos de producto

### 4.1 Sin conexión

[V en el código] Todo el audio es local:

- voces: `assets/audio/voice/<clave>.mp3` (`voice.config.ts:4795`, 4.779 archivos);
- música: `PreloadScene.ts:223`;
- efectos: `PreloadScene.ts:244`;
- ambiente: `Ambience.ts:22`;
- la fuente está empaquetada (`index.html:35-42` → `assets/fonts/PressStart2P-Regular.ttf`).

Lo único que sale a la red es web3: `save.zerothetoken.com`, Alchemy (RPC, NFT, ENS), `mainnet.base.org`,
`eth.llamarpc.com`, Blockscout, imágenes de NFT, OpenSea y adrianzero.com. **Con la build `STEAM=1` de § 1.3 el juego
queda 100 % sin conexión** y el bloqueo de red de Electron lo garantiza.

### 4.2 Pantalla, entradas y ajustes

| Requisito | Hoy [V] | Falta [I] |
|---|---|---|
| Resolución | `game.config.ts:20-23` `Scale.RESIZE` al 100 %, `pixelArt` (:32); escalado entero de A2.8 | Probar 1280×800 (Deck) y 1920×1080 |
| Pantalla completa | No hay `startFullscreen` ni `requestFullscreen`; la ventana de Electron es `fullscreenable` pero arranca en ventana | Arrancar a pantalla completa, con Alt+Intro, F11 y una opción en ajustes |
| Ratón y teclado | `DesktopControls.ts:36-46` (verbos O/P/S/C/L/Y/G/T/U), Tab para resaltar y Esc (:108-109), doble clic (:49) | Bien |
| Mando / Steam Deck | **Nada** (ni una mención a `gamepad`) | Navegación con mando (cursor con el stick, A = acción, rueda de verbos con el pad o los gatillos, inventario con un botón) + configuración por defecto de Steam Input + iconos de mando cuando se juega con él |
| Requisitos Deck «Verified» | — | [V] <https://partner.steamgames.com/doc/steamdeck/compat>: *«The default controller configuration must provide users with the ability to access all content»*; los iconos tienen que coincidir con la entrada activa; resolución 1280×800 o 1280×720; *«the smallest on-screen font character should never fall below 9 pixels in height at 1280x800»* (recomienda 12 px); 30 fps; sin avisos de «no compatible»; si hay que escribir, `showGamepadTextInput`. Ojo: los puzles de teclado (DOORIS, PIN 0301) necesitan el teclado en pantalla |
| Ajustes | Solo velocidad del texto y volumen de la música (`Settings.ts`, en el panel de `SaveButton.ts:2`) | Volumen general, de voces y de efectos; subtítulos; pantalla completa; Salir al escritorio |
| Idiomas | Solo inglés, sin i18n | Ver § 4.3 |

### 4.3 Idiomas

[V en `docs/progreso/A6.1.md`, rama `origin/scumm/a6-voces`] El guion hablado tiene **2.575 líneas y 198.939
caracteres**; Dex es el 89 %. [I] Opciones:

- **Solo inglés en el lanzamiento.** 0 $ y el riesgo más bajo.
- **Subtítulos e interfaz en español, voces en inglés.** Hace falta un sistema i18n (claves en vez de literales en
  `scene.json` y `ScummUI.ts`). Traduce el orquestador con su cuota (0 $), Adrián revisa los chistes, y Steam lo anuncia
  como «interfaz + subtítulos». Esfuerzo: 3-4 vueltas.
- **Doblaje al español.** Con la tarifa medida en A6.1 (0,225 créditos/carácter en `eleven_v4_turbo`), serían unos
  **45.000 créditos, unos 56.000 con el 25 % de margen** [I: misma longitud que el inglés]. Además hay que repetir el
  casting de voces. No lo recomiendo para la v1.

### 4.4 Duración y precio

**Duración real: sin medir** (A9.14 en curso). [I] Horquilla de precio, sin cifras de juegos concretos porque no las he
verificado una a una:

| Duración medida | Precio base sugerido |
|---|---|
| < 2 h | 4,99 $ (y riesgo de devoluciones: con < 2 h se puede acabar y pedir el reembolso [V]) |
| 2-4 h | 6,99-9,99 $ |
| 5 h o más, con extras (comentarios, galería) | 12,99-14,99 $ |

Descuento de lanzamiento del 10-20 % (está permitido al lanzar [V pricing]). Precios regionales con la herramienta de
Steam.

---

## 5. Contenido generado con IA

### 5.1 Qué pide Steam

[V] <https://partner.steamgames.com/doc/gettingstarted/contentsurvey>:

- **Pre-Generated:** *«Any kind of content that ships with your game and is consumed by players»* hecho con IA durante
  el desarrollo. Se promete que no hay contenido ilegal ni que infrinja derechos, y Valve lo revisa como el resto.
- **Live-Generated:** contenido generado mientras se juega. Aquí no hay.
- La página dice *«Efficiency gains through the use of these tools is not the focus of this section»*.
- Según la prensa, gran parte de lo declarado sale en la ficha de la tienda [S, [VGC](https://www.videogameschronicle.com/news/steam-pages-will-now-disclose-which-games-use-ai-generated-content/)].

### 5.2 Inventario y licencias

| Contenido | Herramienta | Licencia o términos | Estado |
|---|---|---|---|
| Música (6 temas × 4 niveles + stingers, A8.3) | ElevenLabs Music, plan **Creator** | [V] <https://elevenlabs.io/eleven-music-model-specific-terms> (actualizado el 9-oct-2026). Creator: elegibilidad *«For Individual Use Only»*; uso comercial *«except film, TV, radio, and Studio Games»*. Un *Studio Game* excluye el *Indie Game*: juego con menos de 500.000 $ de ingresos acumulados, de una entidad con menos de 1.000.000 $ anuales en juegos. Sin atribución obligatoria | **OK como juego indie**. [I] Si vende la SL, aclarar con ElevenLabs que el plan «individual» cubre una explotación de la empresa, o publicar como persona |
| Voces (ElevenLabs TTS, A6.x, `eleven_v4_turbo`) | ElevenLabs, plan Creator | [V] <https://elevenlabs.io/pricing>: Starter (incluido en Creator) trae *«Commercial License»* | [I] Falta comprobar si alguna voz es de la *Voice Library* con condiciones propias y si la licencia sigue viva al dar de baja el plan. **No verificado** |
| Voces antiguas (Kokoro, `voices.json`) | Kokoro-82M | [V] <https://huggingface.co/hexgrad/Kokoro-82M>: pesos **Apache-2.0**, *«can be deployed anywhere from production environments to personal projects»* | La licencia de las **voces** (VOICES.md) no la he podido leer: **sin verificar**. Además A6.3 las va sustituyendo |
| Efectos y stingers | Sintetizados por código (`scripts/audio/synth.mjs`, `stinger-recipes.mjs`; A4.4, A4.5, A4.7) | Propios | OK. [I] Los mp3 antiguos de `assets/audio/sfx` (68) tienen origen **sin documentar**. Si A8.4 usa los efectos de ElevenLabs, revisar sus términos (no los he consultado) |
| Pistas de música antiguas (`retro-adventure`, `vista`, `retroadrian`…) | Origen sin documentar en el repo | — | [I] Comprobar que A8.3 las ha sustituido todas o documentar su origen. `retroadrian` sigue en el tráiler |
| Sprites de NPC (Penny, Chad) | Gemini API (`art/npc/gemini_gen.py`; 0,078 $, `ARTE-N1-N2-P1.md`) | [V] <https://aistudio.google.com/docs/terms> (vigente desde el 23-mar-2026): *«Google won't claim ownership over that content»*, pero se reserva generar lo mismo para otros. En la capa gratuita usa las entradas y salidas para mejorar sus productos | OK. [I] Sin exclusividad: el arte no se puede registrar como «único» |
| Fondos (p. ej. F1 `rooftop`) | «Gem de aventuras gráficas» (app de Gemini, portátil) | Términos de consumo de Google para IA generativa: **no consultados** | [I] Verificarlos; en principio tampoco reclaman propiedad |
| Arte de la primera versión (abril de 2026) | `ASSET_GENERATION_PLAN.md`: PixelLab (prueba gratuita) y SpriteCook (gratis) | **No consultados** | [I] Comprobar qué queda en el juego de esas herramientas: los planes gratuitos suelen limitar el uso comercial. Si queda algo, rehacerlo por código o con Gemini |
| Rig de Dex, iconos y overlays | Código (`art/dex2d/build.py`, `make-item-icons.mjs`, etc.) | Propios | OK |
| Guion y textos | Escritos con un LLM (Claude) y dirigidos por Adrián | Entra en Pre-Generated como texto | Declararlo |
| Fuente Press Start 2P | Google Fonts | [V] el repositorio `google/fonts` la guarda en `ofl/pressstart2p` con `OFL.txt` (SIL Open Font License) | **Falta `OFL.txt` en el repo y en la build**: añadirlo |
| Phaser, Electron | — | MIT [I, conocido] | Añadir los avisos de licencia a la build |
| Marcas de terceros en el guion | «Ledger» (marca real), «Lambo» (A3.12, sin logotipo) | — | [I] «Ledger» → nombre genérico (§ 1.5) |

**Qué falta para estar limpio [I]:**

1. Un archivo `CREDITS.md` y una pantalla de créditos con el origen de cada asset y su licencia.
2. Añadir `OFL.txt`.
3. Documentar el origen de los sfx y de las pistas antiguas, y quitar o sustituir lo que no tenga licencia clara.
4. Leer los términos de la app de Gemini, de los efectos de ElevenLabs y de las voces de Kokoro.
5. Rellenar la sección de IA de la encuesta: «art, music, voice and dialogue drafts created with AI tools during
   development, reviewed and edited by the developer; no live-generated content».
6. **Fuera del ámbito de Steam, pero urgente:** `ASSET_GENERATION_PLAN.md` publica una clave de la API de PixelLab en
   este repo PÚBLICO. Hay que revocarla. Ya estaba anotado en la memoria de la orquestación.

---

## 6. Página de la tienda

### 6.1 Gráficos obligatorios

[V] <https://partner.steamgames.com/doc/store/assets>:

| Asset | Tamaño | ¿Hay algo? [I] |
|---|---|---|
| Header Capsule | 920×430 | Se puede sacar de `assets/ui/intro.png` (3268×1741) con el rótulo nuevo (U1 de Arte pendiente) |
| Small Capsule | 462×174 | Igual, pero el logo tiene que leerse a ese tamaño |
| Main Capsule | 1232×706 | Desde `intro.png` |
| Vertical Capsule | 748×896 | Hay que componerla |
| Page Background (opcional) | 1438×810 | Un fondo de escena oscurecido |
| Library Capsule | 600×900 | Hay que componerla (Dex y Gerald) |
| Library Hero | 3840×1240 (.png) | Los fondos son de 3712×1152: sirve uno ampliado un 3,5 % y recortado |
| Library Logo | 1280 de ancho y/o 720 de alto (.png) | Logotipo con alfa: está por hacer |
| Library Header Capsule | 920×430 | Igual que el header |
| Capturas | Mínimo 1920×1080, 16:9; solo juego, sin arte conceptual ni texto de marketing [V review_process] | Se pueden sacar con puppeteer (scripts `demo-*` del CI) a 1920×1080. Los GIF del CI no sirven tal cual |
| Tráiler | La página no da tamaños | Ya existen `TrailerScene.ts` y la carpeta `trailer/`. [I] Grabarlo a 1920×1080 desde la build de Steam (sin web3) |

Todas las cápsulas necesitan *«a readable product title or logo»* [V].

### 6.2 Texto y metadatos [I]

- **Descripción corta** (frase de gancho): «A crypto-degen wakes up with half a memory and a rehab bill. Point, click,
  HODL your sanity.»
- **Descripción larga:** sinopsis de la biblia, sin enlaces [V] y sin mencionar el token ni los NFT.
- **Etiquetas:** Point & Click, Adventure, Pixel Graphics, Comedy, Retro, Puzzle, Singleplayer, Story Rich, Short, Funny.
- **Clasificación por edad:** cuestionario de contenido de Steam (existe [V]). Habla de alcohol (B.O.T. barman),
  apuestas como tema y lenguaje suave. [I] Las clasificaciones regionales (PEGI/IARC) no las he verificado.
- **Requisitos mínimos [I]:** Windows 10 64 bits, 4 GB de RAM, GPU con WebGL 2, **1 GB de disco** (447 MB de assets +
  Electron).

---

## 7. Plan por fases

Unidades: **vuelta** = una iteración del orquestador (cuota de la suscripción, 0 $ de API).

| Fase | Qué | Quién | Esfuerzo | Dinero |
|---|---|---|---|---|
| 0 | Adrián lee esto y decide: persona o SL, título, ¿solo Windows? | Adrián | 1 lectura | 0 $ |
| A10.2 | Build `STEAM=1`: alias y stubs, `strip-scenes`, ramas `steam` en las 11 ramas de holder, textos de activos reales, job `steam-bundle-clean`, bloqueo de red | Orquestador | 3-4 vueltas | 0 $ (y unos cientos de créditos de ElevenLabs para las líneas de § 1.5) |
| A10.3 | Electron de verdad: pantalla completa, `preload` y `contextBridge`, partidas en archivos, ajustes completos, Salir, iconos, `OFL.txt` y `CREDITS` | Orquestador | 2-3 vueltas | 0 $ |
| A10.4 | Mando y Steam Deck: navegación con mando, iconos, teclado en pantalla en DOORIS y PIN, texto ≥ 9 px a 1280×800 | Orquestador (la prueba en un Deck real la hace Adrián, si tiene uno) | 4-5 vueltas | 0 $ |
| A10.5 | Alta en Steamworks: identidad, banco, impuestos, NDA y Distribution Agreement, pago de la cuota | **Solo Adrián** | 1-2 h + 15-30 días de espera [V] | **100 $** (recuperables) |
| A10.6 | Pregunta a Valve (§ 1.6) | **Solo Adrián** (desde su cuenta) | 10 min | 0 $ |
| A10.7 | steamworks.js: logros (mapeo § 3.2), Auto-Cloud, Rich Presence, overlay, `restartAppIfNecessary`; depósitos con SteamPipe | Orquestador (con el AppID que dé Adrián) | 2-3 vueltas | 0 $ |
| A10.8 | Página: cápsulas, logo, capturas a 1920×1080, tráiler, textos, etiquetas, requisitos, encuesta de contenido e IA | El orquestador lo prepara; **Adrián lo sube y lo envía** | 2-3 vueltas | 0-5 $ de Gemini, si se usan cápsulas pintadas |
| A10.9 | Limpieza de licencias (§ 5.2) | Orquestador; Adrián, para las dudas que haya que preguntar a ElevenLabs o a la gestoría | 1 vuelta | 0 $ |
| A10.10 | «Próximamente» ≥ 2 semanas, revisión de la build y lanzamiento | Adrián pulsa los botones; el orquestador prepara la build | — | 0 $ |
| Opcional | macOS (firma y notarización) | Adrián: cuenta de Apple | 1-2 vueltas | 99 $/año |
| Opcional | Subtítulos en español | Orquestador, con revisión de Adrián | 3-4 vueltas | 0 $ |

**Total para la v1 (solo Windows, inglés):** unas 15-20 vueltas del orquestador y **100 $** de dinero real.

**Lo que SOLO puede hacer Adrián:**

1. Decidir con la gestoría si publica como persona o como SL, y si se da de alta como actividad.
2. Crear la cuenta de Steamworks, verificar su identidad y poner el banco (con el titular igual que el alta) y los datos
   fiscales.
3. Firmar el NDA y el Steam Distribution Agreement.
4. Pagar los 100 $ de la cuota.
5. Enviar la pregunta a Valve.
6. Rellenar y firmar la encuesta de contenido y de IA, que es una declaración suya.
7. Pulsar «Publicar Próximamente» y «Lanzar».
8. Si hay macOS, pagar Apple Developer (99 $/año).
9. Si publica la SL, consultar a ElevenLabs lo del plan individual.
10. Probar en un Steam Deck real, si tiene uno.
11. Decidir el precio final y el título.

**Calendario [I].** Lo que tarda más es lo que no depende del código: 15-30 días de verificación y 21 días desde el
pago. Si Adrián se da de alta y paga en cuanto diga «adelante», los plazos van en paralelo con A10.2-A10.4 y con el
cierre del contenido (A6.3 voces, A2.19, A3.11, A9.14). Hay que sumar 2 semanas de «Próximamente» y unos 7 días hábiles
de revisión. Lo realista es **enero-febrero de 2027**. El *Steam Next Fest* de febrero de 2027 aparece en la
documentación [V, citado en la página de la encuesta]: una demo del capítulo 1 allí sería un buen escaparate [I].

---

## Recomendación final

- **¿Se puede?** **Sí**, con una condición: la versión de Steam **no lleva nada web3 en el bundle** (§ 1.3, con la
  prueba automática en el CI) y no promociona el token. Así el juego queda fuera de la letra de la regla 13 [V]. La
  única duda razonable es el nombre y las menciones a activos reales: se pregunta a Valve (§ 1.6) y se neutralizan en
  la build.
- **¿Qué versión?** «ZEROadventure II: Patient Zero — Steam Edition»: un jugador, sin conexión, solo Windows
  (Deck/Linux por Proton), inglés, logros de Steam y Steam Cloud. Las ramas de holder pasan a ser secretos jugables. La
  web sigue siendo la versión con cartera para la comunidad.
- **¿Cuándo?** No antes de cerrar el contenido y **medir la duración** (A9.14): con menos de 2 h el precio tiene que
  ser bajo por las devoluciones. Primer paso que no cuesta nada: A10.2 (build sin web3), que además limpia la web. Primer
  paso con dinero: el alta de Adrián (100 $). Conviene darla pronto porque los plazos de Valve son la ruta crítica.

## Fuentes que no he podido verificar

- **El reparto 30/25/20 %:** solo en prensa; está en el Distribution Agreement, que no es público.
- **Las incidencias de Electron/Tauri en el overlay y en el *Game Mode* del Deck:** foros y blogs, no Valve.
- **Los términos de la app de Gemini (Gem)**, los de los efectos de ElevenLabs y los de PixelLab y SpriteCook: no
  consultados.
- **La licencia de las voces de Kokoro** (VOICES.md): no leída.
- **La licencia de las voces de la Voice Library** de ElevenLabs y si sobrevive a la baja del plan.
- **El canal exacto para preguntar a Valve antes de la revisión:** hace falta la cuenta.
- **Las clasificaciones por edad regionales (IARC/PEGI) en Steam.**
- **Precios de aventuras comparables:** no los he contrastado uno a uno; la horquilla de § 4.4 es estimación.
- **Ejemplo vivo de juego satírico sobre cripto en Steam:** no encontrado (*Crypto Is Dead* figura como retirado).

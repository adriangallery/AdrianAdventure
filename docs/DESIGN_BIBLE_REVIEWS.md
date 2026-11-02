# Revisiones de la biblia de diseño (A3.1)

Proceso del plan: el diseñador redacta (`docs/DESIGN_BIBLE.md`, borrador en el commit `5f73c65`), dos
críticos lo revisan cada uno en su persona y el diseñador corrige. Abajo, las dos críticas tal cual y la
tabla de cambios aplicados. Las críticas se hicieron sobre el borrador, no sobre la versión final.

---

## Crítica 1 — Fan de Monkey Island centrado en puzles

> Jugué MI1 y MI2 con el manual de la Pirate Bar en la mano. Me importan tres cosas: que cada puzle tenga una
> lógica que se pueda deducir, que nunca me quede atascado por algo que hice antes, y que la solución me haga
> reír. Leí el borrador entero, puzle a puzle.

**Lo que funciona**

- El giro por fin es coherente, y las pistas repartidas («voice match 87 %», la letra de la hoja de visitas,
  el Pepe firmado por P.Z.) son juego limpio de verdad: el jugador puede adivinarlo un capítulo antes que Dex.
- Gerald y el boli de Mt. Gox son buenos objetos-hilo: aparecen, se olvidan y vuelven con otra función.
- El duelo de FUD tiene pares deducibles por lógica (top/bottom, broken clock/twice a day), no por memoria.
  Que las réplicas que Chad no usa sirvan contra PZ-BOT es muy MI2.
- Dos soluciones para entrar a la piscina (disfraz o pato): bien.

**Problemas (de más a menos grave)**

1. **El duelo se rompe con el motor de hoy.** `ChoicePanel` enseña las opciones bloqueadas con su texto y un
   candado. En un duelo de insultos eso enseña todas las réplicas antes de aprenderlas: el puzle desaparece.
   Lo mismo con DOORIS (la opción «Gerald» con candado es la respuesta) y con el PIN del Ledger («0301»).
   Hace falta que A2.6 **oculte** las opciones cuya condición no se cumple, no que las pinte en gris, o que
   el texto de la opción no sea la respuesta.
2. **Callejón sin salida en el capítulo 3.** Si el jugador acciona el interruptor de emergencia antes de
   engañar a PZ-BOT, «se apagan los servidores» y PZ-BOT con ellos: adiós a su log. Además, en el diagrama el
   log apunta al interruptor sin motivo, y el mapa final solo necesita printout + coordenadas, así que el
   hilo de PZ-BOT (el más importante para la historia) acaba siendo opcional.
3. **Capítulo 5 imposible sin volver al capítulo 4.** Si el jugador ganó a Chad aprendiendo solo R1, R3 y R5,
   le faltan R2, R4 y R6 para el duelo final con PZ-BOT y está en el treatment room, a cinco escenas de la
   piscina. Las fuentes tienen que enseñar de forma que ganar a Chad garantice tener las seis.
4. **Objetos necesarios que se consiguen en capítulos anteriores «de pasada».** La `terminal_key` del cajón
   (cap. 2) solo hace falta en el cap. 5; las gafas 3D (cap. 3, «opcional») hacen falta en el cap. 4; la lata
   (cap. 2, cadena opcional) hace falta como prueba en el cap. 4; el recibo (cap. 2) hace falta en el cap. 3.
   No son callejones (se puede volver), pero obligan a cruzar medio juego sin saber por qué. O se hacen
   necesarios en su capítulo, o hay alternativa local.
5. **Buscar el sobre «abriendo el buzón otra vez»** es examinar dos veces sin motivo: pixel hunting por
   repetición, justo lo que la biblia prohíbe. Y el sobre es necesario en el cap. 2.
6. **Pistas que faltan.** El tablón contra el nido: nada dice que el nido esté fuera de alcance. El sobre en el
   escritorio de Penny: la frase de la pista está solo en una rama de su diálogo; si no la eliges, el puzle
   es adivinar. El recibo para la alfa falsa: nada dice dónde hay papel.
7. **La trampilla VIP rompe el capítulo 2.** Va de la calle al sótano y se salta keycard, cajón y antena; la
   biblia dice «ahorra un paso», pero ahorra el capítulo.
8. **La ficha de sobriedad no se usa.** Satoshi comprueba una flag (`beat_chad`); el objeto es decorado y el
   linter (b) lo marcará como objeto que no sirve.
9. **Capítulo 2 con dos cierres** (keycard y veleta) más un cajón «opcional» que es obligatorio dos capítulos
   después: mejor tres cierres de verdad.
10. Menor: el árbol del duelo con 7 opciones por ronda es mucho para elegir; MI enseña las que sabes, pero
    aquí con 6 aprendidas y un móvil, son demasiadas.

**Veredicto**: buena base, con un callejón real (2), uno casi real (3) y un puzle que el motor estropea (1).
Arregla esos tres y el resto es pulido.

---

## Crítica 2 — Jugador Web3 con poca paciencia

> Tengo tres wallets, un AdrianZERO y diez minutos entre llamadas. Si en dos minutos no ha pasado nada, cierro
> la pestaña. Si el juego me trata como turista cripto, también.

**Lo que funciona**

- Que Patient Zero sea YO con mi historial real es el gancho del juego: lo contaría en Twitter.
- Gerald, «BUY $GERALD» y el boli de Mt. Gox son chistes de dentro, no de turista. Bien.
- Que la wallet no bloquee nada: perfecto, así se lo puedo pasar a un amigo sin wallet.

**Problemas**

1. **Dos minutos.** La apertura (narrativa + tarjeta + llamada de Anon) ya es más de un minuto de leer antes de
   tocar nada. Quiero tocar algo en 30 s y tener un objeto en 2 min. La biblia no lo dice en ningún sitio.
2. **Capítulo 1 de 20–25 minutos para abrir una puerta.** Es mucho para el primer contacto. Que dure 15–20 y
   que se note avance cada pocos minutos (sonido, tic en el diario).
3. **Muros de texto otra vez.** Los nodos actuales de Satoshi y B.O.T. tienen 40–60 palabras, los pósters de la
   clínica son cuatro `say` seguidos, y la biblia no pone límite al diálogo, solo a los LOOK.
4. **No os paséis quitando cripto.** Estoy aquí por la sátira cripto. «Like my portfolio» cansa, vale, pero si
   la pasada de humor deja un juego genérico de detectives, me voy. Decid qué chistes cripto SÍ se quedan.
5. **¿Qué gano por ser holder?** La tabla de §7 es cosmética salvo un atajo. Y encima a los holders les quitáis
   el salto del capítulo 4. Decidme al menos cuándo y cómo me entero de lo que gano (y del badge del
   capítulo), sin que me lo metan con calzador.
6. **El momento wallet.** Si conecto la wallet en el capítulo 5, ya es tarde para pensarlo; tiene que haber un
   aviso antes, que no bloquee, del tipo «conecta para ver TU expediente».
7. **Atascarme.** Si me atasco, me voy. La pista por inactividad genérica («take a closer look at…») no basta;
   Anon tendría que poder darme una pista concreta cuando yo quiera.
8. **Ir y volver.** Volver de la clínica al laboratorio a por un recibo es exactamente cuando cierro la pestaña.
9. **El duelo en móvil**: siete opciones de una línea larga cada una no caben en un móvil en vertical.
10. **Perder el duelo y empezar de cero** está bien en MI; aquí, a la segunda derrota quiero una pista.

**Veredicto**: el giro con mi wallet y los chistes de dentro me tienen. El ritmo de los primeros minutos, los
párrafos largos y el ir y volver me echan.

---

## Cambios aplicados

| # | Crítica | Cambio en `DESIGN_BIBLE.md` |
|---|---|---|
| C1.1 | Opciones bloqueadas enseñan la respuesta | §Convenciones y §4: A2.6 tiene que **ocultar** las opciones con condición no cumplida (no gris); hasta entonces, los textos de opción de DOORIS y del Ledger no son la respuesta («[The name on the vet bill]», «[Gerald's birthday, DDMM]»). El duelo de FUD depende de esa parte de A2.6 (A3.3 ya depende de A2.6 en el plan). Nuevo derivado `A2.6a`. |
| C1.2 | Interruptor antes de PZ-BOT = callejón | Cap. 3 reestructurado: PZ-BOT **bloquea por software** el interruptor de emergencia («SHUTDOWN = MISSED OPPORTUNITIES»); engañarlo con la alfa falsa lo cuelga y libera el interruptor. PZ-BOT corre con SAI y no se apaga con el interruptor (vuelve en el cap. 5). El hilo de PZ-BOT pasa a ser obligatorio. Atajo de QA `interruptor-sin-pzbot`. |
| C1.3 | Faltan réplicas para el duelo final | Las fuentes enseñan por pares: monos izq. R1+R2, monos der. R3+R4, B.O.T. R5+R6. Ganar a Chad (I1, I3, I5) exige las tres fuentes, así que garantiza las seis réplicas para PZ-BOT (I2, I4, I6). El libro pasa a ser pista (resume las tres fuentes). |
| C1.4, C2.8 | Objetos de capítulos anteriores | Nuevo principio: lo necesario en un capítulo se consigue en ese capítulo o el anterior lo obliga a llevar. Al aplicarlo salieron dos casos más que la crítica no vio: el Ledger (cap. 1, opcional, necesario en el cap. 3) pasa a ser el tercer factor de DOORIS («three-factor authentication. For a door.»), y la antena (cap. 2, opcional, necesaria en el cap. 3) tiene alternativa local: el ratón roto del sótano como mayal. `terminal_key` es el tercer cierre de la escotilla (cap. 2) y se vuelve a usar en el cap. 5; las gafas 3D salen junto al alargador bajo el suelo técnico (obligatorio en el cap. 3); la lata de prueba sale de la papelera de la clínica (vale cualquier lata del cap. 2); la alfa falsa se escribe en cualquier papel: el recibo de upstairs o los papeles de la mesa del sótano (alternativa local). |
| C1.5 | Sobre por repetición | Un solo OPEN del buzón da la factura y el sobre. |
| C1.6 | Pistas que faltan | Chimenea: «too high to reach»; Penny da la pista del sobre en la frase obligatoria (al intentar coger el abrigo); PZ-BOT/Dex dicen dónde hay papel. |
| C1.7 | Trampilla VIP salta el capítulo | La trampilla del felpudo pide keycard y terminal_key (lector y cerradura): ahorra solo la veleta y la pizza. |
| C1.8 | Ficha que no sirve | La opción de autorización de Satoshi pide `flag: has_sobriety_chip` (hoy) y su nodo retira la ficha con `removeItem` (A1.9). |
| C1.9 | Cap. 2 con dos cierres | Escotilla con tres cierres: lector (keycard), pestillo (veleta), cerradura (terminal_key). |
| C1.10, C2.9 | Demasiadas opciones | Cada ronda enseña 4 opciones: la buena y 3 réplicas de otros pares (siempre las mismas por ronda), solo las aprendidas (A2.6). Réplicas ≤ 12 palabras. |
| C2.1 | Dos minutos | Nueva §4 «Ritmo»: algo que tocar en ≤ 30 s, primer objeto en ≤ 2 min, llamada de Anon ≤ 3 líneas y se puede saltar; apertura (A3.2) ≤ 20 s. |
| C2.2 | Cap. 1 largo | Objetivo 15–20 min y 3–4 hitos por capítulo con sonido y tic en el diario (A2.9). |
| C2.3 | Muros de texto | §5: nodo de diálogo ≤ 25 palabras, ≤ 3 `say` seguidos fuera de cinemáticas, el lore largo va en una opción «Tell me more». Los pósters de la clínica pasan de 4 `say` a 2. |
| C2.4 | No quitar el cripto | §5: lista de chistes cripto que SÍ se quedan (de dentro, con personaje o callback) y regla de que la sátira cripto es el tono del juego; lo que se va es la fórmula. |
| C2.5, C2.6 | Holder y momento wallet | §7: aviso no bloqueante antes del cap. 5 (Satoshi y Anon: «connect to see YOUR file»), badge de capítulo ofrecido al cerrar cada capítulo (opcional), y la rama VIP de Satoshi conserva un perk claro (empezar el duelo en la última ronda). |
| C2.7 | Atascarse | Escalera de 3 pistas por puzle a través de Anon («call Anon» desde el móvil/diario, A2.9); spec en §4 y derivado `A2.9a`. |
| C2.10 | Perder el duelo | A la segunda derrota, Chad suelta una burla que dice qué fuente falta («Even the posh apes have better comebacks, bro.»). |

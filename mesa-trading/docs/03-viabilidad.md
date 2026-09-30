# ¿Puede funcionar de verdad?

Son dos preguntas y tienen respuestas distintas.

## Funcionar como sistema: sí

Esto no es una maqueta. Lee precios reales, sus agentes deciden y se hablan
por un bus de mensajes, pone órdenes de verdad en la cuenta paper de Alpaca
(o en el bróker simulado), controla el riesgo, cuadra con el bróker, se reúne
en comité, aprende de sus operaciones y reparte el capital entre mesas sin que
nadie lo toque. Todo eso está probado: hay pruebas de casos conocidos para
cada cálculo y una demo acelerada que recorre 60 días y comprueba que nada
descuadra.

## Ganar dinero: no hay pruebas de que un sistema así lo consiga

Lo que dicen los datos públicos (fuentes en
`investigacion/viabilidad-fuentes.md`):

- **Alpha Arena** (Nof1, octubre-noviembre de 2025, 10.000 $ reales por
  modelo, cripto con apalancamiento): 4 de 6 modelos perdieron, dos más de la
  mitad del dinero. En la temporada 1.5, con acciones, el conjunto perdió cerca
  de un tercio y solo 6 de 32 ejecuciones ganaron. Su fundador lo dice claro:
  un LLM solo no gana dinero.
- **Los papers que presumen de Sharpe 5 a 8** (TradingAgents, FinMem) miden
  tres meses, pocas acciones y sin costes. Reproducidos en 20 años, no baten a
  comprar y mantener (FINSABER, 2026).
- **Las mejoras automáticas se evaporan:** la mejor estrategia encontrada por
  un agente tras 102 intentos pasó de Sharpe 1,69 a 0,18 con datos nuevos.
- **Los vídeos virales enseñan decoración.** En el primero, el fondo tiene 0
  posiciones y el patrimonio no se ha movido. El segundo enseña 15.216 $ sin
  decir con cuánto empezó ni compararlo con nada. La oficina en pixel art es
  una plantilla que se pone encima de cualquier cosa.

## Lo que ha salido con nuestras estrategias y datos reales

Velas reales de Alpaca del 1 de enero de 2021 al 29 de septiembre de 2026, con
comisión de Alpaca (0,25 %), deslizamiento y una penalización extra de papel
del 0,1 %. Cada mesa se simula con el 25 % del fondo y los límites de riesgo
activos, con el riesgo por operación del 1 % decidido el 30 de septiembre
(`node scripts/probar-backtest.js --real`; con `--usar-cache` repite las
cifras sin red). Comprar y mantener es el mismo universo a partes iguales
desde la misma fecha y con los mismos costes. Momentum va con BTC, ETH y SOL,
las tres con histórico; en vivo rota entre seis cripto.

| Mesa | Rentabilidad | Sharpe | Caída máx. | Comprar y mantener: rentabilidad / Sharpe / caída |
|---|---|---|---|---|
| Momentum cripto | +290 % | **0,91** | 40 % | +167 % / 0,63 / 95 % |
| Ruptura Donchian | +98 % | **0,65** | 39 % | +207 % / 0,66 / 95 % |
| Tendencia SMA 4H (la del vídeo) | −42 % | −0,53 | 55 % | +121 % / 0,58 / 95 % |
| Reversión RSI cripto | −16 % | −0,36 | 20 % | +114 % / 0,54 / 77 % |

Cómo leerlo:

- **Son cifras de cada mesa sobre su propio capital.** El fondo entero lleva
  además mucho efectivo: con Momentum al 40 % y las demás en prueba al 2 %,
  el backtest da un 6,5 % anual, Sharpe 0,72 y una caída máxima del 12,2 %;
  con la protección de la mitad de tamaño al −10 % (aproximada), 5,3 %, 0,62
  y 12,0 % (`node scripts/estudiar-limites.js`, tabla 5; más en
  `04-riesgo-y-mejora.md`).
- **En dinero, solo momentum supera a comprar y mantener** en estos cinco
  años, que han sido muy alcistas para la cripto: +290 % frente a +167 %, con
  menos de la mitad de su caída (40 % frente a 95 %). Ruptura hace +98 %
  frente a +207 %. Pasan buena parte del tiempo en liquidez.
- **Ajustado por riesgo, solo momentum mejora a comprar y mantener** (Sharpe
  0,91 frente a 0,63). Ruptura se queda justo por debajo (0,65 frente a 0,66).
  Esa es toda la ventaja posible, y es modesta.
- **La estrategia del vídeo pierde por costes:** hace 539 operaciones y se
  deja 4.423 $ en comisiones sobre 10.000 $. Sin costes (ni comisión, ni
  deslizamiento, ni penalización) ganaría un 62 %; con ellos pierde un 42 %.
  Las columnas «comisiones» y «sin costes» del script lo enseñan para cada mesa.
- **Fuera de muestra**, validando con datos que la estrategia no vio al
  diseñarse, ninguna mesa pasa el listón estadístico del laboratorio (Sharpe
  deflactado ≥ 0,90; la mejor, ruptura, saca 0,58, y momentum 0,31).
  Traducido: no hay pruebas suficientes de que ninguna tenga ventaja real.
- **El hueco de SOL.** Alpaca no tiene cotizaciones de SOL del 6 de julio de
  2023 al 26 de agosto de 2024. La primera vela de vuelta abre a 18,14 $, el
  precio de julio de 2023, y cierra a 157,25 $. Antes, una orden decidida
  antes del hueco se llenaba a esa apertura y multiplicaba por más de ocho
  con un precio que no existió: de ahí salía buena parte del +196 % de ruptura. Ahora el
  backtest vende lo que tenga abierto de SOL al último cierre anterior al
  hueco, no compra a la apertura de vuelta y no decide hasta recalentar los
  indicadores. Comprar y mantener se mide igual: vende antes del hueco y
  vuelve a comprar en la segunda vela de después. Así deja fuera la subida
  real de SOL durante esos 13 meses (de 20 $ a 157 $), que ninguna mesa puede
  operar sin datos; antes solo la sumaba comprar y mantener, que salía entre
  +734 % y +1.252 %.

Por eso, desde el 30 de septiembre de 2026, **Momentum es la única titular**
y todas las demás arrancan en incubación, con el 2 % y la obligación de
ganarse el puesto en papel:

- Tendencia y Reversión pierden con costes.
- Ruptura gana sola, pero no diversifica: en el fondo, su correlación diaria
  con Momentum es 0,80. Momentum sola (40 %) da Sharpe 0,72 y caída 11,2 %;
  con Ruptura al lado (40 % y 40 %), 0,58 y 26,0 %. Añade caída sin añadir
  rentabilidad por riesgo (`node scripts/estudiar-limites.js`, tabla 3).
- Las de ETF (con claves de Alpaca) no se pueden validar: sin claves no hay
  datos de ETF (Stooq pide JavaScript y Yahoo responde 429).

El capital que no se reparte, un 54 % sin claves, queda en efectivo: mejor
eso que capital en estrategias que no han probado ventaja.

## ¿Aporta algo la IA?

Está por ver, y el sistema lo mide solo. La cartera sombra **«mismas mesas sin
comité»** opera exactamente igual pero sin ninguna decisión de Claude. Si
después de meses el fondo no la bate, la IA solo pone la voz y cuesta dinero.
El panel enseña las dos curvas.

## Qué habría que ver antes de pensar en dinero real

Los criterios ya están fijados (30 de septiembre de 2026) y el panel los
calcula solo: botón Resultados, «¿Listo para dinero real?». Todos a la vez:

1. 180 días o más en papel.
2. 100 operaciones cerradas o más.
3. Sharpe del fondo desde el arranque de 0,7 o más.
4. Ese Sharpe, igual o mejor que el de comprar y mantener BTC y la cesta
   cripto (con claves, también SPY) en el mismo periodo.
5. Caída máxima del 20 % o menos.
6. Ningún incidente en 90 días: kill switch, conciliación grave, orden
   duplicada o huérfana, o error en un departamento.
7. Gasto en IA por debajo del 10 % del beneficio neto.

Si el fondo no bate a «mismas mesas sin comité», se recomienda pasar a real
sin comité. El detalle y el porqué de cada uno, en `05-paso-a-real.md`.

**Aviso estadístico:** con un año de datos, el margen de error del Sharpe es
de ±1. Para demostrar con un 95 % de confianza que un Sharpe de 1 es real
hacen falta unos 4 años. La cuenta paper sirve para filtrar y matar ideas
rápido, no para demostrar que hay ventaja.

El semáforo no activa nada. Si algún día se pasa a real, lo decides tú por
escrito, hace falta un cambio de código a propósito y el primer tramo es una
cantidad que se pueda perder entera (como mucho 2.000 €), con 3 meses
comparando las ejecuciones reales con las de papel.

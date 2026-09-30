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
activos (`node scripts/probar-backtest.js --real`). Comprar y mantener es el
mismo universo a partes iguales desde la misma fecha y con los mismos costes.

| Mesa | Rentabilidad | Sharpe | Caída máx. | Comprar y mantener: rentabilidad / Sharpe / caída |
|---|---|---|---|---|
| Momentum cripto | +120 % | **0,83** | 28 % | +167 % / 0,63 / 95 % |
| Ruptura Donchian | +88 % | **0,64** | 36 % | +207 % / 0,66 / 95 % |
| Tendencia SMA 4H (la del vídeo) | −41 % | −0,52 | 55 % | +121 % / 0,58 / 95 % |
| Reversión RSI cripto | −10 % | −0,42 | 12 % | +114 % / 0,54 / 77 % |

Cómo leerlo:

- **En dinero, ninguna mesa llega a comprar y mantener** en estos cinco
  años, que han sido muy alcistas para la cripto: momentum hace +120 % frente
  a +167 %, y ruptura +88 % frente a +207 %. Pasan la mayor parte del tiempo
  en liquidez.
- **Ajustado por riesgo, solo momentum mejora a comprar y mantener** (Sharpe
  0,83 frente a 0,63) y con menos de un tercio de su caída (28 % frente a
  95 %). Ruptura se queda justo por debajo (0,64 frente a 0,66), con algo más
  de un tercio de la caída (36 % frente a 95 %). Esa es toda la ventaja
  posible, y es modesta.
- **La estrategia del vídeo pierde por costes:** hace 539 operaciones y se
  deja 4.434 $ en comisiones sobre 10.000 $. Sin costes (ni comisión, ni
  deslizamiento, ni penalización) ganaría un 63 %; con ellos pierde un 41 %.
- **Fuera de muestra**, validando con datos que la estrategia no vio al
  diseñarse, ninguna mesa pasa el listón estadístico del laboratorio (Sharpe
  deflactado ≥ 0,90; la mejor saca 0,54). Traducido: no hay pruebas
  suficientes de que ninguna tenga ventaja real.
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

Por eso Tendencia y Reversión arrancan en incubación con el 2 % y no como
titulares. Que Ruptura siga de titular con un Sharpe por debajo del de
comprar y mantener lo decides tú.

## ¿Aporta algo la IA?

Está por ver, y el sistema lo mide solo. La cartera sombra **«mismas mesas sin
comité»** opera exactamente igual pero sin ninguna decisión de Claude. Si
después de meses el fondo no la bate, la IA solo pone la voz y cuesta dinero.
El panel enseña las dos curvas.

## Qué habría que ver antes de pensar en dinero real

Los umbrales los tienes que fijar tú por escrito **antes** de empezar (son
reglas de negocio, no se inventan aquí). Como referencia, lo que proponen las
fuentes:

1. **Semanas 1 a 6 (funciona técnicamente):** cada día cuadran posiciones y
   caja con Alpaca; ninguna orden duplicada ni huérfana; kill switch probado;
   coste de Claude por debajo del tope.
2. **Mínimo 6 meses, mejor 12 (gana dinero):** más de 100 operaciones cerradas;
   bate en neto a comprar y mantener con la misma exposición **y** a «mismas
   mesas sin comité»; caída máxima dentro de tu límite; que el resultado no
   dependa de 2 operaciones.
3. **Aviso estadístico:** con un año de datos, el margen de error del Sharpe es
   de ±1. Para demostrar con un 95 % de confianza que un Sharpe de 1 es real
   hacen falta unos 4 años. La cuenta paper sirve para filtrar y matar ideas
   rápido, no para demostrar que hay ventaja.

Y si algún día se pasa a real: una cantidad que se pueda perder entera, y 1 a
3 meses comparando ejecuciones reales con las de papel.

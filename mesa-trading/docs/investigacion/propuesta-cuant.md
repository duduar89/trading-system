# Propuesta: rigor cuantitativo para la mesa de agentes (fondo en papel de 100.000 $)

## 0. Resumen: ¿puede funcionar de verdad?

Hay dos preguntas distintas y tienen respuestas distintas.

- **Como sistema, sí.** Un proceso Node puede leer datos, generar señales, operar en la cuenta paper de Alpaca, medirse, repartir capital y retirar lo que no funciona sin que nadie lo toque. Todo eso es ingeniería conocida.
- **Como fuente de dinero, no se sabe, y en meses no se va a saber.** El error típico de un Sharpe anual estimado es de unos √((1+SR²/2)/años). Con un año de datos, un Sharpe real de 1 no se distingue de 0 (error de ±1,2). Por eso «ir mejorando» no puede significar «el P&L de esta semana ha subido». Tiene que ser un proceso con reglas y contraste estadístico (sección 7).

**Idea central:** los agentes hablan, explican y proponen. **Las operaciones, los tamaños y el reparto de capital los decide código determinista.** El LLM nunca produce una cifra de negocio.

## 1. Universo, datos y reloj

| Bloque | Activos | Marco | Fuente |
|---|---|---|---|
| Cripto | BTC, ETH, SOL, y LTC, LINK, AVAX y DOGE si están en la lista de Alpaca | 4H y 1D | `v1beta3/crypto/us/bars` (sin clave), `timeframe=4Hour` / `1Day` |
| ETF macro (con claves) | SPY, QQQ, IWM, TLT, GLD | 1D | barras de acciones de Alpaca |

- **Solo se opera lo que Alpaca da como negociable** (`GET /v2/assets?asset_class=crypto`, campo `tradable`). ADA o TAO, que salen en el vídeo, puede que no estén. Si no aparecen, no hay mesa.
- **Sin cortos en cripto** (Alpaca no los permite) y **sin apalancamiento**. Todo es largo o en liquidez.
- **Reloj.** Las mesas 4H evalúan 5 minutos después del cierre de cada vela (00:05, 04:05… UTC). Las mesas 1D a las 00:10 UTC. Los ETF emiten la señal al cierre y ejecutan en la apertura siguiente con `time_in_force=opg`.
- **Datos viejos, cero operaciones.** Si la última barra tiene más de 2× el marco de antigüedad, la mesa no opera y lo dice.
- **Tamaños mínimos.** Las cantidades se redondean a `min_order_size` y `min_trade_increment` de cada activo.

## 2. Departamentos y agentes

| Departamento | Agente | Qué decide (con código) | Qué dice (LLM o plantilla) |
|---|---|---|---|
| Macro | **Régimen** | Multiplicador de exposición (sección 4) | «RISK-ON: BTC sobre la media de 200 días, volatilidad normal» |
| Mesas | **Mesa BTC, Mesa ETH…** (una por activo) | Señal de la estrategia asignada, entrada, stop, salida | «Sin posición en SOL, esperando el cruce 20/100 en 4H» |
| Riesgo | **Jefa de Riesgo** | Veto sobre cualquier orden; límites; kill switch | Explica cada veto con la regla que lo dispara |
| Tesorería | **Tesorero** | Reparto mensual de capital entre mesas | Resume quién gana peso y por qué |
| Ejecución | **Operador** | Envío de órdenes, conciliación con el bróker, deslizamiento medido | «Llenado a 0,08 % del precio de la señal» |
| Control | **Controller** | Todas las métricas y la conciliación del patrimonio con el bróker | Informe diario |
| I+D | **Investigador** + **Auditor** | El Investigador propone hipótesis cerradas; el Auditor corre el laboratorio | «Candidata RUPT-DON 40/20 en ETH: suspende por costes ×2» |
| Comité | (reunión) | Solo aplica lo que ya dictan las reglas | Acta en lenguaje natural |

«Hablar entre ellos» es un bus de mensajes con **hechos tipados**: señal, veto, llenado, cambio de peso, veredicto del laboratorio. El texto se genera a partir de esos hechos. Un agente nunca pasa a otro un número escrito en prosa.

## 3. Catálogo cerrado de estrategias (por mesa)

Son cuatro familias, todas documentadas en la literatura y todas de largo o fuera. Solo se pueden usar los parámetros de esta rejilla; nada es continuo.

| Código | Marco | Entrada | Salida | Por defecto | Rejilla del laboratorio |
|---|---|---|---|---|---|
| **TEND-SMA** | 4H | SMA20 > SMA100 (4H) y cierre 1D > SMA200 (1D) | cruce a la baja o stop a 3×ATR14 | 20/100/200 | rápida {10, 20, 30}, lenta {50, 100, 150} |
| **RUPT-DON** | 1D | cierre por encima del máximo de 20 días | cierre por debajo del mínimo de 10 días o stop a 2×ATR20 | 20/10 | entrada {20, 40, 55}, salida {10, 20} |
| **MOM-TS** | 1D, se revisa los lunes | retorno de 90 días > 0 | retorno ≤ 0 en la revisión | 90 días; volatilidad objetivo 40 % (cripto) / 15 % (ETF) | periodo {30, 60, 90, 180} |
| **REV-RSI2** | 1D, solo ETF | RSI(2) < 10 y cierre > SMA200 | RSI(2) > 70 o 5 días | 10/70/5 | umbral {5, 10, 15} |

**Asignación inicial:** TEND-SMA en BTC, ETH y SOL; MOM-TS en todo el bloque cripto y en los ETF; RUPT-DON en BTC y ETH; REV-RSI2 en SPY y QQQ. Cada pareja activo × estrategia es un **«setup»**, que es la tarjeta de la imagen 2.

**Ejecución modelada (igual en el backtest, en el bróker simulado y en el control del bróker real):**
- La señal se calcula al cierre de la vela y la orden se llena en la apertura de la siguiente. Nunca en la misma vela.
- **Costes cripto por defecto: 25 pb de comisión y 10 pb de deslizamiento por lado.** Hay que confirmar la comisión en la tabla de tarifas vigente de Alpaca; si ha cambiado, se usa la real.
- **Costes ETF: 0 de comisión y 5 pb de deslizamiento.**

## 4. Tamaño y riesgo (Jefa de Riesgo, determinista)

**Tamaño por operación**

- **Para las estrategias con stop:** unidades = (1 % del capital de la mesa) / (k × ATR). Con mesas de 5.000 a 15.000 $, eso supone arriesgar del 0,05 % al 0,15 % del patrimonio por operación.
- **MOM-TS:** nocional = capital de la mesa × volatilidad objetivo / volatilidad realizada de 30 días, con tope de 1×.

**Límites**

| Límite | Valor por defecto | Qué pasa |
|---|---|---|
| Exposición bruta total | ≤ 100 % del patrimonio | Sin apalancamiento, aunque la cuenta paper lo permita |
| Por activo | ≤ 20 % (BTC, ETH, ETF); ≤ 10 % (altcoins) | Veto de la orden |
| Grupo cripto | ≤ 60 % del patrimonio | Todas las cripto van correlacionadas al 0,7–0,9: ocho mesas cripto son una o dos apuestas, no ocho |
| Reserva de liquidez | ≥ 10 % | — |
| Pérdida del día | −3 % | No se abren posiciones nuevas hasta las 00:00 UTC |
| Caída desde máximos del fondo | −10 % | Todos los tamaños a la mitad |
| Caída desde máximos del fondo | −20 % | Kill switch automático: todo a liquidez y se queda así hasta que Eduardo pulsa «Reabrir» |
| Caída de una mesa | −15 % de su asignación | La mesa pasa al banquillo (sigue en sombra, sin capital) |

**Régimen (Macro).** Hay dos condiciones: BTC por encima de su SMA200 diaria, y volatilidad de 30 días ≤ 1,5× su mediana de 365 días.
- Si se cumplen las dos: **RISK-ON**, multiplicador 1,0.
- Si falla una: **NEUTRAL**, multiplicador 0,6.
- Si fallan las dos: **RISK-OFF**, multiplicador 0,3.

El Fear & Greed se enseña, pero **no entra en la fórmula hasta que pase el laboratorio**. Se puede validar porque `api.alternative.me/fng/?limit=0` devuelve todo el histórico. El propio filtro de régimen también es una hipótesis: se compara en el laboratorio con y sin él.

## 5. Cómo reparte capital el Tesorero

Hay tres ideas: base de paridad de riesgo, inclinación contraída hacia la media y exploración fija.

1. **Base.** El peso de cada mesa es proporcional a 1 / volatilidad de 60 días de sus rendimientos diarios. Si la mesa es nueva, se usa la volatilidad del activo.
2. **Sharpe contraído.** Se mezcla el Sharpe real de la mesa con uno de partida, y el real pesa más cuantas más operaciones acumula:
   - S̃ = (n·S_real + n₀·S_previo) / (n + n₀), con **n₀ = 30 operaciones**.
   - S_previo = **0,5 × el Sharpe fuera de muestra del laboratorio** (se descuenta la mitad por optimismo del backtest).
3. **Inclinación.** m = limitar(1 + 0,5·(S̃ − media de S̃), entre 0,5 y 1,5). Una mesa con menos de 30 operaciones o menos de 90 días se queda con m = 1: no se mueve de la base.
4. **Topes.** Se normaliza y se aplican los topes de riesgo. Cada mesa puede cambiar como mucho **±5 puntos del patrimonio por reasignación**.
5. **Cadencia.** Una vez al mes, el día 1 a las 00:30 UTC. El comité puede reunirse cada día para contar cosas, pero los pesos solo cambian una vez al mes.
6. **Exploración.** Un **5 % fijo del patrimonio** para la incubadora, repartido a partes iguales entre las candidatas e independiente de cómo vayan. Así una estrategia nueva no depende de que el Tesorero la «descubra».

**Por qué no Kelly ni bandits:** con 30 a 100 operaciones y mercados que cambian, la ventaja estimada tiene más ruido que señal. Kelly con una ventaja mal estimada sobreapuesta de forma sistemática.

## 6. Laboratorio: cómo entra una estrategia nueva

El **Investigador** (LLM, si hay clave) solo puede proponer una ficha cerrada: familia del catálogo, activo, marco y subrejilla. No escribe reglas nuevas. Cada propuesta suma 1 al **contador de pruebas**, que se guarda y no se reinicia nunca.

**Etapas**

1. **Datos.** Todo el histórico que devuelva la API. Se anota la fecha de la primera barra: no se da por supuesta.
2. **Walk-forward anclado.**
   - En 1D se optimiza con 24 meses y se prueba con los 6 siguientes, avanzando de 6 en 6.
   - En 4H se optimiza con 12 meses y se prueba con 3.
   - En cada ventana se elige el parámetro con **mejor media de sus vecinos en la rejilla** (el centro de una meseta), no el pico aislado.
3. **Reserva final.** Los últimos 6 meses no se tocan hasta el examen final, y cada candidata solo se examina una vez.
4. **Criterios de aprobado.** Tienen que cumplirse todos:
   - Sharpe neto fuera de muestra concatenado ≥ 0,5, y ≥ 0,2 con los costes duplicados.
   - Al menos 30 operaciones fuera de muestra, y al menos el 50 % de las ventanas en positivo.
   - Caída máxima fuera de muestra ≤ 25 %.
   - Los vecinos de la rejilla conservan al menos el 70 % del Sharpe elegido.
   - **Supera el percentil 90 de 1.000 estrategias de entrada aleatoria** con la misma exposición y duración media.
   - **Deflated Sharpe ≥ 0,90**, calculado con el contador de pruebas acumulado.
   - Correlación con el fondo actual < 0,6, o Sharpe claramente mejor que comprar y mantener el activo.
5. **Sombra, 30 días.** Opera en virtual con los datos en vivo. Tiene que emitir las mismas señales que el backtest en esas fechas; si difiere más de un 5 %, hay un error de datos o de código.
6. **Incubadora, 60 días o 20 operaciones.** Opera con capital real de la cuenta paper, pero al 0,25× del tamaño.
7. **Promoción** a mesa normal. El Tesorero la trata con n₀ = 30.
8. **Retirada.** Una mesa se retira si pasa cualquiera de estas cosas:
   - S̃ < 0 después de 60 operaciones.
   - Su caída supera 1,5× la peor caída fuera de muestra.
   - El deslizamiento real supera 2× el modelado durante un mes.

   Una mesa retirada sigue en sombra 90 días, por si la retirada fue un error.

## 7. Cómo «mejora» el sistema de forma medible

El sistema solo puede cambiar cuatro cosas, y cada cambio queda en un **diario de decisiones**. Cada entrada guarda el antes, el después, la evidencia y la fecha de revisión.

1. **Pesos entre mesas:** mensual (sección 5).
2. **Entradas y salidas del catálogo:** las etapas de la sección 6.
3. **Reoptimización trimestral** con walk-forward. El parámetro nuevo solo sustituye al vigente si mejora el Sharpe fuera de muestra en **más de 0,2** y es estable con sus vecinos. Si no, gana la inercia.
4. **Umbrales de riesgo:** solo los cambia Eduardo.

**Cada cambio es un experimento campeón contra aspirante.** La configuración que sale del juego sigue 90 días en sombra, y el Controller compara las dos.

Cada trimestre sale un **informe de mejoras**: cuántos cambios ayudaron, con su intervalo de confianza. Si ayudan menos de la mitad, el proceso de mejora está persiguiendo ruido y se baja su frecuencia. Esto es «mejorar» medido de forma honesta.

**Panel de salud** (lo calcula el Controller; nada viene del LLM):
- Patrimonio frente a tres referencias: BTC comprar y mantener, cripto a partes iguales, y liquidez.
- Sharpe de 90 días con su banda de error.
- Caída máxima, costes pagados y rotación.
- Desviación entre el laboratorio y lo real.

**Tarjeta de setup (imagen 2), con definiciones fijas**
- **Acierto** = operaciones ganadoras / operaciones cerradas.
- **Factor** = beneficio bruto / pérdida bruta.
- **Adherencia** = señales ejecutadas en su vela con un tamaño dentro de ±10 %. Los vetos de Riesgo se cuentan aparte.
- Con menos de 20 operaciones cerradas, la tarjeta dice «muestra insuficiente (n = 7)» en vez de un porcentaje.

## 8. APIs necesarias

| API | Clave | Para qué |
|---|---|---|
| Alpaca Market Data, barras cripto | No | Señales e histórico del laboratorio |
| Alpaca Trading paper (`paper-api.alpaca.markets`) | Key + secret gratis | Cuenta, activos, órdenes, posiciones, actividades (llenados con comisión real) |
| Alpaca, barras de acciones y noticias | La misma | Mesas de ETF. Las noticias solo como narración en la versión 1 |
| alternative.me Fear & Greed | No | Indicador y su histórico para el laboratorio |
| Anthropic | Opcional | Texto de los agentes y propuestas del Investigador, con tope diario |

**Sin claves:** un bróker simulado con 100.000 $ y **exactamente el mismo modelo de costes**. Aviso honesto: en ese modo la ejecución no se valida contra nada externo, porque el simulador se cree sus propios supuestos.

## Riesgos de que esto no funcione

1. **Muestra insuficiente.** Meses de papel no prueban nada. El riesgo es que Eduardo, o el propio sistema, saque conclusiones de 20 operaciones.
2. **Falsa diversificación.** Casi todo el riesgo es beta de BTC. En una caída general de cripto, todas las mesas pierden a la vez. Sin claves para los ETF, el fondo es un solo factor.
3. **El papel es optimista.** No hay impacto de mercado y los llenados son ideales. Además, la comisión cripto de Alpaca es alta para estrategias rápidas: ahí se mueren las de mucha rotación.
4. **Un portátil Windows no es un servidor.** Suspensiones, actualizaciones y wifi hacen que se pierdan velas y stops, y la cripto cotiza 24/7. Hace falta conciliar al arrancar y, cuando el tipo de orden lo permita, poner la protección en el propio bróker.
5. **Sobreajuste por la puerta de atrás.** Un Investigador incansable prueba cientos de variantes, y alguna pasa por suerte. Lo mitigan el contador de pruebas y el Deflated Sharpe, pero no lo eliminan.
6. **Regímenes laterales.** Las estrategias de tendencia sangran durante meses y las reglas pueden retirarlas justo antes de que vuelvan a funcionar. La contracción y el banquillo en sombra lo suavizan.
7. **Narrativa persuasiva.** Un agente que «explica» con seguridad puede hacer creer que hay inteligencia donde solo hay una media móvil. La interfaz debe dejar claro que el texto describe decisiones: no las toma.

## Lo que NO haría

- Dejar que un LLM decida operaciones, tamaños, stops, pesos o parámetros, ni que reescriba reglas «con lo aprendido».
- Scalping, velas de menos de 1 hora o websockets: no hacen falta y la comisión se lo come.
- Reasignar capital a diario, usar Kelly completo o perseguir la mesa ganadora de la semana.
- Cortos, apalancamiento o margen, aunque la cuenta paper lo permita.
- Usar Fear & Greed, noticias o sentimiento como gatillo sin pasar el laboratorio.
- Medir la mejora por el P&L semanal, o presumir de un Sharpe sin su banda de error.
- Pasar a dinero real antes de 12 meses de papel que cumplan los criterios fuera de muestra, y nunca sin que Eduardo lo decida.

Referencia: `/home/user/trading-system/mesa-trading/` todavía está en andamiaje (`src/config.js`, `src/util/`, `docs/` vacío). Esta propuesta no choca con nada de lo que hay.
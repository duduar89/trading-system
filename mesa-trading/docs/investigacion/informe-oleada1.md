================= A-cuant pruebas: {"comando":"cd /home/user/trading-system/mesa-trading && node --test test/cuant-*.test.js   (y además: node scripts/probar-indicadores.js ; node scripts/probar-backtest.js ; NODE_USE_ENV_PROXY=1 node scripts/probar-backtest.js --real — todos salen con código 0)","pasan":91,"fallan":0}
--- DESVIACIONES
1. He creado src/estrategias/comun.js con ayudas compartidas. Está dentro de mi propiedad (src/estrategias/*.js), pero no aparecía en la lista explícita del encargo.
2. Las estrategias exportan extras: marco, dominio (valores cerrados que el laboratorio puede fijar), vecinoMasLento y describir. momentum-rotacion tiene dos perfiles y el contrato solo prevé un parametrosPorDefecto y una rejilla, así que exporta además parametrosEtf, rejillaEtf, parametrosPara(simbolos) y rejillaPara(simbolos). La mesa momentum-etf se crea con params.perfil = 'etf'.
3. decidir() acepta un campo extra `textos: false` que deja vacíos motivo y estado. Lo usa el backtest porque formatear con Intl en cada vela era el cuello de botella; la acción y el stop son idénticos.
4. tendencia-sma abre solo en la vela en que la condición completa (rápida > lenta Y cierre > SMA filtro) pasa a cumplirse, no mientras se cumple. Así no vuelve a entrar en la misma tendencia tras un stop. Cierra cuando la rápida queda por debajo de la lenta. El trailing es chandelier: máximo de cierres desde la entrada − atrStop·ATR, y solo sube.
5. ruptura-donchian: el máximo previo se toma sobre los altos y el mínimo previo sobre los bajos (canal clásico), de las velas anteriores a i. Ni ruptura, ni reversión, ni momentum tienen trailing: trailing() devuelve null.
6. momentum-rotacion, ambigüedades del contrato:
  - Rebalanceo semanal: se decide al cierre de la vela del domingo (termina el lunes 00:00 UTC) y se ejecuta el lunes.
  - Rebalanceo mensual: se decide al cierre de la primera sesión del mes; no hace falta calendario de festivos.
  - Puntuación cripto: rentabilidad 28 d / volatilidad 28 d.
  - Puntuación ETF: media de las rentabilidades a 63, 126 y 252.
  - «Solo si rentabilidad > 0» se aplica también a los ETF (soloPositivos: true); el contrato solo lo dice para cripto.
7. Filtro vol-max: el percentil de la volatilidad 30 d se calcula en una ventana móvil de 365 días, no sobre toda la historia. Con toda la historia, en vivo (300-500 velas) daría un valor distinto que en el laboratorio. Lo calcula la propia estrategia sobre su símbolo e ignora contexto.volPercentil: el contexto(t) del contrato no recibe el símbolo. Sin dato (percentil o F&G a null), el filtro deja pasar.
8. backtest acepta extras opcionales:
  - desde/hasta (ms): opera en un tramo y usa el histórico anterior para calentar.
  - prep: preparado ya calculado.
  - pesoMesa (por defecto 1): los límites del fondo se aplican sobre patrimonio = capital / pesoMesa.
  - volObjetivo.
  Devuelve además params, metricas.exposicionMedia y operacion.stop. Llama a contexto(t + marco), es decir, en el instante del cierre.
9. Modelo de ejecución del motor (el contrato no lo detalla):
  - Las compras van por nocional, con la comisión cobrada en el activo, como en Alpaca.
  - Las ventas cobran la comisión en dólares.
  - Deslizamiento y penalización de papel empeoran el precio en los dos lados.
  - Lo que queda abierto al final se liquida al último cierre con costes (motivoSalida 'fin'), y el último punto de la curva es el efectivo. Así Σ pnl = patrimonio final − capital, y hay prueba de ello.
  - El stop puede saltar en la misma vela de entrada. Si la apertura siguiente ya está bajo el stop, se entra y se sale en la apertura: es lo que haría el vivo.
10. Métricas:
  - Sharpe y Sortino son null cuando no se pueden calcular (curva plana); no se inventa un 0.
  - maxDD es una fracción positiva.
  - expectativa va en $ por operación.
  - exposicion es la fracción del tiempo con alguna operación abierta.
  - El primer retorno diario se mide contra el primer punto de la curva.
  - La curtosis es la de Pearson (una normal da 3).
  - Con menos de 2 ensayos, SR0 = 0.
11. walkForward:
  - Ventanas móviles contadas hacia atrás desde la última vela, para que el tramo más reciente siempre se pruebe.
  - Los indicadores se preparan una vez por combinación sobre todo el histórico.
  - La curva OOS se encadena: cada ventana empieza plana con el patrimonio con que acabó la anterior, y lo abierto se liquida al final de cada ventana.
  - Si ninguna combinación llega a 5 operaciones, se elige la de mejor Sharpe y se marca seleccion 'sin-minimo-operaciones'.
  - sharpesEnsayos es el Sharpe ANUALIZADO de cada combinación fija sobre todo el tramo OOS (null cuenta como 0).
  - Extras: fijos, pesoMesa, capital y walkForwardAsync.
12. Laboratorio:
  - Una hipótesis puede llevar el campo opcional h.params, con valores fijados dentro del dominio de la familia: sin él no se pueden expresar «atrStop + 0,5» ni «vecino más lento». Lleva también el extra h.mesaId.
  - El DSR usa el Sharpe diario de la curva OOS, con N = ensayosPrevios + combinaciones y V = var(sharpesEnsayos)/periodosAnio.
  - Sin maxDDReferencia, la referencia es comprar y mantener el mismo universo en el tramo OOS.
  - La correlación exige al menos 20 días comunes.
  - Exploración: como mucho 1 hipótesis por semana si queda hueco; añade a una mesa un filtro del catálogo elegido de forma determinista por la semana. El contrato menciona origen 'exploracion' pero no cómo se genera.
  - evaluarHipotesis devuelve además ensayos, sharpeUmbral y paramsFinales (los params de la última ventana).
13. «Vecino más lento» según la familia:
  - tendencia: las dos medias suben al siguiente valor de la rejilla.
  - ruptura: el canal de entrada sube.
  - momentum: el siguiente juego de lookbacks con media mayor.
  - reversión: umbral más exigente (10 → 5), es decir, menos señales y más extremas.
14. Rejillas elegidas (el contrato solo fija ≤ 30):
  - tendencia: 24 combinaciones (rápida {5,7,10,14} × lenta {25,40,60} × atrStop {2,5; 3,5}).
  - ruptura: 16.
  - reversión: 18.
  - momentum: 15 en cripto y 12 en ETF.
  - Dominio de atrStop: de 1 a 5 en pasos de 0,5.
15. Régimen: un componente sin datos suficientes (menos de 200 velas, o SPY ausente) suma 0 y el detalle lo dice. detalle es un texto con las cifras; se añaden componentes[] y t.
--- PENDIENTES
- F: en vivo, llamar a preparar() con al menos velasNecesarias(mesa) velas (exportada en src/estrategias/index.js). Con ese número, la decisión y el stop del último índice coinciden con el backtest (el ATR difiere en menos de 2·10⁻⁸). Mínimos:
  - tendencia: 411 velas 4H.
  - momentum: 239.
  - reversión: 410.
  - ruptura: 321.
  - Con filtro vol-max: 396 velas diarias o 2.371 velas 4H.
- F: pasar al laboratorio contextoHistorico(t) → {regimen, fg}. Se puede construir con regimenEnFecha(btcDiario, spyDiario, t) y el histórico diario de miedo y codicia. El motor lo llama con t = cierre de la vela.
- F: decidir con qué pesoMesa se evalúan las hipótesis. Por defecto es 1, lo que da posiciones pequeñas, porque los límites del fondo se aplican sobre el capital de la mesa. Hay que pasar un maxDDReferencia medido de la misma manera: sin él, la referencia de comprar y mantener hace que el criterio de maxDD casi siempre pase.
- B (AlpacaDatos) — dos hallazgos con datos reales:
  1. En 4Hour, /v1beta3/crypto/us/bars devuelve unas 43 velas por página aunque se pida limit=10000 (parece limitado a unas 10.000 barras de 1 minuto por página). Cinco años son unas 300 páginas por símbolo: hay que paginar sin tope bajo y respetar las 180 peticiones/min.
  2. SOL/USD no cotizó en Alpaca del 2023-07-06 al 2024-08-26 (416 velas diarias, 2.503 de 4H). Los indicadores tratan como contiguas las velas a los dos lados del hueco.
- Para Eduardo y el comité: con los valores por defecto del contrato, tendencia-sma 4H (7/25/200) pierde por costes. Sin costes gana +63 %; con costes pierde −41 %. Tuvo 539 operaciones y pagó 4.434 $ de comisiones sobre 10.000 $ (cifras con el motor que trata el hueco de SOL; antes, +66 %, 548 operaciones, 419 por el trailing, y 4.478 $). reversion-rsi en cripto también es negativa. Son las mesas iniciales que dicta el contrato, y cambiarlas es decisión de Eduardo.
- Las dos mesas de ETF (momentum-etf y reversion-etf) no se han podido comprobar con datos reales: hacen falta claves de Alpaca.
- El DSR usa como varianza V solo la dispersión de las combinaciones de la hipótesis actual, no la de todos los ensayos históricos. Para usar la de todos, F tendría que guardar los sharpesEnsayos de cada evaluación junto al contador.
--- NOTAS
PRIMERA COMPROBACIÓN HONESTA CON DATOS REALES
(NODE_USE_ENV_PROXY=1 node scripts/probar-backtest.js --real)

Datos: velas diarias y de 4H de BTC, ETH y SOL desde el 1-ene-2021 hasta el 28/29-sep-2026, de Alpaca, con caché en data/cache/probar/. SOL tiene el hueco que Alpaca no cotizó (2023-07 → 2024-08).

**Corrección del 30-sep-2026.** Las tablas de abajo ya son las del motor que trata ese hueco. La vela de SOL del 26-ago-2024 abre a 18,14 $, el precio de julio de 2023, y cierra a 157,25 $. Antes, una orden decidida antes del hueco se llenaba a esa apertura rancia y multiplicaba por más de ocho: de ahí salía buena parte del +195,7 % (Sharpe 0,67) de ruptura. Ahora lo abierto se vende al último cierre anterior al hueco (motivo «hueco»), no se compra a la apertura de vuelta y el símbolo no decide hasta recalentar. Comprar y mantener se mide igual: vende antes del hueco y vuelve a entrar en la segunda vela de después. Así deja fuera la subida real de SOL durante el hueco (de 20 $ a 157 $), que ninguna mesa puede operar sin datos; con ella salía entre +734 % y +1.252 %. Las otras cifras viejas: momentum 0,79 y tendencia −0,51 con 548 operaciones. Con las nuevas ya no se sostiene que «ruptura empata con comprar y mantener».
Costes: los de §3.4 más la penalización de papel del 0,1 % por lado.
Cada estrategia empieza a contar tras su calentamiento. C&M es comprar y mantener a partes iguales el mismo universo desde la misma fecha, con los mismos costes.

**Tabla 1 — Valores por defecto, como una mesa con el 25 % del fondo (límites del fondo de config.js):**

| Familia | Rent. | CAGR | Sharpe | maxDD | Ops | Expos. | C&M rent. | C&M Sharpe | C&M maxDD |
|---|---|---|---|---|---|---|---|---|---|
| tendencia-sma 4H (BTC/ETH/SOL) | −41,4 % | −9,0 % | −0,52 | 54,5 % | 539 | 15 % | +120,6 % | 0,58 | 94,5 % |
| momentum-rotacion 1D (BTC/ETH/SOL) | +120,2 % | 15,0 % | 0,83 | 27,7 % | 102 | 19 % | +166,7 % | 0,63 | 94,7 % |
| reversion-rsi 1D (BTC/ETH) | −9,7 % | −2,0 % | −0,42 | 12,0 % | 88 | 2 % | +113,9 % | 0,54 | 76,9 % |
| ruptura-donchian 1D (BTC/ETH/SOL) | +87,8 % | 11,7 % | 0,64 | 36,3 % | 83 | 21 % | +207,3 % | 0,66 | 94,8 % |

**Tabla 2 — Calidad de la señal:** la misma estrategia sin límites del fondo, con peso completo por activo.

| Familia | Rent. | Sharpe | maxDD | Factor |
|---|---|---|---|---|
| tendencia | −74,4 % | −0,80 | 82,6 % | 0,72 |
| momentum | +1.489 % | 1,14 | 63,0 % | 1,71 |
| reversión | −19,4 % | −0,20 | 27,8 % | 0,76 |
| ruptura | +283 % | 0,82 | 55,6 % | 1,52 |

**Tabla 3 — Walk-forward fuera de muestra** con la rejilla completa (8 ventanas de 18/6 meses; 7 en reversión):

| Familia | Sharpe OOS | Rent. OOS | maxDD | Ops | Ventanas en positivo | DSR |
|---|---|---|---|---|---|---|
| tendencia | 0,24 | +11,4 % | 22,1 % | 247 | 6/8 | 0,30 |
| momentum | 0,60 | +38,3 % | 24,3 % | 71 | 5/8 | 0,41 |
| reversión | −0,43 | −7,4 % | 10,8 % | 43 | 3/7 | 0,05 |
| ruptura | 0,42 | +25,5 % | 21,2 % | 41 | 4/8 | 0,54 |

LECTURA

- En rentabilidad ninguna familia llega a comprar y mantener en este periodo alcista de la cripto (momentum +120 % frente a +167 %; ruptura +88 % frente a +207 %). Es lo esperable: están invertidas entre el 2 % y el 21 % del tiempo.
- En Sharpe:
  - momentum-rotacion mejora a comprar y mantener (0,83 frente a 0,63) con menos de un tercio de su caída máxima.
  - ruptura queda algo por debajo (0,64 frente a 0,66), con algo más de un tercio de la caída.
  - tendencia 4H y reversión RSI pierden dinero.
- He comprobado que lo de tendencia no es un fallo del motor: sin costes la misma regla gana +63 % (Sharpe 0,63); lo que la mata es la rotación con una comisión del 0,25 %.
- Fuera de muestra NINGUNA familia pasaría el laboratorio: el DSR máximo es 0,54 (ruptura), frente a 0,90 exigido. La evidencia estadística de ventaja es nula o débil, en línea con la advertencia de la propuesta cuant.
- El walk-forward de cada familia con datos reales tarda entre 0,2 y 2,8 s.

VERIFICACIONES DE NORMA DE LA CASA

- **Casos conocidos con el razonamiento escrito en las pruebas:**
  - Cruce SMA2/SMA3 en la vela 6 → entrada en la apertura de la 7 a 9,51425; P&L de 964,4946 $ con 52,48 $ de comisiones.
  - Stop con hueco: sale a 89,865.
  - El trailing vale desde la vela siguiente.
  - normalInv(0,975) = 1,95996398454 (tolerancia 1e-12).
  - DSR a mano = 0,627933. El ejemplo del artículo de Bailey y López de Prado (2014) da 0,90040 (el artículo dice 0,9004).
  - Sharpe y Sortino a mano.
- **Causalidad:** los indicadores, las decisiones y el trailing de las cuatro familias, el régimen y el backtest completo son idénticos sobre N y sobre N+50 velas.
- **Rendimiento:** el walk-forward de las cuatro familias sobre 2.000 velas diarias × 6 símbolos tarda 1,4 s en total (el límite era 30 s).
- **Laboratorio:** tiene prueba del camino positivo (una serie con ventaja fabricada aprueba los 6 criterios) y de los negativos (ruido, correlación 1 con una mesa activa, hipótesis inválida, datos insuficientes).

No he tocado ficheros ajenos, ni he hecho git ni npm install. test/cuant-ayuda.js no contiene pruebas: node --test lo carga como un fichero de 0 pruebas y pasa.
================= B-mercado-broker pruebas: {"comando":"cd /home/user/trading-system/mesa-trading && node --test test/mercado-*.test.js test/broker-*.test.js && node scripts/probar-broker-simulado.js && NODE_USE_ENV_PROXY=1 node scripts/probar-alpaca.js","pasan":102,"fallan":0}
--- DESVIACIONES
1. calendario.cierreSesion(dia) devuelve null los días sin sesión (fin de semana o festivo); el contrato solo dice → ms. Además acepta un instante en ms, además de 'AAAA-MM-DD'.
2. AlpacaDatos.ultimos() para cripto usa /v1beta3/crypto/us/latest/quotes (punto medio bid/ask, con t exacto de la cotización) y cae a /latest/bars solo para los símbolos sin cotización. El contrato dice latest/bars o latest/trades. Medido el 29-sep-2026: la vela de 1 minuto iba hasta 7 minutos por detrás de la cotización (SOL: 36 s frente a 417 s) y las últimas operaciones de DOGE tenían 35 min. Con latest/bars el límite de 180 s de antigüedad del precio vetaría casi todas las aperturas.
3. El t de ultimos() con el respaldo de latest/bars es el INICIO del minuto (lectura prudente para el límite de antigüedad), no el final.
4. El Orden del BrokerSimulado trae cantidadEjecutada NETA (lo que entra en la posición: 0,009975 BTC) y comision en dólares (2,5 $), más el extra cantidadBruta (0,01). Alpaca da filled_qty BRUTO y comision null, y lo cuadra la conciliación. Con neto + comisión en $, la fórmula de libros de C, (precio − costeMedio)·cantidad − comisiones, da el P&L exacto sin conciliar: 94,507 $ en el caso conocido, igual que el efectivo real.
5. patrimonioAyer del BrokerSimulado = último patrimonio visto en el día UTC anterior. En Alpaca, last_equity corta a las 16:00 ET.
6. AlpacaBroker.cuenta().poderCompra = non_marginable_buying_power (el que cuenta en cripto; el fondo no usa margen) y añade el extra poderCompraMargen = buying_power.
7. activo().minNocional: 1 en acciones (doc de Alpaca) y null en cripto, porque la doc se contradice; manda minCantidad × precio. En el simulado, minNocional = 1 y minCantidad = incremento = 1e-9.
8. esperarEjecucion en AlpacaBroker: si al acabar el tiempo la orden no es final, devuelve la última vista (estado 'pendiente' o 'parcial'); si nunca aparece, lanza ErrorBroker tipo 'desconocido'. BrokerSimulado lanza lo mismo si no existe.
9. Los rechazos del BrokerSimulado (fondos, cantidad, mercado_cerrado, invalida) se LANZAN como ErrorBroker y no quedan como orden 'rechazada', igual que el 403/422 de Alpaca al enviar.
10. El constructor de AlpacaBroker no estaba en el contrato. Firma: {claveId, secreto, urlBase, fetch, reloj, limitador, timeoutMs, maxReintentos, dormir, intervaloSondeoMs}. Lanza si urlBase ≠ https://paper-api.alpaca.markets o si faltan claves.
11. La llamada HTTP común (pedir: timeout, JSON tolerante al HTML de nginx, reintentos) vive en src/mercado/limitador.js para no duplicarla entre bróker y datos.
12. Solo el modo sintético de MiedoCodicia pone etiqueta por bandas: 0-25 miedo extremo, 26-46 miedo, 47-54 neutral, 55-75 codicia, 76-100 codicia extrema. No las he inventado: las medí en los 3.159 días del histórico real de la API, estables de 2018 a 2026. El valor sintético es 100/(1+e^(−r30/0,12)) sobre la rentabilidad de 30 días del BTC sintético.
13. DatosSinteticos admite los extras `inicio` (por defecto reloj.ahora() al construir) y `diasHistoria` (900). Ancla los precios para que en `inicio` valgan BTC 100.000, ETH 3.500, SOL 180, LINK 18, AVAX 30 y DOGE 0,20. El volumen v es siempre 0 porque no se usa (§2) y no se inventa.
--- PENDIENTES
- F (integración) debe crear UN Limitador y pasárselo a la vez a AlpacaDatos y a AlpacaBroker: la cuota de 200/min es por cuenta. Si no se pasa, cada uno crea el suyo y juntos podrían llegar a 360/min.
- F: detrás de un proxy (como este entorno), el fetch de Node ≥ 22.21 necesita NODE_USE_ENV_PROXY=1. Conviene ponerlo en el script de arranque o en la documentación.
- C/F: sobre el límite maxAntiguedadPrecioSegCripto = 180 s. Aun con cotizaciones, ETH/USD llegó a tener la suya con 486 s de antigüedad en el venue de Alpaca (29-sep-2026, 20:57Z). Habrá vetos de apertura por precio viejo en ratos de poca actividad. Es el dato real, pero conviene saberlo antes de leerlo como fallo.
- A/F: en velas intradía (1Hour y 4Hour) Alpaca corta una página por semana aunque se pida limit=10000 (medido). 900 días de 4Hour son unas 130 peticiones por símbolo: calentar 6 cripto cuesta 4-5 minutos al ritmo de 180/min, una sola vez gracias a la caché en disco. Las diarias caben en una página. Si el laboratorio solo necesita diarias largas, mejor pedir 4Hour en ventana corta.
- Sin comprobar por falta de claves: la parte con claves de scripts/probar-alpaca.js (cuenta, reloj, posiciones, activo, SPY por IEX, noticias y --orden-prueba de 15 $). Está escrita y probada con fetch falso, pero hay que ejecutarla una vez con el .env de paper. Ahí se verá además si la cuenta paper cobra la comisión en el activo (la ficha lo marca como no documentado).
- ficha-alpaca.md (no es mío) debería recoger dos hallazgos de hoy: el tamaño de página semanal y que latest/quotes es más fresco que latest/bars. Quien tenga la ficha puede añadirlos.
--- NOTAS
Modo: paso a paso; este paso cierra el constructor B. No he tocado ficheros ajenos ni git. Tampoco he ejecutado npm install.

Festivos NYSE verificados con WebFetch en nyse.com/markets/hours-calendars (29-sep-2026).
- 2026: 1-ene, 19-ene, 16-feb, 3-abr, 25-may, 19-jun, 3-jul, 7-sep, 26-nov y 25-dic.
- 2027: 1-ene, 18-ene, 15-feb, 26-mar, 31-may, 18-jun, 5-jul, 6-sep, 25-nov y 24-dic.
- Cierres a las 13:00 ET: 27-nov-2026, 24-dic-2026 y 26-nov-2027.
- Según la nota de la NYSE, el 31-dic-2027 abre (el Año Nuevo de 2028 no se observa) y el 2-jul-2026 no tiene cierre temprano.

Comprobado con curl contra la API real:
- El `end` de las velas es inclusivo y filtra por el inicio de la vela.
- Una vela de 1 minuto sin operaciones tiene como cierre el punto medio de la cotización.

Rendimiento del sintético: 900 días × 6 cripto en unos 330 ms. En la semilla 42, la correlación BTC-ETH diaria sale 0,77, BTC-DOGE 0,70 y LINK-DOGE 0,62; la volatilidad anual va de 0,55 (BTC) a 0,86 (DOGE).

Salida resumida de `node scripts/probar-alpaca.js` SIN claves (29-sep-2026, 20:58Z), todo OK y código de salida 0:
- Último precio: BTC/USD 83.622 $ (hace 2 s), ETH/USD 2.690 $ (hace 69 s), SOL/USD 119,11 $ (hace 37 s).
- 30 días de velas 1Hour de BTC/USD: 719 velas, del 30-ago 21:00Z al 29-sep 19:00Z, en 5 páginas encadenadas por page_token.
- Velas ascendentes, sin duplicados, todas cerradas, OHLC coherente y alineadas a UTC.
- La segunda llamada sale de la caché (0 peticiones) y el fichero de caché queda en disco.
- ETH/USD: 179 velas de 4Hour en 30 días y 59 diarias en 60 días, todas correctas.
- Mensaje final: «Sin claves en .env: se omite la cuenta paper».

En una ejecución anterior con latest/bars, ETH salía con 461 s de antigüedad y SOL con 401 s. Eso motivó el cambio a latest/quotes.

`node scripts/probar-broker-simulado.js`: 14 de 14 OK.
- La compra da 0,009975 BTC, el efectivo queda en 99.000 $ y la comisión es 2,5 $.
- La venta cobra 2,743125 $ de comisión y deja el efectivo en 100.094,506875 $ (= 99.000 + 0,009975·110.000·0,9975).
- Los tres rechazos (fondos, cantidad, mercado_cerrado) funcionan sin tocar el estado.
- Tras recargar desde el JSON, el estado es idéntico.

El índice de miedo y codicia real también responde: valor 73, «Codicia», e histórico de 3.159 días desde 2018-02-01.
================= C-riesgo-cartera pruebas: {"comando":"cd /home/user/trading-system/mesa-trading && node --test test/riesgo-*.test.js test/cartera-*.test.js test/aprendizaje-*.test.js && node scripts/probar-riesgo.js && node scripts/probar-contabilidad.js","pasan":82,"fallan":0}
--- DESVIACIONES
1. Libros, `sombra`: lo he leído como un selector de libro. `sombra:false` da solo los puestos reales y `sombra:true` solo los sombra, nunca mezclados, tanto en valorar como en totalesPorSimbolo. Así F puede valorar la cartera «sin comité» por separado.
2. Libros: la comisión de entrada no entra en el coste medio. Se guarda aparte (comisionesPendientes) y se imputa a prorrata de lo que se vende, que es lo que pide el contrato. escalarSimbolo mantiene lo que se pagó: el valor que desaparece al escalar pasa a comisiones pendientes. Con la venta de 0,009975 a 110.000 sale 94,506875 $, igual que la caja.
3. Libros, aplicarEjecucion: acepta un `precioReferencia` opcional (el precio de la decisión) para calcular `Operacion.deslizamiento`. Es la suma, en fracción, del deslizamiento en contra al entrar (media ponderada) y al salir. Sin referencia en ninguno de los dos lados vale null. Lo necesita la regla «ejecucion» del post-mortem.
4. Libros, aplicarEjecucion: no aplica dos veces la misma ejecución, comprobando el par (puestoId, idCliente). Recuerda las últimas 2.000 y se serializan. El mismo idCliente en otro puesto sí se aplica, para que un kill pueda repartir un cierre entre varios puestos.
5. Libros, venta mayor que el puesto: se contabiliza la cantidad del puesto, se escribe un aviso en el log y se devuelve `exceso`. No lanza error, porque la ejecución ya ocurrió en el bróker; el descuadre lo verá la conciliación.
6. Libros, riesgoInicial: es null si se abre sin stop. En un aumento suma max(0, (precio − stop)·cantidad) con el stop vigente. rMultiple es null si el riesgo es ≤ 0.
7. valorar: `posicionesAbiertas` cuenta símbolos distintos, que es lo que ve el bróker (dos mesas en BTC son una posición); `puestosAbiertos` va aparte. Las exposiciones van en dólares, porque aquí no se conoce el patrimonio. Si falta un precio, se usa el último conocido del puesto y se marca `precioEstimado`.
8. Conciliación: un descuadre grave no genera acción (el contrato no tiene ese tipo). Pone `grave:true` y lo describe en `descuadres` y en el resumen. Añade `limpia` (sin grave, sin huérfanas y sin fantasmas) para el Reabrir, e `ignoradas` para el polvo de menos de 1 $ cuando se le pasan precios.
9. Límites: además del contrato, comprueba el riesgo por operación con el stop (riesgoPorOperacion) como red de seguridad, y veta una apertura sin stop válido (stop ≤ 0 o ≥ precio). Aplica primero los multiplicadores (caída y Megáfono) y después los topes, para que el tamaño final quepa exacto.
10. Límites: se reúnen todos los vetos, no solo el primero. Una acción sin dato de si la bolsa está abierta (mercadoAbierto.accion distinto de true) se trata como bolsa cerrada. Un precio sin precioT se veta. Sin precioDecision no se comprueba el desvío.
11. Límites: abrir en un símbolo que ya tiene otra mesa no cuenta contra maxPosiciones, porque no añade posición en el bróker. Una mesa con multiplicador de comité 0 se veta con el motivo 'multiplicadorComite'. El resto de multiplicadores del comité los aplica F al capital (§6.7) y aquí no se cuentan dos veces.
12. Límites: una propuesta de reduccion, cierre o stop con lado 'compra' se veta (tipoIncoherente) para que no se salte los límites. La 'prueba' solo la frenan el bloqueo y las órdenes por minuto. Las directivas se aceptan en las dos formas: el resumen del estado (§7) y la lista del Megáfono (§6.5). Solo cuentan las vigentes y, si hay varias reducciones, manda la más dura. reducir_riesgo multiplica el tamaño por el factor.
13. Vigilante: el 0,5 de la caída está en la constante FACTOR_CAIDA, porque config no lo tiene: es el efecto de un tope, no un tope. Las comparaciones con los umbrales tienen una holgura de 1e-9, porque 90.000/100.000 − 1 da −0,0999999… y sin ella un −10 % exacto no saltaría.
14. Vigilante: con un kill solo se emite la acción kill, sin stops, para no vender dos veces. Estando ya bloqueado, no relanza el kill y avisa si queda algo abierto. 'pausado' también se mantiene hasta que lo quite un humano, pero un kill lo supera. Un solo cerrar con soloCerrarHasta null no caduca por tiempo.
15. Vigilante: tiene dos parámetros opcionales. `diaInicio` es el día UTC al que pertenece patrimonioInicioDia. Sin él, entre las 00:00 y el cierre diario de las 00:05 la referencia de ayer volvería a disparar el solo cerrar y duraría otro día entero. `multiplicadorCaidaActual` sirve para avisar de la caída solo cuando cambia; sin él, el aviso sale en cada llamada mientras dure. Devuelve también perdidaDia, caida, pico y soloCerrarHasta. Los stops se revisan también en los puestos sombra, y esas acciones llevan `sombra:true`.
16. Evaluador: `adherencia` es una fracción entre 0 y 1, no un tanto por ciento, igual que acierto y el resto del código. Las operaciones con motivoSalida 'prueba' no cuentan en nada. La penalización de papel se resta de cada operación y también de la curva, el día de cada lado. Un punto de la curva con `flujo` (capital que entra por una reasignación) no cuenta como rentabilidad, y maxDD se calcula sobre el índice encadenado. Se anualiza con √365 porque la curva es por día natural.
17. Evaluador: sharpeRodante devuelve null con menos de 30 retornos (minDias). alarmaDeriva usa z = (media − μ)·√n/σ con μ y σ diarios y da alarma si z ≤ −1; con menos de 20 retornos devuelve {alarma:false, z:null}.
18. Asignador: el objetivo se normaliza al presupuesto de titulares antes de mezclarlo 0,7/0,3, para que esos pesos valgan lo que dicen. Una mesa con muestra corta queda fija en su peso actual; si los fijos no dejan un hueco coherente, se escalan todos juntos. El suelo y el techo se aplican con reparto iterativo. Si ni todos los titulares en el techo cubren el presupuesto, el resto queda en efectivo.
19. Asignador: un titular sin pesoActual (primer reparto) recibe directamente su objetivo, que sin muestra es la paridad de riesgo. Si una mesa no tiene volatilidad, toma la media de las demás. El despido no espera a la muestra mínima. Una mesa ascendida con menos de 20 operaciones conserva su 2 % y el suelo la sube al 5 %. Si falta el Sharpe de backtest o el de papel, se descarta. Un estado desconocido recibe peso 0.
20. Benchmarks: se compran netos de comisión (0,25 % cripto cobrado en el activo, 0 en acciones) y de la penalización opcional, que vale 0 por defecto. Si falta un precio al valorar, la cartera sale con valor null en vez de inventar uno. Sin precio de BTC no se crea nada; sin SPY, las carteras spy y btc-spy se omiten y se anotan en `omitidos`.
--- PENDIENTES
- F (integración): tiene que pasar `precioReferencia` en aplicarEjecucion para que el deslizamiento exista, y `diaInicio` y `multiplicadorCaidaActual` a vigilar para evitar que el solo cerrar se repita al pasar la medianoche y que el aviso de caída salga en cada latido.
- F: tiene que aplicar él mismo las acciones 'escalar' de conciliar con libros.escalarSimbolo; conciliar no toca los libros. También decidir qué hacer con huérfanas, fantasmas y el grave (lo sensato: avisar y no reabrir mientras `limpia` sea false).
- F: pasar `penalizacion: limites.penalizacionPapel` a crearBenchmarks para comparar neto contra neto (por defecto es 0), y `penalizacionPapel` a metricasMesa.
- F: si reasigna capital a mitad de curva, anotar `flujo` en la curva diaria de la mesa, para que la reasignación no cuente como rentabilidad.
- No he ejecutado `npm test` completo, a propósito: las pruebas de otros constructores pueden estar a medias.
--- NOTAS
He escrito los siete módulos del constructor C, con sus pruebas y los dos scripts de casos conocidos. Las 82 pruebas pasan (`node --test test/riesgo-*.test.js test/cartera-*.test.js test/aprendizaje-*.test.js`) y los dos scripts, `node scripts/probar-riesgo.js` y `node scripts/probar-contabilidad.js`, salen con código 0 e imprimen «Todos los casos cuadran».

El caso de contabilidad obligatorio cuadra, con el razonamiento escrito en la prueba y en el script:
- Coste medio: 105.000.
- Primera venta: 144,375 (150 − 3 − 2,625).
- Segunda venta: −154,875 (−150 − 2,25 − 2,625).
- Total: −10,5, que es exactamente la caja neta.

Hay pruebas por cada motivo de veto y cada tipo de recorte, y los textos llevan las cifras con `src/util/formato.js` (por ejemplo: «BTC pasaría a 12.000 $ (12,00 % del patrimonio); máximo 10,00 % (10.000 $). Se recorta de 5.000 $ a 3.000 $.»). También están los casos del vigilante (−2 %, −3,5 %, −10 %, −15 %, stop saltado, bloqueo pegajoso), la conciliación (escalar 0,01 → 0,009975, grave, huérfana, fantasma) y el asignador (suavizado, suelo, techo, muestra mínima, despido, incubación, ascenso, descarte).

Los límites se reciben siempre por parámetro (`ctx.limites`), sin copiar cifras de config; las pruebas usan `LIMITES_DUROS` de `src/config.js`. Reutilizo `reloj`, `numeros`, `formato`, `log` y `universo`. No uso las exportaciones de `src/backtest/metricas.js` que no están en el contrato, para no depender de detalles internos de A.

Solo he creado ficheros míos. No he tocado los de otros, ni hecho git, ni instalado nada.
================= D-agentes pruebas: {"comando":"cd /home/user/trading-system/mesa-trading && node --test test/agentes-*.test.js && node scripts/probar-llm.js --sin-clave","pasan":60,"fallan":0}
--- DESVIACIONES
1. llm: tras un 401 la primera llamada devuelve motivo 'error' y deja activo=false; las siguientes devuelven 'sin_clave' sin hacer red. El detalle y estado().ultimoError lo dicen.
2. llm: las respuestas fallidas también traen costeUsd (campo extra) cuando hubo llamada, para poder atribuir el gasto.
3. llm: con un reloj de tipo 'simulado', el día del presupuesto y la t de llm-costes.jsonl salen del reloj real (Date.now). El dinero es real: con la demo a 600x el tope diario se reiniciaría cada pocos minutos. Con cualquier otro reloj se usa reloj.ahora().
4. llm: activo también es true si se inyecta un 'cliente' sin apiKey.
5. llm: el coste suma usage.iterations cuando viene (con salvavidas, cada intento se cobra a la tarifa de su modelo). La tabla lleva también claude-opus-4-8 (5/25/0,50/6,25), el destino del salvavidas en rechazos cyber. Un modelo desconocido se cobra a la tarifa de fable-5-1, la más cara, para que el tope nunca se quede corto.
6. llm: el esquema que se envía a la API no lleva lo que la API no admite (minimum, maximum, minLength, maxLength, maxItems, pattern, minItems>1) y lleva additionalProperties:false en cada objeto. La validación local sigue usando el esquema completo. Un JSON.parse fallido se devuelve como motivo 'esquema'.
7. llm: un 'sistema' vacío se sustituye por un texto por defecto, porque la API rechaza bloques de texto vacíos. Una entrada que no se puede serializar devuelve 'error' sin llamar.
8. cifras: los enteros 0-31 pasan gratis solo si van SIN unidad; «12 %» o «5 $» hay que encontrarlos. Se compara en valor absoluto (el signo lo da la palabra). La tolerancia es la de los decimales que se ven en el texto, lo que incluye los redondeos a 0-2. También cuentan los números que van dentro de textos de la entrada. Una hora HH:MM solo pasa si aparece escrita igual en la entrada. Identificadores como SMA200 o RSI2 no se tratan como cifras. Entiende también pb, k y M.
9. plantillas: el contrato solo da los nombres; las firmas (un objeto por plantilla) son mías y van documentadas en la cabecera. informeComite sirve de dos formas: informeComite(jefe, datos) e informeComite.<jefe>(datos). El recorte a 140 se hace por un separador, para no partir un número.
10. registro: nombres fijos para los 7 puestos fijos, con el género que pide el rol. controller y ejecutor van en el departamento 'operaciones' (sala riesgos) y auditor en 'laboratorio'. usaLLM=true solo para cio, analistas y auditor. Cada nombre es «Nombre Apellido», sin repetir nombre de pila. Exporta además puestosDeMesa() para contratar.
11. bus: un canal o tipo fuera de la lista se publica como 'sistema' con un aviso (con estricto:true lanza error), para que una etiqueta mal puesta no tumbe el latido. Al arrancar carga los últimos maxMemoria mensajes de 'ruta'. Añade desde(t). El id lleva una marca de sesión para no repetirse entre demos con el mismo reloj simulado.
12. megafono: el estado de directivas es el resumen de §7 con origen:'megafono' en cada entrada (comprobado: evaluarPropuesta de Riesgos lo entiende). 'reanudar' solo quita entradas con ese origen y validarDirectiva lo exige si recibe ctx.directivas. Sin duración escrita se ponen 4 h (hasta el siguiente comité). Por palabras clave, las horas se ajustan a 1..72 y el factor baja al valor permitido más prudente, avisándolo en la explicación. Una directiva del LLM fuera de rango se descarta sin tumbar las demás. La explicación del LLM solo se enseña si pasa verificarCifras y no hubo descartes; si no, sale de la plantilla. «Para» solo cuenta como orden al empezar la cláusula.
13. postmortem: lote() devuelve también mesaId y simbolo, que hipotesisDesdeLecciones necesita. pnl=0 cuenta como perdedora. Una ganadora que sale por manual/prueba/fin es 'suerte'. Como mucho 40 operaciones por llamada; el resto va por reglas. Si la lección del LLM no pasa verificarCifras, esa operación entera (también su categoría) va por reglas. hipotesisDesdeLecciones no cuenta acierto_de_libro ni suerte, y lee mesaId o operacion.mesaId.
--- PENDIENTES
- La llamada real no se ha probado: no hay ANTHROPIC_API_KEY en este entorno. Con clave, `node scripts/probar-llm.js` hace una llamada mínima (avisa antes y espera 3 s; cuesta del orden de 0,01 $).
- Opus 5.5 razona siempre y ese razonamiento cuenta contra max_tokens. Con los 2000 por defecto del contrato y esfuerzo medium, el comité puede cortarse por max_tokens: devuelve 'error', se aplica el plan por defecto y la llamada ya se ha cobrado. F debería pasar unos 4000 para el comité y medirlo en llm-costes.jsonl.
- Las tarifas de caché de claude-opus-4-8 (0,50 y 6,25) aplican los multiplicadores estándar (0,1× y 1,25×) sobre 5/25; conviene confirmarlas en la página de precios.
- Integración (F): pasar rutaCostes=data/llm-costes.jsonl y ruta=data/mensajes.jsonl, registrar la plantilla en el Bus, guardar las lecciones con mesaId, y añadir scripts/probar-llm.js a probar-todo.js, que es fichero de F.
- La duración por defecto del Megáfono está fija en 4 h (HORAS_POR_DEFECTO). Si COMITE_HORAS cambia, F puede pasar horasPorDefecto a interpretarPalabrasClave o convendría conectarlo a la configuración.
--- NOTAS
Las 60 pruebas de agentes pasan (llm 21, cifras 9, megáfono 8, post-mortem 7, plantillas 5, registro 5, bus 5). scripts/probar-llm.js cuadra todos sus casos sin clave y sale con 0; sin clave y sin --sin-clave lo dice y no hace red.

Casos conocidos, calculados a mano y escritos en pruebas y script:
- Coste opus-5-5 con 1000/500/2000/1000 tokens: 0,0194 $.
- El mismo en haiku-4-5: 0,00495 $.
- Con salvavidas (opus-5-5 rechaza y opus-4-8 responde): 0,0215 $.
- Estimación con 300 caracteres y 1000 tokens de salida: 0,0204 $.
- Frase conocida: «Comprados 0,009975 BTC a 100.000 (1.000 $). Comisión 2,50 $.»

La forma de la petición está comprobada contra el SDK 0.129.0 real con fetch falso. Opus va a /v1/messages?beta=true con cabecera anthropic-beta server-side-fallback-2026-07-01 y fallbacks:'default' en el cuerpo, sin thinking ni temperature. Haiku va a /v1/messages sin effort, sin fallbacks y sin cabecera beta. APIConnectionError hereda de APIError, así que el orden de comprobación es 401 → 429 → conexión → APIError. Se lee el primer bloque de tipo 'text', no content[0]: con Opus 5.5 delante vienen bloques 'thinking' y, con salvavidas, 'fallback'.

El salvavidas del servidor (fallbacks:'default') va activado en los cuatro modelos que lo admiten, como pide el contrato: si el clasificador rechaza, la API reintenta sola en otro modelo y ese intento se cobra a su tarifa.

Las pruebas no dependen de módulos de otros constructores: el universo y las mesas están escritos a mano. Solo una vez, a mano y fuera de las pruebas, comprobé que evaluarPropuesta de Riesgos entiende el estado del Megáfono: veta SOL pausado y reduce BTC de 2.000 a 1.000 $ con factor 0,5.

test/agentes-ayuda.js no es un .test.js; lo usan las pruebas de agentes. No he tocado ficheros ajenos, ni hecho git ni npm install.
================= E-parque pruebas: {"comando":"node --test test/parque-*.test.js && node scripts/probar-parque.js","pasan":33,"fallan":0}
--- DESVIACIONES
1. Plano: análisis ocupa las filas 8–13 y laboratorio las 13–16 (5 + 3 filas). El boceto de propuesta-visual daba 2 filas al laboratorio, donde no caben dos mesas con silla. Dirección 0–4 y macro 4–8, como en el boceto.
2. Tabiques interiores bajos (22 px, más la tarima donde lindan con macro) y paredes del fondo altas (88 px, llevan pantallas y ventanas). La propuesta decía 1,5 teselas para todas; con esa altura los pasillos quedaban tapados y no se veía a quien anda detrás.
3. La pantalla gigante mide 16 teselas de ancho, no 8, para que se lean las tres secciones (cotizaciones · patrimonio y curva · hechos de la mesa). Va pegada a la pared de la fila 0.
4. Zoom 0,5×–2×, pero encuadrar() baja el mínimo cuando la oficina no cabe entera (móvil) para poder verla de un vistazo. En móvil el encuadre inicial es 0,5× sobre el parqué.
5. web/js/cifras.js reproduce las reglas de src/util/formato.js porque el navegador no puede cargar CommonJS. test/parque-cifras.test.js compara las dos salidas valor a valor. La única diferencia a propósito: hora() sin zona usa la del ordenador que mira el panel, no Europe/Madrid.
6. Los scripts de web/js son a la vez scripts clásicos (window.Parque, funcionan desde file://) y módulos CommonJS, gracias a un envoltorio UMD. Así se prueban con node:test sin navegador. 'use strict' va dentro de cada fábrica.
7. Pruebas en test/parque-*.test.js y script scripts/probar-parque.js: la tabla §1 solo asigna web/** a E. Elegí el prefijo 'parque-'.
8. index.html usa rutas relativas. Si la página se sirve en «/», un script en <head> inserta <base href="/web/">, porque §7 sirve los estáticos en /web/*. Servida en /web/, desde el disco o desde un servidor estático no hace nada.
9. Token: los GET y POST lo mandan en la cabecera x-panel-token. EventSource no admite cabeceras, así que el SSE lo manda en ?token= (§7 lo permite).
10. «Comité en HH:MM» es una cuenta atrás: proximoComite menos la hora estimada del servidor (instantanea.ahora + tiempo transcurrido × velocidad en modo sintético). Muestra «Comité reunido» si hay algún agente en la sala de comité y «Comité pendiente» si la hora ya pasó.
11. CAÍDA se muestra siempre como −|caida|, venga con el signo que venga.
12. Destellos de los monitores: el evento `ejecucion` pone el puesto en ámbar 2 s. Los mensajes tipo 'orden' (ámbar) y 'veto' (rojo intenso) solo destellan si traen datos.puestoId, porque el contrato no tiene evento de veto.
13. Megáfono: la propuesta se espera en datos ({id, texto?, directivas, explicacion}), según «Respuesta de comando: {ok, mensaje, datos?}». También se acepta si llega en el primer nivel.
14. Prueba: si la respuesta trae datos.comprobaciones [{nombre, ok, detalle}], el modal lo pinta como lista; si no, muestra solo el mensaje. El contrato no fija la forma de esos datos.
15. Ajustes: el GET se lee de datos {modo, presupuestoDiaUsd, modeloComite, modeloAgentes, velocidad, limites, modelosDisponibles?}. Lo que falte se toma de la instantánea (llm, limites, velocidad, modo). El POST manda solo los campos que cambiaron.
16. La maqueta usa los nombres fijos de src/agentes/registro.js, pero inventa los de analistas y operadores (el navegador no puede cargar registro.js). Los ids siguen la regla de §6.1 (analista-<ETIQUETA>, puesto-<mesaId>-<ETIQUETA>).
17. Además de lo pedido: pantalla de régimen en la sala de macro, pantalla de comité, pizarras en laboratorio y análisis, tablero de LÍMITES en la pared de riesgos, relojes de cuatro plazas y ventanas con el cielo según la hora. Todo sale de datos de la instantánea o es decorado fijo; ninguna cifra es inventada.
18. Filas del parqué alineadas a la izquierda (columna 2,6) con el mismo ancho de puesto en todas, en vez de centradas: centradas, el rótulo de una mesa corta quedaba debajo de las etiquetas de la fila siguiente. Con más de 6 mesas se juntan varias en una fila de hasta 16 teselas.
--- PENDIENTES
- F (servidor): servir web/ en «/» y en «/web/*». Aceptar el token del SSE por ?token=.
- F: meter datos.puestoId en los mensajes tipo 'orden' y 'veto' del bus, para que el monitor del puesto destelle en ámbar o en rojo.
- F: emitir el evento `agente` ({id, estado, sala, bocadillo}) cada vez que un jefe va o vuelve del comité o del descanso, y con el kill switch (estado 'de_pie'). La interfaz solo mueve a alguien cuando cambia su sala o su estado.
- F: devolver datos.comprobaciones [{nombre, ok, detalle}] en POST /api/comando/prueba, y en GET /api/comando/ajustes devolver datos {modo, presupuestoDiaUsd, modeloComite, modeloAgentes, velocidad, limites, modelosDisponibles}.
- Tras una reconexión la interfaz rellena el feed con los 150 mensajes de la instantánea; no pide /api/mensajes?desde=. Si un corte dura más de 150 mensajes, los intermedios no salen en el feed (sí en el servidor).
- Probado contra un servidor falso que habla §7 (en el scratchpad), no contra src/servidor.js, que aún no existe. Cuando F lo tenga, repetir la comprobación con el servidor real.
--- NOTAS
Comprobado en Chromium real (playwright-core instalado solo en el scratchpad) sirviendo web/ con python3 -m http.server.
- index.html?maqueta=1 a 1440×900 y a 390×844 (DPR 2): 0 errores de consola.
- Clic en un puesto: sale la tarjeta con todos los campos de §8. Clic en la jefa de riesgos: tarjeta de agente con anillo de selección.
- Megáfono: se abre, «pausa SOL 6 h y reduce el riesgo» da dos directivas y el modal se cierra bien.
- A los 25 s el comité lleva a los cinco jefes, por las puertas, a la mesa larga, y luego los devuelve.
- Kill switch: pide escribir KILL, pone en rojo la pantalla y los monitores, y deja a todos de pie.
- Movimiento reducido: sin animación, los jefes saltan a su silla.
- Abierto como file:// entra en modo maqueta sin errores.
- Modo real contra un servidor falso de §7: la página servida en «/» carga gracias al <base>, llega el token en GET, POST y SSE, al cortar la conexión sale la franja «Sin conexión con la mesa, reintentando en 1 s…», y reconecta sola.

Rendimiento: 3–4 ms por fotograma con la cámara quieta. Arrastrando a DPR 2 baja de 13 ms de media (83 ms de pico) a 8,6 ms de media (19 ms de pico) tras cambiar el shadowBlur del edificio por capas translúcidas.

Capturas en /tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/:
- escritorio.png, movil.png, tarjeta.png (las tres pedidas)
- zoom.png, tarjeta-movil.png, tarjeta-agente.png, megafono.png, megafono-movil.png, movil-hoja.png
- salas-derecha.png, pantalla-gigante.png, comite.png, kill.png, ajustes.png, sin-conexion.png

Scripts de verificación, en el mismo scratchpad, carpeta pw/: verificar.js, detalles.js, modo-real.js, servidor-falso.js, arrastre.js, final.js. No he tocado ficheros de otros constructores, ni git, ni npm en el proyecto.

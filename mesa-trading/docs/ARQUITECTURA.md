# Mesa de trading de agentes — arquitectura y contratos

Este documento es el contrato entre módulos. Quien escribe un módulo cumple su
contrato al pie de la letra (nombres de funciones, formas de datos, unidades);
quien lo usa se fía de él. Si un contrato no se puede cumplir, se dice y se
cambia aquí, no en silencio en el código.

Referencias verificadas: `docs/investigacion/ficha-alpaca.md` (API de Alpaca
comprobada con documentación y curl el 29-sep-2026), `propuesta-cuant.md`,
`propuesta-agentes.md`, `viabilidad-fuentes.md`, `critica-sintesis.md`.

---

## 0. Principios (no negociables)

1. **El LLM habla; el código decide los números.** Indicadores, señales,
   régimen, tamaños, stops, límites, P&L y conciliación son código
   determinista. Un LLM solo (a) redacta texto a partir de datos ya calculados,
   (b) elige entre opciones de una lista cerrada, (c) clasifica en categorías
   cerradas. Todo JSON que devuelve un LLM se valida contra esquema; si no
   valida, se aplica el plan por defecto del código.
2. **Ninguna cifra de un LLM llega a la pantalla sin comprobar.** Todo texto de
   LLM pasa por `verificarCifras()`: si cita un número que no está en los datos
   que se le dieron, se sustituye por la plantilla.
3. **Límites duros en `src/config.js`**. El comité y el Megáfono solo pueden
   apretarlos, nunca aflojarlos, y lo que aprietan caduca.
4. **El bróker es la verdad.** El estado local es una caché; se concilia cada
   latido. Si el proceso arrancó bloqueado (kill switch), sigue bloqueado.
5. **Solo papel.** La URL de trading real de Alpaca no existe en el código.
   `AlpacaBroker` rechaza cualquier URL base que no sea
   `https://paper-api.alpaca.markets`.
6. **Sin mirar el futuro.** Una decisión en el cierre de la vela `i` usa solo
   velas `≤ i` y se ejecuta en la apertura de `i+1` (backtest) o al precio
   actual (en vivo). Hay una prueba que lo comprueba (§9).
7. **"Mejorar" se mide contra carteras sombra** (comprar y mantener, y las
   mismas mesas sin comité) con costes y penalización de papel incluidos.
8. **Sin dependencias nuevas.** Solo `@anthropic-ai/sdk`. Node ≥ 20, CommonJS,
   `'use strict'`, sin `"type": "module"`, sin TypeScript, sin paso de build.
9. Identificadores y comentarios en español. Comentarios breves que cuentan el
   porqué, no el qué.

---

## 1. Mapa de ficheros y dueño

Cada fichero tiene un único dueño. Nadie escribe ficheros de otro dueño; si
necesita algo de él, lo pide ajustando este documento.

| Ficheros | Dueño |
|---|---|
| `src/util/{almacen,reloj,log,numeros,formato}.js`, `src/config.js` | YA ESCRITOS (base) |
| `src/mercado/indicadores.js`, `src/mercado/regimen.js`, `src/estrategias/*.js`, `src/cuant/dimensionado.js`, `src/cuant/laboratorio.js`, `src/backtest/{motor,metricas,walkforward}.js`, `test/cuant-*.test.js`, `scripts/probar-indicadores.js`, `scripts/probar-backtest.js` | **A · Cuant** |
| `src/mercado/{universo,calendario,alpaca-datos,sintetico,sentimiento,limitador}.js`, `src/broker/{alpaca-broker,simulado,errores}.js`, `test/mercado-*.test.js`, `test/broker-*.test.js`, `scripts/probar-alpaca.js`, `scripts/probar-broker-simulado.js` | **B · Mercado y bróker** |
| `src/riesgo/{limites,vigilante,incidentes}.js`, `src/cartera/{libros,conciliacion,benchmarks}.js`, `src/aprendizaje/{evaluador,asignador,paso-a-real}.js`, `test/riesgo-*.test.js`, `test/cartera-*.test.js`, `test/aprendizaje-*.test.js`, `scripts/probar-riesgo.js`, `scripts/probar-contabilidad.js`, `scripts/estudiar-limites.js` | **C · Riesgo, cartera y aprendizaje** |
| `src/agentes/{bus,llm,plantillas,megafono,postmortem,registro,cifras}.js`, `test/agentes-*.test.js`, `scripts/probar-llm.js` | **D · Agentes (infraestructura)** |
| `web/**` | **E · Parqué (interfaz)** |
| `src/agentes/departamentos/*.js`, `src/agentes/comite.js`, `src/orquestador.js`, `src/servidor.js`, `src/index.js`, `scripts/demo-acelerada.js`, `scripts/probar-todo.js`, `test/integracion-*.test.js` | **F · Integración** (después de A–D) |
| `src/registros.js`, `test/integracion-registros.test.js` (noticias, historial y decisiones en disco, 30-sep-2026) | **F · Integración** (agente de datos) |
| `src/agentes/{conversacion,reuniones}.js`, `test/integracion-conversacion.test.js` (quién contesta a quién y reuniones de las 9:00 y las 22:15, 30-sep-2026) | **F · Integración** (agente de tono) |
| `src/informes/{index,lectores,estrategias,laboratorio}.js`, `test/informes-*.test.js`, `scripts/probar-vistas.js` (lo que leen las vistas de Informes, los dos servidores, 30-sep-2026) | **F · Integración** (agente de vistas) |
| `scripts/estudiar-candidatas.js`, `scripts/estudiar-ampliada.js`, `docs/estudios/*.json` (la salida versionada de la que salen las notas de las mesas), `test/cuant-candidatas.test.js` (revisión del 30-sep-2026) | **A · Cuant** |

---

## 2. Tipos comunes

```js
// Vela (barra OHLC). t = inicio de la vela en ms UTC. Solo velas CERRADAS.
{ t, o, h, l, c, v }            // v se guarda pero NO se usa: el volumen de Alpaca cripto no sirve (ficha §0.4)

// Marcos
MARCOS = { '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 }

// Símbolo canónico: cripto 'BTC/USD' (con barra), acciones 'SPY'.
// clave(s) = s.replace('/', '')  → 'BTCUSD' (así vienen las posiciones cripto de Alpaca)

// Activo del universo
{ simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto'|'accion', tipo, nombre: 'Bitcoin' }
// tipo (30-sep-2026): 'cripto' | 'indices' | 'bonos' | 'materias' | 'acciones' | 'volatilidad'
```

**Universo** (`src/mercado/universo.js`, dueño B):
- Cripto (sin clave): BTC/USD, ETH/USD, SOL/USD, LINK/USD, AVAX/USD, DOGE/USD y,
  desde el 30-sep-2026, XRP/USD, LTC/USD, BCH/USD y ADA/USD.
- ETF (solo con claves de Alpaca, feed IEX): SPY, QQQ, IWM, TLT, GLD, XLE, XLK,
  XLF y, desde el 30-sep-2026, DIA.
- **Solo dato** (`soloDato: true`): VIXY, el termómetro del miedo de Macro
  (§4.2). Ninguna mesa lo opera: `disponibles()` no lo da nunca, así que no
  tiene analista, ni puesto, ni orden (la plantilla lo salta, `_completar` lo
  quita de cualquier mesa guardada y el Ejecutor rechaza su orden con
  `motivo: 'solo_dato'`).
- **Tipo de activo** (`tipo`, 30-sep-2026; lo usan el capital de la cabecera y
  la vista Estrategias, §7 y §8): Cripto (las 10), Índices (SPY, QQQ, IWM, DIA),
  Bonos (TLT), Materias primas (GLD), Acciones (XLE, XLK, XLF: cestas de
  acciones de un sector) y Volatilidad (VIXY, que nadie opera y nunca sale en un
  desglose). `TIPOS` (`[{ id, nombre }]`, en ese orden), `tipoDe(simbolo)` (acepta
  también la clave `BTCUSD`; fuera del universo, `'otros'`, sin adivinar) y
  `nombreTipo(id)`.
- Exporta `UNIVERSO`, `CRIPTO` (las 10), `CESTA_CRIPTO` (las 6 originales: la
  cartera sombra `cesta-cripto` no cambia), `ETF` (los 9 operables),
  `SOLO_DATO` (`['VIXY']`), `porSimbolo(s)`, `porEtiqueta(e)`, `clave(s)`,
  `desdeClave('BTCUSD') → 'BTC/USD'`, `disponibles({ hayAlpaca }) → Activo[]`
  (sin los de solo dato), `esCripto(s)`, `esSoloDato(s)` y `generacion(s)`
  (1 el universo original, 2 la ampliación: la usa la plantilla para no
  cambiar la cara de nadie, §6.1).
- Decisión de Eduardo (30-sep-2026) con el histórico real: Momentum cripto
  titular sigue con sus 6. Las 4 nuevas las opera solo «Momentum cripto
  ampliada» (§4.3), en incubación; DIA entra en Momentum ETF. Las cifras, del
  estudio guardado `docs/estudios/ampliada-2026-09-30.json`
  (`scripts/estudiar-ampliada.js`), cada par en el tramo en que cotizan todas:
  con LTC y BCH el Sharpe de la titular baja de 0,63 a 0,40 (dic-2021 →
  sep-2026); con XRP, de 0,81 a 0,65 (ene-2024 → sep-2026); ADA cotiza desde
  feb-2026 (7 meses). Las que enseñaba antes (0,82 → 0,58 y 0,74 → 0,56) no
  salían de ningún estudio guardado (revisión del 30-sep-2026).

---

## 3. Mercado y bróker (B)

### 3.1 Fuente de datos — misma interfaz en `AlpacaDatos` y `DatosSinteticos`

```js
async velas(simbolo, marco, { desde, hasta }) → Vela[]
//  ascendente, sin duplicados, SOLO cerradas respecto a reloj.ahora():
//  cripto: t + marcoMs <= ahora. Acciones 1Day: la vela del día D cuenta como
//  cerrada cuando la sesión de D ha terminado (calendario.cierreSesion).
async ultimos(simbolos) → { [simbolo]: { precio, t, demanda?, oferta?, cierreAnterior? } }   // t = instante del dato (ms)
//  cripto: punto medio de la última cotización (demanda = bid, oferta = ask); si falta, cierre de la vela de 1 min.
//  acciones: último trade del snapshot (o la vela de 1 min) y cierreAnterior = cierre diario anterior.
async noticias(simbolos, { desde, limite }) → [{ id, titular, resumen, fuente, autor, t, url, simbolos }]  // [] si no hay claves; t = created_at
disponible(simbolo) → boolean
```

`AlpacaDatos({ claveId, secreto, fetch = globalThis.fetch, reloj, carpetaCache, limitador, timeoutMs = 20000, maxReintentos = 5, timeoutUltimosMs = 10000, reintentosUltimos = 1 })`:
- `ultimos()` va con su propio timeout y un solo reintento (unos 21 s como
  mucho): se pide en cada latido y el siguiente ya reintenta. Con los 20 s × 6
  intentos del resto, una red colgada retendría el latido (y con él el kill,
  el Ctrl+C y los stops) unos 151 s.
- Cripto: `https://data.alpaca.markets/v1beta3/crypto/us/bars`, `/latest/quotes`
  y `/latest/bars`, **sin cabeceras** aunque haya claves (una clave mala da
  401 incluso en el endpoint público, ficha §0.2). Un símbolo por petición
  (el `limit` es total entre símbolos). Paginación con `page_token` hasta que
  `next_page_token` sea null.
- Acciones: `/v2/stocks/bars?feed=iex&adjustment=all`, `/v2/stocks/snapshots?feed=iex`, con cabeceras.
- Noticias: `/v1beta1/news` con cabeceras.
- Caché en disco de velas históricas por símbolo y marco
  (`<carpetaCache>/velas/<clave>_<marco>.json`): solo se piden las que faltan.
- `limitador` (`src/mercado/limitador.js`): cola que no pasa de 180 peticiones/min
  compartida entre datos y trading; 429 → espera `Retry-After` o backoff 1-2-4-8…60 s.

`DatosSinteticos({ semilla, reloj, universo })`: precios inventados pero
deterministas (misma semilla → mismas velas). Solo las 6 cripto. Trayectoria
base de 5 minutos desde `inicio - 900 días` (para calentar indicadores y para
el laboratorio), generada bajo demanda y cacheada en memoria. Regímenes con
cadena de Markov (alcista / lateral / bajista, con deriva y volatilidad
distintas) y un factor común para que las cripto se muevan juntas (correlación
~0,6-0,8). Volatilidades anuales plausibles (BTC ~55 %, DOGE ~90 %).
Velas de cualquier marco por agregación de la trayectoria base, alineadas a UTC.

### 3.2 Miedo y codicia (`sentimiento.js`)

`new MiedoCodicia({ fetch, reloj, carpetaCache, sintetico?: DatosSinteticos })`:
- `async actual() → { valor, etiqueta, t } | null` (caché 1 h). Etiqueta
  traducida de la que da la API (no se inventan umbrales): Extreme Fear →
  «Miedo extremo», Fear → «Miedo», Neutral → «Neutral», Greed → «Codicia»,
  Extreme Greed → «Codicia extrema».
- `async historico() → [{ dia: 'AAAA-MM-DD', valor }]` desde `?limit=0`, caché en disco 24 h.
- `valorEn(historico, t) → { dia, valor } | null`: el del último día ≤ el de `t`.
- `RETRASO_FG = 1 h`: el valor vigente en `t` es `valorEn(historico, t − RETRASO_FG)`,
  en vivo (mesas, macro guarda los últimos días en `macro.fgDias`) y en el
  backtest y el laboratorio. alternative.me publica el del día a las 00:00 UTC,
  el mismo instante en que deciden las mesas diarias: a esa hora se usa el de
  ayer y desde la 01:00 el de hoy.
- En modo sintético: valor derivado de la rentabilidad de 30 días del BTC
  sintético (0-100), marcado `sintetico: true`.

### 3.3 Calendario (`calendario.js`)

Sesión regular NYSE 9:30-16:00 America/New_York (con horario de verano vía
`Intl`), lunes a viernes, festivos NYSE 2026-2027 en una lista. Exporta
`abierto(t)`, `proximaApertura(t)`, `cierreSesion(diaET) → ms`. Con claves de
Alpaca, el orquestador usa `broker.relojMercado()` (la verdad) y el calendario
solo como respaldo y para el bróker simulado.

### 3.4 Bróker — misma interfaz en `AlpacaBroker` y `BrokerSimulado`

```js
nombre                                   // 'alpaca-paper' | 'simulado'
async cuenta() → { patrimonio, efectivo, poderCompra, patrimonioAyer, bloqueada, estado }
async posiciones() → [{ simbolo /*canónico*/, cantidad, disponible, precioMedio, precioActual, valor, pnlNoRealizado }]
async enviarOrden({ idCliente, simbolo, lado: 'compra'|'venta', cantidad?, nocional? }) → Orden
//  siempre a mercado. TIF: cripto 'gtc'; acciones 'day'. Compras por nocional, ventas por cantidad.
async ordenPorIdCliente(idCliente) → Orden | null
async esperarEjecucion(idCliente, { timeoutMs = 20000 }) → Orden        // sondea hasta estado final o timeout
async ordenesAbiertas() → Orden[]
async cancelarTodas() → number
async cancelarOrden(id /* el id del bróker, no el idCliente */) → boolean   // false: ya no se puede cancelar (terminó, 422/404)
async cerrarTodo() → { cerradas: [simbolo], errores: [{ simbolo, status, mensaje, tipo }], ordenes: Orden[] }   // DELETE /v2/positions?cancel_orders=true
async relojMercado() → { abierto, proximaApertura, proximoCierre }
async activo(simbolo) → { negociable, fraccionable, minCantidad, incremento, minNocional }
async comisiones({ desde }) → [{ id, t, simbolo, cantidad, importe, precio, importeUsd }]   // solo AlpacaBroker: actividades CFEE

Orden = { id, idCliente, simbolo, lado, cantidad, nocional, estado: 'pendiente'|'parcial'|'ejecutada'|'cancelada'|'rechazada'|'caducada',
          cantidadEjecutada /* lo que ENTRA en la posición: neto de la comisión en compras cripto */,
          cantidadBruta /* filled_qty */, precioMedio,
          comision /* $: la del simulado; en Alpaca cripto, ESTIMADA a la tasa de costes.comision; acciones 0;
                      null si no se ejecutó nada */, comisionEstimada /* true en Alpaca cripto */,
          creada, actualizada, motivo }
```

- `cerrarTodo().ordenes`: cada liquidación es una orden NUEVA, con un
  idCliente que el fondo no generó; el Ejecutor la sigue (`seguirAjena`) y la
  apunta en los libros como una propia. Con la bolsa cerrada Alpaca acepta la
  venta de acciones y la deja en cola hasta la apertura.
- `comisiones()`: Alpaca apunta la comisión cripto al final del día (CFEE). La
  de una compra va en el activo (qty negativa) y la de una venta en dólares;
  `importeUsd` la pone en dólares cuando se puede (sin precio, null). Sirve para
  contrastar la comisión estimada (§6.9, cierre diario).
- `idCliente` ≤ 128 caracteres, único por carpeta de datos: lleva la sal de la
  carpeta (§6.7). Si el bróker ya tiene una orden con ese idCliente y es la
  misma (símbolo, lado e importe), se adopta; si es OTRA orden, `ErrorBroker`
  de tipo `'invalida'` (422) y no se apunta nada.
- `AlpacaBroker`: base `https://paper-api.alpaca.markets` fija; importes
  vienen como string → `Number()`. Posiciones cripto vienen como `BTCUSD` →
  `universo.desdeClave`. Para vender usar `qty_available`. No leer
  `pattern_day_trader` ni `daytrade_count` (retirados, ficha §0.1). En envío:
  si hay timeout o 5xx, **no reintentar a ciegas**: consultar
  `GET /v2/orders:by_client_order_id` y reenviar solo si no existe.
- Errores: `class ErrorBroker extends Error { status, tipo, reintentable, cuerpo }` con
  `tipo ∈ 'fondos'|'cantidad'|'invalida'|'lavado'|'limite'|'auth'|'red'|'mercado_cerrado'|'desconocido'`
  (`src/broker/errores.js`). 403 «insufficient buying power» → fondos; 403 «insufficient qty» → cantidad; 403 wash trade → lavado; 422 → invalida; 429 → limite; 401 → auth.
- `AlpacaBroker({ claveId, secreto, reloj, limitador, costes })`: `costes.comision`
  (sim → fracción, número o mapa; misma forma que en `BrokerSimulado`) es la
  tasa con la que se estima la comisión cripto de cada orden. Por defecto la de
  `COSTES_POR_DEFECTO` (`src/broker/comun.js`, la ÚNICA fuente de la tasa: la
  usan el simulado, las carteras sombra y esta estimación). 0 si se comprueba
  que paper no cobra.
- `BrokerSimulado({ capitalInicial = 100000, fuente /* {ultimos} */, reloj, ruta, calendario, costes })`:
  llena al instante al último precio ± deslizamiento; **imita a Alpaca en la
  comisión cripto**: en compras se cobra en el activo recibido (recibes
  `cantidad × (1 - comision)`), en ventas en dólares. Comisión cripto 0,25 %
  (taker nivel 1, ficha §4); acciones 0. Deslizamiento: BTC/ETH 5 pb, resto
  cripto 15 pb, ETF 2 pb. Sin margen: rechaza compras sin efectivo. Rechaza
  ventas mayores que lo disponible (no hay cortos). Rechaza acciones con el
  mercado cerrado. Persiste su estado en `ruta` (JSON atómico).

---

## 4. Cuant (A)

### 4.1 Indicadores (`src/mercado/indicadores.js`)

Todas devuelven un **array alineado con la entrada** (mismo largo, `null` donde
aún no hay datos) y son **causales**: el valor en `i` depende solo de `0..i`.

`sma(valores, n)`, `ema(valores, n)`, `rsi(valores, n)` (Wilder),
`atr(velas, n)` (Wilder, true range), `maximo(valores, n)` / `minimo(valores, n)`
(ventana que INCLUYE `i`), `rentabilidad(valores, n)` (c[i]/c[i-n]-1),
`volatilidad(valores, n, periodosAnio)` (desviación de log-rentabilidades
anualizada), `cierres(velas)`.

### 4.2 Régimen macro (`src/mercado/regimen.js`)

`calcularRegimen({ btcDiario: Vela[], spyDiario?: Vela[] }) → { valor: 'RISK-ON'|'NEUTRAL'|'RISK-OFF', puntos, detalle }`

Regla fija, documentada en el propio fichero:
- BTC cierre > SMA200 diaria: +1, si no −1.
- BTC SMA50 > SMA200: +1, si no −1.
- Volatilidad 30 d de BTC anualizada > 100 %: −1.
- SPY cierre > SMA200 (si hay datos): +1, si no −1.
- VIXY cierre > SMA50 de VIXY (si hay datos, desde el 30-sep-2026): −1, si no 0.
  Solo resta (como la volatilidad): el miedo subiendo empuja a la prudencia,
  nunca a RISK-ON. Solo cuenta con claves (Macro y el laboratorio lo piden si
  hay SPY y `datos.disponible('VIXY')`); sin claves no hay VIXY y el régimen es
  exactamente el de antes (ni componente ni texto). `calcularRegimen({ btcDiario,
  spyDiario, vixyDiario? })`, `regimenEnFecha(btc, spy, t, vixy?)`; componente
  `vixy_sobre_sma50`. Regla propuesta por el agente de datos: confirmar con
  Eduardo (umbral SMA50 y que solo reste).
- `puntos ≥ 2` → RISK-ON; `puntos ≤ −2` → RISK-OFF; si no, NEUTRAL.

`regimenEnFecha(btcDiario, spyDiario, t)` para el laboratorio y el backtest:
usa solo las velas diarias ya CERRADAS en `t`. Una vela de BTC (medianoche
UTC) cierra a `t + 1 día`; la de la SPY (medianoche de Nueva York) cierra al
terminar su sesión (16:00 ET o 13:00 en cierre temprano), como en vivo. Así una
decisión cripto de las 00:00 UTC ve la SPY del día anterior, y una de ETF al
cierre de la sesión ve la de ese día. Exporta `cierreVelaDiaria(t) → ms`, el
instante en que cierra la vela diaria que empieza en `t`.

### 4.3 Estrategias (`src/estrategias/<familia>.js` + `index.js`)

```js
module.exports = {
  familia: 'tendencia-sma',
  nombre: 'Tendencia SMA',
  descripcion: 'Largo cuando la SMA rápida cruza por encima de la lenta con el precio sobre la SMA filtro…',
  parametrosPorDefecto: { ... },
  rejilla: { ... },                       // producto cartesiano ≤ 30 combinaciones
  calentamiento(params) → número de velas,
  preparar(velasPorSimbolo /* {sim: Vela[]} mismo marco */, params) → prep,   // arrays causales precalculados
  decidir(prep, { simbolo, i, iAnterior? /* última vela decidida; por defecto i − 1 */,
                   posicion /* null o {cantidad, entrada, stop, maxPrecio, barrasAbierta} */, t, contexto }) → Senal,
  trailing(prep, { simbolo, i, posicion, params }) → nuevoStop | null,       // nunca por debajo del stop actual
  explicar(params, { universo, filtros, limites }) → Explicacion,           // desde el 30-sep-2026
  explicacion,                                                              // explicar(parametrosPorDefecto)
}

Explicacion = { queMira, cuandoCompra, cuandoVende, cuandoNada, riesgo, filtros /* string|null */ }
// Lenguaje llano para quien no sabe de bolsa, sin jerga o con la jerga explicada
// entre paréntesis. Las cifras salen de los parámetros de la mesa (y del límite de
// riesgo por operación si se pasa `limites`), nunca de un LLM. `explicarMesa(mesa,
// { limites })` de src/estrategias/index.js la hace con los params y filtros de una mesa.

Senal = {
  accion: 'abrir' | 'mantener' | 'cerrar' | 'nada',
  peso,              // 0..1, fracción del capital de la MESA para este símbolo si hay posición
  stop,              // precio de stop al abrir (obligatorio en 'abrir'), null si no aplica
  objetivoPrecio,    // null si la estrategia no usa objetivo
  motivo,            // técnico, CON las cifras (p. ej. 'SMA7 84.120 > SMA25 83.900; cierre 84.300 > SMA200 79.100'):
                     //   va a la propuesta y a decisiones.jsonl (§6.10)
  estado,            // lo que dice el operador en el chat y en su tarjeta, EN LLANO (30-sep-2026), en primera
                     //   persona y con las mismas cifras: 'No tengo SOL. Compro cuando su media de 7 velas de 4
                     //   horas cruce por encima de la de 25 con el precio sobre su media de 200.' o 'Mi regla dice
                     //   comprar SOL: … Si cae a 135,00 $, vendo (stop).' Sin «SMA7», «LONG», «top 2», «rebalanceo»
                     //   ni «ATR(14)» sueltos y ≤ plantillas.MAX (test/cuant-estrategias.test.js lo comprueba en
                     //   todas las velas de las cuatro familias). Ayudas en comun.js: px, tramoLlano, calentandoLlano,
                     //   bloqueoLlano (por qué un filtro no deja comprar, con su cifra).
}
```

`contexto` = `{ regimen, fg, filtros }`; `filtros` = lista de filtros activos
de la mesa (`src/estrategias/filtros.js`): solo bloquean `abrir`.

`iAnterior` lo pasa el vivo cuando se saltó velas (ordenador apagado o
dormido): un cruce (tendencia) o un rebalanceo (momentum) que cayó en
`(iAnterior, i]` se decide ahora, tarde, al cierre de `i`. Ruptura y reversión
lo ignoran: miran solo la vela `i` (si deben entrar tarde lo decide Eduardo).

Familias y valores por defecto (los de `propuesta-cuant.md`, no se optimizan en vivo):

| familia | marco | por defecto | stop |
|---|---|---|---|
| `tendencia-sma` | 4Hour | rápida 7, lenta 25, filtro 200 | 2,5 × ATR(14), trailing |
| `momentum-rotacion` | 1Day | cripto: lookback 28 ajustado por vol, top 2, rebalanceo semanal (lunes UTC), solo si rentabilidad > 0. ETF: lookbacks [63,126,252], top 2, mensual | 3 × ATR(14) de catástrofe |
| `reversion-rsi` | 1Day | RSI(2) < 10 y cierre > SMA200 → abrir; cerrar si cierre > SMA5 o tras 5 velas | 3 × ATR(14) |
| `ruptura-donchian` | 1Day | cierre > máximo 20 previo → abrir; cierre < mínimo 10 previo → cerrar | 2 × ATR(20) |

Peso: familias por activo → `1 / universo.length`; rotación → `1 / top` para
los elegidos.

`src/estrategias/filtros.js` — catálogo CERRADO (gramática del laboratorio):
`regimen-no-riskoff` (no abrir en RISK-OFF), `fg-max` (umbral ∈ {75, 80, 85, 90}),
`fg-min` (umbral ∈ {10, 15, 20, 25}), `vol-max` (percentil ∈ {80, 90} de la
volatilidad 30 d en su propia historia). Cada filtro: `{ id, parametros, permite(contexto) → boolean, descripcion }`.

`src/estrategias/index.js` exporta `FAMILIAS` (mapa familia → módulo) y
`mesasIniciales({ hayAlpaca }) → Mesa[]`:

```js
Mesa = { id, nombre, familia, marco, universo: [simbolo], params, filtros: [{id, parametro}], estado: 'titular'|'incubacion'|'banquillo', origen: 'inicial'|'laboratorio', nota,
         estudio? /* solo las de ETF, abajo */ }
Estudio = { fecha: 'AAAA-MM-DD', fuente /* el script */, anos, nombre? /* la candidata */, universo: [simbolo] /* el estudiado */, aprobada: boolean,
            cifras: { sharpeFueraDeMuestra, ventanasPositivas, sharpeDeflactado, rentabilidadAnual, comprarYMantenerAnual,
                      sharpeCompleto?, comprarYMantenerSharpe? /* desde la salida siguiente del estudio */ },
            exposicionMaxima /* con cuánto dinero invertido, como mucho, se hizo rentabilidadAnual (exposicionMaximaEstudio) */,
            avisos?: { <cifra>: texto } /* lo que hay que saber de una cifra, p. ej. un deflactado sin todos los ensayos */,
            umbrales: { sharpeFueraDeMuestra: 0.6, ventanasPositivas: 0.75, sharpeDeflactado: 0.9 } /* los CRITERIOS del laboratorio */,
            decision: { quien: 'Eduardo', que: 'sigue en prueba', peso: 0.02, porque: 'para verla en vivo' } }
```
Iniciales: `tendencia` (BTC, ETH, SOL · 4Hour), `momentum` (6 cripto), `reversion` (BTC, ETH),
`ruptura` (BTC, ETH, SOL), `momentum-ampliada` («Momentum cripto ampliada», las 6 +
XRP, LTC, BCH y ADA, en incubación con una nota que dice las cifras del 30-sep-2026)
solo si la fuente tiene sus 10 (`mesasIniciales({ hayAlpaca, disponibles })`: sin la
lista o en sintético no entra, sería un duplicado de Momentum); con claves además
`momentum-etf` (SPY, QQQ, IWM, TLT, GLD, DIA) y `reversion-etf` (SPY, QQQ).
Un fondo que ya existía recibe la ampliada y DIA con una migración idempotente al
arrancar (`orquestador._migrarUniverso`, §6.10 `migraciones`): mensaje en el feed
(canal direccion, tipo `contratacion`, `datos.migracion = 'universo-2026-09-30'`),
dos decisiones `asignacion` de `quien: 'humano'`, sin tocar ninguna posición; la
ampliada entra con el 2 % del efectivo sin asignar. Con DIA cambia la
referencia de Momentum ETF: su backtest (el de los 5 ETF de antes) se pone a
`null` y `backtestsPendientes` lo rehace con los 6 (la decisión lo dice y
guarda `backtestAnterior`). Un fondo que ya había migrado DIA con el backtest
viejo lo rehace una vez (`migraciones.backtestEtf`, decisión `asignacion` de
`quien: 'laboratorio'` con `datos.migracion = 'backtest-etf-2026-09-30'`, hito
`backtest` de la mesa en /api/estrategias, y nota del laboratorio en el feed).
Todo backtest de referencia guarda desde el 30-sep-2026 el `universo` de la
mesa con que se hizo; `laboratorio.backtestVigente(mesa)` es falso si la mesa
ya tiene otro, y entonces se rehace (revisión del 30-sep-2026: la columna
«Histórico», la lectura y el umbral de ascenso comparaban el papel con 6 ETF
contra el histórico de 5). Estado de arranque (decisión del 30-sep-2026):
`momentum` es la única **titular**; todas las demás arrancan en **incubación**
(2 %) y su `nota` dice por qué con la cifra: tendencia y reversión pierden con
costes, ruptura no diversifica frente a momentum (correlación diaria 0,80,
`scripts/estudiar-limites.js`) y las de ETF suspendieron el filtro del
laboratorio con 10 años de velas reales (`scripts/estudiar-candidatas.js`,
30-sep-2026): Momentum ETF, Sharpe fuera de muestra 0,19 (mín. 0,6), 69 % de
ventanas en positivo (mín. 75 %), Sharpe deflactado 0,48 (mín. 0,90), 2,1 %/año
con como mucho el 20 % invertido frente a 13,3 % de comprar y mantener, con
todo invertido; Reversión en índices (SPY, QQQ, IWM, DIA), 0,33, 56 %, 0,59 y
0,3 %/año (como mucho el 40 % invertido) frente a 15,3 %. Eduardo decidió que
sigan en prueba al 2 % para verlas en vivo: su `nota` lo dice en llano y la
mesa lleva su `estudio` (`ESTUDIOS_ETF`, `UMBRALES_FILTRO`; la prueba comprueba
que los umbrales son los `CRITERIOS` del laboratorio y que la nota lleva sus
cifras).

Revisión del 30-sep-2026 (la salida de aquel estudio no se guardó en git; el
script la deja ahora también en `docs/estudios/candidatas-AAAA-MM-DD.json`,
versionada):
- **Estudio y mesa son lo mismo.** Reversión ETF opera SPY y QQQ; el estudio
  fue de otra cartera, «Reversión en índices» (SPY, QQQ, IWM y DIA). Su nota y
  la vista lo dicen («Su cartera (SPY y QQQ) aún no se ha estudiado… Estas son
  sus cifras, no las de esta mesa»: `estudioDeOtraCartera(mesa)` y
  `textoEstudio(estudio, universoMesa)` de la vista), y
  `scripts/estudiar-candidatas.js` estudia ya cada mesa de ETF con SU universo
  (candidatas con `mesaId`, sacadas de `mesasIniciales`). Con las claves de
  Alpaca, la salida siguiente sustituye esas cifras, o Eduardo decide pasar la
  mesa a los 4 ETF (con migración). La prueba: toda mesa con estudio, también
  tras la migración, o tiene el mismo universo o lo dice.
- **Ensayos previos.** `ensayosPrevios` y `sharpesPrevios` iban dentro de un
  comentario del script: cada candidata se deflactaba como si fuera la
  primera. Arreglado (`test/cuant-candidatas.test.js`); el 0,59 de Reversión en
  índices (2.ª candidata) lleva el aviso `avisos.sharpeDeflactado` («sin
  contar las pruebas del estudio anterior: puede ser más bajo»). No cambia el
  veredicto: suspende también por las otras dos cifras.
- **Comparar lo comparable.** La rentabilidad del estudio se hizo con los
  límites duros (10 % por activo): como mucho el 20 % invertido con top 2, el
  40 % con cuatro activos (`exposicionMaximaEstudio(familia, universo,
  limites)`), y comprar y mantener lo tiene todo. La nota y la vista lo dicen al
  lado; con `cifras.sharpeCompleto` y `comprarYMantenerSharpe` (la salida del
  script ya los trae) la vista compara los Sharpe.
- **La nota de la ampliada sale de un estudio guardado.** Sus cifras (0,82 →
  0,58 con LTC y BCH; 0,74 → 0,56 con XRP) no tenían script ni salida, y no
  cuadraban entre sí: cada cripto nueva cotiza en Alpaca desde un día distinto
  (XRP desde ene-2024, ADA desde feb-2026) y cada par tiene su tramo.
  `scripts/estudiar-ampliada.js` (velas reales de cripto, sin claves; la
  configuración de la titular en `probar-backtest --real`: parámetros por
  defecto, costes, límites duros, mesa del 25 %) compara la titular con y sin
  las nuevas en el tramo en que cotizan todas, y deja
  `docs/estudios/ampliada-AAAA-MM-DD.json`; la nota dice cada par con su tramo
  y la prueba la compara con ese fichero.
- Un fondo que ya tenía las notas del 30-sep las cambia al arrancar
  (`NOTAS_ETF_SUPERADAS` con `notaEtfNueva → { nota, estudio, revision }`, y
  `NOTAS_SUPERADAS` con `notaRevisada → { nota, revision }` para la ampliada;
  `migraciones.notasRevision`): decisión `asignacion` de `quien:
  'laboratorio'` por mesa (`datos.migracion = 'notas-revision-2026-09-30'`,
  hito `estudio`) y una nota del laboratorio en el feed. Sin tocar peso ni
  estado.
Un fondo que ya existía cambia la nota de antes del estudio (`NOTA_ETF_ANTERIOR`,
«Sin validar con datos reales…») por la nueva al arrancar
(`orquestador._migrarNotasEtf`, con `notaEtfNueva(mesa)`): idempotente porque
solo toca una mesa con la nota vieja (una nota ya cambiada, o puesta a mano, no
se pisa), no cambia peso ni estado, deja una decisión `asignacion` de `quien:
'humano'` por mesa (`datos.migracion = 'notas-etf-2026-09-30'`, con la nota y el
estudio) y un mensaje del CIO en el canal direccion.
Pueden ascender por la regla del asignador (§5.7).

`plazoMesa(mesa) → { id: 'horas'|'dia'|'mes', nombre }` y `tiposMesa(mesa) →
[{ id, nombre }]` (30-sep-2026, para agrupar la vista Estrategias; el universo
puede venir por símbolo o por etiqueta): «Cada 4 horas» (marco 4Hour o 1Hour),
«Cada mes» (rotación con rebalanceo mensual: el de la mesa o, sin él, el del
perfil por su universo) y «Cada día o semana» (el resto: diarias y rotación
semanal); los tipos de su universo (§2) en el orden de `TIPOS`. `PLAZOS`, en
ese orden.

### 4.4 Dimensionado (`src/cuant/dimensionado.js`) — lo usan backtest y vivo

```js
dimensionar({ capitalMesa, peso, precio, stop, volAnual, patrimonio, limites, volObjetivo = 0.40 })
  → { nocional, cantidad, limitadoPor: 'peso'|'volatilidad'|'riesgo'|'maxActivo' }
// nocional = min( capitalMesa·peso,
//                 capitalMesa·peso·min(1, volObjetivo/volAnual),
//                 limites.riesgoPorOperacion·patrimonio / ((precio-stop)/precio),
//                 limites.maxPesoPorActivo·patrimonio )
```

### 4.5 Backtest (`src/backtest/motor.js`)

```js
backtest({ velas /* {sim: Vela[]} mismo marco */, estrategia, params, filtros = [], capital = 10000,
           costes /* { comision(sim), deslizamiento(sim), penalizacion } */, contexto /* (t) → {regimen, fg, volPercentil} */,
           limites, periodosAnio }) → { operaciones, curva: [{t, valor}], metricas, retornosDiarios: [{dia, r}] }
```
- Decide en el cierre de `i`; ejecuta en la **apertura de `i+1`** con
  deslizamiento, comisión y penalización de papel.
- Stop dentro de la vela: si `low ≤ stop` sale a `min(open, stop)` (con hueco).
- Trailing se actualiza al cierre y vale desde la vela siguiente.
- Operación: `{ simbolo, entradaT, entradaPrecio, salidaT, salidaPrecio, cantidad, pnl, pnlPct, comisiones, barras, motivoSalida: 'señal'|'stop'|'fin'|'hueco' }`.
- **Hueco en los datos de un símbolo** (más de 4 velas y más de 5 días sin
  ninguna, `comun.umbralHueco`; SOL en Alpaca, 6-jul-2023 → 26-ago-2024): al
  ver la primera vela de después, la orden pendiente caduca, lo abierto se
  vende al último cierre ANTERIOR al hueco (`motivoSalida: 'hueco'`) y el
  símbolo no decide hasta que sus indicadores ya no miran nada de antes
  (`comun.velasMemoria`). La primera vela de vuelta abre con el precio rancio
  (SOL: 18,14 $ con SOL a 157,25 $). `compraYMantener` hace lo mismo: vende al
  cierre anterior y vuelve a comprar en la apertura de la SEGUNDA vela de después.
- Hora de la decisión (`t` de `decidir` y del contexto): el cierre de la vela.
  En acciones diarias es el fin de la sesión (`regimen.cierreVelaDiaria`), no
  `t + 1 día`: el contexto no puede ver lo que pasó entre el cierre de Nueva
  York y la medianoche UTC.

### 4.6 Métricas (`src/backtest/metricas.js`)

`calcularMetricas({ curva, operaciones, periodosAnio })` →
`{ rentabilidad, cagr, sharpe, sortino, maxDD, operaciones, acierto, factorBeneficio, expectativa, exposicion }`
(Sharpe y Sortino sobre retornos DIARIOS agrupados por día UTC, anualizados
con √365 en cripto y √252 en acciones).
`normalCDF(x)`, `normalInv(p)`,
`sharpeDeflactado({ sharpe /*por periodo*/, n, ensayos, varianzaSharpes, asimetria, curtosis }) → { dsr, sharpeUmbral }`
(Bailey y López de Prado 2014).

### 4.7 Walk-forward (`src/backtest/walkforward.js`)

`walkForward({ velas, estrategia, filtros, entrenoMeses = 18, pruebaMeses = 6, minVentanas = 4, costes, contexto, limites, periodosAnio })`
→ `{ ventanas: [{ desde, hasta, params, metricasEntreno, metricasPrueba }], oos: { curva, metricas, operaciones }, combinaciones, sharpesEnsayos: number[] , suficiente: boolean }`.
Si no hay datos para `minVentanas`, prueba 12/3; si tampoco, `suficiente: false`.
En cada ventana elige la combinación de la rejilla con mejor Sharpe de
entrenamiento (con ≥ 5 operaciones). La curva OOS se encadena.

### 4.8 Laboratorio (`src/cuant/laboratorio.js`)

```js
validarHipotesis(h, { universo, familias }) → { ok, error }
// h = { id, familia, marco, universo:[sim], filtros:[{id, parametro}], params?, origen: 'leccion'|'exploracion', motivo }
async evaluarHipotesis(h, { cargarVelas(sim, marco) → Vela[], contextoHistorico(t), ensayosPrevios, sharpesPrevios: number[],
                            retornosMesasActivas: {mesaId: [{dia, r}]}, maxDDReferencia, costes, limites, pesoMesa })
  → { aprobada, criterios: [{ nombre, valor, umbral, ok, … }], walkforward, dsr, correlacionMax, paramsFinales, informe /* texto con cifras */ }
generarHipotesis({ mesas, pistas /* de postmortem.hipotesisDesdeLecciones */, semana, previas, ahora, diasSinRepetir = 90 }) → Hipotesis[]   // máx. 3
firmaHipotesis(h) → string          // el CONTENIDO: familia, marco, universo, filtros y los params que fija al generarse
describirHipotesis(h) → string
```
- `maxDDReferencia`: un número, o una función del tramo fuera de muestra que
  usará el walk-forward, `({ desde, hasta }) → número | { valor, mesaId }` (o su
  promesa). El laboratorio pasa la caída del backtest de la mesa vigente de la
  misma familia en ese mismo tramo; sin mesa de esa familia (o sin valor), la
  referencia es comprar y mantener el mismo universo en ese tramo. El criterio
  de caída lleva `referencia` y `fuenteReferencia` ('mesa <id>' o 'comprar y mantener').
- `sharpesPrevios`: los Sharpe de todos los ensayos anteriores (el laboratorio
  los guarda, como mucho 5.000). La varianza del DSR se calcula con ellos y los
  de esta hipótesis, no solo con los de esta.
- Sin repetir: `generarHipotesis` no propone una hipótesis cuya firma esté en
  `previas` (`[{ h, t, firma? }]`: evaluadas, pendientes y aprobadas) de los
  últimos `diasSinRepetir` días, ni la de una mesa viva (`mesa.firmaHipotesis`),
  ni dos iguales en la misma semana. El id lleva la semana dentro; la firma, no.
Criterios de aprobación (todos): Sharpe OOS ≥ 0,6; ≥ 3 de 4 (o 75 %) ventanas
de prueba con rentabilidad > 0; DSR ≥ 0,90 con el contador de ensayos; ≥ 30
operaciones OOS; maxDD OOS ≤ 1,5 × `maxDDReferencia`; correlación de retornos
diarios con cada mesa activa < 0,7. Costes = comisión + deslizamiento +
penalización de papel. Mapa pista→hipótesis (cerrado): `contra_regimen` →
añadir filtro `regimen-no-riskoff`; `stop_estrecho` → atrStop + 0,5;
`señal_falsa` → vecino más lento de la rejilla. `noticia` y `ejecucion` no
generan hipótesis (no hay histórico con qué probarlas).

---

## 5. Riesgo, cartera y aprendizaje (C)

### 5.1 Libros por puesto (`src/cartera/libros.js`)

Un **puesto** = (mesa × símbolo). Es la unidad de posición y de atribución.
El fondo real (bróker) = suma de puestos no-sombra.

```js
class Libros {
  constructor(json?)                       // desde serializar()
  asegurarPuesto({ puestoId, mesaId, simbolo, sombra = false })
  puesto(puestoId) → { puestoId, mesaId, simbolo, sombra, cantidad, costeMedio, stop, objetivoPrecio, abiertaT,
                       maxPrecio, barrasAbierta, riesgoInicial, regimenEntrada, realizado, comisiones, nOperaciones }
  aplicarEjecucion({ puestoId, lado, cantidad, precio, comision, t, motivo, idCliente, stop?, objetivoPrecio?, regimen? })
     → { operacionCerrada: Operacion | null }
  fijarStop(puestoId, stop)                // nunca baja mientras la posición sigue abierta
  marcarVela(puestoId, precioCierre)        // barrasAbierta++ y maxPrecio
  totalesPorSimbolo({ sombra = false }) → { [simbolo]: cantidad }
  valorar(precios /* {sim: precio} */, { sombra = false }) → { porPuesto, porMesa, exposicionBruta, exposicionCripto, exposicionPorActivo, posicionesAbiertas }
  escalarSimbolo(simbolo, factor, motivo)   // conciliación: reparte la diferencia a prorrata (comisión cobrada en el activo)
  serializar() → json
}
Operacion = { id, puestoId, mesaId, simbolo, entradaT, entradaPrecio, salidaT, salidaPrecio, cantidad, pnl, pnlPct, comisiones,
              motivoSalida: 'señal'|'stop'|'kill'|'riesgo'|'manual'|'prueba', barras, rMultiple, regimenEntrada, deslizamiento }
```
Coste medio ponderado en compras; en ventas el realizado es
`(precio − costeMedio)·cantidad − comisiones` (las de entrada a prorrata). Un
cierre parcial genera una Operación por la parte cerrada.

### 5.2 Conciliación (`src/cartera/conciliacion.js`)

`conciliar({ posicionesBroker, libros, tolerancia = 0.01 }) → { acciones: [{tipo:'escalar', simbolo, factor}|{tipo:'huerfana', simbolo, cantidad}|{tipo:'fantasma', simbolo, cantidadLibros}], grave, resumen }`.
Diferencia relativa ≤ tolerancia → escalar (comisión cobrada en el activo).
Mayor → grave. Posición en bróker sin puesto → huérfana. Puesto sin posición → fantasma.

### 5.3 Límites antes de cada orden (`src/riesgo/limites.js`)

```js
evaluarPropuesta(propuesta, ctx) → { decision: 'aprobar'|'reducir'|'vetar', nocional, cantidad, motivos: [{ limite, valor, maximo, texto }] }
propuesta = { puestoId, mesaId, simbolo, clase, lado, tipo: 'apertura'|'aumento'|'reduccion'|'cierre'|'stop'|'kill'|'prueba', nocional, cantidad, precio, precioT, stop, precioDecision,
              factorTamano? /* el factor de tamaño que ya lleva `nocional` (§6.7) */ }
factorTamano({ directivas, multiplicadorCaida, mesaId?, ahora }) → { total, comite, mesa, megafono, caida }
// total = comite (0,5 con el modo DEFENSIVO) × mesa (multiplicador del comité para esa mesa; sin mesaId, 1)
//         × megafono (la reducción vigente más dura) × caida (multiplicadorCaida). Solo aprieta.
ctx = { ahora, patrimonio, valoracion /* libros.valorar con, por símbolo, el máximo frente al bróker (exposicionConBroker) */,
        nivel: 'normal'|'solo_cerrar'|'bloqueado', multiplicadorCaida,
        directivas, ordenes: { ultimoMinuto, ultimaHoraPorMesa: {mesaId: n} }, mercadoAbierto: {accion: boolean}, limites }
```
- `bloqueado`: veta todo salvo `kill`.
- Reducciones, cierres y stops se aprueban siempre (reducen riesgo), aunque el precio sea viejo.
- Aperturas y aumentos: vetar si nivel ≠ normal, activo vetado, mesa pausada,
  `soloCerrar`, mercado cerrado (acciones), precio más viejo que el límite,
  desvío > `desvioMaxPrecio` entre `precioDecision` y `precio`, posiciones ≥
  máximo, órdenes por minuto o por mesa/hora agotadas. Después, el factor de
  tamaño y los topes: reducir para caber en `maxPesoPorActivo`,
  `maxExposicionBruta`, `maxExposicionCripto` y el riesgo por operación. Si
  tras reducir queda < `minNocionalOrden` → vetar.
- Factor de tamaño: lo aplica UN sitio, las mesas, sobre el nocional final de
  `dimensionar()` (§6.7). Aquí solo se comprueba, sin volver a multiplicar: si
  la propuesta trae `factorTamano` ≤ el que toca ahora, nada; si trae más (el
  Megáfono llegó entre la decisión y la orden), se recorta lo que falta
  (motivo `factorTamano`); si no trae ninguno (el tamaño no vino de las
  mesas), se aplica entero, parte a parte (`multiplicadorCaida`,
  `reduccionMegafono`, `modoDefensivo`, `multiplicadorMesa`).
- Cada motivo lleva texto con las cifras (lo lee la Jefa de riesgos en el chat).
- `valoracion` es la de los libros, pero con la cantidad de cada símbolo
  llevada al máximo entre libros y bróker: una posición del bróker sin puesto
  (huérfana) cuenta para `maxPesoPorActivo`, las exposiciones y el número de
  posiciones. La misma valoración la usan el comité y la cabecera (§7).

### 5.4 Vigilante (`src/riesgo/vigilante.js`)

```js
vigilar({ ahora, patrimonio, patrimonioInicioDia, pico, puestos /* con stop y precio */, precios, limites, nivelActual, soloCerrarHasta })
  → { nivel, multiplicadorCaida, acciones: [{tipo:'stop', puestoId, simbolo, precio, stop} | {tipo:'kill', motivo} | {tipo:'solo_cerrar', motivo, hasta}], alertas: [texto] }
```
Pérdida del día ≤ −2 % → `solo_cerrar` hasta las 00:00 UTC siguientes;
≤ −7 % → kill. Caída desde el máximo ≤ −10 % → `multiplicadorCaida` 0,5;
≤ −25 % → kill. `bloqueado` es pegajoso: solo sale con Reabrir humano.
Umbrales en `config.limites` (decisión del 30-sep-2026, antes −3,5 % y −15 %;
el porqué con cifras en `src/config.js` y `scripts/estudiar-limites.js`).

### 5.5 Carteras sombra (`src/cartera/benchmarks.js`)

`crearBenchmarks({ capital, preciosIniciales, hayAlpaca }) → estado` y
`valorarBenchmarks(estado, precios) → [{ id, nombre, valor, rentabilidad }]`:
`btc` (100 % BTC), `cesta-cripto` (6 cripto a partes iguales), y con claves
`spy` y `btc-spy` (50/50). Comprar y mantener, sin rebalanceo. La sombra
**«mismas mesas sin comité»** la calcula F con puestos `sombra: true`.

Qué compara exactamente «mismas mesas sin comité»: el fondo real frente a sí
mismo sin las decisiones del comité, y nada más. Por eso sufre todo lo que no
es el comité, igual que el fondo:
- Las mismas mesas, pesos, señales y stops (misma estrategia por puesto, con
  su propia posición), sin bróker: se llena al precio del latido con los costes
  del bróker simulado (comisión y deslizamiento), y las acciones con la bolsa
  cerrada esperan a la apertura en su propia cola (`estado.sombra.pendientes`).
- Los límites duros de §5.3 sobre su propia cartera (peso por activo,
  exposiciones, posiciones, riesgo por operación, precio viejo, desvío,
  mínimo por orden) y la caída desde SU máximo (×0,5 al −10 %). Tras un
  Reabrir humano después de un kill, la caída se mide, como la del fondo,
  desde la reapertura: el mismo Reabrir, en el mismo instante, le pone su
  propia referencia de vigilancia (`sombra.picoVigilancia`, su patrimonio al
  reabrir; sube con él y desaparece al volver a su máximo). Si siguiera
  midiendo desde su máximo, abriría a ×0,5 mientras el fondo abre a ×1 y esa
  diferencia se le cargaría al comité. Su máximo histórico (`sombra.pico`,
  cabecera e informes) no se toca.
- El nivel del fondo real: con `solo_cerrar` (pérdida del día), `pausado`
  (botón o conciliación) o `bloqueado` no abre nada, y tampoco decide
  aperturas: una de ETF decidida con la bolsa cerrada no se queda en su cola
  para comprarse al reabrir (el fondo, igual: con el nivel ≠ normal no deja
  nada en la cola del Ejecutor).
- El kill switch, manual o del vigilante: en el mismo instante se cierran
  todas sus posiciones, cada símbolo al precio medio al que lo vendió el fondo
  en ese kill (si el fondo no lo tenía o no llegó a venderlo, al precio de
  ahora con los costes del simulado; las acciones con la bolsa cerrada, a la
  apertura), y se descartan sus compras en cola. Luego no abre hasta Reabrir.
- Las directivas del Megáfono (solo cerrar, pausa de activo o de mesa,
  reducción de riesgo) y los vetos por noticias graves (no los decide el comité).
  Su factor de tamaño (§6.7) lleva el Megáfono y su caída, no el comité.

Lo único que no le llega son las decisiones del comité: el modo DEFENSIVO
(tamaño ×0,5) y SOLO_CERRAR, los multiplicadores por mesa
({0; 0,5; 1}) y sus vetos de 24 h (`origen: 'comite'`). Su patrimonio lo mide
su efectivo (`estado.sombra.efectivo`, parte del capital inicial) más sus
posiciones; su curva diaria (`sombras.curvas['sin-comite']`) se anota en el
cierre diario como la del fondo. Así, «fondo − sin comité» (Sharpe 90 d y
patrimonio) es lo que aporta el comité, sin cargarle el kill, las pausas, el
vigilante ni el Megáfono. Los stops de la sombra los mira el vigilante en cada
latido, como los reales (con el fondo bloqueado ya no tiene nada abierto).

### 5.6 Evaluador (`src/aprendizaje/evaluador.js`)

```js
metricasMesa({ operaciones, curvaDiaria: [{dia, valor}], penalizacionPapel, diasActiva })
  → { operaciones, acierto, factorBeneficio, expectativa, sharpe, sharpeAjustado /* ·n/(n+30) */, maxDD, adherencia, pnlTotal, diasActiva }
// adherencia = % de salidas por regla ('señal' o 'stop') sobre el total de salidas
sharpeRodante(curvaDiaria, dias = 90) → number|null
alarmaDeriva({ retornosPapel /* últimos 30 días */, muBacktest, sigmaBacktest }) → { alarma, z }
```

### 5.7 Asignador (`src/aprendizaje/asignador.js`)

```js
reasignar({ mesas: [{ id, estado, pesoActual, volHistorica, metricas, diasActiva, sharpeBacktest }], ahora })
  → { pesos: {id: w}, cambios: [{id, de, a, motivo}], despidos: [id], ascensos: [id], descartes: [id] }
```
Mensual. Base = paridad de riesgo (1/vol normalizado) entre titulares.
Objetivo = base × clamp(1 + sharpeAjustado, 0,5, 2). Sin cambio con < 20
operaciones o < 60 días. Peso nuevo = 0,7·actual + 0,3·objetivo; suelo 5 %,
techo 40 %; incubación fija 2 %; titulares normalizados a 1 − Σ incubación.
Despido (→ banquillo, peso 0: cierra sus puestos reales y no abre nada nuevo,
tampoco en la sombra «sin comité», que dimensiona con 0 $; lo que tenga
abierto en sombra se cierra por su regla): sharpeAjustado < −0,5 con ≥ 40
operaciones, o maxDD de la mesa > 25 %. Incubación ≥ 60 días: asciende si
sharpe papel > máx(0, sharpeBacktest − 1) y ≥ 10 operaciones; con menos de 10
sigue incubando hasta 180 días; si no, se descarta.
Con el techo del 40 %, lo que los titulares no pueden tomar queda en efectivo
(`cabecera.sinAsignar`, §7): en el arranque sin claves, una titular al 40 % y
tres incubadas al 2 % dejan el 54 %.

### 5.8 Semáforo «¿Listo para dinero real?» (`src/aprendizaje/paso-a-real.js`)

```js
evaluarPasoAReal({ ahora, creado, capitalInicial, patrimonio, operaciones, operacionesSombra, curvaDiaria,
                   curvasSombra /* sombras.curvas: btc, cesta-cripto, spy?, sin-comite */, hayAlpaca, penalizacionPapel,
                   caidaMaximaVista, incidentes, incidentesDesde, costeLLMUsd })
  → { listo, cumplidos, total, criterios: [Criterio], comite: { sharpeFondo, sharpeSinComite, bate, texto }, nota }
Criterio = { id: 'a'…'g', nombre, valor /* number|null */, umbral /* number|null */, ok, valorTexto, umbralTexto, detalle /* string|null */ }
```
Criterios de Eduardo (30-sep-2026); `listo` solo si se cumplen TODOS:
a) ≥ 180 días desde `creado`; b) ≥ 100 operaciones cerradas del fondo real
(sin `prueba` ni sombra); c) Sharpe anualizado (√365) de `curvaDiaria` desde el
arranque ≥ 0,7, con la penalización de papel de sus operaciones y al menos 30
retornos (si no, `valor` null y en rojo); d) ese Sharpe ≥ el mejor de comprar y
mantener BTC y la cesta cripto (con claves, también SPY; una curva que falta
deja el criterio en rojo); e) caída máxima ≤ 20 %: la peor de
`estado.caidaMaxima` (latido a latido) y de la curva diaria penalizada;
f) cero incidentes (§6.10) con `t` en los últimos 90 días y el registro
cubriéndolos (`ahora − incidentesDesde ≥ 90 días`); g) coste acumulado del LLM
(`llm.gastoTotal()`) < 10 % de `patrimonio − capitalInicial`; con beneficio ≤ 0
solo se cumple si el coste es 0. `comite` es informativo y no bloquea: si el
Sharpe del fondo no supera al de «mismas mesas sin comité» (también con la
penalización), el texto recomienda pasar a real sin comité. `nota` dice
siempre que el semáforo no activa nada: el código sigue siendo solo papel.

---

## 6. Agentes (D) e integración (F)

### 6.1 Departamentos, salas y plantilla (`src/agentes/registro.js`, D)

```js
DEPARTAMENTOS = [   // cada uno con `queHace`: una frase llana y sin cifras (pestaña Equipo, §8)
  { id: 'direccion',   nombre: 'Dirección',   color: '#f5b942', sala: 'direccion',   queHace },
  { id: 'macro',       nombre: 'Macro',       color: '#8b5cf6', sala: 'macro',       queHace },
  { id: 'analisis',    nombre: 'Análisis',    color: '#22c55e', sala: 'analisis',    queHace },
  { id: 'mesas',       nombre: 'Mesas',       color: '#3b82f6', sala: 'parque',      queHace },
  { id: 'riesgos',     nombre: 'Riesgos',     color: '#ef4444', sala: 'riesgos',     queHace },
  { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos',     queHace },
  { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio', queHace },
]
SALAS = ['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso']
crearPlantilla({ universo, mesas }) → Agente[]
Agente = { id, nombre, genero: 'f'|'m', departamento, rol, queDecide, queHace, usaLLM: boolean, sala, mesaId?, simbolo?, etiqueta?, puestoId? }
```
`genero` sale del nombre de pila (`NOMBRES`, y fijo en los puestos fijos) y es
el mismo que decide «Operador»/«Operadora» en el rol; la cara del panel lo usa
(barba solo en hombres, §8).
`queHace` (30-sep-2026): una o dos frases en lenguaje llano para alguien que no
sabe de bolsa; `queDecide` sigue siendo el técnico. Los activos de la
ampliación (`universo.generacion` 2) se nombran en una segunda vuelta, después
de todos los demás: su llegada no cambia el nombre de ningún agente que ya
estaba. VIXY (solo dato) no tiene analista ni puesto.
Ids fijos: `cio` (Presidenta del comité), `macro` (Estratega macro),
`analista-<ETIQUETA>` (uno por activo disponible), `riesgos` (Jefa de riesgos),
`ejecutor` (Ejecutor), `controller` (Controller), `laboratorio` (Director de
laboratorio), `auditor` (Auditor post-mortem), `puesto-<mesaId>-<ETIQUETA>`
(un operador por puesto). Nombres propios españoles deterministas (misma
entrada → mismos nombres). Los puestos de mesas nuevas se crean al contratar.

### 6.2 Bus de mensajes (`src/agentes/bus.js`, D)

```js
class Bus extends EventEmitter {
  constructor({ reloj, ruta /* mensajes.jsonl */, agentes /* para deNombre/departamento */, maxMemoria = 500 })
  registrarAgente(agente)
  publicar({ de, para = 'todos', canal, tipo, texto, datos = null, importancia = 1, costeUsd = 0, respondeA = null, hilo = null }) → Mensaje
  ultimos(n = 150, filtro? /* función, u objeto { canal, tipo, de, para, departamento, desde } */) → Mensaje[]
  desde(t) → Mensaje[]            // t ≥ desde (INCLUSIVO), de los que hay en memoria
  // emite 'mensaje'
}
Mensaje = { id, t, de, deNombre, departamento, para, respondeA, hilo, canal, tipo, texto, datos, importancia, costeUsd }
canal ∈ 'parque'|'analisis'|'macro'|'riesgo'|'ejecucion'|'comite'|'megafono'|'laboratorio'|'direccion'|'sistema'
tipo  ∈ 'estado'|'nota'|'regimen'|'senal'|'propuesta'|'aprobacion'|'veto'|'orden'|'ejecucion'|'cierre'|'alerta'
        |'comite'|'voto'|'decision'|'megafono'|'directiva'|'leccion'|'hipotesis'|'contratacion'|'despido'|'informe'|'sistema'|'descanso'
        |'reunion'   // apertura y resumen de las reuniones informativas (§6.9)
```
`datos` es lo que leen otros agentes; `texto` es para el humano.

**Conversación (30-sep-2026).** `para`: id del agente al que se dirige, `'humano'`
o `'todos'` (por defecto). `respondeA`: id del mensaje al que contesta, o
null. `hilo`: id del primer mensaje de la conversación, o null si el mensaje
va suelto; `hilo: true` al publicar abre una conversación nueva con el propio
id, y sin `hilo` pero con `respondeA` se hereda el del mensaje al que contesta.
La interfaz agrupa por `hilo` y enlaza por `respondeA`. Los hilos que hay
(`src/agentes/conversacion.js`, estado en §6.10):
- **Operación de un puesto**: la señal de abrir del operador lo abre; propuesta
  (para `riesgos`, «Marta, quiero comprar…») → aprobación, recorte o veto de
  Riesgos (para el operador, por su nombre de pila) → orden del Ejecutor
  («Recibido, Lucía y Marta: …») → ejecución (para el operador) → mientras
  dure la posición, la señal de cerrar o el stop, su propuesta, aprobación,
  orden y ejecución → cierre del operador → lección del Auditor (para el
  operador, contestando al cierre, en el cierre diario). Los avisos del
  Ejecutor de esa orden (bolsa cerrada, sin respuesta, rechazo) van en el
  mismo hilo. Una compra vetada acaba ahí su hilo.
- **Comité** (§6.8) y **reuniones** (§6.9): la apertura abre el hilo, cada
  turno contesta al anterior (`para`: quien habló antes) y la decisión o el
  resumen cierran.
- **Megáfono**: la orden del humano lo abre; propuesta de la Presidenta (para
  `humano`) → cada directiva aplicada → respuesta del agente al que le toca
  (para `humano`): Riesgos en reducir y solo cerrar, el primer operador de la
  mesa o del activo en pausas y reanudaciones.
- **Laboratorio**: cada idea (`hipotesis`) abre su hilo y su resultado le contesta.

**Ids deterministas.** `id = <t en base 36>-<sesión><n en base 36>`; un bus
nuevo sigue la numeración (y la sesión) del último mensaje de su
`mensajes.jsonl` (`'000'` en un fichero nuevo; al azar solo si no se puede
leer). Así ningún id se repite en el fichero y el continuo y el latido a
latido dan los mismos ids: `respondeA` e `hilo` los citan
(`scripts/probar-latido.js` los compara).
`desde` es inclusivo: con el reloj acelerado muchos mensajes comparten
instante, y quien pagina con el último `t` visto perdería los publicados
después en ese mismo `t`. Los que ya tenía vuelven a llegar y se reconocen
por su `id` (la interfaz deduplica por `id`).

### 6.3 LLM (`src/agentes/llm.js`, D)

```js
crearLLM({ apiKey, modeloComite, modeloAgentes, presupuestoDiaUsd, reloj, rutaCostes, cliente? /* inyectable */, fetch? })
  → {
    activo,                                   // hay clave y no se desactivó por 401
    async pedirJSON({ uso: 'comite'|'agentes', proposito, sistema, entrada /* objeto */, instrucciones, esquema, maxTokens = 2000, esfuerzo })
      → { ok: true, datos, costeUsd, modelo, tokens } | { ok: false, motivo: 'sin_clave'|'presupuesto'|'rechazo'|'error'|'esquema', detalle },
    gastoHoy() → usd, estado() → { activo, modeloComite, modeloAgentes, gastoHoyUsd, presupuestoDiaUsd, llamadasHoy, ultimoError },
    gastoDelDia(dia /* 'AAAA-MM-DD' UTC, de los últimos 8 */) → usd,   // día del DINERO (tiempo real), no el simulado
    gastoEntre(desde, hasta) → usd,                                     // desde < t ≤ hasta, ms de tiempo real
    gastoTotal() → usd,                       // todo llm-costes.jsonl + lo de la sesión (criterio g del semáforo, §5.8)
    fijarModelos({ modeloComite, modeloAgentes }), fijarPresupuesto(usd),
  }
```
Por defecto (`src/config.js`, 30-sep-2026): comité `claude-opus-5-5`, agentes
`claude-haiku-4-5` (solo redactan y clasifican con listas cerradas) y tope de
1 $/día (`LLM_MODELO_COMITE`, `LLM_MODELO_AGENTES`, `LLM_PRESUPUESTO_DIA_USD`).
Forma de la petición (verificada contra la referencia de la API, 29-sep-2026;
Haiku 4.5 comprobado el 30-sep: admite `output_config.format`, rechaza `effort`
y no tiene salvavidas del servidor):
- `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-opus-5`, `claude-fable-5-1`:
  `client.beta.messages.create({ model, max_tokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort, format: { type: 'json_schema', schema } }, system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] })`.
  Sin `thinking`, sin `temperature`. Esfuerzo por defecto: comité `medium`, agentes `low`.
- `claude-haiku-4-5` y cualquier otro: `client.messages.create({ model, max_tokens, output_config: { format }, system, messages })`, sin `effort` ni `fallbacks`.
- `new Anthropic({ apiKey, timeout: 60000, maxRetries: 2 })`, pero cada petición
  lleva los suyos: `timeout` = maxTokens × 40 ms, entre 60 s y 600 s (un
  no-streaming de 4.000 tokens tarda más de 60 s), y `maxRetries: 1`, porque
  cada intento cortado puede haberse cobrado.
- Mirar `stop_reason` antes de leer: `refusal` → `motivo: 'rechazo'`; `max_tokens` → error. Leer el primer bloque `text`, `JSON.parse`, validar contra el esquema (validador mínimo propio: tipos, required, enum, additionalProperties) → si falla, `motivo: 'esquema'`.
- Errores con la cadena tipada del SDK: `AuthenticationError` (desactiva el LLM y lo dice), `RateLimitError`, `APIConnectionError`, `APIError`.
- Coste con `usage` y la tabla por MTok (entrada/salida/lectura caché/escritura caché):
  opus-5-5 4/20/0,20/5 · sonnet-5-5 2/10/0,20/2,5 · haiku-4-5 1/5/0,10/1,25 · opus-5 5/25/0,50/6,25 · fable-5-1 10/50/0,25/12,5.
  Cada llamada se apunta en `llm-costes.jsonl`: `{ t, proposito, modelo, entrada, salida, cacheLectura, cacheEscritura, costeUsd, ok, motivo, ms }`.
- Presupuesto diario (UTC): antes de llamar se estima el máximo (≈ caracteres/3 de entrada + `maxTokens` de salida); si no cabe, `motivo: 'presupuesto'`.
  En los modelos con salvavidas del servidor la reserva incluye el segundo
  intento en el destino más caro (`claude-opus-5` / `claude-opus-4-8`). Una
  llamada cortada por timeout llegó al servidor y puede estar cobrada: se
  apunta como gastado lo reservado × (1 + reintentos), con `estimado: true` en
  `llm-costes.jsonl`. El resto de errores (401, 429, 5xx, sin conexión) cuentan 0.
  Con `rutaCostes`, mirar el tope y reservar se hace en disco y bajo un cerrojo
  corto, compartido por todas las instancias y procesos (`src/agentes/reservas-llm.js`,
  `data/llm-reservas.jsonl`); una reserva vencida sin cerrar (proceso muerto a
  mitad) se apunta con `estimado: true, huerfana: true`. En el modo latido,
  `crearLLM` recibe además `limiteLlamadaMs` (45 s), `reintentos` (0) y
  `plazo()` (ARQUITECTURA-WEB W2).

`src/agentes/cifras.js` (D): `verificarCifras(texto, entrada, { conteos = false } = {}) → { ok, noEncontradas: [] }`. Extrae
números del texto (formatos 1.234,56 · 1,234.56 · 12 % · 3,5 $) y los busca
entre todos los números de `entrada` (aplanada; se aceptan redondeos a 0-2
decimales y porcentajes ×100). Signo: un «+» o «−» escrito pegado al número
tiene que coincidir con el del dato («+523,40 $» no pasa si el dato es
−523,40); sin signo escrito se compara el valor absoluto. Enteros 0-31 sin
unidad ni signo se aceptan siempre (conteos, días, horas); con unidad
(«12 %», «5 $») o con signo («+3»), no: son cifras que hay que encontrar.
Una hora de reloj (16:00) solo pasa si esa hora está en los datos. Con
`{ conteos: true }` (reuniones y comité, donde lo que se cuenta son
operaciones, posiciones y órdenes; revisión del 30-sep-2026) esos enteros
pequeños también tienen que estar en los datos, y también los escritos con
letra («cuatro», «ninguna»; no «un/una», que son artículos).

`vocabulario(texto) → { modos, compras, regimenes }` y
`contradiceVocabulario(texto, { modos: [], compras = modos, regimen = null }) → boolean`
(mismo fichero, 30-sep-2026): el modo, el voto y el régimen que dice un texto,
por su nombre en cualquier forma («DEFENSIVO», «modo defensivo», «solo
cerrar») o en llano («a la mitad», «tamaño normal», «no se abre nada»; «el
mercado acompaña», «ni a favor ni en contra», «tiene miedo»), sin distinguir
mayúsculas. «nivel normal/solo cerrar» (el del fondo) y «el índice de miedo y
codicia» no cuentan. Un texto del LLM que diga algo fuera de lo permitido se
descarta: ahí no hay cifras y `verificarCifras` no lo ve. Las frases de
`plantillas.MODO_TEXTO`, `REGIMEN_TEXTO` y `NO_COMPRA` se reconocen como su
valor (`test/agentes-cifras.test.js`).

### 6.4 Plantillas (`src/agentes/plantillas.js`, D)

Funciones puras que convierten datos en frases en español, usando
`src/util/formato.js`. Mínimo: `estadoPuesto`, `notaAnalista`, `regimen`,
`propuesta`, `aprobacion`, `veto`, `ejecucion`, `cierre`, `stopSaltado`,
`informeComite` (una por jefe), `decisionComite`, `directiva`, `leccion`,
`hipotesis`, `resultadoHipotesis`, `contratacion`, `despido`, `informeDiario`,
`informeSemanal`, `descanso`, `killSwitch`, `soloCerrar`, `reabrir`,
`conciliacion`. Firmas que no son obvias:
`directiva(d, mesas?)` y `decisionComite(d, mesas?)` nombran las mesas por su
nombre («Ruptura Donchian», no «ruptura») si reciben la lista de mesas;
`informeDiario({ dia, desde?, hasta?, patrimonio, pnlDia, pnlDiaPct, operaciones, acierto, gastoLLMUsd })`
dice el tramo real si el cierre no cubre 24 h (portátil apagado a las 00:05);
`reabrir({ quien, patrimonio, pico })` dice con cifras cuánto está el fondo por
debajo de su máximo histórico.
`comoCompra({ modo, nivel?, factor?, soloCerrarHasta? })` (30-sep-2026) es lo
que el fondo hace de verdad con las compras nuevas, y lo usan
`decisionComite`, `reunion.resumenManana` y `reunion.resumenCierre` (que
reciben esos mismos campos): con el fondo fuera del nivel normal, «el fondo no
compra nada: …» con su motivo y hasta cuándo (`NO_COMPRA`: el kill y la pausa,
hasta Reabrir; la pérdida del día, hasta las 00:00 UTC) en vez de explicar el
modo; con el «solo cerrar» del Megáfono, hasta su hora; con un factor
(`mesas.factorTamano`: `{ total, comite, megafono, caida }`) que recorta más
que el modo, el factor real y por qué («compras nuevas a ×0,25 del tamaño
normal por el modo DEFENSIVO y la caída del fondo»). `comprasEfectivas(mismos
datos) → 'NORMAL'|'DEFENSIVO'|'SOLO_CERRAR'|null` dice a qué modo equivale eso
(null: otro factor) para el control de los textos del LLM.

Frases cortas (≤ 220 caracteres, `plantillas.MAX`), con cifras, sin adjetivos
vacíos. **Tono llano (30-sep-2026)**: para alguien que no sabe de bolsa, en
primera persona del agente, sin siglas sin explicar (RSI, stop, Sharpe llevan
su explicación al lado), con las MISMAS cifras de sus datos (ninguna plantilla
calcula una cifra nueva; `test/agentes-plantillas.test.js` pasa cada salida
por `verificarCifras` contra sus datos más las escalas fijas 50, 90 y 200 días
y RSI sobre 100). Los nombres de modo y régimen (NORMAL…, RISK-ON…) se dejan,
con lo que significan al lado (`MODO_TEXTO`, `REGIMEN_TEXTO`). Las que
contestan a alguien reciben `a` (nombre, o solo el de pila) y empiezan por él.
Ejemplo de nota: «Ethereum vale 2.560 $ y sigue en subida: está por encima de
su precio medio de los últimos 50 días (2.480 $). Ojo: ha subido muy deprisa
(RSI 71 de 100) y podría tomarse un respiro.» Nuevas: `orden({ etiqueta, lado,
tipo, nocional, cantidad, a: [nombres] })`, `aperturaComite({ hora, motivo,
primero })`, `respuestaMegafono(d, { mesas, a })`, `reunion.<turno>(datos)`
(§6.9), `pila(nombre)`; `regimen` acepta `componentes` (razones llanas de
cada componente); `notaAnalista`, `nombre` del activo; `informeComite(jefe, {
…, anterior })` empieza dando las gracias a quien habló antes. La espera y la
señal de cada estrategia («No tengo SOL. Compro cuando su media de 7 velas de
4 horas cruce por encima de la de 25 con el precio sobre su media de 200.») las
escribe la estrategia en llano (§4.3, `estado`) y se respetan.

### 6.5 Megáfono (`src/agentes/megafono.js`, D)

Lista CERRADA de directivas (solo aprietan; caducan):
```js
{ tipo: 'reducir_riesgo', factor: 0.25|0.5|0.75, horas: 1..72 }
{ tipo: 'pausar_activo', simbolo, horas }      { tipo: 'pausar_mesa', mesaId, horas }
{ tipo: 'solo_cerrar', horas }
{ tipo: 'reanudar_activo', simbolo }           { tipo: 'reanudar_mesa', mesaId }   // solo deshacen un apretón previo
{ tipo: 'sin_efecto', motivo }
```
`async interpretar(texto, { llm, universo, mesas, directivas?, ahora?, horasPorDefecto = 4 }) → { directivas, explicacion, fuente: 'llm'|'palabras_clave' }`
(`horasPorDefecto`: la duración si la orden no dice cuánto; el orquestador pasa
`COMITE_HORAS`, hasta el comité siguiente. `directivas` y `ahora`: para que un
«reanuda» solo deshaga una pausa del Megáfono vigente),
`revalidar(interpretacion, { universo, mesas, directivas?, ahora?, texto? })` → lo mismo que
`interpretar`, para una interpretación hecha FUERA del cerrojo (modo web): cada
directiva pasa otra vez por `validarDirectiva` contra el estado de ahora, sin
llamar al LLM; la explicación de fuera solo se conserva si ninguna directiva
cambió. El orquestador la recibe por un canal interno,
`comando('megafono', { texto }, { interpretacion })`, que el cuerpo de una
petición HTTP nunca alcanza (el modo local pasa solo `datos`).
`validarDirectiva(d, ctx)`, `aplicarDirectiva(directivas, d, ahora) → directivas`,
`directivasVigentes(directivas, ahora)`. Sin LLM: palabras clave («pausa»,
«para», «reduce», «baja», «solo cerrar», «no abras», «reanuda» + etiqueta o
nombre de mesa). El humano confirma con «Aplicar» antes de que entre. La
explicación del LLM solo se enseña si sus cifras están en la orden o en las
directivas; el motivo de un `sin_efecto` del LLM, solo si sus cifras están en
la orden o en las reglas (si no, un motivo fijo).

### 6.6 Post-mortem (`src/agentes/postmortem.js`, D)

`CATEGORIAS = ['señal_falsa','stop_estrecho','contra_regimen','noticia','ejecucion','acierto_de_libro','suerte']`
(las lecciones de las reglas y las que se piden al LLM, en llano desde el
30-sep-2026: se las dice el Auditor al operador, §6.2)
`clasificarReglas(operacion) → { categoria, leccion }` (reglas fijas:
ganadora por regla → acierto_de_libro; ganadora por kill/riesgo → suerte;
perdedora con régimen RISK-OFF en la entrada → contra_regimen; perdedora por
stop en ≤ 2 velas → stop_estrecho; perdedora con deslizamiento > 0,5 % →
ejecucion; resto → señal_falsa).
`async lote({ operaciones, llm }) → [{ operacionId, mesaId, simbolo, motivoSalida, categoria, leccion, fuente: 'llm'|'reglas' }]` (una
llamada al día; el LLM elige categoría del enum y escribe la lección; la
lección pasa por `verificarCifras` contra los datos de SU operación). La
categoría del LLM tiene que cuadrar con el signo del P&L (una ganadora solo
`acierto_de_libro` o `suerte`; una perdedora, pnl ≤ 0, el resto) y la lección
no puede decir «ganó» en una perdedora ni «perdió» en una ganadora: si no, sale
por reglas. `hipotesisDesdeLecciones(lecciones30d) → [{ mesaId, categoria, n }]`
con n ≥ 5; no cuentan las operaciones cerradas por `kill`, `manual` o `prueba`
(`SALIDAS_SIN_PISTA`): no las cerró la regla de la mesa. Las lecciones
guardadas antes de llevar `motivoSalida` lo toman de su operación
(`operacionId`) al sacar las pistas de la semana.

### 6.7 Flujo de una operación (F)

```
cierre de vela del marco de la mesa
 → Operador del puesto: estrategia.decidir()          [bus: 'senal' / 'estado']
 → capital de mesa = patrimonio · peso
 → dimensionar() → nocional base (el menor de todos sus topes)
 → nocional = nocional base · factor de tamaño         [bus: 'propuesta']
   factor = (0,5 si modo DEFENSIVO) · multiplicador de la mesa · reducción del Megáfono · multiplicadorCaida
 → Jefa de riesgos: evaluarPropuesta()                 [bus: 'aprobacion' | 'veto']
 → Ejecutor: registro de INTENCIÓN en ordenes.jsonl → enviarOrden() → esperarEjecucion()   [bus: 'orden', 'ejecucion']
 → libros.aplicarEjecucion()                           [bus: 'cierre' si se cierra]
 → (en paralelo, el puesto sombra «sin comité» hace lo mismo sin bróker y sin las decisiones del comité: §5.5)
```
- Factor de tamaño (`mesas.tamanoApertura`, con `limites.factorTamano`): va
  sobre el nocional FINAL de `dimensionar()`, después de todos sus topes. Así
  ×0,5 es ×0,5 aunque mande el riesgo por operación o el tope por activo; en
  el capital de la mesa no llegaba (con DEFENSIVO, 7 de 33 compras salían a
  ×1). Lo aplica ese único sitio y la propuesta lo dice (`factorTamano`);
  Riesgos lo comprueba sin volver a multiplicar (§5.3). La sombra «sin
  comité» usa su contexto de Riesgos: Megáfono y su caída sí, comité no. Una
  mesa a ×0 se propone como ×1 para que Riesgos la vete con su motivo. Los
  topes de exposición de Riesgos (con lo ya abierto) van después, así que una
  compra ejecutada puede quedar por debajo del ×0,5 si no cabe.
- `idCliente = mt-<sal>-<mesaId>-<CLAVE>-<velaISO compacta>-<accion>-<n>` (≤ 128).
  `sal` = `estado.creado` (instante en que se creó el estado.json de esa
  carpeta) en segundos y base 36: el contador `n` solo conoce el
  `ordenes.jsonl` de su carpeta, y otra carpeta sobre la misma cuenta paper
  repetiría el id de una orden vieja (Alpaca devolvería la vieja como si fuera
  la nueva). Un id nunca se reutiliza en la misma carpeta.
  Al arrancar, toda orden en INTENCIÓN/ENVIADA/DESCONOCIDA sin estado final se
  consulta por `idCliente` antes de nada; si el bróker no la conoce (404), no
  llegó y se abandona (no se repite: la decisión ya es vieja). Una decisión por
  puesto y vela (`ultimaVela` por mesa en el estado). Si se saltaron velas
  (ordenador apagado o dormido), al volver se marcan una a una (barras
  abiertas y trailing del stop), la decisión recibe `iAnterior` (§4.3) y la
  mesa avisa de cuántas velas se saltó.
- Un error de red al enviar NO es un rechazo: la orden pudo entrar. Queda en
  vuelo como DESCONOCIDA, bloquea otras de ese símbolo y aplaza la conciliación
  hasta saber por su idCliente si existe. Una orden en vuelo que lleva 60 s sin
  estado final (cripto `gtc` llenada a medias fuera del collar) se cancela
  (`cancelarOrden`): lo ejecutado se apunta y el resto lo vuelve a pedir quien
  lo pidió.
- Órdenes de un mismo símbolo, en serie (esperar la ejecución antes de la
  siguiente): evita el rechazo anti-lavado (ficha §0.6).
- Ventas: `min(cantidad del puesto, disponible en el bróker)`. Justo antes de
  vender se concilia ese símbolo con la regla de §5.2 (si libros y bróker
  difieren menos de la tolerancia, se escala): si no, una venta que llega
  antes que la conciliación del latido (un stop, el kill, la prueba) dejaría
  en los libros un resto fantasma.
- Acciones con el mercado cerrado: la decisión queda pendiente y se envía en
  la apertura + 5 min. Una apertura pendiente se vuelve a dimensionar con el
  capital y el factor de ese momento (los comités de la noche, el DEFENSIVO,
  una mesa que pasó al banquillo, que ya no abre) y pasa por Riesgos con el
  precio de entonces (el desvío frente a la decisión la puede vetar). El
  puesto sombra tiene su propia cola (`estado.sombra.pendientes`) con la misma
  regla: si no, la sombra «sin comité» no tendría nunca ETF. Con el fondo en
  un nivel ≠ normal ni el fondo ni la sombra dejan aperturas en cola (Riesgos
  veta la del fondo en el acto; la sombra no la decide), y el kill vacía las
  compras de las dos colas.
- Stops: el vigilante los mira en cada latido con el último precio; si saltan,
  venta a mercado con `tipo: 'stop'`. Aviso permanente en pantalla: con el
  ordenador apagado no hay stops (en cripto no existen órdenes stop simples).

### 6.8 Comité (F: `src/agentes/comite.js`)

Cada `COMITE_HORAS` (alineado a 00, 04, 08… UTC) o a demanda. Orden del día
fijo, cada punto es un mensaje en el canal `comite`:
1. Controller: patrimonio, P&L del día, caída, exposición.
2. Estratega macro: régimen y por qué. Voto: RISK-OFF → DEFENSIVO.
3. Jefa de riesgos: límites cerca de saltar, vetos del periodo. Voto: nivel ≠ normal o caída ≤ −5 % → DEFENSIVO. **Su voto es veto: si dice DEFENSIVO, no puede salir NORMAL.**
4. Mesas: mejor y peor por P&L del periodo.
5. Laboratorio: hipótesis en curso.
6. Megáfono: lo pendiente.
7. Presidenta: decisión.

La decisión: una llamada al LLM (`uso: 'comite'`) que devuelve
```json
{ "modo": "NORMAL|DEFENSIVO|SOLO_CERRAR", "multiplicadores": { "<mesaId>": 0|0.5|1 }, "vetos": ["<simbolo>"], "razon": "…", "intervenciones": [{ "agente": "<id>", "texto": "…" }] }
```
(multiplicadores solo {0, 0,5, 1}; vetos 24 h). Sin LLM, o si no valida:
plan por defecto = modo por mayoría de votos (en empate, el más prudente),
multiplicadores 1, vetos los activos con evento grave de noticias. Las
`intervenciones` sustituyen a las plantillas de los puntos 1-6 solo si pasan
`verificarCifras` contra los datos de SU punto (`{ hora, [punto]: … }`, más
los límites en el de Riesgos), con `{ conteos: true }`, y no dicen un voto, un
modo o un régimen distinto del calculado, ni por su nombre ni en llano
(`contradiceVocabulario`, §6.3): Macro y Riesgos solo pueden decir su voto; los
demás puntos no hablan de modo; el régimen, solo el de Macro. El voto publicado
de Macro y Riesgos es siempre el del código. La `razon` del LLM solo sale si no
hubo veto de Riesgos (con veto, el modo aplicado no es el que razonó), no
nombra otro modo y lo que dice de las compras es lo que pasa con la decisión
ya aplicada (`plantillas.comprasEfectivas`: nada con el fondo fuera del nivel
normal). La decisión dice lo que el fondo hace de verdad con las compras
(`plantillas.comoCompra`): con el fondo bloqueado, en pausa o en solo cerrar,
«Decido: modo DEFENSIVO, el plan por defecto. Ahora el fondo no compra nada:
…». Durante el comité, los
jefes van a la sala de comité (evento `agente`); las pausas entre puntos son
solo de pantalla y `detener()` las corta.

Conversación (30-sep-2026, §6.2): la apertura de la Presidenta abre el hilo y
da la palabra al Controller («Inés, empiezas tú.»); cada punto contesta al
anterior (`respondeA`, `para`: quien habló antes) y, con plantilla, empieza
dándole las gracias por su nombre de pila («Gracias, Inés. Por mi parte: …»).
El voto se dice «Mi voto: DEFENSIVO (compras nuevas a la mitad)». La
decisión cita a quien vetó («Marta ha votado DEFENSIVO y su voto es veto: no
puede salir NORMAL.») o a quienes votaron distinto, y un voto recalculado al
cerrar lo dice con su nombre. Al LLM se le dan los nombres de pila
(`participantes`) y se le pide tono llano, primera persona y dirigirse a quien
habló antes; su texto pasa los mismos controles de siempre.

Datos frescos: el comité tarda (pausas de pantalla, la llamada al LLM) y el
latido sigue mientras tanto. Cada punto se redacta con el estado del momento
en que se publica (`reunirDatos` otra vez, también el voto) y la intervención
del LLM, pedida con los datos del principio, solo sale si cuadra con los de
ese momento. Si desde que se abrió la reunión cambió algo de ese punto, lo dice
quien lo presenta: el nivel del fondo en el de Riesgos («Durante el comité el
fondo ha pasado de bloqueado a normal: un humano ha reabierto el fondo»), el
kill en el del Controller, el régimen en el de Macro y el Megáfono aplicado en
el suyo (el orquestador anota en memoria, numerado, lo que un humano pulsa:
Reabrir, Pausar, kill y Megáfono aplicado). La decisión se toma con el estado
del final de la reunión: votos y plan por defecto recalculados; si un voto ya
dicho en su punto cambió, la decisión lo dice («Votos recalculados al cerrar:
Riesgos DEFENSIVO (dijo NORMAL; el fondo está ahora en pausa)»). Si los votos
del final no son los del principio, la decisión del LLM (tomada con los de
antes) no se aplica: plan por defecto con los del final, y
`motivoPlanPorDefecto` dice por qué. La razón del LLM se comprueba con los
datos del final.

### 6.9 Cadencias del orquestador (F: `src/orquestador.js`)

En cada `paso()` (tiempo real: cada 60 s; sintético: cada 5 min simulados):
precios (con Alpaca, cada 5 min `relojMercado`) → valorar → cierre diario (si
toca) → vigilante → órdenes en vuelo → conciliación → macro y análisis
(noticias en segundo plano) → comité (en segundo plano) → pendientes de la
bolsa (real y sombra) → mesas con vela nueva → semanal y mensual → descansos →
curva → estado.json → emitir estado. El cierre diario va ANTES que el
vigilante: al despertar el portátil tras las 00:05, el vigilante mide ya con
la referencia del día nuevo.
- Analistas: con cada vela 1H cerrada, nota técnica (se publica si cambia el sesgo o cada 4 h).
- Macro: régimen con cada vela 1H; mensaje si cambia o cada 4 h. Miedo y codicia cada hora.
- Noticias (con claves, fuera del sintético): cada hora se traen y cada una
  nueva se guarda en `data/noticias.jsonl` (§6.10), con LLM o sin él. Con LLM,
  cada 4 h en lote se clasifican las que esperan (últimas 24 h) → eventos
  graves bloquean aperturas 24 h en ese activo. Sin LLM se guardan sin
  clasificar (`clasificacion: null`) y no vetan. En sintético no hay noticias
  (no se inventan titulares).
  Solo se marcan vistas tras clasificarlas con éxito (si la llamada falla,
  entran en el lote siguiente) y una noticia solo veta activos que menciona;
  titular y resumen van al LLM como texto de terceros, nunca como instrucciones.
- Historial: al final de cada paso, una línea por hora de reloj en
  `data/historial.jsonl` (§6.10).
- Comité: cada 4 h y a demanda.
- Reuniones informativas (`src/agentes/reuniones.js`, 30-sep-2026), hora de
  Madrid con el reloj de la mesa y su cambio de hora: «Reunión de la mañana» a
  las 9:00 (Controller: la noche desde el cierre del día anterior, con el
  patrimonio y las operaciones cerradas; Macro: el ambiente y el miedo y
  codicia; Riesgos: nivel, lo que está cerca de sus límites y los activos
  vetados; cada operador con posición: qué tiene, cómo va y su stop;
  Presidenta: resumen con el modo y el próximo comité) y «Cierre del día» a
  las 22:15 (Controller: resultado del día UTC y operaciones cerradas; Riesgos:
  lo que queda abierto; Presidenta: cierra). Solo cuentan: NO cambian modo,
  multiplicadores ni vetos. Canal `direccion`: apertura y resumen con tipo
  `reunion`, turnos con `informe`; `datos: { reunion: 'manana'|'cierre',
  turno?, fase?, fuente }`. Los jefes van a la sala de comité como en el
  comité y se quedan hasta `estado.comite.salaHasta`: `SALA_TRAS_REUNION_MS`
  (`src/agentes/comite.js`), 15 min del reloj de la mesa tras un comité o una
  reunión (antes 5 en el modo latido, y Eduardo no llegaba a verlo), en el
  modo latido y en el local (opción `salaTrasComiteMs`). Solo visual. Van después del
  comité del mismo paso (en invierno las 9:00 son las 08:00 UTC, hora de
  comité) y, si hay un comité reunido en segundo plano, esperan al paso
  siguiente. Una que llega más de 1 h tarde (portátil apagado) no se celebra.
  Con LLM, una llamada (`uso: 'agentes'`, propósito `reunion`) redacta los
  turnos; cada texto pasa por `verificarCifras` contra los datos de SU turno
  (con `{ conteos: true }`) y no puede decir otro modo ni otro régimen, ni por
  su nombre ni en llano (`contradiceVocabulario`, §6.3): del modo y de las
  compras solo habla el resumen, con lo que el fondo hace de verdad
  (`comprasEfectivas`); si no, plantilla. El resumen de la Presidenta lleva
  `modo`, `nivel`, `factor` y `soloCerrarHasta` y lo dice con
  `plantillas.comoCompra` (con el fondo bloqueado: «Ahora el fondo no compra
  nada: está bloqueado por el kill switch hasta Reabrir»). En el modo
  latido con LLM, la cita ya movida se guarda antes de llamar. Cada reunión
  deja una línea `reunion` en `decisiones.jsonl` (§6.10): no decide nada, pero
  la pantalla de Decisiones la cuenta con sus cifras.
- Diario 00:05 UTC: cierre diario (patrimonio inicio de día, pico, curva diaria, sombras, métricas de mesa), post-mortem en lote, informe diario.
  Si llega tarde (más de 15 min: portátil apagado o dormido), el día que se
  cierra es el de la referencia (`diaInicio`), las operaciones van por ventana
  desde el cierre anterior (`ultimoCierreT`, así cada una pasa una sola vez por
  el Auditor), el informe dice el tramo real y el día nuevo arranca desde el
  último patrimonio de la curva horaria ANTERIOR a las 00:00 (lo perdido de
  noche cuenta para los límites del día). Con Alpaca, además, contrasta la
  comisión estimada del día anterior con la real (CFEE) y avisa si difieren
  más de un 5 % o si Alpaca no apuntó nada.
- Semanal (lunes 00:10 UTC): laboratorio (≤ 3 hipótesis, en trozos con `setImmediate` para no bloquear), informe semanal (Sharpe 90 d del fondo contra sombras), alarma de deriva.
- Mensual (día 1, 00:15 UTC): asignador → contrataciones (incubación 2 %), ascensos, despidos.
- Descanso: un agente sin trabajo durante 2 h (simuladas) va 15 min a la sala de descanso. Nunca durante un comité ni con el fondo en alerta, ni un operador cuya orden espera al Ejecutor (§7, estado `ejecucion`).

### 6.10 Estado persistido (`data/`)

`estado.json` (atómico y durable, cada latido): mesas y pesos, libros,
`ultimaVela` por mesa, directivas, nivel del fondo, `patrimonioInicioDia`,
`pico`, curva (muestras cada hora, máx. 2.000), sombras, laboratorio
(hipótesis con su firma, `aprobadas`, contador de ensayos y `sharpesEnsayos`),
lecciones (últimos 90 días, con `mesaId` y `motivoSalida`), agentes (estado
visual), próximas cadencias. Campos añadidos después del primer contrato:
- `ultimoCierreT`: instante del último cierre diario (ventana de operaciones).
- `picoVigilancia`, `inicioDiaVigilancia`, `diaInicioVigilancia`: la
  referencia del vigilante tras un REABRIR humano después de un kill (§7);
  `pico` y `patrimonioInicioDia` siguen siendo los históricos.
- `comisionesEstimadas`: `{ 'AAAA-MM-DD': usd }`, comisión cripto estimada por
  día para contrastarla con la CFEE de Alpaca (10 días).
- `sombra.pendientes`: aperturas de acciones del puesto sombra que esperan a la apertura.
- `sombra.picoVigilancia`: la referencia de la caída de la sombra tras un
  REABRIR humano después de un kill (§5.5); `sombra.pico` sigue siendo su
  máximo histórico.
- `fondo.killReintento`: `{ n, proximo }` si tras el kill quedó algo en el bróker.
- `macro.fgDias`: los últimos días de miedo y codicia (para `RETRASO_FG`).
- `noticias.ultimaOk`: última clasificación de noticias que salió bien (las
  noticias solo se marcan vistas tras clasificarlas).
- `mesas[].nota`, `mesas[].firmaHipotesis` (las contratadas del laboratorio).
- `puestos[id].espera`: la espera de la estrategia en la última vela (solo si
  entonces no tenía posición ni iba a abrir), para rehacer la tarjeta del
  puesto en el acto cuando cambia el nivel del fondo (§7, `estadoTexto`).
- `caidaMaxima`: la peor caída vista desde el máximo histórico (fracción ≥ 0),
  actualizada en cada valoración (criterio e, §5.8). Un estado anterior la
  toma de sus curvas guardadas.
- `actividad`: la del último paso (§7), para que la instantánea de un
  comando del modo latido sea la misma que la del continuo.
- `incidentesDesde`: desde cuándo hay registro de incidentes (el arranque del
  fondo; en un estado anterior al registro, el primer arranque con él). El
  criterio f no se da por cumplido hasta que cubre 90 días.
- `noticias.ultimaTraida`, `noticias.ultimaTraidaOk`: la última vez que se
  pidieron noticias (cada hora); `noticias.guardados`: ids ya escritos en
  `noticias.jsonl` (1.000 últimos); `noticias.pendientes`: las guardadas que
  esperan clasificación `[{ id, t, titular, resumen, simbolos, url }]` (24 h,
  100 como mucho). `noticias.ultima` / `ultimaOk` / `vistos` siguen siendo los
  de la clasificación con LLM. Un latido puede escribir en `noticias.jsonl` y
  morir antes de guardar el estado: antes de traer o clasificar,
  `analisis.alinearConRegistro` lee las últimas 300 noticias del fichero y, de
  las que tienen una línea posterior a `max(ultimaTraida, ultima)` (lo último
  que el estado sabe haber escrito), las da por guardadas, devuelve a
  `pendientes` las que siguen sin clasificar (24 h) y da por vistas las ya
  clasificadas, reponiendo su veto vigente en `directivas` y `eventosGraves`
  sin publicar ni apuntar otra decisión (revisión del 30-sep-2026: se
  escribía dos veces y la pantalla enseñaba la primera, sin clasificar).
- `historial.ultimaHora`: la hora (inicio, ms) de la última línea `hora` de
  `historial.jsonl`. Al arrancar se contrasta con las últimas 20 líneas del
  fichero: tras un corte entre escribir la línea y guardar el estado no se repite.
- `mesas[].estudio` (las de ETF, §4.3) y `migraciones.notasEtf`: cuándo se
  cambiaron las notas de ETF en este fondo (informativo: lo que evita repetirla
  es que la nota ya no es la vieja).
- `migraciones`: `{ ampliada?: t, dia?: t, backtestEtf?: t }`, la migración del universo del
  30-sep-2026 hecha en este fondo (no se repite; `backtestEtf`, el backtest de
  Momentum ETF rehecho con DIA, §4.3). No deja línea en `historial.jsonl`: al
  arrancar aún no hay valoración y el patrimonio saldría mal; la línea de la
  hora siguiente ya trae la mesa nueva (la migración queda en el feed y en
  `decisiones.jsonl`).
- `mesas[].universo` nunca lleva un activo de solo dato (se quita al cargar).
- `cadencias.proximaReunionManana`, `cadencias.proximaReunionCierre`: las
  próximas reuniones (§6.9); un estado sin ellas las pone en el primer paso.
  `reuniones: { ultimaManana?, ultimoCierre? }` (`{ t, patrimonio }`): la de la
  mañana cuenta la noche desde el último cierre del día.
- Conversaciones (§6.2): `puestos[id].conversacion = { hilo, ultimo }` mientras
  dura la de su operación; `conversaciones.cierres[operacionId] = { hilo, id,
  de, t }` hasta que el Auditor contesta (10 días, 300 como mucho);
  `conversaciones.megafono = { hilo, ultimo, propuestaId }`;
  `laboratorio.hipotesis[].mensajeId`.

**Registros para las pantallas (30-sep-2026, `src/registros.js`).** Tres JSONL
que solo crecen, copiados a `mesa_registros` por el espejo (fuentes
`noticias`, `historial`, `decisiones`). Nada se inventa: cada línea sale de un
dato ya calculado o de la noticia tal y como la da la fuente. Escribir nunca
lanza. `scripts/probar-latido.js` los compara continuo contra latido a latido.

`noticias.jsonl`, una línea por noticia nueva (con claves de Alpaca):
```js
{ t /* reloj de la mesa al traerla */, id: string, titular, resumen /* ≤ 400 */, url | null, fuente | null, autor | null,
  publicada /* su created_at en ms | null */, simbolos /* solo los del universo operable */,
  clasificacion: null /* sin LLM o aún sin clasificar */ | [{ simbolo, categoria /* CATEGORIAS_NOTICIA */, grave: boolean }],
  veto: null | { simbolo /* el primero vetado */, hasta /* ms */, simbolos /* todos los vetados por ella */ } }
// Si la clasificación llega en un lote posterior, otra línea:
{ t, id, clasificacion, veto, actualiza: true }
```
`clasificacion: []` = clasificada sin nada válido (su clasificación no valía o
no nombraba un símbolo suyo). `leerNoticias(ruta, { desde, limite })` fusiona
las actualizaciones (y pone `clasificadaT`) y devuelve de la más nueva a la más vieja.
Una segunda línea base del mismo id (de un latido cortado, antes del arreglo
del 30-sep-2026) se fusiona como una actualización: vale la clasificación y el
veto no nulos más recientes; la noticia conserva su primera `t`.

`historial.jsonl`, una línea por hora de reloj de la mesa (motivo `hora`) y otra
en cada cambio de modo del comité (`comite`), revisión mensual con cambios de
peso o contrataciones (`asignacion`), `ascenso`, `despido`, `descarte` y `kill`:
```js
{ t, motivo: 'hora'|'comite'|'asignacion'|'ascenso'|'descarte'|'despido'|'kill',
  patrimonio, efectivo /* del bróker | null */, exposicion /* bruta / patrimonio, fracción */,
  caida /* ≤ 0, desde el máximo histórico */,
  sombras: { btc, cesta /* cesta-cripto */, sinComite } /* patrimonios; null si no hay */,
  regimen: 'RISK-ON'|'NEUTRAL'|'RISK-OFF'|null, modoComite: 'NORMAL'|'DEFENSIVO'|'SOLO_CERRAR',
  mesas: [{ id, nombre, estado, peso, patrimonio /* capitalBase + realizado + abierto (valorMesa) */,
            pnlAcumulado /* realizado + abierto de sus puestos reales */, operaciones /* cerradas, sin 'prueba' */,
            sharpe? /* métricas de papel del último cierre diario, si las hay */ }] }
```
Idempotente: una sola `hora` por hora y un solo suceso por (motivo, instante).

`decisiones.jsonl`, una línea por decisión real:
```js
{ t, tipo, quien /* id de agente o 'humano' */, resumen /* texto llano, ≤ 400, hecho por el código con cifras de sus datos
                                                         (o texto del LLM ya pasado por verificarCifras) */, datos }
```
| tipo | quién | dónde | datos |
|---|---|---|---|
| `comite` | `cio` | comite.celebrar | `{ motivo: 'programado'|'demanda', modo, modoAnterior, multiplicadores, vetos, fuente: 'llm'|'defecto', votos: { macro, riesgos }, vetoRiesgos, motivoPlanPorDefecto, costeUsd, votosDichos? }` |
| `orden` | `puesto-…` (señal), `riesgos` (stop, kill), `cio` (despido), `humano` (prueba) | Ejecutor, al mandar la orden | `{ idCliente, puestoId, mesaId, simbolo, lado, tipo, nocional, cantidad, precioReferencia, stop, motivo, motivos: [por qué, motivo de la estrategia con sus cifras] }` |
| `veto` / `recorte` | `riesgos` | riesgos.evaluar (solo reales; la aprobación tal cual no, queda en la orden) | `{ puestoId, mesaId, simbolo, tipo, lado, decision, nocionalPedido, nocional, cantidad, motivos: [{ limite, valor, maximo, texto }] }` |
| `asignacion` | `cio` (revisión mensual) o `humano` (migración) | direccion.revisionMensual, orquestador._migrarUniverso | `{ pesos, ascensos, despidos, descartes, contratadas: [{ mesaId, mesa, hipotesisId, peso }], cambios: [{ mesaId, mesa, de, a, flujo, motivo }] }` o `{ migracion, mesaId, peso?, universo, nota? }` |
| `ascenso` / `despido` / `descarte` | `cio` | direccion.revisionMensual | `{ mesaId, mesa, motivo, operaciones, sharpe, sharpeAjustado, maxDD, diasActiva, sharpeBacktest }` |
| `laboratorio` | `laboratorio` | aplicarEvaluacion (también al incorporar el resultado de fuera de banda) | `{ hipotesisId, aprobada, descripcion, hipotesis: { familia, marco, universo, filtros, params, origen, motivo, mesaId }, criterios: [{ nombre, valor, umbral, ok, comparacion: '≥'|'≤'|'<', …extra (positivas, total, ensayos, referencia, fuenteReferencia, mesa) }], puertasOk, puertasTotal, walkforward: { ventanas, entrenoMeses, pruebaMeses, combinaciones, suficiente }, dsr, ensayosPrevios, ensayosTotales, paramsFinales, referenciaDD, informe }` |
| `kill` | `humano` (panel) o `riesgos` (vigilante) | orquestador.killSwitch | `{ motivo, manual, patrimonio, pico }` |
| `pausa` | `humano` (Pausar, Reabrir), `controller` (conciliaciones graves), `riesgos` (solo cerrar por la pérdida del día) | _cmdPausar, _cmdReabrir, conciliarCadaLatido, vigilarFondo | `{ accion: 'pausar'|'reabrir'|'solo_cerrar', nivel, … }` |
| `megafono` | `humano` | _cmdMegafonoAplicar | `{ id, texto, directivas, fuente }` |
| `noticia` | `analista-…` | analisis.noticias (evento grave) | `{ noticiaId, simbolo, categoria, hasta, titular, url }` |
| `reunion` | `cio` | reuniones.celebrar (9:00 y 22:15 de Madrid; informativa) | `{ reunion: 'manana'|'cierre', hora, fuente: 'llm'|'plantilla', costeUsd, turnos: { [turno]: datos del turno } }` |

Lectores (`src/registros.js`): `leerNoticias`, `leerHistorial(ruta, { desde,
limite })`, `leerDecisiones(ruta, { desde, tipo /* uno o varios separados por
comas */, quien /* id de agente o 'humano': las de la ficha de un agente */, limite })`
y `consultar(carpeta, fuente, URLSearchParams)`. Los servidores no los llaman
directamente: pasan por `src/informes` (§7), que añade los filtros y las
reducciones de las vistas y responde lo mismo en local y en la web.
Además `data/.proceso` (el bloqueo de la carpeta, con el pid), `mensajes.jsonl`,
`ordenes.jsonl`, `operaciones.jsonl`, `operaciones-sombra.jsonl`,
`llm-costes.jsonl`, `informes.jsonl`, `broker-simulado.json`, `cache/` e
`incidentes.jsonl`: el registro de incidentes (`src/riesgo/incidentes.js`),
**solo se añade, nunca se borra**. Una línea `{ t, tipo, detalle, datos? }` por
situación, al aparecer: `kill` (el kill switch, manual o del vigilante),
`conciliacion_grave` (descuadre grave o puesto sin posición en el bróker),
`orden_huerfana` (posición del bróker sin puesto, u orden aceptada que luego
el bróker no conoce), `orden_duplicada` (el bróker ya tenía otra orden con ese
`idCliente`) y `error_departamento` (lo que captura `_error`, una vez por error
y hora, también los de red).

Arranque (`src/index.js`), en este orden:
1. HOST abierto a la red sin `PANEL_TOKEN` → no arranca.
2. Bloqueo de la carpeta (`data/.proceso`) ANTES de construir nada: si su pid
   vive, se niega con un mensaje claro; si murió, se toma.
3. `listen()` ANTES de `orquestador.iniciar()`: con el puerto ocupado se para
   ahí, sin haber resuelto órdenes, guardado estado ni publicado nada. Mientras
   arranca, la API responde 503 y los estáticos ya se sirven.
4. `iniciar()`: cargar (un estado.json que existe pero no se puede leer NO
   arranca un fondo nuevo encima: se niega; uno de otro modo tampoco) → si
   bloqueado, sigue bloqueado → resolver órdenes a medias → conciliar → operar.

---

## 7. API HTTP y eventos (F ↔ E)

Servidor `node:http` en `127.0.0.1:8765` (variables `PUERTO`, `HOST`; `--puerto=0`
deja que el sistema elija un puerto libre y el banner dice cuál). Si hay
`PANEL_TOKEN`, todo `/api/*` (GET, POST y el SSE) lo pide en la cabecera
`x-panel-token` o en `?token=` (EventSource no admite cabeceras); los
estáticos se sirven sin token. Con `HOST` abierto a la red (0.0.0.0 o una IP
de la wifi) y sin `PANEL_TOKEN`, la mesa no arranca.

Defensas frente a otra web abierta en el mismo navegador (las palabras KILL,
REABRIR o PRUEBA no protegen: la web atacante las mete en el cuerpo):
- Los POST exigen `Content-Type: application/json` (si no, **415**): una web
  ajena solo puede mandar text/plain o formularios sin pedir permiso antes.
- **403** si `Origin` no es el del propio panel (también `Origin: null`) o si
  `Sec-Fetch-Site` es `cross-site`, en toda `/api/*`, SSE incluido.
- **421** si la cabecera `Host` no está en una lista FIJA (127.0.0.1, localhost
  y [::1] con el puerto en que escucha, más el `HOST` configurado): así una
  página que pasa a resolver a 127.0.0.1 (DNS rebinding) no llega. El `Origin`
  se compara con esa misma lista, nunca con el `Host` que llega. Con el panel
  abierto a la red no hay lista fija: ahí protege el token.
- Como mucho **20** paneles SSE a la vez: el 21 recibe **503** («Ya hay 20
  paneles conectados…», `Retry-After: 10`). Un panel que deja de leer (más de
  1 MB sin vaciar o 60 s atascado) se corta; EventSource vuelve a conectar solo.
- Mientras el orquestador arranca (el servidor escucha antes), `/api/*`
  responde **503** «La mesa está arrancando: reintenta en unos segundos.»
  (`Retry-After: 2`).
- **401** con dos textos: «Falta el token del panel: abre la URL con ?token=…
  (el valor de PANEL_TOKEN).» sin token, y «El token del panel no vale: revisa
  el ?token=… de la URL (el de PANEL_TOKEN).» con uno malo.

| Método y ruta | Qué |
|---|---|
| `GET /` y `/web/*` | estáticos de `web/` |
| `GET /api/estado` | instantánea completa (abajo) |
| `GET /api/eventos` | SSE: `estado` (instantánea, como mucho una cada 2 s reales), `mensaje` (Mensaje), `agente` ({ id, estado, sala, bocadillo }), `ejecucion` (Ejecucion), `ping` (cada 15 s) |
| `GET /api/mensajes?desde=<t>` | mensajes con `t ≥ desde` (INCLUSIVO; se deduplican por `id`). Si `desde` es anterior a lo que hay en memoria (500), se completa con las últimas 5.000 líneas de `mensajes.jsonl` |
| `GET /api/operaciones` | últimas 200 operaciones cerradas |
| `GET /api/costes-llm` | gasto por día y por propósito |
| `GET /api/noticias?desde=&limite=&simbolo=&graves=1` | noticias de `noticias.jsonl` con las actualizaciones fusionadas, de la más nueva a la más vieja (200 por defecto, máx. 1.000). `simbolo` (BTC, btc, BTC/USD o BTCUSD) busca en `simbolos`, `clasificacion[].simbolo` y `veto.simbolos`; `graves=1`, las que tienen alguna clasificación grave |
| `GET /api/historial?desde=&limite=&puntos=` | líneas de `historial.jsonl` (las últimas 2.000 por defecto, máx. 20.000), en orden. Con `puntos` (20 a 2.000): todo el tramo `t ≥ desde` de la cola (`limite`, 20.000 por defecto) reducido a ≤ `puntos` con LTTB; siempre entran el primero, el último, el máximo y el mínimo del patrimonio y las líneas con `motivo ≠ 'hora'` (como mucho `puntos`/4) |
| `GET /api/decisiones?desde=&tipo=&quien=&limite=` | líneas de `decisiones.jsonl` (500 por defecto, máx. 5.000), en orden; `tipo` admite varios separados por comas; `quien`, las de un agente (o `humano`) |
| `GET /api/estrategias` | ficha de cada mesa para la vista Estrategias (abajo) |
| `GET /api/laboratorio` | el laboratorio para su vista (abajo) |
| `POST /api/comando/comite` | convoca comité ya |
| `POST /api/comando/megafono` `{texto}` | devuelve la propuesta `{ id, directivas, explicacion }` (no aplica) |
| `POST /api/comando/megafono-aplicar` `{id}` | aplica la propuesta |
| `POST /api/comando/prueba` `{ordenMinima?: true, confirmacion?: 'PRUEBA'}` | comprobación de bróker, datos, F&G y LLM; con confirmación, compra y vende 15 $ de BTC |
| `POST /api/comando/pausar` | solo cerrar hasta Reabrir |
| `POST /api/comando/reabrir` `{confirmacion: 'REABRIR'}` | vuelve a normal desde `pausado` o `bloqueado` si la conciliación está limpia. Desde `solo_cerrar` (pérdida del día) responde `ok: false` (HTTP 200): dura hasta las 00:00 UTC y se levanta solo. No borra el máximo histórico: el mensaje dice cuánto acumula el fondo desde él |
| `POST /api/comando/kill` `{confirmacion: 'KILL'}` | bloquea al instante (y lo guarda), cancela todo y cierra todo. `ok: false` si algo queda sin vender: el fondo sigue bloqueado y se reintenta solo cada pocos minutos. Las acciones con la bolsa cerrada se venden a la apertura |
| `GET/POST /api/comando/ajustes` | ver; cambiar `presupuestoDiaUsd`, `modeloComite`, `modeloAgentes`, `velocidad` (sintético). Los límites se ven, no se cambian. |
| `POST /api/comando/rebalancear` `{ mesa }` | Solo mesas de rotación por momentum, fondo en marcha normal y mesa fuera del banquillo. Deja `mesas[].rebalanceoYa = { t, quien }` en el estado; el paso siguiente (procesarMesa) decide como si fuera su día con la última vela cerrada y el precio de ahora (precioDecision = precio de ahora; stop a 3×ATR de ese precio; no entra si el precio ya está bajo el stop que daría el cierre), también en la sombra. Espera, con la marca puesta, si falta la última vela o el precio de alguna de sus criptos. Quita la marca antes de mandar órdenes y apunta `mesas[].rebalanceoVela = tVela`: sobre la misma vela no se repite. Con el fondo parado cuando toca, la marca se quita con una nota. Las propuestas llevan `datos.rebalanceoPedido: true` y la nota del CIO dice qué entró de verdad y cuánto se movió cada precio desde el cierre. Lo pidió Eduardo el 30-sep-2026 (que la titular no esperara 5 días vacía). Desde la terminal: `node scripts/comando.js rebalancear '{"mesa":"momentum"}'`. |

Las cinco rutas de lectura de arriba (noticias, historial, decisiones,
estrategias y laboratorio) son de `src/informes/index.js`,
`consultar(fuente, { carpeta, params, instantanea })`, una sola entrada para
los dos servidores: en local con la instantánea en memoria y en la web con la
publicada por el último latido. Sobre la misma carpeta responden lo mismo
(`test/informes-servidores.test.js` lo compara ruta a ruta). Nunca lanzan: un
fichero que no existe, vacío o con líneas rotas da una lista vacía, y un fallo
en estrategias o laboratorio devuelve el objeto vacío con `error`. Sin los
parámetros de las vistas (`simbolo`, `graves`, `puntos`) responden exactamente
`registros.consultar`; con ellos, y en estrategias y laboratorio, leen solo la
cola de cada JSONL (20.000 líneas, 32 MB como mucho), con caché por tamaño y fecha.

```js
// GET /api/estrategias. Orden: titulares, en prueba y banquillo; dentro, por peso.
{ t, modo, resumen: { total, titulares, incubacion, banquillo, sinAsignar },
  mesas: [{ id, nombre, familia, marco, estado, peso, capital, multiplicador, universo, params, filtros, diasActiva, nota,
            explicacion, papel: { ...metricas de la instantánea, pnlDia }, backtest, sharpeBacktest,
            lectura: { tipo: 'sin_backtest'|'pocas'|'mejor'|'peor', texto, sharpePapel, sharpeBacktest, operaciones, minimo, dias, minimoDias },
            regla: { tipo: 'incubacion'|'titular'|'banquillo', texto, … las cifras de la regla del asignador (§5.7) },
            evolucion: [{ t, pnl, peso, estado }] /* ~120 puntos, con extremos y cambios */,
            hitos: [{ t, tipo: 'alta'|'peso'|'ascenso'|'despido'|'descarte'|'estudio', texto }] /* ≤ 12 */,
            plazo: { id: 'horas'|'dia'|'mes', nombre }, tipos: [{ id, nombre }], estudio: Estudio | null }],   // 30-sep-2026
  grupos: { plazos: [{ id, nombre, mesas /* cuántas */ }], tipos: [{ id, nombre, mesas }] },   // solo los que tiene alguna mesa, en su orden
  error? }
// plazo y tipos: plazoMesa y tiposMesa (§4.3); estudio: el de la mesa (§4.3). El hito 'estudio' es la
// decisión de Eduardo de la migración de notas de ETF (no un alta).
// GET /api/laboratorio. Las evaluadas salen de las decisiones 'laboratorio'; las
// pendientes y en curso, de la instantánea; las contratadas, de las 'asignacion'.
{ t, ensayosTotales, proximaRevision, resumen: { evaluadas, aprobadas, rechazadas, pendientes, contratadas, tasaAprobacion },
  puertas: [{ nombre, comparacion, miradas, pasan, fallan }],
  hipotesis: [{ id, t, estado: 'aprobada'|'rechazada'|'pendiente'|'evaluando', aprobada, descripcion, resumen, familia, marco, universo,
                filtros, params, origen, motivo, mesaId, criterios /* tal cual en decisiones.jsonl */, puertasOk, puertasTotal,
                walkforward, dsr, ensayosPrevios, ensayosTotales, paramsFinales, referenciaDD, informe,
                contratada: { mesaId, mesa, t } | null }] /* ≤ 300, de la más nueva a la más vieja */,
  contratadas: [{ hipotesisId, mesaId, mesa, t, estadoActual, sharpePapel, operaciones, sharpeBacktest, diasActiva }],
  error? }
```
La lectura de una mesa compara papel con histórico solo cuando el asignador
ya la juzgaría, y lo dice: en prueba, desde `REGLAS.ascensoMinOperaciones` (10)
operaciones Y `REGLAS.incubacionDias` (60) días; titular, desde
`REGLAS.minOperaciones` (20) Y `REGLAS.minDias` (60). Por debajo, `tipo:
'pocas'`, tono neutro y el Sharpe de papel «de momento» (anualizado desde
retornos diarios, con pocos días es ruido; revisión del 30-sep-2026: con 10
operaciones en 4 días decía «va mejor» en verde mientras la regla de la misma
ficha decía «no se juzga hasta los 60»). No hay otro umbral escrito para esa
comparación (si Eduardo quiere otro, es regla de negocio suya).

Respuesta de comando: `{ ok, mensaje, datos? }` (HTTP 200; 400 si falta la
confirmación o el JSON no vale; 404 comando desconocido; 405 un comando por
GET salvo `ajustes`; 413 cuerpo de más de 64 KB; 415 sin application/json).

**Instantánea (`GET /api/estado` y evento `estado`)**:
```js
{
  version: 1, ahora, modo: 'alpaca'|'simulado'|'sintetico', broker: 'alpaca-paper'|'simulado', velocidad,
  latidoMs,          // SOLO en modo latido (web, ARQUITECTURA-WEB W2-W3): el ritmo del cron (60 000 en tiempo
                     //   real); la franja «Cifras sin actualizar» salta a 2,5 × latidoMs. En modo local no aparece.
  publicada,         // SOLO en data/instantanea.json del modo latido: Date.now() al publicarla (infraestructura).
  fondo: { nivel: 'normal'|'solo_cerrar'|'pausado'|'bloqueado', motivo, multiplicadorCaida,
           factorTamano: { total, comite, megafono, caida } },
  // factorTamano: el recorte que se aplica DE VERDAD al tamaño de cada apertura nueva, para que la
  //   interfaz no lo recalcule. total = comite × megafono × caida. comite: 0,5 con el modo DEFENSIVO
  //   del comité, 1 si no; megafono: el factor de la reducción del Megáfono vigente (la más dura), 1 si
  //   no hay; caida: multiplicadorCaida del vigilante. Los tres multiplican el nocional FINAL de
  //   dimensionar(), después de todos sus topes (mesas.tamanoApertura, §6.7; Riesgos lo comprueba sin
  //   volver a multiplicar): «×0,5 del tamaño normal» es ×0,5 aunque mande el riesgo por operación o el
  //   tope por activo. El multiplicador por mesa del comité también multiplica, pero es de cada mesa
  //   (mesas[].multiplicador) y aquí no entra. No dice si se puede abrir: con nivel ≠ normal,
  //   SOLO_CERRAR del comité o «solo cerrar» del Megáfono no se abre nada, y eso lo cuentan nivel,
  //   directivas y avisos.
  cabecera: { patrimonio, pnlDia, pnlDiaPct, caida, exposicionBrutaPct, exposicionCriptoPct, posiciones,
              regimen: { valor, detalle }, miedoCodicia: { valor, etiqueta, sintetico } | null,
              proximoComite, modoComite: 'NORMAL'|'DEFENSIVO'|'SOLO_CERRAR',
              comitePedido,                            // SOLO en modo latido: true si está convocado desde el panel
                                                       //   y se celebra en el latido siguiente («Comité convocado»)
              sinAsignar: { fraccion, usd },           // capital que ninguna mesa tiene (queda en efectivo)
              vigilancia: { perdidaDiaPct | null, caidaPct, desdeReapertura },
              capital },                               // desde el 30-sep-2026, abajo
  // capital = { patrimonio, invertido, invertidoPct, efectivo, disponible, disponibleCripto,
  //             porTipo: [{ tipo, nombre, importe, pct, activos: [{ simbolo, etiqueta, importe }], mesas: [mesaId] }],
  //             limites: { bruta: Tope, cripto: Tope } }     Tope = { maximo /* fracción de config.limites */, tope /* $ */, usado /* $ */, queda /* $ */ }
  //   Lo que la barra de arriba enseña de dónde está el dinero (Eduardo, 30-sep-2026). patrimonio,
  //   efectivo e invertido son del bróker (cuenta y posiciones del último refresco): invertido = Σ |valor|
  //   de sus posiciones, invertido + efectivo = patrimonio (el de la cabecera), invertidoPct = invertido /
  //   patrimonio. porTipo: el desglose por `tipo` del universo (§2), en el orden de TIPOS, con los tipos
  //   que tienen algo invertido o alguna mesa fuera del banquillo que los opera (esos, aunque sea 0);
  //   Σ importe = invertido, pct = importe / patrimonio, activos de mayor a menor. disponible, «Puedes
  //   invertir aún», es lo que dejan los límites duros y nada más: min(efectivo, limites.bruta.queda);
  //   disponibleCripto = min(disponible, limites.cripto.queda). En cada Tope, tope = maximo · patrimonio,
  //   usado = la exposición que miran los topes de Riesgos (§5.3: por activo, el máximo entre libros y
  //   bróker, a precio de la mesa; la que de verdad frena una compra, que en marcha normal coincide con lo
  //   invertido) y queda = max(0, tope − usado): la interfaz lo cuenta sin restar. No dice si hoy se puede abrir (nivel,
  //   solo cerrar, vetos: eso lo cuentan fondo, directivas y avisos). test/integracion-capital.test.js y la
  //   demo acelerada lo cuadran con el bróker.
  // pnlDia/pnlDiaPct: desde el inicio REAL del día (también tras reabrir); caida: desde el máximo HISTÓRICO.
  // vigilancia: lo que mide el vigilante contra sus límites (tras un Reabrir humano después de un kill,
  //   desde la reapertura); es la cercanía a los límites, no el resultado. perdidaDiaPct null antes del cierre diario.
  // exposicion*Pct: la de los libros con, por símbolo, el máximo frente al bróker (una posición del bróker
  //   sin puesto, huérfana, cuenta).
  llm: { activo, modeloComite, modeloAgentes, gastoHoyUsd, presupuestoDiaUsd },
  curva: [{ t, patrimonio }],                            // ≤ 500 puntos
  cotizaciones: [{ simbolo, etiqueta, precio, var24hPct, t }],   // var24hPct: frente al precio de 24 h antes del DATO (t), no
                                                                  //   del latido: con los datos parados no se mueve sola
  departamentos: DEPARTAMENTOS,                          // con su `queHace` (§6.1)
  agentes: [{ id, nombre, genero: 'f'|'m', departamento, rol, queDecide, queHace /* llano, §6.1 */, usaLLM, sala, estado: 'trabajando'|'reunion'|'descanso'|'de_pie'|'banquillo'|'ejecucion',
              bocadillo: { texto, hasta } | null, mesaId, simbolo, etiqueta, puestoId }],
  // estado 'ejecucion' (30-sep-2026): el operador que propuso una apertura o un cierre por señal espera de
  //   pie junto al Ejecutor mientras su orden no ha salido (en estado.pendientes, la bolsa cerrada) o no la
  //   ha confirmado el bróker (ordenesEnVuelo). Sale del estado (orquestador._esperandoOrden), así que es
  //   igual en el continuo y latido a latido; no cuenta con el fondo bloqueado (todos de_pie), ni para los
  //   stops, el kill o el despido (no los propuso él). Su bocadillo, mientras espera, lo escribe
  //   plantillas.esperaOrden («Espero junto al Ejecutor: la compra de SPY sale cuando abra la bolsa, a las
  //   15:35.»), con hasta = ahora + 1 min de pantalla. `sala` sigue siendo la suya. Tampoco se va a descansar.
  // capital: patrimonio · peso · multiplicador · (0,5 con DEFENSIVO), lo que la mesa opera de verdad
  //   (el recorte va al nocional, §6.7); 0 en el banquillo.
  mesas: [{ id, nombre, familia, marco, estado, peso, capital, multiplicador, universo: [etiqueta], params,
            metricas: { operaciones, acierto, factorBeneficio, sharpe, sharpeAjustado, maxDD, adherencia, pnlTotal }, pnlDia,
            nota /* string | null: por qué está así (backtest de arranque, contratación, ascenso, despido) */,
            // desde el 30-sep-2026:
            diasActiva, filtros: [{ id, parametro }],
            explicacion: Explicacion | null /* §4.3, con SUS params, filtros y el riesgo por operación de los límites */,
            sharpeBacktest: number | null,
            backtest: { sharpe, maxDD, operaciones, rentabilidad, vol, dias, t } | null /* backtest de referencia guardado (en el estado lleva además mu, sigma y el `universo` con que se hizo) */,
            estudio: Estudio | null /* §4.3: solo las de ETF */ }],
  // metricas son las de papel (desde su alta); backtest, el de referencia (§6.9, laboratorio.backtestMesa).
  puestos: [{ id, mesaId, simbolo, etiqueta, agenteId,
              posicion: { cantidad, nocional, entrada, stop, objetivo, pnlAbierto, pnlAbiertoPct, abiertaT } | null,
              pnlDia, operaciones, acierto, factorBeneficio, adherencia, estadoTexto, ultimaSenal: { accion, t } | null,
              chispa: [number] /* últimos 16 cierres */ }],
  // estadoTexto: con posición abierta se rehace con las cifras de ahora (las de `posicion`); tras un
  //   cierre dice el cierre; sin posición, la espera de la estrategia en la última vela. Si el fondo no
  //   deja abrir, lo dice: bloqueado (todos los puestos), pausa o solo cerrar por la pérdida del día (los
  //   que no tienen posición). Cuando cambia el nivel (Reabrir, Pausar, kill, vigilante) se rehace en el
  //   acto, sin esperar a la vela siguiente; al volver a normal, la espera de la última vela si entonces
  //   no tenía posición ni iba a abrir, y si no «Esperando señal».
  posiciones: [{ simbolo, etiqueta, cantidad, precioMedio, precio, valor, pnl }],
  benchmarks: [{ id, nombre, valor, rentabilidad, sharpe90 }],        // incluye 'sin-comite'
  mejora: { sharpe90Fondo, sharpe90SinComite, sharpe90Btc, texto },
  directivas: { modo, multiplicadores, activosVetados: [{ simbolo, hasta, motivo }], mesasPausadas: [{ mesaId, hasta }],
                soloCerrarHasta, reduccion: { factor, hasta } | null },
  megafonoPendiente: { id, texto, directivas, explicacion } | null,
  mensajes: [Mensaje],                                   // últimos 150
  ejecuciones: [{ t, puestoId, simbolo, etiqueta, lado, cantidad, precio, nocional, comision, motivo }],   // últimas 30
  laboratorio: { ensayosTotales, hipotesis: [{ id, descripcion, estado: 'pendiente'|'evaluando'|'aprobada'|'rechazada', criterios, t }], proximaRevision },
  limites,
  listoParaReal: { listo, cumplidos, total, criterios: [Criterio], comite: { sharpeFondo, sharpeSinComite, bate, texto }, nota },
  // Semáforo «¿Listo para dinero real?» (§5.8, desde el 30-sep-2026): los criterios a-g con
  //   Criterio = { id, nombre, valor, umbral, ok, valorTexto, umbralTexto, detalle }; valorTexto y
  //   umbralTexto ya vienen escritos (la interfaz no recalcula unidades). comite es informativo (bate:
  //   true|false|null). nota: el semáforo no activa nada, el código sigue siendo solo papel.
  avisos: [texto]    // Un «hasta» que no es hoy lleva la fecha, como el feed («hasta el 3 oct 21:55»;
                     // hoy, «hasta las 21:55»).
                     // Lo que bloquea o limita al fondo va delante (en el móvil se corta por el final): nivel
                     // (bloqueado, pausa, solo cerrar), kill pendiente de reintento, solo cerrar del comité o del
                     // Megáfono; con el fondo en normal, los activos vetados (Megáfono, comité, noticia grave) y las
                     // mesas sin abrir (pausa del Megáfono o ×0 del comité), con quién y hasta cuándo; caída
                     // histórica por encima del límite del kill tras reabrir, precios sin actualizar (> 3 min, fuera
                     // del sintético), conciliación con incidencias, capital sin asignar con el porqué («54 % del
                     // capital sin asignar: queda en efectivo. Hay solo 1 mesa titular (techo del 40 %) y 3 en
                     // prueba al 2 %: mejor efectivo que capital en estrategias sin ventaja demostrada.»); al final
                     // 'Con el ordenador apagado no hay stops…' y el modo (sintético / bróker simulado)
  actividad: { t, lista: [{ agente, accion, objetivo?, detalle?, puestoId? }] } | null,
  // Lo que de verdad hizo cada agente en el ÚLTIMO paso() (desde el 30-sep-2026; src/agentes/actividad.js).
  //   t: el reloj de la mesa al empezar el paso (el panel lo usa para reproducir cada paso una sola vez).
  //   Una entrada solo si ese código corrió en ese paso, en el orden en que corrió; determinista (mismo
  //   paso → misma lista); ≤ 20 (si sobran, salen primero las de rutina: señal sin cambio y notas); sin
  //   repetir (agente, accion, objetivo, puestoId); solo agentes de la plantilla. null antes del primer paso.
  //   Se guarda en estado.json: un comando del modo latido publica la misma instantánea que el continuo.
  //   accion (lista cerrada) → quién y de qué código sale:
  //     'precios'      controller  _actualizarPrecios trajo alguna cotización        → 'pantalla-cotizaciones'
  //     'riesgo'       riesgos     vigilante del fondo (cada paso, detalle 'limites') → 'mesas'
  //                                o riesgos.evaluar de una propuesta real (detalle 'propuesta', con puestoId)
  //     'conciliacion' controller  conciliarCadaLatido (no aplazada por órdenes en vuelo) → 'monitor'
  //     'regimen'      macro       macro.actualizar con vela 1H nueva                  → 'pantalla-regimen'
  //     'nota'         analista-X  analisis.notas calculó su nota (vela 1H nueva; detalle la etiqueta) → 'monitor'
  //     'senal'        puesto-X    mesas.procesarMesa decidió el puesto con vela nueva (con puestoId):
  //                                abre o cierra de verdad → 'ejecucion' (detalle 'abrir'|'cerrar');
  //                                si no → 'monitor' (detalle 'sin cambio')
  //     'orden'        ejecutor    el Ejecutor mandó una orden al bróker (detalle '<lado> <ETQ>', puestoId) → 'monitor'
  //     'comite'       cio         se convocó el comité en este paso (detalle 'programado'|'demanda') → 'sala-comite'
  //   objetivo (lista cerrada): 'pantalla-cotizaciones' (pantalla gigante del fondo del parqué), 'monitor' (el
  //   suyo), 'mesas' (las de trading; con puestoId, la de ese puesto), 'ejecucion' (puesto del Ejecutor),
  //   'pantalla-regimen' (sala de macro), 'sala-comite'. El parqué (§8) lo reproduce como paseos.
}
```

---

## 8. Interfaz (E)

Una sola página, HTML + CSS + JS vanilla (sin librerías), en `web/`:
`index.html`, `css/{estilo,vistas}.css`,
`js/{cifras,iso,mapa,dibujo,personajes,caras,paneles,reproductor,maqueta,pwa,graficas,vistas,app}.js`
(scripts clásicos con un namespace `window.Parque`, sin módulos ES para que
abra también desde `file://` en modo maqueta). Gráficas propias en SVG
(`graficas.js`); la CSP de la web no admite recursos de fuera, `style=""` ni
`innerHTML` (los colores por dato van en variables CSS puestas desde JS).

- Barra superior: PATRIMONIO, RESULTADO HOY, CAÍDA, EXPOSICIÓN (bruta y
  cripto), POSICIONES, píldoras RÉGIMEN, F&G, «Comité en HH:MM», MODO (PAPEL
  ALPACA ámbar / SIMULADO azul / SINTÉTICO lila), LLM gasto/tope. Si la fila
  de píldoras no cabe, primero se compacta (F&G se queda en el número; la
  palabra, en su título) y solo después se desliza con el borde desvanecido;
  la del estado del fondo va siempre la primera. La del comité dice «Reunión
  de la mañana» o «Cierre del día» (el nombre de la cita, `datos.nombre`) cuando los jefes están en la sala por una
  reunión informativa (§6.9: lo último que se abrió en la sala es una apertura
  `direccion`/`reunion`), «Comité reunido» en un comité y, si no, la cuenta atrás.
  Mientras el feed reproduce una reunión (abajo), «Comité en curso» (o «Reunión
  de la mañana en curso»…), en ámbar. Patrimonio es un botón (abajo, capital).
- Franja de CAPITAL (30-sep-2026, pedida por Eduardo; `cabecera.capital`, §7),
  justo debajo de la barra y de su mismo fondo, móvil primero: INVERTIDO
  (importe y %), EFECTIVO y MARGEN DE LOS LÍMITES (antes «Puedes invertir aún»:
  la pantalla decía a la vez que se podían invertir 68.451 $ y que el 54 % se
  queda en efectivo; la cifra, `capital.disponible`, es la de los límites y es
  regla de Eduardo: no cambia sin él. Con el fondo parado, `(no compra)` al
  lado y apagada); debajo (al lado en escritorio),
  la barra apilada del reparto (un tramo por tipo de activo con su color y el
  efectivo al final, separados por 2 px; crece desde la izquierda al aparecer,
  sin rebote) y un botón por tipo con su nombre, importe y % (un tipo que opera
  una mesa pero sin nada dentro sale apagado, «0 $»), más la leyenda del
  efectivo: el color nunca va solo. Colores por tipo en `cifras.COLOR_TIPO`,
  paleta categórica validada sobre el fondo de la barra. Al tocar una cifra
  (también PATRIMONIO de la barra), una línea debajo explica de dónde sale, con
  las cifras de la instantánea (`cifras.explicarCapital`: ninguna calculada en
  la pantalla; en el margen, el tope, lo usado y lo que queda de
  `capital.limites`, si manda el efectivo, que no es lo que el fondo va a
  comprar (lo que tienen las mesas, Σ `mesas[].capital`, y lo que se queda en
  efectivo por el reparto, `cabecera.sinAsignar`) y si el fondo hoy no compra); tocar
  otra vez o Escape la quita (`aria-expanded`, `role=status`, se refresca como
  mucho cada 30 s). Sin el campo (servidor anterior) la franja no se pinta. En
  el móvil, con Informes abierto, se esconde para dejarles sitio.
- Reproductor del feed (`reproductor.js`, 30-sep-2026): en el modo latido un
  comité entero (8 mensajes) o una operación entera llegan en el mismo segundo.
  El feed los suelta uno a uno sin cambiar su hora: una reunión (canal comité,
  o `datos.reunion` de las de las 9:00 y las 22:15) repartida en
  `ventanaReunionMs` (150 s; en el sintético acelerado, como mucho la mitad del
  tiempo real entre comités), a razón de total − 1 huecos (8 en el comité; en
  las reuniones, `datos.turnos` + 1), con «Comité en curso · n de 8» encima del
  feed y en la píldora; una operación de un puesto, un mensaje cada 8 s como
  mucho. El primero de cada conversación entra en el acto; lo que llega de
  otra conversación no espera; lo de una conversación con cola, detrás (el
  orden no se rompe). Al abrir el panel, una reunión que acaba de celebrarse
  (su apertura dentro de la ventana) se reproduce desde su apertura; lo demás
  es historia y entra entero. Con la pestaña oculta más de 5 min, lo que
  quedaba entra de golpe. El bocadillo de quien habla sale con su mensaje (el
  de la instantánea espera si tiene algo en cola) y los jefes siguen en la
  sala los 15 min del backend (`SALA_TRAS_REUNION_MS`, §6.9).
  Revisión del 30-sep-2026: tras volver la red o despertar el móvil, lo que
  llega con `t` anterior a `reproductor.limiteHistoria(inst, ahoraMesa)` (el
  reloj de la mesa menos lo que dura una reproducción, en tiempo de la mesa)
  es historia (`separarViejos`): entra de golpe en su sitio por hora, sin
  bocadillos ni operador de pie, y no sale «en curso» un comité de hace 3 h.
  El feed ya no se rehace por cada mensaje soltado (`paneles.anadirMensajes`):
  cada uno va a su sitio por orden de LLEGADA, no por su `t`; una respuesta
  entra en su conversación (el mismo nodo, por hora dentro de ella) y la
  conversación baja al final; un separador de día que se queda sin mensajes se
  quita. Solo se rehace entero con más de 60 de golpe (la primera
  instantánea), con `{ historia: true }` y al cambiar de filtro; se mantienen
  los separadores de día y el tope de 300 nodos (`MAX_DOM`). Antes, en un
  móvil con la CPU a ×4, cada mensaje del reproductor costaba 100–450 ms de
  hilo principal.
- Operador de pie junto al Ejecutor (estado `ejecucion`, §7): mientras su
  orden espera a la bolsa o al bróker (servidor) y, en una operación que se
  reproduce, desde que sale su propuesta hasta que sale la ejecución, el veto
  o el aviso del Ejecutor (panel, `reproductor.abreEspera`/`cierraEspera`, dos
  minutos como mucho). Anda hasta el puesto del Ejecutor (`personajes.
  puntoEjecucion`, hasta cuatro a la vez sin pisarse), se queda de pie
  mirándolo con su bocadillo fijo (su propuesta, o el `esperaOrden` del
  servidor) y vuelve a su silla; no sale a pasear ni a descansar.
- Caras (`caras.js`): cada agente tiene un retrato SVG plano, determinista por
  su id, con la piel, el pelo y el peinado de su muñeco
  (`personajes.aspectoDe(id)`, fuente única), la camisa del color de su
  departamento y, por un segundo hash, corte, gafas, cejas, boca y barba (solo
  si `genero` es 'm'; sin `genero`, lo deduce del rol o del nombre de pila).
  Tres tamaños (24, 40 y 96 px); el humano del Megáfono lleva un megáfono
  ámbar y el sistema un cubo gris. Sin imágenes, `style`, ids ni clipPath.
- Panel lateral con pestañas «Mensajes (n) | Equipo (n)» (`role=tab`, flechas,
  Inicio y Fin; en el móvil, tocar una pestaña abre la hoja inferior).
  Mensajes: chips de filtro por departamento y feed (cara de 40 px, que abre la
  ficha del agente; nombre, etiqueta del departamento con su color, rol, «→
  Marta» si el mensaje va para alguien, hora y texto; lo último abajo;
  autoscroll salvo si el usuario ha subido; máx. 300 en el DOM). Las
  conversaciones (`hilo`/`respondeA`, §6.2) van juntas: las respuestas,
  sangradas bajo el mensaje que abre la conversación, con cara de 24 px, y la
  conversación entera baja al final del feed con cada respuesta nueva; con un
  filtro, sale entera si alguno de sus mensajes es de ese departamento.
  Equipo: los agentes por departamento (en el orden de `DEPARTAMENTOS`, con su
  color, cuántos son y su `queHace`), las Mesas con un rótulo por mesa; cada
  fila (cara, nombre, estado si no trabaja, rol, `queHace` en 2 líneas) abre su
  ficha. Buscador sin tildes ni mayúsculas por nombre o rol (así «btc»
  encuentra a sus operadores); Escape lo borra.
- Ficha del agente (clic en su cara o en su fila de Equipo): cara de 96 px,
  nombre, departamento, estado y rol; «Qué hace» (`queHace`), dónde está, sus
  últimos 5 mensajes y «Ver sus decisiones» (la vista Decisiones filtrada por
  `quien`); si es operador, su mesa (estado y peso) y su posición, con «Ver su
  puesto» y «Ver la mesa»; «Detalle técnico» desplegable (queDecide, LLM, id),
  que sigue abierto aunque la ficha se rehaga. En escritorio, 340 px de ancho.
- Lienzo isométrico Canvas 2D, rejilla 2:1, tesela 64×32, plano 28×22 con
  salas: parqué (pantalla gigante al fondo con cotizaciones, patrimonio y
  curva, y «Hechos de la mesa»), dirección, macro (elevada), análisis,
  laboratorio, riesgos + operaciones, sala de comité, descanso (sofás,
  máquina). Mesas del parqué en filas por mesa (una fila por familia) con un
  puesto por activo y etiqueta flotante. Monitores verde/rojo/gris según P&L
  abierto, ámbar al enviar orden. Personajes dibujados a mano (cuerpo del
  color del departamento), andan por puertas entre salas cuando cambia su
  `sala`. Bocadillos (máx. 5 a la vez, por importancia).
- Trabajo real (`actividad` de §7, `personajes.planificarActividad`): con cada
  `actividad.t` nuevo (una vez por paso: en local llegan varias instantáneas
  por paso) la lista se reparte en ~40 s, y nunca más del 90 % del intervalo
  entre pasos (`latidoMs`; en local sintético 5 min / velocidad; en local
  real 60 s) menos lo que ya pasó. Cada agente se levanta, anda por la ruta
  del mapa hasta su objetivo (pantalla gigante, las mesas o el puesto de la
  propuesta, el puesto de ejecución, la pantalla del régimen, o de pie junto a
  su monitor), mira 3–6 s y vuelve a su silla; si no cabe, anda más deprisa y
  mira menos en la misma proporción. Un paseo por agente a la vez; quien está
  en el comité, el descanso, el banquillo, de pie por el kill o fuera de su
  sala no sale, y si le llaman a mitad de un paseo, lo deja. Bocadillo corto
  de la acción («Precios al día», «Señal: sin cambio»; sin cifras), con
  importancia 0: solo si no está diciendo otra cosa y detrás de los mensajes.
- Vida de adorno (solo dibujo, sin significado): los sentados que trabajan
  teclean a ráfagas y giran la cabeza ~1 s cada 9–16 s, con fase propia por
  agente; sin rebotes.
- Clic en un puesto o agente → tarjeta de detalle (como la imagen 2):
  situación, nocional, cantidad, entrada, stop, objetivo, abierto, P&L del
  día, operaciones, acierto, adherencia, factor, último mensaje, y la mesa del
  puesto con su estado (con tilde: titular, incubación, banquillo), su peso y
  su `nota`; para agentes no-puesto, su ficha (arriba). El operador sentado en
  el parqué abre la tarjeta de su PUESTO (es la que dice cómo va su
  operación); esa tarjeta lleva su cara como botón a su ficha.
- Rótulos de mesa: nunca fuera del lienzo ni encima de lo pintado; con poco
  sitio van por peso (una titular del 40 % antes que una incubada del 2 %) y,
  de último recurso, con la primera palabra del nombre («RUPTURA»): así la de
  más peso ocupa el hueco y desplaza a la de menos.
- Clic en el rótulo de una mesa (encima de su fila) → ficha de la mesa: nota,
  lo que la bloquea (pausa del Megáfono, ×0 del comité, vetos), estado, peso,
  capital, multiplicador, P&L del día y total, operaciones, acierto, factor,
  Sharpe, Sharpe ajustado, caída y adherencia, y sus puestos.
- Teclado sobre el lienzo: flechas para mover, + y − para el zoom, 0 para
  encuadrar; `n` / `p` (o AvPág / RePág) recorren puestos y agentes y `Intro`
  (o espacio) abre la tarjeta del elegido; Escape cierra la tarjeta. Al
  cerrarla, el foco vuelve a lo que la abrió (el lienzo tras un toque o un
  clic; un botón, si se abrió con él), nunca a <body>.
- Botonera: Comité, Megáfono (modal con texto → propuesta → Aplicar),
  Resultados, Prueba, Pausar todo, Reabrir (escribir REABRIR), Kill switch
  (rojo, escribir KILL), Ajustes (modal). Controles de cámara y zoom; arrastrar
  para mover, rueda o pellizco para zoom.
- Informes (botón «Informes», al principio de la botonera; `vistas.js`): una
  capa encima del parqué con cinco pestañas y dirección propia (#evolucion,
  #estrategias, #noticias, #decisiones, #laboratorio; «atrás» o la X vuelven al
  parqué y cambiar de pestaña no apila historial). Con la capa abierta el
  parqué no se pinta y la hoja del móvil se esconde; la botonera (Kill, Pausar)
  sigue a la vista. Todas leen de las rutas de §7, nunca inventan: si no hay
  datos, dicen por qué.
  · Evolución: 1S/1M/3M/Todo (recordado en localStorage), patrimonio que cuenta
    hacia arriba y variación del periodo, una frase del periodo hecha por el
    código con las cifras del historial, el fondo frente a las tres sombras en %
    desde el inicio del periodo, tramos del comité en DEFENSIVO o SOLO CERRAR y
    del fondo bloqueado, marcas de kill, pausas, ascensos, despidos, descartes,
    mesa nueva y cambio de modo, el resultado de cada mesa, el reparto del
    capital (con «Sin asignar») y la caída con los límites del vigilante.
  · Estrategias: arriba, «Agrupar» Por estado (el orden de siempre) | Por plazo
    («Cada 4 horas», «Cada día o semana», «Cada mes») | Por tipo de activo
    (recordado en localStorage) y, agrupando, fichas para quedarse con un solo
    grupo (con cuántas mesas tiene); cada grupo con su rótulo, su número de mesas
    y una línea de qué quiere decir. Una mesa con varios tipos (Momentum ETF:
    índices, bonos y materias primas) va en su propio grupo de mezcla, nunca
    repetida, y al filtrar por uno de sus tipos sale (`vistas.agruparMesas`,
    con `plazo`, `tipos` y `grupos` de /api/estrategias). Una mesa con
    `estudio` (las de ETF) lleva, justo bajo su nombre, el aviso en ámbar con
    icono «Suspendió el filtro; sigue en prueba por decisión de Eduardo.», el
    estudio (fecha, años, activos), cada cifra con su mínimo y «✗ no pasa», y
    su rentabilidad al año frente a comprar y mantener (`vistas.textoEstudio`).
    Después, una tarjeta por mesa con estado, familia, marco, plazo y días, peso y
    capital, resultado en papel, su curva, activos y operadores (con su cara),
    la explicación llana, histórico frente a papel (Sharpe, caída, operaciones;
    el resultado va aparte: uno es % y el otro $ sobre un capital que cambia),
    la lectura, la regla del asignador aplicada a ella, su nota y su historia.
  · Noticias: filtro por activo y «Solo graves», fuente, activos, enlace
    (`rel=noopener noreferrer`), clasificación y veto; sin noticias, por qué
    (sintético, sin claves o esperando) y si el LLM está apagado.
  · Decisiones: por grupos (comité y reuniones, órdenes, vetos y recortes,
    cambios de estrategia, laboratorio, kill/pausas/Megáfono, noticias), cada
    una con la cara de quien decidió, su rol, hora, resumen y «Ver los datos»;
    separadores por día, «Ver más antiguas», comités seguidos sin cambio de
    modo en una línea, y filtro por agente desde su ficha.
  · Laboratorio: evaluadas, aprobadas, ensayos y contratadas; qué puertas
    pasan (barras) y por qué protegen de la suerte; cada hipótesis con sus
    puertas (valor, comparación, umbral y de dónde sale), walk-forward e
    informe; y cómo van en papel las contratadas.
  Gráficas con cruz y ficha al tocar, al pasar el ratón y con el teclado; las
  líneas se descubren y las barras crecen desde su base, sin rebote, y nada se
  anima con `prefers-reduced-motion`. El refresco de cada minuto no repinta si
  los datos no han cambiado y deja abierto lo desplegado.
- Resultados (modal ancho): arriba del todo, el semáforo «¿Listo para dinero
  real?» (`listoParaReal`): veredicto («Todavía no: n de 7» o «Sí: cumple
  todos»), cada criterio a-g con ✓/✗ (y «cumple» / «no cumple» para el lector
  de pantalla), su valor, su umbral y su detalle, la nota del comité y lo que
  no hace; sin el campo (servidor anterior) no se pinta. Después, el fondo
  frente a cada cartera sombra (valor,
  rentabilidad, Sharpe 90 d y diferencia en dólares), incluida «mismas mesas
  sin comité»; «¿Aporta algo el comité?» con el bloque `mejora`; las mesas con
  estado, peso, Sharpe y P&L total, el capital sin asignar (queda en efectivo)
  y la `nota` de cada mesa; y el laboratorio (ensayos acumulados, próxima
  revisión y las hipótesis con sus criterios).
- Barra de LÍMITES del fondo (pantalla del parqué): exposición bruta y cripto,
  y la pérdida del día y la caída tal y como las mide el vigilante
  (`cabecera.vigilancia`): tras reabrir un kill, desde la reapertura, y lo dice
  («medido desde la reapertura»). La cabecera sigue enseñando el resultado
  real (desde el inicio del día y el máximo histórico).
- Móvil (< 768 px): barra compacta, panel lateral como hoja inferior, tarjeta
  a pantalla completa.
- Cifras que cuentan hacia arriba (sin rebote) y respeto a
  `prefers-reduced-motion` (sin adorno y sin paseos de actividad). Tope de
  30 fps mientras alguien anda, cuenta una cifra, hay un destello o el dedo
  toca la pantalla; si no, 12 fps (5 con movimiento reducido). Capa estática
  en canvas fuera de pantalla; pausa con la pestaña oculta.
- `?maqueta=1` (o abrir `index.html` como fichero): genera una instantánea y
  mensajes falsos con `maqueta.js` para poder trabajar la interfaz sin backend.
  La maqueta trae todos los campos de §7 (sin excepciones:
  `test/integracion-servidor.test.js` compara sus claves con las de la mesa de
  verdad) y la misma plantilla (departamentos y fijos de `registro.js`,
  parámetros y explicación de `src/estrategias`), con sus conversaciones:
  operaciones enteras, comité, reuniones informativas y Megáfono. Las vistas de
  Informes no tienen registros en la maqueta y lo dicen.
- Franja de arriba. Roja sin conexión, con el motivo si se sabe y reconexión
  SSE con espera creciente:
  «Sin conexión con la mesa, reintentando en N s…» (red; N cuenta hacia
  atrás cada segundo y va en un trozo aria-hidden, para que el lector de
  pantalla no relea la franja, que es role=status);
  «Falta el token del panel: abre la URL con ?token=… (el valor de
  PANEL_TOKEN).» (401 sin token); «El token del panel no vale: revisa el
  ?token=… de la URL (tiene que ser el de PANEL_TOKEN).» (401 o 403 con token);
  «Hay demasiados paneles abiertos contra la mesa: cierra alguna pestaña.»
  (503 del SSE lleno); «La mesa está arrancando (histórico, órdenes a medias y
  conciliación).» (503 mientras arranca; se distinguen por el `mensaje` del
  503). Ámbar con conexión pero sin instantáneas nuevas desde hace más de 2,5
  latidos (nunca menos de 20 s): «Cifras sin actualizar: el último dato de la
  mesa llegó hace N min…», porque el `ping` mantiene viva una conexión cuyo
  latido está colgado. Un precio más viejo que el límite de §5.3 lleva «hace
  N min» en la pantalla gigante y en la tarjeta.

---

## 9. Pruebas (todas con `node:test`, `npm test`)

Norma de la casa: nada se da por bueno hasta que un caso conocido cuadra, y
el caso queda como `scripts/probar-*.js` que imprime OK/FALLO y sale con
código ≠ 0 si falla. Obligatorio como mínimo:

- A: SMA/EMA/RSI/ATR contra valores calculados a mano en series cortas;
  **causalidad**: añadir velas futuras no cambia ningún valor ya calculado ni
  ninguna decisión pasada; backtest de una serie construida con un cruce en
  una vela conocida → entrada en la apertura de la vela siguiente, P&L exacto
  con comisiones; stop con hueco; `normalInv(0.975) ≈ 1,959964`; DSR en un caso
  de referencia.
- B: cliente Alpaca con `fetch` falso → cuerpo exacto de la orden cripto y de
  acción, cabeceras, paginación, mapeo `BTCUSD`, 403/422/429 → tipo de error,
  timeout en envío → consulta por idCliente y no duplica; bróker simulado:
  comprar 1.000 $ de BTC a 100.000 con 0,25 % → 0,009975 BTC; vender → efectivo exacto.
- C: libros: compra, compra, venta parcial, venta total → realizado exacto;
  límites: cada motivo de veto y de reducción con su caso (riesgo por
  operación del 1 %); vigilante: −2 %, −7 %, −10 %, −25 % y lo que queda entre
  medias (−3,5 % solo cierra, −15 % va a ×0,5); conciliación: escalar vs
  grave; asignador con casos de suelo, techo, muestra mínima, despido;
  semáforo: cada criterio a-g en verde y en rojo; registro de incidentes.
- D: petición al LLM con cliente falso → forma exacta por modelo (opus vs
  haiku, y la config por defecto: comité Opus, agentes Haiku, 1 $/día),
  cálculo de coste, tope diario, gasto acumulado, `refusal`, esquema inválido,
  `verificarCifras` con cifras buenas y malas; Megáfono por palabras clave.
- F: demo acelerada de 60 días sintéticos sin fallos: hay operaciones, ningún
  límite duro violado, `Σ puestos = posiciones del bróker`, `patrimonio =
  efectivo + Σ valor de posiciones`, el comité se reúne, el kill switch cierra
  todo; servidor responde `/api/estado` con la forma de §7; cada incidente
  entra una vez en `incidentes.jsonl` desde donde pasa y el semáforo lo cuenta.

- Tono y conversaciones (30-sep-2026): `scripts/probar-tono.js` (cada
  plantilla en llano, ≤ `MAX` y sin cifras que no estén en sus datos; una demo
  de 5 días donde toda respuesta apunta a un mensaje que existe, cada
  operación cerrada es un hilo completo con el operador por su nombre, cada
  lección contesta a su cierre y hay una reunión a las 09:00 y otra a las 22:15
  de Madrid cada día, que cuentan el modo del comité sin tocarlo) y
  `test/integracion-conversacion.test.js` (la cadena propuesta → aprobación →
  orden → ejecución → cierre → lección, el veto que cierra el hilo, el comité,
  el Megáfono, las reuniones en verano, en invierno y la noche del cambio de
  hora, la reunión que llega tarde y la reunión con LLM). `probar-latido`
  compara también los ids, `respondeA` e `hilo` de los mensajes.

- Pantallas (30-sep-2026): `scripts/probar-vistas.js` (el historial reducido
  conserva primero, último, máximo, mínimo y el kill; la variación del periodo
  es la calculada a mano; el reparto suma 100 %; estrategias y laboratorio
  cuadran con la instantánea y las decisiones; con `--navegador`, las cinco
  vistas en Chromium a 390×844 y 1440×900 sin errores ni avisos de CSP);
  `test/informes-*.test.js` (lectores contra ficheros rotos o enormes, LTTB,
  filtros, y los dos servidores: 401 sin sesión o token, y local = web ruta a
  ruta sobre la misma carpeta, instantánea incluida salvo lo que añade la web);
  `test/parque-{caras,equipo,graficas,maqueta}.test.js` (caras deterministas y
  SVG válido sin `style`, feed con conversaciones, ficha, Equipo, gráficas, y
  la maqueta con la forma y la plantilla de la mesa de verdad);
  `test/web-pwa.test.js` (el service worker guarda la carcasa del panel, todo
  lo que enlaza `index.html`, al abrir con sesión y nunca `/api/*`).

- Extras del 30-sep-2026: `test/integracion-capital.test.js` (el capital cuadra
  con el bróker: Σ porTipo = invertido = Σ posiciones, invertido + efectivo =
  patrimonio, lo disponible con los topes de verdad, con cripto y ETF, con
  cripto por encima del 50 % y con poco efectivo) y la demo acelerada lo
  comprueba cada hora simulada; `test/parque-capital.test.js` (explicaciones sin
  cifras que no estén en la instantánea, la franja con su reparto y sus
  botones, la maqueta cuadrada); `test/mercado-universo.test.js` (tipo de cada
  activo); `test/cuant-estrategias.test.js` (notas y estudio de las ETF con los
  umbrales del laboratorio, plazo y tipos de cada mesa);
  `test/integracion-notas-etf.test.js` (la migración de notas, una sola vez,
  sin pisar una nota distinta, y /api/estrategias con estudio, plazo, tipos,
  grupos y el hito «estudio»); `test/parque-reproductor.test.js` (un comité de
  golpe en ~2,5 min en su orden y con su hora, las reuniones por sus turnos, el
  sintético acelerado, una operación a 8 s y quién abre y cierra la espera, la
  reunión recién celebrada al abrir el panel); `test/integracion-bolsa.test.js`
  (el operador de pie junto al Ejecutor mientras su compra de ETF espera a la
  bolsa, y de vuelta al salir); `test/latido-cerrojo.test.js` (los jefes, 15 min
  en la sala); `test/parque-graficas.test.js` (agrupar y el aviso del estudio);
  `scripts/probar-vistas.js` (plazo y tipos de cada mesa y los grupos).

`scripts/estudiar-limites.js` no es un caso conocido (no está en
`probar-todo`): repite con las velas de `data/cache/probar/` el estudio con el
que se eligieron los límites y las mesas iniciales del 30-sep-2026.

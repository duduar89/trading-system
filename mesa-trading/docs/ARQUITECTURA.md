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
{ simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto'|'accion', nombre: 'Bitcoin' }
```

**Universo** (`src/mercado/universo.js`, dueño B):
- Cripto (sin clave): BTC/USD, ETH/USD, SOL/USD, LINK/USD, AVAX/USD, DOGE/USD.
- ETF (solo con claves de Alpaca, feed IEX): SPY, QQQ, IWM, TLT, GLD, XLE, XLK, XLF.
- Exporta `UNIVERSO`, `porSimbolo(s)`, `porEtiqueta(e)`, `clave(s)`,
  `desdeClave('BTCUSD') → 'BTC/USD'`, `disponibles({ hayAlpaca }) → Activo[]`,
  `esCripto(s)`.

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
async noticias(simbolos, { desde, limite }) → [{ id, titular, resumen, fuente, t, url, simbolos }]  // [] si no hay claves
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
}

Senal = {
  accion: 'abrir' | 'mantener' | 'cerrar' | 'nada',
  peso,              // 0..1, fracción del capital de la MESA para este símbolo si hay posición
  stop,              // precio de stop al abrir (obligatorio en 'abrir'), null si no aplica
  objetivoPrecio,    // null si la estrategia no usa objetivo
  motivo,            // texto corto CON las cifras (p. ej. 'SMA7 84.120 > SMA25 83.900; cierre 84.300 > SMA200 79.100')
  estado,            // texto para el bocadillo: 'Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H)'
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
Mesa = { id, nombre, familia, marco, universo: [simbolo], params, filtros: [{id, parametro}], estado: 'titular'|'incubacion'|'banquillo', origen: 'inicial'|'laboratorio', nota }
```
Iniciales: `tendencia` (BTC, ETH, SOL · 4Hour), `momentum` (6 cripto), `reversion` (BTC, ETH),
`ruptura` (BTC, ETH, SOL); con claves además `momentum-etf` (SPY, QQQ, IWM, TLT, GLD) y
`reversion-etf` (SPY, QQQ). Estado de arranque (decisión del 30-sep-2026):
`momentum` es la única **titular**; todas las demás arrancan en **incubación**
(2 %) y su `nota` dice por qué con la cifra: tendencia y reversión pierden con
costes, ruptura no diversifica frente a momentum (correlación diaria 0,80,
`scripts/estudiar-limites.js`) y las de ETF no se pueden validar sin claves.
Pueden ascender por la regla del asignador (§5.7).

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
DEPARTAMENTOS = [
  { id: 'direccion',   nombre: 'Dirección',   color: '#f5b942', sala: 'direccion' },
  { id: 'macro',       nombre: 'Macro',       color: '#8b5cf6', sala: 'macro' },
  { id: 'analisis',    nombre: 'Análisis',    color: '#22c55e', sala: 'analisis' },
  { id: 'mesas',       nombre: 'Mesas',       color: '#3b82f6', sala: 'parque' },
  { id: 'riesgos',     nombre: 'Riesgos',     color: '#ef4444', sala: 'riesgos' },
  { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos' },
  { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio' },
]
SALAS = ['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso']
crearPlantilla({ universo, mesas }) → Agente[]
Agente = { id, nombre, departamento, rol, queDecide, usaLLM: boolean, sala, mesaId?, simbolo?, etiqueta?, puestoId? }
```
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
  publicar({ de, para = 'todos', canal, tipo, texto, datos = null, importancia = 1, costeUsd = 0 }) → Mensaje
  ultimos(n = 150, filtro? /* función, u objeto { canal, tipo, de, para, departamento, desde } */) → Mensaje[]
  desde(t) → Mensaje[]            // t ≥ desde (INCLUSIVO), de los que hay en memoria
  // emite 'mensaje'
}
Mensaje = { id, t, de, deNombre, departamento, para, canal, tipo, texto, datos, importancia, costeUsd }
canal ∈ 'parque'|'analisis'|'macro'|'riesgo'|'ejecucion'|'comite'|'megafono'|'laboratorio'|'direccion'|'sistema'
tipo  ∈ 'estado'|'nota'|'regimen'|'senal'|'propuesta'|'aprobacion'|'veto'|'orden'|'ejecucion'|'cierre'|'alerta'
        |'comite'|'voto'|'decision'|'megafono'|'directiva'|'leccion'|'hipotesis'|'contratacion'|'despido'|'informe'|'sistema'|'descanso'
```
`datos` es lo que leen otros agentes; `texto` es para el humano.
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

`src/agentes/cifras.js` (D): `verificarCifras(texto, entrada) → { ok, noEncontradas: [] }`. Extrae
números del texto (formatos 1.234,56 · 1,234.56 · 12 % · 3,5 $) y los busca
entre todos los números de `entrada` (aplanada; se aceptan redondeos a 0-2
decimales y porcentajes ×100). Signo: un «+» o «−» escrito pegado al número
tiene que coincidir con el del dato («+523,40 $» no pasa si el dato es
−523,40); sin signo escrito se compara el valor absoluto. Enteros 0-31 sin
unidad ni signo se aceptan siempre (conteos, días, horas); con unidad
(«12 %», «5 $») o con signo («+3»), no: son cifras que hay que encontrar.
Una hora de reloj (16:00) solo pasa si esa hora está en los datos.

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

Frases cortas (≤ 140 caracteres), con cifras, sin adjetivos vacíos. Las de
estado imitan el vídeo: «Sin posición en SOL. Esperando a que SMA 7-25 dé
LONG con filtro 200 (4H).»

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
`validarDirectiva(d, ctx)`, `aplicarDirectiva(directivas, d, ahora) → directivas`,
`directivasVigentes(directivas, ahora)`. Sin LLM: palabras clave («pausa»,
«para», «reduce», «baja», «solo cerrar», «no abras», «reanuda» + etiqueta o
nombre de mesa). El humano confirma con «Aplicar» antes de que entre. La
explicación del LLM solo se enseña si sus cifras están en la orden o en las
directivas; el motivo de un `sin_efecto` del LLM, solo si sus cifras están en
la orden o en las reglas (si no, un motivo fijo).

### 6.6 Post-mortem (`src/agentes/postmortem.js`, D)

`CATEGORIAS = ['señal_falsa','stop_estrecho','contra_regimen','noticia','ejecucion','acierto_de_libro','suerte']`
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
los límites en el de Riesgos) y no nombran un voto o un régimen distinto del
calculado. El voto publicado de Macro y Riesgos es siempre el del código. La
`razon` del LLM solo sale si no hubo veto de Riesgos (con veto, el modo
aplicado no es el que razonó) y no nombra otro modo. Durante el comité, los
jefes van a la sala de comité (evento `agente`); las pausas entre puntos son
solo de pantalla y `detener()` las corta.

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
- Noticias (con claves y LLM): cada 4 h en lote → eventos graves bloquean aperturas 24 h en ese activo.
  Solo se marcan vistas tras clasificarlas con éxito (si la llamada falla,
  entran en el lote siguiente) y una noticia solo veta activos que menciona;
  titular y resumen van al LLM como texto de terceros, nunca como instrucciones.
- Comité: cada 4 h y a demanda.
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
- Descanso: un agente sin trabajo durante 2 h (simuladas) va 15 min a la sala de descanso. Nunca durante un comité ni con el fondo en alerta.

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
- `incidentesDesde`: desde cuándo hay registro de incidentes (el arranque del
  fondo; en un estado anterior al registro, el primer arranque con él). El
  criterio f no se da por cumplido hasta que cubre 90 días.
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
| `POST /api/comando/comite` | convoca comité ya |
| `POST /api/comando/megafono` `{texto}` | devuelve la propuesta `{ id, directivas, explicacion }` (no aplica) |
| `POST /api/comando/megafono-aplicar` `{id}` | aplica la propuesta |
| `POST /api/comando/prueba` `{ordenMinima?: true, confirmacion?: 'PRUEBA'}` | comprobación de bróker, datos, F&G y LLM; con confirmación, compra y vende 15 $ de BTC |
| `POST /api/comando/pausar` | solo cerrar hasta Reabrir |
| `POST /api/comando/reabrir` `{confirmacion: 'REABRIR'}` | vuelve a normal desde `pausado` o `bloqueado` si la conciliación está limpia. Desde `solo_cerrar` (pérdida del día) responde `ok: false` (HTTP 200): dura hasta las 00:00 UTC y se levanta solo. No borra el máximo histórico: el mensaje dice cuánto acumula el fondo desde él |
| `POST /api/comando/kill` `{confirmacion: 'KILL'}` | bloquea al instante (y lo guarda), cancela todo y cierra todo. `ok: false` si algo queda sin vender: el fondo sigue bloqueado y se reintenta solo cada pocos minutos. Las acciones con la bolsa cerrada se venden a la apertura |
| `GET/POST /api/comando/ajustes` | ver; cambiar `presupuestoDiaUsd`, `modeloComite`, `modeloAgentes`, `velocidad` (sintético). Los límites se ven, no se cambian. |

Respuesta de comando: `{ ok, mensaje, datos? }` (HTTP 200; 400 si falta la
confirmación o el JSON no vale; 404 comando desconocido; 405 un comando por
GET salvo `ajustes`; 413 cuerpo de más de 64 KB; 415 sin application/json).

**Instantánea (`GET /api/estado` y evento `estado`)**:
```js
{
  version: 1, ahora, modo: 'alpaca'|'simulado'|'sintetico', broker: 'alpaca-paper'|'simulado', velocidad,
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
              sinAsignar: { fraccion, usd },           // capital que ninguna mesa tiene (queda en efectivo)
              vigilancia: { perdidaDiaPct | null, caidaPct, desdeReapertura } },
  // pnlDia/pnlDiaPct: desde el inicio REAL del día (también tras reabrir); caida: desde el máximo HISTÓRICO.
  // vigilancia: lo que mide el vigilante contra sus límites (tras un Reabrir humano después de un kill,
  //   desde la reapertura); es la cercanía a los límites, no el resultado. perdidaDiaPct null antes del cierre diario.
  // exposicion*Pct: la de los libros con, por símbolo, el máximo frente al bróker (una posición del bróker
  //   sin puesto, huérfana, cuenta).
  llm: { activo, modeloComite, modeloAgentes, gastoHoyUsd, presupuestoDiaUsd },
  curva: [{ t, patrimonio }],                            // ≤ 500 puntos
  cotizaciones: [{ simbolo, etiqueta, precio, var24hPct, t }],   // var24hPct: frente al precio de 24 h antes del DATO (t), no
                                                                  //   del latido: con los datos parados no se mueve sola
  departamentos: DEPARTAMENTOS,
  agentes: [{ id, nombre, departamento, rol, queDecide, usaLLM, sala, estado: 'trabajando'|'reunion'|'descanso'|'de_pie'|'banquillo',
              bocadillo: { texto, hasta } | null, mesaId, simbolo, etiqueta, puestoId }],
  // capital: patrimonio · peso · multiplicador · (0,5 con DEFENSIVO), lo que la mesa opera de verdad
  //   (el recorte va al nocional, §6.7); 0 en el banquillo.
  mesas: [{ id, nombre, familia, marco, estado, peso, capital, multiplicador, universo: [etiqueta], params,
            metricas: { operaciones, acierto, factorBeneficio, sharpe, sharpeAjustado, maxDD, adherencia, pnlTotal }, pnlDia,
            nota /* string | null: por qué está así (backtest de arranque, contratación, ascenso, despido) */ }],
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
}
```

---

## 8. Interfaz (E)

Una sola página, HTML + CSS + JS vanilla (sin librerías), en `web/`:
`index.html`, `css/estilo.css`, `js/{app,iso,mapa,dibujo,personajes,paneles,cifras,maqueta}.js`
(scripts clásicos con un namespace `window.Parque`, sin módulos ES para que
abra también desde `file://` en modo maqueta).

- Barra superior: PATRIMONIO, RESULTADO HOY, CAÍDA, EXPOSICIÓN (bruta y
  cripto), POSICIONES, píldoras RÉGIMEN, F&G, «Comité en HH:MM», MODO (PAPEL
  ALPACA ámbar / SIMULADO azul / SINTÉTICO lila), LLM gasto/tope. Si la fila
  de píldoras no cabe, primero se compacta (F&G se queda en el número; la
  palabra, en su título) y solo después se desliza con el borde desvanecido;
  la del estado del fondo va siempre la primera.
- Panel lateral «Departamentos»: chips de filtro por departamento y feed de
  mensajes (avatar del color del departamento, nombre, hora, texto; lo último
  abajo; autoscroll salvo si el usuario ha subido; máx. 300 en el DOM).
- Lienzo isométrico Canvas 2D, rejilla 2:1, tesela 64×32, plano 28×22 con
  salas: parqué (pantalla gigante al fondo con cotizaciones, patrimonio y
  curva, y «Hechos de la mesa»), dirección, macro (elevada), análisis,
  laboratorio, riesgos + operaciones, sala de comité, descanso (sofás,
  máquina). Mesas del parqué en filas por mesa (una fila por familia) con un
  puesto por activo y etiqueta flotante. Monitores verde/rojo/gris según P&L
  abierto, ámbar al enviar orden. Personajes dibujados a mano (cuerpo del
  color del departamento), andan por puertas entre salas cuando cambia su
  `sala`. Bocadillos (máx. 5 a la vez, por importancia).
- Clic en un puesto o agente → tarjeta de detalle (como la imagen 2):
  situación, nocional, cantidad, entrada, stop, objetivo, abierto, P&L del
  día, operaciones, acierto, adherencia, factor, último mensaje, y la mesa del
  puesto con su estado (con tilde: titular, incubación, banquillo), su peso y
  su `nota`; para agentes no-puesto: rol, qué decide, si usa LLM, último mensaje.
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
  `prefers-reduced-motion`. Tope de 30 fps; capa estática en canvas fuera de
  pantalla; pausa con la pestaña oculta.
- `?maqueta=1` (o abrir `index.html` como fichero): genera una instantánea y
  mensajes falsos con `maqueta.js` para poder trabajar la interfaz sin backend.
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

`scripts/estudiar-limites.js` no es un caso conocido (no está en
`probar-todo`): repite con las velas de `data/cache/probar/` el estudio con el
que se eligieron los límites y las mesas iniciales del 30-sep-2026.

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
| `src/riesgo/{limites,vigilante}.js`, `src/cartera/{libros,conciliacion,benchmarks}.js`, `src/aprendizaje/{evaluador,asignador}.js`, `test/riesgo-*.test.js`, `test/cartera-*.test.js`, `test/aprendizaje-*.test.js`, `scripts/probar-riesgo.js`, `scripts/probar-contabilidad.js` | **C · Riesgo, cartera y aprendizaje** |
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
async ultimos(simbolos) → { [simbolo]: { precio, t } }   // t = instante del dato (ms)
async noticias(simbolos, { desde, limite }) → [{ id, titular, resumen, fuente, t, url, simbolos }]  // [] si no hay claves
disponible(simbolo) → boolean
```

`AlpacaDatos({ claveId, secreto, fetch = globalThis.fetch, reloj, carpetaCache, limitador })`:
- Cripto: `https://data.alpaca.markets/v1beta3/crypto/us/bars` y `/latest/bars`
  (o `/latest/trades`), **sin cabeceras** aunque haya claves (una clave mala da
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
async cerrarTodo() → { cerradas: [simbolo], errores: [] }               // DELETE /v2/positions?cancel_orders=true
async relojMercado() → { abierto, proximaApertura, proximoCierre }
async activo(simbolo) → { negociable, fraccionable, minCantidad, incremento, minNocional }

Orden = { id, idCliente, simbolo, lado, cantidad, nocional, estado: 'pendiente'|'parcial'|'ejecutada'|'cancelada'|'rechazada'|'caducada',
          cantidadEjecutada, precioMedio, comision /* $ o null si el bróker no la da */, creada, actualizada, motivo }
```

- `idCliente` ≤ 128 caracteres, determinista (lo construye F, §6.3).
- `AlpacaBroker`: base `https://paper-api.alpaca.markets` fija; importes
  vienen como string → `Number()`. Posiciones cripto vienen como `BTCUSD` →
  `universo.desdeClave`. Para vender usar `qty_available`. No leer
  `pattern_day_trader` ni `daytrade_count` (retirados, ficha §0.1). En envío:
  si hay timeout o 5xx, **no reintentar a ciegas**: consultar
  `GET /v2/orders:by_client_order_id` y reenviar solo si no existe.
- Errores: `class ErrorBroker extends Error { status, tipo, reintentable, cuerpo }` con
  `tipo ∈ 'fondos'|'cantidad'|'invalida'|'lavado'|'limite'|'auth'|'red'|'mercado_cerrado'|'desconocido'`
  (`src/broker/errores.js`). 403 «insufficient buying power» → fondos; 403 «insufficient qty» → cantidad; 403 wash trade → lavado; 422 → invalida; 429 → limite; 401 → auth.
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

`regimenEnFecha(btcDiario, spyDiario, t)` para el laboratorio (usa solo velas cerradas antes de `t`).

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
  decidir(prep, { simbolo, i, posicion /* null o {cantidad, entrada, stop, maxPrecio, barrasAbierta} */, t, contexto }) → Senal,
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
Mesa = { id, nombre, familia, marco, universo: [simbolo], params, filtros: [{id, parametro}], estado: 'titular'|'incubacion'|'banquillo', origen: 'inicial'|'laboratorio' }
```
Iniciales: `tendencia` (BTC, ETH, SOL · 4Hour), `momentum` (6 cripto), `reversion` (BTC, ETH),
`ruptura` (BTC, ETH, SOL); con claves además `momentum-etf` (SPY, QQQ, IWM, TLT, GLD) y
`reversion-etf` (SPY, QQQ).

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
- Operación: `{ simbolo, entradaT, entradaPrecio, salidaT, salidaPrecio, cantidad, pnl, pnlPct, comisiones, barras, motivoSalida: 'señal'|'stop'|'fin' }`.

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
// h = { id, familia, marco, universo:[sim], filtros:[{id, parametro}], origen: 'leccion'|'exploracion', motivo }
async evaluarHipotesis(h, { cargarVelas(sim, marco) → Vela[], contextoHistorico(t), ensayosPrevios, retornosMesasActivas: {mesaId: [{dia, r}]}, maxDDReferencia, costes, limites })
  → { aprobada, criterios: [{ nombre, valor, umbral, ok }], walkforward, dsr, correlacionMax, informe /* texto con cifras */ }
generarHipotesis({ mesas, pistas /* de postmortem.hipotesisDesdeLecciones */, semana }) → Hipotesis[]   // máx. 3
```
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
propuesta = { puestoId, mesaId, simbolo, clase, lado, tipo: 'apertura'|'aumento'|'reduccion'|'cierre'|'stop'|'kill'|'prueba', nocional, cantidad, precio, precioT, stop, precioDecision }
ctx = { ahora, patrimonio, valoracion /* de libros.valorar */, nivel: 'normal'|'solo_cerrar'|'bloqueado', multiplicadorCaida,
        directivas, ordenes: { ultimoMinuto, ultimaHoraPorMesa: {mesaId: n} }, mercadoAbierto: {accion: boolean}, limites }
```
- `bloqueado`: veta todo salvo `kill`.
- Reducciones, cierres y stops se aprueban siempre (reducen riesgo), aunque el precio sea viejo.
- Aperturas y aumentos: vetar si nivel ≠ normal, activo vetado, mesa pausada,
  `soloCerrar`, mercado cerrado (acciones), precio más viejo que el límite,
  desvío > `desvioMaxPrecio` entre `precioDecision` y `precio`, posiciones ≥
  máximo, órdenes por minuto o por mesa/hora agotadas. Reducir para caber en
  `maxPesoPorActivo`, `maxExposicionBruta`, `maxExposicionCripto`, y aplicar
  `multiplicadorCaida` y la reducción del Megáfono. Si tras reducir queda <
  `minNocionalOrden` → vetar.
- Cada motivo lleva texto con las cifras (lo lee la Jefa de riesgos en el chat).

### 5.4 Vigilante (`src/riesgo/vigilante.js`)

```js
vigilar({ ahora, patrimonio, patrimonioInicioDia, pico, puestos /* con stop y precio */, precios, limites, nivelActual, soloCerrarHasta })
  → { nivel, multiplicadorCaida, acciones: [{tipo:'stop', puestoId, simbolo, precio, stop} | {tipo:'kill', motivo} | {tipo:'solo_cerrar', motivo, hasta}], alertas: [texto] }
```
Pérdida del día ≤ −2 % → `solo_cerrar` hasta las 00:00 UTC siguientes;
≤ −3,5 % → kill. Caída desde el máximo ≤ −10 % → `multiplicadorCaida` 0,5;
≤ −15 % → kill. `bloqueado` es pegajoso: solo sale con Reabrir humano.

### 5.5 Carteras sombra (`src/cartera/benchmarks.js`)

`crearBenchmarks({ capital, preciosIniciales, hayAlpaca }) → estado` y
`valorarBenchmarks(estado, precios) → [{ id, nombre, valor, rentabilidad }]`:
`btc` (100 % BTC), `cesta-cripto` (6 cripto a partes iguales), y con claves
`spy` y `btc-spy` (50/50). Comprar y mantener, sin rebalanceo. La sombra
**«mismas mesas sin comité»** la calcula F con puestos `sombra: true`.

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
Despido (→ banquillo, peso 0, sigue en sombra): sharpeAjustado < −0,5 con ≥ 40
operaciones, o maxDD de la mesa > 25 %. Incubación ≥ 60 días: asciende si
sharpe papel > sharpeBacktest − 1 y ≥ 10 operaciones; si no, se descarta.

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
  ultimos(n = 150, filtro?) → Mensaje[]
  // emite 'mensaje'
}
Mensaje = { id, t, de, deNombre, departamento, para, canal, tipo, texto, datos, importancia, costeUsd }
canal ∈ 'parque'|'analisis'|'macro'|'riesgo'|'ejecucion'|'comite'|'megafono'|'laboratorio'|'direccion'|'sistema'
tipo  ∈ 'estado'|'nota'|'regimen'|'senal'|'propuesta'|'aprobacion'|'veto'|'orden'|'ejecucion'|'cierre'|'alerta'
        |'comite'|'voto'|'decision'|'megafono'|'directiva'|'leccion'|'hipotesis'|'contratacion'|'despido'|'informe'|'sistema'|'descanso'
```
`datos` es lo que leen otros agentes; `texto` es para el humano.

### 6.3 LLM (`src/agentes/llm.js`, D)

```js
crearLLM({ apiKey, modeloComite, modeloAgentes, presupuestoDiaUsd, reloj, rutaCostes, cliente? /* inyectable */, fetch? })
  → {
    activo,                                   // hay clave y no se desactivó por 401
    async pedirJSON({ uso: 'comite'|'agentes', proposito, sistema, entrada /* objeto */, instrucciones, esquema, maxTokens = 2000, esfuerzo })
      → { ok: true, datos, costeUsd, modelo, tokens } | { ok: false, motivo: 'sin_clave'|'presupuesto'|'rechazo'|'error'|'esquema', detalle },
    gastoHoy() → usd, estado() → { activo, modeloComite, modeloAgentes, gastoHoyUsd, presupuestoDiaUsd, llamadasHoy, ultimoError },
    fijarModelos({ modeloComite, modeloAgentes }), fijarPresupuesto(usd),
  }
```
Forma de la petición (verificada contra la referencia de la API, 29-sep-2026):
- `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-opus-5`, `claude-fable-5-1`:
  `client.beta.messages.create({ model, max_tokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort, format: { type: 'json_schema', schema } }, system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] })`.
  Sin `thinking`, sin `temperature`. Esfuerzo por defecto: comité `medium`, agentes `low`.
- `claude-haiku-4-5` y cualquier otro: `client.messages.create({ model, max_tokens, output_config: { format }, system, messages })`, sin `effort` ni `fallbacks`.
- `new Anthropic({ apiKey, timeout: 60000, maxRetries: 2 })`.
- Mirar `stop_reason` antes de leer: `refusal` → `motivo: 'rechazo'`; `max_tokens` → error. Leer el primer bloque `text`, `JSON.parse`, validar contra el esquema (validador mínimo propio: tipos, required, enum, additionalProperties) → si falla, `motivo: 'esquema'`.
- Errores con la cadena tipada del SDK: `AuthenticationError` (desactiva el LLM y lo dice), `RateLimitError`, `APIConnectionError`, `APIError`.
- Coste con `usage` y la tabla por MTok (entrada/salida/lectura caché/escritura caché):
  opus-5-5 4/20/0,20/5 · sonnet-5-5 2/10/0,20/2,5 · haiku-4-5 1/5/0,10/1,25 · opus-5 5/25/0,50/6,25 · fable-5-1 10/50/0,25/12,5.
  Cada llamada se apunta en `llm-costes.jsonl`: `{ t, proposito, modelo, entrada, salida, cacheLectura, cacheEscritura, costeUsd, ok, motivo, ms }`.
- Presupuesto diario (UTC): antes de llamar se estima el máximo (≈ caracteres/3 de entrada + `maxTokens` de salida); si no cabe, `motivo: 'presupuesto'`.

`src/agentes/cifras.js` (D): `verificarCifras(texto, entrada) → { ok, noEncontradas: [] }`. Extrae
números del texto (formatos 1.234,56 · 1,234.56 · 12 % · 3,5 $) y los busca
entre todos los números de `entrada` (aplanada; se aceptan redondeos a 0-2
decimales y porcentajes ×100). Enteros 0-31 se aceptan siempre (conteos,
días, horas).

### 6.4 Plantillas (`src/agentes/plantillas.js`, D)

Funciones puras que convierten datos en frases en español, usando
`src/util/formato.js`. Mínimo: `estadoPuesto`, `notaAnalista`, `regimen`,
`propuesta`, `aprobacion`, `veto`, `ejecucion`, `cierre`, `stopSaltado`,
`informeComite` (una por jefe), `decisionComite`, `directiva`, `leccion`,
`hipotesis`, `resultadoHipotesis`, `contratacion`, `despido`, `informeDiario`,
`informeSemanal`, `descanso`, `killSwitch`, `soloCerrar`, `reabrir`,
`conciliacion`. Frases cortas (≤ 140 caracteres), con cifras, sin adjetivos
vacíos. Las de estado imitan el vídeo: «Sin posición en SOL. Esperando a que
SMA 7-25 dé LONG con filtro 200 (4H).»

### 6.5 Megáfono (`src/agentes/megafono.js`, D)

Lista CERRADA de directivas (solo aprietan; caducan):
```js
{ tipo: 'reducir_riesgo', factor: 0.25|0.5|0.75, horas: 1..72 }
{ tipo: 'pausar_activo', simbolo, horas }      { tipo: 'pausar_mesa', mesaId, horas }
{ tipo: 'solo_cerrar', horas }
{ tipo: 'reanudar_activo', simbolo }           { tipo: 'reanudar_mesa', mesaId }   // solo deshacen un apretón previo
{ tipo: 'sin_efecto', motivo }
```
`async interpretar(texto, { llm, universo, mesas }) → { directivas, explicacion, fuente: 'llm'|'palabras_clave' }`,
`validarDirectiva(d, ctx)`, `aplicarDirectiva(directivas, d, ahora) → directivas`,
`directivasVigentes(directivas, ahora)`. Sin LLM: palabras clave («pausa»,
«para», «reduce», «baja», «solo cerrar», «no abras», «reanuda» + etiqueta o
nombre de mesa). El humano confirma con «Aplicar» antes de que entre.

### 6.6 Post-mortem (`src/agentes/postmortem.js`, D)

`CATEGORIAS = ['señal_falsa','stop_estrecho','contra_regimen','noticia','ejecucion','acierto_de_libro','suerte']`
`clasificarReglas(operacion) → { categoria, leccion }` (reglas fijas:
ganadora por regla → acierto_de_libro; ganadora por kill/riesgo → suerte;
perdedora con régimen RISK-OFF en la entrada → contra_regimen; perdedora por
stop en ≤ 2 velas → stop_estrecho; perdedora con deslizamiento > 0,5 % →
ejecucion; resto → señal_falsa).
`async lote({ operaciones, llm }) → [{ operacionId, categoria, leccion, fuente }]` (una
llamada al día; el LLM elige categoría del enum y escribe la lección; la
lección pasa por `verificarCifras`). `hipotesisDesdeLecciones(lecciones30d) → [{ mesaId, categoria, n }]` con n ≥ 5.

### 6.7 Flujo de una operación (F)

```
cierre de vela del marco de la mesa
 → Operador del puesto: estrategia.decidir()          [bus: 'senal' / 'estado']
 → capital de mesa = patrimonio · peso · multiplicador de comité · (0,5 si modo DEFENSIVO)
 → dimensionar()                                       [bus: 'propuesta']
 → Jefa de riesgos: evaluarPropuesta()                 [bus: 'aprobacion' | 'veto']
 → Ejecutor: registro de INTENCIÓN en ordenes.jsonl → enviarOrden() → esperarEjecucion()   [bus: 'orden', 'ejecucion']
 → libros.aplicarEjecucion()                           [bus: 'cierre' si se cierra]
 → (en paralelo, el puesto sombra «sin comité» hace lo mismo con multiplicador 1 y sin directivas, sin bróker)
```
- `idCliente = mt-<mesaId>-<CLAVE>-<velaISO compacta>-<accion>-<n>` (≤ 128).
  Al arrancar, toda orden en INTENCIÓN/ENVIADA sin estado final se consulta
  por `idCliente` antes de nada. Una decisión por puesto y vela
  (`ultimaVela` por mesa en el estado).
- Órdenes de un mismo símbolo, en serie (esperar la ejecución antes de la
  siguiente): evita el rechazo anti-lavado (ficha §0.6).
- Ventas: `min(cantidad del puesto, disponible en el bróker)`.
- Acciones con el mercado cerrado: la decisión queda pendiente y se envía en
  la apertura + 5 min.
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
`verificarCifras`. Durante el comité, los jefes van a la sala de comité (evento `agente`).

### 6.9 Cadencias del orquestador (F: `src/orquestador.js`)

En cada `paso()` (tiempo real: cada 60 s; sintético: cada 5 min simulados):
precios → valorar → vigilante → conciliación (tiempo real: cada 60 s; con
Alpaca, cada 5 min `relojMercado`) → mesas con vela nueva → emitir estado.
- Analistas: con cada vela 1H cerrada, nota técnica (se publica si cambia el sesgo o cada 4 h).
- Macro: régimen con cada vela 1H; mensaje si cambia o cada 4 h. Miedo y codicia cada hora.
- Noticias (con claves y LLM): cada 4 h en lote → eventos graves bloquean aperturas 24 h en ese activo.
- Comité: cada 4 h y a demanda.
- Diario 00:05 UTC: cierre diario (patrimonio inicio de día, pico, curva diaria, sombras, métricas de mesa), post-mortem en lote, informe diario.
- Semanal (lunes 00:10 UTC): laboratorio (≤ 3 hipótesis, en trozos con `setImmediate` para no bloquear), informe semanal (Sharpe 90 d del fondo contra sombras), alarma de deriva.
- Mensual (día 1, 00:15 UTC): asignador → contrataciones (incubación 2 %), ascensos, despidos.
- Descanso: un agente sin trabajo durante 2 h (simuladas) va 15 min a la sala de descanso. Nunca durante un comité ni con el fondo en alerta.

### 6.10 Estado persistido (`data/`)

`estado.json` (atómico, cada latido): mesas y pesos, libros, `ultimaVela` por
mesa, directivas, nivel del fondo, `patrimonioInicioDia`, `pico`, curva
(muestras cada hora, máx. 2.000), sombras, laboratorio (hipótesis y contador
de ensayos), lecciones (últimos 90 días), agentes (estado visual), próximas
cadencias. `mensajes.jsonl`, `ordenes.jsonl`, `operaciones.jsonl`,
`llm-costes.jsonl`, `informes.jsonl`, `broker-simulado.json`, `cache/`.
Arranque: cargar → si bloqueado, sigue bloqueado → resolver órdenes a medias
→ conciliar → operar.

---

## 7. API HTTP y eventos (F ↔ E)

Servidor `node:http` en `127.0.0.1:8765` (variables `PUERTO`, `HOST`). Si hay
`PANEL_TOKEN`, los POST y el SSE lo piden en la cabecera `x-panel-token` o en `?token=`.

| Método y ruta | Qué |
|---|---|
| `GET /` y `/web/*` | estáticos de `web/` |
| `GET /api/estado` | instantánea completa (abajo) |
| `GET /api/eventos` | SSE: `estado` (instantánea, como mucho una cada 2 s reales), `mensaje` (Mensaje), `agente` ({ id, estado, sala, bocadillo }), `ejecucion` (Ejecucion), `ping` (cada 15 s) |
| `GET /api/mensajes?desde=<t>` | mensajes desde `t` |
| `GET /api/operaciones` | últimas 200 operaciones cerradas |
| `GET /api/costes-llm` | gasto por día y por propósito |
| `POST /api/comando/comite` | convoca comité ya |
| `POST /api/comando/megafono` `{texto}` | devuelve la propuesta `{ id, directivas, explicacion }` (no aplica) |
| `POST /api/comando/megafono-aplicar` `{id}` | aplica la propuesta |
| `POST /api/comando/prueba` `{ordenMinima?: true, confirmacion?: 'PRUEBA'}` | comprobación de bróker, datos, F&G y LLM; con confirmación, compra y vende 15 $ de BTC |
| `POST /api/comando/pausar` | solo cerrar hasta Reabrir |
| `POST /api/comando/reabrir` `{confirmacion: 'REABRIR'}` | vuelve a normal si la conciliación está limpia |
| `POST /api/comando/kill` `{confirmacion: 'KILL'}` | cancela todo, cierra todo, bloquea |
| `GET/POST /api/comando/ajustes` | ver; cambiar `presupuestoDiaUsd`, `modeloComite`, `modeloAgentes`, `velocidad` (sintético). Los límites se ven, no se cambian. |

Respuesta de comando: `{ ok, mensaje, datos? }` (HTTP 200; 400 si falta la confirmación).

**Instantánea (`GET /api/estado` y evento `estado`)**:
```js
{
  version: 1, ahora, modo: 'alpaca'|'simulado'|'sintetico', broker: 'alpaca-paper'|'simulado', velocidad,
  fondo: { nivel: 'normal'|'solo_cerrar'|'pausado'|'bloqueado', motivo, multiplicadorCaida },
  cabecera: { patrimonio, pnlDia, pnlDiaPct, caida, exposicionBrutaPct, exposicionCriptoPct, posiciones,
              regimen: { valor, detalle }, miedoCodicia: { valor, etiqueta, sintetico } | null,
              proximoComite, modoComite: 'NORMAL'|'DEFENSIVO'|'SOLO_CERRAR' },
  llm: { activo, modeloComite, modeloAgentes, gastoHoyUsd, presupuestoDiaUsd },
  curva: [{ t, patrimonio }],                            // ≤ 500 puntos
  cotizaciones: [{ simbolo, etiqueta, precio, var24hPct, t }],
  departamentos: DEPARTAMENTOS,
  agentes: [{ id, nombre, departamento, rol, queDecide, usaLLM, sala, estado: 'trabajando'|'reunion'|'descanso'|'de_pie'|'banquillo',
              bocadillo: { texto, hasta } | null, mesaId, simbolo, etiqueta, puestoId }],
  mesas: [{ id, nombre, familia, marco, estado, peso, capital, multiplicador, universo: [etiqueta], params,
            metricas: { operaciones, acierto, factorBeneficio, sharpe, sharpeAjustado, maxDD, adherencia, pnlTotal }, pnlDia }],
  puestos: [{ id, mesaId, simbolo, etiqueta, agenteId,
              posicion: { cantidad, nocional, entrada, stop, objetivo, pnlAbierto, pnlAbiertoPct, abiertaT } | null,
              pnlDia, operaciones, acierto, factorBeneficio, adherencia, estadoTexto, ultimaSenal: { accion, t } | null,
              chispa: [number] /* últimos 16 cierres */ }],
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
  avisos: [texto]                                        // p. ej. 'Con el ordenador apagado no hay stops'
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
  ALPACA ámbar / SIMULADO azul / SINTÉTICO lila), LLM gasto/tope.
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
  día, operaciones, acierto, adherencia, factor, último mensaje; para agentes
  no-puesto: rol, qué decide, si usa LLM, último mensaje.
- Botonera: Comité, Megáfono (modal con texto → propuesta → Aplicar), Prueba,
  Pausar todo, Reabrir (escribir REABRIR), Kill switch (rojo, escribir KILL),
  Ajustes (modal). Controles de cámara y zoom; arrastrar para mover, rueda o
  pellizco para zoom.
- Móvil (< 768 px): barra compacta, panel lateral como hoja inferior, tarjeta
  a pantalla completa.
- Cifras que cuentan hacia arriba (sin rebote) y respeto a
  `prefers-reduced-motion`. Tope de 30 fps; capa estática en canvas fuera de
  pantalla; pausa con la pestaña oculta.
- `?maqueta=1` (o abrir `index.html` como fichero): genera una instantánea y
  mensajes falsos con `maqueta.js` para poder trabajar la interfaz sin backend.
- Sin conexión: franja «Sin conexión con la mesa, reintentando…» y reconexión SSE con espera creciente.

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
  límites: cada motivo de veto y de reducción con su caso; vigilante: −2 %,
  −3,5 %, −10 %, −15 %; conciliación: escalar vs grave; asignador con casos de
  suelo, techo, muestra mínima, despido.
- D: petición al LLM con cliente falso → forma exacta por modelo (opus vs
  haiku), cálculo de coste, tope diario, `refusal`, esquema inválido,
  `verificarCifras` con cifras buenas y malas; Megáfono por palabras clave.
- F: demo acelerada de 60 días sintéticos sin fallos: hay operaciones, ningún
  límite duro violado, `Σ puestos = posiciones del bróker`, `patrimonio =
  efectivo + Σ valor de posiciones`, el comité se reúne, el kill switch cierra
  todo; servidor responde `/api/estado` con la forma de §7.

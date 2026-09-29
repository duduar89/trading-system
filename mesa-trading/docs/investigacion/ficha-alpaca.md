# Ficha técnica: Alpaca REST sin librería (comprobada el 29-sep-2026)

Marcas: **[V-doc]** está en la documentación oficial (URL al final). **[V-curl]** lo he probado yo hoy con curl. **[S]** es un supuesto que no he podido verificar.

---

## 0. Hallazgos que cambian el diseño

1. **El PDT ya no existe.** FINRA lo retiró y Alpaca aplica desde el 4-jun-2026 un marco nuevo de margen intradía. Estos campos se quitaron de la API el 6-jul-2026: `pattern_day_trader`, `daytrade_count`, `last_daytrade_count`, `daytrading_buying_power` y `last_daytrading_buying_power`. En su lugar se usa `buying_power`. **El cliente no debe leerlos, porque pueden no venir.** [V-doc blog Alpaca]
2. **Las barras cripto sin clave funcionan, pero con una clave inválida dan 401.** El endpoint público rechaza cabeceras malas. Si las claves no están validadas, las peticiones de datos cripto se hacen **sin cabeceras**. [V-curl]
3. **TAO/USD no existe en Alpaca.** `latest/bars?symbols=TAO/USD` devuelve `200 {"bars":{}}`. Un símbolo desconocido no da error, devuelve el objeto vacío. Sí hay datos de BTC, ETH, SOL, DOGE, ADA, DOT, UNI, AVAX, LINK y XRP (todos /USD), además de BTC/USDT y ETH/BTC. [V-curl]
4. **El volumen de las barras cripto no sirve.** Es solo el del venue de Alpaca: el diario de BTC anda entre 0,6 y 18 BTC. El 28-sep, 876 de 1.433 barras de 1 minuto de BTC tenían `n:0, v:0`, y en DOT fueron 1.279 de 1.399. Los precios OHLC sí valen; **cualquier indicador basado en volumen (VWAP, OBV…) no.** [V-curl]
5. **Las órdenes bracket y las stop simples no existen para cripto.** Solo hay market, limit y stop_limit. El stop de cripto lo tiene que gestionar el propio sistema (stop por software) o una `stop_limit` GTC. [V-doc]
6. **La protección anti-wash-trade también se aplica a cripto y a la cuenta paper.** Devuelve 403. [V-doc user-protection]

---

## 1. Trading paper

**URL base:** `https://paper-api.alpaca.markets` (la real es `https://api.alpaca.markets`). [V-doc]
**Cabeceras:**
```
APCA-API-KEY-ID: <key>
APCA-API-SECRET-KEY: <secret>
Content-Type: application/json
```
[V-doc]

Sin cabeceras, la respuesta es un 401 **HTML** de nginx. Con una clave falsa es `401 {"message": "unauthorized."}`. [V-curl] **Parsear siempre con `try { JSON.parse }`.**

La cuenta paper nace con 100.000 $ [V-doc]. Las claves de paper son distintas de las de la cuenta real [V-doc].

### GET /v2/account [V-doc]
**Todos los importes llegan como string**; hay que usar `Number()`.

| Campo | Uso |
|---|---|
| `equity` | cash + long_market_value + short_market_value |
| `last_equity` | equity del día hábil anterior a las 16:00 ET |
| `cash`, `portfolio_value` (obsoleto, igual a equity) | |
| `buying_power`, `regt_buying_power` | |
| `non_marginable_buying_power` | **es el que cuenta para las órdenes cripto** |
| `long_market_value`, `short_market_value`, `initial_margin`, `maintenance_margin`, `multiplier` (string "1"/"2"/"4"), `sma` | |
| `status` (`ACTIVE`, …), `crypto_status` | |
| `trading_blocked`, `account_blocked`, `transfers_blocked`, `trade_suspended_by_user`, `shorting_enabled` | booleanos |
| `accrued_fees`, `pending_reg_taf_fees`, `balance_asof` | |

- P&L del día = `equity - last_equity`, según la propia doc [V-doc]. Ojo: el "día" termina en el cierre de la bolsa de EE. UU., no a medianoche UTC.
- Condición mínima para operar: `status==="ACTIVE" && !trading_blocked && !account_blocked && !trade_suspended_by_user`. [S, lógica derivada de los campos]

### GET /v2/positions [V-doc]
Devuelve un array. Todo son strings salvo `side` y `asset_marginable`.
```json
{"asset_id":"uuid","symbol":"BTCUSD","exchange":"CRYPTO","asset_class":"crypto",
 "avg_entry_price":"83000.1","qty":"0.012","qty_available":"0.012","side":"long",
 "market_value":"1002.4","cost_basis":"996.0","unrealized_pl":"6.4","unrealized_plpc":"0.0064",
 "unrealized_intraday_pl":"..","unrealized_intraday_plpc":"..","current_price":"83533",
 "lastday_price":"83454","change_today":"0.0009","asset_marginable":false}
```
Los porcentajes (`*_plpc`, `change_today`) vienen en tanto por uno.

- `GET /v2/positions/{symbol_or_asset_id}`: para una posición concreta. [V-doc]
- `DELETE /v2/positions/{symbol_or_asset_id}?qty=X` o `?percentage=0-100`: cierre parcial o total. Los dos parámetros son excluyentes, `qty` admite hasta 9 decimales y devuelve **200 con el objeto Order**. [V-doc]
- `DELETE /v2/positions?cancel_orders=true`: **kill switch**. Devuelve `207` con `[{"symbol":"AAPL","status":200,"body":{…order…}}]`; si falla, 500 "Failed to liquidate". [V-doc]

### Órdenes [V-doc salvo donde se indica]
**POST /v2/orders** devuelve **200** con el objeto Order.

Campos del cuerpo:
- `symbol`, `side` (buy|sell), `type` (market|limit|stop|stop_limit|trailing_stop), `time_in_force` (day|gtc|opg|cls|ioc|fok)
- `qty` **o** `notional` (uno de los dos, nunca ambos)
- `limit_price`, `stop_price`, `trail_price`/`trail_percent`, `extended_hours`
- `client_order_id` (**máx. 128 caracteres**)
- `order_class` (simple|bracket|oco|oto|mleg), `take_profit{limit_price}`, `stop_loss{stop_price,limit_price}`, `position_intent` (buy_to_open|buy_to_close|sell_to_open|sell_to_close)

`qty` y `notional` admiten hasta 9 decimales. **Se recomienda mandar los números como string**: los ejemplos oficiales mezclan string y número [S: que acepte ambos].

**a) Acción, qty fraccionaria** [V-doc fractional]
```json
{"symbol":"AAPL","qty":"3.654","side":"buy","type":"market","time_in_force":"day","client_order_id":"cifra-mom-AAPL-20260929T1930-01"}
```

**b) Acción, notional** [V-doc]. Solo market con `day`; mínimo 1 $ (error `"notional must be >= 1.00"`).
```json
{"symbol":"AAPL","notional":"500.75","side":"buy","type":"market","time_in_force":"day"}
```
- Las fraccionarias solo admiten **`day`**: el fallo es `422 {"code":42210000,"message":"fractional orders must be DAY orders"}`.
- La doc de fraccionarias dice que se aceptan market, limit, stop y stop_limit, siempre con `day`. La referencia de POST dice solo market con `day`. **Para no fallar: market + day.**
- No se pueden vender fraccionarias en corto (`"fractional orders cannot be sold short"`).
- Una orden notional no se puede modificar con PATCH.
- Para saber si un valor es fraccionable, mirar `fractionable=true` en el asset.

**c) Cripto, notional** [V-doc parcial: la doc admite notional o qty en cripto; el TIF sale de la lista cripto]
```json
{"symbol":"BTC/USD","notional":"1000","side":"buy","type":"market","time_in_force":"gtc","client_order_id":"cifra-btc-4h-20260929T1600-buy"}
```

**d) Cripto, qty** [V-doc, ejemplo literal]
```json
{"symbol":"BTC/USD","qty":"0.0001","side":"buy","type":"market","time_in_force":"gtc"}
```

**e) Cripto, stop_limit como stop de protección** [S sobre la forma exacta; la doc dice que stop_limit está soportado]
```json
{"symbol":"ETH/USD","qty":"0.5","side":"sell","type":"stop_limit","stop_price":"2600","limit_price":"2590","time_in_force":"gtc"}
```

**Reglas de cripto:**
- TIF: **`gtc` o `ioc`**. Una página de soporte añade `fok` y un ejemplo de la doc usa FOK: es contradictorio, así que **se usa gtc**. [V-doc]
- No hay corto: *"Cryptocurrencies can not be sold short"*. No hay margen: se evalúa contra `non_marginable_buying_power`. [V-doc]
- Máximo **200.000 $ de notional por orden** y 9 decimales. [V-doc]
- El mínimo es contradictorio (una página dice 1 $ de notional y otra "10/precio USD"). **Leer `min_order_size` y `min_trade_increment` del asset** y no cablear nada. [V-doc]
- Los pares cotizan contra BTC, USD, USDT y USDC. Solo se compra con cash liquidado. [V-doc]

**f) Bracket, solo para acciones** [V-doc]
```json
{"side":"buy","symbol":"SPY","type":"market","qty":"100","time_in_force":"gtc","order_class":"bracket",
 "take_profit":{"limit_price":"301"},"stop_loss":{"stop_price":"299","limit_price":"298.5"}}
```
- TIF `day` o `gtc`; no admite `extended_hours`. [V-doc]
- La referencia dice *"Bracket orders: Available for equity trading; not supported for crypto"*. [V-doc]
- Con qty fraccionaria probablemente no funciona: usar acciones enteras. [S]
- También existen OCO (salida sobre una posición ya abierta, `type:"limit"`) y OTO (con `take_profit` o `stop_loss`, al menos uno). [V-doc]

**Consultar órdenes**
- `GET /v2/orders`: parámetros `status` (open|closed|all, por defecto open), `limit` (por defecto 50, **máx. 500**), `after`, `until`, `direction` (asc|desc, por defecto desc), `nested`, `symbols` (CSV), `side`, `asset_class`. [V-doc]
- Campos del objeto Order: `id`, `client_order_id`, `created_at`, `updated_at`, `submitted_at`, `filled_at`, `expired_at`, `canceled_at`, `failed_at`, `asset_id`, `symbol`, `asset_class`, `notional`, `qty`, `filled_qty`, `filled_avg_price`, `order_class`, `type`, `side`, `time_in_force`, `limit_price`, `stop_price`, `status`, `extended_hours`, `legs`, `position_intent`. [V-doc]
- Estados: `new`, `partially_filled`, `filled`, `done_for_day`, `canceled`, `expired`, `replaced`, `pending_cancel`, `pending_replace`, `accepted`, `pending_new`, `accepted_for_bidding`, `stopped`, `rejected`, `suspended`, `calculated`. [V-doc]
- `GET /v2/orders/{id}` sirve para seguir una orden. Una orden notional llega con `qty: null` hasta que se ejecuta. [S]

**Cancelar órdenes**
- `DELETE /v2/orders`: cancela todas. Devuelve `207 [{"id":"uuid","status":200}]`. [V-doc]
- `DELETE /v2/orders/{id}`: devuelve 204, o 422 si ya no se puede cancelar. [S]

**Idempotencia con `client_order_id`**
- Si se repite uno de una orden activa: `422 {"code":40010001,"message":"client_order_id must be unique"}`. [V-doc learn]
- Recuperar la orden: `GET /v2/orders:by_client_order_id?client_order_id=XYZ`. [V-doc]
- Patrón recomendado: generar el id **antes** del POST, con estrategia, símbolo, timestamp y contador, recortado a 128 caracteres **por la izquierda** para no perder el sufijo. Ante un timeout o un 5xx, consultar por ese id antes de reintentar. Un 422 por duplicado demuestra que la orden **sí** entró.

### GET /v2/clock [V-doc]
```json
{"timestamp":"2025-06-24T14:15:22-04:00","is_open":true,"next_open":"2025-06-25T09:30:00-04:00","next_close":"2025-06-24T16:00:00-04:00"}
```
Las fechas llevan offset de Nueva York. Existe también `/v3/clock` para varios mercados; su esquema no lo he comprobado [S]. `GET /v2/calendar?start=&end=` [S].

### GET /v2/assets/{symbol_or_asset_id} [V-doc]
Para cripto hay que **codificar la barra**: `/v2/assets/BTC%2FUSD`.
```json
{"id":"276e2673-764b-4ab6-a611-caf665ca6340","class":"crypto","exchange":"ALPACA","symbol":"BTC/USD",
 "name":"BTC/USD pair","status":"active","tradable":true,"marginable":false,"shortable":false,
 "easy_to_borrow":false,"fractionable":true,"min_order_size":"0.0001","min_trade_increment":"0.0001","price_increment":"1"}
```
- Las acciones traen además `attributes[]`, `margin_requirement_long` y `margin_requirement_short`; `maintenance_margin_requirement` está obsoleto.
- La lista de pares operables sale de `GET /v2/assets?status=active&asset_class=crypto` (pide clave; sin ella da 401 [V-curl]).
- El ejemplo del asset es antiguo: con `price_increment "1"` no cuadran los precios actuales con decimales. **El redondeo de `limit_price` y `qty` se hace con lo que devuelva la API en cada momento.**

### Extra útil
`GET /v2/account/portfolio/history?period=1W&timeframe=1H&intraday_reporting=continuous&pnl_reset=no_reset` devuelve la curva de patrimonio con arrays `timestamp` (epoch), `equity`, `profit_loss`, `profit_loss_pct`, `base_value`. Para cripto 24/7 la doc recomienda `continuous` + `no_reset`. [V-doc]

---

## 2. Formato de símbolos cripto

| Dónde | Formato | Estado |
|---|---|---|
| Datos de mercado v1beta3 | `BTC/USD` obligatorio; `BTCUSD` da `400 "invalid symbol: BTCUSD does not match ^[A-Z]+x?/[A-Z]+$"` | [V-curl] |
| POST /v2/orders | `BTC/USD`; la doc dice que el legado `BTCUSD` se admite por compatibilidad | [V-doc] / legado [S] |
| GET /v2/positions (respuesta) | **`BTCUSD` sin barra** ("The Position list shows BTCUSD instead of BTC/USD…") | [V-doc soporte] |
| /v2/positions/{…} en la ruta | `BTCUSD` o, mejor, el **`asset_id`** de la posición | [S: terceros confirman BTCUSD] |
| /v2/assets/{…} | `BTC%2FUSD` | [V-doc] |
| Noticias | `BTCUSD` (ejemplo `"AAPL,TSLA,BTCUSD"`) | [V-doc] |

El cliente necesita un normalizador: `toPair("BTCUSD") → "BTC/USD"` con una tabla de monedas de cotización USD, USDT, USDC y BTC. En posiciones, el cruce se hace por `asset_id` o por `symbol.replace('/','')`.

**Cripto en corto: no se puede.** [V-doc]

---

## 3. Datos de mercado (`https://data.alpaca.markets`)

### Barras cripto: `GET /v1beta3/crypto/us/bars` [V-curl]
- **Responde 200 sin clave.** La página de referencia dice que pide autenticación, pero "About Market Data" lo exceptúa ("except historical crypto data") y la prueba lo confirma.
- Las rutas `latest/bars`, `latest/quotes`, `latest/trades`, `latest/orderbooks` y `snapshots` bajo `/v1beta3/crypto/us/` también responden 200 sin clave y en tiempo real: la barra de las 19:31Z llegó a las 19:32Z. [V-curl]
- Valores de `loc`: `us`, `us-1`, `eu-1`, `us-2`, `bs-1`. [V-doc]
- Parámetros:
  - `symbols` (CSV)
  - `timeframe`
  - `start` / `end` (RFC-3339 o YYYY-MM-DD). **Por defecto `start` es el inicio del día UTC y `end` es ahora.** [V-curl]
  - `limit` (por defecto 1000, **máx. 10000**; con 10001 devuelve `400 "invalid limit: larger than the allowed maximum of 10000"`) [V-curl]
  - `page_token`, `sort` (asc|desc)
- **Timeframes** [V-curl]:
  - Aceptados: `[1-59]Min` o `T`, `[1-23]Hour` o `H` (`4H` y `4Hour` valen), `1Day`/`1D`, `1Week`/`1W` (la semana empieza el lunes), `{1,2,3,6,12}Month`.
  - Rechazados con 400: `60Min`, `24Hour` y `5Month`.
- Alineación: las barras de 4H caen en 00/04/08…Z y las diarias en **00:00Z** (UTC). [V-curl]
- Hay histórico de BTC/USD desde el **2021-01-01**. [V-curl]
- **Paginación** [V-curl]: la respuesta trae `next_page_token`, que se pasa como `page_token=` con los mismos parámetros. Cuando no hay más, vale `null`. **El `limit` cuenta sobre todos los símbolos juntos**: con tres símbolos y `limit=5` solo llegaron 5 barras de BTC y un token. Conviene **pedir un símbolo por petición**.
```json
{"bars":{"BTC/USD":[{"t":"2026-09-01T00:00:00Z","o":78565.35,"h":78898,"l":78159.625,"c":78650.5755,"v":0.039443456,"n":117,"vw":78544.076976}]},
 "next_page_token":"QlRDL1VTRHxNfDE3ODgyNjQwMDAwMDAwMDAwMDA="}
```
Formato de `snapshots` [V-curl]:
`{"snapshots":{"BTC/USD":{"dailyBar":{…},"latestQuote":{"ap","as","bp","bs","t"},"latestTrade":{"i","p","s","t","tks"},"minuteBar":{…},"prevDailyBar":{…}}}}`

### Acciones: pide clave (sin ella, 401 [V-curl])
- `GET /v2/stocks/bars` [V-doc]:
  - Parámetros: `symbols`, `timeframe`, `start`, `end`, `limit` (1000 por defecto, máx. 10000, sobre todos los símbolos), `adjustment` (raw|split|dividend|spin-off|all; por defecto raw), `asof`, `feed` (iex|sip|otc|boats), `currency`, `page_token`, `sort`.
  - La respuesta tiene el mismo formato `{"bars":{"AAPL":[…]},"next_page_token":…}`.
  - **Pasar siempre `feed=iex`** en el plan gratuito. Con SIP sin suscripción el `end` tiene que tener al menos 15 minutos de antigüedad; si no, `403 "subscription does not permit querying recent SIP data"`. El código es contradictorio: 40010001 en el artículo, 42210000 en la FAQ, así que **se detecta por el texto**. [V-doc]
  - Las barras diarias llevan la marca de medianoche de Nueva York, es decir 04:00Z en verano y 05:00Z en invierno. [V-doc FAQ]
  - `adjustment=all` para calcular indicadores. [S, criterio]
- `GET /v2/stocks/snapshots?symbols=AAPL,SPY&feed=iex`: `latestTrade`, `latestQuote`, `minuteBar`, `dailyBar` y `prevDailyBar` por símbolo. [V-doc] El objeto sale indexado por símbolo en el nivel superior, sin envoltorio `snapshots` [S].
- `GET /v2/stocks/bars/latest?symbols=…&feed=iex` devuelve `{"bars":{"AAPL":{t,o,h,l,c,v,n,vw}}}`. [V-doc]
- El volumen de IEX es una fracción mínima del total: 12.630 operaciones frente a 535.000 en SIP para AAPL. **No usar el volumen de IEX como volumen de mercado.** [V-doc FAQ]

### Noticias: `GET /v1beta1/news` (pide clave; sin ella, 401 [V-curl])
- Parámetros: `symbols` (CSV, cripto sin barra: `BTCUSD`), `start`, `end`, `sort` (por defecto desc), `limit` (**1–50, por defecto 10**), `include_content`, `exclude_contentless`, `page_token`. [V-doc]
- Respuesta: `{"news":[{"id","headline","author","created_at","updated_at","summary","content","url","images","symbols","source"}],"next_page_token":…}`. [V-doc]

### Límites de peticiones
| API | Límite | Estado |
|---|---|---|
| Trading (paper incluido) | **200/min por cuenta**, 429 al pasarse | [V-doc soporte] |
| Datos, plan Basic (gratis) | **200/min**, tiempo real solo IEX, websocket de 30 símbolos, histórico desde 2016 | [V-doc] |
| Algo Trader Plus (99 $/mes) | 10.000/min, SIP | [V-doc] |
| Cripto sin clave | cabeceras `X-Ratelimit-Limit: 200`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (epoch en segundos) | [V-curl] |

Según el foro, las cabeceras `X-RateLimit-*` pueden faltar en una respuesta 429 [S], así que hay que hacer **backoff exponencial** sin depender de ellas.

### Fear & Greed: `https://api.alternative.me/fng/?limit=2&format=json` [V-curl]
```json
{"name":"Fear and Greed Index","data":[{"value":"73","value_classification":"Greed","timestamp":"1790640000","time_until_update":"16018"},
 {"value":"74","value_classification":"Greed","timestamp":"1790553600"}],"metadata":{"error":null}}
```
Los valores son strings. El `timestamp` es epoch en segundos, a las 00:00 UTC; el índice es **diario**.

---

## 4. Comisiones, PDT y horarios

**Comisiones de cripto en la cuenta real**, sobre el volumen de 30 días [V-doc crypto-fees]:

| Nivel | Volumen 30 días | Maker | Taker |
|---|---|---|---|
| 1 | 0–100k | 0,15 % | 0,25 % |
| 2 | 100k–500k | 0,12 % | 0,22 % |
| 3 | 500k–1M | 0,10 % | 0,20 % |
| 4 | 1M–10M | 0,08 % | 0,18 % |
| 5 | 10M–25M | 0,05 % | 0,15 % |
| 6 | 25M–50M | 0,02 % | 0,13 % |
| 7 | 50M–100M | 0,02 % | 0,12 % |
| 8 | 100M+ | 0,00 % | 0,10 % |

- Se cobra sobre lo que se **recibe** en cada operación.
- Se contabiliza **al final del día**, como actividad `CFEE` o `FEE` (`GET /v2/account/activities/CFEE`). [V-doc]
- Las acciones no tienen comisión (los ejemplos lo dan por hecho).

**¿La cuenta paper simula las comisiones de cripto? NO ESTÁ DOCUMENTADO [S].**
- La doc de paper dice que **no** simula impacto de mercado, deslizamiento por latencia, comisiones regulatorias, dividendos ni coste de préstamo.
- Sí simula **ejecuciones parciales aleatorias el 10 % de las veces**, y solo ejecuta contra el NBBO. [V-doc]
- No hay dato; no se inventa. Propuesta: el sistema lleva aparte una "comisión estimada" al 0,25 % taker del nivel 1 y la etiqueta **como estimación**. Pasadas 24 h, se consulta `activities/CFEE` para ver si paper las carga.
- Un blog de terceros afirma que las órdenes cripto de paper se ejecutan contra el libro real de Coinbase Prime. [S]

**PDT:** retirado el 4-jun-2026 y sustituido por el marco de margen intradía. Los campos se quitaron el 6-jul-2026 (ver punto 0). Las reglas de margen intradía **no se aplican a cripto**. [V-doc] Aun así puede llegar un 403 con código `40310100` "pattern day trading protection" en entornos antiguos [V-doc learn, posiblemente obsoleto].

**Horario de acciones** [V-doc]:
- Sesión regular: 9:30–16:00 ET.
- Pre-apertura: 4:00–9:30 ET (lunes a viernes).
- After-hours: 16:00–20:00 ET (lunes a viernes).
- Nocturna: 20:00–4:00 ET (domingo a viernes).
- Fuera del horario regular: solo `limit` con `extended_hours:true` y TIF `day` o `gtc`.
- Para saberlo en cada momento: `GET /v2/clock`.

**Cripto:** 24 horas, 7 días. [V-doc]

---

## 5. Errores y cómo detectarlos [V-doc learn salvo donde se indica]

Formato de los errores de trading:
```json
{"code":40310000,"message":"insufficient buying power","buying_power":"558660.03","cost_basis":"680930026.5"}
```

| HTTP | code | message (se decide por **código + texto**) | Qué hacer |
|---|---|---|---|
| 401 | — | `unauthorized.` (con clave mala) o HTML de nginx (sin clave) | Parar; revisar las claves y el entorno paper/real |
| 403 | 40310000 | `insufficient buying power` | Reducir tamaño; releer la cuenta |
| 403 | 40310000 | `insufficient qty available for order` | Hay órdenes abiertas que bloquean la qty: cancelarlas primero |
| 403 | — | `insufficient balance for …` (cripto) [V-doc soporte] | Igual que la anterior |
| 403 | 40310000 | `asset "X" is not fractionable` | Usar qty entera |
| 403 | 40310000 | `account is not allowed to short` / `…not authorized to trade` / `…restricted to liquidation only` | Pausar la estrategia |
| 403 | — | wash trade potencial (paper y cripto incluidos) [V-doc] | No mandar una orden opuesta con otra abierta; cancelar antes o usar OCO/bracket |
| 403 | 40010001 o 42210000 | `subscription does not permit querying recent SIP data` | Usar `feed=iex` |
| 422 | 40010001 | `client_order_id must be unique` | La orden ya existe: consultar `orders:by_client_order_id` |
| 422 | 40010001 | `invalid time_in_force`, `invalid order type`, `qty or notional is required`, `limit orders require a limit price`, `stop limit orders require both stop and limit price`, `market orders require no stop or limit price` | Error de programación: no reintentar |
| 422 | 42210000 | `fractional orders must be DAY orders` | TIF `day` |
| 422 | — | `notional must be >= 1.00`, `fractional orders cannot be sold short`, `extended hours order must be DAY or GTC limit orders` | No reintentar |
| 400 (datos) | — | `invalid limit…`, `invalid symbol…`, `timeframe period number is larger…` [V-curl] | Error de programación |
| 429 | — | Too Many Requests | Backoff exponencial; no fiarse de las cabeceras |
| 500 / 503 / 504 | — | Error del servidor o timeout | Reintentar, **pero antes consultar por `client_order_id`** |

Una orden puede recibir 200 y quedar `rejected` después, así que tras el POST hay que consultar `GET /v2/orders/{id}` hasta que llegue a un estado final. [S, terceros]

---

## Fuentes
- https://docs.alpaca.markets/reference/postorder
- https://docs.alpaca.markets/docs/orders-at-alpaca
- https://docs.alpaca.markets/docs/fractional-trading
- https://docs.alpaca.markets/docs/crypto-trading
- https://docs.alpaca.markets/us/docs/crypto-trading-1
- https://docs.alpaca.markets/us/docs/crypto-fees
- https://docs.alpaca.markets/reference/getaccount-1
- https://docs.alpaca.markets/docs/working-with-account
- https://docs.alpaca.markets/reference/getallopenpositions
- https://docs.alpaca.markets/reference/deleteallopenpositions-1
- https://docs.alpaca.markets/reference/deleteopenposition-1
- https://docs.alpaca.markets/reference/getopenposition-1
- https://docs.alpaca.markets/us/reference/getallorders-1
- https://docs.alpaca.markets/reference/deleteallorders-1
- https://docs.alpaca.markets/reference/getorderbyclientorderid
- https://docs.alpaca.markets/us/reference/legacyclock
- https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id
- https://docs.alpaca.markets/reference/stockbars
- https://docs.alpaca.markets/reference/stocksnapshots-1
- https://docs.alpaca.markets/reference/stocklatestbars-1
- https://docs.alpaca.markets/reference/cryptobars-1
- https://docs.alpaca.markets/reference/news-3
- https://docs.alpaca.markets/docs/about-market-data-api
- https://docs.alpaca.markets/us/docs/market-data-faq
- https://docs.alpaca.markets/docs/paper-trading
- https://docs.alpaca.markets/docs/user-protection
- https://docs.alpaca.markets/us/docs/the-intraday-margin-rule
- https://docs.alpaca.markets/reference/getaccountportfoliohistory-1
- https://alpaca.markets/blog/finra-retires-the-pdt-rule-introducing-alpacas-new-intraday-margin-framework/
- https://alpaca.markets/support/symbology-positions-list
- https://alpaca.markets/support/usage-limit-api-calls
- https://alpaca.markets/support/what-type-of-orders-are-supported-for-cryptocurrency
- https://alpaca.markets/learn/how-to-fix-common-trading-api-errors-at-alpaca
- https://hmmtrade.com/blog/alpaca-paper-gotchas (terceros; solo para los supuestos)

Pruebas con curl hechas hoy contra `data.alpaca.markets` (v1beta3 cripto: bars, latest, snapshots, orderbooks; v2 stocks; v1beta1 news), contra `paper-api.alpaca.markets` (sin clave y con clave falsa) y contra `api.alternative.me/fng`.
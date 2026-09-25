# 03 · Cripto sistemático y delta-neutral

[← Volver al informe](README.md) · Herramienta: [`herramientas/funding.py`](herramientas/funding.py)

Las estrategias **delta-neutral** no apuestan a que el precio suba o baje. **Cobran por asumir un riesgo** que otros no quieren: financiar el apalancamiento de los minoristas, dar liquidez, prestar stablecoins. No es alfa: es una prima de riesgo con colas feas. Aquí tu ventaja es automatizar, vigilar y salir a tiempo.

**El listón que hay que superar.** Las [Letras del Tesoro a 12 meses al 2,85 %](https://www.tesoro.es/en/letras/12-meses) (septiembre de 2026), sin riesgo de smart contract, de exchange ni de cambio euro/dólar.

**Resumen:**

| Estrategia | Capital | Realista (neto, 2025–26) | Riesgo que asumes | Nota |
|---|---|---|---|---|
| Carry de funding: spot largo + perpetuo corto | 500 €+ | 3–8 %/año sobre el capital total | Funding negativo, exchange, liquidación de la pata corta | **6** |
| Spread de funding entre exchanges (+ Pendle Boros) | 2 k€+ | 4–10 % variable | Dos contrapartes, smart contracts | **6** |
| Vault HLP de Hyperliquid | 100 €+ | ~7 % ahora; históricamente 15–30 % con caídas | Manipulación, decisiones discrecionales del equipo | **6** |
| Préstamo de USDC en Aave o Morpho | 100 €+ | 3,5–6 % | Smart contract, cambio euro/dólar | **5** |
| sUSDe de Ethena | 100 €+ | 4,5–9,4 %, sigue al funding | Emisor, custodia en exchanges | **4** |
| Liderar tu propio vault en Hyperliquid | 1–5 k€ | 0–10 % o pérdidas | Selección adversa, bugs | **4** |
| Farming de puntos + carry | 500 €+ | Muy incierto | El token acaba sin valor | **4** |

---

## 1. Carry de funding: spot largo + perpetuo corto · 6/10 · confianza alta

**Mecánica.** Compras spot y vendes el perpetuo por el mismo importe. Mientras el funding sea positivo, cobras cada 1–8 horas y el precio te da igual. Un bot entra cuando el funding anualizado supera un umbral (por ejemplo un 10 %) y sale cuando se acerca a cero.

**Por qué existe.** Los minoristas quieren ir largos con apalancamiento y hay poco capital dispuesto a arbitrarlo, porque exige margen y tiene riesgo de liquidación. El [BIS (WP 1087)](https://www.bis.org/publ/work1087.pdf) lo documenta:

- el carry cripto supera el 10 % anual de media y llega al 60 %;
- **un carry alto anticipa desplomes**, justo cuando la pata corta sufre.

**Datos reales:**

- **Tercer trimestre de 2025:** funding positivo el 92 % del tiempo. En BitMEX, el de BTC estuvo exactamente en el 0,01 %/8 h (≈11 % anual) el 78 % del tiempo ([BitMEX](https://www.globenewswire.com/news-release/2025/10/14/3166184/0/en/BitMEX-Study-Finds-Cryptocurrency-Funding-Rates-Positive-92-of-the-Time-Revealing-a-Structural-Market-Bias.html)).
- **2026:** **67 días seguidos de funding negativo** en BTC (hasta mayo). En agosto volvió al 8–15 % ([Coinglass](https://www.coinglass.com/FundingRate/BTC)).
- **Carry en futuros de CME:** cayó al ~4 % en febrero de 2025 ([CoinDesk](https://www.coindesk.com/markets/2025/03/21/what-the-collapse-of-the-u-s-bitcoin-etf-cash-and-carry-trade-means-for-investors)).
- **Medido hoy con la herramienta** (25-sep-2026, ETH, últimos 30 días): **10,05 % en Hyperliquid y 5,36 % en OKX**, positivo en más del 90 % de los periodos.

**Realista.** Sobre el capital **total** (spot + margen), tras comisiones: **3–8 % anual** en 2025–26, a menudo parecido a prestar USDC. Las cifras de "19 % en 2025" o "115 % en 6 meses" que circulan vienen de marketing o de backtests sin fricciones.

**Qué puede ir mal:**

- Funding negativo durante meses.
- Liquidación de la pata corta en un pico si tienes poco margen.
- Congelación o quiebra del exchange, o que retiren el par.
- Desanclaje del colateral: **USDe cayó a 0,65 en Binance el 10–11 de octubre de 2025**, aunque on-chain se mantuvo ([CoinDesk](https://www.coindesk.com/markets/2025/10/13/no-ethena-s-usde-didn-t-de-peg)).
- Fiscalidad: miles de cobros de funding y permutas que hay que declarar.

**Dónde, desde España:**

- **Exchanges con licencia MiCA:** Kraken (Chipre) u OKX (Malta) ofrecen perpetuos con apalancamiento limitado para minoristas. Aquí solo necesitas 1x.
- **Hyperliquid** no restringe España: solo EE. UU., Ontario y países sancionados. **No necesitas VPN.**
- **Binance y Bybit global** ya no pueden atender a residentes de la UE sin autorización MiCA desde el 1-jul-2026.

**Pasos:**

```bash
python3 herramientas/funding.py --historico BTC --dias 90   # ¿cuánto ha pagado de verdad?
python3 herramientas/funding.py --spread                    # diferenciales entre exchanges
```

1. Descarga el funding histórico ([hyperliquid-python-sdk](https://github.com/hyperliquid-dex/hyperliquid-python-sdk) y [ccxt](https://github.com/ccxt/ccxt)).
2. Backtest con comisiones reales **incluyendo los meses negativos de 2026**.
3. Un mes en papel.
4. BTC/ETH a 1x, con reglas de salida automáticas y alertas de margen.
5. Nada de altcoins con funding del 300 %: suele ser un pico que precede a una manipulación o un squeeze.

**Frameworks:** [nautilus_trader](https://github.com/nautechsystems/nautilus_trader). [Hummingbot](https://hummingbot.org/blog/funding-rate-arbitrage-and-creating-vaults-on-hyperliquid/) trae una estrategia de funding arb ya hecha. [freqtrade](https://github.com/freqtrade/freqtrade) está pensado para operar en una dirección, así que para carry hay que adaptarlo.

---

## 2. Spread de funding entre exchanges (Hyperliquid frente a exchanges centralizados) + Pendle Boros · 6/10

Largo en el perpetuo del exchange donde el funding es bajo y corto donde es alto. Hyperliquid paga cada hora; los centralizados, cada 8 horas.

[Boros](https://medium.com/boros-fi/cross-exchange-funding-rate-arbitrage-a-fixed-yield-strategy-through-boros-c9e828b61215) (de Pendle) permite **fijar el tipo** y convertir un spread variable en una rentabilidad fija. Pendle declara un **5,98–11,4 % de rentabilidad fija media**, pero son datos del propio emisor.

- **Por qué hay oportunidad:** es un mercado joven, con [unos 150 M$ de posiciones abiertas en agosto de 2026](https://pendlefi.substack.com/p/pendle-print-107).
- **Riesgo:** el 10-oct-2025 Binance bloqueó depósitos y retiradas. Justo cuando más falta hace mover colateral, puede que no puedas.

## 3. Vault HLP de Hyperliquid · 6/10

Depositas USDC en el vault del propio protocolo, que hace market making y liquidaciones. Tiene un bloqueo de 4 días y no cobra comisión de rendimiento.

**Números:**

- **Hoy:** ~7 % anual el último mes (agosto de 2026), con el TVL un 70 % por debajo del pico ([Datawallet](https://www.datawallet.com/crypto/hyperliquid-hlp-explained)).
- **Días buenos:** el 10-oct-2025 ganó 40 M$ en menos de 48 horas ([CoinGecko](https://www.coingecko.com/learn/hyperliquid-hlp-vault-analysis)).
- **Días malos:** en JELLY (marzo de 2025) llegó a perder 12–13,5 M$ sin realizar, y **el equipo cerró el mercado de forma discrecional** ([Oak Research](https://oakresearch.io/en/analyses/investigations/hyperliquid-jelly-attack-context-vulnerability-team-solution)). También perdió en POPCAT (4,9 M$) y en FARTCOIN (1,5 M$).

**Regla:** como mucho un 10–20 % de tu cartera cripto. Prueba primero la retirada completa con poco dinero.

## 4. Préstamo de USDC en Aave V3 o Morpho · 5/10

No es una ventaja sofisticada: es **el listón mínimo** que cualquier bot delta-neutral tiene que superar, y el sitio donde aparcar el capital que no usas.

- **Aave:** 3,3–5,2 % ([agosto de 2026](https://eco.com/support/en/articles/15253991-best-usdc-yield-platforms-2026-aave-morpho-sky-compared)).
- **Morpho:** 4,1–6,8 %, con riesgo del gestor del vault.
- **Tras el riesgo euro/dólar**, compáralo con las Letras.

## 5. sUSDe de Ethena · 4/10

Es un cash-and-carry empaquetado: la misma prima que la estrategia 1, pero sin operar, con riesgo del emisor y de custodia en exchanges centralizados.

- **Rendimiento:** 9,4 % en abril de 2026 y ~4,5 % en junio de 2026. Cuando el funding es negativo, rinde menos que Aave.
- **Acceso:** USDe no está autorizada bajo MiCA, así que solo se consigue on-chain.
- **Nunca la uses como colateral en un exchange centralizado.**

## 6. Liderar tu propio vault en Hyperliquid · 4/10

Montas una estrategia con Hummingbot o Nautilus y la operas como vault. Te llevas el [10 % del beneficio de los depositantes](https://hummingbot.org/blog/funding-rate-arbitrage-and-creating-vaults-on-hyperliquid/) y construyes un **historial verificable on-chain**.

Pero en BTC/ETH mandan las firmas de alta frecuencia. Y **captar dinero de terceros activamente en España puede ser gestión de carteras sin licencia.**

## 7. Farming de puntos combinado con carry · 4/10

Llevas la pata que ya es rentable por el funding a exchanges descentralizados de perpetuos nuevos que tienen programa de puntos. **Una sola wallet, nada de multicuentas.**

El [85 % de los airdrops filtra cuentas duplicadas (sybil)](https://www.luvkaizen.com/blogs/token-farming-guide) y el 88 % de los tokens pierde valor en 3 meses. En España, el airdrop **tributa al recibirlo**, aunque después se desplome.

---

## Trampas

- **Bots de liquidación y MEV como particular.** Es un mercado en el que el ganador se lo lleva todo y lo dominan searchers con infraestructura. En Hyperliquid, las liquidaciones ya las captura HLP.
- **Usar VPN o mentir en el KYC en exchanges sin licencia en la UE.** Te congelan la cuenta y no tienes ninguna protección.
- **Stablecoins "de rendimiento" opacas** o vaults con APY mucho mayor que el funding + Aave. El riesgo existe aunque no lo veas.
- **Guías de funding arb con APR del 19–115 %.** Ignoran que solo la mitad del capital cobra, las comisiones y los meses negativos.
- **Fiscalidad.** Cada permuta cripto-cripto (incluida cripto → stablecoin) es una ganancia o pérdida. Presenta el Modelo 721 si tienes más de 50 k€ fuera de España. Con DAC8, desde 2026 Hacienda recibe los datos de los exchanges de la UE. Detalle en el [doc 07](07-fiscalidad-y-legal.md).

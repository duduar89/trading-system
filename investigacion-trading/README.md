# Ganar dinero con código, IA y mercados: lo que funciona de verdad

**Investigación para un programador con conocimientos de IA, residente en España · 25 de septiembre de 2026**

Esto no es asesoramiento financiero. Es una investigación con fuentes: cada cifra lleva enlace y fecha, y todo se ha buscado con escepticismo. La metodología está al final.

---

## La respuesta corta

**La verdad incómoda.** Hacer un bot de IA que prediga el precio y te haga rico es justo lo que **no** funciona. Hay datos recientes que lo muestran:

- En [StockBench](https://arxiv.org/abs/2510.02209) (octubre 2025), la mayoría de agentes LLM no superan a comprar y mantener.
- En [Alpha Arena](https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/) (noviembre 2025, dinero real), 4 de 6 modelos perdieron. GPT-5 perdió un 59 %.
- En [Prediction Arena](https://arxiv.org/html/2604.07355v1) (enero–marzo 2026), los modelos punteros perdieron entre un 16 % y un 31 % en Kalshi.
- En Polymarket, [el 84 % de 2,5 millones de wallets pierde](https://www.coindesk.com/markets/2026/04/29/a-tiny-group-is-winning-on-polymarket-as-under-1-of-wallets-take-half-the-profits), y menos del 1 % se lleva la mitad de las ganancias. Ese 1 % son bots industriales de market making.

**Dónde gana dinero de verdad alguien con tu perfil.** Aparece siempre en tres sitios:

1. **Subsidios que alguien paga a propósito.** Bonos de captación de las casas de apuestas, premios de torneos de IA, recompensas por aportar liquidez o por encontrar fallos. El dinero no sale de ganarle al mercado: alguien lo reparte, y tu código te ayuda a cogerlo con eficiencia.
2. **Primas de riesgo cobradas con disciplina y a bajo coste.** Funding de perpetuos, tendencia en futuros, venta de volatilidad. Son rentabilidades modestas y reales, a cambio de aguantar riesgos que otros no quieren. Aquí tu ventaja es automatizar, controlar el riesgo y no sobreajustar, no predecir.
3. **Vender palas.** Seguridad DeFi, herramientas, bots por encargo. Ingresos que no dependen de acertar el mercado.

**Mis tres primeras recomendaciones para ti:**

| # | Qué | Por qué a ti | Dinero realista |
|---|---|---|---|
| 1 | **Matched betting con herramientas propias** (bonos de casas con licencia en España + Betfair Exchange) | Legal, casi sin riesgo y lo aceleras programando. **Tiene fecha límite: marzo de 2027** (ver [doc 02](02-apuestas-cuantitativas.md)) | ~1.600–2.400 € una sola vez + 150–300 €/mes, **tributa en la base general** |
| 2 | **Bot de IA en los torneos de Metaculus** (FutureEval + MiniBench) | Es literalmente "programación + IA = dinero", sin capital y con créditos de LLM regalados | 50.000 $ por temporada, 3 temporadas al año. Un bot bueno saca cientos o miles; uno mediano, casi nada |
| 3 | **Carry de funding delta-neutral en cripto** con tu propio bot (BTC/ETH, spot largo + perpetuo corto) | Prima de riesgo real, medible y automatizable. Ya tienes el escáner hecho: [`herramientas/funding.py`](herramientas/funding.py) | 3–8 % anual sobre el capital total en 2025–26. Hay que compararlo con las [Letras del Tesoro al 2,85 %](https://www.tesoro.es/en/letras/12-meses) |

Si tienes paciencia para una curva de aprendizaje de 6 a 12 meses, lo que más potencial tiene para un programador es **la seguridad DeFi**: bug bounties y concursos de auditoría (ver [doc 05](05-vender-palas.md)). Un fallo crítico en Immunefi paga una **mediana de 20.000 $**.

---

## Ranking completo

La puntuación es mía y mide el atractivo **para ti**: tamaño y solidez de la ventaja, por la facilidad para tu perfil, por el riesgo. La columna "España" indica si es legal hoy sin trucos.

| Oportunidad | Capital | Rendimiento realista (neto) | De dónde sale el dinero | España | Nota | Doc |
|---|---|---|---|---|---|---|
| Matched betting (bonos) | 50–3.000 € | 1.600–2.400 € una vez + 150–300 €/mes | Subsidio de captación (347 M€ en promociones en 2025) | ✅ | **8** | [02](02-apuestas-cuantitativas.md) |
| Bots LLM en Metaculus | 0 € | 0 – pocos miles $/temporada | Premios de patrocinadores | ✅ | **8** | [01](01-sin-capital-ia-y-ml.md) |
| Rotación de fondos indexados con traspasos | desde 10 € | Mercado + 0,5–1,5 pp/año por diferir impuestos (estimación) | Ventaja fiscal española | ✅ | **8** | [04](04-bolsa-sistematica.md) |
| Motor fiscal propio (FIFO + compensar pérdidas) | 0 € | Ahorra 19–30 % de las pérdidas que aproveches | Planificación fiscal legal | ✅ | **8** | [07](07-fiscalidad-y-legal.md) |
| Bug bounties y concursos de auditoría DeFi | 0 € | 0 los primeros 6–12 meses; luego muy asimétrico | Los protocolos pagan por información | ✅ (autónomo) | **7** | [05](05-vender-palas.md) |
| Futuros sistemáticos trend + carry (pysystemtrade + IBKR) | 25–100 k€ | Sharpe ~0,8 a largo plazo, **años de −16 %** | Prima de riesgo y de comportamiento | ✅ | **7** | [04](04-bolsa-sistematica.md) |
| Carry de funding spot/perp | 500 €+ | 3–8 %/año sobre el capital total | Prima de riesgo (demanda minorista de apalancamiento) | ✅ | **6** | [03](03-cripto-delta-neutral.md) |
| Value betting contra Pinnacle | 1–5 k€ | Yield del 2–4 % sobre lo apostado, hasta que te limiten | Casas blandas que ponen mal los precios | ✅ | **6,5** | [02](02-apuestas-cuantitativas.md) |
| Numerai (sin stake primero) | 0–500 € | 0 a +20 %/año en NMR; manda el riesgo del token | Un hedge fund paga por señal original | ✅ | **6** | [01](01-sin-capital-ia-y-ml.md) |
| Vault HLP de Hyperliquid | 100 €+ | ~7 % anual ahora; históricamente 15–30 % con caídas | Market making y liquidaciones | ✅ sin VPN | **6** | [03](03-cripto-delta-neutral.md) |
| Darwinex Zero + DarwinIA | 38 €/mes | Poco en absoluto; sirve para tener historial auditado | Capital de Darwinex (asignaciones) | ✅ | **6** | [05](05-vender-palas.md) |
| Freelance de bots y SaaS de trading | 0 € | 200–1.500 $ por encargo | Vender palas | ✅ (autónomo) | **6** | [05](05-vender-palas.md) |
| Cartera multifactor con datos académicos | 20 k€+ | Pocos puntos sobre el índice en el mejor caso | Primas de factores | ✅ | **6** | [04](04-bolsa-sistematica.md) |
| Venta de puts sobre índices (sin apalancar) | 5–60 k€ | Rinde como el índice con menos volatilidad (Sharpe 0,65 frente a 0,49) | Prima de seguro | ✅ | **5** | [04](04-bolsa-sistematica.md) |
| Merger arbitrage | 10–20 k€ | Efectivo + unos pocos puntos | Límites al arbitraje | ✅ | **5** | [04](04-bolsa-sistematica.md) |
| CrunchDAO / Kaggle finance | 0 € | Valor esperado ≈ 0; sirve para el CV | Premios | ✅ | **4,5** | [01](01-sin-capital-ia-y-ml.md) |
| Prop firms (Topstep, FTMO…) | 50–150 €/mes | **Valor esperado negativo** (el 16,8 % aprueba) | Las cuotas de los que suspenden | ⚠️ sin regulación | **4** | [05](05-vender-palas.md) |
| Surebets | 2–10 k€ | Cientos de €/mes hasta que te limiten | Precios fragmentados | ✅ | **4** | [02](02-apuestas-cuantitativas.md) |
| Bittensor (subnets de trading) | decenas–cientos € | Sin datos fiables; la mayoría no recupera el registro | Emisiones del token | ⚠️ | **3,5** | [01](01-sin-capital-ia-y-ml.md) |
| WorldQuant BRAIN (consultor pagado) | 0 € | **No disponible para residentes en España** | — | ❌ | **3,5** | [01](01-sin-capital-ia-y-ml.md) |
| Polymarket / Kalshi | — | La ganancia se la llevan <1 % de wallets | — | ❌ bloqueado | **3** | [06](06-mercados-prediccion-y-vpn.md) |

---

## Qué hacer según tu capital

### Poco dinero (0–1.000 €): el capital lo pone tu cabeza

1. **Matched betting** para los primeros 1.600–2.400 €. Monta tu propio registro en Python y usa [`herramientas/cuotas.py matched`](herramientas/cuotas.py) para calcular las coberturas. Hazlo **antes del 25-mar-2027**: ese día entran los límites conjuntos de depósito del [RD 520/2026](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-13762) (700 €/día, 1.750 €/semana y 3.300 € cada 4 semanas, sumando todas las casas).
2. **Bot de Metaculus.** Haz un fork de [metac-bot-template](https://github.com/Metaculus/metac-bot-template), pide los créditos gratis de LLM y compite en [MiniBench](https://www.metaculus.com/aib/minibench/) cada dos semanas.
3. **Numerai sin stake**: 3–6 meses mirando si tu modelo aporta algo (MMC). No pongas dinero hasta tenerlo claro.
4. En paralelo, si te tira la seguridad: [Ethernaut](https://ethernaut.openzeppelin.com/) → Damn Vulnerable DeFi → tu primer concurso en Code4rena o Sherlock.

### Dinero medio (1.000–25.000 €): primas de riesgo automatizadas

1. **Carry de funding** en BTC/ETH con un exchange con licencia MiCA (Kraken u OKX EU) o con Hyperliquid, que no bloquea España. Antes de entrar mira la media real: `python3 herramientas/funding.py --historico ETH --dias 30`. La media de los últimos 30 días (a 25-sep-2026) fue un 10 % anual en Hyperliquid y un 5,4 % en OKX. Eso es lo que cobra la pata corta: sobre el capital total (spot + margen) sale más o menos la mitad.
2. **Value betting** con un escáner propio frente a Pinnacle (usado como referencia de precio, no para apostar). Mide el CLV (valor frente a la cuota de cierre), no el beneficio. Cuenta con que te limitarán las cuentas en semanas o meses.
3. **Fondos indexados con traspasos** para el núcleo de tu patrimonio. Cualquier regla de rotación que programes la ejecutas con traspasos, sin pagar impuestos en cada cambio.
4. El capital que no uses, en Letras del Tesoro (2,85 %) o en Aave (3,5–6 % en USDC, con riesgo de smart contract y de cambio euro/dólar).

### Mucho dinero (>25.000 €): lo que hacen los profesionales, sin sus comisiones

1. **Futuros sistemáticos diversificados** (tendencia lenta + carry) con [pysystemtrade](https://github.com/robcarver17/pysystemtrade) de Rob Carver e IBKR. Su historial público: Sharpe de 0,80 en 12 años, +23,7 % el último año y −16,3 % el anterior ([fuente](https://qoppac.blogspot.com/2026/04/annual-performance-update-year-12.html)). Te ahorras el 2/20 de un fondo profesional. A cambio tienes que aguantar años malos.
2. **Venta sistemática de puts o put spreads** sobre índices (SPX, XSP o ESTX50), **siempre sin apalancar**. El índice PUT tuvo un drawdown del −32,7 % incluso sin apalancamiento.
3. **Merger arbitrage** solo con OPAs en efectivo. Un LLM puede leer los documentos, pero la decisión la verificas tú.
4. **Motor fiscal propio**: con este capital, compensar pérdidas y ganancias en la base del ahorro vale miles de euros al año.

---

## Sobre usar VPN u "otro país"

Me dijiste que puede ser otro país y que puedes usar una VPN. Esta es la respuesta honesta, plataforma por plataforma (detalle en el [doc 06](06-mercados-prediccion-y-vpn.md)):

| Plataforma | Cómo se entra | ¿Sirve una VPN? | Riesgo real |
|---|---|---|---|
| **Polymarket** | Wallet, sin KYC en la versión internacional (se lo piden a quien opera mucho, según fuentes secundarias) | Técnicamente sí | La DGOJ la [bloqueó el 26-may-2026](https://www.dsca.gob.es/en/comunicacion/notas-prensa/consumo-abre-expediente-sancionador-plataformas-polymarket-kalshi-ordena). **Jugar desde España con VPN en una web sin licencia es infracción leve de la Ley 13/2011 desde 2021: apercibimiento o [multa de hasta 100.000 €](https://www.loyra.com/la-ley-del-juego-en-el-proyecto-de-ley-contra-el-fraude-fiscal/).** Además sus términos prohíben la VPN y pueden congelar la cuenta |
| **Kalshi** | KYC con documento, cara y país de residencia | **No**, salvo mintiendo sobre tu residencia (fraude documental) | No lo hagas |
| **Binance / Bybit global** | KYC con residencia | **No** | Desde el 1-jul-2026 solo pueden atender a residentes de la UE los exchanges autorizados bajo MiCA |
| **WorldQuant BRAIN (consultor)** | Alta fiscal y de pagos | **No** | [España no está en la lista](https://worldquantbrain.com/consultant) de países donde se paga |
| **Hyperliquid, Aave, Pendle** | Wallet | **No hace falta**: no bloquean España | Riesgo de smart contract y ninguna protección al inversor, pero es legal |

**Tres cosas que no cambian con ninguna VPN:**

1. **Sigues tributando en España por todo lo que ganes, en cualquier sitio.** Con DAC8 (desde 2026) y CRS, Hacienda recibe los datos de exchanges y brokers.
2. **Tu banco te preguntará de dónde viene el dinero** cuando pases USDC a euros (normativa contra el blanqueo). Si no puedes justificarlo, te lo bloquean.
3. **El premio no compensa.** En Polymarket, la ventaja la capturan bots industriales (menos del 1 % de las wallets se lleva la mitad del beneficio). Te arriesgarías a una sanción y a perder los fondos para competir contra ellos. Si te gustan los mercados de predicción, la vía legal y rentable es **el torneo de bots de Metaculus** o **Betfair Exchange .es**.

**Irte a vivir a otro país** de verdad es la única forma legal de cambiar las reglas. Pero la residencia fiscal depende de dónde pasas más de 183 días al año, y a estos importes no compensa el cambio de vida.

---

## Lo que no haría (con datos)

- **Dejar a un agente LLM operando solo** (TradingAgents, ai-hedge-fund). Los propios repositorios dicen que son "solo educativos" y los benchmarks lo confirman. Úsalos para investigar, no para ejecutar.
- **Hacer backtests con LLMs sobre fechas anteriores a su corte de entrenamiento.** El modelo ya "vio" el futuro ([Gao, Jiang y Yan](https://arxiv.org/abs/2512.23847)). Todo backtest así está contaminado.
- **Usar prop firms como fuente de ingresos.** Topstep publica que el [16,8 % aprueba y el 0,71 % llega a Live](https://www.topstep.com/blog/truth-about-prop-firm-payouts). FTMO ha pagado unos 144 $ por cliente, menos que su cuota. Encima, lo que cobras tributa como actividad económica (hasta el ~47 % más la cuota de autónomo).
- **Opciones 0DTE y CFDs.** Los minoristas pierden en masa, unos [350.000 $ al día](https://papers.ssrn.com/sol3/Delivery.cfm/4404704.pdf?abstractid=4404704&mirid=1) en 0DTE. En CFDs pierde [entre el 74 y el 89 % de las cuentas](https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors).
- **Estrategias ya muertas**: PEAD en acciones líquidas, arbitraje de inclusión en el S&P 500 (del 7,4 % en los 90 al 0,3 %), tendencia de corto plazo o intradía desde 2009.
- **"Near-resolution" en Polymarket** (comprar al 97–99 %). Una disputa del oráculo te borra meses de céntimos: la del alto el fuego de Irán movió más de 280 M$.
- **Vender señales o gestionar dinero de otros sin licencia de la CNMV.** Vender software, sí. Recomendaciones personalizadas, no.
- **Guías de "ingresos pasivos" con Bittensor, airdrops multicuenta o bots de Telegram.** Sesgo de supervivencia en estado puro.
- **Optimizar parámetros sin contar cuántas pruebas haces.** Usa [`herramientas/robustez.py`](herramientas/robustez.py): con 200 pruebas, un Sharpe de 1,6 sale por pura suerte.

---

## Plan de 90 días

| Semanas | Dinero ya | Construir ventaja | Aprender |
|---|---|---|---|
| 1–2 | Cuenta en Betfair.es + primeros bonos grandes; registro en SQLite | Fork del bot de Metaculus + créditos + primer MiniBench | Leer [Kaunitz et al.](https://arxiv.org/abs/1710.02824) y el artículo del DSR |
| 3–6 | Recorrer los bonos de bienvenida (30–40 casas) | Numerai sin stake; escáner de funding registrando cada hora | Ethernaut / Damn Vulnerable DeFi |
| 7–10 | Bonos recurrentes; empezar value betting con CLV | Bot de carry en papel con los datos de 2026 (incluidos los 67 días negativos) | Primer concurso de auditoría pequeño |
| 11–13 | Balance: ¿qué da más € por hora? | Carry real con poco dinero, a 1x y con salidas automáticas | Decidir: ¿seguridad DeFi en serio o futuros sistemáticos? |

**Una regla para todo:** mide cada vía en **euros netos por hora** y compárala con las Letras del Tesoro (2,85 % sin riesgo). Lo que no gane a eso con margen, se abandona.

---

## Impuestos en cinco líneas

Detalle en el [doc 07](07-fiscalidad-y-legal.md).

- **Trading con tu capital (también con bots)**: base del ahorro, 19–30 %. No hace falta ser autónomo ([DGT V2232-25](https://www.cuatrecasas.com/es/spain/fiscalidad/art/criptomonedas-trading-automatico-actividad-economica)).
- **Apuestas y matched betting**: base general (hasta el ~47 %). Las pérdidas solo compensan ganancias de juego **del mismo año**.
- **Premios** (Metaculus, Kaggle): ganancia patrimonial en la base general.
- **Bug bounties, freelance, SaaS, payouts de prop firms**: actividad económica (autónomo si es habitual).
- **Cripto**: cada permuta tributa (incluso cripto a stablecoin). Método FIFO. Modelo 721 si tienes más de 50 k€ fuera de España. Con DAC8, Hacienda lo ve todo desde 2026.

---

## Documentos

| Doc | Contenido |
|---|---|
| [01 · Sin capital: IA y ML que pagan](01-sin-capital-ia-y-ml.md) | Metaculus, Numerai, CrunchDAO, Kaggle, CrowdCent, WorldQuant, Bittensor |
| [02 · Apuestas cuantitativas](02-apuestas-cuantitativas.md) | Matched betting, value betting, Betfair API, modelos propios, surebets |
| [03 · Cripto delta-neutral](03-cripto-delta-neutral.md) | Funding carry, spreads entre exchanges, HLP, lending, Ethena, vaults |
| [04 · Bolsa sistemática](04-bolsa-sistematica.md) | Traspasos, trend following, factores, venta de puts, merger arb, LLMs |
| [05 · Vender palas](05-vender-palas.md) | Seguridad DeFi, Darwinex, freelance, SaaS, prop firms, eToro |
| [06 · Mercados de predicción y VPN](06-mercados-prediccion-y-vpn.md) | Polymarket, Kalshi, la ley española, alternativas legales |
| [07 · Fiscalidad y legal](07-fiscalidad-y-legal.md) | IRPF, MiCA, DAC8, 720/721, CNMV, prop firms |
| [08 · Repos, herramientas y comunidades](08-repos-y-comunidades.md) | Qué stack usar, qué repos son humo, foros y libros |
| [Herramientas](herramientas/README.md) | `cuotas.py`, `funding.py`, `robustez.py`: código probado y sin dependencias |

---

## Metodología y límites

- **Investigación:** 8 agentes en paralelo, uno por área, con búsqueda web y lectura de fuentes primarias (papers de SSRN y arXiv, BOE, DGOJ, CNMV, documentación oficial, blogs con historial auditable). A cada uno le pedí buscar **contraevidencia** de cada oportunidad antes de darla por buena.
- **Verificación manual:** he comprobado yo mismo las afirmaciones que sostienen las recomendaciones:
  - el RD 520/2026 y sus límites;
  - la sentencia del Supremo de 2024 sobre los bonos;
  - la sanción por usar VPN en juego sin licencia;
  - que España no está en el programa de consultores de WorldQuant;
  - el tipo de las Letras de septiembre de 2026;
  - las medias reales de funding, con `funding.py` y datos en vivo.
- **Límites que debes conocer:**
  - Muchas cifras de rentabilidad vienen de las propias plataformas (Immunefi, Pendle, RebelBetting) o de casos individuales. Lo indico cada vez.
  - Nadie publica la distribución de ingresos del participante medio en casi ninguna de estas vías. Por eso doy rangos y no promesas.
  - Las reglas cambian rápido: los límites de depósito, MiCA o los pagos de Numerai cambiaron en 2025–26. Revisa las fechas de cada dato.
- **Qué quedó fuera por el límite de uso de la sesión:** una ronda de un crítico de completitud que buscara nichos adicionales (descuentos de fondos cerrados, SPACs, liquidez concentrada en DEX, crowdlending). Si te interesa alguno, lo investigo aparte.

# 08 · Repositorios, herramientas de IA y comunidades

[← Volver al informe](README.md)

Actividad de los repositorios comprobada en septiembre de 2026.

**Resumen honesto.** **Las herramientas no crean ventaja.** Lo que hacen es evitar que pierdas dinero por sobreajuste, costes mal modelados o look-ahead. Una revisión de [septiembre de 2026 (arXiv 2609.04917)](https://arxiv.org/abs/2609.04917) concluye que **ninguna arquitectura de IA ha demostrado alfa neto persistente** en distintos regímenes de mercado y con capacidad para escalar, y que hay muy pocos historiales reales auditados.

---

## El stack que te recomiendo

| Para qué | Herramienta | Por qué |
|---|---|---|
| Prototipo rápido | [vectorbt](https://github.com/polakowo/vectorbt) (último commit 17-09-2026) o [Backtesting.py](https://github.com/kernc/backtesting.py) (05-08-2026) | vectorbt es rápido y vectorizado (licencia Fair Code; la versión PRO es de pago). Backtesting.py es ideal para aprender, pero solo trabaja con un activo |
| Validación contra el sobreajuste | **Deflated Sharpe Ratio** ([SSRN 2460551](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)) + **PBO** ([SSRN 2326253](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)) + walk-forward | Ya lo tienes en [`herramientas/robustez.py`](herramientas/robustez.py) |
| Backtest serio y ejecución real | [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) (25-09-2026) o [QuantConnect LEAN](https://github.com/QuantConnect/Lean) (24-09-2026) | Nautilus: núcleo en Rust y el mismo código para backtest y real. LEAN: multiactivo, con datos y conectores de bróker |
| Futuros sistemáticos | [pysystemtrade](https://github.com/robcarver17/pysystemtrade) (21-09-2026) | Sistema de producción de Rob Carver con IBKR, con su historial real publicado |
| Cripto | [ccxt](https://github.com/ccxt/ccxt), [hyperliquid-python-sdk](https://github.com/hyperliquid-dex/hyperliquid-python-sdk), [freqtrade](https://github.com/freqtrade/freqtrade) (24-09-2026), [hummingbot](https://github.com/hummingbot/hummingbot) | freqtrade como laboratorio de estrategias direccionales; hummingbot para market making y funding arb |
| Apuestas | [betfairlightweight](https://github.com/betcode-org/betfair), [flumine](https://github.com/betcode-org/flumine), [penaltyblog](https://github.com/martineastwood/penaltyblog) | API de Betfair, framework de trading y modelos de goles |
| Datos académicos | [openassetpricing](https://pypi.org/project/openassetpricing/), [JKP factors](https://github.com/bkelly-lab/ReplicationCrisis) | Factores replicados, gratis |
| Aprender ML aplicado | [machine-learning-for-trading](https://github.com/stefan-jansen/machine-learning-for-trading) de Stefan Jansen (24-09-2026) | El mejor material didáctico |
| Índices de todo lo demás | [awesome-quant](https://github.com/wilsonfreitas/awesome-quant) | Lista curada |

**Flujo de trabajo:**

1. Prototipa en vectorbt.
2. **Apunta TODAS las pruebas que haces.**
3. Calcula el DSR y el PBO.
4. Walk-forward con un tramo fuera de muestra reservado.
5. Pasa la estrategia a Nautilus o LEAN.
6. 3 meses de paper trading.
7. Capital pequeño.

## Herramientas de IA: para qué sirven de verdad

| Repo | Veredicto |
|---|---|
| [Microsoft Qlib](https://github.com/microsoft/qlib) + [RD-Agent(Q)](https://github.com/microsoft/RD-Agent) | **Útil como fábrica de hipótesis.** RD-Agent(Q) (NeurIPS 2025) [dice doblar el rendimiento anual](https://arxiv.org/abs/2505.15155) frente a las librerías de factores, pero es un backtest de los autores sobre acciones chinas. Trátalo como fuente de ideas para Numerai Signals y valida tú fuera de muestra |
| [Kronos](https://github.com/shiyu-coder/Kronos) (modelo fundacional de velas, AAAI 2026) | Interesante como generador de variables, pero solo tiene backtests de sus autores y menos actividad (último commit 13-04-2026) |
| TimesFM y Chronos en cero-shot | **No sirven para predecir retornos**: R² negativo (TimesFM −2,80 %, Chronos −1,37 %) y peores que LightGBM o CatBoost ([arXiv 2511.18578](https://arxiv.org/html/2511.18578v1)) |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) y [ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) | **Educativos**, según sus propios README. En [StockBench](https://arxiv.org/abs/2510.02209), la mayoría de agentes LLM no superan comprar y mantener. Úsalos para resumir información, nunca para ejecutar |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) y FinGPT | Proyectos académicos activos, con resultados de backtest y demos. No están listos para ganar dinero |
| LLMs para bots de pronóstico | **Aquí sí hay dinero**: el torneo de Metaculus ([doc 01](01-sin-capital-ia-y-ml.md)) |
| LLMs para auditar código | **Aquí también**: priorizar qué revisar en bug bounties ([doc 05](05-vender-palas.md)) |

## Humo y trampas con repos

- **Alpha Arena (Nof1).** Qwen3 ganó un +22 % en dos semanas, que es ruido de una muestra muy corta. En la edición con acciones de EE. UU., [solo 6 de 32 resultados fueron positivos](https://www.business-standard.com/markets/news/ai-bots-auditioning-for-wall-street-trading-are-mostly-losing-money-126050701793_1.html).
- **Backtests con LLMs anteriores a su fecha de corte.** Están contaminados por look-ahead ([arXiv 2512.23847](https://arxiv.org/abs/2512.23847)).
- **El hyperopt de freqtrade sin contar pruebas.** Su propia [documentación](https://www.freqtrade.io/en/stable/hyperopt/) avisa de que genera picos que no sobreviven fuera de muestra.
- **El liquidity mining de Hummingbot Miner.** [Cerró el 16-03-2026](https://miner.hummingbot.io/).
- **Bots y señales de pago en Telegram o Discord.** Quien tiene una ventaja que escala no la vende a 50 € al mes.
- **EAs del MQL5 Market con curvas perfectas.** Suelen ser martingala o grid con backtest sobreajustado.

---

## Comunidades que valen la pena

**Cuantitativo general:**

- [Quantocracy](https://quantocracy.com): agregador diario de blogs cuantitativos. **Empieza por aquí.**
- [Blog de Rob Carver (qoppac)](https://qoppac.blogspot.com): sistemas de futuros para particulares, con honestidad brutal.
- [Alpha Architect](https://alphaarchitect.com): resúmenes críticos de papers sobre factores.
- [r/algotrading](https://www.reddit.com/r/algotrading/): útil para ver errores comunes. r/quant está más orientado a la carrera profesional.
- [QuantConnect Forum](https://www.quantconnect.com/forum/): soporte de LEAN.
- [Elite Trader](https://www.elitetrader.com): foro veterano con mucho ruido, pero con hilos útiles de sistemáticos.
- [Top Traders Unplugged](https://www.toptradersunplugged.com): rendimientos mensuales de fondos de tendencia (CTA).

**Plataformas y torneos:**

- [Numerai Forum](https://forum.numer.ai): muy técnico. Los análisis de por qué fallaron modelos concretos valen oro.
- [Metaculus AIB](https://www.metaculus.com/aib/): resultados y encuestas de qué funcionó en cada temporada.
- Discord de [freqtrade](https://www.freqtrade.io/en/stable/) y de [Hummingbot](https://hummingbot.org).

**Apuestas:**

- [Arbusers](https://arbusers.com) (en inglés, value y arbitraje).
- [Betfair Automation Hub](https://betfair-datascientists.github.io/).
- [Blog de football-data.co.uk](https://www.football-data.co.uk/blog/pinnacle_efficiency.php).
- En español: [Forobet](https://foroapuestas.forobet.com/), [ZeroAzar](https://zeroazar.com/es-es).

**Seguridad DeFi:**

- [Solodit](https://solodit.cyfrin.io), [Cyfrin Updraft](https://updraft.cyfrin.io), Discord de [Code4rena](https://code4rena.com), [blog de MiloTruck](https://milotruck.github.io).

**Fondos y fiscalidad en España:**

- [Foro de fondos de Rankia](https://www.rankia.com/foros/fondos-inversion): qué fondos son traspasables y en qué comercializadora.

## Libros, en orden

1. *Systematic Trading* y *Advanced Futures Trading Strategies*, de Robert Carver.
2. *Advances in Financial Machine Learning*, de Marcos López de Prado: validación cruzada purgada, meta-etiquetado y el DSR.
3. *Machine Learning for Algorithmic Trading*, de Stefan Jansen (con el [repo](https://github.com/stefan-jansen/machine-learning-for-trading)).
4. *Algorithmic Trading*, de Ernest Chan: práctico y corto.

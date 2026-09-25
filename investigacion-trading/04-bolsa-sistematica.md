# 04 · Bolsa, futuros y opciones sistemáticos con evidencia académica

[← Volver al informe](README.md) · Herramienta: [`herramientas/robustez.py`](herramientas/robustez.py)

**La regla de oro.** Casi todas las "anomalías" publicadas se debilitan después de publicarse, y muchas solo existen en microcaps que no puedes negociar. Lo que sobrevive son **primas de riesgo** (tendencia, carry, volatilidad, factores) que se cobran con disciplina, costes bajos y años malos incluidos.

**Tu ventaja como programador:** ejecutarlas sin pagar el 2/20 de un fondo profesional y **sin sobreajustar**.

**Tu ventaja como residente en España:** los **traspasos entre fondos no tributan**.

**Resumen:**

| Estrategia | Capital | Realista | Peor momento conocido | Nota |
|---|---|---|---|---|
| Rotación de fondos indexados con traspasos | desde 10 € | Mercado + 0,5–1,5 pp/año de diferimiento (estimación) | Caídas del mercado de hasta el −50 % | **8** |
| Trend following diversificado (futuros o fondo UCITS) | 25–50 k€ (o menos con un fondo) | SG Trend: 5,3 %/año desde 2000 | −18,6 % en 12 meses (hasta mayo de 2025) | **7** |
| Trend + carry con pysystemtrade (Carver) | 50–100 k€ | Sharpe 0,80 | −16,3 % en un año | **7** |
| Multifactor long-only | 20 k€+ | Pocos puntos sobre el índice | Value: 2007–2020 | **6** |
| Venta de puts sobre índices, sin apalancar | 5–60 k€ | Como el índice con −36 % de volatilidad | −32,7 % | **5** |
| Merger arbitrage | 10–20 k€ | Efectivo + unos pocos puntos | Rupturas en crisis | **5** |
| Señales de noticias con LLM | <1 k€ | Sin evidencia operable | — | **3** |

---

## 1. Rotación sistemática con fondos indexados y traspasos · 8/10

**La idea.** Cualquier regla que programes (rebalanceo por bandas, tendencia a 10 meses, dual momentum) la ejecutas **moviendo dinero entre fondos indexados UCITS mediante traspasos**. No pagas IRPF en cada cambio. Con ETFs, cada venta tributa entre el 19 y el 30 %.

- **Base legal:** [art. 94 LIRPF](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764), vigente en 2026.
- **Qué fondos sirven:** fondos españoles y UCITS extranjeros comercializados en España con más de 500 partícipes ([Rankia](https://www.rankia.com/blog/fondos-inversion/2059196-como-traspasar-fondo-inversion)).

**No es alfa.** Es **diferimiento fiscal**: el impuesto que no pagas sigue invirtiéndose. En estrategias con rotación frecuente puede sumar del orden de 0,5–1,5 puntos al año frente a hacer lo mismo con ETFs. Es una estimación: no hay ningún estudio publicado.

**Limitaciones.**

- Un traspaso tarda 2–5 días hábiles y se ejecuta a valor liquidativo, así que no sirve para señales rápidas.
- Los filtros de tendencia sobre índices han dado muchas señales falsas desde 2010. Reducen el drawdown, pero no garantizan más rentabilidad.

**Pasos.**

1. Elige 3–5 fondos indexados traspasables de bajo coste: renta variable global, bonos y monetario (MyInvestor, Renta 4…).
2. Calcula la señal mensual en Python y haz el backtest con valores liquidativos y retraso T+2.
3. Compara el resultado **después de impuestos** con la misma estrategia en ETFs.

## 2. Trend following diversificado · 7/10 · confianza alta

**Qué es.** Posiciones largas o cortas en 15–40 futuros (índices, bonos, divisas y materias primas) según la tendencia a 3–12 meses, con el tamaño ajustado por volatilidad.

**Evidencia:**

- Es la anomalía con más historia: [positiva en todas las décadas desde 1880](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing) (AQR).
- Gana en crisis largas, como 2008 o 2022.

**Realista (sin adornos):**

- **Índice SG Trend:** 5,33 % anual desde 2000, con un drawdown máximo del 20,6 % ([TTU](https://www.toptradersunplugged.com/trend-following-performance-report-december-2025/)).
- **Peor año:** **−18,6 % en los 12 meses hasta mayo de 2025**, el peor de su historia ([Virtus](https://www.virtus.com/assets/files/95f/the_patience_premium_5028.pdf)).
- Su valor principal es **diversificar**, no rentar mucho.

**Contraevidencia importante.** Un [paper de julio de 2026](https://arxiv.org/abs/2607.01550) encuentra que **el trend following de corto plazo dejó de funcionar hacia 2009** en contratos con tick pequeño, por la microestructura de los market makers de alta frecuencia. **Usa solo tendencias lentas.**

**Cómo, según tu capital:**

- **Menos de 25 k€:** compra un fondo UCITS de managed futures (traspasable).
- **Más de 25 k€:** micro futuros en IBKR con pysystemtrade (ver 3).

## 3. Trend + carry con pysystemtrade (al estilo de Rob Carver) · 7/10

**Qué es.** [pysystemtrade](https://github.com/robcarver17/pysystemtrade) es el sistema de producción open source de Rob Carver para futuros con IBKR. Sigue activo (último commit el 21-09-2026). Carver publica su historial real cada año:

- **Año 12:** +23,7 % neto, CAGR ajustado por volatilidad del 13 %, Sharpe 0,80 frente a 0,54 del índice SG CTA, y **costes del 0,88 %** ([blog](https://qoppac.blogspot.com/2026/04/annual-performance-update-year-12.html)).
- **Año 11:** −16,3 %, su peor año ([blog](https://qoppac.blogspot.com/2025/04/annual-performance-update-returneth.html)).
- **Degradación:** él mismo analiza si el trend following se está degradando ([octubre de 2025](https://qoppac.blogspot.com/2025/10/is-degradation-of-trend-following.html)).

**Desde España.** IBKR Ireland opera con pasaporte UE. **Los futuros no necesitan KID de PRIIPs.** Las ganancias tributan en la base del ahorro. Si tienes más de 50 k€ en el bróker extranjero, presenta el Modelo 720.

**Pasos.**

1. Lee *Systematic Trading* o *Advanced Futures Trading Strategies*.
2. Haz el backtest con los CSV que trae el repositorio.
3. Paper trading en IBKR durante 3–6 meses.
4. Arranca con micros y una volatilidad objetivo del 10–15 %.

## 4. Cartera multifactor con datos académicos abiertos · 6/10

**Datos disponibles:**

- [Open Source Asset Pricing](https://www.openassetpricing.com/data/): 212 predictores, paquete `openassetpricing`.
- [JKP](https://github.com/bkelly-lab/ReplicationCrisis): 153 factores en 93 países.

[Jensen, Kelly y Pedersen](https://onlinelibrary.wiley.com/doi/full/10.1111/jofi.13249) muestran que la mayoría de factores se replica, pero los más fuertes decaen después de publicarse.

**Realista.** Pocos puntos sobre el índice en el mejor caso, con **décadas enteras por debajo** (el value entre 2007 y 2020). En versión long-only y neta de costes capturas solo una parte.

**Ojo con PRIIPs.** No puedes comprar ETFs domiciliados en EE. UU. Usa acciones individuales o ETFs UCITS.

## 5. Venta sistemática de puts sobre índices, sin apalancar · 5/10

**Por qué funciona.** Es una prima de seguro: la volatilidad implícita supera a la realizada en la mayoría de meses. El índice PUT de Cboe, en más de 32 años, tiene [un Sharpe de 0,65 frente a 0,49 del S&P 500 y un drawdown de −32,7 % frente a −51 %](https://www.cboe.com/insights/posts/white-paper-shows-volatility-risk-premium-facilitated-higher-risk-adjusted-returns-for-put-index/).

**No gana más que el índice en rentabilidad absoluta.** La ventaja está en el riesgo, no en el dinero ganado.

**Cómo hacerlo:**

- Puts cubiertos con efectivo en XSP (unos 55–65 k€ de nocional por contrato) o put spreads de riesgo limitado en XSP o ESTX50 vía IBKR.
- Plazo de 30–45 días y delta de 15–30.
- **Nada de 0DTE ni de apalancamiento**: febrero de 2018 (XIV) y marzo de 2020 hundieron a los apalancados.

## 6. Merger arbitrage · 5/10

**Qué es.** Comprar la empresa objetivo de una OPA en efectivo y cobrar el diferencial hasta que se cierre la operación. Diversifica en 10–20 operaciones.

- **Realista:** efectivo + unos pocos puntos. El índice HFRI Merger Arbitrage [ganó un 8,2 % hasta septiembre de 2025](https://www.lpl.com/research/blog/merger-arbitrage-rebound.html).
- **Riesgo:** cuando una operación se rompe pierdes entre un 20 y un 40 %, y en las crisis se rompen muchas a la vez.
- **Dónde entra un LLM:** puede resumir los documentos de la operación y los riesgos de competencia. No hay evidencia de que mejore la selección, así que verifica siempre a mano.

## 7. Señales de noticias con LLM · 3/10

**Qué dice la evidencia:**

- [Lopez-Lira y Tang](https://arxiv.org/abs/2304.07619): GPT predice la **reacción inicial**, que no se puede operar, y **los retornos caen a medida que se adopta la técnica**.
- [Gao, Jiang y Yan](https://arxiv.org/abs/2512.23847): el sesgo de look-ahead infla cualquier backtest anterior a la fecha de corte del modelo.

**Úsalo solo como un factor más**, validado con datos posteriores a la fecha de corte del LLM.

---

## Trampas (todas con datos)

| Trampa | Por qué |
|---|---|
| Opciones 0DTE | Los minoristas pierden [unos 350.000 $ al día en agregado](https://papers.ssrn.com/sol3/Delivery.cfm/4404704.pdf?abstractid=4404704&mirid=1) |
| CFDs | [Pierde entre el 74 y el 89 %](https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors) de las cuentas minoristas |
| PEAD en acciones líquidas | [Deja de ser significativo fuera de microcaps](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again/) (t = 1,43) |
| Arbitraje de inclusión en el S&P 500 | Retorno anormal del [7,4 % en los 90 al 0,3 % en 2010–2020](https://www.nber.org/system/files/working_papers/w30748/w30748.pdf) |
| Tendencia intradía o de corto plazo | [No funciona desde 2009](https://arxiv.org/abs/2607.01550) |
| Vender volatilidad con apalancamiento | Una sola cola se lleva la cuenta |
| Saltarse PRIIPs con VPN, falseando el KYC o el estatus de cliente profesional | Congelación de la cuenta y pérdida de protección. Hay equivalentes UCITS, y las opciones y futuros no están afectados |
| Rotar con ETFs en lugar de fondos | Cada venta tributa, y la regla de los 2 meses bloquea las pérdidas si recompras |
| Probar 500 parámetros y quedarte con el mejor | `python3 herramientas/robustez.py retornos.csv --ensayos 500`: el Deflated Sharpe te dirá que es suerte |

# 05 · Monetizar lo que sabes sin (o con poco) capital propio

[← Volver al informe](README.md)

En la fiebre del oro, los que se hicieron ricos de forma fiable vendían palas. Aquí la pala es **tu código**: seguridad para protocolos, herramientas para traders, o capital de otros que se asigna a tu estrategia.

**Resumen:**

| Vía | Capital | Realista | Curva | España | Nota |
|---|---|---|---|---|---|
| Bug bounties Web3 (Immunefi, Cantina, HackenProof) | 0 € | 0 los primeros 6–12 meses; crítico con mediana de 20 k$ | Alta | ✅ (actividad económica) | **7** |
| Concursos de auditoría (Code4rena, Sherlock, Cantina) | 0 € | Top 10: 200–500 k$/año; el participante mediano gana poco | Alta | ✅ | **7** |
| Darwinex Zero + DarwinIA | 38 €/mes | Bajo en absoluto; historial auditado | Media | ✅ (CNMV/FCA) | **6** |
| Freelance de bots, EAs e indicadores | 0 € | 200–1.500 $ por encargo | Baja | ✅ | **6** |
| Software, SaaS o datos (no señales) | 0–500 € | Muy variable | Media | ✅ | **7** |
| Prop firms de futuros con API | 50–150 €/mes | **Valor esperado negativo** de media | — | ⚠️ sin regulación | **4** |
| eToro Popular Investor | 25 k$ para Elite | ~7.500 $/año con 500 k$ copiados | Audiencia | ✅ | **3** |

---

## 1. Seguridad DeFi: bug bounties y concursos de auditoría · 7/10

Es **lo que mejor paga a un programador sin capital**, pero con una cola larga brutal: pocos cobran mucho y la mayoría no cobra nada al principio.

**Por qué existe.** A un protocolo le sale más barato pagar una recompensa (normalmente como mucho el ~10 % de los fondos en riesgo) que sufrir un hackeo. Según Immunefi, el [94 % de sus programas de larga duración ha recibido algún fallo crítico](https://immunefi.com/blog/research/nearly-every-long-running-bug-bounty-program-on-immunefi-has-found-a-critical-bug/).

**Números:**

- **Immunefi:** en fallos críticos, **mediana de 20.000 $ y media de 114.355 $** (593 programas, 2021 a febrero de 2026). En el primer trimestre de 2026 pagó 7,87 M$ por 1.104 informes ([fuente](https://sqmagazine.co.uk/smart-contract-bug-bounties-statistics/)).
- **Concursos:** caso real de [MiloTruck](https://milotruck.github.io/blog/A-year-of-Competitive-Audits/). Su primer pago fue de unos 397 $ tras ~5 meses estudiando, ganó ~7 k$ el primer año y **172 k$ el segundo** en 17 concursos. Él mismo avisa de que los incentivos van a la baja.
- **Top 10 de las plataformas:** 200–500 k$ al año, según un [agregador sin auditar](https://smartcontractshacking.com/tools/auditor-salary-calculator).

**Contraevidencia.**

- Las estadísticas vienen de Immunefi, que tiene interés comercial.
- Nadie publica cuánto gana el cazador mediano.
- Los programas pueden rebajar la gravedad del fallo que reportas o no pagar ([crítica del propio CEO de Immunefi](https://x.com/MitchellAmador/article/2102437556159758670)).
- Los fallos fáciles se acaban antes porque los equipos también usan herramientas de IA.

**Ruta de aprendizaje:**

1. Solidity: [Ethernaut](https://ethernaut.openzeppelin.com/) y luego Damn Vulnerable DeFi.
2. [Cyfrin Updraft](https://updraft.cyfrin.io) (gratis).
3. Leer cientos de hallazgos reales en [Solodit](https://solodit.cyfrin.io).
4. Montar tu pipeline: [Foundry](https://github.com/foundry-rs/foundry), [Slither](https://github.com/crytic/slither), Echidna/Medusa, y **un LLM para decidir qué código mirar primero** (ahí entra tu ventaja en IA).
5. Especializarte en un nicho con menos competencia: lending, bridges, L2, Rust o Move.
6. Empezar con 2–3 concursos pequeños en Code4rena o Sherlock, comparar tus hallazgos con el informe final, y después ir a por bounties de programas recién lanzados o recién actualizados.

**Reglas.** Nunca explotes un fallo en mainnet: es delito. Los pagos suelen llegar en USDC. En España tributa como **actividad económica**.

---

## 2. Darwinex Zero + DarwinIA · 6/10

Darwinex es una empresa de origen español regulada por la **CNMV y la FCA**. Es la opción más limpia de esta lista desde el punto de vista regulatorio.

**Cómo funciona:**

- Pagas una suscripción (**unos 38 €/mes**, según fuentes secundarias) y operas una cuenta virtual.
- Darwinex convierte tu estrategia en un "DARWIN" con el riesgo normalizado.
- Si tu rating mensual llega a 75, [DarwinIA SILVER](https://darwinexzero.document360.io/docs/darwinia-silver) te asigna **entre 30.000 y 375.000 € durante 3 meses**, y cobras el **15 % del beneficio** con high-water mark (nivel GOLD: hasta 500 k€ durante 6 meses).
- Si en 6 meses no recibes ninguna asignación, te dan un cupón de 25 k€.

**Realista.** Poco en términos absolutos. Con 30 k€ asignados y un 5 % en el trimestre ganas unos 225 €, menos 114 € de suscripción. Donde compensa es en el **historial público auditado**, que sirve para atraer inversores o conseguir trabajo, y en acumular asignaciones.

**Contraevidencia.**

- El rating premia la rentabilidad reciente (el 67 % del peso son los últimos 6 meses), lo que favorece el ruido.
- No hay datos de cuántos DARWIN cobran.
- Darwinex [dejó de ofrecer CFD y FX a nuevos minoristas españoles](https://www.fastbull.com/brokersview/news/darwinex-to-stop-offering-cfds-to-spanish-retail-clients-to-comply-with-cnmv-regulations-237712) en 2024. Confirma qué activos puedes usar en Zero.

**Regla:** si en 6–9 meses no te acercas a un rating de 75, date de baja.

## 3. Freelance de bots, EAs e indicadores · 6/10

**Qué se vende:**

- EAs de MT4/MT5, indicadores en Pine Script, conversiones Pine → MQL5 o Python.
- Conectores para NinjaTrader o Tradovate.
- **Automatizaciones para la API de prop firms como TopstepX**, un mercado que está creciendo.

**Dónde:** [MQL5 Freelance](https://www.mql5.com/en/job/expert) (con depósito en garantía; cobra un 10 %) y [Upwork](https://www.upwork.com/freelance-jobs/mql-5/).

**Precio:** encargos de 200 a 1.500 $. El cliente paga por el trabajo, no por el resultado.

**Cuidado.**

- Hay mucha competencia a precios bajos.
- Clientes que piden martingalas o bots para saltarse las reglas de las prop firms. No los aceptes.
- Si lo haces con habitualidad, te toca darte de alta como autónomo.

## 4. Vender software, SaaS o datos, no señales · 7/10

**Legal sin licencia:** herramientas genéricas (backtesters, screeners, APIs de datos, bots descargables).

**Reservado a entidades con licencia de la CNMV (EAF o ESI):** recomendaciones personalizadas y gestionar dinero de otros ([guía CNMV para finfluencers de 2026](https://www.cnmv.es/DocPortal/Publicaciones/Guias/Guia_Del_like_a_la_inversion.pdf)).

La frontera es difusa: **un Telegram de pago con entradas y salidas concretas puede considerarse asesoramiento**. Ideas con demanda probada:

- escáner de value y surebets para casas .es;
- rastreador de promociones para matched bettors;
- motor fiscal FIFO para brokers extranjeros y DeFi (ver [doc 07](07-fiscalidad-y-legal.md)).

## 5. Prop firms · 4/10: solo como opción de pérdida limitada, nunca como sueldo

**Datos oficiales de [Topstep para 2025](https://www.topstep.com/blog/truth-about-prop-firm-payouts):**

- solo aprueba el **16,8 %** de los que hacen la prueba;
- el **33,3 % de los financiados** cobra algún pago;
- el **0,71 %** llega a Live Funded.

**FTMO:** unos 650 M$ pagados a 4,5 millones de clientes, unos **144 $ por cliente**, menos que la cuota.

Su negocio son las cuotas de los que suspenden.

**Si aun así quieres probar:**

- Topstep permite bots por API en las fases de evaluación, pero **no en Live**. Apex [prohíbe la automatización total](https://support.apextraderfunding.com/hc/en-us/articles/40463668243099-Prohibited-Activities) en las cuentas financiadas.
- La CNMV advierte de que **no están reguladas**.
- Lo que cobres tributa como **actividad económica** (base general hasta el ~47 %, autónomo, IVA). Si ganas, te sale más a cuenta hacer lo mismo con tu capital, que tributa al 19–30 % (ver [doc 07](07-fiscalidad-y-legal.md)).
- Solo tiene sentido si ya tienes una estrategia de futuros intradía validada fuera de muestra. Simula antes con Monte Carlo la probabilidad de aprobar la prueba con sus reglas exactas de drawdown.

## 6. eToro Popular Investor · 3/10

Para el nivel Elite necesitas 25.000 $ propios, 500.000 $ copiados y 4 meses en Champion. A cambio cobras el [1,5–2 % anual de lo copiado](https://help.etoro.com/Spanish/Community/1121314362/-Cu%C3%A1les-son-los-requisitos-del-programa-Popular-Investor.htm). Depende de tener audiencia, no de tu alfa, y en las caídas los que te copian se van.

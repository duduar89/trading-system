# 01 · Sin capital: plataformas que pagan por IA y ML

[← Volver al informe](README.md)

En estas plataformas no te pagan por ganarle al mercado. Te paga **un patrocinador que quiere algo tuyo**: medir la IA, señales originales para un fondo o talento que reclutar. Por eso encajan con un programador que sabe de IA y tiene poco capital.

**Resumen:**

| Plataforma | Capital | Pago real | Tu ventaja | España | Nota |
|---|---|---|---|---|---|
| Metaculus FutureEval / MiniBench | 0 € | 50 k$ por temporada ×3/año + 1 k$ cada 2 semanas | Ingeniería de LLM: búsqueda, ensembles, calibración | ✅ | **8** |
| Numerai (Classic, Signals, Crypto) | 0–500 € | Staking; el pago agregado cayó de más de 1 M$/mes a 182 k$/mes | Señal original (MMC) | ✅ | **6** |
| CrunchDAO / ADIA Lab | 0 € | Retos de 100 k$ (~1 al año) y benchmark de 6 k$/trimestre | Estadística de nicho | ✅ (KYC al cobrar) | **5** |
| Kaggle (finanzas) | 0 € | 25–120 k$, pero solo cobran 3–6 | Validación temporal sólida | ✅ | **4,5** |
| CrowdCent (ranking de Hyperliquid) | 0 € | 10 k$ por semestre, repartido | Poca competencia | ✅ | **4** |
| WorldQuant BRAIN | 0 € | Consultor: **no disponible en España**. IQC: 100 k$ | Contratación | ⚠️ solo IQC | **3,5** |
| Bittensor (SN8, SN50) | decenas–cientos € | Sin datos fiables | — | ⚠️ | **3,5** |

---

## Metaculus: torneos de bots LLM (FutureEval y MiniBench) · 8/10

**Qué es.** Programas un bot con LLM y búsqueda de información que pronostica automáticamente de 300 a 500 preguntas reales por temporada: binarias, numéricas y de opción múltiple.

- **Premios:** tres temporadas al año con [50.000 $ cada una](https://forum.effectivealtruism.org/posts/ZfLAN557rGWACKtmc/announcing-metaculus-summer-2026-futureeval-bot-tournament) (la de [primavera de 2026 tuvo 58.000 $](https://forum.effectivealtruism.org/posts/5EX9dz7nKthcxECTe/announcing-spring-2026-ai-forecasting-benchmark)). Además está [MiniBench](https://www.metaculus.com/aib/minibench/): torneos de 1.000 $ cada dos semanas.
- **Coste:** Metaculus da **créditos gratis de LLM** (donados por Anthropic, OpenAI y Google) y acceso a AskNews.
- **Torneo actual:** ya hay uno de [otoño de 2026 en marcha](https://github.com/Metaculus/metaculus/pull/5205).

**Por qué hay ventaja.**

- El premio no sale de otro participante: es un subsidio para medir la IA.
- Compiten pocos equipos serios. En el Q2 de 2025 hubo [96 bots](https://x.com/metaculus/status/1958239204325879854).
- Los bots ganadores de Q1 2025 superaron con claridad a la plantilla que usaba **el mismo modelo base**. Gana la ingeniería (búsqueda, agregación, calibración), no el modelo.

**Dinero realista.** En Q1 2025, [los tres primeros ganaron 7.685 $, 5.499 $ y 4.065 $](https://www.metaculus.com/notebooks/37692/winners-of-the-q1-2025-ai-forecasting-benchmark-tournament/), y otros 7 bots se repartieron 12.752 $. Un bot en el top 10–20 saca cientos o pocos miles por temporada. Un bot mediano, casi nada. No hay datos del reparto por percentiles.

**Contraevidencia.**

- Los pronosticadores humanos profesionales siguen ganando a los bots.
- Hay startups con equipos dedicados (Mantic) que se llevan buena parte de los premios.
- Entrar tarde en una temporada penaliza.
- Hay que rellenar una encuesta para cobrar.

**Primeros pasos.**

1. Fork de [metac-bot-template](https://github.com/Metaculus/metac-bot-template) y ver el vídeo de 30 min.
2. Pedir créditos de LLM y AskNews.
3. Iterar en MiniBench: ciclos de dos semanas y retroalimentación rápida.
4. Mejorar el bot: ensemble de varios modelos, recuperación de noticias, tasas base y calibración (extremizar con cuidado).
5. Leer las encuestas de "qué funcionó" de temporadas anteriores en [metaculus.com/aib](https://www.metaculus.com/aib/).

**Impuestos.** Ganancia patrimonial en la base general.

---

## Numerai (Classic, Signals, Crypto) · 6/10

**Qué es.** Envías predicciones sobre datos ofuscados (Classic), señales propias sobre acciones (Signals) o predicciones de cripto (Crypto). Opcionalmente haces staking de NMR, o de USDC con el nuevo sistema de [staking on-chain de julio de 2026](https://blog.numer.ai/numerai-monthly-numercon-agents-staking-risk-1m-nmr-buyback/). El pago depende sobre todo del **MMC**, es decir, de lo que tu señal aporta al metamodelo:

```
pago = 3 × CORR60 + 15 × MMC60
```

Fuente: [documentación oficial](https://docs.numer.ai/numerai-tournament/staking).

**Por qué hay ventaja.** Un hedge fund real paga por señal **no correlacionada** con la del resto. Copiar el ejemplo o el metamodelo [apenas paga](https://forum.numer.ai/t/changing-scoring-payouts-again-to-mmc-only/6794/). Tu ventaja está en aportar datos o factores originales, sobre todo en Signals.

**Dinero realista.**

- Numerai ha pagado [más de 43 M$ en total](https://www.alphanova.tech/blog/is-numerai-worth-it).
- El pago mensual agregado **cayó de más de 1 M$ (enero 2025) a 182 k$ (enero 2026)**, y Numerai tuvo que recomprar NMR por 1 M$.
- Para un modelo decente, espera de 0 a +20 % anual **en NMR**. Lo que manda es el precio del token.

**Riesgos.** Quema de stake, precio del NMR, reglas que cambian cada año, stake bloqueado 60 días o más y riesgo de smart contract.

**Primeros pasos.**

1. `pip install numerapi` y [example-scripts](https://github.com/numerai/example-scripts).
2. Enviar **sin stake durante 3–6 meses** y seguir CORR60 y MMC60.
3. Si el MMC es positivo de forma estable, stake pequeño **en USDC** (paga una décima parte, pero sin riesgo del token).
4. Signals, si tienes datos alternativos propios.

---

## CrunchDAO / ADIA Lab · 5/10

Competiciones de ML en finanzas patrocinadas por ADIA Lab, el laboratorio del fondo soberano de Abu Dabi.

- El [Structural Break Challenge 2025](https://www.adialab.ae/structural-break-challenge) repartió 100 k$: 40 k$ al primero y premios hasta el puesto 10.
- Desde 2026 hay un [Open Benchmark continuo](https://hub.crunchdao.com/competitions/structural-break-open-benchmark) con un reparto trimestral de 6 k$ entre los 3 primeros.

La competencia es menor que en Kaggle y los problemas (rupturas estructurales, descubrimiento causal) premian saber estadística. Los retos grandes son esporádicos. El KYC se hace al cobrar.

## Kaggle (competiciones financieras) · 4,5/10

Ejemplo: [Hull Tactical Market Prediction](https://www.kaggle.com/competitions/hull-tactical-market-prediction), con 100 k$ en premios (50 k$ al primero), terminada en junio de 2026.

- **Valor esperado ≈ 0.** Miles de equipos compiten por 3–6 premios, y en finanzas la reordenación final del ranking es brutal.
- **Para qué sirve:** portfolio y contratación. Estudia las soluciones ganadoras (por ejemplo [Jane Street](https://github.com/scaomath/kaggle-jane-street)).
- **Cómo competir bien:** validación temporal purgada e ignorar el leaderboard público.
- **Ahora mismo:** no encontré ninguna gran competición financiera abierta a septiembre de 2026.

## CrowdCent: ranking de Hyperliquid · 4/10

Ordenas los perpetuos de Hyperliquid según su retorno esperado a 10 y 30 días. No hay stake. Se reparten [10.000 USDC por semestre](https://crowdcentcuration.substack.com/p/crowdcent-community-update-47f) entre todos los participantes. El bote es pequeño, pero sirve de **banco de pruebas** para señales cripto que luego puedes llevar a Numerai Crypto o a tu bot de carry. Cliente: `pip install crowdcent-challenge`.

## WorldQuant BRAIN · 3,5/10: el programa pagado no está disponible en España

La plataforma para crear alphas es gratis y buena para aprender. Pero el **programa Research Consultant**, que paga "desde 2.000 $ por trimestre en nivel Master y desde 8.000 $ en Grandmaster", **solo existe en ciertos países y España no está en la lista** ([comprobado el 25-sep-2026](https://worldquantbrain.com/consultant)): China, Hong Kong, Taiwán, Kenia, Corea del Sur, Indonesia, India, Malasia, Singapur, Reino Unido, Vietnam, Tailandia, EE. UU., Armenia, Hungría, Nigeria y Georgia.

Usar una VPN no sirve, porque para cobrar hay que darse de alta con datos fiscales y de pago. Lo que sí está abierto a residentes en España es el [IQC](https://www.worldquant.com/brain/iqc/): 100 k$ en premios, pero más de 140.000 inscritos. Úsalo como vía de contratación.

## Bittensor (subnets de trading) · 3,5/10

Minas señales en subnets como SN8 (Vanta, antes Taoshi) o SN50 (Synth) y cobras en el token de la subnet. Motivos para desconfiar:

- La emisión se [redujo a la mitad en diciembre de 2025](https://www.tao.media/the-ultimate-guide-to-bittensor-2026/).
- Las cifras de rentabilidad vienen de blogs del propio ecosistema.
- Si rindes poco, pierdes tu puesto (UID).
- Cobras en dos tokens volátiles.

**No hay datos independientes de ganancias por minero.** Si te pica la curiosidad, primero testnet y [taostats](https://taostats.io/subnets).

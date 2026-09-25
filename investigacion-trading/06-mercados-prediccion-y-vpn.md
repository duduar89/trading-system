# 06 · Mercados de predicción, VPN y "otro país"

[← Volver al informe](README.md)

Me dijiste: *"Puede ser otro país, ¿eh? Puedo usar un nuevo VPN."* Este documento responde a eso con la ley, los términos de cada plataforma y los datos de rentabilidad. Todo está verificado a 25 de septiembre de 2026.

---

## Estado en España

- **26 de mayo de 2026:** Consumo, a través de la DGOJ, [abrió un expediente sancionador y ordenó bloquear Polymarket y Kalshi](https://www.dsca.gob.es/en/comunicacion/notas-prensa/consumo-abre-expediente-sancionador-plataformas-polymarket-kalshi-ordena). Los considera **juego sin licencia**. El bloqueo se aplica en los proveedores de internet ([CoinDesk](https://www.coindesk.com/policy/2026/05/26/spain-joins-growing-list-of-countries-shutting-out-polymarket-and-kalshi)).
- **A 24 de septiembre de 2026** siguen bloqueadas y no hay resolución publicada ([startpolymarket](https://startpolymarket.com/countries/spain/)). La DGOJ estimaba 3–4 meses, así que la resolución puede llegar en cualquier momento, y puede endurecer la situación.
- **Curiosidad:** la [página de restricciones de Polymarket](https://help.polymarket.com/en/articles/13364163-geographic-restrictions) (actualizada el 14-ago-2026) **no incluye a España**. El bloqueo lo pone España, no Polymarket. Aun así, sus términos **prohíben usar VPN** para saltarse restricciones y permiten congelar cuentas.

## Qué dice la ley sobre ti como usuario (verificado)

La Ley 11/2021, contra el fraude fiscal, modificó la Ley 13/2011 del juego. Desde entonces es **infracción leve**:

> *"participar desde España, a través del uso de técnicas de enmascaramiento de direcciones IP, en actividades de juego ofrecidas a través de páginas distintas de las autorizadas"*

La sanción para las infracciones leves va del **apercibimiento a una multa de hasta 100.000 €**. Fuentes: [Loyra Abogados](https://www.loyra.com/la-ley-del-juego-en-el-proyecto-de-ley-contra-el-fraude-fiscal/), [Poker-Red](https://www.poker-red.com/noticias/ley-juego-proyecto-ley-contra-fraude-fiscal-preve-sanciones-vpns-39116) y el [texto consolidado en el BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2011-9280).

Dicho de otra forma:

- **Usar una VPN en general es legal.**
- **Usar una VPN para jugar desde España en una web sin licencia española es una infracción administrativa expresa.**

No encontré casos publicados de sanciones a jugadores concretos. Pero la norma existe y la DGOJ ya ha calificado estos mercados como juego.

## Plataforma por plataforma

| Plataforma | Cómo se entra | ¿Funciona la VPN? | Qué te juegas |
|---|---|---|---|
| **Polymarket** (internacional) | Wallet, sin KYC para empezar. Según fuentes secundarias de mayo de 2026, pide KYC a quien opera mucho y bloquea rangos de IP de VPN | Técnicamente sí | Infracción leve de la Ley 13/2011, incumplir sus términos (congelación de cuenta), preguntas de tu banco sobre el origen del dinero al pasar USDC a euros, y tratamiento fiscal incierto |
| **Kalshi** | KYC con documento, reconocimiento facial y **país de residencia**. Se abrió a más de 140 países en [octubre de 2025](https://www.sportico.com/business/sports-betting/2025/kalshi-international-countries-access-1234874388/) | **No**, salvo mintiendo sobre tu residencia | Fraude documental. **No** |
| **Limitless, Myriad y otros sin KYC** | Wallet | Sí | Mismo encaje legal que Polymarket (juego sin licencia), liquidez muy baja, riesgo de oráculo |
| **Betfair Exchange .es** | KYC español | No hace falta | **Legal** (licencia DGOJ). Pool español aislado y más pequeño |
| **Torneos de Metaculus** | Cuenta | No hace falta | **Legal**. No hay dinero en riesgo |

## ¿Merece la pena el riesgo? Los números dicen que no

Aunque ignoraras la ley, la ventaja en Polymarket no es para un particular:

- **El 84,1 % de 2,5 millones de wallets pierde.** Solo el 0,51 % ganó más de 1.000 $, y **menos del 1 % de las wallets se lleva la mitad de las ganancias** ([CoinDesk, abril de 2026](https://www.coindesk.com/markets/2026/04/29/a-tiny-group-is-winning-on-polymarket-as-under-1-of-wallets-take-half-the-profits)). Ese 1 % son bots de market making y arbitraje.
- **Arbitraje.** Un [paper de IMDEA](https://arxiv.org/abs/2508.03474) estima 40 M$ de beneficio por arbitraje entre abril de 2024 y abril de 2025, concentrado en wallets automatizadas. Desde 2026 hay **comisiones para quien toma liquidez** en la mayoría de categorías ([docs](https://docs.polymarket.com/market-makers/maker-rebates)). Además, un análisis de 2026 encuentra que [el 62 % de las dependencias entre mercados que detecta un LLM no dan beneficio](https://medium.com/@navnoorbawa/combinatorial-arbitrage-in-prediction-markets-why-62-of-llm-detected-dependencies-fail-to-26f614804e8d).
- **Market making con rebates.** Hoy es el mecanismo más sólido: entre el 15 y el 25 % de las comisiones de los takers se reparte entre los makers. Pero el 0,55 % de las wallets de market making captura el 50 % del beneficio. El repositorio de referencia, [poly-maker](https://github.com/warproxxx/poly-maker), avisa de que puede perder dinero.
- **Bots de LLM que leen noticias.** En [Prediction Arena](https://arxiv.org/html/2604.07355v1) (57 días con dinero real, enero–marzo de 2026), los modelos punteros **perdieron entre un 16 y un 31 % en Kalshi**.
- **"Near-resolution"** (comprar al 95–99 %). Las disputas del oráculo UMA afectaron a más de 30 M$ en 2025, y la del alto el fuego de Irán, en abril de 2026, movió más de 280 M$ ([guía](https://polymarkets.co.il/en/guide/uma-disputes/)).

**Conclusión:** arriesgarte a una infracción y a que te congelen los fondos para competir contra bots industriales no compensa.

## Lo que sí puedes hacer con los mercados de predicción, legalmente

1. **Torneo de bots de Metaculus.** La misma habilidad (pronosticar con IA), sin riesgo de capital y con premios de 50 k$ por temporada. Ver [doc 01](01-sin-capital-ia-y-ml.md).
2. **Betfair Exchange .es.** Intercambio de apuestas con licencia y automatizable con [flumine](https://github.com/betcode-org/flumine). Ver [doc 02](02-apuestas-cuantitativas.md).
3. **Investigar con los datos públicos de Polymarket.** Leer la API de mercados y los datos on-chain es legal. Puedes construir un detector de arbitraje o de inconsistencias entre mercados y monetizarlo como investigación, dataset o herramienta, sin operar desde España. Cliente oficial: [py-clob-client](https://github.com/Polymarket/py-clob-client).
4. **Esperar a la resolución de la DGOJ**, o a que alguna plataforma pida licencia en España.

## Fiscalidad si alguna vez operas en estos mercados

La DGT no se ha pronunciado. Hay [dos lecturas](https://taxdown.es/criptomonedas-declaracion-renta/polymarket-declarar-apuestas-mercados-prediccion):

- **Ganancia patrimonial en la base del ahorro.** Es la posición mayoritaria entre los asesores.
- **Juego.** Si Hacienda sigue a la DGOJ, las ganancias irían a la base general y las pérdidas solo compensarían ganancias de juego del mismo año.

Para evitar problemas, registra cada operación con su hash de transacción.

---

## Sobre "otro país" en general

| Qué quieres | ¿Se puede? |
|---|---|
| Usar plataformas extranjeras **sin KYC** (DeFi, Hyperliquid, Aave…) | Sí, y muchas ni bloquean España. Pero sin protección al inversor y tributando igual en España |
| Usar plataformas extranjeras **con KYC de residencia** (Kalshi, Binance global, consultor de WorldQuant) | Solo mintiendo en el KYC. No te ayudo con eso: es fraude y te expone a perderlo todo |
| Tributar menos por operar "desde fuera" | **No.** Como residente fiscal en España tributas por tu **renta mundial**. Con [DAC8](https://finbooks.com/es/blog/dac8-crypto-reporting) (desde 2026) y CRS, Hacienda recibe los datos |
| Cambiar de país de verdad | Es legal, pero la residencia fiscal depende de pasar más de 183 días al año y de dónde tengas tus intereses. A estos importes no compensa el cambio de vida |

# Informe escéptico: ¿puede funcionar de verdad un «trading floor» de agentes IA?

## 1) Veredicto en 5 líneas

1. **Funcionar técnicamente: sí.** Leer datos, poner a varios agentes con papeles a discutir, pasar su propuesta por límites de riesgo escritos en código y mandar órdenes a Alpaca paper es ingeniería normal. TradingAgents y varios repos de «pixel office» ya lo hacen.
2. **Ganar dinero: no hay pruebas públicas de que lo consiga.** En las pruebas en vivo con dinero real la mayoría pierde. Los papers que enseñan Sharpe de 5 a 8 no aguantan cuando se evalúan en periodos largos, con costes y sin fugas de información del futuro.
3. **El comité de agentes añade coste y variabilidad, no ventaja demostrada.** Si hay ventaja, está en reglas deterministas y en la gestión del riesgo. El LLM tiene que demostrar que aporta algo frente a la misma estrategia sin él. En el propio vídeo, la estrategia real es un cruce de medias (SMA 7-25) que el agente solo narra.
4. **Lo más peligroso es la parte de «se mejora solo».** Si no se apunta cada variante probada y no se valida con datos que no se usaron para diseñarla, cada «mejora» se ajusta al ruido del pasado reciente.
5. **Objetivo honesto:** un laboratorio en papel con métricas netas de todos los costes y criterios para matarlo escritos antes de empezar. Nada de dinero real antes de unos 12 meses batiendo a comprar y mantener y a la versión sin LLM. Y aun así, con una cantidad pequeña.

## 2) Evidencia

### A. Pruebas en vivo con dinero real o en tiempo real

**Alpha Arena, temporada 1 (Nof1)**
- Del 18 de octubre al 3 de noviembre de 2025. Cada modelo tenía 10.000 $ reales para operar perpetuos de cripto en Hyperliquid, con apalancamiento.
- Resultados: Qwen3 Max +22,3 %, DeepSeek +4,9 %, Claude Sonnet 4.5 −30,8 %, Grok 4 −45,3 %, Gemini 2.5 Pro −56,7 %, GPT-5 −62,7 %.
- Las cifras finales cambian un poco según la fuente y el momento en que se tomaron. La web de nof1.ai devolvió 403, así que estas cifras vienen de recopilaciones de terceros.
- Fuentes: [iWeaver](https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/), [GNcrypto](https://www.gncrypto.news/news/qwen-wins-alpha-arena-season-1-with-22-percent-returns/).
- Varias recopilaciones atribuyen a Gemini más de 160 operaciones y más de 1.000 $ en comisiones sobre 10.000 $. No lo he podido verificar en fuente primaria ([iWeaver](https://www.iweaver.ai/blog/alpha-arena-ai-trader-showdown/)).

**Alpha Arena, temporada 1.5 (acciones de EE. UU.)**
- 8 modelos en 4 modalidades, 32 ejecuciones de 10.000 $ durante dos semanas.
- Según Bloomberg (6 de mayo de 2026), el conjunto perdió cerca de un tercio del capital y solo 6 de las 32 ejecuciones acabaron en beneficio.
- Con las mismas instrucciones, Grok 4.20 hizo 158 operaciones en un concurso y Qwen 1.418.
- El fundador de Nof1 dice: *«LLMs can't really make money by themselves… you need a very sophisticated harness»* («los LLM no ganan dinero por sí solos; hace falta un andamiaje muy sofisticado»). Añade que operar de forma autónoma con un LLM *«isn't a thing yet»* («todavía no es algo que exista»).
- Fuentes: [Bloomberg](https://www.bloomberg.com/news/articles/2026-05-06/ai-bots-auditioning-for-wall-street-trading-are-mostly-losing), [Business Standard](https://www.business-standard.com/markets/news/ai-bots-auditioning-for-wall-street-trading-are-mostly-losing-money-126050701793_1.html), [ZeroHedge](https://www.zerohedge.com/markets/wall-street-keeps-testing-ai-traders-most-are-still-underperforming), [GNcrypto](https://www.gncrypto.news/news/mystery-model-alpha-arena-season-1-5-winner/).

**LiveTradeBench**
- 50 días en vivo con 21 modelos.
- Sacar buena nota en LMArena, la clasificación general de modelos, no predice operar mejor ([arXiv 2511.03628](https://arxiv.org/abs/2511.03628)).

**TradeRank (competición simulada)**
- Con comisión del 0,1 % y sin apalancamiento.
- Solo 5 de 22 «modelo-temporadas» acabaron en beneficio, y ningún modelo repitió beneficio ([TradeRank](https://www.traderank.ai/blog/can-ai-beat-the-market)).

### B. Los papers y su letra pequeña

**TradingAgents** ([arXiv 2412.20138](https://arxiv.org/html/2412.20138v3))
- Solo 3 meses (enero a marzo de 2024) y 3 acciones.
- Sharpe de 5,6 a 8,2, sin modelar costes.
- Los propios autores reconocen que limitaron la prueba a 3 meses por el coste de las llamadas al LLM.
- Una revisión externa encontró que la referencia de «comprar y mantener» está mal: el paper dice −5,23 % y lo real fue +9,12 %. Además, el repositorio tiene abierta una queja por usar datos del futuro (issue #203) ([dev.to](https://dev.to/trow126/the-most-starred-llm-trading-paper-claims-buy-and-hold-lost-523-it-actually-gained-912-1jj6)).

**FINSABER** (KDD 2026, [arXiv 2505.07078](https://arxiv.org/abs/2505.07078))
- FinMem publicaba un Sharpe de 2,68 en TSLA; al reproducirlo con GPT-4o sale 0,59.
- Evaluado en 20 años:
  - TSLA: comprar y mantener 0,631 frente a FinMem 0,641.
  - NFLX: comprar y mantener 0,622 frente a FinMem 0,293.
  - Universo amplio de valores: comprar y mantener 0,703 frente a FinAgent 0,241.
- Los LLM resultan demasiado conservadores cuando el mercado sube y demasiado agresivos cuando baja.
- Ojo: el periodo 2004-2024 está dentro de lo que el modelo vio al entrenarse, así que parten con ventaja, y aun así no ganan.

**StockBench** ([arXiv 2510.02209](https://arxiv.org/abs/2510.02209))
- Marzo a julio de 2025.
- La mayoría de los agentes no supera a comprar y mantener, y eso sin modelar costes.

**Revisión «Agentic Trading»** ([arXiv 2605.19337](https://arxiv.org/html/2605.19337v1))
- De 19 estudios, ninguno llega al nivel más alto de reproducibilidad (R3), y solo 1 declara cómo modela los costes.
- No existen comparaciones entre backtest y resultados en vivo.

**«What survives honest evaluation?»** ([arXiv 2608.27734](https://arxiv.org/html/2608.27734v1))
- La mejor estrategia que encontró un agente LLM tras 102 intentos tenía Sharpe 1,69 en la fase de diseño y cayó a 0,18 con datos nuevos.
- De 5 ejecuciones independientes, ninguna pasa la certificación. SPY (Sharpe 0,85) sí la pasa.

**Fuga de datos del futuro dentro del modelo** ([arXiv 2605.24564](https://arxiv.org/html/2605.24564))
- Un LLM ya «conoce» los precios de los años con los que se entrenó.
- Por eso cualquier backtest hecho con Claude sobre 2024-2025 está contaminado.

**Robustez y seguridad** ([SoK FARSIGHT, arXiv 2609.19705](https://arxiv.org/abs/2609.19705))
- El 80 % de 15 esquemas académicos falla al menos una métrica de robustez.
- Los 15 son vulnerables, incluidos ataques a través de la fuente de noticias.

**Fallos de los sistemas multiagente** ([MAST, arXiv 2503.13657](https://arxiv.org/abs/2503.13657))
- Fallan entre el 41 % y el 86,7 % de las veces.
- El 37 % de los fallos es desalineación entre agentes.
- En el 14 % de los casos el agente razona bien y luego hace otra cosa.

### C. Papel frente a real en Alpaca

**Qué hace y qué no hace la cuenta paper** ([docs](https://docs.alpaca.markets/us/docs/paper-trading))
- Empieza con 100.000 $.
- Ejecuta al mejor precio de compra o venta del momento cuando la orden es ejecutable.
- El 10 % de las veces ejecuta solo una parte de la orden, al azar.
- **No simula** el impacto de tus órdenes en el mercado, la fuga de información, el deslizamiento por latencia, la posición en la cola, la mejora de precio, las tasas regulatorias ni los dividendos.

**Comisiones de cripto en real** ([docs](https://docs.alpaca.markets/us/docs/crypto-fees))
- En el nivel más bajo (menos de 100.000 $ de volumen en 30 días): 0,15 % si tu orden espera en el libro (*maker*) y 0,25 % si ejecuta al momento (*taker*).
- Se cobran en el activo que recibes.
- Un tercero comprobó que la cuenta paper también descuenta el 0,25 % de las monedas compradas: la cantidad que queda en cartera no es la que pediste ([PR](https://github.com/SaguPandya96/Data-Science-/pull/47)). Hay que comprobarlo en la primera operación.

**Límites de la cripto en Alpaca** ([docs](https://docs.alpaca.markets/docs/crypto-trading))
- No se puede vender en corto ni usar margen.
- Solo hay órdenes a mercado, límite y stop-limit. No hay stop a mercado.
- Lo que hacían los modelos de Alpha Arena (perpetuos, apalancamiento, cortos) no se puede replicar aquí.

**Aviso sobre un blog**
- Un blog dice que en paper las órdenes de cripto van al libro de órdenes real ([hmmtrade](https://hmmtrade.com/blog/alpaca-paper-gotchas)).
- La documentación oficial lo contradice («not routed to a live exchange»). No hay que fiarse de ese blog.

### D. Por qué los vídeos enseñan sobre todo visualización

**Lo que se ve en las dos capturas**
- **Vídeo 1:**
  - Patrimonio 99.999 $, resultado −1 $, exposición 0 %, 0 posiciones, modo PAPEL: todavía no ha operado.
  - Los bocadillos incluyen «Pausa de cinco minutos», que es puro teatro.
- **Vídeo 2:**
  - La tarjeta enseña un 33 % de acierto, factor de beneficio 1,28 y adherencia «aquecendo» (calentando): la muestra de operaciones es mínima.
  - Da un patrimonio de 15.216 $ sin decir con cuánto empezó ni compararlo con nada.

**La oficina en pixel art es una pieza genérica**
- Se puede poner encima de cualquier cosa: [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (hecho para agentes de programación), [agent-office](https://github.com/harishkotra/agent-office), [pixel-office](https://github.com/Bapiai25/pixel-office) (un solo HTML, sin backend).
- No dice nada sobre si el sistema gana dinero.

## 3) Qué hay que ver en la cuenta paper antes de pensar en dinero real

**La estadística manda.**
- Con rentabilidades diarias, el margen de error del Sharpe anual es ≈ √((1+SR²/2)/T), con T en años ([Lo 2002](https://rpc.cfainstitute.org/research/financial-analysts-journal/2002/the-statistics-of-sharpe-ratios)).
- En 17 días (lo que duró Alpha Arena) el margen es de ±4,6. Es ruido puro.
- En 3 meses el margen es de ±2. Un Sharpe de 2 medido ahí no se distingue de 0.
- En 12 meses el margen es de ±1 a ±1,2.
- Para demostrar con un 95 % de confianza que un Sharpe de 1 es mayor que 0 hacen falta unos 4 años. Para un Sharpe de 2, unos 2 años.
- La cripto tiene colas gruesas, lo que alarga todavía más esos plazos ([Bailey y López de Prado, MinTRL](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1821643)).
- **Conclusión:** la cuenta paper no demuestra que haya ventaja; sirve para filtrar y para matar ideas rápido.

**Fase A (semanas 1 a 6): comprobar que funciona técnicamente**
- Cada día, las posiciones y la caja del sistema coinciden con las de Alpaca, sin diferencias.
- Ninguna orden huérfana ni duplicada.
- El botón de parada total (kill switch) está probado.
- Los vetos del módulo de riesgo quedan contados.
- El coste diario del LLM está registrado y por debajo del tope.
- Cada cifra del panel se puede reproducir desde el registro.

**Fase B (mínimo 6 meses, lo ideal 12 o más): comprobar si gana dinero**

| Métrica | Cómo medirla |
|---|---|
| Rentabilidad **neta** | Después de comisiones, del diferencial estimado entre compra y venta y del coste de la API |
| Comparativas | Frente a comprar y mantener BTC, una cesta equiponderada de los mismos activos, SPY (si opera acciones) y efectivo. Sobre todo, frente a **la misma estrategia sin LLM**, corriendo en paralelo desde el primer día |
| Sharpe y Sortino | Con rentabilidades diarias y 365 días al año en cripto, siempre con su intervalo de confianza |
| Caída máxima y su duración | Comparada con la caída de BTC en el mismo periodo |
| Exposición media y beta frente a BTC | Hay que compararlo con una referencia de la misma exposición. Si solo está invertido el 40 % del tiempo, «caer menos» no tiene mérito |
| Número de operaciones cerradas | 100 o más. Con 100, el acierto tiene un margen de ±10 puntos; con 30, de ±18 |
| Rotación y comisiones | Como porcentaje anual del patrimonio |
| Acierto, ganancia media / pérdida media, factor de beneficio | — |
| Si el resultado depende de pocas operaciones | Quitar las 2 mejores y ver si sigue en positivo |
| Adherencia | Porcentaje de órdenes que siguen la regla declarada y porcentaje de decisiones del LLM vetadas |
| Registro de variantes | Cada variante probada se apunta, para poder deflactar el Sharpe ([DSR](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)) |

**Criterios para pasar a dinero real.** Eduardo tiene que escribirlos antes de empezar. Los umbrales de riesgo los decide él; aquí no se inventan.
- Tras 12 meses o más, bate en neto a comprar y mantener con la misma exposición **y** a la versión sin LLM.
- La caída máxima queda dentro del límite que Eduardo haya fijado de antemano.
- 100 operaciones o más.
- Ningún incidente en los últimos 3 meses.

Si se cumple todo, se empieza solo con una cantidad que se pueda perder entera. Durante 1 a 3 meses se comparan las ejecuciones reales con las de papel, para medir cuánto se pierde al pasar a real.

## 4) Las 5 trampas más probables

1. **Construir el teatro en vez del sistema.**
   - Bocadillos, pausas para el café y departamentos consumen tokens y atención, y no aportan rentabilidad.
   - El vídeo 1 tiene 0 posiciones.
   - **Cómo evitarla:** los bocadillos se generan con plantillas a partir de los datos. El LLM solo interviene cuando pasa algo, como una vela nueva de 4 horas o un cambio de señal.

2. **Dejar que el LLM decida o calcule.**
   - No es determinista: con el mismo prompt, un modelo hizo 158 operaciones y otro 1.418.
   - Se inventa cifras, y las noticias pueden meterle instrucciones maliciosas (15 de 15 esquemas vulnerables en SoK).
   - **Cómo evitarla:** el LLM solo propone y narra. El código calcula el tamaño, los stops y el P&L, y puede vetar.

3. **Que los costes se coman cualquier ventaja.**
   - **Comisiones (ejemplo ilustrativo):** con 8 activos, 10.000 $ por posición y una ida y vuelta cada 2 semanas por activo, al 0,25 % + 0,25 %, salen unos 10.400 $ al año. Es el 10,4 % del patrimonio, antes del diferencial entre compra y venta.
   - **Coste de la API (cota alta, sin caché, precios de la API a 25-sep-2026):**
     - Un comité de 13 llamadas × (5.000 tokens de entrada + 700 de salida), con 48 decisiones al día.
     - Con Haiku 4.5 (1 $ / 5 $ por millón): unos 5 $ al día, unos 160 $ al mes.
     - Con Sonnet 5.5 (2 $ / 10 $): unos 320 $ al mes.
     - 20 agentes «charlando» cada 5 minutos con Haiku: otros 330 $ al mes. **El teatro cuesta más que las decisiones.**
   - **Lo importante:** el coste de la API es dinero real, aunque el P&L sea de mentira. Con 10.000 € reales, 160 $ al mes obligan a ganar un 19 % al año solo para cubrirlo.

4. **Creer que «se mejora solo».**
   - Cada ajuste que hace el propio sistema es un intento más, y sin control se ajusta al ruido (Sharpe 1,69 que baja a 0,18; 0 de 5 sobreviven).
   - Si se hace backtest con Claude sobre años que ya vio al entrenarse, el resultado está contaminado.
   - **Cómo evitarla:**
     - Los cambios se prueban antes en una cartera en sombra, en paralelo y durante varias semanas.
     - Solo se adoptan si cumplen criterios fijados de antemano.
     - Todas las variantes quedan apuntadas y el Sharpe se deflacta.

5. **Confundir suerte o racha de mercado con habilidad, y papel con real.**
   - 17 días o 2 semanas no dicen nada.
   - Un mercado alcista hace que cualquier cosa larga parezca buena; FINSABER muestra que los LLM se equivocan de forma distinta según suba o baje el mercado.
   - La cuenta paper no simula el impacto ni el deslizamiento.
   - Las monedas en cartera no coinciden con las pedidas por la comisión, así que hay que conciliar con el bróker y no con la orden.
   - Un stop-limit puede no ejecutarse si el precio salta. En cripto no hay cortos ni apalancamiento.

## 5) Qué significa para el diseño

- **Separar en tres capas:** motor determinista (señales, riesgo, tamaño de las posiciones, P&L, conciliación), agentes LLM (tesis, veto cualitativo, narración con tope de coste) y panel (solo lectura del estado).
- **Estrategia de control desde el día 1:** las mismas reglas sin LLM, en el simulador interno, y el patrimonio de comprar y mantener BTC dibujado en el mismo gráfico.
- **Registro inmutable (JSONL)** de cada propuesta, veto, orden, ejecución, comisión y dólar gastado en la API. Así cualquier cifra del panel se puede reconstruir.
- **Criterios para matar el sistema y límites de riesgo:** los fija Eduardo por escrito antes de arrancar. Si falta alguno, se le pregunta; no se inventa.
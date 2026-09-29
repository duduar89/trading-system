# Propuesta: la mesa de trading como «sociedad de agentes»

## Veredicto
- **Sí, puede funcionar de verdad**, entendido así: opera sola 24/7 con la cuenta paper de 100.000 $, nunca se salta el riesgo y aprende de una forma que se puede medir.
- **No puede prometer ganar al mercado.** Si hay ventaja, sale de estrategias deterministas y de la gestión del riesgo. La charla entre agentes sirve para explicar y para gobernar, no para acertar.
- Los vídeos enseñan 40 muñecos ocupados. Lo sano es lo que dice el bocadillo de SOL: «sin posición, esperando señal». Casi siempre, lo correcto es no operar.

## La regla que lo ordena todo
El LLM **habla, resume y elige de un menú cerrado**. El código **calcula, dimensiona, veta y ejecuta**. Ninguna cifra del panel ni ninguna orden sale de un LLM. Si su respuesta no valida contra el esquema JSON, se descarta y se aplica la regla determinista.

## Departamentos y agentes

| Departamento | Agente | Qué decide de verdad | Quién lo hace | Cadencia |
|---|---|---|---|---|
| Macro | `macro` | Régimen RISK-ON / NEUTRAL / RISK-OFF → multiplica el riesgo por 1,0 / 0,6 / 0,25 | Código | Cierre diario y cada 4 h |
| Análisis | `analista` | Nada operativo: nota por activo (sesgo, SMA50, RSI 4H, volatilidad) | El código calcula, el LLM redacta | Cada 4 h, todos los activos en una llamada |
| Noticias (con claves) | `noticias` | Solo puede marcar «evento» en un activo → tamaño ×0,5 durante 12 h. Nunca sube el tamaño | El LLM clasifica titulares con etiquetas cerradas | Lote cada 30 min |
| Mesas | `mesa-btc`, `mesa-eth`, `mesa-sol`, con un trader por estrategia | Proponen entrada, stop y objetivo | Código | Al cierre de cada vela de 4H |
| Riesgo | `riesgo` | Aprueba con tamaño o **veta** con motivo. Controla el kill switch | Solo código | Cada propuesta y cada latido (60 s) |
| Ejecución | `ejecucion` | Manda las órdenes, reconcilia con el bróker y no opera con precios de más de 15 min | Código | Cada latido |
| Intervención | `interventor` | Patrimonio, P&L, caída, exposición y métricas por estrategia | Código | Cada latido |
| Laboratorio | `laboratorio` | Variantes: las prueba en sombra, las promueve o las retira | Backtest en código, hipótesis del LLM | Semanal |
| Dirección | `comite` | Reparte el presupuesto de riesgo; pausa o reanuda estrategias | El LLM elige del menú y el código lo valida | Cada 4 h y extraordinario |
| Secretaría | `cronista` | Nada: convierte los eventos en bocadillos | Plantillas; LLM opcional | Por evento |

**Estrategias iniciales.** Son el punto de partida clásico, sin optimizar. El laboratorio las ajusta dentro de una rejilla acotada.
- `tendencia-sma`: cruce de SMA 7/25 en 4H, solo en largo y solo con el precio por encima de la SMA200 de 4H (la del vídeo). Stop a 2×ATR(14).
- `ruptura-donchian`: entra al superar el máximo de 20 velas de 4H y sale al perder el mínimo de 10.
- `reversion-rsi`: RSI(14) de 4H por debajo de 30 con el precio sobre la SMA200 diaria, solo en régimen NEUTRAL. Objetivo 1,5R.

**Universo.** Sin claves: BTC, ETH y SOL contra el dólar. Con claves: solo los pares que devuelva el endpoint de activos de Alpaca, más SPY, QQQ, GLD y TLT en velas diarias como lectura macro. En Alpaca la cripto solo se opera en largo.

## Cómo se hablan

**El bus.** Es un emisor de eventos dentro del proceso más un fichero `bus-AAAA-MM-DD.jsonl` donde se añade cada mensaje. El panel recibe ese mismo flujo por SSE: lo que se ve en pantalla *es* el registro, no una animación aparte. Tras un reinicio, el estado se reconstruye desde el JSONL y se reconcilia con el bróker antes de hacer nada.

**El mensaje.** Cada uno lleva `{id, ts, de, canal, tipo, texto, datos, refs}`:
- `datos` son las cifras del código.
- `texto` es lo que se pinta en el bocadillo.
- `refs` enlaza cada mensaje con el que lo provocó (señal → orden → cierre → lección).

**Canales y tipos.**
- Canales: `#mercado`, `#senales`, `#riesgo`, `#ordenes`, `#comite`, `#megafono`, `#laboratorio`, `#charla`.
- Tipos: `OBSERVACION`, `PROPUESTA`, `APROBACION`, `VETO`, `ORDEN`, `EJECUCION`, `DIRECTIVA`, `VOTO`, `LECCION`.

**Vida de una operación**
1. Cierra la vela de 4H de SOL y `mesa-sol/tendencia-sma` publica una `PROPUESTA` con entrada, stop, objetivo y motivo.
2. `riesgo` calcula el tamaño: patrimonio × 1 % × régimen × asignación del comité ÷ (entrada − stop). Después lo recorta con los límites que ya están en `src/config.js`:
   - 20 % del patrimonio por activo y 60 % en cripto.
   - −3 % de pérdida en el día.
   - Las directivas del Megáfono.

   Publica `APROBACION` con las unidades, o `VETO` con un motivo de lista cerrada: `LIMITE_ACTIVO`, `LIMITE_CRIPTO`, `PERDIDA_DIA`, `PRECIO_VIEJO`, `MEGAFONO`, `ORDENES_HORA` o `MIN_NOCIONAL`.
3. `ejecucion` manda la orden con su stop y publica `EJECUCION` con el precio real.
4. Al cerrar la operación, `interventor` calcula R, MAE/MFE (la peor y la mejor excursión del precio durante la operación) y adherencia, y lanza el post-mortem.

Las propuestas vetadas también se siguen en sombra. Así se sabe si un veto ahorró dinero o lo costó, y si el Megáfono acierta.

**Caso conocido antes de operar** (`scripts/probar-dimensionado.js`): con 100.000 $ de patrimonio, entrada a 100 y stop a 95, el riesgo es de 1.000 $. 1.000 / 5 = 200 unidades, que valen 20.000 $, justo el tope del 20 %. Si no salen 200 unidades, el sistema no arranca.

**Botones del panel:**
- **Comité**: convoca uno extraordinario.
- **Pausar todo**: no abre nada nuevo y mantiene los stops.
- **Kill switch**: cierra todo. Salta solo con una caída del −15 %, y solo un humano lo desactiva con **Reabrir**.
- **Prueba**: ejecuta los casos conocidos.
- **Ajustes**: enseña los límites.

## El comité

Se reúne cada 4 h (`COMITE_HORAS=4`, ya está en la config). Hay comité extraordinario si el día pierde más de un −2 %, si cambia el régimen o si se pulsa «Comité».

**Orden del día fijo:**
1. Estado, que presenta `interventor`. Son cifras de código y no se discuten.
2. Régimen, de `macro`.
3. Mesas: por estrategia, las últimas 4 h y los últimos 30 días. Operaciones, acierto, factor de beneficio, adherencia y vetos.
4. Laboratorio: candidatas a promover y estrategias a retirar.
5. Megáfono: directivas vigentes y cuáles caducan.
6. Decisiones.

**Votos, sin teatro.** Los «votos» de cada departamento son comprobaciones de código que se pintan como votos:
- `riesgo` veta cualquier asignación que rompa un límite, y ese veto es absoluto.
- `laboratorio` veta cualquier promoción que no haya pasado sus puertas.

Que varios LLM «voten» sería la misma opinión con varios disfraces, y a varias veces el coste.

**Lo que el comité (LLM) puede decidir**, siempre con salida JSON validada:
- Un multiplicador por estrategia de la lista {0; 0,5; 1; 1,25}, con la suma de presupuestos ≤ 1.
- Pausar o reanudar una estrategia, con motivo.
- Renovar una directiva del Megáfono, como mucho 7 días.
- Aceptar o rechazar una promoción que ya pasó las puertas.

Lo que nunca puede hacer: tocar los límites duros, abrir o cerrar posiciones a mano, o cambiar parámetros de una estrategia.

**Base determinista, y prueba de que el LLM aporta.** Siempre se calcula también la decisión por defecto: un multiplicador por la rentabilidad ajustada a riesgo de los últimos 30 días, acotado.
- Sin clave o sin presupuesto, se aplica esa.
- Con clave, se guardan las dos y la del LLM compite en sombra contra la base. Si a los 60 días no la mejora, el comité LLM se apaga.

## El Megáfono: de frase libre a parámetro acotado

La frase de Eduardo pasa por un LLM que solo puede devolver una de estas directivas:

| Directiva | Parámetro | Límite |
|---|---|---|
| `apretar_riesgo` | factor de 0,25 a 1,0 | nunca más de 1 |
| `evitar_activo` | activo | — |
| `pausar_estrategia` | estrategia | — |
| `cerrar_posicion` | activo | pide confirmación |
| `pregunta` | texto | se contesta con cifras del interventor |
| `no_entendido` | — | no hace nada |

- Todas caducan en el siguiente comité, salvo que el comité las renueve.
- **El Megáfono solo aprieta.** Para subir el riesgo hay que editar `data/ajustes.json`, a propósito.
- Antes de aplicar una directiva, el panel dice lo que ha entendido. Por ejemplo: «He entendido: evitar SOL hasta el comité de las 16:00. ¿Confirmar?».
- Sin clave de Anthropic, el Megáfono es un formulario con esos seis botones.

## Memoria: post-mortem y lecciones

**La ficha de cada operación.** Al cerrarla, el código apunta:
- Estrategia, activo, y régimen y F&G al entrar.
- Entrada, salida, stop y objetivo; R, MAE/MFE y duración.
- Deslizamiento y adherencia.

El LLM añade dos líneas y **una etiqueta de lista cerrada**: `acierto`, `senal_falsa_lateral`, `contra_regimen`, `stop_ajustado`, `salida_prematura`, `mala_ejecucion` o `buena_decision_mal_resultado`. Todo va a `lecciones.jsonl`.

**La memoria útil es el recuento, no el texto.** Cada semana el código agrupa por estrategia × régimen × etiqueta. Si una etiqueta se repite (n ≥ 20 con R medio < −0,3), se convierte en hipótesis. Por ejemplo: «`tendencia-sma` pierde en NEUTRAL: probar a exigir ADX > 20». Al comité solo llegan las cinco lecciones agregadas más relevantes.

**Cómo mejora sin romperse**
1. Una variante usa el mismo código con otros parámetros, dentro de una rejilla de unas 20 combinaciones como mucho.
2. Se prueba con backtest walk-forward: los parámetros se ajustan en un tramo del histórico y se evalúan en el siguiente.
3. Si pasa, corre en sombra al menos 14 días y 30 señales.
4. Se promueve si su factor de beneficio supera al de la titular en un 10 % o más sin empeorar la caída. Como mucho, una promoción por semana.
5. Vuelve atrás sola si en sus 20 primeras operaciones reales rinde claramente por debajo de lo que dio en sombra.

Un LLM nunca reescribe código de estrategia ni de riesgo.

## Coste del LLM

Precios por millón de tokens, entrada/salida: Opus 5.5, 4/20 $; Haiku 4.5, 1/5 $. La tabla es una estimación; la primera semana se sustituye por lo medido.

| Uso | Llamadas/día | Con Haiku | Con Opus 5.5 |
|---|---|---|---|
| Comité (siempre Opus) | 6–8 | ~0,60 $ | ~0,60 $ |
| Notas de análisis | 6 | 0,04 $ | 0,25 $ |
| Post-mortem | ~5 | 0,02 $ | 0,10 $ |
| Noticias (con claves) | 48 | 0,17 $ | 0,85 $ |
| Megáfono | ~5 | 0,01 $ | 0,07 $ |
| Charla opcional | 48 | 0,19 $ | 0,95 $ |
| **Total** | | **~1 $/día (~30 $/mes)** | **~2,8 $/día** |

La config actual usa Opus 5.5 para todo con un tope de 2 $/día, así que ese tope se alcanza a media tarde. Si `LLM_MODELO_AGENTES` pasa a Haiku 4.5, el gasto queda en ~1 $/día. **Esa decisión es de Eduardo.**

**Cómo se mantiene bajo:**
- Los bocadillos salen de plantillas con datos reales; el LLM solo añade adorno.
- Se llama por evento, no por reloj.
- Se agrupa en lotes: todos los activos en una llamada y todos los titulares en otra.
- Se reutiliza el prompt de sistema en caché cuando las llamadas van seguidas.
- Post-mortem nocturno y laboratorio van por la Batch API, al 50 %.

**El tope diario.** Cada llamada guarda sus tokens y su coste en `llm-costes.jsonl`. El gasto se va recortando por escalones:
- Al 70 % del tope se apaga la charla.
- Al 90 %, las notas pasan a plantilla.
- Al 100 %, el comité usa la base determinista.

El trading nunca se para por falta de presupuesto de LLM.

## Qué APIs hacen falta

| API | Para qué | Clave |
|---|---|---|
| Alpaca Market Data (cripto) | Velas | No |
| alternative.me | Índice Fear & Greed | No |
| Alpaca Trading (paper) | Cuenta de 100.000 $, órdenes, acciones IEX, noticias | Sí, gratuita |
| Anthropic | Comité, notas, Megáfono, post-mortem | Sí, pero opcional |

Sin claves, funciona con un bróker simulado de 100.000 $ y precios reales de cripto. Ese simulador tiene que cobrar comisión y deslizamiento. **La comisión de cripto de Alpaca hay que comprobarla en su web antes de fijarla; no tengo el dato.** Qué tipos de orden admite Alpaca para cripto (stop-limit, órdenes con stop y objetivo enlazados) también hay que verificarlo antes de construir la ejecución.

## Riesgos de que esto no funcione

1. **Pocas operaciones, mucho ruido.** Con velas de 4H y tres activos habrá pocas operaciones por semana. Saber si algo mejora llevará meses, y antes de eso cualquier conclusión es suerte.
2. **Sobreajuste.** Buscar parámetros sobre el mismo histórico acaba encontrando uno que «funcionó». La rejilla pequeña, el walk-forward y la sombra lo limitan, pero no lo eliminan.
3. **El papel miente a favor.** Alpaca paper no simula ni el impacto de mercado ni la cola de órdenes, así que los resultados serán mejores que con dinero real.
4. **El portátil duerme.** Windows suspende, se actualiza y reinicia. Por eso los stops tienen que vivir en el bróker. En modo simulado, al despertar se rejuegan las velas perdidas y cada stop se ejecuta al peor precio que haya habido.
5. **La cripto se mueve junta.** BTC, ETH y SOL suelen caer a la vez: lo que protege es el tope del 60 % en cripto, no la diversificación.
6. **El LLM convence.** Un comité bien redactado aparenta criterio aunque sea ruido. Por eso compite en sombra con la base y se apaga si no gana.
7. **Los datos fallan en silencio.** Una vela que no llega o llega tarde no puede generar señal: con un precio de más de 15 min, no se opera y se avisa.

## Lo que NO haría

- Dejar que un LLM dé precios, tamaños, stops o cifras del panel.
- Poner un LLM detrás de cada muñeco: 40 veces el coste para la misma opinión.
- Dejar que el Megáfono o el comité suban el riesgo.
- Dejar que el sistema reescriba su propio código.
- Hacer scalping o usar velas de minutos: el portátil y las comisiones se lo comen.
- Usar apalancamiento, cortos o derivados en esta fase.
- Pasar a dinero real sin al menos 3 meses y 100 operaciones en papel, comparadas con comprar y mantener BTC/ETH con la misma volatilidad.
- Añadir activos o estrategias antes de que las tres primeras tengan historial.
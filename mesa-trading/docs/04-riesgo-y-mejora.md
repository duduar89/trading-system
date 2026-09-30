# Riesgo y cómo se mejora solo

## Límites duros

Viven en `src/config.js` (`LIMITES_DUROS`). **Decididos el 30 de septiembre de
2026** (Eduardo lo delegó en el director, con el techo que él puso: como mucho
un 2 % de riesgo por operación). Ni el comité ni el Megáfono pueden
aflojarlos; solo apretarlos, y lo que aprietan caduca.

| Límite | Valor | Qué pasa |
|---|---|---|
| Peso por activo | 10 % del patrimonio | La orden se recorta |
| Exposición total | 80 % | Se recorta: siempre queda un 20 % en efectivo |
| Exposición cripto | 50 % | Se recorta: las cripto se mueven juntas |
| Riesgo por operación | 1 % | El tamaño se ajusta para que, si salta el stop, se pierda como mucho eso |
| Posiciones abiertas | 12 | No se abren más |
| Pérdida del día −2 % | — | Solo cerrar hasta las 00:00 UTC |
| Pérdida del día −7 % | — | **Kill switch** automático |
| Caída desde el máximo −10 % | — | Posiciones nuevas a la mitad |
| Caída desde el máximo −25 % | — | **Kill switch** automático |
| Órdenes | 10 por minuto, 4 por mesa y hora | Protege de un bucle |
| Orden mínima | 10 $ | Por debajo, la comisión se come la operación |
| Precio viejo | 15 min cripto, 2 min acciones | No se abre con un precio caducado |
| Desvío de precio | 2 % | Si el precio se ha movido más desde la decisión, se vuelve a decidir |

### Por qué estos valores

Con velas reales de Alpaca (BTC, ETH y SOL, de 2021 a septiembre de 2026),
comisiones, deslizamiento y la penalización de papel. Todas las cifras salen
de `node scripts/estudiar-limites.js`, que las repite cuando quieras (lee las
velas que guarda `node scripts/probar-backtest.js --real`).

**Riesgo por operación: 1 %.** Con la cartera con la que se hizo el estudio
(Momentum 40 %, Ruptura 40 % y las otras dos al 2 %), sin la protección del
fondo:

| Riesgo | Rentabilidad anual | Sharpe | Caída máxima | Peor operación |
|---|---|---|---|---|
| 0,5 % (el de antes) | 4,9 % | 0,56 | 16,8 % | −0,85 % del fondo |
| **1 %** | **8,5 %** | **0,61** | **26,7 %** | −2,05 % |
| 1,5 % | 10,3 % | 0,65 | 29,5 % | −3,30 % |
| 2 % (tu techo) | 10,0 % | 0,63 | 30,9 % | −3,31 % |

Con la protección (posiciones nuevas a la mitad al −10 %), el 1 % da un 6,5 %
anual con una caída máxima del 21,5 %, y el 1,5 % ya no rinde más (6,3 %): el
tope del 10 % por activo satura y subir el riesgo solo añade caída. Por encima
del 1,5 % tampoco rinde más sin protección (el 2 % da menos que el 1,5 %). Y
un aviso: **la peor operación puede costar más que el riesgo por operación**,
porque un hueco de precio salta el stop (con el 2 %, una costó el 3,31 % del
fondo).

**Kills: −7 % en el día y −25 % desde el máximo.** Con riesgo del 1 % y la
protección, en cinco años la caída habría cruzado el −15 % y el −20 % una vez
(el bajista de 2022) y el −25 % ninguna; el peor día fue −6,39 %. Con los
kills de antes (−3,5 % y −15 %) el fondo se habría bloqueado en un bajista
normal de la cripto (hubo 3 días de −3,5 % o peor y la caída pasó una vez del
−15 %); ningún día llegó al −7 %. El kill es para cuando algo se
rompe (un bucle, datos malos, un hueco extremo); los días malos y los
bajistas los gestionan el «solo cerrar» del −2 % y la mitad de tamaño del
−10 %.

**Sin cambios:** el tope del 10 % por activo (con el 15 % o el 20 %, Momentum
pasa de Sharpe 0,72 a 0,71 y 0,70: manda su objetivo de volatilidad, no el
tope), la exposición total del 80 %, la cripto del 50 %, el «solo cerrar» del
−2 %, la mitad de tamaño al −10 %, las órdenes, la antigüedad del precio y el
desvío.

**Con la cartera de arranque de ahora** (Momentum 40 % y las otras tres al
2 %; el 54 % en efectivo) y estos límites: 6,5 % anual, Sharpe 0,72 y caída
máxima del 12,2 % sin la protección; con ella, aproximada, 5,3 %, 0,62 y
12,0 %. Es un backtest: cinco años muy alcistas para la cripto y un solo
bajista.

**Stops:** cada operación nace con stop. Los vigila el propio sistema cada
minuto, porque Alpaca no tiene órdenes stop simples para cripto. **Con el
ordenador apagado no hay stops**, y el panel lo avisa siempre. Si esto va a
estar encendido meses, lo sensato es un servidor pequeño siempre encendido.

**Kill switch:** cancela todas las órdenes, cierra todas las posiciones y deja
el fondo **bloqueado**. Si el proceso se reinicia, arranca bloqueado. Solo se
reabre escribiendo REABRIR, y solo si las posiciones cuadran con el bróker.
También cierra la cartera sombra «mismas mesas sin comité», al mismo precio al
que vendió el fondo (ver abajo por qué).

**El bróker es la verdad.** Cada minuto el Controller compara las posiciones
del sistema con las de Alpaca. Si difieren por la comisión que Alpaca cobra en
la propia moneda, lo ajusta. Si difieren de verdad, avisa, y a la tercera
seguida pausa el fondo.

**Registro de incidentes.** Cada kill switch, conciliación grave, orden
duplicada u orden huérfana y cada error dentro de un departamento se apunta
una vez en `data/incidentes.jsonl`, que solo crece. Es la prueba de que el
sistema funciona técnicamente, uno de los criterios para pensar en dinero real
(`05-paso-a-real.md`).

**Órdenes que no se repiten.** Cada orden lleva un identificador fijo
(mesa, activo, vela, acción). Antes de enviarla se apunta la intención. Si se
corta la red a mitad, al volver se pregunta a Alpaca si esa orden existe antes
de reenviarla.

## Cómo mejora (y por qué despacio)

Mejorar **no** es que el P&L de esta semana suba. Es que el Sharpe de 90 días
del fondo suba frente a sus carteras sombra, con todos los costes.

**Qué mide «mismas mesas sin comité».** Si el comité aporta algo. Por eso esa
sombra es el mismo fondo sin las decisiones del comité, y sufre todo lo demás
igual que el fondo:

| Le llega a la sombra | No le llega |
|---|---|
| Las mismas mesas, pesos, señales y stops, con comisión y deslizamiento | El modo DEFENSIVO del comité (capital de mesa a la mitad) |
| Los límites duros sobre su propia cartera, y la caída desde su máximo | El modo SOLO_CERRAR del comité |
| El nivel del fondo real: solo cerrar por la pérdida del día, pausa, bloqueo | Los multiplicadores por mesa del comité (×0, ×0,5) |
| El kill switch: cierra todo a la vez, al precio al que vendió el fondo | Los vetos de 24 h del comité |
| El Megáfono: solo cerrar, pausas de activo o de mesa, reducción de riesgo | |
| Los vetos por noticias graves | |

Así, la diferencia «fondo − sin comité» es lo que hizo el comité, y no se le
carga lo que hicieron el kill, las pausas, el vigilante o el Megáfono. Antes la
sombra no sufría nada de eso: tras la demo de 60 días (semilla 42), cuyo final
fuerza un kill, las dos curvas coincidían hasta el kill y luego el panel decía
que el comité restaba 555 $, cuando lo que restaba era el kill.

Hay cuatro mecanismos de mejora, todos con reglas fijadas de antemano:

1. **Reparto mensual del capital** (día 1 de cada mes). Cada mesa parte de un
   peso por paridad de riesgo y se inclina según su Sharpe, pero contraído:
   `Sharpe × n / (n + 30)`, con n = operaciones. Con 10 operaciones, un Sharpe
   de 2 cuenta como 0,5. Ninguna mesa cambia de peso con menos de 20
   operaciones o 60 días. Suelo del 5 % y techo del 40 %; el cambio se suaviza
   (70 % peso anterior, 30 % nuevo). Lo que no cabe queda en efectivo: al
   arrancar, con Momentum como única titular (40 %) y las demás en prueba al
   2 %, el 54 % sin claves. Mejor efectivo que capital en estrategias que no
   han probado ventaja.
2. **Despidos.** Si una mesa tiene un Sharpe ajustado por debajo de −0,5 con
   40 o más operaciones, o cae más del 25 %, pasa al banquillo: capital 0,
   cierra sus posiciones y no abre nada nuevo, tampoco en la sombra «mismas
   mesas sin comité» (con peso 0 no tiene capital). Lo que tuviera abierto en
   sombra solo se cierra por su regla.
3. **Contrataciones por el laboratorio** (los lunes). Como mucho 3 hipótesis
   por semana, siempre dentro de una lista cerrada: familia de estrategia,
   parámetros de una rejilla y filtros de un catálogo. El LLM no se inventa
   estrategias. Cada hipótesis pasa un walk-forward (18 meses para ajustar,
   6 para probar, repetido) con costes, y tiene que cumplir **todo**:
   - Sharpe fuera de muestra de 0,6 o más.
   - 3 de cada 4 ventanas en positivo.
   - Sharpe deflactado de 0,90 o más, contando todas las hipótesis probadas
     hasta la fecha.
   - 30 operaciones o más.
   - Caída como mucho 1,5 veces la de la mesa vigente de la misma familia en
     el mismo tramo, o 1,5 veces la de comprar y mantener si no hay mesa de
     esa familia.
   - Correlación menor de 0,7 con las mesas que ya hay.

   Una hipótesis con el mismo contenido (familia, vela, activos, parámetros y
   filtros) no se vuelve a probar en 90 días, aunque cambie la semana: cada
   repetición sumaría ensayos al Sharpe deflactado.

   Si aprueba, entra en **incubación** con el 2 % durante 60 días. Solo asciende
   si en papel gana dinero (Sharpe > 0) y no va mucho peor que en su backtest,
   con al menos 10 operaciones. Una mesa lenta, como Ruptura (2–3 operaciones
   cada 60 días), sigue incubando hasta 180 días antes de juzgarla.
4. **Lecciones.** El auditor clasifica cada operación cerrada. Si una causa se
   repite 5 veces en 30 días en una mesa, se convierte en una hipótesis concreta.
   Las operaciones cerradas por el kill switch, a mano o en la orden de prueba
   no cuentan: no las cerró la regla de la mesa.
   Por ejemplo, «contra régimen» se convierte en «probar la mesa con el filtro
   de no abrir en RISK-OFF», que pasa por el laboratorio como cualquier otra.
   Las lecciones nunca cambian un parámetro directamente.

**Alarma de deriva:** si una mesa va en papel una desviación típica por debajo
de lo que prometía su backtest durante 30 días, se avisa. Suele ser señal de
sobreajuste.

Consecuencia honesta: con velas de 4 horas y de 1 día hay pocas operaciones.
Durante los primeros meses el reparto apenas se moverá. Es lo correcto, pero
decepciona. La demo acelerada (`npm run demo`) sirve para ver los mecanismos
funcionando en minutos.

# Riesgo y cómo se mejora solo

## Límites duros

Viven en `src/config.js` (`LIMITES_DUROS`). **Son una propuesta razonada, no
una decisión tuya todavía**: revísalos. Ni el comité ni el Megáfono pueden
aflojarlos; solo apretarlos, y lo que aprietan caduca.

| Límite | Valor | Qué pasa |
|---|---|---|
| Peso por activo | 10 % del patrimonio | La orden se recorta |
| Exposición total | 80 % | Se recorta: siempre queda un 20 % en efectivo |
| Exposición cripto | 50 % | Se recorta: las cripto se mueven juntas |
| Riesgo por operación | 0,5 % | El tamaño se ajusta para que, si salta el stop, se pierda como mucho eso |
| Posiciones abiertas | 12 | No se abren más |
| Pérdida del día −2 % | — | Solo cerrar hasta las 00:00 UTC |
| Pérdida del día −3,5 % | — | **Kill switch** automático |
| Caída desde el máximo −10 % | — | Posiciones nuevas a la mitad |
| Caída desde el máximo −15 % | — | **Kill switch** automático |
| Órdenes | 10 por minuto, 4 por mesa y hora | Protege de un bucle |
| Orden mínima | 10 $ | Por debajo, la comisión se come la operación |
| Precio viejo | 15 min cripto, 2 min acciones | No se abre con un precio caducado |
| Desvío de precio | 2 % | Si el precio se ha movido más desde la decisión, se vuelve a decidir |

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
   (70 % peso anterior, 30 % nuevo).
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
   si en papel no va mucho peor que en su backtest.
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

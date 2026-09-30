# Paso a dinero real: cuándo y cómo

Resumen: el fondo **no pasa solo a dinero real, nunca**. En Resultados, arriba
del todo, hay un semáforo, **«¿Listo para dinero real?»**, que se calcula solo
con los datos del fondo y dice qué criterios cumple y cuáles no. Aunque se
ponga todo en verde, no cambia nada: el código sigue operando solo en papel.

Los criterios se fijaron el 30 de septiembre de 2026 (Eduardo lo delegó en el
director) y están en `src/aprendizaje/paso-a-real.js`.

## Los siete criterios (tienen que cumplirse todos)

| | Criterio | Umbral | Por qué |
|---|---|---|---|
| a | Días en papel desde que arrancó el fondo | 180 o más | Seis meses es el mínimo que proponen las fuentes (mejor doce; `03-viabilidad.md`). Con menos, el resultado es sobre todo suerte: con un año de datos el Sharpe aún tiene un margen de error de ±1 |
| b | Operaciones cerradas del fondo (sin la orden de prueba) | 100 o más | Con pocas operaciones, el resultado depende de dos o tres. Es el umbral que proponen las mismas fuentes |
| c | Sharpe anualizado del fondo desde el arranque, con retornos diarios | 0,7 o más | Es el nivel del backtest: la cartera de arranque de ahora (Momentum 40 % y el resto en prueba) dio Sharpe 0,72 en cinco años de velas reales sin la protección del ×0,5, y 0,62 con ella (aproximada; `node scripts/estudiar-limites.js`, tabla 5). El listón está, por tanto, algo por encima de lo que promete el backtest con la protección: pide que el papel no rinda peor que el estudio |
| d | Ese Sharpe frente a comprar y mantener BTC y la cesta cripto en el mismo periodo (con claves de Alpaca, también SPY) | Igual o mejor que el mejor de ellos | Si comprar y mantener rinde más por cada unidad de riesgo, el fondo sobra: bastaría con comprar y esperar |
| e | Caída máxima del fondo desde su máximo | 20 % o menos | El kill salta a −25 %. Un fondo que en papel ya ha caído más de un 20 % está demasiado cerca de él. En el backtest, la cartera de arranque no pasó del 12,2 % |
| f | Incidentes en los últimos 90 días | Ninguno, y el registro cubriendo los 90 días | Antes de meter dinero, el sistema tiene que funcionar técnicamente: sin kill switch, sin descuadres con el bróker, sin órdenes duplicadas o huérfanas y sin errores en los departamentos |
| g | Gasto acumulado en IA frente al beneficio neto del fondo | Menos del 10 % | La IA tiene que pagarse. Si el fondo no gana, cualquier gasto en IA es demasiado (solo pasa si el gasto es cero) |

Además, **una nota del comité, que no bloquea**: si el fondo no bate a su
cartera sombra «mismas mesas sin comité», la recomendación es pasar a real
**sin comité**, con la IA apagada. El comité solo tiene sentido si aporta.

### Cómo se mide cada cifra

- El Sharpe y la caída del fondo se miden con la **penalización de papel**
  (0,1 % por lado en cada operación), igual que las mesas: la cuenta paper
  llena mejor que la realidad. Comprar y mantener ya la pagó al comprar.
- La caída máxima es la peor de dos: la de la curva diaria y la que se ve
  latido a latido (cada minuto), que se guarda en el estado del fondo.
- Hacen falta 30 días de curva para dar un Sharpe; antes, el criterio c
  enseña «—» y dice cuántos días faltan.
- Los incidentes están en `data/incidentes.jsonl`. Ese fichero **solo crece**:
  no se borra ni se edita, porque es la prueba del criterio f. Cuenta como
  incidente:
  - el kill switch, lo pulse un humano o lo dispare el vigilante;
  - una conciliación grave: los libros y el bróker no cuadran y no es la
    comisión, o el sistema cree tener una posición que el bróker no tiene;
  - una orden huérfana: una posición del bróker que ningún puesto conoce, o
    una orden que el bróker aceptó y luego dice no conocer;
  - una orden duplicada: el bróker ya tenía otra orden con el mismo
    identificador;
  - un error dentro de un departamento (una vez por error y hora). **También
    cuenta un error de red**: con el portátil que se duerme o pierde la wifi,
    es difícil pasar 90 días sin ninguno. Para esto sirve un servidor pequeño
    siempre encendido.
- Si el fondo ya existía antes de que hubiera registro de incidentes, el
  registro empieza el primer día que arranca con él, y el criterio f no se
  da por bueno hasta que cubre 90 días: no se puede afirmar que no hubo
  incidentes en días que no se apuntaron.
- El gasto en IA es todo lo apuntado en `data/llm-costes.jsonl`; el beneficio
  neto, el patrimonio de ahora menos el capital con el que arrancó.
- `data/` es la memoria del fondo. Borrarla es empezar de cero: los 180 días y
  los 90 sin incidentes vuelven a contar desde el principio.

### Qué tardará en ponerse en verde

Unos criterios dependen del tiempo y otros del mercado. El b puede tardar más
que el a: en el backtest real, Momentum cerró 102 operaciones en algo más de
cinco años y medio (`node scripts/probar-backtest.js --real`), unas 18 al año.
La mayoría de las operaciones del fondo las harán las mesas en prueba, sobre
todo Tendencia (539 en el mismo periodo); si el asignador las descarta a los
60 días, llegar a 100 operaciones puede llevar años.

## Qué pasa si se cumplen todos

Nada automático. El semáforo solo informa. Para pasar a real:

1. **Decisión escrita de Eduardo.** Ninguna sesión de Claude lo decide.
2. **Un cambio deliberado de código.** Hoy el programa no conoce la dirección
   de la cuenta real de Alpaca y se niega a arrancar con otra que no sea la de
   paper. Cambiarlo es un trabajo aparte, con sus pruebas.
3. **Primer tramo pequeño:** una cantidad que se pueda perder entera. La
   propuesta es **como mucho 2.000 €**.
4. **Tres meses comparando** cada ejecución real con la que habría hecho el
   papel: precio, comisión y deslizamiento. Si difieren, se para y se revisa.
5. Si la nota del comité dice que no aporta, el paso a real se hace **sin
   comité** (la IA apagada).

Si después un criterio vuelve a rojo (por ejemplo, un kill), el semáforo lo
enseña en el acto: un incidente reinicia la cuenta de 90 días.

## Dónde se ve

- En el panel: botón **Resultados**, primer bloque. Cada criterio con ✓ o ✗,
  su valor, su umbral y una línea que explica la cifra.
- En la instantánea (`GET /api/estado`), campo `listoParaReal`
  (`docs/ARQUITECTURA.md` §7).

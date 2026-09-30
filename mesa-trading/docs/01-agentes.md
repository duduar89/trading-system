# Los agentes y los departamentos

Una regla lo ordena todo: **los agentes hablan, el código decide los números.**
Cada agente es un trozo de código con una tarea concreta y una voz. La voz es
una frase hecha a partir de los datos o, si hay clave de Claude, un texto que
redacta la IA y que se comprueba antes de enseñarlo: si cita una cifra que no
estaba en los datos, se tira y sale la frase hecha. Lo que se compra, cuánto,
dónde va el stop y cuándo se para todo lo decide código determinista, con
pruebas de casos conocidos.

Hay 27 agentes sin claves de Alpaca: 13 fijos y 14 operadores de puesto. Con
claves hay más (analistas y operadores de ETF).

## Departamentos

| Departamento | Agente | Qué decide de verdad | ¿Usa Claude? | Cuándo |
|---|---|---|---|---|
| **Dirección** | Carmen Aguirre, presidenta del comité | Modo del fondo (NORMAL, DEFENSIVO o SOLO_CERRAR), multiplicadores por mesa de solo {0; 0,5; 1} y vetos de 24 h a un activo. Nunca toca los límites duros. | Sí, una llamada por comité | Cada 4 h y cuando pulsas «Comité» |
| **Macro** | Tomás Herrera, estratega macro | Régimen RISK-ON, NEUTRAL o RISK-OFF por regla fija: BTC frente a sus medias de 50 y 200 días, su volatilidad y, con claves, SPY. En RISK-OFF vota DEFENSIVO. | No | Cada hora |
| **Análisis** | Un analista por activo | Nota técnica (sesgo, SMA50, RSI, volatilidad). Con claves, clasifica los titulares de noticias; un evento grave (hackeo, exclusión, regulación seria) bloquea las aperturas en ese activo 24 h. | Sí, solo para noticias | Cada vela de 1 h; noticias cada 4 h |
| **Mesas (el parqué)** | Un operador por puesto (mesa × activo) | Aplica su estrategia al cierre de cada vela y propone comprar, mantener o cerrar, con stop. | No | Al cierre de su vela (4 h o 1 día) |
| **Riesgos** | Marta Solís, jefa de riesgos | Aprueba, recorta o veta cada orden contra los límites duros. En el comité su voto DEFENSIVO es veto. | No | Cada orden y cada latido |
| **Operaciones** | Raúl Campos, ejecutor | Envía las órdenes aprobadas, espera a que se ejecuten y nunca repite una orden ya enviada. | No | Cada orden |
| | Inés Ferrer, controller | Patrimonio, P&L, caída, exposición y conciliación con el bróker. | No | Cada latido (1 min) |
| **Laboratorio** | Álvaro Medina, director de laboratorio | Qué variantes se prueban (solo dentro de una lista cerrada) y si pasan las pruebas para entrar en incubación. | No | Cada lunes |
| | Julián Prieto, auditor post-mortem | Clasifica cada operación cerrada (señal falsa, stop estrecho, contra régimen, noticia, ejecución, acierto de libro, suerte) y escribe la lección. Si una categoría se repite 5 veces en 30 días en una mesa, abre una hipótesis en el laboratorio. | Sí, en lote diario | Cada día |

Con clave de Claude, el comité decide con **Claude Opus 5.5**; los demás que
usan IA (noticias, lecciones, Megáfono) solo redactan o clasifican con listas
cerradas y van con **Claude Haiku 4.5**, que cuesta la cuarta parte por token.
Tope de gasto: **1 $ al día** (se cambia en Ajustes o en el `.env`).

## Las mesas (estrategias)

| Mesa | Estrategia | Vela | Activos | Estado inicial | Por qué |
|---|---|---|---|---|---|
| Momentum cripto | Cada lunes compra las 2 cripto con mejor rentabilidad de 28 días ajustada por volatilidad, solo si suben | 1 día | BTC, ETH, SOL, LINK, AVAX, DOGE | **Titular (40 %), la única** | Backtest real 2021-2026 con costes y riesgo del 1 %: Sharpe 0,91 frente a 0,63 de comprar y mantener, con menos de la mitad de su caída (40 % frente a 95 %) |
| Ruptura Donchian | Compra al romper el máximo de 20 días, vende al perder el mínimo de 10 | 1 día | BTC, ETH, SOL | **Incubación (2 %)** | Sola, Sharpe 0,65, justo por debajo del 0,66 de comprar y mantener. En el fondo no diversifica: su correlación diaria con Momentum es 0,80 y juntas dan Sharpe 0,58 y caída 26,0 %, frente a 0,72 y 11,2 % de Momentum sola |
| Tendencia SMA | SMA 7 > SMA 25 con el precio sobre la SMA 200 (la del vídeo) | 4 horas | BTC, ETH, SOL | **Incubación (2 %)** | Pierde con costes: Sharpe −0,53; en 539 operaciones se deja en comisiones 4.423 $ de cada 10.000 $ |
| Reversión RSI | Compra caídas extremas (RSI(2) < 10) en tendencia alcista | 1 día | BTC, ETH | **Incubación (2 %)** | Pierde con costes: Sharpe −0,36 |
| Momentum ETF (con claves) | Rotación mensual entre SPY, QQQ, IWM, TLT, GLD y DIA | 1 día | ETF | **Incubación (2 %)** | Suspendió el filtro con 10 años de datos reales (30-sep-2026): Sharpe fuera de muestra 0,19 (mín. 0,6), 69 % de ventanas en positivo, deflactado 0,48; 2,1 %/año con como mucho el 20 % invertido frente a 13,3 % de comprar y mantener, con todo invertido. Sigue en prueba por decisión de Eduardo, para verla en vivo |
| Reversión ETF (con claves) | RSI(2) en SPY y QQQ | 1 día | ETF | **Incubación (2 %)** | Su cartera (SPY y QQQ) aún no se ha estudiado. El estudio del 30-sep-2026 fue de otra más grande (SPY, QQQ, IWM y DIA) y suspendió: Sharpe fuera de muestra 0,33, 56 % de ventanas en positivo, deflactado 0,59 (sin los ensayos del estudio anterior: puede ser más bajo); 0,3 %/año con como mucho el 40 % invertido frente a 15,3 %. Sigue en prueba por decisión de Eduardo, para verla en vivo |

Así arrancó el fondo el 30 de septiembre de 2026 (decisión de Eduardo,
delegada en el director). Las cifras salen de `node scripts/probar-backtest.js
--real` y `node scripts/estudiar-limites.js`. Una mesa en incubación opera de
verdad con el 2 % y puede ascender a titular por la regla del asignador
(`04-riesgo-y-mejora.md`). El capital que no se reparte queda en efectivo: el
54 % sin claves.

Además hay **carteras sombra**, que no operan: solo miden. Son comprar y
mantener BTC, la cesta de las 6 cripto y, con claves, SPY y 50/50 BTC-SPY. La
más importante es **«mismas mesas sin comité»**: las mismas estrategias sin
las decisiones del comité, y con todo lo demás igual que el fondo (límites,
pausas, kill, Megáfono y noticias; detalle en `04-riesgo-y-mejora.md`). Si el
fondo con comité no la supera, el comité no está aportando nada y el panel lo
dice.

## Cómo se hablan

Todo pasa por un bus de mensajes. Cada mensaje lleva unos **datos**, que son lo
que leen los demás agentes, y un **texto**, que es lo que lees tú en el panel.

Así viaja una operación:

```
cierra la vela de 4 h
 → Operador BTC de Tendencia: «SMA7 84.120 > SMA25 83.900 y cierre sobre SMA200: abro»   (señal)
 → tamaño con límites: 3.000 $ con stop a 80.500                                         (propuesta)
 → Marta Solís (Riesgos): «BTC pasaría a 12 % del patrimonio; máximo 10 %. Recorto a 2.000 $»   (aprobación con recorte)
 → Raúl Campos (Ejecutor): orden enviada con un identificador que impide repetirla       (orden)
 → Alpaca/simulado: ejecutada a 84.150                                                   (ejecución)
 → Inés Ferrer (Controller): cuadra la posición con el bróker                            (conciliación)
 → al cerrar: Julián Prieto (Auditor) la clasifica y escribe la lección                  (lección)
```

El comité se reúne cada 4 horas con un orden del día fijo:

1. Controller: cifras.
2. Macro: régimen.
3. Riesgos: límites y vetos.
4. Mesas: la mejor y la peor.
5. Laboratorio.
6. Megáfono pendiente.
7. Decisión de la presidenta.

Durante el comité, los jefes se levantan y van a la sala de reuniones.

## El Megáfono

Escribes una orden en castellano («pausa SOL 6 horas», «reduce el riesgo a la
mitad», «solo cerrar hasta mañana»). Claude, o unas palabras clave si no hay
clave, la traduce a una directiva de una **lista cerrada**. El panel te enseña
la propuesta y solo entra si pulsas «Aplicar». Las directivas solo pueden
apretar (reducir, pausar, cerrar), nunca aflojar un límite, y caducan solas.

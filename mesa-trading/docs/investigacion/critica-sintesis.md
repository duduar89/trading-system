# Crítica jefe — síntesis de las cuatro propuestas (29-sep-2026)

Cruce de las propuestas «Rigor cuantitativo», «Riesgo y operaciones», «Sociedad
de agentes» y «Réplica visual» con la ficha de Alpaca y el informe del escéptico.

## 1. Contradicciones y qué se eligió

| Tema | Elección |
|---|---|
| Tamaño máx. por posición | 10 % nocional y riesgo por operación 0,5 % del patrimonio |
| Exposición bruta | 80 %: el 20 % en efectivo absorbe comisiones y evita rozar margen |
| Pérdida diaria | −2 % solo cerrar, −3,5 % kill switch |
| Caída desde máximo | −10 % posiciones nuevas a la mitad, −15 % kill switch (fondo); > 25 % despido (mesa) |
| Reasignación de capital | Mensual para los pesos base, con muestra mínima 20 operaciones / 60 días. El comité de 4 h solo aplica multiplicadores discretos {0, 0,5, 1} temporales. Se quita el 1,25 (aumentaría riesgo) |
| Sesgo del analista | No toca señales (sería doble conteo con las reglas técnicas). Solo un flag de evento grave de noticias bloquea aperturas 24 h |
| Megáfono | Lista cerrada de directivas, confirmación humana, solo aprieta |
| Stops cripto | En software (trailing). Aviso en pantalla: con el portátil apagado no hay stops |
| Stops acciones | En software también, por uniformidad (las fraccionarias solo admiten TIF day) |
| Mesas vs activo | Una mesa = una familia de estrategia (unidad de capital y aprendizaje); un puesto visual por activo |
| Timeframe mínimo | 1 hora |
| Conciliación | Cada 60 s; empuje a la interfaz cada 2 s |

## 2. Lo que la ficha de Alpaca desmiente o matiza

1. Bracket/OCO/OTO no existen en cripto.
2. `notional` solo con `market`; en acciones solo TIF `day`; en cripto `gtc`/`ioc`.
3. Fraccionarias: TIF solo `day`.
4. Comisión cripto cobrada en el activo recibido: la cantidad comprada no es la pedida. La conciliación usa la cantidad de la posición, no `filled_qty`.
5. Posiciones cripto sin barra (`BTCUSD`) frente a órdenes con barra.
6. `limit` en peticiones multi-símbolo es total: un símbolo por petición.
7. `4Hour` es un timeframe nativo.
8. Para vender se usa `qty_available`.
9. Acciones gratis solo con `feed=iex`.

## 3. Las diez ideas que entran sí o sí

1. El LLM habla, el código decide los números. Todo JSON de LLM se valida contra esquema; si falla, plan por defecto.
2. Límites duros en fichero, solo apretables.
3. Idempotencia: `client_order_id` determinista + registro de intención antes de enviar + consulta por `client_order_id` tras timeout.
4. El bróker es la verdad: conciliación cada 60 s.
5. Carteras sombra (100 % BTC, cesta cripto, SPY, 50/50) y «mismas mesas sin comité».
6. Walk-forward con costes y ejecución en la apertura de la vela siguiente, rejilla ≤ 30, Sharpe deflactado con contador de hipótesis.
7. Contracción n/(n+30) y muestra mínima 20 operaciones / 60 días.
8. Incubación: 2 % del presupuesto durante 60 días.
9. Arranque en frío seguro: si estaba bloqueado, arranca bloqueado.
10. Penalización artificial de papel de 0,1 % por lado al medir.

## 4. Lo que se tiró

1. Multiplicador 1,25 del comité.
2. Post-mortem LLM por cada operación → lote diario.
3. Secretario como agente separado.
4. Personajes que se van a descansar por tiempo → solo cuando no tienen trabajo.
5. Stop de tiempo sin validar.

## 5. Mecanismo de mejora medible

Mejora = el Sharpe rodante de 90 días del fondo sube frente a sus carteras
sombra, con costes incluidos. Reparto mensual con contracción; entrada de
estrategias solo por gramática cerrada, walk-forward, DSR e incubación; salida
por Sharpe ajustado < −0,5 con ≥ 40 operaciones o caída propia > 25 %;
alarma de deriva cuando el papel va 1 σ por debajo del backtest 30 días;
informe semanal con coste del LLM frente a P&L.

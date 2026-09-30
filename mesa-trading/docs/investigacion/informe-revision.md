confirmados 68 { media: 27, baja: 40, alta: 1 }

##### GRUPO web | arreglados: 17 | fuera: 9
PRUEBAS: Resultados:
- node --test test/parque-*.test.js: 60 de 60 (antes eran 33).
- node scripts/probar-parque.js: todos los casos OK, incluidos 10 casos conocidos nuevos en la sección 8.
- npm test completo: 453 de 453.
- test/integracion-servidor.test.js (forma de la maqueta frente a la instantánea real): 9 de 9 con el src actual.

Todas las pruebas nuevas fallan contra una copia intacta de web/ (scratchpad/revision/web/antes):
- parque-cifras: 11 fallan.
- parque-mapa: 2 fallan.
- parque-dibujo, fichero nuevo con un lienzo falso que apunta cada fillText: 8 fallan.
- parque-maqueta: 3 fallan.
- parque-paneles, fichero nuevo: 5 fallan.

Comprobaciones en Chromium, scripts en /tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/revision/web/:
- v1-maqueta.js (escritorio, anchos de 768 a 1300 y móvil de 360 y 390): Resultados, ficha de mesa, solo cerrar del Megáfono, foco estable, teclado, anchos de la botonera, píldora PAUSADO, Kill y Pausar a la vista, Tab que no se escapa de la ficha y ningún inert al cerrar. Todo OK.
- v2-conexion.js (servidor falso falso.js): falta el token, token que no vale, SSE a 503 y datos parados con ping. Todo OK.
- v3-parque.js: 7 y 16 mesas. Con 7 no chocan los rótulos y se ven los 7 a partir de zoom 0,8. Con 16 se ven 11 a zoom 1 y el resto al acercar.
- v4-pantalla.js: capturas de la pantalla gigante con 14 cotizaciones y de los relojes y ventanas.
- v5-real.js: contra node src/index.js --modo=sintetico ×600, en 1440 y 390, sin errores de consola. Los dos únicos FALLO de la tanda son de mi comprobación: esperaba la nota con Sharpe −0,51 y el src de ahora dice −0,52 (la corregí después). El «sin asignar 16 %», la ficha de mesa y los separadores del feed salen bien.

Capturas en scratchpad/capturas/arreglo-web-*.png.
NOTAS: Solo he tocado web/**, test/parque-*.test.js (con dos ficheros nuevos, parque-dibujo y parque-paneles) y scripts/probar-parque.js. No he hecho nada de git.

La lógica que se puede probar sin navegador está en cifras.js: nivelEfectivo, bloqueosPuesto, bloqueosMesa, sinAsignar, precioViejo, rotuloMesa, datosParados, momento, dia y hace. Así la barra, el lienzo y la ficha no pueden contar cosas distintas.

La maqueta usa ahora los pesos del arranque real (2/40/2/40) en lugar de 30/30/20/20, para que se vean la incubación y el 16 % sin asignar. Ninguna prueba dependía de esos pesos.

Dos cosas de diseño que conviene saber:
- Con 16 mesas no caben todos los rótulos a zoom 1: en lugar de pintarlos unos encima de otros, se omiten los que pisarían algo hasta que se acerca la cámara. El revisor ya dejaba como decisión de negocio qué hacer por encima de unas 12 mesas (tope de mesas vivas o sacar las del banquillo del parqué).
- Andar más rápido en sintético acelerado es un arreglo del lado de la interfaz. No cambia las pausas del comité en src/agentes/comite.js.

Al comprobar maté mis propios procesos de prueba: el servidor sintético en 18890 y los falsos en 18870 a 18885. No queda ningún proceso ni ningún dato mío dentro del proyecto; las carpetas de datos están en el scratchpad.
FUERA: ["src/util/formato.js: la misma regla del cero sin signo en agrupar, usd y pct. Hasta que esté, test/parque-cifras.test.js compara con formato.js quitando el signo a un cero redondeado (sinSignoEnCero); cuando se arregle, esa función ya no hará nada.","src/orquestador.js instantanea(): añadir avisos de «pausado» y «solo_cerrar hasta…» delante de los demás (hallazgo del móvil, punto 2) y, si se quiere, uno por cada directiva que bloquee aperturas (hallazgo del solo cerrar, punto 5). En _cmdReabrir, decir que el solo cerrar del Megáfono o del comité sigue vigente (punto 4).","src/agentes/plantillas.js directiva(d, mesas) y decisionComite: nombres de mesa en vez de ids. Hay que pasar las mesas desde megafono.explicar (megafono.js:371), orquestador.js:906 y megafono.js:108. La interfaz ya resuelve el nombre en la propuesta que enseña.","El P&L de la última vela en la ficha es del servidor: estadoTexto en vivo en instantanea() (orquestador.js:739), guardar el texto del cierre en registrarOperacion y que mesas.js textoPuesto use valoracion.porPuesto. En web no hay nada que tocar.","src/orquestador.js _actualizarPrecios: apuntar en historialPrecios solo cuando cambia q.t, para que var24hPct no se mueva con un precio congelado. Del hallazgo de la red caída también quedan fuera AlpacaDatos.ultimos (timeouts más cortos) y el aviso «Sin precios nuevos desde…» en instantanea().","Grupo nucleo, §7 de ARQUITECTURA.md: la maqueta ya lleva mesas[].nota. La interfaz no necesita ningún campo n

##### GRUPO cuant | arreglados: 7 | fuera: 13
PRUEBAS: Pruebas del grupo: node --test test/cuant-*.test.js da 108 de 108 (antes había 91). La suite completa, node --test test/*.test.js, da 438 de 438.

Pruebas nuevas, y cuántas fallan con el código de antes. Lo comprobé con scratchpad/revision/cuant/antes.sh, que las corre sobre copias intactas de mis ficheros:
- test/cuant-motor.test.js: +6, las 6 fallan antes. Cubren: la orden no se llena tras el hueco; venta 'hueco' al cierre previo con cuadre Σ pnl = final − capital; recalentamiento, también con 'desde' dentro de él; ruptura sin comprar a la apertura rancia y sin posiciones que crucen el hueco, con la causalidad intacta; comprar y mantener que vuelve a entrar en la segunda vela; contexto de ETF pedido a las 16:00 ET y cripto en t + 1 día.
- test/cuant-estrategias.test.js: +5, las 5 fallan antes. Cubren: cruce saltado, lunes saltado, primera sesión del mes saltada, puntuación de momentum tras un hueco y umbralHueco (el puente de Viernes Santo no cuenta como hueco).
- test/cuant-regimen.test.js: +1, falla antes. SPY cerrada a las 16:00 ET y a las 13:00 en cierre temprano, y vista por una decisión de las 00:00Z.
- test/cuant-laboratorio.test.js: +5, las 5 fallan antes. Cubren: firmaHipotesis; nada repetido en 90 días (y sí pasado ese plazo), con aprobadas con firma y mesas contratadas bloqueando; lección y exploración nunca iguales en 120 semanas; DSR con sharpesPrevios (0,45 → ~0); maxDDReferencia como función del tramo. Una prueba existente se actualizó: fuenteReferencia.

Comprobaciones aparte, en scratchpad/revision/cuant/:
- scripts/probar-backtest.js y probar-indicadores.js: todos OK.
- demo-acelerada de 30 días: todas las invariantes OK.
- causalidad-futuro.js: OK.
- vivo-vs-backtest.js: 0 de 1.188 decisiones distintas.
- Scripts del revisor hueco-sol*.js: sin operaciones de SOL a través del hueco y sin salto de la curva.
- etf-contexto.js: el contexto se pide a las 20:00Z y usa la BTC ya cerrada.
- choque-semana.js: 8/120 → 0.
- duplicado-llamador.js: con el llamador pasando previas no hay contratación duplicada.
- cruce-saltado.js y lunes-saltado.js con mixto/: 0 entradas perdidas y la cartera igual a la de control.

No he tocado git ni ningún fichero fuera de mi lista.
NOTAS: Ficheros modificados:
- /home/user/trading-system/mesa-trading/src/backtest/motor.js
- src/mercado/regimen.js
- src/estrategias/comun.js (umbralHueco, reanudaciones, ultimaReanudacion, velasMemoria)
- src/estrategias/index.js (velasNecesarias reutiliza velasMemoria; los resultados son idénticos en las 6 mesas)
- src/estrategias/tendencia-sma.js
- src/estrategias/momentum-rotacion.js
- src/cuant/laboratorio.js
- test/cuant-motor.test.js, test/cuant-estrategias.test.js, test/cuant-regimen.test.js, test/cuant-laboratorio.test.js

Decisiones que he tomado y conviene que conozca el director:

1. Recalentamiento tras un hueco. Uso la opción estricta del hallazgo, calentamiento + 15·ATR, que es el criterio de velasNecesarias. En ruptura 1D son 321 velas. La otra opción, solo el calentamiento, deja un ATR inflado por la vela rancia (su rango verdadero es de unos 141 $). La ventana de la puntuación de momentum es la misma, para que un símbolo que el motor no deja decidir tampoco ocupe un puesto del top. Esto sube momentum real de +110,2 % / Sharpe 0,79 a +120,2 % / 0,83.

2. Comprar y mantener, tras un hueco, vuelve a invertir en la segunda vela en vez de quedarse en efectivo. Así sigue siendo una cartera de comprar y mantener.

3. La regla nueva de la SPY en regimenEnFecha cambia el régimen del backtest también en las decisiones cripto de las 00:00Z. Ahora ven la SPY del día, como en vivo. Es menos conservador que antes, pero no mira el futuro: esa vela ya había cerrado.

4. La varianza del DSR mezcla Sharpe anualizados con 365 y con 252 si el laboratorio prueba familias cripto y de ETF. Se pasa a diaria con el periodosAnio de la hipótesis que se evalúa. Es una aproximación y lo dejo escrito.

5. En walkforward.js no he tocado tCalentado para vol-max: el hallazgo lo deja fuera del arreglo mínimo. Si se aplicara, las hipótesis 4H con vol-max se quedarían sin datos suficientes con Alpaca.

6. Las operaciones del backtest pueden llevar ahora motivoSalida 'hueco'. Nada fuera de src/cuant y src/backtest las lee, pero §4.5 del contrato solo menciona 'señal', 'stop' y 'fin'.

7. La nota de tendencia en mesasIniciales dice −0,52, y web/js/maqueta.js y los docs siguen con −0,51. El cambio es pequeño, pero conviene alinearlos (ver «fuera»). Las mesas que ya estén guardadas en estado.json conservan su nota vieja.

Durante el trabajo vi fallar la prueba de formato de parque-cifras.test.js mientras otro grupo tocaba web/js/cifras.js. En la última pasada ya pasaba: 438 de 438.
FUERA: ["src/agentes/departamentos/laboratorio.js revisionSemanal (línea 148). Pasar a generarHipotesis `previas: [...lab.hipotesis, ...lab.aprobadas], ahora`. Sin esto, la regla de los 90 días de la decisión (g) no actúa en marcha. Lo he comprobado en memoria con scratchpad/revision/cuant/duplicado-llamador.js: sin el cambio salen 4 aprobadas con 3 firmas y lab3 = lab1; con el cambio, «con-llamador», salen 3 aprobadas con 3 firmas distintas y ningún duplicado contratado.","src/agentes/departamentos/laboratorio.js evaluarPendientes, tres cambios. (1) Línea 180: pasar `sharpesPrevios: lab.sharpesEnsayos` (DSR de la decisión g). (2) Opcional: `maxDDReferencia: tramo => …` con el tramo que ya da evaluarHipotesis, en lugar de recalcularlo con tramoOOS. (3) Línea 197: guardar `firma: firmaHipotesis(entrada.h)` en cada aprobada, calculada antes de mezclar paramsFinales.","Decisión (g) + integración nº 6, operaciones cerradas por kill, manual o prueba. No deben generar pistas. El sitio es auditoria() en src/agentes/departamentos/laboratorio.js:271 (hoy solo aparta 'prueba'), o postmortem.hipotesisDesdeLecciones. Las pistas que recibe generarHipotesis no llevan motivoSalida, así que no se puede filtrar desde src/cuant.","src/agentes/departamentos/direccion.js, revisionMensual (línea 99) y contratar(). Quitar las aprobadas con la misma firma o que coincidan con una mesa viva. contratar() debe copiar h.firma a mesa.firmaHipotesis; generarHipotesis ya lo tiene en cuenta.","src/agentes/departam

##### GRUPO mercado-broker | arreglados: 12 | fuera: 15
PRUEBAS: `node --test test/mercado-*.test.js test/broker-*.test.js`: 121 de 121 (antes 102). `npm test` completo: 458 de 458. Antes de arreglar fallaban las pruebas nuevas: 13 de broker-alpaca, 3 de broker-simulado, 3 de mercado-alpaca-datos y sentimiento, y las 3 de broker-alpaca-contabilidad; estas 3 las comprobé también con el adaptador anterior sacado de git y cargado con una precarga. `node scripts/probar-broker-simulado.js`: todos los casos cuadran, incluidos el EPERM y el id repetido. `NODE_USE_ENV_PROXY=1 node scripts/probar-alpaca.js` contra Alpaca real, sin claves: todo en orden (último precio, 719 velas 1H en 5 páginas, caché). `--orden-prueba` contra el Alpaca falso: con comisión, OK con la tasa real del 0,250 %; sin comisión, FALLO bien señalado. `node scripts/demo-acelerada.js --dias=20 --datos=<mi carpeta>`: se cumplen todas las invariantes. Scripts de los revisores copiados a scratchpad/revision/mercado-broker/e2e: r3, r7, r4, r9, r5 y eperm-orden ya dan lo correcto; r1 y r2 (kill) siguen fallando, porque dependen de operaciones.js. futuro/diaria-acciones-congelada.js y verificar-futuro-3/arreglo-probado.js: las 8 diarias definitivas. Coste en cripto medido con mercado-broker/coste-cola.js: 186 peticiones al día, igual que antes.
NOTAS: Ficheros: src/broker/alpaca-broker.js, src/broker/simulado.js, src/broker/comun.js (nuevo), src/mercado/alpaca-datos.js, src/mercado/sentimiento.js, test/broker-alpaca.test.js, test/broker-simulado.test.js, test/broker-alpaca-contabilidad.test.js (nuevo), test/mercado-alpaca-datos.test.js, test/mercado-sentimiento.test.js, scripts/probar-alpaca.js y scripts/probar-broker-simulado.js. No he hecho nada de git.

- COSTES_POR_DEFECTO y aFuncion pasan a src/broker/comun.js. simulado.js reexporta COSTES_POR_DEFECTO, así que agentes/departamentos/comun.js sigue funcionando sin cambios.
- Cambian a propósito tres expectativas de test/broker-alpaca.test.js. La compra ejecutada da cantidadEjecutada neta, 0,01187025 en lugar de 0,0119, en las pruebas «timeout en el envío…» y «esperarEjecucion sondea…». Y el 422 en el primer envío ya no adopta la orden existente.
- calendario.js no necesita cambios: los arreglos de motor.js y regimen.js usan cierreSesion, diaET y msDesdeET, que ya existen. En universo.js, limitador.js y sintetico.js no hacía falta nada.
- Redondeo a 9 decimales al más cercano, como el simulado. Si Alpaca redondea hacia abajo, la conciliación escala por una diferencia de 1e-9, que es insignificante.
- Ninguno de los 14 hallazgos del verificador de integración cae en mis ficheros.
- Los scripts y datos de trabajo están en /tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/revision/mercado-broker/.
FUERA: ["src/agentes/departamentos/operaciones.js, Ejecutor._ejecutar, rama de venta: escalar el símbolo antes de vender (libros.escalarSimbolo cuando 1e-9 < |qB/qL − 1| ≤ 0,01 y no hay otra orden en vuelo). Sigue haciendo falta si paper no cobra, si cobra otra tasa (0,22 %…) o por redondeos.","operaciones.js, _aplicar: la estimación de comisión que proponía contabilidad (paso 1) ya no hace falta, porque el adaptador da la cantidad neta y la comisión como número. Si alguien la implementa, tiene que actuar SOLO cuando orden.comision no sea número; si no, se descuenta dos veces.","operaciones.js, cierreDiario: contrastar Σ broker.comisiones({desde}).importeUsd con Σ comisiones estimadas del día y alertar si difieren más de un 5 % o si CFEE sale vacío con estimaciones > 0.","src/cartera/benchmarks.js:18: tomar la tasa de COSTES_POR_DEFECTO (src/broker/comun.js; simulado.js la reexporta) en vez de duplicarla.","Comentarios que han quedado viejos: src/cartera/libros.js:169-170 («Alpaca da la comisión como null…») y src/cartera/conciliacion.js:6-8.","operaciones.js, killSwitch: no barrer con cerrarTodo() mientras haya una venta 'kill' de acciones pendiente; hacer una segunda pasada por el Ejecutor. Si se mantiene el barrido, registrar las `ordenes` que ahora devuelve cerrarTodo (INTENCION/ENVIADA + ordenesEnVuelo con reparto). r1 (kill de noche con SPY) y r2 (venta del kill a medias) siguen fallando hasta entonces.","operaciones.js, _resolver: cancelar con broker.cancelarOrden(orden.id) u

##### GRUPO agentes-llm | arreglados: 14 | fuera: 10
PRUEBAS: - `node --test test/agentes-*.test.js`: 77 de 77 (antes 60).
- Todas las pruebas nuevas o cambiadas fallan con las fuentes originales. Lo comprobé en una copia con los src/agentes originales: 22 no ok, entre ellas signo, gastoDelDia, salvavidas, timeout, motivo del Megáfono, horasPorDefecto, nombres de mesa, despido, informe tardío, reabrir, lecciones sin doble negativo, perdedora «de suerte», pistas de kill y desde inclusivo.
- `node --test "test/*.test.js"` (npm test): 474 de 474, con el árbol que están tocando los demás grupos.
- `node scripts/probar-llm.js --sin-clave` y sin argumentos: 37 casos OK (antes 17). Los casos nuevos van sin red ni coste, con un fetch falso.
- `node scripts/probar-todo.js`: 9 de 9, con la demo de 20 días y sus invariantes en OK.
- Falsos rechazos, con el script del revisor (copia en scratchpad/revision/agentes-llm/falsos-rechazos.js): 72 comités con las plantillas como texto del LLM y el signo bien puesto. Se aceptan 432 de 432 intervenciones y 72 de 72 razones, así que el endurecimiento del signo no rechaza textos correctos.
NOTAS: Ficheros tocados:
- src/agentes/{cifras,postmortem,megafono,plantillas,llm,bus}.js
- test/agentes-{cifras,postmortem,megafono,plantillas,llm,bus}.test.js
- scripts/probar-llm.js

registro.js no cambia: ningún hallazgo cae en él. No he hecho git. Las copias originales, para comparar, están en scratchpad/revision/agentes-llm/orig.

Decisiones y avisos:
1. Reserva del salvavidas. La he aplicado para que el tope diario no se pueda pasar; es la dirección que marca el principio 3. Tiene un coste: la reserva del comité con opus-5-5 sube de unos 0,09 $ a unos 0,22 $, así que el último ~0,2 $ del día no lo puede usar el comité. La alternativa sin código es documentar el tope como blando, y eso lo decide Eduardo. Los destinos del salvavidas (opus-5 y opus-4-8, a 5/25 $) salen del código y del hallazgo, no de la documentación de la API.
2. Timeout. Se apunta como gastado reservado × 2 (con estimado:true). Con la red en «agujero», unos cuantos comités cortados pueden agotar el presupuesto del día y el LLM pasa a plantillas hasta las 00:00 UTC. Es la dirección prudente, porque no se distingue si la petición llegó.
3. Explicación del Megáfono. Seguí el hallazgo de verificarCifras, el más estricto: sin la lista de límites. El del Megáfono proponía mantenerla. Los límites sí valen para el motivo de un sin_efecto.
4. Añadidos que el arreglo propuesto no traía, los dos en la dirección prudente:
   - un entero 0-31 con signo ya no pasa gratis;
   - el post-mortem manda a reglas una lección cuyo verbo contradice el P&L.
5. decisionComite cambia de orden: «(plan por defecto)» en la cabeza, luego paradas, vetos y a la mitad. He ajustado la prueba exacta de plantillas. Ninguna prueba de integración dependía del orden.
6. gastoDelDia usa días de dinero, en tiempo real. En sintético, quien llama tiene que pasar null (ver fuera). También dejé gastoEntre(desde, hasta) para el cierre por ventana del hallazgo del apagado.
FUERA: ["src/agentes/comite.js (no es de mi grupo). (1) Hallazgo «Voto NORMAL cuando Riesgos vota DEFENSIVO»: en :239 aceptar la razón solo si !decision.vetoRiesgos y no nombra otro modo ni régimen; en :242 usar la plantilla si el texto contradice votos o régimen; en :253 añadir el voto del código salvo que el texto ya lo diga con el valor correcto. (2) Hallazgo verificarCifras, punto 3: en :242 comprobar cada intervención solo contra su punto, { hora, [agente]: entrada[agente] } más limites para riesgos. (3) Llamar a plantillas.decisionComite({...decision, fuente}, e.mesas) para que salgan los nombres.","src/agentes/departamentos/operaciones.js:409 (cierreDiario). Usar `(!ctx.llm || ctx.reloj.tipo === 'simulado' || typeof ctx.llm.gastoDelDia !== 'function') ? null : ctx.llm.gastoDelDia(dia)`, o gastoEntre(desde, hasta) con la ventana de ultimoCierreT. Pasar también desde y hasta a plantillas.informeDiario para que salga el tramo real. src/orquestador.js:101 (LLM de sustitución) y el LLM falso de test/integracion-orquestador.test.js:30 pueden añadir gastoDelDia: () => 0, aunque el typeof ya los cubre.","src/orquestador.js _cmdReabrir, decisión (a): llamar a plantillas.reabrir({ quien: 'un humano desde el panel', patrimonio: this.vivo.patrimonio, pico: this.estado.pico }), con el pico histórico, no el de vigilancia. Añadir el aviso permanente en instantanea().avisos.","src/orquestador.js:906: plantillas.directiva(dir, this.estado.mesas). En la llamada a megafono.interpretar, pasar ho

##### GRUPO nucleo | arreglados: 29 | fuera: 6
PRUEBAS: npm test: 518 of 518 pass (baseline was 474). New or extended tests: test/integracion-ejecutor.test.js (+9: stop and kill right after a buy with an Alpaca-style broker, paper that does not charge, stop of one of two mesas, 'red' error on send → DESCONOCIDA, and the order that never arrived, phantom in flight, partial fill cancelled at 60 s, idCliente salt); new test/integracion-bolsa.test.js (5: same-batch pending openings, night kill with an ETF in two mesas, opening already done after a crash, re-sizing with DEFENSIVO ×0.5 and banquillo, sombra ETF queue); new test/integracion-fondo.test.js (20: reopening, solo_cerrar refused, kill without network plus retry, kill without prices, folder lock, unreadable estado.json, crash between sale and save, laptop asleep, LLM spend in the report, CFEE, orphans in the limits, unassigned capital and avisos, puesto card text, candles decided after a shutdown, laboratorio without repeats, Dirección contracting once, news ×2, committee, F&G at 00:00); new test/integracion-util.test.js (8: almacen, formato, num, esLoopback/proxy, lock); test/cartera-conciliacion.test.js (+2). The new ejecutor, bolsa and fondo tests were run against a copy with the original (HEAD) versions of my files swapped in: they failed there and pass now (8 of 8, 5 of 5, 19 of 19). Three existing tests encoded the old behaviour and were adjusted: the sale that left a residue within tolerance, a blocked fund with open positions that sat idle, and the shape of cabecera. node scripts/probar-todo.js: 9 of 9 exit 0. node scripts/demo-acelerada.js --dias=60 exits 0 with the same figures as before (99,678 $, 360 committees, 81 executions). It also passes with seed 7 (60 days) and seed 13 (30 days). The reviewers' reproduction scripts were rerun from scratchpad/revision (contabilidad, riesgo, alpaca, robustez, futuro, llm). All show the fix, except those that still assume the old behaviour. fg-dia-d measures macro.fg instead of what the mesa uses; that path is covered by a test. r10 with the reviewers' fake Alpaca fails because the fake has no DELETE /v2/orders/{id}; with that route added in a copy (scratchpad/revision/nucleo/alpaca-copia) the partial is cancelled and the position closes. r10-error-red calls proponerApertura while the position is already open.
NOTAS: Mode: I fixed only my group's files, did no git, and the data/ folder was not touched. Behaviour Eduardo should know about: (1) a loss that happened overnight while the laptop slept now counts against the day limit on wake-up (it follows 'los límites solo se aprietan'), and the reviewers' suspension case now triggers the kill at 06:00; he should confirm the rule. (2) After a kill-then-reopen, the ×0.5 size multiplier for a drawdown is also measured from the reopening, because the vigilante measures everything from its own reference; the committee still votes DEFENSIVO by the historical drawdown. (3) With the fund bloqueado, anything the broker still holds (orphans included) is sold automatically, retrying at 1, 2, 4, 8 and then every 10 minutes. (4) I did not implement C4 (sombra and the kill/pause) or R11 (ETF stops outside market hours) because they are business rules nobody has fixed; they are under 'fuera'. The web still computes sinAsignar on its own; cabecera.sinAsignar is there when the interface wants to use it. Scratch scripts and results are in /tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/revision/nucleo/ (repros.txt, repros2.txt, the edit scripts and the 'antes' copy used to confirm the tests failed on the old code).
FUERA: ["src/index.js: (e) listen() BEFORE orquestador.iniciar(), and show the EBLOQUEO message cleanly. Rb3: print 'Estado guardado' only if detener() succeeded, otherwise exit 1. Rb8: a second Ctrl+C / SIGHUP / SIGBREAK with a time cap. Rb9: use config.proxy.activo and config.proxy.ignoradasEnEnv for the warnings instead of process.env.NODE_USE_ENV_PROXY. Rb11: refuse to start when !config.esLoopback(config.host) && !config.tokenPanel. L6: banner from llm.estado(). L9: npm run demo with an API key spends real money (decision for Eduardo).","src/servidor.js: (d) CSRF (Content-Type json, Origin/Sec-Fetch-Site → 403, also on the SSE), (i) SSE capped at 20 clients (503), Rb6 backpressure (res.writableLength > 1 MB → destroy), Rb10 Host header against a fixed list, integration findings #1, #10, #13.","web/: (h) show benchmarks/mejora/laboratorio/nota/sinAsignar, the labels with accents and the missing-token strip. The limits bar (dibujo.js 'Pérdida del día') should read cabecera.vigilancia.perdidaDiaPct/caidaPct. maqueta.js should add cabecera.sinAsignar and cabecera.vigilancia; test/integracion-servidor.test.js accepts them as extras until then. Interface findings I1-I12 on the client side, integration findings #9, #10 and #14.","package.json: a 'start-proxy' script (node --use-env-proxy src/index.js) (Rb9).","docs/ARQUITECTURA.md outside §7, for whoever owns it: §6.7 idCliente = mt-<sal>-<mesaId>-… (sal = estado.creado in base 36) and the 'determinista' in §3.4; §6.7 sombra ETF queue

##### GRUPO servidor | arreglados: 14 | fuera: 5
PRUEBAS: npm test: 530 de 530 (unos 36 s). node scripts/probar-todo.js: 9 de 9 scripts salen con 0. node scripts/demo-acelerada.js --dias=60: sale con 0 y «OK: todas las invariantes se cumplen».

He añadido 14 pruebas a test/integracion-servidor.test.js, que ahora tiene 21:
- CSRF: 415, 403 por Origin o Sec-Fetch-Site, el SSE ajeno, y que el propio panel y localhost siguen pasando.
- Host ajeno: 421.
- SSE con 20 paneles y el 21 con 503.
- Panel que no lee cortado por pendiente y por atasco, con un lector sano que no pierde ningún mensaje y recibe la última instantánea, no la intermedia.
- API con 503 mientras arranca.
- /api/mensajes inclusivo, y /api/mensajes más allá de la memoria con un Bus de 20.
- Arranque con procesos hijo de src/index.js:
  - HOST=0.0.0.0 sin token no arranca ni crea nada.
  - Un segundo proceso sobre la misma carpeta se niega sin tocar estado, bróker ni mensajes.
  - Mismo puerto con otra carpeta: falla antes de iniciar y la carpeta queda sin estado ni bloqueo.
  - Ctrl+C suelta el bloqueo.
  - El segundo Ctrl+C sale en menos de 3 s con el cierre colgado.
  - Un cierre que falla no dice «Estado guardado» y sale con 1.
- Avisos del banner (LLM guardado en Ajustes, proxy, gasto de la demo, consejo sin red, URL con 0.0.0.0) y el script start-proxy.

Todas fallan contra la versión anterior de servidor.js, index.js y package.json (copia en scratchpad/revision/servidor/copia-vieja), salvo la de /api/mensajes inclusivo: bus.js ya lo había arreglado otro grupo y la dejo como guarda a nivel de servidor.

Comprobado a mano:
- scratchpad/revision/servidor/navegador.js, con Chromium:
  - el panel en 127.0.0.1 y en localhost funciona: 0 errores de consola, 0 respuestas ≥400, POST y SSE;
  - la web ajena pausa el servidor viejo y no el nuevo.
- HOST=0.0.0.0 con token:
  - el banner da la URL local y la de la red;
  - por la IP de la red, con token 200 y sin token 401;
  - con Origin ajeno, 403.
- Modo simulado real: con y sin npm run start-proxy, los avisos son correctos.
- Sin red con el proxy activo: dice que el proxy o la red no responden, sale con 1 y suelta el bloqueo.
- Con clave falsa y Ajustes a 0,5 $ y fable, el banner lo enseña y avisa de lo que dice el .env.
NOTAS: Solo he tocado src/servidor.js, src/index.js, package.json (script start-proxy) y test/integracion-servidor.test.js. No he hecho git. Las copias de antes están en scratchpad/revision/servidor/*.orig.

Otros grupos ya tenían hecho lo que uso: el bloqueo de data/.proceso en util/proceso.js y orquestador.iniciar; esLoopback, PROXY_ACTIVO y config.proxy en config.js; y bus.desde inclusivo. Yo lo he conectado en index.js y servidor.js.

Decisiones de diseño:
1. El bloqueo se toma en main() antes de construir(), no solo en iniciar(). Si no, un segundo proceso reescribe broker-simulado.json al crear el bróker.
2. SIGHUP se maneja solo en Windows. En Linux o Mac anularía el nohup.
3. Un segundo Ctrl+C no guarda si hay un latido en curso. Vale lo guardado en el último latido, que es la recuperación de un corte ya probada.
4. Con HOST abierto y token se acepta cualquier Host (el token protege). Sin token, index.js ya no arranca.
5. Un comando por curl sin Content-Type JSON ahora da 415. El mensaje dice qué cabecera poner.
6. /api/mensajes sin desde devuelve hasta 5.000 mensajes del disco, no solo los 500 de memoria.

Un detalle visto al probar: a ×600, un Ctrl+C durante un comité esperaba unos 9 s por las pausas de pantalla, y antes podía esperar sin tope. Ahora son como mucho 10 s y el mensaje dice si lo pendiente era el latido o las tareas de fondo. Lo limpio queda anotado en «fuera».
FUERA: ["docs/ARQUITECTURA.md §7 (grupo núcleo). Hay que documentar: los POST exigen application/json (415); 403 si Origin es ajeno o 'null' o si Sec-Fetch-Site es cross-site, también en el SSE; 421 si el Host no es de la lista fija; tope de 20 paneles SSE con 503; 503 mientras arranca; /api/mensajes inclusivo y completado desde mensajes.jsonl; los dos textos del 401. En §6.10 falta el orden del arranque: bloqueo, luego listen, luego iniciar.","README.md:48 y AGENTS.md:40: cambiar «NODE_USE_ENV_PROXY=1 npm start» por «npm run start-proxy» y decir que hace falta Node 22.21 o posterior (en Node 20 no existen ni la variable ni el flag). docs/02-apis.md:37: añadir HOST y que abrirlo a la red exige PANEL_TOKEN.","src/agentes/comite.js y orquestador.detener(): las pausas de pantalla del comité (pausaComiteMs, 1,5 s × 7) se leen una sola vez al empezar, así que un Ctrl+C durante un comité espera hasta unos 10 s. Ahora el tope de index.js lo corta, pero lo limpio sería que detener() anulara esas pausas.","Decisión de Eduardo (hallazgo llm): si `npm run demo` con ANTHROPIC_API_KEY debe apagar el LLM salvo con --con-llm. Por ahora solo hay aviso en el banner.","web/js/app.js (grupo web), menor: sondearEventos toma cualquier 503 de /api/eventos como «lleno». Durante el arranque el servidor también responde 503 («arrancando»). Hoy no se nota, porque /api/estado también falla y no se llega a sondear, pero se podría leer `mensaje` para distinguirlos."]

##### GRUPO resto | arreglados: 17 | fuera: 5
PRUEBAS: npm test pasa 539 de 539 en 5 de 6 pasadas completas (antes eran 530; ahora hay 6 pruebas de integración nuevas y 3 de interfaz). En la otra pasada falló la prueba inestable que cuento aparte. node scripts/probar-todo.js: 9 de 9 scripts con código 0; probar-backtest da ahora 12 casos OK. node scripts/demo-acelerada.js --dias=60 sale con código 0: 99.678 $ (−0,32 %), 360 comités, 81 ejecuciones y «OK: todas las invariantes se cumplen». Las 6 pruebas de test/integracion-remate.test.js fallan sobre una copia del árbol anterior (scratchpad/revision/final/viejo) y pasan con los cambios. probar-backtest --real --usar-cache --datos=scratchpad/revision/final/data repite la tabla de cuant (−41,4 %/−0,52/539; +120,2 %/0,83; −9,7 %/−0,42; +87,8 %/0,64; C&M 120,6/166,7/113,9/207,3 %). Con descarga nueva hasta el 30-sep (NODE_USE_ENV_PROXY=1, en scratchpad/revision/final/data-fresca) difiere como mucho 0,1 %. scratchpad/revision/final/tendencia-sin-comision.js da +63,3 % sin costes y 4.434 $ de comisiones. Los repros de alpaca r1 (kill con SPY de noche) y r2 (venta del kill a medias) salen bien: libros y Alpaca a cero y conciliación limpia. Humo en Chromium (scratchpad/revision/final/humo-web.js): 10 de 10. Proceso real a ×600: Ctrl+C durante un comité sale en 1.043 ms con «Estado guardado» y suelta .proceso. data/ del proyecto sin tocar: solo tiene cache.
NOTAS: Modo: paso a paso sobre el encargo, sin git (como pedía el encargo). Antes de tocar nada contrasté cada punto con el disco, y los demás arregladores ya habían hecho la mayoría. Ya estaban: formato.js con el cero sin signo; los avisos de pausado y solo cerrar y el mensaje de _cmdReabrir; plantillas.directiva y decisionComite con parámetro mesas, y megafono.explicar con los nombres; el estadoTexto en vivo y textoPuesto; timeoutUltimosMs/reintentosUltimos; el aviso «Sin precios nuevos»; CSRF, Host, tope de SSE, contrapresión y /api/mensajes inclusivo; el laboratorio con previas, sharpesPrevios, maxDDReferencia por tramo y firma; direccion con firmaHipotesis; mesas con desde/iAnterior; desdeCalentamiento; RETRASO_FG; benchmarks con COSTES_POR_DEFECTO; en operaciones.js, conciliar antes de vender, contraste de CFEE, segunda pasada del kill, cancelación a los 60 s, 'red' como DESCONOCIDA, sal en idCliente y gastoLLMDe; almacen con critico/durable; index.js (bloqueo, listen antes de iniciar, Rb3, Rb8, Rb9, Rb11, banner con llm.estado()); config.num con coma decimal; analisis.js con noticias cruzadas y vistas solo tras clasificar; comite.js puntos (1) y (2); start-proxy en package.json. Lo que faltaba de verdad lo arreglé con su prueba, y la documentación la escribí contra el código, leyendo cada función. Corrijo algo de la lista de cifras: la caída de comprar y mantener (de +734 % a +121 %) no viene de un precio rancio. Viene de que ahora comprar y mantener también vende antes del hueco y recompra después, así que deja fuera la subida real de SOL de 20 $ a 157 $ durante el hueco. Así lo explico en los documentos. Los scripts de reproducción, los registros y las salidas están en /tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/revision/final/; la copia del árbol de antes, en antes/arbol.tar.
FUERA: ["Opcional, lo implementé y lo quité: la señal de aborto en limitador.pedir() para el Ctrl+C. Cortar las peticiones a mitad de latido y luego guardar deja consumida la vela decidida y las órdenes de acciones pendientes de la apertura sin enviarlas: al arrancar se consultarían, darían 404 y se abandonarían. Hoy, un latido que no acaba en 10 s sale sin guardar y se rehace al arrancar, que es más seguro. Ahora que las pausas del comité se cortan, el Ctrl+C típico ya sale en 1 s. El diff está en scratchpad/revision/final/limitador-abortar-descartado.diff.","Hallazgos de interfaz I1-I12: no tengo su lista, así que no los repasé uno a uno. Solo una prueba de humo en Chromium, 10 de 10 (sin errores de consola contra el servidor real a 1440 y 390 px, Resultados con el 16 % sin asignar y la nota −0,52, la maqueta, y las franjas de 503 'arrancando' y 'lleno').","laboratorio.auditoria sigue mandando al post-mortem las operaciones cerradas por kill o a mano (solo aparta las de prueba): se auditan y guardan su lección, pero no dan pistas. Así lo pide la decisión (g) y no lo he cambiado.","Decisiones de Eduardo sin implementar: si paper cobra la comisión cripto (`node scripts/probar-alpaca.js --orden-prueba` con claves; si no cobra, costes.comision = 0 en AlpacaBroker); si src/backtest/motor.js costesPorDefecto debe seguir cobrando la comisión aunque paper no la cobre; si ruptura sigue de titular con Sharpe 0,64 frente a 0,66; lección frente a mesa madre y «sin medir = cumple» (F9); si npm

##### FINAL funciona
+ npm test: 539 de 539 en 33 s. node scripts/probar-todo.js: 9 de 9 scripts salen con 0, con todos sus casos en OK (alpaca 21, backtest 12, broker-simulado 22, contabilidad 35, indicadores 13, llm 37, parque 43, riesgo 36, demo de 20 días).
+ Demo acelerada de 60 días, con todas las invariantes en OK, reinicio recuperado igual y kill final que lo cierra todo. Semilla 42: 99.678 $ (−0,32 %), 360 comités, 81 ejecuciones, bruta máxima 22,24 %. Semilla 7: +6,72 %, bruta máxima 28,99 %, un activo como mucho 9,93 %. Semilla 123: +5,33 %, bruta máxima 27,95 %, un activo como mucho 10,00 %, 0 vetos.
+ Sintético a ×600 sondeado 3 minutos cada 10 s. En las 18 muestras /api/estado coincide con §7 campo a campo, incluidos cabecera.sinAsignar y cabecera.vigilancia, sin ninguna clave de más. Se cumplen Σ puestos = bróker, bruta = Σ valor / patrimonio y sinAsignar = 1 − Σ pesos. No sale undefined, NaN ni null en mensajes, avisos ni estadoTexto. Hay 18 patrimonios distintos y como mucho 150 mensajes. Por el SSE, estado llega cada 2.000 a 2.480 ms y los 5 jefes van a 'comite'.
+ CSRF, probado con curl. Un POST text/plain con Origin ajeno da 403 (pausar y kill); JSON con Origin ajeno, 403; Origin null, 403; Sec-Fetch-Site cross-site, 403; Host ajeno (rebinding), 421; un formulario o text/plain del mismo origen, 415; el OPTIONS de preflight, 403. Desde la propia interfaz en Chromium, Pausar, Reabrir (escribiendo REABRIR), Megáfono con Interpretar y Aplicar, Comité y Prueba responden todos 200 y hacen su efecto.
+ Cada POST contra el proceso vivo. comite: ok; con uno en marcha responde «Ya hay un comité reunido». megafono «pausa SOL 6 horas» da pausar_activo; aplicarla con un id falso se rechaza; con el bueno, SOL queda vetado exactamente +6,00 h. «sube el riesgo al 200 %» da sin_efecto. La pausa y el solo cerrar del Megáfono se aplican bien. prueba: sin PRUEBA da 400; con PRUEBA compra y vende 0,00015044 BTC (−0,09 $). pausar pasa a 'pausado'. reabrir da 400 sin la palabra o en minúsculas; con REABRIR vuelve a normal y dice que el solo cerrar del Megáfono sigue vigente. kill da 400 sin la palabra; con KILL deja 0 posiciones, 0 puestos y el fondo bloqueado. Además: comando desconocido 404, JSON roto 400, 70 KB 413, GET kill 405, «limites» en ajustes rechazado.
+ Dos procesos sobre la misma carpeta: el segundo se niega en el acto, tanto con otro puerto como con el mismo, y dice qué pid tiene el bloqueo sin tocar ningún fichero. Tras Ctrl+C, .proceso se suelta. HOST=0.0.0.0 sin PANEL_TOKEN no arranca.
+ Reabrir tras un kill conserva la caída histórica. En el proceso vivo (kill, Ctrl+C, rearranque «BLOQUEADO», reabrir), cabecera.caida es idéntica en los tres momentos. Con un script de caída del −10 % (revision/final/reabrir-reinicio.js): tras el reinicio, tras reabrir y tras un segundo reinicio, caida sigue en −0,1003, con vigilancia.desdeReapertura=true y caidaPct 0.
+ Modo simulado con precios reales (NODE_USE_ENV_PROXY=1), 3 minutos: 18 de 18 muestras con la forma de §7 y 0 errores. BTC 83.124 frente a 83.193 del último trade de Alpaca pedido con curl, ETH 2.667 frente a 2.666,9 y SOL 118,07 frente a 118,09. Miedo y codicia real (71). /api/estado en 10 ms. Por stderr solo sale el aviso experimental del proxy.
+ Chromium a 1440×900 y a 390×844 (también 1024, maqueta y file://), con el navegador en UTC: 0 errores de consola y 0 respuestas de error, salvo los 401 y 503 buscados en las pruebas de franja. En ningún ancho hay desplazamiento horizontal.
+ Resultados, en los dos anchos. «¿Aporta algo el comité?» trae el Sharpe 90 d del fondo, sin comité, de BTC y la diferencia. «Frente a las carteras sombra» trae valor, rentabilidad, Sharpe 90 d y «Fondo − esta». La tabla de mesas lleva Incubación, Titular y Banquillo con tilde, «Sin asignar: 16 % (15.945 $)», o el 20 % tras los descartes, y las notas. El laboratorio muestra 172 ensayos, la próxima revisión y 10 hipótesis con sus criterios «(no pasa: 0,60)».
+ Etiquetas y cifras. Rótulos del parqué con tilde («TENDENCIA SMA · 4H · INCUBACIÓN») y «SOLO CERRAR» sin guion en la pantalla del comité. Un barrido de todas las fichas (31 por panel) y de todos los modales en 3 paneles no encuentra -0,00, +0,00, incubacion ni solo_cerrar. La única palabra cruda es SOLO_CERRAR en el texto descriptivo del CIO.
+ Directivas a la vista. La píldora dice «SOLO CERRAR hasta 06:40 · Megáfono» y en el móvil va la primera. El puesto vetado lleva la etiqueta «SOL · VETADO» y las mesas pausadas el rótulo «… · PAUSADA». La ficha del puesto trae «No abre SOL: vetado hasta 08:40 (Megáfono).» y «No abre: mesa en pausa hasta 07:50 (Megáfono).». La ficha de la mesa se abre desde el rótulo, desde Resultados y desde «Ver la mesa», con todas sus métricas. El modal Reabrir avisa de que no quita las directivas.
+ Accesibilidad y teclado. Con el foco en «Ver la mesa», sigue ahí tras varias instantáneas. n, p e Intro recorren y abren puestos, y se anuncian en #anuncio. En el móvil la ficha es role=dialog con aria-modal y deja inerte lo de detrás; el inert se quita al cerrar, al pulsar Escape y al pasar a escritorio. En tableta (1024) los botones van solo con icono y aria-label, salvo el Kill switch.
+ Franjas de conexión. Sin token: «Falta el token del panel…». Con un token malo: «El token del panel no vale…». Con 20 SSE abiertos: «Hay demasiados paneles abiertos…», que desaparece al cerrarlos. Con el servidor parado con SIGSTOP, a los 30 s sale la ámbar «Cifras sin actualizar: el último dato…», y al reanudarlo todo se recupera.
+ Resto de la interfaz. A ×3000, 1,2 s después de convocar el comité los 5 jefes ya están sentados en la sala (hallazgo 7 resuelto). Con 7 mesas (servidor falso de 31 puestos) el parqué tiene 6 filas, ningún rótulo se solapa y llevan el tramo («MOMENTUM CRIPTO · 1D · BTC–DOGE»). La pantalla gigante con 15 cotizaciones va en dos columnas, con «+2 más» y los precios viejos apagados con «hace 2 h». En el feed, las horas en Madrid cuadran con los textos, y hay separador «Hoy · 31 jul» y «31 jul 02:00» en los hechos de la mesa.
+ data/ del proyecto intacto: sin cambios desde el 29-sep. git status sigue con los mismos 90 ficheros. Todos los procesos parados y todos los .proceso soltados.

##### FINAL problemas
1. [media] Resultados se abre desplazado hasta el final, con el laboratorio y la hipótesis más antigua a la vista. «¿Aporta algo el comité?» y las sombras, que son lo principal de la pantalla, quedan fuera arriba. abrirModal pone el foco en el primer button.primario, que en Resultados es «Cerrar», al pie del todo.
   DONDE: web/js/paneles.js:743-744 (abrirModal: querySelector('textarea, input:not([disabled]), select, button.primario')) junto con paneles.js:885 (el «Cerrar» primario al final de construirResultados)
   REPRO: Abre el panel sobre un estado con laboratorio (por ejemplo la copia de data/ de una demo de 60 días) y pulsa Resultados. En Chromium, #modal queda con scrollTop=1721 de 2571 a 1440×900 y 2510 de 3304 a 390×844. El título «¿Aporta algo el comité?» cae en y=−1599 y el foco en «Cerrar» (capturas final-bloqueado-*-resultados.png; script revision/final/navegador/final-directivas.js).
2. [media] El modal Reabrir enseña un «null» suelto entre la explicación y el campo REABRIR en el caso más común: pausa o kill sin directivas del Megáfono ni del comité. Element.append() convierte null en el texto «null»; el helper el() sí descarta los null, pero aquí se llama a append directamente.
   DONDE: web/js/paneles.js:969-970 (c.append(...cabModal(...), notas.length ? el('ul', …) : null, conf.campo, res, pieModal(b)))
   REPRO: Con el fondo en normal, en pausa o bloqueado y sin directivas vigentes, pulsa Reabrir. Los nodos de #modal-cuerpo son HEADER, P, TEXTO:«null», LABEL…, y se ve en pantalla (final-reabrir-null-escritorio.png y -movil.png; script revision/final/navegador/final-reabrir-null.js).
3. [media] Después de Reabrir tras un kill, la ficha de cada puesto sin posición sigue diciendo «Fondo bloqueado por el kill switch: no se opera hasta Reabrir.» hasta su vela siguiente: hasta 4 h en las mesas de 4H y hasta 24 h en las de 1D. Contradice la píldora, los avisos y el «Trabajando» del operador en la misma ficha. estadoTexto solo se rehace en la vela y la instantánea lo usa tal cual cuando no hay posición. Tiene que ver con el pendiente de «estadoTexto en vivo» (que habla del P&L con posición), pero ese no cubre este caso.
   DONDE: src/agentes/departamentos/mesas.js:102 (textoPuesto, solo en la vela); src/orquestador.js:887-898 (instantanea: sin posición usa aux.estadoTexto); _cmdReabrir no lo refresca
   REPRO: Arranca sobre la carpeta de una demo acabada (queda bloqueada por el kill final) y haz POST /api/comando/reabrir {confirmacion:'REABRIR'} hacia las 00:35 UTC simuladas. A las 01:45, en /api/estado, los 14 de 14 puestos siguen con ese estadoTexto y fondo.nivel es 'normal' (captura final-directivas-movil-puesto-sol.png).
4. [baja] En la pantalla LÍMITES, tras reabrir un kill, el rótulo «medido desde la reapertura» se pinta encima del título «LÍMITES DEL FONDO»: se montan unos 90 px de texto.
   DONDE: web/js/dibujo.js:1102 (título en x=24, 800 24px) frente a 1116-1118 (subtítulo alineado a la derecha en W−24, 16px, sobre la misma línea base y=40)
   REPRO: Con cabecera.vigilancia.desdeReapertura=true (después de un kill y Reabrir), pinta dibujo.pintarLimites en un lienzo de 480×270 (final-limites-reabierto.png; script revision/final/navegador/final-limites.js).
5. [baja] Pantalla gigante con más de 6 cotizaciones (modo Alpaca con ETF): en dos columnas, una variación de dos cifras se monta sobre el precio (DOGE 0,1795 con +10,37 % pisa 12 px; −12,34 % pisa 5 px), y con una cifra el hueco es de 0,1 px («108.974▲»). En cripto, un movimiento de ≥10 % en 24 h es frecuente.
   DONDE: web/js/dibujo.js:962-965 (filaCotizacion en dos columnas con xPrecio 158 y xVar 262, precio a 20 px y variación a 18 px)
   REPRO: Pinta dibujo.pintarPantallaGigante con 15 cotizaciones (final-gigante-15.png). Las medidas salen con measureText: revision/final/navegador/final-gigante-medir.js.
6. [baja] En el móvil, con el encuadre inicial, los rótulos de mesa salen cortados por la izquierda: con 4 mesas empiezan en x −35, −34, −126 y −133, y de Ruptura Donchian solo se ven 3 px. También son el sitio que se toca para abrir la ficha de la mesa. colocar() los corre a la izquierda sin tener en cuenta el borde del lienzo.
   DONDE: web/js/app.js:594-602 (colocar) y 603-630 (pintarRotulosFila)
   REPRO: Abre el panel a 390×844 y mira window.__parque.est.rotulosPintados, o la captura final-simulado-movil.png («DENCIA SMA · 4H · INCUBACIÓN», «MENTUM CRIPTO · 1D»). Con 7 mesas llegan hasta x=−197 (script revision/final/navegador/final-rotulos.js).
7. [baja] En el móvil, al abrir la ficha tocando un puesto, el foco queda en <body> y no en «Cerrar», aunque la ficha es un diálogo con aria-modal. Abierta con seleccionar() el foco sí va a «Cerrar». Todo apunta a que el mousedown de compatibilidad del toque cae sobre el lienzo, que para entonces ya está inerte, y se lleva el foco.
   DONDE: web/js/paneles.js:491-499 (mostrarTarjeta: el focus() de .cerrar se pierde con el toque)
   REPRO: A 390×844 con isMobile y hasTouch, toca el ancla de un puesto: document.activeElement es BODY a los 0, 50, 300, 1500 y 4000 ms. Con window.__parque.seleccionar({tipo:'puesto',…}) es BUTTON.cerrar (script revision/final/navegador/final-foco-movil.js).
8. [baja] Una reducción del Megáfono («reduce el riesgo a la mitad 3 horas») no se ve ni en la píldora ni en los avisos. Si coincide con el DEFENSIVO del comité, la píldora dice «DEFENSIVO ×0,5» cuando el tamaño real es ×0,25, porque mesas.js aplica el 0,5 del DEFENSIVO y limites.js vuelve a multiplicar por el factor de la reducción. nivelEfectivo ya calcula la reducción, pero nadie la usa.
   DONDE: web/js/paneles.js:268-274 y web/js/dibujo.js:869 (solo miran n.defensivo); src/agentes/departamentos/mesas.js:56 junto con src/riesgo/limites.js:231-235
   REPRO: Aplica por el Megáfono «reduce el riesgo a la mitad 3 horas» con modo NORMAL: la píldora queda oculta y los avisos no la nombran. cifras.nivelEfectivo({fondo:{nivel:'normal'},directivas:{modo:'DEFENSIVO',reduccion:{factor:0.5,hasta:…}}}) devuelve defensivo:true y reduccion 0,5, y la píldora pinta solo «DEFENSIVO ×0,5».
9. [baja] El comité trabaja con los datos que reunió al empezar. Si mientras está reunido alguien pulsa Reabrir o aplica el Megáfono (un comité ocupa 15 min simulados a ×600), los informes salen falsos y la decisión se toma con el estado viejo. Ejemplo: «Megáfono: ninguna directiva vigente» con 3 vigentes, y Riesgos vota DEFENSIVO por «Nivel bloqueado» cuando el fondo ya estaba reabierto; el DEFENSIVO se aplicó 4 h.
   DONDE: src/agentes/comite.js:100-131 (datos reunidos al empezar la reunión y publicados con pausas)
   REPRO: En la carpeta panel42 (sintético), el comité empieza a las 00:30 UTC. A las 00:35 se reabre y a las 00:40 se aplican 3 directivas del Megáfono. En mensajes.jsonl, a las 00:45: «Nivel bloqueado, 0 vetos… Voto DEFENSIVO», «Megáfono: ninguna directiva vigente, nada pendiente» y «Decisión: modo DEFENSIVO».
10. [baja] Con el servidor colgado (proceso vivo que no responde), a los 45 s la franja pasa a «Sin conexión con la mesa, reintentando en 1 s…» y se queda así mientras dure: ni hay reintento ni crece la espera, porque fetch y EventSource esperan sin tope. Cuando el servidor vuelve, se recupera solo.
   DONDE: web/js/app.js:270 (traerEstado sin AbortController ni tiempo máximo), 320-330 (EventSource) y 353-361 (reintentar)
   REPRO: Con el panel abierto, kill -STOP del proceso: a los 50, 75 y 100 s la franja sigue en «reintentando en 1 s…»; tras kill -CONT desaparece (script revision/final/navegador/final-parados.js).
11. [baja] Honestidad del encuadre: «¿Aporta algo el comité?» y «Fondo − sin comité» le cargan al comité lo que hicieron el kill manual, las pausas, el vigilante y el Megáfono, porque la sombra «sin comité» no los sufre. Tras la demo de 60 días con semilla 42 (kill final forzado), Resultados dice «Fondo − sin comité −0,18» de Sharpe y −555 $, cuando antes del kill las dos curvas coincidían (−0,32 % ambas).
   DONDE: web/js/paneles.js:828-840 (bloque de mejora) y src/orquestador.js:936-939 (sombra sin-comite); §5.5
   REPRO: Abre Resultados sobre la carpeta de una demo acabada, reabre y deja correr (captura final-resultados-arriba-escritorio.png). Si hubo kill, pausa o vetos, el bloque debería avisarlo.
12. [baja] «Última señal: nada · 02:00» enseña el id crudo de la acción (nada, abrir, cerrar) en la ficha del puesto.
   DONDE: web/js/paneles.js:562
   REPRO: Abre la ficha de cualquier puesto sin posición (final-directivas-movil-puesto-sol.png).
13. [baja] Con mesas contratadas, en el encuadre inicial de escritorio el rótulo que se deja de pintar es el de una titular (Ruptura Donchian, el 40 % del capital), mientras las incubadas del 2 % sí salen. Ceder por orden de fila no da prioridad al peso.
   DONDE: web/js/app.js:603-620 (el orden de est.mapa.rotulosFila decide quién cede)
   REPRO: Servidor falso con 7 mesas (revision/final/servidor-mesas.js en el puerto 18810) a 1440×900: rotulosPintados trae 6 y falta 'ruptura' (final-mesas7-escritorio.png).
capturas [
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-escritorio-resultados.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-movil-resultados.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-escritorio-resultados-lab.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-resultados-arriba-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-resultados-arriba-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-resultados-mesas-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-escritorio-ficha-mesa.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-bloqueado-movil-ficha-puesto.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-directivas-escritorio-puesto-sol.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-directivas-movil-puesto-sol.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-directivas-escritorio-mesa-momentum.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-directivas-escritorio-reabrir.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-directivas-escritorio-teclado.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-reabrir-null-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-reabrir-null-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-limites-reabierto.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-gigante-6.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-gigante-15.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-simulado-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-simulado-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-tableta-1024.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-mesas7-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-mesas7-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-comite3000-1200.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-franja-sin-token.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-franja-token-malo.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-franja-sse-lleno.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-franja-datos-parados.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-maqueta-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-maqueta-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-ui-reduccion.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/final-tex-comite-0.png'
]

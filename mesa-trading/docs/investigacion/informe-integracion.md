=== INTEGRACION desviaciones
11. Laboratorio. (1) retornosMesasActivas son las curvas de papel de las mesas, no backtests. (2) maxDDReferencia se mide con un backtest de la mesa vigente de la misma familia en el tramo fuera de muestra. Ese tramo lo calcula tramoOOS (src/agentes/departamentos/laboratorio.js:73), que repite la regla de ventanas de walkforward (18/6 y, si no llega, 12/3) porque evaluarHipotesis pide la referencia ANTES de correr el walk-forward. Propuesta para A: que evaluarHipotesis acepte maxDDReferencia como función del tramo. (3) Guardo los sharpesEnsayos de cada evaluación junto al contador, pero src/cuant/laboratorio.js:160 solo usa la varianza de la hipótesis actual. Propuesta para A: un parámetro varianzaSharpes.
12. Kill switch. Vende posición a posición con el Ejecutor: una venta por símbolo, repartida a prorrata entre sus puestos con el mismo idCliente. Antes cancela todo y resuelve las órdenes en vuelo. Los puestos sombra no se tocan. (Actualizado el 30-sep-2026.) Lo que queda a medias (una venta llenada en parte, sin respuesta o rechazada) tiene una segunda pasada por el Ejecutor: cancelar, resolver lo que esté en vuelo y volver a vender lo que diga el bróker. broker.cerrarTodo() queda como último recurso: solo si aún hay fallidos y ninguna venta de acciones espera a la apertura (con Alpaca, su DELETE dejaría otra venta encolada que nadie sigue). Cada liquidación que devuelve (`ordenes`) se sigue y se apunta en los libros como una orden propia (Ejecutor.seguirAjena). Si al final queda algo en el bróker, el fondo sigue bloqueado y se reintenta solo, con esperas de 1, 2, 4 y 8 min y luego cada 10 (fondo.killReintento).
13. Órdenes en vuelo (Alpaca, tras 20 s sin estado final). No se envía otra del mismo símbolo y la conciliación se aplaza hasta que terminen. Si no, un descuadre transitorio acabaría en pausa a la tercera conciliación grave. (Actualizado el 30-sep-2026.) A los 60 s sin estado final (cripto gtc llenada a medias fuera del collar) se cancela lo que falta: lo ejecutado se apunta y el resto lo vuelve a pedir quien lo pidió. Un error de red al enviar ya no es un rechazo: la orden queda en vuelo como DESCONOCIDA y se consulta por idCliente; si el bróker no la conoce (404), no llegó y se abandona sin repetirla.
14. src/agentes/departamentos/mesas.js:130. Aperturas de acciones con la bolsa cerrada: se encolan SIN pasar por Riesgos, y Riesgos las evalúa a la apertura + 5 min con el precio de ese momento (con el control de desvío frente a la decisión). Si Riesgos las mirara al decidir, evaluarPropuesta las vetaría siempre por mercadoCerrado y §6.7 no se cumpliría. Hay una sola pendiente por puesto y lado: un stop saltado de noche no se encola en cada latido.
15. src/agentes/departamentos/mesas.js:238. En las mesas cripto con varios símbolos, si la vela de alguno aún no ha llegado se espera hasta 10 min antes de decidir. Si no, el símbolo que llega tarde se quedaría sin decidir en esa vela.
16. Arranque: el orquestador se niega a cargar un estado.json de otro modo (sintético frente a simulado o alpaca). Evita mezclar precios inventados con reales.
17. Demo: guarda estado.json cada 12 pasos (1 h simulada) por velocidad, más al final y tras cada comando. index.js lo guarda en cada latido.
18. D (src/agentes/megafono.js:22): interpretar() no acepta horasPorDefecto, así que la duración por defecto del Megáfono sigue fija en 4 h aunque COMITE_HORAS cambie. Propuesta: pasar opciones a interpretar().
19. D: postmortem.lote() no pasa esfuerzo, así que el LLM usa el de agentes por defecto ('low'), que es lo que pide el encargo. No he tocado nada.
=== pendientes
- Probar con ANTHROPIC_API_KEY real el comité (maxTokens 4000, esfuerzo medium), las noticias y el post-mortem, y medir el coste en data/llm-costes.jsonl. Aquí no hay clave: esas rutas están probadas con un LLM falso (esquema estricto, veto de Riesgos, verificarCifras).
- Probar el modo alpaca con claves paper: ETF, relojMercado, órdenes en vuelo, conciliación de la comisión cobrada en el activo y cierre de posiciones de acciones con la bolsa cerrada. Está probado con bróker simulado y calendario real.
- Decisiones para Eduardo: (1) pesos iniciales 40/40 con un 16 % sin asignar por el techo del asignador; (2) Reabrir tras un kill reinicia el pico y el inicio del día; (3) ritmo de descansos de uno por hora.
- E (web/): la interfaz no pinta benchmarks, mejora, laboratorio ni mesas[].nota, aunque la instantánea los trae. Propuesta: una tarjeta de mesa con la nota y una pantalla de sombras con Sharpe 90 d.
- A: que evaluarHipotesis acepte maxDDReferencia en función del tramo y una varianzaSharpes de todos los ensayos, para quitar el duplicado de tramoOOS y usar el contador histórico completo en el DSR.
- Con Alpaca, el primer walk-forward de 4H del laboratorio (800 días) pide unas 115 páginas por símbolo por el limitador compartido. Esa primera vez puede retrasar unos 2 min las peticiones de trading; después sale de la caché.
- A ×3000 los jefes apenas llegan a la sala de comité antes de volver (el comité dura 2,4 s reales). A ×600, la velocidad de npm run demo, sí se sientan.
=== notas
Modo: el paso completo del encargo F en una pieza. No he hecho git ni npm install. No he tocado ficheros ajenos salvo el arreglo de src/util/numeros.js.

Lo construido: siete departamentos (mesas, análisis, macro, riesgos, operaciones con Ejecutor y Controller, laboratorio con Auditor, dirección) más un módulo de piezas comunes. Además: el comité de §6.8, el Orquestador (iniciar, paso, instantánea con la forma exacta de §7, comando y los eventos estado, mensaje, agente y ejecución), el servidor node:http, index.js, la demo acelerada, probar-todo y 23 pruebas nuevas de integración (368 → 394 en total, contando una prueba de A que ya estaba). package.json lleva ahora demo, demo-rapida y probar.

Pruebas:
- npm test: 394 de 394 en unos 17 s.
- node scripts/probar-todo.js: 9 de 9 scripts salen con 0 (los ocho probar-* sin --real, más la demo de 20 días).
- La demo de 60 días tarda unos 25 s. Además de las invariantes del encargo, comprueba que no hubo ningún error dentro de los departamentos.
- La forma de la instantánea se compara campo a campo con la de web/js/maqueta.js. El único campo de más es mesas[].nota, que pedía el encargo.

Casos conocidos que he comprobado a mano:
- La sombra «sin comité» coincide al céntimo con el fondo en la demo, porque el comité solo pasó a DEFENSIVO un día y ese día no hubo aperturas. Con un comité forzado que deja ruptura a ×0 se separa: 99.466 $ frente a 98.918 $.
- Parado con Ctrl+C y rearrancado sobre la misma carpeta, sigue con el mismo reloj simulado y las mismas posiciones.
- En modo simulado con precios reales de Alpaca (sin claves, por el proxy), el primer latido carga el histórico real. Régimen RISK-ON +2, miedo y codicia 73 real, las 4 mesas decidiendo y backtests de referencia de 180 y 365 días.

Chromium: node src/index.js --modo=sintetico --velocidad=3000 en un puerto libre y con una carpeta de datos del scratchpad (data/ queda limpio). Panel sin maqueta, 20 s, en escritorio (1440×900) y en móvil (390×844):
- 0 errores de consola y 0 peticiones fallidas.
- Cabecera «99.997 $» y píldoras RISK-ON, F&G y SINTÉTICO ×3.000.
- El feed pasa de 64 a 132 mensajes.
- 27 personajes y 27 agentes.
- Tarjeta de puesto con posición, comité desde la botonera, ajustes y prueba funcionando.
La primera pasada sí dio 9 errores: eran las 404 del escáner de precarga, ya resueltas en el servidor. Capturas en el scratchpad: capturas/integrado*.png.

Rendimiento de pintado: unos 3 ms por fotograma de media.

=== VERIFICADOR funciona
+ Pruebas: `npm test` pasa 394 de 394 en 17 s. Cada `scripts/probar-*.js` sin --real sale con 0 y con todos sus casos en OK: alpaca 21, backtest 10, broker-simulado 13, contabilidad 35, indicadores 13, llm 17 (con --sin-clave y sin argumentos), parque 34, riesgo 36. `probar-todo.js` pasa 9 de 9.
+ Demo de 60 días con semilla 42: repite exactamente las cifras del informe (99.678 $, -0,32 %, 360 comités, 81 ejecuciones, invariantes OK). Con semilla 7: +6,72 %, 360 comités, bruta máxima 28,99 % y un activo como mucho 9,93 %, todo OK. También hice dos demos más largas que el informe no cubría: 100 días con semilla 42 y 130 días con semilla 7. Las dos salen OK y recorren la revisión mensual: incubadas descartadas al banquillo y tendencia ascendida a titular con el 20 %.
+ Las cifras cuadran entre sí. Hice una comprobación contable mía, independiente del bróker: patrimonio del bróker = capital + Σ realizado + Σ abierto neto de comisiones de entrada pendientes. Se cumple con menos de 0,0001 $ de diferencia en 2.160 muestras de 45 días, con las semillas 42 y 7 (scratchpad/verificacion/identidad.js). Tras el kill del proceso vivo, efectivo del bróker = capital + Σ pnl de operaciones.jsonl (diferencia de 9e-5 $). En cualquier momento hubo como mucho 5 posiciones. El peso por activo en la compra nunca pasa del 10 %; después sube hasta un 10,8 % solo porque se mueve el precio, lo que es coherente con §5.3.
+ Operaciones por mesa coherentes con el marco de cada una: tendencia (4H) 23; momentum, reversión y ruptura (1D) entre 4 y 5 en 60 días. Comités cada 4 h: 6 al día, 8 mensajes cada uno (2.880 de 360). Macro y analistas publican cada 4 h o cuando cambian. Ningún mensaje pasa de 140 caracteres y ninguno lleva undefined, NaN ni null (3.997 mensajes).
+ Proceso sintético a ×3000 sondeado 3 minutos cada 10 s. /api/estado coincide con §7 campo a campo (salvo el campo extra `nota`). El patrimonio cambia: 18 valores distintos en 18 muestras. Hay mensajes de 7 departamentos. En 180 s salieron 37 decisiones de comité, y el SSE `agente` llevó a cio, controller, macro, riesgos y laboratorio a la sala 'comite' en cada comité (185 eventos). Los eventos `estado` del SSE llegan como mucho uno cada 2 s (salvo la instantánea inicial). En todas las muestras Σ puestos = bróker y la exposición bruta = Σ valor / patrimonio.
+ Comandos POST probados contra el proceso vivo:
- comite: ok. Un segundo comité inmediato responde «Ya hay un comité reunido».
- megafono con «pausa SOL 6 horas»: propone {pausar_activo, SOL/USD, 6}. megafono-aplicar con un id falso se rechaza; con el id bueno, SOL aparece en directivas.activosVetados hasta exactamente +6,00 h. «sube el riesgo al 200 %» da sin_efecto.
- prueba: 4 comprobaciones. ordenMinima sin PRUEBA da 400; con PRUEBA compra y vende 15 $ de BTC.
- pausar: nivel 'pausado'.
- reabrir: 400 sin la palabra y con «reabrir» en minúsculas; con REABRIR vuelve a 'normal'.
- kill: 400 sin la palabra; con KILL cierra ETH, LINK, AVAX y SOL, deja 0 posiciones y 0 puestos abiertos, nivel bloqueado y 22 de 27 agentes de pie (los otros 5 estaban en comité).
- Reinicio con Ctrl+C y la misma carpeta: «El fondo arranca BLOQUEADO», nivel bloqueado, 0 posiciones.
- Otros: comando desconocido 404, JSON roto 400, 70 KB 413, GET kill 405, los límites no se cambian desde ajustes.
+ El veto de SOL funciona. Con la pausa vigente, proponerApertura(SOL) se veta con el motivo 'activoVetado' y no sale ninguna orden; pasadas 6 h se aprueba. En una marcha natural de 40 días con SOL pausado y renovado, hubo 8 vetos a SOL y 0 compras reales de SOL. El sombra «sin comité» sí siguió operando SOL, que es lo que manda el diseño (scratchpad/verificacion/sol-veto.js).
+ El vigilante dentro del orquestador, con umbrales de juguete puestos solo en esa prueba: salta solo_cerrar, luego el kill, cierra todo (bróker 0, puestos 0), se mantiene bloqueado 3 latidos y no hay ninguna compra con nivel distinto de normal (scratchpad/verificacion/vigilante-integrado.js).
+ Robustez ante caídas: maté el proceso con SIGKILL 8 veces en momentos al azar y lo rearranqué. Libros y bróker cuadran en todos los arranques y no aparece ningún error.
+ Modo simulado con NODE_USE_ENV_PROXY=1, 8 minutos sin claves. Precios reales: BTC 83.708, ETH 2.681, SOL 119,35, que coinciden con los últimos trades de Alpaca pedidos con curl (83.682, 2.686, 119,2). Miedo y codicia real (73, sin marca de sintético). /api/estado da 200 en 29 ms con la forma de §7. Lo único que sale por stderr es el aviso de Node «EnvHttpProxyAgent is experimental»; ningún error de la aplicación.
+ PANEL_TOKEN:
- /api/estado, /api/eventos y los POST dan 401 sin token o con un token malo, y 200 con ?token= o con la cabecera.
- Los estáticos se sirven sin token y la interfaz abierta con ?token= funciona con 0 errores.
- Los 4 intentos de salir de la carpeta web/ que probé (../ y variantes codificadas) dan 404.
- Los oyentes del SSE se quitan al cerrar la conexión: 40 abiertos, 0 tras cerrar.
+ Chromium a 1440×900 y a 390×844:
- 0 errores de consola, 0 peticiones fallidas, 0 respuestas 404.
- La barra superior tiene cifras (patrimonio, resultado, caída, exposición, posiciones y las píldoras de régimen, F&G, comité, modo y LLM).
- El feed tiene 192 mensajes y hay 27 personajes.
- Clic (o toque en móvil) sobre un puesto abre la tarjeta: panel lateral en escritorio, pantalla completa 390×844 en móvil. Sus cifras coinciden con /api/estado.
- No hay desplazamiento horizontal de la página.
+ El arreglo de src/util/numeros.js es correcto: redondearAbajo(167,363836; 1e-9) = 167,363836 y los casos límite que probé no suben por encima de la entrada más de un ulp. La memoria del proceso a ×3000 se mantiene estable (unos 180 MB).
=== hallazgos
1. [media] Cualquier página web puede mandar comandos al panel desde el navegador del usuario (CSRF). Sin PANEL_TOKEN, que es lo que viene por defecto, el servidor acepta POST de otro origen con Content-Type text/plain: una petición «simple» que el navegador envía sin pedir permiso antes. Las palabras de confirmación (KILL, REABRIR, PRUEBA) no protegen, porque la página atacante las mete en el cuerpo. Una web cualquiera podría pulsar el kill switch, pausar, reabrir un fondo que el kill dejó bloqueado (saltándose lo de que «solo reabre un humano»), lanzar la orden de prueba o dejar propuestas en el Megáfono. No se mira ni Origin, ni Content-Type, ni Sec-Fetch-Site.
   DONDE: src/servidor.js:158-189 (api(), en especial la línea 187, que ejecuta el comando sin mirar el origen); src/servidor.js:122 (autorizado() solo mira el token)
   REPRO: Con el proceso en marcha sin PANEL_TOKEN: curl -X POST -H 'Content-Type: text/plain' -H 'Origin: https://sitio-malicioso.example' -H 'Sec-Fetch-Site: cross-site' --data '{"confirmacion":"KILL"}' http://127.0.0.1:18792/api/comando/pausar → 200 {"ok":true,"mensaje":"Pausado…"} y /api/estado queda en nivel 'pausado' (lo probé y luego reabrí). Lo mismo vale para /api/comando/kill y /api/comando/reabrir. Chrome moderno puede pedir permiso de red local, pero otros navegadores no.
2. [media] Nada impide arrancar dos procesos sobre la misma carpeta de datos. Con distinto puerto, los dos corren a la vez, escriben estado.json, broker-simulado.json, ordenes.jsonl y mensajes.jsonl y mandan órdenes con el mismo idCliente. Con Alpaca paper, los dos operarían la misma cuenta. Con el mismo puerto, el segundo proceso ejecuta orquestador.iniciar() completo antes de fallar con EADDRINUSE: guarda estado.json, publica en mensajes.jsonl y resuelve órdenes a medias.
   DONDE: src/index.js:80-85 (iniciar() va antes de listen, y no hay fichero de bloqueo); src/orquestador.js iniciar()
   REPRO: Con el sintético corriendo en 18791 sobre --datos=X, arranca node src/index.js --modo=sintetico --velocidad=3000 --puerto=18796 --datos=X durante 25 s. Arranca sin aviso. Después, en X/ordenes.jsonl aparecen 2 idCliente repetidos en INTENCION (mt-reversion-BTCUSD-20261111T0000Z-cerrar-1 y mt-tendencia-BTCUSD-20261112T0000Z-abrir-1) y mensajes.jsonl tiene 15 saltos de t hacia atrás.
3. [media] Confirmo lo que el informe ya avisaba: al reabrir tras un kill, se ponen el pico y el patrimonio de inicio del día al valor actual. En la práctica eso afloja un límite duro. La caída desde el máximo del −15 % pasa a medirse desde la reapertura, así que dos kills seguidos permiten perder en total alrededor de un 28 % sin que el vigilante salte. Además la cabecera enseña «Caída 0 %» aunque el fondo siga lejos de su máximo histórico. El principio 3 dice que los límites solo se aprietan. Es decisión de Eduardo.
   DONDE: src/orquestador.js:994-998 (_cmdReabrir)
   REPRO: scratchpad/verificacion/vigilante-integrado.js (umbrales de juguete solo en la prueba): tras el kill, «reabrir: … pico 100121.92 inicioDía 100121.92 patrimonio 100121.92»; el pico anterior se pierde y instantanea().cabecera.caida pasa a 0.
4. [media] Confirmo lo que el informe ya avisaba: los pesos iniciales suman el 84 % y el 16 % del capital no se asigna nunca. Cuando las dos incubadas se descartan, queda sin asignar el 20 % (demo de 100 días con semilla 42: momentum 40 %, ruptura 40 %, las otras dos en el banquillo). El encargo decía «el resto a partes iguales», pero con el techo del 40 % del asignador y solo dos titulares no cabe. Contrato y encargo se contradicen: lo tiene que decidir Eduardo.
   DONDE: src/orquestador.js:244 (reasignar para los pesos iniciales); §5.7 (techo del 40 %)
   REPRO: GET /api/estado en un arranque limpio: mesas = tendencia 0,02 · momentum 0,40 · reversion 0,02 · ruptura 0,40, Σ = 0,84. node scripts/demo-acelerada.js --dias=100 → «tendencia banquillo 0 % · momentum titular 40 % · reversion banquillo 0 % · ruptura titular 40 %».
5. [baja] Reabrir desde 'solo_cerrar' (pérdida del día del −2 %) responde ok, «Reabierto: vuelta a nivel normal», pero en el latido siguiente el vigilante vuelve a poner solo_cerrar, porque la pérdida del día sigue ahí. El botón dice algo que no se sostiene. O se niega explicando que el límite dura hasta las 00:00 UTC, o lo avisa.
   DONDE: src/orquestador.js:978-1005 (_cmdReabrir), junto con riesgos.vigilarFondo
   REPRO: scratchpad/verificacion/reabrir-solo.js → «reabrir: true Reabierto: vuelta a nivel normal. | nivel justo después: normal | un latido después: solo_cerrar».
6. [baja] El laboratorio vuelve a proponer cada semana la misma hipótesis ya rechazada, porque el id lleva la semana dentro. Cada vez suma ensayos al contador del DSR (180 ensayos y 0 aprobadas en la demo de 60 días; 0 aprobadas también a 100 y 130 días). Además, las operaciones cerradas por un kill manual entran en el post-mortem como 'señal_falsa' y generan pistas de hipótesis. Consecuencia: el camino de contratación de extremo a extremo no se ejerce en ninguna demo; solo lo cubre la prueba unitaria.
   DONDE: src/agentes/departamentos/laboratorio.js:149 (quita repetidas solo por id); src/cuant/laboratorio.js:223 (id = h-<semana>-…); laboratorio.js auditoria() no aparta motivoSalida 'kill' ni 'manual'
   REPRO: En data/mensajes.jsonl de la sesión sintética: «tendencia-sma 4H en BTC, ETH, SOL. Origen: lección» propuesta y rechazada el 12-oct, el 19-oct y el 26-oct, siempre por Sharpe OOS. La lección de SOL que la alimenta viene de «Cerrada SOL por kill switch».
7. [baja] A ×3000 el comité dura unos 2,1 s reales (7 pausas de 300 ms). La API pone a los 5 jefes en la sala 'comite', pero en el dibujo no llegan nunca: tardan más en andar que lo que dura la reunión, y la sala se ve vacía con la píldora «Comité reunido» encendida. A ×600 (npm run demo) sí da tiempo.
   DONDE: src/agentes/comite.js:202 (pausaMs acotado a intervalo/2/8)
   REPRO: Sintético a ×3000, POST /api/comando/comite y captura a los 600 y 1200 ms: capturas/verificacion-comite-600.png y verificacion-comite-1200.png. La API lista cio, macro, riesgos, controller y laboratorio en 'comite' y la sala marrón está vacía.
8. [baja] /api/estado lleva en mesas[] un campo `nota` que §7 no recoge. Se nota solo al validar la forma campo a campo.
   DONDE: src/orquestador.js:761
   REPRO: GET /api/estado → mesas[i] tiene la clave 'nota' además de las de §7 (scratchpad/verificacion/vigilar.js la marca como campo extra).
9. [baja] Las horas escritas dentro de los textos van siempre en hora de Madrid (formato.hora con 'Europe/Madrid'), pero la hora de cada mensaje en el feed usa la zona del navegador. Con un navegador en UTC, un mensaje fechado a las 12:00 dice «Abro el comité de las 14:00». Para un usuario en España sale igual.
   DONDE: src/util/formato.js:57 (hora con Madrid fijo) frente a web/js/cifras.js:76 (zona del navegador)
   REPRO: Abre el panel en Chromium con TZ=UTC: capturas/verificacion-escritorio-tarjeta.png, feed «Carmen Aguirre 12:00 · Abro el comité de las 14:00».
10. [baja] Con PANEL_TOKEN puesto, si se abre el panel sin ?token= la interfaz enseña «Sin conexión con la mesa, reintentando…» y deja 401 en la consola, en vez de decir que falta el token. Es consecuencia de pedir el token también en los GET, una decisión de F; lo que se pinta es de E.
   DONDE: src/servidor.js:158-160; el texto de la franja está en web/js
   REPRO: PANEL_TOKEN=secreto123 node src/index.js --modo=sintetico --puerto=18794 y abrir http://127.0.0.1:18794/ sin ?token → franja «Sin conexión con la mesa, reintentando en 4 s…» y 4 errores 401 en la consola.
11. [baja] GET /api/mensajes?desde=t devuelve solo mensajes con t estrictamente mayor. En sintético muchos mensajes comparten el mismo t, así que quien pagine con el último t visto pierde los que se publiquen después en ese mismo instante. Además solo hay 500 en memoria. La interfaz no usa esta ruta.
   DONDE: src/agentes/bus.js:86 y 103; src/servidor.js /api/mensajes
   REPRO: Coge desde = t del mensaje 20 empezando por el final de /api/estado y pide GET /api/mensajes?desde=<t>: devuelve 9 mensajes, no los 20 o más esperados.
12. [baja] Las noticias se marcan como vistas antes de que el LLM las clasifique. Si la llamada falla (presupuesto agotado, error o esquema), esas noticias no se vuelven a mirar nunca y un evento grave se escaparía. Lo saco de leer el código; no lo he podido probar porque hacen falta claves de Alpaca y del LLM.
   DONDE: src/agentes/departamentos/analisis.js:129-131 (n.vistos antes de pedirJSON en la 134)
   REPRO: Con un LLM falso que devuelva {ok:false, motivo:'presupuesto'}, llama a analisis.noticias() dos veces con 4 h de diferencia y las mismas noticias: la segunda llamada no las manda al LLM.
13. [baja] No hay límite de clientes SSE. Con más de 100 conexiones a la vez Node avisa de MaxListenersExceededWarning en el orquestador. No es una fuga, porque al cerrar se quitan los oyentes, pero no hay tope.
   DONDE: src/servidor.js sse(); src/orquestador.js (setMaxListeners(100))
   REPRO: Abre 120 conexiones a /api/eventos a la vez (scratchpad/verificacion/sse-fuga.js) → en el log del proceso: «MaxListenersExceededWarning: … 101 estado listeners added to [Orquestador]».
14. [baja] La tarjeta del puesto pinta el estado de la mesa en crudo, «incubacion» sin tilde. Es un detalle visual del lado de E.
   DONDE: web/js (tarjeta), con el dato mesa.estado de la instantánea
   REPRO: Clic en el puesto BTC de tendencia → cabecera «BTC/USD · tendencia-sma 4H · incubacion» (capturas/verificacion-movil-tarjeta.png).
=== capturas [
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-escritorio.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-escritorio-tarjeta.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-movil.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-movil-tarjeta.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-comite-600.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-comite-1200.png',
  '/tmp/claude-0/-home-user/16b0fbe0-e75e-57fd-9ee4-d36be51ff36a/scratchpad/capturas/verificacion-comite-1800.png'
]

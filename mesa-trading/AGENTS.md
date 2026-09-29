# Mesa de trading de agentes

Fondo de agentes de IA que opera **solo en papel**: cuenta paper de Alpaca o
bróker simulado con 100.000 $. Panel isométrico en `web/`. Es de Eduardo, que
no programa: Claude escribe, prueba y documenta todo, en español.

## Reglas que el código no confiesa

- **Solo papel.** `AlpacaBroker` acepta únicamente `https://paper-api.alpaca.markets`.
  Cualquier camino a dinero real lo decide Eduardo por escrito, nunca una sesión.
- **El LLM habla; el código decide los números.** Tamaños, stops, límites, P&L
  y señales son código determinista. El LLM solo redacta, elige de listas
  cerradas o clasifica; todo su texto pasa por `verificarCifras` antes de
  llegar a pantalla.
- **Los límites duros (`src/config.js`) solo se aprietan.** El comité y el
  Megáfono no pueden aflojarlos. Sus valores, los criterios de kill y qué mesa
  arranca como titular son reglas de negocio de Eduardo: si falta una, se
  pregunta.
- **El contrato manda.** `docs/ARQUITECTURA.md` fija la firma y la forma de
  datos de cada módulo y la instantánea que lee la interfaz. Un cambio de forma
  se escribe primero allí.
- **Reloj, nunca `Date.now()`**, en la lógica: el mismo código corre en tiempo
  real y acelerado.
- **Honestidad de resultados.** Todo rendimiento se mide con costes y
  penalización de papel, y frente a las carteras sombra (comprar y mantener, y
  «mismas mesas sin comité»). Un resultado bueno se contrasta antes de
  contarlo.

## Antes de dar algo por bueno

Un caso conocido que cuadra, guardado como `scripts/probar-*.js`. La demo
acelerada es el caso conocido del sistema entero: sus invariantes (límites,
Σ puestos = bróker, patrimonio = efectivo + posiciones, reinicio, kill) no se
relajan para que pase. Puerta antes de cada commit: `npm test` y `npm run probar`
en verde.

Al tocar bróker o datos de Alpaca, primero `docs/investigacion/ficha-alpaca.md`
(API comprobada: comisión cobrada en el activo, posiciones `BTCUSD`, páginas
semanales en 4H, anti-lavado). En este contenedor, la red de Node necesita
`NODE_USE_ENV_PROXY=1`.

## Git

Un commit por pieza, con el porqué en el mensaje, y `git push` al cerrar. Nunca
`.env` ni `data/`.

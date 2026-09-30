# Mesa de trading de agentes

Un fondo de inversión **en papel** dirigido por agentes de IA organizados en
departamentos. Se hablan entre ellos, operan solos una cuenta demo de
100.000 $ y reparten el capital según lo que funciona. Todo se ve en un parqué
isométrico en el navegador: mesas con monitores en verde o rojo, pantalla
gigante, comité que se reúne, bocadillos, kill switch.

**Nunca toca dinero real.** El código no conoce la dirección de la cuenta real
de Alpaca.

## Arrancar (Windows, Mac o Linux)

Hace falta Node.js 20 o superior.

```
cd mesa-trading
npm install
npm start
```

y abrir **http://localhost:8765**.

- **Sin ninguna clave** arranca en modo `simulado`: precios **reales** de
  cripto de Alpaca y un bróker interno con 100.000 $ que imita a Alpaca
  (comisiones incluidas).
- **Con claves de Alpaca paper** en `.env` opera en tu cuenta demo de Alpaca.
- **Con clave de Claude**, el comité decide y redacta con IA, con un tope
  de gasto diario.

Qué APIs hacen falta y cómo se consiguen: `docs/02-apis.md`. Copia
`.env.ejemplo` como `.env` y rellénalo.

### Ver la película entera en minutos

```
npm run demo          # precios inventados, reloj a ×600: un día pasa en 2,4 min
npm run demo-rapida   # 60 días simulados sin panel en ~25 s, con comprobaciones
```

### Comprobar que todo cuadra

```
npm test              # ~400 pruebas
npm run probar        # casos conocidos (contabilidad, riesgo, indicadores…) + demo corta
```

Detrás de un proxy corporativo, arranca con `npm run start-proxy` en vez de
`npm start`: hace que Node use el proxy de las variables del sistema. Hace
falta Node 22.21 o posterior (en Node 20 no existen ni la variable
`NODE_USE_ENV_PROXY` ni el flag `--use-env-proxy`). Las variables del proxy
van en el sistema, no en el `.env`: Node las lee al arrancar.

## Qué hay dentro

| Documento | Qué cuenta |
|---|---|
| `docs/01-agentes.md` | Los departamentos, los agentes, qué decide cada uno de verdad, cómo se hablan, el comité y el Megáfono |
| `docs/02-apis.md` | Qué APIs hacen falta, qué cuestan y qué pasa con cada combinación de claves |
| `docs/03-viabilidad.md` | **¿Puede ganar dinero?** La respuesta honesta, con fuentes y con nuestro backtest real |
| `docs/04-riesgo-y-mejora.md` | Límites duros, stops, kill switch, y cómo se mejora solo sin engañarse |
| `docs/ARQUITECTURA.md` | El contrato técnico entre módulos (para quien toque el código) |
| `docs/investigacion/` | Ficha verificada de la API de Alpaca, propuestas de diseño, informe escéptico y los informes de construcción |

## La botonera

| Botón | Qué hace |
|---|---|
| Comité | Convoca el comité ahora |
| Megáfono | Le dices al fondo algo en castellano («pausa SOL 6 horas»). Te enseña la directiva y solo entra si pulsas Aplicar. Solo puede apretar, nunca aflojar. Sin duración, dura hasta el comité siguiente |
| Resultados | El fondo frente a sus carteras sombra (comprar y mantener y «mismas mesas sin comité»), si el comité aporta algo, las mesas con su nota, el capital sin asignar y el laboratorio |
| Prueba | Comprueba bróker, datos, índice de miedo y codicia, y la IA. Si escribes PRUEBA, compra y vende 15 $ de BTC |
| Pausar todo | Solo se cierran posiciones hasta que reabras |
| Reabrir | Escribiendo REABRIR, si las posiciones cuadran con el bróker. Sale de la pausa y del bloqueo del kill; el «solo cerrar» por la pérdida del día no se reabre (dura hasta las 00:00 UTC). No borra el máximo histórico: la caída se sigue contando desde él |
| Kill switch | Escribiendo KILL: cancela todo, cierra todo y deja el fondo bloqueado, también tras reiniciar |
| Ajustes | Tope de gasto en IA, modelos y velocidad de la demo. Los límites de riesgo solo se ven |

## Tres avisos

1. **Con el ordenador apagado no hay stops.** Alpaca no tiene órdenes stop
   simples para cripto; el sistema vigila los stops cada minuto. Para dejarlo
   meses, un servidor pequeño siempre encendido.
2. **La cuenta paper llena mejor que la realidad.** El sistema resta un 0,1 %
   por lado al medirse para no engañarse.
3. **Los límites de riesgo son una propuesta.** Están razonados en
   `docs/04-riesgo-y-mejora.md`, pero las reglas de dinero son tuyas: revísalas
   en `src/config.js`.

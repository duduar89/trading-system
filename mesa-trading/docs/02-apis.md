# Qué APIs hacen falta

Resumen: **para verlo funcionar no hace falta ninguna clave**. Con dos claves
gratuitas (Alpaca paper) opera de verdad en una cuenta demo de 100.000 $. Con
una tercera (Claude) los agentes redactan y el comité decide con IA.

| API | ¿Obligatoria? | Coste | Para qué | Cómo se consigue |
|---|---|---|---|---|
| **Alpaca — datos de cripto** | No lleva clave | Gratis | Precios y velas de BTC, ETH, SOL, LINK, AVAX y DOGE | Nada: es pública |
| **alternative.me — miedo y codicia** | No lleva clave | Gratis | El índice F&G de la barra superior y su histórico (para probar filtros en el laboratorio) | Nada: es pública |
| **Alpaca — trading paper** | Para operar en Alpaca | Gratis | Cuenta demo con 100.000 $: órdenes, posiciones, cuenta. Da también acciones/ETF (feed IEX) y noticias | alpaca.markets → crear cuenta → «Paper Trading» → «API Keys» → generar. Son dos cadenas: *Key ID* y *Secret Key* |
| **Anthropic (Claude)** | Opcional | De pago por uso, con tope diario que tú fijas (2 $/día por defecto) | Comité de inversión, clasificación de noticias, lecciones del post-mortem, interpretar el Megáfono | console.anthropic.com → API Keys |

## Qué pasa con cada combinación

| Claves en `.env` | Modo | Qué hace |
|---|---|---|
| Ninguna | `simulado` | Precios **reales** de cripto, bróker **simulado** interno con 100.000 $ que imita a Alpaca (comisión 0,25 %, deslizamiento). Los agentes hablan con frases hechas a partir de los datos. |
| Alpaca | `alpaca` | Opera en tu **cuenta paper de Alpaca** (100.000 $ de mentira). Añade mesas de ETF (SPY, QQQ, IWM, TLT, GLD) y noticias. |
| Alpaca + Claude | `alpaca` con IA | Lo anterior + comité con Claude, noticias clasificadas, lecciones redactadas. |
| — | `sintetico` (`npm run demo`) | Precios inventados y reloj acelerado: un día pasa en unos minutos. Sirve para ver el sistema entero moverse. |

## El fichero `.env`

Se crea en la carpeta `mesa-trading/` (hay un ejemplo en `.env.ejemplo`). **Nunca
se sube a git** (está en `.gitignore`).

```
ALPACA_API_KEY_ID=PK...
ALPACA_API_SECRET_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
LLM_PRESUPUESTO_DIA_USD=2
```

Opcionales: `LLM_MODELO_COMITE` y `LLM_MODELO_AGENTES` (por defecto
`claude-opus-5-5`; con `claude-haiku-4-5` en los agentes el gasto baja unas
cuatro veces), `PUERTO` (8765), `PANEL_TOKEN` (si vas a abrir el panel desde
otro ordenador), `COMITE_HORAS` (4).

## Límites que conviene saber

- Alpaca admite 200 peticiones por minuto; el sistema se queda en 180.
- Las velas de 4 horas de Alpaca vienen de una semana en una semana: el primer
  arranque tarda unos minutos en bajar el histórico y luego queda en caché
  (`data/cache/`).
- **Solo papel.** El código no conoce la dirección de la cuenta real de Alpaca
  y se niega a arrancar con otra que no sea la de paper.
- La cuenta paper de Alpaca no simula deslizamiento ni colas: llena mejor que la
  realidad. Por eso el sistema resta un 0,1 % por lado al medir las mesas.

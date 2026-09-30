# Qué APIs hacen falta

Resumen: **para verlo funcionar no hace falta ninguna clave**. Con dos claves
gratuitas (Alpaca paper) opera de verdad en una cuenta demo de 100.000 $. Con
una tercera (Claude) los agentes redactan y el comité decide con IA.

| API | ¿Obligatoria? | Coste | Para qué | Cómo se consigue |
|---|---|---|---|---|
| **Alpaca — datos de cripto** | No lleva clave | Gratis | Precios y velas de BTC, ETH, SOL, LINK, AVAX y DOGE | Nada: es pública |
| **alternative.me — miedo y codicia** | No lleva clave | Gratis | El índice F&G de la barra superior y su histórico (para probar filtros en el laboratorio) | Nada: es pública |
| **Alpaca — trading paper** | Para operar en Alpaca | Gratis | Cuenta demo con 100.000 $: órdenes, posiciones, cuenta. Da también acciones/ETF (feed IEX) y noticias | alpaca.markets → crear cuenta → «Paper Trading» → «API Keys» → generar. Son dos cadenas: *Key ID* y *Secret Key* |
| **Anthropic (Claude)** | Opcional | De pago por uso, con tope diario que tú fijas (1 $/día por defecto) | Comité de inversión, clasificación de noticias, lecciones del post-mortem, interpretar el Megáfono | console.anthropic.com → API Keys |

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
LLM_PRESUPUESTO_DIA_USD=1
```

Opcionales: `LLM_MODELO_COMITE` (por defecto `claude-opus-5-5`: el comité es
el único que decide algo) y `LLM_MODELO_AGENTES` (por defecto
`claude-haiku-4-5`: solo redactan y clasifican con listas cerradas; Haiku
cuesta 1 $ y 5 $ por millón de tokens de entrada y salida, frente a 4 $ y 20 $
de Opus 5.5). Lo gastado de verdad queda en `data/llm-costes.jsonl` y se ve en
Ajustes. Si tu `.env` es de antes del 30 de septiembre de 2026 y dice
`LLM_PRESUPUESTO_DIA_USD=2`, manda el `.env`: cámbialo a 1 si quieres el tope
nuevo. `PUERTO` (8765), `HOST` (127.0.0.1: el panel solo se abre desde
este ordenador), `PANEL_TOKEN`, `COMITE_HORAS` (4). Abrir el panel a la red
(`HOST=0.0.0.0` o una IP de la wifi) exige un `PANEL_TOKEN` largo: sin él la
mesa no arranca, porque cualquiera en la misma red podría pausar, reabrir o
lanzar el kill. Con token, el panel se abre con `?token=…` en la URL.

## Límites que conviene saber

- Alpaca admite 200 peticiones por minuto; el sistema se queda en 180.
- Las velas de 4 horas de Alpaca vienen de una semana en una semana: el primer
  arranque tarda unos minutos en bajar el histórico y luego queda en caché
  (`data/cache/`).
- **Solo papel.** El código no conoce la dirección de la cuenta real de Alpaca
  y se niega a arrancar con otra que no sea la de paper.
- La cuenta paper de Alpaca no simula deslizamiento ni colas: llena mejor que la
  realidad. Por eso el sistema resta un 0,1 % por lado al medir las mesas.

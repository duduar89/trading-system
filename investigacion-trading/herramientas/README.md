# Herramientas

Tres scripts en Python 3.10+ **sin dependencias** (solo librería estándar). No necesitan claves de API: solo leen datos públicos o hacen cálculos. **No ejecutan órdenes.** Esa parte la tienes que construir tú, con cuidado.

```bash
cd investigacion-trading/herramientas
python3 -m unittest discover -s tests      # 25 tests, sin red
```

## `cuotas.py`: apuestas con matemáticas

Para value betting, surebets y matched betting (sección 2 del informe).

```bash
# Quitar el margen a una línea "sharp" (Pinnacle) con 4 métodos
python3 cuotas.py devig 2.10 3.40 3.60

# ¿Tiene valor la cuota 2.30 de una casa blanda para el local? EV + Kelly fraccional
python3 cuotas.py ev --justas 2.10 3.40 3.60 --seleccion 0 --cuota 2.30 --banca 1000
#  -> EV +5.49 % por euro, Kelly x0.25 = 1.06 % de la banca

# ¿Es surebet la mejor cuota de cada resultado?
python3 cuotas.py surebet 2.25 3.60 3.90 --total 100

# Matched betting: convertir una apuesta gratis de 25 € (SNR) usando un exchange
python3 cuotas.py matched --back 4.0 --lay 4.2 --stake 25 --tipo freebet --comision 0.02
#  -> +17.58 € pase lo que pase (conversión 70 %)
```

Métodos de devig: `multiplicativo` (el ingenuo), `aditivo`, `power` y `shin`. Shin suele ser el más fiel en fútbol porque corrige el sesgo favorito-longshot. Las casas cobran más margen en los underdogs.

## `funding.py`: carry delta-neutral en perpetuos cripto

Para la estrategia de funding (sección 3). Lee OKX, Hyperliquid, Binance y Bybit. Si un exchange bloquea tu IP, se salta.

```bash
python3 funding.py                           # top funding positivo, con neto tras comisiones
python3 funding.py --spread                  # diferenciales entre exchanges
python3 funding.py --historico ETH --dias 30 # media REAL de los últimos 30 días
python3 funding.py --exchanges okx hyperliquid --min-volumen 5e6 --comision 0.003 --dias 60
```

Ejemplo real (25-sep-2026). ETH en los últimos 30 días: Hyperliquid, media anualizada del 10,05 %, positivo el 96 % de las horas. OKX, 5,36 %, positivo el 92 % de los periodos.

Los números de la tabla "top" son la **foto de ahora mismo** anualizada. Un 300 % anual en una altcoin suele ser un pico de horas, no un rendimiento. Decide con `--historico`.

## `robustez.py`: ¿tu backtest es suerte?

Para cualquier estrategia que backtestees (secciones 5 y 6). Implementa el Probabilistic Sharpe Ratio, el Deflated Sharpe Ratio y el Minimum Track Record Length (Bailey y López de Prado).

```bash
python3 robustez.py retornos.csv --columna ret --ensayos 200 --periodos-anio 252
```

```
Sharpe anualizado: 0.75
PSR (P[Sharpe real > 0]): 90.1 %
Con 200 ensayos, la suerte sola daría un Sharpe anualizado de ~1.60
DSR (P[Sharpe real > suerte]): 7.0 %  -> NO concluyente: probablemente sobreajuste
Track record mínimo para Sharpe > 0 al 95 %: 1231 periodos (~4.9 años)
```

`--ensayos` es **el número total de variantes que probaste**, incluidas las que tiraste. Mentirte aquí es mentirte a ti mismo.

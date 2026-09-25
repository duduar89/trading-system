#!/usr/bin/env python3
"""¿Tu backtest es suerte? Sharpe probabilístico (PSR), Sharpe deflactado (DSR) y
track record mínimo, según Bailey y López de Prado (2012, 2014).

El error nº 1 de los programadores que hacen trading: probar 500 combinaciones de
parámetros, quedarse con la mejor y creer que su Sharpe de 2 es real. El DSR corrige
por el número de pruebas que has hecho y por colas gordas/asimetría de los retornos.

Solo librería estándar. Ejemplos:

    # retornos diarios en un CSV (columna "ret"), probaste 200 variantes
    python robustez.py retornos.csv --columna ret --ensayos 200 --periodos-anio 252

    # si guardaste el Sharpe (no anualizado) de cada variante, mejor aún:
    python robustez.py retornos.csv --columna ret --sharpes-ensayos sharpes.txt
"""
from __future__ import annotations

import argparse
import csv
import math
import statistics
from dataclasses import dataclass
from statistics import NormalDist
from typing import Sequence

EULER_GAMMA = 0.5772156649015329
_N = NormalDist()


@dataclass
class Momentos:
    sharpe: float      # por periodo (NO anualizado)
    asimetria: float
    curtosis: float    # curtosis "normal" (3 para una gaussiana), no el exceso
    n: int


def momentos(retornos: Sequence[float]) -> Momentos:
    n = len(retornos)
    if n < 3:
        raise ValueError("hacen falta al menos 3 retornos")
    media = statistics.fmean(retornos)
    desv = statistics.pstdev(retornos, media)
    if desv == 0:
        raise ValueError("los retornos no tienen varianza")
    m3 = sum((r - media) ** 3 for r in retornos) / n
    m4 = sum((r - media) ** 4 for r in retornos) / n
    return Momentos(media / desv, m3 / desv**3, m4 / desv**4, n)


def _denominador(m: Momentos) -> float:
    v = 1.0 - m.asimetria * m.sharpe + (m.curtosis - 1.0) / 4.0 * m.sharpe**2
    if v <= 0:
        raise ValueError("momentos inconsistentes (varianza del Sharpe <= 0)")
    return math.sqrt(v)


def psr(m: Momentos, sharpe_referencia: float = 0.0) -> float:
    """Probabilidad de que el Sharpe real supere `sharpe_referencia` (ambos por periodo)."""
    z = (m.sharpe - sharpe_referencia) * math.sqrt(m.n - 1) / _denominador(m)
    return _N.cdf(z)


def sharpe_maximo_esperado(var_sharpes: float, ensayos: int) -> float:
    """Sharpe máximo que esperarías por pura suerte tras `ensayos` pruebas independientes
    con Sharpe real 0 (por periodo)."""
    if ensayos < 2:
        return 0.0
    return math.sqrt(var_sharpes) * (
        (1.0 - EULER_GAMMA) * _N.inv_cdf(1.0 - 1.0 / ensayos)
        + EULER_GAMMA * _N.inv_cdf(1.0 - 1.0 / (ensayos * math.e))
    )


def dsr(m: Momentos, ensayos: int, var_sharpes: float | None = None) -> tuple[float, float]:
    """Deflated Sharpe Ratio. Devuelve (probabilidad, Sharpe de referencia usado).

    Si no das la varianza de los Sharpes de tus pruebas, se aproxima con la varianza
    muestral del estimador del Sharpe, 1/(n-1)·(1 - γ3·SR + (γ4-1)/4·SR²). Es una
    cota optimista: si tus variantes eran muy distintas entre sí, el DSR real es peor.
    """
    if var_sharpes is None:
        var_sharpes = _denominador(m) ** 2 / (m.n - 1)
    ref = sharpe_maximo_esperado(var_sharpes, ensayos)
    return psr(m, ref), ref


def track_record_minimo(m: Momentos, sharpe_referencia: float = 0.0, confianza: float = 0.95) -> float:
    """Nº mínimo de periodos para afirmar con `confianza` que el Sharpe real > referencia."""
    if m.sharpe <= sharpe_referencia:
        return math.inf
    z = _N.inv_cdf(confianza)
    return 1.0 + _denominador(m) ** 2 * (z / (m.sharpe - sharpe_referencia)) ** 2


def leer_columna(ruta: str, columna: str | None) -> list[float]:
    with open(ruta, newline="") as f:
        filas = list(csv.reader(f))
    if not filas:
        raise ValueError("CSV vacío")
    cabecera = filas[0]
    if columna is None:
        idx = 0
    elif columna.isdigit():
        idx = int(columna)
    else:
        idx = cabecera.index(columna)
    try:
        float(cabecera[idx])
        datos = filas
    except ValueError:
        datos = filas[1:]
    return [float(r[idx]) for r in datos if len(r) > idx and r[idx].strip() not in ("", "nan", "NaN")]


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", help="CSV con retornos simples por periodo (0.01 = +1 %%)")
    ap.add_argument("--columna", help="nombre o índice de la columna (por defecto la primera)")
    ap.add_argument("--ensayos", type=int, default=1, help="cuántas variantes/parámetros probaste en total")
    ap.add_argument("--sharpes-ensayos", help="fichero con el Sharpe por periodo de cada variante (uno por línea)")
    ap.add_argument("--periodos-anio", type=float, default=252, help="252 diario, 52 semanal, 12 mensual, 8760 horario")
    a = ap.parse_args(argv)

    rets = leer_columna(a.csv, a.columna)
    m = momentos(rets)
    anualiza = math.sqrt(a.periodos_anio)
    print(f"Observaciones: {m.n}")
    print(f"Sharpe anualizado: {m.sharpe * anualiza:.2f}   (por periodo {m.sharpe:.4f})")
    print(f"Asimetría: {m.asimetria:+.2f}   Curtosis: {m.curtosis:.2f} (3 = normal)")
    print(f"PSR (P[Sharpe real > 0]): {psr(m) * 100:.1f} %")

    var = None
    ensayos = a.ensayos
    if a.sharpes_ensayos:
        with open(a.sharpes_ensayos) as f:
            sharpes = [float(x) for x in f if x.strip()]
        ensayos = len(sharpes)
        var = statistics.variance(sharpes)
    if ensayos > 1:
        p, ref = dsr(m, ensayos, var)
        print(f"Con {ensayos} ensayos, la suerte sola daría un Sharpe anualizado de ~{ref * anualiza:.2f}")
        print(f"DSR (P[Sharpe real > suerte]): {p * 100:.1f} %  -> "
              + ("aceptable (>95 %)" if p > 0.95 else "NO concluyente: probablemente sobreajuste"))
    trl = track_record_minimo(m)
    if math.isfinite(trl):
        print(f"Track record mínimo para Sharpe > 0 al 95 %: {trl:.0f} periodos (~{trl / a.periodos_anio:.1f} años)")
    else:
        print("Sharpe <= 0: no hay track record que lo salve.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

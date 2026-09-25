#!/usr/bin/env python3
"""Calculadora de apuestas para programadores: quitar el margen (devig), EV, Kelly,
surebets y matched betting.

Solo usa la librería estándar. Ejemplos:

    # Probabilidades "justas" de un 1X2 de Pinnacle quitando el margen (método Shin)
    python cuotas.py devig 2.10 3.40 3.60 --metodo shin

    # ¿Tiene valor pagar 2.30 por el local si Pinnacle marca 2.10 / 3.40 / 3.60?
    python cuotas.py ev --justas 2.10 3.40 3.60 --seleccion 0 --cuota 2.30 --banca 1000

    # ¿Es surebet la mejor cuota de cada resultado en distintas casas?
    python cuotas.py surebet 2.25 3.60 3.90 --total 100

    # Matched betting: apuesta gratis de 25 EUR en la casa a 4.0, lay en exchange a 4.2
    python cuotas.py matched --back 4.0 --lay 4.2 --stake 25 --tipo freebet --comision 0.02
"""
from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from typing import Callable, Sequence

# ---------------------------------------------------------------------------
# Quitar el margen de la casa ("devig")
# ---------------------------------------------------------------------------


def implicitas(cuotas: Sequence[float]) -> list[float]:
    """Probabilidades implícitas crudas (suman más de 1 por el margen)."""
    if any(c <= 1.0 for c in cuotas):
        raise ValueError("todas las cuotas decimales deben ser > 1.0")
    return [1.0 / c for c in cuotas]


def margen(cuotas: Sequence[float]) -> float:
    """Overround: 0.05 significa un 5 % de margen."""
    return sum(implicitas(cuotas)) - 1.0


def _biseccion(f: Callable[[float], float], lo: float, hi: float, tol: float = 1e-12) -> float:
    flo = f(lo)
    for _ in range(200):
        mid = (lo + hi) / 2.0
        fmid = f(mid)
        if abs(fmid) < tol:
            return mid
        if (fmid > 0) == (flo > 0):
            lo, flo = mid, fmid
        else:
            hi = mid
    return (lo + hi) / 2.0


def devig_multiplicativo(cuotas: Sequence[float]) -> list[float]:
    """Reparte el margen proporcionalmente. Sencillo, pero sobrevalora a los favoritos."""
    q = implicitas(cuotas)
    s = sum(q)
    return [x / s for x in q]


def devig_aditivo(cuotas: Sequence[float]) -> list[float]:
    """Resta el mismo margen a cada resultado. Puede dar negativos con underdogs extremos."""
    q = implicitas(cuotas)
    exceso = (sum(q) - 1.0) / len(q)
    p = [x - exceso for x in q]
    if any(x <= 0 for x in p):
        raise ValueError("el método aditivo da probabilidades negativas; usa power o shin")
    return p


def devig_power(cuotas: Sequence[float]) -> list[float]:
    """Busca k tal que sum(q_i^k) = 1. Corrige el sesgo favorito-longshot."""
    q = implicitas(cuotas)
    if abs(sum(q) - 1.0) < 1e-12:
        return list(q)
    k = _biseccion(lambda k: sum(x**k for x in q) - 1.0, 0.01, 50.0)
    return [x**k for x in q]


def devig_shin(cuotas: Sequence[float]) -> list[float]:
    """Modelo de Shin (1993): supone una fracción z de apostantes con información privilegiada.

    Suele ser el más preciso en mercados con sesgo favorito-longshot (fútbol, caballos).
    """
    q = implicitas(cuotas)
    s = sum(q)
    if abs(s - 1.0) < 1e-12:
        return list(q)

    def probs(z: float) -> list[float]:
        return [(math.sqrt(z * z + 4.0 * (1.0 - z) * x * x / s) - z) / (2.0 * (1.0 - z)) for x in q]

    z = _biseccion(lambda z: sum(probs(z)) - 1.0, 0.0, 0.999)
    return probs(z)


METODOS: dict[str, Callable[[Sequence[float]], list[float]]] = {
    "multiplicativo": devig_multiplicativo,
    "aditivo": devig_aditivo,
    "power": devig_power,
    "shin": devig_shin,
}


def cuota_justa(p: float) -> float:
    return 1.0 / p


# ---------------------------------------------------------------------------
# Valor esperado y Kelly
# ---------------------------------------------------------------------------


def valor_esperado(p: float, cuota: float) -> float:
    """EV por euro apostado: 0.05 = +5 % de rendimiento esperado."""
    return p * cuota - 1.0


def kelly(p: float, cuota: float) -> float:
    """Fracción de banca de Kelly completo. Negativa = no apostar."""
    return (p * cuota - 1.0) / (cuota - 1.0)


# ---------------------------------------------------------------------------
# Surebets (arbitraje entre casas)
# ---------------------------------------------------------------------------


@dataclass
class Surebet:
    es_surebet: bool
    suma_implicitas: float
    beneficio_pct: float
    stakes: list[float]
    retorno: float


def surebet(mejores_cuotas: Sequence[float], total: float = 100.0) -> Surebet:
    """Con la mejor cuota de cada resultado (de casas distintas), reparte `total`
    para cobrar lo mismo pase lo que pase."""
    q = implicitas(mejores_cuotas)
    s = sum(q)
    stakes = [total * x / s for x in q]
    retorno = total / s
    return Surebet(s < 1.0, s, (retorno / total - 1.0) * 100.0, stakes, retorno)


# ---------------------------------------------------------------------------
# Matched betting (bonos de casas con licencia + exchange)
# ---------------------------------------------------------------------------


@dataclass
class Matched:
    lay_stake: float
    responsabilidad: float
    gana_back: float
    gana_lay: float


def matched_bet(back: float, lay: float, stake: float, comision: float = 0.02, tipo: str = "normal") -> Matched:
    """Iguala una apuesta a favor en la casa (back) con una en contra en el exchange (lay).

    tipo="normal":   apuesta calificante con dinero real (pierdes un poco para liberar el bono).
    tipo="freebet":  apuesta gratis en la que no se devuelve el stake (SNR), lo habitual en España.
    Devuelve el resultado neto en cada escenario; en un buen matched ambos son casi iguales.
    """
    if tipo not in ("normal", "freebet"):
        raise ValueError("tipo debe ser 'normal' o 'freebet'")
    if lay <= 1.0 or back <= 1.0:
        raise ValueError("cuotas deben ser > 1.0")
    ganancia_back_bruta = stake * (back - 1.0) if tipo == "freebet" else stake * back
    lay_stake = ganancia_back_bruta / (lay - comision)
    responsabilidad = lay_stake * (lay - 1.0)
    coste_back = 0.0 if tipo == "freebet" else stake
    # Gana la selección en la casa: cobras el back, pagas la responsabilidad del lay.
    gana_back = stake * (back - 1.0) - responsabilidad
    # Pierde la selección: cobras el lay (menos comisión), pierdes el stake si era dinero real.
    gana_lay = lay_stake * (1.0 - comision) - coste_back
    return Matched(lay_stake, responsabilidad, gana_back, gana_lay)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _fmt_pct(x: float) -> str:
    return f"{x * 100:+.2f} %"


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("devig", help="probabilidades justas quitando el margen")
    d.add_argument("cuotas", type=float, nargs="+")
    d.add_argument("--metodo", choices=[*METODOS, "todos"], default="todos")

    e = sub.add_parser("ev", help="valor esperado y Kelly de una cuota frente a una referencia sharp")
    e.add_argument("--justas", type=float, nargs="+", required=True, help="cuotas de referencia (p.ej. Pinnacle) de TODOS los resultados")
    e.add_argument("--seleccion", type=int, required=True, help="índice (0, 1, 2...) del resultado que quieres apostar")
    e.add_argument("--cuota", type=float, required=True, help="cuota que te ofrece la casa blanda")
    e.add_argument("--metodo", choices=list(METODOS), default="shin")
    e.add_argument("--banca", type=float, default=0.0)
    e.add_argument("--fraccion-kelly", type=float, default=0.25)

    s = sub.add_parser("surebet", help="comprobar arbitraje con la mejor cuota de cada resultado")
    s.add_argument("cuotas", type=float, nargs="+")
    s.add_argument("--total", type=float, default=100.0)

    m = sub.add_parser("matched", help="calcular un matched bet con un exchange")
    m.add_argument("--back", type=float, required=True)
    m.add_argument("--lay", type=float, required=True)
    m.add_argument("--stake", type=float, required=True)
    m.add_argument("--comision", type=float, default=0.02, help="comisión del exchange sobre ganancias (0.02 = 2 %%)")
    m.add_argument("--tipo", choices=["normal", "freebet"], default="normal")

    a = ap.parse_args(argv)

    if a.cmd == "devig":
        print(f"Margen de la casa: {margen(a.cuotas) * 100:.2f} %")
        metodos = METODOS if a.metodo == "todos" else {a.metodo: METODOS[a.metodo]}
        for nombre, fn in metodos.items():
            try:
                p = fn(a.cuotas)
            except ValueError as exc:
                print(f"{nombre:>15}: {exc}")
                continue
            cols = "  ".join(f"p={x:.4f} (justa {cuota_justa(x):.3f})" for x in p)
            print(f"{nombre:>15}: {cols}")
    elif a.cmd == "ev":
        p = METODOS[a.metodo](a.justas)[a.seleccion]
        ev = valor_esperado(p, a.cuota)
        k = kelly(p, a.cuota)
        print(f"Probabilidad justa ({a.metodo}): {p:.4f}  -> cuota justa {cuota_justa(p):.3f}")
        print(f"Cuota ofrecida {a.cuota:.3f}: EV {_fmt_pct(ev)} por euro apostado")
        if k <= 0:
            print("Kelly <= 0: no hay valor, no apuestes.")
        else:
            print(f"Kelly completo: {k * 100:.2f} % de la banca; Kelly x{a.fraccion_kelly}: {k * a.fraccion_kelly * 100:.2f} %")
            if a.banca > 0:
                print(f"Stake sugerido con banca {a.banca:.2f}: {a.banca * k * a.fraccion_kelly:.2f}")
    elif a.cmd == "surebet":
        r = surebet(a.cuotas, a.total)
        print(f"Suma de probabilidades implícitas: {r.suma_implicitas:.4f}")
        if r.es_surebet:
            print(f"SUREBET: beneficio garantizado {r.beneficio_pct:.2f} % (retorno {r.retorno:.2f} sobre {a.total:.2f})")
        else:
            print(f"No es surebet (perderías {-r.beneficio_pct:.2f} %)")
        for i, (c, st) in enumerate(zip(a.cuotas, r.stakes)):
            print(f"  resultado {i}: cuota {c:.3f} -> apostar {st:.2f}")
    elif a.cmd == "matched":
        r = matched_bet(a.back, a.lay, a.stake, a.comision, a.tipo)
        print(f"Lay stake: {r.lay_stake:.2f}  (responsabilidad en el exchange: {r.responsabilidad:.2f})")
        print(f"Si gana la selección en la casa: {r.gana_back:+.2f}")
        print(f"Si pierde la selección:         {r.gana_lay:+.2f}")
        if a.tipo == "freebet":
            print(f"Conversión de la apuesta gratis: {min(r.gana_back, r.gana_lay) / a.stake * 100:.1f} %")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

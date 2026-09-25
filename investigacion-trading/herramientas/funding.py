#!/usr/bin/env python3
"""Escáner de funding rates de perpetuos para evaluar carry delta-neutral.

Dos estrategias que mide:

1. Cash-and-carry: comprar el spot y vender el perpetuo del mismo activo. Cobras el funding
   mientras sea positivo; no te importa si el precio sube o baja.
2. Spread entre exchanges: corto en el exchange que paga más funding, largo en el que paga
   menos. Cobras la diferencia.

Lo que NO te dice (y te puede arruinar): riesgo de contraparte del exchange, auto-deleveraging,
liquidación de la pata corta si el margen es escaso, depegs del colateral, y que el funding
cambia de signo. Mira siempre la media histórica, no la foto de hoy.

Solo lee APIs públicas (no necesita claves). Ejemplos:

    python funding.py                         # top por funding anualizado en todos los exchanges
    python funding.py --spread                # mejores diferenciales entre exchanges
    python funding.py --historico ETH --dias 30   # media real de los últimos 30 días
    python funding.py --exchanges okx hyperliquid --min-volumen 5e6

Binance y Bybit bloquean algunas IPs (p. ej. EE. UU.); si un exchange falla se ignora.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable

HORAS_ANIO = 24 * 365
UA = {"User-Agent": "funding-scanner/1.0", "Content-Type": "application/json"}


def _get(url: str, timeout: float = 15.0):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _post(url: str, body: dict, timeout: float = 15.0):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=UA, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


@dataclass
class Funding:
    exchange: str
    activo: str          # BTC, ETH... (normalizado)
    simbolo: str         # símbolo nativo del exchange
    tasa: float          # tasa del periodo actual/último (0.0001 = 0,01 %)
    horas_periodo: float  # cada cuántas horas se cobra
    volumen_usd: float | None = None

    @property
    def anual(self) -> float:
        """Funding anualizado simple (sin capitalizar)."""
        return self.tasa * HORAS_ANIO / self.horas_periodo


# ---------------------------------------------------------------------------
# Adaptadores por exchange (solo perpetuos lineales contra USDT/USDC/USD)
# ---------------------------------------------------------------------------


def okx() -> list[Funding]:
    data = _get("https://www.okx.com/api/v5/public/funding-rate?instId=ANY")["data"]
    vols = {}
    try:
        for t in _get("https://www.okx.com/api/v5/market/tickers?instType=SWAP")["data"]:
            # volCcy24h va en la moneda base; lo pasamos a USD con el último precio
            vols[t["instId"]] = float(t.get("volCcy24h") or 0) * float(t.get("last") or 0)
    except (urllib.error.URLError, KeyError, ValueError):
        pass
    out = []
    for d in data:
        inst = d["instId"]
        if not inst.endswith("-USDT-SWAP"):
            continue
        horas = (int(d["nextFundingTime"]) - int(d["fundingTime"])) / 3_600_000 or 8.0
        out.append(Funding("okx", inst.split("-")[0], inst, float(d["fundingRate"]), horas, vols.get(inst)))
    return out


def hyperliquid() -> list[Funding]:
    meta, ctxs = _post("https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"})
    out = []
    for u, c in zip(meta["universe"], ctxs):
        if u.get("isDelisted"):
            continue
        # Hyperliquid cobra funding cada hora
        out.append(Funding("hyperliquid", u["name"], u["name"], float(c["funding"]), 1.0, float(c.get("dayNtlVlm") or 0)))
    return out


def binance() -> list[Funding]:
    idx = _get("https://fapi.binance.com/fapi/v1/premiumIndex")
    intervalos = {}
    try:
        for f in _get("https://fapi.binance.com/fapi/v1/fundingInfo"):
            intervalos[f["symbol"]] = float(f["fundingIntervalHours"])
    except (urllib.error.URLError, KeyError, ValueError):
        pass
    vols = {}
    try:
        for t in _get("https://fapi.binance.com/fapi/v1/ticker/24hr"):
            vols[t["symbol"]] = float(t["quoteVolume"])
    except (urllib.error.URLError, KeyError, ValueError):
        pass
    out = []
    for d in idx:
        s = d["symbol"]
        if not s.endswith("USDT"):
            continue
        out.append(Funding("binance", s[:-4], s, float(d["lastFundingRate"]), intervalos.get(s, 8.0), vols.get(s)))
    return out


def bybit() -> list[Funding]:
    base = "https://api.bybit.com/v5/market"
    intervalos = {}
    cursor = ""
    while True:
        r = _get(f"{base}/instruments-info?category=linear&limit=1000&cursor={cursor}")["result"]
        for i in r["list"]:
            intervalos[i["symbol"]] = float(i.get("fundingInterval") or 480) / 60.0
        cursor = r.get("nextPageCursor") or ""
        if not cursor:
            break
    out = []
    for t in _get(f"{base}/tickers?category=linear")["result"]["list"]:
        s = t["symbol"]
        if not s.endswith("USDT") or not t.get("fundingRate"):
            continue
        out.append(Funding("bybit", s[:-4], s, float(t["fundingRate"]), intervalos.get(s, 8.0), float(t.get("turnover24h") or 0)))
    return out


EXCHANGES: dict[str, Callable[[], list[Funding]]] = {
    "okx": okx,
    "hyperliquid": hyperliquid,
    "binance": binance,
    "bybit": bybit,
}


def recoger(nombres: Iterable[str]) -> list[Funding]:
    todo: list[Funding] = []
    for n in nombres:
        try:
            filas = EXCHANGES[n]()
            todo.extend(filas)
            print(f"  {n}: {len(filas)} perpetuos", file=sys.stderr)
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError, TimeoutError) as exc:
            print(f"  {n}: no disponible ({exc})", file=sys.stderr)
    return todo


# ---------------------------------------------------------------------------
# Histórico: la foto de hoy engaña, la media de 30 días mucho menos
# ---------------------------------------------------------------------------


def historico_hyperliquid(activo: str, dias: int) -> list[float]:
    """Tasas horarias de los últimos `dias` días (la API devuelve máx. 500 por llamada)."""
    fin = int(time.time() * 1000)
    inicio = fin - dias * 86_400_000
    tasas: list[float] = []
    while inicio < fin:
        lote = _post("https://api.hyperliquid.xyz/info", {"type": "fundingHistory", "coin": activo, "startTime": inicio})
        if not lote:
            break
        tasas.extend(float(x["fundingRate"]) for x in lote)
        ultimo = lote[-1]["time"]
        if ultimo <= inicio:
            break
        inicio = ultimo + 1
    return tasas


def historico_okx(activo: str, dias: int) -> tuple[list[float], float]:
    inst = f"{activo}-USDT-SWAP"
    limite = int(time.time() * 1000) - dias * 86_400_000
    tasas: list[float] = []
    tiempos: list[int] = []
    despues = ""
    while True:
        url = f"https://www.okx.com/api/v5/public/funding-rate-history?instId={inst}&limit=100"
        if despues:
            url += f"&after={despues}"
        lote = _get(url)["data"]
        if not lote:
            break
        for x in lote:
            t = int(x["fundingTime"])
            if t < limite:
                break
            tasas.append(float(x["realizedRate"] or x["fundingRate"]))
            tiempos.append(t)
        else:
            despues = lote[-1]["fundingTime"]
            continue
        break
    horas = 8.0
    if len(tiempos) > 1:
        horas = statistics.median(a - b for a, b in zip(tiempos, tiempos[1:])) / 3_600_000
    return tasas, horas


def resumen_historico(activo: str, dias: int) -> None:
    print(f"Funding histórico de {activo}, últimos {dias} días (anualizado, simple):")
    try:
        hl = historico_hyperliquid(activo, dias)
        if hl:
            pos = sum(1 for x in hl if x > 0) / len(hl)
            print(f"  hyperliquid: media {statistics.mean(hl) * HORAS_ANIO * 100:6.2f} %  "
                  f"({len(hl)} cobros horarios, {pos * 100:.0f} % positivos)")
    except (urllib.error.URLError, KeyError, ValueError) as exc:
        print(f"  hyperliquid: no disponible ({exc})")
    try:
        ok, horas = historico_okx(activo, dias)
        if ok:
            pos = sum(1 for x in ok if x > 0) / len(ok)
            print(f"  okx:         media {statistics.mean(ok) * HORAS_ANIO / horas * 100:6.2f} %  "
                  f"({len(ok)} cobros cada {horas:g} h, {pos * 100:.0f} % positivos)")
    except (urllib.error.URLError, KeyError, ValueError) as exc:
        print(f"  okx: no disponible ({exc})")


# ---------------------------------------------------------------------------
# Salida
# ---------------------------------------------------------------------------


def neto_anual(bruto_anual: float, comision_ida_vuelta: float, dias_mantener: float) -> float:
    """Descuenta comisiones de abrir y cerrar las patas amortizadas en el tiempo que mantienes."""
    return bruto_anual - comision_ida_vuelta * 365.0 / dias_mantener


def mostrar_top(filas: list[Funding], n: int, min_vol: float, comision: float, dias: float) -> None:
    filas = [f for f in filas if (f.volumen_usd or 0) >= min_vol]
    filas.sort(key=lambda f: f.anual, reverse=True)
    print(f"\nTop {n} funding POSITIVO (corto perp + largo spot cobra). Neto con comisiones {comision * 100:.2f} % "
          f"ida y vuelta amortizadas en {dias:g} días:")
    print(f"{'exchange':<12}{'activo':<10}{'tasa':>10}{'cada':>6}{'anual':>10}{'neto':>10}{'vol 24h':>14}")
    for f in filas[:n]:
        print(f"{f.exchange:<12}{f.activo:<10}{f.tasa * 100:>9.4f}%{f.horas_periodo:>5g}h"
              f"{f.anual * 100:>9.1f}%{neto_anual(f.anual, comision, dias) * 100:>9.1f}%"
              f"{(f.volumen_usd or 0) / 1e6:>12.1f}M")


def spreads(filas: list[Funding], min_vol: float) -> list[tuple[float, str, Funding, Funding]]:
    """(spread anual, activo, pata corta, pata larga) ordenado de mayor a menor."""
    por_activo: dict[str, list[Funding]] = {}
    for f in filas:
        if (f.volumen_usd or 0) >= min_vol:
            por_activo.setdefault(f.activo, []).append(f)
    pares = []
    for activo, fs in por_activo.items():
        if len(fs) < 2:
            continue
        alto = max(fs, key=lambda f: f.anual)
        bajo = min(fs, key=lambda f: f.anual)
        if alto.exchange != bajo.exchange:
            pares.append((alto.anual - bajo.anual, activo, alto, bajo))
    pares.sort(key=lambda p: p[0], reverse=True)
    return pares


def mostrar_spreads(filas: list[Funding], n: int, min_vol: float, comision: float, dias: float) -> None:
    pares = spreads(filas, min_vol)
    # Dos patas de perpetuo: el doble de comisiones que un cash-and-carry
    print(f"\nTop {n} spreads entre exchanges (corto donde paga más, largo donde paga menos). "
          f"Neto con 2 x {comision * 100:.2f} % en {dias:g} días:")
    print(f"{'activo':<10}{'corto en':<14}{'anual':>9}{'largo en':>14}{'anual':>9}{'spread':>9}{'neto':>9}")
    for spread, activo, alto, bajo in pares[:n]:
        print(f"{activo:<10}{alto.exchange:<14}{alto.anual * 100:>8.1f}%{bajo.exchange:>14}{bajo.anual * 100:>8.1f}%"
              f"{spread * 100:>8.1f}%{neto_anual(spread, 2 * comision, dias) * 100:>8.1f}%")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exchanges", nargs="+", choices=list(EXCHANGES), default=list(EXCHANGES))
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--min-volumen", type=float, default=10e6, help="volumen 24h mínimo en USD (liquidez)")
    ap.add_argument("--comision", type=float, default=0.002, help="comisiones+slippage de abrir y cerrar (0.002 = 0,2 %%)")
    ap.add_argument("--dias", type=float, default=30, help="días que piensas mantener la posición")
    ap.add_argument("--spread", action="store_true", help="mostrar diferenciales entre exchanges")
    ap.add_argument("--historico", metavar="ACTIVO", help="media histórica real de un activo (BTC, ETH...)")
    a = ap.parse_args(argv)

    if a.historico:
        resumen_historico(a.historico.upper(), int(a.dias))
        return 0

    print("Descargando funding...", file=sys.stderr)
    filas = recoger(a.exchanges)
    if not filas:
        print("Ningún exchange respondió.", file=sys.stderr)
        return 1
    mostrar_top(filas, a.top, a.min_volumen, a.comision, a.dias)
    if a.spread:
        mostrar_spreads(filas, a.top, a.min_volumen, a.comision, a.dias)
    print("\nOjo: un funding alto hoy suele ser un pico que revierte en horas. Antes de entrar, "
          "mira --historico ACTIVO --dias 30.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

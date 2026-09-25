"""Tests sin red: python -m unittest discover -s tests (desde herramientas/)."""
import math
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cuotas  # noqa: E402
import funding  # noqa: E402
import robustez  # noqa: E402

PINNACLE_1X2 = [2.10, 3.40, 3.60]


class TestCuotas(unittest.TestCase):
    def test_margen(self):
        self.assertAlmostEqual(cuotas.margen([2.0, 2.0]), 0.0)
        self.assertAlmostEqual(cuotas.margen(PINNACLE_1X2), 1 / 2.1 + 1 / 3.4 + 1 / 3.6 - 1)

    def test_todos_los_metodos_suman_uno(self):
        for nombre, fn in cuotas.METODOS.items():
            with self.subTest(metodo=nombre):
                p = fn(PINNACLE_1X2)
                self.assertAlmostEqual(sum(p), 1.0, places=9)
                self.assertTrue(all(0 < x < 1 for x in p))

    def test_sin_margen_no_cambia_nada(self):
        for fn in cuotas.METODOS.values():
            self.assertEqual([round(x, 9) for x in fn([2.0, 2.0])], [0.5, 0.5])

    def test_shin_y_power_quitan_mas_margen_al_underdog(self):
        mult = cuotas.devig_multiplicativo([1.25, 4.50])
        for fn in (cuotas.devig_shin, cuotas.devig_power):
            p = fn([1.25, 4.50])
            self.assertGreater(p[0], mult[0])
            self.assertLess(p[1], mult[1])

    def test_aditivo_falla_con_longshot_extremo(self):
        with self.assertRaises(ValueError):
            cuotas.devig_aditivo([1.02, 12.0, 300.0])

    def test_cuota_invalida(self):
        with self.assertRaises(ValueError):
            cuotas.implicitas([1.0, 2.0])

    def test_ev_y_kelly(self):
        self.assertAlmostEqual(cuotas.valor_esperado(0.5, 2.2), 0.1)
        self.assertAlmostEqual(cuotas.kelly(0.5, 2.2), 0.1 / 1.2)
        self.assertLess(cuotas.kelly(0.4, 2.0), 0)

    def test_surebet_iguala_retornos(self):
        r = cuotas.surebet([2.25, 3.60, 3.90], total=100)
        self.assertTrue(r.es_surebet)
        self.assertAlmostEqual(sum(r.stakes), 100)
        for c, s in zip([2.25, 3.60, 3.90], r.stakes):
            self.assertAlmostEqual(c * s, r.retorno)
        self.assertFalse(cuotas.surebet(PINNACLE_1X2).es_surebet)

    def test_matched_normal_iguala_escenarios(self):
        r = cuotas.matched_bet(back=2.0, lay=2.04, stake=50, comision=0.02)
        self.assertAlmostEqual(r.gana_back, r.gana_lay)
        self.assertLess(r.gana_back, 0)  # la calificante cuesta un poco

    def test_matched_freebet_iguala_escenarios(self):
        r = cuotas.matched_bet(back=4.0, lay=4.2, stake=25, comision=0.02, tipo="freebet")
        self.assertAlmostEqual(r.gana_back, r.gana_lay)
        # sin comisión y con back == lay la conversión es exactamente (B-1)/B
        r0 = cuotas.matched_bet(back=5.0, lay=5.0, stake=10, comision=0.0, tipo="freebet")
        self.assertAlmostEqual(r0.gana_back, 10 * 4 / 5)

    def test_cli(self):
        self.assertEqual(cuotas.main(["devig", "2.1", "3.4", "3.6"]), 0)
        self.assertEqual(cuotas.main(["ev", "--justas", "2.1", "3.4", "3.6", "--seleccion", "0", "--cuota", "2.3"]), 0)


def _f(ex, activo, tasa, horas, vol=1e9):
    return funding.Funding(ex, activo, activo, tasa, horas, vol)


class TestFunding(unittest.TestCase):
    def test_anualizado(self):
        self.assertAlmostEqual(_f("x", "BTC", 0.0001, 8).anual, 0.0001 * 3 * 365)
        self.assertAlmostEqual(_f("x", "BTC", 0.0000125, 1).anual, 0.0000125 * 24 * 365)

    def test_neto(self):
        self.assertAlmostEqual(funding.neto_anual(0.20, 0.002, 30), 0.20 - 0.002 * 365 / 30)

    def test_spreads(self):
        filas = [
            _f("okx", "ETH", -0.0001, 8),
            _f("hyperliquid", "ETH", 0.00002, 1),
            _f("okx", "BTC", 0.0001, 8),
            _f("hyperliquid", "BTC", 0.00002, 1),
            _f("okx", "SOLO", 0.01, 8),               # solo en un exchange: sin spread
            _f("hyperliquid", "ILIQ", 0.001, 1, vol=1),  # sin liquidez: filtrado
            _f("okx", "ILIQ", -0.001, 8, vol=1),
        ]
        pares = funding.spreads(filas, min_vol=1e6)
        self.assertEqual([p[1] for p in pares], ["ETH", "BTC"])
        spread, _, corto, largo = pares[0]
        self.assertEqual((corto.exchange, largo.exchange), ("hyperliquid", "okx"))
        self.assertAlmostEqual(spread, corto.anual - largo.anual)

    def test_adaptador_okx(self):
        def fake_get(url, timeout=15.0):
            if "funding-rate" in url:
                return {"data": [
                    {"instId": "BTC-USDT-SWAP", "fundingRate": "0.0001", "fundingTime": "0", "nextFundingTime": str(4 * 3_600_000)},
                    {"instId": "BTC-USD-SWAP", "fundingRate": "0.0001", "fundingTime": "0", "nextFundingTime": "28800000"},
                ]}
            return {"data": [{"instId": "BTC-USDT-SWAP", "volCcy24h": "10", "last": "100000"}]}
        with mock.patch.object(funding, "_get", fake_get):
            filas = funding.okx()
        self.assertEqual(len(filas), 1)
        self.assertEqual((filas[0].activo, filas[0].horas_periodo, filas[0].volumen_usd), ("BTC", 4.0, 1e6))

    def test_adaptador_hyperliquid(self):
        payload = [
            {"universe": [{"name": "BTC"}, {"name": "MATIC", "isDelisted": True}]},
            [{"funding": "0.0000125", "dayNtlVlm": "5e9"}, {"funding": "0.1", "dayNtlVlm": "0"}],
        ]
        with mock.patch.object(funding, "_post", lambda url, body, timeout=15.0: payload):
            filas = funding.hyperliquid()
        self.assertEqual(len(filas), 1)
        self.assertAlmostEqual(filas[0].anual, 0.0000125 * 8760)

    def test_adaptador_binance(self):
        def fake_get(url, timeout=15.0):
            if "premiumIndex" in url:
                return [{"symbol": "BTCUSDT", "lastFundingRate": "0.0001"}, {"symbol": "BTCUSDC", "lastFundingRate": "0.0001"},
                        {"symbol": "XUSDT", "lastFundingRate": "0.001"}]
            if "fundingInfo" in url:
                return [{"symbol": "XUSDT", "fundingIntervalHours": 4}]
            return [{"symbol": "BTCUSDT", "quoteVolume": "123.0"}]
        with mock.patch.object(funding, "_get", fake_get):
            filas = {f.activo: f for f in funding.binance()}
        self.assertEqual(set(filas), {"BTC", "X"})
        self.assertEqual(filas["BTC"].horas_periodo, 8.0)
        self.assertEqual(filas["X"].horas_periodo, 4.0)
        self.assertEqual(filas["BTC"].volumen_usd, 123.0)

    def test_adaptador_bybit(self):
        def fake_get(url, timeout=15.0):
            if "instruments-info" in url:
                return {"result": {"list": [{"symbol": "BTCUSDT", "fundingInterval": 480}, {"symbol": "XUSDT", "fundingInterval": 60}],
                                   "nextPageCursor": ""}}
            return {"result": {"list": [{"symbol": "BTCUSDT", "fundingRate": "0.0001", "turnover24h": "9"},
                                        {"symbol": "XUSDT", "fundingRate": "0.0002", "turnover24h": "1"},
                                        {"symbol": "BTCPERP", "fundingRate": "0.0001"}]}}
        with mock.patch.object(funding, "_get", fake_get):
            filas = {f.activo: f for f in funding.bybit()}
        self.assertEqual(set(filas), {"BTC", "X"})
        self.assertEqual(filas["X"].horas_periodo, 1.0)

    def test_exchange_caido_no_rompe(self):
        def roto():
            raise funding.urllib.error.URLError("451")
        with mock.patch.dict(funding.EXCHANGES, {"okx": roto}):
            self.assertEqual(funding.recoger(["okx"]), [])


class TestRobustez(unittest.TestCase):
    def test_momentos_gaussiana_simetrica(self):
        m = robustez.momentos([-1.0, 0.0, 1.0, -1.0, 0.0, 1.0])
        self.assertAlmostEqual(m.sharpe, 0.0)
        self.assertAlmostEqual(m.asimetria, 0.0)

    def test_psr_valor_conocido(self):
        m = robustez.Momentos(sharpe=0.1, asimetria=0.0, curtosis=3.0, n=1000)
        z = 0.1 * math.sqrt(999) / math.sqrt(1 + 0.5 * 0.01)
        self.assertAlmostEqual(robustez.psr(m), robustez.NormalDist().cdf(z))

    def test_mas_ensayos_menos_confianza(self):
        m = robustez.Momentos(sharpe=0.08, asimetria=-0.5, curtosis=6.0, n=750)
        probs = [robustez.dsr(m, n)[0] for n in (1, 10, 100, 1000)]
        self.assertEqual(probs, sorted(probs, reverse=True))
        self.assertAlmostEqual(probs[0], robustez.psr(m))

    def test_colas_negativas_penalizan(self):
        normal = robustez.Momentos(0.1, 0.0, 3.0, 500)
        colas = robustez.Momentos(0.1, -2.0, 15.0, 500)
        self.assertLess(robustez.psr(colas), robustez.psr(normal))

    def test_track_record_minimo(self):
        m = robustez.Momentos(0.1, 0.0, 3.0, 1000)
        z = robustez.NormalDist().inv_cdf(0.95)
        self.assertAlmostEqual(robustez.track_record_minimo(m), 1 + 1.005 * (z / 0.1) ** 2)
        self.assertTrue(math.isinf(robustez.track_record_minimo(robustez.Momentos(-0.1, 0, 3, 100))))

    def test_leer_csv_con_y_sin_cabecera(self):
        with tempfile.TemporaryDirectory() as d:
            con = os.path.join(d, "con.csv")
            with open(con, "w") as f:
                f.write("fecha,ret\n2024-01-01,0.01\n2024-01-02,-0.02\n2024-01-03,\n")
            self.assertEqual(robustez.leer_columna(con, "ret"), [0.01, -0.02])
            sin = os.path.join(d, "sin.csv")
            with open(sin, "w") as f:
                f.write("0.01,5\n-0.02,6\n")
            self.assertEqual(robustez.leer_columna(sin, "1"), [5.0, 6.0])
            self.assertEqual(robustez.leer_columna(sin, None), [0.01, -0.02])


if __name__ == "__main__":
    unittest.main()

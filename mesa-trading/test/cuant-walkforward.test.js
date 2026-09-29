'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { walkForward, walkForwardAsync, calcularVentanas, sumarMeses } = require('../src/backtest/walkforward');
const { backtest } = require('../src/backtest/motor');
const { FAMILIAS } = require('../src/estrategias');
const comun = require('../src/estrategias/comun');
const { cestaSintetica } = require('./cuant-ayuda');

const SEIS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'];
const ruptura = FAMILIAS['ruptura-donchian'];

test('sumarMeses respeta fin de mes', () => {
  assert.equal(sumarMeses(Date.UTC(2024, 0, 31), 1), Date.UTC(2024, 1, 29)); // 31-ene + 1 mes = 29-feb (bisiesto)
  assert.equal(sumarMeses(Date.UTC(2024, 6, 1), -18), Date.UTC(2023, 0, 1));
});

test('ventanas 18/6 contadas hacia atrás desde el final', () => {
  // Datos calientes desde 1-ene-2020 hasta 1-ene-2024 (48 meses): 6k + 18 ≤ 48 → 5 ventanas.
  const v = calcularVentanas({ tCalentado: Date.UTC(2020, 0, 1), tFin: Date.UTC(2024, 0, 1), entrenoMeses: 18, pruebaMeses: 6 });
  assert.equal(v.length, 5);
  assert.deepEqual(v[0], { entrenoDesde: Date.UTC(2020, 0, 1), pruebaDesde: Date.UTC(2021, 6, 1), pruebaHasta: Date.UTC(2022, 0, 1) });
  assert.deepEqual(v[4], { entrenoDesde: Date.UTC(2022, 0, 1), pruebaDesde: Date.UTC(2023, 6, 1), pruebaHasta: Date.UTC(2024, 0, 1) });
  for (let k = 1; k < v.length; k++) assert.equal(v[k].pruebaDesde, v[k - 1].pruebaHasta); // pruebas contiguas
});

test('walk-forward completo: forma de §4.7, selección con ≥ 5 operaciones y curva OOS encadenada', () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 1500, 21);
  const wf = walkForward({ velas, estrategia: ruptura });
  assert.equal(wf.suficiente, true);
  assert.equal(wf.entrenoMeses, 18);
  assert.equal(wf.pruebaMeses, 6);
  assert.equal(wf.combinaciones, comun.numeroCombinaciones(ruptura.rejilla));
  assert.equal(wf.sharpesEnsayos.length, wf.combinaciones);
  assert.ok(wf.ventanas.length >= 4);
  for (const v of wf.ventanas) {
    for (const k of ['desde', 'hasta', 'params', 'metricasEntreno', 'metricasPrueba']) assert.ok(k in v, k);
    assert.equal(v.entrenoHasta, v.desde);
  }
  // Primera ventana: la combinación elegida tiene el mejor Sharpe de entrenamiento entre las de ≥ 5 operaciones.
  const v0 = wf.ventanas[0];
  const combos = comun.combinaciones(ruptura.rejilla, ruptura.parametrosPorDefecto);
  const sharpes = combos.map(p => backtest({ velas, estrategia: ruptura, params: p, desde: v0.entrenoDesde, hasta: v0.entrenoHasta }).metricas)
    .filter(m => m.operaciones >= 5).map(m => (m.sharpe === null ? -Infinity : m.sharpe));
  assert.equal(v0.metricasEntreno.sharpe, Math.max(...sharpes));
  // Curva OOS: empieza con el capital y cada ventana arranca donde acabó la anterior.
  assert.equal(wf.oos.curva[0].valor, 10000);
  assert.equal(wf.oos.metricas.operaciones, wf.oos.operaciones.length);
  let idx = 0;
  let previo = 10000;
  for (const v of wf.ventanas) {
    const tramo = wf.oos.curva.filter(p => p.t >= v.desde && p.t < v.hasta);
    assert.equal(tramo[0].valor, previo);
    previo = tramo[tramo.length - 1].valor;
    idx += tramo.length;
  }
  assert.equal(idx, wf.oos.curva.length);
  cerca(wf.oos.metricas.rentabilidad, previo / 10000 - 1);
});

function cerca(a, b, tol = 1e-9) { assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`); }

test('si no hay datos para 4 ventanas de 18/6 prueba 12/3', () => {
  // ~31 meses tras el calentamiento: 18/6 da 2 ventanas; 12/3 da 6.
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD'], 960, 22);
  const wf = walkForward({ velas, estrategia: ruptura });
  assert.equal(wf.entrenoMeses, 12);
  assert.equal(wf.pruebaMeses, 3);
  assert.equal(wf.suficiente, true);
  assert.ok(wf.ventanas.length >= 4);
});

test('sin datos ni para 12/3 → suficiente: false', () => {
  const velas = cestaSintetica(['BTC/USD'], 400, 23);
  const wf = walkForward({ velas, estrategia: ruptura });
  assert.equal(wf.suficiente, false);
  assert.deepEqual(wf.ventanas, []);
  assert.match(wf.motivo, /ventanas/);
});

test('valores fijos: todas las ventanas usan el atrStop fijado', () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 1500, 24);
  const wf = walkForward({ velas, estrategia: ruptura, fijos: { atrStop: 3.5 } });
  assert.equal(wf.combinaciones, 8); // 4 entradas × 2 salidas
  assert.ok(wf.ventanas.every(v => v.params.atrStop === 3.5));
});

test('la versión asíncrona da exactamente lo mismo', async () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD'], 1300, 25);
  const a = walkForward({ velas, estrategia: FAMILIAS['reversion-rsi'] });
  const b = await walkForwardAsync({ velas, estrategia: FAMILIAS['reversion-rsi'] });
  assert.deepEqual(b, a);
});

test('RENDIMIENTO: 2.000 velas diarias × 6 símbolos × rejilla completa < 30 s por familia', () => {
  const velas = cestaSintetica(SEIS, 2000, 26);
  // tendencia-sma es 4H; para medir su rejilla de 24 sobre velas diarias se usa una copia en 1D.
  const familias = [{ ...FAMILIAS['tendencia-sma'], marco: '1Day' }, FAMILIAS['momentum-rotacion'], FAMILIAS['reversion-rsi'], ruptura];
  for (const e of familias) {
    const t0 = process.hrtime.bigint();
    const wf = walkForward({ velas, estrategia: e });
    const seg = Number(process.hrtime.bigint() - t0) / 1e9;
    assert.equal(wf.suficiente, true);
    assert.ok(wf.combinaciones <= 30);
    assert.ok(seg < 30, `${e.familia}: ${seg.toFixed(1)} s`);
  }
});

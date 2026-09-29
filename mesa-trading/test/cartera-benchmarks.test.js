'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearBenchmarks, valorarBenchmarks } = require('../src/cartera/benchmarks');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const PRECIOS = {
  'BTC/USD': 100000, 'ETH/USD': 4000, 'SOL/USD': 200, 'LINK/USD': 20, 'AVAX/USD': 40, 'DOGE/USD': 0.2, SPY: 500,
};

test('sin claves: solo btc y cesta-cripto', () => {
  const e = crearBenchmarks({ capital: 100000, preciosIniciales: PRECIOS, hayAlpaca: false });
  assert.deepEqual(e.carteras.map(c => c.id), ['btc', 'cesta-cripto']);
});

test('100 % BTC con comisión 0,25 % en el activo: caso conocido', () => {
  // 100.000 $ / 100.000 = 1 BTC; × (1 − 0,0025) = 0,9975 BTC.
  const e = crearBenchmarks({ capital: 100000, preciosIniciales: PRECIOS, hayAlpaca: false });
  const btc = e.carteras.find(c => c.id === 'btc');
  cerca(btc.componentes[0].cantidad, 0.9975);
  // A 110.000: 0,9975 · 110.000 = 109.725 → +9,725 %.
  const v = valorarBenchmarks(e, { ...PRECIOS, 'BTC/USD': 110000 });
  const b = v.find(x => x.id === 'btc');
  cerca(b.valor, 109725);
  cerca(b.rentabilidad, 0.09725);
});

test('cesta cripto: 6 partes iguales, sin rebalanceo', () => {
  const e = crearBenchmarks({ capital: 60000, preciosIniciales: PRECIOS });
  const cesta = e.carteras.find(c => c.id === 'cesta-cripto');
  assert.equal(cesta.componentes.length, 6);
  // 10.000 $ por activo: ETH 10.000/4.000·0,9975 = 2,49375.
  cerca(cesta.componentes.find(c => c.simbolo === 'ETH/USD').cantidad, 2.49375);
  // Si ETH se duplica y el resto no se mueve: 5·9.975 + 2·9.975 = 69.825.
  const v = valorarBenchmarks(e, { ...PRECIOS, 'ETH/USD': 8000 }).find(x => x.id === 'cesta-cripto');
  cerca(v.valor, 69825, 1e-6);
});

test('con claves: spy (sin comisión) y btc-spy 50/50', () => {
  const e = crearBenchmarks({ capital: 100000, preciosIniciales: PRECIOS, hayAlpaca: true });
  assert.deepEqual(e.carteras.map(c => c.id), ['btc', 'cesta-cripto', 'spy', 'btc-spy']);
  const v = valorarBenchmarks(e, { ...PRECIOS, SPY: 550, 'BTC/USD': 90000 });
  // SPY: 200 acciones sin comisión → 110.000.
  cerca(v.find(x => x.id === 'spy').valor, 110000);
  // 50/50: 0,49875 BTC · 90.000 + 100 SPY · 550 = 44.887,5 + 55.000.
  cerca(v.find(x => x.id === 'btc-spy').valor, 99887.5);
});

test('penalización de papel opcional y precio que falta → valor null, no inventado', () => {
  const e = crearBenchmarks({ capital: 100000, preciosIniciales: PRECIOS, penalizacion: 0.001 });
  cerca(e.carteras[0].componentes[0].cantidad, 0.9975 * 0.999);
  const v = valorarBenchmarks(e, { 'BTC/USD': { precio: 100000, t: 0 } });
  assert.notEqual(v.find(x => x.id === 'btc').valor, null);
  const cesta = v.find(x => x.id === 'cesta-cripto');
  assert.equal(cesta.valor, null);
  assert.equal(cesta.rentabilidad, null);
});

test('sin precio de BTC no se puede crear; sin SPY se omite y se dice', () => {
  assert.throws(() => crearBenchmarks({ capital: 1000, preciosIniciales: { 'ETH/USD': 1 } }), /BTC/);
  const sinSpy = { ...PRECIOS };
  delete sinSpy.SPY;
  const e = crearBenchmarks({ capital: 1000, preciosIniciales: sinSpy, hayAlpaca: true });
  assert.deepEqual(e.carteras.map(c => c.id), ['btc', 'cesta-cripto']);
  assert.deepEqual(e.omitidos.map(o => o.id), ['spy', 'btc-spy']);
});

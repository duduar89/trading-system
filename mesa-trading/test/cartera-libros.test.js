'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Libros } = require('../src/cartera/libros');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (tol ${tol})`);

function librosConBTC() {
  const l = new Libros();
  l.asegurarPuesto({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  return l;
}

test('caso conocido: compra, compra, venta parcial, venta total → realizado exacto', () => {
  const l = librosConBTC();
  // Compra 0,01 BTC a 100.000 (comisión 2,5 $) con stop 95.000 → riesgo (100.000 − 95.000)·0,01 = 50 $.
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: 2.5, t: 1000, motivo: 'señal', idCliente: 'c1', stop: 95000, regimen: 'RISK-ON' });
  // Compra 0,01 a 110.000 (comisión 2,75 $). Coste medio = (0,01·100.000 + 0,01·110.000)/0,02 = 105.000.
  // Riesgo añadido con el stop vigente: (110.000 − 95.000)·0,01 = 150 → riesgoInicial 200 $.
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 110000, comision: 2.75, t: 2000, motivo: 'señal', idCliente: 'c2' });
  let p = l.puesto('tendencia-BTC');
  cerca(p.cantidad, 0.02);
  cerca(p.costeMedio, 105000);
  cerca(p.riesgoInicial, 200);
  cerca(p.comisiones, 5.25);

  // Venta 0,01 a 120.000 (comisión 3 $): (120.000 − 105.000)·0,01 = 150;
  // − 3 de salida − (2,5 + 2,75)/2 = 2,625 de entrada a prorrata → 144,375.
  const r1 = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.01, precio: 120000, comision: 3, t: 3000, motivo: 'señal', idCliente: 'v1' });
  const op1 = r1.operacionCerrada;
  cerca(op1.pnl, 144.375);
  cerca(op1.cantidad, 0.01);
  cerca(op1.entradaPrecio, 105000);
  cerca(op1.comisiones, 3 + 2.625);
  // pnlPct sobre lo invertido en la parte cerrada: 144,375 / 1.050.
  cerca(op1.pnlPct, 144.375 / 1050);
  // rMultiple: la mitad del riesgo (100 $) → 144,375 / 100.
  cerca(op1.rMultiple, 1.44375);
  assert.equal(op1.motivoSalida, 'señal');
  assert.equal(op1.regimenEntrada, 'RISK-ON');
  assert.equal(op1.entradaT, 1000);
  p = l.puesto('tendencia-BTC');
  cerca(p.cantidad, 0.01);
  cerca(p.costeMedio, 105000);
  cerca(p.realizado, 144.375);

  // Venta del resto a 90.000 (comisión 2,25 $): (90.000 − 105.000)·0,01 = −150;
  // − 2,25 − 2,625 (la otra mitad de las de entrada) → −154,875.
  const r2 = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.01, precio: 90000, comision: 2.25, t: 4000, motivo: 'stop', idCliente: 'v2' });
  const op2 = r2.operacionCerrada;
  cerca(op2.pnl, -154.875);
  cerca(op2.rMultiple, -1.54875);
  assert.equal(op2.motivoSalida, 'stop');
  p = l.puesto('tendencia-BTC');
  assert.equal(p.cantidad, 0);
  assert.equal(p.stop, null);
  assert.equal(p.nOperaciones, 2);
  // Total: 144,375 − 154,875 = −10,5 = caja (−2.105,25 + 2.094,75).
  cerca(p.realizado, -10.5);
  cerca(p.comisiones, 2.5 + 2.75 + 3 + 2.25);
  assert.notEqual(op1.id, op2.id);
});

test('rMultiple con cierre parcial: compra 1 a 100 con stop 95, vende mitad a 110 y resto a 95', () => {
  const l = librosConBTC();
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 1, precio: 100, comision: 0, t: 0, stop: 95 });
  // Riesgo inicial 5 $; la mitad cerrada arriesgaba 2,5 y ganó 5 → 2R.
  const a = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.5, precio: 110, comision: 0, t: 1, motivo: 'señal' });
  cerca(a.operacionCerrada.rMultiple, 2);
  // La otra mitad sale en el stop: −2,5 / 2,5 = −1R.
  const b = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.5, precio: 95, comision: 0, t: 2, motivo: 'stop' });
  cerca(b.operacionCerrada.rMultiple, -1);
});

test('stop: nunca baja con la posición abierta; marcarVela cuenta barras y máximo', () => {
  const l = librosConBTC();
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 1, precio: 100, comision: 0, t: 0, stop: 95 });
  assert.equal(l.fijarStop('tendencia-BTC', 97), 97);
  assert.equal(l.fijarStop('tendencia-BTC', 90), 97, 'no baja');
  l.marcarVela('tendencia-BTC', 104);
  l.marcarVela('tendencia-BTC', 102);
  l.marcarVela('tendencia-BTC', 103);
  const p = l.puesto('tendencia-BTC');
  assert.equal(p.barrasAbierta, 3);
  assert.equal(p.maxPrecio, 104);
  const op = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 1, precio: 103, comision: 0, t: 5, motivo: 'señal' }).operacionCerrada;
  assert.equal(op.barras, 3);
});

test('misma ejecución dos veces en el mismo puesto no se cuenta dos veces', () => {
  const l = librosConBTC();
  const e = { puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: 2.5, t: 0, idCliente: 'mt-x' };
  l.aplicarEjecucion(e);
  const r = l.aplicarEjecucion(e);
  assert.equal(r.duplicada, true);
  cerca(l.puesto('tendencia-BTC').cantidad, 0.01);
  // El mismo idCliente en OTRO puesto (un kill que reparte un cierre) sí cuenta.
  l.asegurarPuesto({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD' });
  l.aplicarEjecucion({ ...e, puestoId: 'ruptura-BTC' });
  cerca(l.totalesPorSimbolo()['BTC/USD'], 0.02);
});

test('sombra: fuera de totales y valoración del fondo salvo que se pida sombra:true', () => {
  const l = librosConBTC();
  l.asegurarPuesto({ puestoId: 'sombra:tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', sombra: true });
  l.asegurarPuesto({ puestoId: 'momentum-ETH', mesaId: 'momentum', simbolo: 'ETH/USD' });
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.1, precio: 100000, comision: 0, t: 0 });
  l.aplicarEjecucion({ puestoId: 'sombra:tendencia-BTC', lado: 'compra', cantidad: 0.2, precio: 100000, comision: 0, t: 0 });
  l.aplicarEjecucion({ puestoId: 'momentum-ETH', lado: 'compra', cantidad: 2, precio: 4000, comision: 8, t: 0 });

  assert.deepEqual(l.totalesPorSimbolo(), { 'BTC/USD': 0.1, 'ETH/USD': 2 });
  assert.deepEqual(l.totalesPorSimbolo({ sombra: true }), { 'BTC/USD': 0.2 });

  const v = l.valorar({ 'BTC/USD': 110000, 'ETH/USD': { precio: 3900, t: 0 } });
  // 0,1·110.000 = 11.000; 2·3.900 = 7.800.
  cerca(v.exposicionBruta, 18800);
  cerca(v.exposicionCripto, 18800);
  cerca(v.exposicionPorActivo['BTC/USD'], 11000);
  assert.equal(v.posicionesAbiertas, 2);
  assert.equal(v.porPuesto['sombra:tendencia-BTC'], undefined);
  // pnl abierto ETH neto de la comisión de entrada: (3.900 − 4.000)·2 − 8 = −208.
  cerca(v.porPuesto['momentum-ETH'].pnlAbierto, -208);
  cerca(v.porMesa.tendencia.valor, 11000);

  const vs = l.valorar({ 'BTC/USD': 110000 }, { sombra: true });
  cerca(vs.exposicionBruta, 22000);
  assert.equal(vs.posicionesAbiertas, 1);
});

test('valorar sin precio usa el último conocido y lo marca', () => {
  const l = librosConBTC();
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.1, precio: 100000, comision: 0, t: 0 });
  l.marcarVela('tendencia-BTC', 101000);
  const v = l.valorar({});
  cerca(v.exposicionBruta, 10100);
  assert.equal(v.porPuesto['tendencia-BTC'].precioEstimado, true);
  assert.deepEqual(v.preciosEstimados, ['BTC/USD']);
});

test('escalarSimbolo reparte a prorrata entre puestos no-sombra y conserva lo pagado', () => {
  const l = librosConBTC();
  l.asegurarPuesto({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD' });
  l.asegurarPuesto({ puestoId: 'sombra:tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', sombra: true });
  // Alpaca: pides 0,01 y 0,03 BTC con comisión null; en la cuenta aparecen ×0,9975.
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: null, t: 0 });
  l.aplicarEjecucion({ puestoId: 'ruptura-BTC', lado: 'compra', cantidad: 0.03, precio: 100000, comision: null, t: 0 });
  l.aplicarEjecucion({ puestoId: 'sombra:tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: 0, t: 0 });
  const r = l.escalarSimbolo('BTC/USD', 0.9975, 'comisión cobrada en el activo');
  assert.equal(r.ajustados.length, 2);
  cerca(l.puesto('tendencia-BTC').cantidad, 0.009975);
  cerca(l.puesto('ruptura-BTC').cantidad, 0.029925);
  cerca(l.puesto('sombra:tendencia-BTC').cantidad, 0.01, 0);
  // Lo que desaparece (0,000025·100.000 = 2,5 $) pasa a comisión de entrada.
  cerca(l.puesto('tendencia-BTC').comisiones, 2.5, 1e-9);
  // Vender todo a 110.000 con comisión 0,25 % en dólares: caja neta = 1.097,25·0,9975 − 1.000.
  const venta = 0.009975 * 110000;
  const op = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.009975, precio: 110000, comision: venta * 0.0025, t: 1, motivo: 'señal' }).operacionCerrada;
  cerca(op.pnl, venta * 0.9975 - 1000, 1e-9);
  cerca(op.pnl, 94.506875, 1e-9);
  assert.equal(l.puesto('tendencia-BTC').cantidad, 0);
});

test('venta mayor que el puesto: se contabiliza lo que hay y se informa del exceso', () => {
  const l = librosConBTC();
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 1, precio: 100, comision: 0, t: 0 });
  const r = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 1.5, precio: 100, comision: 0, t: 1, motivo: 'manual' });
  cerca(r.operacionCerrada.cantidad, 1);
  cerca(r.exceso, 0.5);
  assert.equal(l.puesto('tendencia-BTC').cantidad, 0);
});

test('deslizamiento de la operación: entrada + salida en contra, en fracción', () => {
  const l = librosConBTC();
  // Decide a 100 y compra a 100,2 (0,2 % en contra); decide vender a 110 y vende a 109,67 (0,3 %).
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 1, precio: 100.2, comision: 0, t: 0, precioReferencia: 100 });
  const op = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 1, precio: 109.67, comision: 0, t: 1, motivo: 'señal', precioReferencia: 110 }).operacionCerrada;
  cerca(op.deslizamiento, 0.002 + 0.003, 1e-12);
});

test('serializar y reconstruir da el mismo estado (y sigue contando igual)', () => {
  const l = librosConBTC();
  l.asegurarPuesto({ puestoId: 'sombra:tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', sombra: true });
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: 2.5, t: 1000, idCliente: 'c1', stop: 95000, regimen: 'NEUTRAL', precioReferencia: 99950 });
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 110000, comision: 2.75, t: 2000, idCliente: 'c2' });
  l.aplicarEjecucion({ puestoId: 'sombra:tendencia-BTC', lado: 'compra', cantidad: 0.02, precio: 105000, comision: 0, t: 2000 });
  l.marcarVela('tendencia-BTC', 111000);
  l.escalarSimbolo('BTC/USD', 0.999, 'prueba');
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.005, precio: 120000, comision: 1.5, t: 3000, motivo: 'señal', idCliente: 'v1' });

  const json = JSON.parse(JSON.stringify(l.serializar()));
  const copia = new Libros(json);
  assert.deepEqual(copia.serializar(), l.serializar());
  assert.deepEqual(copia.puesto('tendencia-BTC'), l.puesto('tendencia-BTC'));

  // La misma venta en los dos da la misma operación, y el idCliente ya visto se sigue ignorando.
  const e = { puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.004, precio: 90000, comision: 1, t: 4000, motivo: 'stop', idCliente: 'v2' };
  assert.deepEqual(copia.aplicarEjecucion(e), l.aplicarEjecucion(e));
  assert.equal(copia.aplicarEjecucion({ ...e, idCliente: 'c1', lado: 'compra' }).duplicada, true);
});

test('errores claros: puesto inexistente, lado o cantidad inválidos', () => {
  const l = librosConBTC();
  assert.throws(() => l.aplicarEjecucion({ puestoId: 'nadie', lado: 'compra', cantidad: 1, precio: 1 }), /no existe/);
  assert.throws(() => l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'corto', cantidad: 1, precio: 1 }), /lado/);
  assert.throws(() => l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0, precio: 1 }), /cantidad/);
  assert.throws(() => l.asegurarPuesto({ puestoId: 'tendencia-BTC', mesaId: 'otra', simbolo: 'BTC/USD' }), /otros datos/);
  assert.equal(l.puesto('nadie'), null);
});

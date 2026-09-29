'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Libros } = require('../src/cartera/libros');
const { conciliar } = require('../src/cartera/conciliacion');

const cerca = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

function libros(posiciones) {
  const l = new Libros();
  for (const [puestoId, mesaId, simbolo, cantidad, sombra] of posiciones) {
    l.asegurarPuesto({ puestoId, mesaId, simbolo, sombra: Boolean(sombra) });
    l.aplicarEjecucion({ puestoId, lado: 'compra', cantidad, precio: 100, comision: 0, t: 0 });
  }
  return l;
}

test('caso típico: comisión cobrada en el activo → escalar dentro de tolerancia', () => {
  // Libros 0,01 BTC; el bróker tiene 0,009975 (0,01·(1 − 0,0025)): −0,25 % ≤ 1 %.
  const l = libros([['tendencia-BTC', 'tendencia', 'BTC/USD', 0.01]]);
  const r = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.009975 }], libros: l });
  assert.equal(r.grave, false);
  assert.equal(r.limpia, true);
  assert.equal(r.acciones.length, 1);
  assert.equal(r.acciones[0].tipo, 'escalar');
  assert.equal(r.acciones[0].simbolo, 'BTC/USD');
  cerca(r.acciones[0].factor, 0.9975);
  assert.match(r.resumen, /BTC/);
  assert.match(r.resumen, /0,009975/);
  // Aplicar el escalado deja los libros cuadrados.
  l.escalarSimbolo('BTC/USD', r.acciones[0].factor, 'conciliación');
  const otra = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.009975 }], libros: l });
  assert.deepEqual(otra.acciones, []);
  assert.match(otra.resumen, /limpia/);
});

test('fuera de tolerancia → grave, sin escalar', () => {
  // 0,009 frente a 0,01 es −10 %: no es una comisión, se ha perdido algo.
  const l = libros([['tendencia-BTC', 'tendencia', 'BTC/USD', 0.01]]);
  const r = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.009 }], libros: l });
  assert.equal(r.grave, true);
  assert.equal(r.limpia, false);
  assert.deepEqual(r.acciones, []);
  assert.equal(r.descuadres.length, 1);
  cerca(r.descuadres[0].diferencia, -0.1, 1e-12);
  assert.match(r.resumen, /grave/);
  assert.match(r.resumen, /-10,00 %/);
});

test('huérfana (bróker sin puesto) y fantasma (puesto sin bróker); los sombra no cuentan', () => {
  const l = libros([
    ['ruptura-SOL', 'ruptura', 'SOL/USD', 10],
    ['sombra:tendencia-BTC', 'tendencia', 'BTC/USD', 0.5, true],
  ]);
  const r = conciliar({
    posicionesBroker: [{ simbolo: 'ETHUSD', cantidad: 1.5 }],   // clave sin barra: se normaliza a ETH/USD
    libros: l,
  });
  assert.deepEqual(r.acciones, [
    { tipo: 'huerfana', simbolo: 'ETH/USD', cantidad: 1.5 },
    { tipo: 'fantasma', simbolo: 'SOL/USD', cantidadLibros: 10 },
  ]);
  assert.equal(r.grave, false);
  assert.equal(r.limpia, false);
  assert.match(r.resumen, /Huérfana/);
  assert.match(r.resumen, /Fantasma/);
});

test('varias mesas en el mismo símbolo se suman antes de comparar', () => {
  const l = libros([
    ['tendencia-BTC', 'tendencia', 'BTC/USD', 0.01],
    ['ruptura-BTC', 'ruptura', 'BTC/USD', 0.03],
  ]);
  const r = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.0399 }], libros: l });
  cerca(r.acciones[0].factor, 0.9975);
});

test('con precios, los restos de menos de 1 $ son polvo y no generan acción', () => {
  const l = new Libros();
  const r = conciliar({
    posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.000000005 }],
    libros: l,
    precios: { 'BTC/USD': 100000 },
  });
  assert.deepEqual(r.acciones, []);
  assert.equal(r.ignoradas.length, 1);
  assert.equal(r.limpia, true);
});

test('tolerancia configurable: 0,5 % hace grave un −0,6 %', () => {
  const l = libros([['tendencia-BTC', 'tendencia', 'BTC/USD', 1]]);
  const r = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.994 }], libros: l, tolerancia: 0.005 });
  assert.equal(r.grave, true);
});

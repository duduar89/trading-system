'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Libros } = require('../src/cartera/libros');
const { conciliar, factorEscalado, exposicionConBroker } = require('../src/cartera/conciliacion');

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

test('factorEscalado: la misma regla que conciliar (ruido → nada; ≤ 1 % → factor; más → grave, nada)', () => {
  assert.equal(factorEscalado(1, 1), null);
  assert.equal(factorEscalado(1, 1 + 1e-12), null);
  cerca(factorEscalado(1, 0.9975), 0.9975);
  cerca(factorEscalado(0.9975, 1), 1 / 0.9975);          // paper que no cobra: los libros netos, el bróker bruto
  cerca(factorEscalado(1, 0.99), 0.99);                   // justo en la tolerancia
  assert.equal(factorEscalado(1, 0.985), null);           // −1,5 %: grave
  assert.equal(factorEscalado(0, 1), null);
  assert.equal(factorEscalado(1, 0), null);
  assert.equal(factorEscalado(1, 0.995, 0.001), null);    // tolerancia configurable
});

test('exposicionConBroker: una huérfana del bróker cuenta para los topes; porPuesto y porMesa no cambian', () => {
  const l = libros([['tendencia-BTC', 'tendencia', 'BTC/USD', 50], ['momentum-SPY', 'momentum-etf', 'SPY', 10]]);
  const val = l.valorar({ 'BTC/USD': 100, SPY: 100 });
  cerca(val.exposicionPorActivo['BTC/USD'], 5000);
  // En el bróker: BTC con 40.000 $ de más (cuenta usada antes), DOGE sin puesto y SPY algo por debajo (lectura vieja).
  const pos = [
    { simbolo: 'BTC/USD', cantidad: 450, valor: 45000 },
    { simbolo: 'DOGEUSD', cantidad: 1000, valor: 300 },       // clave de Alpaca: se canoniza
    { simbolo: 'SPY', cantidad: 9, valor: 900 },
  ];
  const r = exposicionConBroker(val, pos);
  cerca(r.exposicionPorActivo['BTC/USD'], 45000);
  cerca(r.exposicionPorActivo['DOGE/USD'], 300);
  cerca(r.exposicionPorActivo.SPY, 1000, 1e-9);             // máximo: la cifra de los libros no se rebaja
  cerca(r.exposicionBruta, 46300, 1e-9);
  cerca(r.exposicionCripto, 45300, 1e-9);
  assert.equal(r.posicionesAbiertas, 3);
  assert.equal(r.porPuesto, val.porPuesto);
  assert.equal(r.porMesa, val.porMesa);
  // Sin huérfanas, lo mismo que los libros.
  const igual = exposicionConBroker(val, [{ simbolo: 'BTC/USD', cantidad: 50, valor: 5000 }, { simbolo: 'SPY', cantidad: 10, valor: 1000 }]);
  cerca(igual.exposicionBruta, val.exposicionBruta);
  assert.equal(igual.posicionesAbiertas, val.posicionesAbiertas);
});

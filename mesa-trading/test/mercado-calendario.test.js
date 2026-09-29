'use strict';
// Calendario NYSE: sesión 9:30-16:00 ET con horario de verano vía Intl, festivos
// y cierres a las 13:00 de 2026-2027 (comprobados en nyse.com el 29-sep-2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const cal = require('../src/mercado/calendario');

const U = (a, m, d, h = 0, mi = 0) => Date.UTC(a, m - 1, d, h, mi);

test('horario de verano (EDT, UTC−4): 9:30 ET = 13:30Z y 16:00 ET = 20:00Z', () => {
  // Martes 29-sep-2026.
  assert.equal(cal.abierto(U(2026, 9, 29, 13, 29)), false);
  assert.equal(cal.abierto(U(2026, 9, 29, 13, 30)), true);
  assert.equal(cal.abierto(U(2026, 9, 29, 19, 59)), true);
  assert.equal(cal.abierto(U(2026, 9, 29, 20, 0)), false, 'a las 16:00 ya está cerrado');
  assert.equal(cal.cierreSesion('2026-09-29'), U(2026, 9, 29, 20, 0));
  assert.equal(cal.aperturaSesion('2026-09-29'), U(2026, 9, 29, 13, 30));
});

test('horario de invierno (EST, UTC−5): 9:30 ET = 14:30Z', () => {
  // Martes 1-dic-2026.
  assert.equal(cal.abierto(U(2026, 12, 1, 14, 29)), false);
  assert.equal(cal.abierto(U(2026, 12, 1, 14, 30)), true);
  assert.equal(cal.abierto(U(2026, 12, 1, 20, 30)), true);
  assert.equal(cal.abierto(U(2026, 12, 1, 21, 0)), false);
});

test('cambios de hora de 2026: 8 de marzo y 1 de noviembre', () => {
  assert.equal(cal.aperturaSesion('2026-03-06'), U(2026, 3, 6, 14, 30), 'viernes antes del cambio: EST');
  assert.equal(cal.aperturaSesion('2026-03-09'), U(2026, 3, 9, 13, 30), 'lunes después: EDT');
  assert.equal(cal.aperturaSesion('2026-10-30'), U(2026, 10, 30, 13, 30), 'viernes antes: EDT');
  assert.equal(cal.aperturaSesion('2026-11-02'), U(2026, 11, 2, 14, 30), 'lunes después: EST');
});

test('fines de semana y festivos cerrados', () => {
  assert.equal(cal.abierto(U(2026, 10, 3, 15)), false, 'sábado');
  assert.equal(cal.abierto(U(2026, 10, 4, 15)), false, 'domingo');
  for (const dia of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
    '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']) {
    assert.equal(cal.esDiaHabil(dia), false, dia);
    assert.equal(cal.cierreSesion(dia), null, dia);
    assert.equal(cal.abierto(cal.msDesdeET(dia, 11, 0)), false, dia);
  }
  assert.equal(cal.FESTIVOS.size, 20);
});

test('días que parecen festivos pero abren: 2-jul-2026 (entero) y 31-dic-2027', () => {
  assert.equal(cal.cierreSesion('2026-07-02'), U(2026, 7, 2, 20, 0));
  assert.equal(cal.esDiaHabil('2027-12-31'), true);
  assert.equal(cal.abierto(U(2027, 12, 31, 15)), true);
});

test('cierres a las 13:00 ET: 27-nov-2026, 24-dic-2026 y 26-nov-2027', () => {
  assert.equal(cal.cierreSesion('2026-11-27'), U(2026, 11, 27, 18, 0));
  assert.equal(cal.abierto(U(2026, 11, 27, 17, 59)), true);
  assert.equal(cal.abierto(U(2026, 11, 27, 18, 0)), false);
  assert.equal(cal.cierreSesion('2026-12-24'), U(2026, 12, 24, 18, 0));
  assert.equal(cal.cierreSesion('2027-11-26'), U(2027, 11, 26, 18, 0));
});

test('próxima apertura: salta fines de semana y festivos; abierto → la de mañana', () => {
  // Jueves 2-jul-2026 tras el cierre → el 3 es festivo → lunes 6 a las 9:30 EDT.
  assert.equal(cal.proximaApertura(U(2026, 7, 2, 21)), U(2026, 7, 6, 13, 30));
  // En plena sesión → la de mañana.
  assert.equal(cal.proximaApertura(U(2026, 9, 29, 15)), U(2026, 9, 30, 13, 30));
  // Antes de abrir → la de hoy.
  assert.equal(cal.proximaApertura(U(2026, 9, 29, 10)), U(2026, 9, 29, 13, 30));
  // Viernes Santo 2027 (26-mar) → lunes 29.
  assert.equal(cal.proximaApertura(U(2027, 3, 25, 21)), U(2027, 3, 29, 13, 30));
});

test('próximo cierre y relojMercado con la forma de broker.relojMercado()', () => {
  assert.equal(cal.proximoCierre(U(2026, 9, 29, 15)), U(2026, 9, 29, 20, 0));
  assert.equal(cal.proximoCierre(U(2026, 11, 27, 15)), U(2026, 11, 27, 18, 0));
  assert.deepEqual(cal.relojMercado(U(2026, 10, 3, 12)), {
    abierto: false, proximaApertura: U(2026, 10, 5, 13, 30), proximoCierre: U(2026, 10, 5, 20, 0),
  });
});

test('día de Nueva York de un instante y cobertura de la lista', () => {
  assert.equal(cal.diaET(U(2026, 9, 30, 3, 0)), '2026-09-29', '23:00 EDT del 29');
  assert.equal(cal.diaET(U(2026, 9, 30, 4, 0)), '2026-09-30');
  assert.equal(cal.cierreSesion(U(2026, 9, 29, 4, 0)), U(2026, 9, 29, 20, 0), 'acepta un instante (diaria de Alpaca)');
  assert.equal(cal.cubre(U(2026, 5, 1)), true);
  assert.equal(cal.cubre(U(2028, 5, 1)), false);
});

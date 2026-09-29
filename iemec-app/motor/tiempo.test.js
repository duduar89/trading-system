'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('./tiempo');

test('hora de verano: 6-oct-2026 17:00 en Madrid son las 15:00 UTC', () => {
  assert.equal(t.desdeMadrid('2026-10-06', '17:00').toISOString(), '2026-10-06T15:00:00.000Z');
});

test('hora de invierno: 3-nov-2026 17:00 en Madrid son las 16:00 UTC', () => {
  assert.equal(t.desdeMadrid('2026-11-03', '17:00').toISOString(), '2026-11-03T16:00:00.000Z');
});

test('el retraso de octubre (25-oct-2026): las 2:30 existen dos veces y se toma la de verano', () => {
  assert.equal(t.desdeMadrid('2026-10-25', '02:30').toISOString(), '2026-10-25T00:30:00.000Z');
  // Una cita de las 11:00 de ese domingo cae ya en invierno.
  assert.equal(t.desdeMadrid('2026-10-25', '11:00').toISOString(), '2026-10-25T10:00:00.000Z');
});

test('el adelanto de marzo (29-mar-2026): las 2:30 no existen y se pasa a las 3:00', () => {
  const r = t.desdeMadrid('2026-03-29', '02:30');
  assert.equal(t.partesMadrid(r).hora, '03:00');
});

test('ida y vuelta: partesMadrid(desdeMadrid(x)) = x en todo el año', () => {
  for (let d = 0; d < 366; d += 7) {
    const fecha = t.sumarDias('2026-01-01', d);
    for (const hora of ['10:00', '13:35', '19:55']) {
      const p = t.partesMadrid(t.desdeMadrid(fecha, hora));
      assert.equal(p.fecha, fecha);
      assert.equal(p.hora, hora);
    }
  }
});

test('días de la semana, sumas y meses', () => {
  assert.equal(t.diaSemana('2026-09-29'), 2); // martes
  assert.equal(t.diaSemana('2026-10-04'), 7); // domingo
  assert.equal(t.sumarDias('2026-09-29', 6), '2026-10-05');
  assert.equal(t.sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(t.sumarMeses('2026-11-15', 2), '2027-01-15');
  assert.equal(t.diasEntre('2026-09-29', '2026-10-05'), 6);
  assert.equal(t.hhmm(t.minutosDe('9:05')), '09:05');
});

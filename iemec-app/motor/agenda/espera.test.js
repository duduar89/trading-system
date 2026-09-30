'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encajaFranja, leSirve, normalizarTelefono, esFijoEspanol, fechasDichas } = require('./espera');

const hueco = (iso, minutos) => ({ inicio: new Date(iso), minutos });

test('la franja: mañana antes de las 14:00, tarde desde las 14:00; sin franja, a cualquier hora', () => {
  assert.equal(encajaFranja(null, 11 * 60), true);
  assert.equal(encajaFranja('manana', 13 * 60 + 55), true);
  assert.equal(encajaFranja('manana', 14 * 60), false);
  assert.equal(encajaFranja('tarde', 14 * 60), true);
  assert.equal(encajaFranja('tarde', 12 * 60), false);
  assert.equal(encajaFranja('manana,tarde', 19 * 60), true);
  assert.equal(encajaFranja('lo que sea', 19 * 60), true, 'lo que no se entiende no descarta a nadie');
});

test('si quiere adelantar su cita, solo le sirve un hueco antes; lo de Treatwell, nunca', () => {
  const h = hueco('2026-10-21T15:00:00Z', 17 * 60);
  assert.equal(leSirve(h, { franjas: null }), true);
  assert.equal(leSirve(h, { franjas: 'manana' }), false);
  assert.equal(leSirve(h, { franjas: null }, { inicio: new Date('2026-10-30T11:00:00Z'), origen: 'recepcion' }), true, 'se le adelanta');
  assert.equal(leSirve(h, { franjas: null }, { inicio: new Date('2026-10-20T11:00:00Z'), origen: 'recepcion' }), false, 'la que tiene ya es antes');
  assert.equal(leSirve(h, { franjas: null }, { inicio: new Date('2026-10-21T15:00:00Z'), origen: 'recepcion' }), false, 'la misma hora no le cambia nada');
  assert.equal(leSirve(h, { franjas: null }, { inicio: new Date('2026-10-30T11:00:00Z'), origen: 'treatwell' }), false);
});

test('el móvil, como lo escriba recepción', () => {
  assert.equal(normalizarTelefono('611 22 33 44'), '+34611223344');
  assert.equal(normalizarTelefono('0034 611-22-33-44'), '+34611223344');
  assert.equal(normalizarTelefono('34611223344'), '+34611223344');
  assert.equal(normalizarTelefono('+44 7700 900123'), '+447700900123');
  assert.equal(normalizarTelefono('12'), null);
  assert.equal(normalizarTelefono(''), null);
});

test('un fijo no tiene WhatsApp: no vale para avisarle de un hueco', () => {
  assert.equal(esFijoEspanol(normalizarTelefono('916 33 44 55')), true);
  assert.equal(esFijoEspanol(normalizarTelefono('876 11 22 33')), true);
  assert.equal(esFijoEspanol(normalizarTelefono('611 22 33 44')), false);
  assert.equal(esFijoEspanol(normalizarTelefono('722 83 32 85')), false);
  assert.equal(esFijoEspanol('+447700900123'), false, 'uno de fuera se intenta');
});

test('las fechas que dice al apuntarse («sí, pero hasta el viernes»)', () => {
  const hoy = '2026-10-19'; // lunes
  assert.deepEqual(fechasDichas('Sí, pero solo por las tardes', { hoy }), {});
  assert.deepEqual(fechasDichas('Sí, hasta el viernes', { hoy }), { hasta: '2026-10-23' });
  assert.deepEqual(fechasDichas('Vale, pero antes del jueves', { hoy }), { hasta: '2026-10-21' });
  assert.deepEqual(fechasDichas('Sí, a partir del 3 de noviembre', { hoy }), { desde: '2026-11-03' });
  assert.deepEqual(fechasDichas('Sí, desde el miércoles y hasta el viernes 30', { hoy }), { desde: '2026-10-21', hasta: '2026-10-30' });
  assert.deepEqual(fechasDichas('Sí, desde luego', { hoy }), {}, '«desde luego» no es una fecha');
});

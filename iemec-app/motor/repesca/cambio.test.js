'use strict';
// Quiere cambiar su cita: lo que nombra de su cita es lo que no le va; lo que va detrás de «al» o
// «para», adónde la quiere. Hoy es martes 6-oct-2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const { entenderCambio } = require('./cambio');

const HOY = '2026-10-06';
const JUEVES = { fecha: '2026-10-08', hora: '17:00' };
const entiende = (texto, citas = [JUEVES]) => entenderCambio(texto, citas, { hoy: HOY });

test('lo que nombra de su propia cita es el día que no puede, no adónde la quiere', () => {
  for (const frase of [
    'Tengo cita el jueves a las 17:00 y no voy a poder ir',
    'Me ha surgido algo el jueves a las 17:00, ¿la podemos mover?',
    'Necesito cambiar la cita del jueves 8',
    'Quiero cambiar la cita del jueves',
    'Hola, quiero cambiar mi cita del jueves 8 de octubre, a las 17:00', // el botón de «Tu cita»
    'No voy a poder ir el jueves',
    'La de las 17:00 no la puedo, ¿me la cambias?',
  ]) {
    const r = entiende(frase);
    assert.equal(r.pide, undefined, `${frase} → ${JSON.stringify(r)}`);
    assert.deepEqual(r.evitar, { fecha: '2026-10-08' }, frase);
  }
  // Su cita es el jueves 15: «el jueves» es el suyo, aunque el próximo jueves sea el 8.
  assert.deepEqual(entiende('Quiero cambiar la cita del jueves', [{ fecha: '2026-10-15', hora: '12:00' }]).evitar, { fecha: '2026-10-15' });
});

test('lo que no es su cita es adónde la quiere', () => {
  assert.deepEqual(entiende('¿Me la puedes retrasar al viernes a las 17:30?').pide, { fecha: '2026-10-09', hora: '17:30', franja: null });
  assert.deepEqual(entiende('¿Me la pasas al jueves?', [{ fecha: '2026-10-26', hora: '12:00' }]).pide, { fecha: '2026-10-08', hora: null, franja: null });
  assert.deepEqual(entiende('Necesito cambiar la cita del jueves al viernes').pide, { fecha: '2026-10-09', hora: null, franja: null });
  assert.deepEqual(entiende('¿Me la cambias para el lunes por la tarde?').pide, { fecha: '2026-10-12', hora: null, franja: 'tarde' });
  assert.equal(entiende('¿La podemos pasar al 20 de octubre?').pide.fecha, '2026-10-20');
  // Solo la hora: ese mismo día.
  assert.deepEqual(entiende('¿Me la retrasas a las 18:30?').pide, { fecha: '2026-10-08', hora: '18:30', franja: null });
  assert.deepEqual(entiende('La del jueves a las 17:00, ¿me la pones a las 19:00?').pide, { fecha: '2026-10-08', hora: '19:00', franja: null });
  // «Tengo cita para el jueves» habla de la suya.
  assert.deepEqual(entiende('Tengo cita para el jueves y no puedo ir').evitar, { fecha: '2026-10-08' });
});

test('sin día ni hora: otros desde mañana, en su franja si la dice', () => {
  assert.deepEqual(entiende('Uy, me ha surgido algo, necesito cambiarla'), { indice: 0, franja: null });
  assert.equal(entiende('Necesito cambiarla, solo puedo por la tarde').franja, 'tarde');
  assert.equal(entiende('¿Me la cambias a otro día?').evitar, null);
  const martes = entiende('El martes no puedo, cámbiamela', [{ fecha: '2026-10-13', hora: '12:00' }]);
  assert.deepEqual(martes.evitar, { fecha: '2026-10-13' });
});

test('con varias citas, la que nombra; si no nombra ninguna, la primera', () => {
  const citas = [{ fecha: '2026-10-13', hora: '12:00' }, { fecha: '2026-10-16', hora: '17:00' }];
  assert.equal(entiende('Necesito cambiar la del viernes', citas).indice, 1);
  assert.deepEqual(entiende('Necesito cambiar la del viernes', citas).evitar, { fecha: '2026-10-16' });
  assert.equal(entiende('La de las 17:00 me la pasas al lunes', citas).indice, 1);
  assert.equal(entiende('La de las 17:00 me la pasas al lunes', citas).pide.fecha, '2026-10-12');
  assert.equal(entiende('Necesito cambiarla', citas).indice, 0);
  assert.equal(entiende('Vale, cámbiala', citas).indice, 0);
});

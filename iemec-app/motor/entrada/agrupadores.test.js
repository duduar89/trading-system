'use strict';
// Los agrupadores del catálogo (Head Spa japonés, programa de acné…): no se reservan, pero es lo que
// nombran los anuncios. La entrada de leads los reconoce (y lo retirado, no), y lo que escribe el
// paciente se entiende con el principio del nombre («la limpieza facial»), sin adivinar.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./leads');

const NOTA = 'No se reserva: agrupa varias técnicas; se reserva la concreta o la valoración.';
const CATALOGO = [
  { id: 'head-spa-japones', nombre: 'Head Spa japonés (Head Spa Sakura)', alias: [], activo: 0, notas: NOTA },
  { id: 'head-spa-express', nombre: 'Head Spa Express', alias: [], activo: 1 },
  { id: 'head-spa-detox', nombre: 'Head Spa Detox Purificante', alias: ['Head Spa Japonés · Head Detox Purificante'], activo: 1 },
  { id: 'tratamiento-acne', nombre: 'Programa de tratamiento del acné', alias: '["Tratamiento del acné","Tratamiento antiacné"]', activo: 0, notas: NOTA },
  { id: 'rejuvenecimiento-vaginal', nombre: 'Rejuvenecimiento vaginal (láser, radiofrecuencia o PRP)', alias: ['Rejuvenecimiento vaginal'], activo: 0, notas: NOTA },
  { id: 'limpieza-facial-profunda', nombre: 'Limpieza facial profunda', alias: [], activo: 1 },
  { id: 'limpieza-espalda', nombre: 'Limpieza de espalda', alias: [], activo: 1 },
  { id: 'suplemento', nombre: 'Suplemento para el Head Spa', alias: [], activo: 0, notas: 'No se reserva: es un complemento que se añade a otra cita.' },
  { id: 'retirado', nombre: 'Tratamiento del acné antiguo', alias: [], activo: 0, notas: 'Lo que fuera.' },
];

test('un agrupador es lo que el importador deja inactivo con su nota; lo retirado y los complementos, no', () => {
  assert.equal(L.esAgrupador(CATALOGO[0]), true);
  assert.equal(L.esAgrupador({ ...CATALOGO[0], activo: '0' }), true);
  assert.equal(L.esAgrupador(CATALOGO[1]), false, 'lo que se reserva');
  assert.equal(L.esAgrupador(CATALOGO.find((t) => t.id === 'suplemento')), false);
  assert.equal(L.esAgrupador(CATALOGO.find((t) => t.id === 'retirado')), false);
  assert.equal(L.esAgrupador({ id: 'x', agrupador: 1 }), true, 'o si se dice');
  assert.equal(L.esAgrupador(null), false);
});

test('tratamiento de interés: los agrupadores se reconocen (y lo dicen); lo retirado sigue sin valer', () => {
  const r = (p) => L.resolverTratamiento({ tratamientos: CATALOGO, mapeo: [{ clave: 'Anuncio acné', tratamiento_id: 'tratamiento-acne' }], ...p });
  assert.deepEqual(r({ textos: ['Head Spa japonés en Boadilla'] }), { id: 'head-spa-japones', via: 'catalogo', agrupador: true });
  assert.deepEqual(r({ respuesta: 'Tratamiento del acné' }), { id: 'tratamiento-acne', via: 'formulario', agrupador: true });
  assert.deepEqual(r({ claves: ['anuncio acné'] }), { id: 'tratamiento-acne', via: 'mapeo', agrupador: true });
  assert.deepEqual(r({ id: 'head-spa-japones' }), { id: 'head-spa-japones', via: 'id', agrupador: true });
  assert.deepEqual(r({ textos: ['Head Spa Detox Purificante'] }), { id: 'head-spa-detox', via: 'catalogo' }, 'lo concreto gana a su agrupador');
  assert.equal(r({ id: 'retirado' }), null);
  assert.equal(r({ id: 'suplemento' }), null);
});

test('si empatan varios y uno de ellos los agrupa, ese; si no, ninguno', () => {
  assert.equal(L.buscarEnCatalogo('Head Spa', CATALOGO), 'head-spa-japones');
  assert.equal(L.buscarEnCatalogo('Limpieza', CATALOGO.filter((t) => t.activo)), null, 'dos limpiezas: ninguna');
});

test('en lo que escribe el paciente vale el principio del nombre, de dos palabras o más; lo que no está claro, no', () => {
  const m = (texto) => L.buscarEnMensaje(texto, CATALOGO);
  assert.equal(m('Hola, ¿qué precio tiene la limpieza facial?'), 'limpieza-facial-profunda');
  assert.equal(m('Quería información del head spa'), 'head-spa-japones', 'los niveles empatan: el agrupador');
  assert.equal(m('Me gustaría el head spa detox'), 'head-spa-detox');
  assert.equal(m('Info del tratamiento del acné'), 'tratamiento-acne', 'por un alias entero');
  assert.equal(m('Quiero una limpieza'), null, 'una palabra que tienen dos');
  assert.equal(m('Quiero pedir cita para la semana que viene'), null);
  assert.equal(m('Hola, quiero más información'), null);
  assert.equal(m(''), null);
});

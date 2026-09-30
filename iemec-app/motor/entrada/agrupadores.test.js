'use strict';
// Los agrupadores del catálogo (Head Spa japonés, programa de acné…): no se reservan, pero es lo que
// nombran los anuncios. La entrada de leads los reconoce (y lo retirado, no), y lo que escribe el
// paciente se entiende con el principio del nombre («la limpieza facial»), sin adivinar. Un agrupador
// solo gana un empate a sus técnicas, y lo íntimo no se atribuye por una palabra suelta.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./leads');
const catalogoReal = require('../../semillas/iemec/tratamientos.json');

const NOTA = 'No se reserva: agrupa varias técnicas; se reserva la concreta o la valoración.';
const CATALOGO = [
  { id: 'head-spa-japones', nombre: 'Head Spa japonés (Head Spa Sakura)', alias: [], activo: 0, notas: NOTA, familia: 'head_spa', subfamilia: 'ritual' },
  { id: 'head-spa-express', nombre: 'Head Spa Express', alias: [], activo: 1, familia: 'head_spa', subfamilia: 'ritual' },
  { id: 'head-spa-detox', nombre: 'Head Spa Detox Purificante', alias: ['Head Spa Japonés · Head Detox Purificante'], activo: 1, familia: 'head_spa', subfamilia: 'ritual' },
  { id: 'tratamiento-acne', nombre: 'Programa de tratamiento del acné', alias: '["Tratamiento del acné","Tratamiento antiacné"]', activo: 0, notas: NOTA, familia: 'facial', subfamilia: 'plan_personalizado' },
  { id: 'rejuvenecimiento-vaginal', nombre: 'Rejuvenecimiento vaginal (láser, radiofrecuencia o PRP)', alias: ['Rejuvenecimiento vaginal'], activo: 0, notas: NOTA,
    familia: 'ginecoestetica', subfamilia: 'plan_personalizado' },
  { id: 'limpieza-facial-profunda', nombre: 'Limpieza facial profunda', alias: [], activo: 1, familia: 'facial', subfamilia: 'higiene' },
  { id: 'limpieza-espalda', nombre: 'Limpieza de espalda', alias: [], activo: 1, familia: 'corporal', subfamilia: 'higiene' },
  { id: 'suplemento', nombre: 'Suplemento para el Head Spa', alias: [], activo: 0, notas: 'No se reserva: es un complemento que se añade a otra cita.', familia: 'head_spa', subfamilia: 'complemento' },
  { id: 'retirado', nombre: 'Tratamiento del acné antiguo', alias: [], activo: 0, notas: 'Lo que fuera.', familia: 'facial', subfamilia: 'acne' },
];
// Lo que se busca: lo que se reserva y los agrupadores (como servidor/leads.js y la repesca).
const VALIDOS = CATALOGO.filter((t) => t.activo || L.esAgrupador(t));

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
  assert.equal(L.buscarEnCatalogo('Head Spa', VALIDOS), 'head-spa-japones');
  assert.equal(L.buscarEnCatalogo('Limpieza', CATALOGO.filter((t) => t.activo)), null, 'dos limpiezas: ninguna');
  // El agrupador solo gana a sus técnicas (misma familia y subfamilia): con otro que no lo es, ninguno.
  const conOtro = [...VALIDOS, { id: 'head-spa-maquina', nombre: 'Head Spa con máquina de vapor', alias: [], activo: 1, familia: 'capilar', subfamilia: 'aparatologia' }];
  assert.equal(L.buscarEnCatalogo('Head Spa', conOtro), null);
  assert.equal(L.esOpcion(CATALOGO[1], CATALOGO[0]), true);
  assert.equal(L.esOpcion(CATALOGO[0], CATALOGO[0]), false, 'no es opción de sí mismo');
  assert.equal(L.esOpcion(CATALOGO[5], CATALOGO[3]), false, 'otra subfamilia');
});

test('lo íntimo no se le atribuye por una palabra suelta: solo si lo nombra entero', () => {
  const laseres = [...VALIDOS,
    { id: 'depilacion-laser', nombre: 'Depilación láser de diodo', alias: [], activo: 1, familia: 'corporal', subfamilia: 'laser' },
    { id: 'radiofrecuencia-facial', nombre: 'Radiofrecuencia facial', alias: [], activo: 1, familia: 'facial', subfamilia: 'aparatologia' }];
  for (const f of ['Láser', 'laser', 'Radiofrecuencia', 'Vaginal']) {
    assert.equal(L.buscarEnCatalogo(f, laseres), null, f);
    assert.equal(L.buscarEnMensaje(f, laseres), null, f);
    assert.equal(L.resolverTratamiento({ tratamientos: laseres, respuesta: f, textos: [f] }), null, f);
  }
  // Solo el agrupador íntimo lo contiene: tampoco, es un trozo de su nombre.
  assert.equal(L.buscarEnCatalogo('PRP', VALIDOS), null);
  // Nombrado entero, sí (y la conversación lo pasa a recepción).
  assert.equal(L.buscarEnCatalogo('Rejuvenecimiento vaginal', laseres), 'rejuvenecimiento-vaginal');
  assert.equal(L.buscarEnMensaje('Quiero info del rejuvenecimiento vaginal', laseres), 'rejuvenecimiento-vaginal');
});

test('con el catálogo real: «Láser», «Radiofrecuencia» y «Fotona» no son el rejuvenecimiento vaginal; «Head Spa» es el Head Spa japonés', () => {
  const tratamientos = (Array.isArray(catalogoReal) ? catalogoReal : catalogoReal.tratamientos).map((t) => ({ ...t, activo: t.activo ? 1 : 0 }));
  const validos = tratamientos.filter((t) => t.activo || L.esAgrupador(t));
  for (const f of ['Láser', 'laser', 'LÁSER', 'Radiofrecuencia', 'Fotona', 'Láser Fotona']) {
    assert.equal(L.resolverTratamiento({ tratamientos, respuesta: f }), null, `formulario «${f}»`);
    assert.equal(L.resolverTratamiento({ tratamientos, textos: [f] }), null, `campaña «${f}»`);
    assert.equal(L.buscarEnMensaje(f, validos), null, `WhatsApp «${f}»`);
  }
  assert.equal(L.resolverTratamiento({ tratamientos, respuesta: 'Head Spa' })?.id, 'head-spa-japones');
  assert.equal(L.buscarEnMensaje('Quería información del head spa', validos), 'head-spa-japones');
  assert.equal(L.resolverTratamiento({ tratamientos, respuesta: 'Rejuvenecimiento vaginal' })?.id, 'rejuvenecimiento-vaginal', 'nombrado entero, sí');
  // El importador sigue escribiendo la nota del botón compartido como la lee la conversación.
  const japones = tratamientos.find((t) => t.id === 'head-spa-japones');
  assert.ok(japones.notas.includes(`${L.NOTA_BOTON_COMPARTIDO}Head Spa Detox Purificante»`), japones.notas);
});

test('en lo que escribe el paciente vale el principio del nombre, de dos palabras o más; lo que no está claro, no', () => {
  const m = (texto) => L.buscarEnMensaje(texto, VALIDOS);
  assert.equal(m('Hola, ¿qué precio tiene la limpieza facial?'), 'limpieza-facial-profunda');
  assert.equal(m('Quería información del head spa'), 'head-spa-japones', 'los niveles empatan: el agrupador');
  assert.equal(m('Me gustaría el head spa detox'), 'head-spa-detox');
  assert.equal(m('Info del tratamiento del acné'), 'tratamiento-acne', 'por un alias entero');
  assert.equal(m('Quiero una limpieza'), null, 'una palabra que tienen dos');
  assert.equal(m('Quiero pedir cita para la semana que viene'), null);
  assert.equal(m('Hola, quiero más información'), null);
  assert.equal(m(''), null);
});

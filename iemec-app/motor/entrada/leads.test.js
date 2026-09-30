'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./leads');

test('teléfono: formato internacional, España por defecto', () => {
  const casos = {
    '612 34 56 78': '+34612345678',
    '612-345-678': '+34612345678',
    '+34 612 345 678': '+34612345678',
    '0034612345678': '+34612345678',
    '34612345678': '+34612345678',
    '(+34) 712.345.678': '+34712345678',
    '912 345 678': '+34912345678',
    '+44 7700 900123': '+447700900123',
    '00447700900123': '+447700900123',
    '612 34 56': null,
    '6123456789': null,
    '512 345 678': null,
    '+34 512 345 678': null,
    '+1 23': null,
    'no tengo': null,
    '': null,
  };
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(L.normalizarTelefono(entrada), esperado, entrada);
  assert.equal(L.normalizarTelefono(null), null);
  assert.equal(L.normalizarTelefono(612345678), '+34612345678');
});

test('un fijo español no tiene WhatsApp; un móvil o un número extranjero, sí', () => {
  assert.ok(L.esFijoEspanol('+34912345678'));
  assert.ok(L.esFijoEspanol('+34812345678'));
  assert.ok(!L.esFijoEspanol('+34612345678'));
  assert.ok(!L.esFijoEspanol('+34712345678'));
  assert.ok(!L.esFijoEspanol('+447700900123'));
});

test('nombre: limpio, con mayúsculas y sin emojis; el de pila para saludar', () => {
  assert.equal(L.limpiarNombre('laura GARCÍA 🌸'), 'Laura García');
  assert.equal(L.limpiarNombre('  María José  de la Fuente '), 'María José De La Fuente');
  assert.equal(L.limpiarNombre('McArthur'), 'McArthur');
  assert.equal(L.limpiarNombre('🌸🌸'), null);
  assert.equal(L.limpiarNombre('J.'), null);
  assert.equal(L.nombrePila('🌸 lau 🌸'), 'Lau');
  assert.equal(L.nombrePila('J. Ramón Pérez'), 'Ramón');
  assert.equal(L.nombrePila(null), null);
});

test('email: en minúsculas y con forma de email', () => {
  assert.equal(L.normalizarEmail(' Laura.Prueba@Ejemplo.COM '), 'laura.prueba@ejemplo.com');
  assert.equal(L.normalizarEmail('laura@'), null);
  assert.equal(L.normalizarEmail(null), null);
});

test('formulario de Meta: contacto, tratamiento que le interesa y el resto de respuestas', () => {
  const f = L.datosFormulario([
    { name: 'full_name', values: ['Laura Prueba'] },
    { name: 'phone_number', values: ['+34611000401'] },
    { name: 'email', values: ['laura@ejemplo.com'] },
    { name: '¿qué_tratamiento_te_interesa?', values: ['Mesoterapia capilar'] },
    { name: '¿cuándo_prefieres_que_te_llamemos?', values: ['Por la tarde'] },
    { name: 'city', values: ['Boadilla del Monte'] },
  ]);
  assert.deepEqual([f.nombre, f.telefono, f.email, f.tratamiento], ['Laura Prueba', '+34611000401', 'laura@ejemplo.com', 'Mesoterapia capilar']);
  assert.deepEqual(f.respuestas, [
    { pregunta: '¿Qué tratamiento te interesa?', valor: 'Mesoterapia capilar' },
    { pregunta: '¿Cuándo prefieres que te llamemos?', valor: 'Por la tarde' },
    { pregunta: 'Ciudad', valor: 'Boadilla del Monte' },
  ]);
  const g = L.datosFormulario([{ name: 'first_name', values: ['Ana'] }, { name: 'last_name', values: ['Ejemplo'] }, { name: 'telefono', values: ['600 000 402'] }]);
  assert.deepEqual([g.nombre, g.telefono, g.email, g.tratamiento, g.respuestas], ['Ana Ejemplo', '600 000 402', null, null, []]);
  assert.deepEqual(L.datosFormulario(undefined).respuestas, []);
});

test('POST /api/leads: lo que se acepta', () => {
  assert.equal(L.leerLeadApi(null).ok, false);
  assert.equal(L.leerLeadApi([]).ok, false);
  assert.match(L.leerLeadApi({ nombre: 'Sin contacto' }).error, /teléfono o el email/);
  const { datos } = L.leerLeadApi({
    telefono: '611 000 403', nombre: 'Web Prueba', email: 'web@ejemplo.com', tratamiento: 'Mesoterapia capilar', codigo_web: 'OTO26-CAP',
    utm: { utm_source: 'google', utm_campaign: 'otono-capilar' }, utm_medium: 'cpc', mensaje: 'Quiero saber precios', origen: 'inventado',
  });
  assert.equal(datos.origen, 'web', 'un origen que no existe queda como «web»');
  assert.deepEqual(datos.utm, { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'otono-capilar' });
  assert.equal(datos.codigoWeb, 'OTO26-CAP');
  assert.equal(datos.campana, 'otono-capilar');
  assert.deepEqual(datos.respuestas, [{ pregunta: 'Mensaje', valor: 'Quiero saber precios' }]);
  assert.equal(datos.tratamiento.respuesta, 'Mesoterapia capilar');
  assert.deepEqual(datos.tratamiento.claves.slice(0, 2), ['OTO26-CAP', 'otono-capilar']);
  assert.equal(L.leerLeadApi({ email: 'x@ejemplo.com', origen: 'ghl' }).datos.origen, 'ghl');
  // De GHL: el envío (para no duplicar si reintenta) va aparte de la persona (que puede volver).
  const ghl = L.leerLeadApi({ telefono: '611000404', origen: 'ghl', id_externo: 'op-404-1', id_contacto: 'contacto-404', id_oportunidad: 'op-404-1' }).datos;
  assert.deepEqual([ghl.idExterno, ghl.idContacto, ghl.idOportunidad], ['op-404-1', 'contacto-404', 'op-404-1']);
});

test('webhook de leads de Meta: solo los avisos «leadgen» de una página', () => {
  const lista = L.leerWebhookLeads({ object: 'page', entry: [{ id: 'PAGINA', changes: [
    { field: 'leadgen', value: { leadgen_id: '900000000000001', form_id: '800000000000001', ad_id: '700000000000001', adgroup_id: '600000000000001', page_id: 'PAGINA', created_time: 1759140000 } },
    { field: 'feed', value: { item: 'post' } },
    { field: 'leadgen', value: {} },
  ] }] });
  assert.deepEqual(lista, [{ leadgenId: '900000000000001', formularioId: '800000000000001', anuncioId: '700000000000001', conjuntoId: '600000000000001', paginaId: 'PAGINA' }]);
  assert.deepEqual(L.leerWebhookLeads({ object: 'instagram', entry: [] }), []);
});

const CATALOGO = [
  { id: 'mesoterapia-capilar', nombre: 'Mesoterapia capilar', alias: '["meso capilar"]' },
  { id: 'mesoterapia-capilar-alopecia', nombre: 'Mesoterapia capilar contra la alopecia', alias: null },
  { id: 'hifu-facial', nombre: 'HIFU facial (InnovaPro V10)', alias: [] },
  { id: 'hifu-corporal', nombre: 'HIFU corporal', alias: [] },
  { id: 'lipofilling', nombre: 'Lipotransferencia facial / Lipofilling facial', alias: [] },
  { id: 'exosomas', nombre: 'Exosomas', alias: [] },
  { id: 'exosomas-capilares', nombre: 'Exosomas capilares', alias: [] },
  { id: 'baja', nombre: 'Tratamiento retirado', alias: [], activo: 0 },
];

test('catálogo: el nombre exacto, sin paréntesis, cada alternativa y los alias', () => {
  assert.equal(L.buscarEnCatalogo('Mesoterapia capilar', CATALOGO), 'mesoterapia-capilar');
  assert.equal(L.buscarEnCatalogo('MESOTERAPIA CAPILAR contra la alopecia', CATALOGO), 'mesoterapia-capilar-alopecia');
  assert.equal(L.buscarEnCatalogo('Hola, me interesa el HIFU facial', CATALOGO), 'hifu-facial');
  assert.equal(L.buscarEnCatalogo('lipofilling facial', CATALOGO), 'lipofilling');
  assert.equal(L.buscarEnCatalogo('Info meso capilar otoño', CATALOGO), 'mesoterapia-capilar');
  assert.equal(L.buscarEnCatalogo('Campaña exosomas capilares octubre', CATALOGO), 'exosomas-capilares', 'gana la forma más larga');
  assert.equal(L.buscarEnCatalogo('corporal', CATALOGO), 'hifu-corporal', 'una palabra corta que solo tiene un tratamiento');
  assert.equal(L.buscarEnCatalogo('HIFU', CATALOGO), null, 'dos tratamientos con HIFU: mejor ninguno');
  assert.equal(L.buscarEnCatalogo('Campaña otoño 2026', CATALOGO), null);
  assert.equal(L.buscarEnCatalogo('', CATALOGO), null);
});

test('tratamiento de interés: identificador, formulario, mapeo y catálogo, por ese orden', () => {
  const mapeo = [
    { clave: '120200000000009', tratamiento_id: 'hifu-corporal' },
    { clave: 'Tratamientos capilares', tratamiento_id: 'mesoterapia-capilar' },
    { clave: 'OTO26-EXO', tratamiento_id: 'exosomas' },
    { clave: 'retirado', tratamiento_id: 'baja' },
  ];
  const r = (p) => L.resolverTratamiento({ tratamientos: CATALOGO, mapeo, ...p });
  assert.deepEqual(r({ id: 'exosomas' }), { id: 'exosomas', via: 'id' });
  assert.deepEqual(r({ id: 'baja' }), null, 'uno inactivo no vale');
  assert.deepEqual(r({ respuesta: 'Tratamientos capilares' }), { id: 'mesoterapia-capilar', via: 'formulario' });
  assert.deepEqual(r({ respuesta: 'Exosomas', claves: ['120200000000009'] }), { id: 'exosomas', via: 'formulario' }, 'lo que respondió manda');
  assert.deepEqual(r({ respuesta: 'Lo que me recomendéis', claves: [null, '120200000000009'] }), { id: 'hifu-corporal', via: 'mapeo' });
  assert.deepEqual(r({ claves: ['oto26-exo'] }), { id: 'exosomas', via: 'mapeo' }, 'sin distinguir mayúsculas');
  assert.deepEqual(r({ claves: ['retirado'] }), null);
  assert.deepEqual(r({ claves: ['nada'], textos: ['Anuncio vídeo meso capilar', 'Campaña HIFU'] }), { id: 'mesoterapia-capilar', via: 'catalogo' });
  assert.equal(r({}), null);
});

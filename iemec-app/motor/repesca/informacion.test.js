'use strict';
// «Quiero más información», «¿qué precio tiene?» (lo típico del primer mensaje de un anuncio) y lo
// que agrupa varias técnicas: qué decide la repesca y cómo lo dice el modo simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar } = require('./interpretar');
const { decidir } = require('./decidir');
const { crearCalendario } = require('./calendario-clinica');
const { textoSimulado } = require('../../servidor/integraciones/ia');

const calendario = crearCalendario({
  horario: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' })).concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]),
  festivos: ['2026-10-05', '2026-10-12'],
});
const HIGIENE = { id: 'higiene-facial', familia: 'facial', regimen_legal: 'cosmetico' };
// Martes 29-sep-2026 a las 10:00.
const ctx = (extra = {}) => ({ hoy: '2026-09-29', ahoraMin: 600, calendario, tratamiento: HIGIENE, importe: 60, ofertas: [], hechas: [],
  ofertasRechazadas: 0, tieneRespuestaAprobada: true, reservable: true, ...extra });
const tipos = (d) => d.acciones.map((a) => a.tipo);

test('«quiero más información»: lo aprobado, una valoración, huecos (si la IA puede darle cita) y seguimiento', () => {
  const d = decidir(interpretar('Hola, quiero más información'), ctx({ frase: 'Hola, quiero más información' }));
  assert.equal(d.intencion, 'informacion');
  assert.deepEqual(tipos(d), ['responder', 'ofrecer_valoracion', 'proponer_huecos', 'programar_seguimiento']);
  assert.equal(d.acciones[2].opcional, true, 'si no hay huecos, no queda una tarea: queda el seguimiento');
  assert.equal(d.acciones[2].desdeFecha, '2026-09-29');
  assert.equal(d.proximoPaso, 'seguimiento');
  const s = d.acciones.at(-1);
  assert.deepEqual([s.fecha, s.motivo], ['2026-10-01', 'informacion']);
  assert.match(d.guia, /aprobado/);
});

test('«¿qué precio tiene?» sin respuesta aprobada ni reserva por la IA: valoración y seguimiento, sin pasarlo a nadie', () => {
  const d = decidir(interpretar('¿Qué precio tiene?'), ctx({ tieneRespuestaAprobada: false, reservable: false }));
  assert.deepEqual(tipos(d), ['ofrecer_valoracion', 'programar_seguimiento']);
  assert.equal(d.proximoPaso, 'seguimiento');
  // Sin saber de qué tratamiento habla: se le pregunta.
  const sin = decidir(interpretar('¿Me das info?'), ctx({ tratamiento: { id: null, familia: null, regimen_legal: 'desconocido' }, tieneRespuestaAprobada: false, reservable: false }));
  assert.match(sin.guia, /qué tratamiento le interesa/);
});

test('con una franja, los huecos que pide son de esa franja; con un día, desde ese día', () => {
  const t = decidir(interpretar('Quiero información, mejor por las tardes'), ctx());
  assert.equal(t.acciones.find((a) => a.tipo === 'proponer_huecos').franja, 'tarde');
  const j = decidir(interpretar('Quiero información para el jueves'), ctx());
  assert.equal(j.acciones.find((a) => a.tipo === 'proponer_huecos').desdeFecha, '2026-10-01');
});

test('«me gustaría reservar una valoración», «quisiera pedir cita», «¿podría agendar…?»: se le proponen huecos', () => {
  for (const f of ['Me gustaría reservar una valoración', 'Quisiera pedir cita', '¿Podría agendar una cita para el jueves?']) {
    const d = decidir(interpretar(f), ctx({ frase: f }));
    assert.equal(d.intencion, 'reservar', f);
    assert.equal(d.acciones[0].tipo, 'proponer_huecos', f);
    assert.equal(d.proximoPaso, 'espera_respuesta', f);
  }
});

test('lo que agrupa varias técnicas: se le pregunta cuál; si no se puede preguntar, recepción; lo demás, como siempre', () => {
  const agrupador = { nombre: 'Head Spa japonés', opciones: [{ id: 'head-spa-express', nombre: 'Head Spa Express' }, { id: 'head-spa-detox', nombre: 'Head Spa Detox Purificante' }] };
  for (const f of ['Hola, quiero más información', 'Quiero pedir cita', 'Sí', '¿Qué precio tiene?']) {
    const d = decidir(interpretar(f), ctx({ agrupador, reservable: false }));
    assert.deepEqual(tipos(d), ['preguntar_opcion', 'programar_seguimiento'], f);
    assert.deepEqual(d.acciones[0].opciones, ['head-spa-express', 'head-spa-detox']);
    assert.equal(d.proximoPaso, 'espera_respuesta');
  }
  const r = decidir(interpretar('Quiero más información'), ctx({ agrupador: { nombre: 'Rejuvenecimiento vaginal', opciones: [] }, reservable: false }));
  assert.deepEqual(tipos(r), ['pasar_a_persona']);
  assert.match(r.acciones[0].motivo, /agrupa varias técnicas: contarle las opciones y proponerle cita/);
  // «El mes que viene» o una baja no necesitan saber cuál.
  assert.equal(decidir(interpretar('El mes que viene'), ctx({ agrupador })).intencion, 'aplazar');
  assert.deepEqual(tipos(decidir(interpretar('BAJA'), ctx({ agrupador }))), ['baja']);
});

test('lo que dice el modo simulado', () => {
  const info = (texto, datos, extra = {}) => textoSimulado(decidir(interpretar(texto), ctx(extra)), datos);
  assert.equal(info('Hola, quiero más información', { conTratamiento: false, nombre: 'Lucía', primerMensajeIa: true }, { tratamiento: { id: null }, tieneRespuestaAprobada: false, reservable: false }),
    'Soy el asistente virtual de IEMEC. Gracias, Lucía. ¿Qué tratamiento te interesa? Te cuento lo que necesites y, si quieres, te busco hueco para una primera valoración con nuestro equipo, sin compromiso.');
  assert.equal(info('¿Qué precio tiene?', { conTratamiento: true, nombre: 'Marta', respuestaAprobada: 'Dura unos 45 minutos.', huecosTexto: 'el jueves 1 de octubre a las 11:00' }),
    'Gracias, Marta. Dura unos 45 minutos. Si quieres, te busco hueco para una primera visita con nuestro equipo, que te lo explica todo en persona y sin compromiso: el jueves 1 de octubre a las 11:00. ¿Te reservo alguno?');
  assert.equal(info('Info', { conTratamiento: true }, { tieneRespuestaAprobada: false, reservable: false }),
    'Gracias. Lo mejor es verlo en una valoración con nuestro equipo, sin compromiso. ¿Quieres que te busquemos hueco?');
  // Pidió la tarde y no queda: se le dice y se le ofrece la mañana.
  assert.match(info('Quiero información, mejor por las tardes', { conTratamiento: true, huecosTexto: 'el jueves 1 de octubre a las 11:00', franjaSinHuecos: 'tarde', franjaOfrecida: 'manana' }),
    /por la tarde no me queda nada estos días, pero por la mañana tengo el jueves 1 de octubre a las 11:00\. ¿Te reservo alguno\?$/);
  const huecos = textoSimulado(decidir(interpretar('Vale, por la tarde'), ctx()), { huecosTexto: 'el jueves 1 de octubre a las 11:00', franjaSinHuecos: 'tarde', franjaOfrecida: 'manana', nombre: 'Ana' });
  assert.equal(huecos, 'Por la tarde no me queda nada estos días, Ana; por la mañana te puedo ofrecer el jueves 1 de octubre a las 11:00. ¿Te viene bien alguno?');
  const opciones = textoSimulado(decidir(interpretar('Quiero más información'), ctx({ agrupador: { nombre: 'x', opciones: [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }] } })),
    { nombre: 'Ana', opcionesTexto: 'Head Spa Express o Head Spa Detox Purificante' });
  assert.equal(opciones, 'Tenemos varias opciones, Ana: Head Spa Express o Head Spa Detox Purificante. ¿Cuál te interesa? Así te busco hueco.');
});

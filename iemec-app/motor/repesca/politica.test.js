'use strict';
// La política de la repesca: siempre un próximo paso, la fecha que pidió el paciente y ofertas
// solo del catálogo y dentro de la ley.
const test = require('node:test');
const assert = require('node:assert/strict');
const casos = require('./excusas.casos');
const { interpretar } = require('./interpretar');
const { decidir } = require('./decidir');
const { ofertasPosibles, comprobarOfertaPropuesta } = require('./ofertas');
const { revisar } = require('./filtro-legal');
const { crearCalendario } = require('./calendario-clinica');

const calendario = crearCalendario({
  horario: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' }))
    .concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]),
  festivos: ['2026-10-05', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06', '2027-03-26'],
});
const TOXINA = { id: 'toxina-facial', familia: 'facial', regimen_legal: 'medicamento_receta' };
const HIGIENE = { id: 'higiene-facial', familia: 'facial', regimen_legal: 'cosmetico' };
const RELLENO = { id: 'relleno-labios', familia: 'facial', regimen_legal: 'producto_sanitario' };
const OFERTAS = [
  { id: 1, tipo: 'promocion', familias: ['facial'], nombre: '20 % en tratamientos faciales' },
  { id: 2, tipo: 'plazos', nombre: 'Pago en 3 plazos sin intereses', importeMin: 150 },
  { id: 3, tipo: 'valoracion', nombre: 'Valoración gratuita con el médico' },
  { id: 4, tipo: 'bono', familias: ['facial'], nombre: 'Bono de 3 sesiones' },
];
const ctx = (extra = {}) => ({
  hoy: '2026-09-29', ahoraMin: 600, calendario, tratamiento: HIGIENE, importe: 90, ofertas: OFERTAS, hechas: [],
  ofertasRechazadas: 0, tieneRespuestaAprobada: true, ...extra,
});
const PROXIMOS = new Set(['cita', 'seguimiento', 'persona', 'cerrada', 'espera_respuesta']);

test('toda la batería: siempre hay un próximo paso y ninguna conversación se queda en el aire', () => {
  for (const c of casos) {
    const d = decidir(interpretar(c.frase), ctx({ frase: c.frase }));
    assert.ok(d.acciones.length > 0, c.frase);
    assert.ok(PROXIMOS.has(d.proximoPaso), `${c.frase} → ${d.proximoPaso}`);
    if (c.intencion === 'baja') assert.deepEqual(d.acciones, [{ tipo: 'baja' }]);
    if (!['cerrada', 'persona'].includes(d.proximoPaso)) {
      assert.ok(d.acciones.some((a) => a.tipo === 'programar_seguimiento'), `${c.frase}: sin fecha para volver a escribir`);
    }
    if (c.intencion === 'salud_personal') assert.equal(d.acciones[0].tipo, 'pasar_a_persona');
    if (c.urgente) assert.equal(d.acciones[0].urgente, true);
    if (c.intencion === 'aplazar' && c.plazo !== 'vago') {
      const s = d.acciones.find((a) => a.tipo === 'programar_seguimiento');
      assert.equal(s.fecha, c.fecha, c.frase);
    }
  }
});

test('el caso de la clínica: «el mes que viene» nunca se escribe al día siguiente', () => {
  const d = decidir(interpretar('Bueno, pero el mes que viene me viene mejor'), ctx({ frase: 'el mes que viene me viene mejor' }));
  const s = d.acciones.find((a) => a.tipo === 'programar_seguimiento');
  assert.equal(s.fecha, '2026-10-06');
  assert.notEqual(s.fecha, '2026-09-30');
  assert.equal(s.texto, 'el martes 6 de octubre');
  assert.equal(s.frase, 'el mes que viene me viene mejor');
  assert.ok(d.acciones.some((a) => a.tipo === 'proponer_huecos' && a.opcional), 'antes, ofrece dejar ya reservado un hueco');
});

test('el caso de la clínica: «me parece muy caro» recibe una oferta del catálogo', () => {
  const d = decidir(interpretar('Me parece muy caro'), ctx());
  const o = d.acciones.find((a) => a.tipo === 'ofrecer');
  assert.ok(o, 'hace una oferta');
  assert.equal(o.ofertaId, 4, 'bono para un tratamiento de importe bajo');
  assert.ok(d.acciones.some((a) => a.tipo === 'programar_seguimiento'), 'y un recordatorio');
});

test('toxina: nunca promoción ni bono; sí plazos o valoración', () => {
  const { validas, descartes } = ofertasPosibles({ tratamiento: TOXINA, ofertas: OFERTAS, hechas: [], importe: 350, hoy: '2026-09-29' });
  assert.deepEqual(validas.map((o) => o.tipo), ['plazos', 'valoracion']);
  assert.ok(descartes.find((x) => x.id === 1).motivo.includes('medicamento'));
  const d = decidir(interpretar('Es carísimo'), ctx({ tratamiento: TOXINA, importe: 350 }));
  assert.equal(d.acciones.find((a) => a.tipo === 'ofrecer').ofertaTipo, 'plazos');
  // Aunque la IA «proponga» la promoción, el código la rechaza.
  assert.equal(comprobarOfertaPropuesta(1, { tratamiento: TOXINA, ofertas: OFERTAS, hechas: [], importe: 350, hoy: '2026-09-29' }).ok, false);
});

test('relleno (producto sanitario): sin rebajas salvo visto bueno del abogado', () => {
  let r = ofertasPosibles({ tratamiento: RELLENO, ofertas: OFERTAS, hechas: [], importe: 300, hoy: '2026-09-29' });
  assert.ok(!r.validas.some((o) => o.tipo === 'promocion'));
  r = ofertasPosibles({ tratamiento: RELLENO, ofertas: [{ ...OFERTAS[0], permitidaProductoSanitario: true }], hechas: [], importe: 300, hoy: '2026-09-29' });
  assert.equal(r.validas.length, 1);
});

test('régimen sin confirmar o publicidad restringida (mesoterapia, carboxiterapia…): como un producto sanitario', () => {
  const casos = [
    { id: 'mesoterapia-corporal', familia: 'facial', regimen_legal: 'desconocido', publicidad_restringida: true },
    { id: 'carboxiterapia', familia: 'facial', regimen_legal: 'desconocido' },
    { id: 'criolipolisis', familia: 'facial', regimen_legal: 'aparatologia', publicidad_restringida: true }, // oferta sin confirmar
  ];
  for (const t of casos) {
    const { validas, descartes } = ofertasPosibles({ tratamiento: t, ofertas: OFERTAS, hechas: [], importe: 90, hoy: '2026-09-29' });
    assert.deepEqual(validas.map((o) => o.tipo), ['valoracion'], t.id);
    assert.match(descartes.find((x) => x.id === 4).motivo, /restringida|sin confirmar/, t.id);
    const d = decidir(interpretar('Me parece muy caro'), ctx({ tratamiento: t }));
    assert.notEqual(d.acciones.find((a) => a.tipo === 'ofrecer')?.ofertaTipo, 'bono', t.id);
    // Con el visto bueno del abogado sanitario en la oferta, sí.
    assert.equal(ofertasPosibles({ tratamiento: t, ofertas: [{ ...OFERTAS[3], permitidaProductoSanitario: true }], hechas: [], importe: 90, hoy: '2026-09-29' }).validas.length, 1);
  }
  // Sin tratamiento conocido no cambia nada: el régimen «desconocido» es solo que no se sabe cuál es.
  const r = ofertasPosibles({ tratamiento: { id: null, familia: 'facial', regimen_legal: 'desconocido' }, ofertas: OFERTAS, hechas: [], importe: 90, hoy: '2026-09-29' });
  assert.ok(r.validas.some((o) => o.tipo === 'bono'));
});

test('no se repite una oferta ya hecha y, si la rechaza, se cierra con motivo precio', () => {
  const hechas = [{ ofertaId: 4, fecha: '2026-09-20' }];
  const d = decidir(interpretar('Sigue siendo caro'), ctx({ hechas }));
  assert.notEqual(d.acciones.find((a) => a.tipo === 'ofrecer')?.ofertaId, 4);
  const cierre = decidir(interpretar('Es caro igualmente'), ctx({ ofertasRechazadas: 1 }));
  assert.deepEqual(cierre.acciones, [{ tipo: 'cerrar', motivo: 'precio' }]);
});

test('importe alto (cirugía capilar): llama una persona', () => {
  const d = decidir(interpretar('Me parece muy caro'), ctx({ importe: 3200 }));
  assert.equal(d.acciones[0].tipo, 'tarea_llamar');
  assert.equal(d.proximoPaso, 'persona');
});

test('competencia de precio: primero la valoración, sin guerra de precios', () => {
  const d = decidir(interpretar('En otra clínica me lo hacen más barato'), ctx());
  assert.equal(d.acciones.find((a) => a.tipo === 'ofrecer').ofertaTipo, 'valoracion');
  assert.match(d.guia, /guerra de precios/);
});

test('respuesta vaga: pregunta una vez; la segunda, seguimiento por defecto', () => {
  const primera = decidir(interpretar('Más adelante'), ctx());
  assert.equal(primera.acciones[0].tipo, 'preguntar_cuando');
  assert.ok(primera.acciones.some((a) => a.tipo === 'programar_seguimiento'), 'aunque no conteste, queda fecha');
  const segunda = decidir(interpretar('Más adelante'), ctx({ yaPreguntoCuando: true }));
  assert.equal(segunda.acciones.at(-1).tipo, 'programar_seguimiento');
});

test('evento: huecos con margen antes; si no da tiempo, una persona', () => {
  const d = decidir(interpretar('Tengo una boda el 20 de noviembre y quiero estar guapa'), ctx());
  const p = d.acciones.find((a) => a.tipo === 'proponer_huecos');
  assert.equal(p.hastaFecha, '2026-11-05');
  const tarde = decidir(interpretar('Tengo una boda el día 5 y quiero estar guapa'), ctx());
  assert.equal(tarde.acciones[0].tipo, 'pasar_a_persona');
});

test('duda médica sin respuesta aprobada: a una persona, nunca inventa', () => {
  const d = decidir(interpretar('¿Duele mucho?'), ctx({ tieneRespuestaAprobada: false }));
  assert.equal(d.acciones[0].tipo, 'pasar_a_persona');
});

test('filtro legal: medicamentos, marcas, promesas y baja', () => {
  assert.equal(revisar('20% de descuento en bótox este mes. IEMEC. Responde BAJA para no recibir más.').ok, false);
  assert.equal(revisar('Relleno de labios con Juvéderm. IEMEC. Baja: responde BAJA').ok, false);
  assert.equal(revisar('Resultados garantizados y sin riesgo en IEMEC. Baja: BAJA').ok, false);
  assert.equal(revisar('Promo ADN Salmón Glow en IEMEC este mes').ok, false, 'marketing sin baja');
  assert.equal(revisar('Promo ADN Salmón Glow en IEMEC este mes', { tieneBaja: true }).ok, true);
  const util = revisar('Hola Ana, te recordamos tu cita mañana a las 17:00 en IEMEC.', { tipo: 'utilidad' });
  assert.equal(util.ok, true);
  const conv = revisar('La toxina botulínica se aplica en consulta médica.', { tipo: 'conversacion' });
  assert.equal(conv.ok, true);
  assert.equal(conv.avisos.length, 1);
});

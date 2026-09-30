'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./resenas');
const { crearCalendario } = require('../repesca/calendario-clinica');
const T = require('../tiempo');

const calendario = crearCalendario({
  horario: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' })).concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]),
  festivos: ['2026-10-05', '2026-10-12'],
});
const madrid = (d) => { const p = T.partesMadrid(d); return `${p.fecha} ${p.hora}`; };

test('se pide a todos tras la cita, dos horas después y en horario', () => {
  const r = R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '12:00') }, paciente: {} }, calendario);
  assert.equal(r.pedir, true);
  assert.equal(madrid(r.cuando), '2026-10-06 14:00');
  // Cita que acaba a las 19:30 del sábado 3-oct: domingo cerrado, lunes 5 festivo → martes 6 a las 10:30.
  const tarde = R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid('2026-10-03', '19:30') }, paciente: {} }, calendario);
  assert.equal(madrid(tarde.cuando), '2026-10-06 10:30');
});

test('no se pide si no vino, si se dio de baja, si ya reseñó, si hay queja o si se le pidió hace poco', () => {
  const base = { cita: { estado: 'completada', fin: new Date('2026-10-06T10:00:00Z') }, paciente: {} };
  assert.equal(R.pedirResena({ ...base, cita: { ...base.cita, estado: 'no_presentada' } }, calendario).pedir, false);
  assert.equal(R.pedirResena({ ...base, paciente: { baja_comercial_en: new Date() } }, calendario).pedir, false);
  assert.equal(R.pedirResena({ ...base, yaResenoEnGoogle: true }, calendario).pedir, false);
  assert.match(R.pedirResena({ ...base, conversacionAbiertaConQueja: true }, calendario).motivo, /queja/);
  assert.equal(R.pedirResena({ ...base, ultimaPeticion: new Date('2026-08-01T10:00:00Z') }, calendario).pedir, false);
});

test('una sola petición aunque complete dos citas el mismo día; y al enviarla se vuelve a mirar todo', () => {
  const cita = { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '13:10') };
  // Al programar la de la segunda cita, la de la primera aún no ha salido: esta no se pide.
  assert.deepEqual(R.pedirResena({ cita, paciente: {}, otraEnCamino: true }, calendario), { pedir: false, motivo: R.OTRA_EN_CAMINO });
  // Justo antes de enviarla cuenta lo de ese momento: una baja, una queja o una petición que ya salió.
  const envio = { cita, paciente: {}, referencia: T.desdeMadrid('2026-10-06', '15:10') };
  assert.equal(R.motivoParaNoPedir(envio, { referencia: envio.referencia }), null);
  assert.equal(R.motivoParaNoPedir({ ...envio, paciente: { baja_comercial_en: T.desdeMadrid('2026-10-06', '14:30') } }), 'se dio de baja de los mensajes');
  assert.equal(R.motivoParaNoPedir({ ...envio, conversacionAbiertaConQueja: true }), 'tiene una queja abierta: primero se atiende');
  assert.equal(R.motivoParaNoPedir({ ...envio, ultimaPeticion: T.desdeMadrid('2026-10-06', '14:00') }, { referencia: envio.referencia }), 'ya se le pidió hace poco');
  assert.equal(R.motivoParaNoPedir({ ...envio, ultimaPeticion: T.desdeMadrid('2026-05-06', '14:00') }, { referencia: envio.referencia }), null, 'hace más de 120 días, sí');
});

test('si recepción la marca tarde, sale cuando ya no se puede deshacer; días después, ya no se pide', () => {
  const cita = { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '12:00') };
  // Marcada a las 12:10: sale a las 14:00 como siempre.
  assert.equal(madrid(R.pedirResena({ cita, paciente: {}, noAntesDe: T.desdeMadrid('2026-10-06', '12:40') }, calendario).cuando), '2026-10-06 14:00');
  // Marcada a las 17:00: no sale hasta las 17:30 (hasta entonces se puede deshacer).
  assert.equal(madrid(R.pedirResena({ cita, paciente: {}, noAntesDe: T.desdeMadrid('2026-10-06', '17:30') }, calendario).cuando), '2026-10-06 17:30');
  // Marcada a las 19:45: las 20:15 ya es tarde → el día siguiente a las 10:30.
  assert.equal(madrid(R.pedirResena({ cita, paciente: {}, noAntesDe: T.desdeMadrid('2026-10-06', '20:15') }, calendario).cuando), '2026-10-07 10:30');
  const viejo = R.pedirResena({ cita, paciente: {}, noAntesDe: T.desdeMadrid('2026-10-09', '10:30') }, calendario);
  assert.deepEqual(viejo, { pedir: false, motivo: 'la cita se marcó como completada días después' });
});

test('el enlace lleva directo a escribir la reseña en la ficha', () => {
  assert.equal(R.enlaceResena('ChIJ123'), 'https://search.google.com/local/writereview?placeid=ChIJ123');
});

test('temas y sentimiento', () => {
  const a = R.analizar({ nota: 5, texto: 'Trato exquisito y muy profesionales. Los resultados, naturales. La clínica preciosa.' });
  assert.deepEqual(a.temas.sort(), ['instalaciones', 'profesionalidad', 'resultados', 'trato']);
  assert.equal(a.sentimiento, 'positivo');
  const b = R.analizar({ nota: 4, texto: 'Bien pero una hora de retraso' });
  assert.equal(b.sentimiento, 'mixto');
  assert.ok(b.temas.includes('espera_puntualidad'));
  assert.equal(R.analizar({ nota: 1, texto: 'No contestan nunca al teléfono' }).prioridad, 'alta');
});

test('las respuestas nunca nombran tratamientos ni confirman que es paciente, y varían', () => {
  const r1 = R.borradorRespuesta({ autor: 'Laura Gómez', nota: 5, texto: 'Me puse bótox con la doctora y genial, muy profesionales' }, { indice: 0 });
  const r2 = R.borradorRespuesta({ autor: 'Carmen', nota: 5, texto: 'Relleno de labios perfecto, trato encantador' }, { indice: 1 });
  for (const r of [r1, r2]) {
    assert.doesNotMatch(r.texto, /b[oó]tox|toxina|relleno|labios|tratamiento|paciente/i);
    assert.equal(r.requiereAprobacion, true);
  }
  assert.match(r1.texto, /Laura/);
  assert.notEqual(r1.texto.split(' ')[0], r2.texto.split(' ')[0]);
  const neg = R.borradorRespuesta({ autor: 'Pedro', nota: 1, texto: 'Fatal, me cobraron de más por el injerto' });
  assert.match(neg.texto, /en privado/);
  assert.doesNotMatch(neg.texto, /injerto|cobr/);
});

test('métricas de la ficha', () => {
  const resenas = [
    { nota: 5, texto: 'Genial, trato encantador', publicada_en: '2026-09-02T10:00:00Z', respondida_en: '2026-09-02T14:00:00Z' },
    { nota: 4, texto: 'Bien, algo de espera', publicada_en: '2026-09-10T10:00:00Z', respondida_en: null },
    { nota: 5, texto: 'Resultados naturales', publicada_en: '2026-09-20T10:00:00Z', respondida_en: '2026-09-21T10:00:00Z' },
  ];
  const peticiones = [
    { enviada_en: '2026-09-01T12:00:00Z', pulsada_en: '2026-09-01T13:00:00Z', resena_id: 1 },
    { enviada_en: '2026-09-09T12:00:00Z', pulsada_en: null, resena_id: null },
  ];
  const m = R.metricas({ resenas, peticiones, desde: '2026-09-01', hasta: '2026-10-01' });
  assert.equal(m.resenas, 3);
  assert.equal(m.notaMedia, 4.67);
  assert.equal(m.tasaRespuesta, 67);
  assert.equal(m.sinResponder, 1);
  assert.equal(m.conversion, 50);
  assert.equal(m.pulsadas, 1);
});

test('publicaciones de Google: por temporada, sin tratamientos con publicidad restringida y con código de origen', () => {
  const { ideasDelMes } = require('./publicaciones');
  const tratamientos = [
    { id: 'mesoterapia-capilar', nombre: 'Mesoterapia capilar', familia: 'medicina_capilar', publicidad_restringida: false },
    { id: 'prp-capilar', nombre: 'PRP capilar', familia: 'medicina_capilar', publicidad_restringida: true },
    { id: 'diagnostico-capilar', nombre: 'Diagnóstico capilar', familia: 'medicina_capilar', publicidad_restringida: false },
  ];
  const ideas = ideasDelMes({ mes: 10, tratamientos });
  assert.ok(ideas.length >= 2);
  assert.ok(!ideas.some((i) => i.tratamientoId === 'prp-capilar'));
  assert.ok(ideas.every((i) => i.boton.url.startsWith('https://wa.me/34722833285?text=') && i.boton.url.includes(encodeURIComponent(i.codigo))));
  assert.ok(ideas.every((i) => i.texto.length <= 1500));
});

test('publicaciones de Google: nada que no se reserve o se haya retirado, llegue activo como llegue', () => {
  const { ideasDelMes } = require('./publicaciones');
  // Como sale de MariaDB (0/1) y como sale del catálogo (true/false).
  const tratamientos = [
    { id: 'dermapen-capilar-con-exosomas', nombre: 'Dermapen capilar con exosomas', familia: 'medicina_capilar', publicidad_restringida: false, activo: 0 },
    { id: 'plan-capilar', nombre: 'Plan capilar', familia: 'medicina_capilar', publicidad_restringida: false, activo: false },
    { id: 'diagnostico-capilar', nombre: 'Diagnóstico capilar', familia: 'medicina_capilar', publicidad_restringida: false, activo: 1 },
    { id: 'oxigenoterapia-capilar', nombre: 'Oxigenoterapia capilar', familia: 'medicina_capilar', publicidad_restringida: false },
  ];
  assert.deepEqual(ideasDelMes({ mes: 10, tratamientos }).map((i) => i.tratamientoId).filter(Boolean), ['diagnostico-capilar', 'oxigenoterapia-capilar']);
});

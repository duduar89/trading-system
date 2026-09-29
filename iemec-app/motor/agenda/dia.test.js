'use strict';
// Casos de calendario de verdad: festivos de Boadilla, cambio de hora, retenciones que caducan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararDia, huecoAInstantes, aMinutosDelDia } = require('./dia');
const { buscarHuecos } = require('./huecos');
const T = require('../tiempo');

const HORARIO = [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00:00', cierra: '20:00:00' }))
  .concat([{ dia_semana: 6, abre: '10:00:00', cierra: '20:00:00' }]);
const FESTIVOS = ['2026-10-05', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25'];
const base = (extra = {}) => ({
  ahora: new Date('2026-09-29T08:00:00Z'),
  horario: HORARIO,
  festivos: FESTIVOS,
  salas: [{ id: 1, tipo: 'consulta_medica', activa: 1 }],
  profesionales: [{ id: 10, rol: 'medico', activo: 1 }],
  horariosProf: [1, 2, 3, 4, 5, 6].map((d) => ({ profesional_id: 10, dia_semana: d, inicio: '11:00:00', fin: '20:00:00' })),
  ...extra,
});
const toxina = { duracion: 30, crema: 0, holguraAntes: 0, holguraDespues: 10, rol: 'medico', salaTipo: 'consulta_medica' };

test('5-oct-2026 es fiesta local en Boadilla (Virgen del Rosario): clínica cerrada', () => {
  const dia = prepararDia({ ...base(), fecha: '2026-10-05' });
  assert.equal(dia.festivo, true);
  assert.deepEqual(buscarHuecos(dia, toxina), []);
});

test('el domingo no abre y el sábado abre a las 10:00 pero el médico entra a las 11:00', () => {
  assert.deepEqual(prepararDia({ ...base(), fecha: '2026-10-04' }).abierto, []);
  const sabado = prepararDia({ ...base(), fecha: '2026-10-03' });
  assert.equal(sabado.abierto[0].desde, 600);
  assert.equal(buscarHuecos(sabado, toxina)[0].inicio, 660);
});

test('el domingo del cambio de hora (25-oct) y el lunes siguiente: las horas de reloj no se mueven', () => {
  const cita = { sala_id: 1, profesional_id: 10, estado: 'confirmada',
    sala_desde: T.desdeMadrid('2026-10-26', '12:00'), sala_hasta: T.desdeMadrid('2026-10-26', '12:40'),
    prof_desde: T.desdeMadrid('2026-10-26', '12:00'), prof_hasta: T.desdeMadrid('2026-10-26', '12:30') };
  const dia = prepararDia({ ...base(), fecha: '2026-10-26', citas: [cita] });
  assert.deepEqual(dia.ocupacion.salas[1], [{ desde: 720, hasta: 760 }]);
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(!inicios.includes(720));
  assert.ok(inicios.includes(760));
  // El hueco de las 17:00 del lunes 26 (ya en invierno) son las 16:00 UTC.
  const i = huecoAInstantes('2026-10-26', { inicio: 1020 }, toxina);
  assert.equal(i.inicio.toISOString(), '2026-10-26T16:00:00.000Z');
  assert.equal(i.sala_hasta.toISOString(), '2026-10-26T16:40:00.000Z');
});

test('un intervalo que cruza la medianoche se recorta al día', () => {
  const r = aMinutosDelDia(new Date('2026-10-06T21:00:00Z'), new Date('2026-10-07T10:00:00Z'), '2026-10-07');
  assert.deepEqual(r, { desde: 0, hasta: 720 });
});

test('una retención caducada ya no ocupa y una cancelada tampoco', () => {
  const ahora = new Date('2026-10-06T08:00:00Z');
  const citas = [
    { sala_id: 1, profesional_id: 10, estado: 'retenida', retenida_hasta: new Date('2026-10-06T07:50:00Z'),
      sala_desde: T.desdeMadrid('2026-10-07', '12:00'), sala_hasta: T.desdeMadrid('2026-10-07', '12:40'),
      prof_desde: T.desdeMadrid('2026-10-07', '12:00'), prof_hasta: T.desdeMadrid('2026-10-07', '12:30') },
    { sala_id: 1, profesional_id: 10, estado: 'cancelada',
      sala_desde: T.desdeMadrid('2026-10-07', '13:00'), sala_hasta: T.desdeMadrid('2026-10-07', '13:40'),
      prof_desde: T.desdeMadrid('2026-10-07', '13:00'), prof_hasta: T.desdeMadrid('2026-10-07', '13:30') },
  ];
  const dia = prepararDia({ ...base({ ahora }), fecha: '2026-10-07', citas });
  assert.equal(dia.ocupacion.salas[1], undefined);
});

test('hoy: nada antes de ahora + antelación (60 min por defecto)', () => {
  // 6-oct 10:12 en Madrid (08:12 UTC) → primer hueco 11:15.
  const dia = prepararDia({ ...base({ ahora: new Date('2026-10-06T08:12:00Z') }), fecha: '2026-10-06' });
  assert.equal(buscarHuecos(dia, toxina)[0].inicio, 675);
  const ayer = prepararDia({ ...base({ ahora: new Date('2026-10-06T08:12:00Z') }), fecha: '2026-10-05' });
  assert.deepEqual(ayer.abierto, []);
});

test('comida fija y flotante desde la base, ausencia y horario con vigencia', () => {
  const dia = prepararDia({ ...base(), fecha: '2026-10-07',
    pausas: [{ profesional_id: 10, modo: 'fija', dia_semana: null, ventana_inicio: '14:00:00', ventana_fin: '15:00:00', duracion_min: 60 }],
    ausencias: [{ profesional_id: 10, desde: T.desdeMadrid('2026-10-07', '18:00'), hasta: T.desdeMadrid('2026-10-08', '00:00') }],
  });
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(!inicios.includes(14 * 60));
  assert.ok(inicios.includes(17 * 60 + 30));
  assert.ok(!inicios.includes(17 * 60 + 35));
  const sinVigencia = prepararDia({ ...base({ horariosProf: [{ profesional_id: 10, dia_semana: 3, inicio: '11:00:00', fin: '20:00:00', vigente_desde: '2026-11-01' }] }), fecha: '2026-10-07' });
  assert.equal(sinVigencia.profesionales.length, 0);
});

'use strict';
// Casos de calendario del motor de huecos, en minutos del día (600 = 10:00).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buscarHuecos, proponer, bloquesDeCita } = require('./huecos');

const h = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
const r = (d, a) => ({ desde: h(d), hasta: h(a) });

function diaBase(extra = {}) {
  return {
    paso: 5,
    abierto: [r('11:00', '20:00')],
    salas: [
      { id: 1, tipo: 'consulta_medica' },
      { id: 2, tipo: 'cabina_aparatologia' },
      { id: 3, tipo: 'cabina_estetica' },
    ],
    equipos: [],
    profesionales: [
      { id: 10, rol: 'medico', turnos: [{ ...r('11:00', '20:00'), salaPreferidaId: 1 }], bloqueos: [], pausasFlotantes: [] },
      { id: 20, rol: 'esteticista', turnos: [r('11:00', '20:00')], bloqueos: [], pausasFlotantes: [] },
    ],
    ocupacion: { salas: {}, profesionales: {}, equipos: {} },
    ...extra,
  };
}
const toxina = { duracion: 30, crema: 0, holguraAntes: 0, holguraDespues: 10, rol: 'medico', salaTipo: 'consulta_medica' };

test('día libre: el primer hueco es a la apertura y el último acaba antes del cierre', () => {
  const huecos = buscarHuecos(diaBase(), toxina);
  assert.equal(huecos[0].inicio, h('11:00'));
  assert.equal(huecos[0].profesionalId, 10);
  assert.equal(huecos[0].salaId, 1);
  assert.equal(huecos.at(-1).inicio, h('19:30'));
  assert.ok(huecos.every((x) => x.inicio % 5 === 0));
});

test('la holgura de limpieza bloquea la sala, no al profesional', () => {
  const b = bloquesDeCita(h('12:00'), toxina);
  assert.deepEqual(b.sala, r('12:00', '12:40'));
  assert.deepEqual(b.profesional, r('12:00', '12:30'));
});

test('una cita existente ocupa la sala con su limpieza y no se solapa nada', () => {
  const dia = diaBase({ ocupacion: { salas: { 1: [r('12:00', '12:40')] }, profesionales: { 10: [r('12:00', '12:30')] }, equipos: {} } });
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(!inicios.includes(h('11:45')), '11:45-12:15 pisaría la cita');
  assert.ok(!inicios.includes(h('11:30')), '11:30-12:00 más la limpieza hasta 12:10 pisa la sala');
  assert.ok(inicios.includes(h('12:40')));
});

test('con la sala ocupada hasta las 12:40, la siguiente cita en esa sala empieza a las 12:40', () => {
  const dia = diaBase({ salas: [{ id: 1, tipo: 'consulta_medica' }], ocupacion: { salas: { 1: [r('12:00', '12:40')] }, profesionales: { 10: [r('12:00', '12:30')] }, equipos: {} } });
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(!inicios.includes(h('12:30')));
  assert.ok(inicios.includes(h('12:40')));
  // Y antes: 11:20 + 30 + 10 de limpieza = 12:00 justo: vale.
  assert.ok(inicios.includes(h('11:20')));
  assert.ok(!inicios.includes(h('11:25')));
});

test('la crema anestésica ocupa la sala pero deja libre al médico', () => {
  const labios = { duracion: 30, crema: 20, holguraAntes: 0, holguraDespues: 10, rol: 'medico', salaTipo: 'consulta_medica' };
  const b = bloquesDeCita(h('12:00'), labios);
  assert.deepEqual(b.profesional, r('12:20', '12:50'));
  assert.deepEqual(b.sala, r('12:00', '13:00'));
  // El médico tiene otra cita de 12:00 a 12:20 en otra sala: el paciente de labios puede entrar a
  // las 12:00 a ponerse la crema.
  const dia = diaBase({ salas: [{ id: 1, tipo: 'consulta_medica' }, { id: 4, tipo: 'consulta_medica' }], ocupacion: { salas: { 4: [r('12:00', '12:20')] }, profesionales: { 10: [r('12:00', '12:20')] }, equipos: {} } });
  const huecos = buscarHuecos(dia, labios);
  const doce = huecos.find((x) => x.inicio === h('12:00'));
  assert.ok(doce, 'a las 12:00 cabe');
  assert.equal(doce.salaId, 1);
});

test('comida fija: nada entre las 14:00 y las 15:00', () => {
  const dia = diaBase();
  dia.profesionales[0].bloqueos = [r('14:00', '15:00')];
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(inicios.includes(h('13:30')));
  assert.ok(!inicios.includes(h('13:35')));
  assert.ok(!inicios.includes(h('14:30')));
  assert.ok(inicios.includes(h('15:00')));
});

test('comida flotante: 45 min entre 13:30 y 16:00 siempre quedan libres', () => {
  const dia = diaBase();
  dia.profesionales[0].pausasFlotantes = [{ ...r('13:30', '16:00'), duracion: 45 }];
  // Ya tiene citas 13:30-14:30 y 15:15-16:00: solo quedan 45 min (14:30-15:15) para comer.
  dia.ocupacion.profesionales = { 10: [r('13:30', '14:30'), r('15:15', '16:00')] };
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(!inicios.includes(h('14:30')), 'se comería la comida');
  assert.ok(!inicios.includes(h('14:45')), 'se comería la comida');
  // Fuera de la ventana no molesta.
  assert.ok(inicios.includes(h('16:00')));
  assert.ok(inicios.includes(h('13:00')));
});

test('comida flotante: si hay sitio de sobra, una cita dentro de la ventana sí vale', () => {
  const dia = diaBase();
  dia.profesionales[0].pausasFlotantes = [{ ...r('13:30', '16:00'), duracion: 45 }];
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(inicios.includes(h('13:30')));
  assert.ok(inicios.includes(h('14:15')));
});

test('ausencia del profesional: no hay huecos mientras está fuera', () => {
  const dia = diaBase();
  dia.profesionales[0].bloqueos = [r('11:00', '16:00')];
  const huecos = buscarHuecos(dia, toxina);
  assert.equal(huecos[0].inicio, h('16:00'));
});

test('aparato compartido fijo en una sala: el láser obliga a esa cabina y no se usa dos veces a la vez', () => {
  const laser = { duracion: 45, crema: 0, holguraAntes: 0, holguraDespues: 10, rol: 'medico', salaTipo: null, salasPermitidas: [1, 2], equipoCodigo: 'fotona' };
  const dia = diaBase({ equipos: [{ id: 7, codigo: 'fotona', salaId: 2, movil: false, unidades: 1 }] });
  const huecos = buscarHuecos(dia, laser);
  assert.ok(huecos.every((x) => x.salaId === 2 && x.equipoId === 7));
  dia.ocupacion.equipos = { 7: [r('12:00', '12:45')] };
  dia.ocupacion.salas = { 2: [r('12:00', '12:55')] };
  const inicios = buscarHuecos(dia, laser).map((x) => x.inicio);
  assert.ok(!inicios.includes(h('12:30')));
  assert.ok(inicios.includes(h('12:55')));
});

test('aparato móvil con dos unidades: caben dos citas a la vez en salas distintas', () => {
  const preso = { duracion: 40, crema: 0, holguraAntes: 0, holguraDespues: 5, rol: 'esteticista', salaTipo: null, salasPermitidas: [2, 3], equipoCodigo: 'presoterapia' };
  const dia = diaBase({ equipos: [{ id: 8, codigo: 'presoterapia', salaId: null, movil: true, unidades: 2 }] });
  dia.profesionales.push({ id: 21, rol: 'esteticista', turnos: [r('11:00', '20:00')], bloqueos: [], pausasFlotantes: [] });
  dia.ocupacion = { salas: { 2: [r('12:00', '12:45')] }, profesionales: { 20: [r('12:00', '12:40')] }, equipos: { 8: [r('12:00', '12:40')] } };
  const doce = buscarHuecos(dia, preso).find((x) => x.inicio === h('12:00'));
  assert.ok(doce);
  assert.equal(doce.salaId, 3);
  assert.equal(doce.profesionalId, 21);
  // Con las dos unidades en uso, a las 12:00 ya no cabe una tercera.
  dia.ocupacion.equipos[8].push(r('12:00', '12:40'));
  assert.ok(!buscarHuecos(dia, preso).some((x) => x.inicio === h('12:00')));
});

test('jornada partida de la clínica: no se reserva en el cierre de mediodía', () => {
  const dia = diaBase({ abierto: [r('10:00', '14:00'), r('16:00', '20:00')] });
  const inicios = buscarHuecos(dia, toxina).map((x) => x.inicio);
  assert.ok(inicios.includes(h('13:30')));
  assert.ok(!inicios.includes(h('13:35')));
  assert.ok(!inicios.includes(h('15:00')));
  assert.ok(inicios.includes(h('16:00')));
});

test('antelación mínima: hoy no se ofrece nada antes de la hora mínima', () => {
  const dia = diaBase({ minimoDesde: h('16:07') });
  assert.equal(buscarHuecos(dia, toxina)[0].inicio, h('16:10'));
});

test('sin profesional del rol o sin sala del tipo, no hay huecos', () => {
  assert.deepEqual(buscarHuecos(diaBase(), { ...toxina, rol: 'cirujano' }), []);
  assert.deepEqual(buscarHuecos(diaBase(), { ...toxina, salaTipo: 'quirofano' }), []);
  assert.deepEqual(buscarHuecos(diaBase({ abierto: [] }), toxina), []);
});

test('agenda compacta: prefiere pegar la cita a la anterior del médico', () => {
  const dia = diaBase();
  dia.profesionales.push({ id: 11, rol: 'medico', turnos: [r('11:00', '20:00')], bloqueos: [], pausasFlotantes: [] });
  dia.salas.push({ id: 5, tipo: 'consulta_medica' });
  dia.ocupacion = { salas: { 1: [r('11:00', '11:40')] }, profesionales: { 10: [r('11:00', '11:30')] }, equipos: {} };
  const once30 = buscarHuecos(dia, toxina).find((x) => x.inicio === h('11:30'));
  assert.equal(once30.profesionalId, 10, 'el médico 10 acaba a las 11:30: se le pega la siguiente');
});

test('proponer: tres huecos repartidos y, si prefiere tardes, por la tarde', () => {
  const huecos = buscarHuecos(diaBase(), toxina);
  const tres = proponer(huecos);
  assert.equal(tres.length, 3);
  assert.ok(tres[1].inicio - tres[0].inicio >= 60);
  const tardes = proponer(huecos, { preferencia: 'tarde' });
  assert.ok(tardes.every((x) => x.inicio >= h('15:00')));
});

test('proponer: a igualdad, horas redondas (13:00 antes que 12:50)', () => {
  const lista = [h('12:50'), h('12:55'), h('13:00'), h('13:05'), h('16:10'), h('16:15'), h('16:30'), h('17:45')].map((inicio) => ({ inicio }));
  assert.deepEqual(proponer(lista, { n: 2, separacionMin: 180 }).map((x) => x.inicio), [h('13:00'), h('16:30')]);
  // Si no hay horas redondas, se proponen las que hay.
  assert.deepEqual(proponer([{ inicio: h('12:50') }, { inicio: h('16:10') }], { n: 2 }).map((x) => x.inicio), [h('12:50'), h('16:10')]);
});

'use strict';
// Colocar una cita que ya tiene hora (la de Flowww) con el motor de huecos, y decir por qué no cabe.
// El día se prepara como en la base (motor/agenda/dia.js), con datos inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararDia } = require('../agenda/dia');
const C = require('./colocar');

const AHORA = new Date('2026-10-13T08:00:00Z');
const JUEVES = '2026-10-15';

function dia({ citas = [], ausencias = [], pausas = [], festivo = false } = {}) {
  return prepararDia({
    fecha: JUEVES, ahora: AHORA, antelacionMin: 0,
    horario: [{ dia_semana: 4, abre: '10:00', cierra: '20:00' }],
    festivos: festivo ? [JUEVES] : [],
    salas: [{ id: 1, tipo: 'cabina_estetica' }, { id: 2, tipo: 'consulta_medica' }, { id: 3, tipo: 'cabina_estetica' }],
    profesionales: [{ id: 10, rol: 'medico' }, { id: 20, rol: 'esteticista' }, { id: 21, rol: 'esteticista' }],
    horariosProf: [
      { profesional_id: 10, dia_semana: 4, inicio: '10:00', fin: '14:00' },
      { profesional_id: 20, dia_semana: 4, inicio: '10:00', fin: '20:00' },
      { profesional_id: 21, dia_semana: 4, inicio: '10:00', fin: '20:00' },
    ],
    ausencias, pausas, citas,
  });
}
const limpieza = { id: 'limpieza-facial', duracion: 60, holguraDespues: 10, rol: 'esteticista', salaTipo: 'cabina_estetica', salasPermitidas: [1], profesionalesPermitidos: [] };
const toxina = { id: 'toxina', duracion: 30, holguraDespues: 10, rol: 'medico', salaTipo: 'consulta_medica', salasPermitidas: [], profesionalesPermitidos: [] };
const nombres = { sala: (id) => ({ 1: 'Cabina facial', 2: 'Consulta 1', 3: 'Cabina corporal' }[id]), profesional: (id) => ({ 10: 'Dra. Ejemplo', 20: 'Estética Uno', 21: 'Estética Dos' }[id]) };

test('a su hora exacta, aunque no sea múltiplo de cinco (Flowww da citas «a y siete»)', () => {
  const h = C.huecoExacto(dia(), limpieza, 10 * 60 + 7, { profesionalId: 21 });
  assert.deepEqual([h.inicio, h.salaId, h.profesionalId], [607, 1, 21]);
  assert.equal(C.huecoExacto(dia(), limpieza, 607, { salaId: 3 }), null, 'la limpieza facial solo va en la cabina facial');
  assert.deepEqual(C.salasDelTratamiento(dia(), toxina).map((s) => s.id), [2]);
});

test('lo que se coloca ocupa: la siguiente ya lo ve el motor y sabe con quién choca', () => {
  const d = dia();
  const ocupacion = [];
  const h = C.huecoExacto(d, limpieza, 600, { profesionalId: 20 });
  C.ocupar(d, ocupacion, limpieza, 600, h, 'otra cita de las 10:00 (la fila 2 de las citas)');
  assert.equal(C.huecoExacto(d, limpieza, 630, { profesionalId: 21 }), null);
  assert.equal(C.porQueNoCabe(d, limpieza, 630, { profesionalId: 21 }, ocupacion, nombres), 'Cabina facial ocupada por otra cita de las 10:00 (la fila 2 de las citas)');
  assert.equal(C.porQueNoCabe(d, limpieza, 630, { profesionalId: 20 }, ocupacion, nombres), 'Estética Uno ya tiene otra cita de las 10:00 (la fila 2 de las citas)');
  assert.ok(C.huecoExacto(d, limpieza, 670, { profesionalId: 21 }), 'con la limpieza de la cabina hecha (11:10), cabe');
});

test('por qué no cabe, en palabras de recepción', () => {
  const porQue = (d, t, min, o = {}) => C.porQueNoCabe(d, t, min, o, [], nombres);
  assert.equal(porQue(dia({ festivo: true }), limpieza, 600), 'es festivo');
  assert.equal(porQue(dia(), limpieza, 19 * 60 + 30), 'cae fuera del horario de la clínica');
  assert.equal(porQue(dia(), toxina, 15 * 60, { profesionalId: 10 }), 'cae fuera del horario de Dra. Ejemplo');
  assert.equal(porQue(dia(), toxina, 11 * 60, { profesionalId: 20 }), 'Estética Uno no hace este tratamiento en la app');
  assert.equal(porQue(dia(), toxina, 15 * 60), 'cae fuera del horario de quien hace este tratamiento');
  const ausente = dia({ ausencias: [{ profesional_id: 21, desde: new Date('2026-10-15T09:00:00Z'), hasta: new Date('2026-10-15T11:00:00Z') }] });
  assert.equal(porQue(ausente, limpieza, 11 * 60 + 30, { profesionalId: 21 }), 'Estética Dos tiene la comida o una ausencia a esa hora');
  const comida = dia({ pausas: [{ profesional_id: 20, modo: 'flotante', dia_semana: null, ventana_inicio: '14:00', ventana_fin: '15:00', duracion_min: 45 }] });
  assert.equal(C.huecoExacto(comida, limpieza, 14 * 60 + 10, { profesionalId: 20 }), null);
  assert.equal(porQue(comida, limpieza, 14 * 60 + 10, { profesionalId: 20 }), 'no le deja sitio a la comida de Estética Uno');
});

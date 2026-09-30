'use strict';
// Lo que recepción marca de cada cita: qué cambios valen y a qué hora, el «Deshacer» y cuándo se
// avisa de que toca repetir.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./estados');
const T = require('../tiempo');

const en = (hora, fecha = '2026-10-06') => T.desdeMadrid(fecha, hora);
// Una cita del martes 6-oct de 12:00 a 13:00 (hora de Madrid).
const cita = (estado, extra = {}) => ({ estado, inicio: en('12:00'), fin: en('13:00'), ...extra });

test('«Ha llegado»: de confirmada a llegada, solo el día de la cita', () => {
  assert.equal(E.comprobarCambio(cita('confirmada'), 'llegada', en('11:40')).ok, true);
  assert.equal(E.comprobarCambio(cita('confirmada'), 'llegada', en('10:05')).ok, true, 'si llega pronto, también');
  const antes = E.comprobarCambio(cita('confirmada'), 'llegada', en('12:00', '2026-10-05'));
  assert.equal(antes.codigo, 'FUERA_DE_HORA');
  assert.match(antes.mensaje, /martes 6 de octubre/);
  const despues = E.comprobarCambio(cita('confirmada'), 'llegada', en('10:00', '2026-10-07'));
  assert.match(despues.mensaje, /completada o «No vino»/, 'al día siguiente se le dice qué sí puede marcar');
  assert.equal(E.comprobarCambio(cita('retenida'), 'llegada', en('12:00')).codigo, 'ESTADO_NO_VALIDO');
  assert.equal(E.comprobarCambio(cita('llegada'), 'llegada', en('12:00')).mensaje, 'La cita ya está marcada como «Ha llegado»');
});

test('«Completada»: desde llegada, en curso o confirmada, y solo desde la hora de inicio', () => {
  for (const de of ['llegada', 'en_curso', 'confirmada']) {
    assert.equal(E.comprobarCambio(cita(de), 'completada', en('12:00')).ok, true, de);
  }
  const pronto = E.comprobarCambio(cita('llegada'), 'completada', en('11:59'));
  assert.equal(pronto.codigo, 'FUERA_DE_HORA');
  assert.equal(pronto.mensaje, 'Aún no ha empezado: se puede marcar como completada desde las 12:00');
  assert.equal(E.comprobarCambio(cita('confirmada'), 'completada', en('18:00', '2026-10-09')).ok, true, 'días después, también');
  assert.equal(E.comprobarCambio(cita('no_presentada'), 'completada', en('13:00')).codigo, 'ESTADO_NO_VALIDO');
  assert.equal(E.comprobarCambio(cita('cancelada'), 'completada', en('13:00')).mensaje, 'La cita está cancelada: no se puede marcar como «Completada»');
  assert.equal(E.comprobarCambio(cita('retenida'), 'completada', en('13:00')).codigo, 'ESTADO_NO_VALIDO');
});

test('«No vino»: de confirmada, solo pasada la hora de inicio', () => {
  const justo = E.comprobarCambio(cita('confirmada'), 'no_presentada', en('12:00'));
  assert.equal(justo.codigo, 'FUERA_DE_HORA');
  assert.equal(justo.mensaje, 'Aún no es la hora de la cita: «No vino» se marca pasadas las 12:00');
  assert.equal(E.comprobarCambio(cita('confirmada'), 'no_presentada', en('12:01')).ok, true);
  assert.equal(E.comprobarCambio(cita('llegada'), 'no_presentada', en('12:20')).mensaje, 'La cita ya tiene marcada la llegada: no se puede marcar como «No vino»');
  assert.equal(E.comprobarCambio(cita('completada'), 'no_presentada', en('14:00')).codigo, 'ESTADO_NO_VALIDO');
});

test('confirmar y cancelar siguen igual con la tabla (y una retención caducada no se confirma)', () => {
  assert.equal(E.comprobarCambio(cita('retenida'), 'confirmada', en('09:00')).ok, true);
  assert.equal(E.comprobarCambio(cita('confirmada'), 'confirmada', en('09:00')).ok, true, 'confirmar dos veces no falla');
  const caducada = cita('retenida', { retenida_hasta: en('08:55') });
  assert.equal(E.comprobarCambio(caducada, 'confirmada', en('09:00')).codigo, 'RETENCION_CADUCADA');
  assert.equal(E.comprobarCambio(cita('confirmada'), 'cancelada', en('09:00')).ok, true);
  assert.equal(E.comprobarCambio(cita('completada'), 'cancelada', en('14:00')).codigo, 'ESTADO_NO_VALIDO', 'lo hecho no se cancela');
  assert.equal(E.comprobarCambio(cita('retenida'), 'confirmada', en('09:00'), { de: ['confirmada'] }).codigo, 'ESTADO_NO_VALIDO', '«de» restringe la tabla');
  assert.equal(E.comprobarCambio(cita('confirmada'), 'volando', en('09:00')).codigo, 'ESTADO_DESCONOCIDO');
});

test('los botones que tocan según el estado y la hora', () => {
  assert.deepEqual(E.accionesPosibles(cita('confirmada'), en('10:00')), ['llegada']);
  assert.deepEqual(E.accionesPosibles(cita('confirmada'), en('12:00')), ['llegada', 'completada']);
  assert.deepEqual(E.accionesPosibles(cita('confirmada'), en('12:05')), ['llegada', 'completada', 'no_presentada']);
  assert.deepEqual(E.accionesPosibles(cita('confirmada'), en('10:00', '2026-10-07')), ['completada', 'no_presentada']);
  assert.deepEqual(E.accionesPosibles(cita('confirmada'), en('10:00', '2026-10-05')), []);
  assert.deepEqual(E.accionesPosibles(cita('llegada'), en('11:50')), []);
  assert.deepEqual(E.accionesPosibles(cita('llegada'), en('12:00')), ['completada']);
  for (const e of ['retenida', 'completada', 'no_presentada', 'cancelada']) assert.deepEqual(E.accionesPosibles(cita(e), en('12:30')), [], e);
});

test('«Deshacer»: vuelve al estado anterior durante 30 minutos, y solo lo que marca recepción', () => {
  const hecha = cita('completada', { estado_anterior: 'llegada', estado_cambiado_en: en('13:05') });
  const d = E.comprobarDeshacer(hecha, en('13:20'));
  assert.equal(d.ok, true);
  assert.equal(d.a, 'llegada');
  assert.equal(T.partesMadrid(d.hasta).hora, '13:35');
  const tarde = E.comprobarDeshacer(hecha, en('13:35'));
  assert.equal(tarde.codigo, 'DESHACER_CADUCADO');
  assert.equal(tarde.mensaje, 'Ya no se puede deshacer «Completada»: han pasado más de 30 minutos');
  assert.equal(E.comprobarDeshacer(cita('completada'), en('13:20')).codigo, 'NADA_QUE_DESHACER', 'sin estado anterior no hay nada que deshacer');
  assert.equal(E.comprobarDeshacer(cita('confirmada', { estado_anterior: 'retenida', estado_cambiado_en: en('09:00') }), en('09:05')).codigo, 'NADA_QUE_DESHACER');
  // Una cancelación no se deshace desde el panel: el hueco pudo dársele a otra persona.
  assert.equal(E.comprobarDeshacer(cita('cancelada', { estado_anterior: 'confirmada', estado_cambiado_en: en('09:00') }), en('09:05')).codigo, 'NADA_QUE_DESHACER');
  assert.equal(E.comprobarDeshacer(cita('no_presentada', { estado_anterior: 'confirmada', estado_cambiado_en: en('12:20') }), en('12:30')).a, 'confirmada');
});

test('toca repetir: el día de la cita más el intervalo, menos un margen para encontrar hueco', () => {
  assert.deepEqual(E.avisoRepetir('2026-10-06', 120), { toca: '2027-02-03', aviso: '2027-01-22', margen: 12 });
  assert.deepEqual(E.avisoRepetir('2026-10-06', 30), { toca: '2026-11-05', aviso: '2026-11-02', margen: 3 });
  assert.deepEqual(E.avisoRepetir('2026-10-06', 365), { toca: '2027-10-06', aviso: '2027-09-22', margen: 14 });
  assert.equal(E.avisoRepetir('2026-10-06', null), null);
  assert.equal(E.avisoRepetir('2026-10-06', 0), null);
});

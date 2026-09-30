'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./secuencias');
const { crearCalendario } = require('./calendario-clinica');
const { BIBLIOTECA } = require('./plantillas');
const T = require('../tiempo');

const calendario = crearCalendario({
  horario: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' }))
    .concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]),
  festivos: ['2026-10-05', '2026-10-12'],
});
const madrid = (d) => { const p = T.partesMadrid(d); return `${p.fecha} ${p.hora}`; };

test('cada paso de plantilla usa una plantilla que existe en la biblioteca', () => {
  const usos = new Set(BIBLIOTECA.map((p) => p.uso));
  for (const [nombre, sec] of Object.entries(S.SECUENCIAS)) {
    for (const p of sec.pasos.filter((x) => x.accion === 'plantilla')) assert.ok(usos.has(p.uso), `${nombre}: ${p.uso}`);
  }
});

test('lead que entra el viernes 2-oct a las 22:10: el primer mensaje sale el sábado a las 10:00, no de noche', () => {
  const ins = { secuencia: 'lead', inicio: T.desdeMadrid('2026-10-02', '22:10') };
  assert.equal(madrid(S.momentoDelPaso(ins, 0, calendario).cuando), '2026-10-03 10:00');
});

test('el paso de las 4 h que cae en domingo pasa al siguiente día que abre (y se salta el festivo)', () => {
  const ins = { secuencia: 'lead', inicio: T.desdeMadrid('2026-10-03', '19:00') }; // sábado
  // 19:00 + 4 h = 23:00 del sábado → domingo cerrado → lunes 5 festivo → martes 6 a las 11:00.
  assert.equal(madrid(S.momentoDelPaso(ins, 1, calendario).cuando), '2026-10-06 11:00');
});

test('lead que entra el martes a las 23:30: la bienvenida sale el miércoles al abrir y el paso de las 4 h, 4 h después (no un minuto más tarde)', () => {
  const ins = { secuencia: 'lead', inicio: T.desdeMadrid('2026-10-06', '23:30') };
  const primero = S.momentoDelPaso(ins, 0, calendario).cuando;
  assert.equal(madrid(primero), '2026-10-07 11:00');
  assert.equal(madrid(S.momentoDelPaso(ins, 1, calendario).cuando), '2026-10-07 11:00', 'contado desde la entrada, los dos caerían juntos');
  assert.equal(madrid(S.momentoDelSiguiente(ins, 0, calendario, primero).cuando), '2026-10-07 15:00');
  // Si sale a su hora, el siguiente va a la suya; la tarea de las 24 h, a las 24 h de la inscripción.
  const deDia = { secuencia: 'lead', inicio: T.desdeMadrid('2026-10-06', '12:00') };
  assert.equal(madrid(S.momentoDelSiguiente(deDia, 0, calendario, T.desdeMadrid('2026-10-06', '12:00')).cuando), '2026-10-06 16:00');
  assert.equal(madrid(S.momentoDelSiguiente(deDia, 1, calendario, T.desdeMadrid('2026-10-06', '16:00')).cuando), '2026-10-07 12:00');
  assert.equal(S.momentoDelSiguiente(deDia, 4, calendario, T.desdeMadrid('2026-10-13', '12:00')), null);
});

test('presupuesto: 2, 7 y 21 días, con llamada a los 8 si el importe es alto', () => {
  const ins = { secuencia: 'presupuesto', inicio: T.desdeMadrid('2026-09-29', '12:00') };
  assert.equal(madrid(S.momentoDelPaso(ins, 0, calendario).cuando), '2026-10-01 12:00');
  assert.equal(madrid(S.momentoDelPaso(ins, 1, calendario).cuando), '2026-10-06 12:00');
  assert.equal(S.momentoDelPaso(ins, 2, calendario).paso.tarea, 'llamar');
  assert.equal(madrid(S.momentoDelPaso(ins, 3, calendario).cuando), '2026-10-20 12:00');
  assert.equal(S.momentoDelPaso(ins, 4, calendario), null);
});

test('en cuanto el paciente contesta, las secuencias se pausan; con cita, terminan', () => {
  const ins = [{ secuencia: 'lead', estado: 'activa' }, { secuencia: 'toca_repetir', estado: 'activa' }];
  assert.ok(S.alOcurrir('respuesta', ins).every((i) => i.estado === 'pausada'));
  const conCita = S.alOcurrir('cita', ins);
  assert.ok(conCita.every((i) => i.estado === 'terminada'));
  const pres = S.alOcurrir('cita', [{ secuencia: 'presupuesto', estado: 'activa' }]);
  assert.equal(pres[0].estado, 'terminada');
});

test('silencio pactado, bajas, consentimiento y límite de mensajes', () => {
  const ahora = new Date('2026-10-01T10:00:00Z');
  const base = { ahora, enviados: [], consentimientoMarketing: true };
  assert.equal(S.puedeEnviarComercial(base).ok, true);
  assert.match(S.puedeEnviarComercial({ ...base, seguimientoPendienteHasta: new Date('2026-10-06T09:30:00Z') }).motivo, /silencio pactado/);
  assert.equal(S.puedeEnviarComercial({ ...base, baja: true }).ok, false);
  assert.match(S.puedeEnviarComercial({ ...base, consentimientoMarketing: false }).motivo, /LSSI/);
  assert.equal(S.puedeEnviarComercial({ ...base, consentimientoMarketing: false, esClienteConServicioSimilar: true }).ok, true);
  const dos = [new Date('2026-09-29T10:00:00Z'), new Date('2026-09-30T10:00:00Z')];
  assert.match(S.puedeEnviarComercial({ ...base, enviados: dos }).motivo, /esta semana/);
});

test('con varias secuencias a la vez, manda la de más prioridad (presupuesto antes que toca repetir)', () => {
  const m = S.laQueManda([{ id: 1, secuencia: 'toca_repetir', estado: 'activa' }, { id: 2, secuencia: 'presupuesto', estado: 'activa' }, { id: 3, secuencia: 'lead', estado: 'pausada' }]);
  assert.equal(m.id, 2);
});

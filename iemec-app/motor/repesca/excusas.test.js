'use strict';
// Batería de excusas: cada frase se entiende bien y, si toca volver a escribir, la fecha es la
// correcta. Fechas y bajas: cero fallos (regla del encargo).
const test = require('node:test');
const assert = require('node:assert/strict');
const casos = require('./excusas.casos');
const { interpretar } = require('./interpretar');
const { calcularSeguimiento } = require('./plazos');
const { crearCalendario } = require('./calendario-clinica');

const calendario = crearCalendario({
  horario: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' }))
    .concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]),
  festivos: ['2026-10-05', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06', '2027-03-26'],
});
const HOY = '2026-09-29';
const AHORA_MIN = 600;

test(`la batería tiene al menos 100 frases (${casos.length})`, () => {
  assert.ok(casos.length >= 100);
});

for (const c of casos) {
  test(`«${c.frase}»`, () => {
    const r = interpretar(c.frase);
    assert.equal(r.intencion, c.intencion, `intención: ${JSON.stringify(r)}`);
    if (c.plazo) assert.equal(r.plazo?.tipo, c.plazo, `plazo: ${JSON.stringify(r.plazo)}`);
    if (c.urgente) assert.equal(r.urgente, true);
    if (c.fecha) {
      const s = calcularSeguimiento(r.plazo, { hoy: HOY, ahoraMin: AHORA_MIN, calendario, franja: r.franja });
      assert.equal(s.fecha, c.fecha, `fecha: ${JSON.stringify(s)}`);
      if (c.hora) assert.equal(s.hora, c.hora);
      assert.ok(calendario.abre(s.fecha), 'nunca un día que la clínica no abre');
      assert.ok(s.fecha >= HOY);
    }
  });
}

test('el texto que se le confirma al paciente lleva el día con número', () => {
  const s = calcularSeguimiento({ tipo: 'mes_siguiente' }, { hoy: HOY, ahoraMin: AHORA_MIN, calendario });
  assert.equal(s.texto, 'el martes 6 de octubre');
  const t = calcularSeguimiento({ tipo: 'hoy_tarde' }, { hoy: HOY, ahoraMin: AHORA_MIN, calendario });
  assert.equal(t.texto, 'esta tarde');
  const n = calcularSeguimiento({ tipo: 'tras_hito', hito: 'navidad' }, { hoy: HOY, ahoraMin: AHORA_MIN, calendario });
  assert.equal(n.texto, 'el lunes 11 de enero de 2027');
});

test('«ahora no puedo» a las 19:30 ya no es «esta tarde»: pasa a mañana', () => {
  const s = calcularSeguimiento({ tipo: 'hoy_tarde' }, { hoy: HOY, ahoraMin: 19 * 60 + 30, calendario });
  assert.equal(s.fecha, '2026-09-30');
});

test('la hora habitual del paciente manda si cabe en el horario', () => {
  const s = calcularSeguimiento({ tipo: 'semanas', n: 2 }, { hoy: HOY, ahoraMin: AHORA_MIN, calendario, horaHabitual: '19:10' });
  assert.equal(s.hora, '19:10');
  const fuera = calcularSeguimiento({ tipo: 'semanas', n: 2 }, { hoy: HOY, ahoraMin: AHORA_MIN, calendario, horaHabitual: '22:00' });
  assert.ok(fuera.hora < '20:00');
});

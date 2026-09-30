'use strict';
// El paciente elige (o no) entre los huecos propuestos. Hoy es miércoles 30-sep-2026 y se le
// ofrecieron: martes 6 a las 11:00 y a las 14:00, y miércoles 7 a las 11:00.
const test = require('node:test');
const assert = require('node:assert/strict');
const { elegirHueco, leerHora } = require('./eleccion');

const HOY = '2026-09-30';
const OFRECIDOS = [
  { fecha: '2026-10-06', hora: '11:00' },
  { fecha: '2026-10-06', hora: '14:00' },
  { fecha: '2026-10-07', hora: '11:00' },
];
const elige = (texto, huecos = OFRECIDOS) => elegirHueco(texto, huecos, { hoy: HOY });
const clave = (h) => `${h.fecha} ${h.hora}`;

const ELEGIDOS = [
  ['El martes a las 11', '2026-10-06 11:00'],
  ['el martes a las 2', '2026-10-06 14:00'],
  ['A las 14:00', '2026-10-06 14:00'],
  ['Sí, la de las 14:00 porfa', '2026-10-06 14:00'],
  ['El miércoles', '2026-10-07 11:00'],
  ['me viene bien el miercoles', '2026-10-07 11:00'],
  ['La primera', '2026-10-06 11:00'],
  ['la segunda opción', '2026-10-06 14:00'],
  ['el último', '2026-10-07 11:00'],
  ['la 1ª', '2026-10-06 11:00'],
  ['Perfecto, el 7', '2026-10-07 11:00'],
  ['El 6 a las 11:00', '2026-10-06 11:00'],
  ['el 6 de octubre a las 14h', '2026-10-06 14:00'],
  ['Mejor el miércoles', '2026-10-07 11:00'],
  ['El martes no puedo, mejor el miércoles', '2026-10-07 11:00'],
  ['el martes a las 11 mejor que el miércoles', '2026-10-06 11:00'],
  ['Vale, el martes a las dos', '2026-10-06 14:00'],
  ['ok el 7', '2026-10-07 11:00'],
  ['la primera no, la segunda', '2026-10-06 14:00'],
  ['Sí porfa, el martes a las 11 me va genial', '2026-10-06 11:00'],
];

for (const [frase, esperado] of ELEGIDOS) {
  test(`elige: «${frase}»`, () => {
    const r = elige(frase);
    assert.equal(r?.tipo, 'elegido', JSON.stringify(r));
    assert.equal(clave(r.hueco), esperado);
  });
}

test('con un solo hueco, «vale» o «sí» lo reservan', () => {
  for (const f of ['Vale', 'sí', 'Perfecto!!', 'ok', 'Genial, reservámelo', 'de acuerdo']) {
    const r = elige(f, [OFRECIDOS[2]]);
    assert.equal(r?.tipo, 'elegido', f);
    assert.equal(clave(r.hueco), '2026-10-07 11:00');
  }
});

test('dudoso: hay más de uno que encaja, se le pregunta cuál', () => {
  assert.deepEqual(elige('el martes').candidatos.map(clave), ['2026-10-06 11:00', '2026-10-06 14:00']);
  assert.deepEqual(elige('a las 11').candidatos.map(clave), ['2026-10-06 11:00', '2026-10-07 11:00']);
  assert.equal(elige('Vale').tipo, 'dudoso');
  assert.equal(elige('Vale').candidatos.length, 3);
  // Solo una preferencia («por la tarde») no es elegir: se confirma antes de reservar.
  const tarde = elige('por la tarde');
  assert.equal(tarde.tipo, 'dudoso');
  assert.deepEqual(tarde.candidatos.map(clave), ['2026-10-06 14:00']);
  assert.deepEqual(elige('vale, pero por la tarde').candidatos.map(clave), ['2026-10-06 14:00']);
});

test('ninguno le viene bien: se buscan otros', () => {
  for (const f of ['Ninguno me viene bien', 'no me viene bien ninguno', 'otro día', '¿Tenéis otras horas?', 'no me cuadran esos']) {
    assert.equal(elige(f)?.tipo, 'otros', f);
  }
  const r = elige('el martes no puedo');
  assert.equal(r.tipo, 'otros');
  assert.equal(r.evitar.diaSemana, 2);
  assert.equal(elige('ninguno, mejor por la tarde').franja, 'tarde');
});

test('pide algo que no se le ofreció: se mira en la agenda', () => {
  assert.deepEqual(elige('¿Y el jueves a las 12?'), { tipo: 'pide', fecha: '2026-10-01', hora: '12:00', franja: null });
  assert.deepEqual(elige('el jueves por la tarde'), { tipo: 'pide', fecha: '2026-10-01', hora: null, franja: 'tarde' });
  assert.deepEqual(elige('el viernes'), { tipo: 'pide', fecha: '2026-10-02', hora: null, franja: null });
  assert.deepEqual(elige('a las 7 de la tarde'), { tipo: 'pide', fecha: null, hora: '19:00', franja: null });
  assert.deepEqual(elige('mañana a las 12'), { tipo: 'pide', fecha: '2026-10-01', hora: '12:00', franja: null });
  assert.deepEqual(elige('el 15 de octubre'), { tipo: 'pide', fecha: '2026-10-15', hora: null, franja: null });
  assert.deepEqual(elige('a la una y media'), { tipo: 'pide', fecha: null, hora: '13:30', franja: null });
  assert.deepEqual(elige('Ninguno de esos días puedo, ¿el viernes por la tarde?'), { tipo: 'pide', fecha: '2026-10-02', hora: null, franja: 'tarde' });
  assert.deepEqual(elige('ninguno, mejor el jueves'), { tipo: 'pide', fecha: '2026-10-01', hora: null, franja: null });
  // «por la mañana» es una franja, no «mañana».
  assert.equal(elige('el lunes por la mañana').fecha, '2026-10-05');
});

test('lo que no habla de los huecos sigue la repesca normal', () => {
  for (const f of ['me lo pienso', 'gracias', '¿cuánto cuesta?', 'tengo dudas con el dolor', 'Hola']) {
    assert.equal(elige(f), null, f);
  }
  assert.equal(elige('vale', []), null);
});

test('horas escritas de muchas maneras', () => {
  assert.deepEqual(leerHora('a las 11:30'), { h: 11, m: 30 });
  assert.deepEqual(leerHora('a las 5 y media'), { h: 17, m: 30 });
  assert.deepEqual(leerHora('las once y cuarto'), { h: 11, m: 15 });
  assert.deepEqual(leerHora('sobre las 18h'), { h: 18, m: null });
  assert.deepEqual(leerHora('17.45'), { h: 17, m: 45 });
  assert.deepEqual(leerHora('a mediodía'.normalize('NFD').replace(/[̀-ͯ]/g, '')), { h: 12, m: null });
  assert.equal(leerHora('la semana que viene'), null);
});

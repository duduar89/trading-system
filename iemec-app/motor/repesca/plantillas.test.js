'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./plantillas');

test('toda la biblioteca de partida pasa el formato de Meta y el filtro legal', () => {
  for (const p of P.BIBLIOTECA) {
    const r = P.comprobarPlantilla(p);
    assert.ok(r.ok, `${p.nombre}: ${r.errores.join(' | ')}`);
  }
});

test('la biblioteca cubre todos los usos de la repesca y de la agenda', () => {
  const usos = new Set(P.BIBLIOTECA.map((p) => p.uso));
  for (const u of ['cita_confirmacion', 'cita_cambiada', 'cita_recordatorio_24h', 'cita_recordatorio_2h', 'cita_cancelada', 'hueco_liberado', 'lead_primer_contacto', 'lead_sin_cita',
    'cancelacion_recuperar', 'no_vino_recuperar', 'presupuesto_2d', 'presupuesto_7d', 'presupuesto_21d', 'como_quedamos', 'toca_repetir', 'paciente_dormido', 'vale_regalo', 'resena']) {
    assert.ok(usos.has(u), `falta ${u}`);
  }
});

test('lo que sale solo tras una cita no nombra el tratamiento ni dice lo que no ha pasado', () => {
  const de = (uso) => P.BIBLIOTECA.find((p) => p.uso === uso);
  // La cancelada, «No vino» y «toca repetir» llegan también a quien solo es cliente: sin {{2}} (el tratamiento).
  for (const uso of ['cancelacion_recuperar', 'no_vino_recuperar', 'toca_repetir']) assert.deepEqual(P.variablesDe(de(uso).cuerpo), [1], uso);
  assert.doesNotMatch(de('no_vino_recuperar').cuerpo, /cancel/i, 'a quien no vino no se le dice que canceló');
  assert.doesNotMatch(de('toca_repetir').cuerpo, /meses|semanas|años/i, 'los hay que se repiten cada mes');
  assert.doesNotMatch(de('resena').cuerpo, /\bhoy\b/i, 'la de una cita de tarde sale al día siguiente');
  assert.equal(P.rellenar(de('no_vino_recuperar'), ['Milagros']),
    'Hola Milagros, te echamos de menos en tu última cita en IEMEC. ¿Te buscamos otro momento que te venga mejor? Si no quieres recibir más mensajes como este, responde BAJA.');
});

test('las de la cita no nombran el tratamiento: día, hora y sede; el mapa y los botones de enlace, con el token al final', () => {
  const de = (uso) => P.BIBLIOTECA.find((p) => p.uso === uso);
  const sede = 'IEMEC (Av. Siglo XXI, 13, local 35, Boadilla del Monte)';
  const usos = ['cita_confirmacion', 'cita_cambiada', 'cita_recordatorio_24h', 'cita_recordatorio_2h', 'cita_cancelada'];
  for (const uso of usos) {
    const p = de(uso);
    assert.equal(p.categoria, 'utilidad', uso);
    assert.doesNotMatch(`${p.cuerpo} ${p.ejemplos.join(' ')}`, /tratamiento|valoraci[oó]n|facial|capilar/i, `${uso}: sin tratamiento`);
  }
  assert.deepEqual(de('cita_confirmacion').ejemplos, ['Laura', 'martes 6 de octubre', '17:00', sede]);
  assert.deepEqual(de('cita_recordatorio_24h').ejemplos, ['Laura', 'martes 6 de octubre', '17:00', sede]);
  assert.deepEqual(de('cita_recordatorio_2h').ejemplos, ['Laura', '17:00', sede]);
  // Confirmación (y cambio): mapa y dos botones de enlace, «Añadir al calendario» (/cal/) y «Ver mi cita» (/c/).
  for (const uso of ['cita_confirmacion', 'cita_cambiada']) {
    assert.deepEqual(de(uso).cabecera, { tipo: 'ubicacion' });
    assert.deepEqual(de(uso).botones.map((b) => [b.tipo, b.texto, b.url]), [
      ['url', 'Añadir al calendario', 'https://agenda.iemec-clinic.com/cal/{{1}}'],
      ['url', 'Ver mi cita', 'https://agenda.iemec-clinic.com/c/{{1}}'],
    ]);
  }
  assert.match(de('cita_cambiada').cuerpo, /bórrala y añade esta/);
  // La víspera: solo respuestas rápidas (se ve también en WhatsApp de escritorio).
  assert.deepEqual(de('cita_recordatorio_24h').botones, [{ tipo: 'respuesta_rapida', texto: 'Sí, allí estaré' }, { tipo: 'respuesta_rapida', texto: 'Necesito cambiarla' }]);
  assert.deepEqual(P.RESPUESTAS_VISPERA, ['Sí, allí estaré', 'Necesito cambiarla']);
  assert.deepEqual(P.comprobarPlantilla(de('cita_recordatorio_24h')).avisos, []);
  // Dos horas antes: el mapa y «Ver mi cita». Cancelada: sin botones (que Meta no la pase a marketing).
  assert.deepEqual(de('cita_recordatorio_2h').cabecera, { tipo: 'ubicacion' });
  assert.deepEqual(de('cita_recordatorio_2h').botones.map((b) => b.url), ['https://agenda.iemec-clinic.com/c/{{1}}']);
  assert.deepEqual(de('cita_cancelada').botones, []);
  assert.match(de('cita_cancelada').cuerpo, /Si la tenías en tu calendario, bórrala/);
});

test('formato: la variable del enlace, al final y con ejemplo; el mapa, solo en utilidad o marketing; aviso para el escritorio', () => {
  const base = { nombre: 'iemec_prueba', categoria: 'utilidad', cuerpo: 'Hola {{1}}, esta es tu cita de hoy en IEMEC.', ejemplos: ['Laura'] };
  const errores = (p) => P.validarFormato({ ...base, ...p });
  assert.deepEqual(errores({ botones: [{ tipo: 'url', texto: 'Ver', url: 'https://agenda.iemec-clinic.com/c/{{1}}', ejemplo: 'abc' }] }), []);
  assert.ok(errores({ botones: [{ tipo: 'url', texto: 'Ver', url: 'https://agenda.iemec-clinic.com/{{1}}/c', ejemplo: 'abc' }] }).some((e) => /al final/.test(e)));
  assert.ok(errores({ botones: [{ tipo: 'url', texto: 'Ver', url: 'https://agenda.iemec-clinic.com/c/{{1}}' }] }).some((e) => /ejemplo/.test(e)));
  assert.ok(errores({ botones: [1, 2, 3].map((i) => ({ tipo: 'url', texto: `Ver ${i}`, url: 'https://x.es/a' })) }).some((e) => /2 botones de enlace/.test(e)));
  assert.ok(errores({ cabecera: { tipo: 'holograma' } }).some((e) => /Cabecera desconocida/.test(e)));
  assert.ok(errores({ categoria: 'autenticacion', cabecera: { tipo: 'ubicacion' } }).some((e) => /mapa/.test(e)));
  const mezcla = P.comprobarPlantilla({ ...base, botones: [{ tipo: 'respuesta_rapida', texto: 'Sí' }, { tipo: 'url', texto: 'Ver', url: 'https://x.es/a' }] });
  assert.ok(mezcla.avisos.some((a) => /escritorio/.test(a)));
  // Los botones y la cabecera, vengan de la biblioteca o de la base (JSON en texto).
  assert.deepEqual(P.botonesDe({ botones: '[{"tipo":"url","texto":"Ver"}]' }), [{ tipo: 'url', texto: 'Ver' }]);
  assert.deepEqual(P.cabeceraDe({ cabecera: '{"tipo":"ubicacion"}' }), { tipo: 'ubicacion' });
  assert.equal(P.cabeceraDe({ cabecera: null }), null);
  assert.deepEqual(P.botonesDe({}), []);
});

test('las de marketing llevan la baja y las de repesca, los tres botones', () => {
  for (const p of P.BIBLIOTECA.filter((x) => x.categoria === 'marketing')) assert.match(p.cuerpo, /responde BAJA/);
  const cq = P.BIBLIOTECA.find((x) => x.uso === 'como_quedamos');
  assert.deepEqual(cq.botones.map((b) => b.texto), ['Sí, búscame hueco', 'Más adelante', 'No, gracias']);
});

test('formato: detecta los errores típicos que hacen que Meta rechace', () => {
  const mal = { nombre: 'Promo Otoño', cuerpo: '{{1}} tienes 20% en {{3}}', ejemplos: ['Ana'], categoria: 'marketing', botones: [{ tipo: 'respuesta_rapida', texto: 'Quiero aprovechar esta oferta ya mismo' }] };
  const e = P.validarFormato(mal);
  assert.ok(e.some((x) => /minúsculas/.test(x)));
  assert.ok(e.some((x) => /seguidas/.test(x)));
  assert.ok(e.some((x) => /ejemplo/.test(x)));
  assert.ok(e.some((x) => /empezar ni acabar/.test(x)));
  assert.ok(e.some((x) => /25 caracteres/.test(x)));
});

test('estados: solo transiciones posibles', () => {
  assert.ok(P.puedePasar('borrador', 'en_revision'));
  assert.ok(P.puedePasar('en_revision', 'rechazada'));
  assert.ok(P.puedePasar('aprobada', 'pausada'));
  assert.ok(!P.puedePasar('desactivada', 'aprobada'));
  assert.ok(!P.puedePasar('borrador', 'aprobada'));
});

test('si Meta pausa la principal o su calidad es roja, entra la de reserva', () => {
  const lista = [
    { id: 1, uso: 'como_quedamos', estado: 'aprobada', calidad: 'verde' },
    { id: 2, uso: 'como_quedamos', estado: 'aprobada', calidad: 'verde', reservaDeId: 1 },
  ];
  assert.equal(P.elegirPlantilla('como_quedamos', lista).id, 1);
  lista[0].estado = 'pausada';
  assert.equal(P.elegirPlantilla('como_quedamos', lista).id, 2);
  lista[0].estado = 'aprobada'; lista[0].calidad = 'roja';
  assert.equal(P.elegirPlantilla('como_quedamos', lista).id, 2);
  lista[1].estado = 'rechazada';
  assert.equal(P.elegirPlantilla('como_quedamos', lista), null);
});

test('rellenar variables para la vista previa', () => {
  const p = P.BIBLIOTECA.find((x) => x.uso === 'como_quedamos');
  assert.match(P.rellenar(p, ['Laura', 'tu tratamiento facial']), /^Hola Laura, como quedamos, te escribo para buscarte hueco para tu tratamiento facial\./);
});

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
  for (const u of ['cita_confirmacion', 'cita_recordatorio_24h', 'cita_cancelada', 'hueco_liberado', 'lead_primer_contacto', 'lead_sin_cita',
    'cancelacion_recuperar', 'no_vino_recuperar', 'presupuesto_2d', 'presupuesto_7d', 'presupuesto_21d', 'como_quedamos', 'toca_repetir', 'paciente_dormido', 'vale_regalo', 'resena']) {
    assert.ok(usos.has(u), `falta ${u}`);
  }
});

test('lo que sale solo tras una cita no nombra el tratamiento ni dice lo que no ha pasado', () => {
  const de = (uso) => P.BIBLIOTECA.find((p) => p.uso === uso);
  // «No vino» y «toca repetir» llegan también a quien solo es cliente: sin {{2}} (el tratamiento).
  for (const uso of ['no_vino_recuperar', 'toca_repetir']) assert.deepEqual(P.variablesDe(de(uso).cuerpo), [1], uso);
  assert.doesNotMatch(de('no_vino_recuperar').cuerpo, /cancel/i, 'a quien no vino no se le dice que canceló');
  assert.doesNotMatch(de('toca_repetir').cuerpo, /meses|semanas|años/i, 'los hay que se repiten cada mes');
  assert.doesNotMatch(de('resena').cuerpo, /\bhoy\b/i, 'la de una cita de tarde sale al día siguiente');
  assert.equal(P.rellenar(de('no_vino_recuperar'), ['Milagros']),
    'Hola Milagros, te echamos de menos en tu última cita en IEMEC. ¿Te buscamos otro momento que te venga mejor? Si no quieres recibir más mensajes como este, responde BAJA.');
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

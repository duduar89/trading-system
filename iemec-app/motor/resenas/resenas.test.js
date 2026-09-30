'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./resenas');
const { crearCalendario } = require('../repesca/calendario-clinica');
const { BIBLIOTECA } = require('../repesca/plantillas');
const T = require('../tiempo');

const horario = [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, abre: '11:00', cierra: '20:00' })).concat([{ dia_semana: 6, abre: '10:00', cierra: '20:00' }]);
const calendario = crearCalendario({ horario, festivos: ['2026-10-05', '2026-10-12'] });
const madrid = (d) => { const p = T.partesMadrid(d); return `${p.fecha} ${p.hora}`; };
// El equipo tal y como está en la web de la clínica (datos públicos, semillas/iemec/equipo.json).
const EQUIPO = require('../../semillas/iemec/equipo.json').profesionales.map((p) => p.nombre);
// Los nombres y alias del catálogo consolidado, como los pasa el servidor al revisar una respuesta.
const CATALOGO = require('../../semillas/iemec/tratamientos.json').tratamientos.flatMap((t) => [t.nombre, ...(t.alias || [])]);

test('se pide a todos tras la cita, dos horas después y en horario', () => {
  const r = R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '12:00') }, paciente: {} }, calendario);
  assert.equal(r.pedir, true);
  assert.equal(r.variante, '2h');
  assert.equal(madrid(r.cuando), '2026-10-06 14:00');
  // Cita que acaba a las 19:30 del sábado 3-oct: domingo cerrado, lunes 5 festivo → martes 6 a las 10:30.
  const tarde = R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid('2026-10-03', '19:30') }, paciente: {} }, calendario);
  assert.equal(madrid(tarde.cuando), '2026-10-06 10:30');
});

test('solo se deja de pedir por la baja (de la ficha o de la lista), la reseña ya hecha o una petición de hace menos de 120 días; una queja no lo impide', () => {
  const base = { cita: { estado: 'completada', fin: new Date('2026-10-06T10:00:00Z') }, paciente: {} };
  assert.equal(R.pedirResena({ ...base, cita: { ...base.cita, estado: 'no_presentada' } }, calendario).pedir, false);
  assert.deepEqual(R.pedirResena({ ...base, paciente: { baja_comercial_en: new Date() } }, calendario), { pedir: false, motivo: R.DE_BAJA });
  assert.deepEqual(R.pedirResena({ ...base, bajaComercial: true }, calendario), { pedir: false, motivo: R.DE_BAJA }, 'la lista de bajas por teléfono también');
  assert.equal(R.pedirResena({ ...base, yaResenoEnGoogle: true }, calendario).pedir, false);
  assert.equal(R.pedirResena({ ...base, ultimaPeticion: new Date('2026-08-01T10:00:00Z') }, calendario).pedir, false);
  // Excluir a quien se ha quejado es pedir solo a los contentos: la queja se atiende en paralelo.
  const conQueja = R.pedirResena({ ...base, conversacionAbiertaConQueja: true }, calendario);
  assert.equal(conQueja.pedir, true);
  assert.equal(conQueja.motivo, undefined);
});

test('una sola petición aunque complete dos citas el mismo día; y al enviarla se vuelve a mirar todo', () => {
  const cita = { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '13:10') };
  // Al programar la de la segunda cita, la de la primera aún no ha salido: esta no se pide.
  assert.deepEqual(R.pedirResena({ cita, paciente: {}, otraEnCamino: true }, calendario), { pedir: false, motivo: R.OTRA_EN_CAMINO });
  // Justo antes de enviarla cuenta lo de ese momento: una baja o una petición que ya salió.
  const envio = { cita, paciente: {}, referencia: T.desdeMadrid('2026-10-06', '15:10') };
  assert.equal(R.motivoParaNoPedir(envio, { referencia: envio.referencia }), null);
  assert.equal(R.motivoParaNoPedir({ ...envio, paciente: { baja_comercial_en: T.desdeMadrid('2026-10-06', '14:30') } }), 'se dio de baja de los mensajes');
  assert.equal(R.motivoParaNoPedir({ ...envio, conversacionAbiertaConQueja: true }), null, 'una queja de después tampoco la para');
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

test('la prueba del momento: 2 horas después, al día siguiente a las 11:00 o a los 3 días, siempre en horario y un día que abre', () => {
  const pedir = (fecha, hora, variante, extra = {}) => {
    const r = R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid(fecha, hora) }, paciente: {}, variante, ...extra }, calendario);
    assert.equal(r.variante, variante);
    return madrid(r.cuando);
  };
  // Martes 6-oct, acaba a las 12:00.
  assert.equal(pedir('2026-10-06', '12:00', '2h'), '2026-10-06 14:00');
  assert.equal(pedir('2026-10-06', '12:00', 'dia_siguiente'), '2026-10-07 11:00');
  assert.equal(pedir('2026-10-06', '12:00', 'tres_dias'), '2026-10-09 12:00');
  // Viernes 9-oct a las 19:00: el sábado abre; a los 3 días es el lunes 12, festivo → martes a las 10:30.
  assert.equal(pedir('2026-10-09', '19:00', '2h'), '2026-10-10 10:30');
  assert.equal(pedir('2026-10-09', '19:00', 'dia_siguiente'), '2026-10-10 11:00');
  assert.equal(pedir('2026-10-09', '19:00', 'tres_dias'), '2026-10-13 10:30');
  // Sábado 3-oct a las 19:30: domingo cerrado y lunes festivo → el martes, a las 11:00 la del día siguiente.
  assert.equal(pedir('2026-10-03', '19:30', 'dia_siguiente'), '2026-10-06 11:00');
  assert.equal(pedir('2026-10-03', '19:30', 'tres_dias'), '2026-10-06 19:30');
  // Nunca antes de que se pueda deshacer: completada el miércoles a las 12:30.
  assert.equal(pedir('2026-10-06', '12:00', 'dia_siguiente', { noAntesDe: T.desdeMadrid('2026-10-07', '13:00') }), '2026-10-07 13:00');
  // Una variante que no existe: la de siempre.
  assert.equal(R.pedirResena({ cita: { estado: 'completada', fin: T.desdeMadrid('2026-10-06', '12:00') }, paciente: {}, variante: 'ya' }, calendario).variante, '2h');
});

test('la variante se reparte entre las citas y es siempre la misma para la misma cita', () => {
  const cuenta = { '2h': 0, dia_siguiente: 0, tres_dias: 0 };
  for (let id = 1; id <= 600; id++) cuenta[R.elegirVariante(id)]++;
  for (const v of R.VARIANTES) assert.ok(cuenta[v] > 150 && cuenta[v] < 250, JSON.stringify(cuenta));
  assert.equal(R.elegirVariante(4242), R.elegirVariante(4242));
  // Si la clínica se queda con una, todas esa; sin ninguna, la de siempre.
  assert.ok([1, 2, 3, 4, 5].every((id) => R.elegirVariante(id, ['tres_dias']) === 'tres_dias'));
  assert.ok([1, 2, 3].every((id) => ['2h', 'dia_siguiente'].includes(R.elegirVariante(id, ['2h', 'dia_siguiente']))));
  assert.equal(R.elegirVariante(7, []), '2h');
});

test('un solo recordatorio, a los 7-9 días y solo si no abrió el enlace', () => {
  // Enviada el martes 6-oct a las 16:00 → el martes 13 a las 16:00.
  assert.equal(madrid(R.momentoRecordatorio(T.desdeMadrid('2026-10-06', '16:00'), calendario)), '2026-10-13 16:00');
  // Un sábado (la clínica abre): el sábado siguiente.
  assert.equal(madrid(R.momentoRecordatorio(T.desdeMadrid('2026-10-03', '12:00'), calendario)), '2026-10-10 12:00');
  // El día 7 es festivo → el día 8, al abrir el horario de envío.
  const puente = crearCalendario({ horario, festivos: ['2026-10-13', '2026-10-14'] });
  assert.equal(madrid(R.momentoRecordatorio(T.desdeMadrid('2026-10-06', '10:45'), puente)), '2026-10-15 10:30');
  // Cerrada del día 7 al 9: no hay recordatorio.
  const cerrada = crearCalendario({ horario, festivos: ['2026-10-13', '2026-10-14', '2026-10-15'] });
  assert.equal(R.momentoRecordatorio(T.desdeMadrid('2026-10-06', '10:45'), cerrada), null);

  const enviada = T.desdeMadrid('2026-10-06', '16:00');
  const base = { peticion: { estado: 'enviada', enviada_en: enviada, pulsada_en: null }, cita: { estado: 'completada' }, paciente: {} };
  const dia8 = T.desdeMadrid('2026-10-14', '12:00');
  assert.equal(R.motivoParaNoRecordar(base, { ahora: dia8 }), null);
  assert.equal(R.motivoParaNoRecordar({ ...base, peticion: { ...base.peticion, pulsada_en: T.desdeMadrid('2026-10-07', '09:00') } }, { ahora: dia8 }), 'ya abrió el enlace');
  assert.equal(R.motivoParaNoRecordar({ ...base, bajaComercial: true }, { ahora: dia8 }), R.DE_BAJA);
  assert.equal(R.motivoParaNoRecordar({ ...base, yaResenoEnGoogle: true }, { ahora: dia8 }), 'ya dejó una reseña');
  assert.equal(R.motivoParaNoRecordar({ ...base, peticion: { ...base.peticion, estado: 'fallida' } }, { ahora: dia8 }), 'la petición no salió');
  // Una queja no lo para (como la petición); el plazo sí: el día 9 a las 20:00, con una hora de margen.
  assert.equal(R.motivoParaNoRecordar({ ...base, conversacionAbiertaConQueja: true }, { ahora: dia8 }), null);
  assert.equal(R.motivoParaNoRecordar(base, { ahora: T.desdeMadrid('2026-10-15', '20:30') }), null);
  assert.match(R.motivoParaNoRecordar(base, { ahora: T.desdeMadrid('2026-10-16', '11:00') }), /plazo/);
});

test('el enlace: el oficial de la ficha (newReviewUri) si lo hay y es de Google; si no, el de reserva con el place_id', () => {
  assert.equal(R.enlaceResena('ChIJ123'), 'https://search.google.com/local/writereview?placeid=ChIJ123');
  const oficial = 'https://search.google.com/local/writereview?placeid=ChIJB6Pn5d2FQQ0ReZ4Qoqe8gtg&source=g.page.m';
  assert.equal(R.enlaceParaResenar({ enlaceFicha: oficial, placeId: 'ChIJ123' }), oficial);
  assert.equal(R.enlaceParaResenar({ enlaceFicha: 'https://g.page/r/CXyz123/review', placeId: 'ChIJ123' }), 'https://g.page/r/CXyz123/review');
  // El de Places (writeAReviewUri) también es de Google.
  assert.equal(R.esEnlaceDeGoogle('https://www.google.com/maps/place//data=!4m3!3m2!1s0x0:0x0!12e1'), true);
  // Solo hosts de Google de una lista cerrada: un subdominio de otro («google.abc.io») lleva a otro sitio.
  for (const malo of ['https://ejemplo.invalid/resena', 'http://search.google.com/local/writereview?placeid=x', 'https://google.com.ejemplo.invalid/x', 'javascript:alert(1)', 'no es un enlace',
    'https://google.abc.io/opina', 'https://google.xyz.uk/r', 'https://usuario:clave@search.google.com/x', 'https://search.google.com:8443/x']) {
    assert.equal(R.enlaceParaResenar({ enlaceFicha: malo, placeId: 'ChIJ123' }), 'https://search.google.com/local/writereview?placeid=ChIJ123', malo);
  }
  assert.equal(R.enlaceParaResenar({}), null);
});

test('el mensaje que pide la reseña cumple las normas de Google: el de la biblioteca sí; los que piden estrellas, filtran, regalan o sugieren, no', () => {
  for (const uso of ['resena', 'resena_recordatorio']) {
    const p = BIBLIOTECA.find((x) => x.uso === uso);
    const r = R.revisarPeticion(p.cuerpo, { profesionales: EQUIPO });
    assert.ok(r.ok, `${uso}: ${r.errores.join(' | ')}`);
    assert.equal(p.categoria, 'utilidad', 'sobre esa visita, sin promoción: Meta la puede aprobar como utilidad');
    assert.match(p.cuerpo, /visita a IEMEC del \{\{2\}\}/, 'dice de qué visita (su día), sin el tratamiento');
    assert.deepEqual(p.botones.map((b) => b.url), ['https://agenda.iemec-clinic.com/r/{{1}}']);
  }
  const baja = 'Si no quieres recibir más mensajes como este, responde BAJA.';
  const casos = [
    [`Hola {{1}}, gracias por tu visita. ¡Déjanos 5 estrellas en Google! ${baja}`, /estrellas/],
    [`Hola {{1}}, si te ha gustado tu visita, déjanos tu opinión en Google. ${baja}`, /contento/],
    [`Hola {{1}}, gracias por tu visita. Si algo no fue bien, escríbenos antes de publicar. ${baja}`, /contento/],
    [`Hola {{1}}, gracias por tu visita. Por tu opinión te regalamos un 10 % de descuento. ${baja}`, /a cambio/],
    [`Hola {{1}}, gracias por tu visita. Menciona a la Dra. Perea en tu opinión. ${baja}`, /qué escribir|equipo/],
    [`Hola {{1}}, gracias por tu visita. ¿Qué tal te trató Maribel? ${baja}`, /nadie del equipo/],
    [`Hola {{1}}, gracias por tu visita y por confiarnos tu tratamiento de láser. ${baja}`, /tratamiento/],
    ['Hola {{1}}, gracias por tu visita de hoy. Tu opinión en Google nos ayuda mucho.', /hoy/],
    ['Hola {{1}}, gracias por tu visita. Tu opinión en Google nos ayuda mucho.', /baja/i],
    [`Hola {{1}}, ¿nos dejas tu opinión en Google? ${baja}`, /visita/],
  ];
  for (const [texto, motivo] of casos) {
    const r = R.revisarPeticion(texto, { profesionales: EQUIPO });
    assert.equal(r.ok, false, texto);
    assert.ok(r.errores.some((e) => motivo.test(e)), `${texto} → ${r.errores.join(' | ')}`);
  }
});

test('temas, sentimiento, el tema nuevo «seguimiento» y la alerta clínica', () => {
  const a = R.analizar({ nota: 5, texto: 'Trato exquisito y muy profesionales. Los resultados, naturales. La clínica preciosa.' });
  assert.deepEqual(a.temas.sort(), ['instalaciones', 'profesionalidad', 'resultados', 'trato']);
  assert.equal(a.sentimiento, 'positivo');
  assert.equal(a.alertaClinica, false);
  const b = R.analizar({ nota: 4, texto: 'Bien pero una hora de retraso' });
  assert.equal(b.sentimiento, 'mixto');
  assert.ok(b.temas.includes('espera_puntualidad'));
  assert.equal(R.analizar({ nota: 1, texto: 'No contestan nunca al teléfono' }).prioridad, 'alta');
  assert.ok(R.analizar({ nota: 5, texto: 'Me llamaron al día siguiente para ver qué tal estaba. Un seguimiento de diez.' }).temas.includes('seguimiento'));
  assert.ok(R.analizar({ nota: 5, texto: 'Estuvieron pendientes de mí toda la semana' }).temas.includes('seguimiento'));

  // Complicaciones y reclamaciones: alerta clínica (prioridad alta), con sus formas corrientes.
  const alertas = [
    ['Se me infectó la zona y nadie me llamó', 'infección'],
    ['Se me infectaron los puntos, fatal', 'infección'],
    ['Me quemaron la piel con el aparato', 'quemadura'],
    ['Me quemé con el láser', 'quemadura'],
    ['Tuve una complicación y tardaron en verme', 'complicación'],
    ['Acabé en urgencias esa misma noche', 'urgencias'],
    ['Me salió una necrosis en la zona', 'necrosis'],
    ['Voy a poner una denuncia', 'denuncia'],
    ['Voy a poner una demanda', 'denuncia'],
    ['Lo llevaré a juicio', 'denuncia'],
    ['He puesto una reclamación en Consumo', 'denuncia'],
    ['Pedí la hoja de reclamaciones', 'denuncia'],
    ['Ya lo tiene mi abogado', 'abogado'],
    ['Me dejaron una cicatriz horrible', 'cicatriz'],
    ['Me salió un hematoma enorme y se me inflamó la cara', 'hematoma'],
    ['Me salió un hematoma enorme y se me inflamó la cara', 'inflamación'],
    ['Me quedó la cara paralizada', 'parálisis'],
    // La frase se corta en la coma y en «pero»: lo de antes no niega lo de después.
    ['Sin dolor, pero con una quemadura que aún tengo', 'quemadura'],
  ];
  for (const [texto, alerta] of alertas) {
    const r = R.analizar({ nota: 1, texto });
    assert.equal(r.alertaClinica, true, texto);
    assert.ok(r.alertas.includes(alerta), `${texto} → ${r.alertas}`);
    assert.equal(r.prioridad, 'alta');
  }
  // Negado o dicho de pasada no es una alerta: una reseña contenta no manda una tarea urgente a
  // dirección médica ni le quita a marketing la respuesta.
  for (const texto of ['Todo perfecto, sin ninguna complicación', 'Cero complicaciones, genial', 'No tuve ninguna infección', 'No hubo ni una sola complicación',
    'Me explicaron las posibles complicaciones', 'Sin hematomas ni inflamación, estupendo', 'Me han mejorado muchísimo las cicatrices del acné',
    'A mi juicio, los mejores', 'Tienen mucha demanda: cuesta conseguir cita', 'Qué hospitalidad', 'Todo desinfectado y limpísimo', 'Me ayudó a quemar grasa']) {
    const r = R.analizar({ nota: 5, texto });
    assert.deepEqual([r.alertaClinica, r.alertas], [false, []], texto);
    assert.notEqual(r.prioridad, 'alta', texto);
  }
  // Más formas corrientes: la demanda suelta, «de urgencia», los antibióticos, la fiebre.
  for (const [texto, alerta] of [
    ['Os voy a poner una demanda', 'denuncia'], ['Una demanda es lo que os merecéis', 'denuncia'], ['Tuve que ir al médico de urgencia', 'urgencias'],
    ['Tuve que tomar antibióticos dos semanas', 'antibióticos'], ['Me ha quedado una cicatriz horrible', 'cicatriz'], ['Estuve con fiebre tres días', 'fiebre'],
    ['Me salió un absceso', 'reacción grave'],
  ]) {
    assert.ok(R.analizar({ nota: 1, texto }).alertas.includes(alerta), `${texto} → ${R.analizar({ nota: 1, texto }).alertas}`);
  }
  // En francés y en inglés (el injerto capilar tiene pacientes de Francia).
  for (const [texto, alerta] of [
    ["J'ai eu une infection après la greffe, je vais porter plainte avec mon avocat", 'infección'],
    ["J'ai eu une infection après la greffe, je vais porter plainte avec mon avocat", 'denuncia'],
    ["J'ai eu une infection après la greffe, je vais porter plainte avec mon avocat", 'abogado'],
    ['Complication grave… je suis allé aux urgences', 'complicación'], ['Complication grave… je suis allé aux urgences', 'urgencias'],
    ['Brûlure au visage après le laser', 'quemadura'], ['Nécrose après injection', 'necrosis'], ["J'ai été hospitalisée", 'urgencias'],
    ['I got an infection and a burn, my lawyer will contact you', 'abogado'], ['I got an infection and a burn, my lawyer will contact you', 'quemadura'],
    ['I ended up in hospital, I will sue you', 'denuncia'], ['Terrible experience, I had to go to the ER', 'urgencias'], ['Awful scarring after the procedure', 'cicatriz'],
  ]) {
    assert.ok(R.analizar({ nota: 1, texto }).alertas.includes(alerta), `${texto} → ${R.analizar({ nota: 1, texto }).alertas}`);
  }
  for (const texto of ['Sans aucune complication, parfait', 'No complications at all, great team', 'It helped me burn fat, amazing', 'Sue at reception was lovely',
    'Me dieron cita de urgencia y todo genial', 'Tienen tanta demanda que hay que reservar con tiempo', 'Hospitalité parfaite, merci']) {
    assert.deepEqual(R.analizar({ nota: 5, texto }).alertas, [], texto);
  }
  // Lo de contexto (cicatriz, hematoma…) cuenta si la reseña no es de las contentas.
  assert.deepEqual(R.analizar({ nota: 2, texto: 'Me quedó una cicatriz' }).alertas, ['cicatriz']);
  assert.deepEqual(R.analizar({ nota: 5, texto: 'Me quedó una cicatriz pequeña, todo genial' }).alertas, []);
  // Una contenta que cuenta una complicación de verdad, sí: la ve dirección médica.
  assert.equal(R.analizar({ nota: 5, texto: 'Tuve una infección pero me la trataron enseguida, genial' }).alertaClinica, true);
  for (const texto of ['Trato excelente y resultados naturales', 'Muy atentos en recepción', 'Fui con miedo y salí encantada']) {
    assert.equal(R.analizar({ nota: 5, texto }).alertaClinica, false, texto);
  }
  // El tono: «explicaron» no es «caro» ni «último» un «timo».
  assert.equal(R.analizar({ nota: 5, texto: 'Me lo explicaron todo muy bien' }).sentimiento, 'positivo');
  assert.equal(R.analizar({ nota: 5, texto: 'El último día me atendieron igual de bien' }).sentimiento, 'positivo');
  assert.equal(R.analizar({ nota: 4, texto: 'Bien, pero algo caro' }).sentimiento, 'mixto');
});

test('las respuestas: breves, variadas, en neutro, sin tratamiento, fechas ni equipo, y sin confirmar que es paciente', () => {
  const r1 = R.borradorRespuesta({ autor: 'Laura Gómez', nota: 5, texto: 'Me puse bótox con la doctora y genial, muy profesionales' }, { indice: 0 });
  const r2 = R.borradorRespuesta({ autor: 'Carmen', nota: 5, texto: 'Relleno de labios perfecto, trato encantador' }, { indice: 1 });
  for (const r of [r1, r2]) {
    assert.doesNotMatch(r.texto, /b[oó]tox|toxina|relleno|labios|tratamiento|paciente|doctora|visita|cita/i);
    assert.equal(r.requiereAprobacion, true);
  }
  assert.match(r1.texto, /Laura/);
  assert.notEqual(r1.texto.split(' ')[0], r2.texto.split(' ')[0]);
  assert.match(r2.texto, /que el trato haya estado a la altura/i, 'lenguaje neutro');
  const neg = R.borradorRespuesta({ autor: 'Pedro', nota: 1, texto: 'Fatal, me cobraron de más por el injerto' });
  assert.match(neg.texto, /en privado/);
  assert.match(neg.texto, /722 83 32 85/, 'con el teléfono de la ficha');
  assert.doesNotMatch(neg.texto, /injerto|cobr/);
  // Sin nombre de pila válido, sin nombre; y el de la ficha, en mayúsculas o no, bien escrito.
  assert.match(R.borradorRespuesta({ autor: 'Usuario de Google', nota: 5 }).texto, /^¡Muchas gracias! /);
  assert.equal(R.primerNombre('LAURA GÓMEZ'), 'Laura');
  assert.equal(R.primerNombre('M. G.'), '');

  // Una alerta clínica de 1-3 estrellas: ni un detalle en público, que llame.
  const alerta = R.borradorRespuesta({ autor: 'Rosa', nota: 1, texto: 'Me quemaron la cara con el láser, voy a denunciar' });
  assert.match(alerta.texto, /en privado/);
  assert.doesNotMatch(alerta.texto, /quem|láser|laser|denunci|cara/i);

  // Veinte seguidas (el historial de un día): ninguna igual, y todas pasan la revisión.
  const recientes = [];
  const textos = ['Muy buen trato', 'Instalaciones preciosas', '', 'Resultados naturales, encantada', 'Muy profesionales, lo explican todo'];
  for (let i = 0; i < 20; i++) {
    const nota = [5, 5, 4, 5, 3][i % 5];
    const b = R.borradorRespuesta({ autor: ['Ana', 'Luis', 'Marta'][i % 3], nota, texto: textos[i % textos.length] }, { indice: i, recientes });
    const rev = R.revisarRespuesta(b.texto, { resena: { nota, autor: ['Ana', 'Luis', 'Marta'][i % 3], texto: textos[i % textos.length] }, profesionales: EQUIPO, recientes });
    assert.ok(rev.ok, `${b.texto} → ${rev.errores.join(' | ')}`);
    assert.deepEqual(rev.avisos, [], b.texto);
    recientes.push(b.texto);
  }
  assert.equal(new Set(recientes.map(R.huella)).size, 20, 'ninguna repetida');
  // Tampoco las negativas, las de alerta o las mixtas: doce seguidas de cada, todas distintas.
  for (const [nota, texto] of [[1, 'Muy mal'], [2, 'Me hicieron esperar muchísimo, fatal'], [1, 'Me quemaron, voy a denunciar'], [3, 'Regular']]) {
    const hechas = [];
    for (let i = 0; i < 12; i++) hechas.push(R.borradorRespuesta({ autor: ['Rosa', 'Pedro', 'Irene'][i % 3], nota, texto }, { indice: i, recientes: hechas }).texto);
    assert.equal(new Set(hechas.map(R.huella)).size, 12, `${nota} ★: ${texto}`);
    if (nota <= 2) assert.ok(hechas.every((x) => /722 83 32 85/.test(x) && /en privado/.test(x)), texto);
  }
  // Si la que tocaría ya salió hace poco, sale otra.
  const repetida = R.borradorRespuesta({ autor: 'Julia', nota: 5, texto: '' }, { indice: 0, recientes: ['¡Muchas gracias, Ana! Un saludo de todo el equipo de IEMEC.'] });
  assert.notEqual(R.huella(repetida.texto), R.huella('¡Muchas gracias, Ana! Un saludo de todo el equipo de IEMEC.'));
});

test('las respuestas no se agotan: cada clase tiene 120 o más distintas y el borrador salta las de la ventana de recientes', () => {
  const clases = {
    '5 ★ que habla del trato': { nota: 5, texto: 'Muy buen trato' },
    '5 ★ sin texto': { nota: 5, texto: '' },
    '5 ★ con texto y sin tema': { nota: 5, texto: 'Genial todo' },
    '3 ★': { nota: 3, texto: 'Regular' },
    '4 ★ con espera': { nota: 4, texto: 'Bien, pero una hora de retraso' },
    'negativa': { nota: 1, texto: 'Muy mal' },
    'alerta clínica': { nota: 1, texto: 'Me quemaron, voy a denunciar' },
  };
  for (const [clase, r] of Object.entries(clases)) {
    const resena = { autor: 'Ana', ...r };
    const distintas = new Set();
    for (let i = 0; i < 400; i++) distintas.add(R.huella(R.borradorRespuesta(resena, { indice: i }).texto));
    assert.equal(distintas.size, R.variedad(resena), clase);
    assert.ok(distintas.size >= 120, `${clase}: ${distintas.size}`);
    // Con las 60 recientes de la misma clase (y los 20 borradores del día), sale otra que no está.
    const recientes = [];
    for (let i = 0; i < 80; i++) recientes.push(R.borradorRespuesta({ ...resena, autor: ['Luis', 'Marta', 'Pablo'][i % 3] }, { indice: 7 * i, recientes }).texto);
    assert.equal(new Set(recientes.map(R.huella)).size, 80, clase);
    const otra = R.borradorRespuesta(resena, { indice: 3, recientes });
    assert.ok(!recientes.map(R.huella).includes(R.huella(otra.texto)), clase);
    assert.equal(R.revisarRespuesta(otra.texto, { resena, profesionales: EQUIPO, recientes }).ok, true, clase);
  }
});

test('revisar una respuesta antes de publicarla: lo que no puede salir', () => {
  const c = {
    resena: { nota: 5, autor: 'Laura G.', texto: 'La doctora Perea, un encanto. Muy recomendable' },
    tratamientos: ['Toxina botulínica facial', 'Relleno de labios con ácido hialurónico', 'Rosácea'],
    profesionales: EQUIPO,
    telefono: '+34722833285',
  };
  const errores = (texto, extra = {}) => R.revisarRespuesta(texto, { ...c, ...extra }).errores.join(' | ');
  assert.equal(errores('¡Muchas gracias, Laura! Nos alegra mucho que el trato haya estado a la altura. Hasta pronto.'), '');
  assert.match(errores('¡Gracias, Laura! La Dra. Perea estará feliz de leerte.'), /equipo/);
  assert.match(errores('¡Gracias, Laura! Maribel te manda un abrazo.'), /equipo \(«Maribel»\)/);
  assert.match(errores('¡Gracias, Laura! Nos alegra que el relleno de labios haya quedado tan bien.'), /tratamiento .*datos de salud/);
  assert.match(errores('¡Gracias, Laura! Tu rosácea está mucho mejor.'), /tratamiento/);
  assert.match(errores('¡Gracias, Laura! Nos vemos el martes 13 de octubre.'), /fecha/);
  assert.match(errores('¡Gracias, Laura! Te esperamos en tu próxima cita.'), /paciente/);
  assert.match(errores('¡Gracias, Laura! Mira nuestras novedades en www.iemec-clinic.com'), /enlaces/);
  assert.match(errores('¡Gracias, Laura! Tienes un 20 % de descuento en tu próxima visita.'), /promociones/);
  assert.match(errores('Hola, lo sentimos. Llámanos al 600 11 22 33.', { resena: { nota: 1, texto: 'Mal' } }), /teléfono de la clínica/);
  assert.match(errores('Hola, sentimos que no haya ido bien. Escríbenos cuando quieras.', { resena: { nota: 2, texto: 'Regular' } }), /1 o 2 estrellas.*722 83 32 85/);
  assert.equal(errores('Hola, sentimos que no haya ido bien. Llámanos al 722 83 32 85 y lo hablamos en privado.', { resena: { nota: 2, texto: 'Regular' } }), '');
  assert.match(errores('Hola, qué pena lo de la infección: llámanos al 722 83 32 85.', { resena: { nota: 1, texto: 'Se me infectó' } }), /salud/);
  // Confirmar que es paciente, solo si lo dice ella.
  assert.match(errores('¡Gracias, Laura! Nos alegra que tu visita fuera tan bien.'), /paciente/);
  assert.equal(errores('¡Gracias, Laura! Nos alegra que tu visita fuera tan bien.', { resena: { nota: 5, autor: 'Laura', texto: 'Fui a mi primera cita con nervios y salí feliz' } }), '');
  // Se puede saludar a quien se llama como alguien del equipo.
  assert.equal(errores('¡Muchas gracias, Paula! Hasta pronto.', { resena: { nota: 5, autor: 'Paula R.', texto: '' } }), '');
  // Igual que otra reciente (sin contar el nombre): Google la rechaza por repetida.
  assert.match(errores('¡Muchas gracias, Laura! Un saludo de todo el equipo de IEMEC.', { recientes: ['¡Muchas gracias, Carmen! Un saludo de todo el equipo de IEMEC.'] }), /repetidas/);
  assert.match(errores('x'.repeat(4097)), /4\.096 bytes/);
  // Lo que es mejorable pero no impide publicar: el género.
  const neutro = R.revisarRespuesta('¡Gracias, Laura! Nos alegra que te hayas sentido tan bien atendida.', c);
  assert.equal(neutro.ok, true);
  assert.match(neutro.avisos.join(' '), /neutro/);
});

test('revisar una respuesta con el catálogo de verdad: ni el cuerpo, ni el peso, ni lo íntimo, ni «tu próxima revisión»', () => {
  // La reseña no dice que viniera ni a qué.
  const c = { resena: { nota: 5, autor: 'Laura G.', texto: 'Todo genial, muy amables' }, tratamientos: CATALOGO, profesionales: EQUIPO };
  const errores = (texto) => R.revisarRespuesta(`¡Gracias, Laura! ${texto}`, c).errores.join(' | ');
  for (const [texto, motivo] of [
    ['Te esperamos en la próxima revisión.', /paciente/], ['Nos vemos en la siguiente cita.', /paciente/], ['Te esperamos de nuevo muy pronto.', /paciente/],
    ['Gracias por tu confianza.', /paciente/], ['Esperamos que la zona tratada evolucione bien.', /paciente/],
    ['Nos alegra que tu nariz haya quedado como esperabas.', /nariz/], ['¡Enhorabuena por esos kilos de menos!', /kilos/],
    ['Nos alegra que el pecho haya quedado natural.', /pecho/], ['Nos alegra que las cicatrices hayan mejorado.', /cicatrices/],
    ['Nos alegra que la incontinencia haya mejorado.', /incontinencia/], ['Qué bien que te gustara la rinomodelación.', /rinomodelación/],
    ['Nos alegra que los glúteos hayan quedado así.', /glúteos/], ['Los exosomas hacen maravillas.', /exosomas/], ['Tu piel está radiante.', /piel/],
    ['Tu primera consulta gratuita te espera.', /promociones|paciente/],
  ]) {
    assert.match(errores(texto), motivo, texto);
  }
  // Lo corriente sí se puede decir, aunque salga en algún nombre del catálogo, y el nombre de la clínica también.
  for (const texto of ['Para cualquier consulta, aquí nos tienes.', 'Cuidamos mucho la limpieza de cada rincón.', 'Todo el equipo médico te lo agradece.',
    'Te recibimos siempre con los brazos abiertos.', 'Un saludo del Instituto Europeo de Medicina Estética y Capilar.', 'Gracias por tu valoración.']) {
    assert.equal(errores(texto), '', texto);
  }
});

test('todas nuestras respuestas, en todas sus combinaciones, pasan la revisión con el catálogo y el equipo de verdad', () => {
  const clases = [
    [5, 'Muy buen trato'], [5, 'Muy profesionales'], [5, 'Resultados naturales'], [5, 'Instalaciones preciosas'], [5, 'Todo muy cómodo'],
    [5, 'Te contestan enseguida por WhatsApp'], [5, 'Un seguimiento de diez'], [5, ''], [5, 'Genial todo'],
    [4, 'Bien, pero una hora de retraso'], [4, 'Bien, aunque algo caro'], [3, 'No contestan al teléfono'], [3, 'Regular'],
    [1, 'Muy mal'], [2, 'Me hicieron esperar muchísimo, fatal'], [1, 'Me quemaron, voy a denunciar'],
  ];
  for (const [nota, texto] of clases) {
    const resena = { nota, autor: 'Ana', texto };
    const n = R.variedad(resena);
    for (let i = 0; i < n; i++) {
      const b = R.borradorRespuesta(resena, { indice: i });
      const r = R.revisarRespuesta(b.texto, { resena, tratamientos: CATALOGO, profesionales: EQUIPO });
      assert.ok(r.ok, `${nota} ★ «${texto}»: ${b.texto} → ${r.errores.join(' | ')}`);
      assert.deepEqual(r.avisos, [], b.texto);
    }
  }
});

test('lo que llega de Google: con los nombres del adaptador o con los de la API, y la moderación de nuestra respuesta', () => {
  const api = R.normalizarResena({
    reviewId: 'abc123', starRating: 'FOUR', reviewer: { displayName: 'Ana P.', isAnonymous: false }, comment: 'Muy bien',
    createTime: '2026-10-01T10:00:00Z', updateTime: '2026-10-02T10:00:00Z',
    reviewReply: { comment: 'Gracias, Ana', updateTime: '2026-10-02T12:00:00Z', reviewReplyState: 'REJECTED', policyViolation: 'PERSONAL_INFO' },
  });
  assert.deepEqual({ ...api, publicadaEn: api.publicadaEn.toISOString(), actualizadaEn: api.actualizadaEn.toISOString(), respondidaEn: api.respondidaEn.toISOString() }, {
    googleId: 'abc123', nota: 4, autor: 'Ana P.', texto: 'Muy bien', publicadaEn: '2026-10-01T10:00:00.000Z', actualizadaEn: '2026-10-02T10:00:00.000Z',
    respuesta: 'Gracias, Ana', respondidaEn: '2026-10-02T12:00:00.000Z', estadoRespuesta: 'rechazada', motivoRechazo: 'PERSONAL_INFO',
  });
  assert.equal(R.normalizarResena({ reviewId: 'x', starRating: 'FIVE', reviewer: { displayName: 'Nadie', isAnonymous: true }, createTime: '2026-10-01T10:00:00Z' }).autor, null);
  const adaptador = R.normalizarResena({ googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Genial', publicadaEn: '2026-10-06T15:00:00Z' });
  assert.deepEqual([adaptador.googleId, adaptador.nota, adaptador.autor, adaptador.texto, adaptador.estadoRespuesta], ['g1', 5, 'Laura G.', 'Genial', null]);
  assert.equal(R.normalizarResena({ googleId: 'g2', nota: 5, texto: '   ', publicadaEn: '2026-10-06T15:00:00Z', motivoRechazo: { type: 'REPETITIVE' } }).texto, null);
  assert.equal(R.normalizarResena({ googleId: 'g2', nota: 5, publicadaEn: '2026-10-06T15:00:00Z', policyViolation: { type: 'REPETITIVE' } }).motivoRechazo, 'REPETITIVE');
  for (const mala of [null, {}, { googleId: 'g', nota: 7, publicadaEn: '2026-10-06' }, { googleId: 'g', nota: 5 }, { nota: 5, publicadaEn: '2026-10-06' }]) {
    assert.equal(R.normalizarResena(mala), null);
  }
  assert.equal(R.estadoModeracion('PENDING'), 'pendiente');
  assert.equal(R.estadoModeracion('approved'), 'aprobada');
  assert.equal(R.estadoModeracion('otro'), null);
});

test('los KPI de la ficha: respuesta, rechazadas, conversión, ritmo, nota de 90 días, temas del mes y la prueba del momento', () => {
  const ahora = new Date('2026-10-30T12:00:00Z');
  const resenas = [
    { nota: 5, con_texto: 1, temas: '["trato"]', estado: 'publicada', publicada_en: '2026-10-28T10:00:00Z', primera_respuesta_en: '2026-10-28T14:00:00Z', respuesta_estado: 'aprobada', respuestas_rechazadas: 0 },
    // Google rechazó su respuesta: vuelve a la bandeja (no cuenta como contestada) y cuenta como rechazada.
    { nota: 1, con_texto: 1, temas: ['precio'], estado: 'borrador', publicada_en: '2026-10-20T09:00:00Z', primera_respuesta_en: '2026-10-20T11:00:00Z', respuesta_estado: 'rechazada', respuestas_rechazadas: 1 },
    { nota: 4, con_texto: 0, temas: null, estado: 'borrador', publicada_en: '2026-09-15T10:00:00Z', primera_respuesta_en: null },
    { nota: 5, con_texto: 1, temas: null, estado: 'publicada', publicada_en: '2026-05-01T10:00:00Z', primera_respuesta_en: '2026-05-02T10:00:00Z' },
    { nota: 3, con_texto: 1, temas: null, estado: 'historial', publicada_en: '2026-01-10T10:00:00Z', primera_respuesta_en: null },
  ];
  const peticiones = [
    { estado: 'enviada', enviada_en: '2026-10-18T12:00:00Z', pulsada_en: '2026-10-18T13:00:00Z', variante: '2h', recordatorio_enviado_en: null },
    { estado: 'enviada', enviada_en: '2026-10-10T12:00:00Z', pulsada_en: null, variante: 'tres_dias', recordatorio_estado: 'enviado', recordatorio_enviado_en: '2026-10-17T12:00:00Z' },
    { estado: 'enviada', enviada_en: '2026-10-01T10:00:00Z', pulsada_en: '2026-10-08T12:00:00Z', variante: 'dia_siguiente', recordatorio_estado: 'enviado', recordatorio_enviado_en: '2026-10-08T10:00:00Z' },
    { estado: 'enviada', enviada_en: '2026-06-01T10:00:00Z', pulsada_en: '2026-06-01T11:00:00Z', variante: '2h', recordatorio_enviado_en: null },
    // Lo que no salió no cuenta: ni la petición fallida (aunque traiga fecha), ni un recordatorio fallido.
    { estado: 'fallida', enviada_en: '2026-10-20T12:00:00Z', pulsada_en: null, variante: '2h', recordatorio_enviado_en: null },
    { estado: 'enviada', enviada_en: '2026-10-19T12:00:00Z', pulsada_en: '2026-10-27T12:00:00Z', variante: '2h', recordatorio_estado: 'fallido', recordatorio_enviado_en: '2026-10-26T12:00:00Z' },
  ];
  const m = R.metricas({ resenas, peticiones, ahora });
  assert.equal(m.total, 5);
  assert.equal(m.notaTotal, 3.6);
  assert.equal(m.nota90, 3.33);
  assert.deepEqual([m.resenas90, m.resenas14], [3, 2]);
  assert.equal(m.tasaRespuesta, 33);
  assert.equal(m.tasaRespuestaConTexto, 50);
  assert.equal(m.horasRespuesta, 3, 'mediana de 4 h y 2 h');
  assert.equal(m.horasRespuestaNegativas, 2);
  assert.deepEqual([m.respuestas90, m.rechazadas, m.tasaRechazo], [2, 1, 50]);
  // La fallida no cuenta, y el clic de después de un recordatorio que no salió no es del recordatorio.
  assert.deepEqual(m.peticiones, { enviadas: 4, abiertas: 3, tasaApertura: 75, recordatorios: 2, abiertasTrasRecordatorio: 1, resenasNuevas: 2, porCada100: 50 });
  assert.deepEqual(m.variantes.map((v) => [v.variante, v.enviadas, v.abiertas, v.abiertasAntes, v.tasa]), [
    ['2h', 2, 2, 2, 100], ['dia_siguiente', 1, 1, 0, 0], ['tres_dias', 1, 0, 0, 0],
  ]);
  assert.deepEqual(m.temasMes, [{ tema: 'precio', resenas: 1, pct: 50 }, { tema: 'trato', resenas: 1, pct: 50 }]);
  assert.equal(m.porSemana.length, 12);
  assert.deepEqual(m.porSemana.at(-1), { semana: '2026-10-26', resenas: 1 }, 'la semana en curso');
  assert.deepEqual(m.porSemana.filter((s) => s.resenas).map((s) => s.semana), ['2026-09-14', '2026-10-19', '2026-10-26']);
  assert.deepEqual([m.porResponder, m.enHistorial], [2, 1]);
  // Los borradores del historial no cuentan como «por contestar»: van aparte, poco a poco.
  assert.equal(R.metricas({ resenas: [{ nota: 5, estado: 'borrador', historial: 1, publicada_en: '2025-02-01T10:00:00Z' }], ahora }).porResponder, 0);
  // Una reseña que su autor cambió después de contestarla: sigue contestada (la respuesta se ve en
  // Google) y a la vez está por contestar (espera otra).
  const reabierta = R.metricas({ resenas: [{ nota: 1, estado: 'borrador', respondida: 1, publicada_en: '2026-10-25T10:00:00Z' }], ahora });
  assert.deepEqual([reabierta.tasaRespuesta, reabierta.porResponder], [100, 1]);
  // Sin datos, sin cifras inventadas.
  const vacio = R.metricas({ ahora });
  assert.deepEqual([vacio.notaTotal, vacio.tasaRespuesta, vacio.horasRespuesta, vacio.peticiones.porCada100], [null, null, null, null]);
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

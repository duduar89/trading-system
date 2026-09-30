'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./whatsapp');

// Cuerpo de webhook con el formato de la Cloud API (datos inventados).
const cuerpo = ({ mensajes = [], estados = [], contactos = [], campo = 'messages' } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-PRUEBA', changes: [{ field: campo, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '34600000000', phone_number_id: 'NUM-PRUEBA' }, contacts: contactos, messages: mensajes, statuses: estados } }] }],
});
const de = '34611000301';
const msg = (extra) => ({ from: de, id: `wamid.PRUEBA${Math.random().toString(36).slice(2, 8)}`, timestamp: '1759140000', ...extra });

test('texto: va a la repesca con el teléfono en formato internacional y el nombre del perfil', () => {
  const { mensajes, estados } = W.leerWebhook(cuerpo({ contactos: [{ wa_id: de, profile: { name: 'Laura García' } }], mensajes: [msg({ id: 'wamid.T1', type: 'text', text: { body: ' Hola, quiero cita ' } })] }));
  assert.equal(estados.length, 0);
  assert.equal(mensajes.length, 1);
  const m = mensajes[0];
  assert.deepEqual([m.waId, m.telefono, m.perfil, m.tipo, m.texto, m.aIa], ['wamid.T1', '+34611000301', 'Laura García', 'texto', 'Hola, quiero cita', true]);
  assert.equal(m.marca.toISOString(), '2025-09-29T10:00:00.000Z');
  assert.equal(m.referral, null);
});

test('botón de plantilla e interactivo: cuenta lo que pone el botón o la opción de la lista', () => {
  const { mensajes } = W.leerWebhook(cuerpo({ mensajes: [
    msg({ type: 'button', context: { id: 'wamid.PLANTILLA' }, button: { text: 'Sí, búscame hueco', payload: 'si' } }),
    msg({ type: 'button', button: { payload: 'Más adelante' } }),
    msg({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Confirmo' } } }),
    msg({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l2', title: 'Por la tarde', description: 'de 16 a 20' } } }),
    msg({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{}' } } }),
  ] }));
  assert.deepEqual(mensajes.map((m) => [m.tipo, m.texto, m.aIa]), [
    ['boton', 'Sí, búscame hueco', true],
    ['boton', 'Más adelante', true],
    ['interactivo', 'Confirmo', true],
    ['interactivo', 'Por la tarde', true],
    ['interactivo', '[respuesta a un formulario de WhatsApp]', false],
  ]);
  assert.match(mensajes[4].tarea, /formulario/);
});

test('audio, imagen, documento, ubicación, sticker y contacto: se registran y los ve una persona', () => {
  const { mensajes } = W.leerWebhook(cuerpo({ mensajes: [
    msg({ type: 'audio', audio: { id: 'MEDIA1', mime_type: 'audio/ogg; codecs=opus', voice: true } }),
    msg({ type: 'image', image: { id: 'MEDIA2', mime_type: 'image/jpeg', caption: '¿Esto se puede tratar?' } }),
    msg({ type: 'document', document: { id: 'MEDIA3', filename: 'analitica.pdf', mime_type: 'application/pdf' } }),
    msg({ type: 'location', location: { latitude: 40.405, longitude: -3.873, name: 'Casa' } }),
    msg({ type: 'sticker', sticker: { id: 'MEDIA4', mime_type: 'image/webp' } }),
    msg({ type: 'contacts', contacts: [{ name: { formatted_name: 'Ana Ejemplo' }, phones: [{ phone: '+34 600 000 001' }] }] }),
    msg({ type: 'video', video: { id: 'MEDIA5' } }),
  ] }));
  assert.deepEqual(mensajes.map((m) => [m.tipo, m.texto, m.aIa]), [
    ['audio', '[audio]', false],
    ['imagen', '[imagen] ¿Esto se puede tratar?', false],
    ['documento', '[documento: analitica.pdf]', false],
    ['ubicacion', '[ubicación: Casa]', false],
    ['sticker', '[sticker]', false],
    ['contacto', '[contacto: Ana Ejemplo]', false],
    ['video', '[vídeo]', false],
  ]);
  assert.equal(mensajes[1].leyenda, '¿Esto se puede tratar?');
  assert.ok(mensajes.every((m) => m.tarea), 'cada una con su tarea');
  assert.match(mensajes[0].tarea, /audio/);
});

test('lo que no se puede leer no se pierde; lo que no es un mensaje suyo, sí se salta', () => {
  const { mensajes } = W.leerWebhook(cuerpo({ mensajes: [
    msg({ type: 'unsupported', errors: [{ code: 131051, title: 'Message type unknown' }] }),
    msg({ type: 'system', system: { body: 'User changed number', wa_id: '34622000301', type: 'user_changed_number' } }),
    msg({ type: 'reaction', reaction: { message_id: 'wamid.NUESTRO', emoji: '👍' } }),
    msg({ type: 'reaction', reaction: { message_id: 'wamid.NUESTRO', emoji: '' } }),
    msg({ type: 'request_welcome' }),
  ] }));
  assert.deepEqual(mensajes.map((m) => m.tipo), ['otro', 'sistema', 'reaccion']);
  assert.match(mensajes[0].tarea, /WhatsApp/);
  assert.equal(mensajes[1].texto, '[ha cambiado de número de WhatsApp: +34622000301]');
  assert.deepEqual(mensajes[2].reaccion, { a: 'wamid.NUESTRO', emoji: '👍' });
  assert.equal(mensajes[2].tarea, null, 'una reacción no es trabajo para nadie');
});

test('referral: el anuncio que abrió WhatsApp', () => {
  const { mensajes } = W.leerWebhook(cuerpo({ mensajes: [msg({
    type: 'text', text: { body: 'Hola, quiero más información' },
    referral: { source_url: 'https://fb.me/ejemplo', source_id: '120200000000001', source_type: 'ad', headline: 'Mesoterapia capilar', body: 'Texto del anuncio', media_type: 'image', ctwa_clid: 'ARAkPRUEBAclid' },
  })] }));
  assert.deepEqual(mensajes[0].referral, {
    fuenteId: '120200000000001', fuenteTipo: 'ad', fuenteUrl: 'https://fb.me/ejemplo', titular: 'Mesoterapia capilar', cuerpo: 'Texto del anuncio', ctwaClid: 'ARAkPRUEBAclid', medio: 'image',
  });
});

test('estados: enviado, entregado, leído y fallido con el motivo dicho para recepción', () => {
  const { estados, mensajes } = W.leerWebhook(cuerpo({ estados: [
    { id: 'wamid.S1', status: 'sent', timestamp: '1759140000', recipient_id: de },
    { id: 'wamid.S1', status: 'delivered', timestamp: '1759140001', recipient_id: de },
    { id: 'wamid.S1', status: 'read', timestamp: '1759140002', recipient_id: de },
    { id: 'wamid.S2', status: 'failed', timestamp: '1759140003', recipient_id: de, errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }] },
    { id: 'wamid.S3', status: 'failed', recipient_id: de, errors: [{ code: 999999, title: 'Algo raro', error_data: { details: 'con detalle' } }] },
    { id: 'wamid.S4', status: 'deleted', recipient_id: de },
  ] }));
  assert.equal(mensajes.length, 0);
  assert.deepEqual(estados.map((e) => [e.waId, e.estado]), [['wamid.S1', 'enviado'], ['wamid.S1', 'entregado'], ['wamid.S1', 'leido'], ['wamid.S2', 'fallido'], ['wamid.S3', 'fallido']]);
  assert.equal(estados[0].error, null);
  assert.equal(estados[3].error.codigo, '131049');
  assert.match(estados[3].error.texto, /límite de mensajes de marketing/);
  assert.deepEqual(estados[4].error, { codigo: '999999', texto: 'Algo raro: con detalle' });
});

test('varios cambios en un aviso; los que no son de mensajes se apuntan pero no se procesan', () => {
  const c = cuerpo({ mensajes: [msg({ type: 'text', text: { body: 'uno' } })] });
  c.entry.push({ id: 'WABA-PRUEBA', changes: [
    { field: 'messages', value: { messages: [msg({ from: '34611000302', type: 'text', text: { body: 'dos' } })] } },
    { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'iemec_lead_bienvenida' } },
  ] });
  const r = W.leerWebhook(c);
  assert.deepEqual(r.mensajes.map((m) => [m.telefono, m.texto]), [['+34611000301', 'uno'], ['+34611000302', 'dos']]);
  assert.deepEqual(r.campos, ['messages', 'message_template_status_update']);
  assert.deepEqual(W.leerWebhook({}).mensajes, []);
  assert.deepEqual(W.leerWebhook(null).estados, []);
});

test('identificador del aviso: el wamid, «wamid:estado» o la huella del cuerpo', () => {
  const uno = W.leerWebhook(cuerpo({ mensajes: [msg({ id: 'wamid.ID1', type: 'text', text: { body: 'hola' } })] }));
  assert.equal(W.idExterno(uno, Buffer.from('x')), 'wamid.ID1');
  const est = W.leerWebhook(cuerpo({ estados: [{ id: 'wamid.ID2', status: 'read' }] }));
  assert.equal(W.idExterno(est, Buffer.from('x')), 'wamid.ID2:leido');
  const nada = W.leerWebhook(cuerpo({ campo: 'account_update' }));
  assert.match(W.idExterno(nada, Buffer.from('{"a":1}')), /^sha256:[0-9a-f]{64}$/);
  assert.equal(W.idExterno(nada, Buffer.from('{"a":1}')), W.idExterno(nada, Buffer.from('{"a":1}')));
});

test('respuesta al momento: al audio y a la foto sí (presentándose la primera vez); al sticker no', () => {
  assert.equal(W.respuestaAutomatica('audio', { nombre: 'Laura', primerMensajeIa: true }),
    'Soy el asistente virtual de IEMEC. Gracias, Laura. Ahora mismo no puedo escuchar audios, así que se lo paso a una persona del equipo, que te contesta por aquí lo antes posible.');
  assert.match(W.respuestaAutomatica('imagen', {}), /^Gracias\. Se lo paso a una persona del equipo/);
  assert.equal(W.respuestaAutomatica('sticker', {}), null);
  assert.equal(W.respuestaAutomatica('ubicacion', {}), null);
});

test('teléfono de WhatsApp: el número internacional con «+»', () => {
  assert.equal(W.telefonoDe('34611000301'), '+34611000301');
  assert.equal(W.telefonoDe('447700900123'), '+447700900123');
  assert.equal(W.telefonoDe('usuario.prueba'), null);
  assert.equal(W.telefonoDe(undefined), null);
});

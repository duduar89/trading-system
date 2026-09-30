'use strict';
// Lo que llega por el webhook de WhatsApp (formato de la Cloud API de Meta, el mismo que usa
// 360dialog), puesto en limpio para el servidor. Sin base de datos ni red: solo lee el cuerpo.
//
//   mensajes  { waId, telefono, perfil, tipo, texto, aIa, leyenda, referral, reaccion, tarea, marca }
//             · texto, botón de plantilla e interactivo (botón o lista) → su texto va a la repesca
//               (aIa = true)
//             · audio, imagen, vídeo, documento, ubicación, sticker, contacto… → se registran como
//               «[audio]», «[imagen] leyenda»… y los atiende una persona (tarea = su título)
//             · reacción → se registra, sin más
//   estados   { waId, estado, telefono, marca, error: { codigo, texto } | null }
//             sent → enviado, delivered → entregado, read → leido, failed → fallido
const crypto = require('crypto');

const ESTADOS = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };

// Lo que no es texto: cómo se guarda (tipo de mensajes), cómo se lee en la bandeja y la tarea.
const CONTENIDOS = {
  audio: { tipo: 'audio', etiqueta: 'audio', tarea: 'Ha mandado un audio: escucharlo y contestar' },
  image: { tipo: 'imagen', etiqueta: 'imagen', tarea: 'Ha mandado una imagen: revisarla y contestar' },
  video: { tipo: 'video', etiqueta: 'vídeo', tarea: 'Ha mandado un vídeo: revisarlo y contestar' },
  document: { tipo: 'documento', etiqueta: 'documento', tarea: 'Ha mandado un documento: revisarlo y contestar' },
  sticker: { tipo: 'sticker', etiqueta: 'sticker', tarea: 'Ha mandado un sticker: revisar la conversación' },
  location: { tipo: 'ubicacion', etiqueta: 'ubicación', tarea: 'Ha mandado una ubicación: revisar y contestar' },
  contacts: { tipo: 'contacto', etiqueta: 'contacto', tarea: 'Ha mandado un contacto: revisar y contestar' },
};

// Errores de entrega más habituales, dichos para recepción. Los demás, con el texto de Meta.
const ERRORES = {
  131049: 'Meta no lo entregó para no saturar al paciente (límite de mensajes de marketing)',
  131050: 'El paciente ha dejado de recibir mensajes de marketing de la clínica en WhatsApp',
  131047: 'Pasaron más de 24 horas desde su último mensaje: hace falta una plantilla aprobada',
  131026: 'No se puede entregar: el número no tiene WhatsApp o no acepta mensajes de empresas',
  131048: 'Límite de Meta por mensajes bloqueados o denunciados como spam',
  131056: 'Demasiados mensajes seguidos al mismo número',
  130472: 'El número está en un experimento de Meta y no recibe mensajes de marketing',
  131051: 'Tipo de mensaje no admitido por WhatsApp',
  131000: 'Error de Meta al enviar',
  131031: 'La cuenta de WhatsApp de la clínica está bloqueada',
  131042: 'Problema con el método de pago de la cuenta de WhatsApp',
  132001: 'La plantilla no existe o no está aprobada en ese idioma',
  132015: 'La plantilla está pausada por baja calidad',
  132016: 'La plantilla está desactivada',
};

const texto = (v) => (v == null ? null : String(v).trim() || null);

function describirError(err) {
  if (!err) return null;
  const codigo = err.code == null ? null : String(err.code);
  const deMeta = [err.title || err.message, err.error_data?.details].filter(Boolean).join(': ');
  return { codigo: codigo ? codigo.slice(0, 20) : null, texto: (ERRORES[codigo] || deMeta || 'Error sin descripción').slice(0, 255) };
}

// «34611000101» → «+34611000101». WhatsApp manda el número internacional sin el «+».
function telefonoDe(waId) {
  const t = String(waId ?? '').replace(/^\+/, '');
  return /^\d{8,15}$/.test(t) ? `+${t}` : null;
}

function leerReferral(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    fuenteId: texto(r.source_id), fuenteTipo: texto(r.source_type), fuenteUrl: texto(r.source_url),
    titular: texto(r.headline), cuerpo: texto(r.body), ctwaClid: texto(r.ctwa_clid), medio: texto(r.media_type),
  };
}

// Un mensaje del paciente → { tipo, texto, aIa, leyenda, tarea, reaccion } (o null si no es suyo).
function contenido(m) {
  switch (m.type) {
    case 'text': {
      const t = texto(m.text?.body);
      return t ? { tipo: 'texto', texto: t, aIa: true } : { tipo: 'otro', texto: '[mensaje vacío]', tarea: 'Ha mandado un mensaje vacío: revisar la conversación' };
    }
    case 'button': {
      // Respuesta rápida de una plantilla («Sí, búscame hueco»): lo que pone el botón.
      const t = texto(m.button?.text) || texto(m.button?.payload);
      return t ? { tipo: 'boton', texto: t, aIa: true } : { tipo: 'boton', texto: '[botón]', tarea: 'Ha pulsado un botón sin texto: revisar la conversación' };
    }
    case 'interactive': {
      const i = m.interactive || {};
      const t = texto(i.button_reply?.title) || texto(i.list_reply?.title);
      if (t && ['button_reply', 'list_reply'].includes(i.type)) return { tipo: 'interactivo', texto: t, aIa: true };
      return { tipo: 'interactivo', texto: '[respuesta a un formulario de WhatsApp]', tarea: 'Ha respondido a un formulario de WhatsApp: revisarlo' };
    }
    case 'reaction': {
      const emoji = texto(m.reaction?.emoji);
      if (!emoji) return null; // ha quitado una reacción: nada que ver
      return { tipo: 'reaccion', texto: `[reacción ${emoji}]`, reaccion: { a: texto(m.reaction?.message_id), emoji } };
    }
    case 'request_welcome':
      return null; // abre el chat por primera vez: aún no ha escrito nada
    case 'system': {
      const nuevo = m.system?.type === 'user_changed_number' ? telefonoDe(m.system.wa_id || m.system.new_wa_id) : null;
      return {
        tipo: 'sistema',
        texto: nuevo ? `[ha cambiado de número de WhatsApp: ${nuevo}]` : '[aviso de WhatsApp]',
        tarea: nuevo ? 'Ha cambiado de número de WhatsApp: revisar la ficha' : 'Aviso de WhatsApp sobre este contacto: revisarlo',
      };
    }
    default: {
      const c = CONTENIDOS[m.type];
      if (!c) {
        return { tipo: 'otro', texto: '[mensaje que no se puede leer aquí]', tarea: 'Ha mandado algo que la app no puede leer: mirarlo en WhatsApp y contestar' };
      }
      const d = m[m.type] || {};
      const leyenda = texto(d.caption);
      let detalle = null;
      if (m.type === 'document') detalle = texto(d.filename);
      if (m.type === 'location') detalle = [texto(d.name), texto(d.address)].filter(Boolean).join(', ') || (d.latitude != null ? `${d.latitude}, ${d.longitude}` : null);
      if (m.type === 'contacts') detalle = (m.contacts || []).map((x) => texto(x?.name?.formatted_name)).filter(Boolean).join(', ') || null;
      const marca = `[${c.etiqueta}${detalle ? `: ${detalle}` : ''}]`;
      return { tipo: c.tipo, texto: leyenda ? `${marca} ${leyenda}` : marca, leyenda, tarea: c.tarea };
    }
  }
}

/**
 * Lee el cuerpo del webhook (ya en JSON).
 * @returns {{ mensajes: object[], estados: object[], campos: string[] }}
 */
function leerWebhook(cuerpo) {
  const mensajes = [];
  const estados = [];
  const campos = new Set();
  for (const entrada of Array.isArray(cuerpo?.entry) ? cuerpo.entry : []) {
    for (const cambio of Array.isArray(entrada?.changes) ? entrada.changes : []) {
      if (cambio?.field) campos.add(String(cambio.field));
      if (cambio?.field !== 'messages') continue;
      const v = cambio.value || {};
      const perfiles = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((c) => [String(c?.wa_id), texto(c?.profile?.name)]));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const c = contenido(m || {});
        if (!c) continue;
        mensajes.push({
          waId: texto(m.id), telefono: telefonoDe(m.from), perfil: perfiles.get(String(m.from)) || null,
          tipo: c.tipo, texto: c.texto, aIa: Boolean(c.aIa), leyenda: c.leyenda || null, tarea: c.tarea || null,
          reaccion: c.reaccion || null, referral: leerReferral(m.referral), marca: m.timestamp ? new Date(Number(m.timestamp) * 1000) : null,
        });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const estado = ESTADOS[s?.status];
        if (!estado || !texto(s.id)) continue;
        estados.push({
          waId: texto(s.id), estado, telefono: telefonoDe(s.recipient_id), marca: s.timestamp ? new Date(Number(s.timestamp) * 1000) : null,
          error: estado === 'fallido' ? describirError((s.errors || [])[0] || {}) : null,
        });
      }
    }
  }
  return { mensajes, estados, campos: [...campos] };
}

// Identificador del webhook para no guardarlo dos veces si Meta lo repite: el wamid si trae un solo
// mensaje, «wamid:estado» si trae un solo estado; si no, la huella del cuerpo tal cual llegó.
function idExterno(datos, crudo) {
  let id = null;
  if (datos.mensajes.length === 1 && !datos.estados.length) id = datos.mensajes[0].waId;
  else if (datos.estados.length === 1 && !datos.mensajes.length) id = `${datos.estados[0].waId}:${datos.estados[0].estado}`;
  if (id && id.length <= 160) return id;
  return `sha256:${crypto.createHash('sha256').update(crudo).digest('hex')}`;
}

// Lo que se le contesta al momento cuando manda algo que la IA no puede ver ni escuchar. Si ya lo
// lleva una persona, o es un sticker, una ubicación…, no se le dice nada: lo ve el equipo.
function respuestaAutomatica(tipo, { nombre = null, primerMensajeIa = false } = {}) {
  const hola = primerMensajeIa ? 'Soy el asistente virtual de IEMEC. ' : '';
  const n = nombre ? `, ${nombre}` : '';
  if (tipo === 'audio') return `${hola}Gracias${n}. Ahora mismo no puedo escuchar audios, así que se lo paso a una persona del equipo, que te contesta por aquí lo antes posible.`;
  if (['imagen', 'video', 'documento'].includes(tipo)) return `${hola}Gracias${n}. Se lo paso a una persona del equipo, que lo revisa y te contesta por aquí lo antes posible.`;
  return null;
}

module.exports = { leerWebhook, idExterno, describirError, telefonoDe, respuestaAutomatica, ERRORES };

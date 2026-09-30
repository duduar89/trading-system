'use strict';
// Escribir a mano desde la bandeja del panel (servidor/rutas/panel.js) con la ventana de 24 h cerrada:
// qué plantillas puede mandar recepción y qué se mira antes de que salga una. Lo mismo que miran los
// envíos automáticos (servidor/repesca/motor.js): para lo comercial, la baja y el consentimiento; y lo
// que se escribe en las variables pasa el filtro de publicidad sanitaria, como la plantilla al aprobarla.
const { variablesDe } = require('../motor/repesca/plantillas');
const { revisar } = require('../motor/repesca/filtro-legal');
const { limpiarNombre, nombrePila } = require('../motor/entrada/leads');
const { tieneBaja } = require('./bajas');
const repesca = require('./repesca/motor');

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Las que solo manda la app. Las que llevan en un botón el enlace de una cita o de una reseña (ese
// valor lo pone la app al mandarla) y las que dan pie a algo que solo crea la app: el «Sí, guárdamelo»
// de un hueco liberado se liga a la oferta de la lista de espera (servidor/avisos-espera.js); mandada
// a mano no hay oferta detrás, el «sí» no reserva nada y la conversación se queda esperando.
const SOLO_LA_APP = new Set(['hueco_liberado']);
const laMandaLaApp = (pl) => SOLO_LA_APP.has(pl.uso) || (json(pl.botones) || []).some((b) => b.tipo === 'url' && /\{\{\d+\}\}/.test(b.url || ''));

// Con qué nombre se le saluda («Hola {{1}}»), como en los mensajes automáticos: el de su ficha, el de
// pila del lead o el de su perfil de WhatsApp.
async function saludo(q, c) {
  const [[paciente]] = c.paciente_id ? await q.query('SELECT nombre FROM pacientes WHERE id = ?', [c.paciente_id]) : [[null]];
  const [[lead]] = c.lead_id ? await q.query('SELECT nombre FROM leads WHERE id = ?', [c.lead_id]) : [[null]];
  return (paciente?.nombre && paciente.nombre !== 'Paciente' && limpiarNombre(paciente.nombre) ? paciente.nombre : null)
    || nombrePila(lead?.nombre) || nombrePila(c.nombre_whatsapp) || null;
}

// ¿Se le puede mandar una plantilla comercial? Lo que miran las secuencias (permisoComercial) y, además,
// la lista de bajas por el teléfono de la conversación. La baja y la falta de consentimiento no se las
// salta nadie (LSSI art. 21 y 22, RGPD art. 21); los topes de mensajes comerciales y el silencio que
// pidió el paciente quedan en aviso: lo decide la persona. → { puede, baja, motivo, aviso }
async function permisoComercial(q, c, ahora) {
  if (await tieneBaja(q, c.telefono)) return { puede: false, baja: true, motivo: 'pidió la baja de los mensajes comerciales', aviso: null };
  const p = await repesca.permisoComercial(q, { paciente_id: c.paciente_id, lead_id: c.lead_id }, ahora);
  if (p.ok) return { puede: true, baja: false, motivo: null, aviso: null };
  if (/baja/.test(p.motivo)) return { puede: false, baja: true, motivo: 'pidió la baja de los mensajes comerciales', aviso: null };
  if (/consentimiento/.test(p.motivo)) return { puede: false, baja: false, motivo: p.motivo, aviso: null };
  return { puede: true, baja: false, motivo: null, aviso: p.motivo };
}

/**
 * Lo que se mira antes de mandar a mano una plantilla aprobada a la conversación `c`.
 * @returns {Promise<{ variables: string[] } | { status: number, codigo: string, error: string, errores?: string[] }>}
 *   las variables tal y como salen, o por qué no sale
 */
async function comprobarEnvio(q, c, pl, valores, ahora) {
  if (laMandaLaApp(pl)) {
    return { status: 400, codigo: 'PLANTILLA_AUTOMATICA', error: 'Esa plantilla la manda la app sola (lleva el enlace de una cita o de una reseña, o la respuesta se liga a una oferta de la lista de espera)' };
  }
  const comercial = pl.categoria === 'marketing';
  if (comercial) {
    const permiso = await permisoComercial(q, c, ahora);
    if (!permiso.puede) return { status: 409, codigo: 'SIN_PERMISO_COMERCIAL', error: `No se le puede mandar una plantilla comercial: ${permiso.motivo}` };
  }
  // Sin saltos de línea ni espacios de más: Meta no los admite en una variable. Y ninguna vacía: Meta
  // rechaza la plantilla y al paciente le llegaría «{{2}}».
  const variables = (Array.isArray(valores) ? valores : []).map((v) => String(v ?? '').replace(/\s+/g, ' ').trim());
  const faltan = [...new Set(variablesDe(pl.cuerpo))].filter((n) => !variables[n - 1]);
  if (faltan.length) return { status: 400, codigo: 'FALTAN_VARIABLES', error: `Falta rellenar ${faltan.map((n) => `{{${n}}}`).join(', ')} de la plantilla` };
  // El filtro de publicidad sanitaria, a lo que escribe recepción. El nombre con que se le saluda, si es
  // el de su ficha, no se mira (a una Milagros no se le bloquea nada); cualquier otra cosa en {{1}}, sí.
  const nombre = await saludo(q, c);
  const escrito = variables.filter((v, i) => !(i === 0 && v === nombre)).join(' ');
  const legal = revisar(escrito, { tipo: comercial ? 'marketing' : 'utilidad', tieneBaja: true });
  if (!legal.ok) {
    return { status: 400, codigo: 'FILTRO_LEGAL', error: `No pasa el filtro de publicidad sanitaria: ${legal.errores.join(' ')}`, errores: legal.errores };
  }
  return { variables };
}

module.exports = { SOLO_LA_APP, laMandaLaApp, saludo, permisoComercial, comprobarEnvio };

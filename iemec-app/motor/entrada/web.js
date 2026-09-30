'use strict';
// El formulario «Te llamamos» de la web pública (POST /web/contacto), puesto en limpio y validado.
// Sin base de datos ni red: lo usa servidor/rutas/web.js. Los mensajes de error son los de la web
// (web/js/web.js), para que se vean igual con JavaScript y sin él.
const crypto = require('crypto');
const E = require('./leads');
const { normalizar } = require('../repesca/interpretar');

const PREFERENCIAS = { whatsapp: 'WhatsApp', llamada: 'Llamada', correo: 'Correo electrónico' };
const MENSAJES = {
  nombre: 'Escribe tu nombre.',
  telefono: 'Revisa el teléfono: 9 cifras, o con prefijo si es de fuera de España.',
  email: 'Revisa el correo electrónico (falta la @ o el dominio).',
  emailRequerido: 'Has elegido que te contestemos por correo: escribe tu correo electrónico.',
  tratamiento: 'Elige qué te interesa (o «Otra cosa»).',
  preferencia: 'Elige cómo prefieres que te contactemos.',
  mensaje: 'El mensaje es demasiado largo: como máximo, 500 caracteres.',
  privacidad: 'Para contestarte necesitamos tu consentimiento en la primera casilla.',
};
const LARGO = { nombre: 80, telefono: 20, email: 120, mensaje: 500 };
// Un envío más rápido que esto (desde que se abrió la página) es de un robot. Solo frena a los
// robots torpes: t lo pone el navegador (vacío = sin JavaScript), igual que la trampa.
const MINIMO_MS = 2500;
// Las referencias de la web: «web-lipolaser», «web-intima-f-6mlx46»… (servidor/referencias-web.js).
const RE_REF = /^web-[a-z0-9-]{1,36}$/;

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// La campaña, como la escribe la web en sus enlaces: una palabra corta en minúsculas («otono-lipo»,
// «facebook», «cpc»). Lo demás no se guarda: es texto libre que manda cualquiera y acabaría en el lead
// (y antes, en el título de las tareas de recepción).
const slugUtm = (v) => {
  const s = texto(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  return /^[a-z0-9_-]{1,60}$/.test(s) ? s : null;
};
const utmDe = (c) => {
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = slugUtm(c[k]);
    if (v) utm[k] = v;
  }
  return Object.keys(utm).length ? utm : null;
};

// La huella de un envío, con la clave del servidor (HMAC): sin ella no se puede comprobar si un
// mensaje adivinado es el que se guardó cifrado. Con JavaScript, la web pone un identificador al azar
// en cada formulario («envio»): un reintento del mismo envío tiene la misma huella. Sin JavaScript,
// lo enviado y el minuto (un doble clic no duplica).
function huellaEnvio(clave, partes) {
  return crypto.createHmac('sha256', clave).update(partes.join('|')).digest('hex');
}

/**
 * @param {object} cuerpo lo que manda el formulario (application/x-www-form-urlencoded)
 * @param {object} o { referencias: { 'web-…': { catalogo, pagina, especialidad } }, grupos: { valor: texto },
 *                     ahora: Date, clave: secreto del servidor para la huella,
 *                     versiones: { 'fecha.huella': {…} } las versiones de los textos que ha publicado la web }
 *                     (semillas/iemec/referencias-web.json y textos-formulario.json, que genera web/construir.js)
 * @returns {{ ok, errores, robot, datos, solicitud }}
 *   robot: la trampa viene rellena o se envió en menos de MINIMO_MS (con JavaScript): «recibido» sin
 *   guardar nada. t vacío = sin JavaScript: no se descarta.
 */
function leerFormularioWeb(cuerpo, { referencias = {}, grupos = {}, ahora = new Date(), clave = 'sin-clave-de-servidor', versiones = {} } = {}) {
  const c = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  const t = texto(c.t);
  const ms = /^\d{1,12}$/.test(t) ? Number(t) : null;
  const robot = Boolean(texto(c.web)) || (ms !== null && ms < MINIMO_MS);

  const errores = {};
  const nombre = texto(c.nombre);
  if (!nombre || nombre.length > LARGO.nombre || !E.limpiarNombre(nombre)) errores.nombre = MENSAJES.nombre;
  const telefonoTal = texto(c.telefono);
  const telefono = telefonoTal.length <= LARGO.telefono ? E.normalizarTelefono(telefonoTal) : null;
  if (!telefono) errores.telefono = MENSAJES.telefono;
  const preferencia = texto(c.preferencia);
  if (!PREFERENCIAS[preferencia]) errores.preferencia = MENSAJES.preferencia;
  const emailTal = texto(c.email);
  const email = emailTal && emailTal.length <= LARGO.email ? E.normalizarEmail(emailTal) : null;
  if (emailTal && !email) errores.email = MENSAJES.email;
  else if (!emailTal && preferencia === 'correo') errores.email = MENSAJES.emailRequerido;
  const mensaje = typeof c.mensaje === 'string' ? c.mensaje.trim() : '';
  if (mensaje.length > LARGO.mensaje) errores.mensaje = MENSAJES.mensaje;
  if (c.privacidad !== 'si') errores.privacidad = MENSAJES.privacidad;

  // ¿Qué le interesa? El valor es un grupo («medicina-capilar», «otra»…) o la referencia de la
  // página del tratamiento («web-lipolaser»); nunca un id del catálogo. En lo íntimo y el peso el
  // grupo va preseleccionado y el tratamiento sale de la referencia de la página («ref»). Una
  // referencia bien formada que la app aún no conoce (una página publicada antes de desplegar la app
  // con su referencias-web.json) vale igual: interés sin tratamiento, como su WhatsApp.
  const valor = texto(c.tratamiento);
  const ref = RE_REF.test(texto(c.ref)) ? texto(c.ref) : null;
  const deRef = (r) => (r && Object.prototype.hasOwnProperty.call(referencias, r) ? referencias[r] : null);
  let catalogo = null;
  let interes = null;
  if (RE_REF.test(valor)) {
    catalogo = deRef(valor)?.catalogo || null;
  } else if (Object.prototype.hasOwnProperty.call(grupos, valor)) {
    interes = grupos[valor];
    const pagina = deRef(ref);
    if (pagina && pagina.especialidad === valor) catalogo = pagina.catalogo || null;
    if (valor === 'tarjeta-regalo') catalogo = deRef('web-tarjeta-regalo')?.catalogo || null;
  } else {
    errores.tratamiento = MENSAJES.tratamiento;
  }

  const pagina = /^\/[\w\-./]{0,199}$/.test(texto(c.pagina)) ? texto(c.pagina) : '/';
  // La versión de los textos que vio: la que dice su formulario, si es una de las que ha publicado la
  // web; si no (inventada, o de una web publicada antes que la app), se guarda marcada y su casilla
  // comercial no cuenta.
  const versionDada = /^[\w.-]{1,20}$/.test(texto(c.version_textos)) ? texto(c.version_textos) : null;
  const versionConocida = Boolean(versionDada && Object.prototype.hasOwnProperty.call(versiones, versionDada));
  const comercial = c.comercial === 'si';
  const utm = utmDe(c);
  const envio = /^[A-Za-z0-9-]{8,64}$/.test(texto(c.envio)) ? texto(c.envio) : null;
  const minuto = new Date(ahora).toISOString().slice(0, 16);
  const huella = huellaEnvio(clave, envio ? ['envio', envio, telefono || telefonoTal] : ['campos', telefono || telefonoTal, pagina, valor, mensaje, minuto]);

  const respuestas = [];
  if (interes) respuestas.push({ pregunta: 'Le interesa', valor: interes });
  if (PREFERENCIAS[preferencia]) respuestas.push({ pregunta: 'Prefiere que le contestemos por', valor: PREFERENCIAS[preferencia] });
  if (mensaje) respuestas.push({ pregunta: 'Mensaje', valor: mensaje });

  return {
    ok: !Object.keys(errores).length,
    errores,
    robot,
    datos: {
      origen: 'web', sinVerificar: true, telefono: telefonoTal, nombre, email: emailTal || null, codigoWeb: ref, campana: utm?.utm_campaign || null, utm,
      idExterno: `web:${huella.slice(0, 40)}`, respuestas,
      tratamiento: { id: catalogo, claves: [ref, utm?.utm_campaign], textos: [] },
    },
    solicitud: {
      pagina, ref, preferencia: PREFERENCIAS[preferencia] ? preferencia : null, interes, catalogo,
      datos: true, comercial, version: versionDada || 'desconocida', versionConocida, huella, telefono,
      // Lo que escribió, para la prueba cifrada (solicitudes_web.datos_cifrados).
      nombre, email: email || null, mensaje: mensaje || null,
    },
  };
}

// Los botones de WhatsApp de la web escriben el primer mensaje con su referencia al final:
// «Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)», y con campaña,
// «(ref. web-lipolaser · c-1x2y3z)» (la huella de la campaña, nunca su nombre: web/js/web.js).
const RE_REF_WHATSAPP = /\(ref\. (web-[a-z0-9-]{1,36})(?: · (c-[0-9a-z]{1,8}))?\)/;
function referenciaDeWhatsapp(texto_) {
  const m = typeof texto_ === 'string' ? texto_.match(RE_REF_WHATSAPP) : null;
  return m ? { ref: m[1], campana: m[2] || null } : null;
}

// La huella de una campaña, la misma que calcula web/js/web.js con el utm_campaign de la visita (en
// minúsculas): «c-» y FNV-1a de 32 bits en base 36. El WhatsApp de la web solo lleva esto, nunca el
// nombre (una campaña puede nombrar un tratamiento íntimo); la app la reconoce entre las que conoce.
function huellaCampana(nombre) {
  const s = String(nombre ?? '').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `c-${h.toString(36)}`;
}

// El texto sin la referencia, para entenderlo (las reglas, la IA, su historial): «(ref. …)» la
// escribió la web, no el paciente, y lleva un código que nadie tiene por qué leer.
const RE_REF_SUELTA = /\s*\(ref\. [^)]{1,60}\)/gi;
const sinReferencia = (t) => String(t ?? '').replace(RE_REF_SUELTA, '').trim();

// Lo que contesta al WhatsApp de confirmación de una solicitud de la web («Hemos recibido una
// solicitud con este número. ¿Has sido tú?»): 'si' (el botón «Sí, fui yo», «sí», «soy yo»…), 'no'
// («No fui yo», «yo no he pedido nada», «número equivocado»…) o null (no contesta a eso).
const NO_FUE = /^(no|nop|nope|para nada)\b|\b(no|nunca) (lo )?(he|hemos|habia|habiamos) (pedido|solicitado|rellenado|enviado)\b|\byo no (he|fui|era|soy)\b|\bno (fui|he sido|era|soy) yo\b|\bnumero equivocado\b|\bequivocad[oa]s?\b|\bno se (de )?(que|quien)\b/;
const SI_FUE = /^(si|sii+|claro|correcto|exacto|efectivamente|eso es|asi es|en efecto)\b|\b(fui|he sido|soy|era) yo\b/;
function respuestaConfirmacion(texto_) {
  const t = normalizar(texto_).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (NO_FUE.test(t)) return 'no';
  if (SI_FUE.test(t)) return 'si';
  return null;
}

module.exports = {
  leerFormularioWeb, referenciaDeWhatsapp, sinReferencia, respuestaConfirmacion, huellaEnvio, huellaCampana, slugUtm, MENSAJES, PREFERENCIAS, MINIMO_MS, RE_REF,
};

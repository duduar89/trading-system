'use strict';
// El formulario «Te llamamos» de la web pública (POST /web/contacto), puesto en limpio y validado.
// Sin base de datos ni red: lo usa servidor/rutas/web.js. Los mensajes de error son los de la web
// (web/js/web.js), para que se vean igual con JavaScript y sin él.
const crypto = require('crypto');
const E = require('./leads');

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
// Un envío más rápido que esto (desde que se abrió la página) es de un robot.
const MINIMO_MS = 2500;

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const utmDe = (c) => {
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = texto(c[k]).slice(0, 160);
    if (v) utm[k] = v;
  }
  return Object.keys(utm).length ? utm : null;
};

/**
 * @param {object} cuerpo lo que manda el formulario (application/x-www-form-urlencoded)
 * @param {object} o { referencias: { 'web-…': { catalogo, pagina, especialidad } }, grupos: { valor: texto },
 *                     ahora: Date }  (semillas/iemec/referencias-web.json, que genera web/construir.js)
 * @returns {{ ok, errores, robot, datos, solicitud }}
 *   robot: la trampa viene rellena o se envió en menos de MINIMO_MS (con JavaScript): «recibido» sin
 *   guardar nada. t vacío = sin JavaScript: no se descarta.
 */
function leerFormularioWeb(cuerpo, { referencias = {}, grupos = {}, ahora = new Date() } = {}) {
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
  // grupo va preseleccionado y el tratamiento sale de la referencia de la página («ref»).
  const valor = texto(c.tratamiento);
  const ref = /^web-[a-z0-9-]{1,36}$/.test(texto(c.ref)) ? texto(c.ref) : null;
  const deRef = (r) => (r && Object.prototype.hasOwnProperty.call(referencias, r) ? referencias[r] : null);
  let catalogo = null;
  let interes = null;
  if (deRef(valor) && valor.startsWith('web-')) {
    catalogo = deRef(valor).catalogo || null;
  } else if (Object.prototype.hasOwnProperty.call(grupos, valor)) {
    interes = grupos[valor];
    const pagina = deRef(ref);
    if (pagina && pagina.especialidad === valor) catalogo = pagina.catalogo || null;
    if (valor === 'tarjeta-regalo') catalogo = deRef('web-tarjeta-regalo')?.catalogo || null;
  } else {
    errores.tratamiento = MENSAJES.tratamiento;
  }

  const pagina = /^\/[\w\-./]{0,199}$/.test(texto(c.pagina)) ? texto(c.pagina) : '/';
  const version = /^[\w.-]{1,20}$/.test(texto(c.version_textos)) ? texto(c.version_textos) : 'desconocida';
  const comercial = c.comercial === 'si';
  const utm = utmDe(c);
  // Un mismo envío repetido (la red falla y se reintenta, o doble clic sin JavaScript) no se duplica:
  // la huella junta lo enviado, el tiempo de rellenado y el minuto.
  const minuto = new Date(ahora).toISOString().slice(0, 16);
  const huella = crypto.createHash('sha256').update([telefono || telefonoTal, pagina, t, valor, mensaje, ms === null ? minuto : ''].join('|')).digest('hex');

  const respuestas = [];
  if (interes) respuestas.push({ pregunta: 'Le interesa', valor: interes });
  if (PREFERENCIAS[preferencia]) respuestas.push({ pregunta: 'Prefiere que le contestemos por', valor: PREFERENCIAS[preferencia] });
  if (mensaje) respuestas.push({ pregunta: 'Mensaje', valor: mensaje });

  return {
    ok: !Object.keys(errores).length,
    errores,
    robot,
    datos: {
      origen: 'web', telefono: telefonoTal, nombre, email: emailTal || null, codigoWeb: ref, campana: utm?.utm_campaign || null, utm,
      idExterno: `web:${huella.slice(0, 40)}`, respuestas,
      tratamiento: { id: catalogo, claves: [ref, utm?.utm_campaign], textos: [] },
    },
    solicitud: {
      pagina, ref, preferencia: PREFERENCIAS[preferencia] ? preferencia : null, interes, catalogo,
      datos: true, comercial, version, huella, telefono,
    },
  };
}

module.exports = { leerFormularioWeb, MENSAJES, PREFERENCIAS, MINIMO_MS };

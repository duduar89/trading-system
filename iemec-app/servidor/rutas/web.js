'use strict';
// El formulario «Te llamamos» de la web pública (web/, un sitio estático en otro dominio):
//   POST /web/contacto   application/x-www-form-urlencoded, sin clave (lo manda el navegador)
// Sin JavaScript contesta 303 a <web>/gracias/ (o una página sencilla con los errores); con él
// (Accept: application/json), 200 {ok: true}, 422 {ok: false, errores} o 429. CORS solo para el
// dominio de la web (solo deja leer la respuesta: no impide que otra web lo mande).
//
// La ruta es anónima y el teléfono no se comprueba: cualquiera puede escribir el de otra persona. Por
// eso nada de lo que llega por aquí escribe a nadie con lo que puso quien lo envió, ni se une a los
// datos de otro (servidor/leads.js): quien pide WhatsApp recibe primero un WhatsApp neutro de
// confirmación («¿Has sido tú?»), sin nombre ni tratamiento, y quien pide llamada o correo, una tarea
// para recepción que avisa de que está sin verificar. Además:
//   · lo que manda otra web (Origin ajeno, o Sec-Fetch-Site: cross-site) o un robot torpe (la trampa, un
//     envío instantáneo) recibe «recibido» y no se guarda nada;
//   · límite por IP (8 cada 15 minutos y 20 al día: 429) y por teléfono (3 al día, sin decírselo a quien
//     envía: se contesta como a un envío bueno y no se guarda nada);
//   · tope entre todos de lo que se pone en marcha solo (20 por hora): pasado, se guarda sin escribir a
//     nadie ni crear tareas, y una sola tarea avisa a recepción.
// Guarda el lead y la prueba de los dos consentimientos por separado (solicitudes_web, lo pedido
// cifrado), con la fecha y la versión de los textos, que se comprueba contra las publicadas.
const express = require('express');
const config = require('../config');
const { altaLead } = require('../leads');
const { leerFormularioWeb } = require('../../motor/entrada/web');
const { LIMITES, sumarIntento, claveLimite, huellaIp } = require('../seguridad');
const { secreto } = require('../sesion');
const { registrar } = require('../eventos');
const { cargarReferencias, cargarTextosFormulario } = require('../referencias-web');

// (La app no se despliega con web/: su propio escape.)
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapar = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);

const dominioWeb = () => (process.env.WEB_DOMINIO || config.web.dominio).replace(/\/+$/, '');
function origenesWeb() {
  const extra = (process.env.WEB_ORIGENES ?? config.web.origenes ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const lista = [dominioWeb(), ...extra];
  return new Set(lista.map((o) => { try { return new URL(o).origin; } catch { return null; } }).filter(Boolean));
}

// ¿Lo manda otra web? Con cabecera Origin (los navegadores la ponen en todo POST), tiene que ser la de
// la web; «null» (una página sin origen) no dice nada, y entonces manda Sec-Fetch-Site.
function deOtraWeb(req) {
  const origen = req.get('origin');
  if (origen && origen !== 'null') return !origenesWeb().has(origen);
  return req.get('sec-fetch-site') === 'cross-site';
}

// Página mínima para quien envía sin JavaScript y algo no cuadra (normalmente lo ve antes el navegador).
function paginaErrores(errores, volver) {
  const lista = Object.values(errores).map((m) => `<li>${escapar(m)}</li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Revisa el formulario · IEMEC</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1f232b}a{color:#123f3e}</style></head>
<body><h1>Falta algún dato</h1><ul>${lista}</ul><p>Vuelve atrás con el botón del navegador para no perder lo que has escrito, o <a href="${escapar(volver)}">vuelve al formulario</a>. Si lo prefieres, escríbenos por WhatsApp o llámanos al 722 83 32 85.</p></body></html>`;
}

// Pasado el tope de lo que el formulario pone en marcha solo, una sola tarea (la misma mientras siga
// abierta) dice cuántas han llegado en la última hora.
const TITULO_TOPE = 'Formulario de la web: más solicitudes de las normales';
async function avisarTope(pool, n, ahora) {
  const titulo = `${TITULO_TOPE} (${n} en la última hora). Se han guardado sin escribirles ni crear tareas: puede ser alguien usando el formulario con teléfonos ajenos. Revisar los leads de la web de hoy`.slice(0, 200);
  const [hecho] = await pool.query("UPDATE tareas SET titulo = ? WHERE tipo = 'otro' AND estado = 'abierta' AND titulo LIKE ?", [titulo, `${TITULO_TOPE}%`]);
  if (!hecho.affectedRows) {
    await pool.query("INSERT INTO tareas (tipo, titulo, urgente, vence_en) VALUES ('otro', ?, TRUE, ?)", [titulo, new Date(ahora.getTime() + 3600000)]);
  }
}

// Si la IP no se sabe (el proxy no manda X-Forwarded-For), todos comparten la misma: se avisa una vez
// en el registro (docs/DESPLIEGUE.md dice cómo comprobarlo).
let avisadoSinIp = false;

function rutasWeb({ pool, reloj = () => new Date(), referencias = null, textos = null } = {}) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const refs = () => referencias || cargarReferencias();
  const versiones = () => (textos || cargarTextosFormulario()).versiones;

  const cors = (req, res) => {
    const origen = req.get('origin');
    res.vary('Origin');
    if (origen && origenesWeb().has(origen)) res.set('Access-Control-Allow-Origin', origen);
  };
  r.options('/web/contacto', (req, res) => {
    cors(req, res);
    res.set({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Accept, Content-Type', 'Access-Control-Max-Age': '600' });
    res.sendStatus(204);
  });

  r.post('/web/contacto', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 40 }), envolver(async (req, res) => {
    cors(req, res);
    const json = /application\/json/i.test(req.get('accept') || '');
    const ahora = reloj();
    const listo = () => (json ? res.json({ ok: true }) : res.redirect(303, `${dominioWeb()}/gracias/`));
    const demasiados = () => {
      res.set('Retry-After', '900');
      if (json) return res.status(429).json({ ok: false, error: 'demasiados_envios' });
      return res.status(429).type('html').set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .send(paginaErrores({ limite: 'Has enviado varias solicitudes seguidas. Espera unos minutos.' }, `${dominioWeb()}/pedir-cita/`));
    };

    // Lo que manda otra web (el navegador de alguien que la visita) no lo ha pedido nadie.
    if (deOtraWeb(req)) return listo();
    const { referencias: tabla, grupos } = refs();
    const l = leerFormularioWeb(req.body, { referencias: tabla, grupos, ahora, clave: secreto(), versiones: versiones() });
    if (l.robot) return listo();

    // Cada envío cuenta para el límite de su IP, vaya bien o mal.
    if (!req.ip && !avisadoSinIp) {
      avisadoSinIp = true;
      console.warn('web/contacto: la petición llega sin IP (¿el proxy no manda X-Forwarded-For?): todos los envíos comparten el mismo límite. Ver docs/DESPLIEGUE.md');
    }
    const porIp = await sumarIntento(p(), claveLimite('web', req), { ventanaMs: LIMITES.web.ventanaMs, ahora });
    const porIpDia = await sumarIntento(p(), claveLimite('webDia', req), { ventanaMs: LIMITES.webDia.ventanaMs, ahora });
    if (porIp.n > LIMITES.web.max || porIpDia.n > LIMITES.webDia.max) return demasiados();

    if (!l.ok) {
      if (json) return res.status(422).json({ ok: false, errores: l.errores });
      return res.status(422).type('html').set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .send(paginaErrores(l.errores, `${dominioWeb()}${l.solicitud.pagina}#te-llamamos`));
    }

    // Por teléfono, en silencio: a quien envía se le contesta igual (si no, sabría si otro ha pedido
    // información hoy con ese número), pero no se guarda nada.
    const porTelefono = await sumarIntento(p(), `webTelefono:${huellaIp(`tel:${l.solicitud.telefono}`)}`, { ventanaMs: LIMITES.webTelefono.ventanaMs, ahora });
    if (porTelefono.n > LIMITES.webTelefono.max) {
      await registrar(p(), { tipo: 'web_limite_telefono', actor: 'web', datos: { envios: porTelefono.n } });
      return listo();
    }

    // Lo que se pone en marcha solo, entre todos: pasado el tope, se guarda sin hacer nada más.
    const cupo = await sumarIntento(p(), 'webAcciones', { ventanaMs: LIMITES.webAcciones.ventanaMs, ahora });
    const sinAcciones = cupo.n > LIMITES.webAcciones.max;
    if (sinAcciones) await avisarTope(p(), cupo.n, ahora);

    // Quien pide WhatsApp recibe el de confirmación; quien pide llamada o correo, una tarea para
    // recepción (servidor/leads.js).
    const pref = l.solicitud.preferencia;
    const datos = { ...l.datos, tareaWeb: pref === 'llamada' ? 'web_llamada' : pref === 'correo' ? 'web_correo' : null };
    await altaLead(p(), datos, { inscribir: false, confirmar: pref === 'whatsapp', sinAcciones, ahora, solicitud: l.solicitud });
    return listo();
  }));

  r.use('/web', (err, _req, res, _next) => {
    const estado = err.status || err.statusCode || 500;
    if (estado >= 500) console.error('web/contacto:', err.message);
    res.status(estado).json({ ok: false, error: estado >= 500 ? 'Algo ha fallado en el servidor' : 'Petición no válida' });
  });
  return r;
}

module.exports = { rutasWeb, cargarReferencias, origenesWeb, deOtraWeb };

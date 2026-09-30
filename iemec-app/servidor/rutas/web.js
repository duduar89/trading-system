'use strict';
// El formulario «Te llamamos» de la web pública (web/, un sitio estático en otro dominio):
//   POST /web/contacto   application/x-www-form-urlencoded, sin clave (lo manda el navegador)
// Sin JavaScript contesta 303 a <web>/gracias/ (o una página sencilla con los errores); con él
// (Accept: application/json), 200 {ok: true}, 422 {ok: false, errores} o 429. CORS solo para el
// dominio de la web. Guarda el lead (servidor/leads.js) y la prueba de los dos consentimientos por
// separado, con la fecha y la versión de los textos (solicitudes_web). Límite de envíos por IP y
// por teléfono en MariaDB (sin cookies ni CAPTCHA de terceros). Un robot (la trampa rellena o un
// envío instantáneo) recibe «recibido» y no se guarda nada.
const express = require('express');
const config = require('../config');
const { altaLead } = require('../leads');
const { leerFormularioWeb } = require('../../motor/entrada/web');
const { LIMITES, sumarIntento, claveLimite, huellaIp } = require('../seguridad');
const { cargarReferencias } = require('../referencias-web');

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

// Página mínima para quien envía sin JavaScript y algo no cuadra (normalmente lo ve antes el navegador).
function paginaErrores(errores, volver) {
  const lista = Object.values(errores).map((m) => `<li>${escapar(m)}</li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Revisa el formulario · IEMEC</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1f232b}a{color:#123f3e}</style></head>
<body><h1>Falta algún dato</h1><ul>${lista}</ul><p>Vuelve atrás con el botón del navegador para no perder lo que has escrito, o <a href="${escapar(volver)}">vuelve al formulario</a>. Si lo prefieres, escríbenos por WhatsApp o llámanos al 722 83 32 85.</p></body></html>`;
}

function rutasWeb({ pool, reloj = () => new Date(), referencias = null } = {}) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const refs = () => referencias || cargarReferencias();

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

    const { referencias: tabla, grupos } = refs();
    const l = leerFormularioWeb(req.body, { referencias: tabla, grupos, ahora });
    if (l.robot) return listo();

    // Cada envío cuenta para el límite de su IP, vaya bien o mal.
    const porIp = await sumarIntento(p(), claveLimite('web', req), { ventanaMs: LIMITES.web.ventanaMs, ahora });
    if (porIp.n > LIMITES.web.max) return demasiados();

    if (!l.ok) {
      if (json) return res.status(422).json({ ok: false, errores: l.errores });
      return res.status(422).type('html').set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .send(paginaErrores(l.errores, `${dominioWeb()}${l.solicitud.pagina}#te-llamamos`));
    }

    const porTelefono = await sumarIntento(p(), `webTelefono:${huellaIp(`tel:${l.solicitud.telefono}`)}`, { ventanaMs: LIMITES.webTelefono.ventanaMs, ahora });
    if (porTelefono.n > LIMITES.webTelefono.max) return demasiados();

    // Quien pide WhatsApp entra en la secuencia de seguimiento de su solicitud (como un lead de la
    // web de siempre); quien pide llamada o correo, no: le contesta una persona (tarea).
    const pref = l.solicitud.preferencia;
    const datos = { ...l.datos, tareaWeb: pref === 'llamada' ? 'web_llamada' : pref === 'correo' ? 'web_correo' : null };
    await altaLead(p(), datos, { inscribir: pref === 'whatsapp', ahora, solicitud: l.solicitud });
    return listo();
  }));

  r.use('/web', (err, _req, res, _next) => {
    const estado = err.status || err.statusCode || 500;
    if (estado >= 500) console.error('web/contacto:', err.message);
    res.status(estado).json({ ok: false, error: estado >= 500 ? 'Algo ha fallado en el servidor' : 'Petición no válida' });
  });
  return r;
}

module.exports = { rutasWeb, cargarReferencias, origenesWeb };

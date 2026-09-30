'use strict';
// Lo que entra de fuera, sin sesión del panel:
//   GET/POST /webhooks/whatsapp   Cloud API de Meta (o 360dialog, que manda el mismo formato)
//   GET/POST /webhooks/meta       leads de los formularios de los anuncios (Lead Ads)
//   POST     /api/leads           la web y otras herramientas (GHL mientras exista), con clave
// El GET es la verificación de Meta al dar de alta el webhook (hub.challenge). El POST va firmado:
// X-Hub-Signature-256 = HMAC-SHA256 del cuerpo TAL CUAL llega con el secreto de la app. Se comprueba,
// se guarda (cifrado), se encola y se contesta 200 al momento; lo procesa el cron (servidor/entrada.js).
// Por eso estas rutas van antes del lector de JSON de la app: la firma se calcula sobre los bytes.
const crypto = require('crypto');
const express = require('express');
const { guardarWebhook, TRABAJOS } = require('../entrada');
const { altaLead } = require('../leads');
const W = require('../../motor/entrada/whatsapp');
const { leerLeadApi, leerWebhookLeads } = require('../../motor/entrada/leads');

const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);
const crudo = express.raw({ type: () => true, limit: '1mb' });

// Compara dos secretos en tiempo constante, también si miden distinto (se comparan sus huellas).
function igualesSeguro(a, b) {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/**
 * ¿Viene de verdad de Meta (o del proveedor)? Con secreto de la app, la firma tiene que cuadrar; sin
 * él, vale una clave compartida en la cabecera X-Clave (360dialog no firma con el secreto de nuestra
 * app, pero deja añadir cabeceras). Sin ninguno de los dos: en producción se rechaza; fuera, se
 * admite y queda firma_ok = NULL.
 */
function autenticar(req, cuerpo, { secreto, clave }) {
  if (secreto) {
    const esperada = `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
    const firma = req.get('x-hub-signature-256');
    return firma && igualesSeguro(firma, esperada) ? { ok: true, firmaOk: true } : { ok: false, estado: 401, error: 'Firma no válida' };
  }
  if (clave) {
    const dada = req.get('x-clave');
    return dada && igualesSeguro(dada, clave) ? { ok: true, firmaOk: true } : { ok: false, estado: 401, error: 'Clave no válida' };
  }
  if (process.env.NODE_ENV === 'production') return { ok: false, estado: 503, error: 'Falta el secreto del webhook en el servidor' };
  return { ok: true, firmaOk: null };
}

// Verificación de Meta: GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → el challenge.
const verificacion = (variable) => (req, res) => {
  const token = process.env[variable];
  const q = req.query;
  const reto = typeof q['hub.challenge'] === 'string' ? q['hub.challenge'] : '';
  if (token && q['hub.mode'] === 'subscribe' && typeof q['hub.verify_token'] === 'string'
    && igualesSeguro(q['hub.verify_token'], token) && /^[\w.-]{1,256}$/.test(reto)) {
    return res.type('text/plain').send(reto);
  }
  res.sendStatus(403);
};

function leerJson(cuerpo) {
  try {
    const v = JSON.parse(cuerpo.toString('utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function rutasWebhooks({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);

  r.get('/webhooks/whatsapp', verificacion('WHATSAPP_VERIFY_TOKEN'));
  r.post('/webhooks/whatsapp', crudo, envolver(async (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const a = autenticar(req, cuerpo, { secreto: process.env.WHATSAPP_APP_SECRET, clave: process.env.WHATSAPP_WEBHOOK_CLAVE });
    if (!a.ok) return res.status(a.estado).json({ error: a.error });
    const json = leerJson(cuerpo);
    if (!json) return res.status(400).json({ error: 'El cuerpo no es JSON' });
    const datos = W.leerWebhook(json);
    const evento = datos.mensajes.length ? 'mensajes' : datos.estados.length ? 'estados' : datos.campos[0] || 'otro';
    await guardarWebhook(p(), {
      proveedor: 'whatsapp', trabajo: datos.mensajes.length ? TRABAJOS.whatsapp : TRABAJOS.estados,
      evento, idExterno: W.idExterno(datos, cuerpo), cuerpo: cuerpo.toString('utf8'), firmaOk: a.firmaOk,
    });
    res.sendStatus(200);
  }));

  r.get('/webhooks/meta', verificacion('META_VERIFY_TOKEN'));
  r.post('/webhooks/meta', crudo, envolver(async (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const a = autenticar(req, cuerpo, { secreto: process.env.META_APP_SECRET });
    if (!a.ok) return res.status(a.estado).json({ error: a.error });
    const json = leerJson(cuerpo);
    if (!json) return res.status(400).json({ error: 'El cuerpo no es JSON' });
    const leads = leerWebhookLeads(json);
    const idExterno = leads.length === 1 ? `leadgen:${leads[0].leadgenId}` : `sha256:${crypto.createHash('sha256').update(cuerpo).digest('hex')}`;
    await guardarWebhook(p(), { proveedor: 'meta', evento: leads.length ? 'leadgen' : 'otro', idExterno, cuerpo: cuerpo.toString('utf8'), firmaOk: a.firmaOk });
    res.sendStatus(200);
  }));

  // La web (desde su servidor, nunca desde el navegador: la clave no puede ir en la página) y GHL.
  r.post('/api/leads', express.json({ limit: '100kb' }), express.urlencoded({ extended: false, limit: '100kb' }), envolver(async (req, res) => {
    const clave = process.env.LEADS_CLAVE || '';
    if (clave.length < 16) return res.status(503).json({ error: 'La entrada de leads no está configurada (LEADS_CLAVE)' });
    const dada = req.get('x-clave');
    if (!dada || !igualesSeguro(dada, clave)) return res.status(401).json({ error: 'Clave no válida' });
    const l = leerLeadApi(req.body);
    if (!l.ok) return res.status(400).json({ error: l.error });
    const a = await altaLead(p(), l.datos, { ahora: new Date() });
    res.status(a.nuevo ? 201 : 200).json({
      ok: true, leadId: a.leadId, nuevo: a.nuevo, inscrito: a.inscrito, motivo: a.motivo || null, tratamiento: a.tratamientoId || null,
    });
  }));

  r.use((err, _req, res, _next) => {
    const estado = err.status || err.statusCode || 500;
    if (estado >= 500) console.error('webhooks:', err.message);
    res.status(estado).json({ error: estado >= 500 ? 'Algo ha fallado en el servidor' : 'Petición no válida' });
  });
  return r;
}

module.exports = { rutasWebhooks, autenticar, igualesSeguro };

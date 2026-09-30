'use strict';
// Lo que entra de fuera, sin sesión del panel:
//   GET/POST /webhooks/whatsapp   Cloud API de Meta (o 360dialog, que manda el mismo formato)
//   GET/POST /webhooks/meta       leads de los formularios de los anuncios (Lead Ads)
//   POST     /webhooks/google     avisos de la ficha de Google (Pub/Sub push, con token OIDC)
//   POST     /api/leads           la web y otras herramientas (GHL mientras exista), con clave
// El GET es la verificación de Meta al dar de alta el webhook (hub.challenge). El POST va firmado:
// X-Hub-Signature-256 = HMAC-SHA256 del cuerpo TAL CUAL llega con el secreto de la app. Se comprueba,
// se guarda (cifrado), se encola y se contesta 200 al momento; lo procesa el cron (servidor/entrada.js).
// Por eso estas rutas van antes del lector de JSON de la app: la firma se calcula sobre los bytes.
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { guardarWebhook, TRABAJOS } = require('../entrada');
const { altaLead } = require('../leads');
const { TRABAJOS: TRABAJOS_GOOGLE } = require('../ficha-google');
const { crearVerificadorPubSub, leerAvisoPubSub } = require('../integraciones/google');
const W = require('../../motor/entrada/whatsapp');
const { leerLeadApi, leerWebhookLeads } = require('../../motor/entrada/leads');

const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);
const crudo = express.raw({ type: () => true, limit: '1mb' });
// Una clave compartida más corta se puede adivinar: se trata como si no estuviera.
const LARGO_MINIMO_CLAVE = 16;

// Compara dos secretos en tiempo constante, también si miden distinto (se comparan sus huellas).
function igualesSeguro(a, b) {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/**
 * ¿Viene de verdad de Meta (o del proveedor)? Con secreto de la app, la firma tiene que cuadrar; sin
 * él, vale una clave compartida en la cabecera X-Clave (360dialog no firma con el secreto de nuestra
 * app, pero deja añadir cabeceras), de 16 caracteres o más. Sin ninguno de los dos: en producción se
 * rechaza; fuera, se admite y queda firma_ok = NULL.
 */
function autenticar(req, cuerpo, { secreto, clave: dada = null }) {
  const clave = dada && dada.length >= LARGO_MINIMO_CLAVE ? dada : null;
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

/**
 * ¿Viene de Google? Pub/Sub firma un token OIDC (Authorization: Bearer …) para la cuenta de servicio de
 * la suscripción (GOOGLE_PUBSUB_EMAIL) con la audiencia que se le dio (GOOGLE_PUBSUB_AUDIENCIA; por
 * defecto, esta misma dirección). Sin GOOGLE_PUBSUB_EMAIL: en producción se rechaza; fuera, se admite
 * y queda firma_ok = NULL. Si no se pueden leer las claves de Google, 503 (Pub/Sub reintenta).
 */
async function autenticarGoogle(req, verificar) {
  const email = process.env.GOOGLE_PUBSUB_EMAIL;
  if (!email) {
    if (process.env.NODE_ENV === 'production') return { ok: false, estado: 503, error: 'Falta GOOGLE_PUBSUB_EMAIL en el servidor' };
    return { ok: true, firmaOk: null };
  }
  const audiencia = process.env.GOOGLE_PUBSUB_AUDIENCIA || `${String(process.env.URL_PUBLICA || config.urlPublica).replace(/\/+$/, '')}/webhooks/google`;
  const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(req.get('authorization') || '');
  if (!m) return { ok: false, estado: 401, error: 'Falta el token de Google' };
  try {
    await verificar(m[1], { audiencia, email });
    return { ok: true, firmaOk: true };
  } catch (err) {
    if (err.motivo) return { ok: false, estado: 403, error: 'Token de Google no válido' };
    console.error('webhooks: no se ha podido comprobar el token de Google:', err.message);
    return { ok: false, estado: 503, error: 'No se ha podido comprobar el token de Google' };
  }
}

function leerJson(cuerpo) {
  try {
    const v = JSON.parse(cuerpo.toString('utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// reloj: la hora con la que se encola y se da de alta (las pruebas la fijan). verificarGoogle: quien
// comprueba el token de Pub/Sub (en las pruebas, uno falso; si no, el de verdad, con las claves de
// Google).
function rutasWebhooks({ pool, reloj = () => new Date(), verificarGoogle = null }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const verificar = verificarGoogle || crearVerificadorPubSub();

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
      telefonos: [...new Set(datos.mensajes.map((m) => m.telefono).filter(Boolean))], ahora: reloj(),
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
    await guardarWebhook(p(), { proveedor: 'meta', evento: leads.length ? 'leadgen' : 'otro', idExterno, cuerpo: cuerpo.toString('utf8'), firmaOk: a.firmaOk, ahora: reloj() });
    res.sendStatus(200);
  }));

  // Avisos de la ficha de Google por Pub/Sub (reseña nueva o cambiada, cambios de Google, control de
  // la ficha…). El token se mira antes de leer el cuerpo; después, se guarda (cifrado, como los demás),
  // se encola y se contesta 204. Pub/Sub repite el aviso si no se contesta: el mismo messageId no se
  // guarda dos veces. Lo procesa el cron (servidor/ficha-google.js).
  const tokenDeGoogle = (req, res, next) => {
    autenticarGoogle(req, verificar).then((a) => {
      if (!a.ok) return res.status(a.estado).json({ error: a.error });
      req.firmaGoogle = a.firmaOk;
      next();
    }, next);
  };
  r.post('/webhooks/google', tokenDeGoogle, crudo, envolver(async (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const json = leerJson(cuerpo);
    if (!json || !json.message || typeof json.message !== 'object') return res.status(400).json({ error: 'No es un aviso de Pub/Sub' });
    const aviso = leerAvisoPubSub(json);
    const idExterno = aviso.idMensaje ? `pubsub:${aviso.idMensaje}` : `sha256:${crypto.createHash('sha256').update(cuerpo).digest('hex')}`;
    await guardarWebhook(p(), {
      proveedor: 'google', trabajo: TRABAJOS_GOOGLE.aviso, evento: aviso.tipo || 'otro', idExterno,
      cuerpo: cuerpo.toString('utf8'), firmaOk: req.firmaGoogle, ahora: reloj(),
    });
    res.sendStatus(204);
  }));

  // La web (desde su servidor, nunca desde el navegador: la clave no puede ir en la página) y GHL.
  // La clave se mira antes de leer el cuerpo.
  const conClave = (req, res, next) => {
    const clave = process.env.LEADS_CLAVE || '';
    if (clave.length < LARGO_MINIMO_CLAVE) return res.status(503).json({ error: 'La entrada de leads no está configurada (LEADS_CLAVE)' });
    const dada = req.get('x-clave');
    if (!dada || !igualesSeguro(dada, clave)) return res.status(401).json({ error: 'Clave no válida' });
    next();
  };
  r.post('/api/leads', conClave, express.json({ limit: '100kb' }), express.urlencoded({ extended: false, limit: '100kb' }), envolver(async (req, res) => {
    const l = leerLeadApi(req.body);
    if (!l.ok) return res.status(400).json({ error: l.error });
    const a = await altaLead(p(), l.datos, { ahora: reloj() });
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

module.exports = { rutasWebhooks, autenticar, autenticarGoogle, igualesSeguro };

'use strict';
// Meta (Facebook e Instagram) detrás de un adaptador. De momento, los leads de los formularios de los
// anuncios (Lead Ads): el webhook solo trae el identificador del lead y los datos (nombre, teléfono,
// email, respuestas, campaña, conjunto y anuncio) se piden a la Graph API.
//   · simulado (por defecto): devuelve los leads que se le dan (pruebas y demo); nunca sale a internet.
//   · real: GET https://graph.facebook.com/<versión>/<leadgen_id> con el token de la página
//     (META_TOKEN_PAGINA, permiso leads_retrieval). Sin token no arranca (puerta ⛔ en PROGRESO.md).
// Un error «permanente» (el lead no existe para nosotros, token caducado, sin permiso) no se arregla
// reintentando: el lead va a recepción al momento. Los de Meta o de la red (5xx, límites), se reintentan.
const crypto = require('crypto');

// Códigos de la Graph API que son límites de llamadas: esperar y reintentar.
const LIMITES = new Set([4, 17, 32, 613, 80001]);

function errorMeta(mensaje, permanente) {
  const err = new Error(mensaje);
  err.permanente = permanente;
  return err;
}

const CAMPOS = ['id', 'created_time', 'field_data', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'platform', 'is_organic'];

function crearSimulado({ leads = {} } = {}) {
  const almacen = new Map(Object.entries(leads));
  const pedidos = [];
  return {
    modo: 'simulado',
    leads: almacen,
    pedidos,
    async obtenerLead(id) {
      pedidos.push(String(id));
      const lead = almacen.get(String(id));
      if (!lead) throw errorMeta(`Meta simulado: no hay ningún lead ${id}`, true);
      return { id: String(id), ...lead };
    },
  };
}

function crearReal(env = process.env, { fetch = globalThis.fetch } = {}) {
  const token = env.META_TOKEN_PAGINA;
  if (!token) throw new Error('Meta real: falta META_TOKEN_PAGINA, el token de la página con permiso leads_retrieval (puerta ⛔ en PROGRESO.md)');
  const version = env.META_GRAPH_VERSION || 'v23.0';
  return {
    modo: 'real',
    async obtenerLead(id) {
      if (!/^\d{1,30}$/.test(String(id))) throw errorMeta(`Identificador de lead no válido: ${id}`, true);
      const q = new URLSearchParams({ fields: CAMPOS.join(','), access_token: token });
      // Si la app exige «appsecret_proof», va firmado con su secreto.
      if (env.META_APP_SECRET) q.set('appsecret_proof', crypto.createHmac('sha256', env.META_APP_SECRET).update(token).digest('hex'));
      const r = await fetch(`https://graph.facebook.com/${version}/${id}?${q}`, { signal: AbortSignal.timeout(15000) });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        const permanente = r.status >= 400 && r.status < 500 && r.status !== 429 && !LIMITES.has(datos.error?.code);
        throw errorMeta(`Meta ${r.status}: ${datos.error?.message || 'error al pedir el lead'}`, permanente);
      }
      return datos;
    },
  };
}

function crearMeta(modo = 'simulado', opciones = {}) {
  return modo === 'real' ? crearReal(opciones.env || process.env, opciones) : crearSimulado(opciones);
}

module.exports = { crearMeta, CAMPOS };

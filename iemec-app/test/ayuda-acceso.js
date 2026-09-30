'use strict';
// Lo que comparten las pruebas de acceso: la app entera con un reloj que pone la prueba, un cliente que
// guarda la cookie de sesión como un navegador (y manda el origen del panel en lo que cambia cosas), el
// alta por invitación y la entrada con el autenticador simulado. Personas y correos, inventados.
const assert = require('node:assert/strict');
const express = require('express');
const { crearApp } = require('../servidor/index');
const acceso = require('../servidor/acceso');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearGoogle } = require('../servidor/integraciones/google');
const { Autenticador } = require('./autenticador-simulado');

const ORIGEN = 'http://localhost:3004';

// El entorno de las pruebas de acceso, sin lo que pueda traer el .env del portátil. Devuelve cómo
// dejarlo como estaba.
function ponerEntorno(cambios) {
  const antes = {};
  for (const [k, v] of Object.entries(cambios)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => ponerEntorno(antes);
}
const ENTORNO = { URL_PUBLICA: ORIGEN, MODO_DEMO: undefined, PANEL_CLAVE: undefined, NODE_ENV: undefined, SESION_SECRETO: undefined };

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((ok) => s.once('listening', ok));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

// La app con un reloj que la prueba adelanta a su gusto (req.ahora solo lo pone el servidor).
function appConReloj(pool, reloj) {
  const app = express();
  app.use((req, _res, next) => { req.ahora = reloj.ahora; next(); });
  app.use(crearApp({ pool, deps: { ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado'), google: crearGoogle('simulado') } }));
  return app;
}

// Un navegador: guarda la cookie y la manda; en lo que no es GET, con el origen del panel. ip: la IP
// con la que llega (X-Forwarded-For; la app se fía de un proxy), para no mezclar límites entre pruebas.
function cliente(base, { ip = null } = {}) {
  const c = {
    cookie: null,
    async pedir(ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: {
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...(metodo === 'GET' ? {} : { Origin: ORIGEN }),
          ...(c.cookie ? { Cookie: c.cookie } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}), ...cabeceras,
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      const puesta = r.headers.get('set-cookie');
      if (puesta) {
        const m = /iemec_sesion=([^;]*)/.exec(puesta);
        c.cookie = m && m[1] ? `iemec_sesion=${m[1]}` : null;
      }
      const texto = await r.text();
      let json = null;
      try { json = JSON.parse(texto); } catch { /* no es JSON */ }
      return { status: r.status, json, cabeceras: r.headers, renovada: Boolean(puesta) };
    },
  };
  return c;
}

const tokenDe = (enlace) => /#alta\/([A-Za-z0-9_-]{43})$/.exec(enlace)[1];

// Alta con el enlace: opciones, el autenticador crea la passkey y la respuesta vuelve al servidor.
async function darDeAlta(c, aut, token, { dispositivo = 'Móvil de prueba', ...torcer } = {}) {
  const op = await c.pedir('/api/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } });
  assert.equal(op.status, 200, JSON.stringify(op.json));
  return c.pedir('/api/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta: aut.registrar(op.json, torcer), dispositivo } });
}

async function entrar(c, aut, firma = {}) {
  const op = await c.pedir('/api/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
  assert.equal(op.status, 200, JSON.stringify(op.json));
  return c.pedir('/api/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta: aut.firmar(op.json, firma) } });
}

// Una persona del equipo dada de alta y con sesión: { usuario, c (su navegador), aut (su móvil) }.
async function personaConSesion(pool, base, { email, nombre, rol, ahora, ip = null }) {
  const alta = await acceso.crearUsuario(pool, { email, nombre, rol, actor: 'pruebas', ahora });
  const c = cliente(base, { ip });
  const aut = new Autenticador({ origen: ORIGEN });
  const r = await darDeAlta(c, aut, tokenDe(alta.enlace));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { usuario: alta.usuario, c, aut };
}

module.exports = { ORIGEN, ENTORNO, ponerEntorno, conServidor, appConReloj, cliente, tokenDe, darDeAlta, entrar, personaConSesion, Autenticador };

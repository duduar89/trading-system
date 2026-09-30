'use strict';
// Entrar al panel, antes de tener sesión (/api/acceso): el enlace de alta, registrar la passkey,
// entrar con passkey y el acceso de emergencia con PANEL_CLAVE. Todo va por POST, también el token del
// enlace (así no queda en ninguna URL de un registro), y con límite de intentos por IP: retos pedidos,
// fallos (cada error de aquí cuenta) e intentos con la clave de emergencia.
const express = require('express');
const acceso = require('../acceso');
const { iniciarSesion, sesionPublica, modoDemo } = require('../sesion');
const { contar, frenar, sumarFallo } = require('../seguridad');

const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);

function rutasAcceso({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const ahoraDe = (req) => req.ahora || new Date();
  const cuerpo = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

  // Lo que necesita saber la pantalla de entrada.
  r.get('/', (_req, res) => res.json({ emergencia: acceso.hayClaveEmergencia(), demo: modoDemo() }));

  r.post('/invitacion', frenar(p), envolver(async (req, res) => {
    res.json(await acceso.verInvitacion(p(), { token: cuerpo(req).token, ahora: ahoraDe(req) }));
  }));

  r.post('/alta/opciones', frenar(p), contar(p, 'retos'), envolver(async (req, res) => {
    res.json(await acceso.opcionesAlta(p(), { token: cuerpo(req).token, ahora: ahoraDe(req) }));
  }));

  r.post('/alta', frenar(p), envolver(async (req, res) => {
    const { token, respuesta, dispositivo } = cuerpo(req);
    const { usuario, passkeyId } = await acceso.completarAlta(p(), { token, respuesta, dispositivo, ahora: ahoraDe(req) });
    iniciarSesion(res, usuario, { passkeyId, ahora: ahoraDe(req) });
    res.status(201).json(sesionPublica(usuario));
  }));

  r.post('/entrar/opciones', frenar(p), contar(p, 'retos'), envolver(async (req, res) => {
    res.json(await acceso.opcionesEntrar(p(), { ahora: ahoraDe(req) }));
  }));

  r.post('/entrar', frenar(p), envolver(async (req, res) => {
    const { usuario, passkeyId } = await acceso.verificarEntrada(p(), { respuesta: cuerpo(req).respuesta, ahora: ahoraDe(req) });
    iniciarSesion(res, usuario, { passkeyId, ahora: ahoraDe(req) });
    res.json(sesionPublica(usuario));
  }));

  r.post('/emergencia', frenar(p), contar(p, 'emergencia'), envolver(async (req, res) => {
    const { email, clave } = cuerpo(req);
    const { usuario } = await acceso.entrarConClave(p(), { email, clave, ip: req.ip, ahora: ahoraDe(req) });
    iniciarSesion(res, usuario, { emergencia: true, ahora: ahoraDe(req) });
    res.json(sesionPublica({ ...usuario, emergencia: true }));
  }));

  r.use(errores(p, 'acceso'));
  return r;
}

// Errores de acceso: su estado y su mensaje, y en las rutas sin sesión cada uno cuenta como fallo para
// el límite de la IP. Una passkey desconocida lleva el RP ID: el panel se lo dice al navegador para que
// deje de ofrecerla. El motivo técnico solo sale en el registro del servidor.
function errores(p, donde, { cuentaFallo = true } = {}) {
  return async (err, req, res, _next) => {
    if (!(err instanceof acceso.ErrorAcceso)) {
      console.error(`${donde}:`, err.message);
      return res.status(500).json({ error: 'Algo ha fallado en el servidor' });
    }
    if (err.causa && !process.env.NODE_TEST_CONTEXT) console.warn(`${donde}: ${err.codigo} (${err.causa})`);
    if (cuentaFallo && err.codigo !== 'EMERGENCIA_NO_CONFIGURADA') await sumarFallo(p(), req).catch(() => {});
    res.status(err.estado).json({ error: err.message, codigo: err.codigo, ...(err.codigo === 'CREDENCIAL_DESCONOCIDA' ? { rpID: acceso.rp().id } : {}) });
  };
}

module.exports = { rutasAcceso, errores };

'use strict';
// Equipo y accesos, dentro del panel (con sesión):
//   /api/panel/equipo…   dar de alta, cambiar el rol, desactivar, enlace nuevo, cerrar sesiones y borrar
//                        passkeys de cualquiera: solo quien puede gestionar el equipo (dirección, admin).
//   /api/panel/passkeys… las passkeys propias: verlas, añadir la de este aparato y borrar una perdida.
//   /api/panel/sesiones/cerrar-otras   cierra las sesiones de los demás aparatos (esta sigue).
const express = require('express');
const acceso = require('../acceso');
const { exige, PERMISOS } = require('../permisos');
const { emitir, cerrarCookie } = require('../sesion');
const { contar } = require('../seguridad');
const { errores } = require('./acceso');

const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);
const idDe = (valor) => (/^\d{1,10}$/.test(String(valor)) ? Number(valor) : null);

function rutasEquipo({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const ahoraDe = (req) => req.ahora || new Date();
  const actor = (req) => req.usuario?.email || 'panel';
  const gestionar = exige('usuarios.gestionar');
  // Lo propio necesita un usuario de verdad (el de la demostración no tiene passkeys).
  const conUsuario = (req, res, next) => (req.usuario?.id ? next()
    : res.status(409).json({ error: 'En la demostración no hay passkeys propias: entra con tu passkey para gestionarlas.', codigo: 'SIN_USUARIO' }));
  // Una cookie nueva con la versión de sesiones de ahora: quien cierra sus otras sesiones sigue dentro.
  const seguirDentro = (req, res, u) => emitir(res, u, { inicio: req.usuario.inicio ?? ahoraDe(req).getTime(), passkeyId: req.usuario.passkeyId, emergencia: req.usuario.emergencia, ahora: ahoraDe(req) });

  // ── El equipo ─────────────────────────────────────────────────────────────────────────────
  // Con la tabla de permisos, para que se vea qué puede hacer cada rol.
  r.get('/equipo', gestionar, envolver(async (req, res) => {
    res.json({
      usuarios: await acceso.equipo(p(), { ahora: ahoraDe(req) }), yo: req.usuario.id ?? null,
      permisos: Object.entries(PERMISOS).map(([id, { roles, que }]) => ({ id, roles, que })),
    });
  }));

  // Cuerpo: { email, nombre, rol }. Devuelve el enlace de alta: solo se ve esta vez.
  r.post('/equipo', gestionar, envolver(async (req, res) => {
    const { email, nombre, rol } = req.body || {};
    res.status(201).json(await acceso.crearUsuario(p(), { email, nombre, rol, actor: actor(req), ahora: ahoraDe(req) }));
  }));

  // Cuerpo: { rol } y/o { activo }.
  r.patch('/equipo/:id', gestionar, envolver(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id) return res.status(404).json({ error: 'No existe esa persona en el equipo', codigo: 'USUARIO_DESCONOCIDO' });
    const { rol, activo } = req.body || {};
    res.json(await acceso.cambiarUsuario(p(), { id, rol, activo: activo === undefined ? undefined : Boolean(activo), actor: actor(req), actorId: req.usuario.id, ahora: ahoraDe(req) }));
  }));

  r.post('/equipo/:id/invitacion', gestionar, envolver(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id) return res.status(404).json({ error: 'No existe esa persona en el equipo', codigo: 'USUARIO_DESCONOCIDO' });
    res.status(201).json(await acceso.invitar(p(), { usuarioId: id, actor: actor(req), ahora: ahoraDe(req) }));
  }));

  r.post('/equipo/:id/cerrar-sesiones', gestionar, envolver(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id) return res.status(404).json({ error: 'No existe esa persona en el equipo', codigo: 'USUARIO_DESCONOCIDO' });
    const u = await acceso.cerrarSesiones(p(), { id, actor: actor(req) });
    if (id === req.usuario.id) seguirDentro(req, res, u);
    res.json({ ok: true });
  }));

  // La passkey perdida de alguien: las sesiones que se abrieron con ella se acaban al momento.
  r.delete('/equipo/:id/passkeys/:pk', gestionar, envolver(async (req, res) => {
    const [id, pk] = [idDe(req.params.id), idDe(req.params.pk)];
    if (!id || !pk) return res.status(404).json({ error: 'No existe esa passkey', codigo: 'PASSKEY_DESCONOCIDA' });
    await acceso.borrarPasskey(p(), { id: pk, usuarioId: id, actor: actor(req) });
    const cerrada = pk === req.usuario.passkeyId;
    if (cerrada) cerrarCookie(res);
    res.json({ ok: true, sesionCerrada: cerrada });
  }));

  // ── Mis passkeys ──────────────────────────────────────────────────────────────────────────
  r.get('/passkeys', conUsuario, envolver(async (req, res) => {
    res.json({ passkeys: await acceso.passkeysDe(p(), req.usuario.id), actual: req.usuario.passkeyId ?? null });
  }));

  r.post('/passkeys/opciones', conUsuario, contar(p, 'retos'), envolver(async (req, res) => {
    res.json(await acceso.opcionesNuevaPasskey(p(), { usuarioId: req.usuario.id, ahora: ahoraDe(req) }));
  }));

  // Cuerpo: { respuesta, dispositivo }.
  r.post('/passkeys', conUsuario, envolver(async (req, res) => {
    const { respuesta, dispositivo } = req.body || {};
    res.status(201).json(await acceso.registrarNuevaPasskey(p(), { usuarioId: req.usuario.id, respuesta, dispositivo, actor: actor(req), ahora: ahoraDe(req) }));
  }));

  // Si es la passkey con la que se ha entrado, esta sesión se acaba aquí.
  r.delete('/passkeys/:id', conUsuario, envolver(async (req, res) => {
    const id = idDe(req.params.id);
    if (!id) return res.status(404).json({ error: 'No existe esa passkey', codigo: 'PASSKEY_DESCONOCIDA' });
    await acceso.borrarPasskey(p(), { id, usuarioId: req.usuario.id, actor: actor(req) });
    const cerrada = id === req.usuario.passkeyId;
    if (cerrada) cerrarCookie(res);
    res.json({ ok: true, sesionCerrada: cerrada });
  }));

  r.post('/sesiones/cerrar-otras', conUsuario, envolver(async (req, res) => {
    seguirDentro(req, res, await acceso.cerrarSesiones(p(), { id: req.usuario.id, actor: actor(req) }));
    res.json({ ok: true });
  }));

  r.use(errores(p, 'equipo', { cuentaFallo: false }));
  return r;
}

module.exports = { rutasEquipo };

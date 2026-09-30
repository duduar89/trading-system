'use strict';
// Sesión del panel: cookie firmada (HMAC-SHA256), httpOnly, SameSite=Strict y Secure en producción.
// Se entra con passkey (servidor/acceso.js); la clave compartida PANEL_CLAVE queda solo como acceso de
// emergencia de dirección. La cookie lleva quién es y su rol, pero en cada petición se mira el usuario
// en la base: si se desactiva, si se cierran sus sesiones o si se borra la passkey con la que entró, la
// sesión deja de valer en ese momento, y el rol que cuenta es siempre el de la base.
// Dura como mucho una jornada (12 h), caduca tras 2 h sin usar el panel y la cookie se renueva cada
// cuarto de hora de uso. La de emergencia dura una hora y no se alarga.
// Con MODO_DEMO=1 (solo fuera de producción) se entra como usuario de demostración.
const crypto = require('crypto');
const express = require('express');
const { NOMBRE_ROL, permisosDe } = require('./permisos');

const NOMBRE = 'iemec_sesion';
const MAXIMA_MS = 12 * 3600 * 1000;
const INACTIVIDAD_MS = 2 * 3600 * 1000;
const RENOVAR_MS = 15 * 60 * 1000;
const EMERGENCIA_MS = 3600 * 1000;
const DEMO = { id: null, email: 'demo@iemec', nombre: 'Demostración', rol: 'direccion' };

function secreto() {
  const s = process.env.SESION_SECRETO;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('Falta SESION_SECRETO (32+ caracteres) en el .env del servidor');
  return 'desarrollo-no-usar-en-produccion-0123456789';
}

function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

// Los datos de la cookie si la firma cuadra y no ha caducado. Una cookie de antes de las passkeys (o
// hecha a mano en las pruebas) no lleva inicio: se toma el que le corresponde por su caducidad.
function verificar(valor, ahora = new Date()) {
  if (typeof valor !== 'string' || !valor.includes('.')) return null;
  const [cuerpo, firma] = valor.split('.');
  const esperada = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  if (!firma || firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  let datos;
  try { datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); } catch { return null; }
  if (!datos || typeof datos !== 'object') return null;
  const t = ahora.getTime();
  const inicio = Number(datos.inicio ?? datos.hasta - MAXIMA_MS);
  const tope = inicio + (datos.em ? EMERGENCIA_MS : MAXIMA_MS);
  return datos.hasta > t && tope > t ? { ...datos, inicio, emitida: Number(datos.emitida ?? inicio) } : null;
}

function leerCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${NOMBRE}=([^;]+)`).exec(req.headers.cookie || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

function ponerCookie(res, valor, maxAgeMs) {
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `${NOMBRE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${seguro}`);
}

// Cookie con la sesión de este usuario: su inicio (el tope), la passkey con la que entró y la versión
// de sus sesiones (cerrarlas todas la sube).
function emitir(res, usuario, { inicio, passkeyId = null, emergencia = false, ahora = new Date() }) {
  const t = ahora.getTime();
  const hasta = Math.min(t + INACTIVIDAD_MS, inicio + (emergencia ? EMERGENCIA_MS : MAXIMA_MS));
  ponerCookie(res, firmar({
    id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, v: Number(usuario.sesion_version || 0),
    pk: passkeyId, ...(emergencia ? { em: 1 } : {}), inicio, emitida: t, hasta,
  }), hasta - t);
}

const iniciarSesion = (res, usuario, { passkeyId = null, emergencia = false, ahora = new Date() } = {}) => emitir(res, usuario, { inicio: ahora.getTime(), passkeyId, emergencia, ahora });
const cerrarCookie = (res) => ponerCookie(res, '', 0);

function modoDemo() {
  return process.env.MODO_DEMO === '1' && process.env.NODE_ENV !== 'production';
}

// El usuario de la sesión tal como está ahora en la base, o null si la sesión ya no vale.
async function usuarioDeSesion(pool, datos) {
  const id = Number(datos.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const pk = datos.pk == null ? null : Number(datos.pk);
  const [[u]] = await pool.query(
    `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.sesion_version,
            (? IS NULL OR EXISTS (SELECT 1 FROM passkeys p WHERE p.id = ? AND p.usuario_id = u.id)) AS con_passkey
       FROM usuarios u WHERE u.id = ?`, [pk, pk, id]);
  if (!u || !u.activo || !Number(u.con_passkey) || Number(datos.v || 0) !== Number(u.sesion_version)) return null;
  return u;
}

// Middleware: req.usuario = { id, email, nombre, rol, emergencia, passkeyId }, o 401.
function exigirSesion({ pool }) {
  const p = () => (typeof pool === 'function' ? pool() : pool);
  return async (req, res, next) => {
    try {
      const ahora = req.ahora || new Date();
      const datos = verificar(leerCookie(req), ahora);
      const u = datos && await usuarioDeSesion(p(), datos);
      if (u) {
        const emergencia = Boolean(datos.em);
        req.usuario = { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, emergencia, passkeyId: datos.pk ?? null, inicio: datos.inicio };
        if (ahora.getTime() - datos.emitida >= RENOVAR_MS || u.rol !== datos.rol || u.nombre !== datos.nombre) {
          emitir(res, u, { inicio: datos.inicio, passkeyId: datos.pk ?? null, emergencia, ahora });
        }
        return next();
      }
      if (datos) cerrarCookie(res);
      if (modoDemo()) { req.usuario = { ...DEMO, emergencia: false, passkeyId: null }; return next(); }
      res.status(401).json({ error: 'Hay que entrar al panel', codigo: 'SIN_SESION' });
    } catch (err) {
      next(err);
    }
  };
}

// Lo que el panel sabe de la sesión: quién es, su rol y qué puede hacer (para ocultar lo demás).
function sesionPublica(u) {
  return {
    id: u.id ?? null, nombre: u.nombre, email: u.email, rol: u.rol, rolNombre: NOMBRE_ROL[u.rol] || u.rol,
    permisos: permisosDe(u.rol), demo: modoDemo(), emergencia: Boolean(u.emergencia),
  };
}

function rutasSesion({ pool }) {
  const r = express.Router();
  r.get('/sesion', exigirSesion({ pool }), (req, res) => res.json(sesionPublica(req.usuario)));
  r.post('/sesion/salir', (_req, res) => { cerrarCookie(res); res.json({ ok: true }); });
  return r;
}

module.exports = {
  exigirSesion, rutasSesion, iniciarSesion, emitir, cerrarCookie, sesionPublica, modoDemo, firmar, verificar, secreto,
  DURACION: { MAXIMA_MS, INACTIVIDAD_MS, RENOVAR_MS, EMERGENCIA_MS },
};
